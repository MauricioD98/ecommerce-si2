import { ApiProperty } from '@nestjs/swagger';

export class CampaignResultDto {
  @ApiProperty({ example: 'Sucursal Centro', description: 'Audiencia a la que se envió' })
  audience: string;

  @ApiProperty({ example: 120, description: 'Usuarios seleccionados' })
  recipients: number;

  @ApiProperty({ example: 118, description: 'Correos enviados correctamente' })
  sent: number;

  @ApiProperty({ example: 2, description: 'Correos que fallaron (ver el log del servidor)' })
  failed: number;
}
