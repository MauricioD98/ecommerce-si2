import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBase64, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { LoginDto } from '../../auth/dto/login.dto';
import { RegisterDto } from '../../auth/dto/register.dto';

// Prueba de integridad de la app oficial para un desafío de POST /auth/mobile/challenge.
//   android     → integrityToken (Play Integrity, standard request con el requestHash del desafío), o
//                 certificateChain (Key Attestation con el requestHash como challenge: APK fuera de Play)
//   ios         → keyId + attestation (primera vez) o keyId + assertion (las siguientes)
//   development → nada más: solo lo acepta una API con NODE_ENV=development|test y
//                 MOBILE_ATTESTATION_DEV_BYPASS=true
export class MobileAttestationDto {
  @ApiProperty({ description: 'Id del desafío emitido por POST /auth/mobile/challenge' })
  @IsUUID()
  challengeId: string;

  @ApiProperty({ enum: ['android', 'ios', 'development'] })
  @IsIn(['android', 'ios', 'development'])
  platform: 'android' | 'ios' | 'development';

  @ApiProperty({ required: false, description: 'Android: token de Play Integrity' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  integrityToken?: string;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Android fuera de Play: cadena de Key Attestation (base64 DER, hoja primero)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(8_000, { each: true })
  @IsBase64(undefined, { each: true })
  certificateChain?: string[];

  @ApiProperty({ required: false, description: 'iOS: keyId de App Attest (base64)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyId?: string;

  @ApiProperty({ required: false, description: 'iOS: objeto de atestación (base64), solo la primera vez' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  attestation?: string;

  @ApiProperty({ required: false, description: 'iOS: aserción (base64) con una clave ya atestiguada' })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  assertion?: string;
}

export class MobileLoginDto extends LoginDto {
  @ApiProperty({ type: MobileAttestationDto })
  @ValidateNested()
  @Type(() => MobileAttestationDto)
  @IsNotEmpty()
  attestation: MobileAttestationDto;
}

export class MobileRegisterDto extends RegisterDto {
  @ApiProperty({ type: MobileAttestationDto })
  @ValidateNested()
  @Type(() => MobileAttestationDto)
  @IsNotEmpty()
  attestation: MobileAttestationDto;
}

export class MobileRefreshDto {
  @ApiProperty({ type: MobileAttestationDto, required: false, description: 'Obligatoria cuando la API responde MOBILE_ATTESTATION_REQUIRED' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MobileAttestationDto)
  attestation?: MobileAttestationDto;
}
