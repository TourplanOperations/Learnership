import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphSender, addressOf } from '../server/graph-mail.js';

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      statusText: '',
      headers: { get: () => 'req-1' },
      json: async () => r.body ?? {},
    };
  };
  fn.calls = calls;
  return fn;
}

const opts = { tenantId: 'tenant-1', clientId: 'client-1', clientSecret: 'secret-1', sender: 'learnership.applications@tourplan.com' };
const token = { status: 200, body: { access_token: 'tok-1', expires_in: 3600 } };

test('gets a token, then posts the message to the sender mailbox', async () => {
  const f = fakeFetch([token, { status: 202 }]);
  const send = createGraphSender({ ...opts, fetchImpl: f });
  await send({
    to: 'team@example.com',
    replyTo: 'applicant@example.com',
    subject: 'Hello',
    html: '<p>Hi</p>',
    attachments: [{ filename: 'form.pdf', content: Buffer.from('%PDF-test'), contentType: 'application/pdf' }],
  });

  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].url, /login\.microsoftonline\.com\/tenant-1\/oauth2\/v2\.0\/token$/);
  const form = new URLSearchParams(f.calls[0].init.body.toString());
  assert.equal(form.get('grant_type'), 'client_credentials');
  assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default');

  assert.equal(f.calls[1].url, 'https://graph.microsoft.com/v1.0/users/learnership.applications%40tourplan.com/sendMail');
  assert.equal(f.calls[1].init.headers.Authorization, 'Bearer tok-1');
  const { message, saveToSentItems } = JSON.parse(f.calls[1].init.body);
  assert.equal(saveToSentItems, true);
  assert.equal(message.subject, 'Hello');
  assert.deepEqual(message.body, { contentType: 'HTML', content: '<p>Hi</p>' });
  assert.deepEqual(message.toRecipients, [{ emailAddress: { address: 'team@example.com' } }]);
  assert.deepEqual(message.replyTo, [{ emailAddress: { address: 'applicant@example.com' } }]);
  assert.equal(message.attachments[0]['@odata.type'], '#microsoft.graph.fileAttachment');
  assert.equal(Buffer.from(message.attachments[0].contentBytes, 'base64').toString(), '%PDF-test');
});

test('reuses the token for later messages', async () => {
  const f = fakeFetch([token, { status: 202 }, { status: 202 }]);
  const send = createGraphSender({ ...opts, fetchImpl: f });
  await send({ to: 'a@example.com', subject: 's', html: 'h' });
  await send({ to: 'b@example.com', subject: 's', html: 'h' });
  assert.equal(f.calls.filter((c) => c.url.includes('/token')).length, 1);
});

test('retries once with a fresh token after a 401', async () => {
  const f = fakeFetch([token, { status: 401 }, { status: 200, body: { access_token: 'tok-2', expires_in: 3600 } }, { status: 202 }]);
  const send = createGraphSender({ ...opts, fetchImpl: f });
  await send({ to: 'a@example.com', subject: 's', html: 'h' });
  assert.equal(f.calls[3].init.headers.Authorization, 'Bearer tok-2');
});

test('reports sign-in and send failures clearly', async () => {
  const badLogin = createGraphSender({ ...opts, fetchImpl: fakeFetch([{ status: 401, body: { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret' } }]) });
  await assert.rejects(badLogin({ to: 'a@example.com', subject: 's', html: 'h' }), /Microsoft sign-in failed \(401\): AADSTS7000215/);

  const denied = createGraphSender({ ...opts, fetchImpl: fakeFetch([token, { status: 403, body: { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } } }]) });
  await assert.rejects(denied({ to: 'a@example.com', subject: 's', html: 'h' }), /sendMail failed \(403\): Access is denied/);
});

test('addressOf extracts the bare address', () => {
  assert.equal(addressOf('Tourplan Learnership <learnership.applications@tourplan.com>'), 'learnership.applications@tourplan.com');
  assert.equal(addressOf('plain@example.com'), 'plain@example.com');
});
