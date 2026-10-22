/**
 * The document as a whole: a fresh one, reading one off disk, and ids.
 */
import { isDay } from './dates';
import type { Example } from './learn';
import { defaultSettings, DEFAULT_TEMPLATES, SCHEMA_VERSION, type Item, type LedgerDoc, type Meeting, type Person, type Settings } from './types';

let counter = 0;

/** Short, sortable, unique enough for one person's ledger. */
export function newId(prefix: string, now = Date.now()): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${now.toString(36)}${counter.toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyDoc(now = new Date()): LedgerDoc {
  return {
    schema: SCHEMA_VERSION,
    settings: defaultSettings(),
    people: [],
    items: [],
    meetings: [],
    dismissed: [],
    examples: [],
    nextNum: 1,
    createdAt: now.toISOString(),
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function day(v: unknown): string | undefined {
  return isDay(v) ? v : undefined;
}

/** Settings as stored, completed from the defaults so an older file gains new options. */
export function readSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const r = raw as Partial<Settings>;
  const templates = { ...DEFAULT_TEMPLATES } as Settings['templates'];
  if (isObj(r.templates)) {
    for (const k of Object.keys(templates) as (keyof Settings['templates'])[]) {
      const t = (r.templates as Record<string, unknown>)[k];
      if (isObj(t) && typeof t.subject === 'string' && typeof t.body === 'string') templates[k] = { subject: t.subject, body: t.body };
    }
  }
  return {
    ...d,
    myName: str(r.myName) ?? d.myName,
    myEmail: str(r.myEmail) ?? d.myEmail,
    workDays: Array.isArray(r.workDays) && r.workDays.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) ? [...r.workDays] : d.workDays,
    holidays: Array.isArray(r.holidays) ? r.holidays.filter(isDay).sort() : d.holidays,
    dateOrder: r.dateOrder === 'DMY' || r.dateOrder === 'YMD' || r.dateOrder === 'MDY' ? r.dateOrder : d.dateOrder,
    chase: { ...d.chase, ...(isObj(r.chase) ? r.chase : {}) },
    ageing: { ...d.ageing, ...(isObj(r.ageing) ? r.ageing : {}) },
    riskBuffer: typeof r.riskBuffer === 'number' ? r.riskBuffer : d.riskBuffer,
    learnAfter: typeof r.learnAfter === 'number' ? r.learnAfter : d.learnAfter,
    review: { ...d.review, ...(isObj(r.review) ? r.review : {}) },
    templates,
    ai: { ...d.ai, ...(isObj(r.ai) ? r.ai : {}) },
    outlook: { ...d.outlook, ...(isObj(r.outlook) ? r.outlook : {}) },
  };
}

function readItem(raw: unknown, problems: string[]): Item | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string') {
    problems.push('An item with no id or title was skipped.');
    return null;
  }
  const r = raw as Partial<Item>;
  const created = str(r.createdAt) ?? new Date(0).toISOString();
  return {
    id: r.id!,
    num: typeof r.num === 'number' ? r.num : 0,
    title: r.title!,
    direction: r.direction === 'owe' ? 'owe' : 'wait',
    personId: str(r.personId),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    askedOn: day(r.askedOn) ?? created.slice(0, 10),
    due: day(r.due),
    nextChase: day(r.nextChase),
    snoozeUntil: day(r.snoozeUntil),
    status: r.status === 'done' || r.status === 'dropped' ? r.status : 'open',
    closedOn: day(r.closedOn),
    closeNote: str(r.closeNote),
    source: isObj(r.source) ? (r.source as Item['source']) : undefined,
    links: Array.isArray(r.links) ? r.links.filter((t): t is string => typeof t === 'string') : [],
    blockedBy: Array.isArray(r.blockedBy) ? r.blockedBy.filter((t): t is string => typeof t === 'string') : [],
    recur: isObj(r.recur) ? (r.recur as Item['recur']) : undefined,
    notes: str(r.notes),
    history: Array.isArray(r.history) ? r.history.filter((h) => isObj(h) && typeof h.at === 'string' && typeof h.kind === 'string') : [],
    createdAt: created,
    updatedAt: str(r.updatedAt) ?? created,
  };
}

function isExample(v: unknown): v is Example {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.at === 'string' &&
    (v.task === 'action' || v.task === 'reply') &&
    typeof v.text === 'string' &&
    typeof v.label === 'string' &&
    (v.fromMe === undefined || typeof v.fromMe === 'boolean') &&
    (v.proposed === undefined || typeof v.proposed === 'string')
  );
}

/**
 * Read a document off disk. Unknown fields are dropped, missing ones filled, and
 * anything unreadable reported rather than silently lost.
 */
export function readDoc(raw: unknown): { doc: LedgerDoc; problems: string[] } {
  const problems: string[] = [];
  const base = emptyDoc();
  if (!isObj(raw)) return { doc: base, problems: ['The ledger file did not hold a ledger.'] };
  const schema = typeof raw.schema === 'number' ? raw.schema : 1;
  if (schema > SCHEMA_VERSION) problems.push(`This ledger was saved by a newer version of Ledger (schema ${schema}). Update the app before editing it.`);
  const items = (Array.isArray(raw.items) ? raw.items : []).map((i) => readItem(i, problems)).filter((i): i is Item => i !== null);
  const people = (Array.isArray(raw.people) ? raw.people : []).filter((p): p is Person => isObj(p) && typeof p.id === 'string' && typeof p.name === 'string');
  const meetings = (Array.isArray(raw.meetings) ? raw.meetings : [])
    .filter((m): m is Meeting => isObj(m) && typeof m.id === 'string' && typeof m.name === 'string')
    .map((m) => ({ ...m, attendees: Array.isArray(m.attendees) ? m.attendees : [], sessions: Array.isArray(m.sessions) ? m.sessions : [], recurring: !!m.recurring }));
  const maxNum = items.reduce((n, i) => Math.max(n, i.num), 0);
  // Number any item that arrived without one, in the order it was created.
  let next = Math.max(typeof raw.nextNum === 'number' ? raw.nextNum : 1, maxNum + 1);
  for (const it of [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) if (!it.num) it.num = next++;
  return {
    doc: {
      schema: SCHEMA_VERSION,
      settings: readSettings(raw.settings),
      people,
      items,
      meetings,
      dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.filter((d): d is string => typeof d === 'string') : [],
      examples: Array.isArray(raw.examples) ? raw.examples.filter(isExample) : [],
      nextNum: next,
      createdAt: str(raw.createdAt) ?? base.createdAt,
    },
    problems,
  };
}

export function personById(doc: LedgerDoc, id: string | undefined): Person | undefined {
  return id ? doc.people.find((p) => p.id === id) : undefined;
}

export function itemById(doc: LedgerDoc, id: string | undefined): Item | undefined {
  return id ? doc.items.find((i) => i.id === id) : undefined;
}
