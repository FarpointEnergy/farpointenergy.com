// Fixed Google endpoints. No caller-controlled URL or automatic send retry.
export const MAILBOX = 'karan@farpointenergy.com';
export class GmailError extends Error {
  constructor(code, {status = 0, stage = 'read'} = {}) {
    super(code); this.name = 'GmailError'; this.code = code; this.status = status; this.stage = stage;
  }
}

async function boundedJson(response, stage, maxBytes = 2 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > maxBytes) throw new GmailError('gmail_response_oversized', {stage});
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new GmailError('gmail_response_invalid', {stage, status: response.status}); }
}

export function createGmailClient(config, {fetchImpl = fetch, now = () => Date.now()} = {}) {
  const mailbox = config.mailbox ?? config.reportRecipient ?? MAILBOX;
  if (mailbox !== MAILBOX) throw new GmailError('gmail_wrong_mailbox', {stage: 'profile'});
  let token = null; let expires = 0; let refresh = null; let verifiedUntil = 0;
  async function accessToken() {
    if (token && expires > now() + 60_000) return token;
    if (refresh) return refresh;
    refresh = (async () => {
      if (!config.gmailClientId || !config.gmailClientSecret || !config.gmailRefreshToken) {
        throw new GmailError('gmail_oauth_unconfigured', {stage: 'auth'});
      }
      let response;
      try {
        response = await fetchImpl('https://oauth2.googleapis.com/token', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: new URLSearchParams({client_id: config.gmailClientId, client_secret: config.gmailClientSecret,
            refresh_token: config.gmailRefreshToken, grant_type: 'refresh_token'})
        });
      } catch { throw new GmailError('gmail_auth_transport', {stage: 'auth'}); }
      if (!response.ok) throw new GmailError('gmail_auth_rejected', {stage: 'auth', status: response.status});
      const data = await boundedJson(response, 'auth', 16_384);
      if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in)) {
        throw new GmailError('gmail_auth_invalid', {stage: 'auth'});
      }
      token = data.access_token; expires = now() + Math.max(0, data.expires_in) * 1000;
      return token;
    })();
    try { return await refresh; } finally { refresh = null; }
  }
  async function request(path, {method = 'GET', body, stage = 'read'} = {}) {
    const access = await accessToken();
    let response;
    try {
      response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: {Authorization: `Bearer ${access}`, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {})
      });
    } catch { throw new GmailError('gmail_transport_uncertain', {stage}); }
    if (!response.ok) {
      if (response.status === 401) { token = null; verifiedUntil = 0; }
      throw new GmailError('gmail_request_rejected', {stage, status: response.status});
    }
    return boundedJson(response, stage);
  }
  async function verifyProfile({force = false} = {}) {
    if (!force && verifiedUntil > now()) return MAILBOX;
    const profile = await request('profile', {stage: 'profile'});
    if (profile.emailAddress?.toLowerCase() !== MAILBOX) {
      throw new GmailError('gmail_wrong_mailbox', {stage: 'profile'});
    }
    verifiedUntil = now() + 60 * 60_000;
    return MAILBOX;
  }
  return {
    verifyProfile,
    async listMessages({q, pageToken, maxResults = 100, labelIds = []}) {
      await verifyProfile();
      const params = new URLSearchParams({q, maxResults: String(Math.min(maxResults, 500)), includeSpamTrash: 'false'});
      if (pageToken) params.set('pageToken', pageToken);
      for (const label of labelIds) params.append('labelIds', label);
      return request(`messages?${params}`);
    },
    async getMessage(id) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new GmailError('gmail_invalid_message_id');
      await verifyProfile();
      return request(`messages/${encodeURIComponent(id)}?format=full`);
    },
    async sendRaw(raw) {
      await verifyProfile();
      const result = await request('messages/send', {method: 'POST', body: {raw}, stage: 'send'});
      if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(result.id)) {
        throw new GmailError('gmail_send_invalid_success', {stage: 'send'});
      }
      return result;
    }
  };
}

export function sendFailureState(error) {
  // No send HTTP request was made when credential/profile preparation failed.
  if (error instanceof GmailError && error.stage !== 'send') return 'failed';
  const status = Number(error?.status);
  return status >= 400 && status < 500 && status !== 408 && status !== 429 ? 'failed' : 'uncertain';
}
