import crypto from 'node:crypto';
import { config } from './config';

// Supplier links carry the order and supplier, signed so they can't be guessed or edited.
// No expiry: a supplier may open an old email weeks later to look the order up.
export type LinkPayload = { o: string; s: string }; // numeric order id, supplier key

function sign(data: string): string {
  return crypto.createHmac('sha256', config.linkSecret).update(data).digest('base64url').slice(0, 32);
}

export function makeToken(orderId: string, supplierKey: string): string {
  const data = Buffer.from(JSON.stringify({ o: orderId.split('/').pop(), s: supplierKey })).toString('base64url');
  return `${data}.${sign(data)}`;
}

export function readToken(token: string): LinkPayload | null {
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = sign(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function supplierUrl(orderId: string, supplierKey: string): string {
  return `${config.appUrl}/t/${makeToken(orderId, supplierKey)}`;
}
