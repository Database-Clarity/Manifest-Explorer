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
import { gunzipSync } from 'node:zlib';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_SCRATCH =
  'C:\\Users\\Seleo\\.t3\\userdata\\providers\\antigravity\\ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32\\antigravity-acp\\brain\\630aad88-6d45-4bfe-a537-fe4f7107e4cf\\scratch\\history-build';
const DEFAULT_ACCOUNT_ID = 'c5ec2772673dc72f5e58587ef4c80ff8';
const DEFAULT_BUCKET = 'manifest-history';
const VERSIONS_KEY = 'v1/versions.json';

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
for .json.gz objects. It compares each local file's SHA-256 and size with the
checkpoint and uploads only changed artifacts (buckets, snapshots, and
v1/releases/*.json.gz), with v1/versions.json last. It refuses to upload any
bucket that still contains the old truncated-diff marker "t". It invokes the
project's Wrangler config with --remote.
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

function artifactGroup(key) {
  if (key === VERSIONS_KEY) return 'versions';
  if (key.startsWith('v1/buckets/')) return 'buckets';
  if (key.startsWith('v1/latest-snapshot/')) return 'snapshots';
  if (key.startsWith('v1/releases/')) return 'releases';
  if (key === 'v1/entry-dates.bin.gz') return 'entry-dates';
  return 'other';
}

function megabytes(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/**
 * Guard the published data set: every revision must carry all of its ops.
 * `t` was the old truncation marker and must never appear again.
 */
function scanLosslessRevisions(files) {
  let bucketFiles = 0;
  let revisions = 0;
  let revisionsWithOps = 0;
  let truncatedRevisions = 0;
  let maxDiffOps = 0;
  for (const file of files) {
    if (!file.relative.startsWith('buckets/') || !file.relative.endsWith('.json.gz')) continue;
    bucketFiles += 1;
    const bucket = JSON.parse(gunzipSync(readFileSync(file.full)).toString('utf8'));
    for (const history of Object.values(bucket)) {
      if (!Array.isArray(history)) continue;
      for (const revision of history) {
        revisions += 1;
        if (revision && Object.prototype.hasOwnProperty.call(revision, 't')) {
          truncatedRevisions += 1;
        }
        if (Array.isArray(revision?.d) && revision.d.length > 0) {
          revisionsWithOps += 1;
          maxDiffOps = Math.max(maxDiffOps, revision.d.length);
        }
      }
    }
  }
  if (truncatedRevisions > 0) {
    throw new Error(
      `Refusing to upload: ${truncatedRevisions} revisions still contain the truncated-diff marker "t"`,
    );
  }
  return { bucketFiles, revisions, revisionsWithOps, truncatedRevisions, maxDiffOps };
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
  const binaryGzip = key.endsWith('.bin.gz');
  const args = [
    'r2',
    'object',
    'put',
    `${options.bucket}/${key}`,
    '--remote',
    '--pipe',
    '--force',
    '--content-type',
    binaryGzip ? 'application/octet-stream' : 'application/json',
  ];
  if (key.endsWith('.json.gz') || binaryGzip) args.push('--content-encoding', 'gzip');

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
    const gzip = key.endsWith('.json.gz') || key.endsWith('.bin.gz');
    const contentType = key.endsWith('.bin.gz') ? 'application/octet-stream' : 'application/json';
    if (
      object.http_metadata?.contentType !== contentType ||
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

function readDecoded(file) {
  const bytes = readFileSync(file);
  const gzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return gzip ? gunzipSync(bytes) : bytes;
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
  const latestVersion = versions.versions.reduce(
    (latest, version) => (version.i > latest.i ? version : latest),
    versions.versions[0],
  );
  const releaseKey = `v1/releases/${latestVersion.i}.json.gz`;
  const releaseLocal = path.join(sourceDir, 'releases', `${latestVersion.i}.json.gz`);
  if (!existsSync(releaseLocal)) {
    throw new Error(`Release index is missing locally: ${releaseLocal}`);
  }
  // Wrangler's `get --pipe` decodes objects carrying Content-Encoding: gzip.
  const sunshotRemote = path.join(verifyDir, `sunshot-${hex}.json`);
  const releaseRemote = path.join(verifyDir, `release-${latestVersion.i}.json`);
  await getObjectToFile('v1/versions.json', versionsRemote, options);
  await getObjectToFile(`v1/buckets/DestinyInventoryItemDefinition/${hex}.json.gz`, sunshotRemote, options);
  await getObjectToFile(releaseKey, releaseRemote, options);
  const versionsMatches = (await sha256File(versionsLocal)) === (await sha256File(versionsRemote));
  const sunshotDecodedLocal = gunzipSync(readFileSync(sunshotLocal));
  const sunshotMatches =
    createHash('sha256').update(sunshotDecodedLocal).digest('hex') ===
    (await sha256File(sunshotRemote));
  const releaseDecodedLocal = readDecoded(releaseLocal);
  const releaseDecodedRemote = readDecoded(releaseRemote);
  const releaseMatches =
    createHash('sha256').update(releaseDecodedLocal).digest('hex') ===
    createHash('sha256').update(releaseDecodedRemote).digest('hex');
  if (!versionsMatches) throw new Error('R2 verification failed: v1/versions.json differs from local file');
  if (!sunshotMatches) throw new Error(`R2 verification failed: Sunshot bucket ${hex} differs from local file`);
  if (!releaseMatches) throw new Error(`R2 verification failed: ${releaseKey} differs from local file`);
  const sunshot = JSON.parse(readFileSync(sunshotRemote, 'utf8'));
  if (!Object.prototype.hasOwnProperty.call(sunshot, '2907129557')) {
    throw new Error(`R2 verification failed: Sunshot was absent from bucket ${hex}`);
  }
  const release = JSON.parse(releaseDecodedRemote.toString('utf8'));
  const counts = latestVersion.counts;
  if (
    release.v !== latestVersion.i ||
    !counts ||
    ['a', 'm', 'r', 'u', 'c'].some((kind) => release.totals?.[kind] !== counts[kind])
  ) {
    throw new Error(`R2 verification failed: ${releaseKey} totals do not match versions.json counts`);
  }
  console.log(
    `R2 verification OK: v1/versions.json, Sunshot bucket ${hex}, and ${releaseKey} ` +
      `(${release.totals.a + release.totals.m + release.totals.r} entries) match local artifacts.`,
  );
  return {
    versionsMatches,
    sunshotMatches,
    sunshotBucket: hex,
    releaseMatches,
    releaseVersionIndex: latestVersion.i,
    releaseEntries: release.totals.a + release.totals.m + release.totals.r,
  };
}

async function main(options) {
  ensureOutsideProject(options.scratchDir, 'Scratch directory');
  ensureOutsideProject(options.sourceDir, 'Source directory');
  ensureOutsideProject(options.checkpointFile, 'Checkpoint file');
  const sourceDir = path.resolve(options.sourceDir);
  if (!existsSync(path.join(sourceDir, 'versions.json'))) {
    throw new Error(`Build output is missing: ${path.join(sourceDir, 'versions.json')}`);
  }
  if (!existsSync(path.join(sourceDir, 'entry-dates.bin.gz'))) {
    throw new Error(
      `Build output is missing: ${path.join(sourceDir, 'entry-dates.bin.gz')}; ` +
        'run build-entry-dates.mjs before uploading',
    );
  }
  const versions = JSON.parse(readFileSync(path.join(sourceDir, 'versions.json'), 'utf8'));
  if (versions.schema !== 1 || !Array.isArray(versions.versions)) {
    throw new Error('Build output has an unsupported versions.json schema');
  }
  const missingReleases = versions.versions.filter(
    (version) =>
      !Number.isInteger(version.i) ||
      !existsSync(path.join(sourceDir, 'releases', `${version.i}.json.gz`)),
  );
  if (missingReleases.length > 0) {
    throw new Error(
      `Build output is missing ${missingReleases.length} release index file(s) under ` +
        `${path.join(sourceDir, 'releases')}; run build-releases.mjs before uploading`,
    );
  }
  const allFiles = filesUnder(sourceDir).sort((a, b) => a.relative.localeCompare(b.relative));
  if (!allFiles.length) throw new Error(`No files found under ${sourceDir}`);
  for (const file of allFiles) {
    if (
      !file.relative.endsWith('.json') &&
      !file.relative.endsWith('.json.gz') &&
      file.relative !== 'entry-dates.bin.gz'
    ) {
      throw new Error(`Unexpected history artifact: ${file.relative}`);
    }
  }

  // Fail before any R2 write if the build still contains truncated revisions.
  const lossless = scanLosslessRevisions(allFiles);

  const checkpoint = loadCheckpoint(options.checkpointFile, options.bucket, options.accountId);
  const work = [];
  const groups = ['buckets', 'snapshots', 'releases', 'entry-dates', 'versions', 'other'];
  const changedByGroup = Object.fromEntries(groups.map((group) => [group, 0]));
  const unchangedByGroup = Object.fromEntries(groups.map((group) => [group, 0]));
  const localByGroup = Object.fromEntries(groups.map((group) => [group, 0]));
  const bytesByGroup = Object.fromEntries(groups.map((group) => [group, 0]));
  let skipped = 0;
  let totalBytes = 0;
  let uploadedBytes = 0;
  for (const file of allFiles) {
    const stat = statSync(file.full);
    const hash = await sha256File(file.full);
    const metadata = { size: stat.size, sha256: hash };
    totalBytes += stat.size;
    const key = `v1/${file.relative}`;
    const group = artifactGroup(key);
    localByGroup[group] += 1;
    bytesByGroup[group] += stat.size;
    const prior = checkpoint.objects[key];
    // Content hash only: a rebuild that produces identical bytes must never be
    // re-uploaded just because the file's mtime changed.
    if (!options.force && prior?.sha256 === metadata.sha256 && prior?.size === metadata.size) {
      skipped += 1;
      unchangedByGroup[group] += 1;
      continue;
    }
    uploadedBytes += stat.size;
    changedByGroup[group] += 1;
    work.push({ ...file, key, metadata, group });
  }

  // Commit v1/versions.json last so the API only advertises a new version once
  // every history artifact, including the entry date index, is durable.
  const ordered = [
    ...work.filter((file) => file.group !== 'versions'),
    ...work.filter((file) => file.group === 'versions'),
  ];
  console.log(
    `Uploading ${ordered.length} changed artifacts to ${options.bucket} ` +
      `(${uploadedBytes} bytes); ${skipped} unchanged artifacts will be skipped.`,
  );
  console.log(
    `Changed buckets: ${changedByGroup.buckets}, snapshots: ${changedByGroup.snapshots}, ` +
      `releases: ${changedByGroup.releases}, entry dates: ${changedByGroup['entry-dates']}, ` +
      `versions: ${changedByGroup.versions}; ` +
      `unchanged buckets: ${unchangedByGroup.buckets}, snapshots: ${unchangedByGroup.snapshots}, ` +
      `releases: ${unchangedByGroup.releases}, entry dates: ${unchangedByGroup['entry-dates']}.`,
  );

  let saveQueue = Promise.resolve();
  let pendingSaves = 0;
  const queueSave = () => {
    const snapshot = { ...checkpoint, objects: { ...checkpoint.objects } };
    saveQueue = saveQueue.then(() => saveCheckpoint(options.checkpointFile, snapshot));
    return saveQueue;
  };
  const uploadTask = async (file) => {
    await uploadOne(file.full, file.key, options);
    checkpoint.objects[file.key] = file.metadata;
    pendingSaves += 1;
    if (pendingSaves >= 25) {
      pendingSaves = 0;
      await queueSave();
    }
  };
  await mapLimit(
    ordered.filter((file) => file.group !== 'versions'),
    options.concurrency,
    uploadTask,
  );
  for (const file of ordered.filter((file) => file.group === 'versions')) {
    await uploadTask(file);
  }
  await queueSave();

  const verification = options.verify ? await verifyObjects(options, sourceDir, versions) : null;
  const info = await bucketInfo(options);
  const inventory = verifyObjectInventory(allFiles, await listRemoteObjects(options), options.bucket);
  const report = {
    bucket: options.bucket,
    accountId: options.accountId,
    uploaded: ordered.length,
    skipped,
    changedByGroup,
    unchangedByGroup,
    localByGroup,
    localReleaseFiles: localByGroup.releases,
    localReleaseCompressedMB: megabytes(bytesByGroup.releases),
    localObjectCount: allFiles.length,
    localBytes: totalBytes,
    localCompressedMB: megabytes(totalBytes),
    uploadedBytes,
    uploadedCompressedMB: megabytes(uploadedBytes),
    lossless,
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
