import { markSupplierPaid } from '@/lib/orders';

export async function POST(request: Request) {
  const form = await request.formData();
  await markSupplierPaid(String(form.get('order')), String(form.get('supplier')));
  return Response.redirect(new URL('/admin', request.url), 303);
}
