#!/usr/bin/env node
/**
 * Generate the per-version release index for the v1 manifest history data set.
 *
 * Output (shared by worker/index.ts and src/manifest/history.ts):
 *
 *   v1/releases/{versionIndex}.json.gz   gzip(level 9) ManifestReleaseSummary
 *   v1/versions.json                      HistoryManifestIndex with `counts`
 *
 * A release summary lists every item that changed in that version, grouped by
 * table and change kind, as compact metadata tuples:
 *
 *   [hash, name, subtitle, icon, tierType] (+ changedFields for modifications)
 *
 * The generator does not re-diff any definitions. It reads the already-built
 * `buckets/` revision streams and `latest-snapshot/` definitions, starts each
 * item at its current metadata, and walks revisions newest → oldest while
 * reversing only the handful of display fields the release index shows. Items
 * that no longer exist in the latest snapshot (including entire retired
 * tables) recover their metadata from the removal revision's stored old
 * values, so removed entries stay readable too.
 *
 * Usage:
 *   node scripts/history/build-releases.mjs [--source-dir <dir>]
 *     [--scratch-dir <dir>] [--no-verify]
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_SCRATCH =
  'C:\\Users\\Seleo\\.t3\\userdata\\providers\\antigravity\\ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32\\antigravity-acp\\brain\\630aad88-6d45-4bfe-a537-fe4f7107e4cf\\scratch\\history-build';
const KIND_ORDER = ['a', 'm', 'r', 'u', 'c'];
const KIND_SET = new Set(KIND_ORDER);
const SUNSHOT_HASH = 2907129557;
const RELEASE_FILE_RE = /^\d+\.json\.gz$/;

const HELP = `Generate per-version release indexes for the v1 history data set.

Usage:
  node scripts/history/build-releases.mjs [--source-dir <dir>]
    [--scratch-dir <dir>] [--no-verify]

Reads:
  <source-dir>/versions.json
  <source-dir>/buckets/{table}/{bucketHex}.json.gz
  <source-dir>/latest-snapshot/{table}.json.gz

Writes:
  <source-dir>/releases/{versionIndex}.json.gz   one file per version
  <source-dir>/versions.json                     with exact per-version counts

Defaults to the history backfill scratch directory:
  ${DEFAULT_SCRATCH}
`;

function parseArgs(argv) {
  const options = {
    sourceDir: null,
    scratchDir: DEFAULT_SCRATCH,
    verify: true,
    help: false,
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
    else if (arg === '--no-verify') options.verify = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.sourceDir) options.sourceDir = path.join(options.scratchDir, 'v1');
  return options;
}

function ensureOutsideProject(target, label) {
  const relative = path.relative(PROJECT_ROOT, path.resolve(target));
  if (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  ) {
    throw new Error(`${label} must be outside the repository: ${target}`);
  }
}

function megabytes(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function tierTypeOf(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function readGzipJson(file) {
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
}

function emptyMetadata() {
  return {
    name: '',
    icon: '',
    displaySubtitle: '',
    typeAndTier: '',
    typeName: '',
    tierType: 0,
  };
}

/** Extract the only fields the release index displays from a definition. */
function metadataFromDefinition(definition) {
  const source = isRecord(definition) ? definition : {};
  const display = isRecord(source.displayProperties) ? source.displayProperties : {};
  const inventory = isRecord(source.inventory) ? source.inventory : {};
  return {
    name: text(display.name),
    icon: text(display.icon),
    displaySubtitle: text(display.subtitle),
    typeAndTier: text(source.itemTypeAndTierDisplayName),
    typeName: text(source.itemTypeDisplayName),
    tierType: tierTypeOf(inventory.tierType),
  };
}

function subtitleOf(metadata) {
  return metadata.typeAndTier || metadata.typeName || metadata.displaySubtitle || '';
}

function decodePointerSegment(segment) {
  return String(segment).replace(/~[01]/g, (escape) => (escape === '~1' ? '/' : '~'));
}

function pointerSegments(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return [];
  return pointer.slice(1).split('/').map(decodePointerSegment);
}

/**
 * Cheap path gate before splitting a pointer. Revision streams are dominated by
 * unrelated fields, and splitting every operation would dominate the scan.
 */
