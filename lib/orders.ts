import { config } from './config';
import { gql, assertNoUserErrors, orderGid, uploadFile } from './shopify';
import { loadSuppliers, supplierForVendor } from './suppliers';
import { supplierUrl } from './links';
import { sendEmail } from './email';
import { buildInvoicePdf, invoiceFilename } from './invoice';
import { addBusinessDays } from './format';
import * as t from './templates';

export type Address = {
  name: string | null; company: string | null; address1: string | null; address2: string | null;
  city: string | null; zip: string | null; country: string | null; phone: string | null;
};
export type LineItem = {
  id: string; title: string; variantTitle: string | null; sku: string | null; vendor: string | null;
  quantity: number; unitPrice: string; total: string;
};
export type FulfillmentOrder = { id: string; status: string; lineItems: { id: string; remainingQuantity: number; lineItemId: string }[] };

export type Tracking = { number: string; company: string; url: string | null };
export type SupplierState = {
  name: string; email: string; lineItemIds: string[];
  status: 'sent' | 'confirmed' | 'rejected' | 'shipped';
  sentAt: string; confirmedAt?: string; rejectedAt?: string; rejectReason?: string; shippedAt?: string;
  tracking?: Tracking; invoiceFileId?: string; invoiceFilename?: string;
  paid?: boolean; paidAt?: string; remindedConfirmAt?: string; remindedShipAt?: string;
};
export type OrderState = {
  suppliers: Record<string, SupplierState>;
  unassigned: string[];          // line item titles whose vendor has no supplier
  customerInProgressSentAt?: string;
  aInvoiceFileId?: string;
  reviewSentAt?: string;
  createdAt: string;
};

export type Order = {
  id: string; name: string; createdAt: string; email: string | null; phone: string | null;
  customerName: string | null; financialStatus: string; currency: string; tags: string[];
  subtotal: string; shipping: string; tax: string; total: string; shippingTitle: string | null;
  billingAddress: Address | null; shippingAddress: Address | null; note: string | null;
  lineItems: LineItem[]; fulfillmentOrders: FulfillmentOrder[];
  state: OrderState | null;
  stateDigest: string | null; // optimistic lock for the state metafield, null = no state yet
};

// Another request changed the order state since we read it (two suppliers at once, a duplicate webhook).
export class StaleStateError extends Error {}

export const TAG_IN_PROGRESS = 'Vykdoma';
export const TAG_SHIPPED = 'Išsiųsta';
export const TAG_REJECTED = 'Tiekėjas atmetė';
// Adding this tag to an order in Shopify marks every shipped supplier of that order as paid.
export const TAG_SUPPLIER_PAID = 'Tiekėjui apmokėta';

const ADDRESS = 'name company address1 address2 city zip country phone';
const ORDER_FIELDS = `
  id name createdAt email phone note tags displayFinancialStatus currencyCode
  customer { displayName }
  subtotalPriceSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  totalTaxSet { shopMoney { amount } }
  totalPriceSet { shopMoney { amount } }
  shippingLine { title }
  billingAddress { ${ADDRESS} }
  shippingAddress { ${ADDRESS} }
  lineItems(first: 100) { nodes {
    id title variantTitle sku vendor quantity
    originalUnitPriceSet { shopMoney { amount } }
    discountedTotalSet { shopMoney { amount } }
  } }
  fulfillmentOrders(first: 10) { nodes {
    id status
    lineItems(first: 50) { nodes { id remainingQuantity lineItem { id } } }
  } }
  state: metafield(namespace: "intere", key: "state") { value compareDigest }
`;

