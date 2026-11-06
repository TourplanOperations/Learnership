import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idNumberError, normaliseIdNumber } from '../public/sa-id.js';

// Build a valid number by computing its Luhn check digit.
function withCheckDigit(twelve) {
  for (let z = 0; z <= 9; z++) {
    const id = twelve + z;
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      let d = Number(id[12 - i]);
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    if (sum % 10 === 0) return id;
  }
  throw new Error('no check digit');
}
const VALID = withCheckDigit('020315512308'); // born 15 March 2002, citizen

test('accepts a valid ID number, with or without spaces', () => {
  assert.equal(idNumberError(VALID), '');
  assert.equal(idNumberError(`${VALID.slice(0, 6)} ${VALID.slice(6, 10)} ${VALID.slice(10)}`), '');
  assert.equal(normaliseIdNumber(' 020315 5123-089 '), '0203155123089');
});

test('accepts the known example number', () => {
  assert.equal(idNumberError('8001015009087'), '');
});

test('rejects a wrong check digit', () => {
  const wrong = VALID.slice(0, 12) + ((Number(VALID[12]) + 1) % 10);
  assert.match(idNumberError(wrong), /not a valid South African ID number/);
});

test('rejects wrong length, letters and empty values', () => {
  assert.match(idNumberError('123456789012'), /13 digits/);
  assert.match(idNumberError('80010150090A7'), /13 digits/);
  assert.match(idNumberError(''), /required/);
});

test('rejects impossible dates', () => {
  assert.match(idNumberError(withCheckDigit('021315512308')), /date of birth/);
  assert.match(idNumberError(withCheckDigit('020231512308')), /date of birth/);
  assert.equal(idNumberError(withCheckDigit('000229512308')), ''); // 29 Feb 2000
});

test('rejects a citizenship digit other than 0 or 1', () => {
  assert.match(idNumberError(withCheckDigit('020315512328')), /not a valid/);
  assert.equal(idNumberError(withCheckDigit('020315512318')), ''); // permanent resident
});

test('checks the number against the date of birth', () => {
  assert.equal(idNumberError(VALID, '2002-03-15'), '');
  assert.match(idNumberError(VALID, '2002-03-16'), /does not match the date of birth/);
});
