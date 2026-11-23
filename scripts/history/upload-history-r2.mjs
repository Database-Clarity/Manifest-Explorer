#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_SCRATCH =
  'C:\\Users\\Seleo\\.t3\\userdata\\providers\\antigravity\\ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32\\antigravity-acp\\brain\\630aad88-6d45-4bfe-a537-fe4f7107e4cf\\scratch\\history-build';
const DEFAULT_ACCOUNT_ID = 'c5ec2772673dc72f5e58587ef4c80ff8';
const DEFAULT_BUCKET = 'manifest-history';

function parseArgs(argv) {
  const options = {
    sourceDir: path.join(DEFAULT_SCRATCH, 'v1'),
    checkpointFile: path.join(DEFAULT_SCRATCH, 'r2-upload-checkpoint.json'),
    scratchDir: DEFAULT_SCRATCH,
    bucket: DEFAULT_BUCKET,
    accountId: DEFAULT_ACCOUNT_ID,
    concurrency: 8,
    force: false,
    verify: true,
  };
  const takeValue = (flag, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--source-dir') options.sourceDir = path.resolve(takeValue(arg, i++));
    else if (arg === '--scratch-dir') options.scratchDir = path.resolve(takeValue(arg, i++));
    else if (arg === '--checkpoint-file') options.checkpointFile = path.resolve(takeValue(arg, i++));
    else if (arg === '--bucket') options.bucket = takeValue(arg, i++);
    else if (arg === '--account-id') options.accountId = takeValue(arg, i++);
    else if (arg === '--concurrency') options.concurrency = Number(takeValue(arg, i++));
    else if (arg === '--force') options.force = true;
    else if (arg === '--no-verify') options.verify = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^[a-z0-9-]{3,63}$/.test(options.bucket)) throw new Error('Invalid R2 bucket name');
  if (!/^[a-f0-9]{32}$/i.test(options.accountId)) throw new Error('Invalid Cloudflare account ID');
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 32) {
    throw new Error('--concurrency must be an integer from 1 to 32');
  }
  return options;
}

function help() {
  console.log(`Upload built v1 artifacts to Cloudflare R2 with a resumable local checkpoint.

Usage:
  node scripts/history/upload-history-r2.mjs
    [--source-dir <dir>] [--scratch-dir <dir>]
    [--checkpoint-file <file>] [--bucket manifest-history]
    [--account-id <id>] [--concurrency 8] [--force] [--no-verify]

The uploader sets application/json for JSON objects and gzip content-encoding
for .json.gz objects. It invokes the project's Wrangler config with --remote.
`);
}

function ensureOutsideProject(target, label) {
  const relative = path.relative(PROJECT_ROOT, path.resolve(target));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error(`${label} must be outside the repository: ${target}`);
  }
}

function mkdirp(directory) {
  mkdirSync(directory, { recursive: true });
}

function filesUnder(directory, relative = '') {
  const result = [];
  for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    const full = path.join(directory, child);
    if (entry.isDirectory()) result.push(...filesUnder(directory, child));
    else if (entry.isFile()) result.push({ full, relative: child.replaceAll('\\', '/') });
  }
  return result;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function loadCheckpoint(file, bucket, accountId) {
  if (!existsSync(file)) return { schema: 1, bucket, accountId, objects: {} };
  const checkpoint = JSON.parse(readFileSync(file, 'utf8'));
  if (checkpoint.bucket !== bucket || checkpoint.accountId !== accountId) {
    throw new Error(`Checkpoint ${file} belongs to a different bucket or account`);
  }
  if (!checkpoint.objects || typeof checkpoint.objects !== 'object') checkpoint.objects = {};
  return checkpoint;
}

function saveCheckpoint(file, checkpoint) {
  mkdirp(path.dirname(file));
  const temporary = `${file}.part`;
  writeFileSync(temporary, JSON.stringify(checkpoint, null, 2));
  rmSync(file, { force: true });
  renameSync(temporary, file);
}

