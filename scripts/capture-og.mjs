import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const repoRoot = path.resolve(import.meta.dirname, '..');
const baseUrl = process.env.OG_CAPTURE_BASE_URL ?? 'https://manifest.d2clarity.com';
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
const profileRoot = path.join(
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
    : path.join(os.tmpdir(), 'opencode'),
  'capture-og',
);
mkdirSync(profileRoot, { recursive: true });
const profileDir = mkdtempSync(path.join(profileRoot, 'chromium-'));
const devtoolsFile = path.join(profileDir, 'DevToolsActivePort');
function findBrowserExecutable() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const playwrightExecutable = chromium.executablePath();
  if (existsSync(playwrightExecutable)) return playwrightExecutable;

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

function terminateProcessTree(child) {
  if (!child?.pid) return;
  spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
}

async function waitForCapturePaint(page) {
  await page.locator('footer[aria-label="Manifest status"] [role="status"]')
    .filter({ hasText: 'Ready' })
    .waitFor({ timeout: 180_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const visibleImages = [...document.images].filter((image) => {
      const bounds = image.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    await Promise.all(visibleImages.map((image) => image.decode().catch(() => undefined)));
  });
  const visibleBrokenImages = await page.evaluate(() =>
    [...document.images].filter((image) => {
      const bounds = image.getBoundingClientRect();
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        image.currentSrc &&
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
  await delay(700);
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

async function waitForDevToolsPort(child) {
  let startupError;
  child.once('error', (error) => {
    startupError = error;
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) {
      throw new Error(`Headless Chromium exited with code ${child.exitCode}.`);
    }
    if (existsSync(devtoolsFile)) {
      const [port] = readFileSync(devtoolsFile, 'utf8').trim().split(/\r?\n/);
      if (port && /^\d+$/.test(port)) return Number(port);
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for Chromium DevTools.');
}

async function waitForPreview(child) {
  let startupError;
  child.once('error', (error) => {
    startupError = error;
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) {
      throw new Error(`Vite preview exited with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch('http://127.0.0.1:4179/');
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error('Timed out waiting for Vite preview on port 4179.');
}

let chromiumProcess;
let previewProcess;
let browser;
try {
  if (process.env.OG_CAPTURE_START_PREVIEW === '1') {
    previewProcess = spawn(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        '4179',
        '--strictPort',
      ],
      {
        cwd: repoRoot,
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    await waitForPreview(previewProcess);
    console.log('Vite preview serving dist/ at http://127.0.0.1:4179.');
  }
  chromiumProcess = spawn(
    browserExecutable,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    {
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  const port = await waitForDevToolsPort(chromiumProcess);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
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

  await setTheme(page, 'light');
  for (const [width, height] of [
    [1280, 900],
    [1200, 630],
  ]) {
    await page.setViewportSize({ width, height });
    await assertSplitLayout(page, `Light ${width}×${height}, Wrap on`);
  }
  await page.getByRole('checkbox', { name: 'Wrap' }).uncheck();
  await assertSplitLayout(page, 'Light 1200×630, Wrap off', {
    requireWideCode: false,
  });
  await page.getByRole('checkbox', { name: 'Wrap' }).check();
  await assertSplitLayout(page, 'Light 1200×630, Wrap on again');

  await page.getByRole('group', { name: 'Diff layout' })
    .getByRole('button', { name: 'Inline', exact: true })
    .click();
  await page.getByRole('region', { name: 'Inline JSON diff' }).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  await assertInlineGrid(page, 4, 'Light desktop');
  await page.getByRole('group', { name: 'Diff layout' })
    .getByRole('button', { name: 'Split', exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('region', { name: 'Inline JSON diff' }).waitFor();
  await assertInlineGrid(page, 3, 'Light mobile 390×844');

  await page.setViewportSize({ width: 1280, height: 900 });
  await setTheme(page, 'dark');
  for (const [width, height] of [
    [1280, 900],
    [1200, 630],
  ]) {
    await page.setViewportSize({ width, height });
    await assertSplitLayout(page, `Dark ${width}×${height}, Wrap on`);
  }
  await page.getByRole('group', { name: 'Diff layout' })
    .getByRole('button', { name: 'Inline', exact: true })
    .click();
  await page.getByRole('region', { name: 'Inline JSON diff' }).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  await assertInlineGrid(page, 4, 'Dark desktop');
  await page.getByRole('group', { name: 'Diff layout' })
    .getByRole('button', { name: 'Split', exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('region', { name: 'Inline JSON diff' }).waitFor();
  await assertInlineGrid(page, 3, 'Dark mobile 390×844');

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
  terminateProcessTree(chromiumProcess);
  terminateProcessTree(previewProcess);
  await delay(500);
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Could not remove temporary browser profile: ${error.message}`);
  }
}
