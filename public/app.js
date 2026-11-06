// Tourplan Learnership application form.

const DRAFT_KEY = 'tp-learnership-draft-v1';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const form = $('#application-form');
const state = { config: null, docs: {}, submitting: false, touched: new Set(), showAll: false };

const EXT_KINDS = { pdf: 'pdf', jpg: 'jpeg', jpeg: 'jpeg', png: 'png', docx: 'docx' };
const KIND_LABELS = { pdf: 'PDF', jpeg: 'JPG', png: 'PNG', docx: 'Word (.docx)' };

// ---------------------------------------------------------------- storage helpers

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
}
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ fields: readFields(), languages: readLanguages(), docs: state.docs, savedAt: Date.now() }));
  } catch {
    /* storage unavailable (private mode); the form still works */
  }
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- setup

async function init() {
  try {
    const res = await fetch('/api/config');
    state.config = await res.json();
  } catch {
    showFormAlert('We could not load the application form. Please check your connection and refresh the page.');
    return;
  }
  const cfg = state.config;
  $$('[data-max-mb]').forEach((el) => (el.textContent = cfg.maxFileMb));

  const closeDate = new Date(cfg.closesAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg' });
  const status = $('#window-status');
  if (cfg.window !== 'open') {
    status.classList.add('is-closed');
    status.lastElementChild.textContent = cfg.window === 'closed' ? 'Applications for 2027 have closed' : 'Applications open soon';
    $$('[data-when-open]').forEach((el) => (el.hidden = true));
    $('#apply-grid').hidden = true;
    $('#closed-notice').hidden = false;
    $('#closed-title').textContent = cfg.window === 'closed' ? 'Applications for the 2027 intake have closed' : 'Applications are not open yet';
    $('#closed-body').textContent =
      cfg.window === 'closed'
        ? `Applications closed on ${closeDate}. Thank you for your interest. Please check back later in the year for the next intake.`
        : `Applications open on ${new Date(cfg.opensAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
    return;
  }
  status.lastElementChild.textContent = `Applications open until ${closeDate}`;

  for (const sel of $$('select[data-options]')) {
    const opts = cfg.options[sel.dataset.options];
    for (const o of opts) sel.add(new Option(o, o));
  }
  const dob = form.elements.date_of_birth;
  dob.max = new Date(Date.now() - 16 * 365.25 * 864e5).toISOString().slice(0, 10);

  buildDocSlots();

  const draft = loadDraft();
  if (draft) restoreDraft(draft);
  if (!$$('#lang-rows .lang-row').length) addLanguageRow({ language: 'English' });

  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);
  form.addEventListener('focusout', (e) => {
    if (e.target.name) {
      state.touched.add(e.target.name);
      validateField(e.target);
    }
  });
  form.addEventListener('submit', onSubmit);
  $('#add-language').addEventListener('click', () => {
    addLanguageRow();
    $$('#lang-rows .lang-name').at(-1).focus();
  });
  $('#clear-draft').addEventListener('click', () => {
    if (!confirm('Clear everything you have entered and start again?')) return;
    clearDraft();
    location.reload();
  });
  updateDerived();
  refresh();
}

function onInput(e) {
  if (e.target.closest('.lang-row')) $('#languages-error').textContent = '';
  if (e.target.name && (state.touched.has(e.target.name) || e.type === 'change')) validateField(e.target);
  updateDerived();
  refresh();
  saveDraft();
}

function updateDerived() {
  const name = form.elements['declaration.full_name'].value.trim();
  $('#declare-name').textContent = name || '[your full name]';
  const finalYear = form.elements['qualification.status'].value === 'final_year';
  $('#year-label').textContent = finalYear ? 'Expected year of completion' : 'Year completed';
}

// ---------------------------------------------------------------- fields

function fieldInputs() {
  return $$('input[name], select[name], textarea[name]', form).filter((el) => el.name !== 'website');
}

function readFields() {
  const out = {};
  for (const el of fieldInputs()) {
    if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  }
  return out;
}

const PHONE = /^\+?[\d\s()-]{9,20}$/;
function fieldError(el) {
  const v = el.type === 'checkbox' ? el.checked : el.type === 'radio' ? form.elements[el.name].value : el.value.trim();
  const label = el.closest('.field')?.querySelector('.label')?.firstChild?.textContent?.trim() || 'This field';
  if (el.required && !v) {
    if (el.name === 'declaration.declared') return 'Please confirm the declaration.';
    if (el.name === 'declaration.popia_consent') return 'Please give consent so we can process your application.';
    return el.tagName === 'SELECT' || el.type === 'radio' ? 'Please choose an option.' : `${label} is required.`;
  }
  if (!v) return '';
  if (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Please enter a valid email address.';
  if (el.type === 'tel' && (!PHONE.test(v) || v.replace(/\D/g, '').length < 9)) return 'Please enter a valid phone number.';
  if (el.name === 'qualification.year' && (+v < 1990 || +v > 2027)) return 'Please enter a year between 1990 and 2027.';
  if (el.name === 'date_of_birth') {
    const age = (Date.now() - Date.parse(v)) / (365.25 * 864e5);
    if (Number.isNaN(age) || age < 16 || age > 70) return 'Please check your date of birth.';
  }
  return '';
}

function setFieldError(el, msg) {
  const wrap = el.closest('.field');
  if (!wrap) return;
  wrap.classList.toggle('invalid', Boolean(msg));
  const errEl = wrap.querySelector('.error');
  if (errEl) errEl.textContent = msg;
  if (el.type === 'radio') $$(`input[name="${el.name}"]`).forEach((r) => r.setAttribute('aria-invalid', msg ? 'true' : 'false'));
  else el.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function validateField(el) {
  if (!el.name || el.closest('.lang-row')) return '';
  const msg = fieldError(el);
  setFieldError(el, msg);
  return msg;
}

// ---------------------------------------------------------------- languages

function addLanguageRow(data = {}) {
  const row = $('#lang-row-tpl').content.firstElementChild.cloneNode(true);
  $('.lang-name', row).value = data.language || '';
  for (const s of ['speak', 'read', 'write']) $(`[data-skill="${s}"]`, row).checked = data[s] ?? Boolean(data.language);
  $('.lang-remove', row).addEventListener('click', () => {
    row.remove();
    if (!$$('#lang-rows .lang-row').length) addLanguageRow();
    refresh();
    saveDraft();
  });
  $('#lang-rows').append(row);
}

function readLanguages() {
  return $$('#lang-rows .lang-row').map((row) => ({
    language: $('.lang-name', row).value.trim(),
    speak: $('[data-skill="speak"]', row).checked,
    read: $('[data-skill="read"]', row).checked,
    write: $('[data-skill="write"]', row).checked,
  }));
}

function languagesError() {
  const langs = readLanguages().filter((l) => l.language || l.speak || l.read || l.write);
  if (!langs.length) return 'Please add at least one language.';
  if (langs.some((l) => !l.language)) return 'Please enter the name of each language, or remove empty rows.';
  if (langs.some((l) => !l.speak && !l.read && !l.write)) return 'Tick speak, read or write for each language.';
  return '';
}

// ---------------------------------------------------------------- documents

function buildDocSlots() {
  const list = $('#doc-slots');
  state.config.documents.forEach((doc, i) => {
    const li = $('#doc-slot-tpl').content.firstElementChild.cloneNode(true);
    li.dataset.key = doc.key;
    li.id = `doc-${doc.key}`;
    $('.doc-num', li).textContent = `${i + 1}.`;
    $('.doc-title', li).textContent = doc.label;
    $('.doc-hint', li).textContent = `${doc.hint} ${doc.accept.map((k) => KIND_LABELS[k]).join(', ')}.`;
    const input = $('input[type=file]', li);
    input.accept = doc.accept.flatMap((k) => (k === 'jpeg' ? ['.jpg', '.jpeg', 'image/jpeg'] : k === 'png' ? ['.png', 'image/png'] : k === 'pdf' ? ['.pdf', 'application/pdf'] : ['.docx'])).join(',');
    input.setAttribute('aria-label', `Choose file for ${doc.label}`);
    input.addEventListener('change', () => input.files[0] && uploadDocument(doc, li, input.files[0]).finally(() => (input.value = '')));
    $('.doc-remove', li).addEventListener('click', () => {
      delete state.docs[doc.key];
      setSlot(li, 'empty');
      refresh();
      saveDraft();
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('dragover');
    });
    li.addEventListener('dragleave', () => li.classList.remove('dragover'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) uploadDocument(doc, li, f);
    });
    list.append(li);
  });
}

function setSlot(li, s, message = '') {
  li.dataset.state = s;
  $('.doc-status', li).textContent = message;
  $('.choose-text', li).textContent = s === 'ok' || s === 'error' ? 'Replace file' : 'Choose file';
  $('.doc-remove', li).hidden = s !== 'ok';
}

function formatSize(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function uploadDocument(doc, li, file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const kind = EXT_KINDS[ext];
  if (ext === 'heic' || ext === 'heif') return setSlot(li, 'error', 'iPhone HEIC photos are not supported. Please export the photo as JPG and upload again.');
  if (kind && !doc.accept.includes(kind)) {
    return setSlot(li, 'error', `${KIND_LABELS[kind]} files are not accepted here. Please upload ${doc.accept.map((k) => KIND_LABELS[k]).join(' or ')}.`);
  }
  if (file.size > state.config.maxFileMb * 1024 * 1024) {
    return setSlot(li, 'error', `This file is ${formatSize(file.size)}. The limit is ${state.config.maxFileMb} MB; please scan at a lower resolution or compress it.`);
  }
  if (file.size === 0) return setSlot(li, 'error', 'This file is empty. Please choose another file.');

  delete state.docs[doc.key];
  setSlot(li, 'checking', `Checking ${file.name}…`);
  refresh();

  const body = new FormData();
  body.append('file', file);
  try {
    const res = await fetch(`/api/documents/${doc.key}`, { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSlot(li, 'error', data.error || 'The upload failed. Please try again.');
    } else {
      state.docs[doc.key] = { token: data.token, filename: data.filename, size: data.size, kind: data.kind };
      setSlot(li, 'ok', `${data.filename} · ${formatSize(data.size)} · checked and readable`);
    }
  } catch {
    setSlot(li, 'error', 'The upload failed. Please check your connection and try again.');
  }
  refresh();
  saveDraft();
}

// ---------------------------------------------------------------- progress + submit gating

const SECTIONS = {
  personal: ['title', 'surname', 'first_name', 'middle_name', 'date_of_birth', 'country_of_birth'],
  contact: ['residential_address', 'city', 'province', 'postal_code', 'email', 'cell_number', 'alternative_number'],
  qualification: ['qualification.qualification', 'qualification.institution', 'qualification.field', 'qualification.nqf_level', 'qualification.status', 'qualification.year'],
  declaration: ['declaration.full_name', 'declaration.signed_at', 'declaration.declared', 'declaration.popia_consent'],
};
const SECTION_NAMES = { personal: 'personal details', contact: 'address and contact details', qualification: 'qualification', languages: 'languages', documents: 'documents', declaration: 'declaration' };

function sectionComplete(sec) {
  if (sec === 'languages') return !languagesError();
  if (sec === 'documents') return docsComplete();
  return SECTIONS[sec].every((name) => {
    const el = form.elements[name];
    const first = el instanceof RadioNodeList ? el[0] : el;
    return !fieldError(first);
  });
}
const docsComplete = () => state.config.documents.every((d) => state.docs[d.key]);

function refresh() {
  const docCount = state.config.documents.filter((d) => state.docs[d.key]).length;
  $('#doc-count').textContent = `${docCount} of ${state.config.documents.length}`;
  const incomplete = [];
  for (const sec of Object.keys(SECTION_NAMES)) {
    const done = sectionComplete(sec);
    $(`#progress-list [data-sec="${sec}"]`).classList.toggle('done', done);
    $(`#sec-${sec}`).classList.toggle('complete', done);
    if (!done) incomplete.push(sec);
  }
  const btn = $('#submit-btn');
  const checking = $$('.doc-slot[data-state="checking"]').length > 0;
  const ready = incomplete.length === 0 && !checking && !state.submitting;
  // Submission is blocked (button disabled) until every document has passed the check.
  btn.disabled = !docsComplete() || checking || state.submitting;
  btn.setAttribute('aria-disabled', String(!ready));
  $('.submit-bar').classList.toggle('ready', ready);

  const hint = $('#submit-hint');
  if (state.submitting) hint.textContent = 'Submitting your application…';
  else if (checking) hint.textContent = 'Checking your document…';
  else if (!docsComplete()) {
    const missing = state.config.documents.length - docCount;
    hint.textContent = `Attach ${missing} more document${missing > 1 ? 's' : ''} to submit. You can submit once all five documents have been checked.`;
  } else if (incomplete.length) hint.textContent = `Please complete your ${incomplete.map((s) => SECTION_NAMES[s]).join(', ')}.`;
  else hint.textContent = 'Everything is complete. Please check your details, then submit.';
}

function showAllErrors() {
  let first = null;
  for (const el of fieldInputs()) {
    if (el.closest('.lang-row')) continue;
    if (validateField(el) && !first) first = el;
  }
  const langErr = languagesError();
  $('#languages-error').textContent = langErr;
  $$('#lang-rows .lang-row').forEach((row) => row.classList.toggle('invalid', Boolean(langErr) && !$('.lang-name', row).value.trim()));
  if (!first && langErr) first = $('#sec-languages');
  if (!first && !docsComplete()) first = $('.doc-slot:not([data-state="ok"])');
  return first;
}

function showFormAlert(msg) {
  const a = $('#form-alert');
  a.textContent = msg;
  a.hidden = !msg;
}

async function onSubmit(e) {
  e.preventDefault();
  if (state.submitting) return;
  showFormAlert('');
  const first = showAllErrors();
  if (first) {
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (first.focus) first.focus({ preventScroll: true });
    return;
  }

  const f = readFields();
  const payload = {
    title: f.title,
    surname: f.surname,
    first_name: f.first_name,
    middle_name: f.middle_name,
    date_of_birth: f.date_of_birth,
    country_of_birth: f.country_of_birth,
    residential_address: f.residential_address,
    city: f.city,
    province: f.province,
    postal_code: f.postal_code,
    email: f.email,
    cell_number: f.cell_number,
    alternative_number: f.alternative_number,
    languages: readLanguages().filter((l) => l.language),
    qualification: {
      qualification: f['qualification.qualification'],
      institution: f['qualification.institution'],
      field: f['qualification.field'],
      nqf_level: f['qualification.nqf_level'],
      status: f['qualification.status'],
      year: f['qualification.year'],
    },
    declaration: {
      full_name: f['declaration.full_name'],
      signed_at: f['declaration.signed_at'],
      declared: f['declaration.declared'],
      popia_consent: f['declaration.popia_consent'],
    },
    documents: Object.fromEntries(Object.entries(state.docs).map(([k, v]) => [k, v.token])),
    website: form.elements.website.value,
  };

  state.submitting = true;
  refresh();
  try {
    const res = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      applyServerIssues(data.issues || []);
      showFormAlert(data.error || 'Something went wrong. Please try again.');
      $('#form-alert').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    clearDraft();
    $('#apply-grid').hidden = true;
    $('.apply-head').hidden = true;
    $('#success-name').textContent = data.firstName;
    $('#success-ref').textContent = data.reference;
    $('#success-email').textContent = data.email;
    const s = $('#success');
    s.hidden = false;
    s.scrollIntoView({ behavior: 'smooth', block: 'start' });
    s.focus({ preventScroll: true });
  } catch {
    showFormAlert('We could not reach the server. Please check your connection and try again. Your answers and documents are still here.');
  } finally {
    state.submitting = false;
    refresh();
  }
}

function applyServerIssues(issues) {
  for (const issue of issues) {
    if (issue.path.startsWith('documents.')) {
      const key = issue.path.split('.')[1];
      delete state.docs[key];
      const li = $(`#doc-${key}`);
      if (li) setSlot(li, 'error', issue.message);
    } else if (issue.path.startsWith('languages')) {
      $('#languages-error').textContent = issue.message;
    } else {
      const el = form.elements[issue.path];
      const target = el instanceof RadioNodeList ? el[0] : el;
      if (target) setFieldError(target, issue.message);
    }
  }
  refresh();
  saveDraft();
}

// ---------------------------------------------------------------- draft restore

function restoreDraft(draft) {
  for (const [name, value] of Object.entries(draft.fields || {})) {
    const el = form.elements[name];
    if (!el) continue;
    if (el instanceof RadioNodeList) {
      for (const r of el) r.checked = r.value === value;
    } else if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  }
  for (const l of draft.languages || []) if (l.language || l.speak || l.read || l.write) addLanguageRow(l);
  // Upload tokens are valid for 24 hours; older documents need to be added again.
  const fresh = Date.now() - (draft.savedAt || 0) < 23 * 60 * 60 * 1000;
  for (const [key, d] of Object.entries(draft.docs || {})) {
    const li = $(`#doc-${key}`);
    if (!li) continue;
    if (fresh && d.token) {
      state.docs[key] = d;
      setSlot(li, 'ok', `${d.filename} · ${formatSize(d.size)} · checked and readable`);
    } else {
      setSlot(li, 'error', 'Please add this document again; earlier uploads expire after 24 hours.');
    }
  }
}

init();