function spawnWrangler(args, options, mode) {
  const onWindows = process.platform === 'win32';
  const npxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const executable = onWindows ? process.execPath : 'npx';
  const invocationArgs = [
    ...(onWindows ? [npxCli] : []),
    '--yes',
    'wrangler',
    '--config=wrangler.jsonc',
    ...args,
  ];
  const child = spawn(executable, invocationArgs, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: options.accountId },
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-6000);
  });
  if (mode === 'upload') child.stdout.resume();
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Wrangler exited ${code ?? signal}: ${stderr.trim()}`));
    });
  });
  return { child, completed, stderr: () => stderr, mode };
}

async function uploadOne(file, key, options) {
  const args = [
    'r2',
    'object',
    'put',
    `${options.bucket}/${key}`,
    '--remote',
    '--pipe',
    '--force',
    '--content-type',
    'application/json',
  ];
  if (key.endsWith('.json.gz')) args.push('--content-encoding', 'gzip');

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { child, completed } = spawnWrangler(args, options, 'upload');
    const inputDone = pipeline(createReadStream(file), child.stdin);
    const settled = await Promise.allSettled([completed, inputDone]);
    try {
      if (settled[0].status === 'rejected') throw settled[0].reason;
      if (settled[1].status === 'rejected') throw settled[1].reason;
      return;
    } catch (error) {
      if (attempt === 3 || error.code === 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }
}

async function getObjectToFile(key, file, options) {
  const args = ['r2', 'object', 'get', `${options.bucket}/${key}`, '--remote', '--pipe'];
  const { child, completed } = spawnWrangler(args, options, 'download');
  mkdirp(path.dirname(file));
  const output = createWriteStream(file);
  const outputDone = pipeline(child.stdout, output);
  const settled = await Promise.allSettled([completed, outputDone]);
  if (settled[0].status === 'rejected') throw settled[0].reason;
  if (settled[1].status === 'rejected') throw settled[1].reason;
}

async function bucketInfo(options) {
  const args = ['r2', 'bucket', 'info', options.bucket, '--json'];
  const { child, completed, stderr } = spawnWrangler(args, options, 'info');
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${chunk}`;
  });
  await completed;
  try {
    const start = stdout.indexOf('{');
    return JSON.parse(stdout.slice(start));
  } catch {
    throw new Error(`Could not parse Wrangler bucket info JSON: ${stderr()}`);
  }
}

function cloudflareApiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const roaming = process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming');
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? (
    process.platform === 'win32'
      ? path.join(roaming, 'xdg.config')
      : path.join(homedir(), '.config')
  );
  const candidates = [
    path.join(xdgConfig, '.wrangler', 'config', 'default.toml'),
    path.join(homedir(), '.wrangler', 'config', 'default.toml'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const config = readFileSync(file, 'utf8');
    const match =
      config.match(/^\s*oauth_token\s*=\s*"([^"\r\n]+)"\s*$/m) ??
      config.match(/^\s*oauth_token\s*=\s*'([^'\r\n]+)'\s*$/m);
    if (match?.[1]) return match[1];
  }
  throw new Error(
    'Cloudflare API token unavailable for exact R2 object listing; set CLOUDFLARE_API_TOKEN or log in with Wrangler.',
  );
}

async function listRemoteObjects(options) {
  const token = cloudflareApiToken();
  const objects = [];
  let cursor;
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/r2/buckets/${options.bucket}/objects`,
    );
    url.searchParams.set('prefix', 'v1/');
    url.searchParams.set('per_page', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Cloudflare R2 object listing failed (HTTP ${response.status})`);
    }
    const body = await response.json();
    if (!body.success) {
      const errors = (body.errors ?? []).map((error) => error.message).join('; ');
      throw new Error(`Cloudflare R2 object listing failed: ${errors || 'unknown API error'}`);
    }
    objects.push(...(body.result ?? []));
    if (!body.result_info?.is_truncated) return objects;
    cursor = body.result_info.cursor;
    if (!cursor) throw new Error('Cloudflare R2 object listing was truncated without a cursor');
  }
  throw new Error('Cloudflare R2 object listing exceeded 100 pages');
}