function mapOrder(o: any): Order {
  return {
    id: o.id, name: o.name, createdAt: o.createdAt, email: o.email, phone: o.phone, note: o.note,
    customerName: o.customer?.displayName ?? null, financialStatus: o.displayFinancialStatus,
    currency: o.currencyCode, tags: o.tags,
    subtotal: o.subtotalPriceSet.shopMoney.amount, shipping: o.totalShippingPriceSet.shopMoney.amount,
    tax: o.totalTaxSet?.shopMoney.amount ?? '0', total: o.totalPriceSet.shopMoney.amount,
    shippingTitle: o.shippingLine?.title ?? null,
    billingAddress: o.billingAddress, shippingAddress: o.shippingAddress,
    lineItems: o.lineItems.nodes.map((li: any) => ({
      id: li.id, title: li.title, variantTitle: li.variantTitle, sku: li.sku, vendor: li.vendor, quantity: li.quantity,
      unitPrice: li.originalUnitPriceSet.shopMoney.amount, total: li.discountedTotalSet.shopMoney.amount,
    })),
    fulfillmentOrders: o.fulfillmentOrders.nodes.map((fo: any) => ({
      id: fo.id, status: fo.status,
      lineItems: fo.lineItems.nodes.map((x: any) => ({ id: x.id, remainingQuantity: x.remainingQuantity, lineItemId: x.lineItem.id })),
    })),
    state: o.state?.value ? JSON.parse(o.state.value) : null,
    stateDigest: o.state?.compareDigest ?? null,
  };
}

export async function getOrder(id: string): Promise<Order | null> {
  const data = await gql(`query($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`, { id: orderGid(id) });
  return data.order ? mapOrder(data.order) : null;
}

// Full order details exceed Shopify's per-query cost limit when listed, so lists fetch only
// id + state, and full orders are loaded one by one for the rows that need them.
export type OrderRef = { id: string; name: string; state: OrderState | null };

export async function listOrderRefs(query: string, first = 50): Promise<OrderRef[]> {
  const data = await gql(`query($q: String!, $first: Int!) {
    orders(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) {
      nodes { id name state: metafield(namespace: "intere", key: "state") { value } }
    }
  }`, { q: query, first });
  return data.orders.nodes.map((o: any) => ({ id: o.id, name: o.name, state: o.state?.value ? JSON.parse(o.state.value) : null }));
}

export async function getOrders(ids: string[]): Promise<Order[]> {
  const out: Order[] = [];
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map(getOrder));
    out.push(...(batch.filter(Boolean) as Order[]));
  }
  return out;
}

// Writes the state JSON plus the human-facing metafields shown on the order page in Shopify admin.
// The write is atomic and guarded by compareDigest (null means "must not exist yet"),
// so of two concurrent writers exactly one wins and the other gets StaleStateError.
async function saveState(order: Order, state: OrderState) {
  const invoiceIds = Object.values(state.suppliers).map((s) => s.invoiceFileId).filter(Boolean);
  const statusLine = Object.values(state.suppliers)
    .map((s) => `${s.name}: ${t.statusLabel(s)}`)
    .join('; ');
  const trackingLines = Object.values(state.suppliers)
    .filter((s) => s.tracking)
    .map((s) => `${s.name}: ${s.tracking!.company} ${s.tracking!.number}`)
    .join('\n');
  const metafields: any[] = [
    { ownerId: order.id, namespace: 'intere', key: 'state', type: 'json', value: JSON.stringify(state), compareDigest: order.stateDigest },
    { ownerId: order.id, namespace: 'intere', key: 'busena', type: 'single_line_text_field', value: statusLine || '-' },
  ];
  if (trackingLines) metafields.push({ ownerId: order.id, namespace: 'intere', key: 'siuntos', type: 'multi_line_text_field', value: trackingLines });
  if (state.aInvoiceFileId) metafields.push({ ownerId: order.id, namespace: 'intere', key: 'a_saskaita', type: 'file_reference', value: state.aInvoiceFileId });
  if (invoiceIds.length) metafields.push({ ownerId: order.id, namespace: 'intere', key: 'b_saskaitos', type: 'list.file_reference', value: JSON.stringify(invoiceIds) });
  const data = await gql(`mutation($m: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $m) { metafields { key compareDigest } userErrors { code field message } }
  }`, { m: metafields });
  if (data.metafieldsSet.userErrors.some((e: any) => e.code === 'STALE_OBJECT')) throw new StaleStateError(order.name);
  assertNoUserErrors(data.metafieldsSet, 'metafieldsSet');
  order.state = state;
  order.stateDigest = data.metafieldsSet.metafields.find((m: any) => m.key === 'state')?.compareDigest ?? null;
}

