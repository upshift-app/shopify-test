import crypto from 'node:crypto';
import { config } from './config';

let cached: { token: string; expiresAt: number } | null = null;

// Client credentials grant: works when the app and the store are in the same Shopify organization.
// Tokens live 24 h, so we cache per serverless instance and refresh a few minutes early.
async function accessToken(): Promise<string> {
  if (process.env.SHOPIFY_ACCESS_TOKEN) return process.env.SHOPIFY_ACCESS_TOKEN;
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached.token;
  const res = await fetch(`https://${config.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Shopify token request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${config.shop}/admin/api/${config.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await accessToken() },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(`Shopify GraphQL error: ${JSON.stringify(body.errors ?? body)}`);
  return body.data as T;
}

// Throws when a mutation payload reports userErrors, so callers can't silently ignore them.
export function assertNoUserErrors(payload: { userErrors?: { field?: string[]; message: string }[] }, what: string) {
  if (payload?.userErrors?.length) throw new Error(`${what}: ${JSON.stringify(payload.userErrors)}`);
}

export function verifyWebhook(rawBody: string, hmacHeader: string | null): boolean {
  if (!hmacHeader) return false;
  const digest = crypto.createHmac('sha256', config.clientSecret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Uploads a file to Shopify Files (Content > Files) and returns its GID.
export async function uploadFile(filename: string, bytes: Uint8Array, mimeType: string, alt: string): Promise<string> {
  const staged = await gql(`mutation($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`, { input: [{ filename, mimeType, resource: 'FILE', httpMethod: 'POST', fileSize: String(bytes.length) }] });
  assertNoUserErrors(staged.stagedUploadsCreate, 'stagedUploadsCreate');
  const target = staged.stagedUploadsCreate.stagedTargets[0];

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([bytes as BlobPart], { type: mimeType }), filename);
  const up = await fetch(target.url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`Staged upload failed: ${up.status} ${await up.text()}`);

  const created = await gql(`mutation($files: [FileCreateInput!]!) {
    fileCreate(files: $files) { files { id } userErrors { field message } }
  }`, { files: [{ originalSource: target.resourceUrl, contentType: 'FILE', alt, filename }] });
  assertNoUserErrors(created.fileCreate, 'fileCreate');
  return created.fileCreate.files[0].id as string;
}

export function orderGid(id: string | number): string {
  return String(id).startsWith('gid://') ? String(id) : `gid://shopify/Order/${id}`;
}

export function adminOrderUrl(orderGidOrId: string): string {
  const id = orderGidOrId.split('/').pop();
  const store = config.shop.replace('.myshopify.com', '');
  return `https://admin.shopify.com/store/${store}/orders/${id}`;
}
