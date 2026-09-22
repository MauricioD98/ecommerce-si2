import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AddressResponseDto } from './dto/address-response.dto';
import { JwtAuthGuard } from '../../../common/decorators/guards/jwt-auth.guard';
import { GetUser } from '../../../common/decorators/get-user.decorator';

// Direcciones guardadas del usuario autenticado (cualquier rol): siempre se filtra por su propio id
@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('users/me/addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'List my saved addresses (default first)' })
  @ApiResponse({ status: 200, type: [AddressResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(@GetUser('id') userId: string): Promise<AddressResponseDto[]> {
    return await this.addressesService.findAll(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Save a new address with its map location' })
  @ApiBody({ type: CreateAddressDto })
  @ApiResponse({ status: 201, type: AddressResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @GetUser('id') userId: string,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressResponseDto> {
    return await this.addressesService.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update one of my addresses (or make it the default)' })
  @ApiParam({ name: 'id', description: 'Address ID' })
  @ApiBody({ type: UpdateAddressDto })
  @ApiResponse({ status: 200, type: AddressResponseDto })
  @ApiResponse({ status: 404, description: 'Address not found' })
  async update(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressResponseDto> {
    return await this.addressesService.update(userId, id, dto);
  }

  // PUT: edición completa de una dirección (título, calle, referencia y ubicación)
  @Put(':id')
  @ApiOperation({ summary: 'Edit one of my addresses' })
  @ApiParam({ name: 'id', description: 'Address ID' })
  @ApiBody({ type: UpdateAddressDto })
  @ApiResponse({ status: 200, type: AddressResponseDto })
  @ApiResponse({ status: 404, description: 'Address not found' })
  async replace(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressResponseDto> {
    return await this.addressesService.update(userId, id, dto);
  }

  @Patch(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make one of my addresses the default (the others lose the flag)' })
  @ApiParam({ name: 'id', description: 'Address ID' })
  @ApiResponse({ status: 200, type: AddressResponseDto })
  @ApiResponse({ status: 404, description: 'Address not found' })
  async setDefault(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AddressResponseDto> {
    return await this.addressesService.setDefault(userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete one of my addresses' })
  @ApiParam({ name: 'id', description: 'Address ID' })
  @ApiResponse({ status: 200, description: 'Address deleted successfully' })
  @ApiResponse({ status: 404, description: 'Address not found' })
  async remove(
    @GetUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    return await this.addressesService.remove(userId, id);
  }
}
