import { describe, expect, it } from 'vitest';
import { age, chasePlan, expectedArrival, looksDead, makeCtx, risk, today } from '../src/engine/decide';
import { chase, complete, link, recordPromise, updatePerson } from '../src/engine/ops';
import { personStats } from '../src/engine/stats';
import { add, at, docWith, pid, TODAY } from './helpers';
import type { LedgerDoc } from '../src/engine/types';

/** Give Sam a record: five items each asked on a Monday and received 6 working days later, 2 late on a promise. */
function samWithHistory(doc: LedgerDoc): LedgerDoc {
  const sam = pid(doc, 'Sam');
  const mondays = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'];
  for (const m of mondays) {
    const r = add(doc, { title: `old ${m}`, personId: sam, askedOn: m, due: addWd(m, 4) }, at(m));
    doc = chase(r.doc, [r.item.id], 'nudge', 'email', at(addWd(m, 5)));
    doc = complete(doc, r.item.id, undefined, at(addWd(m, 6))).doc;
  }
  return doc;
}
function addWd(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('person statistics', () => {
  it('counts delivery, lateness and chases from closed items', () => {
    const doc = samWithHistory(docWith());
    const st = personStats(doc.items, pid(doc, 'Sam'), doc.settings, { workDays: [1, 2, 3, 4, 5], holidays: [] });
    expect(st.samples).toBe(5);
    expect(st.learned).toBe(true);
    expect(st.deliveryDays).toBe(6);
    expect(st.lateDays).toBe(2);
    expect(st.promisesKept).toBe(0);
    expect(st.chasesNeeded).toBe(1);
  });
});

describe('when to chase', () => {
  it('uses the default rhythm before anything is learned', () => {
    const { doc, item } = add(docWith(), { title: 'x', askedOn: '2026-10-12' });
    const plan = chasePlan(item, makeCtx(doc, TODAY))!;
    expect(plan.day).toBe('2026-10-19');
    expect(plan.reason).toContain('your default');
    expect(plan.level).toBe('nudge');
  });
  it("learns a person's rhythm", () => {
    let doc = samWithHistory(docWith());
    const r = add(doc, { title: 'new', personId: pid(doc, 'Sam'), askedOn: '2026-10-12' });
    doc = r.doc;
    const plan = chasePlan(r.item, makeCtx(doc, TODAY))!;
    // usually 6 working days, so chase at day 7: Monday 12 + 7 = Wednesday 21.
    expect(plan.day).toBe('2026-10-21');
    expect(plan.reason).toContain('usually delivers in 6 working days');
  });
  it('honours a hand-set rhythm over what was learned', () => {
    let doc = samWithHistory(docWith());
    doc = updatePerson(doc, pid(doc, 'Sam'), { chaseEvery: 2 });
    const r = add(doc, { title: 'new', personId: pid(doc, 'Sam'), askedOn: '2026-10-12' });
    expect(chasePlan(r.item, makeCtx(r.doc, TODAY))!.day).toBe('2026-10-14');
  });
  it('waits until the day after a promise', () => {
    const { doc, item } = add(docWith(), { title: 'x', askedOn: '2026-10-12', due: '2026-10-22' });
    const plan = chasePlan(item, makeCtx(doc, TODAY))!;
    expect(plan.day).toBe('2026-10-23');
    expect(plan.reason).toContain('promised');
  });
  it('steps up the level with each unanswered chase', () => {
    let { doc, item } = add(docWith(), { title: 'x', askedOn: '2026-10-01' }, at('2026-10-01'));
    doc = chase(doc, [item.id], 'nudge', 'email', at('2026-10-08'));
    expect(chasePlan(doc.items[0], makeCtx(doc, TODAY))!.level).toBe('firm');
    doc = chase(doc, [item.id], 'firm', 'email', at('2026-10-13'));
    expect(chasePlan(doc.items[0], makeCtx(doc, TODAY))!.level).toBe('escalate');
    doc = recordPromise(doc, item.id, '2026-10-20', undefined, at('2026-10-14'));
    expect(chasePlan(doc.items[0], makeCtx(doc, TODAY))!.level).toBe('nudge');
  });
});

describe('arrival and risk', () => {
  it('expects a habitual late runner to be late', () => {
    let doc = samWithHistory(docWith());
    const r = add(doc, { title: 'input', personId: pid(doc, 'Sam'), due: '2026-10-21' });
    doc = r.doc;
    const exp = expectedArrival(r.item, makeCtx(doc, TODAY));
    expect(exp.day).toBe('2026-10-23');
    expect(exp.reason).toContain('runs 2 working days late');
  });
  it('flags something I owe as at risk when its input will land too late', () => {
    let doc = samWithHistory(docWith());
    const input = add(doc, { title: 'Sam input', personId: pid(doc, 'Sam'), due: '2026-10-21' });
    doc = input.doc;
    const mine = add(doc, { title: 'Report to BART', direction: 'owe', due: '2026-10-23' });
    doc = link(mine.doc, mine.item.id, input.item.id, at(TODAY));
    const ctx = makeCtx(doc, TODAY);
    const rk = risk(doc.items.find((i) => i.id === mine.item.id)!, ctx)!;
    expect(rk.level).toBe('risk');
    expect(rk.reason).toContain('likely Fri 10/23');
  });
  it('says unknown when the input has no date', () => {
    let doc = docWith();
    const input = add(doc, { title: 'Sam input', personId: pid(doc, 'Sam') });
    const mine = add(input.doc, { title: 'Mine', direction: 'owe', due: '2026-10-30' });
    doc = link(mine.doc, mine.item.id, input.item.id, at(TODAY));
    expect(risk(doc.items.find((i) => i.id === mine.item.id)!, makeCtx(doc, TODAY))!.level).toBe('unknown');
  });
});

describe('dead items', () => {
  it('calls an item dead after long silence and repeated chases', () => {
    let { doc, item } = add(docWith(), { title: 'x', askedOn: '2026-09-01' }, at('2026-09-01'));
    doc = chase(doc, [item.id], 'nudge', 'email', at('2026-09-08'));
    doc = chase(doc, [item.id], 'firm', 'email', at('2026-09-15'));
    expect(looksDead(doc.items[0], makeCtx(doc, TODAY))).toContain('No movement');
  });
});

describe('today', () => {
  it('sorts the day into sections, each item once', () => {
    let doc = docWith();
    const a = add(doc, { title: 'Overdue thing', direction: 'owe', due: '2026-10-13' });
    const b = add(a.doc, { title: 'Chase me', askedOn: '2026-10-01', personId: pid(a.doc, 'Priya') });
    const c = add(b.doc, { title: 'Due soon', direction: 'owe', due: '2026-10-19' });
    doc = c.doc;
    const t = today(makeCtx(doc, TODAY));
    expect(t.due.map((e) => e.item.title)).toEqual(['Overdue thing']);
    expect(t.chase.map((e) => e.item.title)).toEqual(['Chase me']);
    expect(t.soon.map((e) => e.item.title)).toEqual(['Due soon']);
    expect(t.due[0].reason).toContain('2 working days ago');
  });
  it('shows an item whose blockers all arrived as unblocked', () => {
    let doc = docWith();
    const input = add(doc, { title: 'input', personId: pid(doc, 'Sam') });
    const mine = add(input.doc, { title: 'Mine', direction: 'owe', due: '2026-10-30' });
    doc = link(mine.doc, mine.item.id, input.item.id, at(TODAY));
    doc = complete(doc, input.item.id, undefined, at('2026-10-14')).doc;
    const t = today(makeCtx(doc, TODAY));
    expect(t.unblocked.map((e) => e.item.title)).toEqual(['Mine']);
  });
  it('describes age in words with a tone', () => {
    const { doc, item } = add(docWith(), { title: 'x', direction: 'owe', due: TODAY });
    expect(age(item, makeCtx(doc, TODAY))).toMatchObject({ tone: 'bad', label: 'Due today' });
  });
});