function verifyObjectInventory(localFiles, remoteObjects, bucket) {
  const expected = new Map(localFiles.map((file) => [
    `v1/${file.relative}`,
    statSync(file.full).size,
  ]));
  const actual = new Map(remoteObjects.map((object) => [object.key, object]));
  const missing = [...expected.keys()].filter((key) => !actual.has(key));
  const extra = [...actual.keys()].filter((key) => !expected.has(key));
  let sizeMismatches = 0;
  let metadataMismatches = 0;
  for (const [key, size] of expected) {
    const object = actual.get(key);
    if (!object) continue;
    if (object.size !== size) sizeMismatches += 1;
    const gzip = key.endsWith('.json.gz');
    if (
      object.http_metadata?.contentType !== 'application/json' ||
      (gzip
        ? object.http_metadata?.contentEncoding !== 'gzip'
        : Boolean(object.http_metadata?.contentEncoding))
    ) {
      metadataMismatches += 1;
    }
  }
  if (missing.length || extra.length || sizeMismatches || metadataMismatches) {
    throw new Error(
      `R2 inventory mismatch for ${bucket}: missing=${missing.length}, extra=${extra.length}, ` +
        `size=${sizeMismatches}, metadata=${metadataMismatches}`,
    );
  }
  return {
    prefix: 'v1/',
    objectCount: actual.size,
    expectedObjectCount: expected.size,
    missing: 0,
    extra: 0,
    sizeMismatches: 0,
    metadataMismatches: 0,
  };
}

