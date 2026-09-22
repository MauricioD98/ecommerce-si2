import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';

// Datos que necesita el PDF. Es independiente de Prisma: la venta presencial (POS) puede armar
// su propio InvoiceData y llamar directamente a renderInvoice().
export interface InvoiceData {
  number: string;
  date: Date;
  branch: { name: string; address?: string | null; phone?: string | null } | null;
  customer: { name: string; email?: string | null };
  // Cómo se entregó el pedido; null en una venta presencial
  delivery: { type: 'DELIVERY' | 'PICKUP'; address?: string | null } | null;
  items: { name: string; quantity: number; unitPrice: number }[];
  discount: number; // descuento de trabajador
  total: number;
}

const money = (value: number): string => `$${value.toFixed(2)}`;

@Injectable()
export class InvoiceService {
  constructor(private prisma: PrismaService) {}

  // Factura de un pedido existente
  async generateOrderInvoice(orderId: string): Promise<{ buffer: Buffer; filename: string; data: InvoiceData }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        branch: true,
        orderItems: { include: { product: true } },
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    const data: InvoiceData = {
      number: order.orderNumber,
      date: order.createdAt,
      branch: order.branch,
      customer: {
        name: `${order.user.firstName ?? ''} ${order.user.lastName ?? ''}`.trim() || order.user.email,
        email: order.user.email,
      },
      delivery: { type: order.fulfillmentType, address: order.shippingAddress },
      items: order.orderItems.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: Number(item.price),
      })),
      discount: Number(order.discountApplied),
      total: Number(order.totalAmount),
    };

    return { buffer: await this.renderInvoice(data), filename: `factura-${order.orderNumber}.pdf`, data };
  }

  renderInvoice(data: InvoiceData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Factura ${data.number}`, Author: 'STELLA FEMME' } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        this.draw(doc, data);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private draw(doc: PDFKit.PDFDocument, data: InvoiceData): void {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentWidth = right - left;

    // Encabezado
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#000').text('STELLA FEMME', left, 50);
    doc.font('Helvetica-Bold').fontSize(16).text('FACTURA', left, 50, { width: contentWidth, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#4b5563')
      .text(`N.º ${data.number}`, left, 72, { width: contentWidth, align: 'right' })
      .text(data.date.toLocaleDateString('es-BO', { day: '2-digit', month: 'long', year: 'numeric' }), left, 86, {
        width: contentWidth,
        align: 'right',
      });

    doc.moveTo(left, 110).lineTo(right, 110).strokeColor('#e5e7eb').stroke();

    // Sucursal y cliente
    const blockTop = 125;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#6b7280').text('SUCURSAL', left, blockTop);
    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    if (data.branch) {
      doc.text(data.branch.name, left, blockTop + 14);
      if (data.branch.address) doc.text(data.branch.address, { width: 230 });
      if (data.branch.phone) doc.text(`Tel: ${data.branch.phone}`);
    } else {
      doc.text('Venta en línea', left, blockTop + 14);
    }

    const customerX = left + contentWidth / 2;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#6b7280').text('CLIENTE', customerX, blockTop);
    doc.font('Helvetica').fontSize(10).fillColor('#111827').text(data.customer.name, customerX, blockTop + 14, { width: 230 });
    if (data.customer.email) doc.text(data.customer.email, { width: 230 });
    if (data.delivery) {
      doc.text(data.delivery.type === 'PICKUP' ? 'Retiro en sucursal' : 'Envío a domicilio', { width: 230 });
      if (data.delivery.type === 'DELIVERY' && data.delivery.address) doc.text(data.delivery.address, { width: 230 });
    }

    // Tabla de productos
    const colQty = left + 290;
    const colPrice = left + 350;
    const colSubtotal = left + 430;
    let y = Math.max(doc.y, blockTop + 70) + 24;

    const drawHeader = (top: number) => {
      doc.rect(left, top, contentWidth, 22).fill('#f3f4f6');
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151');
      doc.text('PRODUCTO', left + 8, top + 7, { width: 270 });
      doc.text('CANT.', colQty, top + 7, { width: 50, align: 'right' });
      doc.text('P. UNIT.', colPrice, top + 7, { width: 70, align: 'right' });
      doc.text('SUBTOTAL', colSubtotal, top + 7, { width: right - colSubtotal - 8, align: 'right' });
    };

    drawHeader(y);
    y += 30;

    let subtotal = 0;
    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    for (const item of data.items) {
      const lineTotal = item.unitPrice * item.quantity;
      subtotal += lineTotal;

      // Salto de página: se repite el encabezado de la tabla
      if (y > doc.page.height - 190) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader(y);
        y += 30;
        doc.font('Helvetica').fontSize(10).fillColor('#111827');
      }

      const nameHeight = doc.heightOfString(item.name, { width: 270 });
      doc.text(item.name, left + 8, y, { width: 270 });
      doc.text(String(item.quantity), colQty, y, { width: 50, align: 'right' });
      doc.text(money(item.unitPrice), colPrice, y, { width: 70, align: 'right' });
      doc.text(money(lineTotal), colSubtotal, y, { width: right - colSubtotal - 8, align: 'right' });

      y += Math.max(nameHeight, 14) + 8;
      doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor('#f3f4f6').stroke();
    }

    // Totales
    if (y > doc.page.height - 150) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y += 10;
    const labelX = left + 260;
    const labelWidth = 150;
    const valueWidth = right - labelX - labelWidth - 8;
    const totalRow = (label: string, value: string, bold = false, color = '#111827') => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 13 : 10).fillColor(color);
      doc.text(label, labelX, y, { width: labelWidth });
      doc.text(value, labelX + labelWidth, y, { width: valueWidth + 8, align: 'right' });
      y += bold ? 24 : 18;
    };

    totalRow('Subtotal', money(subtotal));
    if (data.discount > 0) {
      totalRow('Descuento de trabajador', `-${money(data.discount)}`, false, '#059669');
    }
    doc.moveTo(labelX, y).lineTo(right, y).strokeColor('#000').stroke();
    y += 8;
    totalRow('TOTAL', money(data.total), true, '#000');

    // Pie
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#6b7280')
      .text('Los precios ya incluyen las ofertas vigentes de la sucursal. ¡Gracias por tu compra!', left, y + 20, {
        width: contentWidth,
        align: 'center',
      });
  }
}
