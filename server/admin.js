// Password-protected review pages for the Learnership team.

import crypto from 'node:crypto';
import express from 'express';
import cookieSession from 'cookie-session';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { REQUIRED_DOCUMENTS, documentByKey, KIND_LABELS, MIME_TYPES } from './documents.js';
import { STUDY_STATUS } from './application-schema.js';
import { store } from './store.js';
import { formatDate, buildApplicationPdf } from './application-pdf.js';
import { sendTeamNotification } from './mail.js';

export const STATUSES = {
  new: 'New',
  reviewing: 'Reviewing',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  offered: 'Offered',
  unsuccessful: 'Unsuccessful',
  withdrawn: 'Withdrawn',
};

export const adminRouter = express.Router();

adminRouter.use(
  cookieSession({
    name: 'tp_admin',
    secret: config.sessionSecret,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: 8 * 60 * 60 * 1000,
    path: '/admin',
  }),
);
adminRouter.use(express.urlencoded({ extended: false, limit: '32kb' }));

// Reject cross-site form posts.
adminRouter.use((req, res, next) => {
  if (req.method === 'POST') {
    const origin = req.get('origin');
    if (origin && origin !== config.publicBaseUrl && origin !== `${req.protocol}://${req.get('host')}`) {
      console.warn(`Blocked admin POST: origin=${origin} host=${req.get('host')} proto=${req.protocol}`);
      return res.status(403).send('Forbidden');
    }
  }
  next();
});

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(title, body, { signedIn = true } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Learnership admin</title><meta name="robots" content="noindex">
<link rel="icon" href="/favicon.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/admin.css"></head><body class="admin">
<header class="site-header"><div class="wrap header-row"><a href="/admin" class="brand"><img src="/tourplan-logo.png" alt="Tourplan" height="22"></a>
<span class="header-tag">Learnership admin</span>${signedIn ? '<form method="post" action="/admin/logout" class="header-action"><button class="btn btn-pill btn-ghost-dark" type="submit">Sign out</button></form>' : ''}</div></header>
<main class="wrap admin-main">${body}</main></body></html>`;
}

function requireAdmin(req, res, next) {
  if (!config.adminPassword) return res.status(503).send(page('Admin disabled', '<div class="card"><h1 class="page-title">Admin is disabled</h1><p>Set ADMIN_PASSWORD to enable the review pages.</p></div>', { signedIn: false }));
  if (req.session?.admin) return next();
  res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
}

const safeNext = (n) => (typeof n === 'string' && n.startsWith('/admin') && !n.startsWith('//') ? n : '/admin');

// ---------------------------------------------------------------- sign in

adminRouter.get('/login', (req, res) => {
  const err = req.query.error ? '<p class="alert alert-danger" role="alert">That password is not correct.</p>' : '';
  res.send(
    page(
      'Sign in',
      `<div class="card narrow"><p class="eyebrow">Tourplan Learnership</p><h1 class="page-title">Sign in to review applications</h1>${err}
<form method="post" action="/admin/login" class="stack"><input type="hidden" name="next" value="${esc(safeNext(req.query.next))}">
<label class="field"><span class="label">Admin password</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
<button class="btn btn-primary" type="submit">Sign in</button></form></div>`,
      { signedIn: false },
    ),
  );
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });

adminRouter.post('/login', loginLimiter, (req, res) => {
  const given = crypto.createHash('sha256').update(String(req.body.password || '')).digest();
  const expected = crypto.createHash('sha256').update(config.adminPassword).digest();
  if (config.adminPassword && crypto.timingSafeEqual(given, expected)) {
    req.session.admin = true;
    return res.redirect(safeNext(req.body.next));
  }
  res.redirect(`/admin/login?error=1&next=${encodeURIComponent(safeNext(req.body.next))}`);
});

adminRouter.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/admin/login');
});

// ---------------------------------------------------------------- list

adminRouter.get('/', requireAdmin, async (req, res, next) => {
  try {
    const status = STATUSES[req.query.status] ? req.query.status : '';
    const search = String(req.query.q || '').slice(0, 80);
    const all = await store.listApplications({ intakeYear: config.intakeYear });
    const rows = all.filter(
      (a) =>
        (!status || a.status === status) &&
        (!search || [a.surname, a.first_name, a.email, a.reference, a.id_number].some((v) => (v || '').toLowerCase().includes(search.toLowerCase()))),
    );
    const counts = Object.fromEntries(Object.keys(STATUSES).map((s) => [s, all.filter((a) => a.status === s).length]));
    const nqf7 = all.filter((a) => Number(a.qualification?.nqf_level) >= 7).length;

    const tiles = `<div class="kpis">
<div class="kpi"><span class="label">Applications</span><span class="kpi-value">${all.length}</span><span class="meta">${config.intakeYear} intake</span></div>
<div class="kpi"><span class="label">NQF 7 or higher</span><span class="kpi-value">${nqf7}</span><span class="meta">${all.length ? Math.round((nqf7 / all.length) * 100) : 0}% of applications</span></div>
<div class="kpi"><span class="label">Awaiting review</span><span class="kpi-value">${counts.new}</span><span class="meta">Status: new</span></div>
<div class="kpi"><span class="label">Shortlisted</span><span class="kpi-value">${counts.shortlisted + counts.interview + counts.offered}</span><span class="meta">Incl. interview and offered</span></div></div>`;

    const filter = `<form class="filters" method="get" action="/admin">
<label class="field inline"><span class="label">Search</span><input type="search" name="q" value="${esc(search)}" placeholder="Name, email, reference or ID number"></label>
<label class="field inline"><span class="label">Status</span><select name="status"><option value="">All statuses</option>${Object.entries(STATUSES)
      .map(([k, v]) => `<option value="${k}"${k === status ? ' selected' : ''}>${v} (${counts[k]})</option>`)
      .join('')}</select></label>
<button class="btn btn-secondary" type="submit">Apply</button>${status || search ? '<a class="btn btn-link" href="/admin">Clear</a>' : ''}</form>`;

    const table = rows.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>Reference</th><th>Applicant</th><th>Qualification</th><th>NQF</th><th>Submitted</th><th>Status</th></tr></thead><tbody>${rows
          .map(
            (a) => `<tr><td><a href="/admin/applications/${a.id}">${esc(a.reference)}</a></td>
<td><a href="/admin/applications/${a.id}">${esc(a.surname)}, ${esc(a.first_name)}</a><div class="meta">${esc(a.email)}</div></td>
<td>${esc(a.qualification?.qualification)}<div class="meta">${esc(a.qualification?.field)} · ${a.qualification?.status === 'final_year' ? 'final year' : 'completed'}</div></td>
<td>${esc(a.qualification?.nqf_level)}</td><td class="nowrap">${formatDate(a.created_at)}</td>
<td><span class="chip chip-${a.status}">${STATUSES[a.status] || a.status}</span>${a.team_email_status === 'failed' ? ' <span class="chip chip-unsuccessful" title="Team email failed">Email failed</span>' : ''}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : `<div class="empty"><p class="state-title">No applications ${status || search ? 'match these filters' : 'yet'}</p><p class="meta">${status || search ? 'Try clearing the filters.' : 'New applications appear here as soon as they are submitted.'}</p></div>`;

    res.send(page('Applications', `<p class="eyebrow">Learnership ${config.intakeYear}</p><h1 class="page-title">Applications</h1>${tiles}<div class="card">${filter}${table}</div>`));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- detail

async function loadApp(req, res) {
  const app = /^[0-9a-f-]{36}$/i.test(req.params.id) ? await store.getApplication(req.params.id) : null;
  if (!app) res.status(404).send(page('Not found', '<div class="card"><h1 class="page-title">Application not found</h1><p><a href="/admin">Back to applications</a></p></div>'));
  return app;
}

adminRouter.get('/applications/:id', requireAdmin, async (req, res, next) => {
  try {
    const a = await loadApp(req, res);
    if (!a) return;
    const q = a.qualification || {};
    const dl = (pairs) => `<dl class="dl">${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v || '<span class="meta">—</span>'}</dd>`).join('')}</dl>`;
    const flash = req.query.saved ? '<p class="alert alert-ok" role="status">Changes saved.</p>' : req.query.resent ? '<p class="alert alert-ok" role="status">Team email sent again.</p>' : '';
    const emailWarn = a.team_email_status === 'failed'
      ? `<div class="alert alert-danger" role="alert">The notification email to ${esc(config.teamInbox)} failed: ${esc(a.email_error)}<form method="post" action="/admin/applications/${a.id}/resend"><button class="btn btn-secondary" type="submit">Send again</button></form></div>`
      : '';

    const docs = REQUIRED_DOCUMENTS.map((d) => {
      const f = a.documents?.[d.key];
      return `<li class="doc-row"><div><strong>${esc(d.label)}</strong><div class="meta">${f ? `${esc(f.filename)} · ${KIND_LABELS[f.kind]} · ${Math.max(1, Math.round(f.size / 1024))} KB · ${esc(f.summary)}` : 'Missing'}</div></div>
${f ? `<div class="doc-actions"><a class="btn btn-secondary" href="/admin/applications/${a.id}/documents/${d.key}" target="_blank" rel="noopener">View</a><a class="btn btn-link" href="/admin/applications/${a.id}/documents/${d.key}?download=1">Download</a></div>` : ''}</li>`;
    }).join('');

    const body = `<p class="crumbs"><a href="/admin">Applications</a> / ${esc(a.reference)}</p>
<div class="detail-head"><div><p class="eyebrow">Reference ${esc(a.reference)}</p><h1 class="page-title">${esc(a.title)} ${esc(a.first_name)} ${esc(a.middle_name || '')} ${esc(a.surname)}</h1>
<p class="meta">Submitted ${formatDate(a.created_at)} · team email ${esc(a.team_email_status)} · applicant email ${esc(a.applicant_email_status)}</p></div>
<a class="btn btn-secondary" href="/admin/applications/${a.id}/pdf" target="_blank" rel="noopener">Application PDF</a></div>
${flash}${emailWarn}
<div class="detail-grid"><div class="stack">
<section class="card"><h2 class="card-title">Personal details</h2>${dl([
      ['Date of birth', formatDate(a.date_of_birth)],
      ['Country of birth', esc(a.country_of_birth)],
      ['SA ID number', esc(a.id_number)],
      ['Address', [a.residential_address, a.city, a.province, a.postal_code].map(esc).join('<br>')],
      ['Email', `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>`],
      ['Cell number', esc(a.cell_number)],
      ['Alternative number', esc(a.alternative_number)],
    ])}</section>
<section class="card"><h2 class="card-title">Qualification</h2>${dl([
      ['Qualification', esc(q.qualification)],
      ['Institution', esc(q.institution)],
      ['Field of study', esc(q.field)],
      ['NQF level', `${esc(q.nqf_level)}${Number(q.nqf_level) < 7 ? ' <span class="chip chip-reviewing">Below NQF 7</span>' : ''}`],
      ['Status', `${esc(STUDY_STATUS[q.status])} (${esc(q.year)})`],
    ])}</section>
<section class="card"><h2 class="card-title">Languages</h2><table class="table compact"><thead><tr><th>Language</th><th>Speak</th><th>Read</th><th>Write</th></tr></thead><tbody>${(a.languages || [])
      .map((l) => `<tr><td>${esc(l.language)}</td><td>${l.speak ? 'Yes' : 'No'}</td><td>${l.read ? 'Yes' : 'No'}</td><td>${l.write ? 'Yes' : 'No'}</td></tr>`)
      .join('')}</tbody></table></section>
<section class="card"><h2 class="card-title">Supporting documents</h2><ul class="doc-list">${docs}</ul></section>
<section class="card"><h2 class="card-title">Declaration</h2><p>I, ${esc(a.declaration?.full_name)}, hereby declare that the above and all supporting documents are true and correct.</p>${dl([
      ['Signed at', esc(a.declaration?.signed_at)],
      ['Date', formatDate(a.created_at)],
      ['South African ID', a.declaration?.sa_id ? 'Confirmed' : 'Not confirmed'],
      ['POPIA consent', a.declaration?.popia_consent ? `Given ${formatDate(a.declaration.consented_at)}` : 'Not given'],
    ])}</section>
</div>
<aside><form class="card stack sticky" method="post" action="/admin/applications/${a.id}"><h2 class="card-title">Review</h2>
<label class="field"><span class="label">Status</span><select name="status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${k === a.status ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
<label class="field"><span class="label">Notes</span><textarea name="admin_notes" rows="8" maxlength="5000" placeholder="Internal notes, visible to the Learnership team only">${esc(a.admin_notes)}</textarea></label>
<button class="btn btn-primary" type="submit">Save changes</button></form></aside></div>`;
    res.send(page(a.reference, body));
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/applications/:id', requireAdmin, async (req, res, next) => {
  try {
    const a = await loadApp(req, res);
    if (!a) return;
    const patch = { admin_notes: String(req.body.admin_notes || '').slice(0, 5000) || null };
    if (STATUSES[req.body.status]) patch.status = req.body.status;
    await store.updateApplication(a.id, patch);
    res.redirect(`/admin/applications/${a.id}?saved=1`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/applications/:id/resend', requireAdmin, async (req, res, next) => {
  try {
    const a = await loadApp(req, res);
    if (!a) return;
    const pdf = a.application_pdf_path ? await store.getFile(a.application_pdf_path) : await buildApplicationPdf(a);
    await sendTeamNotification(a, pdf);
    await store.updateApplication(a.id, { team_email_status: 'sent', email_error: null });
    res.redirect(`/admin/applications/${a.id}?resent=1`);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------- files

function sendFile(res, buffer, { contentType, filename, download }) {
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'private, no-store',
    // Uploaded files are only ever PDF, JPG, PNG or DOCX (verified on upload); block
    // scripts regardless. A CSP sandbox would stop Chrome's PDF viewer, so it is not used.
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; object-src 'self'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
}

adminRouter.get('/applications/:id/documents/:key', requireAdmin, async (req, res, next) => {
  try {
    const a = await loadApp(req, res);
    if (!a) return;
    const d = documentByKey(req.params.key);
    const f = d && a.documents?.[d.key];
    if (!f) return res.status(404).send('Document not found');
    const buffer = await store.getFile(f.path);
    sendFile(res, buffer, {
      contentType: MIME_TYPES[f.kind],
      filename: `${a.reference} ${d.label} - ${f.filename}`,
      download: req.query.download === '1' || f.kind === 'docx',
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/applications/:id/pdf', requireAdmin, async (req, res, next) => {
  try {
    const a = await loadApp(req, res);
    if (!a) return;
    const buffer = a.application_pdf_path ? await store.getFile(a.application_pdf_path) : await buildApplicationPdf(a);
    sendFile(res, buffer, { contentType: 'application/pdf', filename: `Learnership application ${a.reference} - ${a.surname}.pdf` });
  } catch (e) {
    next(e);
  }
});

adminRouter.use((err, _req, res, _next) => {
  console.error('Admin error:', err);
  res.status(500).send(page('Error', `<div class="card"><h1 class="page-title">Something went wrong</h1><p>${esc(err.message)}</p><p><a href="/admin">Back to applications</a></p></div>`));
});
