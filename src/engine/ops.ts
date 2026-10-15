/**
 * Every change to the ledger, as a pure function from one document to the next.
 *
 * Nothing here mutates its input: the app keeps the previous document for undo, and
 * an edit that reached into it would make undo restore the edit. Each change that
 * matters later is also written into the item's history, which is append-only.
 */
import { addDays, addMonths, addWorkingDays, onOrBeforeWorking, toDay, type Calendar } from './dates';
import { newId } from './doc';
import type { Actor, ChaseLevel, Day, Direction, HistoryEvent, Item, LedgerDoc, Meeting, Person, Recurrence, Settings, Source } from './types';

export type Op = (doc: LedgerDoc) => LedgerDoc;

export function calendarOf(settings: Settings): Calendar {
  return { workDays: settings.workDays, holidays: settings.holidays };
}

function stamp(now: Date): string {
  return now.toISOString();
}

function ev(now: Date, kind: HistoryEvent['kind'], text?: string, by: Actor = 'you', extra: Partial<HistoryEvent> = {}): HistoryEvent {
  return { at: stamp(now), kind, ...(text ? { text } : {}), ...(by !== 'you' ? { by } : {}), ...extra };
}

function replaceItem(doc: LedgerDoc, id: string, fn: (it: Item) => Item): LedgerDoc {
  let found = false;
  const items = doc.items.map((it) => {
    if (it.id !== id) return it;
    found = true;
    return fn(it);
  });
  if (!found) throw new Error(`No item ${id}`);
  return { ...doc, items };
}

export type ItemDraft = {
  title: string;
  direction: Direction;
  personId?: string;
  tags?: string[];
  askedOn?: Day;
  due?: Day;
  source?: Source;
  links?: string[];
  blockedBy?: string[];
  recur?: Recurrence;
  notes?: string;
  by?: Actor;
  /** A line for the history, e.g. which sentence an item was read from. */
  createdNote?: string;
};

export function addItem(doc: LedgerDoc, draft: ItemDraft, now: Date): { doc: LedgerDoc; item: Item } {
  const title = draft.title.trim();
  if (!title) throw new Error('An item needs a title.');
  const today = toDay(now);
  const item: Item = {
    id: newId('it', now.getTime()),
    num: doc.nextNum,
    title,
    direction: draft.direction,
    personId: draft.personId,
    tags: draft.tags ?? [],
    askedOn: draft.askedOn ?? today,
    due: draft.due,
    status: 'open',
    source: draft.source,
    links: draft.links ?? [],
    blockedBy: draft.blockedBy ?? [],
    recur: draft.recur,
    notes: draft.notes,
    history: [ev(now, 'created', draft.createdNote, draft.by ?? 'you', draft.due ? { due: draft.due } : {})],
    createdAt: stamp(now),
    updatedAt: stamp(now),
  };
  return { doc: { ...doc, items: [...doc.items, item], nextNum: doc.nextNum + 1 }, item };
}

export type ItemPatch = Partial<Pick<Item, 'title' | 'direction' | 'personId' | 'tags' | 'askedOn' | 'due' | 'nextChase' | 'notes' | 'links' | 'recur' | 'source'>>;

const FIELD_LABEL: Partial<Record<keyof ItemPatch, string>> = {
  title: 'Title',
  direction: 'Direction',
  personId: 'Person',
  askedOn: 'Asked on',
  due: 'Due',
  nextChase: 'Next chase',
};

/**
 * Change fields on an item. Changes worth knowing about later (a moved date, a
 * different person) are written to the history in words; notes and tags are not,
 * because the history is for what happened to the request, not to its wording.
 */
