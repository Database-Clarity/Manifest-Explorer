import http from 'node:http';
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const repoRoot = path.resolve(import.meta.dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const useLocalDist = process.env.OG_CAPTURE_START_PREVIEW === '1';
let baseUrl = process.env.OG_CAPTURE_BASE_URL ?? 'https://manifest.d2clarity.com';
const historyOnly = process.env.OG_CAPTURE_HISTORY_ONLY === '1';
const changelogKey = 'clarity-manifest-explorer:last-seen-changelog';
const settingsKey = 'clarity-manifest-settings';
const changelogMeta = readFileSync(
  path.join(repoRoot, 'src', 'data', 'changelogMeta.ts'),
  'utf8',
);
const latestChangelogVersion = changelogMeta.match(
  /^export const LATEST_CHANGELOG_VERSION = '([^']+)';$/m,
)?.[1];
if (!latestChangelogVersion) {
  throw new Error('Could not read LATEST_CHANGELOG_VERSION from src/data/changelogMeta.ts.');
}

function findBrowserExecutable() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const playwrightExecutable = chromium.executablePath();
  if (existsSync(playwrightExecutable)) return playwrightExecutable;

  const systemCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : '',
  ].filter(Boolean);
  const systemChrome = systemCandidates.find((candidate) => existsSync(candidate));
  if (systemChrome) return systemChrome;

  const browserCache = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
    : '';
  if (browserCache && existsSync(browserCache)) {
    const candidates = readdirSync(browserCache)
      .filter((entry) => /^chromium(?:_headless_shell)?-\d+$/.test(entry))
      .sort((left, right) => {
        const leftRevision = Number(left.match(/\d+$/)?.[0] ?? 0);
        const rightRevision = Number(right.match(/\d+$/)?.[0] ?? 0);
        return rightRevision - leftRevision;
      })
      .flatMap((entry) => [
        path.join(browserCache, entry, 'chrome-win64', 'chrome.exe'),
        path.join(browserCache, entry, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
      ]);
    const installed = candidates.find((candidate) => existsSync(candidate));
    if (installed) return installed;
  }
  throw new Error(
    'Chromium was not found. Set CHROMIUM_PATH or install a browser with Playwright.',
  );
}

const browserExecutable = findBrowserExecutable();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function startLocalDistServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (reqUrl.pathname.startsWith('/api/')) {
        const upstream = `https://manifest.d2clarity.com${reqUrl.pathname}${reqUrl.search}`;
        const upRes = await fetch(upstream, {
          headers: { accept: req.headers.accept || '*/*' },
        });
        const buf = Buffer.from(await upRes.arrayBuffer());
        const headers = { 'cache-control': 'no-store' };
        const ct = upRes.headers.get('content-type');
        if (ct) headers['content-type'] = ct;
        res.writeHead(upRes.status, headers);
        res.end(buf);
        return;
      }
      let relPath = decodeURIComponent(reqUrl.pathname);
      if (relPath === '/' || relPath === '') relPath = '/index.html';
      let filePath = path.join(distDir, relPath);
      if (
        !filePath.startsWith(distDir) ||
        !existsSync(filePath) ||
        statSync(filePath).isDirectory()
      ) {
        filePath = path.join(distDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME_TYPES[ext] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 4179;
  return { server, url: `http://127.0.0.1:${port}` };
}

async function waitForCapturePaint(page) {
  await page.locator('footer[aria-label="Manifest status"] [role="status"]')
    .filter({ hasText: 'Ready' })
    .waitFor({ timeout: 90_000 });
  await delay(600);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const visibleImages = [...document.images].filter((image) => {
        const bounds = image.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 && (image.currentSrc || image.getAttribute('src'));
      });
      const pending = visibleImages.filter((image) => !image.complete);
      if (pending.length === 0) break;
      await Promise.race([
        Promise.all(
          pending.map(
            (image) =>
              new Promise((resolve) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
              }),
          ),
        ),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
    const visibleImages = [...document.images].filter((image) => {
      const bounds = image.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0 && (image.currentSrc || image.getAttribute('src'));
    });
    await Promise.all(
      visibleImages.map((image) =>
        Promise.race([
          image.decode().catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]),
      ),
    );
  });
  const visibleBrokenImages = await page.evaluate(() =>
    [...document.images].filter((image) => {
      const bounds = image.getBoundingClientRect();
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        (image.currentSrc || image.getAttribute('src')) &&
        (!image.complete || image.naturalWidth === 0)
      );
    }).length,
  );
  if (visibleBrokenImages > 0) {
    throw new Error(`Found ${visibleBrokenImages} visible image(s) that did not load.`);
  }
  const modalCount = await page
    .locator('[role="dialog"]:visible, [aria-modal="true"]:visible')
    .count();
  if (modalCount > 0) {
    throw new Error(`Found ${modalCount} visible modal/overlay element(s) before capture.`);
  }
  await delay(500);
}

