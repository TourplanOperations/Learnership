// Persistence: application records and document files.
//
// Production uses Supabase (Postgres table `applications` + private Storage bucket).
// When Supabase is not configured, a local JSON file and folder under ./local-data are
// used instead so the portal can be run and tested on a laptop.

import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from './config.js';
import { createClient } from '@supabase/supabase-js';
import { config, usingSupabase } from './config.js';

const LOCAL_ROOT = path.join(PROJECT_ROOT, 'local-data');
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class DuplicateApplicationError extends Error {}

// ---------------------------------------------------------------- Supabase

function supabaseStore() {
  const sb = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = () => sb.storage.from(config.storageBucket);

  const check = ({ data, error }, what) => {
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  };

  return {
    mode: 'supabase',

    async putFile(filePath, buffer, contentType) {
      check(await bucket().upload(filePath, buffer, { contentType, upsert: true }), `Upload ${filePath}`);
    },
    async moveFile(from, to) {
      check(await bucket().move(from, to), `Move ${from}`);
    },
    async getFile(filePath) {
      const blob = check(await bucket().download(filePath), `Download ${filePath}`);
      return Buffer.from(await blob.arrayBuffer());
    },
    async cleanupPending() {
      const items = check(await bucket().list('pending', { limit: 1000 }), 'List pending');
      const old = items
        .filter((i) => i.created_at && Date.now() - new Date(i.created_at).getTime() > PENDING_MAX_AGE_MS)
        .map((i) => `pending/${i.name}`);
      if (old.length) check(await bucket().remove(old), 'Remove pending');
      return old.length;
    },

    async emailExists(email, intakeYear) {
      const { count, error } = await sb
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('intake_year', intakeYear)
        .ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`));
      if (error) throw new Error(`Duplicate check: ${error.message}`);
      return count > 0;
    },
    async insertApplication(row) {
      const { data, error } = await sb.from('applications').insert(row).select().single();
      if (error?.code === '23505') throw new DuplicateApplicationError('duplicate');
      if (error) throw new Error(`Insert application: ${error.message}`);
      return data;
    },
    async updateApplication(id, patch) {
      check(await sb.from('applications').update(patch).eq('id', id), 'Update application');
    },
    async getApplication(id) {
      const { data, error } = await sb.from('applications').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(`Get application: ${error.message}`);
      return data;
    },
    async listApplications({ intakeYear, status, search } = {}) {
      let q = sb
        .from('applications')
        .select('id, reference, created_at, status, title, first_name, surname, email, cell_number, qualification, team_email_status')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (intakeYear) q = q.eq('intake_year', intakeYear);
      if (status) q = q.eq('status', status);
      if (search) {
        const s = search.replace(/[,%()\\]/g, ' ').trim();
        if (s) q = q.or(`surname.ilike.%${s}%,first_name.ilike.%${s}%,email.ilike.%${s}%,reference.ilike.%${s}%`);
      }
      return check(await q, 'List applications');
    },
  };
}

// ---------------------------------------------------------------- Local (development)

function localStore() {
  const dbFile = path.join(LOCAL_ROOT, 'applications.json');
  const fileRoot = path.join(LOCAL_ROOT, 'storage');
  const safe = (p) => {
    const full = path.resolve(fileRoot, p);
    if (!full.startsWith(fileRoot + path.sep)) throw new Error('Invalid path');
    return full;
  };
  const readDb = async () => JSON.parse(await fs.readFile(dbFile, 'utf8').catch(() => '[]'));
  const writeDb = async (rows) => {
    await fs.mkdir(LOCAL_ROOT, { recursive: true });
    await fs.writeFile(dbFile, JSON.stringify(rows, null, 2));
  };

  return {
    mode: 'local',

    async putFile(p, buffer) {
      const full = safe(p);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, buffer);
    },
    async moveFile(from, to) {
      const dest = safe(to);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(safe(from), dest);
    },
    async getFile(p) {
      return fs.readFile(safe(p));
    },
    async cleanupPending() {
      const dir = path.join(fileRoot, 'pending');
      const names = await fs.readdir(dir).catch(() => []);
      let removed = 0;
      for (const n of names) {
        const st = await fs.stat(path.join(dir, n));
        if (Date.now() - st.mtimeMs > PENDING_MAX_AGE_MS) {
          await fs.rm(path.join(dir, n));
          removed++;
        }
      }
      return removed;
    },

    async emailExists(email, intakeYear) {
      return (await readDb()).some((r) => r.intake_year === intakeYear && r.email.toLowerCase() === email.toLowerCase());
    },
    async insertApplication(row) {
      const rows = await readDb();
      if (rows.some((r) => r.intake_year === row.intake_year && r.email.toLowerCase() === row.email.toLowerCase())) {
        throw new DuplicateApplicationError('duplicate');
      }
      const saved = { id: crypto.randomUUID(), created_at: new Date().toISOString(), status: 'new', ...row };
      rows.push(saved);
      await writeDb(rows);
      return saved;
    },
    async updateApplication(id, patch) {
      const rows = await readDb();
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows[i] = { ...rows[i], ...patch };
      await writeDb(rows);
    },
    async getApplication(id) {
      return (await readDb()).find((r) => r.id === id) ?? null;
    },
    async listApplications({ intakeYear, status, search } = {}) {
      const s = (search || '').toLowerCase();
      return (await readDb())
        .filter((r) => !intakeYear || r.intake_year === intakeYear)
        .filter((r) => !status || r.status === status)
        .filter((r) => !s || [r.surname, r.first_name, r.email, r.reference].some((v) => (v || '').toLowerCase().includes(s)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
  };
}

export const store = usingSupabase ? supabaseStore() : localStore();
