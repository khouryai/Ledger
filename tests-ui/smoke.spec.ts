import { expect, test, type Page } from '@playwright/test';

function watch(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function demo(page: Page, screen = 'today') {
  await page.goto(`/?demo=1#/${screen}`);
  await expect(page.locator('.sidenav-brand-name')).toHaveText('LEDGER');
}

async function quickAdd(page: Page, text: string) {
  const input = page.locator('[data-quickadd="main"]');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

const THREAD = `From: Sam Lee <sam.lee@example.com>
Sent: Wednesday, October 14, 2026 4:12 PM
To: Alex Khoury <alex.khoury@example.com>
Subject: RE: Cable schedule

Hi Alex,

Could you please send the updated IXL test procedure by Friday? I'll send the revised cable schedule next Tuesday.

Thanks,
Sam`;

test('first run offers where to keep the ledger, and starts empty in the browser', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await expect(page.getByText('What I owe, and what I am owed.')).toBeVisible();
  await page.getByTestId('setup-browser').click();
  await expect(page.getByText('Start with the next thing on your mind')).toBeVisible();
  await expect(page.getByText('Saving in this browser only.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('quick-add shows what it read, adds the item, and the item survives a reload', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await page.getByTestId('setup-browser').click();
  const input = page.locator('[data-quickadd="main"]');
  await input.fill('@Morgan_Hale drawings rev C by fri #BART');
  await expect(page.locator('.qa-chips')).toContainText('New person');
  await expect(page.locator('.qa-chips')).toContainText('Morgan Hale');
  await expect(page.locator('.qa-chips')).toContainText('Promised');
  await expect(page.locator('.qa-chips')).toContainText('#BART');
  await input.press('Tab');
  await expect(page.getByTestId('qa-dir-main')).toHaveText('I owe');
  await input.press('Tab');
  await expect(page.getByTestId('qa-dir-main')).toHaveText('Waiting on');
  await input.press('Enter');
  await expect(page.locator('.toast')).toContainText('Added #1: Drawings rev C');
  await expect(page.getByTestId('save-state')).toContainText('Saved');
  await page.goto('/#/wait');
  await expect(page.locator('[data-item="1"]')).toContainText('Drawings rev C');
  await page.reload();
  await expect(page.locator('[data-item="1"]')).toContainText('Morgan Hale');
  expect(errors).toEqual([]);
});

test('an item opens, is chased with a drafted email, then received and undone', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'wait');
  await page.locator('.row', { hasText: 'Cable schedule for HTT interlocking' }).click();
  await expect(page.getByTestId('chase-plan')).toContainText('Chase now');
  await page.getByTestId('drawer-chase').click();
  await expect(page.getByTestId('chase-body')).toHaveValue(/Hi Jordan,/);
  await expect(page.getByTestId('chase-body')).toHaveValue(/Cable schedule for HTT interlocking/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('chase-eml').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.eml$/);
  await expect(page.locator('.toast')).toContainText('logged');
  await expect(page.locator('.history')).toContainText('Chased');
  await page.getByTestId('drawer-done').click();
  await expect(page.locator('.toast')).toContainText('Received');
  await page.locator('.toast button', { hasText: 'Undo' }).click();
  await expect(page.locator('.toast')).toContainText('Undone');
  expect(errors).toEqual([]);
});

test('Today offers one email for several chases to the same person', async ({ page }) => {
  const errors = watch(page);
  await demo(page);
  await page.getByRole('button', { name: /One email to Maria/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Chase Maria Lopez');
  await expect(page.getByTestId('chase-body')).toHaveValue(/- Signed TAWR for Saturday/);
  expect(errors).toEqual([]);
});

test('capture finds the actions in a pasted email and adds them', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'capture');
  await page.getByTestId('capture-text').fill(THREAD);
  await expect(page.locator('.card-title')).toContainText('RE: Cable schedule');
  await page.getByTestId('capture-rules').click();
  await expect(page.getByTestId('suggestion')).toHaveCount(2);
  await page.getByTestId('add-suggestions').click();
  await expect(page.locator('.toast')).toContainText('Added 2 items');
  await page.getByRole('link', { name: /Waiting on/ }).click();
  await expect(page.locator('.row', { hasText: 'Send the revised cable schedule' })).toContainText('Sam Lee');
  await page.getByRole('link', { name: /I owe/ }).click();
  await expect(page.locator('.row', { hasText: 'Send the updated IXL test procedure' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the on-device model path works end to end with the stand-in model', async ({ page }) => {
  const errors = watch(page);
  await page.addInitScript(() => {
    (window as unknown as { __LEDGER_FAKE_AI__: unknown }).__LEDGER_FAKE_AI__ = { myName: 'Alex Khoury' };
  });
  await demo(page, 'settings');
  await page.getByTestId('ai-toggle').check();
  await page.getByTestId('ai-load').click();
  await expect(page.getByTestId('ai-status')).toContainText('Ready');
  await page.goto('/?demo=1#/capture');
  await page.getByTestId('capture-text').fill(THREAD);
  await page.getByTestId('capture-ai').click();
  await expect(page.getByTestId('suggestion').first()).toContainText('model');
  await expect(page.getByTestId('suggestion')).toHaveCount(2);
  // The model writes a chaser…
  await page.getByRole('link', { name: /Waiting on/ }).click();
  await page.locator('.row', { hasText: 'Cable schedule for HTT interlocking' }).click();
  await page.getByTestId('drawer-chase').click();
  await page.getByTestId('chase-ai').click();
  await expect(page.getByTestId('chase-body')).toHaveValue(/Checking in on Cable schedule for HTT interlocking/);
  await expect(page.locator('.modal')).toContainText('written by the on-device model');
  await page.keyboard.press('Escape');
  // …and judges a reply, keeping the new date it gave.
  await page.getByTestId('reply-toggle').click();
  await page.getByTestId('reply-text').fill('Sorry, still waiting on the vendor. I will have it to you by 12/1.');
  await page.getByTestId('reply-check').click();
  await expect(page.locator('.drawer')).toContainText('Not delivered');
  await expect(page.locator('.drawer')).toContainText('(model)');
  await page.getByRole('button', { name: /Record their new date/ }).click();
  await expect(page.locator('.history')).toContainText('New date given');
  expect(errors).toEqual([]);
});

test('people come in from a To line, and one person can be chased for everything', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await page.getByTestId('setup-browser').click();
  await page.goto('/#/people');
  await page.getByTestId('people-paste').fill('Sam Lee <sam.lee@example.com>; "Shah, Priya" <priya.shah@example.com>');
  await page.getByTestId('people-add').click();
  await expect(page.locator('.p-list')).toContainText('Priya Shah');
  await quickAdd(page, '@Sam ATS report');
  await quickAdd(page, '@Sam radio survey');
  await page.locator('.p-list a', { hasText: 'Sam Lee' }).click();
  await page.getByTestId('chase-all').click();
  await expect(page.getByRole('dialog')).toContainText('2 of 2 items');
  expect(errors).toEqual([]);
});

test('meeting mode carries the agenda over and adds actions with attendee chips', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'meetings');
  await page.getByText('BART weekly progress').click();
  await expect(page.locator('main')).toContainText('Confirm the possession dates for November');
  await page.getByTestId('meeting-start').click();
  await page.locator('.qa-chips button', { hasText: 'Priya Shah' }).click();
  const input = page.locator('[data-quickadd="meeting"]');
  await expect(input).toHaveValue(/@"Priya Shah"/);
  await input.press('End');
  await input.type('send the comment log by fri');
  await input.press('Enter');
  await expect(page.locator('main')).toContainText('Send the comment log');
  expect(errors).toEqual([]);
});

test('the weekly review keeps items and is marked done', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'review');
  await page.getByTestId('review-keep').click();
  await page.getByTestId('review-keep').click();
  await page.getByTestId('review-finish').click();
  await expect(page.locator('.toast')).toContainText('Review done');
  expect(errors).toEqual([]);
});

