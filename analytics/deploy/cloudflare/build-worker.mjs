import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const destination = process.argv[2];
if (!destination || !destination.startsWith('/')) throw new Error('Absolute artifact directory required');
const core = await readFile(resolve(here, '../../collector/core.mjs'), 'utf8');
const probe = await readFile(resolve(here, 'ip-probe.mjs'), 'utf8');
const wrapper = await readFile(resolve(here, 'wrapper.mjs'), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHash = hash(core + '\0' + probe + '\0' + wrapper);
const sourceVersion = 'farpoint-cloudflare-collector/1.0.0+' + sourceHash;
const source = `const BUILD_SOURCE_VERSION = ${JSON.stringify(sourceVersion)};\n${core}\n${probe}\n${wrapper}`;
const workerPath = resolve(destination, `collector-${sourceHash}.mjs`);
const manifestPath = resolve(destination, `collector-${sourceHash}.manifest.json`);
const manifest = {
  format_version: 1,
  source_version: sourceVersion,
  core_sha256: hash(core),
  probe_sha256: hash(probe),
  wrapper_sha256: hash(wrapper),
  core_and_wrapper_sha256: sourceHash,
  worker_sha256: hash(source),
  worker_bytes: Buffer.byteLength(source),
  output: workerPath,
  public_export_enabled: false,
  default_ip_attribution_enabled: false
};
await mkdir(destination, {recursive: true});
async function writeIdenticalOrCreate(path, content) {
  try { await writeFile(path, content, {flag: 'wx'}); }
  catch (error) {
    if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== content) throw error;
  }
}
await writeIdenticalOrCreate(workerPath, source);
await writeIdenticalOrCreate(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({...manifest, manifest: manifestPath}));
