import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Separate from database snapshots. Production credentials must be scoped to a
// private bucket/prefix; no public ACL or signed URL is created here.
export function createObjectStore({ endpoint, region = 'auto', bucket, accessKeyId, secretAccessKey, prefix = 'farpoint/', client }) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket || '')) throw new Error('Invalid backup bucket');
  if (!/^[a-zA-Z0-9/_-]+\/$/.test(prefix) || prefix.includes('..')) throw new Error('Invalid backup prefix');
  if (endpoint) {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Backup endpoint must be an HTTPS origin');
  }
  if (!client && (!accessKeyId || !secretAccessKey)) throw new Error('Backup credentials unavailable');
  const s3 = client || new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2 });
  function key(value) {
    if (typeof value !== 'string' || value.length > 512 || !/^[a-zA-Z0-9/_.-]+$/.test(value) || value.includes('..') || value.startsWith('/')) throw new Error('Invalid object key');
    return prefix + value;
  }
  async function putIfAbsent(name, bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length > 2 * 1024 * 1024) throw new Error('Journal object too large');
    try {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key(name), Body: bytes, ContentType: 'application/octet-stream', IfNoneMatch: '*' }), { abortSignal: AbortSignal.timeout(15000) });
      return true;
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 412) return false;
      throw new Error('Private object write failed');
    }
  }
  async function getWithVersion(name) {
    let response;
    try { response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key(name) }), { abortSignal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Private object read failed'); }
    if (response.ContentLength > 2 * 1024 * 1024) { response.Body?.destroy?.(); throw new Error('Journal object too large'); }
    if (typeof response.ETag !== 'string' || !response.ETag || response.ETag.length > 200 || /[\r\n\0]/.test(response.ETag)) { response.Body?.destroy?.(); throw new Error('Private object version unavailable'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.Body) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { response.Body.destroy?.(); throw new Error('Journal object too large'); }
      chunks.push(chunk);
    }
    return { bytes: Buffer.concat(chunks), version: response.ETag };
  }
  async function get(name) { return (await getWithVersion(name)).bytes; }
  async function putIfMatch(name, bytes, version) {
    if (!name.endsWith('/manifest.json.enc') || !Buffer.isBuffer(bytes) || bytes.length > 2 * 1024 * 1024 || typeof version !== 'string' || !version || version.length > 200 || /[\r\n\0]/.test(version)) throw new Error('Invalid journal inventory update');
    try {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key(name), Body: bytes, ContentType: 'application/octet-stream', IfMatch: version }), { abortSignal: AbortSignal.timeout(15000) });
      return true;
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 412) return false;
      throw new Error('Private journal inventory update failed');
    }
  }
  async function list(name) {
    const result = [], seenKeys = new Set(), seenTokens = new Set(); let continuation, pages = 0;
    const requestedPrefix = key(name);
    do {
      if (++pages > 20) throw new Error('Private object listing exceeds page limit');
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: requestedPrefix, ContinuationToken: continuation, MaxKeys: 1000 }), { abortSignal: AbortSignal.timeout(15000) });
      if (typeof page.IsTruncated !== 'boolean' || !Number.isInteger(page.KeyCount) || page.KeyCount < 0 || page.Prefix !== requestedPrefix || (!Array.isArray(page.Contents) && !(page.Contents === undefined && page.KeyCount === 0))) throw new Error('Incomplete private object listing');
      const items = page.Contents || [];
      if (page.KeyCount !== items.length) throw new Error('Incomplete private object listing');
      for (const item of items) {
        if (typeof item.Key !== 'string' || !item.Key.startsWith(requestedPrefix) || seenKeys.has(item.Key)) throw new Error('Invalid private object listing');
        seenKeys.add(item.Key);
        result.push(item.Key.slice(prefix.length));
      }
      if (result.length > 10000) throw new Error('Private object listing exceeds safety limit');
      continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && (typeof continuation !== 'string' || !continuation || seenTokens.has(continuation))) throw new Error('Incomplete private object listing');
      if (continuation) seenTokens.add(continuation);
    } while (continuation);
    return result;
  }
  return {
    putIfAbsent, get, getWithVersion, putIfMatch, list,
    // Snapshot methods deliberately cannot delete or replace journal objects.
    async putSnapshot(name, body, contentLength) {
      if (!/^snapshots\/\d{4}-\d{2}-\d{2}T[\d-]+Z\/(farpoint_leads|umami)\.dump\.enc$/.test(name)) throw new Error('Invalid snapshot key');
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key(name), Body: body, ContentLength: contentLength, ContentType: 'application/octet-stream', IfNoneMatch: '*' }), { abortSignal: AbortSignal.timeout(300000) });
    },
    async readSnapshot(name) {
      if (!name.startsWith('snapshots/')) throw new Error('Invalid snapshot key');
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key(name) }), { abortSignal: AbortSignal.timeout(300000) });
      return response.Body;
    },
    async removeExpiredSnapshot(name) {
      if (!/^snapshots\/\d{4}-\d{2}-\d{2}T[\d-]+Z\/(farpoint_leads|umami)\.dump\.enc$/.test(name)) throw new Error('Invalid snapshot key');
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key(name) }), { abortSignal: AbortSignal.timeout(15000) });
    }
  };
}

export function objectStoreFromEnv(env = process.env) {
  return createObjectStore({ endpoint: env.BACKUP_S3_ENDPOINT, region: env.BACKUP_S3_REGION || 'auto', bucket: env.BACKUP_S3_BUCKET, accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY, prefix: env.BACKUP_S3_PREFIX || 'farpoint/' });
}
