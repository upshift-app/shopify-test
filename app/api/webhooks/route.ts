import { after } from 'next/server';
import { verifyWebhook } from '@/lib/shopify';
import { handlePaidTag, processNewOrder } from '@/lib/orders';

// Shopify wants a 200 within 5 seconds, so the work runs after the response.
// Missed or failed deliveries are picked up by the cron sync.
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyWebhook(raw, request.headers.get('x-shopify-hmac-sha256'))) {
    return new Response('invalid hmac', { status: 401 });
  }
  const topic = request.headers.get('x-shopify-topic');
  const payload = JSON.parse(raw);
  const orderId = payload.admin_graphql_api_id ?? String(payload.id);

  after(async () => {
    try {
      if (topic === 'orders/create') await processNewOrder(orderId);
      if (topic === 'orders/updated') await handlePaidTag(orderId);
    } catch (err) {
      console.error(`[webhook ${topic}] ${orderId}`, err);
    }
  });
  return new Response('ok');
}
