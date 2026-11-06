// The supporting documents required by the 2027 Learnership application form.
// `accept` lists the file kinds allowed for each slot (detected from file contents,
// not the file name).

export const REQUIRED_DOCUMENTS = [
  {
    key: 'matric',
    label: 'Matric certificate',
    hint: 'Your National Senior Certificate (or equivalent).',
    accept: ['pdf', 'jpeg', 'png'],
  },
  {
    key: 'tertiary',
    label: 'Proof of tertiary education',
    hint: 'Your diploma or degree certificate. If you are in your final year, upload your latest academic transcript.',
    accept: ['pdf', 'jpeg', 'png'],
  },
  {
    key: 'cv',
    label: 'Curriculum vitae',
    hint: 'Your CV as a PDF or Word document.',
    accept: ['pdf', 'docx'],
  },
  {
    key: 'id',
    label: 'Copy of ID document',
    hint: 'Both sides of a smart ID card, or the photo page of your green ID book or passport.',
    accept: ['pdf', 'jpeg', 'png'],
  },
  {
    key: 'residence',
    label: 'Proof of residence',
    hint: 'A utility bill, bank statement, lease or affidavit not older than three months.',
    accept: ['pdf', 'jpeg', 'png'],
  },
];

export const DOCUMENT_KEYS = REQUIRED_DOCUMENTS.map((d) => d.key);

export const KIND_LABELS = { pdf: 'PDF', jpeg: 'JPG', png: 'PNG', docx: 'Word (.docx)' };

export const EXTENSIONS = { pdf: 'pdf', jpeg: 'jpg', png: 'png', docx: 'docx' };

export const MIME_TYPES = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function documentByKey(key) {
  return REQUIRED_DOCUMENTS.find((d) => d.key === key);
}
