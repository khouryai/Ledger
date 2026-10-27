/**
 * The ledger's data model.
 *
 * One document, saved as `ledger.json` in the folder the user picked. Everything a
 * person types is here; everything that can be worked out from it (how long an item
 * has waited, when to chase next, what is at risk) is computed on every render and
 * never stored. A stored derived value goes stale the moment the calendar turns over,
 * and nobody notices until it is wrong in front of them.
 */
import type { Example } from './learn';

/** A calendar day, `YYYY-MM-DD`, in the user's local time. */
export type Day = string;

/** I owe someone something, or I am waiting on someone for something. */
export type Direction = 'owe' | 'wait';

export type ItemStatus = 'open' | 'done' | 'dropped';

export type SourceKind = 'meeting' | 'email' | 'call' | 'conversation' | 'self' | 'outlook';

export type Source = {
  kind: SourceKind;
  /** A meeting name, an email subject, who rang. Free text. */
  ref?: string;
  /** The day it came up, when that is not the day it was logged. */
  date?: Day;
  meetingId?: string;
  sessionId?: string;
  /** Outlook's id for the message it came from, so it is never suggested twice. */
  messageId?: string;
};

/**
 * A schedule: what engine/recur.ts reads to put the next occurrence on the list. A
 * part left out is taken from the due date it was set from, so an old file's
 * `{ every: 1, unit: 'week' }` still means "every week, on the day it was due".
 */
export type Recurrence = {
  every: number;
  /** `day` counts working days. */
  unit: 'day' | 'week' | 'month';
  /** For `week`: the weekdays it falls on, 0 = Sunday … 6 = Saturday. For `month` with `nth`: the weekday. */
  days?: number[];
  /** For `month`: the day of the month, 1 to 31 (the month's last in a shorter one), or -1 for the last working day. */
  monthDay?: number;
  /** For `month`, instead of a day: the first to fourth (1 to 4) or the last (-1) of `days` in the month. */
  nth?: number;
  /** The day the schedule counts from: it settles which weeks "every other week" falls in. */
  from?: Day;
  /** Nothing is due after this day. */
  until?: Day;
  /** Each occurrence is owed even when one is late. Absent: the next one is the first due from the day it is closed. */
  catchUp?: boolean;
};

/** One step of a checklist on an item. A recurring item's steps come back unticked. */
export type Step = { id: string; text: string; done: boolean };

export type ChaseLevel = 'nudge' | 'firm' | 'escalate';

export type HistoryKind =
  | 'created'
  | 'edited'
  | 'chased'
  | 'promise'
  | 'note'
  | 'snoozed'
  | 'reviewed'
  | 'received'
  | 'done'
  | 'dropped'
  | 'reopened'
  | 'linked'
  | 'unlinked'
  | 'skipped'
  | 'step';

/** Who made a change: you, or a rule or the model you accepted a suggestion from. */
export type Actor = 'you' | 'rule' | 'ai' | 'outlook' | 'learned';

/**
 * One line in an item's history. Appended, never edited or removed: the history is
 * what the person statistics are counted from, and a history that can be rewritten
 * makes every figure built on it unfalsifiable.
 */
export type HistoryEvent = {
  at: string;
  kind: HistoryKind;
  text?: string;
  by?: Actor;
  /** For `chased`: which template was used. */
  level?: ChaseLevel;
  /** The due date this event set, when it set one: on creation, an edit or a promise. */
  due?: Day;
};

export type Item = {
  id: string;
  /** A short number for saying "item 42" out loud and in an action log. */
  num: number;
  title: string;
  direction: Direction;
  personId?: string;
  tags: string[];
  /** When the request was made. The wait is counted from here. */
  askedOn: Day;
  /** For `owe`, my deadline. For `wait`, the date they promised. */
  due?: Day;
  /** A chase date the user set by hand. Absent means "work it out". */
  nextChase?: Day;
  /** Hidden from every working list until this day. */
  snoozeUntil?: Day;
  status: ItemStatus;
  closedOn?: Day;
  closeNote?: string;
  source?: Source;
  links: string[];
  /** Waiting-on items this one cannot finish without. */
  blockedBy: string[];
  recur?: Recurrence;
  /** The recurring series this occurrence belongs to: the id of its first occurrence. */
  seriesId?: string;
  /** A checklist. Absent when it has none. */
  steps?: Step[];
  notes?: string;
  history: HistoryEvent[];
  createdAt: string;
  updatedAt: string;
};

export type Person = {
  id: string;
  name: string;
  email?: string;
  company?: string;
  role?: string;
  /** Who to copy when a chase is escalated. */
  escalateTo?: { name: string; email?: string };
  /** Chase every N working days, overriding both the default and what was learned. */
  chaseEvery?: number;
  notes?: string;
  createdAt: string;
};

