import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { config } from './config';
import type { Order } from './orders';
import { money } from './format';

// Seller (A) -> customer (C) invoice. Generated from the order, so it can be rebuilt at any time.
// If the client keeps Order Printer Pro, this is the piece to swap for its PDF.
export function invoiceNumber(order: Order): string {
  return `${config.seller.invoicePrefix}-${order.name.replace('#', '')}`;
}

export function invoiceFilename(order: Order): string {
  return `saskaita-${invoiceNumber(order)}.pdf`;
}

async function font(file: string): Promise<Buffer> {
  return fs.readFile(path.join(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf', file));
}

export async function buildInvoicePdf(order: Order): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(await font('DejaVuSans.ttf'), { subset: true });
  const bold = await pdf.embedFont(await font('DejaVuSans-Bold.ttf'), { subset: true });
  const page = pdf.addPage([595, 842]); // A4
  const grey = rgb(0.4, 0.4, 0.4);
  let y = 790;
  const text = (s: string, x: number, size = 10, f = regular, color = rgb(0, 0, 0)) =>
    page.drawText(s, { x, y, size, font: f, color });
  const right = (s: string, xRight: number, size = 10, f = regular) =>
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f });

  text('PVM SĄSKAITA FAKTŪRA', 50, 18, bold);
  y -= 22;
  text(`Serija ir Nr. ${invoiceNumber(order)}`, 50, 11);
  y -= 15;
  text(`Data: ${order.createdAt.slice(0, 10)}   Užsakymas: ${order.name}`, 50, 10, regular, grey);

  y -= 40;
  const top = y;
  text('Pardavėjas', 50, 9, bold, grey);
  y -= 15;
  text(config.seller.name, 50, 11, bold);
  for (const line of config.seller.details) { y -= 14; text(line, 50, 9); }

  y = top;
  const buyer = order.billingAddress ?? order.shippingAddress;
  text('Pirkėjas', 320, 9, bold, grey);
  y -= 15;
  text(buyer?.name ?? order.customerName ?? '', 320, 11, bold);
  for (const line of [buyer?.company, buyer?.address1, buyer?.address2, [buyer?.zip, buyer?.city].filter(Boolean).join(' '), buyer?.country, order.email]) {
    if (!line) continue;
    y -= 14;
    text(line, 320, 9);
  }

  y = Math.min(y, top - 100) - 30;
  page.drawLine({ start: { x: 50, y: y + 14 }, end: { x: 545, y: y + 14 }, thickness: 0.5, color: grey });
  text('Prekė', 50, 9, bold, grey);
  right('Kiekis', 380, 9, bold);
  right('Kaina', 460, 9, bold);
  right('Suma', 545, 9, bold);
  y -= 8;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: grey });

  for (const item of order.lineItems) {
    y -= 18;
    const title = item.variantTitle ? `${item.title} (${item.variantTitle})` : item.title;
    text(title.length > 60 ? `${title.slice(0, 57)}...` : title, 50, 10);
    right(String(item.quantity), 380);
    right(money(item.unitPrice, order.currency), 460);
    right(money(item.total, order.currency), 545);
  }

  y -= 14;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: grey });
  const totals: [string, string][] = [
    ['Prekės', money(order.subtotal, order.currency)],
    [`Pristatymas${order.shippingTitle ? ` (${order.shippingTitle})` : ''}`, money(order.shipping, order.currency)],
  ];
  if (Number(order.tax) > 0) totals.push(['iš jų PVM', money(order.tax, order.currency)]);
  for (const [label, value] of totals) {
    y -= 18;
    right(label, 460, 10);
    right(value, 545, 10);
  }
  y -= 22;
  right('Iš viso mokėti', 460, 12, bold);
  right(money(order.total, order.currency), 545, 12, bold);

  y -= 40;
  text(order.financialStatus === 'PAID' ? 'Apmokėta.' : 'Neapmokėta.', 50, 10, regular, grey);

  return pdf.save();
}
