import { ApiProperty } from "@nestjs/swagger";

export class UserRoleDto {
  @ApiProperty({ description: 'Role ID', example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ description: 'Role name', example: 'Admin Sucursal' })
  name: string;
}

export class UserResponseDto {
  @ApiProperty({ description: 'User ID', example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ description: 'User email address', example: 'user@example.com' })
  email: string;

  @ApiProperty({ description: 'User first name', example: 'John', nullable:true, })
  firstName: string | null;

  @ApiProperty({ description: 'User last name', example: 'Doe', nullable:true, })
  lastName: string| null;

  @ApiProperty({ description: 'Teléfono de contacto', example: '+591 70000000', nullable: true })
  phone: string | null;

  @ApiProperty({ description: 'Sucursal favorita del cliente (notificaciones)', nullable: true })
  preferredBranchId: string | null;

  @ApiProperty({ description: 'User role', type: UserRoleDto })
  role: UserRoleDto;

  @ApiProperty({
    description: 'Permissions granted by the role',
    type: [String],
    example: ['MANAGE_INVENTORY', 'VIEW_ORDERS'],
  })
  permissions: string[];

  @ApiProperty({ description: 'Assigned branch ID (staff only)', nullable: true })
  branchId: string | null;

  @ApiProperty({ description: 'Employee discount percentage (0-100)', example: 0 })
  employeeDiscount: number;

  @ApiProperty({ description: 'Account creation date', example: '2023-10-01T12:34:56.789Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Last account update date', example: '2023-10-10T12:34:56.789Z' })
  updatedAt: Date;

}
