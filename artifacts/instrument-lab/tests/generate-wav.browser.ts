import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import type { Locator } from '@playwright/test';

const baseUrl = process.env.INSTRUMENT_LAB_URL ?? 'http://127.0.0.1:23913/';
const launchOptions = { headless: true };
const ownerStorageState = process.env.INSTRUMENT_LAB_OWNER_STORAGE_STATE;

test('Generate creates a downloadable WAV in the preview', async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.goto(baseUrl);
    const generate = page.getByRole('button', { name: 'Generate WAV performance' });
    await assertVisible(generate);
    await generate.click();

    const download = page.locator('a.download-link[download$=".wav"]');
    await download.waitFor({ state: 'visible', timeout: 15_000 });
    assert.match(await download.getAttribute('href') ?? '', /^blob:/);
    assert.match(await download.textContent() ?? '', /save WAV/);
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      download.click(),
    ]);
    assert.match(file.suggestedFilename(), /\.wav$/);
  } finally {
    await browser.close();
  }
});

test('render failures are shown and Generate does not stay stuck', async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, 'OfflineAudioContext', {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'Generate WAV performance' }).click();
    await page.getByRole('alert').waitFor({ state: 'visible' });
    assert.match(await page.getByRole('alert').textContent() ?? '', /OfflineAudioContext/);
    assert.equal(await page.getByRole('button', { name: 'Generate WAV performance' }).isEnabled(), true);
  } finally {
    await browser.close();
  }
});

test('manual and default control choices survive a delayed library refresh', async (t) => {
  if (!ownerStorageState) {
    t.skip('Set INSTRUMENT_LAB_OWNER_STORAGE_STATE to run owner-workbench browser checks.');
    return;
  }
  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({ storageState: ownerStorageState });
    const page = await context.newPage();
    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'Bass guitar' }).click();
    await page.getByRole('button', { name: 'Refresh library' }).waitFor({ state: 'visible' });

    const releases: Array<() => void> = [];
    await page.route('**/api/studio/library', async (route) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ projects: [], packages: [], references: [] }) });
    });
    const cabinet = page.getByLabel('Cabinet weight');

    await page.getByRole('button', { name: 'Refresh library' }).click();
    await waitForRelease(releases);
    await setRangeValue(cabinet, 60);
    await page.getByText('MANUAL OVERRIDE').waitFor({ state: 'visible' });
    releases.shift()?.();
    await page.getByText('MANUAL OVERRIDE').waitFor({ state: 'visible' });
    assert.equal(await cabinet.inputValue(), '60');

    await page.getByRole('button', { name: 'Reset defaults' }).click();
    await page.getByText('DEFAULTS').waitFor({ state: 'visible' });
    assert.equal(await cabinet.inputValue(), '62');
    await page.getByRole('button', { name: 'Refresh library' }).click();
    await waitForRelease(releases);
    releases.shift()?.();
    await page.getByText('DEFAULTS').waitFor({ state: 'visible' });
    assert.equal(await cabinet.inputValue(), '62');
  } finally {
    await browser.close();
  }
});

async function assertVisible(locator: { isVisible(): Promise<boolean> }) {
  assert.equal(await locator.isVisible(), true);
}

async function waitForRelease(releases: Array<() => void>) {
  for (let attempt = 0; attempt < 50 && !releases.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(releases.length, 'library refresh should be intercepted before changing controls');
}

async function setRangeValue(locator: Locator, value: number) {
  await locator.evaluate((element, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, String(next));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}