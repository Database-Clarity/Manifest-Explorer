#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = path.join(ROOT, 'src/data/manifestPatchNotes.generated.json');
const RSS_BASE = 'https://www.bungie.net/en/rss/NewsByCategory';
const CUTOFF = '2017-09-01';
const MAX_PAGES = 100;
const isIncremental = process.argv.includes('--incremental');

const HTML_ENTITIES = {
  '&amp;': '&',
  '&apos;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&nbsp;': ' ',
  '&quot;': '"',
  '&ndash;': '–',
  '&mdash;': '—',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
  '&hellip;': '…',
  '&copy;': '©',
};

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&[a-z]+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? entity);
}

function cleanText(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function readTag(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'i'));
  if (!match?.[1]) return '';
  const value = match[1].trim().replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');
  return decodeEntities(value);
}

function canonicalUrl(rawUrl) {
  const url = new URL(rawUrl, 'https://www.bungie.net');
  url.hash = '';
  url.search = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

function parseRss(xml) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi)].map(({ 1: item }) => {
    const rawLink = readTag(item, 'link');
    const rawDate = readTag(item, 'pubDate');
    const publishedTime = Date.parse(rawDate);
    const url = canonicalUrl(rawLink);
    return {
      title: cleanText(readTag(item, 'title')),
      url,
      guid: cleanText(readTag(item, 'guid')),
      published: Number.isFinite(publishedTime) ? new Date(publishedTime).toISOString() : null,
    };
  });
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/rss+xml, application/xml, text/xml, */*',
          'user-agent': 'ManifestExplorerPatchNotes/1.0 (+https://manifest.d2clarity.com)',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
  }
  throw lastError;
}

const NON_PATCH_TITLE_RE =
  /\b(?:marathon|twid|twab|this week in destiny|dev(?:elopment)? update|security update|content vault update|companion update|game director|road to|community update|launch blog|developer update|development update)\b/i;
const PATCH_TITLE_RE = /^destiny\s*2\s+(?:(?:pc|steam)\s+)?(?:update|hotfix|patch notes?)\b/i;
// Bungie omitted "2" from these six otherwise versioned D2 patch-note titles.
// Keep this narrow article-id allowlist rather than accepting generic Destiny
// updates from the global news feed.
const LEGACY_D2_ARTICLE_IDS = new Set([
  '/7/en/news/article/46410',
  '/7/en/news/article/46933',
  '/7/en/news/article/46973',
  '/7/en/news/article/47529',
  '/7/en/news/article/48060',
  '/7/en/news/article/50906',
]);
const PATCHISH_RE = /\b(?:update|hotfix|patch notes?)\b/i;
const VERSION_RE = /\b(?:update|hotfix)\s*(?:[-:–]\s*)?v?(\d+(?:\.\d+){1,3})\b/i;
const DATE_RE = /\b(?:update|hotfix)\b[^0-9]*(\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4}))\b/i;
const NUMBER_FIXES = new Map([
  ['/destiny_update_8_2_5_1', '8.2.5.1'],
  ['/destiny_update_8_5_2_4', '8.2.5.4'],
]);

function correctedTitle(title, number, url) {
  if (!number) return title;
  const pathname = new URL(url).pathname.toLowerCase();
  if (![...NUMBER_FIXES.keys()].some((articleId) => pathname.endsWith(articleId))) return title;
  return title.replace(VERSION_RE, (match, originalNumber) =>
    originalNumber === number ? match : match.replace(originalNumber, number),
  );
}

function toPatchNote(item) {
  if (!item.published) return null;
  const date = item.published.slice(0, 10);
  const title = item.title.trim();
  const pathname = new URL(item.url).pathname.toLowerCase();
  const isLegacyD2Title = LEGACY_D2_ARTICLE_IDS.has(pathname);
  if (
    date < CUTOFF ||
    (!PATCH_TITLE_RE.test(title) && !isLegacyD2Title) ||
    !PATCHISH_RE.test(title) ||
    NON_PATCH_TITLE_RE.test(title) ||
    !(/\d/.test(title) || /patch notes?/i.test(title))
  ) {
    return null;
  }

  const kind = /\bhotfix\b/i.test(title) ? 'hotfix' : 'update';
  const number =
    [...NUMBER_FIXES].find(([articleId]) => pathname.endsWith(articleId))?.[1] ??
    title.match(VERSION_RE)?.[1] ??
    undefined;
  const dateLabel = title.match(DATE_RE)?.[1];
  const label = `${kind === 'hotfix' ? 'Hotfix' : 'Update'} ${number ?? dateLabel ?? title.replace(/^Destiny(?:\s*2)?\s+/i, '')}`;
  return {
    date,
    kind,
    ...(number ? { number } : {}),
    label,
    title: correctedTitle(title, number, item.url),
    url: item.url,
  };
}

function dedupeItems(items) {
  const seenUrls = new Set();
  const seenGuids = new Set();
  const deduped = [];
  for (const item of items) {
    const url = canonicalUrl(item.url);
    const guid = item.guid?.trim();
    if (seenUrls.has(url) || (guid && seenGuids.has(guid))) continue;
    seenUrls.add(url);
    if (guid) seenGuids.add(guid);
    deduped.push({ ...item, url });
  }
  return deduped;
}

async function readExistingNotes() {
  try {
    const parsed = JSON.parse(await readFile(OUTPUT, 'utf8'));
    return Array.isArray(parsed.notes) ? parsed.notes : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function harvest() {
  const pagesToFetch = isIncremental ? 3 : MAX_PAGES;
  const collected = [];
  let consecutiveEmptyPages = 0;
  let reachedCutoff = false;

  for (let page = 1; page <= pagesToFetch; page += 1) {
    const url = `${RSS_BASE}?category=updates&currentpage=${page}&itemsperpage=25`;
    const items = parseRss(await fetchText(url));
    console.log(`RSS page ${page}: ${items.length} items`);
    if (items.length === 0) {
      consecutiveEmptyPages += 1;
      if (!isIncremental && consecutiveEmptyPages >= 2) break;
      continue;
    }
    consecutiveEmptyPages = 0;
    collected.push(...items);

    if (
      !isIncremental &&
      items.some((item) => item.published && item.published.slice(0, 10) < CUTOFF)
    ) {
      reachedCutoff = true;
      break;
    }
  }

  if (!isIncremental && !reachedCutoff && consecutiveEmptyPages < 2) {
    throw new Error(`Reached page limit (${MAX_PAGES}) before the ${CUTOFF} cutoff.`);
  }
  return dedupeItems(collected);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function noteOrder(a, b) {
  return (
    compareText(b.date, a.date) ||
    compareText(a.label, b.label) ||
    compareText(a.url, b.url)
  );
}

const harvestedItems = await harvest();
const harvestedNotes = harvestedItems.map(toPatchNote).filter(Boolean);
const existingNotes = isIncremental ? await readExistingNotes() : [];
const byUrl = new Map();
for (const note of [...existingNotes, ...harvestedNotes]) {
  byUrl.set(canonicalUrl(note.url), { ...note, url: canonicalUrl(note.url) });
}
const notes = [...byUrl.values()].sort(noteOrder);

await writeFile(OUTPUT, `${JSON.stringify({ notes })}\n`, 'utf8');
console.log(
  `${isIncremental ? 'Incremental update' : 'Full rebuild'} complete: ${harvestedNotes.length} RSS notes, ${notes.length} unique notes in ${path.relative(ROOT, OUTPUT)}`,
);
