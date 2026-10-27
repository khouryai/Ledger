/**
 * Recurring items and the week, in the built app: defined by clicking or typing, shown
 * a week at a time, closed, skipped, paused and rescheduled, with steps that come back
 * unticked. The sample ledger is built relative to today, so nothing here depends on
 * which day it runs; where a date matters, the test makes its own item.
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

const series = (page: Page, title: string) => page.locator(`[data-testid="series"][data-series="${title}"]`);

test('a recurring item is defined by clicking, its dates shown before it is added', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'recurring');
  await expect(page.getByTestId('routine-grid')).toBeVisible();
  await page.getByTestId('recurring-new').click();
  await page.getByTestId('recurring-title').fill('Safety walk');
  // Weekly on Friday to begin with; Tuesday as well.
  await page.getByTestId('sched-day-2').click();
  await expect(page.getByTestId('schedule-preview')).toContainText('Every Tuesday and Friday');
  await expect(page.getByTestId('schedule-preview').locator('.sched-dates > span')).toHaveCount(5);
  await page.getByTestId('recurring-steps').fill('Walk the site\nWrite it up');
  await page.getByTestId('recurring-add').click();
  await expect(page.locator('.toast')).toContainText('Safety walk, every Tuesday and Friday.');
  await expect(series(page, 'Safety walk')).toContainText('Every Tuesday and Friday');
  await expect(series(page, 'Safety walk')).toContainText('0/2 steps');
  // Monthly, on the last working day.
  await page.getByTestId('recurring-new').click();
  await page.getByTestId('recurring-title').fill('Month-end return');
  await page.getByTestId('sched-unit-month').click();
  await page.getByTestId('sched-last-working').check();
  await expect(page.getByTestId('schedule-preview')).toContainText('Monthly on the last working day');
  await page.getByTestId('recurring-add').click();
  await expect(series(page, 'Month-end return')).toContainText('Monthly on the last working day');
  expect(errors).toEqual([]);
});

test('a recurring item is done, skipped and paused from its list, each saying when the next is due', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'recurring');
  await series(page, 'Timesheet').getByRole('button', { name: 'Done: Timesheet' }).click();
  await expect(page.locator('.toast')).toContainText(/Done: #\d+\. The next is due \w{3} /);
  await series(page, 'Site diary').getByRole('button', { name: 'Skip this one: Site diary' }).click();
  await expect(page.locator('.toast')).toContainText(/Skipped #\d+\. The next is due/);
  await expect(series(page, 'Site diary')).toContainText('skipped');
  await series(page, 'Radio test log').getByRole('button', { name: 'More for Radio test log' }).click();
  await page.getByRole('menuitem', { name: 'Pause until…' }).click();
  const until = page.getByTestId('pause-until');
  await until.fill('+3w');
  await until.press('Enter');
  await page.getByTestId('pause-save').click();
  await expect(page.locator('.toast')).toContainText('Paused: the next is due');
  // Undo puts it back as it was.
  await page.locator('.toast button', { hasText: 'Undo' }).click();
  await expect(page.locator('.toast')).toContainText('Undone');
  expect(errors).toEqual([]);
});

test('the schedule is typed in the add line, shown in words before Enter, and kept on the item', async ({ page }) => {
  const errors = watch(page);
  await demo(page);
  const input = page.locator('[data-quickadd="main"]');
  await input.fill('owe: fire alarm test the first monday of every month until 6/30/27');
  await expect(page.getByTestId('qa-recur')).toContainText('Monthly on the first Monday, until');
  await expect(page.locator('.qa-chips')).toContainText('Fire alarm test');
  await input.press('Enter');
  await expect(page.locator('.toast')).toContainText('Fire alarm test');
  await page.evaluate(() => (location.hash = '#/recurring'));
  await series(page, 'Fire alarm test').locator('.row-open').click();
  await expect(page.getByTestId('drawer-repeats')).toContainText('Monthly on the first Monday');
  await expect(page.getByTestId('drawer-repeats')).toContainText('Close this one and the next is due');
  expect(errors).toEqual([]);
});

test('the schedule changes from the item, and the change is written in its history', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'recurring');
  await series(page, 'Timesheet').locator('.row-open').click();
  await page.getByTestId('drawer-schedule').click();
  await page.getByTestId('sched-day-4').click();
  await page.getByTestId('sched-day-5').click();
  await expect(page.getByTestId('schedule-preview')).toContainText('Every Thursday');
  await page.getByTestId('schedule-save').click();
  await expect(page.locator('.drawer .history')).toContainText('Repeats: Every Friday → Every Thursday');
  await expect(page.getByTestId('drawer-repeats')).toContainText('Every Thursday');
  expect(errors).toEqual([]);
});

test('steps are ticked on an item, and the next one starts with them unticked', async ({ page }) => {
  const errors = watch(page);
  await demo(page, 'recurring');
  await series(page, 'Weekly progress report to BART').locator('.row-open').click();
  const drawer = page.locator('.drawer');
  await drawer.getByTestId('step-0').check();
  await expect(drawer.getByTestId('drawer-steps')).toContainText('1 of 3 done');
  await drawer.getByTestId('step-add').fill('Attach the site photos');
  await drawer.getByTestId('step-add').press('Enter');
  await expect(drawer.getByTestId('drawer-steps')).toContainText('1 of 4 done');
  await expect(drawer.locator('.history')).toContainText('Done: Collect the test results');
  await drawer.getByTestId('drawer-done').click();
  await expect(page.locator('.toast')).toContainText('The next is due');
  await page.keyboard.press('Escape');
  await expect(series(page, 'Weekly progress report to BART')).toContainText('0/4 steps');
  expect(errors).toEqual([]);
});

test('the week lays out each day, and a deadline moves by dragging it or from its Move menu', async ({ page }) => {
  const errors = watch(page);
  await demo(page);
  // "next wed" is always in next week, whatever today is.
  await quickAdd(page, 'owe: commissioning dry run next wed');
  await expect(page.locator('.toast')).toContainText('Commissioning dry run');
  await page.evaluate(() => (location.hash = '#/week'));
  await expect(page.locator('.ph-title')).toHaveText('This week');
  await expect(page.getByTestId('routine-grid')).toBeVisible();
  await page.getByTestId('week-next').click();
  await expect(page.locator('.ph-title')).toHaveText('Next week');
  const board = page.getByTestId('week-board');
  const days = board.locator('.wday');
  await expect(days).toHaveCount(5);
  const card = () => board.locator('.wcard', { hasText: 'Commissioning dry run' });
  await expect(days.nth(2).locator('.wcard', { hasText: 'Commissioning dry run' })).toBeVisible();
  // Dragged from Wednesday to Thursday.
  await card().dragTo(days.nth(3).locator('.wday-list'));
  await expect(page.locator('.toast')).toContainText(/is due Thu /);
  await expect(days.nth(3).locator('.wcard', { hasText: 'Commissioning dry run' })).toBeVisible();
  // And to Friday from the menu, as on a phone or from the keyboard.
  await card().getByRole('button', { name: /^Move #\d+/ }).click();
  await page.getByRole('menuitem', { name: /^Friday/ }).click();
  await expect(days.nth(4).locator('.wcard', { hasText: 'Commissioning dry run' })).toBeVisible();
  // Showing only what I owe leaves out what others promised.
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'I owe' }).click();
  await expect(board.locator('.wcard-promise')).toHaveCount(0);
  await expect(card()).toBeVisible();
  expect(errors).toEqual([]);
});

test('number keys go to the main screens, and the arrows step through the weeks', async ({ page }) => {
  const errors = watch(page);
  await demo(page);
  await page.keyboard.press('2');
  await expect(page.locator('.ph-title')).toHaveText('This week');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.ph-title')).toHaveText('Next week');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.ph-title')).toHaveText('Last week');
  await page.keyboard.press('5');
  await expect(page.locator('.ph-title')).toHaveText('Recurring');
  await page.keyboard.press('1');
  await expect(page.locator('.ph-title')).toHaveText('Today');
  expect(errors).toEqual([]);
});

test('what is done today is listed on Today, a click from being reopened', async ({ page }) => {
  const errors = watch(page);
  await demo(page);
  await quickAdd(page, 'owe: call the depot today');
  const row = page.locator('.today-main .row', { hasText: 'Call the depot' });
  await row.getByRole('button', { name: /^Done: #\d+/ }).click();
  await expect(page.getByTestId('done-today')).toContainText('Call the depot');
  await page.getByTestId('done-today').locator('.row', { hasText: 'Call the depot' }).locator('.row-open').click();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.locator('.toast')).toContainText('Reopened');
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the week is a tab, and the week and recurring screens fit the phone', async ({ page }) => {
    const errors = watch(page);
    await page.goto('/?demo=1#/today');
    await page.locator('.tabbar').getByRole('link', { name: /Week/ }).click();
    await expect(page.locator('.ph-title')).toHaveText('This week');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.goto('/?demo=1#/recurring');
    await expect(page.getByTestId('routine-grid')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.getByTestId('routine-grid').evaluate((el) => el.scrollWidth <= el.parentElement!.clientWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
});
