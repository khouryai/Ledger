/**
 * Two devices, one ledger.
 *
 * The laptop and the phone each keep the copy they last read (the *base*) and save
 * against its version. When a save finds that the other device saved first, the two
 * are merged here, three ways: what changed on this device since the base, what
 * changed on the other, and the base they both started from.
 *
 * - A field changed on one side only takes that side's value.
 * - A field changed on both sides to different values keeps this device's value
 *   (the edit the person is looking at), and is counted as a clash.
 * - An item's history is the union of both histories: it is append-only, so nothing
 *   either device recorded is lost, and person statistics stay honest.
 * - Lists of ids and words (tags, links, needs, attendees, dismissed messages) merge
 *   as sets: added on either side is kept, removed on either side is removed.
 * - Something deleted on one side and untouched on the other is deleted. Something
 *   deleted on one side and edited on the other is kept: an edit is a statement that
 *   it still matters.
 * - Two items given the same #number on two devices: the one already saved keeps
 *   it, and this device's gets the next free number, with a line in its history.
 *
 * Pure: no clock except the `now` passed in, no I/O.
 */
import type { HistoryEvent, Item, LedgerDoc, Meeting, MeetingSession, Person, Settings } from './types';

export type MergeResult = {
  doc: LedgerDoc;
  /** Fields both devices changed to different values; this device's value was kept. */
  clashes: number;
  /** Items whose #number was taken on the other device first. */
  renumbered: { id: string; from: number; to: number }[];
};

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON with keys sorted, so two equal values compare equal whatever order they were built in. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObj(v))
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v) ?? 'undefined';
}

export function same(a: unknown, b: unknown): boolean {
  return canon(a) === canon(b);
}

type Tally = { clashes: number };

/** One value, three ways. */
function pick<T>(base: T | undefined, mine: T, theirs: T, tally: Tally): T {
  if (same(mine, theirs)) return mine;
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  tally.clashes++;
  return mine;
}

/** Plain objects merged key by key, nested objects recursively; anything else is one value. */
function deep(base: unknown, mine: unknown, theirs: unknown, tally: Tally): unknown {
  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out: Obj = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(b)])) {
      const v = deep(b[k], mine[k], theirs[k], tally);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return pick(base, mine, theirs, tally);
}

/** A list of strings as a set: added on either side kept, removed on either side gone. */
export function mergeSet(base: string[] | undefined, mine: string[], theirs: string[]): string[] {
  const b = new Set(base ?? []);
  const removed = new Set([...b].filter((x) => !mine.includes(x) || !theirs.includes(x)));
  const out: string[] = [];
  for (const x of [...mine, ...theirs]) if (!removed.has(x) && !out.includes(x)) out.push(x);
  return out;
}

/** Records with ids: matched by id, each merged with `one`, deletions as described above. */
function byId<T extends { id: string }>(base: T[], mine: T[], theirs: T[], one: (b: T | undefined, m: T, t: T) => T): T[] {
  const B = new Map(base.map((x) => [x.id, x]));
  const M = new Map(mine.map((x) => [x.id, x]));
  const T = new Map(theirs.map((x) => [x.id, x]));
  const out: T[] = [];
  for (const id of new Set([...M.keys(), ...T.keys()])) {
    const b = B.get(id);
    const m = M.get(id);
    const t = T.get(id);
    if (m && t) out.push(one(b, m, t));
    else if (m) {
      // Not on their side: new here, or deleted there. Deleted there and untouched here goes.
      if (!(b && same(b, m))) out.push(m);
    } else if (t) {
      if (!(b && same(b, t))) out.push(t);
    }
  }
  return out;
}

function eventKey(h: HistoryEvent): string {
  return canon(h);
}

