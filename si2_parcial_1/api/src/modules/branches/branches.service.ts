import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Branch } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { hasAllBranches } from '../../common/utils/permission.util';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  async create(createBranchDto: CreateBranchDto): Promise<Branch> {
    return await this.prisma.branch.create({ data: createBranchDto });
  }

  // Público: solo sucursales activas
  async findAllActive(): Promise<Branch[]> {
    return await this.prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // Administración: con alcance global se ven todas; con alcance de sucursal solo la propia
  async findAllForAdmin(actor: AuthUser): Promise<Branch[]> {
    return await this.prisma.branch.findMany({
      where: hasAllBranches(actor) ? {} : { id: actor.branchId ?? '' },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<Branch> {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  // Sucursal que puede recibir pedidos / mostrar stock (debe existir y estar activa)
  async findActiveOrFail(id: string): Promise<Branch> {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch || !branch.isActive) {
      throw new NotFoundException('Branch not found or inactive');
    }
    return branch;
  }

  async update(id: string, updateBranchDto: UpdateBranchDto, actor: AuthUser): Promise<Branch> {
    await this.findOne(id);

    // Activar/desactivar una sucursal requiere alcance global
    if (updateBranchDto.isActive !== undefined && !hasAllBranches(actor)) {
      throw new ForbiddenException('Only a user with access to all branches can activate or deactivate a branch');
    }

    return await this.prisma.branch.update({
      where: { id },
      data: updateBranchDto,
    });
  }

  async remove(id: string): Promise<{ message: string }> {
    await this.findOne(id);

    // Integridad referencial: inventario, pedidos, personal asignado o clientes que la tengan como favorita
    const [inventories, orders, staffUsers, preferredByUsers] = await Promise.all([
      this.prisma.productInventory.count({ where: { branchId: id } }),
      this.prisma.order.count({ where: { branchId: id } }),
      this.prisma.user.count({ where: { branchId: id } }),
      this.prisma.user.count({ where: { preferredBranchId: id } }),
    ]);
    if (inventories > 0 || orders > 0 || staffUsers > 0 || preferredByUsers > 0) {
      throw new BadRequestException(
        'No se puede eliminar la sucursal porque tiene inventario, pedidos o usuarios asociados.',
      );
    }

    await this.prisma.branch.delete({ where: { id } });
    return { message: 'Branch deleted successfully' };
  }
}