export function updateItem(doc: LedgerDoc, id: string, patch: ItemPatch, now: Date, describe?: (field: keyof ItemPatch, from: unknown, to: unknown) => string): LedgerDoc {
  return replaceItem(doc, id, (it) => {
    const next: Item = { ...it, ...patch, updatedAt: stamp(now) };
    const lines: string[] = [];
    for (const key of Object.keys(patch) as (keyof ItemPatch)[]) {
      const label = FIELD_LABEL[key];
      if (!label) continue;
      const from = it[key];
      const to = next[key];
      if (from === to) continue;
      lines.push(describe ? describe(key, from, to) : `${label}: ${from ?? 'none'} → ${to ?? 'none'}`);
    }
    if (patch.direction && patch.direction !== it.direction && patch.direction === 'owe') next.nextChase = undefined;
    const dueSet = 'due' in patch && patch.due !== it.due && patch.due ? { due: patch.due } : {};
    return lines.length ? { ...next, history: [...it.history, ev(now, 'edited', lines.join('; '), 'you', dueSet)] } : next;
  });
}

/** Log a chase. The chaser itself is drafted elsewhere; this records that it went. */
export function chase(doc: LedgerDoc, ids: string[], level: ChaseLevel, channel: string, now: Date): LedgerDoc {
  let out = doc;
  for (const id of ids) {
    out = replaceItem(out, id, (it) => ({
      ...it,
      // A hand-set chase date has been honoured; the next one is worked out again.
      nextChase: undefined,
      snoozeUntil: undefined,
      updatedAt: stamp(now),
      history: [...it.history, ev(now, 'chased', `${levelWord(level)} by ${channel}${ids.length > 1 ? ` (with ${ids.length - 1} other${ids.length > 2 ? 's' : ''})` : ''}`, 'you', { level })],
    }));
  }
  return out;
}

export function levelWord(level: ChaseLevel): string {
  return level === 'nudge' ? 'Nudge' : level === 'firm' ? 'Firm chase' : 'Escalation';
}

/** Next due date for a recurring item, on or before the matching working day. */
export function nextRecurrence(from: Day, recur: Recurrence, cal: Calendar): Day {
  if (recur.unit === 'day') return addWorkingDays(from, Math.max(1, recur.every), cal);
  if (recur.unit === 'week') return onOrBeforeWorking(addDays(from, 7 * Math.max(1, recur.every)), cal);
  return onOrBeforeWorking(addMonths(from, Math.max(1, recur.every)), cal);
}

/**
 * Close an item as done. For a waiting item that is "received". A recurring item
 * spawns its next occurrence, linked by a line in both histories.
 */
export function complete(doc: LedgerDoc, id: string, note: string | undefined, now: Date): { doc: LedgerDoc; spawned?: Item } {
  const today = toDay(now);
  const it = doc.items.find((i) => i.id === id);
  if (!it) throw new Error(`No item ${id}`);
  const kind = it.direction === 'wait' ? 'received' : 'done';
  let out = replaceItem(doc, id, (x) => ({
    ...x,
    status: 'done',
    closedOn: today,
    closeNote: note?.trim() || undefined,
    snoozeUntil: undefined,
    nextChase: undefined,
    updatedAt: stamp(now),
    history: [...x.history, ev(now, kind, note?.trim() || undefined)],
  }));
  let spawned: Item | undefined;
  if (it.recur) {
    const cal = calendarOf(doc.settings);
    const due = nextRecurrence(it.due && it.due > today ? it.due : (it.due ?? today), it.recur, cal);
    const made = addItem(
      out,
      {
        title: it.title,
        direction: it.direction,
        personId: it.personId,
        tags: it.tags,
        due: due > today ? due : nextRecurrence(today, it.recur, cal),
        recur: it.recur,
        source: it.source,
        links: it.links,
        createdNote: `Recurs: next after #${it.num}`,
      },
      now,
    );
    out = made.doc;
    spawned = made.item;
  }
  return { doc: out, spawned };
}

export function drop(doc: LedgerDoc, id: string, reason: string | undefined, now: Date): LedgerDoc {
  const today = toDay(now);
  return replaceItem(doc, id, (it) => ({
    ...it,
    status: 'dropped',
    closedOn: today,
    closeNote: reason?.trim() || undefined,
    snoozeUntil: undefined,
    updatedAt: stamp(now),
    history: [...it.history, ev(now, 'dropped', reason?.trim() || undefined)],
  }));
}

export function reopen(doc: LedgerDoc, id: string, now: Date): LedgerDoc {
  return replaceItem(doc, id, (it) => ({
    ...it,
    status: 'open',
    closedOn: undefined,
    closeNote: undefined,
    updatedAt: stamp(now),
    history: [...it.history, ev(now, 'reopened')],
  }));
}

