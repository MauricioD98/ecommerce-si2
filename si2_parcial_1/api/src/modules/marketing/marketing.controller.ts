import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MarketingService } from './marketing.service';
import { SendCampaignDto } from './dto/send-campaign.dto';
import { CampaignResultDto } from './dto/campaign-result.dto';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';

@ApiTags('marketing')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketingService: MarketingService) {}

  @Post('send-campaign')
  @HttpCode(HttpStatus.OK)
  @Permissions(Permission.SEND_MARKETING)
  @ApiOperation({
    summary: 'Send a promotional email (SEND_MARKETING)',
    description:
      'Con alcance global (ALL_BRANCHES) se envía a todos los usuarios o a los clientes de una sucursal. ' +
      'Con alcance de sucursal se envía solo a los usuarios con al menos un pedido en la sucursal propia.',
  })
  @ApiBody({ type: SendCampaignDto })
  @ApiResponse({ status: 200, type: CampaignResultDto })
  @ApiResponse({ status: 400, description: 'Invalid data or no recipients' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async sendCampaign(@GetUser() user: AuthUser, @Body() dto: SendCampaignDto): Promise<CampaignResultDto> {
    return await this.marketingService.sendCampaign(user, dto);
  }
}
