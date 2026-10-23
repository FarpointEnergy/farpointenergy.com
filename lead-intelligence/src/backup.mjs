import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const MAGIC = Buffer.from('FPBK01');
function secretKey(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('Backup encryption key must be 32 bytes encoded as hex');
  return Buffer.from(value, 'hex');
}
export function pgEnvironment(connectionString, env = process.env) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database URL');
  // Credentials never appear in argv, output, object names or manifests.
  return { PATH: env.PATH, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get('sslmode') || 'require', PGCONNECT_TIMEOUT: '10' };
}
export async function encryptStream(source, file, hexKey) {
  const nonce = randomBytes(12);
  const header = Buffer.concat([MAGIC, nonce]);
  const cipher = createCipheriv('aes-256-gcm', secretKey(hexKey), nonce);
  cipher.setAAD(MAGIC);
  const handle = await open(file, 'wx', 0o600);
  await handle.write(header); await handle.close();
  await pipeline(source, cipher, createWriteStream(file, { flags: 'a', mode: 0o600 }));
  await appendFile(file, cipher.getAuthTag());
  const saved = await open(file, 'r'); await saved.sync(); await saved.close();
}
export async function decryptSnapshot(file, destination, hexKey) {
  const info = await stat(file);
  if (info.size < MAGIC.length + 12 + 16) throw new Error('Invalid encrypted snapshot');
  const handle = await open(file, 'r');
  const header = Buffer.alloc(MAGIC.length + 12), tag = Buffer.alloc(16);
  await handle.read(header, 0, header.length, 0); await handle.read(tag, 0, tag.length, info.size - 16); await handle.close();
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid encrypted snapshot');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(hexKey), header.subarray(MAGIC.length));
  decipher.setAAD(MAGIC); decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(file, { start: header.length, end: info.size - 17 }), decipher, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  } catch { await rm(destination, { force: true }); throw new Error('Snapshot authentication failed'); }
}
async function hashStream(stream) {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}
async function dumpDatabase(connectionString, file, key) {
  const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], { env: pgEnvironment(connectionString), stdio: ['ignore', 'pipe', 'pipe'] });
  // pg_dump errors can contain connection data. Consume without printing.
  child.stderr.resume();
  const completion = new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error('Database backup process unavailable')));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('Database backup failed')));
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 300000);
  try { await Promise.all([encryptStream(child.stdout, file, key), completion]); }
  finally { clearTimeout(timeout); if (child.exitCode === null) child.kill('SIGTERM'); }
}
export async function backupDatabases({ store, databases, encryptionKey, now = new Date() }) {
  secretKey(encryptionKey);
  if (!databases.farpoint_leads || !databases.umami || Object.keys(databases).length !== 2) throw new Error('Both databases are required');
  const directory = await mkdtemp(join(tmpdir(), 'farpoint-backup-'));
  const stamp = now.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
  const results = [];
  try {
    for (const [name, url] of Object.entries(databases)) {
      const file = join(directory, `${name}.dump.enc`), key = `snapshots/${stamp}/${name}.dump.enc`;
      await dumpDatabase(url, file, encryptionKey);
      const checksum = await hashStream(createReadStream(file));
      await store.putSnapshot(key, createReadStream(file), (await stat(file)).size);
      if (await hashStream(await store.readSnapshot(key)) !== checksum) throw new Error('Remote snapshot read-back verification failed');
      results.push({ database: name, key, sha256: checksum });
    }
    // Only prune after both snapshots have been read back successfully. Seven-day
    // expiry is independent of the separately retained deletion journal.
    for (const key of await store.list('snapshots/')) {
      const match = /^snapshots\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\/(farpoint_leads|umami)\.dump\.enc$/.exec(key);
      if (match && Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`) < now.getTime() - 7 * 86400000) await store.removeExpiredSnapshot(key);
    }
    return results;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

// Explicit operator command only: download and authenticate before pg_restore.
// Never stream unauthenticated plaintext into a database.
export async function downloadVerifiedSnapshot({ store, key, destination, encryptionKey }) {
  const directory = await mkdtemp(join(tmpdir(), 'farpoint-restore-'));
  const encrypted = join(directory, 'snapshot.enc');
  let count = 0;
  const cap = new Transform({ transform(chunk, encoding, callback) { count += chunk.length; callback(count > 1024 * 1024 * 1024 ? new Error('Snapshot exceeds 1 GiB restore limit') : null, chunk); } });
  try {
    await pipeline(await store.readSnapshot(key), cap, createWriteStream(encrypted, { flags: 'wx', mode: 0o600 }));
    await decryptSnapshot(encrypted, destination, encryptionKey);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
