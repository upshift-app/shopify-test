import { readToken } from '@/lib/links';
import { confirmOrder, rejectOrder, shipOrder } from '@/lib/orders';

export const maxDuration = 60;

const MAX_PDF_BYTES = 4 * 1024 * 1024; // Vercel functions accept ~4.5 MB request bodies

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = readToken(token);
  if (!link) return new Response('Not found', { status: 404 });
  const back = (query: string) => Response.redirect(new URL(`/t/${token}?${query}`, request.url), 303);

  const form = await request.formData();
  const action = form.get('action');
  try {
    if (action === 'confirm') {
      await confirmOrder(link.o, link.s);
      return back('ok=confirmed');
    }
    if (action === 'reject') {
      await rejectOrder(link.o, link.s, String(form.get('reason') ?? '').slice(0, 1000));
      return back('ok=rejected');
    }
    if (action === 'ship') {
      const number = String(form.get('number') ?? '').trim();
      const company = String(form.get('company') ?? '').trim();
      const url = String(form.get('url') ?? '').trim();
      const file = form.get('invoice');
      if (!number || !company) return back('err=tracking');
      if (!(file instanceof File) || file.size === 0 || file.size > MAX_PDF_BYTES) return back('err=pdf');
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Check the PDF magic bytes rather than trusting the browser's content type.
      if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') return back('err=pdf');
      await shipOrder(link.o, link.s, { number, company, url: /^https?:\/\//.test(url) ? url : null }, {
        filename: file.name.toLowerCase().endsWith('.pdf') ? file.name : `${file.name}.pdf`,
        content: bytes,
      });
      return back('ok=shipped');
    }
  } catch (err) {
    console.error(`[supplier ${action}] order ${link.o} supplier ${link.s}`, err);
    return back('err=failed');
  }
  return new Response('Bad request', { status: 400 });
}
