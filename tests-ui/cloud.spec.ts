/**
 * The hosted app's account, against the in-memory test server (`?cloud=fake`): the
 * three sign-in steps, the ledger saved encrypted, opened again, locked, signed out
 * and back in. Then the phone layout, and the GitHub Pages build itself under its
 * security policy. Any console error fails a test, a CSP violation included.
 */
import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

function watch(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

const EMAIL = 'me@example.com';
const PASSWORD = 'a long sign-in password';
const PHRASE = 'correct horse battery staple';

async function createAccount(page: Page, base = '/') {
  await page.goto(`${base}?cloud=fake#/today`);
  await page.getByTestId('auth-to-signup').click();
  await page.getByTestId('auth-email').fill(EMAIL);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-password-again').fill(PASSWORD);
  await page.getByTestId('auth-signup').click();
  await expect(page.getByRole('heading', { name: 'Add an authenticator' })).toBeVisible();
  await expect(page.getByTestId('auth-secret')).toHaveText('JBSW Y3DP EHPK 3PXP');
  await page.getByTestId('auth-code').fill('123456');
  await page.getByTestId('auth-verify').click();
  await expect(page.getByRole('heading', { name: 'Choose a passphrase' })).toBeVisible();
  await page.getByTestId('auth-passphrase').fill(PHRASE);
  await page.getByTestId('auth-passphrase-again').fill(PHRASE);
  await expect(page.getByTestId('auth-unlock')).toBeDisabled();
  await page.getByTestId('auth-understood').check();
  await page.getByTestId('auth-unlock').click();
  await expect(page.locator('.ph-title')).toHaveText('Today', { timeout: 15_000 });
}

/** The item added in the first test, looked for where it lives: Waiting on. */
async function seeItem(page: Page) {
  await expect(page.locator('.sidenav-brand-name')).toHaveText('LEDGER', { timeout: 15_000 });
  await page.evaluate(() => (location.hash = '#/wait'));
  await expect(page.locator('.rows')).toContainText('TAWR for the weekend');
}

async function addAndWaitSaved(page: Page, text: string) {
  const input = page.locator('[data-quickadd="main"]');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  await expect(page.getByTestId('save-state')).toContainText('Saved', { timeout: 10_000 });
}

test('an account: three steps in, saved encrypted, locked, signed out and back', async ({ page }) => {
  const errors = watch(page);
  await createAccount(page);
  await addAndWaitSaved(page, '@"Sam Lee" signed TAWR for the weekend by fri');

  // The server holds the ledger, but not readable.
  const server = await page.evaluate(() => localStorage.getItem('ledger-fake-server') ?? '');
  expect(server).toContain('"ledgers"');
  expect(server).not.toContain('TAWR');
  expect(server).not.toContain('Sam Lee');

  // Opening again on this device: the session and the remembered key, nothing asked.
  await page.reload();
  await seeItem(page);

  // Forgetting the passphrase here: it is asked for, a wrong one is refused.
  await page.goto('/?cloud=fake#/settings');
  await page.getByTestId('account-lock').click();
  await expect(page.getByRole('heading', { name: 'Your passphrase' })).toBeVisible();
  await page.getByTestId('auth-passphrase').fill('not the passphrase at all');
  await page.getByTestId('auth-unlock').click();
  await expect(page.getByRole('alert')).toContainText('does not open this ledger');
  await page.getByTestId('auth-passphrase').fill(PHRASE);
  await page.getByTestId('auth-unlock').click();
  await seeItem(page);

  // Signing out leaves nothing usable here: password, code and passphrase again.
  await page.goto('/?cloud=fake#/settings');
  await page.getByTestId('account-signout').click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByTestId('auth-email').fill(EMAIL);
  await page.getByTestId('auth-password').fill('the wrong password!');
  await page.getByTestId('auth-signin').click();
  await expect(page.getByRole('alert')).toContainText('do not match');
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-signin').click();
  await expect(page.getByRole('heading', { name: 'Authenticator code' })).toBeVisible();
  await page.getByTestId('auth-code').fill('654321');
  await page.getByTestId('auth-verify').click();
  await expect(page.getByRole('alert')).toContainText('not right');
  await page.getByTestId('auth-code').fill('123456');
  await page.getByTestId('auth-verify').click();
  await expect(page.getByRole('heading', { name: 'Your passphrase' })).toBeVisible();
  await page.getByTestId('auth-passphrase').fill(PHRASE);
  await page.getByTestId('auth-unlock').click();
  await seeItem(page);
  expect(errors).toEqual([]);
});

test('only an invited address can create an account', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/?cloud=fake#/today');
  await page.getByTestId('auth-to-signup').click();
  await page.getByTestId('auth-email').fill('someone@else.com');
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-password-again').fill(PASSWORD);
  await page.getByTestId('auth-signup').click();
  await expect(page.getByRole('alert')).toContainText('cannot have an account');
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('screens are a tab bar, the rest is under More, and an item fills the screen', async ({ page }) => {
    const errors = watch(page);
    await page.goto('/?demo=1#/today');
    await expect(page.locator('.sidenav')).not.toBeInViewport();
    const tabs = page.locator('.tabbar');
    await expect(tabs).toBeVisible();
    await tabs.getByRole('link', { name: /Waiting on/ }).click();
    await expect(page.locator('.ph-title')).toHaveText('Waiting on');
    await page.getByTestId('tab-more').click();
    await expect(page.locator('.sidenav')).toBeInViewport();
    await page.locator('.sidenav').getByRole('link', { name: /People/ }).click();
    await expect(page.locator('.ph-title')).toHaveText('People');
    await expect(page.locator('.sidenav')).not.toBeInViewport();
    await page.goto('/?demo=1#/wait');
    await page.locator('.row', { hasText: 'Cable schedule' }).locator('.row-open').click();
    const box = await page.locator('.drawer').boundingBox();
    expect(box?.width).toBe(390);
    // Nothing on the page is wider than the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });
});

test.describe('the GitHub Pages build', () => {
  test.skip(!existsSync('site/index.html'), 'npm run build:pages first');

  test('opens under /Ledger/ with its security policy, and signs in with no violation', async ({ page }) => {
    const errors = watch(page);
    const base = 'http://127.0.0.1:4174/Ledger/';
    await page.goto(`${base}index.html`);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toMatch(/(^|\s)'unsafe-eval'/);
    await createAccount(page, base);
    await addAndWaitSaved(page, 'owe: IXL test plan to Priya next tue');
    const manifest = await (await page.request.get(`${base}manifest.webmanifest`)).json();
    expect(manifest.start_url).toBe('./');
    expect((await page.request.get(`${base}sw.js`)).ok()).toBe(true);
    expect(errors).toEqual([]);
  });
});
