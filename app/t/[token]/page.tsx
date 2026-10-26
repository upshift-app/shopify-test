import { notFound } from 'next/navigation';
import { readToken } from '@/lib/links';
import { getOrder, itemsFor } from '@/lib/orders';
import { statusLabel } from '@/lib/templates';

export const dynamic = 'force-dynamic';

const CARRIERS = ['DPD', 'Omniva', 'LP Express', 'Venipak', 'Itella (Smartpost)', 'DHL', 'UPS', 'Kita'];

const NOTICES: Record<string, string> = {
  confirmed: 'Užsakymas patvirtintas. Ačiū! Kai išsiųsite, įrašykite siuntos numerį žemiau.',
  rejected: 'Užsakymas atmestas. Intere apie tai informuota.',
  shipped: 'Ačiū! Siuntos informacija ir sąskaita gauta.',
};
const ERRORS: Record<string, string> = {
  pdf: 'Prisekite sąskaitą PDF formatu (iki 4 MB).',
  tracking: 'Įrašykite siuntos sekimo numerį ir pasirinkite kurjerį.',
  failed: 'Nepavyko išsaugoti. Bandykite dar kartą arba parašykite mums.',
};

export default async function SupplierPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { token } = await params;
  const { ok, err } = await searchParams;
  const link = readToken(token);
  if (!link) notFound();
  const order = await getOrder(link.o);
  const s = order?.state?.suppliers[link.s];
  if (!order || !s) notFound();

  const items = itemsFor(order, s);
  const a = order.shippingAddress;
  const action = `/api/supplier/${token}`;

  return (
    <main>
      <p className="muted">Intere · tiekėjas {s.name}</p>
      <h1>Užsakymas {order.name}</h1>
      <span className={`badge ${s.status}`}>{statusLabel(s)}</span>

      {ok && NOTICES[ok] && <div className="notice">{NOTICES[ok]}</div>}
      {err && ERRORS[err] && <div className="notice error">{ERRORS[err]}</div>}

      <div className="card">
        <h2>Prekės</h2>
        <table>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.title}{i.variantTitle ? ` (${i.variantTitle})` : ''}{i.sku && <div className="muted">SKU: {i.sku}</div>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{i.quantity} vnt.</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2 style={{ marginTop: 20 }}>Pristatymas</h2>
        <p style={{ margin: 0 }}>
          {[a?.name, a?.company, a?.address1, a?.address2, [a?.zip, a?.city].filter(Boolean).join(' '), a?.country, a?.phone || order.phone]
            .filter(Boolean).map((line, i) => <span key={i}>{line}<br /></span>)}
        </p>
        {order.shippingTitle && <p className="muted">Pristatymo būdas: {order.shippingTitle}</p>}
        {order.note && <p><b>Pirkėjo pastaba:</b> {order.note}</p>}
      </div>

      {s.status === 'sent' && (
        <div className="card">
          <h2>Ar galite įvykdyti šį užsakymą?</h2>
          <form method="post" action={action}>
            <input type="hidden" name="action" value="confirm" />
            <button type="submit">Patvirtinti užsakymą</button>
          </form>
          <details>
            <summary>Negaliu įvykdyti (atmesti užsakymą)</summary>
            <form method="post" action={action}>
              <input type="hidden" name="action" value="reject" />
              <label htmlFor="reason">Priežastis</label>
              <textarea id="reason" name="reason" rows={3} placeholder="Pvz. prekės neturime sandėlyje, bus po 3 savaičių" required />
              <button type="submit" className="secondary">Atmesti užsakymą</button>
            </form>
          </details>
        </div>
      )}

      {s.status === 'confirmed' && (
        <div className="card">
          <h2>Siuntos informacija ir sąskaita</h2>
          <form method="post" action={action} encType="multipart/form-data">
            <input type="hidden" name="action" value="ship" />
            <label htmlFor="company">Kurjeris</label>
            <select id="company" name="company" required defaultValue="">
              <option value="" disabled>Pasirinkite</option>
              {CARRIERS.map((c) => <option key={c}>{c}</option>)}
            </select>
            <label htmlFor="number">Siuntos sekimo numeris</label>
            <input id="number" name="number" type="text" required autoComplete="off" />
            <label htmlFor="url">Sekimo nuoroda (nebūtina)</label>
            <input id="url" name="url" type="url" placeholder="https://" />
            <label htmlFor="invoice">Sąskaita faktūra už prekes su pristatymu (PDF)</label>
            <input id="invoice" name="invoice" type="file" accept="application/pdf,.pdf" required />
            <button type="submit">Patvirtinti išsiuntimą</button>
          </form>
        </div>
      )}

      {s.status === 'shipped' && s.tracking && (
        <div className="card">
          <h2>Išsiųsta</h2>
          <p>{s.tracking.company}: {s.tracking.url ? <a href={s.tracking.url}>{s.tracking.number}</a> : s.tracking.number}</p>
          <p className="muted">Sąskaita: {s.invoiceFilename} · {s.paid ? `apmokėta ${s.paidAt?.slice(0, 10)}` : 'dar neapmokėta'}</p>
        </div>
      )}

      {s.status === 'rejected' && (
        <div className="card"><h2>Užsakymas atmestas</h2><p className="muted">{s.rejectReason}</p></div>
      )}
    </main>
  );
}
