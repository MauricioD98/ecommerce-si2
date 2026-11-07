import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsIn, IsObject, IsUUID } from 'class-validator';

export const OFFLINE_ENTITIES = ['product', 'category', 'collection', 'order'] as const;
export type OfflineEntity = (typeof OFFLINE_ENTITIES)[number];
export const OFFLINE_OPS = ['create', 'update'] as const;
export type OfflineOp = (typeof OFFLINE_OPS)[number];

/**
 * Un cambio del panel de administración hecho sin conexión. `changes` se valida con el mismo DTO que usa
 * el endpoint normal de esa entidad (ver OfflineSyncService). `expected`: para cada campo cambiado, el valor
 * que el dispositivo tenía cuando el usuario lo editó.
 */
export class OfflineChangeDto {
  @ApiProperty({ description: 'Id del cambio generado en el dispositivo; un reintento reusa el mismo' })
  @IsUUID('all')
  changeId: string;

  @ApiProperty({ enum: OFFLINE_ENTITIES })
  @IsIn(OFFLINE_ENTITIES as unknown as string[])
  entity: OfflineEntity;

  @ApiProperty({ enum: OFFLINE_OPS })
  @IsIn(OFFLINE_OPS as unknown as string[])
  op: OfflineOp;

  @ApiProperty({ description: 'Id de la entidad. En "create" lo genera el dispositivo (idempotente)' })
  @IsUUID('all')
  entityId: string;

  @ApiProperty({ type: Object })
  @IsDefined()
  @IsObject()
  changes: Record<string, unknown>;

  @ApiProperty({ type: Object, required: false })
  @IsObject()
  expected: Record<string, unknown> = {};
}
