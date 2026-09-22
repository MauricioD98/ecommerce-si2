import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { CategoryService } from './category.service';
import { QueryCategoryDto } from './dto/query-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Categories')
@Controller('categories')
export class CategoryController {
constructor(private readonly categoryService: CategoryService) {}

// Create a new category
@Post()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(Permission.MANAGE_PRODUCTS)
@ApiBearerAuth('JWT-auth')
@ApiOperation({ summary: 'Create a new category' })
@ApiBody({ type: CreateCategoryDto })
@ApiResponse({ status: 201, description: 'Category created successfully.' })
@ApiResponse({ status: 400, description: 'Invalid input data.' })
@ApiResponse({ status: 401, description: 'Unauthorized.' })
@ApiResponse({ status: 403, description: 'Forbidden.' })
async create(
  @Body() createCategoryDto: CreateCategoryDto,
): Promise<CategoryResponseDto> {
  return await this.categoryService.create(createCategoryDto);  
}

@Get()
  @ApiOperation({ summary: 'Get all categories' })
  @ApiResponse({
    status: 200,
    description: 'List of categories retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/CategoryResponseDto' },
        },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
            totalPages: { type: 'number' },
          }
        }
      }
    }
  })
  async findAll(@Query() queryDto: QueryCategoryDto) {
    return await this.categoryService.findAll(queryDto);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get category by ID" })
  @ApiResponse({
    status: 200,
    description: "Category details",
    type: CategoryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: "Category not found",
  })
 async findOne(@Param('id') id: string): Promise<CategoryResponseDto> {
  return await this.categoryService.findOne(id);
 }

 @Get('slug/:slug')
  @ApiOperation({
    summary: 'Get category by slug',
  })
  @ApiResponse({
    status: 200,
    description: 'Category details',
    type: CategoryResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findBySlug(@Param('slug') slug: string): Promise<CategoryResponseDto> {
    return await this.categoryService.findBySlug(slug);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update category (Admin only)' })
  @ApiBody({
    type:UpdateCategoryDto
  })
  @ApiResponse({
    status: 200,
    description: 'Category updated successfully',
    type: CategoryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Category not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Category slug already exists',
  })
  async update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.update(id, updateCategoryDto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete category (Admin Only)" })
  @ApiResponse({
    status: 400,
    description: "Cannot delete category with products",
  })
  @ApiResponse({
    status: 200,
    description: "Category deleted successfully",
  })
  @ApiResponse({
    status: 404,
    description: "Category not found",
  })
    async remove(@Param('id') id: string): Promise<{ message: string }> {
    return await this.categoryService.remove(id);
  }
  }

