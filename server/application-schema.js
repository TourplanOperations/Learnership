// Validation for the application form. Mirrors the 2027 Learnership enrolment form,
// plus a short qualification section used to check the NQF 7 entry requirement.

import { z } from 'zod';
import { DOCUMENT_KEYS } from './documents.js';

export const TITLES = ['Mr', 'Ms', 'Mrs', 'Miss', 'Mx', 'Dr'];
export const PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
  'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape', 'Outside South Africa',
];
export const FIELDS_OF_STUDY = ['IT', 'Tourism', 'Business', 'Other'];
export const NQF_LEVELS = ['6', '7', '8', '9', '10'];
export const STUDY_STATUS = { completed: 'Completed', final_year: 'Currently in final year' };

const text = (max, label) =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
const optionalText = (max) => z.string().trim().max(max).optional().transform((v) => v || null);
const phone = (label) =>
  z.string().trim().refine((v) => /^\+?[\d\s()-]{9,20}$/.test(v) && v.replace(/\D/g, '').length >= 9, `${label} must be a valid phone number.`);

function age(dob, on = new Date()) {
  const d = new Date(dob);
  let a = on.getFullYear() - d.getFullYear();
  const m = on.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < d.getDate())) a--;
  return a;
}

export const applicationSchema = z.object({
  title: z.enum(TITLES, { error: 'Please choose a title.' }),
  surname: text(80, 'Surname'),
  first_name: text(80, 'First name'),
  middle_name: optionalText(80),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth is required.')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Date of birth is not a valid date.')
    .refine((v) => age(v) >= 16 && age(v) <= 70, 'Please check your date of birth.'),
  country_of_birth: text(80, 'Country of birth'),
  residential_address: text(300, 'Street address'),
  city: text(80, 'Town or city'),
  province: z.enum(PROVINCES, { error: 'Please choose a province.' }),
  postal_code: text(12, 'Postal code'),
  email: z.string().trim().toLowerCase().pipe(z.email('Please enter a valid email address.')).pipe(z.string().max(160)),
  cell_number: phone('Cell number'),
  alternative_number: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || (/^\+?[\d\s()-]{9,20}$/.test(v) && v.replace(/\D/g, '').length >= 9), 'Alternative number must be a valid phone number.'),

  languages: z
    .array(
      z
        .object({
          language: text(40, 'Language'),
          speak: z.boolean(),
          read: z.boolean(),
          write: z.boolean(),
        })
        .refine((l) => l.speak || l.read || l.write, 'Tick speak, read or write for each language.'),
    )
    .min(1, 'Please add at least one language.')
    .max(10),

  qualification: z.object({
    qualification: text(150, 'Qualification name'),
    institution: text(150, 'Institution'),
    field: z.enum(FIELDS_OF_STUDY, { error: 'Please choose a field of study.' }),
    nqf_level: z.enum(NQF_LEVELS, { error: 'Please choose the NQF level.' }),
    status: z.enum(Object.keys(STUDY_STATUS), { error: 'Please say whether the qualification is completed.' }),
    year: z.coerce.number().int().min(1990, 'Please check the year.').max(2027, 'Please check the year.'),
  }),

  declaration: z.object({
    full_name: text(160, 'Full name'),
    signed_at: text(80, 'Signed at'),
    sa_id: z.literal(true, { error: 'Applications are open only to people with a valid South African ID.' }),
    declared: z.literal(true, { error: 'Please confirm the declaration.' }),
    popia_consent: z.literal(true, { error: 'Please consent to the processing of your personal information.' }),
  }),

  // Upload tokens returned by POST /api/documents/:key, one per required document.
  documents: z.object(Object.fromEntries(DOCUMENT_KEYS.map((k) => [k, z.string({ error: 'Missing document.' }).min(10, 'Missing document.')]))),

  // Honeypot: real people never see or fill this field.
  website: z.string().max(0).optional(),
});

export function formatIssues(error) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
