import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags, ApiTooManyRequestsResponse, getSchemaPath } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { OrdersService } from './orders.service';
import { ModerateThrottle, RelaxedThrottle } from '../../common/decorators/custom-throttler.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderApiResponseDto, OrderResponseDto, PaginatedOrderResponseDto } from './dto/order-response.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { QueryOrderDto } from './dto/query-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';

@ApiTags('orders')
@ApiBearerAuth('JWT-auth')
@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
constructor(private readonly ordersService: OrdersService) {}

// Create orders
@Post()
@ModerateThrottle()
@ApiOperation({
  summary: "Create a new order"
})
@ApiBody({
  type: CreateOrderDto
})
@ApiCreatedResponse({
  description: "Order created successfully",
  type: OrderApiResponseDto
})

@ApiBadRequestResponse({
  description: "Invalid data or insufficient stock",
})
@ApiNotFoundResponse({
  description: "Cart not found or empty",
})
@ApiTooManyRequestsResponse({
  description: 'Too many requests - rate limit exceeded',
})
async create(
  @Body() createOrderDto: CreateOrderDto,
  @GetUser() user: AuthUser,
) {
    return await this.ordersService.create(user, createOrderDto);
}

@Get('admin/all')
@Permissions(Permission.VIEW_ORDERS)
@RelaxedThrottle()
@ApiOperation({
  summary: '[ADMIN] Get all orders (paginated)'
})
@ApiQuery({
  name: 'status', required: false, type: String
})
@ApiQuery({
  name: 'page', required: false, type: Number
})
@ApiQuery({
  name: 'limit', required: false, type: Number
})
@ApiResponse({
  description: 'List of orders',
  schema: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: getSchemaPath(OrderResponseDto) }
        },
        total: { type: "number" },
        page: { type: "number" },
        limit: { type: "number" },
    }
  }
})
@ApiForbiddenResponse({
  description: 'Admin access required',
})
async findAllForAdmin(@Query() query:QueryOrderDto, @GetUser() actor: AuthUser) {

  return await this.ordersService.findAllForAdmin(query, actor);
}

  
@Get()
@RelaxedThrottle()
@ApiOperation({
  summary: 'Get all orders for current user (paginated)'
})
@ApiQuery({ name: 'status', required: false, type: String })
@ApiQuery({ name: 'page', required: false, type: Number })
@ApiQuery({ name: 'limit', required: false, type: Number })
@ApiOkResponse({
  description: "List of user orders",
  type: PaginatedOrderResponseDto
})
async findAll(@Query() query: QueryOrderDto, @GetUser('id') userId: string) {
  return await this.ordersService.findAll(userId, query);
}

@Get('me')
@RelaxedThrottle()
@ApiOperation({
  summary: 'Mis pedidos: historial del cliente autenticado (paginado, más recientes primero)'
})
@ApiQuery({ name: 'status', required: false, type: String })
@ApiQuery({ name: 'page', required: false, type: Number })
@ApiQuery({ name: 'limit', required: false, type: Number })
@ApiOkResponse({
  description: "List of the current user's orders, including items, item sizes and payment status",
  type: PaginatedOrderResponseDto
})
async findMine(@Query() query: QueryOrderDto, @GetUser('id') userId: string) {
  return await this.ordersService.findAll(userId, query);
}

@Get('admin/:id')
@Permissions(Permission.VIEW_ORDERS)
@RelaxedThrottle()
@ApiOperation({
  summary: "[ADMIN]: Get order by id"
})
@ApiParam({
  name: 'id', description: 'Order ID'
})
@ApiOkResponse({
  description: 'Order details',
  type: OrderApiResponseDto
})
@ApiNotFoundResponse({
  description: 'Order not found',
})
@ApiForbiddenResponse({
  description: 'Admin access required',
})
async findOneAdmin(@Param('id') id: string, @GetUser() actor: AuthUser) {
  return await this.ordersService.findOne(id, undefined, actor);
}

@Get(':id')
@RelaxedThrottle()
@ApiOperation({
  summary: 'Get an order by ID for current user'
})
@ApiParam({
  name: 'id',
  description: 'Order ID'
})
@ApiOkResponse({ description: 'Order details', type: OrderApiResponseDto })
@ApiNotFoundResponse({
  description: 'Order not found'
})
async findOne(@Param('id') id: string, @GetUser('id') userId: string) {
  return await this.ordersService.findOne(id, userId);
}

@Patch('admin/:id')
@Permissions(Permission.VIEW_ORDERS)
@ModerateThrottle()
@ApiOperation({
  summary: "[ADMIN] Update any order"
})
@ApiParam({
  name: 'id', description: 'Order ID'
})
@ApiBody({
  type: UpdateOrderDto
})
@ApiOkResponse({
  description: 'Order update successfully',
  type: OrderApiResponseDto
})
@ApiNotFoundResponse({
  description: 'Order not found'
})
@ApiForbiddenResponse({
  description: 'Admin access required'
})
  async updateAdmin(@Param('id') id: string, @Body() dto: UpdateOrderDto, @GetUser() actor: AuthUser) {
  return await this.ordersService.update(id, dto, undefined, actor);
}

@Patch(':id')
@ModerateThrottle()
@ApiOperation({
  summary: 'Update your own order'
})
@ApiParam({
  name: 'id', description: 'Order ID'
})
@ApiBody({
  type: UpdateOrderDto
})
@ApiOkResponse({
  description: 'Order updated successfully',
})
@ApiNotFoundResponse({
  description: 'Order not found',
})
async update(
  @Param('id') id: string,
  @Body() dto: UpdateOrderDto,
  @GetUser('id') userId: string,
) {
  return await this.ordersService.update(id, dto, userId);
}

@Delete('admin/:id')
@Permissions(Permission.VIEW_ORDERS)
@ModerateThrottle()
@ApiOperation({
  summary: 'ADMIN cancel order by ID'
})
@ApiParam({
  name: 'id', description: 'Order ID'
})
@ApiOkResponse({
  description: 'Order cancelled!', type: OrderApiResponseDto
})
@ApiNotFoundResponse({
  description: 'Order not found',
})
async cancelAdmin(@Param('id') id: string, @GetUser() actor: AuthUser) {
  return await this.ordersService.cancel(id, undefined, actor);
}



@Delete(':id')
@ModerateThrottle()
@ApiOperation({
  summary: 'User cancel order by ID'
})
@ApiParam({
  name: 'id', description: 'Order ID'
})
@ApiOkResponse({
  description: 'Order cancelled!',
  type: OrderApiResponseDto,
})
@ApiNotFoundResponse({
  description: 'Order not found',
})
async cancel(@Param('id') id: string, @GetUser('id') userId: string) {
  return await this.ordersService.cancel(id, userId);
}

}
