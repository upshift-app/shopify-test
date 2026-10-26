import { config } from './config';
import { esc } from './format';
import { adminOrderUrl } from './shopify';
import type { Email, Attachment } from './email';
import type { Address, LineItem, Order, SupplierState } from './orders';

// All emails are in Lithuanian. A = seller, B = supplier, C = customer, D = accountant.

function layout(title: string, body: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#222;line-height:1.5">
  <h2 style="font-size:20px;margin:0 0 16px">${esc(title)}</h2>
  ${body}
  <p style="color:#888;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:12px">Intere · intere.lt</p>
</div>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#222;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block">${esc(label)}</a></p>`;
}

function itemsTable(items: LineItem[]): string {
  const rows = items
    .map((i) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(i.title)}${i.variantTitle ? ` <span style="color:#666">(${esc(i.variantTitle)})</span>` : ''}${i.sku ? `<br><span style="color:#888;font-size:12px">SKU: ${esc(i.sku)}</span>` : ''}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${i.quantity} vnt.</td></tr>`)
    .join('');
  return `<table style="width:100%;border-collapse:collapse;margin:12px 0">${rows}</table>`;
}

function address(a: Address | null, phone?: string | null): string {
  if (!a) return '<p>-</p>';
  const lines = [a.name, a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.country, a.phone || phone];
  return `<p style="margin:4px 0">${lines.filter(Boolean).map(esc).join('<br>')}</p>`;
}

function trackingBlock(s: SupplierState): string {
  const tr = s.tracking!;
  const number = tr.url ? `<a href="${esc(tr.url)}">${esc(tr.number)}</a>` : esc(tr.number);
  return `<p><b>Kurjeris:</b> ${esc(tr.company)}<br><b>Siuntos sekimo numeris:</b> ${number}</p>`;
}

export function statusLabel(s: SupplierState): string {
  if (s.status === 'sent') return 'laukia patvirtinimo';
  if (s.status === 'confirmed') return 'patvirtinta, ruošiama';
  if (s.status === 'rejected') return 'atmesta';
  return s.paid ? 'išsiųsta, apmokėta' : 'išsiųsta, neapmokėta';
}

// B: new order, only what the supplier needs (items + delivery), no prices or payment data.
export function supplierNewOrder(order: Order, s: SupplierState, items: LineItem[], link: string): Email {
  return {
    to: s.email,
    replyTo: config.sellerEmail,
    subject: `Naujas užsakymas ${order.name} iš Intere`,
    html: layout(`Naujas užsakymas ${order.name}`, `
      <p>Sveiki,</p>
      <p>Gavome naują užsakymą. Prašome jį patvirtinti paspaudus mygtuką žemiau.</p>
      ${itemsTable(items)}
      <p><b>Pristatymo adresas:</b></p>${address(order.shippingAddress, order.phone)}
      ${order.shippingTitle ? `<p><b>Pristatymo būdas:</b> ${esc(order.shippingTitle)}</p>` : ''}
      ${order.note ? `<p><b>Pirkėjo pastaba:</b> ${esc(order.note)}</p>` : ''}
      ${button(link, 'Peržiūrėti ir patvirtinti užsakymą')}
      <p style="color:#666;font-size:13px">Jei prekės neturite, tame pačiame puslapyje galite užsakymą atmesti.</p>`),
  };
}

export function supplierShipRequest(order: Order, s: SupplierState, link: string): Email {
  return {
    to: s.email,
    replyTo: config.sellerEmail,
    subject: `Užsakymas ${order.name}: įrašykite siuntos numerį ir sąskaitą`,
    html: layout(`Ačiū, užsakymas ${order.name} patvirtintas`, `
      <p>Kai išsiųsite prekes, įrašykite siuntos sekimo numerį ir pridėkite sąskaitą faktūrą (PDF) už prekes su pristatymu.</p>
      ${button(link, 'Įrašyti siuntos numerį ir sąskaitą')}`),
  };
}

export function supplierPaid(order: Order, s: SupplierState): Email {
  return {
    to: s.email,
    replyTo: config.sellerEmail,
    subject: `Užsakymas ${order.name}: sąskaita apmokėta`,
    html: layout('Sąskaita apmokėta', `<p>Sveiki,</p><p>Informuojame, kad Jūsų sąskaita už užsakymą <b>${esc(order.name)}</b> apmokėta.</p><p>Ačiū už bendradarbiavimą!</p>`),
  };
}

export function supplierReminder(order: Order, s: SupplierState, items: LineItem[], link: string, kind: 'confirm' | 'ship'): Email {
  const what = kind === 'confirm' ? 'dar nepatvirtintas' : 'dar neįrašytas siuntos numeris ir sąskaita';
  return {
    to: s.email,
    replyTo: config.sellerEmail,
    subject: `Priminimas: užsakymas ${order.name}`,
    html: layout(`Priminimas: užsakymas ${order.name}`, `<p>Sveiki,</p><p>Užsakymas ${esc(order.name)} ${what}.</p>${itemsTable(items)}${button(link, kind === 'confirm' ? 'Patvirtinti užsakymą' : 'Įrašyti siuntos numerį')}`),
  };
}

// A
export function sellerConfirmed(order: Order, s: SupplierState): Email {
  return {
    to: config.sellerEmail,
    subject: `${s.name} patvirtino užsakymą ${order.name}`,
    html: layout(`Tiekėjas patvirtino užsakymą ${order.name}`, `<p><b>${esc(s.name)}</b> patvirtino užsakymą. Užsakymui priskirta žyma „Vykdoma“, pirkėjui išsiųstas laiškas su sąskaita.</p>${button(adminOrderUrl(order.id), 'Atidaryti Shopify')}`),
  };
}

export function sellerRejected(order: Order, s: SupplierState): Email {
  return {
    to: config.sellerEmail,
    subject: `DĖMESIO: ${s.name} atmetė užsakymą ${order.name}`,
    html: layout(`Tiekėjas atmetė užsakymą ${order.name}`, `<p><b>${esc(s.name)}</b> atmetė užsakymą.</p><p><b>Priežastis:</b> ${esc(s.rejectReason) || '-'}</p><p>Pirkėjui automatiškai niekas nesiųsta. Susisiekite su pirkėju.</p>${button(adminOrderUrl(order.id), 'Atidaryti Shopify')}`),
  };
}

export function sellerShipped(order: Order, s: SupplierState, bInvoice: Attachment): Email {
  return {
    to: config.sellerEmail,
    subject: `Užsakymas ${order.name} išsiųstas (${s.name})`,
    html: layout(`Užsakymas ${order.name} išsiųstas`, `<p><b>${esc(s.name)}</b> išsiuntė prekes. Tiekėjo sąskaita prisegta.</p>${trackingBlock(s)}${button(adminOrderUrl(order.id), 'Atidaryti Shopify')}`),
    attachments: [bInvoice],
  };
}

export function sellerUnassigned(order: Order, titles: string[]): Email {
  return {
    to: config.sellerEmail,
    subject: `DĖMESIO: užsakyme ${order.name} yra prekių be tiekėjo`,
    html: layout('Prekės be tiekėjo', `<p>Šioms prekėms nerastas tiekėjas (produkto „Vendor“ nesutampa su jokiu tiekėju), todėl jos niekam neišsiųstos:</p><ul>${titles.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${button(adminOrderUrl(order.id), 'Atidaryti Shopify')}`),
  };
}

export function sellerSupplierLate(order: Order, s: SupplierState, kind: 'confirm' | 'ship'): Email {
  const what = kind === 'confirm' ? 'dar nepatvirtino užsakymo' : 'dar neįrašė siuntos numerio';
  return {
    to: config.sellerEmail,
    subject: `Tiekėjas ${s.name} ${what} ${order.name}`,
    html: layout('Tiekėjas vėluoja', `<p><b>${esc(s.name)}</b> ${what} <b>${esc(order.name)}</b>. Tiekėjui išsiųstas priminimas.</p>${button(adminOrderUrl(order.id), 'Atidaryti Shopify')}`),
  };
}

// C
export function customerInProgress(order: Order, aInvoice: Attachment): Email {
  return {
    to: order.email!,
    replyTo: config.sellerEmail,
    subject: `Jūsų užsakymas ${order.name} jau vykdomas`,
    html: layout('Užsakymas vykdomas', `<p>Sveiki,</p><p>Jūsų užsakymas <b>${esc(order.name)}</b> patvirtintas ir jau ruošiamas. Kai jis bus išsiųstas, atsiųsime siuntos sekimo numerį.</p><p>Sąskaitą faktūrą rasite prisegtą prie šio laiško.</p><p>Ačiū, kad perkate Intere!</p>`),
    attachments: [aInvoice],
  };
}

export function customerShipped(order: Order, s: SupplierState, aInvoice: Attachment): Email {
  return {
    to: order.email!,
    replyTo: config.sellerEmail,
    subject: `Jūsų užsakymas ${order.name} išsiųstas`,
    html: layout('Užsakymas išsiųstas', `<p>Sveiki,</p><p>Jūsų užsakymas <b>${esc(order.name)}</b> išsiųstas.</p>${trackingBlock(s)}<p>Sąskaitą faktūrą rasite prisegtą prie šio laiško.</p><p>Ačiū, kad perkate Intere!</p>`),
    attachments: [aInvoice],
  };
}

export function customerReview(order: Order): Email {
  const code = config.reviewDiscountCode;
  return {
    to: order.email!,
    replyTo: config.sellerEmail,
    subject: 'Kaip Jums patiko pirkinys?',
    html: layout('Ačiū, kad pirkote Intere', `<p>Sveiki,</p><p>Būsime dėkingi, jei skirsite minutę ir paliksite atsiliepimą apie užsakymą ${esc(order.name)}.</p>${button(config.reviewUrl, 'Palikti atsiliepimą')}${code ? `<p>Kitam pirkiniui dovanojame nuolaidos kodą: <b style="font-size:18px">${esc(code)}</b></p>` : ''}<p><a href="${esc(config.newsletterUrl)}">Užsiprenumeruokite naujienlaiškį</a> ir sužinokite apie naujienas pirmieji.</p>`),
  };
}

// D
export function accountant(order: Order, s: SupplierState, aInvoice: Attachment, bInvoice: Attachment): Email {
  return {
    to: config.accountantEmail,
    subject: `Užsakymas ${order.name}: sąskaitos (${s.name})`,
    html: layout(`Užsakymas ${order.name}`, `<p>Prisegtos sąskaitos: pardavimo sąskaita pirkėjui ir tiekėjo <b>${esc(s.name)}</b> sąskaita.</p>${trackingBlock(s)}`),
    attachments: [aInvoice, bInvoice],
  };
}