async function setTheme(page, theme) {
  const settingsButton = page.getByRole('button', { name: 'Settings', exact: true }).first();
  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  if (!(await settingsDialog.isVisible().catch(() => false))) {
    await settingsButton.click();
  }
  const themeGroup = page.getByRole('group', { name: 'Theme' });
  await themeGroup.waitFor();
  const themeButton = themeGroup.getByRole('button', {
    name: theme === 'dark' ? 'Dark' : 'Light',
    exact: true,
  });
  if ((await themeButton.getAttribute('aria-pressed')) !== 'true') {
    await themeButton.click();
  }
  await page.keyboard.press('Escape');
  await settingsDialog.waitFor({ state: 'hidden' });
}

async function measureSplitLayout(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('[class*="splitCell"]')];
    const codes = cells
      .map((cell) => cell.querySelector('code'))
      .filter((code) => code instanceof HTMLElement);
    const target = codes.find(
      (code) => code.textContent?.trim() === '"isFeaturedItem": true,',
    );
    const targetCell = target?.closest('[class*="splitCell"]');
    const codeWidths = codes.map((code) => code.getBoundingClientRect().width);
    return {
      cellWidth: targetCell?.getBoundingClientRect().width ?? 0,
      minCodeWidth: codeWidths.length ? Math.min(...codeWidths) : 0,
      codeWidth: target?.getBoundingClientRect().width ?? 0,
      targetHeight: target?.getBoundingClientRect().height ?? 0,
      codeCount: codes.length,
      hasTargetLine: Boolean(target),
    };
  });
}

async function assertSplitLayout(page, label, { requireWideCode = true } = {}) {
  const metrics = await measureSplitLayout(page);
  if (
    !metrics.codeCount ||
    (requireWideCode && metrics.codeWidth < 300)
  ) {
    throw new Error(
      `${label}: Split code width must be >= 300px; measured ${metrics.codeWidth}px.`,
    );
  }
  if (!metrics.hasTargetLine) {
    throw new Error(`${label}: Could not find the "isFeaturedItem": true, diff line.`);
  }
  if (metrics.targetHeight > 28) {
    throw new Error(
      `${label}: "isFeaturedItem": true, wrapped to ${metrics.targetHeight}px high.`,
    );
  }
  console.log(
    `${label}: splitCell=${metrics.cellWidth.toFixed(1)}px, code=${metrics.codeWidth.toFixed(1)}px (min ${metrics.minCodeWidth.toFixed(1)}px), target line=${metrics.targetHeight.toFixed(1)}px.`,
  );
}

async function measureInlineGrid(page) {
  return page.evaluate(() => {
    const line = document.querySelector(
      '[aria-label="Inline JSON diff"] [class*="addedLine"], [aria-label="Inline JSON diff"] [class*="removedLine"], [aria-label="Inline JSON diff"] [class*="contextLine"]',
    );
    if (!(line instanceof HTMLElement)) return null;
    const columns = getComputedStyle(line).gridTemplateColumns;
    return {
      columns,
      count: columns.trim().split(/\s+/).length,
      scrollWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ),
      viewportWidth: window.innerWidth,
    };
  });
}

async function assertInlineGrid(page, expectedColumns, label) {
  const metrics = await measureInlineGrid(page);
  if (!metrics || metrics.count !== expectedColumns) {
    throw new Error(
      `${label}: expected ${expectedColumns} inline grid columns; measured ${metrics?.columns ?? 'none'}.`,
    );
  }
  if (
    expectedColumns === 3 &&
    metrics.scrollWidth > metrics.viewportWidth
  ) {
    throw new Error(
      `${label}: horizontal overflow ${metrics.scrollWidth}px > ${metrics.viewportWidth}px.`,
    );
  }
  console.log(
    `${label}: inline grid=${metrics.columns}; overflow=${Math.max(0, metrics.scrollWidth - metrics.viewportWidth)}px.`,
  );
}

