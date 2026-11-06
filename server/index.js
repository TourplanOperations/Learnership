import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, usingSupabase, mailMode, applicationWindow } from './config.js';
import { REQUIRED_DOCUMENTS, documentByKey, EXTENSIONS, MIME_TYPES } from './documents.js';
import { validateDocument } from './validate-doc.js';
import { applicationSchema, formatIssues, TITLES, PROVINCES, FIELDS_OF_STUDY, NQF_LEVELS, STUDY_STATUS } from './application-schema.js';
import { store, DuplicateApplicationError } from './store.js';
import { buildApplicationPdf } from './application-pdf.js';
import { sendTeamNotification, sendApplicantConfirmation } from './mail.js';
import { adminRouter } from './admin.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();

app.set('trust proxy', 1); // Render terminates TLS in front of the app
app.disable('x-powered-by');
app.use(
  helmet({
    // "no-referrer" (helmet's default) makes browsers send `Origin: null` on form posts,
    // which would break the admin pages' cross-site POST check.
    referrerPolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        frameSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
  }),
);

// ---------------------------------------------------------------- upload tokens
// After a document passes the readability check it is stored under pending/ and the
// browser receives a signed token describing it. The submission then presents the
// tokens, so files are uploaded and checked once, and cannot be swapped afterwards.

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const sign = (data) => crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url');

function issueToken(payload) {
  const data = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  return `${data}.${sign(data)}`;
}

function readToken(token, expectedKey) {
  const [data, mac] = String(token).split('.');
  if (!data || !mac) return null;
  const expected = sign(data);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  if (payload.key !== expectedKey || Date.now() - payload.iat > TOKEN_TTL_MS) return null;
  return payload;
}

function cleanFilename(name, kind) {
  const base = path.basename(Buffer.from(name || '', 'latin1').toString('utf8')).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '').trim();
  return (base || `document.${EXTENSIONS[kind]}`).slice(0, 120);
}

// ---------------------------------------------------------------- public API

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: config.isProduction ? '1h' : 0 }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => {
  res.json({
    intakeYear: config.intakeYear,
    window: applicationWindow(),
    opensAt: config.opensAt,
    closesAt: config.closesAt,
    maxFileMb: config.maxFileBytes / 1024 / 1024,
    documents: REQUIRED_DOCUMENTS,
    options: { titles: TITLES, provinces: PROVINCES, fields: FIELDS_OF_STUDY, nqfLevels: NQF_LEVELS, studyStatus: STUDY_STATUS },
    teamInbox: config.teamInbox,
  });
});

const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: 1, fields: 5 } });

function closedResponse(res) {
  const w = applicationWindow();
  return res.status(403).json({
    error: w === 'closed' ? 'Applications for this intake have closed.' : 'Applications are not open yet.',
  });
}

app.post('/api/documents/:key', uploadLimiter, (req, res) => {
  const slot = documentByKey(req.params.key);
  if (!slot) return res.status(404).json({ error: 'Unknown document.' });
  if (applicationWindow() !== 'open') return closedResponse(res);

  upload.single('file')(req, res, async (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `This file is larger than ${config.maxFileBytes / 1024 / 1024} MB. Please reduce its size (for example scan at 150 to 200 dpi) and upload again.` });
    }
    if (err) return res.status(400).json({ error: 'The upload failed. Please try again.' });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Please choose a file to upload.' });

    const result = await validateDocument(req.file.buffer, slot);
    if (!result.ok) return res.status(422).json({ error: result.message });

    try {
      const id = crypto.randomUUID();
      const filePath = `pending/${id}.${EXTENSIONS[result.kind]}`;
      await store.putFile(filePath, req.file.buffer, MIME_TYPES[result.kind]);
      const filename = cleanFilename(req.file.originalname, result.kind);
      const token = issueToken({ key: slot.key, path: filePath, kind: result.kind, size: req.file.size, filename, summary: result.summary });
      res.json({ token, filename, kind: result.kind, size: req.file.size, summary: result.summary });
    } catch (e) {
      console.error('Storing pending upload failed:', e);
      res.status(500).json({ error: 'We could not save this file just now. Please try again in a moment.' });
    }
  });
});

