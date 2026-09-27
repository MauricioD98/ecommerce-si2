import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChatbotService } from './chatbot.service';
import { ChatbotCatalogDto } from './dto/chatbot-product-response.dto';
import { QueryChatbotProductsDto } from './dto/query-chatbot-products.dto';
import { RelaxedThrottle } from '../../common/decorators/custom-throttler.decorator';

// Endpoint público para el chatbot (Botpress). No lleva JwtAuthGuard a propósito: expone lo mismo
// que ya es público en GET /products, y el bot habla con clientes sin sesión. Sí lleva rate limit,
// porque sin autenticación es la única defensa contra un bucle del bot martillando la base.
@ApiTags('chatbot')
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Get('products')
  @UseGuards(ThrottlerGuard)
  @RelaxedThrottle()
  @ApiOperation({
    summary: 'Catálogo de productos activos con disponibilidad, aplanado para un chatbot (público)',
  })
  @ApiResponse({
    status: 200,
    description: 'Productos activos con stock por talla',
    type: ChatbotCatalogDto,
  })
  @ApiResponse({
    status: 503,
    description: 'La base de datos no respondió: el bot debe decir que no pudo consultar, no que no hay stock',
  })
  async getProducts(@Query() queryDto: QueryChatbotProductsDto): Promise<ChatbotCatalogDto> {
    return await this.chatbotService.getCatalog(queryDto);
  }
}
