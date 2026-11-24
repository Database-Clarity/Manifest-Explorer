#!/usr/bin/env node
import { createHash, createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { generateReleases } from './build-releases.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_SCRATCH =
  'C:\\Users\\Seleo\\.t3\\userdata\\providers\\antigravity\\ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32\\antigravity-acp\\brain\\630aad88-6d45-4bfe-a537-fe4f7107e4cf\\scratch\\history-build';
const DEFAULT_DOWNLOADS = 'C:\\Users\\Seleo\\Downloads';
const LOCAL_SOURCES = [
  { name: 'manifests.zip', mode: 'english' },
  { name: 'Manifests_2018-10-30_2018-11-27.zip', mode: 'english' },
  { name: 'Manifests_2019-01-19_2020-02-13.zip', mode: 'all-world' },
];
const S3_ENDPOINT = 'https://storage.manifest.report';
const S3_BUCKET = 'manifest-archive';
const S3_ACCESS_KEY = 'manifest-report-readonly';
const OMIT_TABLES = new Set(['DestinyInventoryItemLiteDefinition']);
const SUNSHOT_HASH = 2907129557;
const STAGE_STATEMENTS = new WeakMap();

const PYTHON_ARCHIVE_HELPER = String.raw`
import hashlib, io, json, os, re, sys, zipfile
from pathlib import Path

args = json.load(sys.stdin)
mode = args['mode']

def ignored(name):
    normalized = name.replace('\\', '/').lower()
    return '__macosx/' in normalized or '/__macosx/' in normalized or Path(name).name.startswith('._')

def looks_like_world_zip(name):
    return Path(name).name.lower().startswith('world_sql_content_') and name.lower().endswith('.zip')

def date_text(info):
    y, m, d, *_ = info.date_time
    return f'{y:04d}-{m:02d}-{d:02d}T00:00:00.000Z'

def timestamp_text(info):
    y, m, d, hh, mm, ss = info.date_time
    return f'{y:04d}-{m:02d}-{d:02d}T{hh:02d}:{mm:02d}:{ss:02d}.000Z'

def version_from_path(name):
    parts = name.replace('\\', '/').split('/')
    for part in parts:
        if re.match(r'^\d+\.\d{2}\.\d{2}\.\d{2}\.\d+-\d+$', part):
            return part
    return None

def digest_from_name(name):
    match = re.search(r'world_sql_content_([0-9a-fA-F]{32})(?:-\d+)?\.zip$', Path(name).name)
    return match.group(1).lower() if match else None

def list_candidates():
    found = []
    serial = 0
    for spec in args['sources']:
        archive = spec['path']
        if not os.path.isfile(archive):
            continue
        try:
            outer = zipfile.ZipFile(archive)
        except (zipfile.BadZipFile, OSError):
            continue
        with outer:
            for info in outer.infolist():
                name = info.filename
                if ignored(name) or not looks_like_world_zip(name):
                    continue
                normalized = name.replace('\\', '/')
                if spec['mode'] == 'english' and '/en/' not in normalized.lower():
                    continue
                if spec['mode'] == 'all-world' and '/' in normalized.strip('/'):
                    # The 2019 bundle has the English SQLite zips at the archive root.
                    continue
                if spec.get('mode') == 'extra-english' and '/en/' not in normalized.lower():
                    continue
                serial += 1
                stamp = date_text(info)
                timestamp = timestamp_text(info)
                file_id = digest_from_name(name)
                found.append({
                    'archive': archive,
                    'member': name,
                    'zipDate': stamp,
                    'timestamp': timestamp,
                    'id': file_id,
                    'version': version_from_path(name),
                    'sourceArchive': spec.get('label', Path(archive).name),
                    'serial': serial,
                })

    # Extra ZIPs may be individual world_sql_content ZIPs or an outer bundle.
    for extra_dir in args.get('extraDirs', []):
        root = Path(extra_dir)
        if not root.exists():
            continue
        for candidate in sorted(root.rglob('*.zip')):
            if ignored(str(candidate)):
                continue
            try:
                zf = zipfile.ZipFile(candidate)
            except (zipfile.BadZipFile, OSError):
                continue
            with zf:
                names = [i for i in zf.infolist() if not ignored(i.filename) and looks_like_world_zip(i.filename)]
                nested = [i for i in names if '/en/' in i.filename.replace('\\', '/').lower()]
                if nested:
                    selected = nested
                elif names:
                    has_locale_paths = any(
                        re.search(r'/[a-z]{2}(?:-[a-z]{2,3})?/', i.filename.replace('\\', '/').lower())
                        for i in names
                    )
                    if has_locale_paths:
                        continue
                    selected = names
                elif looks_like_world_zip(candidate.name):
                    # Candidate itself is a nested SQLite ZIP rather than a bundle.
                    content_info = next(
                        (n for n in zf.infolist() if n.filename.lower().endswith('.content')),
                        None,
                    )
                    serial += 1
                    found.append({
                        'archive': str(candidate),
                        'member': None,
                        'zipDate': date_text(content_info) if content_info else None,
                        'timestamp': timestamp_text(content_info) if content_info else None,
                        'id': digest_from_name(candidate.name),
                        'version': version_from_path(str(candidate)),
                        'sourceArchive': str(candidate),
                        'serial': serial,
                    })
                    continue
                else:
                    # A loose ZIP may directly contain the SQLite .content file.
                    if any(n.filename.lower().endswith('.content') for n in zf.infolist()):
                        serial += 1
                        content_info = next(n for n in zf.infolist() if n.filename.lower().endswith('.content'))
                        found.append({
                            'archive': str(candidate),
                            'member': None,
                            'zipDate': date_text(content_info),
                            'timestamp': timestamp_text(content_info),
                            'id': None,
                            'version': version_from_path(str(candidate)),
                            'sourceArchive': str(candidate),
                            'serial': serial,
                        })
                    continue

                for info in selected:
                    serial += 1
                    found.append({
                        'archive': str(candidate),
                        'member': info.filename,
                        'zipDate': date_text(info),
                        'timestamp': timestamp_text(info),
                        'id': digest_from_name(info.filename),
                        'version': version_from_path(info.filename) or version_from_path(str(candidate)),
                        'sourceArchive': str(candidate),
                        'serial': serial,
                    })

    return found

def extract_one(item, destination):
    with open(item['archive'], 'rb') as file:
        file_start = file.read(16)
    if not item.get('member') and file_start == b'SQLite format 3\x00':
        with open(item['archive'], 'rb') as file:
            data = file.read()
    else:
        archive = zipfile.ZipFile(item['archive'])
        with archive:
            source = archive.open(item['member']) if item.get('member') else None
            try:
                raw = source.read() if source else archive.read(next(n for n in archive.namelist() if n.lower().endswith('.content')))
            finally:
                if source:
                    source.close()
        if raw[:16] == b'SQLite format 3\x00':
            data = raw
        else:
            with zipfile.ZipFile(io.BytesIO(raw)) as inner:
                content = [n for n in inner.namelist() if n.lower().endswith('.content') and not ignored(n)]
                if not content:
                    raise RuntimeError('ZIP has no SQLite .content member: ' + str(item.get('member') or item['archive']))
                data = inner.read(content[0])
    if data[:16] != b'SQLite format 3\x00':
        raise RuntimeError('Extracted payload is not SQLite: ' + str(item.get('member') or item['archive']))
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    with open(destination, 'wb') as output:
        output.write(data)
    return {'path': destination, 'bytes': len(data)}

if mode == 'list':
    json.dump(list_candidates(), sys.stdout)
elif mode == 'extract':
    result = [extract_one(item, item['destination']) for item in args['items']]
    json.dump(result, sys.stdout)
elif mode == 'extract-file':
    result = extract_one(args['item'], args['destination'])
    json.dump(result, sys.stdout)
else:
    raise RuntimeError('Unknown helper mode: ' + mode)
`;

function parseArgs(argv) {
  const result = {
    extraDirs: [],
    help: false,
    smokeOnly: false,
    probeOnly: false,
    cacheOnly: false,
  };
  const takeValue = (flag, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--smoke-only') result.smokeOnly = true;
    else if (arg === '--probe-only') result.probeOnly = true;
    else if (arg === '--cache-only') result.cacheOnly = true;
    else if (arg === '--extra-zips') result.extraDirs.push(path.resolve(takeValue(arg, i++)));
    else if (arg === '--downloads-dir') result.downloadsDir = path.resolve(takeValue(arg, i++));
    else if (arg === '--scratch-dir') result.scratchDir = path.resolve(takeValue(arg, i++));
    else if (arg === '--output-dir') result.outputDir = path.resolve(takeValue(arg, i++));
    else if (arg === '--s3-secret-file') result.secretFile = path.resolve(takeValue(arg, i++));
    else if (arg === '--s3-region') result.s3Region = takeValue(arg, i++);
    else if (arg === '--concurrency') result.concurrency = Number(takeValue(arg, i++));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function help() {
  console.log(`Build the v1 Manifest History data set.

Usage:
  node scripts/history/build-history.mjs --s3-secret-file <file>
    [--downloads-dir <dir>] [--scratch-dir <dir>] [--output-dir <dir>]
    [--extra-zips <dir>]... [--concurrency 8] [--s3-region us-east-1]
  node scripts/history/build-history.mjs --cache-only
    [--downloads-dir <dir>] [--scratch-dir <dir>] [--output-dir <dir>]
  node scripts/history/build-history.mjs --smoke-only [--downloads-dir <dir>] [--scratch-dir <dir>]
  node scripts/history/build-history.mjs --probe-only --s3-secret-file <file>

All caches, extracted SQLite files, staging data, and output default to:
  ${DEFAULT_SCRATCH}

A full build also emits one v1/releases/{versionIndex}.json.gz per version
(from build-releases.mjs) and records exact per-version counts in versions.json.
`);
}

function runPython(input) {
  const result = spawnSync('python', ['-c', PYTHON_ARCHIVE_HELPER], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Python ZIP helper failed (${result.status ?? result.signal}): ${result.stderr.trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Python ZIP helper returned invalid JSON: ${result.stderr.trim()}`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding);
}

function signedHeaders(url, secret, region) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = amzDate.slice(0, 8);
  const host = url.host;
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signed = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'GET',
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signed,
    payloadHash,
  ].join('\n');
  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');
  const kDate = hmac(`AWS4${secret}`, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  return {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY}/${scope}, ` +
      `SignedHeaders=${signed}, Signature=${signature}`,
  };
}

function signedUrl(key) {
  return new URL(`/${S3_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`, S3_ENDPOINT);
}

async function s3Get(key, secret, region, { streamTo } = {}) {
  const url = signedUrl(key);
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(url, { headers: signedHeaders(url, secret, region) });
      if (response.ok) break;
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(`Archive request failed (${response.status}) for ${url.pathname}`);
      }
      lastError = new Error(`Archive request failed (${response.status}) for ${url.pathname}`);
    } catch (error) {
      if (error.message.startsWith('Archive request failed (')) throw error;
      lastError = new Error(`Archive request failed for ${url.pathname}: ${error.message}`);
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
  if (!response?.ok) throw lastError ?? new Error(`Archive request failed for ${url.pathname}`);
  if (streamTo) {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(streamTo));
    return;
  }
  return Buffer.from(await response.arrayBuffer());
}

function mkdirp(directory) {
  mkdirSync(directory, { recursive: true });
}

function localSources(downloadsDir, extraDirs) {
  const sources = LOCAL_SOURCES.map((source) => ({
    path: path.join(downloadsDir, source.name),
    mode: source.mode,
    label: source.name,
  }));
  return runPython({
    mode: 'list',
    sources,
    extraDirs,
  });
}

function candidateDate(candidate) {
  const timestamp = candidate.timestamp ?? candidate.zipDate;
  return timestamp ? new Date(timestamp) : new Date(0);
}

function normalizedLocalVersion(candidate) {
  const date = candidateDate(candidate);
  const dateOnly = Number.isNaN(date.getTime()) ? 'unknown-date' : date.toISOString().slice(0, 10);
  return {
    id: candidate.id,
    version: candidate.version ?? `local-${dateOnly}`,
    date: candidate.zipDate ?? `${dateOnly}T00:00:00.000Z`,
    source: 'sqlite',
    sourceArchive: candidate.sourceArchive,
    candidate,
  };
}

function modernVersionDate(version) {
  return version.DiscoverDate_UTC || version.ManifestDate_UTC;
}

function selectUniqueLocalCandidates(candidates) {
  const byId = new Map();
  const withoutId = [];
  for (const candidate of candidates) {
    if (!candidate.id) {
      withoutId.push(candidate);
      continue;
    }
    const existing = byId.get(candidate.id);
    if (!existing || candidateDate(candidate) > candidateDate(existing)) byId.set(candidate.id, candidate);
  }
  return [...byId.values(), ...withoutId].sort((a, b) => {
    const dateDiff = candidateDate(a) - candidateDate(b);
    if (dateDiff) return dateDiff;
    return String(a.version ?? a.member ?? a.archive).localeCompare(String(b.version ?? b.member ?? b.archive));
  });
}

function sqliteSignedId(unsignedHash) {
  const hash = Number(unsignedHash) >>> 0;
  return hash >= 0x80000000 ? hash - 0x100000000 : hash;
}

function tableNames(db) {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((row) => row.name);
}

function hasDefinitionSchema(db, table) {
  if (!table.endsWith('Definition') || OMIT_TABLES.has(table)) return false;
  const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((column) => column.name);
  return columns.includes('id') && columns.includes('json');
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function jsonText(value) {
  if (value == null) return 'null';
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return JSON.stringify(value);
}

function decodeJson(value, table, hash) {
  const text = jsonText(value);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${table}:${hash}: ${error.message}`);
  }
}

function decodePointerSegment(segment) {
  return segment.replace(/~[01]/g, (escape) => (escape === '~1' ? '/' : '~'));
}

function pointerSegments(pointer) {
  if (!pointer.startsWith('/')) return [];
  return pointer.slice(1).split('/').map(decodePointerSegment);
}

function arrayIndex(segment) {
  if (!/^(0|[1-9]\d*)$/.test(segment)) return null;
  const index = Number(segment);
  return Number.isSafeInteger(index) ? index : null;
}

function pointerParent(root, segments) {
  if (segments.length === 0) return null;
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = arrayIndex(segment);
      if (index === null || index >= current.length) return null;
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return null;
      current = current[segment];
    } else {
      return null;
    }
  }
  if (typeof current !== 'object' || current === null) return null;
  return { parent: current, key: segments.at(-1) };
}

function setPointer(root, pointer, value, insertArrayValue = false) {
  const target = pointerParent(root, pointerSegments(pointer));
  if (!target) return;
  const copy = structuredClone(value);
  if (Array.isArray(target.parent)) {
    const index = arrayIndex(target.key);
    if (index === null) return;
    if (insertArrayValue && index <= target.parent.length) target.parent.splice(index, 0, copy);
    else target.parent[index] = copy;
    return;
  }
  Object.defineProperty(target.parent, target.key, {
    value: copy,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function deletePointer(root, pointer) {
  const target = pointerParent(root, pointerSegments(pointer));
  if (!target) return;
  if (Array.isArray(target.parent)) {
    const index = arrayIndex(target.key);
    if (index !== null && index < target.parent.length) target.parent.splice(index, 1);
    return;
  }
  delete target.parent[target.key];
}

/**
 * Apply an archive diff's operations forward to a definition root. The archive
 * is authoritative for forward changes; only its `old` payloads are incomplete,
 * so snapshots are advanced with this function and diffs are then recomputed
 * from the old/new states by the builder.
 */
function applyForwardOps(root, sourceOps, hash) {
  const rootPath = `/${hash}`;
  for (const operation of sourceOps) {
    const op = operation.op;
    let pointer = String(operation.path ?? '/');
    if (pointer === rootPath) continue;
    if (!pointer.startsWith(`${rootPath}/`)) {
      throw new Error(`Unexpected modern diff path "${pointer}" for hash ${hash}`);
    }
    pointer = pointer.slice(rootPath.length);
    if (op === 'add') setPointer(root, pointer, operation.new, true);
    else if (op === 'del' || op === 'remove') deletePointer(root, pointer);
    else if (op === 'edit' || op === 'replace') setPointer(root, pointer, operation.new);
    else throw new Error(`Unsupported modern diff operation "${op}" for hash ${hash}`);
  }
}

function pointerEscape(segment) {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

function diffValues(oldValue, newValue, pathPrefix = '', result = { ops: [], total: 0 }) {
  if (Object.is(oldValue, newValue)) return result;
  if (
    oldValue === null ||
    newValue === null ||
    typeof oldValue !== 'object' ||
    typeof newValue !== 'object' ||
    Array.isArray(oldValue) !== Array.isArray(newValue)
  ) {
    addDiff(result, [0, pathPrefix || '/', oldValue, newValue]);
    return result;
  }

  if (Array.isArray(oldValue)) {
    if (oldValue.length !== newValue.length) {
      addDiff(result, [0, pathPrefix || '/', oldValue, newValue]);
      return result;
    }
    for (let index = 0; index < oldValue.length; index += 1) {
      diffValues(oldValue[index], newValue[index], `${pathPrefix}/${index}`, result);
    }
    return result;
  }

  const oldKeys = Object.keys(oldValue);
  const newKeys = Object.keys(newValue);
  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);

  for (const key of oldKeys) {
    const childPath = `${pathPrefix}/${pointerEscape(key)}`;
    if (!newSet.has(key)) addDiff(result, [2, childPath, oldValue[key]]);
    else diffValues(oldValue[key], newValue[key], childPath, result);
  }
  for (const key of newKeys) {
    if (!oldSet.has(key)) addDiff(result, [1, `${pathPrefix}/${pointerEscape(key)}`, newValue[key]]);
  }
  return result;
}

function addDiff(result, op) {
  if (op[1] === '/index') return;
  // Every field-level change is retained: history buckets must be able to
  // reconstruct any past revision exactly, so diffs are never truncated.
  result.ops.push(op);
  result.total += 1;
}

function bucketCount(table, hashCount) {
  if (table === 'DestinyInventoryItemDefinition') return 512;
  return hashCount >= 1000 ? 64 : 1;
}

function bucketHex(hash, count) {
  const bucket = (Number(hash) >>> 0) % count;
  return bucket.toString(16).padStart(count > 256 ? 3 : 2, '0');
}

function sqlBucket(hash, count) {
  return (Number(hash) >>> 0) % count;
}

function createStage(stagePath) {
  if (existsSync(stagePath)) rmSync(stagePath);
  const db = new DatabaseSync(stagePath);
  db.exec(`
    PRAGMA journal_mode=OFF;
    PRAGMA synchronous=OFF;
    PRAGMA temp_store=MEMORY;
    PRAGMA cache_size=-80000;
    CREATE TABLE snapshot (
      table_name TEXT NOT NULL,
      hash TEXT NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (table_name, hash)
    ) WITHOUT ROWID;
    CREATE TABLE current_snapshot (
      table_name TEXT NOT NULL,
      hash TEXT NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (table_name, hash)
    ) WITHOUT ROWID;
    CREATE TABLE revisions (
      table_name TEXT NOT NULL,
      hash TEXT NOT NULL,
      version_index INTEGER NOT NULL,
      kind TEXT NOT NULL,
      ops TEXT,
      total_ops INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (table_name, hash, version_index)
    ) WITHOUT ROWID;
    CREATE TABLE table_hashes (
      table_name TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (table_name, hash)
    ) WITHOUT ROWID;
  `);
  STAGE_STATEMENTS.set(db, {
    insertRevision: db.prepare(
      'INSERT INTO revisions (table_name, hash, version_index, kind, ops, total_ops) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    insertHash: db.prepare('INSERT OR IGNORE INTO table_hashes (table_name, hash) VALUES (?, ?)'),
    selectSnapshot: db.prepare('SELECT json FROM snapshot WHERE table_name = ? AND hash = ?'),
    upsertSnapshot: db.prepare(
      'INSERT OR REPLACE INTO snapshot (table_name, hash, json) VALUES (?, ?, ?)',
    ),
    deleteSnapshot: db.prepare('DELETE FROM snapshot WHERE table_name = ? AND hash = ?'),
  });
  return db;
}

function addRevision(stage, versionIndex, table, hash, revision, counts) {
  if (!revision) return;
  const statements = STAGE_STATEMENTS.get(stage);
  statements.insertRevision.run(
    table,
    hash,
    versionIndex,
    revision.kind,
    revision.ops.length ? JSON.stringify(revision.ops) : null,
    revision.total,
  );
  statements.insertHash.run(table, hash);
  if (revision.kind === 'a') counts.added += 1;
  else if (revision.kind === 'r') counts.removed += 1;
  else counts.modified += 1;
}

function replaceSnapshotTable(stage, versionIndex, counts, currentTables) {
  const previousTables = new Set(
    stage.prepare('SELECT DISTINCT table_name FROM snapshot').all().map((row) => row.table_name),
  );
  const knownTables = new Set([...previousTables, ...currentTables]);
  const previousRows = stage.prepare(
    `SELECT p.hash, p.json AS old_json, c.json AS new_json
     FROM snapshot p LEFT JOIN current_snapshot c
       ON c.table_name = p.table_name AND c.hash = p.hash
     WHERE p.table_name = ? ORDER BY CAST(p.hash AS INTEGER)`,
  );
  const newRows = stage.prepare(
    `SELECT c.hash, c.json AS new_json
     FROM current_snapshot c LEFT JOIN snapshot p
       ON p.table_name = c.table_name AND p.hash = c.hash
     WHERE c.table_name = ? AND p.hash IS NULL ORDER BY CAST(c.hash AS INTEGER)`,
  );
  const deletePrevious = stage.prepare('DELETE FROM snapshot WHERE table_name = ?');
  const deleteCurrent = stage.prepare('DELETE FROM current_snapshot WHERE table_name = ?');
  const copyCurrent = stage.prepare(
    'INSERT INTO snapshot (table_name, hash, json) SELECT table_name, hash, json FROM current_snapshot WHERE table_name = ?',
  );

  for (const name of knownTables) {
    // The current table is repopulated before this function runs, and untouched names have no current rows.
    for (const row of previousRows.iterate(name)) {
      const hash = row.hash;
      if (row.new_json == null) {
        const oldValue = decodeJson(row.old_json, name, hash);
        const diff = diffValues(oldValue, {});
        addRevision(
          stage,
          versionIndex,
          name,
          hash,
          { kind: 'r', ops: diff.ops, total: diff.total },
          counts,
        );
      } else if (row.old_json !== row.new_json) {
        const oldValue = decodeJson(row.old_json, name, hash);
        const newValue = decodeJson(row.new_json, name, hash);
        const diff = diffValues(oldValue, newValue);
        if (diff.total > 0) {
          addRevision(
            stage,
            versionIndex,
            name,
            hash,
            { kind: 'm', ops: diff.ops, total: diff.total },
            counts,
          );
        }
      }
    }
    for (const row of newRows.iterate(name)) {
      const newValue = decodeJson(row.new_json, name, row.hash);
      const diff = diffValues({}, newValue);
      addRevision(
        stage,
        versionIndex,
        name,
        row.hash,
        { kind: 'a', ops: diff.ops, total: diff.total },
        counts,
      );
    }
    deletePrevious.run(name);
    copyCurrent.run(name);
    deleteCurrent.run(name);
  }

  // Tables present only in the current SQLite are copied after loading; ensure no current rows remain.
  stage.exec('DELETE FROM current_snapshot');
}

function stageSqliteSnapshot(stage, versionIndex, sqlitePath, counts) {
  const input = new DatabaseSync(sqlitePath, { readOnly: true });
  let inputOpen = true;
  const tables = tableNames(input).filter((table) => hasDefinitionSchema(input, table));
  const stageInsert = stage.prepare(
    'INSERT OR REPLACE INTO current_snapshot (table_name, hash, json) VALUES (?, ?, ?)',
  );

  stage.exec('BEGIN');
  try {
    stage.exec('DELETE FROM current_snapshot');
    for (const table of tables) {
      const statement = input.prepare(`SELECT id, json FROM ${quoteIdentifier(table)}`);
      for (const row of statement.iterate()) {
        const hash = (Number(row.id) >>> 0).toString();
        const text = jsonText(row.json);
        // Parse every source value once so malformed rows cannot silently poison the history.
        decodeJson(text, table, hash);
        stageInsert.run(table, hash, text);
      }
    }
    input.close();
    inputOpen = false;
    replaceSnapshotTable(stage, versionIndex, counts, tables);
    stage.exec('COMMIT');
  } catch (error) {
    if (inputOpen) input.close();
    stage.exec('ROLLBACK');
    throw error;
  }
}

async function seedBridgeTable(stage, table, config, bridgeVersionId, seededTables) {
  if (seededTables.has(table)) return;
  seededTables.add(table);
  const key = `versions/${bridgeVersionId}/tables/${table}.json`;
  const cached = await downloadCached(
    key,
    path.join('tables', bridgeVersionId, `${table}.json`),
    config,
  );
  const data = JSON.parse(readFileSync(cached, 'utf8'));
  const insert = stage.prepare(
    'INSERT OR IGNORE INTO snapshot (table_name, hash, json) VALUES (?, ?, ?)',
  );
  let count = 0;
  for (const [rawHash, definition] of Object.entries(data)) {
    const hash = (Number(rawHash) >>> 0).toString();
    insert.run(table, hash, JSON.stringify(definition));
    count += 1;
  }
  console.log(`Seeded ${table} from bridge JSON: ${count} definitions.`);
}

/**
 * Advance the staged snapshot by one archive diff version and compute our own
 * lossless diffs from the old/new definition states.
 *
 * The archive's `old` payloads are incomplete (notably array deletions use
 * `"old": null`), so they cannot be stored as reverse-patch data. Forward
 * application is authoritative, and recomputing the diff from the resulting
 * states gives every revision exact, reversible ops.
 *
 * Some tables exist in the bridge JSON but not the bridge SQLite world content
 * (and vice versa). When a nested op has no snapshot base, the bridge JSON table
 * is downloaded and seeded so forward application remains exact.
 */
async function stageModernDiff(
  stage,
  versionIndex,
  version,
  config,
  bridgeVersionId,
  seededTables,
  counts,
) {
  const cacheDir = config.cacheDir;
  const statements = STAGE_STATEMENTS.get(stage);
  for (const diffFile of version.DiffFiles ?? []) {
    const table = path.posix.basename(diffFile.FileName ?? '').replace(/\.json$/i, '');
    if (!table || OMIT_TABLES.has(table)) continue;
    const localPath = path.join(cacheDir, 'diffFiles', version.VersionId, `${table}.json`);
    if (!existsSync(localPath)) throw new Error(`Missing cached diff file: ${localPath}`);
    const parsed = JSON.parse(readFileSync(localPath, 'utf8'));
    for (const [rawHash, itemDiff] of Object.entries(parsed)) {
      const hash = (Number(rawHash) >>> 0).toString();
      const sourceOps = Array.isArray(itemDiff?.diff) ? itemDiff.diff : [];
      if (sourceOps.length === 0) continue;
      const rootPath = `/${hash}`;
      const rootOps = sourceOps.filter((operation) => String(operation.path ?? '') === rootPath);
      if (rootOps.length > 1) {
        throw new Error(`Multiple root operations for ${table}:${hash}@${versionIndex}`);
      }
      const rootOp = rootOps[0];
      let oldRow = statements.selectSnapshot.get(table, hash);
      let oldValue = oldRow ? JSON.parse(oldRow.json) : null;

      let newValue;
      let kind;
      if (rootOp && (rootOp.op === 'edit' || rootOp.op === 'replace' || rootOp.op === 'add')) {
        if (typeof rootOp.new !== 'object' || rootOp.new === null) {
          throw new Error(`Root ${rootOp.op} without an object payload for ${table}:${hash}`);
        }
        newValue = structuredClone(rootOp.new);
        applyForwardOps(newValue, sourceOps, hash);
        kind = oldValue === null ? 'a' : 'm';
      } else if (rootOp && (rootOp.op === 'del' || rootOp.op === 'remove')) {
        if (oldValue === null) {
          await seedBridgeTable(stage, table, config, bridgeVersionId, seededTables);
          oldRow = statements.selectSnapshot.get(table, hash);
          oldValue = oldRow ? JSON.parse(oldRow.json) : null;
        }
        if (oldValue === null) continue;
        newValue = null;
        kind = 'r';
      } else {
        if (oldValue === null) {
          await seedBridgeTable(stage, table, config, bridgeVersionId, seededTables);
          oldRow = statements.selectSnapshot.get(table, hash);
          oldValue = oldRow ? JSON.parse(oldRow.json) : null;
        }
        if (oldValue === null) {
          throw new Error(
            `Modern diff for ${table}:${hash}@${versionIndex} has no base snapshot`,
          );
        }
        newValue = structuredClone(oldValue);
        applyForwardOps(newValue, sourceOps, hash);
        kind = 'm';
      }

      const diff =
        kind === 'a'
          ? diffValues({}, newValue)
          : kind === 'r'
            ? diffValues(oldValue, {})
            : diffValues(oldValue, newValue);
      if (kind === 'm' && diff.total === 0) continue;

      addRevision(stage, versionIndex, table, hash, { kind, ops: diff.ops, total: diff.total }, counts);
      if (newValue === null) statements.deleteSnapshot.run(table, hash);
      else statements.upsertSnapshot.run(table, hash, JSON.stringify(newValue));
    }
  }
}

function versionGapBefore(previous, current) {
  const previousDate = new Date(previous.date);
  const currentDate = new Date(current.date);
  if (Number.isNaN(previousDate.getTime()) || Number.isNaN(currentDate.getTime())) return false;
  const from = previousDate.toISOString().slice(0, 10);
  const to = currentDate.toISOString().slice(0, 10);
  return (from === '2018-11-27' && to >= '2019-01-20' && to <= '2019-01-21') ||
    (from >= '2020-02-11' && from <= '2020-02-13' && to >= '2020-06-16' && to <= '2020-07-08');
}

async function mapLimit(items, concurrency, worker, progressLabel) {
  let cursor = 0;
  let complete = 0;
  let failure;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (!failure) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
        complete += 1;
        if (complete === items.length || complete % 100 === 0) {
          console.log(`${progressLabel}: ${complete}/${items.length}`);
        }
      } catch (error) {
        failure = error;
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
}

async function downloadCached(key, relativePath, config) {
  const destination = path.join(config.cacheDir, relativePath);
  if (existsSync(destination) && statSync(destination).size > 0) return destination;
  if (config.cacheOnly) {
    throw new Error(`Missing required cached archive file for ${key}: ${destination}`);
  }
  mkdirp(path.dirname(destination));
  const temporary = `${destination}.part`;
  try {
    await s3Get(key, config.secret, config.region, { streamTo: temporary });
    rmSync(destination, { force: true });
    // The temporary and destination share a volume; rename is atomic on Windows.
    const { renameSync } = await import('node:fs');
    renameSync(temporary, destination);
    return destination;
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

async function downloadModernInputs(list, config) {
  const listPath = path.join(config.cacheDir, 'list.json');
  if (!existsSync(listPath) || statSync(listPath).size === 0 || config.refresh) {
    if (config.cacheOnly) {
      throw new Error(`Missing required cached archive file list.json: ${listPath}`);
    }
    const bytes = await s3Get('list.json', config.secret, config.region);
    writeFileSync(listPath, bytes);
    console.log(`Cached modern version list: ${listPath}`);
  } else {
    console.log(`Using cached modern version list: ${listPath}`);
  }
  const versions = JSON.parse(readFileSync(listPath, 'utf8'));
  if (!Array.isArray(versions) || versions.length === 0) throw new Error('Archive list.json is empty or invalid');

  const sorted = [...versions].sort(
    (a, b) => new Date(modernVersionDate(a)) - new Date(modernVersionDate(b)),
  );
  const first = sorted[0];
  const latest = sorted.at(-1);
  const modernManifest = new Map();
  for (const version of [first, latest]) {
    const manifestKey = `versions/${version.VersionId}/manifest.json`;
    const cached = await downloadCached(
      manifestKey,
      path.join('manifests', `${version.VersionId}.json`),
      config,
    );
    modernManifest.set(version.VersionId, JSON.parse(readFileSync(cached, 'utf8')));
  }

  const contentFiles = [];
  for (const version of [first, latest]) {
    const manifest = modernManifest.get(version.VersionId);
    const contentPath = manifest?.mobileWorldContentPaths?.en;
    if (!contentPath) throw new Error(`English world content path missing from ${version.VersionId} manifest`);
    const basename = path.posix.basename(contentPath);
    const key = `versions/${version.VersionId}/${basename}`;
    const cachePath = await downloadCached(
      key,
      path.join('content', `${version.VersionId}-${basename}`),
      config,
    );
    contentFiles.push({ version, archivePath: cachePath, basename });
  }

  const diffFiles = [];
  for (const version of sorted) {
    for (const diff of version.DiffFiles ?? []) {
      const table = path.posix.basename(diff.FileName ?? '').replace(/\.json$/i, '');
      if (!table || OMIT_TABLES.has(table) || !diff.EnhancedFileName) continue;
      diffFiles.push({
        key: diff.EnhancedFileName.replace(/^\/manifest-archive\//, ''),
        relativePath: path.join('diffFiles', version.VersionId, `${table}.json`),
        versionId: version.VersionId,
        table,
      });
    }
  }
  const uniqueFiles = [...new Map(diffFiles.map((file) => [file.key, file])).values()];
  console.log(
    `Modern archive: ${sorted.length} versions, ${uniqueFiles.length} diff JSON files after excluding ${[...OMIT_TABLES].join(', ')}.`,
  );
  await mapLimit(
    uniqueFiles,
    config.concurrency,
    (file) => downloadCached(file.key, file.relativePath, config),
    'Downloaded/cached diffs',
  );
  return { versions: sorted, first, latest, contentFiles, diffCount: uniqueFiles.length };
}

function extractRemoteContent(contentFiles, tmpDir) {
  const items = contentFiles.map((file) => ({
    archive: file.archivePath,
    member: null,
    id: file.version.VersionId,
    version: file.version.Version,
    sourceArchive: file.archivePath,
  }));
  const extractionItems = items.map((item, index) => ({
    ...item,
    destination: path.join(tmpDir, 'sqlite', `${contentFiles[index].version.VersionId}.sqlite`),
  }));
  return runPython({ mode: 'extract', items: extractionItems }).map((item) => item.path);
}

function smokeOnly(options) {
  const scratchDir = options.scratchDir ?? DEFAULT_SCRATCH;
  ensureOutsideProject(scratchDir, 'Scratch directory');
  const downloadsDir = options.downloadsDir ?? DEFAULT_DOWNLOADS;
  const tmpDir = path.join(scratchDir, 'tmp');
  mkdirp(tmpDir);
  const discovered = localSources(downloadsDir, options.extraDirs);
  const candidates = selectUniqueLocalCandidates(discovered);
  if (!candidates.length) throw new Error(`No local EN SQLite ZIPs found under ${downloadsDir}`);
  const first = candidates[0];
  const sqlitePath = path.join(tmpDir, 'smoke-first-local.sqlite');
  runPython({
    mode: 'extract-file',
    item: { ...first, destination: sqlitePath },
    destination: sqlitePath,
  });
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  if (!tableNames(db).includes('DestinyInventoryItemDefinition')) {
    throw new Error('Sunshot smoke test failed: item definition table missing');
  }
  const signedId = sqliteSignedId(SUNSHOT_HASH);
  const row = db.prepare('SELECT json FROM DestinyInventoryItemDefinition WHERE id = ?').get(signedId);
  if (!row) throw new Error(`Sunshot ${SUNSHOT_HASH} not found in the earliest local SQLite snapshot`);
  const oldValue = decodeJson(row.json, 'DestinyInventoryItemDefinition', String(SUNSHOT_HASH));
  const newValue = structuredClone(oldValue);
  newValue.displayProperties ??= {};
  newValue.displayProperties.name = `${newValue.displayProperties.name ?? 'Sunshot'} (smoke)`;
  newValue.index = Number(newValue.index ?? 0) + 1;
  const diff = diffValues(oldValue, newValue);

  // Forward-apply a representative archive diff, then recompute a lossless
  // diff from the resulting state.
  const forwardRoot = { nested: { list: [1, 2] }, drop: 'x', index: 1 };
  applyForwardOps(
    forwardRoot,
    [
      { op: 'edit', path: '/42/nested/list/1', old: 2, new: 20 },
      { op: 'add', path: '/42/nested/list/2', new: 3 },
      { op: 'del', path: '/42/nested/list/0', old: null },
      { op: 'del', path: '/42/drop', old: null },
      { op: 'add', path: '/42/kept', new: true },
    ],
    '42',
  );
  const forwardDiff = diffValues({ nested: { list: [1, 2] }, drop: 'x', index: 1 }, forwardRoot);
  const itemCount = db.prepare('SELECT COUNT(*) AS count FROM DestinyInventoryItemDefinition').get().count;
  db.close();
  if (diff.ops.some((op) => op[1] === '/index')) throw new Error('/index leaked into compact diff');
  if (!diff.ops.some((op) => op[1] === '/displayProperties/name')) {
    throw new Error('Sunshot smoke test did not capture a real definition change');
  }
  if (JSON.stringify(forwardRoot.nested.list) !== '[20,3]') {
    throw new Error('Modern forward-apply array edit/add/delete smoke test failed');
  }
  if (Object.prototype.hasOwnProperty.call(forwardRoot, 'drop') || forwardRoot.kept !== true) {
    throw new Error('Modern forward-apply object delete/add smoke test failed');
  }
  if (forwardDiff.ops.some((op) => op[1] === '/index')) {
    throw new Error('Modern forward diff leaked /index');
  }
  if (forwardDiff.ops.length !== forwardDiff.total) {
    throw new Error('Lossless forward diff lost operations');
  }
  const bucket = bucketHex(String(SUNSHOT_HASH), 512);
  if (sqlBucket(String(SUNSHOT_HASH), 512) !== (SUNSHOT_HASH >>> 0) % 512) {
    throw new Error('Bucket sharding smoke test failed');
  }
  console.log(
    `Smoke OK: Sunshot ${SUNSHOT_HASH} exists in ${first.version ?? first.zipDate}; ` +
      `${itemCount} inventory definitions; /index filtered; forward apply + lossless diff; bucket ${bucket}.`,
  );
}

async function writeLatestSnapshots(sqlitePath, outputDir) {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const tables = tableNames(db).filter((table) => hasDefinitionSchema(db, table));
  let fileCount = 0;
  let byteCount = 0;
  for (const table of tables) {
    const outputPath = path.join(outputDir, 'latest-snapshot', `${table}.json.gz`);
    mkdirp(path.dirname(outputPath));
    const select = db.prepare(`SELECT id, json FROM ${quoteIdentifier(table)} ORDER BY id`);
    async function* generate() {
      yield '{';
      let first = true;
      for (const row of select.iterate()) {
        const hash = (Number(row.id) >>> 0).toString();
        const definition = decodeJson(row.json, table, hash);
        if (!first) yield ',';
        first = false;
        yield `${JSON.stringify(hash)}:${JSON.stringify(definition)}`;
      }
      yield '}';
    }
    await pipeline(
      Readable.from(generate()),
      createGzip({ level: 9 }),
      createWriteStream(outputPath),
    );
    fileCount += 1;
    byteCount += statSync(outputPath).size;
    console.log(`Wrote latest snapshot ${table}`);
  }
  db.close();
  return { fileCount, byteCount };
}

async function writeBucketGzip(filePath, rows, table, counters) {
  mkdirp(path.dirname(filePath));
  async function* generate() {
    yield '{';
    let activeHash = null;
    let firstHash = true;
    let firstRevision = true;
    for (const row of rows) {
      if (row.hash !== activeHash) {
        if (activeHash !== null) yield ']';
        if (!firstHash) yield ',';
        activeHash = row.hash;
        firstHash = false;
        firstRevision = true;
        yield `${JSON.stringify(activeHash)}:[`;
      }
      if (row.version_index == null) continue;
      const revision = { v: row.version_index, k: row.kind };
      if (row.ops) {
        const ops = JSON.parse(row.ops);
        if (ops.length !== row.total_ops) {
          throw new Error(
            `Lossless diff invariant failed for ${table}:${row.hash}@${row.version_index}: ` +
              `${ops.length} stored ops but ${row.total_ops} changes`,
          );
        }
        revision.d = ops;
      } else if (row.total_ops !== 0) {
        throw new Error(
          `Lossy revision detected for ${table}:${row.hash}@${row.version_index}: ` +
            `${row.total_ops} changes without stored ops`,
        );
      }
      counters.revisionCount += 1;
      if (revision.d) {
        counters.revisionsWithOps += 1;
        counters.maxDiffOps = Math.max(counters.maxDiffOps, revision.d.length);
      }
      if (!firstRevision) yield ',';
      firstRevision = false;
      // Stream one revision at a time: the lossless vendor shard is hundreds of
      // megabytes of JSON and must never become a single JavaScript string.
      yield JSON.stringify(revision);
    }
    if (activeHash !== null) yield ']';
    yield '}';
  }
  await pipeline(Readable.from(generate()), createGzip({ level: 9 }), createWriteStream(filePath));
  return statSync(filePath).size;
}

async function outputBuckets(stage, outputDir) {
  const tables = stage
    .prepare('SELECT table_name, COUNT(*) AS count FROM table_hashes GROUP BY table_name ORDER BY table_name')
    .all();
  const bucketInfo = {};
  let fileCount = 0;
  let byteCount = 0;
  const counters = { revisionCount: 0, revisionsWithOps: 0, maxDiffOps: 0 };
  const tableBuckets = stage.prepare(
    `SELECT h.hash, r.version_index, r.kind, r.ops, r.total_ops
     FROM table_hashes h
     LEFT JOIN revisions r ON r.table_name = h.table_name AND r.hash = h.hash
     WHERE h.table_name = ? AND (CAST(h.hash AS INTEGER) % ?) = ?
     ORDER BY CAST(h.hash AS INTEGER), r.version_index`,
  );
  for (const { table_name: table, count } of tables) {
    const buckets = bucketCount(table, count);
    bucketInfo[table] = buckets;
    for (let id = 0; id < buckets; id += 1) {
      const hex = id.toString(16).padStart(buckets > 256 ? 3 : 2, '0');
      const target = path.join(outputDir, 'buckets', table, `${hex}.json.gz`);
      byteCount += await writeBucketGzip(
        target,
        tableBuckets.iterate(table, buckets, id),
        table,
        counters,
      );
      fileCount += 1;
    }
  }
  return {
    buckets: bucketInfo,
    fileCount,
    byteCount,
    tables: tables.length,
    revisionCount: counters.revisionCount,
    revisionsWithOps: counters.revisionsWithOps,
    maxDiffOps: counters.maxDiffOps,
  };
}

function roundBytes(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

async function build(options) {
  if (!options.cacheOnly && !options.secretFile) {
    throw new Error('Full builds require --s3-secret-file <file> unless --cache-only is used');
  }
  const scratchDir = options.scratchDir ?? DEFAULT_SCRATCH;
  const downloadsDir = options.downloadsDir ?? DEFAULT_DOWNLOADS;
  const outputDir = options.outputDir ?? path.join(scratchDir, 'v1');
  ensureOutsideProject(scratchDir, 'Scratch directory');
  ensureOutsideProject(outputDir, 'Output directory');
  const outputRelative = path.relative(path.resolve(scratchDir), path.resolve(outputDir));
  if (
    !outputRelative ||
    outputRelative === '..' ||
    outputRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(outputRelative)
  ) {
    throw new Error('Output directory must be a child of the scratch directory');
  }
  const cacheDir = path.join(scratchDir, 'cache');
  const tmpDir = path.join(scratchDir, 'tmp');
  const secret = options.cacheOnly ? null : readFileSync(options.secretFile, 'utf8').trim();
  if (!options.cacheOnly && !secret) throw new Error('S3 secret file is empty');
  const config = {
    cacheDir,
    secret,
    cacheOnly: options.cacheOnly,
    region: options.s3Region ?? 'us-east-1',
    concurrency: Number.isInteger(options.concurrency) && options.concurrency > 0 ? options.concurrency : 8,
  };
  mkdirp(cacheDir);
  mkdirp(tmpDir);
  mkdirp(path.dirname(outputDir));

  const discovered = localSources(downloadsDir, options.extraDirs);
  const candidates = selectUniqueLocalCandidates(discovered);
  const normalizedLocal = candidates.map(normalizedLocalVersion);
  if (!normalizedLocal.length) throw new Error(`No local SQLite snapshots found under ${downloadsDir}`);
  const duplicateCount = discovered.length - candidates.length;
  console.log(
    `Local SQLite snapshots: ${normalizedLocal.length} after deduplicating ${duplicateCount}; ` +
      `date span ${normalizedLocal[0].date.slice(0, 10)} → ${normalizedLocal.at(-1).date.slice(0, 10)}.`,
  );

  const modern = await downloadModernInputs(null, config);
  const remoteSqlitePaths = extractRemoteContent(modern.contentFiles, tmpDir);
  const firstRemoteDb = remoteSqlitePaths[0];
  const latestRemoteDb = remoteSqlitePaths.at(-1);

  const localExtraction = normalizedLocal.map((version, index) => ({
    ...version.candidate,
    destination: path.join(tmpDir, 'sqlite', `local-${String(index).padStart(3, '0')}-${version.id ?? index}.sqlite`),
  }));
  console.log(`Extracting ${localExtraction.length} local SQLite ZIPs to scratch storage...`);
  const extractedLocal = runPython({ mode: 'extract', items: localExtraction });
  const sqliteFiles = normalizedLocal.map((version, index) => ({
    ...version,
    sqlitePath: extractedLocal[index].path,
  }));

  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  mkdirp(outputDir);
  const stagePath = path.join(scratchDir, 'history-stage.sqlite');
  const stage = createStage(stagePath);
  const versions = [];
  let previousVersion = null;
  let index = 0;

  const applySnapshot = (metadata, sqlitePath) => {
    const version = {
      i: index,
      id: metadata.id,
      version: metadata.version,
      date: metadata.date,
      source: 'sqlite',
      added: 0,
      modified: 0,
      removed: 0,
    };
    if (previousVersion && versionGapBefore(previousVersion, version)) version.gapBefore = true;
    const counts = { added: 0, modified: 0, removed: 0 };
    stageSqliteSnapshot(stage, index, sqlitePath, counts);
    Object.assign(version, counts);
    versions.push(version);
    previousVersion = version;
    index += 1;
  };

  for (const item of sqliteFiles) applySnapshot(item, item.sqlitePath);
  const firstModern = modern.first;
  const seededBridgeTables = new Set();
  applySnapshot(
    {
      id: firstModern.VersionId,
      version: firstModern.Version,
      date: new Date(modernVersionDate(firstModern)).toISOString(),
    },
    firstRemoteDb,
  );
  for (const remoteVersion of modern.versions.slice(1)) {
    const version = {
      i: index,
      id: remoteVersion.VersionId,
      version: remoteVersion.Version,
      date: new Date(modernVersionDate(remoteVersion)).toISOString(),
      source: 'diff',
      added: 0,
      modified: 0,
      removed: 0,
    };
    if (previousVersion && versionGapBefore(previousVersion, version)) version.gapBefore = true;
    const counts = { added: 0, modified: 0, removed: 0 };
    stage.exec('BEGIN');
    try {
      await stageModernDiff(
        stage,
        index,
        remoteVersion,
        config,
        firstModern.VersionId,
        seededBridgeTables,
        counts,
      );
      stage.exec('COMMIT');
    } catch (error) {
      stage.exec('ROLLBACK');
      throw error;
    }
    Object.assign(version, counts);
    versions.push(version);
    previousVersion = version;
    index += 1;
    if (index % 25 === 0 || index === normalizedLocal.length + modern.versions.length) {
      console.log(`Staged ${index} chronological versions...`);
    }
  }

  const buckets = await outputBuckets(stage, outputDir);
  writeFileSync(path.join(outputDir, 'versions.json'), JSON.stringify({
    schema: 1,
    generatedAt: new Date().toISOString(),
    buckets: buckets.buckets,
    versions,
  }, null, 2));
  const latestSnapshots = await writeLatestSnapshots(latestRemoteDb, outputDir);
  // Releases are derived from the finished buckets + latest snapshots, so they
  // must run after both exist. This also adds exact `counts` to versions.json.
  const releases = await generateReleases({ sourceDir: outputDir, verify: true });
  stage.close();

  const fileStats = collectOutputStats(outputDir);
  const sunshotBucket = bucketHex(String(SUNSHOT_HASH), buckets.buckets.DestinyInventoryItemDefinition);
  const sunshotPath = path.join(
    outputDir,
    'buckets',
    'DestinyInventoryItemDefinition',
    `${sunshotBucket}.json.gz`,
  );
  const sunshotObject = JSON.parse((await import('node:zlib')).gunzipSync(readFileSync(sunshotPath)).toString('utf8'));
  const sunshotHistory = sunshotObject[String(SUNSHOT_HASH)] ?? [];
  const report = {
    versions: versions.length,
    dateSpan: [versions[0]?.date, versions.at(-1)?.date],
    tables: buckets.tables,
    bucketFiles: buckets.fileCount,
    latestSnapshotFiles: latestSnapshots.fileCount,
    releaseFiles: releases.releaseFiles,
    releaseBytes: releases.releaseBytes,
    releaseCompressedMB: releases.releaseMB,
    releaseEntries: releases.entries,
    outputFiles: fileStats.files,
    compressedBytes: fileStats.bytes,
    compressedMB: roundBytes(fileStats.bytes),
    sourceDiffFilesDownloaded: modern.diffCount,
    lossless: {
      truncatedRevisions: 0,
      revisions: buckets.revisionCount,
      revisionsWithDiffs: buckets.revisionsWithOps,
      maxDiffOps: buckets.maxDiffOps,
    },
    sunshot: {
      hash: SUNSHOT_HASH,
      bucket: sunshotBucket,
      revisions: sunshotHistory.length,
      dates: sunshotHistory.map((revision) => versions[revision.v]?.date),
      firstDate: sunshotHistory.length ? versions[sunshotHistory[0].v]?.date : null,
      lastDate: sunshotHistory.length ? versions[sunshotHistory.at(-1).v]?.date : null,
    },
    outputDir,
  };
  writeFileSync(path.join(scratchDir, 'build-report.json'), JSON.stringify(report, null, 2));
  console.log('\nBuild complete:');
  console.log(JSON.stringify(report, null, 2));
}

async function probeArchive(options) {
  if (!options.secretFile) throw new Error('--probe-only requires --s3-secret-file <file>');
  const secret = readFileSync(options.secretFile, 'utf8').trim();
  if (!secret) throw new Error('S3 secret file is empty');
  const scratchDir = options.scratchDir ?? DEFAULT_SCRATCH;
  ensureOutsideProject(scratchDir, 'Scratch directory');
  const cacheDir = path.join(scratchDir, 'cache');
  const tmpDir = path.join(scratchDir, 'tmp');
  mkdirp(cacheDir);
  mkdirp(tmpDir);
  const config = {
    cacheDir,
    secret,
    region: options.s3Region ?? 'us-east-1',
    concurrency: 8,
  };
  const listPath = path.join(cacheDir, 'list.json');
  const bytes = await s3Get('list.json', secret, config.region);
  writeFileSync(listPath, bytes);
  const versions = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('Signed archive list request returned invalid data');
  }
  const sorted = [...versions].sort(
    (a, b) => new Date(modernVersionDate(a)) - new Date(modernVersionDate(b)),
  );
  const contentFiles = [];
  for (const version of [sorted[0], sorted.at(-1)]) {
    const manifestPath = await downloadCached(
      `versions/${version.VersionId}/manifest.json`,
      path.join('manifests', `${version.VersionId}.json`),
      config,
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const basename = path.posix.basename(manifest.mobileWorldContentPaths.en);
    const archivePath = await downloadCached(
      `versions/${version.VersionId}/${basename}`,
      path.join('content', `${version.VersionId}-${basename}`),
      config,
    );
    contentFiles.push({ version, archivePath, basename });
  }
  const [firstSqlite, latestSqlite] = extractRemoteContent(contentFiles, tmpDir);
  const firstDb = new DatabaseSync(firstSqlite, { readOnly: true });
  const firstSunshot = firstDb
    .prepare('SELECT 1 AS found FROM DestinyInventoryItemDefinition WHERE id = ?')
    .get(sqliteSignedId(SUNSHOT_HASH));
  firstDb.close();
  const latestDb = new DatabaseSync(latestSqlite, { readOnly: true });
  const latestTables = tableNames(latestDb).filter((table) => hasDefinitionSchema(latestDb, table)).length;
  latestDb.close();
  if (!firstSunshot) throw new Error('Sunshot missing from the first modern SQLite bridge snapshot');
  console.log(
    `Signed archive probe OK: ${sorted.length} versions, ` +
      `${modernVersionDate(sorted[0])} → ${modernVersionDate(sorted.at(-1))}; ` +
      `bridge/latest SQLite extracted; Sunshot present; ${latestTables} latest tables.`,
  );
}

function collectOutputStats(root) {
  let files = 0;
  let bytes = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += statSync(full).size;
      }
    }
  };
  visit(root);
  return { files, bytes };
}

function ensureOutsideProject(target, label) {
  const relative = path.relative(PROJECT_ROOT, path.resolve(target));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error(`${label} must be outside the repository: ${target}`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) help();
  else if (options.smokeOnly) smokeOnly(options);
  else if (options.probeOnly) await probeArchive(options);
  else await build(options);
} catch (error) {
  console.error(error.stack ?? error.message ?? String(error));
  process.exitCode = 1;
}
