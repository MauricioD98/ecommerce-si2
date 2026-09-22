import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendCampaignDto {
  @ApiProperty({ example: '¡20% de descuento este fin de semana!', maxLength: 150 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  subject: string;

  @ApiProperty({
    example: '<p>Este fin de semana disfruta de <strong>20%</strong> en toda la tienda.</p>',
    description: 'Contenido en HTML. Se eliminan scripts, iframes y manejadores de eventos antes de enviarlo',
    maxLength: 50000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  htmlBody: string;

  @ApiPropertyOptional({
    description:
      'Sucursal cuyos clientes recibirán el correo. Con alcance global, si se omite se envía a todos los usuarios; ' +
      'con alcance de sucursal se usa siempre la propia',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
