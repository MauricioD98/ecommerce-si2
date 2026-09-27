import { ApiProperty } from '@nestjs/swagger';

export class ChatbotSizeStockDto {
  @ApiProperty({ example: 'M' })
  size: string;

  @ApiProperty({ description: 'Unidades disponibles de esa talla', example: 4 })
  stock: number;
}

export class ChatbotProductDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'SKU-001' })
  sku: string;

  @ApiProperty({ example: 'Vestido Midi Satinado' })
  name: string;

  @ApiProperty({ example: 'Vestido midi de satén con tirantes ajustables.' })
  description: string;

  @ApiProperty({ example: 'Vestidos' })
  category: string;

  @ApiProperty({ description: 'Precio de lista', example: 350 })
  price: number;

  @ApiProperty({
    description:
      'Precio a cobrar. Igual a `price` salvo que se haya pedido con branchId y esa sucursal tenga descuento.',
    example: 315,
  })
  effectivePrice: number;

  @ApiProperty({ description: 'Moneda de ambos precios', example: 'BOB' })
  currency: string;

  @ApiProperty({ type: [String], example: ['negro', 'rojo'] })
  colors: string[];

  @ApiProperty({ type: [ChatbotSizeStockDto], description: 'Todas las tallas del producto, con su stock' })
  sizes: ChatbotSizeStockDto[];

  @ApiProperty({
    type: [String],
    description: 'Atajo: solo las tallas con stock > 0. Es lo que el bot le puede ofrecer al cliente.',
    example: ['S', 'M'],
  })
  availableSizes: string[];

  @ApiProperty({ description: 'Suma del stock de todas las tallas', example: 7 })
  totalStock: number;

  @ApiProperty({ description: 'true si hay al menos una talla con stock', example: true })
  inStock: boolean;

  @ApiProperty({ nullable: true })
  imageUrl: string | null;
}

export class ChatbotCatalogDto {
  @ApiProperty({ type: [ChatbotProductDto] })
  products: ChatbotProductDto[];

  @ApiProperty({ description: 'Cantidad de productos devueltos', example: 12 })
  count: number;

  @ApiProperty({
    nullable: true,
    description: 'Sucursal usada para calcular stock y descuentos; null si se consultó sin sucursal',
  })
  branchId: string | null;

  @ApiProperty({ description: 'Momento de la consulta, para que el bot sepa qué tan fresco es el dato' })
  generatedAt: string;
}
