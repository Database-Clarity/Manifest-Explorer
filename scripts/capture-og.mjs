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
const baseUrl = process.env.OG_CAPTURE_BASE_URL ?? 'http://127.0.0.1:8796';
const changelogKey = 'clarity-manifest-explorer:last-seen-changelog';
const settingsKey = 'clarity-manifest-settings';
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

let chromiumProcess;
let browser;
try {
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
    ({ changelogKey: key, settingsKey: preferenceKey }) => {
      localStorage.setItem(key, '2026.11.24-1');
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
    { changelogKey, settingsKey },
  );
  const page = await context.newPage();

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
    () => {
      const liteTag = document.querySelector('[class*="liteTag"]');
      return !liteTag;
    },
    null,
    { timeout: 120_000 },
  );
  await page.locator('footer[aria-label="Manifest status"] [role="status"]')
    .filter({ hasText: 'Ready' })
    .waitFor({ timeout: 180_000 });
  console.log('Sunshot inspector opened.');
  await explorerSearch.fill('Rampage');
  await page.getByRole('option').filter({ hasText: 'Rampage' }).first().waitFor({
    timeout: 60_000,
  });
  await explorerSearch.evaluate((element) => element.blur());
  await page.screenshot({
    path: path.join(repoRoot, 'public', 'og-image.png'),
    type: 'png',
  });

  await page.goto(`${baseUrl}/history/315`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  await page.getByRole('heading', { name: 'May 29, 2026' }).waitFor({
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
  await page.screenshot({
    path: path.join(repoRoot, 'public', 'og-history.png'),
    type: 'png',
  });

  console.log('Captured public/og-image.png and public/og-history.png at 1200×630.');
  await context.close();
} finally {
  try {
    if (browser) await browser.close();
  } catch {}
  terminateProcessTree(chromiumProcess);
  await delay(500);
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Could not remove temporary browser profile: ${error.message}`);
  }
}