export type MeetingSession = {
  id: string;
  date: Day;
  notes?: string;
};

export type Meeting = {
  id: string;
  name: string;
  attendees: string[];
  recurring: boolean;
  sessions: MeetingSession[];
  createdAt: string;
};

export type DateOrder = 'MDY' | 'DMY' | 'YMD';

export type Template = { subject: string; body: string };

export type AiMode = 'off' | 'local';

export type Settings = {
  /** Used to sign chasers and to tell which emails in a pasted thread are yours. */
  myName: string;
  myEmail: string;
  /** 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  holidays: Day[];
  dateOrder: DateOrder;
  chase: {
    /** Default rhythm, in working days, before anything has been learned. */
    every: number;
    /** Chases with no movement before escalating is suggested. */
    escalateAfter: number;
  };
  ageing: {
    /** Working days since last touch at which a waiting item turns amber, then red. */
    amber: number;
    red: number;
  };
  /** Working days of slack wanted between a blocker arriving and my own deadline. */
  riskBuffer: number;
  /** Closed items with a person before their own pattern replaces the defaults. */
  learnAfter: number;
  review: {
    /** Working days untouched before an item is due a look in the weekly review. */
    staleAfter: number;
    /** Working days with no movement and repeated chases before an item looks dead. */
    deadAfter: number;
    /** Day of the week the review is prompted. 5 = Friday. */
    weekday: number;
    lastDone?: Day;
  };
  templates: Record<ChaseLevel | 'batch', Template>;
  ai: {
    mode: AiMode;
    model: string;
  };
  outlook: {
    enabled: boolean;
    clientId: string;
    tenantId: string;
    /** How far back sent mail is read, in days. */
    lookback: number;
    /** Working days without a reply before a sent ask is suggested. */
    noReplyAfter: number;
  };
};

export type LedgerDoc = {
  schema: number;
  settings: Settings;
  people: Person[];
  items: Item[];
  meetings: Meeting[];
  /** Outlook messages the user said were not worth tracking. */
  dismissed: string[];
  /** What the user decided about suggestions and replies: what engine/learn.ts learns from. */
  examples: Example[];
  nextNum: number;
  createdAt: string;
};

export const SCHEMA_VERSION = 1;

export const DEFAULT_TEMPLATES: Settings['templates'] = {
  nudge: {
    subject: '{subject}',
    body: [
      'Hi {first},',
      '',
      'Just checking in on {title}, which I asked about on {asked}.',
      'You mentioned you would have it by {promised}.',
      'Could you let me know where it stands?',
      '',
      'Thanks,',
      '{me}',
    ].join('\n'),
  },
  firm: {
    subject: '{subject}',
    body: [
      'Hi {first},',
      '',
      'Following up again on {title}. I first asked on {asked}, {waited} ago.',
      'It was due {promised}.',
      'I need this to keep things moving on my side. Can you send it, or give me a date I can rely on?',
      '',
      'Thanks,',
      '{me}',
    ].join('\n'),
  },
  escalate: {
    subject: '{subject}',
    body: [
      'Hi {first},',
      '',
      'I have followed up on {title} a few times since {asked} without getting it closed out.',
      'It was due {promised}.',
      'I have copied {escalateTo} so we can agree how to get this done.',
      'Could you reply with a firm date?',
      '',
      'Thanks,',
      '{me}',
    ].join('\n'),
  },
  batch: {
    subject: 'Open items: {count} waiting',
    body: [
      'Hi {first},',
      '',
      'A quick round-up of the things I am waiting on from you:',
      '',
      '{list}',
      '',
      'Could you let me know where each one stands?',
      '',
      'Thanks,',
      '{me}',
    ].join('\n'),
  },
};

export const DEFAULT_MODEL = 'Phi-4-mini-instruct-q4f16_1-MLC';

export function defaultSettings(): Settings {
  return {
    myName: '',
    myEmail: '',
    workDays: [1, 2, 3, 4, 5],
    holidays: [],
    dateOrder: 'MDY',
    chase: { every: 5, escalateAfter: 2 },
    ageing: { amber: 3, red: 7 },
    riskBuffer: 1,
    learnAfter: 5,
    review: { staleAfter: 7, deadAfter: 15, weekday: 5 },
    templates: structuredClone(DEFAULT_TEMPLATES),
    ai: { mode: 'off', model: DEFAULT_MODEL },
    outlook: { enabled: false, clientId: '', tenantId: 'organizations', lookback: 14, noReplyAfter: 3 },
  };
}
