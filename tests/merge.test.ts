import { describe, expect, it } from 'vitest';
import { mergeDocs, mergeHistory, mergeSet, same } from '../src/engine/merge';
import { addNote, addPerson, complete, removePerson, snooze, updateItem, updatePerson, updateSettings } from '../src/engine/ops';
import { add, at, docWith, pid, TODAY } from './helpers';

const NOW = at(TODAY, 15);

function base() {
  let doc = docWith();
  doc = add(doc, { title: 'ATS report', personId: pid(doc, 'Sam') }).doc;
  doc = add(doc, { title: 'Cable schedule', personId: pid(doc, 'Priya') }).doc;
  return doc;
}

describe('merging two devices', () => {
  it('takes a change made on one side only', () => {
    const b = base();
    const mine = b;
    const theirs = updateItem(b, b.items[0].id, { title: 'ATS report rev B' }, at(TODAY, 11));
    const r = mergeDocs(b, mine, theirs, NOW);
    expect(r.doc.items[0].title).toBe('ATS report rev B');
    expect(r.clashes).toBe(0);
  });

  it('keeps edits to different fields and different items from both sides', () => {
    const b = base();
    const mine = updateItem(b, b.items[0].id, { due: '2026-10-20' }, at(TODAY, 11));
    const theirs = snooze(updateItem(b, b.items[0].id, { title: 'ATS report rev B' }, at(TODAY, 12)), b.items[1].id, '2026-10-22', at(TODAY, 12));
    const r = mergeDocs(b, mine, theirs, NOW);
    expect(r.doc.items[0].title).toBe('ATS report rev B');
    expect(r.doc.items[0].due).toBe('2026-10-20');
    expect(r.doc.items[1].snoozeUntil).toBe('2026-10-22');
    expect(r.clashes).toBe(0);
  });

  it('keeps this device on a real clash, and says so', () => {
    const b = base();
    const mine = updateItem(b, b.items[0].id, { title: 'Mine' }, at(TODAY, 11));
    const theirs = updateItem(b, b.items[0].id, { title: 'Theirs' }, at(TODAY, 12));
    const r = mergeDocs(b, mine, theirs, NOW);
    expect(r.doc.items[0].title).toBe('Mine');
    expect(r.clashes).toBe(1);
  });

  it('loses nothing from either history', () => {
    const b = base();
    const id = b.items[0].id;
    const mine = addNote(b, id, 'Called Sam', at(TODAY, 11));
    const theirs = complete(addNote(b, id, 'Sam emailed', at(TODAY, 12)), id, undefined, at(TODAY, 13)).doc;
    const r = mergeDocs(b, mine, theirs, NOW);
    const h = r.doc.items[0].history.map((e) => e.text ?? e.kind);
    expect(h).toContain('Called Sam');
    expect(h).toContain('Sam emailed');
    expect(r.doc.items[0].status).toBe('done');
    // Oldest first, each event once.
    const ats = r.doc.items[0].history.map((e) => e.at);
    expect([...ats].sort()).toEqual(ats);
    expect(new Set(r.doc.items[0].history.map((e) => JSON.stringify(e))).size).toBe(r.doc.items[0].history.length);
  });

  it('adds items made on both devices, renumbering the one whose number was taken', () => {
    const b = base();
    const mine = add(b, { title: 'Made on the phone' }, at(TODAY, 11)).doc;
    const theirs = add(b, { title: 'Made on the laptop' }, at(TODAY, 12)).doc;
    const r = mergeDocs(b, mine, theirs, NOW);
    const phone = r.doc.items.find((i) => i.title === 'Made on the phone')!;
    const laptop = r.doc.items.find((i) => i.title === 'Made on the laptop')!;
    expect(laptop.num).toBe(3);
    expect(phone.num).toBe(4);
    expect(r.renumbered).toEqual([{ id: phone.id, from: 3, to: 4 }]);
    expect(phone.history.at(-1)?.text).toMatch(/Renumbered from #3/);
    expect(r.doc.nextNum).toBe(5);
    expect(new Set(r.doc.items.map((i) => i.num)).size).toBe(r.doc.items.length);
  });

  it('merges tags as sets', () => {
    expect(mergeSet(['a', 'b'], ['a', 'b', 'c'], ['b', 'd'])).toEqual(['b', 'c', 'd']);
    const b = base();
    const id = b.items[0].id;
    const mine = updateItem(b, id, { tags: ['BART'] }, at(TODAY, 11));
    const theirs = updateItem(b, id, { tags: ['IXL'] }, at(TODAY, 12));
    expect(mergeDocs(b, mine, theirs, NOW).doc.items[0].tags).toEqual(['BART', 'IXL']);
  });

  it('deletes what one side deleted and the other left alone, keeps what the other edited', () => {
    let b = base();
    b = addPerson(b, { name: 'Dev Patel' }, at(TODAY)).doc;
    const dev = pid(b, 'Dev');
    const mine = removePerson(b, dev);
    expect(mergeDocs(b, mine, b, NOW).doc.people.some((p) => p.id === dev)).toBe(false);
    const theirs = updatePerson(b, dev, { email: 'dev@example.com' });
    expect(mergeDocs(b, mine, theirs, NOW).doc.people.find((p) => p.id === dev)?.email).toBe('dev@example.com');
  });

  it('keeps a person one side deleted while an item still names them', () => {
    let b = base();
    b = addPerson(b, { name: 'Dev Patel' }, at(TODAY)).doc;
    const dev = pid(b, 'Dev');
    const mine = removePerson(b, dev);
    const theirs = add(b, { title: 'For Dev', personId: dev }, at(TODAY, 12)).doc;
    const r = mergeDocs(b, mine, theirs, NOW);
    expect(r.doc.people.some((p) => p.id === dev)).toBe(true);
  });

  it('merges settings field by field', () => {
    const b = base();
    const mine = updateSettings(b, { chase: { ...b.settings.chase, every: 3 } });
    const theirs = updateSettings(b, { myName: 'Alex K' });
    const r = mergeDocs(b, mine, theirs, NOW);
    expect(r.doc.settings.chase.every).toBe(3);
    expect(r.doc.settings.myName).toBe('Alex K');
    expect(r.clashes).toBe(0);
  });

  it('is a no-op when nothing changed on the other side', () => {
    const b = base();
    const mine = updateItem(b, b.items[1].id, { title: 'x' }, at(TODAY, 11));
    const r = mergeDocs(b, mine, b, NOW);
    expect(same(r.doc, mine)).toBe(true);
  });

  it('orders history by time and keeps same-instant events in order', () => {
    const h = mergeHistory(
      [
        { at: '2026-10-15T10:00:00.000Z', kind: 'created' },
        { at: '2026-10-15T12:00:00.000Z', kind: 'note', text: 'a' },
      ],
      [
        { at: '2026-10-15T10:00:00.000Z', kind: 'created' },
        { at: '2026-10-15T11:00:00.000Z', kind: 'note', text: 'b' },
      ],
    );
    expect(h.map((e) => e.text ?? e.kind)).toEqual(['created', 'b', 'a']);
  });
});
