import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CollectionsService } from './collections.service';
import { CollectionResponseDto } from './dto/collection-response.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { QueryCollectionDto } from './dto/query-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';

// Público en lectura (igual que categories): el catálogo y el filtro de colecciones no requieren sesión
@ApiTags('Collections')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new collection (MANAGE_PRODUCTS)' })
  @ApiBody({ type: CreateCollectionDto })
  @ApiResponse({ status: 201, description: 'Collection created successfully', type: CollectionResponseDto })
  @ApiResponse({ status: 409, description: 'Slug already exists' })
  async create(@Body() createCollectionDto: CreateCollectionDto): Promise<CollectionResponseDto> {
    return await this.collectionsService.create(createCollectionDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all collections' })
  @ApiResponse({
    status: 200,
    description: 'List of collections',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/CollectionResponseDto' } },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  async findAll(@Query() queryDto: QueryCollectionDto) {
    return await this.collectionsService.findAll(queryDto);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get collection by slug (used by the catalog page /colecciones/:slug)' })
  @ApiResponse({ status: 200, description: 'Collection details', type: CollectionResponseDto })
  @ApiResponse({ status: 404, description: 'Collection not found' })
  async findBySlug(@Param('slug') slug: string): Promise<CollectionResponseDto> {
    return await this.collectionsService.findBySlug(slug);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update collection (MANAGE_PRODUCTS)' })
  @ApiBody({ type: UpdateCollectionDto })
  @ApiResponse({ status: 200, description: 'Collection updated successfully', type: CollectionResponseDto })
  @ApiResponse({ status: 404, description: 'Collection not found' })
  @ApiResponse({ status: 409, description: 'Slug already exists' })
  async update(@Param('id') id: string, @Body() updateCollectionDto: UpdateCollectionDto): Promise<CollectionResponseDto> {
    return await this.collectionsService.update(id, updateCollectionDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete collection (MANAGE_PRODUCTS)' })
  @ApiResponse({ status: 200, description: 'Collection deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete collection with products' })
  @ApiResponse({ status: 404, description: 'Collection not found' })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return await this.collectionsService.remove(id);
  }
}