// Re-reads the order and retries when another request updated the state in between.
async function withFreshOrder<T>(id: string, fn: (order: Order) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const order = await getOrder(id);
    if (!order) throw new Error(`Order ${id} not found`);
    try {
      return await fn(order);
    } catch (err) {
      if (!(err instanceof StaleStateError) || attempt >= 4) throw err;
    }
  }
}

async function addTags(order: Order, tags: string[]) {
  const data = await gql(`mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`, { id: order.id, tags });
  assertNoUserErrors(data.tagsAdd, 'tagsAdd');
}

async function removeTags(order: Order, tags: string[]) {
  const data = await gql(`mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`, { id: order.id, tags });
  assertNoUserErrors(data.tagsRemove, 'tagsRemove');
}

export function itemsFor(order: Order, s: SupplierState): LineItem[] {
  return order.lineItems.filter((li) => s.lineItemIds.includes(li.id));
}

async function sellerInvoice(order: Order) {
  return { filename: invoiceFilename(order), content: await buildInvoicePdf(order) };
}

// 1. New order: split the items by supplier and send each supplier its part.
// Idempotent: an order that already has state is skipped, so webhook retries and the cron sync are safe.
export async function processNewOrder(id: string): Promise<'processed' | 'skipped'> {
  const order = await getOrder(id);
  if (!order || order.state) return 'skipped';

  const suppliers = await loadSuppliers();
  const now = new Date().toISOString();
  const state: OrderState = { suppliers: {}, unassigned: [], createdAt: now };
  for (const li of order.lineItems) {
    const supplier = supplierForVendor(suppliers, li.vendor);
    if (!supplier?.email) {
      state.unassigned.push(`${li.title} (${li.vendor || 'be tiekėjo'})`);
      continue;
    }
    state.suppliers[supplier.key] ??= { name: supplier.name, email: supplier.email, lineItemIds: [], status: 'sent', sentAt: now };
    state.suppliers[supplier.key].lineItemIds.push(li.id);
  }
  // Claim the order before sending anything: only one concurrent caller can create the state.
  try {
    await saveState(order, state);
  } catch (err) {
    if (err instanceof StaleStateError) return 'skipped';
    throw err;
  }

  for (const [key, s] of Object.entries(state.suppliers)) {
    await sendEmail(t.supplierNewOrder(order, s, itemsFor(order, s), supplierUrl(order.id, key)));
  }
  if (state.unassigned.length) await sendEmail(t.sellerUnassigned(order, state.unassigned));
  return 'processed';
}

function requireSupplier(order: Order, key: string): SupplierState {
  const s = order.state?.suppliers[key];
  if (!s) throw new Error('Supplier not part of this order');
  return s;
}

// 2. Supplier confirms: order goes "Vykdoma", seller is told, customer gets the seller invoice once.
export async function confirmOrder(id: string, key: string) {
  const result = await withFreshOrder(id, async (order) => {
    const state = order.state!;
    const s = requireSupplier(order, key);
    if (s.status !== 'sent') return null;
    s.status = 'confirmed';
    s.confirmedAt = new Date().toISOString();
    const firstConfirmation = !state.customerInProgressSentAt;
    if (firstConfirmation) state.customerInProgressSentAt = s.confirmedAt;
    await saveState(order, state);
    return { order, s, firstConfirmation };
  });
  if (!result) return;
  const { order, s, firstConfirmation } = result;
  await addTags(order, [TAG_IN_PROGRESS]);

  const invoice = await sellerInvoice(order);
  if (firstConfirmation) {
    // Keep a copy of the customer invoice on the order in Shopify admin.
    await withFreshOrder(id, async (fresh) => {
      if (fresh.state!.aInvoiceFileId) return;
      fresh.state!.aInvoiceFileId = await uploadFile(invoice.filename, invoice.content, 'application/pdf', `Sąskaita ${order.name}`);
      await saveState(fresh, fresh.state!);
    });
  }
  await sendEmail(t.sellerConfirmed(order, s));
  if (firstConfirmation && order.email) await sendEmail(t.customerInProgress(order, invoice));
  await sendEmail(t.supplierShipRequest(order, s, supplierUrl(order.id, key)));
}

