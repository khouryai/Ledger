/**
 * A model that learns from what the user does, on this device, in milliseconds.
 *
 * Every suggestion kept, unticked or turned round in Capture, and every reply verdict
 * confirmed or corrected, is an example: the sentence, and what the user said it was.
 * The examples are stored in the ledger (they are things the user did); the model is
 * not (it is derived, and rebuilt from the examples whenever the ledger is opened).
 *
 * The model is naive Bayes over words, word pairs and a few cues, with each feature
 * counted once per sentence. It is small enough to explain itself: every decision it
 * makes comes with the phrases that decided it and how often the user went each way.
 *
 * Who owes an action is learned relative to whoever wrote the text, not as I owe /
 * waiting on, because "could you send" means the reader owes it whether the reader is
 * me or them. `writer` is the author doing it; `other` is anyone else (the reader, or
 * someone named in the notes). `direction()` turns that back into owe / wait.
 *
 * Pure: no clock except what is passed in, no I/O, no browser. Tested in Node.
 */
import { newId } from './doc';
import type { Direction, LedgerDoc } from './types';

export type ExampleTask = 'action' | 'reply';
export type ActionLabel = 'none' | 'writer' | 'other';
export type ReplyLabel = 'delivered' | 'partial' | 'stall' | 'unclear';

export type Example = {
  id: string;
  at: string;
  task: ExampleTask;
  /** The sentence or reply, as it was. Kept to 500 characters. */
  text: string;
  /** For actions: whether the text was written by the user. */
  fromMe?: boolean;
  /** What the user said it was. */
  label: string;
  /** What the app had proposed, so the rules and the learning can be compared honestly. */
  proposed?: string;
};

/** The most examples kept of each kind; the oldest go first. */
export const KEEP = 3000;

export const ACTION_LABELS: ActionLabel[] = ['none', 'writer', 'other'];
export const REPLY_LABELS: ReplyLabel[] = ['delivered', 'partial', 'stall', 'unclear'];

export function relative(direction: Direction, fromMe: boolean): Exclude<ActionLabel, 'none'> {
  // Written by me: what I do is mine to deliver (owe). Written by them: what they do,
  // I am waiting on.
  return (direction === 'owe') === fromMe ? 'writer' : 'other';
}

export function direction(label: Exclude<ActionLabel, 'none'>, fromMe: boolean): Direction {
  return (label === 'writer') === fromMe ? 'owe' : 'wait';
}

// ---------------------------------------------------------------- features

const DAYS = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day)?$/;
const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/;
const SOON = /^(eow|eod|cob|eom|asap|tomorrow|today|tonight|tmrw|tmr)$/;

/** Words, with dates, numbers, links and addresses folded so they generalise. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' _url ')
    .replace(/\S+@\S+\.\S+/g, ' _email ')
    .replace(/\b\d{1,4}[/.-]\d{1,2}([/.-]\d{1,4})?\b/g, ' _date ')
    .replace(/\b\d+(st|nd|rd|th)?\b/g, ' _num ')
    .replace(/[^a-z_'\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean)
    .map((w) => (DAYS.test(w) ? '_day' : MONTHS.test(w) && w.length >= 3 && w !== 'may' ? '_month' : SOON.test(w) ? '_soon' : w));
}

/** What the model sees in a sentence: words, word pairs and a few cues. */
export function features(text: string, fromMe?: boolean): string[] {
  const w = words(text);
  const f = new Set<string>();
  for (const x of w) f.add(x);
  for (let i = 0; i + 1 < w.length; i++) f.add(`${w[i]} ${w[i + 1]}`);
  if (w.length) f.add(`^${w[0]}`);
  if (/\?\s*$/.test(text)) f.add('#question');
  if (/^\s*([-*•]|\d+[.)])\s+/.test(text)) f.add('#bullet');
  if (/\b(by|before|until|no later than)\s+(_day|_date|_soon|_month|next|end|the end)/.test(w.join(' '))) f.add('#by-when');
  if (fromMe !== undefined) f.add(fromMe ? '#from-me' : '#from-them');
  f.add(w.length <= 4 ? '#short' : w.length >= 25 ? '#long' : '#medium');
  return [...f];
}

