function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env variable ${name}`);
  return value;
}

export const config = {
  get shop() { return required('SHOPIFY_SHOP'); }, // e.g. intere.myshopify.com
  get clientId() { return required('SHOPIFY_CLIENT_ID'); },
  get clientSecret() { return required('SHOPIFY_CLIENT_SECRET'); },
  apiVersion: '2026-10',
  get appUrl() { return required('APP_URL').replace(/\/$/, ''); },
  // Signs supplier links. Rotating it invalidates every link already sent.
  get linkSecret() { return required('LINK_SECRET'); },
  get adminPassword() { return required('ADMIN_PASSWORD'); },
  get cronSecret() { return process.env.CRON_SECRET ?? ''; },

  // Who gets which email
  get sellerEmail() { return required('SELLER_EMAIL'); },         // A
  get accountantEmail() { return required('ACCOUNTANT_EMAIL'); }, // D
  get fromEmail() { return process.env.FROM_EMAIL ?? 'Intere <info@intere.lt>'; },
  get resendKey() { return process.env.RESEND_API_KEY ?? ''; },

  // Seller details printed on the invoice; SELLER_DETAILS lines are separated by |
  seller: {
    get name() { return process.env.SELLER_NAME ?? 'Intere'; },
    get details() { return (process.env.SELLER_DETAILS ?? '').split('|').filter(Boolean); },
    get invoicePrefix() { return process.env.INVOICE_PREFIX ?? 'INT'; },
  },

  confirmReminderHours: Number(process.env.CONFIRM_REMINDER_HOURS ?? 24),
  shipReminderHours: Number(process.env.SHIP_REMINDER_HOURS ?? 72),
  // The review email from this app is off by default: Omnisend is meant to send it.
  reviewEmailsEnabled: process.env.REVIEW_EMAILS_ENABLED === 'true',
  reviewAfterBusinessDays: Number(process.env.REVIEW_AFTER_BUSINESS_DAYS ?? 5),
  get reviewUrl() { return process.env.REVIEW_URL ?? 'https://intere.lt'; },
  get reviewDiscountCode() { return process.env.REVIEW_DISCOUNT_CODE ?? ''; },
  get newsletterUrl() { return process.env.NEWSLETTER_URL ?? 'https://intere.lt'; },
};