test('Outlook suggests sent emails nobody answered, from a fake mailbox', async ({ page }) => {
  const errors = watch(page);
  await page.addInitScript(() => {
    const sent = [
      {
        id: 'm1',
        conversationId: 'c1',
        subject: 'Possession plan',
        sentDateTime: new Date(Date.now() - 9 * 86400000).toISOString(),
        toRecipients: [{ emailAddress: { name: 'Dev Patel', address: 'dev.patel@example.com' } }],
        body: { contentType: 'text', content: 'Dev, could you send the radio coverage plot for the tunnel?' },
      },
    ];
    (window as unknown as { __LEDGER_FAKE_GRAPH__: unknown }).__LEDGER_FAKE_GRAPH__ = {
      me: async () => ({ displayName: 'Alex Khoury', mail: 'alex.khoury@example.com' }),
      sent: async () => sent,
      conversation: async () => [],
      flagged: async () => [],
      events: async () => [],
      signOut: async () => undefined,
    };
  });
  await demo(page, 'settings');
  await page.getByTestId('outlook-toggle').check();
  const id = page.getByPlaceholder('00000000-0000-0000-0000-000000000000');
  await id.fill('11111111-2222-3333-4444-555555555555');
  await id.press('Enter');
  await page.locator('.nav-link', { hasText: 'Outlook' }).click();
  await page.getByTestId('outlook-check').click();
  await expect(page.getByTestId('suggestion')).toHaveCount(1);
  await expect(page.getByTestId('suggestion')).toContainText('no reply');
  await expect(page.getByTestId('suggestion').locator('[aria-label="Title"]')).toHaveValue('Send the radio coverage plot for the tunnel');
  await page.getByTestId('add-suggestions').click();
  await expect(page.locator('.toast')).toContainText('Added 1 item');
  // Checked again, the same email is not suggested twice.
  await page.getByTestId('outlook-check').click();
  await expect(page.getByTestId('suggestion')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the action log downloads as an Excel workbook', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'owe');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xlsx').click()]);
  expect(dl.suggestedFilename()).toMatch(/^Ledger I owe .*\.xlsx$/);
  expect(errors).toEqual([]);
});

