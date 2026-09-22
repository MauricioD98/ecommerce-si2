import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { BulkDiscountDto } from '../branches/dto/bulk-discount.dto';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Create
  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create a new product (MANAGE_PRODUCTS: Super Admin and Admin Sucursal). Starts with stock 0 in every branch',
  })
  @ApiBody({
    type: CreateProductDto
  })
  @ApiResponse({
    status: 201,
    description: 'Product created successfully',
    type: ProductResponseDto,
  })
  
  @ApiResponse({
    status: 409,
    description: 'Sku already exists',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required',
  })

  async create(
    @Body() createProductDto: CreateProductDto,
    @GetUser() actor: AuthUser,
  ): Promise<ProductResponseDto> {
    return await this.productsService.create(createProductDto, actor);
  }

  @Get()
  @ApiOperation({
    summary: "Get all products with optional filters"
  })
  @ApiResponse({
    status: 200,
    description: "List of products with pagination",
    schema: {
      type: 'object',
      properties: {
        data: {
          type: "array",
          items: { $ref: '#/components/schemas/ProductResponseDto' }
        },

        meta: {
          type: "object",
          properties: {
            total: { type: "number" },
            page: { type: 'number' },
            limit: { type: 'number' },
            totalPages: { type: 'number' }
          }
        }
      }
    }
  })
  async findAll(@Query() queryDto: QueryProductDto) {
  return await this.productsService.findAll(queryDto);
    }

  @Get(':id')
  @ApiOperation({
    summary: " Get product by id"
  })
  @ApiResponse({
    status: 200,
    description: "Product details",
    type: ProductResponseDto
  })
  @ApiResponse({
    status: 404,
    description: "Product not found"
  })  
  async findOne(
    @Param('id') id: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ): Promise<ProductResponseDto> {
  return await this.productsService.findOne(id, branchId);
}

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Update a product (MANAGE_PRODUCTS)'
  })
  @ApiBody({
    type: UpdateProductDto
  }) 
  @ApiResponse({
    status: 200,
    description: 'Product updated successfully',
    type: ProductResponseDto
  })
  @ApiResponse({
    status: 404,
    description: 'Product not found'
  })
  @ApiResponse({
    status: 409,
    description: 'SKu already exists'
  })
  async update(
  @Param('id') id: string,
  @Body() updateProductDto: UpdateProductDto,
  @GetUser() actor: AuthUser,
): Promise<ProductResponseDto> {
  return await this.productsService.update(id, updateProductDto, actor);
}
 
 // Descuento masivo: solo SUPERADMIN. Cada ADMIN_SUCURSAL edita el de su sucursal en PUT /branches/:branchId/inventory/:productId
  @Put(':productId/discounts/bulk')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_INVENTORY, Permission.ALL_BRANCHES)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Apply a discount to a product in all branches (SUPERADMIN only)'
  })
  @ApiBody({
    type: BulkDiscountDto
  })
  @ApiResponse({
    status: 200,
    description: 'Discount applied to every branch',
    schema: { type: 'object', properties: { updatedBranches: { type: 'number' } } },
  })
  @ApiResponse({
    status: 400,
    description: 'No discount provided or discountPrice not lower than the price'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - SUPERADMIN role required'
  })
  @ApiResponse({
    status: 404,
    description: 'Product not found'
  })
  async applyDiscountToAllBranches(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: BulkDiscountDto,
  ): Promise<{ updatedBranches: number }> {
    return await this.productsService.applyDiscountToAllBranches(productId, dto);
  }

  // Stock global (legado). Cada sucursal gestiona el suyo en PUT /branches/:branchId/inventory/:productId
  @Patch(':id/stock')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_PRODUCTS, Permission.ALL_BRANCHES)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: "Update product stock (Admin Only)"
  }) 
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        quantity: {
          type: "number",
          description: "Stock adjustment ( positive to add, negative to subtract) ",
          example:10
        }
      },
      required:['quantity']
    }
  })
  @ApiResponse({
    status: 200,
    description: "Stock updated successfully",
    type: ProductResponseDto
  })
  @ApiResponse({
    status: 400,
    description: "Insufficient stock"
  })
  @ApiResponse({
    status: 404,
    description: "Product not found"
  })
  async updateStock(
  @Param('id') id: string,
  @Body('quantity') quantity: number,
): Promise<ProductResponseDto> {
  return await this.productsService.updateStock(id, quantity);
}

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Delete product (MANAGE_PRODUCTS)"
  })
  @ApiResponse({
    status: 200,
    description: "Product deleted successfully"
  })
  @ApiResponse({
    status: 404,
    description: "Product not found"
  })
  @ApiResponse({
    status: 400,
    description: "Cannot delete product in active orders"
  })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
  return await this.productsService.remove(id);
}
}