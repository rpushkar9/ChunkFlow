import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

const EXTENSION_PATH = path.resolve(process.cwd(), 'web_plugin_22_full_functionality');
const TEST_URL_CHUNKED = process.env.CHUNKFLOW_TEST_URL_CHUNKED || 'http://ipv4.download.thinkbroadband.com/20MB.zip';
const TEST_URL_LARGE = process.env.CHUNKFLOW_TEST_URL_LARGE || 'http://ipv4.download.thinkbroadband.com/1GB.zip';
const LAUNCH_CHANNEL = process.env.CHUNKFLOW_PLAYWRIGHT_CHANNEL || 'chromium';

const MODE_TIMEOUT_MS = Number(process.env.CHUNKFLOW_MODE_TIMEOUT_MS || 180000);
const WORKER_TIMEOUT_MS = Number(process.env.CHUNKFLOW_WORKER_TIMEOUT_MS || 60000);
const PROFILE_DIR_PREFIX = path.join(os.tmpdir(), 'chunkflow-playwright-profile-');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getExtensionState(page) {
  return page.evaluate(async () => {
    const storage = await new Promise((resolve) => {
      chrome.storage.local.get({ downloadModes: {}, activeChunkFetches: [] }, resolve);
    });

    const downloads = await new Promise((resolve) => {
      chrome.downloads.search({ orderBy: ['-startTime'], limit: 15 }, resolve);
    });

    return {
      storage,
      downloads: downloads.map((d) => ({
        id: d.id,
        byExtensionId: d.byExtensionId,
        url: d.url,
        finalUrl: d.finalUrl,
        filename: d.filename,
        state: d.state
      }))
    };
  });
}

async function waitForServiceWorker(context, timeoutMs) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const workers = context.serviceWorkers();
    if (workers.length > 0) {
      return workers[0];
    }
    await sleep(500);
  }

  throw new Error(`Timed out waiting for extension service worker after ${timeoutMs}ms`);
}

async function cancelAndErase(page, downloadId) {
  await page.evaluate(async (id) => {
    await new Promise((resolve) => chrome.downloads.cancel(id, () => resolve()));
    await new Promise((resolve) => chrome.downloads.erase({ id }, () => resolve()));
  }, downloadId);
}

async function triggerStartDownload(page, url) {
  return page.evaluate((downloadUrl) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'START_DOWNLOAD', url: downloadUrl }, (response) => {
        resolve(response || null);
      });
    });
  }, url);
}

async function waitForMode(page, beforeIds, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const state = await getExtensionState(page);
    const after = state.downloads.find((d) => !beforeIds.has(d.id));
    if (after) {
      const mode = state.storage.downloadModes[String(after.id)];
      if (mode) {
        return {
          download: after,
          mode,
          activeChunkFetches: state.storage.activeChunkFetches
        };
      }
    }
    await sleep(500);
  }

  throw new Error(`Timed out waiting for download mode after ${timeoutMs}ms`);
}

async function runScenario(page, name, url, expectedMode) {
  const before = await getExtensionState(page);
  const beforeIds = new Set(before.downloads.map((d) => d.id));

  const sendResponse = await triggerStartDownload(page, url);
  if (!sendResponse || sendResponse.success !== true) {
    throw new Error(`[${name}] START_DOWNLOAD rejected: ${JSON.stringify(sendResponse)}`);
  }

  const result = await waitForMode(page, beforeIds, MODE_TIMEOUT_MS);
  const ok = result.mode === expectedMode;

  if (result.download?.id) {
    await cancelAndErase(page, result.download.id);
  }

  return {
    name,
    expectedMode,
    actualMode: result.mode,
    byExtensionId: result.download.byExtensionId,
    url: result.download.url,
    ok
  };
}

async function main() {
  const profileDir = fs.mkdtempSync(PROFILE_DIR_PREFIX);
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: LAUNCH_CHANNEL,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });

  try {
    const worker = await waitForServiceWorker(context, WORKER_TIMEOUT_MS);
    worker.on('console', (msg) => {
      console.log(`[sw:${msg.type()}] ${msg.text()}`);
    });
    console.log(`Service worker URL: ${worker.url()}`);
    const extensionId = new URL(worker.url()).hostname;

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    const results = [];
    results.push(await runScenario(popup, 'chunked-20mb', TEST_URL_CHUNKED, 'chunked'));
    results.push(await runScenario(popup, 'normal-1gb', TEST_URL_LARGE, 'normal'));

    for (const result of results) {
      const marker = result.ok ? 'PASS' : 'FAIL';
      console.log(`${marker} ${result.name}: expected=${result.expectedMode} actual=${result.actualMode} byExtensionId=${result.byExtensionId}`);
      console.log(`  createdUrl=${result.url}`);
    }

    if (results.some((r) => !r.ok)) {
      process.exitCode = 1;
    }
  } finally {
    await context.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
