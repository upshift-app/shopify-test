# Intere automation

Dropshipping flow for a Shopify store: customer (C) buys, each supplier (B) gets their part of the order,
confirms it, enters tracking and uploads an invoice through a signed link (no accounts). Seller (A),
customer and accountant (D) get the right emails with the right PDFs. Next.js on Vercel, no database:
state lives in order metafields, PDFs in Shopify Files.

## Flow

| Step | Trigger | What happens |
|---|---|---|
| New order | `orders/create` webhook (cron catches missed ones) | Items split by product **Vendor** -> supplier metaobject. Each supplier gets an email with items + delivery only. Items without a supplier -> alert to A. Shopify's own order confirmation still goes to C and A. |
| Supplier confirms | link `/t/<token>` | Tag `Vykdoma`. Email to A. Email to C with the seller invoice (PDF, once per order). Email to B asking for tracking + invoice. |
| Supplier rejects | same link | Tag `Tiekėjas atmetė`, alert to A with the reason. |
| Supplier ships | same link, tracking + PDF | Shopify fulfillment for that supplier's lines (customer not notified by Shopify), B invoice saved to Files. Emails: A (B invoice), C (tracking + A invoice), D (A + B invoice + tracking). Tag `Išsiųsta` when every supplier is done. |
| Supplier paid | `/admin` button, or tag `Tiekėjui apmokėta` on the order | Email to B. |
| Daily cron | `/api/cron` | Sync missed orders, reminders (B not confirmed in 24 h / not shipped in 72 h, A copied), optional review email. |

In Shopify admin each order shows pinned metafields: supplier status, tracking numbers, A invoice, B invoices.

## Setup

1. Dev Dashboard (same organization as the store) > create app, scopes:
   `read_orders,write_orders,read_products,write_products,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders,read_files,write_files,read_metaobjects,write_metaobjects,read_metaobject_definitions,write_metaobject_definitions,read_customers`
   Release, install on the store. Auth uses the client credentials grant (app and store must share an organization).
2. Copy `.env.local` values (see the file for all variables), then `npm install` and `npm run setup`
   (add `-- --test-data` for two test suppliers and two draft products, `npm run test-order` for a test order).
3. Suppliers: Shopify admin > Content > Metaobjects > Tiekėjas. `vendor` must equal the product's Vendor.

## Deploy (Vercel)

```bash
npx vercel link
npx vercel env add ...   # every variable from .env.local, APP_URL = the production URL
npx vercel --prod
```

Then set `APP_URL` to the https URL and run `npm run setup` again: it registers the webhooks.
Emails: set `RESEND_API_KEY` and verify the sender domain in Resend. Without the key nothing is sent,
emails are written to `.outbox/` (locally) or the log (Vercel).

Vercel Hobby is for non-commercial use and runs crons once a day; a client project belongs on Pro.

## Notes

- Concurrency: every state write uses `compareDigest`, so duplicate webhooks or two suppliers acting at once never double-send.
- Seller invoice is generated here (`lib/invoice.ts`, numbering `INVOICE_PREFIX-<order number>`). If the client keeps Order Printer Pro, that is the piece to swap.
- Review / discount / newsletter email is meant for Omnisend; `REVIEW_EMAILS_ENABLED=true` turns on a simple built-in one.