test('the command menu finds an item by number and opens it', async ({ page }) => {
  const errors = watch(page);
  await demo(page);
  await page.keyboard.press('Control+k');
  await page.locator('.cmd-input').fill('#7');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Item 7' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Item 7' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('every screen renders without an error', async ({ page }) => {
  const errors = watch(page);
  for (const s of ['today', 'owe', 'wait', 'all', 'capture', 'meetings', 'review', 'people', 'settings']) {
    await page.goto(`/?demo=1#/${s}`);
    await expect(page.locator('.ph-title')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("a long title and long notes are shown whole, never scrolled inside their box", async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'wait');
  await page.locator('.row', { hasText: 'Cable schedule' }).click();
  const long = 'Cable schedule for HTT interlocking, with the corrections from the October site walk and the radio survey cross-references for sections 4 and 7';
  await page.getByTestId('item-title').fill(long);
  await page.getByTestId('item-title').press('Enter');
  await expect(page.locator('.row', { hasText: 'radio survey cross-references' })).toHaveCount(1);
  const notes = page.getByRole('textbox', { name: 'Notes' });
  await notes.fill(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].map((w) => `${w}: a line of the note`).join('\n'));
  for (const box of [page.getByTestId('item-title'), notes]) {
    const { scroll, client } = await box.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(scroll).toBeLessThanOrEqual(client + 1);
  }
  expect(await page.getByTestId('item-title').inputValue()).toBe(long);
  expect(errors).toEqual([]);
});

test('going to another screen closes an open item', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'owe');
  await page.locator('.row', { hasText: 'Phase 2 test summary' }).click();
  await expect(page.locator('.drawer')).toBeVisible();
  await page.goto('/?demo=1#/today');
  await page.evaluate(() => (location.hash = '#/wait'));
  await expect(page.locator('.drawer')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with no usable graphics chip, the real model says so instead of failing silently', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'settings');
  await page.getByTestId('ai-toggle').check();
  await page.getByTestId('ai-load').click();
  await expect(page.getByTestId('ai-status')).toContainText(/WebGPU|graphics adapter|graphics chip/);
  expect(errors).toEqual([]);
});

test('the single-file version opens straight from disk', async ({ page }) => {
  const errors = watch(page);
  await page.goto(new URL('../standalone/index.html?demo=1#/today', import.meta.url).href);
  await expect(page.locator('.ph-title')).toHaveText('Today');
  await expect(page.locator('main')).toContainText('Chase today');
  expect(errors).toEqual([]);
});

test('an Outlook .msg file dropped into Capture is read', async ({ page }) => {
  const errors = watch(page);
  const { makeMsg } = await import('../tests/msgFixture');
  const bytes = makeMsg({ subject: 'RE: Radio survey', body: 'Alex, could you send the tunnel drawings by Friday?', senderName: 'Dev Patel', senderEmail: 'dev.patel@example.com', toName: 'Alex Khoury', toEmail: 'alex.khoury@example.com' });
  await demo(page, 'capture');
  await page.locator('input[type=file]').setInputFiles({ name: 'survey.msg', mimeType: 'application/vnd.ms-outlook', buffer: Buffer.from(bytes) });
  await expect(page.locator('.card-title')).toContainText('RE: Radio survey');
  await expect(page.locator('main')).toContainText('From Dev Patel');
  await page.getByTestId('capture-rules').click();
  await expect(page.getByTestId('suggestion').locator('[aria-label="Title"]')).toHaveValue('Send the tunnel drawings');
  expect(errors).toEqual([]);
});