let localServer;
let browser;
try {
  if (useLocalDist) {
    const started = await startLocalDistServer();
    localServer = started.server;
    baseUrl = started.url;
    console.log(`Local dist server listening at ${baseUrl}.`);
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutable,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  await context.addInitScript(
    ({ changelogKey: key, settingsKey: preferenceKey, latestChangelogVersion: version }) => {
      localStorage.setItem(key, version);
      localStorage.setItem(
        preferenceKey,
        JSON.stringify({
          state: {
            theme: 'dark',
            viewMode: 'grid',
            railCollapsed: true,
            railWidth: 224,
            inspectorWidth: 600,
          },
          version: 1,
        }),
      );
    },
    { changelogKey, settingsKey, latestChangelogVersion },
  );
  const page = await context.newPage();
  await page.route('**/api/history/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const upstreamUrl = new URL(
      `${requestUrl.pathname}${requestUrl.search}`,
      'https://manifest.d2clarity.com',
    );
    await route.fulfill({
      response: await route.fetch({ url: upstreamUrl.href }),
    });
  });

  if (!historyOnly) {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.locator('[class*="gridCell"]').first().waitFor({ timeout: 120_000 });
    console.log('Explorer results loaded.');
    const explorerSearch = page.locator('textarea').first();
    await explorerSearch.fill('Sunshot');
    const sunshotResult = page.getByRole('option').filter({ hasText: 'Sunshot' }).first();
    await sunshotResult.waitFor({ timeout: 60_000 });
    console.log('Sunshot search result found.');
    await sunshotResult.click();
    await page.getByRole('heading', { name: 'Sunshot', exact: true }).waitFor({
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => !document.querySelector('[class*="liteTag"]'),
      null,
      { timeout: 120_000 },
    );
    console.log('Sunshot inspector opened.');
    await explorerSearch.fill('Rampage');
    await page.getByRole('option').filter({ hasText: 'Rampage' }).first().waitFor({
      timeout: 60_000,
    });
    await waitForCapturePaint(page);
    await explorerSearch.evaluate((element) => element.blur());
    await page.screenshot({
      path: path.join(repoRoot, 'public', 'og-image.png'),
      type: 'png',
    });
  }

  await page.goto(`${baseUrl}/history/315`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  await page.getByRole('heading', { name: 'Jun 9, 2026' }).waitFor({
    timeout: 120_000,
  });
  console.log('History release loaded.');
  const historySearch = page.getByLabel('Search changed entries');
  await historySearch.fill('Sunshot');
  const historySunshot = page.locator('[class*="entryCard"]').filter({ hasText: 'Sunshot' }).first();
  await historySunshot.waitFor({ timeout: 60_000 });
  await historySunshot.click();
  await page.getByRole('heading', { name: 'Sunshot', exact: true }).waitFor({
    timeout: 60_000,
  });
  await page.getByRole('region', { name: 'Side-by-side JSON diff' }).waitFor({
    timeout: 60_000,
  });
  const diffView = page.getByRole('group', { name: 'Entry view' });
  const diffSelected = await diffView
    .getByRole('button', { name: 'Diff', exact: true })
    .getAttribute('aria-pressed');
  if (diffSelected !== 'true') {
    throw new Error('The history entry did not open on the Diff tab.');
  }
  const splitSelected = await page
    .getByRole('group', { name: 'Diff layout' })
    .getByRole('button', { name: 'Split' })
    .getAttribute('aria-pressed');
  if (splitSelected !== 'true') {
    throw new Error('The history diff did not open in Split layout.');
  }
  if (!(await page.getByRole('checkbox', { name: 'Wrap' }).isChecked())) {
    throw new Error('The history diff Wrap option is not enabled.');
  }

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.getByRole('region', { name: 'Side-by-side JSON diff' }).waitFor();
  await assertSplitLayout(page, 'Final capture 1200×630, dark');
  if (!(await page.getByRole('checkbox', { name: 'Wrap' }).isChecked())) {
    throw new Error('The final history capture requires Wrap to be enabled.');
  }
  await waitForCapturePaint(page);
  await page.screenshot({
    path: path.join(repoRoot, 'public', 'og-history.png'),
    type: 'png',
  });

  console.log(
    historyOnly
      ? 'Captured public/og-history.png at 1200×630.'
      : 'Captured public/og-image.png and public/og-history.png at 1200×630.',
  );
  await context.close();
} finally {
  try {
    if (browser) await browser.close();
  } catch {}
  if (localServer) {
    await new Promise((resolve) => localServer.close(resolve));
  }
}
