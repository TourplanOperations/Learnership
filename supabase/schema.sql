-- Tourplan Learnership application portal: Supabase schema.
-- Run once in the Supabase SQL editor (Project > SQL Editor > New query).

create extension if not exists pgcrypto;

create table if not exists public.applications (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique,
  intake_year           int  not null,
  created_at            timestamptz not null default now(),
  status                text not null default 'new'
                        check (status in ('new', 'reviewing', 'shortlisted', 'interview', 'offered', 'unsuccessful', 'withdrawn')),

  -- Personal details (as on the application form)
  title                 text not null,
  surname               text not null,
  first_name            text not null,
  middle_name           text,
  date_of_birth         date not null,
  country_of_birth      text not null,
  residential_address   text not null,
  city                  text not null,
  province              text not null,
  postal_code           text not null,
  email                 text not null,
  cell_number           text not null,
  alternative_number    text,

  -- [{ "language": "English", "speak": true, "read": true, "write": true }, ...]
  languages             jsonb not null default '[]'::jsonb,
  -- { "qualification": "...", "institution": "...", "field": "IT", "nqf_level": "7", "status": "completed", "year": 2025 }
  qualification         jsonb not null default '{}'::jsonb,
  -- { "matric": { "path": "...", "filename": "...", "kind": "pdf", "size": 12345, "summary": "..." }, ... }
  documents             jsonb not null default '{}'::jsonb,
  -- { "full_name": "...", "signed_at": "Boksburg", "date": "2026-11-06", "sa_id": true, "declared": true, "popia_consent": true, "consented_at": "..." }
  declaration           jsonb not null default '{}'::jsonb,

  application_pdf_path  text,
  team_email_status     text not null default 'pending',  -- pending | sent | failed
  applicant_email_status text not null default 'pending', -- pending | sent | failed | skipped
  email_error           text,
  admin_notes           text
);

-- One application per email address per intake.
create unique index if not exists applications_intake_email_key
  on public.applications (intake_year, lower(email));
create index if not exists applications_created_at_idx on public.applications (created_at desc);

-- Lock the table down: only the server (service role key) can read or write.
-- No policies are created, so the public anon key has no access at all.
alter table public.applications enable row level security;

-- Private storage bucket for supporting documents (10 MB per file).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'learnership-documents', 'learnership-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;
