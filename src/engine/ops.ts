/**
 * Every change to the ledger, as a pure function from one document to the next.
 *
 * Nothing here mutates its input: the app keeps the previous document for undo, and
 * an edit that reached into it would make undo restore the edit. Each change that
 * matters later is also written into the item's history, which is append-only.
 */
import { addDays, fmtDay, isDay, toDay, type Calendar } from './dates';
import { newId } from './doc';
import { describeRecurrence, firstOccurrence, fullRule, nextOccurrence, occurrencesAfter, ruleOf, sameRecurrence } from './recur';
import type { Actor, ChaseLevel, Day, Direction, HistoryEvent, Item, LedgerDoc, Meeting, Person, Recurrence, Settings, Source, Step } from './types';

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
  /** The series an occurrence belongs to. A new recurring item starts its own. */
  seriesId?: string;
  steps?: Step[];
  notes?: string;
  by?: Actor;
  /** A line for the history, e.g. which sentence an item was read from. */
  createdNote?: string;
};

export function addItem(doc: LedgerDoc, draft: ItemDraft, now: Date): { doc: LedgerDoc; item: Item } {
  const title = draft.title.trim();
  if (!title) throw new Error('An item needs a title.');
  const today = toDay(now);
  const id = newId('it', now.getTime());
  const item: Item = {
    id,
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
    seriesId: draft.seriesId ?? (draft.recur ? id : undefined),
    steps: draft.steps?.length ? draft.steps : undefined,
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
  recur: 'Repeats',
};

/** A change of schedule in words: "Repeats: Every Friday → Every Thursday". */
function recurLine(from: Recurrence | undefined, to: Recurrence | undefined, settings: Settings): string {
  const say = (r: Recurrence) => describeRecurrence(r, { order: settings.dateOrder });
  if (!to) return `Stopped repeating (was ${from ? say(from) : 'repeating'})`;
  return from ? `Repeats: ${say(from)} → ${say(to)}` : `Repeats ${say(to)}`;
}

/**
 * Change fields on an item. Changes worth knowing about later (a moved date, a
 * different person, a new schedule) are written to the history in words; notes and
 * tags are not, because the history is for what happened to the request, not to its
 * wording.
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
      if (key === 'recur') {
        if (!sameRecurrence(it.recur, next.recur)) lines.push(recurLine(it.recur, next.recur, doc.settings));
        continue;
      }
      if (from === to) continue;
      const word = (v: unknown) => (v === undefined ? 'none' : isDay(v) ? fmtDay(v, doc.settings.dateOrder) : String(v));
      lines.push(describe ? describe(key, from, to) : `${label}: ${word(from)} → ${word(to)}`);
    }
    // An item that starts repeating starts a series of its own.
    if (next.recur && !next.seriesId) next.seriesId = it.id;
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

/**
 * Put the next occurrence of a recurring item on the list: the first day of its
 * schedule after the one just closed, and not before today unless each one is owed
 * (or not before `resumeOn`, after a pause). It is the one before, copied: what, who,
 * tags, links, notes and steps (unticked), with the schedule held whole. The dates
 * passed over on the way are named in its history, so a skipped week is never silent.
 */
function spawnNext(doc: LedgerDoc, it: Item, now: Date, resumeOn?: Day): { doc: LedgerDoc; spawned?: Item } {
  const rule = ruleOf(it);
  if (!rule) return { doc };
  // An occurrence reopened after the next one went on the list has a next already.
  const series = it.seriesId ?? it.id;
  if (doc.items.some((x) => x.id !== it.id && x.status === 'open' && x.recur && (x.seriesId ?? x.id) === series)) return { doc };
  const today = toDay(now);
  const cal = calendarOf(doc.settings);
  const after = it.due ?? today;
  const notBefore = resumeOn && resumeOn > today ? resumeOn : rule.catchUp ? undefined : today;
  const due = nextOccurrence(rule, after, cal, notBefore);
  if (!due) return { doc };
  const passed = notBefore ? occurrencesAfter(rule, after, addDays(due, -1), cal) : [];
  const words = (d: Day) => fmtDay(d, doc.settings.dateOrder, today);
  const made = addItem(
    doc,
    {
      title: it.title,
      direction: it.direction,
      personId: it.personId,
      tags: it.tags,
      due,
      recur: rule,
      seriesId: it.seriesId ?? it.id,
      source: it.source,
      links: it.links,
      notes: it.notes,
      steps: it.steps?.map((s) => ({ ...s, done: false })),
      createdNote: `Recurs: next after #${it.num}${passed.length ? `. Passed over: ${passed.length > 3 ? `${passed.length} dates from ${words(passed[0])}` : passed.map(words).join(', ')}` : ''}`,
    },
    now,
  );
  return { doc: made.doc, spawned: made.item };
}

/**
 * Close an item as done. For a waiting item that is "received". A recurring item puts
 * its next occurrence on the list, linked by its series and a line in its history.
 */
export function complete(doc: LedgerDoc, id: string, note: string | undefined, now: Date): { doc: LedgerDoc; spawned?: Item } {
  const today = toDay(now);
  const it = doc.items.find((i) => i.id === id);
  if (!it) throw new Error(`No item ${id}`);
  const kind = it.direction === 'wait' ? 'received' : 'done';
  const out = replaceItem(doc, id, (x) => ({
    ...x,
    status: 'done',
    closedOn: today,
    closeNote: note?.trim() || undefined,
    snoozeUntil: undefined,
    nextChase: undefined,
    updatedAt: stamp(now),
    history: [...x.history, ev(now, kind, note?.trim() || undefined)],
  }));
  return it.recur && it.status === 'open' ? spawnNext(out, it, now) : { doc: out };
}

/**
 * Pass over one occurrence of a recurring item: it is closed as skipped, which is
 * neither done nor late, and the next one goes on the list. With `resumeOn`, every
 * occurrence before that day is passed over too: a pause.
 */
export function skip(doc: LedgerDoc, id: string, now: Date, resumeOn?: Day): { doc: LedgerDoc; spawned?: Item } {
  const it = doc.items.find((i) => i.id === id);
  if (!it) throw new Error(`No item ${id}`);
  if (!it.recur || it.status !== 'open') throw new Error('Only a recurring item still on the list can be skipped.');
  const today = toDay(now);
  const why = resumeOn && resumeOn > today ? `Paused until ${fmtDay(resumeOn, doc.settings.dateOrder, today)}` : undefined;
  const out = replaceItem(doc, id, (x) => ({
    ...x,
    status: 'dropped',
    closedOn: today,
    closeNote: why ?? 'Skipped',
    snoozeUntil: undefined,
    nextChase: undefined,
    updatedAt: stamp(now),
    history: [...x.history, ev(now, 'skipped', why)],
  }));
  return spawnNext(out, it, now, resumeOn);
}

/**
 * Start a series again whose last occurrence has been closed: a new occurrence on the
 * first day of `recur` from `start`, in the same series.
 */
export function restartSeries(doc: LedgerDoc, lastId: string, recur: Recurrence, start: Day, now: Date): { doc: LedgerDoc; item: Item } {
  const last = doc.items.find((i) => i.id === lastId);
  if (!last) throw new Error(`No item ${lastId}`);
  const rule = fullRule({ ...recur, from: undefined }, start);
  const due = firstOccurrence(rule, start, calendarOf(doc.settings));
  if (!due) throw new Error('That schedule has no dates left. Change when it ends.');
  return addItem(
    doc,
    {
      title: last.title,
      direction: last.direction,
      personId: last.personId,
      tags: last.tags,
      due,
      recur: rule,
      seriesId: last.seriesId ?? last.id,
      source: last.source,
      links: last.links,
      notes: last.notes,
      steps: last.steps?.map((s) => ({ ...s, done: false })),
      createdNote: `Started again after #${last.num}`,
    },
    now,
  );
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

// ── Steps ───────────────────────────────────────────────────────────────────

function withSteps(it: Item, steps: Step[], now: Date, event?: HistoryEvent): Item {
  return { ...it, steps: steps.length ? steps : undefined, updatedAt: stamp(now), ...(event ? { history: [...it.history, event] } : {}) };
}

/** Add a step to an item's checklist. Writing the list is wording, not history. */
export function addStep(doc: LedgerDoc, id: string, text: string, now: Date): LedgerDoc {
  const t = text.trim();
  if (!t) return doc;
  return replaceItem(doc, id, (it) => withSteps(it, [...(it.steps ?? []), { id: newId('st', now.getTime()), text: t, done: false }], now));
}

/** Tick a step, or untick it. That is progress on the item, so it is in the history. */
export function toggleStep(doc: LedgerDoc, id: string, stepId: string, now: Date): LedgerDoc {
  return replaceItem(doc, id, (it) => {
    const step = it.steps?.find((s) => s.id === stepId);
    if (!step) return it;
    const done = !step.done;
    return withSteps(it, it.steps!.map((s) => (s.id === stepId ? { ...s, done } : s)), now, ev(now, 'step', `${done ? 'Done' : 'Not done after all'}: ${step.text}`));
  });
}

export function renameStep(doc: LedgerDoc, id: string, stepId: string, text: string, now: Date): LedgerDoc {
  const t = text.trim();
  if (!t) return removeStep(doc, id, stepId, now);
  return replaceItem(doc, id, (it) => withSteps(it, (it.steps ?? []).map((s) => (s.id === stepId ? { ...s, text: t } : s)), now));
}

export function removeStep(doc: LedgerDoc, id: string, stepId: string, now: Date): LedgerDoc {
  return replaceItem(doc, id, (it) => withSteps(it, (it.steps ?? []).filter((s) => s.id !== stepId), now));
}

/** Move a step up (-1) or down (1) the list. */
export function moveStep(doc: LedgerDoc, id: string, stepId: string, by: -1 | 1, now: Date): LedgerDoc {
  return replaceItem(doc, id, (it) => {
    const steps = [...(it.steps ?? [])];
    const i = steps.findIndex((s) => s.id === stepId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= steps.length) return it;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return withSteps(it, steps, now);
  });
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
