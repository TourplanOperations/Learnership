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

  // Email (SMTP). Works with Microsoft 365, Resend, SendGrid, etc.
  // When SMTP_HOST is not set, emails are written to ./local-data/outbox as .eml files.
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },
  mailFrom: env.MAIL_FROM || 'Tourplan Learnership <learnership.applications@tourplan.com>',
  teamInbox: env.TEAM_INBOX || 'Learnership.Applications@tourplan.com',
  sendApplicantConfirmation: bool(env.SEND_APPLICANT_CONFIRMATION, true),

  // Admin review page.
  adminPassword: env.ADMIN_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me',

  // Upload limits.
  maxFileBytes: Number(env.MAX_FILE_MB || 10) * 1024 * 1024,
};

export const usingSupabase = Boolean(config.supabaseUrl && config.supabaseServiceKey);
export const usingSmtp = Boolean(config.smtp.host);

export function applicationWindow(now = new Date()) {
  if (now < config.opensAt) return 'not_open';
  if (now > config.closesAt) return 'closed';
  return 'open';
}

if (config.isProduction) {
  const missing = [];
  if (!usingSupabase) missing.push('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  if (!usingSmtp) missing.push('SMTP_HOST');
  if (!config.adminPassword) missing.push('ADMIN_PASSWORD');
  if (config.sessionSecret === 'dev-only-secret-change-me') missing.push('SESSION_SECRET');
  if (missing.length) {
    console.error(`Missing required production settings: ${missing.join(', ')}`);
    process.exit(1);
  }
}
