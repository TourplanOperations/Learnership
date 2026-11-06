import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../server/validate-doc.js';
import * as fx from './fixtures.js';

const ANY = { accept: ['pdf', 'jpeg', 'png'] };
const CV = { accept: ['pdf', 'docx'] };

async function expectOk(buf, slot = ANY) {
  const r = await validateDocument(await buf, slot);
  assert.equal(r.ok, true, r.message);
  return r;
}
async function expectRejected(buf, pattern, slot = ANY) {
  const r = await validateDocument(await buf, slot);
  assert.equal(r.ok, false, `expected rejection, got ok (${r.summary})`);
  assert.match(r.message, pattern);
  return r;
}

test('accepts a clear photo', () => expectOk(fx.sharpPhoto()));
test('accepts a slightly soft photo', () => expectOk(fx.slightlySoftPhoto()));
test('accepts a large noisy phone photo', () => expectOk(fx.phonePhoto4k()));
test('rejects a blurry photo', () => expectRejected(fx.blurryPhoto(), /blurry/));
test('rejects a dark photo', () => expectRejected(fx.darkPhoto(), /dark/));
test('rejects a blank image', () => expectRejected(fx.blankPhoto(), /blank/));
test('rejects a tiny image', () => expectRejected(fx.tinyPhoto(), /resolution/));

test('accepts a text PDF', () => expectOk(fx.textPdf()));
test('accepts a clear scanned PDF', () => expectOk(fx.scannedPdf()));
test('rejects a blurry scanned PDF', () => expectRejected(fx.blurryScannedPdf(), /blurry/));
test('rejects a low-resolution scanned PDF', () => expectRejected(fx.lowResScannedPdf(), /resolution/));
test('rejects a password-protected PDF', () => expectRejected(fx.encryptedPdf(), /password/));
test('rejects a blank PDF', () => expectRejected(fx.blankPdf(), /blank/));
test('rejects a corrupt PDF', async () => {
  const buf = (await fx.textPdf()).subarray(0, 400);
  await expectRejected(buf, /could not be opened|blank/);
});

test('accepts a Word CV', () => expectOk(fx.docx('Curriculum vitae. '.repeat(20)), CV));
test('rejects an empty Word CV', () => expectRejected(fx.docx('CV'), /empty/, CV));
test('rejects Word where not allowed', () => expectRejected(fx.docx('Curriculum vitae. '.repeat(20)), /not accepted/));
test('rejects images for the CV slot', () => expectRejected(fx.sharpPhoto(), /not accepted/, CV));
test('rejects unknown files', () => expectRejected(Buffer.from('hello world, this is plain text'), /not recognised/));
test('explains HEIC photos', () => expectRejected(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0'), /HEIC/));
