# Tourplan Learnership application portal

Online application portal for the Tourplan Africa Learnership (2027 intake). Applicants read about the programme, complete the enrolment form and upload their five supporting documents. Each document is checked for readability as soon as it is attached, and the form can only be submitted once all five have passed.

On submission the application is stored in Supabase, a PDF of the completed form is generated, and an email goes to Learnership.Applications@tourplan.com with the PDF attached and secure links to each document. The applicant receives a confirmation email with their reference number. The Learnership team reviews applications on the password-protected admin page at `/admin`.

## How it works

| Part | Where |
| --- | --- |
| Public page and form | `public/` (plain HTML, CSS and JavaScript, no build step) |
| Web server and API | `server/index.js` (Node.js 22+, Express) |
| Document readability checks | `server/validate-doc.js` |
| Completed-form PDF | `server/application-pdf.js` |
| Emails | `server/mail.js` (SMTP) |
| Admin review pages | `server/admin.js` |
| Database and file storage | `server/store.js`, schema in `supabase/schema.sql` |
| Hosting | `render.yaml` (Render Blueprint) |

### Document checks

Every upload is checked on the server before it is accepted:

- **File type** is detected from the file contents, not the name. PDF, JPG and PNG are accepted for all documents; the CV may also be a Word (.docx) file. iPhone HEIC photos and old .doc files get a specific message explaining how to convert them.
- **Opens correctly**: corrupt files, password-protected PDFs and Word files, and empty documents are rejected.
- **Photos and scans** must be at least 600 pixels on the shortest side and pass brightness (not too dark), contrast (not blank or washed out) and sharpness (not blurred) checks.
- **Scanned PDFs** (no selectable text) have their page image extracted and put through the same photo checks.
- **Size limit** is 10 MB per file (`MAX_FILE_MB`).

The checks confirm a document is legible, not that it is the right document. The team still confirms that on review. The thresholds are in `LIMITS` at the top of `server/validate-doc.js`, and `npm test` runs them against good and bad sample files.

### Security and POPIA

- Supabase is accessed only by the server with the service role key. Row-level security is on with no policies, so the public key has no access, and the storage bucket is private.
- Document links in the team email open the admin page, which needs the admin password. Documents are never available on public URLs.
- Upload tokens are signed, so a submission can only reference files that passed the check for that document slot.
- One application per email address per intake. Rate limiting and a hidden honeypot field deter spam.
- Applicants must give POPIA consent before submitting, and the consent time is stored.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). Choose a region close to South Africa (for example Frankfurt or London) unless Tourplan policy needs otherwise.
2. Open **SQL Editor**, paste in `supabase/schema.sql` and run it. This creates the `applications` table and the private `learnership-documents` bucket.
3. From **Project Settings > API**, copy the **Project URL** and the **service_role** key. The service role key is a secret: only put it in Render, never in the page code.

### 2. Email (SMTP)

The portal sends mail over SMTP. Pick one option:

- **Microsoft 365**: use a mailbox such as `learnership.applications@tourplan.com` with Authenticated SMTP enabled for it (Microsoft 365 admin centre > user > Mail > Manage email apps). Host `smtp.office365.com`, port `587`, `SMTP_SECURE=false`, and that mailbox's username and password (or an app password).
- **Resend or SendGrid**: create an API key, verify the `tourplan.com` sending domain (DNS records added by IT), then use the SMTP settings in `.env.example`.

`MAIL_FROM` must be an address the mail service is allowed to send as.

### 3. GitHub and Render

1. Push this folder to a GitHub repository. `.gitignore` already excludes `node_modules`, `.env` and `local-data`.
2. In Render, choose **New > Blueprint**, select the repository and apply `render.yaml`. It creates a web service on the Starter plan in Frankfurt. The free plan sleeps when idle, which makes the first visit slow, so it is not recommended for a live application period.
3. Fill in the environment variables Render asks for:
   - `PUBLIC_BASE_URL`: the service URL, for example `https://tourplan-learnership-portal.onrender.com`, or a custom domain such as `https://learnership.tourplan.com`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
   - `ADMIN_PASSWORD`: a strong password shared with the Learnership selection team
   - `SESSION_SECRET` is generated automatically.
4. Optionally add a custom domain under the service's **Settings > Custom Domains** and update `PUBLIC_BASE_URL`.

In production the server refuses to start if Supabase, SMTP, the admin password or the session secret is missing.

### 4. Check it

1. Submit a test application with your own documents.
2. Confirm the email arrives at Learnership.Applications@tourplan.com with the PDF, and the confirmation reaches the applicant address.
3. Sign in at `/admin`, open the application, view each document, then set its status to **Withdrawn** (or delete the row in Supabase).

## Running locally

```bash
npm install
cp .env.example .env   # set ADMIN_PASSWORD; leave Supabase and SMTP blank
npm run dev            # http://localhost:3000
npm test               # document-check tests
```

Without Supabase and SMTP settings, applications are saved to `local-data/` and emails are written to `local-data/outbox/` as `.eml` files, so nothing leaves your machine.

## Changing things for the next intake

- Dates: `INTAKE_YEAR`, `APPLICATIONS_OPEN_AT`, `APPLICATIONS_CLOSE_AT` (environment variables), and the dates and stipend in `public/index.html`.
- Required documents: `server/documents.js`.
- Form fields: `public/index.html`, `server/application-schema.js`, and the matching column in `supabase/schema.sql`.
- Email wording: `server/mail.js`.
