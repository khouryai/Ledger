/**
 * What the on-device model is asked to do, and how its answers are checked.
 *
 * The model is used for language only: reading what an email asks for, writing a
 * chaser in the right tone, judging whether a reply delivers. Every fact it returns
 * is re-derived or verified here before anybody sees it:
 *
 *   - dates: the model returns the phrase ("next Tuesday"); the date is worked out by
 *     the same parser the quick-add line uses, never taken from the model;
 *   - people: the name it returns is matched exactly against the people list, and an
 *     unknown name is offered as a new person, never mapped to the nearest one;
 *   - quotes: the sentence it says an action came from is looked for in the text, and
 *     a quote that is not there is flagged as the model's own wording.
 *
 * Nothing it says is written to the ledger until the user accepts it.
 */
import { findDate, fmtDayLong, type Calendar } from '../engine/dates';
import { findAsks, type Ask } from '../engine/asks';
import { matchPerson, firstName } from '../engine/people';
import { checkReplyRules, type ReplyCheck, type ReplyVerdict } from '../engine/reply';
import { chases, lastChase } from '../engine/stats';
import type { ChaseLevel, DateOrder, Day, Direction, Item, Person } from '../engine/types';
import { parseJsonAnswer, type AiEngine } from './engine';

export type TaskContext = {
  today: Day;
  cal: Calendar;
  order: DateOrder;
  people: Person[];
  myName: string;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function todayLine(ctx: TaskContext): string {
  const wd = WEEKDAYS[new Date(`${ctx.today}T12:00:00`).getDay()];
  return `Today is ${wd} ${fmtDayLong(ctx.today)}.`;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Long text is read in pieces small enough for the model's 4,096-token window. */
export function chunks(text: string, size = 4500): string[] {
  const paras = text.split(/\n{2,}/);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > size && cur) {
      out.push(cur);
      cur = '';
    }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
      continue;
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ── Finding actions ─────────────────────────────────────────────────────────

export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['owe', 'wait'] },
          person: { type: 'string' },
          title: { type: 'string' },
          when: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['direction', 'person', 'title', 'when', 'quote'],
      },
    },
  },
  required: ['actions'],
};

export function extractPrompt(ctx: TaskContext, who: { fromMe: boolean; sender?: string; recipient?: string }): string {
  const me = ctx.myName || 'the reader';
  return [
    `You read workplace emails and meeting notes and list the actions in them. ${todayLine(ctx)} The reader is ${me}.`,
    who.fromMe ? `This text was written by ${me}${who.recipient ? ` to ${who.recipient}` : ''}.` : `This text was written by ${who.sender ?? 'someone else'} to ${me}.`,
    'An action is something someone asked for, promised, or was given to do. For each action give:',
    `- direction: "owe" if ${me} has to do it, "wait" if someone else has to do it for ${me}.`,
    '- person: the other person\'s name exactly as written, or "" if nobody is named.',
    '- title: a short instruction under 12 words, with no dates, names or greetings.',
    '- when: the deadline words exactly as written (for example "by Friday" or "next Tuesday"), or "".',
    '- quote: the sentence the action came from, copied exactly.',
    'Only list real, outstanding actions. Ignore greetings, thanks, signatures and anything already done. If there are none, return an empty list.',
  ].join('\n');
}

type RawAction = { direction?: string; person?: string; title?: string; when?: string; quote?: string };

