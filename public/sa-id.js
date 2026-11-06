// South African ID number checks, shared by the browser form and the server.
//
// Format YYMMDD SSSS C A Z:
//   YYMMDD  date of birth
//   SSSS    sequence (0000-4999 female, 5000-9999 male); not checked
//   C       0 = South African citizen, 1 = permanent resident
//   A       historically a race marker, now always 8 (older IDs may have 9); not checked
//   Z       Luhn check digit
//
// These checks catch typing mistakes and numbers that cannot exist. They cannot confirm
// that a number was issued, or that it belongs to the applicant; that needs Home Affairs.

export function normaliseIdNumber(value) {
  return String(value ?? '').replace(/[\s-]/g, '');
}

function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Returns '' when valid, otherwise a message for the applicant.
// dateOfBirth (optional) is 'YYYY-MM-DD'; when given, it must match the first six digits.
export function idNumberError(value, dateOfBirth) {
  const id = normaliseIdNumber(value);
  if (!id) return 'South African ID number is required.';
  if (!/^\d{13}$/.test(id)) return 'A South African ID number has 13 digits.';

  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  const daysInMonth = new Date(Date.UTC(2000, mm, 0)).getUTCDate(); // 2000 is a leap year, so 29 Feb passes
  if (mm < 1 || mm > 12 || dd < 1 || dd > daysInMonth) {
    return 'The first six digits of your ID number should be your date of birth (YYMMDD). Please check the number.';
  }
  if (id[10] !== '0' && id[10] !== '1') return 'This is not a valid South African ID number. Please check it against your ID document.';
  if (!luhnValid(id)) return 'This is not a valid South African ID number. Please check it against your ID document.';

  if (dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    const yymmdd = dateOfBirth.slice(2, 4) + dateOfBirth.slice(5, 7) + dateOfBirth.slice(8, 10);
    if (id.slice(0, 6) !== yymmdd) return 'Your ID number does not match the date of birth you entered. Please check both.';
  }
  return '';
}
