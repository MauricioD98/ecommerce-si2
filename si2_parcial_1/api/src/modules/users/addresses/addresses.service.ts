import { Injectable, NotFoundException } from '@nestjs/common';
import { UserAddress } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AddressResponseDto } from './dto/address-response.dto';

@Injectable()
export class AddressesService {
  constructor(private prisma: PrismaService) {}

  // Predeterminada primero y luego las más recientes
  async findAll(userId: string): Promise<AddressResponseDto[]> {
    const addresses = await this.prisma.userAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return addresses.map((address) => this.toResponse(address));
  }

  async create(userId: string, dto: CreateAddressDto): Promise<AddressResponseDto> {
    const address = await this.prisma.$transaction(async (tx) => {
      // La primera dirección del usuario es la predeterminada
      const existing = await tx.userAddress.count({ where: { userId } });
      const isDefault = existing === 0 || dto.isDefault === true;

      // Solo una predeterminada por usuario
      if (isDefault) {
        await tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }

      return tx.userAddress.create({
        data: { ...dto, isDefault, userId },
      });
    });
    return this.toResponse(address);
  }

  async update(userId: string, id: string, dto: UpdateAddressDto): Promise<AddressResponseDto> {
    await this.findOwned(userId, id);

    const address = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.userAddress.update({ where: { id }, data: dto });
    });
    return this.toResponse(address);
  }

  // Deja una sola predeterminada por usuario: la elegida se marca y las demás pierden el flag
  async setDefault(userId: string, id: string): Promise<AddressResponseDto> {
    await this.findOwned(userId, id);

    const address = await this.prisma.$transaction(async (tx) => {
      await tx.userAddress.updateMany({ where: { userId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      return tx.userAddress.update({ where: { id }, data: { isDefault: true } });
    });
    return this.toResponse(address);
  }

  async remove(userId: string, id: string): Promise<{ message: string }> {
    const address = await this.findOwned(userId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.userAddress.delete({ where: { id } });

      // Si era la predeterminada, la más reciente pasa a serlo
      if (address.isDefault) {
        const next = await tx.userAddress.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
        if (next) {
          await tx.userAddress.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });
    return { message: 'Address deleted successfully' };
  }

  // Solo se accede a direcciones propias: una ajena responde igual que una inexistente
  private async findOwned(userId: string, id: string): Promise<UserAddress> {
    const address = await this.prisma.userAddress.findFirst({ where: { id, userId } });
    if (!address) {
      throw new NotFoundException('Address not found');
    }
    return address;
  }

  private toResponse(address: UserAddress): AddressResponseDto {
    return {
      id: address.id,
      title: address.title,
      address: address.address,
      reference: address.reference,
      latitude: address.latitude,
      longitude: address.longitude,
      isDefault: address.isDefault,
      createdAt: address.createdAt,
    };
  }
}