function isTrackedPointer(pointer) {
  if (typeof pointer !== 'string') return false;
  return (
    pointer === '' ||
    pointer === '/displayProperties' ||
    pointer.startsWith('/displayProperties/') ||
    pointer === '/inventory' ||
    pointer.startsWith('/inventory/') ||
    pointer === '/itemTypeAndTierDisplayName' ||
    pointer === '/itemTypeDisplayName'
  );
}

/**
 * Apply one old/new field value to the metadata state. Unknown paths are
 * ignored; whole-object replacements (`/displayProperties`, `/inventory`, the
 * definition root) are expanded so every tracked field stays exact.
 */
function applyMetadataValue(metadata, pointer, value) {
  const segments = pointerSegments(pointer);
  if (segments.length === 0) {
    Object.assign(metadata, metadataFromDefinition(value));
    return;
  }
  const head = segments[0];
  if (head === 'displayProperties') {
    if (segments.length === 1) {
      const display = isRecord(value) ? value : {};
      metadata.name = text(display.name);
      metadata.icon = text(display.icon);
      metadata.displaySubtitle = text(display.subtitle);
    } else if (segments.length === 2) {
      if (segments[1] === 'name') metadata.name = text(value);
      else if (segments[1] === 'icon') metadata.icon = text(value);
      else if (segments[1] === 'subtitle') metadata.displaySubtitle = text(value);
    }
    return;
  }
  if (head === 'itemTypeAndTierDisplayName' && segments.length === 1) {
    metadata.typeAndTier = text(value);
    return;
  }
  if (head === 'itemTypeDisplayName' && segments.length === 1) {
    metadata.typeName = text(value);
    return;
  }
  if (head === 'inventory') {
    if (segments.length === 1) {
      metadata.tierType = isRecord(value) ? tierTypeOf(value.tierType) : 0;
    } else if (segments.length === 2 && segments[1] === 'tierType') {
      metadata.tierType = tierTypeOf(value);
    }
  }
}

/**
 * Reverse one revision's diff ops on the metadata state. Revisions describe
 * forward changes, so replaying their old values newest-first restores the
 * definition's display fields at every earlier version.
 */
function reverseMetadata(metadata, ops) {
  for (let index = ops.length - 1; index >= 0; index -= 1) {
    const op = ops[index];
    if (!Array.isArray(op) || !isTrackedPointer(op[1])) continue;
    if (op[0] === 0 || op[0] === 2) applyMetadataValue(metadata, op[1], op[2]);
    else if (op[0] === 1) applyMetadataValue(metadata, op[1], undefined);
  }
}

/**
 * Recover metadata directly from a revision when the item is absent from the
 * latest snapshot state. Removed items use the revision's old values; a
 * missing-but-not-removed item (should not occur) uses its new values.
 */
function metadataFromRevision(revision, side) {
  const metadata = emptyMetadata();
  const ops = Array.isArray(revision.d) ? revision.d : [];
  for (const op of ops) {
    if (!Array.isArray(op) || !isTrackedPointer(op[1])) continue;
    if (side === 'old') {
      if (op[0] === 0 || op[0] === 2) applyMetadataValue(metadata, op[1], op[2]);
    } else if (op[0] === 0) {
      applyMetadataValue(metadata, op[1], op[3]);
    } else if (op[0] === 1) {
      applyMetadataValue(metadata, op[1], op[2]);
    }
  }
  return metadata;
}

/** Deterministic ordering: named entries A→Z, then unnamed by hash. */
function compareReleaseEntries(left, right) {
  const leftNamed = left[1].length > 0;
  const rightNamed = right[1].length > 0;
  if (leftNamed !== rightNamed) return leftNamed ? -1 : 1;
  if (leftNamed) {
    const leftKey = left[1].toLowerCase();
    const rightKey = right[1].toLowerCase();
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    if (left[1] < right[1]) return -1;
    if (left[1] > right[1]) return 1;
  }
  return left[0] - right[0];
}

function loadLatestMetadata(sourceDir, tables, log) {
  const snapshotDir = path.join(sourceDir, 'latest-snapshot');
  const metadata = new Map();
  if (!existsSync(snapshotDir)) {
    log('[releases] No latest-snapshot directory; every item will use revision values.');
    return metadata;
  }
  let loaded = 0;
  for (const table of tables) {
    const file = path.join(snapshotDir, `${table}.json.gz`);
    if (!existsSync(file)) continue;
    const definitions = readGzipJson(file);
    if (!isRecord(definitions)) {
      throw new Error(`Latest snapshot ${file} is not a JSON object`);
    }
    const byHash = new Map();
    for (const [hash, definition] of Object.entries(definitions)) {
      byHash.set(hash, metadataFromDefinition(definition));
    }
    metadata.set(table, byHash);
    loaded += 1;
  }
  log(`[releases] Loaded metadata for ${loaded}/${tables.length} latest snapshots.`);
  return metadata;
}

