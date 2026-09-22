import { ApiProperty } from '@nestjs/swagger';

export class RoleResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Admin Sucursal' })
  name: string;

  @ApiProperty({ example: 'Gestiona su sucursal', nullable: true })
  description: string | null;

  @ApiProperty({ type: [String], example: ['MANAGE_USERS', 'MANAGE_INVENTORY', 'VIEW_ORDERS'] })
  permissions: string[];

  @ApiProperty({ example: 3, description: 'Usuarios que tienen este rol' })
  usersCount: number;

  @ApiProperty({ example: true, description: 'Rol base del sistema: no se puede eliminar ni renombrar' })
  isBase: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
