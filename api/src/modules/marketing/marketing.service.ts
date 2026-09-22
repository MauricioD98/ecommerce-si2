import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SendCampaignDto } from './dto/send-campaign.dto';
import { CampaignResultDto } from './dto/campaign-result.dto';
import { hasAllBranches } from '../../common/utils/permission.util';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';

@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async sendCampaign(actor: AuthUser, dto: SendCampaignDto): Promise<CampaignResultDto> {
    const branchId = this.resolveBranchId(actor, dto.branchId);

    let audience = 'Todos los usuarios';
    if (branchId) {
      const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
      if (!branch) {
        throw new NotFoundException('Branch not found');
      }
      audience = branch.name;
    }

    // Con sucursal: solo clientes con al menos un pedido en ella. Sin sucursal (solo alcance global): todos
    const recipients = await this.prisma.user.findMany({
      where: branchId ? { orders: { some: { branchId } } } : {},
      select: { email: true },
    });
    if (recipients.length === 0) {
      throw new BadRequestException('No hay destinatarios para esta campaña');
    }

    const { sent, failed } = await this.mailService.sendCampaign(recipients, dto.subject, dto.htmlBody);
    this.logger.log(`Campaña "${dto.subject}" de ${actor.email} a ${audience}: ${sent} enviados, ${failed} fallidos`);

    return { audience, recipients: recipients.length, sent, failed };
  }

  // Con alcance global se elige la sucursal (o todas); sin él queda fija en la propia
  private resolveBranchId(actor: AuthUser, requested?: string): string | undefined {
    if (hasAllBranches(actor)) {
      return requested;
    }
    if (!actor.branchId) {
      throw new ForbiddenException('User is not assigned to a branch');
    }
    if (requested && requested !== actor.branchId) {
      throw new ForbiddenException('You can only send campaigns to customers of your own branch');
    }
    return actor.branchId;
  }
}
