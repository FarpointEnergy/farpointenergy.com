import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, lstat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY = 86_400_000;
const MAX_BYTES = 256 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value);
const fail = () => { throw new Error('Deletion journal validation failed'); };

function date(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
  return value;
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail();
  return value;
}
function ids(value, kind) {
  if (!Array.isArray(value) || value.length > 1000) fail();
  for (const item of value) {
    if (kind === 'gmail') {
      if (typeof item !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item)) fail();
    } else uuid(item);
  }
  return [...new Set(value)].sort();
}
function request(value) {
  const allowed = ['version', 'type', 'requestId', 'requestedAt', 'websiteId', 'browserIds', 'inquiryIds', 'gmailMessageIds'];
  if (!value || Object.keys(value).some(k => !allowed.includes(k))) fail();
  if (value.version !== 1 || value.type !== 'request') fail();
  const result = {
    version: 1, type: 'request', requestId: uuid(value.requestId), requestedAt: date(value.requestedAt), websiteId: uuid(value.websiteId),
    browserIds: ids(value.browserIds, 'browser'), inquiryIds: ids(value.inquiryIds, 'inquiry'), gmailMessageIds: ids(value.gmailMessageIds, 'gmail'),
  };
  if (!(result.browserIds.length + result.inquiryIds.length + result.gmailMessageIds.length)) fail();
  return result;
}
function validateKey(key) {
  const bytes = Buffer.isBuffer(key) ? Buffer.from(key) : typeof key === 'string' && /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, 'hex') : null;
  if (!bytes || bytes.length !== 32) throw new Error('Journal encryption key must contain 32 bytes');
  return bytes;
}

