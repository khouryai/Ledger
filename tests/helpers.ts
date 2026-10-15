import { emptyDoc } from '../src/engine/doc';
import { addItem, addPerson, type ItemDraft } from '../src/engine/ops';
import type { LedgerDoc } from '../src/engine/types';

/** A fixed instant: Thursday 15 October 2026, 10:00 local. */
export function at(day: string, hour = 10): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0);
}

export const TODAY = '2026-10-15';

export function docWith(people: string[] = ['Sam Lee', 'Priya Shah']): LedgerDoc {
  let doc = emptyDoc(at(TODAY));
  doc = { ...doc, settings: { ...doc.settings, myName: 'Alex Khoury', myEmail: 'alex@example.com' } };
  for (const name of people) {
    const email = `${name.toLowerCase().replace(/ /g, '.')}@example.com`;
    doc = addPerson(doc, { name, email }, at(TODAY)).doc;
  }
  return doc;
}

export function add(doc: LedgerDoc, draft: Partial<ItemDraft> & { title: string }, when = at(TODAY)) {
  return addItem(doc, { direction: 'wait', ...draft }, when);
}

export function pid(doc: LedgerDoc, first: string): string {
  const p = doc.people.find((x) => x.name.startsWith(first));
  if (!p) throw new Error(`no ${first}`);
  return p.id;
}
