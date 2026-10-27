import { describe, expect, it } from 'vitest';
import { addWorkingDays } from '../src/engine/dates';
import { age, makeCtx, suggestions } from '../src/engine/decide';
import { readDoc } from '../src/engine/doc';
import { mergeDocs } from '../src/engine/merge';
import { addStep, complete, moveStep, removeStep, renameStep, reopen, restartSeries, skip, toggleStep, updateItem } from '../src/engine/ops';
import { reviewQueue, weekSummary, weekSummaryText } from '../src/engine/review';
import { allSeries, outcome, seriesOf } from '../src/engine/series';
import { personStats } from '../src/engine/stats';
import type { LedgerDoc, Recurrence } from '../src/engine/types';
import { add, at, docWith, pid, TODAY } from './helpers';

const FRIDAYS: Recurrence = { every: 1, unit: 'week', days: [5] };
const CAL = { workDays: [1, 2, 3, 4, 5], holidays: [] };

/** A timesheet every Friday, the first due Friday 16 October. */
function timesheet(doc = docWith(), extra: Partial<Parameters<typeof add>[1]> = {}) {
  return add(doc, { title: 'Timesheet', direction: 'owe', due: '2026-10-16', recur: FRIDAYS, ...extra }, at('2026-10-12'));
}

describe('closing an occurrence', () => {
  it('puts the next on the list: same series and schedule, notes kept, steps unticked', () => {
    let { doc, item } = timesheet(docWith(), { notes: 'Cost code 4410', steps: [{ id: 's1', text: 'Hours from the diary', done: true }] });
    expect(item.seriesId).toBe(item.id);
    const r = complete(doc, item.id, undefined, at('2026-10-16'));
    doc = r.doc;
    expect(r.spawned).toMatchObject({ title: 'Timesheet', due: '2026-10-23', seriesId: item.id, notes: 'Cost code 4410', recur: { days: [5] } });
    expect(r.spawned!.steps).toEqual([{ id: 's1', text: 'Hours from the diary', done: false }]);
    expect(r.spawned!.history[0].text).toBe(`Recurs: next after #${item.num}`);
  });
  it('closed late, skips to the first still to come and says which it passed over', () => {
    const { doc, item } = timesheet();
    const r = complete(doc, item.id, undefined, at('2026-10-27'));
    expect(r.spawned!.due).toBe('2026-10-30');
    expect(r.spawned!.history[0].text).toBe(`Recurs: next after #${item.num}. Passed over: Fri 10/23`);
  });
  it('closed late with each one owed, puts the very next on the list, late or not', () => {
    const { doc, item } = timesheet(docWith(), { recur: { ...FRIDAYS, catchUp: true } });
    expect(complete(doc, item.id, undefined, at('2026-10-27')).spawned!.due).toBe('2026-10-23');
  });
  it('puts nothing on the list after the last one', () => {
    const { doc, item } = timesheet(docWith(), { recur: { ...FRIDAYS, until: '2026-10-16' } });
    const r = complete(doc, item.id, undefined, at('2026-10-16'));
    expect(r.spawned).toBeUndefined();
    expect(r.doc.items.filter((i) => i.status === 'open')).toEqual([]);
  });
  it('does not put a second one on the list when a closed one is reopened and closed again', () => {
    let { doc, item } = timesheet();
    doc = complete(doc, item.id, undefined, at('2026-10-16')).doc;
    doc = reopen(doc, item.id, at('2026-10-16'));
    const again = complete(doc, item.id, undefined, at('2026-10-16'));
    expect(again.spawned).toBeUndefined();
    expect(again.doc.items.filter((i) => i.status === 'open').length).toBe(1);
  });
});

