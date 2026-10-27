/**
 * Recurring items as series: every occurrence of one recurring item, the one in hand,
 * and how it has gone. Worked out from the items on every render and never stored, so
 * a record can never disagree with the occurrences it is counted from.
 */
import { compareDays } from './dates';
import { ruleOf } from './recur';
import type { Day, Item, LedgerDoc, Recurrence } from './types';

/** How a closed occurrence went: done by its date, done after it, passed over, or dropped. */
export type Outcome = 'done' | 'late' | 'skipped' | 'dropped';

export function outcome(it: Item): Outcome | null {
  if (it.status === 'open') return null;
  if (it.status === 'done') return it.due && it.closedOn && it.closedOn > it.due ? 'late' : 'done';
  return it.history.some((h) => h.kind === 'skipped') ? 'skipped' : 'dropped';
}

export type SeriesRecord = {
  /** Occurrences done, on time or late. */
  done: number;
  onTime: number;
  late: number;
  skipped: number;
  /** Done on time in a row, back from the latest. A skipped one neither counts nor breaks it. */
  streak: number;
  lastDone?: Day;
};

export type Series = {
  /** The id of its first occurrence. */
  id: string;
  /** The occurrence on the list: the one to do next. */
  current?: Item;
  /** Every occurrence, in the order they fell due. */
  items: Item[];
  /** The occurrence its name and schedule are read from: the one in hand, else the latest. */
  head: Item;
  rule?: Recurrence;
  /** Still repeating: the occurrence in hand has a schedule. */
  active: boolean;
  record: SeriesRecord;
};

/** The day an occurrence belongs to: the day it was due, else the day it was closed. */
export function occurrenceDay(it: Item): Day {
  return it.due ?? it.closedOn ?? it.askedOn;
}

function record(items: Item[]): SeriesRecord {
  const r: SeriesRecord = { done: 0, onTime: 0, late: 0, skipped: 0, streak: 0 };
  let counting = true;
  for (const it of [...items].reverse()) {
    const o = outcome(it);
    if (!o) continue;
    if (o === 'done' || o === 'late') {
      r.done++;
      if (it.closedOn && (!r.lastDone || it.closedOn > r.lastDone)) r.lastDone = it.closedOn;
    }
    if (o === 'done') r.onTime++;
    else if (o === 'late') r.late++;
    else if (o === 'skipped') r.skipped++;
    if (counting) {
      if (o === 'done') r.streak++;
      else if (o !== 'skipped') counting = false;
    }
  }
  return r;
}

/** Every recurring series in the ledger: those still repeating first, the soonest due first. */
export function allSeries(doc: LedgerDoc): Series[] {
  const groups = new Map<string, Item[]>();
  for (const it of doc.items) {
    const id = it.seriesId ?? (it.recur ? it.id : undefined);
    if (id) groups.set(id, [...(groups.get(id) ?? []), it]);
  }
  const out: Series[] = [];
  for (const [id, items] of groups) {
    items.sort((a, b) => compareDays(occurrenceDay(a), occurrenceDay(b)) || a.num - b.num);
    const open = items.filter((i) => i.status === 'open');
    const current = open.find((i) => i.recur) ?? open[0];
    const head = current ?? items.reduce((a, b) => (b.num > a.num ? b : a));
    out.push({ id, current, items, head, rule: ruleOf(head), active: !!current?.recur, record: record(items) });
  }
  return out.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      compareDays(a.current?.due ?? '9999-12-31', b.current?.due ?? '9999-12-31') ||
      a.head.title.localeCompare(b.head.title),
  );
}

/** The series an item belongs to, if it is one of a recurring item's occurrences. */
export function seriesOf(doc: LedgerDoc, it: Item): Series | undefined {
  const id = it.seriesId ?? (it.recur ? it.id : undefined);
  return id ? allSeries(doc).find((s) => s.id === id) : undefined;
}

/** True for an occurrence of a recurring item: it falls due on a schedule rather than when asked. */
export function isOccurrence(it: Item): boolean {
  return !!(it.recur || it.seriesId);
}
