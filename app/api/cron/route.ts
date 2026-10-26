import { config } from '@/lib/config';
import { runCron } from '@/lib/orders';

export const maxDuration = 60;

// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  if (config.cronSecret && request.headers.get('authorization') !== `Bearer ${config.cronSecret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const log = await runCron();
  return Response.json({ ok: true, log });
}
