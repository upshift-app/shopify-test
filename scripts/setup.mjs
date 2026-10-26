// One-time store setup. Safe to re-run: existing definitions, suppliers and webhooks are kept.
//   npm run setup                -> supplier metaobject type, order metafields, webhooks
//   npm run setup -- --test-data -> also two test suppliers and two draft products (one per supplier)
import { gql, check } from './shopify.mjs';

const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
const withTestData = process.argv.includes('--test-data');

async function supplierDefinition() {
  const existing = await gql(`{ metaobjectDefinitionByType(type: "tiekejas") { id } }`);
  if (existing.metaobjectDefinitionByType) return console.log('= metaobject type tiekejas exists');
  const res = await gql(`mutation($d: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $d) { metaobjectDefinition { id } userErrors { field message } }
  }`, { d: {
    type: 'tiekejas',
    name: 'Tiekėjas',
    displayNameKey: 'pavadinimas',
    fieldDefinitions: [
      { key: 'pavadinimas', name: 'Pavadinimas', type: 'single_line_text_field', required: true },
      { key: 'vendor', name: 'Produkto Vendor', description: 'Turi sutapti su produkto „Vendor“ lauku', type: 'single_line_text_field', required: true },
      { key: 'el_pastas', name: 'El. paštas', type: 'single_line_text_field', required: true },
    ],
  } });
  check(res.metaobjectDefinitionCreate, 'metaobjectDefinitionCreate');
  console.log('+ metaobject type tiekejas');
}

async function orderMetafields() {
  const defs = [
    { key: 'busena', name: 'Tiekėjų būsena', type: 'single_line_text_field' },
    { key: 'siuntos', name: 'Siuntų numeriai', type: 'multi_line_text_field' },
    { key: 'a_saskaita', name: 'Sąskaita pirkėjui (A)', type: 'file_reference' },
    { key: 'b_saskaitos', name: 'Tiekėjų sąskaitos (B)', type: 'list.file_reference' },
    { key: 'state', name: 'Automatizacijos duomenys', type: 'json', pin: false },
  ];
  for (const d of defs) {
    const res = await gql(`mutation($d: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $d) { createdDefinition { id } userErrors { code field message } }
    }`, { d: { namespace: 'intere', ownerType: 'ORDER', pin: d.pin ?? true, key: d.key, name: d.name, type: d.type } });
    const errs = res.metafieldDefinitionCreate.userErrors;
    if (errs.some((e) => e.code === 'TAKEN')) console.log(`= order metafield intere.${d.key} exists`);
    else { check(res.metafieldDefinitionCreate, `metafield ${d.key}`); console.log(`+ order metafield intere.${d.key}`); }
  }
}

async function webhooks() {
  if (!appUrl.startsWith('https://')) return console.log(`! APP_URL is ${appUrl || 'empty'}, webhooks need a public https URL; skipped`);
  const uri = `${appUrl}/api/webhooks`;
  const existing = await gql(`{ webhookSubscriptions(first: 50) { nodes { id topic uri } } }`);
  for (const topic of ['ORDERS_CREATE', 'ORDERS_UPDATED']) {
    const same = existing.webhookSubscriptions.nodes.filter((w) => w.topic === topic);
    if (same.some((w) => w.uri === uri)) { console.log(`= webhook ${topic}`); continue; }
    for (const old of same) {
      await gql(`mutation($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { message } } }`, { id: old.id });
      console.log(`- webhook ${topic} -> ${old.uri}`);
    }
    const res = await gql(`mutation($topic: WebhookSubscriptionTopic!, $s: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $s) { webhookSubscription { id } userErrors { field message } }
    }`, { topic, s: { uri, format: 'JSON' } });
    check(res.webhookSubscriptionCreate, `webhook ${topic}`);
    console.log(`+ webhook ${topic} -> ${uri}`);
  }
}

async function testData() {
  const emails = (process.env.TEST_SUPPLIER_EMAILS ?? '').split(',').map((s) => s.trim());
  const suppliers = [
    { handle: 'testas-b1', name: 'Testas B1 (baldai)', vendor: 'Testas B1', email: emails[0] },
    { handle: 'testas-b2', name: 'Testas B2 (šviestuvai)', vendor: 'Testas B2', email: emails[1] ?? emails[0] },
  ];
  for (const s of suppliers) {
    const res = await gql(`mutation($h: MetaobjectHandleInput!, $m: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $h, metaobject: $m) { metaobject { id } userErrors { field message } }
    }`, { h: { type: 'tiekejas', handle: s.handle }, m: { fields: [
      { key: 'pavadinimas', value: s.name }, { key: 'vendor', value: s.vendor }, { key: 'el_pastas', value: s.email },
    ] } });
    check(res.metaobjectUpsert, 'metaobjectUpsert');
    console.log(`+ supplier ${s.name} <${s.email}>`);
  }

  const products = [
    { title: 'TESTAS Ąžuolinis staliukas', vendor: 'Testas B1', price: '189.00', sku: 'TEST-B1-STAL' },
    { title: 'TESTAS Lino šviestuvas', vendor: 'Testas B2', price: '64.90', sku: 'TEST-B2-SVIE' },
  ];
  for (const p of products) {
    const found = await gql(`query($q: String!) { products(first: 1, query: $q) { nodes { id } } }`, { q: `title:'${p.title}'` });
    if (found.products.nodes.length) { console.log(`= product ${p.title}`); continue; }
    // DRAFT keeps the test products off the live storefront.
    const res = await gql(`mutation($p: ProductCreateInput!) {
      productCreate(product: $p) { product { id variants(first: 1) { nodes { id } } } userErrors { field message } }
    }`, { p: { title: p.title, vendor: p.vendor, status: 'DRAFT', tags: ['intere-testas'] } });
    check(res.productCreate, 'productCreate');
    const product = res.productCreate.product;
    const upd = await gql(`mutation($pid: ID!, $v: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $pid, variants: $v) { userErrors { field message } }
    }`, { pid: product.id, v: [{ id: product.variants.nodes[0].id, price: p.price, inventoryItem: { sku: p.sku, tracked: false } }] });
    check(upd.productVariantsBulkUpdate, 'productVariantsBulkUpdate');
    console.log(`+ product ${p.title} (${p.vendor}, draft)`);
  }
}

await supplierDefinition();
await orderMetafields();
await webhooks();
if (withTestData) await testData();
console.log('done');
