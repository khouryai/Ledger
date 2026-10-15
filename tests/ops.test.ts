import { describe, expect, it } from 'vitest';
import { addNote, chase, complete, drop, link, recordPromise, reopen, snooze, updateItem, wouldCycle, mergePeople, removePerson } from '../src/engine/ops';
import { readDoc } from '../src/engine/doc';
import { add, at, docWith, pid, TODAY } from './helpers';

describe('items', () => {
  it('numbers items and writes a created event', () => {
    let doc = docWith();
    const a = add(doc, { title: 'One', personId: pid(doc, 'Sam') });
    doc = a.doc;
    const b = add(doc, { title: 'Two' });
    expect(a.item.num).toBe(1);
    expect(b.item.num).toBe(2);
    expect(a.item.history[0].kind).toBe('created');
    expect(a.item.askedOn).toBe(TODAY);
  });
  it('never changes the document it was given', () => {
    const doc = docWith();
    const { doc: next, item } = add(doc, { title: 'x' });
    const frozen = JSON.stringify(next);
    chase(next, [item.id], 'nudge', 'email', at(TODAY));
    complete(next, item.id, 'ok', at(TODAY));
    expect(JSON.stringify(next)).toBe(frozen);
  });
  it('records due moves in the history with the date it set', () => {
    let { doc, item } = add(docWith(), { title: 'x', due: '2026-10-20' });
    doc = updateItem(doc, item.id, { due: '2026-10-23' }, at('2026-10-16'));
    const it2 = doc.items[0];
    expect(it2.history.at(-1)).toMatchObject({ kind: 'edited', due: '2026-10-23' });
    expect(it2.history.at(-1)!.text).toContain('Due');
  });
  it('closes, reopens and drops', () => {
    let { doc, item } = add(docWith(), { title: 'x' });
    doc = complete(doc, item.id, 'arrived', at('2026-10-16')).doc;
    expect(doc.items[0]).toMatchObject({ status: 'done', closedOn: '2026-10-16', closeNote: 'arrived' });
    expect(doc.items[0].history.at(-1)!.kind).toBe('received');
    doc = reopen(doc, item.id, at('2026-10-16'));
    expect(doc.items[0].status).toBe('open');
    doc = drop(doc, item.id, 'not needed', at('2026-10-16'));
    expect(doc.items[0].status).toBe('dropped');
  });
  it('spawns the next occurrence of a recurring item', () => {
    let { doc, item } = add(docWith(), { title: 'Timesheet', direction: 'owe', due: '2026-10-16', recur: { every: 1, unit: 'week' } });
    const r = complete(doc, item.id, undefined, at('2026-10-16'));
    doc = r.doc;
    expect(r.spawned).toMatchObject({ title: 'Timesheet', due: '2026-10-23', status: 'open' });
    expect(doc.items.length).toBe(2);
  });
  it('moves a monthly recurrence back to a working day', () => {
    let { doc, item } = add(docWith(), { title: 'Report', direction: 'owe', due: '2026-10-05', recur: { every: 1, unit: 'month' } });
    const r = complete(doc, item.id, undefined, at('2026-10-05'));
    // 5 Nov 2026 is a Thursday.
    expect(r.spawned!.due).toBe('2026-11-05');
    ({ doc, item } = add(docWith(), { title: 'Report', direction: 'owe', due: '2026-09-07', recur: { every: 1, unit: 'month' } }));
    // 7 Nov 2026 is a Saturday, so the Friday before.
    const r2 = complete(doc, item.id, undefined, at('2026-10-07'));
    expect(r2.spawned!.due).toBe('2026-11-06');
  });
  it('refuses a blocked-by loop', () => {
    let doc = docWith();
    const a = add(doc, { title: 'a', direction: 'owe' });
    doc = a.doc;
    const b = add(doc, { title: 'b' });
    doc = b.doc;
    doc = link(doc, a.item.id, b.item.id, at(TODAY));
    expect(wouldCycle(doc, b.item.id, a.item.id)).toBe(true);
    expect(() => link(doc, b.item.id, a.item.id, at(TODAY))).toThrow();
  });
  it('snoozes, notes and records promises', () => {
    let { doc, item } = add(docWith(), { title: 'x' });
    doc = snooze(doc, item.id, '2026-10-20', at(TODAY));
    expect(doc.items[0].snoozeUntil).toBe('2026-10-20');
    doc = addNote(doc, item.id, 'Called, he is on it', at(TODAY));
    doc = recordPromise(doc, item.id, '2026-10-22', 'Will send Thursday', at(TODAY));
    expect(doc.items[0].due).toBe('2026-10-22');
    expect(doc.items[0].history.map((h) => h.kind)).toEqual(['created', 'snoozed', 'note', 'promise']);
  });
});

describe('people', () => {
  it('merges a duplicate and moves its items', () => {
    let doc = docWith(['Sam Lee', 'S Lee']);
    const { doc: d2 } = add(doc, { title: 'x', personId: pid(doc, 'S Lee') });
    doc = mergePeople(d2, pid(d2, 'Sam'), pid(d2, 'S Lee'), at(TODAY));
    expect(doc.people.length).toBe(1);
    expect(doc.items[0].personId).toBe(doc.people[0].id);
  });
  it('will not remove someone with items', () => {
    const doc = docWith(['Sam Lee']);
    const { doc: d2 } = add(doc, { title: 'x', personId: pid(doc, 'Sam') });
    expect(() => removePerson(d2, pid(d2, 'Sam'))).toThrow();
  });
});

describe('reading a file', () => {
  it('fills what is missing and numbers unnumbered items', () => {
    const { doc, problems } = readDoc({ items: [{ id: 'a', title: 'x', createdAt: '2026-10-01T10:00:00Z' }, { id: 'b', title: 'y', num: 4 }], settings: { chase: { every: 3 } } });
    expect(problems).toEqual([]);
    expect(doc.items.find((i) => i.id === 'a')!.num).toBe(5);
    expect(doc.nextNum).toBe(6);
    expect(doc.settings.chase).toEqual({ every: 3, escalateAfter: 2 });
    expect(doc.settings.templates.nudge.body).toContain('{first}');
  });
});
