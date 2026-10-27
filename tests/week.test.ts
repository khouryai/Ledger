import { describe, expect, it } from 'vitest';
import { makeCtx } from '../src/engine/decide';
import { complete, skip } from '../src/engine/ops';
import type { LedgerDoc, Recurrence } from '../src/engine/types';
import { routineGrid, weekOf, weekPlan, weekPlanText } from '../src/engine/week';
import { add, at, docWith, pid, TODAY } from './helpers';

const DAILY: Recurrence = { every: 1, unit: 'day' };
const FRIDAYS: Recurrence = { every: 1, unit: 'week', days: [5] };

/**
 * The week of Monday 12 October, seen on Thursday 15th. A diary every working day:
 * Monday's done on time, Tuesday's done late on Wednesday, Wednesday's skipped, and
 * Thursday's in hand. A Friday timesheet still open from the 9th.
 */
function week(): LedgerDoc {
  let doc = docWith();
  const sam = pid(doc, 'Sam');
  const priya = pid(doc, 'Priya');
  doc = add(doc, { title: 'Report', direction: 'owe', due: '2026-10-14' }, at('2026-10-05')).doc;
  doc = add(doc, { title: 'Plan', direction: 'owe', due: '2026-10-16' }, at('2026-10-05')).doc;
  doc = add(doc, { title: 'Old thing', direction: 'owe', due: '2026-10-07' }, at('2026-10-01')).doc;
  doc = add(doc, { title: 'Someday', direction: 'owe' }, at('2026-10-01')).doc;
  doc = add(doc, { title: 'Drawings', personId: sam, due: '2026-10-16' }, at('2026-10-12')).doc;
  doc = add(doc, { title: 'Cable schedule', personId: priya, askedOn: '2026-10-01' }, at('2026-10-01')).doc;
  const quote = add(doc, { title: 'Quote', direction: 'owe' }, at('2026-10-05'));
  doc = complete(quote.doc, quote.item.id, undefined, at('2026-10-13')).doc;
  const diary = add(doc, { title: 'Diary', direction: 'owe', due: '2026-10-12', recur: DAILY }, at('2026-10-09'));
  let r = complete(diary.doc, diary.item.id, undefined, at('2026-10-12'));
  r = complete(r.doc, r.spawned!.id, undefined, at('2026-10-14'));
  r = skip(r.doc, r.spawned!.id, at('2026-10-14'));
  doc = r.doc;
  doc = add(doc, { title: 'Timesheet', direction: 'owe', due: '2026-10-09', recur: FRIDAYS }, at('2026-10-05')).doc;
  return doc;
}

const titles = (xs: { item: { title: string }; kind?: string }[]) => xs.map((e) => (e.kind ? `${e.kind} ${e.item.title}` : e.item.title));

describe('the week', () => {
  it('puts each thing on its day', () => {
    const plan = weekPlan(makeCtx(week(), TODAY), weekOf(TODAY));
    expect(plan.from).toBe('2026-10-12');
    expect(plan.to).toBe('2026-10-18');
    expect(plan.days.map((d) => d.day)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    const on = (day: string) => titles(plan.days.find((d) => d.day === day)!.entries);
    expect(on('2026-10-12')).toEqual(['closed Diary']);
    expect(on('2026-10-13')).toEqual(['closed Quote']);
    expect(on('2026-10-14')).toEqual(['due Report', 'closed Diary']);
    // Priya's chase fell due last week: it is today's.
    expect(on('2026-10-15')).toEqual(['due Diary', 'chase Cable schedule']);
    expect(on('2026-10-16')).toEqual(['due Plan', 'promise Drawings', 'planned Diary', 'planned Timesheet']);
    expect(plan.overdue.map((i) => i.title)).toEqual(['Old thing', 'Timesheet']);
    expect(plan.undated.map((i) => i.title)).toEqual(['Someday']);
    expect(plan.counts).toEqual({ due: 3, promise: 1, chase: 1, planned: 2, closed: 3 });
  });
  it('looks ahead to next week, carrying what is overdue', () => {
    const plan = weekPlan(makeCtx(week(), TODAY), weekOf(TODAY, 1));
    const on = (day: string) => titles(plan.days.find((d) => d.day === day)!.entries);
    // Sam promised Friday, so his chase is the Monday after.
    expect(on('2026-10-19')).toEqual(['chase Drawings', 'planned Diary']);
    expect(on('2026-10-23')).toEqual(['planned Diary', 'planned Timesheet']);
    expect(plan.overdue.map((i) => i.title)).toEqual(['Old thing', 'Timesheet', 'Report']);
  });
  it('reads as lines to paste into an email', () => {
    const ctx = makeCtx(week(), TODAY);
    const text = weekPlanText(weekPlan(ctx, weekOf(TODAY)), ctx);
    expect(text.split('\n').slice(0, 3)).toEqual(['Week of Mon 10/12 to Fri 10/16', '', 'Mon 10/12']);
    expect(text).toContain('Thu 10/15\n- Due: Diary\n- Chase: Cable schedule (Priya Shah)');
    expect(text).toContain('- Expected: Drawings (Sam Lee)');
    expect(text).toContain('Carried over:\n- Old thing, due Wed 10/7\n- Timesheet, due Fri 10/9');
    expect(text).toContain('No date yet:\n- Someday');
  });
  it('shows a holiday, and a weekend day only when something is on it', () => {
    let doc = week();
    doc = { ...doc, settings: { ...doc.settings, holidays: ['2026-10-13'] } };
    doc = add(doc, { title: 'Weekend job', direction: 'owe', due: '2026-10-17' }).doc;
    const plan = weekPlan(makeCtx(doc, TODAY), weekOf(TODAY));
    expect(plan.days.find((d) => d.day === '2026-10-13')).toMatchObject({ holiday: true, working: false });
    expect(plan.days.map((d) => d.day)).toContain('2026-10-17');
    expect(plan.days.map((d) => d.day)).not.toContain('2026-10-18');
  });
});

describe('recurring items, a week at a time', () => {
  it('shows each occurrence on its day: done, late, skipped, due and still to come', () => {
    const rows = routineGrid(makeCtx(week(), TODAY), weekOf(TODAY));
    expect(rows.map((r) => r.series.head.title)).toEqual(['Timesheet', 'Diary']);
    const [timesheet, diary] = rows;
    expect(timesheet.overdueSince).toBe('2026-10-09');
    expect(timesheet.cells.map((c) => [c.day, c.state])).toEqual([['2026-10-16', 'planned']]);
    expect(diary.cells.map((c) => [c.day, c.state])).toEqual([
      ['2026-10-12', 'done'],
      ['2026-10-13', 'late'],
      ['2026-10-14', 'skipped'],
      ['2026-10-15', 'due'],
      ['2026-10-16', 'planned'],
    ]);
  });
  it('marks the days that went by while one was left open', () => {
    const doc = add(docWith(), { title: 'Diary', direction: 'owe', due: '2026-10-12', recur: DAILY }, at('2026-10-09')).doc;
    const [row] = routineGrid(makeCtx(doc, TODAY), weekOf(TODAY));
    expect(row.cells.map((c) => c.state)).toEqual(['overdue', 'missed', 'missed', 'planned', 'planned']);
  });
  it('leaves out a series with nothing this week', () => {
    const doc = add(docWith(), { title: 'Quarterly audit', direction: 'owe', due: '2026-12-01', recur: { every: 3, unit: 'month', monthDay: 1 } }).doc;
    expect(routineGrid(makeCtx(doc, TODAY), weekOf(TODAY))).toEqual([]);
  });
});