export async function rejectOrder(id: string, key: string, reason: string) {
  const result = await withFreshOrder(id, async (order) => {
    const s = requireSupplier(order, key);
    if (s.status !== 'sent') return null;
    s.status = 'rejected';
    s.rejectedAt = new Date().toISOString();
    s.rejectReason = reason;
    await saveState(order, order.state!);
    return { order, s };
  });
  if (!result) return;
  await addTags(result.order, [TAG_REJECTED]);
  await sendEmail(t.sellerRejected(result.order, result.s));
}

// 3. Supplier ships: Shopify fulfillment with tracking, invoice stored in Files, emails to A, C and D.
export async function shipOrder(id: string, key: string, tracking: Tracking, invoicePdf: { filename: string; content: Uint8Array }) {
  const first = await getOrder(id);
  if (!first) throw new Error(`Order ${id} not found`);
  const s0 = requireSupplier(first, key);
  if (s0.status !== 'confirmed') return;
  const storedName = `${s0.name}-${first.name.replace('#', '')}-${invoicePdf.filename}`.replace(/[^\w.\-]+/g, '_');
  const invoiceFileId = await uploadFile(storedName, invoicePdf.content, 'application/pdf', `Tiekėjo sąskaita ${first.name} (${s0.name})`);

  const result = await withFreshOrder(id, async (order) => {
    const state = order.state!;
    const s = requireSupplier(order, key);
    if (s.status !== 'confirmed') return null;

    // Fulfil exactly this supplier's lines. Lines already fulfilled (by an earlier attempt) have no remaining quantity.
    // The customer is notified by our own email (with the invoice) instead of Shopify's.
    const byFo = order.fulfillmentOrders
      .filter((fo) => fo.status === 'OPEN' || fo.status === 'IN_PROGRESS')
      .map((fo) => ({
        fulfillmentOrderId: fo.id,
        fulfillmentOrderLineItems: fo.lineItems
          .filter((x) => s.lineItemIds.includes(x.lineItemId) && x.remainingQuantity > 0)
          .map((x) => ({ id: x.id, quantity: x.remainingQuantity })),
      }))
      .filter((x) => x.fulfillmentOrderLineItems.length);
    if (byFo.length) {
      const res = await gql(`mutation($f: FulfillmentInput!) {
        fulfillmentCreate(fulfillment: $f) { fulfillment { trackingInfo { number company url } } userErrors { field message } }
      }`, { f: {
        lineItemsByFulfillmentOrder: byFo,
        notifyCustomer: false,
        trackingInfo: { number: tracking.number, company: tracking.company, ...(tracking.url ? { url: tracking.url } : {}) },
      } });
      assertNoUserErrors(res.fulfillmentCreate, 'fulfillmentCreate');
      // Shopify fills in the tracking URL for carriers it knows.
      tracking.url ||= res.fulfillmentCreate.fulfillment.trackingInfo?.[0]?.url ?? null;
    }

    s.invoiceFileId = invoiceFileId;
    s.invoiceFilename = storedName;
    s.status = 'shipped';
    s.shippedAt = new Date().toISOString();
    s.tracking = tracking;
    await saveState(order, state);
    return { order, s };
  });
  if (!result) return;
  const { order, s } = result;

  const allDone = Object.values(order.state!.suppliers).every((x) => x.status === 'shipped' || x.status === 'rejected');
  if (allDone) {
    await addTags(order, [TAG_SHIPPED]);
    await removeTags(order, [TAG_IN_PROGRESS]);
  }

  const aInvoice = await sellerInvoice(order);
  const bInvoice = { filename: storedName, content: invoicePdf.content };
  await sendEmail(t.sellerShipped(order, s, bInvoice));
  if (order.email) await sendEmail(t.customerShipped(order, s, aInvoice));
  await sendEmail(t.accountant(order, s, aInvoice, bInvoice));
}

