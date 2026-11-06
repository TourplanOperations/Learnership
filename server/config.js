// Central configuration, read once from environment variables.
// See .env.example for descriptions of every setting.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

function bool(v, fallback = false) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

export const config = {
  port: Number(env.PORT || 3000),
  isProduction: env.NODE_ENV === 'production',
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),

  intakeYear: Number(env.INTAKE_YEAR || 2027),
  // Applications are accepted between these instants (SAST = UTC+2).
  opensAt: new Date(env.APPLICATIONS_OPEN_AT || '2026-11-01T00:00:00+02:00'),
  closesAt: new Date(env.APPLICATIONS_CLOSE_AT || '2027-01-08T23:59:59+02:00'),

  // Supabase. When SUPABASE_URL is not set the portal runs in local mode:
  // applications are written to ./local-data instead (development only).
  supabaseUrl: env.SUPABASE_URL || '',
  supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
  storageBucket: env.SUPABASE_BUCKET || 'learnership-documents',

  // Email. Preferred: Microsoft Graph (Microsoft 365 with modern authentication), used
  // when the three GRAPH_* settings are present. Otherwise SMTP (Resend, SendGrid, ...).
  // With neither, emails are written to ./local-data/outbox as .eml files.
  graph: {
    tenantId: env.GRAPH_TENANT_ID || '',
    clientId: env.GRAPH_CLIENT_ID || '',
    clientSecret: env.GRAPH_CLIENT_SECRET || '',
    // Mailbox the app sends as; defaults to the address in MAIL_FROM.
    sender: env.GRAPH_SENDER || '',
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },
  mailFrom: env.MAIL_FROM || 'Tourplan Learnership <tourplanafrica@tourplan.africa>',
  teamInbox: env.TEAM_INBOX || 'Learnership.Applications@tourplan.com',
  sendApplicantConfirmation: bool(env.SEND_APPLICANT_CONFIRMATION, true),

  // Admin review page.
  adminPassword: env.ADMIN_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me',

  // Upload limits.
  maxFileBytes: Number(env.MAX_FILE_MB || 10) * 1024 * 1024,
};

export const usingSupabase = Boolean(config.supabaseUrl && config.supabaseServiceKey);
export const usingGraph = Boolean(config.graph.tenantId && config.graph.clientId && config.graph.clientSecret);
export const usingSmtp = !usingGraph && Boolean(config.smtp.host);
export const mailMode = usingGraph ? 'graph' : usingSmtp ? 'smtp' : 'local';

export function applicationWindow(now = new Date()) {
  if (now < config.opensAt) return 'not_open';
  if (now > config.closesAt) return 'closed';
  return 'open';
}

if (config.isProduction) {
  const missing = [];
  if (!usingSupabase) missing.push('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  if (mailMode === 'local') missing.push('GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET (or SMTP_HOST)');
  if (!config.adminPassword) missing.push('ADMIN_PASSWORD');
  if (config.sessionSecret === 'dev-only-secret-change-me') missing.push('SESSION_SECRET');
  if (missing.length) {
    console.error(`Missing required production settings: ${missing.join(', ')}`);
    process.exit(1);
  }
}
