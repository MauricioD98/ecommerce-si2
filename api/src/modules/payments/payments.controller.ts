import { Body, Controller, Get, Headers, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { ApiBadRequestResponse, ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreatePaymentIntentApiResponseDto, PaymentApiResponseDto } from './dto/payment-response.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { GenerateQrDto, ConfirmQrDto } from './dto/qr-payment.dto';

@Controller('payments')
@ApiTags('payments')
export class PaymentsController {

    constructor(private readonly paymentsService: PaymentsService) {}

    @Post("create-intent")
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('JWT-auth')
    @ApiOperation({
    summary: 'Create payment intent',
    description: 'Create a payment intent for an order. The amount is always computed server-side from order.totalAmount, never trusted from the request body'
    })
    @ApiCreatedResponse({
    description: 'Payment intent created successfully',
    type: CreatePaymentIntentApiResponseDto
    })  
    @ApiBadRequestResponse({
    description: 'invalid data or order not found',
  })
  async createPaymentIntent(
    @Body() createPaymentIntentDto: CreatePaymentIntentDto,
    @GetUser('id') userId: string,
  ) {
    return await this.paymentsService.createPaymentIntent(
      userId,
      createPaymentIntentDto,
    );
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
  summary: "Confirm payment",
  description: "Confirm a payment intent for an order"
 })
  @ApiResponse({
  status: 200,
  description: 'Payment confirmed successfully',
  type: PaymentApiResponseDto,
 })
  @ApiBadRequestResponse({
  description: 'Payment not found or already completed'
 })
 async confirmPayment(
    @Body() confirmPaymentDto: ConfirmPaymentDto,
    @GetUser('id') userId: string,
  ) {
    return await this.paymentsService.confirmPayment(userId, confirmPaymentDto);
  }

  // ─── PAGO CON QR (PROYECTO UNIVERSITARIO) ──────────────────────────────────

  @Post('qr/generate')
  @ApiOperation({
    summary: 'Generar código QR para pago simulado',
    description: 'Genera el QR de pago con URL para escanear y confirmar en la BD',
  })
  async generateQr(
    @Body() generateQrDto: GenerateQrDto,
    @Headers('origin') origin?: string,
  ) {
    const data = await this.paymentsService.generateQrPayment(generateQrDto.orderId, origin);
    return {
      success: true,
      data,
      message: 'Código QR generado exitosamente',
    };
  }

  @Get('qr/status/:orderId')
  @ApiOperation({
    summary: 'Consultar estado del pago por QR',
    description: 'Permite al frontend/móvil hacer polling mientras se espera el escaneo',
  })
  async getQrStatus(@Param('orderId') orderId: string) {
    return await this.paymentsService.getQrPaymentStatus(orderId);
  }

  @Post('qr/confirm')
  @ApiOperation({
    summary: 'Confirmar pago por QR',
    description: 'Confirma el pago por QR de una orden, actualizando la BD a COMPLETADO',
  })
  async confirmQrPayment(@Body() confirmQrDto: ConfirmQrDto) {
    const order = await this.paymentsService.markQrPaymentSucceeded(
      confirmQrDto.orderId,
      confirmQrDto.transactionId,
    );
    return {
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.paymentStatus,
      },
      message: 'Pago por QR confirmado exitosamente',
    };
  }

  @Get('qr-confirm/:orderId')
  @ApiOperation({
    summary: 'Endpoint de escaneo con cámara móvil',
    description: 'Página HTML que se abre al escanear el QR físico con un celular',
  })
  async qrConfirmHtml(@Param('orderId') orderId: string, @Res() res: Response) {
    try {
      const order = await this.paymentsService.markQrPaymentSucceeded(orderId);
      const totalFormatted = Number(order.totalAmount).toFixed(2);

      const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pago QR Confirmado - Stella Femme</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #1e293b; border-radius: 24px; padding: 36px 24px; max-width: 400px; width: 100%; text-align: center; border: 1px solid #334155; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    .icon { width: 72px; height: 72px; background: #065f46; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; color: #34d399; font-size: 38px; }
    h1 { font-size: 22px; color: #f8fafc; margin: 0 0 6px; }
    .badge { display: inline-block; background: rgba(52, 211, 153, 0.15); color: #34d399; border: 1px solid #059669; font-weight: 600; padding: 4px 12px; border-radius: 999px; font-size: 12px; margin-bottom: 20px; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px; }
    .details { background: #0f172a; border: 1px solid #334155; border-radius: 14px; padding: 16px; margin-bottom: 24px; text-align: left; }
    .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; color: #94a3b8; }
    .row:last-child { margin-bottom: 0; font-weight: bold; color: #f8fafc; font-size: 16px; padding-top: 8px; border-top: 1px solid #1e293b; }
    .status-ok { color: #34d399; font-weight: 700; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>¡Pago QR Confirmado!</h1>
    <div class="badge">Simulación Exitosa • Stella Femme</div>
    <p>El pago de este pedido fue procesado y registrado con éxito en la base de datos.</p>
    <div class="details">
      <div class="row"><span>N° Pedido:</span><span>#${order.orderNumber}</span></div>
      <div class="row"><span>Método:</span><span>QR Simple (Demo)</span></div>
      <div class="row"><span>Estado:</span><span class="status-ok">PAGADO (PROCESANDO)</span></div>
      <div class="row"><span>Total:</span><span>Bs ${totalFormatted}</span></div>
    </div>
    <p style="font-size:12px; color:#64748b; margin:0;">
      Ya puedes volver a la pantalla de compra. Se actualizará automáticamente.
    </p>
  </div>
</body>
</html>
      `;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (error) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(`
        <div style="font-family:sans-serif; text-align:center; padding:40px;">
          <h2>No se pudo procesar el pago del pedido</h2>
          <p>${(error as Error).message || 'Error desconocido'}</p>
        </div>
      `);
    }
  }

@Get()
@ApiOperation({
  summary: 'Get all payments',
  description: 'Get all payments for the current user',
})
@ApiOkResponse({
  description: 'Payments retrieved successfully',
  type: PaymentApiResponseDto,
})
async findAll(@GetUser('id') userId: string) {
  return await this.paymentsService.findAll(userId);
}

@Get(':id')
@ApiParam({
  name: 'id',
  description: 'Payment ID',
  example: '154sd4848ds5d-4654-4sdd8s7d-sd4656'
})
@ApiOperation({
  summary: 'Get payment by ID',
  description: 'Get a specific payment by its ID'
})
@ApiOkResponse({
  description: 'Payment retrieved successfully',
  type: PaymentApiResponseDto
})
@ApiNotFoundResponse({
  description: 'Payment not found',
})
async findOne(@Param('id') id: string, @GetUser('id') userId: string) {
  return await this.paymentsService.findOne(id, userId);
}


@Get('order/:orderId')
@ApiParam({
  name: 'orderId',
  description: 'Order ID',
  example: 'order-123'
})
@ApiOperation({
  summary: 'Get payment by order ID',
  description: 'Get payment information for a specific order'
})
@ApiOkResponse({
  description: 'Payment retrieved successfully',
  type: PaymentApiResponseDto
})
@ApiNotFoundResponse({
  description: 'Payment not found',
})
async findByOrder(
  @Param('orderId') orderId: string,
  @GetUser('id') userId: string,
) {
  return await this.paymentsService.findByOrder(orderId, userId);
}

}