export function snooze(doc: LedgerDoc, id: string, until: Day | undefined, now: Date): LedgerDoc {
  return replaceItem(doc, id, (it) => ({
    ...it,
    snoozeUntil: until,
    updatedAt: stamp(now),
    history: [...it.history, ev(now, 'snoozed', until ? `until ${until}` : 'woken')],
  }));
}

export function addNote(doc: LedgerDoc, id: string, text: string, now: Date, by: Actor = 'you'): LedgerDoc {
  const t = text.trim();
  if (!t) return doc;
  return replaceItem(doc, id, (it) => ({ ...it, updatedAt: stamp(now), history: [...it.history, ev(now, 'note', t, by)] }));
}

/** Kept in the weekly review: it has been looked at, which resets the review clock only. */
export function markReviewed(doc: LedgerDoc, id: string, now: Date): LedgerDoc {
  return replaceItem(doc, id, (it) => ({ ...it, history: [...it.history, ev(now, 'reviewed')] }));
}

/** They gave a (new) date. That is movement from their side, and it becomes the promise. */
export function recordPromise(doc: LedgerDoc, id: string, day: Day | undefined, text: string | undefined, now: Date, by: Actor = 'you'): LedgerDoc {
  return replaceItem(doc, id, (it) => ({
    ...it,
    due: day ?? it.due,
    nextChase: undefined,
    updatedAt: stamp(now),
    history: [...it.history, ev(now, 'promise', text?.trim() || undefined, by, day ? { due: day } : {})],
  }));
}

/** True if making `id` wait on `blocker` would close a loop. */
export function wouldCycle(doc: LedgerDoc, id: string, blocker: string): boolean {
  const seen = new Set<string>();
  const stack = [blocker];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === id) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const it = doc.items.find((i) => i.id === cur);
    if (it) stack.push(...it.blockedBy);
  }
  return false;
}

export function link(doc: LedgerDoc, id: string, blocker: string, now: Date): LedgerDoc {
  if (id === blocker || wouldCycle(doc, id, blocker)) throw new Error('That would make the two items wait on each other.');
  const b = doc.items.find((i) => i.id === blocker);
  return replaceItem(doc, id, (it) =>
    it.blockedBy.includes(blocker)
      ? it
      : { ...it, blockedBy: [...it.blockedBy, blocker], updatedAt: stamp(now), history: [...it.history, ev(now, 'linked', b ? `Needs #${b.num} ${b.title}` : undefined)] },
  );
}

export function unlink(doc: LedgerDoc, id: string, blocker: string, now: Date): LedgerDoc {
  const b = doc.items.find((i) => i.id === blocker);
  return replaceItem(doc, id, (it) =>
    it.blockedBy.includes(blocker)
      ? { ...it, blockedBy: it.blockedBy.filter((x) => x !== blocker), updatedAt: stamp(now), history: [...it.history, ev(now, 'unlinked', b ? `No longer needs #${b.num}` : undefined)] }
      : it,
  );
}

// ── People ──────────────────────────────────────────────────────────────────

export function addPerson(doc: LedgerDoc, p: Omit<Person, 'id' | 'createdAt'>, now: Date): { doc: LedgerDoc; person: Person } {
  const name = p.name.trim();
  if (!name) throw new Error('A person needs a name.');
  const person: Person = { ...p, name, email: p.email?.trim().toLowerCase() || undefined, id: newId('pe', now.getTime()), createdAt: stamp(now) };
  return { doc: { ...doc, people: [...doc.people, person] }, person };
}

export function updatePerson(doc: LedgerDoc, id: string, patch: Partial<Omit<Person, 'id' | 'createdAt'>>): LedgerDoc {
  return { ...doc, people: doc.people.map((p) => (p.id === id ? { ...p, ...patch, email: (patch.email ?? p.email)?.trim().toLowerCase() || undefined } : p)) };
}

