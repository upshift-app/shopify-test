// Minimal Admin API client for the CLI scripts (the app itself uses lib/shopify.ts).
const shop = process.env.SHOPIFY_SHOP;
const apiVersion = '2026-10';
let token = process.env.SHOPIFY_ACCESS_TOKEN;

async function accessToken() {
  if (token) return token;
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  token = (await res.json()).access_token;
  return token;
}

export async function gql(query, variables = {}) {
  const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await accessToken() },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body, null, 2));
  return body.data;
}

export function check(payload, what) {
  if (payload?.userErrors?.length) throw new Error(`${what}: ${JSON.stringify(payload.userErrors)}`);
  return payload;
}
