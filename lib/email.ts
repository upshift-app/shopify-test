import fs from 'node:fs/promises';
import path from 'node:path';
import { Resend } from 'resend';
import { config } from './config';

export type Attachment = { filename: string; content: Uint8Array };
export type Email = { to: string | string[]; subject: string; html: string; attachments?: Attachment[]; replyTo?: string };

// Without RESEND_API_KEY the email is written to .outbox/ (local testing) and logged.
export async function sendEmail(email: Email): Promise<void> {
  if (config.resendKey) {
    const resend = new Resend(config.resendKey);
    const { error } = await resend.emails.send({
      from: config.fromEmail,
      to: email.to,
      subject: email.subject,
      html: email.html,
      replyTo: email.replyTo,
      attachments: email.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content) })),
    });
    if (error) throw new Error(`Email to ${email.to} failed: ${error.message}`);
    return;
  }

  const to = Array.isArray(email.to) ? email.to.join(', ') : email.to;
  console.log(`[email] to=${to} subject="${email.subject}" attachments=${email.attachments?.map((a) => a.filename).join(',') ?? ''}`);
  const dir = path.join(process.env.VERCEL ? '/tmp' : process.cwd(), '.outbox');
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = `${stamp}-${to.replace(/[^a-z0-9]+/gi, '_')}`;
  const attachmentLinks = (email.attachments ?? []).map((a) => `<li><a href="${slug}-${a.filename}">${a.filename}</a></li>`).join('');
  await fs.writeFile(
    path.join(dir, `${slug}.html`),
    `<!doctype html><meta charset="utf-8"><p><b>To:</b> ${to}<br><b>Subject:</b> ${email.subject}</p><ul>${attachmentLinks}</ul><hr>${email.html}`,
  );
  for (const a of email.attachments ?? []) await fs.writeFile(path.join(dir, `${slug}-${a.filename}`), a.content);
}