/** Durable immutable records plus a conditional-write encrypted inventory; listing is not a recovery authority. */
export function createDeletionJournal({ store, key, websiteId, installationId, prefix = 'deletion-journal/' }) {
  if (!store || !['putIfAbsent', 'get', 'getWithVersion', 'putIfMatch'].every(k => typeof store[k] === 'function')) throw new Error('Independent deletion journal store is required');
  if (!/^[a-z0-9][a-z0-9/-]*\/$/.test(prefix) || prefix.includes('//') || prefix.includes('..')) fail();
  const secret = validateKey(key);
  const manifestKey = `${prefix}manifest.json.enc`;
  uuid(websiteId); uuid(installationId);
  const emptyManifest = { version: 1, type: 'manifest', websiteId, installationId, requests: [] };
  const keyFor = (type, id) => `${prefix}${type}/${uuid(id)}.json.enc`;
  function encrypt(objectKey, value) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', secret, nonce);
    cipher.setAAD(Buffer.from(objectKey));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonical(value))), cipher.final()]);
    return Buffer.from(JSON.stringify({ version: 1, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') }));
  }
  function decrypt(objectKey, bytes) {
    try {
      if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
      if (bytes.length > MAX_BYTES) fail();
      const envelope = JSON.parse(bytes.toString('utf8'));
      if (envelope.version !== 1 || Object.keys(envelope).sort().join(',') !== 'ciphertext,nonce,tag,version') fail();
      const nonce = Buffer.from(envelope.nonce, 'base64');
      const tag = Buffer.from(envelope.tag, 'base64');
      if (nonce.length !== 12 || tag.length !== 16) fail();
      const decipher = createDecipheriv('aes-256-gcm', secret, nonce);
      decipher.setAAD(Buffer.from(objectKey));
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    } catch { fail(); }
  }
  async function immutableWrite(objectKey, value) {
    const bytes = encrypt(objectKey, value);
    if (bytes.length > MAX_BYTES) fail();
    await store.putIfAbsent(objectKey, bytes);
    // Read back even when an idempotent retry found an existing immutable object.
    const actual = decrypt(objectKey, await store.get(objectKey));
    const expectedHash = Buffer.from(digest(canonical(value)), 'hex');
    const actualHash = Buffer.from(digest(canonical(actual)), 'hex');
    if (!timingSafeEqual(expectedHash, actualHash)) fail();
    return actual;
  }
  async function readManifest() {
    const stored = await store.getWithVersion(manifestKey);
    if (!stored || typeof stored.version !== 'string' || !stored.version) fail();
    const value = decrypt(manifestKey, stored.bytes);
    if (Object.keys(value).sort().join(',') !== 'installationId,requests,type,version,websiteId' || value.version !== 1 || value.type !== 'manifest' || value.websiteId !== websiteId || value.installationId !== installationId || !Array.isArray(value.requests) || value.requests.length > 1000) fail();
    const unique = new Set();
    for (const entry of value.requests) {
      if (Object.keys(entry).sort().join(',') !== 'requestHash,requestId,requestedAt' || !/^[0-9a-f]{64}$/.test(entry.requestHash)) fail();
      uuid(entry.requestId); date(entry.requestedAt);
      if (unique.has(entry.requestId)) fail();
      unique.add(entry.requestId);
    }
    return { value, version: stored.version };
  }
  async function updateInventory(mutate, verify) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const { value, version } = await readManifest();
      const next = { ...value, requests: mutate(value.requests).sort((a, b) => a.requestId.localeCompare(b.requestId)) };
      if (next.requests.length > 1000) throw new Error('Deletion journal inventory capacity exceeded');
      if (canonical(next) === canonical(value)) return value;
      const bytes = encrypt(manifestKey, next);
      if (bytes.length > MAX_BYTES) fail();
      if (!await store.putIfMatch(manifestKey, bytes, version)) continue;
      const verified = (await readManifest()).value;
      if (!verify(verified.requests)) fail();
      return verified;
    }
    throw new Error('Deletion journal inventory update conflicted');
  }
  async function readRequest(requestId, inventory) {
    const manifest = inventory || (await readManifest()).value;
    const entry = manifest.requests.find(item => item.requestId === requestId);
    if (!entry) fail();
    const result = request(decrypt(keyFor('requests', requestId), await store.get(keyFor('requests', requestId))));
    if (result.requestId !== requestId || result.websiteId !== websiteId || result.requestedAt !== entry.requestedAt || digest(canonical(result)) !== entry.requestHash) fail();
    return result;
  }
  async function pruneExpired({ now = new Date() } = {}) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail();
    const cutoff = now.getTime() - 100 * DAY;
    const active = entry => Date.parse(entry.requestedAt) > cutoff;
    return updateInventory(entries => entries.filter(active), entries => entries.every(active));
  }
  return {
    // Provision once, separately from erasure/restore. Never auto-create during recovery.
    async initialize() {
      await store.putIfAbsent(manifestKey, encrypt(manifestKey, emptyManifest));
      await readManifest();
      return { initialized: true };
    },
    async writeRequest(value) {
      await readManifest();
      const item = request({ version: 1, type: 'request', requestId: randomUUID(), requestedAt: new Date().toISOString(), ...value });
      if (item.websiteId !== websiteId || Date.parse(item.requestedAt) > Date.now() + 60000 || Date.parse(item.requestedAt) <= Date.now() - 100 * DAY) fail();
      await immutableWrite(keyFor('requests', item.requestId), item);
      const entry = { requestId: item.requestId, requestedAt: item.requestedAt, requestHash: digest(canonical(item)) };
      await updateInventory(entries => {
        const existing = entries.find(row => row.requestId === item.requestId);
        if (existing && canonical(existing) !== canonical(entry)) fail();
        return existing ? entries : [...entries, entry];
      }, entries => entries.some(row => canonical(row) === canonical(entry)));
      // Neither object persistence alone nor an unverified conditional update acknowledges erasure intent.
      return readRequest(item.requestId);
    },
    readRequest,
    pruneExpired,
    async writeCompletion(value, completedAt = new Date()) {
      const item = request(value);
      const stored = await readRequest(item.requestId);
      if (canonical(stored) !== canonical(item)) fail();
      const objectKey = keyFor('completions', item.requestId);
      const completion = { version: 1, type: 'completion', requestId: item.requestId, requestHash: digest(canonical(item)), requestedAt: item.requestedAt, completedAt: date(completedAt.toISOString()) };
      await store.putIfAbsent(objectKey, encrypt(objectKey, completion));
      const verified = decrypt(objectKey, await store.get(objectKey));
      validateCompletion(verified, item);
      return verified;
    },
    async readRequests({ now = new Date(), websiteId: requestedWebsite } = {}) {
      if (requestedWebsite !== undefined && requestedWebsite !== websiteId) fail();
      const inventory = await pruneExpired({ now });
      const records = [];
      for (const entry of inventory.requests) {
        if (Date.parse(entry.requestedAt) > now.getTime() + 60000) fail();
        records.push(await readRequest(entry.requestId, inventory));
      }
      return records.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    },
  };
}

