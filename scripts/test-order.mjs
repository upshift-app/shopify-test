// Creates a paid test order with the draft test products, without emailing anyone from Shopify.
//   npm run test-order            -> one item from each test supplier (multi-supplier case)
//   npm run test-order -- --single -> only the B1 item
import { gql, check } from './shopify.mjs';

const single = process.argv.includes('--single');
const titles = single ? ['TESTAS Ąžuolinis staliukas'] : ['TESTAS Ąžuolinis staliukas', 'TESTAS Lino šviestuvas'];

const lineItems = [];
for (const title of titles) {
  const data = await gql(`query($q: String!) { products(first: 1, query: $q) { nodes { variants(first: 1) { nodes { id } } } } }`, { q: `title:'${title}'` });
  const variant = data.products.nodes[0]?.variants.nodes[0];
  if (!variant) throw new Error(`Test product "${title}" not found, run: npm run setup -- --test-data`);
  lineItems.push({ variantId: variant.id, quantity: 1 });
}

const address = {
  firstName: 'Testas', lastName: 'Pirkėjas', address1: 'Gedimino pr. 1', city: 'Vilnius', zip: '01103',
  countryCode: 'LT', phone: '+37060000000',
};
const res = await gql(`mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) { order { id name } userErrors { field message } }
}`, {
  order: {
    email: process.env.TEST_CUSTOMER_EMAIL,
    lineItems,
    shippingAddress: address,
    billingAddress: address,
    financialStatus: 'PAID',
    tags: ['intere-testas'],
    note: 'Testinis užsakymas',
    shippingLines: [{ title: 'Kurjeris į namus', priceSet: { shopMoney: { amount: '9.90', currencyCode: 'EUR' } } }],
  },
  options: { sendReceipt: false, sendFulfillmentReceipt: false, inventoryBehaviour: 'BYPASS' },
});
check(res.orderCreate, 'orderCreate');
console.log(`created ${res.orderCreate.order.name} ${res.orderCreate.order.id}`);
