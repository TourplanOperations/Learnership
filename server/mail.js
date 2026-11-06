// Outgoing email. Uses SMTP when configured (Microsoft 365, Resend, SendGrid, ...);
// otherwise writes .eml files to ./local-data/outbox for local testing.

import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';
import nodemailer from 'nodemailer';
import { config, usingSmtp } from './config.js';
import { REQUIRED_DOCUMENTS } from './documents.js';
import { formatDate } from './application-pdf.js';

const OUTBOX = path.join(PROJECT_ROOT, 'local-data', 'outbox');

const transport = usingSmtp
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

async function send(message) {
  const info = await transport.sendMail({ from: config.mailFrom, ...message });
  if (!usingSmtp) {
    await fs.mkdir(OUTBOX, { recursive: true });
    const file = path.join(OUTBOX, `${Date.now()}-${message.to.split('@')[0].replace(/\W/g, '')}.eml`);
    await fs.writeFile(file, info.message);
    console.log(`[mail] SMTP not configured; wrote ${path.relative(PROJECT_ROOT, file)}`);
  }
  return info;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(inner) {
  return `<!doctype html><html><body style="margin:0;background:#EBEBEB;font-family:'MuseoSans','Manrope',Segoe UI,Arial,sans-serif;color:#111111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBEBEB;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden">
<tr><td style="background:#000000;padding:20px 28px"><img src="${config.publicBaseUrl}/tourplan-logo.png" alt="Tourplan" height="24" style="display:block;height:24px"></td></tr>
<tr><td style="padding:28px;font-size:14px;line-height:1.55">${inner}</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendTeamNotification(app, pdfBuffer) {
  const reviewUrl = `${config.publicBaseUrl}/admin/applications/${app.id}`;
  const docRows = REQUIRED_DOCUMENTS.map(
    (d) =>
      `<tr><td style="padding:6px 0;color:#6B6A68;width:45%">${esc(d.label)}</td><td style="padding:6px 0"><a href="${reviewUrl}/documents/${d.key}" style="color:#BA0C2F">${esc(app.documents[d.key]?.filename)}</a></td></tr>`,
  ).join('');
  const q = app.qualification;

  const html = layout(`
<p style="margin:0 0 4px;color:#BA0C2F;font-size:11px;font-weight:700;letter-spacing:1px">NEW LEARNERSHIP APPLICATION ${app.intake_year}</p>
<h1 style="margin:0 0 4px;font-size:22px">${esc(app.first_name)} ${esc(app.surname)}</h1>
<p style="margin:0 0 20px;color:#6B6A68">Reference ${esc(app.reference)} · submitted ${formatDate(app.created_at)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-bottom:20px">
<tr><td style="padding:6px 0;color:#6B6A68;width:45%">Qualification</td><td style="padding:6px 0">${esc(q.qualification)}, NQF ${esc(q.nqf_level)} (${esc(q.field)})</td></tr>
<tr><td style="padding:6px 0;color:#6B6A68">Institution</td><td style="padding:6px 0">${esc(q.institution)}, ${q.status === 'completed' ? 'completed' : 'final year'} ${esc(q.year)}</td></tr>
<tr><td style="padding:6px 0;color:#6B6A68">Province</td><td style="padding:6px 0">${esc(app.province)}</td></tr>
</table>
<p style="margin:0 0 8px;font-weight:700">Supporting documents (all passed the readability check)</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-bottom:24px">${docRows}</table>
<p style="margin:0 0 24px"><a href="${reviewUrl}" style="display:inline-block;background:#BA0C2F;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">Review application</a></p>
<p style="margin:0;color:#6B6A68;font-size:12px">The completed application form is attached as a PDF. Document links open the Learnership admin page and need the admin password. This email contains personal information; please do not forward it outside the selection team.</p>`);

  return send({
    to: config.teamInbox,
    replyTo: app.email,
    subject: `Learnership application ${app.intake_year}: ${app.surname}, ${app.first_name} (${app.reference})`,
    html,
    text: `New Learnership application ${app.reference} from ${app.first_name} ${app.surname}.\nReview: ${reviewUrl}\nThe completed form is attached.`,
    attachments: [{ filename: `Learnership application ${app.reference} - ${app.surname}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  });
}

export async function sendApplicantConfirmation(app) {
  const html = layout(`
<p style="margin:0 0 16px">Dear ${esc(app.first_name)},</p>
<p style="margin:0 0 16px">Thank you for applying for the Tourplan Learnership ${app.intake_year}. We have received your application and all five supporting documents.</p>
<p style="margin:0 0 16px;padding:14px 16px;background:#F5F4EF;border-radius:8px">Your reference number is <strong>${esc(app.reference)}</strong>. Please quote it if you contact us.</p>
<p style="margin:0 0 16px">Applications close on ${formatDate(config.closesAt)}. Our team will review every application after the closing date, and shortlisted applicants will be contacted for the next step in the selection process, which includes psychometric testing.</p>
<p style="margin:0 0 16px">If any of your details change, or you have a question, please email <a href="mailto:${config.teamInbox}" style="color:#BA0C2F">${config.teamInbox}</a>.</p>
<p style="margin:0">Kind regards,<br><strong>The Tourplan Learnership team</strong><br><span style="color:#6B6A68">Tourplan Africa, Boksburg</span></p>`);

  return send({
    to: app.email,
    replyTo: config.teamInbox,
    subject: `We have received your Tourplan Learnership application (${app.reference})`,
    html,
    text: `Dear ${app.first_name},\n\nThank you for applying for the Tourplan Learnership ${app.intake_year}. Your reference number is ${app.reference}.\n\nShortlisted applicants will be contacted after applications close on ${formatDate(config.closesAt)}.\n\nKind regards,\nThe Tourplan Learnership team`,
  });
}