// 4. Seller paid the supplier invoice.
export async function markSupplierPaid(id: string, key: string) {
  const result = await withFreshOrder(id, async (order) => {
    const s = requireSupplier(order, key);
    if (s.paid || s.status !== 'shipped') return null;
    s.paid = true;
    s.paidAt = new Date().toISOString();
    await saveState(order, order.state!);
    return { order, s };
  });
  if (result) await sendEmail(t.supplierPaid(result.order, result.s));
}

export async function handlePaidTag(id: string) {
  const order = await getOrder(id);
  if (!order?.state || !order.tags.includes(TAG_SUPPLIER_PAID)) return;
  for (const [key, s] of Object.entries(order.state.suppliers)) {
    if (s.status === 'shipped' && !s.paid) await markSupplierPaid(order.id, key);
  }
}

// Hourly/daily housekeeping: catch orders a webhook missed, nudge slow suppliers, optional review email.
export async function runCron() {
  const log: string[] = [];
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  for (const o of await listOrderRefs(`created_at:>='${since}'`)) {
    if (!o.state && (await processNewOrder(o.id)) === 'processed') log.push(`processed ${o.name}`);
  }

  const now = Date.now();
  const hoursSince = (iso?: string) => (iso ? (now - Date.parse(iso)) / 3600_000 : Infinity);
  const refs = await listOrderRefs(`created_at:>='${new Date(now - 30 * 86400_000).toISOString()}'`, 100);
  const needsWork = refs.filter((r) => r.state && (
    Object.values(r.state.suppliers).some((s) => s.status === 'sent' || s.status === 'confirmed') ||
    (config.reviewEmailsEnabled && !r.state.reviewSentAt)
  ));
  for (const order of await getOrders(needsWork.map((r) => r.id))) {
    const state = order.state;
    if (!state) continue;
    let changed = false;
    for (const [key, s] of Object.entries(state.suppliers)) {
      if (s.status === 'sent' && hoursSince(s.sentAt) >= config.confirmReminderHours && hoursSince(s.remindedConfirmAt) >= 24) {
        await sendEmail(t.supplierReminder(order, s, itemsFor(order, s), supplierUrl(order.id, key), 'confirm'));
        await sendEmail(t.sellerSupplierLate(order, s, 'confirm'));
        s.remindedConfirmAt = new Date().toISOString();
        changed = true;
        log.push(`confirm reminder ${order.name} ${s.name}`);
      }
      if (s.status === 'confirmed' && hoursSince(s.confirmedAt) >= config.shipReminderHours && hoursSince(s.remindedShipAt) >= 24) {
        await sendEmail(t.supplierReminder(order, s, itemsFor(order, s), supplierUrl(order.id, key), 'ship'));
        await sendEmail(t.sellerSupplierLate(order, s, 'ship'));
        s.remindedShipAt = new Date().toISOString();
        changed = true;
        log.push(`ship reminder ${order.name} ${s.name}`);
      }
    }
    if (config.reviewEmailsEnabled && !state.reviewSentAt && order.email) {
      const shipped = Object.values(state.suppliers).map((s) => s.shippedAt).filter(Boolean) as string[];
      const allShipped = shipped.length && shipped.length === Object.values(state.suppliers).filter((s) => s.status !== 'rejected').length;
      if (allShipped) {
        const last = new Date(shipped.sort().at(-1)!);
        if (addBusinessDays(last, config.reviewAfterBusinessDays).getTime() <= now) {
          await sendEmail(t.customerReview(order));
          state.reviewSentAt = new Date().toISOString();
          changed = true;
          log.push(`review email ${order.name}`);
        }
      }
    }
    // A supplier acting at the same moment wins; the reminder flags are simply written on the next run.
    if (changed) await saveState(order, state).catch((err) => { if (!(err instanceof StaleStateError)) throw err; });
  }
  return log;
}