/** Turn the model's answer into suggestions, checking every fact in it. */
export function checkActions(raw: RawAction[], text: string, ctx: TaskContext, fallbackPerson?: string): Ask[] {
  const out: Ask[] = [];
  const seen = new Set<string>();
  const hay = norm(text);
  for (const a of raw) {
    const title = (a.title ?? '').trim().replace(/[.?!]+$/, '');
    if (title.length < 3) continue;
    const key = norm(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const direction: Direction = a.direction === 'owe' ? 'owe' : 'wait';
    const when = (a.when ?? '').trim();
    const d = when ? findDate(when, ctx.today, ctx.cal, ctx.order) : null;
    const personName = (a.person ?? '').trim() || fallbackPerson;
    const meName = norm(ctx.myName);
    const isMe = personName && meName && (norm(personName) === meName || norm(personName) === meName.split(' ')[0]);
    const quote = (a.quote ?? '').trim();
    const quoteFound = !!quote && hay.includes(norm(quote));
    out.push({
      kind: 'ai',
      quote: quote || title,
      index: quoteFound ? text.toLowerCase().indexOf(quote.toLowerCase().slice(0, 20)) : -1,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      direction,
      personName: isMe ? undefined : personName,
      match: personName && !isMe ? matchPerson(ctx.people, { name: personName }) : undefined,
      due: d?.day,
      duePhrase: d ? when : undefined,
      quoteFound,
    });
  }
  return out;
}

export async function extractActions(
  engine: AiEngine,
  text: string,
  ctx: TaskContext,
  who: { fromMe: boolean; sender?: string; recipient?: string },
  onProgress?: (done: number, total: number) => void,
): Promise<Ask[]> {
  const parts = chunks(text);
  const all: Ask[] = [];
  for (let i = 0; i < parts.length; i++) {
    onProgress?.(i, parts.length);
    const answer = await engine.complete({
      system: extractPrompt(ctx, who),
      user: `---\n${parts[i]}\n---`,
      schema: EXTRACT_SCHEMA,
      maxTokens: 900,
      temperature: 0.1,
    });
    const parsed = parseJsonAnswer<{ actions?: RawAction[] }>(answer);
    all.push(...checkActions(parsed.actions ?? [], parts[i], ctx, who.fromMe ? who.recipient : who.sender));
  }
  onProgress?.(parts.length, parts.length);
  const seen = new Set<string>();
  return all.filter((a) => {
    const k = norm(a.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Writing a chaser ────────────────────────────────────────────────────────

export function chaserPrompt(myName: string): string {
  return [
    `You write short follow-up emails for ${myName || 'the sender'}, who manages testing and commissioning on a rail signalling project.`,
    'Write the body only: no subject line. Plain text, under 120 words, professional and human.',
    'Tone: "nudge" is a friendly check-in; "firm" is clear and direct and asks for a date; "escalate" is calm, states the history and mentions who is copied.',
    'Use only the facts given. Never invent dates, commitments, attachments or reasons.',
    `Start with "Hi" and the first name. End with "Thanks," and ${myName || 'the sender'} on the next line.`,
  ].join('\n');
}

export function chaserFacts(items: Item[], person: Person | undefined, level: ChaseLevel, ctx: TaskContext): string {
  const lines = [`To: ${person ? `${firstName(person)} (${person.name}${person.company ? `, ${person.company}` : ''})` : 'them'}`, `Tone: ${level}`];
  if (level === 'escalate' && person?.escalateTo) lines.push(`Copied: ${person.escalateTo.name}`);
  lines.push('Items:');
  for (const it of items) {
    const bits = [`asked ${fmtDayLong(it.askedOn)}`];
    if (it.due) bits.push(`${it.due < ctx.today ? 'promised' : 'due'} ${fmtDayLong(it.due)}`);
    const n = chases(it).length;
    if (n) bits.push(`chased ${n} time${n === 1 ? '' : 's'}, last ${fmtDayLong(lastChase(it))}`);
    lines.push(`- ${it.title} (${bits.join('; ')})`);
    const notes = it.history.filter((h) => (h.kind === 'note' || h.kind === 'promise') && h.text).slice(-2);
    for (const nte of notes) lines.push(`  note: ${nte.text}`);
  }
  return lines.join('\n');
}

export async function writeChaser(engine: AiEngine, items: Item[], person: Person | undefined, level: ChaseLevel, ctx: TaskContext): Promise<string> {
  const text = await engine.complete({ system: chaserPrompt(ctx.myName), user: chaserFacts(items, person, level, ctx), maxTokens: 400, temperature: 0.4 });
  const body = text
    .replace(/^\s*subject:.*$/im, '')
    .replace(/^```[a-z]*\s*|```\s*$/g, '')
    .trim();
  if (body.length < 20) throw new Error('The model returned an empty draft.');
  return body;
}

// ── Checking a reply ────────────────────────────────────────────────────────

export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['delivered', 'partial', 'stall', 'unclear'] },
    when: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['verdict', 'when', 'summary'],
};

export async function checkReply(engine: AiEngine, item: Item, reply: string, ctx: TaskContext): Promise<ReplyCheck> {
  const answer = await engine.complete({
    system: [
      `You judge whether a reply delivers what was asked for. ${todayLine(ctx)}`,
      'verdict: "delivered" if they sent it or confirmed it is done; "partial" if only some of it; "stall" if it is not delivered (a holding reply, an excuse or a new date); "unclear" if you cannot tell.',
      'when: any new date they gave, in their exact words, or "".',
      'summary: one short sentence.',
    ].join('\n'),
    user: `What was asked: ${item.title}\n\nTheir reply:\n---\n${reply.slice(0, 6000)}\n---`,
    schema: REPLY_SCHEMA,
    maxTokens: 200,
    temperature: 0.1,
  });
  const r = parseJsonAnswer<{ verdict?: string; when?: string; summary?: string }>(answer);
  const verdict: ReplyVerdict = ['delivered', 'partial', 'stall', 'unclear'].includes(r.verdict ?? '') ? (r.verdict as ReplyVerdict) : 'unclear';
  const when = (r.when ?? '').trim();
  const d = when ? findDate(when, ctx.today, ctx.cal, ctx.order) : null;
  // The date has to be in the reply, not only in the model's answer.
  const inReply = d && reply.toLowerCase().includes(when.toLowerCase());
  return {
    verdict,
    promise: inReply && d!.day >= ctx.today ? d!.day : undefined,
    promisePhrase: inReply ? when : undefined,
    summary: (r.summary ?? '').trim() || 'No summary given.',
    by: 'ai',
  };
}

export { checkReplyRules };

// ── Briefs ──────────────────────────────────────────────────────────────────

export async function writeBrief(engine: AiEngine, kind: 'week' | 'person', facts: string, myName: string): Promise<string> {
  const system =
    kind === 'week'
      ? `Write a short weekly status paragraph (three to five sentences) for ${myName || 'the reader'} from the facts given. Plain text, no lists, no headings. Use only the facts given; never invent numbers, names or dates.`
      : `Write a short paragraph for ${myName || 'the reader'} to read before a call with this person: what they owe, what is owed to them, oldest and most overdue first. Plain text. Use only the facts given.`;
  const text = await engine.complete({ system, user: facts.slice(0, 7000), maxTokens: 350, temperature: 0.3 });
  return text.trim();
}

/** For the tests and the fallback engine: the rule finder's answer in the model's shape. */
export function asksAsModelJson(text: string, ctx: TaskContext, fromMe: boolean, other?: string): string {
  const asks = findAsks(text, { ...ctx, fromMe, sender: !fromMe && other ? { name: other } : undefined, recipient: fromMe && other ? { name: other } : undefined });
  return JSON.stringify({ actions: asks.map((a) => ({ direction: a.direction, person: a.personName ?? '', title: a.title, when: a.duePhrase ?? '', quote: a.quote })) });
}