describe('skipping and pausing', () => {
  it('skips one: closed as skipped, neither done nor late, and the next on the list', () => {
    const { doc, item } = timesheet();
    const r = skip(doc, item.id, at(TODAY));
    const skipped = r.doc.items.find((i) => i.id === item.id)!;
    expect(skipped).toMatchObject({ status: 'dropped', closeNote: 'Skipped' });
    expect(outcome(skipped)).toBe('skipped');
    expect(age(skipped, makeCtx(r.doc, TODAY)).label).toBe('Skipped');
    expect(r.spawned!.due).toBe('2026-10-23');
  });
  it('pauses until a day: everything before it is passed over', () => {
    const { doc, item } = timesheet();
    const r = skip(doc, item.id, at(TODAY), '2026-11-02');
    expect(r.doc.items.find((i) => i.id === item.id)!.closeNote).toBe('Paused until Mon 11/2');
    expect(r.spawned!.due).toBe('2026-11-06');
  });
  it('will not skip something that does not repeat', () => {
    const { doc, item } = add(docWith(), { title: 'One-off' });
    expect(() => skip(doc, item.id, at(TODAY))).toThrow();
  });
});

describe('changing a schedule', () => {
  it('writes the change in words, and an item that starts repeating starts a series', () => {
    let { doc, item } = add(docWith(), { title: 'Status note', direction: 'owe', due: '2026-10-16' });
    doc = updateItem(doc, item.id, { recur: FRIDAYS }, at(TODAY));
    expect(doc.items[0].seriesId).toBe(item.id);
    expect(doc.items[0].history.at(-1)!.text).toBe('Repeats Every Friday');
    doc = updateItem(doc, item.id, { recur: { ...FRIDAYS, days: [4] }, due: '2026-10-15' }, at(TODAY));
    expect(doc.items[0].history.at(-1)!.text).toBe('Repeats: Every Friday → Every Thursday; Due: Fri 10/16 → Thu 10/15');
    // The same schedule set again is no change at all.
    expect(updateItem(doc, item.id, { recur: { ...FRIDAYS, days: [4] } }, at(TODAY)).items[0].history.length).toBe(doc.items[0].history.length);
    doc = updateItem(doc, item.id, { recur: undefined }, at(TODAY));
    expect(doc.items[0].history.at(-1)!.text).toBe('Stopped repeating (was Every Thursday)');
    expect(complete(doc, item.id, undefined, at(TODAY)).spawned).toBeUndefined();
  });
  it('starts an ended series again, in the same series', () => {
    let { doc, item } = timesheet();
    doc = updateItem(doc, item.id, { recur: undefined }, at(TODAY));
    doc = complete(doc, item.id, undefined, at('2026-10-16')).doc;
    const r = restartSeries(doc, item.id, FRIDAYS, '2026-11-02', at(TODAY));
    expect(r.item).toMatchObject({ seriesId: item.id, due: '2026-11-06', title: 'Timesheet' });
    expect(seriesOf(r.doc, r.item)!.items.length).toBe(2);
  });
});

