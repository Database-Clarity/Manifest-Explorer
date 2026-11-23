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
`/index`-only edit is discarded, and checks the 512-way bucket calculation.

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
  2020-06-16 bridge snapshot, then consumes the archive's modern diffs.
- Emits `v1/versions.json`, all deterministic bucket shards, and the latest
  English SQLite snapshot as gzip-compressed JSON.
- Writes `build-report.json` outside the repo, including counts and Sunshot's
  revision timeline.

Optional future local ZIP bundles can be included with one or more
`--extra-zips <directory>` arguments. The directory is scanned recursively;
English entries are preferred and duplicate content MD5s collapse to the
latest dated copy. To change scratch or output locations, use `--scratch-dir`
and optionally `--output-dir` (which must remain a child of scratch).

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
`c5ec2772673dc72f5e58587ef4c80ff8`. It uploads with parallelism 8, sets
`Content-Type: application/json`, sets `Content-Encoding: gzip` for `.json.gz`,
and checkpoints each successful artifact under the scratch directory. Re-running
skips files whose size, modification time, and SHA-256 still match the
checkpoint. Use `--force` to upload everything again.

By default, upload completion is followed by remote `wrangler r2 object get`
checks for `v1/versions.json` and Sunshot's bucket shard. The downloaded bytes
are compared to the local files and the gzip shard is decompressed to confirm
Sunshot is present. The uploader then lists the remote `v1/` prefix using
Cloudflare's R2 List Objects API and checks all keys, byte sizes, content types,
and gzip encodings. It uses `CLOUDFLARE_API_TOKEN` when set, or reads the
existing Wrangler OAuth token from its local config at runtime; it never prints
the token. `r2-upload-report.json` records this exact prefix count separately
from Wrangler bucket-info usage statistics, which may lag behind recent writes.
