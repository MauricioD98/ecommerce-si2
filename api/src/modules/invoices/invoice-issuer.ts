import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { tenantStorage } from '../../tenancy/tenant-context';

// Tienda que emite la factura de una compra. Sale SIEMPRE del contexto de tenant del backend (request
// HTTP resuelto por TenantMiddleware, o runInTenant en el outbox/cron), nunca de datos del front: el
// pedido se lee con el cliente Prisma de ese mismo schema, así que pedido y tienda coinciden por
// construcción.
export interface InvoiceIssuer {
  tenantId: string;
  name: string;
  slug: string;
  // Solo PNG/JPEG guardados como data URL (lo que pdfkit sabe dibujar). Las URLs externas no se
  // descargan desde un proceso en segundo plano.
  logo: Buffer | null;
}

// Sin tienda segura no se emite nada: el outbox reintenta y, agotados los intentos, el evento queda
// DEAD con este mensaje (sin datos del cliente).
export class InvoiceIssuerUnavailableError extends Error {
  constructor(reason: string) {
    super(`No se pudo determinar la tienda emisora de la factura (${reason})`);
    this.name = 'InvoiceIssuerUnavailableError';
  }
}

// La factura se generó pero el correo NO salió (o el servidor lo rechazó). El outbox la reintenta y,
// agotados los intentos, queda DEAD con este mensaje. Se guarda en outbox_events.lastError: se quitan
// las direcciones de correo que pueda traer la respuesta del servidor SMTP.
export class InvoiceDeliveryError extends Error {
  constructor(orderNumber: string, reason: string) {
    super(`Factura del pedido #${orderNumber} no enviada: ${reason.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '***@***')}`.slice(0, 480));
    this.name = 'InvoiceDeliveryError';
  }
}

const logger = new Logger('InvoiceIssuer');

const LOGO_DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/;

export function decodeLogo(logoUrl: string | null | undefined): Buffer | null {
  if (!logoUrl) return null;
  const match = LOGO_DATA_URL.exec(logoUrl);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  const isPng = buffer.length > 8 && buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return isPng || isJpeg ? buffer : null;
}

// Nombre apto para cabeceras de correo y nombres de archivo: sin saltos de línea ni comillas
export const sanitizeStoreName = (name: string): string => name.replace(/["\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

export async function resolveInvoiceIssuer(control: ControlPrismaService, prisma: PrismaService): Promise<InvoiceIssuer> {
  const ctx = tenantStorage.getStore();
  if (!ctx?.tenantId) {
    logger.error('Factura sin contexto de tienda: no se emite');
    throw new InvoiceIssuerUnavailableError('sin contexto de tienda');
  }

  const tenant = await control.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { id: true, name: true, slug: true, schemaName: true },
  });
  // El schema del que se leyó el pedido tiene que ser el de esta tienda; si no, el contexto está
  // armado a mano de forma inconsistente y la factura podría salir con el nombre de otra tienda.
  if (!tenant || tenant.schemaName !== ctx.schemaName) {
    logger.error(`Factura con tienda inconsistente (tenant ${ctx.tenantId}): no se emite`);
    throw new InvoiceIssuerUnavailableError('tienda inconsistente');
  }
  const name = sanitizeStoreName(tenant.name ?? '');
  if (!name) {
    logger.error(`La tienda ${tenant.id} no tiene nombre: no se emite la factura`);
    throw new InvoiceIssuerUnavailableError('tienda sin nombre');
  }

  let logo: Buffer | null = null;
  try {
    const appearance = await prisma.storeAppearance.findUnique({ where: { id: 'default' }, select: { logoUrl: true } });
    logo = decodeLogo(appearance?.logoUrl);
  } catch (error) {
    // El logo es opcional: sin él la factura sale solo con el nombre
    logger.warn(`No se pudo leer el logo de la tienda ${tenant.id}: ${error instanceof Error ? error.message : error}`);
  }

  return { tenantId: tenant.id, name, slug: tenant.slug, logo };
}