/** A person can be removed only when nothing refers to them: history is never orphaned. */
export function removePerson(doc: LedgerDoc, id: string): LedgerDoc {
  if (doc.items.some((i) => i.personId === id)) throw new Error('This person has items. Merge them into someone else instead.');
  return { ...doc, people: doc.people.filter((p) => p.id !== id), meetings: doc.meetings.map((m) => ({ ...m, attendees: m.attendees.filter((a) => a !== id) })) };
}

/** Fold a duplicate into the person who stays. Every item and meeting follows. */
export function mergePeople(doc: LedgerDoc, keepId: string, goneId: string, now: Date): LedgerDoc {
  if (keepId === goneId) return doc;
  const gone = doc.people.find((p) => p.id === goneId);
  const keep = doc.people.find((p) => p.id === keepId);
  if (!gone || !keep) return doc;
  return {
    ...doc,
    people: doc.people.filter((p) => p.id !== goneId).map((p) => (p.id === keepId ? { ...p, email: p.email ?? gone.email, company: p.company ?? gone.company, role: p.role ?? gone.role } : p)),
    items: doc.items.map((it) =>
      it.personId === goneId ? { ...it, personId: keepId, updatedAt: stamp(now), history: [...it.history, ev(now, 'edited', `Person: ${gone.name} merged into ${keep.name}`)] } : it,
    ),
    meetings: doc.meetings.map((m) => ({ ...m, attendees: [...new Set(m.attendees.map((a) => (a === goneId ? keepId : a)))] })),
  };
}

// ── Meetings ────────────────────────────────────────────────────────────────

export function addMeeting(doc: LedgerDoc, m: { name: string; attendees: string[]; recurring: boolean }, now: Date): { doc: LedgerDoc; meeting: Meeting } {
  const name = m.name.trim();
  if (!name) throw new Error('A meeting needs a name.');
  const meeting: Meeting = { id: newId('mt', now.getTime()), name, attendees: m.attendees, recurring: m.recurring, sessions: [], createdAt: stamp(now) };
  return { doc: { ...doc, meetings: [...doc.meetings, meeting] }, meeting };
}

export function updateMeeting(doc: LedgerDoc, id: string, patch: Partial<Pick<Meeting, 'name' | 'attendees' | 'recurring'>>): LedgerDoc {
  return { ...doc, meetings: doc.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
}

/** Today's session of a meeting, created if it is not there yet. */
export function openSession(doc: LedgerDoc, meetingId: string, day: Day, now: Date): { doc: LedgerDoc; sessionId: string } {
  const m = doc.meetings.find((x) => x.id === meetingId);
  if (!m) throw new Error('No such meeting.');
  const existing = m.sessions.find((s) => s.date === day);
  if (existing) return { doc, sessionId: existing.id };
  const s = { id: newId('ms', now.getTime()), date: day };
  return { doc: updateMeetingSessions(doc, meetingId, [...m.sessions, s]), sessionId: s.id };
}

function updateMeetingSessions(doc: LedgerDoc, meetingId: string, sessions: Meeting['sessions']): LedgerDoc {
  return { ...doc, meetings: doc.meetings.map((m) => (m.id === meetingId ? { ...m, sessions } : m)) };
}

export function setSessionNotes(doc: LedgerDoc, meetingId: string, sessionId: string, notes: string): LedgerDoc {
  const m = doc.meetings.find((x) => x.id === meetingId);
  if (!m) return doc;
  return updateMeetingSessions(
    doc,
    meetingId,
    m.sessions.map((s) => (s.id === sessionId ? { ...s, notes } : s)),
  );
}

export function removeMeeting(doc: LedgerDoc, id: string): LedgerDoc {
  return { ...doc, meetings: doc.meetings.filter((m) => m.id !== id) };
}

// ── Settings and the rest ───────────────────────────────────────────────────

export function updateSettings(doc: LedgerDoc, patch: Partial<Settings>): LedgerDoc {
  return { ...doc, settings: { ...doc.settings, ...patch } };
}

export function dismissMessage(doc: LedgerDoc, messageId: string): LedgerDoc {
  return doc.dismissed.includes(messageId) ? doc : { ...doc, dismissed: [...doc.dismissed, messageId].slice(-2000) };
}
