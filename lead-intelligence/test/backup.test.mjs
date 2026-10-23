import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { encryptStream, decryptSnapshot, downloadVerifiedSnapshot, pgEnvironment } from '../src/backup.mjs';

test('encrypted snapshot roundtrip authenticates bytes and rejects tampering without leaving plaintext', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backup-test-'));
  try {
    const encrypted = join(directory, 'backup.enc'), plain = join(directory, 'dump'), rejected = join(directory, 'rejected');
    const bytes = Buffer.from('synthetic database bytes\nwith Unicode: Δ');
    await encryptStream(Readable.from([bytes]), encrypted, 'ab'.repeat(32));
    const payload = await readFile(encrypted);
    assert.equal(payload.includes(bytes), false);
    await decryptSnapshot(encrypted, plain, 'ab'.repeat(32));
    assert.deepEqual(await readFile(plain), bytes);
    payload[25] ^= 1; await writeFile(encrypted, payload);
    await assert.rejects(decryptSnapshot(encrypted, rejected, 'ab'.repeat(32)), /authentication/);
    await assert.rejects(access(rejected));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('pg_dump credentials use environment fields and a strict protocol', () => {
  const env = pgEnvironment('postgresql://backup_user:fake%24secret@db.internal:5432/umami?sslmode=require', { PATH: '/bin' });
  assert.equal(env.PGUSER, 'backup_user'); assert.equal(env.PGPASSWORD, 'fake$secret');
  assert.equal(env.PGSSLMODE, 'require'); assert.equal(env.PGDATABASE, 'umami');
  assert.throws(() => pgEnvironment('https://db.internal/umami'), /Invalid/);
});

test('snapshot decryption never deletes or overwrites an existing destination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backup-existing-test-'));
  try {
    const encrypted = join(directory, 'backup.enc'), destination = join(directory, 'existing.dump');
    const existing = Buffer.from('existing recovery data that must survive\n\0\xff', 'binary');
    await encryptStream(Readable.from([Buffer.from('new synthetic database bytes')]), encrypted, 'ab'.repeat(32));
    await writeFile(destination, existing);
    await assert.rejects(decryptSnapshot(encrypted, destination, 'ab'.repeat(32)), { code: 'EEXIST' });
    assert.deepEqual(await readFile(destination), existing);
    // Even an unauthentic snapshot cannot make an existing destination ours to remove.
    const damaged = await readFile(encrypted); damaged[25] ^= 1; await writeFile(encrypted, damaged);
    await assert.rejects(decryptSnapshot(encrypted, destination, 'ab'.repeat(32)), { code: 'EEXIST' });
    assert.deepEqual(await readFile(destination), existing);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('backup encryption and restore enforce the same complete encrypted size budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'backup-budget-test-'));
  try {
    const encrypted = join(directory, 'exact.enc'), oversized = join(directory, 'oversized.enc');
    const destination = join(directory, 'restored.dump'), rejected = join(directory, 'rejected.dump');
    const bytes = Buffer.alloc(30, 65), maxBytes = 64; // Includes34bytes of encryption framing.
    await encryptStream(Readable.from([bytes]), encrypted, 'ab'.repeat(32), { maxBytes });
    const saved = await readFile(encrypted); assert.equal(saved.length, maxBytes);
    const store = { readSnapshot: async () => Readable.from([saved]) };
    await downloadVerifiedSnapshot({ store, key: 'synthetic', destination, encryptionKey: 'ab'.repeat(32), maxBytes });
    assert.deepEqual(await readFile(destination), bytes);
    await assert.rejects(encryptStream(Readable.from([Buffer.alloc(31)]), oversized, 'ab'.repeat(32), { maxBytes }), /size limit/);
    await assert.rejects(downloadVerifiedSnapshot({ store, key: 'synthetic', destination: rejected, encryptionKey: 'ab'.repeat(32), maxBytes: maxBytes - 1 }), /size limit/);
    await assert.rejects(access(rejected));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
