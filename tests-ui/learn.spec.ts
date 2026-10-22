/**
 * Learning from the user, in the browser: a ledger that already holds some decisions
 * changes Capture's suggestions and says why; new decisions are learned from; Settings
 * reports how well it does. And the on-device model copied to a folder and back,
 * against the browser's own storage, with no network.
 */
import { expect, test, type Page } from '@playwright/test';

function watch(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Decisions a user made before: FYI lines unticked, "pls action" added by hand. */
function ledgerWithHabits(): string {
  const things = ['ATS report', 'cable schedule', 'IXL test plan', 'radio survey', 'possession plan', 'ICD update', 'tunnel drawings', 'site walk notes', 'TAWR forms', 'switch tests', 'SAT procedure', 'punch list'];
  const examples: object[] = [];
  let n = 0;
  const ex = (text: string, label: string, proposed: string) => examples.push({ id: `ex_${++n}`, at: `2026-10-01T00:${String(n).padStart(2, '0')}:00.000Z`, task: 'action', text, label, fromMe: false, proposed });
  things.forEach((t, i) => {
    ex(`Could you send the ${t} by Friday?`, 'other', 'other');
    ex(`FYI please note the ${t} was issued last week.`, 'none', 'other');
    ex(`Pls action the ${t} review before the ${i + 3}th.`, 'other', 'none');
  });
  return JSON.stringify({ schema: 1, settings: { myName: 'Alex Khoury', myEmail: 'alex.khoury@example.com' }, people: [], items: [], meetings: [], examples, nextNum: 1 });
}

const EMAIL = `From: Sam Lee <sam.lee@example.com>
Sent: Wednesday, October 14, 2026 4:12 PM
To: Alex Khoury <alex.khoury@example.com>
Subject: RE: Signal design

Hi Alex,

FYI please note the signal design was issued yesterday.
Could you send the updated IXL test procedure by Friday?
Pls action the fire alarm interface review before the 20th.

Thanks,
Sam`;

async function openLedger(page: Page, json: string) {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/?memory=1#/settings');
  await page.locator('input[type=file][accept*=".json"]').setInputFiles({ name: 'ledger.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.locator('.toast')).toContainText('Opened ledger.json');
}

test('suggestions change by what was learned, say why, and teach it more', async ({ page }) => {
  const errors = watch(page);
  await openLedger(page, ledgerWithHabits());
  await expect(page.getByTestId('learn-action')).toContainText('In use');
  await expect(page.getByTestId('learn-action')).toContainText('36 decisions learned from');
  await expect(page.getByTestId('learn-action')).toContainText(/Right \d+% of the time/);

  await page.evaluate(() => (location.hash = '#/capture'));
  await page.getByTestId('capture-text').fill(EMAIL);
  await page.getByTestId('capture-rules').click();
  const sugg = page.getByTestId('suggestion');

  // The FYI line the rules picked up on "please" is unticked, with the reason.
  const fyi = sugg.filter({ hasText: 'FYI please note' });
  await expect(fyi.locator('input[type=checkbox]')).not.toBeChecked();
  await expect(fyi.locator('.learned-note')).toContainText('Unticked: sentences like this were not actions for you');

  // The request is left as the rules made it.
  const req = sugg.filter({ hasText: 'Could you send the updated IXL' });
  await expect(req.locator('input[type=checkbox]')).toBeChecked();
  await expect(req.locator('.learned-note')).toHaveCount(0);

  // "Pls action", which the rules do not know, is found by what was learned.
  const pls = sugg.filter({ hasText: 'Pls action the fire alarm' });
  await expect(pls.locator('.learned-mark')).toBeVisible();
  await expect(pls.locator('.learned-note')).toContainText('Found by what it learned from you');
  await expect(pls.locator('input[type=checkbox]')).toBeChecked();
  await expect(pls.getByRole('button', { name: 'I owe' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('add-suggestions').click();
  await expect(page.locator('.toast')).toContainText('Added 2 items');

  // All three decisions, the unticked one included, were learned from.
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByTestId('learn-action')).toContainText('39 decisions learned from');
  expect(errors).toEqual([]);
});

test('a corrected reply verdict is learned from', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/?demo=1#/wait');
  await page.locator('.row', { hasText: 'Cable schedule for HTT interlocking' }).click();
  await page.getByTestId('reply-toggle').click();
  await page.getByTestId('reply-text').fill('It is on its way to you, should land shortly.');
  await page.getByTestId('reply-check').click();
  const correct = page.getByTestId('reply-correct');
  await expect(correct).toBeVisible();
  await correct.getByRole('button', { name: 'Not delivered' }).click();
  await expect(page.locator('.drawer')).toContainText('As you said. Ledger learns from it.');
  await expect(page.locator('.drawer')).toContainText('(yours)');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(page.getByTestId('learn-reply')).toContainText('1 decisions so far');
  expect(errors).toEqual([]);
});

test('the on-device model is saved to a folder and loaded back, with no download', async ({ page }) => {
  const errors = watch(page);
  // The folder picker answers with the browser's private file system, which the test can read.
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = () => navigator.storage.getDirectory();
  });
  page.on('dialog', (d) => void d.accept());
  await page.goto('/?demo=1#/settings');

  // A small stand-in for a downloaded model, filed exactly where WebLLM files a real one.
  const base = 'https://huggingface.co/mlc-ai/Phi-4-mini-instruct-q4f16_1-MLC/resolve/main/';
  const lib = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_86/base/Phi-4-mini-instruct-q4f16_1_cs1k-webgpu.wasm';
  await page.evaluate(
    async ({ base, lib }) => {
      const put = async (scope: string, url: string, body: string) => (await caches.open(scope)).put(new Request(url), new Response(body));
      await put('webllm/model', `${base}tensor-cache.json`, JSON.stringify({ records: [{ dataPath: 'params_shard_0.bin', nbytes: 12, records: [] }] }));
      await put('webllm/model', `${base}params_shard_0.bin`, 'weights-0123');
      await put('webllm/model', `${base}tokenizer.json`, '{"tok":1}');
      await put('webllm/config', `${base}mlc-chat-config.json`, '{"model_type":"phi3"}');
      await put('webllm/wasm', lib, 'wasm-bytes');
      // Something else in the same storage, which must not be copied.
      await put('webllm/model', 'https://huggingface.co/mlc-ai/Other-Model/resolve/main/params_shard_0.bin', 'not-this-one');
    },
    { base, lib },
  );

  await page.getByTestId('ai-toggle').check();
  await expect(page.getByTestId('ai-status')).toContainText('Downloaded', { timeout: 20_000 });
  await page.getByTestId('ai-save-folder').click();
  await expect(page.locator('.toast')).toContainText('Saved Phi-4 mini to ledger-model-Phi-4-mini-instruct-q4f16_1-MLC');

  const saved = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('ledger-model-Phi-4-mini-instruct-q4f16_1-MLC');
    const manifest = JSON.parse(await (await (await dir.getFileHandle('ledger-model.json')).getFile()).text());
    const shard = await (await (await (await dir.getDirectoryHandle('model')).getFileHandle('params_shard_0.bin')).getFile()).text();
    return { files: manifest.files.map((f: { path: string }) => f.path).sort(), shard };
  });
  expect(saved.files).toEqual(['config/mlc-chat-config.json', 'model/params_shard_0.bin', 'model/tensor-cache.json', 'model/tokenizer.json', 'wasm/Phi-4-mini-instruct-q4f16_1_cs1k-webgpu.wasm']);
  expect(saved.shard).toBe('weights-0123');

  // Removed from the browser, then brought back from the folder.
  await page.getByRole('button', { name: 'Remove the download' }).click();
  await expect(page.getByTestId('ai-load-folder')).toBeVisible();
  expect(await page.evaluate(async (base) => !!(await (await caches.open('webllm/model')).match(`${base}params_shard_0.bin`)), base)).toBe(false);
  await page.getByTestId('ai-load-folder').click();
  await expect(page.locator('.toast')).toContainText('Loaded Phi-4 mini from the folder: 5 files, nothing downloaded');
  await expect(page.getByTestId('ai-save-folder')).toBeVisible();
  const back = await page.evaluate(async (base) => (await (await caches.open('webllm/model')).match(`${base}params_shard_0.bin`))?.text(), base);
  expect(back).toBe('weights-0123');
  expect(errors).toEqual([]);
});

test("the app's service worker never clears the model's storage", async ({ page }) => {
  const errors = watch(page);
  // The model is already in the browser before the app's worker starts, as it is
  // after any earlier visit; then the worker installs and activates, clearing caches.
  await page.addInitScript(() => {
    void caches.open('webllm/model').then((c) => c.put(new Request('https://huggingface.co/x/resolve/main/params_shard_0.bin'), new Response('kept')));
  });
  await page.goto('/?demo=1#/today');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await new Promise((r) => setTimeout(r, 1500));
  });
  const kept = await page.evaluate(async () => (await (await caches.open('webllm/model')).match('https://huggingface.co/x/resolve/main/params_shard_0.bin'))?.text());
  expect(kept).toBe('kept');
  expect(errors).toEqual([]);
});
