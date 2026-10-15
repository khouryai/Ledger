/**
 * What the history says about an item and about a person.
 *
 * Nothing here is stored. It is counted from the items' histories every time it is
 * asked for, which is cheap at the size of one person's ledger and means a figure can
 * never disagree with the history it came from.
 */
import { compareDays, toDay, workingDaysBetween, type Calendar } from './dates';
import type { Day, HistoryEvent, Item, Settings } from './types';

/** The local day an event happened. */
export function eventDay(e: HistoryEvent): Day {
  return toDay(new Date(e.at));
}

/** Events that count as somebody having touched the item. */
const TOUCH = new Set<HistoryEvent['kind']>(['created', 'edited', 'chased', 'promise', 'note', 'reviewed', 'reopened', 'snoozed', 'linked']);

/** Events that count as movement on the request itself, not just me poking it. */
const MOVEMENT = new Set<HistoryEvent['kind']>(['created', 'promise', 'note', 'reopened', 'edited']);

export function lastTouch(it: Item): Day {
  let best = it.askedOn;
  for (const e of it.history) if (TOUCH.has(e.kind)) {
    const d = eventDay(e);
    if (d > best) best = d;
  }
  return best;
}

/** The last time anything happened other than a chase or a review. */
export function lastMovement(it: Item): Day {
  let best = it.askedOn;
  for (const e of it.history) if (MOVEMENT.has(e.kind)) {
    const d = eventDay(e);
    if (d > best) best = d;
  }
  return best;
}

/** The last time they responded: a promise, or a note of what they said. */
export function lastResponse(it: Item): Day | undefined {
  let best: Day | undefined;
  for (const e of it.history) if (e.kind === 'promise' || e.kind === 'note') {
    const d = eventDay(e);
    if (!best || d > best) best = d;
  }
  return best;
}

export function chases(it: Item): HistoryEvent[] {
  return it.history.filter((e) => e.kind === 'chased');
}

export function lastChase(it: Item): Day | undefined {
  const c = chases(it);
  return c.length ? eventDay(c[c.length - 1]) : undefined;
}

/** Chases since the last movement: how many times I have asked into silence. */
export function chasesSinceMovement(it: Item): number {
  const since = lastMovementInstant(it);
  return it.history.filter((e) => e.kind === 'chased' && e.at > since).length;
}

function lastMovementInstant(it: Item): string {
  let best = '';
  for (const e of it.history) if (MOVEMENT.has(e.kind) && e.at > best) best = e.at;
  return best;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type PersonStats = {
  /** Closed waiting items with this person that the figures are counted from. */
  samples: number;
  /** True once there are enough samples to use instead of the defaults. */
  learned: boolean;
  /** Median working days from asking to receiving. */
  deliveryDays: number | null;
  /** Median working days late against their promise; negative is early. */
  lateDays: number | null;
  /** Share of promises kept, of those with a promise. */
  promisesKept: number | null;
  promised: number;
  /** Median chases it took before it arrived. */
  chasesNeeded: number | null;
  openWait: number;
  openOwe: number;
};

export function personStats(items: Item[], personId: string, settings: Settings, cal: Calendar): PersonStats {
  const mine = items.filter((i) => i.personId === personId);
  const received = mine.filter((i) => i.direction === 'wait' && i.status === 'done' && i.closedOn);
  const delivery: number[] = [];
  const late: number[] = [];
  const chaseCounts: number[] = [];
  let kept = 0;
  for (const it of received) {
    delivery.push(Math.max(0, workingDaysBetween(it.askedOn, it.closedOn!, cal)));
    chaseCounts.push(chases(it).length);
    const promise = promiseAtClose(it);
    if (promise) {
      const l = workingDaysBetween(promise, it.closedOn!, cal);
      late.push(l);
      if (l <= 0) kept++;
    }
  }
  return {
    samples: received.length,
    learned: received.length >= settings.learnAfter,
    deliveryDays: median(delivery),
    lateDays: median(late),
    promisesKept: late.length ? kept / late.length : null,
    promised: late.length,
    chasesNeeded: median(chaseCounts),
    openWait: mine.filter((i) => i.status === 'open' && i.direction === 'wait').length,
    openOwe: mine.filter((i) => i.status === 'open' && i.direction === 'owe').length,
  };
}

/**
 * The promise an item is measured against: the first date it was ever given. Later
 * dates are re-promises, and measuring against the last one would make every slip
 * look on time.
 */
export function promiseAtClose(it: Item): Day | undefined {
  return it.history.find((e) => e.due)?.due ?? it.due;
}

export function sortByDay<T>(xs: T[], key: (x: T) => Day | undefined): T[] {
  return [...xs].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka && kb) return compareDays(ka, kb);
    return ka ? -1 : kb ? 1 : 0;
  });
}
