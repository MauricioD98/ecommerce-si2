import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { UsersService } from './users.service';
import { UserResponseDto } from './dto/user-response.dto';
import type { RequestWithUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { UpdateUserDto } from './dto/update-user.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';


@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard,PermissionsGuard)
@Controller('users')
export class UsersController {

constructor(private readonly usersService: UsersService) {}

// Get current user profile
@Get('me')
@ApiOperation({ summary: 'Get current user profile' })
@ApiResponse({
  status: 200,
  description: 'The current user profile',
  type: UserResponseDto,
})

@ApiResponse({ status: 401, description: 'Unauthorized' })
async getProfile(@Req() req: RequestWithUser): Promise<UserResponseDto> {
  return await this.usersService.findOne(req.user.id);
  }

@Get()
@Permissions(Permission.MANAGE_USERS, Permission.ALL_BRANCHES)
@ApiOperation({ summary: 'Get all users' })
@ApiResponse({
  status: 200,
  description: 'List of all users',
  type: [UserResponseDto],
})

@ApiResponse({ status: 401, description: 'Unauthorized' })
async findAll(): Promise<UserResponseDto[]> {
  return await this.usersService.findAll();
}

// Staff management (declared before :id so "staff" is not parsed as an ID)
@Get('staff')
@Permissions(Permission.MANAGE_USERS)
@ApiOperation({ summary: 'List staff (ADMIN_SUCURSAL only its own branch)' })
@ApiResponse({ status: 200, description: 'List of staff users', type: [UserResponseDto] })
@ApiResponse({ status: 403, description: 'Forbidden' })
async findAllStaff(@GetUser() actor: AuthUser): Promise<UserResponseDto[]> {
  return await this.usersService.findAllStaff(actor);
}

@Post('staff')
@Permissions(Permission.MANAGE_USERS)
@ApiOperation({ summary: 'Create an ADMIN_SUCURSAL or EMPLEADO user (ADMIN_SUCURSAL only for its own branch)' })
@ApiBody({ type: CreateStaffDto })
@ApiResponse({ status: 201, description: 'Staff user created', type: UserResponseDto })
@ApiResponse({ status: 403, description: 'Forbidden' })
@ApiResponse({ status: 409, description: 'Email already in use' })
async createStaff(
  @GetUser() actor: AuthUser,
  @Body() createStaffDto: CreateStaffDto,
): Promise<UserResponseDto> {
  return await this.usersService.createStaff(actor, createStaffDto);
}

@Patch('staff/:id')
@Permissions(Permission.MANAGE_USERS)
@ApiOperation({ summary: 'Update staff role, branch or employee discount' })
@ApiBody({ type: UpdateStaffDto })
@ApiResponse({ status: 200, description: 'Staff user updated', type: UserResponseDto })
@ApiResponse({ status: 403, description: 'Forbidden' })
@ApiResponse({ status: 404, description: 'Staff user not found' })
async updateStaff(
  @GetUser() actor: AuthUser,
  @Param('id') id: string,
  @Body() updateStaffDto: UpdateStaffDto,
): Promise<UserResponseDto> {
  return await this.usersService.updateStaff(actor, id, updateStaffDto);
}

@Get(':id')
@Permissions(Permission.MANAGE_USERS, Permission.ALL_BRANCHES)
@ApiOperation({ summary: 'Get user by ID' })
@ApiResponse({
  status: 200,
  description: 'The user with the specified ID',
  type: UserResponseDto,
})
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 404, description: 'User not found' })
async findOne(@Param('id') id: string): Promise<UserResponseDto> {
  return await this.usersService.findOne(id);
}

@Patch('me')
@ApiOperation({ summary: 'Update current user profile' })
@ApiBody({ type: UpdateUserDto })
@ApiResponse({
  status: 200,
  description: 'The updated user profile',
  type: UserResponseDto,
})

@Patch('me')
@ApiResponse({ status: 200, description: 'Profile updated successfully' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 409, description: 'Email already in use' })
async updateProfile(
  @GetUser('id') userId: string,
  @Body() updateUserDto: UpdateUserDto,
): Promise<UserResponseDto> {
  return await this.usersService.update(userId, updateUserDto);
}

/*@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 409, description: 'Email already in use' })
async updateProfile(
  userId: string,
  @Body() updateUserDto: UpdateUserDto,
): Promise<UserResponseDto> {
  return await this.usersService.update(userId, updateUserDto);
}*/

@Patch('me/password')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Change current user password' })
@ApiResponse({ status: 200, description: 'Password changed successfully' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
async changePassword(
  @GetUser('id') userId: string,
  @Body() changePasswordDto: ChangePasswordDto,
): Promise<{ message: string }> {
  return await this.usersService.changePassword(userId, changePasswordDto);
  }

@Delete('me')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Delete current user account' })
@ApiResponse({ status: 200, description: 'User account deleted successfully' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
async deleteAccount(@GetUser('id') userId: string): Promise<{ message: string }> {
  return await this.usersService.remove(userId);
}

@Delete(':id')
@Permissions(Permission.MANAGE_USERS, Permission.ALL_BRANCHES)
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Delete user by ID' })
@ApiResponse({
  status: 200,
  description: 'User with the specified ID deleted successfully',
})
@ApiResponse({ status: 401, description: 'Unauthorized' })
async deleteUser(@Param('id') id: string): Promise<{ message: string }> {
  return await this.usersService.remove(id);
}


}
