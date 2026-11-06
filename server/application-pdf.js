// Builds the completed application form as a PDF, laid out in the Tourplan document
// style: black header band with the logo, crimson eyebrow, bold title, numbered sections.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { REQUIRED_DOCUMENTS, KIND_LABELS } from './documents.js';
import { STUDY_STATUS } from './application-schema.js';

const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets-logo.png');
const CRIMSON = '#BA0C2F';
const INK = '#111111';
const MUTED = '#6B6A68';
const RULE = '#D9D9D9';

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg' });
}

export function buildApplicationPdf(app) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 60, left: 50, right: 50 },
      info: { Title: `Learnership application ${app.reference}`, Author: 'Tourplan Learnership portal' },
      bufferPages: true,
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const left = 50;
    const contentW = W - 100;

    // Header band
    doc.rect(0, 0, W, 90).fill('#000000');
    doc.image(LOGO, left, 32, { height: 26 });
    doc.fillColor('#FFFFFF').font('Helvetica').fontSize(9).text('IT Solutions for the Tourism Sector', left, 40, { width: contentW, align: 'right' });

    doc.y = 120;
    doc.fillColor(CRIMSON).font('Helvetica-Bold').fontSize(9).text(`LEARNERSHIP APPLICATION ${app.intake_year}`, left, doc.y, { characterSpacing: 1 });
    doc.moveDown(0.3);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(`${app.first_name} ${app.surname}`);
    doc.moveDown(0.2);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(`Reference ${app.reference}  ·  Submitted ${formatDate(app.created_at)}`);
    doc.moveDown(1);

    let n = 0;
    const section = (title) => {
      if (doc.y > doc.page.height - 160) doc.addPage();
      n++;
      doc.moveDown(0.6);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(`${n}. ${title}`, left);
      const y = doc.y + 4;
      doc.moveTo(left, y).lineTo(left + contentW, y).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.y = y + 8;
    };
    const row = (label, value) => {
      const y = doc.y;
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(label, left, y, { width: 150 });
      doc.fillColor(INK).font('Helvetica').fontSize(10).text(value || '—', left + 160, y, { width: contentW - 160 });
      doc.y = Math.max(doc.y, y) + 5;
    };

    section('Personal details');
    row('Title', app.title);
    row('Surname', app.surname);
    row('First name', app.first_name);
    row('Middle name', app.middle_name);
    row('Date of birth', formatDate(app.date_of_birth));
    row('Country of birth', app.country_of_birth);
    row('Residential address', [app.residential_address, app.city, app.province, app.postal_code].filter(Boolean).join('\n'));
    row('Email address', app.email);
    row('Cell number', app.cell_number);
    row('Alternative number', app.alternative_number);

    section('Qualification');
    const q = app.qualification;
    row('Qualification', q.qualification);
    row('Institution', q.institution);
    row('Field of study', q.field);
    row('NQF level', q.nqf_level);
    row('Status', `${STUDY_STATUS[q.status]} (${q.year})`);

    section('Languages');
    const cols = [left, left + 220, left + 300, left + 380];
    const head = doc.y;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9);
    ['Language', 'Speak', 'Read', 'Write'].forEach((h, i) => doc.text(h, cols[i], head));
    doc.y = head + 16;
    for (const l of app.languages) {
      const y = doc.y;
      doc.fillColor(INK).font('Helvetica').fontSize(10).text(l.language, cols[0], y, { width: 210 });
      [l.speak, l.read, l.write].forEach((v, i) => doc.text(v ? 'Yes' : 'No', cols[i + 1], y));
      doc.y = y + 16;
    }

    section('Supporting documents');
    for (const d of REQUIRED_DOCUMENTS) {
      const f = app.documents[d.key];
      row(d.label, f ? `Submitted: ${f.filename} (${KIND_LABELS[f.kind]}, ${Math.max(1, Math.round(f.size / 1024))} KB)\nReadability check passed: ${f.summary}` : 'Not submitted');
    }

    section('Declaration');
    const dec = app.declaration;
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(
      `I, ${dec.full_name}, hereby declare that the above and all supporting documents are true and correct.`,
      left, doc.y, { width: contentW },
    );
    doc.moveDown(0.6);
    row('Full name', dec.full_name);
    row('Signed at', dec.signed_at);
    row('Date', formatDate(app.created_at));
    row('Signature', `Signed electronically by ${dec.full_name} on submission`);
    row('South African ID', dec.sa_id ? 'Confirmed holds a valid South African ID' : 'Not confirmed');
    row('POPIA consent', `Given on ${formatDate(dec.consented_at)}`);

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would otherwise make pdfkit add a new page.
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 40;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text('Confidential. Contains personal information processed under POPIA for the Tourplan Learnership selection process.', left, y, { width: contentW - 60, lineBreak: false })
        .text(`Page ${i + 1} of ${range.count}`, left, y, { width: contentW, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
