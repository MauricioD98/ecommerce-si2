import { Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PlanFeatureGuard } from '../../common/decorators/guards/plan-feature.guard';
import { RequirePlanFeature } from '../../common/decorators/plan-feature.decorator';
import { TryOnService } from './try-on.service';

@ApiTags('try-on')
@Controller('try-on')
export class TryOnController {
  constructor(private readonly tryOnService: TryOnService) {}

  // Cada sesión cuesta dinero real: solo usuarios autenticados de ESTA tienda y solo en el Plan Pro.
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PlanFeatureGuard)
  @RequirePlanFeature('virtualTryOn')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Token efímero para el Probador Virtual (Decart) de la tienda actual (Plan Pro)' })
  createSession(@Headers('origin') origin?: string) {
    return this.tryOnService.createSession(origin);
  }
}
