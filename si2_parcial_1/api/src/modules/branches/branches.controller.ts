import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { InventoryService } from './inventory.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { SetInventoryDto } from './dto/set-inventory.dto';
import { BranchResponseDto, InventoryResponseDto } from './dto/branch-response.dto';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { BranchGuard } from '../../common/decorators/guards/branch.guard';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';

@ApiTags('branches')
@Controller('branches')
export class BranchesController {
  constructor(
    private readonly branchesService: BranchesService,
    private readonly inventoryService: InventoryService,
  ) {}

  // Public: selector de sucursal del cliente
  @Get()
  @ApiOperation({ summary: 'Get active branches (public)' })
  @ApiResponse({ status: 200, description: 'List of active branches', type: [BranchResponseDto] })
  async findAllActive(): Promise<BranchResponseDto[]> {
    return await this.branchesService.findAllActive();
  }

  @Get('manage/all')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @AnyPermission(Permission.MANAGE_BRANCHES, Permission.MANAGE_INVENTORY, Permission.MANAGE_USERS, Permission.VIEW_ORDERS)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get all branches, including inactive (own branch for ADMIN_SUCURSAL)' })
  @ApiResponse({ status: 200, description: 'List of branches', type: [BranchResponseDto] })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAllForAdmin(@GetUser() user: AuthUser): Promise<BranchResponseDto[]> {
    return await this.branchesService.findAllForAdmin(user);
  }

  @Get(':branchId')
  @ApiOperation({ summary: 'Get an active branch by ID (public)' })
  @ApiParam({ name: 'branchId', description: 'Branch ID' })
  @ApiResponse({ status: 200, description: 'Branch details', type: BranchResponseDto })
  @ApiResponse({ status: 404, description: 'Branch not found or inactive' })
  async findOne(@Param('branchId', ParseUUIDPipe) branchId: string): Promise<BranchResponseDto> {
    return await this.branchesService.findActiveOrFail(branchId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_BRANCHES, Permission.ALL_BRANCHES)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a branch (SUPERADMIN only)' })
  @ApiBody({ type: CreateBranchDto })
  @ApiResponse({ status: 201, description: 'Branch created successfully', type: BranchResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(@Body() createBranchDto: CreateBranchDto): Promise<BranchResponseDto> {
    return await this.branchesService.create(createBranchDto);
  }

  @Patch(':branchId')
  @UseGuards(JwtAuthGuard, PermissionsGuard, BranchGuard)
  @Permissions(Permission.MANAGE_BRANCHES)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update a branch (ADMIN_SUCURSAL only its own branch)' })
  @ApiParam({ name: 'branchId', description: 'Branch ID' })
  @ApiBody({ type: UpdateBranchDto })
  @ApiResponse({ status: 200, description: 'Branch updated successfully', type: BranchResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async update(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() updateBranchDto: UpdateBranchDto,
    @GetUser() user: AuthUser,
  ): Promise<BranchResponseDto> {
    return await this.branchesService.update(branchId, updateBranchDto, user);
  }

  @Delete(':branchId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions(Permission.MANAGE_BRANCHES, Permission.ALL_BRANCHES)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a branch (SUPERADMIN only)' })
  @ApiParam({ name: 'branchId', description: 'Branch ID' })
  @ApiResponse({ status: 200, description: 'Branch deleted successfully' })
  @ApiResponse({ status: 400, description: 'La sucursal tiene inventario, pedidos o usuarios asociados' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async remove(@Param('branchId', ParseUUIDPipe) branchId: string): Promise<{ message: string }> {
    return await this.branchesService.remove(branchId);
  }

  // Inventario por sucursal
  @Get(':branchId/inventory')
  @UseGuards(JwtAuthGuard, PermissionsGuard, BranchGuard)
  @Permissions(Permission.MANAGE_INVENTORY)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get the inventory of a branch (staff of that branch only)' })
  @ApiParam({ name: 'branchId', description: 'Branch ID' })
  @ApiResponse({ status: 200, description: 'Branch inventory', type: [InventoryResponseDto] })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getInventory(
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<InventoryResponseDto[]> {
    return await this.inventoryService.listByBranch(branchId);
  }

  @Put(':branchId/inventory/:productId')
  @UseGuards(JwtAuthGuard, PermissionsGuard, BranchGuard)
  @Permissions(Permission.MANAGE_INVENTORY)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Set the stock and discount of a product in a branch (ADMIN_SUCURSAL only its own branch)' })
  @ApiParam({ name: 'branchId', description: 'Branch ID' })
  @ApiParam({ name: 'productId', description: 'Product ID' })
  @ApiBody({ type: SetInventoryDto })
  @ApiResponse({ status: 200, description: 'Stock updated successfully', type: InventoryResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Branch or product not found' })
  async setInventory(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetInventoryDto,
  ): Promise<InventoryResponseDto> {
    return await this.inventoryService.setStock(branchId, productId, dto);
  }
}