function newReference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  return `TPL${String(config.intakeYear).slice(-2)}-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

app.post('/api/applications', submitLimiter, express.json({ limit: '64kb' }), async (req, res) => {
  if (applicationWindow() !== 'open') return closedResponse(res);

  const parsed = applicationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please correct the highlighted fields.', issues: formatIssues(parsed.error) });
  const form = parsed.data;
  if (form.website) return res.status(400).json({ error: 'Submission rejected.' });

  // Every required document must carry a valid upload token.
  const docs = {};
  const missing = [];
  for (const d of REQUIRED_DOCUMENTS) {
    const t = readToken(form.documents[d.key], d.key);
    if (t) docs[d.key] = t;
    else missing.push({ path: `documents.${d.key}`, message: `${d.label}: please upload this document again.` });
  }
  if (missing.length) return res.status(400).json({ error: 'Some documents need to be uploaded again.', issues: missing });

  try {
    if (await store.emailExists(form.email, config.intakeYear)) {
      return res.status(409).json({
        error: `An application has already been submitted with this email address. If you need to update it, please email ${config.teamInbox}.`,
        issues: [{ path: 'email', message: 'An application with this email address already exists.' }],
      });
    }

    const reference = newReference();
    const documents = {};
    for (const [key, t] of Object.entries(docs)) {
      const finalPath = `applications/${reference}/${key}.${EXTENSIONS[t.kind]}`;
      await store.moveFile(t.path, finalPath);
      documents[key] = { path: finalPath, filename: t.filename, kind: t.kind, size: t.size, summary: t.summary };
    }

    const { documents: _tokens, website: _hp, ...fields } = form;
    const saved = await store.insertApplication({
      ...fields,
      reference,
      intake_year: config.intakeYear,
      documents,
      declaration: { ...form.declaration, consented_at: new Date().toISOString() },
    });

    // Respond as soon as the application is safely stored; the PDF and emails follow.
    res.status(201).json({ reference, firstName: saved.first_name, email: saved.email });
    finaliseApplication(saved).catch((e) => console.error(`Finalising ${reference} failed:`, e));
  } catch (e) {
    if (e instanceof DuplicateApplicationError) {
      return res.status(409).json({ error: `An application has already been submitted with this email address. If you need to update it, please email ${config.teamInbox}.` });
    }
    console.error('Submitting application failed:', e);
    res.status(500).json({ error: 'Something went wrong while saving your application. Your documents are still attached; please try submitting again in a few minutes.' });
  }
});

export async function finaliseApplication(saved) {
  const pdf = await buildApplicationPdf(saved);
  const pdfPath = `applications/${saved.reference}/application-${saved.reference}.pdf`;
  await store.putFile(pdfPath, pdf, 'application/pdf');
  const patch = { application_pdf_path: pdfPath };

  try {
    await sendTeamNotification({ ...saved, ...patch }, pdf);
    patch.team_email_status = 'sent';
  } catch (e) {
    console.error(`Team email for ${saved.reference} failed:`, e);
    patch.team_email_status = 'failed';
    patch.email_error = String(e.message || e).slice(0, 500);
  }

  if (config.sendApplicantConfirmation) {
    try {
      await sendApplicantConfirmation(saved);
      patch.applicant_email_status = 'sent';
    } catch (e) {
      console.error(`Applicant email for ${saved.reference} failed:`, e);
      patch.applicant_email_status = 'failed';
      patch.email_error = [patch.email_error, String(e.message || e)].filter(Boolean).join(' | ').slice(0, 500);
    }
  } else {
    patch.applicant_email_status = 'skipped';
  }
  await store.updateApplication(saved.id, patch);
}

// ---------------------------------------------------------------- admin

app.use('/admin', adminRouter);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).sendFile(path.join(ROOT, 'public', 'index.html'));
});

// Clear abandoned uploads (documents checked but never submitted) once an hour.
async function cleanup() {
  try {
    const n = await store.cleanupPending();
    if (n) console.log(`Removed ${n} abandoned upload(s).`);
  } catch (e) {
    console.error('Pending upload cleanup failed:', e.message);
  }
}
setInterval(cleanup, 60 * 60 * 1000).unref();
cleanup();

app.listen(config.port, () => {
  console.log(`Learnership portal on ${config.publicBaseUrl} (port ${config.port})`);
  console.log(`  storage: ${usingSupabase ? 'Supabase' : 'LOCAL ./local-data (development)'}`);
  console.log(`  email:   ${mailMode === 'graph' ? `Microsoft Graph as ${config.graph.sender || config.mailFrom}` : mailMode === 'smtp' ? `SMTP ${config.smtp.host}` : 'LOCAL ./local-data/outbox (development)'}`);
  console.log(`  window:  ${applicationWindow()} (closes ${config.closesAt.toISOString()})`);
  if (!config.adminPassword) console.log('  admin:   ADMIN_PASSWORD not set; admin pages disabled');
});