async function mapLimit(items, limit, worker) {
  let next = 0;
  let finished = 0;
  let failure;
  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try {
        await worker(items[index]);
        finished += 1;
        if (finished === items.length || finished % 25 === 0) {
          console.log(`R2 uploads: ${finished}/${items.length}`);
        }
      } catch (error) {
        failure = error;
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
}

async function verifyObjects(options, sourceDir, versions) {
  const verifyDir = path.join(options.scratchDir, 'r2-verify');
  const versionsLocal = path.join(sourceDir, 'versions.json');
  const versionsRemote = path.join(verifyDir, 'versions.json');
  const definitions = versions.buckets?.DestinyInventoryItemDefinition;
  if (!Number.isInteger(definitions) || definitions < 1) {
    throw new Error('versions.json does not declare DestinyInventoryItemDefinition buckets');
  }
  const bucket = (2907129557 >>> 0) % definitions;
  const hex = bucket.toString(16).padStart(definitions > 256 ? 3 : 2, '0');
  const sunshotLocal = path.join(
    sourceDir,
    'buckets',
    'DestinyInventoryItemDefinition',
    `${hex}.json.gz`,
  );
  // Wrangler's `get --pipe` decodes objects carrying Content-Encoding: gzip.
  const sunshotRemote = path.join(verifyDir, `sunshot-${hex}.json`);
  await getObjectToFile('v1/versions.json', versionsRemote, options);
  await getObjectToFile(`v1/buckets/DestinyInventoryItemDefinition/${hex}.json.gz`, sunshotRemote, options);
  const versionsMatches = (await sha256File(versionsLocal)) === (await sha256File(versionsRemote));
  const sunshotDecodedLocal = (await import('node:zlib')).gunzipSync(readFileSync(sunshotLocal));
  const sunshotMatches =
    createHash('sha256').update(sunshotDecodedLocal).digest('hex') ===
    (await sha256File(sunshotRemote));
  if (!versionsMatches) throw new Error('R2 verification failed: v1/versions.json differs from local file');
  if (!sunshotMatches) throw new Error(`R2 verification failed: Sunshot bucket ${hex} differs from local file`);
  const sunshot = JSON.parse(readFileSync(sunshotRemote, 'utf8'));
  if (!Object.prototype.hasOwnProperty.call(sunshot, '2907129557')) {
    throw new Error(`R2 verification failed: Sunshot was absent from bucket ${hex}`);
  }
  console.log(`R2 verification OK: v1/versions.json and Sunshot bucket ${hex} match local artifacts.`);
  return { versionsMatches, sunshotMatches, sunshotBucket: hex };
}

async function main(options) {
  ensureOutsideProject(options.scratchDir, 'Scratch directory');
  ensureOutsideProject(options.sourceDir, 'Source directory');
  ensureOutsideProject(options.checkpointFile, 'Checkpoint file');
  const sourceDir = path.resolve(options.sourceDir);
  if (!existsSync(path.join(sourceDir, 'versions.json'))) {
    throw new Error(`Build output is missing: ${path.join(sourceDir, 'versions.json')}`);
  }
  const versions = JSON.parse(readFileSync(path.join(sourceDir, 'versions.json'), 'utf8'));
  if (versions.schema !== 1 || !Array.isArray(versions.versions)) {
    throw new Error('Build output has an unsupported versions.json schema');
  }
  const allFiles = filesUnder(sourceDir).sort((a, b) => a.relative.localeCompare(b.relative));
  if (!allFiles.length) throw new Error(`No files found under ${sourceDir}`);
  for (const file of allFiles) {
    if (!file.relative.endsWith('.json') && !file.relative.endsWith('.json.gz')) {
      throw new Error(`Unexpected non-JSON artifact: ${file.relative}`);
    }
  }

  const checkpoint = loadCheckpoint(options.checkpointFile, options.bucket, options.accountId);
  const work = [];
  let skipped = 0;
  let bytes = 0;
  for (const file of allFiles) {
    const stat = statSync(file.full);
    const hash = await sha256File(file.full);
    const metadata = { size: stat.size, mtimeMs: stat.mtimeMs, sha256: hash };
    bytes += stat.size;
    const key = `v1/${file.relative}`;
    const prior = checkpoint.objects[key];
    if (
      !options.force &&
      prior?.size === metadata.size &&
      prior?.mtimeMs === metadata.mtimeMs &&
      prior?.sha256 === metadata.sha256
    ) {
      skipped += 1;
      continue;
    }
    work.push({ ...file, key, metadata });
  }
  console.log(
    `Uploading ${work.length} artifacts to ${options.bucket}; ${skipped} unchanged checkpoint entries will be skipped.`,
  );

  let saveQueue = Promise.resolve();
  await mapLimit(work, options.concurrency, async (file) => {
    await uploadOne(file.full, file.key, options);
    checkpoint.objects[file.key] = file.metadata;
    saveQueue = saveQueue.then(() => saveCheckpoint(options.checkpointFile, checkpoint));
    await saveQueue;
  });
  await saveQueue;

  const verification = options.verify ? await verifyObjects(options, sourceDir, versions) : null;
  const info = await bucketInfo(options);
  const inventory = verifyObjectInventory(allFiles, await listRemoteObjects(options), options.bucket);
  const report = {
    bucket: options.bucket,
    accountId: options.accountId,
    uploaded: work.length,
    skipped,
    localObjectCount: allFiles.length,
    localBytes: bytes,
    remoteObjectCount: inventory.objectCount,
    objectInventory: inventory,
    bucketInfoObjectCount: Number(info.object_count),
    remoteBucketBytes: info.bucket_size,
    verified: verification,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(options.scratchDir, 'r2-upload-report.json'), JSON.stringify(report, null, 2));
  console.log('\nR2 upload complete:');
  console.log(JSON.stringify(report, null, 2));
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) help();
  else await main(options);
} catch (error) {
  console.error(error.stack ?? error.message ?? String(error));
  process.exitCode = 1;
}
