import { gql } from './shopify';

// Suppliers are Shopify metaobjects of type "tiekejas", managed in Content > Metaobjects.
// A product belongs to a supplier when the product's Vendor equals the supplier's "vendor" field.
export type Supplier = { key: string; name: string; vendor: string; email: string };

export const SUPPLIER_TYPE = 'tiekejas';

export async function loadSuppliers(): Promise<Supplier[]> {
  const data = await gql(`query($type: String!) {
    metaobjects(type: $type, first: 100) {
      nodes { handle fields { key value } }
    }
  }`, { type: SUPPLIER_TYPE });
  return data.metaobjects.nodes.map((n: any) => {
    const f = Object.fromEntries(n.fields.map((x: any) => [x.key, x.value ?? '']));
    return { key: n.handle, name: f.pavadinimas || n.handle, vendor: f.vendor || '', email: f.el_pastas || '' };
  });
}

export function supplierForVendor(suppliers: Supplier[], vendor: string | null): Supplier | undefined {
  const v = (vendor ?? '').trim().toLowerCase();
  return suppliers.find((s) => s.vendor.trim().toLowerCase() === v);
}