function validateIndex(index, sourceDir) {
  if (
    !isRecord(index) ||
    index.schema !== 1 ||
    !isRecord(index.buckets) ||
    !Array.isArray(index.versions)
  ) {
    throw new Error(
      `${path.join(sourceDir, 'versions.json')} is not a valid HistoryManifestIndex`,
    );
  }
  const versions = [...index.versions].sort((a, b) => a.i - b.i);
  for (let position = 0; position < versions.length; position += 1) {
    const version = versions[position];
    if (!isRecord(version) || version.i !== position || typeof version.date !== 'string') {
      throw new Error(
        'versions.json entries must be contiguous from index 0; ' +
          `found ${JSON.stringify(version)} at position ${position}`,
      );
    }
  }
  if (!versions.length) throw new Error('versions.json contains no versions');
  return versions;
}

function bucketTables(sourceDir, declaredTables) {
  const bucketsDir = path.join(sourceDir, 'buckets');
  if (!existsSync(bucketsDir)) throw new Error(`Bucket directory is missing: ${bucketsDir}`);
  const found = new Set(
    readdirSync(bucketsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const tables = Object.keys(declaredTables).filter((table) => found.has(table));
  for (const table of found) {
    if (!Object.prototype.hasOwnProperty.call(declaredTables, table)) {
      throw new Error(`Bucket table ${table} is not declared in versions.json buckets`);
    }
  }
  return tables.sort();
}

function createAccumulator(version) {
  return { v: version.i, counts: { a: 0, m: 0, r: 0, u: 0, c: 0 }, tables: {} };
}

function pushEntry(accumulator, table, revision, hash, metadata, changedFields) {
  let changes = accumulator.tables[table];
  if (!changes) {
    changes = {};
    accumulator.tables[table] = changes;
  }
  let entries = changes[revision.k];
  if (!entries) {
    entries = [];
    changes[revision.k] = entries;
  }
  const tuple = [hash, metadata.name, subtitleOf(metadata), metadata.icon, metadata.tierType];
  if (revision.k === 'm') tuple.push(changedFields);
  entries.push(tuple);
  accumulator.counts[revision.k] += 1;
}

function finalizeRelease(accumulator, version) {
  const tables = {};
  for (const table of Object.keys(accumulator.tables).sort()) {
    const changes = accumulator.tables[table];
    const output = {};
    for (const kind of KIND_ORDER) {
      const entries = changes[kind];
      if (!entries || entries.length === 0) continue;
      entries.sort(compareReleaseEntries);
      output[kind] = entries;
    }
    if (Object.keys(output).length > 0) tables[table] = output;
  }
  const release = { v: accumulator.v, date: version.date };
  if (typeof version.version === 'string' && version.version.length > 0) {
    release.version = version.version;
  }
  release.totals = { ...accumulator.counts };
  release.tables = tables;
  return release;
}

function cleanReleases(directory, versionCount, log) {
  mkdirSync(directory, { recursive: true });
  let removed = 0;
  for (const name of readdirSync(directory)) {
    const staleRelease = RELEASE_FILE_RE.test(name)
      ? Number(name.slice(0, -'.json.gz'.length)) >= versionCount
      : name.endsWith('.tmp') || name.endsWith('.part');
    if (staleRelease) {
      rmSync(path.join(directory, name), { force: true });
      removed += 1;
    }
  }
  if (removed > 0) log(`[releases] Removed ${removed} stale file(s) from ${directory}.`);
}

function verifyReleases({ sourceDir, versions, tables, log }) {
  const declaredTables = new Set(tables);
  const directory = path.join(sourceDir, 'releases');
  const names = readdirSync(directory);
  for (const name of names) {
    if (!RELEASE_FILE_RE.test(name)) {
      throw new Error(`Unexpected file in releases directory: ${name}`);
    }
  }
  const indexes = new Set(names.map((name) => Number(name.slice(0, -'.json.gz'.length))));
  if (indexes.size !== versions.length || names.length !== versions.length) {
    throw new Error(
      `Release file count mismatch: ${indexes.size} unique / ${names.length} files ` +
        `for ${versions.length} versions`,
    );
  }
  for (const version of versions) {
    if (!indexes.has(version.i)) throw new Error(`Release file ${version.i}.json.gz is missing`);
  }

  const errors = [];
  const countsMismatches = [];
  const sunshotHits = new Map();
  let bytes = 0;
  let entries = 0;
  for (const version of versions) {
    const file = path.join(directory, `${version.i}.json.gz`);
    bytes += statSync(file).size;
    const release = readGzipJson(file);
    if (!isRecord(release) || release.v !== version.i) {
      errors.push(`release ${version.i}: invalid v`);
      continue;
    }
    if (release.date !== version.date) {
      errors.push(`release ${version.i}: date ${release.date} != ${version.date}`);
    }
    const expectedVersion =
      typeof version.version === 'string' && version.version.length > 0
        ? version.version
        : undefined;
    if (release.version !== expectedVersion) {
      errors.push(`release ${version.i}: version label mismatch`);
    }
    if (!isRecord(release.tables) || !isRecord(release.totals)) {
      errors.push(`release ${version.i}: tables/totals are not objects`);
      continue;
    }
    const totals = { a: 0, m: 0, r: 0, u: 0, c: 0 };
    for (const [table, changes] of Object.entries(release.tables)) {
      if (!declaredTables.has(table)) {
        errors.push(`release ${version.i}: undeclared table ${table}`);
        continue;
      }
      if (!isRecord(changes)) {
        errors.push(`release ${version.i}: table ${table} is not an object`);
        continue;
      }
      for (const [kind, tuples] of Object.entries(changes)) {
        if (!KIND_SET.has(kind) || !Array.isArray(tuples)) {
          errors.push(`release ${version.i}: invalid kind ${table}/${kind}`);
          continue;
        }
        totals[kind] += tuples.length;
        entries += tuples.length;
        for (const tuple of tuples) {
          if (
            !Array.isArray(tuple) ||
            tuple.length !== (kind === 'm' ? 6 : 5) ||
            !Number.isInteger(tuple[0]) ||
            tuple[0] < 0 ||
            tuple[0] > 0xffffffff ||
            typeof tuple[1] !== 'string' ||
            typeof tuple[2] !== 'string' ||
            typeof tuple[3] !== 'string' ||
            !Number.isInteger(tuple[4]) ||
            tuple[4] < 0 ||
            tuple[4] > 6 ||
            (kind === 'm' && (!Number.isInteger(tuple[5]) || tuple[5] < 1))
          ) {
            errors.push(
              `release ${version.i}: invalid ${table}/${kind} tuple ${JSON.stringify(tuple)}`,
            );
          }
          if (tuple[0] === SUNSHOT_HASH) {
            sunshotHits.set(version.i, { kind, table, tuple });
          }
        }
      }
    }
    for (const kind of KIND_ORDER) {
      if (release.totals[kind] !== totals[kind]) {
        errors.push(
          `release ${version.i}: totals.${kind}=${release.totals[kind]} but ${totals[kind]} tuples`,
        );
      }
    }
    const counts = version.counts;
    if (!isRecord(counts) || KIND_ORDER.some((kind) => counts[kind] !== totals[kind])) {
      countsMismatches.push(version.i);
    }
    if (errors.length > 100) break;
  }
  if (errors.length) {
    throw new Error(`Release verification failed:\n${errors.slice(0, 20).join('\n')}`);
  }
  if (countsMismatches.length) {
    throw new Error(
      `versions.json counts mismatch for ${countsMismatches.length} versions: ` +
        countsMismatches.slice(0, 10).join(', '),
    );
  }

  const latestIndex = versions.at(-1).i;
  const latest = sunshotHits.get(latestIndex) ?? null;
  const target = versions.find((version) => version.date.startsWith('2026-05-29'));
  const targetHit = target ? sunshotHits.get(target.i) ?? null : null;
  const verification = {
    releaseFiles: versions.length,
    releaseBytes: bytes,
    releaseMB: megabytes(bytes),
    entries,
    countsVerified: versions.length,
    sunshot: {
      latestVersionIndex: latestIndex,
      latest: latest
        ? { v: latestIndex, kind: latest.kind, table: latest.table, tuple: latest.tuple }
        : null,
      targetVersionIndex: target?.i ?? null,
      target: targetHit
        ? { v: target.i, kind: targetHit.kind, table: targetHit.table, tuple: targetHit.tuple }
        : null,
    },
  };
  log(
    `[releases] Verified ${verification.releaseFiles} files (${verification.releaseMB} MB gzip, ` +
      `${entries} entries) and ${verification.countsVerified} counts.`,
  );
  if (latest) {
    log(
      `[releases] Sunshot @${latestIndex}: [${latest.tuple[0]}, "${latest.tuple[1]}", ` +
        `"${latest.tuple[2]}", "${latest.tuple[3]}", ${latest.tuple[4]}` +
        `${latest.tuple[5] === undefined ? '' : `, ${latest.tuple[5]}`}] (${latest.kind})`,
    );
  } else {
    log(`[releases] Sunshot did not change in the newest version (${latestIndex}).`);
  }
  if (targetHit && target) {
    log(
      `[releases] Sunshot @${target.i} (${target.date.slice(0, 10)}): ` +
        `[${targetHit.tuple[0]}, "${targetHit.tuple[1]}", "${targetHit.tuple[2]}", ` +
        `"${targetHit.tuple[3]}", ${targetHit.tuple[4]}` +
        `${targetHit.tuple[5] === undefined ? '' : `, ${targetHit.tuple[5]}`}] (${targetHit.kind})`,
    );
  } else if (target) {
    log(
      `[releases] Sunshot did not change in ${target.date.slice(0, 10)} (index ${target.i}).`,
    );
  }
  return verification;
}

/**
 * Generate every release index and add exact `counts` to versions.json.
 * Exported so build-history.mjs can emit releases after a full backfill.
 */
export async function generateReleases({ sourceDir, log = console.log, verify = true } = {}) {
  if (!sourceDir) throw new Error('generateReleases requires a sourceDir');
  ensureOutsideProject(sourceDir, 'Source directory');
  const indexFile = path.join(sourceDir, 'versions.json');
  if (!existsSync(indexFile)) throw new Error(`Build output is missing: ${indexFile}`);
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const versions = validateIndex(index, sourceDir);

  const startedAt = Date.now();
  const tables = bucketTables(sourceDir, index.buckets);
  const snapshotStartedAt = Date.now();
  const latestMetadata = loadLatestMetadata(sourceDir, tables, log);
  log(`[releases] Latest snapshots loaded in ${Date.now() - snapshotStartedAt}ms.`);

  const accumulators = versions.map(createAccumulator);
  const countsByVersion = new Map();
  const legacyMismatches = [];
  let bucketFiles = 0;
  let revisions = 0;

  log(
    `[releases] Scanning ${tables.length} tables for ${versions.length} versions ` +
      `(${versions[0].date.slice(0, 10)} → ${versions.at(-1).date.slice(0, 10)})...`,
  );

  for (const table of tables) {
    const directory = path.join(sourceDir, 'buckets', table);
    const files = readdirSync(directory).filter((name) => name.endsWith('.json.gz')).sort();
    const latest = latestMetadata.get(table) ?? new Map();
    let tableRevisions = 0;
    for (const file of files) {
      const bucket = readGzipJson(path.join(directory, file));
      if (!isRecord(bucket)) throw new Error(`Bucket ${table}/${file} is not a JSON object`);
      for (const [hash, history] of Object.entries(bucket)) {
        if (!/^\d+$/.test(hash) || !Array.isArray(history) || history.length === 0) {
          throw new Error(`Bucket ${table}/${file} has an invalid entry for hash ${hash}`);
        }
        const hashNumber = Number(hash);
        if (!Number.isSafeInteger(hashNumber) || hashNumber < 0 || hashNumber > 0xffffffff) {
          throw new Error(`Bucket ${table}/${file} has an out-of-range hash ${hash}`);
        }
        let metadata = latest.get(hash) ?? null;
        let previousVersion = Number.POSITIVE_INFINITY;
        for (let position = history.length - 1; position >= 0; position -= 1) {
          const revision = history[position];
          if (!isRecord(revision) || !Number.isInteger(revision.v) || !KIND_SET.has(revision.k)) {
            throw new Error(`Bucket ${table}/${file} hash ${hash} has an invalid revision`);
          }
          if (revision.v >= previousVersion) {
            throw new Error(
              `Bucket ${table}/${file} hash ${hash} revisions are not strictly ascending ` +
                `at ${revision.v}`,
            );
          }
          previousVersion = revision.v;
          const accumulator = accumulators[revision.v];
          if (!accumulator) {
            throw new Error(`Bucket ${table}/${file} references unknown version ${revision.v}`);
          }
          const ops = Array.isArray(revision.d) ? revision.d : [];
          if (revision.k === 'm' && ops.length === 0) {
            throw new Error(
              `Bucket ${table}/${file} hash ${hash}@${revision.v} is a lossy modification`,
            );
          }
          if (!metadata) {
            metadata = metadataFromRevision(revision, revision.k === 'r' ? 'old' : 'new');
            pushEntry(accumulator, table, revision, hashNumber, metadata, ops.length);
            // Removal old values already describe the state before the removal;
            // every other kind is reversed from its post-revision state.
            if (revision.k !== 'r') reverseMetadata(metadata, ops);
          } else {
            pushEntry(accumulator, table, revision, hashNumber, metadata, ops.length);
            reverseMetadata(metadata, ops);
          }
          revisions += 1;
          tableRevisions += 1;
        }
      }
      bucketFiles += 1;
    }
    log(`[releases] ${table}: ${tableRevisions} revisions across ${files.length} buckets.`);
  }

  const releasesDir = path.join(sourceDir, 'releases');
  cleanReleases(releasesDir, versions.length, log);
  const writeStartedAt = Date.now();
  let releaseBytes = 0;
  for (let versionIndex = 0; versionIndex < versions.length; versionIndex += 1) {
    const accumulator = accumulators[versionIndex];
    const release = finalizeRelease(accumulator, versions[versionIndex]);
    countsByVersion.set(versionIndex, release.totals);
    const file = path.join(releasesDir, `${versionIndex}.json.gz`);
    const temporary = `${file}.tmp`;
    const compressed = gzipSync(Buffer.from(JSON.stringify(release), 'utf8'), { level: 9 });
    writeFileSync(temporary, compressed);
    rmSync(file, { force: true });
    // Rename is atomic on the same volume, so readers never see a partial gzip.
    renameSync(temporary, file);
    releaseBytes += compressed.length;
    accumulators[versionIndex] = null;
    if ((versionIndex + 1) % 25 === 0 || versionIndex + 1 === versions.length) {
      log(`[releases] Wrote ${versionIndex + 1}/${versions.length} release files.`);
    }
  }

  for (const version of versions) {
    const totals = countsByVersion.get(version.i);
    version.counts = { ...totals };
    if (
      (version.added ?? 0) !== totals.a ||
      (version.modified ?? 0) !== totals.m ||
      (version.removed ?? 0) !== totals.r
    ) {
      legacyMismatches.push(version.i);
    }
  }
  index.generatedAt = new Date().toISOString();
  writeFileSync(indexFile, JSON.stringify(index, null, 2));

  log(
    `[releases] ${revisions} entries in ${versions.length} files, ` +
      `${megabytes(releaseBytes)} MB gzip ` +
      `(scan ${writeStartedAt - startedAt}ms, write ${Date.now() - writeStartedAt}ms).`,
  );
  if (legacyMismatches.length > 0) {
    log(
      `[releases] Note: legacy added/modified/removed totals differ from release ` +
        `counts for ${legacyMismatches.length} version(s): ${legacyMismatches
          .slice(0, 10)
          .join(', ')}${legacyMismatches.length > 10 ? ', …' : ''}`,
    );
  }

  const result = {
    versions: versions.length,
    releaseFiles: versions.length,
    releaseBytes,
    releaseMB: megabytes(releaseBytes),
    tables: tables.length,
    bucketFiles,
    entries: revisions,
    sunshot: null,
  };
  if (verify) {
    // Verify the bytes that were actually written, not the in-memory objects.
    const writtenIndex = JSON.parse(readFileSync(indexFile, 'utf8'));
    const writtenVersions = validateIndex(writtenIndex, sourceDir);
    result.verification = verifyReleases({ sourceDir, versions: writtenVersions, tables, log });
    result.sunshot = result.verification.sunshot;
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  await generateReleases({
    sourceDir: options.sourceDir,
    verify: options.verify,
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    process.exitCode = 1;
  });
}
