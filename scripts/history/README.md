# Manifest History backfill

These scripts build and upload the shared `v1/` history data set. The build uses
Node.js 26's built-in `node:sqlite`, crypto, filesystem, and zlib modules. Python
3 is used only to read the nested ZIP containers and extract SQLite files. No
project dependencies are installed or changed.

## Scratch and secrets

By default, downloads, extracted databases, the staging SQLite database, output,
checkpoints, and verification downloads are all stored under:

```text
C:\Users\Seleo\.t3\userdata\providers\antigravity\ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32\antigravity-acp\brain\630aad88-6d45-4bfe-a537-fe4f7107e4cf\scratch\history-build\
```

The scripts reject scratch/output paths inside the Git repository. The archive
secret is read only when the build runs, from `--s3-secret-file`; it is never
printed or written to the cache. Pass the secret-file path as an argument, not
the secret value.

## Build

Run the local smoke check first. It extracts the earliest local SQLite ZIP,
checks Sunshot (`DestinyInventoryItemDefinition:2907129557`), verifies that an
`/index`-only edit is discarded, forward-applies a representative archive diff,
recomputes a lossless diff, and checks the 512-way bucket calculation.

```powershell
node .\scripts\history\build-history.mjs --smoke-only
node .\scripts\history\build-history.mjs --probe-only --s3-secret-file <secret-file>
node .\scripts\history\build-history.mjs --s3-secret-file <secret-file>
```

The signed `--probe-only` request caches the archive index and bridge/latest
SQLite payloads in scratch, extracts both databases, and confirms Sunshot is
present in the 2020-06-16 bridge database.

The full build:

