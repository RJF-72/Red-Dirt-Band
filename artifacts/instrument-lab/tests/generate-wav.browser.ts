import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { chromium } from '@playwright/test';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';

const baseUrl = process.env.INSTRUMENT_LAB_URL
  ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/` : 'http://127.0.0.1:23913/');
const launchOptions = { headless: true };
const apiServerRequire = createRequire(new URL('../../api-server/package.json', import.meta.url));
const { createClerkClient } = apiServerRequire('@clerk/express') as {
  createClerkClient(options: { secretKey: string }): {
    users: { getUserList(options: { emailAddress: string[] }): Promise<{ data: Array<{ id: string }> }> };
    signInTokens: { createSignInToken(options: { userId: string; expiresInSeconds: number }): Promise<{ url: string }> };
  };
};

test('Generate creates a downloadable WAV in the preview', async () => {
  const browser = await chromium.launch(launchOptions);
  let ownerPage: { context: BrowserContext; page: Page } | undefined;
  try {
    ownerPage = await createOwnerPage(browser);
    const { page } = ownerPage;
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
    if (ownerPage) await signOutAndClose(ownerPage.context, ownerPage.page);
    await browser.close();
  }
});

test('render failures are shown and Generate does not stay stuck', async () => {
  const browser = await chromium.launch(launchOptions);
  let ownerPage: { context: BrowserContext; page: Page } | undefined;
  try {
    ownerPage = await createOwnerPage(browser);
    const { page } = ownerPage;
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
    if (ownerPage) await signOutAndClose(ownerPage.context, ownerPage.page);
    await browser.close();
  }
});

test('manual and default control choices survive a delayed library refresh', async () => {
  const browser = await chromium.launch(launchOptions);
  let ownerPage: { context: BrowserContext; page: Page } | undefined;
  try {
    ownerPage = await createOwnerPage(browser);
    const { page } = ownerPage;
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
    await page.getByText('DEFAULTS', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await cabinet.inputValue(), '62');
    await page.getByRole('button', { name: 'Refresh library' }).click();
    await waitForRelease(releases);
    releases.shift()?.();
    await page.getByText('DEFAULTS', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await cabinet.inputValue(), '62');
  } finally {
    if (ownerPage) await signOutAndClose(ownerPage.context, ownerPage.page);
    await browser.close();
  }
});

async function assertVisible(locator: Locator) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
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

async function createOwnerPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const ownerEmail = process.env.AIM_OWNER_EMAIL;
  if (!secretKey || !ownerEmail) {
    throw new Error('CLERK_SECRET_KEY and AIM_OWNER_EMAIL are required for owner-workbench browser checks.');
  }

  const clerk = createClerkClient({ secretKey });
  const owner = await clerk.users.getUserList({ emailAddress: [ownerEmail] });
  const ownerId = owner.data[0]?.id;
  if (!ownerId) throw new Error('The configured AIM owner does not have a Clerk development user.');

  const signInToken = await clerk.signInTokens.createSignInToken({ userId: ownerId, expiresInSeconds: 60 });

  const signInContext = await browser.newContext();
  try {
    const signInPage = await signInContext.newPage();
    await signInPage.goto(signInToken.url, { waitUntil: 'networkidle' });
    const sessionCookies = await signInContext.cookies();
    if (!sessionCookies.some((cookie) => cookie.name.startsWith('__session'))) {
      throw new Error('Clerk did not establish an owner session for the browser check.');
    }

    const context = await browser.newContext();
    await context.addCookies(sessionCookies.map(({ name, value, expires, httpOnly, secure, sameSite }) => ({
      name,
      value,
      expires,
      httpOnly,
      secure,
      sameSite,
      url: baseUrl,
    })));
    return { context, page: await context.newPage() };
  } finally {
    await signInContext.close();
  }
}

async function signOutAndClose(context: BrowserContext, page: Page) {
  try {
    await page.evaluate(async () => { await window.Clerk?.signOut(); });
  } finally {
    await context.close();
  }
}