// ------------------------------------------------------------------- model

export type Model = {
  task: ExampleTask;
  labels: string[];
  n: number;
  /** Examples per label. */
  docs: Record<string, number>;
  /** Per label, how many examples had each feature. */
  counts: Record<string, Map<string, number>>;
  /** Per label, the sum of the counts (for smoothing). */
  totals: Record<string, number>;
  vocab: number;
};

function featuresOf(e: Example): string[] {
  return features(e.text, e.task === 'action' ? e.fromMe : undefined);
}

export function train(examples: Example[], task: ExampleTask): Model {
  const labels: string[] = task === 'action' ? ACTION_LABELS : REPLY_LABELS;
  const docs: Record<string, number> = {};
  const counts: Record<string, Map<string, number>> = {};
  const totals: Record<string, number> = {};
  const vocab = new Set<string>();
  for (const l of labels) {
    docs[l] = 0;
    counts[l] = new Map();
    totals[l] = 0;
  }
  let n = 0;
  for (const e of examples) {
    if (e.task !== task || !labels.includes(e.label)) continue;
    n++;
    docs[e.label]++;
    for (const f of featuresOf(e)) {
      counts[e.label].set(f, (counts[e.label].get(f) ?? 0) + 1);
      totals[e.label]++;
      vocab.add(f);
    }
  }
  return { task, labels, n, docs, counts, totals, vocab: vocab.size };
}

/** Probability of each label for a set of features. Features never seen are ignored. */
export function scores(m: Model, feats: string[]): Record<string, number> {
  const known = feats.filter((f) => m.labels.some((l) => m.counts[l].has(f)));
  const logs = m.labels.map((l) => {
    let s = Math.log((m.docs[l] + 1) / (m.n + m.labels.length));
    for (const f of known) s += Math.log(((m.counts[l].get(f) ?? 0) + 1) / (m.totals[l] + m.vocab + 1));
    return s;
  });
  const top = Math.max(...logs);
  const exp = logs.map((x) => Math.exp(x - top));
  const sum = exp.reduce((a, b) => a + b, 0);
  return Object.fromEntries(m.labels.map((l, i) => [l, exp[i] / sum]));
}

/** Enough to go on: a model that has seen too little says nothing at all. */
export function ready(m: Model): boolean {
  if (m.task === 'action') return m.n >= 30 && m.docs.none >= 5 && m.docs.writer + m.docs.other >= 10;
  return m.n >= 20 && m.labels.filter((l) => m.docs[l] >= 3).length >= 2;
}

/** How many more examples it needs, for the Settings screen. */
export function needs(m: Model): number {
  return Math.max(0, (m.task === 'action' ? 30 : 20) - m.n);
}

/** Words too common to explain anything on their own. */
const FILLER = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'is', 'it', 'this', 'that', 'with', 'be', 'as', 'are', 'was', 'for', 'from', 'by', 'i', 'we', 'me', 'my', 'so', 'if', 'but', 'just', 'also', 'have', 'has', 'will']);

function phrase(f: string): string | null {
  if (f.startsWith('#') || f.startsWith('^')) return null;
  const parts = f.split(' ');
  if (parts.every((w) => FILLER.has(w) || w.startsWith('_'))) return null;
  const out = f.replace(/_day/g, '(a day)').replace(/_date/g, '(a date)').replace(/_soon/g, '(eow/asap)').replace(/_num/g, '(a number)').replace(/_month/g, '(a month)').replace(/_url/g, '(a link)').replace(/_email/g, '(an address)');
  return `"${out}"`;
}

type Evidence = { f: string; a: number; b: number };