function validateCompletion(value, item) {
  if (Object.keys(value).sort().join(',') !== 'completedAt,requestHash,requestId,requestedAt,type,version' || value.version !== 1 || value.type !== 'completion' || value.requestId !== item.requestId || value.requestedAt !== item.requestedAt || value.requestHash !== digest(canonical(item))) fail();
  date(value.completedAt);
  if (Date.parse(value.completedAt) < Date.parse(item.requestedAt)) fail();
}

/** Development-only adapter. A local directory does not satisfy off-instance recovery. */
export function createLocalJournalStore({ directory, developmentOnly = false }) {
  if (!developmentOnly || !path.isAbsolute(directory)) throw new Error('Local journal storage is development-only');
  directory = path.resolve(directory);
  function filename(key) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(key) || key.startsWith('/') || key.split('/').some(part => !part || part === '.' || part === '..')) fail();
    return path.join(directory, key);
  }
  async function ensureDirectory(dir) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    let cursor = dir;
    while (cursor.startsWith(directory)) {
      if ((await lstat(cursor)).isSymbolicLink()) fail();
      if (cursor === directory) break;
      cursor = path.dirname(cursor);
    }
  }
  return {
    async putIfAbsent(key, bytes) {
      const file = filename(key);
      await ensureDirectory(path.dirname(file));
      let handle;
      try { handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
      catch (error) { if (error.code === 'EEXIST') return false; throw error; }
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      const parent = await open(path.dirname(file), constants.O_RDONLY | constants.O_DIRECTORY);
      try { await parent.sync(); } finally { await parent.close(); }
      return true;
    },
    async get(key) {
      const handle = await open(filename(key), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if ((await handle.stat()).size > MAX_BYTES) fail();
        return await handle.readFile();
      } finally { await handle.close(); }
    },
    async getWithVersion(key) {
      const bytes = await this.get(key);
      return { bytes, version: digest(bytes) };
    },
    async putIfMatch(key, bytes, version) {
      const file = filename(key), lockPath = `${file}.lock`, temporary = `${file}.tmp-${randomUUID()}`;
      let lock;
      try { lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
      catch (error) { if (error.code === 'EEXIST') return false; throw error; }
      try {
        if (digest(await this.get(key)) !== version) return false;
        const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, file);
        const parent = await open(path.dirname(file), constants.O_RDONLY | constants.O_DIRECTORY);
        try { await parent.sync(); } finally { await parent.close(); }
        return true;
      } finally {
        await lock.close();
        await unlink(lockPath);
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    },
    async list(prefix) {
      if (typeof prefix !== 'string' || !prefix.endsWith('/')) fail();
      const base = filename(prefix.slice(0, -1));
      try { await lstat(base); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const found = [];
      async function walk(dir, relative) {
        if ((await lstat(dir)).isSymbolicLink()) fail();
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) fail();
          const key = `${relative}${entry.name}`;
          if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${key}/`);
          else if (entry.isFile()) found.push(key);
          else fail();
          if (found.length > 20000) fail();
        }
      }
      await walk(base, prefix);
      return found.sort();
    },
  };
}
