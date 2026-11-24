#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
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
import { decodeEntryDates, encodeEntryDates } from './entry-dates-codec.mjs';

const DEFAULT_SCRATCH =
  'C:\\Users\\Seleo\\.t3\\userdata\\providers\\antigravity\\ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32\\antigravity-acp\\brain\\630aad88-6d45-4bfe-a537-fe4f7107e4cf\\scratch\\history-build';

function canonicalHash(value) {
  const hash = Number(value);
  if (!Number.isInteger(hash) || hash < 0 || hash > 0xffff_ffff) {
    throw new Error(`Invalid unsigned entry hash: ${value}`);
  }
  return String(hash >>> 0);
}

function readSnapshotFile(file) {
  const compressed = readFileSync(file);
  const json = gunzipSync(compressed).toString('utf8');
  const definitions = JSON.parse(json);
  if (definitions === null || typeof definitions !== 'object' || Array.isArray(definitions)) {
    throw new Error(`Latest snapshot ${file} is not a JSON object`);
  }
  return Object.keys(definitions);
}

function toVersionDates(versions) {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('Entry dates require a non-empty versions array');
  }
  if (versions.length > 0xffff) throw new Error('EDAT supports at most 65,535 versions');
  return versions.map((version, index) => {
    const timestamp = Date.parse(version?.date);
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error(`Invalid date for history version ${index}: ${version?.date}`);
    }
    return timestamp;
  });
}

/**
 * Build the compact current-manifest date index from latest snapshots plus the
 * stage revisions. Pass an open DatabaseSync as `stage` to avoid reopening it.
 */
export async function writeEntryDates({
  stageDbPath,
  stage,
  outputDir,
  versions,
  latestSnapshotDir = path.join(outputDir, 'latest-snapshot'),
} = {}) {
  if (!outputDir) throw new Error('writeEntryDates requires outputDir');
  if (!stage && !stageDbPath) {
    throw new Error('writeEntryDates requires either an open stage database or stageDbPath');
  }
  const dateValues = toVersionDates(versions);
  const ownedStage = !stage;
  const db = stage ?? new DatabaseSync(stageDbPath, { readOnly: true });
  const tables = new Map();
  let currentEntryCount = 0;
  let omittedEntryCount = 0;
  let inferredEntryCount = 0;

  try {
    const hasRevisions = db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='revisions'",
    ).get();
    if (!hasRevisions) throw new Error('Staging database has no revisions table');

    // TEMP objects remain writable even when the source DB is opened read-only.
    db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS entry_dates_current (
        table_name TEXT NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY (table_name, hash)
      ) WITHOUT ROWID;
      DELETE FROM entry_dates_current;
    `);
    const insertCurrent = db.prepare(
      'INSERT OR IGNORE INTO entry_dates_current (table_name, hash) VALUES (?, ?)',
    );
    if (!existsSync(latestSnapshotDir)) {
      throw new Error(`Latest snapshot directory not found: ${latestSnapshotDir}`);
    }

    const snapshotFiles = readdirSync(latestSnapshotDir)
      .filter((name) => name.endsWith('.json.gz'))
      .sort();
    for (const filename of snapshotFiles) {
      const table = filename.slice(0, -'.json.gz'.length);
      const hashes = readSnapshotFile(path.join(latestSnapshotDir, filename));
      for (const rawHash of hashes) insertCurrent.run(table, canonicalHash(rawHash));
      currentEntryCount += hashes.length;
    }

    const grouped = db.prepare(`
      SELECT r.table_name,
             r.hash,
             MIN(CASE WHEN r.kind = 'a' THEN r.version_index END) AS first_added,
             MIN(r.version_index) AS first_any,
             MAX(r.version_index) AS last_any
      FROM revisions AS r
      INNER JOIN entry_dates_current AS c
        ON c.table_name = r.table_name AND c.hash = r.hash
      GROUP BY r.table_name, r.hash
      ORDER BY r.table_name, CAST(r.hash AS INTEGER)
    `);
    for (const row of grouped.iterate()) {
      const firstAdded = row.first_added == null ? null : Number(row.first_added);
      const firstAny = row.first_any == null ? null : Number(row.first_any);
      const lastAny = row.last_any == null ? null : Number(row.last_any);
      const firstVersionIndex = firstAdded ?? firstAny ?? -1;
      const record = {
        firstVersionIndex,
        lastVersionIndex: lastAny ?? -1,
        firstInferred: firstAdded == null && firstAny != null,
      };
      if (
        !Number.isInteger(record.firstVersionIndex) ||
        !Number.isInteger(record.lastVersionIndex) ||
        record.firstVersionIndex >= dateValues.length ||
        record.lastVersionIndex >= dateValues.length
      ) {
        throw new Error(`Revision index exceeds versions.json for ${row.table_name}:${row.hash}`);
      }
      let records = tables.get(row.table_name);
      if (!records) {
        records = new Map();
        tables.set(row.table_name, records);
      }
      records.set(Number(canonicalHash(row.hash)), record);
      if (record.firstInferred) inferredEntryCount += 1;
    }
    const encoded = encodeEntryDates({ versionDates: dateValues, tables });
    // Decode our own bytes before compression/writing so a bad encoder can
    // never replace a previous artifact.
    const verified = decodeEntryDates(encoded);
    const entryCount = [...verified.tables.values()].reduce((total, records) => total + records.size, 0);
    omittedEntryCount = currentEntryCount - entryCount;
    if (omittedEntryCount < 0) throw new Error('More dated records than current snapshot entries');

    mkdirSync(outputDir, { recursive: true });
    const target = path.join(outputDir, 'entry-dates.bin.gz');
    const temporary = `${target}.part`;
    try {
      writeFileSync(temporary, gzipSync(encoded, { level: 9 }));
      renameSync(temporary, target);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    return {
      file: target,
      compressedBytes: statSync(target).size,
      uncompressedBytes: encoded.byteLength,
      versions: dateValues.length,
      tables: tables.size,
      entries: entryCount,
      currentSnapshotEntries: currentEntryCount,
      omittedEntries: omittedEntryCount,
      firstInferredEntries: inferredEntryCount,
    };
  } finally {
    if (ownedStage) db.close();
  }
}

function parseArgs(argv) {
  const options = {
    outputDir: path.join(DEFAULT_SCRATCH, 'v1'),
    stageDbPath: path.join(DEFAULT_SCRATCH, 'history-stage.sqlite'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir' || arg === '--stage-db') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--output-dir') options.outputDir = path.resolve(value);
      else options.stageDbPath = path.resolve(value);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main(options) {
  const indexPath = path.join(options.outputDir, 'versions.json');
  if (!existsSync(indexPath)) throw new Error(`Missing history index: ${indexPath}`);
  const versions = JSON.parse(readFileSync(indexPath, 'utf8')).versions;
  const stats = await writeEntryDates({
    stageDbPath: options.stageDbPath,
    outputDir: options.outputDir,
    versions,
  });
  console.log('Entry dates artifact built and decoded successfully:');
  console.log(JSON.stringify(stats, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        'Usage: node scripts/history/build-entry-dates.mjs [--output-dir <dir>] [--stage-db <path>]',
      );
    } else {
      await main(options);
    }
  } catch (error) {
    console.error(error.stack ?? error.message ?? String(error));
    process.exitCode = 1;
  }
}