/**
 * Phrases that speak for `label`: seen with it at least `min` times, and nearly only
 * with it (at least 80% of every example that had the phrase, whatever its label).
 * Two-word phrases first, as they read as the reason; then the most often seen.
 */
function evidence(m: Model, label: string, against: string[], feats: Iterable<string>, min: number): Evidence[] {
  const rows: Evidence[] = [];
  for (const f of feats) {
    const a = m.counts[label].get(f) ?? 0;
    if (a < min || !phrase(f)) continue;
    const all = m.labels.reduce((s, l) => s + (m.counts[l].get(f) ?? 0), 0);
    if (a / all < 0.8) continue;
    rows.push({ f, a, b: against.reduce((s, l) => s + (m.counts[l].get(f) ?? 0), 0) });
  }
  return rows.sort((x, y) => Number(y.f.includes(' ')) - Number(x.f.includes(' ')) || y.a - x.a);
}

/**
 * The phrases that pushed toward `label` over `against`, as words: what the user is
 * shown beside the decision.
 */
export function because(m: Model, feats: string[], label: string, against: string[], said: [string, string]): string | null {
  const rows = evidence(m, label, against, feats, 2).slice(0, 2);
  if (!rows.length) return null;
  return rows.map((r) => `${phrase(r.f)} was ${said[0]} ${r.a} time${r.a === 1 ? '' : 's'} and ${said[1]} ${r.b}`).join('; ');
}

// ---------------------------------------------------------- the decisions

export type ActionJudgement = {
  /** Probability the sentence is an action at all. */
  action: number;
  /** The label the model would pick, and how sure it is. */
  label: ActionLabel;
  p: number;
  /** Untick, turn round, or keep: what the app should do with a suggestion. */
  advice: 'untick' | 'flip' | 'keep';
  reason?: string;
};

/** What the learning says about one suggested sentence, against the direction proposed. */
export function judgeAction(m: Model, quote: string, fromMe: boolean, proposed: Direction): ActionJudgement {
  const feats = features(quote, fromMe);
  const s = scores(m, feats);
  const label = (ACTION_LABELS.slice().sort((a, b) => s[b] - s[a])[0] ?? 'none') as ActionLabel;
  const action = 1 - s.none;
  if (!ready(m)) return { action, label, p: s[label], advice: 'keep' };
  if (s.none >= 0.8) {
    const why = because(m, feats, 'none', ['writer', 'other'], ['unticked', 'kept']);
    return { action, label: 'none', p: s.none, advice: 'untick', reason: `Unticked: sentences like this were not actions for you${why ? ` (${why})` : ''}.` };
  }
  const mine = relative(proposed, fromMe);
  const other = mine === 'writer' ? 'other' : 'writer';
  if (s[other] >= 0.75 && s[other] > s[mine]) {
    const why = because(m, feats, other, [mine], ['the other way', 'as proposed']);
    const to = direction(other, fromMe) === 'owe' ? 'I owe' : 'Waiting on';
    return { action, label: other, p: s[other], advice: 'flip', reason: `Switched to ${to}: you turned sentences like this round before${why ? ` (${why})` : ''}.` };
  }
  return { action, label, p: s[label], advice: 'keep' };
}

export type Missed = { quote: string; index: number; direction: Direction; p: number; reason: string };

/**
 * Sentences the rules passed over that the learning reads as actions: offered as
 * suggestions like any other, marked as found by the learning, with the reason.
 */
export function findMissed(m: Model, candidates: { text: string; index: number }[], fromMe: boolean, already: string[], threshold = 0.85): Missed[] {
  if (!ready(m)) return [];
  const seen = new Set(already.map((q) => q.trim().toLowerCase()));
  const out: Missed[] = [];
  for (const c of candidates) {
    if (seen.has(c.text.trim().toLowerCase()) || words(c.text).length < 3) continue;
    const feats = features(c.text, fromMe);
    const s = scores(m, feats);
    if (1 - s.none < threshold) continue;
    const label: Exclude<ActionLabel, 'none'> = s.writer >= s.other ? 'writer' : 'other';
    const why = because(m, feats, label, ['none'], ['kept', 'unticked']);
    if (!why) continue;
    out.push({ quote: c.text, index: c.index, direction: direction(label, fromMe), p: 1 - s.none, reason: `Found by what it learned from you, not by the rules: ${why}.` });
  }
  return out;
}

