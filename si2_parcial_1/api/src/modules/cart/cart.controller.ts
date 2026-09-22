
import { Controller, Get, Post, Patch, Delete, Body, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Cart')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard) 
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener el carrito activo del usuario' })
  @ApiResponse({ status: 200, description: 'Carrito recuperado exitosamente.' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Sucursal cuyos descuentos se aplican a los precios' })
  getCart(
    @GetUser('id') userId: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.cartService.getOrCreateCart(userId, branchId);
  }

  @Post('items')
  @ApiOperation({ summary: 'Agregar un producto al carrito' })
  @ApiResponse({ status: 201, description: 'Producto agregado al carrito.' })
  @ApiResponse({ status: 400, description: 'Stock insuficiente.' })
  addItem(
    @GetUser('id') userId: string, 
    @Body() dto: AddCartItemDto,
  ) {
    return this.cartService.addItem(userId, dto);
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Actualizar la cantidad de un ítem en el carrito' })
  @ApiParam({ name: 'itemId', description: 'ID del registro CartItem' })
  @ApiResponse({ status: 200, description: 'Cantidad actualizada correctamente.' })
  updateItemQuantity(
    @GetUser('id') userId: string, 
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItemQuantity(userId, itemId, dto);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Eliminar un ítem del carrito' })
  @ApiParam({ name: 'itemId', description: 'ID del registro CartItem' })
  @ApiResponse({ status: 200, description: 'Ítem eliminado.' })
  @ApiQuery({ name: 'branchId', required: false })
  removeItem(
    @GetUser('id') userId: string,
    @Param('itemId') itemId: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.cartService.removeItem(userId, itemId, branchId);
  }

  @Delete()
  @ApiOperation({ summary: 'Vaciar todo el contenido del carrito' })
  @ApiResponse({ status: 200, description: 'Carrito vaciado exitosamente.' })
  @ApiQuery({ name: 'branchId', required: false })
  clearCart(
    @GetUser('id') userId: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.cartService.clearCart(userId, branchId);
  }
}