describe('series', () => {
  it('groups the occurrences and counts how it has gone', () => {
    let { doc, item } = timesheet();
    let cur = item;
    // On time, late, skipped, then on time twice.
    for (const [how, when] of [['done', '2026-10-16'], ['done', '2026-10-26'], ['skip', '2026-10-30'], ['done', '2026-11-06'], ['done', '2026-11-13']] as const) {
      const r = how === 'skip' ? skip(doc, cur.id, at(when)) : complete(doc, cur.id, undefined, at(when));
      doc = r.doc;
      cur = r.spawned!;
    }
    const [s] = allSeries(doc);
    expect(s.items.map((i) => i.due)).toEqual(['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13', '2026-11-20']);
    expect(s.current!.due).toBe('2026-11-20');
    expect(s.active).toBe(true);
    expect(s.record).toEqual({ done: 4, onTime: 3, late: 1, skipped: 1, streak: 2, lastDone: '2026-11-13' });
  });
  it('lists those still repeating first, soonest due first', () => {
    let doc = timesheet().doc;
    doc = add(doc, { title: 'Diary', direction: 'owe', due: TODAY, recur: { every: 1, unit: 'day' } }).doc;
    const ended = add(doc, { title: 'Old routine', direction: 'owe', due: '2026-10-01', recur: FRIDAYS });
    doc = updateItem(ended.doc, ended.item.id, { recur: undefined }, at(TODAY));
    expect(allSeries(doc).map((s) => [s.head.title, s.active])).toEqual([
      ['Diary', true],
      ['Timesheet', true],
      ['Old routine', false],
    ]);
  });
  it('links the occurrences an older version made into one series', () => {
    const items = [
      { id: 'a', num: 3, title: 'Timesheet', direction: 'owe', status: 'done', recur: { every: 1, unit: 'week' }, due: '2026-10-09', history: [{ at: '2026-10-05T10:00:00Z', kind: 'created' }] },
      { id: 'b', num: 7, title: 'Timesheet', direction: 'owe', status: 'done', recur: { every: 1, unit: 'week' }, due: '2026-10-16', history: [{ at: '2026-10-09T10:00:00Z', kind: 'created', text: 'Recurs: next after #3' }] },
      { id: 'c', num: 9, title: 'Timesheet', direction: 'owe', status: 'open', recur: { every: 1, unit: 'week' }, due: '2026-10-23', history: [{ at: '2026-10-16T10:00:00Z', kind: 'created', text: 'Recurs: next after #7' }] },
      { id: 'd', num: 10, title: 'Unrelated', direction: 'wait', status: 'open', history: [{ at: '2026-10-16T10:00:00Z', kind: 'created', text: 'Recurs: next after #9' }] },
    ];
    const { doc } = readDoc({ items });
    expect(doc.items.map((i) => i.seriesId)).toEqual(['a', 'a', 'a', undefined]);
    const [s] = allSeries(doc);
    expect(s.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(s.current!.id).toBe('c');
  });
});

describe('suggestions from a recurring item\'s record', () => {
  /** A Friday timesheet from 18 September, each one closed as `hows` says; late is the Tuesday after. */
  function record(hows: ('done' | 'late' | 'skip')[]): LedgerDoc {
    let { doc, item: cur } = timesheet(docWith(), { due: '2026-09-18' });
    for (const how of hows) {
      const r = how === 'skip' ? skip(doc, cur.id, at(cur.due!)) : complete(doc, cur.id, undefined, at(how === 'late' ? addWorkingDays(cur.due!, 2, CAL) : cur.due!));
      doc = r.doc;
      cur = r.spawned!;
    }
    return doc;
  }
  it('says when one is done late most times, and by how much', () => {
    const doc = record(['late', 'done', 'late', 'late']);
    expect(suggestions(makeCtx(doc, TODAY))).toEqual([
      { kind: 'slipping', itemId: allSeries(doc)[0].current!.id, reason: 'Done late 3 of the last 4 times, usually 2 working days after its day' },
    ]);
  });
  it('asks whether one skipped most times is still needed', () => {
    expect(suggestions(makeCtx(record(['skip', 'skip', 'done', 'skip']), TODAY)).map((s) => [s.kind, s.reason])).toEqual([['unneeded', 'Skipped 3 of the last 4 times']]);
  });
  it('says nothing with too little to go on, or a good record', () => {
    expect(suggestions(makeCtx(record(['late', 'late']), TODAY))).toEqual([]);
    expect(suggestions(makeCtx(record(['done', 'late', 'done', 'done']), TODAY))).toEqual([]);
  });
});

describe('what recurring items do to the rest', () => {
  it('leaves a person\'s delivery times to what was asked of them', () => {
    let doc = docWith();
    const sam = pid(doc, 'Sam');
    // Weekly results from Sam, each received on its Friday a week after it went on the list.
    let r = add(doc, { title: 'Regression results', personId: sam, due: '2026-09-04', recur: FRIDAYS }, at('2026-08-28'));
    doc = r.doc;
    let cur = r.item;
    for (const fri of ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02']) {
      const c = complete(doc, cur.id, undefined, at(fri));
      doc = c.doc;
      cur = c.spawned!;
    }
    const st = personStats(doc.items, sam, doc.settings, { workDays: [1, 2, 3, 4, 5], holidays: [] });
    expect(st.samples).toBe(0);
    expect(st.recurring).toBe(5);
    expect(st.learned).toBe(false);
    // Their dates still count as kept.
    expect(st.promisesKept).toBe(1);
  });
  it('is due on its day rather than waiting, and is not quiet before it', () => {
    const doc = add(docWith(), { title: 'Results', personId: undefined, askedOn: '2026-09-01', due: '2026-10-19', recur: { every: 1, unit: 'week', days: [1] } }, at('2026-09-01')).doc;
    const ctx = makeCtx(doc, TODAY);
    expect(age(doc.items[0], ctx)).toMatchObject({ label: 'Due in 2 days', tone: 'warn' });
    expect(reviewQueue(ctx)).toEqual([]);
  });
  it('counts the week\'s occurrences in the summary, not as new work', () => {
    let { doc, item } = add(docWith(), { title: 'Diary', direction: 'owe', due: '2026-10-12', recur: { every: 1, unit: 'day' } }, at('2026-10-09'));
    let cur = item;
    for (const day of ['2026-10-12', '2026-10-13']) {
      const r = complete(doc, cur.id, undefined, at(day));
      doc = r.doc;
      cur = r.spawned!;
    }
    doc = skip(doc, cur.id, at('2026-10-14')).doc;
    const s = weekSummary(makeCtx(doc, TODAY));
    expect(s.recurring).toEqual({ due: 4, done: 2, skipped: 1 });
    expect(s.opened.length).toBe(0);
    expect(weekSummaryText(s, makeCtx(doc, TODAY))).toContain('Recurring: 2 of 4 done, 1 skipped.');
  });
});

describe('steps', () => {
  it('are added, ticked, renamed, moved and removed, with ticks in the history', () => {
    let { doc, item } = add(docWith(), { title: 'Monthly report', direction: 'owe' });
    doc = addStep(doc, item.id, 'Collect hours', at(TODAY));
    doc = addStep(doc, item.id, '  ', at(TODAY));
    doc = addStep(doc, item.id, 'Draft', at(TODAY));
    const [one, two] = doc.items[0].steps!;
    doc = toggleStep(doc, item.id, one.id, at(TODAY));
    expect(doc.items[0].steps!.map((s) => s.done)).toEqual([true, false]);
    expect(doc.items[0].history.at(-1)).toMatchObject({ kind: 'step', text: 'Done: Collect hours' });
    doc = renameStep(doc, item.id, two.id, 'Draft and send', at(TODAY));
    doc = moveStep(doc, item.id, two.id, -1, at(TODAY));
    expect(doc.items[0].steps!.map((s) => s.text)).toEqual(['Draft and send', 'Collect hours']);
    doc = removeStep(doc, item.id, one.id, at(TODAY));
    doc = removeStep(doc, item.id, two.id, at(TODAY));
    expect(doc.items[0].steps).toBeUndefined();
  });
  it('merge one by one across two devices', () => {
    let { doc: base, item } = add(docWith(), { title: 'Report', direction: 'owe' });
    base = addStep(addStep(base, item.id, 'One', at(TODAY)), item.id, 'Two', at(TODAY));
    const [one, two] = base.items[0].steps!;
    const laptop: LedgerDoc = toggleStep(base, item.id, one.id, at(TODAY));
    const phone: LedgerDoc = toggleStep(base, item.id, two.id, at(TODAY));
    const r = mergeDocs(base, laptop, phone, at(TODAY));
    expect(r.doc.items[0].steps!.map((s) => s.done)).toEqual([true, true]);
    expect(r.clashes).toBe(0);
  });
});
