import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/decorators/guards/roles.guard';
import { UsersService } from './users.service';
import { UserResponseDto } from './dto/user-response.dto';
import type { RequestWithUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';


@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard,RolesGuard)
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
@Roles(Role.ADMIN)
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

@Get(':id')
@Roles(Role.ADMIN)
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
@Roles(Role.ADMIN)
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
