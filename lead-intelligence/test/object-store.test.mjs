import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createObjectStore } from '../src/object-store.mjs';

test('journal writes are conditional and private; snapshot cleanup cannot delete a journal', async () => {
  const calls = [];
  const client = { async send(command) { calls.push(command.input); return {}; } };
  const store = createObjectStore({ bucket: 'farpoint-test', prefix: 'qa/', client });
  assert.equal(await store.putIfAbsent('deletion-journal/requests/example.enc', Buffer.from('encrypted')), true);
  assert.equal(calls[0].IfNoneMatch, '*'); assert.equal(calls[0].ACL, undefined);
  await assert.rejects(store.removeExpiredSnapshot('deletion-journal/requests/example.enc'));
  await assert.rejects(store.putIfAbsent('../public', Buffer.from('no')));
  assert.equal(calls.length, 1);
});

test('oversized or incomplete object data fails closed', async () => {
  const store = createObjectStore({ bucket: 'farpoint-test', client: { async send() { return { ContentLength: 3 * 1024 * 1024, Body: Readable.from([]) }; } } });
  await assert.rejects(store.get('deletion-journal/requests/example.enc'), /too large/);
  const badList = createObjectStore({ bucket: 'farpoint-test', client: { async send() { return { IsTruncated: true, Contents: [] }; } } });
  await assert.rejects(badList.list('deletion-journal/'), /Incomplete/);
});

test('CAS inventory uses the fetched object version and reports conflicts without overwriting', async () => {
  const calls = [];
  const client = { async send(command) {
    calls.push(command.input);
    if (command.constructor.name === 'GetObjectCommand') return { ETag: '"version-1"', ContentLength: 3, Body: Readable.from([Buffer.from('old')]) };
    if (command.input.IfMatch === '"stale"') throw { $metadata: { httpStatusCode: 412 } };
    return {};
  } };
  const store = createObjectStore({ bucket: 'farpoint-test', client });
  const prior = await store.getWithVersion('deletion-journal/manifest.json.enc');
  assert.equal(prior.version, '"version-1"');
  assert.equal(await store.putIfMatch('deletion-journal/manifest.json.enc', Buffer.from('new'), prior.version), true);
  assert.equal(calls[1].IfMatch, prior.version);
  assert.equal(await store.putIfMatch('deletion-journal/manifest.json.enc', Buffer.from('new'), '"stale"'), false);
  await assert.rejects(store.putIfMatch('deletion-journal/requests/a.enc', Buffer.from('bad'), prior.version));
});

test('listing validates every page, namespace and advancing continuation token', async () => {
  const page = { Prefix: 'farpoint/deletion-journal/', IsTruncated: false, KeyCount: 1, Contents: [{ Key: 'farpoint/deletion-journal/manifest.json.enc' }] };
  const good = createObjectStore({ bucket: 'farpoint-test', client: { async send() { return page; } } });
  assert.deepEqual(await good.list('deletion-journal/'), ['deletion-journal/manifest.json.enc']);
  for (const invalid of [{ ...page, IsTruncated: undefined }, { ...page, KeyCount: 2 }, { ...page, Contents: undefined }, { ...page, Prefix: 'other/' }, { ...page, Contents: [{ Key: 'farpoint/snapshots/a' }] }]) {
    const store = createObjectStore({ bucket: 'farpoint-test', client: { async send() { return invalid; } } });
    await assert.rejects(store.list('deletion-journal/'));
  }
  const looping = createObjectStore({ bucket: 'farpoint-test', client: { async send() { return { Prefix: page.Prefix, IsTruncated: true, KeyCount: 0, NextContinuationToken: 'same' }; } } });
  await assert.rejects(looping.list('deletion-journal/'), /Incomplete/);
});
