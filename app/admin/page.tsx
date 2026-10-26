import { getOrders, listOrderRefs } from '@/lib/orders';
import { gql, adminOrderUrl } from '@/lib/shopify';
import { statusLabel } from '@/lib/templates';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';

async function fileUrls(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const data = await gql(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on GenericFile { id url } } }`, { ids });
  return Object.fromEntries(data.nodes.filter((n: any) => n?.url).map((n: any) => [n.id, n.url]));
}

export default async function AdminPage() {
  const refs = (await listOrderRefs('', 50)).filter((o) => o.state);
  const orders = await getOrders(refs.map((r) => r.id));
  const ids = orders.flatMap((o) => [o.state!.aInvoiceFileId, ...Object.values(o.state!.suppliers).map((s) => s.invoiceFileId)]).filter(Boolean) as string[];
  const urls = await fileUrls(ids);

  return (
    <main className="wide">
      <h1>Užsakymai ir tiekėjai</h1>
      <p className="muted">Paskutiniai 50 užsakymų. Tiekėjo sąskaitą pažymėti apmokėta galima čia arba Shopify užsakymui pridėjus žymą „Tiekėjui apmokėta“.</p>
      <div className="card">
        <table>
          <thead>
            <tr><th>Užsakymas</th><th className="hide-sm">Pirkėjas</th><th>Tiekėjas</th><th>Būsena</th><th>Siunta</th><th>Sąskaitos</th><th></th></tr>
          </thead>
          <tbody>
            {orders.flatMap((o) => {
              const suppliers = Object.entries(o.state!.suppliers);
              const aUrl = o.state!.aInvoiceFileId ? urls[o.state!.aInvoiceFileId] : undefined;
              if (!suppliers.length) {
                return [<tr key={o.id}><td><a href={adminOrderUrl(o.id)} target="_blank">{o.name}</a></td><td className="hide-sm">{o.customerName}</td><td colSpan={5} className="muted">Nėra tiekėjo: {o.state!.unassigned.join(', ')}</td></tr>];
              }
              return suppliers.map(([key, s], i) => (
                <tr key={`${o.id}-${key}`}>
                  <td>{i === 0 && <><a href={adminOrderUrl(o.id)} target="_blank">{o.name}</a><div className="muted">{o.createdAt.slice(0, 10)} · {money(o.total, o.currency)}</div></>}</td>
                  <td className="hide-sm">{i === 0 && (o.customerName ?? o.email)}</td>
                  <td>{s.name}</td>
                  <td><span className={`badge ${s.status}`}>{statusLabel(s)}</span>{s.rejectReason && <div className="muted">{s.rejectReason}</div>}</td>
                  <td>{s.tracking ? (s.tracking.url ? <a href={s.tracking.url} target="_blank">{s.tracking.company} {s.tracking.number}</a> : `${s.tracking.company} ${s.tracking.number}`) : '-'}</td>
                  <td>
                    {i === 0 && aUrl && <div><a href={aUrl} target="_blank">A sąskaita</a></div>}
                    {s.invoiceFileId && urls[s.invoiceFileId] && <div><a href={urls[s.invoiceFileId]} target="_blank">B sąskaita</a></div>}
                  </td>
                  <td>
                    {s.status === 'shipped' && !s.paid && (
                      <form method="post" action="/api/admin/paid">
                        <input type="hidden" name="order" value={o.id} />
                        <input type="hidden" name="supplier" value={key} />
                        <button className="small" type="submit">Apmokėta</button>
                      </form>
                    )}
                  </td>
                </tr>
              ));
            })}
            {!orders.length && <tr><td colSpan={7} className="muted">Užsakymų dar nėra.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
