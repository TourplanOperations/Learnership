// Checks that an uploaded supporting document is a real, openable and legible file.
//
// The checks are technical, not content-aware: they confirm the file is the type it
// claims to be, opens without a password, is not blank, and (for scans and photos)
// has enough resolution, contrast and sharpness to be read. They do not confirm that
// the document is the right document; the Learnership team does that on review.

import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { KIND_LABELS } from './documents.js';

const STANDARD_FONTS = path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;

// Thresholds. Tuned against sample scans and phone photos (see test/validate-doc.test.js).
export const LIMITS = {
  minImageShortSide: 600, // px; a phone photo or 150 dpi scan of A5 or larger clears this
  minBrightness: 30, // mean grey level 0-255; below this the image is too dark
  minContrast: 14, // grey-level standard deviation; below this the page is blank or washed out
  minSharpness: 60, // variance of the Laplacian at 1200px; below this text is too blurred
  minPdfTextChars: 40, // letters/digits needed to treat a PDF as a text (non-scanned) document
  minDocxTextChars: 80,
  maxPdfPages: 40,
};

class DocumentRejected extends Error {}

function reject(message) {
  throw new DocumentRejected(message);
}

export function detectKind(buf) {
  if (buf.length < 8) return null;
  if (buf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  // Common formats people try that we do not accept, so we can explain why.
  const head = buf.subarray(0, 12).toString('latin1');
  if (head.includes('ftypheic') || head.includes('ftypheix') || head.includes('ftypmif1')) return 'heic';
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'doc';
  return null;
}

/**
 * Validate a document buffer.
 * @param {Buffer} buf
 * @param {{accept: string[]}} slot  allowed kinds for this document slot
 * @returns {Promise<{ok: true, kind: string, summary: string} | {ok: false, message: string}>}
 */
export async function validateDocument(buf, slot) {
  try {
    let kind = detectKind(buf);
    if (kind === 'zip') kind = (await isDocx(buf)) ? 'docx' : null;

    if (kind === 'heic') reject('iPhone HEIC photos are not supported. Please export the photo as JPG, or set your camera to "Most Compatible", and upload again.');
    if (kind === 'doc') reject('Older Word (.doc) files are not supported. Please save the document as PDF or .docx and upload again.');
    if (!kind) reject(`This file type is not recognised. Please upload ${allowedText(slot.accept)}.`);
    if (!slot.accept.includes(kind)) reject(`${KIND_LABELS[kind]} files are not accepted for this document. Please upload ${allowedText(slot.accept)}.`);

    let summary;
    if (kind === 'pdf') summary = await checkPdf(buf);
    else if (kind === 'docx') summary = await checkDocx(buf);
    else summary = await checkImage(buf, { label: 'image' });

    return { ok: true, kind, summary };
  } catch (err) {
    if (err instanceof DocumentRejected) return { ok: false, message: err.message };
    console.error('Unexpected document validation error:', err);
    return { ok: false, message: 'We could not open this file. It may be damaged. Please try saving or scanning it again.' };
  }
}

function allowedText(kinds) {
  const labels = kinds.map((k) => KIND_LABELS[k]);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}` : labels[0];
}

// ---------------------------------------------------------------- images

async function checkImage(buf, { label, fromPdf = false }) {
  let meta;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    reject(fromPdf ? 'A scanned page inside this PDF could not be read. Please scan the document again.' : 'This image could not be opened. It may be damaged. Please take the photo or scan again.');
  }
  // Account for EXIF rotation when measuring.
  const swap = meta.orientation && meta.orientation >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;
  const shortSide = Math.min(width, height);

  if (shortSide < LIMITS.minImageShortSide) {
    reject(`The ${label} resolution is too low to read (${width} × ${height} pixels). Please upload a clearer scan or photo; at least ${LIMITS.minImageShortSide} pixels on the shortest side.`);
  }

  // Analyse a normalised greyscale copy so thresholds do not depend on camera resolution.
  const base = sharp(buf).rotate().greyscale().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true });
  const stats = await base.clone().stats();
  const { mean, stdev } = stats.channels[0];

  if (mean < LIMITS.minBrightness) reject(`The ${label} is too dark to read. Please retake it in good light.`);
  if (stdev < LIMITS.minContrast) reject(`The ${label} appears to be blank or washed out. Please check you selected the right file, or retake it with less glare.`);

  const sharpness = await laplacianVariance(base);
  if (sharpness < LIMITS.minSharpness) reject(`The ${label} is too blurry to read. Please hold the camera steady, make sure the text is in focus, and try again.`);

  return `${width} × ${height} px, sharpness ${Math.round(sharpness)}`;
}

// Variance of the Laplacian: a standard, cheap focus measure. Sharp text has strong
// edges and a high variance; out-of-focus or motion-blurred photos score low.
async function laplacianVariance(pipeline) {
  const { data } = await pipeline
    .clone()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] - 128;
    sum += v;
    sumSq += v * v;
  }
  const n = data.length;
  const m = sum / n;
  return sumSq / n - m * m;
}

// ---------------------------------------------------------------- PDF

async function checkPdf(buf) {
  let pdf;
  try {
    pdf = await getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
      verbosity: 0,
      standardFontDataUrl: STANDARD_FONTS,
    }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') reject('This PDF is password protected. Please remove the password (or print it to a new PDF) and upload again.');
    reject('This PDF could not be opened. It may be damaged or incomplete. Please save or scan it again.');
  }

  try {
    const pages = pdf.numPages;
    if (pages < 1) reject('This PDF has no pages.');
    if (pages > LIMITS.maxPdfPages) reject(`This PDF has ${pages} pages. Please upload only the relevant pages (up to ${LIMITS.maxPdfPages}).`);

    let textChars = 0;
    for (let i = 1; i <= Math.min(pages, 5); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) textChars += (item.str || '').replace(/[^\p{L}\p{N}]/gu, '').length;
      page.cleanup();
    }
    if (textChars >= LIMITS.minPdfTextChars) return `${pages} page${pages > 1 ? 's' : ''}, text PDF`;

    // No (or almost no) selectable text: treat as a scanned document and check its images.
    const scan = await checkScannedPdf(buf);
    return `${pages} page${pages > 1 ? 's' : ''}, scanned (${scan})`;
  } finally {
    await pdf.destroy();
  }
}

// For scanned PDFs, find the page images and run the same legibility checks used for photos.
async function checkScannedPdf(buf) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  const images = [];
  for (const page of doc.getPages().slice(0, 5)) {
    collectImages(page.node.Resources(), doc, images, 0);
  }
  if (images.length === 0) reject('This PDF appears to be blank: it has no readable text or scanned images. Please check you selected the right file.');

  // Check the largest image (normally the scanned page itself).
  images.sort((a, b) => b.width * b.height - a.width * a.height);
  const main = images[0];
  if (Math.min(main.width, main.height) < LIMITS.minImageShortSide) {
    reject(`The scan inside this PDF is too low resolution to read (${main.width} × ${main.height} pixels). Please rescan at 150 dpi or higher.`);
  }
  const decoded = await decodePdfImage(main);
  if (decoded) {
    await checkImage(decoded, { label: 'scanned page', fromPdf: true });
    return `${main.width} × ${main.height} px, legibility checked`;
  }
  return `${main.width} × ${main.height} px`;
}

function collectImages(resources, doc, out, depth) {
  if (!resources || depth > 3) return;
  const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xobjects) return;
  for (const [, ref] of xobjects.entries()) {
    const obj = doc.context.lookup(ref);
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const subtype = dict.get(PDFName.of('Subtype'))?.toString();
    if (subtype === '/Image') {
      const num = (k) => Number(dict.lookup(PDFName.of(k))?.toString() || 0);
      const filter = dict.lookup(PDFName.of('Filter'));
      const filters = filter instanceof PDFArray ? filter.asArray().map(String) : filter ? [String(filter)] : [];
      out.push({
        width: num('Width'),
        height: num('Height'),
        bits: num('BitsPerComponent'),
        colorSpace: String(dict.lookup(PDFName.of('ColorSpace')) ?? ''),
        filters,
        bytes: obj.contents,
      });
    } else if (subtype === '/Form') {
      collectImages(dict.lookupMaybe(PDFName.of('Resources'), PDFDict), doc, out, depth + 1);
    }
  }
}

// Turn a PDF image stream into something sharp can read, for the common encodings
// produced by scanners and phone scanning apps. Returns null when not decodable here
// (e.g. JBIG2/CCITT black-and-white scans), in which case only resolution is checked.
async function decodePdfImage(img) {
  if (img.filters.length === 1 && img.filters[0] === '/DCTDecode') return Buffer.from(img.bytes);
  if (img.filters.length === 1 && img.filters[0] === '/FlateDecode' && img.bits === 8) {
    const channels = img.colorSpace === '/DeviceRGB' ? 3 : img.colorSpace === '/DeviceGray' ? 1 : 0;
    if (!channels) return null;
    try {
      const raw = zlib.inflateSync(Buffer.from(img.bytes));
      if (raw.length !== img.width * img.height * channels) return null;
      // Re-wrap as PNG so checkImage can treat it like any other upload.
      return sharp(raw, { raw: { width: img.width, height: img.height, channels } }).png().toBuffer();
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------- Word

async function isDocx(buf) {
  try {
    const zip = await JSZip.loadAsync(buf);
    return Boolean(zip.file('word/document.xml'));
  } catch {
    return false;
  }
}

async function checkDocx(buf) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    reject('This Word document could not be opened. Please save it again, or upload it as a PDF.');
  }
  if (zip.file('EncryptionInfo')) reject('This Word document is password protected. Please remove the password and upload again.');
  const xml = await zip.file('word/document.xml').async('string');
  const text = xml.replace(/<w:tab\/>|<\/w:p>/g, ' ').replace(/<[^>]+>/g, '');
  const chars = text.replace(/[^\p{L}\p{N}]/gu, '').length;
  if (chars < LIMITS.minDocxTextChars) reject('This Word document appears to be empty. Please check you selected the right file.');
  return `Word document, ${text.trim().split(/\s+/).length} words`;
}