/** Both histories, each event once, oldest first. */
export function mergeHistory(mine: HistoryEvent[], theirs: HistoryEvent[]): HistoryEvent[] {
  const seen = new Set<string>();
  const out: HistoryEvent[] = [];
  for (const h of [...mine, ...theirs]) {
    const k = eventKey(h);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  // A stable sort keeps two events with the same instant in the order they were made.
  return out.map((h, i) => ({ h, i })).sort((a, b) => a.h.at.localeCompare(b.h.at) || a.i - b.i).map((x) => x.h);
}

const ITEM_SETS = ['tags', 'links', 'blockedBy'] as const;

/** An item without the parts merged on their own terms, so they are not counted as clashes. */
function fields(it: Item | undefined): Obj | undefined {
  if (!it) return undefined;
  const { tags: _t, links: _l, blockedBy: _b, history: _h, updatedAt: _u, ...rest } = it;
  return rest;
}

function mergeItem(b: Item | undefined, m: Item, t: Item, tally: Tally): Item {
  const out = { ...(deep(fields(b), fields(m), fields(t), tally) as Item) };
  for (const k of ITEM_SETS) out[k] = mergeSet(b?.[k], m[k], t[k]);
  out.history = mergeHistory(m.history, t.history);
  out.updatedAt = m.updatedAt > t.updatedAt ? m.updatedAt : t.updatedAt;
  return out;
}

function mergePerson(b: Person | undefined, m: Person, t: Person, tally: Tally): Person {
  return deep(b, m, t, tally) as Person;
}

function mergeSession(b: MeetingSession | undefined, m: MeetingSession, t: MeetingSession, tally: Tally): MeetingSession {
  return deep(b, m, t, tally) as MeetingSession;
}

function mergeMeeting(b: Meeting | undefined, m: Meeting, t: Meeting, tally: Tally): Meeting {
  const strip = (x: Meeting | undefined) => {
    if (!x) return undefined;
    const { sessions: _s, attendees: _a, ...rest } = x;
    return rest;
  };
  const rest = deep(strip(b), strip(m), strip(t), tally) as Obj;
  return {
    ...rest,
    attendees: mergeSet(b?.attendees, m.attendees, t.attendees),
    sessions: byId(b?.sessions ?? [], m.sessions, t.sessions, (bs, ms, ts) => mergeSession(bs, ms, ts, tally)),
  } as Meeting;
}

/**
 * Merge this device's ledger (`mine`) with the one the other device saved
 * (`theirs`), both descended from `base`.
 */
export function mergeDocs(base: LedgerDoc, mine: LedgerDoc, theirs: LedgerDoc, now: Date): MergeResult {
  const tally: Tally = { clashes: 0 };
  let items = byId(base.items, mine.items, theirs.items, (b, m, t) => mergeItem(b, m, t, tally));
  const people = byId(base.people, mine.people, theirs.people, (b, m, t) => mergePerson(b, m, t, tally));
  // A person deleted on one side but still named by an item is kept.
  for (const it of items) {
    if (it.personId && !people.some((p) => p.id === it.personId)) {
      const back = mine.people.find((p) => p.id === it.personId) ?? theirs.people.find((p) => p.id === it.personId);
      if (back) people.push(back);
    }
  }
  const meetings = byId(base.meetings, mine.meetings, theirs.meetings, (b, m, t) => mergeMeeting(b, m, t, tally));
  const settings = deep(base.settings, mine.settings, theirs.settings, tally) as Settings;

  // Numbers: the item that already had the number on the saved side keeps it.
  let nextNum = Math.max(mine.nextNum, theirs.nextNum, ...items.map((i) => i.num + 1));
  const renumbered: MergeResult['renumbered'] = [];
  const theirsHas = new Map(theirs.items.map((i) => [i.id, i.num]));
  const holder = new Map<number, string>();
  for (const it of items) if (theirsHas.get(it.id) === it.num) holder.set(it.num, it.id);
  for (const it of items) if (!holder.has(it.num)) holder.set(it.num, it.id);
  const at = now.toISOString();
  items = items.map((it) => {
    if (holder.get(it.num) === it.id) return it;
    const to = nextNum++;
    renumbered.push({ id: it.id, from: it.num, to });
    return { ...it, num: to, history: [...it.history, { at, kind: 'edited', text: `Renumbered from #${it.num}: the other device used that number first` }] };
  });

  return {
    doc: {
      schema: Math.max(mine.schema, theirs.schema),
      settings,
      people,
      items,
      meetings,
      dismissed: mergeSet(base.dismissed, mine.dismissed, theirs.dismissed),
      // Examples are never edited: both devices' are kept, and one forgotten on either is gone.
      examples: byId(base.examples, mine.examples, theirs.examples, (_b, m) => m).sort((a, b) => a.at.localeCompare(b.at)),
      nextNum,
      createdAt: base.createdAt || mine.createdAt,
    },
    clashes: tally.clashes,
    renumbered,
  };
}