export type ReplyJudgement = { verdict: ReplyLabel; p: number; reason: string } | null;

/** A verdict on a reply that overrides the rules' (or the model's) when the learning is sure. */
export function judgeReply(m: Model, reply: string, current: ReplyLabel): ReplyJudgement {
  if (!ready(m)) return null;
  const feats = features(reply);
  const s = scores(m, feats);
  const best = REPLY_LABELS.slice().sort((a, b) => s[b] - s[a])[0];
  if (best === current || s[best] < 0.75) return null;
  const word: Record<ReplyLabel, string> = { delivered: 'delivered', partial: 'part delivered', stall: 'not delivered', unclear: 'unclear' };
  const why = because(m, feats, best, REPLY_LABELS.filter((l) => l !== best), [`in replies you called ${word[best]}`, 'in the others']);
  return { verdict: best, p: s[best], reason: `Read as ${word[best]} from your earlier verdicts${why ? `: ${why}` : ''}.` };
}

// ---------------------------------------------------------- how good it is

export type Accuracy = { n: number; learned: number; proposed: number | null };

/**
 * Five-fold cross-validation over the most recent examples: each is predicted by a
 * model trained without it. `proposed` is how often what the app proposed (rules or
 * the model) was right on the same examples, where that was recorded.
 */
export function accuracy(examples: Example[], task: ExampleTask, limit = 1000): Accuracy | null {
  const xs = examples.filter((e) => e.task === task).slice(-limit);
  if (xs.length < 20) return null;
  let right = 0;
  let base = 0;
  let baseN = 0;
  for (let k = 0; k < 5; k++) {
    const m = train(
      xs.filter((_, i) => i % 5 !== k),
      task,
    );
    xs.forEach((e, i) => {
      if (i % 5 !== k) return;
      const s = scores(m, featuresOf(e));
      const best = m.labels.slice().sort((a, b) => s[b] - s[a])[0];
      if (best === e.label) right++;
      if (e.proposed !== undefined) {
        baseN++;
        if (e.proposed === e.label) base++;
      }
    });
  }
  return { n: xs.length, learned: right / xs.length, proposed: baseN ? base / baseN : null };
}

/** The phrases that most mean `label` to this user, for the Settings screen. */
export function signature(m: Model, label: string, against: string[], count = 6): string[] {
  if (!m.n) return [];
  return evidence(m, label, against, m.counts[label].keys(), 3)
    .slice(0, count)
    .map((r) => phrase(r.f)!);
}

// ------------------------------------------------------------------ ops

export type ExampleDraft = Omit<Example, 'id' | 'at'>;

/** Add examples, newest kept, so the ledger never grows without bound. */
export function learn(doc: LedgerDoc, add: ExampleDraft[], now: Date): LedgerDoc {
  const fresh = add
    .filter((e) => e.text.trim())
    .map((e) => ({ ...e, text: e.text.trim().slice(0, 500), id: newId('ex', now.getTime()), at: now.toISOString() }));
  if (!fresh.length) return doc;
  const all = [...doc.examples, ...fresh];
  const keep = new Set<string>();
  for (const task of ['action', 'reply'] as const) for (const e of all.filter((x) => x.task === task).slice(-KEEP)) keep.add(e.id);
  return { ...doc, examples: all.filter((e) => keep.has(e.id)) };
}

/** Forget everything learned, of one kind or both. */
export function forget(doc: LedgerDoc, task?: ExampleTask): LedgerDoc {
  return { ...doc, examples: task ? doc.examples.filter((e) => e.task !== task) : [] };
}
