// Sends email through Microsoft Graph (Microsoft 365) using an Entra ID app registration
// with the Mail.Send application permission (client credentials flow, modern authentication).
// No mailbox password is involved; restrict the app to the sending mailbox in Exchange Online.

const TOKEN_SKEW_MS = 5 * 60 * 1000;

export function createGraphSender({ tenantId, clientId, clientSecret, sender, fetchImpl = fetch }) {
  let cached = null; // { token, expiresAt }

  async function getToken() {
    if (cached && Date.now() < cached.expiresAt - TOKEN_SKEW_MS) return cached.token;
    const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new Error(`Microsoft sign-in failed (${res.status}): ${body.error_description || body.error || 'no access token returned'}`);
    }
    cached = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
    return cached.token;
  }

  const recipients = (list) => [].concat(list || []).filter(Boolean).map((address) => ({ emailAddress: { address } }));

  // message: { to, replyTo, subject, html, attachments: [{ filename, content (Buffer), contentType }] }
  return async function sendMail(message) {
    const payload = {
      message: {
        subject: message.subject,
        body: { contentType: 'HTML', content: message.html },
        toRecipients: recipients(message.to),
        replyTo: recipients(message.replyTo),
        attachments: (message.attachments || []).map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.filename,
          contentType: a.contentType || 'application/octet-stream',
          contentBytes: Buffer.from(a.content).toString('base64'),
        })),
      },
      saveToSentItems: true,
    };

    const send = async (token) =>
      fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

    let res = await send(await getToken());
    if (res.status === 401) {
      // Token revoked or expired early: fetch a fresh one and try once more.
      cached = null;
      res = await send(await getToken());
    }
    if (res.status !== 202 && !res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Microsoft Graph sendMail failed (${res.status}): ${body.error?.message || body.error?.code || res.statusText}`);
    }
    return { messageId: res.headers?.get?.('request-id') || null };
  };
}

// "Tourplan Learnership <learnership.applications@tourplan.com>" -> the bare address.
export function addressOf(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(from || '')).trim();
}
