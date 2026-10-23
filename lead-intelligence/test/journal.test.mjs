import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDeletionJournal, createLocalJournalStore } from '../src/journal.mjs';

function memoryStore() {
  const objects = new Map();
  return {
    objects,
    async putIfAbsent(key, bytes) { if (objects.has(key)) return false; objects.set(key, Buffer.from(bytes)); return true; },
    async get(key) { if (!objects.has(key)) throw new Error('Object unavailable'); return Buffer.from(objects.get(key)); },
    async getWithVersion(key) { const bytes = await this.get(key); return { bytes, version: createHash('sha256').update(bytes).digest('hex') }; },
    async putIfMatch(key, bytes, version) { if (!objects.has(key) || createHash('sha256').update(objects.get(key)).digest('hex') !== version) return false; objects.set(key, Buffer.from(bytes)); return true; },
    async list(prefix) { return [...objects.keys()].filter(key => key.startsWith(prefix)); },
  };
}
async function fixture() {
  const store = memoryStore(), key = randomBytes(32), now = new Date();
  const value = { requestId: randomUUID(), requestedAt: now.toISOString(), websiteId: randomUUID(), browserIds: [randomUUID()], inquiryIds: [randomUUID()], gmailMessageIds: ['18abcDef0'] };
  const installationId = randomUUID();
  const journal = createDeletionJournal({ store, key, websiteId: value.websiteId, installationId });
  await journal.initialize();
  return { store, key, now, value, installationId, journal };
}
test('journal verifies immutable encrypted requests and completion, preserving exact Gmail IDs', async () => {
  const { store, now, value, installationId, journal } = await fixture();
  const item = await journal.writeRequest(value);
  assert.deepEqual(await journal.writeRequest(value), item);
  assert.equal(store.objects.size, 2);
  for (const bytes of store.objects.values()) {
    assert.ok(!bytes.toString().includes(value.browserIds[0]));
    assert.ok(!bytes.toString().includes(value.gmailMessageIds[0]));
  }
  await journal.writeCompletion(item, now);
  await journal.writeCompletion(item, new Date(now.getTime() + 1000));
  assert.equal(store.objects.size, 3);
  assert.deepEqual(await journal.readRequests({ now, websiteId: value.websiteId }), [item]);
  assert.deepEqual(await journal.readRequests({ now: new Date(now.getTime() + 101 * 86400000) }), []);
  await assert.rejects(journal.writeRequest({ ...value, browserIds: [randomUUID()] }), /validation failed/);
});
test('journal rejects tampering, wrong keys, swapped objects and incomplete listings', async () => {
  const { store, now, value, installationId, journal } = await fixture();
  await journal.writeRequest(value);
  const [objectKey, bytes] = [...store.objects.entries()].find(([key]) => key.includes('/requests/'));
  const envelope = JSON.parse(bytes);
  envelope.tag = randomBytes(16).toString('base64');
  store.objects.set(objectKey, Buffer.from(JSON.stringify(envelope)));
  await assert.rejects(journal.readRequests({ now }), /validation failed/);
  store.objects.set(objectKey, bytes);
  await assert.rejects(createDeletionJournal({ store, key: randomBytes(32), websiteId: value.websiteId, installationId }).readRequests({ now }), /validation failed/);
  store.objects.delete(objectKey);
  store.objects.set(objectKey.replace(value.requestId, randomUUID()), bytes);
  await assert.rejects(journal.readRequests({ now }), /unavailable/);
});
test('failed durable write or read-back never acknowledges journal persistence', async () => {
  const { store, value, key, installationId } = await fixture();
  const readFailure = createDeletionJournal({ key, websiteId: value.websiteId, installationId, store: { ...store, get: async () => { throw new Error('read failed'); } } });
  await assert.rejects(readFailure.writeRequest(value), /read failed/);
  const writeFailure = createDeletionJournal({ key, websiteId: value.websiteId, installationId, store: { ...store, putIfAbsent: async () => { throw new Error('write failed'); } } });
  await assert.rejects(writeFailure.writeRequest(value), /write failed/);
});
test('a missing independent journal cannot masquerade as an empty restore journal', async () => {
  const store = memoryStore(), key = randomBytes(32), websiteId = randomUUID(), installationId = randomUUID(), journal = createDeletionJournal({ store, key, websiteId, installationId });
  await assert.rejects(journal.readRequests(), /unavailable/);
  await journal.initialize();
  assert.deepEqual(await journal.readRequests(), []);
  assert.deepEqual(await createDeletionJournal({ store: { ...store, list: async () => [] }, key, websiteId, installationId }).readRequests(), []);
  store.objects.clear();
  await assert.rejects(journal.readRequests(), /unavailable/);
});
test('unknown fields, noncanonical UUIDs, unsafe prefixes and future requests reject', async () => {
  const { store, key, now, value, installationId, journal } = await fixture();
  await assert.rejects(journal.writeRequest({ ...value, customerName: 'not permitted' }), /validation failed/);
  await assert.rejects(journal.writeRequest({ ...value, browserIds: ['not-a-uuid'] }), /validation failed/);
  assert.throws(() => createDeletionJournal({ store, key, websiteId: value.websiteId, installationId, prefix: '../' }), /validation failed/);
  await assert.rejects(journal.writeRequest({ ...value, requestedAt: new Date(now.getTime() + 120000).toISOString() }), /validation failed/);
});
test('bound inventory rejects wrong site/installation and a lost incomplete request; listing omission cannot hide it', async () => {
  const { store, key, value, installationId, journal } = await fixture();
  await journal.writeRequest(value);
  const noListing = createDeletionJournal({ store: { ...store, list: async () => [] }, key, websiteId: value.websiteId, installationId });
  assert.equal((await noListing.readRequests()).length, 1);
  await assert.rejects(journal.readRequests({ websiteId: randomUUID() }), /validation failed/);
  await assert.rejects(createDeletionJournal({ store, key, websiteId: randomUUID(), installationId }).readRequests(), /validation failed/);
  await assert.rejects(createDeletionJournal({ store, key, websiteId: value.websiteId, installationId: randomUUID() }).readRequests(), /validation failed/);
  store.objects.delete(`deletion-journal/requests/${value.requestId}.json.enc`);
  await assert.rejects(journal.readRequests(), /unavailable/);
});
test('CAS retries retain concurrent requests and failed registration never acknowledges an erasure', async () => {
  const { store, key, value, installationId, journal } = await fixture();
  let calls = 0;
  const contested = createDeletionJournal({ key, websiteId: value.websiteId, installationId, store: {
    ...store,
    async putIfMatch(name, bytes, version) { if (++calls === 1) return false; return store.putIfMatch(name, bytes, version); },
  } });
  await contested.writeRequest(value);
  assert.equal(calls, 2);
  await Promise.all(Array.from({ length: 4 }, () => journal.writeRequest({ ...value, requestId: randomUUID() })));
  assert.equal((await journal.readRequests()).length, 5);
  const blocked = createDeletionJournal({ key, websiteId: value.websiteId, installationId, store: { ...store, putIfMatch: async () => false } });
  await assert.rejects(blocked.writeRequest({ ...value, requestId: randomUUID() }), /update conflicted/);
  assert.equal((await journal.readRequests()).length, 5);
  await journal.pruneExpired({ now: new Date(Date.parse(value.requestedAt) + 101 * 86400000) });
  for (const name of store.objects.keys()) if (name.includes('/requests/')) store.objects.delete(name);
  assert.deepEqual(await journal.readRequests(), []);
});
test('development filesystem store fsyncs private immutable objects and detects corruption', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'farpoint-journal-'));
  try {
    assert.throws(() => createLocalJournalStore({ directory }), /development-only/);
    const { key, value, now, installationId } = await fixture();
    const store = createLocalJournalStore({ directory, developmentOnly: true });
    const journal = createDeletionJournal({ store, key, websiteId: value.websiteId, installationId });
    await journal.initialize();
    const record = await journal.writeRequest(value);
    const name = (await store.list('deletion-journal/')).find(key => key.includes('/requests/'));
    assert.equal((await stat(path.join(directory, name))).mode & 0o777, 0o600);
    assert.deepEqual(await journal.readRequests({ now }), [record]);
    await assert.rejects(store.putIfAbsent('../escape', Buffer.from('x')), /validation failed/);
    await writeFile(path.join(directory, name), 'partial');
    await assert.rejects(journal.readRequests({ now }), /validation failed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