- Reads the three configured ZIPs in `C:\Users\Seleo\Downloads\`.
- Downloads `list.json`, the 2020-06-16 and 2026-10-13 SQLite content, and
  available modern diff JSON files into the scratch cache. Diff downloads use
  concurrency 8 and resume from cached files.
- Computes complete JSON diffs between local SQLite snapshots and the
  2020-06-16 bridge snapshot. For modern versions it applies the archive's diff
  operations forward to a staged snapshot, then recomputes every revision's
  diff from the resulting old/new states instead of copying the archive's ops.
  This matters because the upstream enhanced diffs contain incomplete `old`
  payloads (array deletions often carry `"old": null`), which cannot be used
  for reverse patching.
- Stores **100% of every recomputed field diff op**. There is no per-revision
  op cap: `d` always contains the complete diff and `t` is never written
  because `d.length` is exact. Whole-item additions and removals are emitted as
  per-field ops, so reverse-patching can restore a removed definition and undo
  an addition even when a hash is removed and later re-added.
- Replaces changed arrays atomically and otherwise diffs arrays element by
  element; replaying ops in reverse order (`d.length - 1` down to `0`)
  reconstructs the previous value exactly, modulo the ignored top-level
  `index` field.
- Emits `v1/versions.json`, all deterministic bucket shards, the latest English
  SQLite snapshot, and one release index per version as gzip-compressed JSON.
- Writes `build-report.json` outside the repo, including counts, lossless-diff
  diagnostics, release-index totals, and Sunshot's revision timeline.

Optional future local ZIP bundles can be included with one or more
`--extra-zips <directory>` arguments. The directory is scanned recursively;
English entries are preferred and duplicate content MD5s collapse to the
latest dated copy. To change scratch or output locations, use `--scratch-dir`
and optionally `--output-dir` (which must remain a child of scratch).

## Release indexes

`v1/releases/{versionIndex}.json.gz` holds one `ManifestReleaseSummary` per
history version, gzip level 9, and is what the History page renders without
downloading every bucket. Each entry is a compact tuple:

```text
[hash, name, subtitle, icon, tierType]              added / removed / other
[hash, name, subtitle, icon, tierType, changedFields] modified
```

`subtitle` is `itemTypeAndTierDisplayName || itemTypeDisplayName ||
displayProperties.subtitle || ""`; `tierType` is `inventory.tierType` (0–6)
and `changedFields` is the exact `d.length` of the modification revision.
Entries are sorted deterministically (named A→Z, then unnamed by hash), empty
kinds and empty tables are omitted, and `totals` always has all five counters
`{ a, m, r, u, c }`. `v1/versions.json` gains the same exact
`counts: { a, m, r, u, c }` on every version entry.

Generate them from already-built buckets and snapshots (a full
`build-history.mjs` run does this automatically after writing the latest
snapshots):

```powershell
node .\scripts\history\build-releases.mjs
node .\scripts\history\build-releases.mjs --no-verify   # skip read-back checks
```

`build-releases.mjs` reads only `v1/buckets/{table}/*.json.gz` and
`v1/latest-snapshot/{table}.json.gz`. It starts each item at its current
metadata and walks revisions newest → oldest, reversing only
`/displayProperties/name`, `/displayProperties/icon`,
`/itemTypeAndTierDisplayName`, `/itemTypeDisplayName`, and
`/inventory/tierType` (including whole-object replacements). Items removed
from the current manifest, and tables that no longer exist, recover their
metadata from the removal revision's stored old values, so historical entries
keep real names, icons, and tiers. A full 321-version run takes roughly 30–45
seconds and writes about 27 MB of gzip.

Incremental updates are automatic: when `update-live-manifest.mjs` records a
new Bungie version it writes `v1/releases/{nextVersionIndex}.json.gz` from the
same definitions it just diffed and adds `counts` to the new version entry,
before committing `v1/versions.json`.

## Lossless diffs

History buckets are the source of truth for reconstructing any past revision,
so diff storage is 100% lossless and has **no operation cap**.

- Every revision stores all of its field changes in `d`; `d.length` is always
  the exact number of changes (`t` is never emitted).
- Modern archive diffs are applied forward and the stored ops are recomputed
  from the resulting definition states, so every `old`/`new` payload is exact
  even where the upstream diff file itself omitted a removed value.
- Whole-item `add`/`del` revisions are emitted as per-field ops. A removed
  definition therefore keeps its full payload in the removal revision, and
  reverse-patching across a remove → re-add sequence restores the older value.
- Arrays that change length are replaced atomically; arrays of equal length are
  diffed element by element. Entries added to or removed from an array are
  stored as index adds/removes, which reverse correctly when ops are replayed
  newest-first and right-to-left (`d.length - 1` … `0`).
- Objects that become primitives (or vice versa) are replaced atomically.
- Only the top-level `index` field is ignored; Bungie renumbers it for almost
  every insert and it is not part of a definition's identity.

Known upstream limitation: the archive's modern enhanced diff stream records
`displayProperties.icon` path changes only as field add/delete, not as edits.
Icon-path history after the 2020-06-16 bridge therefore cannot be recovered from
diff data alone; every other field round-trips exactly against the archived
SQLite snapshots. The uploader and verification scripts treat this as a known
source omission rather than diff truncation.

## Data discovered in the supplied archives

The ZIP contents differ from the approximate counts in the task description:

- `manifests.zip` has 64 usable English SQLite ZIPs. The matching
  `__MACOSX/._*` entries are macOS metadata sidecars and are ignored.
- The 2018 bundle has 3 usable English SQLite ZIPs.
- The 2019–2020 bundle has 33 ZIP entries but only 32 unique content MD5s. The
  duplicate `46cf9ce60af935fdb7103928794f1cd3` is represented by the later
  2020-02-13 archive entry.
- The supplied local archives therefore contribute 99 chronological snapshots
  after the one duplicate MD5 is removed; together with the 222 remote versions
  this is 321 history versions.
- The remote index has 222 versions. It lists 3,548 diff entries including
  `DestinyInventoryItemLiteDefinition`; excluding that redundant table leaves
  3,363 downloadable diff JSON files.

The actual source counts and precise date span are recorded in the generated
`build-report.json`. Local ZIP timestamps supply dates (normalized to UTC
midnight) and same-day ordering, while the remote `ManifestDate_UTC` supplies
modern dates. Explicit `gapBefore` markers identify the 2018-11-27 → 2019-01-20
and 2020-02-13 → 2020-06-16 gaps.

## Upload and verify

After a successful build:

```powershell
node .\scripts\history\upload-history-r2.mjs
```

The uploader invokes the repository's Wrangler config against the remote
`manifest-history` R2 bucket and Cloudflare account
`c5ec2772673dc72f5e58587ef4c80ff8`. It sets `Content-Type: application/json`,
sets `Content-Encoding: gzip` for `.json.gz`, and checkpoints each successful
artifact under the scratch directory. Before any write it scans every bucket
and **refuses to upload if any revision still carries the old truncation marker
`t`**.

Uploads are incremental by content: each local artifact's SHA-256 and size are
compared with `r2-upload-checkpoint.json`, and only files whose bytes actually
changed are uploaded. A rebuild that produces identical bucket bytes skips that
bucket even though its mtime moved, and unchanged `v1/releases/*.json.gz` files
are skipped the same way. `v1/versions.json` is always uploaded last, after
every changed bucket, snapshot, and release index, so the API never advertises
a version before its data is durable. Use `--force` to upload everything again.
The run reports changed vs unchanged buckets, snapshots, releases, and versions,
the uploaded compressed size, and the total compressed size of the data set.

By default, upload completion is followed by remote `wrangler r2 object get`
checks for `v1/versions.json`, Sunshot's bucket shard, and the newest
`v1/releases/{i}.json.gz`. The downloaded bytes are compared to the local files
and the gzip shard is decompressed to confirm Sunshot is present; the release
index must also match the newest version's `counts`. The uploader then lists
the remote `v1/` prefix using Cloudflare's R2 List Objects API and checks all
keys, byte sizes, content types, and gzip encodings. It uses
`CLOUDFLARE_API_TOKEN` when set, or reads the existing Wrangler OAuth token from
its local config at runtime; it never prints the token.
`r2-upload-report.json` records this exact prefix count separately from
Wrangler bucket-info usage statistics, which may lag behind recent writes.
