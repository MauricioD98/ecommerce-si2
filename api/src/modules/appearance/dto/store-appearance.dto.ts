import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUrl, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

// Redes que la tienda puede enlazar (el front muestra un ícono por cada una)
export const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'whatsapp', 'x', 'youtube', 'website'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

// Catálogo cerrado de tipografías: el front solo tiene cargadas estas (front/utils/fonts.ts)
export const FONT_FAMILIES = ['Inter', 'Playfair Display', 'Montserrat', 'Roboto', 'Poppins'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

// #rrggbb: es lo que devuelve <input type="color"> y lo único que se inyecta como variable CSS
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// Solo http(s): una URL "javascript:" terminaría en un href de la tienda pública
const HTTP_URL = { protocols: ['http', 'https'], require_protocol: true };

export class SocialLinkDto {
  @ApiProperty({ enum: SOCIAL_PLATFORMS })
  @IsIn(SOCIAL_PLATFORMS)
  platform: SocialPlatform;

  @ApiProperty({ example: 'https://instagram.com/mitienda' })
  @IsUrl(HTTP_URL)
  @MaxLength(500)
  url: string;
}

// PATCH parcial: solo se cambia lo que viene. Las imágenes subidas van por su propio endpoint
// (multipart); acá logoUrl/faviconUrl aceptan una URL externa, o null para quitarlas.
export class UpdateStoreAppearanceDto {
  @ApiPropertyOptional({ example: '#000000' })
  @IsOptional()
  @Matches(HEX_COLOR)
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#ffffff' })
  @IsOptional()
  @Matches(HEX_COLOR)
  secondaryColor?: string;

  @ApiPropertyOptional({ description: 'SEO y "Quiénes somos"' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: [SocialLinkDto], nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(SOCIAL_PLATFORMS.length * 2)
  @ValidateNested({ each: true })
  @Type(() => SocialLinkDto)
  socialLinks?: SocialLinkDto[] | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl(HTTP_URL)
  @MaxLength(1000)
  logoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl(HTTP_URL)
  @MaxLength(1000)
  faviconUrl?: string | null;

  @ApiPropertyOptional({ enum: FONT_FAMILIES, example: 'Inter' })
  @IsOptional()
  @IsIn(FONT_FAMILIES)
  fontFamily?: FontFamily;

  @ApiPropertyOptional({ example: '#ffffff' })
  @IsOptional()
  @Matches(HEX_COLOR)
  navbarBackgroundColor?: string;

  @ApiPropertyOptional({ example: '#000000' })
  @IsOptional()
  @Matches(HEX_COLOR)
  navbarTextColor?: string;

  @ApiPropertyOptional({ example: '#333333' })
  @IsOptional()
  @Matches(HEX_COLOR)
  searchBarBackgroundColor?: string;

  @ApiPropertyOptional({ example: '#ffffff' })
  @IsOptional()
  @Matches(HEX_COLOR)
  storeBackgroundColor?: string;

  @ApiPropertyOptional({ nullable: true, description: 'URL externa https, o null para quitarla' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl(HTTP_URL)
  @MaxLength(1000)
  storeBackgroundImage?: string | null;

  @ApiPropertyOptional({ example: '#1a1a1a' })
  @IsOptional()
  @Matches(HEX_COLOR)
  adminMenuColor?: string;
}
