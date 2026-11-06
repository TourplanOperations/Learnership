// Generates sample documents (good and bad) for the validator tests.
// All content is invented sample text; no real personal data.

import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';

const LINES = [
  'NATIONAL SENIOR CERTIFICATE',
  'This is to certify that SAMPLE LEARNER',
  'has satisfied the requirements for the award of the',
  'National Senior Certificate with admission to Bachelor studies.',
  'English Home Language 72%   Mathematics 68%   Life Orientation 81%',
  'Accounting 64%   Business Studies 70%   Geography 66%',
  'Certificate number 0000000000   Issued Pretoria',
];

function documentSvg(width, height) {
  const fs = Math.round(width / 40);
  const text = LINES.map(
    (l, i) => `<text x="${width * 0.08}" y="${height * 0.18 + i * fs * 2.1}" font-family="Helvetica, Arial" font-size="${fs}" fill="#111">${l}</text>`,
  ).join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f7f5ee"/>` +
      `<rect x="${width * 0.04}" y="${height * 0.05}" width="${width * 0.92}" height="${height * 0.9}" fill="none" stroke="#333" stroke-width="4"/>${text}</svg>`,
  );
}

export async function sharpPhoto(w = 1700, h = 1200) {
  return sharp(documentSvg(w, h)).jpeg({ quality: 85 }).toBuffer();
}
export async function blurryPhoto() {
  return sharp(documentSvg(1700, 1200)).blur(5).jpeg({ quality: 85 }).toBuffer();
}
export async function slightlySoftPhoto() {
  return sharp(documentSvg(1700, 1200)).blur(1.2).jpeg({ quality: 80 }).toBuffer();
}
export async function phonePhoto4k() {
  // Large phone photo with mild softness and sensor noise.
  const noise = await sharp({ create: { width: 4000, height: 3000, channels: 3, noise: { type: 'gaussian', mean: 0, sigma: 6 } } }).png().toBuffer();
  return sharp(documentSvg(4000, 3000)).blur(1.5).composite([{ input: noise, blend: 'soft-light' }]).jpeg({ quality: 82 }).toBuffer();
}
export async function darkPhoto() {
  return sharp(documentSvg(1700, 1200)).linear(0.1, 0).jpeg().toBuffer();
}
export async function blankPhoto() {
  return sharp({ create: { width: 1700, height: 1200, channels: 3, background: '#fbfbfb' } }).jpeg().toBuffer();
}
export async function tinyPhoto() {
  return sharp(documentSvg(500, 350)).png().toBuffer();
}

function pdfToBuffer(build, opts = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', ...opts });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    build(doc);
    doc.end();
  });
}

export function textPdf() {
  return pdfToBuffer((d) => LINES.forEach((l) => d.fontSize(14).text(l)));
}
export function encryptedPdf() {
  return pdfToBuffer((d) => d.text(LINES.join(' ')), { userPassword: 'secret', ownerPassword: 'owner' });
}
export function blankPdf() {
  return pdfToBuffer(() => {});
}
export async function scannedPdf(img) {
  const jpg = img ?? (await sharpPhoto(1240, 1754));
  return pdfToBuffer((d) => d.image(jpg, 0, 0, { width: 595, height: 842 }));
}
export async function blurryScannedPdf() {
  const jpg = await sharp(documentSvg(1240, 1754)).blur(5).jpeg().toBuffer();
  return scannedPdf(jpg);
}
export async function lowResScannedPdf() {
  const jpg = await sharp(documentSvg(400, 566)).jpeg().toBuffer();
  return scannedPdf(jpg);
}

export async function docx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
