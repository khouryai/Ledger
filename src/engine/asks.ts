/**
 * Finding the actions in an email or a page of meeting notes, by rule.
 *
 * Three shapes are recognised:
 *   a request    "Could you send the ATS report by Friday?"
 *   a promise    "I'll get the revised procedure over next week."
 *   an action    "Sam to confirm possession times"  /  "Action: Priya - update ICD"
 *
 * Who owes whom follows from who wrote it. A request in an email from somebody else
 * is something I owe them; a promise from them is something I am waiting on. In an
 * email from me it is the other way round. A named action line says its own owner.
 *
 * This is the fallback that needs no model, and every suggestion it makes is shown
 * with the sentence it came from and has to be accepted by hand.
 */
import { findDate, type Calendar } from './dates';
import { matchPerson, type PersonMatch } from './people';
import { tidyTitle } from './quickadd';
import type { DateOrder, Day, Direction, Person } from './types';

/** `ai` marks an action the on-device model found rather than a rule. */
export type AskKind = 'request' | 'promise' | 'action' | 'ai';

export type Ask = {
  kind: AskKind;
  /** The sentence exactly as it appears in the text. */
  quote: string;
  index: number;
  title: string;
  direction: Direction;
  /** The other party, by name as written, when the text names them. */
  personName?: string;
  match?: PersonMatch;
  due?: Day;
  duePhrase?: string;
  /** False when the quoted sentence could not be found in the text: the model paraphrased. */
  quoteFound?: boolean;
};

export type AskContext = {
  today: Day;
  cal: Calendar;
  order: DateOrder;
  people: Person[];
  /** The message was written by me. */
  fromMe: boolean;
  /** Who wrote it, when it was not me. */
  sender?: { name: string; email?: string };
  /** Who it was addressed to, when it was from me and to one person. */
  recipient?: { name: string; email?: string };
  myName: string;
};

/** Phrasings that are a request whatever else the sentence says. */
const REQUEST = [
  /\b(can|could|would|will) you\b/i,
  /\bplease\b/i,
  /\bkindly\b/i,
  /\b(i|we) need (you|your)\b/i,
  /\bneed you to\b/i,
  /\blet (me|us) know\b/i,
  /\bawaiting your\b/i,
  /\bwaiting (on|for) your\b/i,
];

/** A sentence that opens with an instruction: "Send me the drawings." */
const IMPERATIVE = /^(?:[A-Z][\w'-]+,\s*)?(send|provide|share|confirm|forward|update|review|approve|sign|return|submit|check|book|arrange|issue)\b/i;

const PROMISE = [
  /\b(i|we)('ll| will| shall| am going to|'m going to| are going to|'re going to)\b/i,
  /\b(i|we)('ll| will)? (send|get|provide|share|confirm|follow up|come back|get back|update|review|look into|check)\b.*\b(by|tomorrow|today|next|this|eod|eow|monday|tuesday|wednesday|thursday|friday)\b/i,
  /\bwill (send|provide|share|confirm|follow up|get back|come back|update|revert)\b/i,
  /\bleave it with me\b/i,
  /\bi('ll| will) take (that|this|it|care)\b/i,
];

/** "Sam to send X", "Action: Sam - X", "AP Sam: X", "@Sam X" — a named owner. */
const ACTION_LINE = [
  // Action: Sam - X   /   AP me: X   /   Action (Priya): X   /   Action: Sam to X
  /^\s*(?:[-*•]\s*)?(?:action|actions|ap|ai|todo|to do)(?:\s*\(([^)]+)\)|\s+([A-Za-z][\w'.-]*(?:\s[A-Za-z][\w'.-]*)?))?\s*[:\-–]\s*(?:([A-Za-z][\w'.-]*(?:\s[A-Za-z][\w'.-]*)?)\s*[:\-–]\s*)?(.+)$/i,
  /^\s*(?:[-*•]\s*)?([A-Z][\w'.-]*(?:\s[A-Z][\w'.-]*)?)\s+to\s+((?:send|provide|confirm|check|review|update|issue|share|arrange|book|chase|follow|get|prepare|draft|submit|schedule|call|email|raise|close|fix|test|investigate|look|set|organise|organize|coordinate|write|produce|complete|finalise|finalize|circulate|agree|ask|contact|discuss)\b.+)$/,
  /^\s*(?:[-*•]\s*)?@([A-Za-z][\w'.-]*)\s+(.+)$/,
];

/** Capitalised words that start "X to do Y" without being anybody. */
const NOT_A_NAME = /^(need|needs|want|wants|have|has|had|plan|plans|planning|remember|going|trying|agreed|decided|they|you|also|then|who|what|how|when|and|but|so|try|able|unable|nothing|something|time|ok|okay|due|reminder|note|nice|good|great|happy|glad|hard|easy|best|first|next|last)$/i;

const POLITE = [
  /^(hi|hello|dear|hey)\s+[\w ,]+[,!]\s*/i,
  /^[A-Z][\w'-]+(?:\s[A-Z][\w'-]+)?,\s+(?=[a-z])/,
  /^(can|could|would|will) you (please |kindly )?/i,
  /^(please|kindly)\s+(can you\s+|could you\s+)?/i,
  /^(i|we) (would )?(need|needed) (you to |your |the )?/i,
  /^(i|we)('ll| will| shall| am going to|'m going to| are going to|'re going to)\s+/i,
  /^(just )?(a )?(quick )?(reminder|note) (to|that)\s+/i,
  /^(also|and|but|so|then|finally|lastly)[,]?\s+/i,
  /^let (me|us) know\s+/i,
];

/** Split text into sentences and bullet lines, keeping where each started. */
export function sentences(text: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  const re = /[^\n.!?]+(?:[.!?]+(?=\s|$)|(?=\n)|$)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const raw = m[0];
    const t = raw.trim();
    if (t.length < 6) continue;
    out.push({ text: t, index: m.index + raw.indexOf(t) });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

function stripPolite(s: string): string {
  let t = s.trim();
  for (let i = 0; i < 3; i++) for (const re of POLITE) t = t.replace(re, '');
  return t;
}

/** A sentence made into a title: politeness, the date and the question mark taken off. */
export function titleFrom(sentence: string, duePhrase?: string): string {
  let t = sentence;
  if (duePhrase) t = t.replace(duePhrase, ' ');
  t = stripPolite(t)
    .replace(/[?!.]+$/, '')
    .replace(/\s+(by|before|on|until|no later than|at the latest)\s*$/i, '')
    .replace(/,?\s*(please|thanks|thank you)\s*$/i, '');
  t = tidyTitle(t);
  return t.length > 140 ? `${t.slice(0, 137).trim()}…` : t;
}

function signoffIndex(text: string): number {
  const m = /^\s*(thanks|thank you|many thanks|regards|kind regards|best regards|best|cheers|sincerely)[,!.]?\s*$/im.exec(text);
  return m ? m.index : text.length;
}

export function findAsks(text: string, ctx: AskContext): Ask[] {
  const body = text.slice(0, signoffIndex(text));
  const out: Ask[] = [];
  const seen = new Set<string>();
  const other = ctx.fromMe ? ctx.recipient : ctx.sender;

  const push = (a: Omit<Ask, 'title' | 'due' | 'duePhrase' | 'match'> & { titleSource?: string }) => {
    const d = findDate(a.titleSource ?? a.quote, ctx.today, ctx.cal, ctx.order);
    const title = titleFrom(a.titleSource ?? a.quote, d?.text);
    if (title.length < 4) return;
    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const match = a.personName ? matchPerson(ctx.people, { name: a.personName, email: other && a.personName === other.name ? other.email : undefined }) : undefined;
    out.push({ kind: a.kind, quote: a.quote, index: a.index, title, direction: a.direction, personName: a.personName, match, due: d?.day, duePhrase: d?.text });
  };

  // Action lines first, one per line.
  let offset = 0;
  for (const line of body.split('\n')) {
    const at = offset;
    offset += line.length + 1;
    for (const [i, re] of ACTION_LINE.entries()) {
      const m = re.exec(line);
      if (!m) continue;
      let owner: string | undefined;
      let rest: string;
      if (i === 0) {
        owner = (m[1] ?? m[2] ?? m[3])?.trim();
        rest = m[4];
        // "Action: Sam to send X" names its owner inside the text.
        const inner = /^([A-Z][\w'.-]*(?:\s[A-Z][\w'.-]*)?)\s+to\s+(.+)$/.exec(rest);
        if (!owner && inner) {
          owner = inner[1];
          rest = inner[2];
        }
      } else {
        owner = m[1];
        rest = m[2];
      }
      if (owner && NOT_A_NAME.test(owner)) continue;
      const mine = !owner || /^(me|i|myself|we|us)$/i.test(owner) || (!!ctx.myName && owner.toLowerCase() === ctx.myName.toLowerCase()) || (!!ctx.myName && owner.toLowerCase() === ctx.myName.split(' ')[0].toLowerCase());
      push({
        kind: 'action',
        quote: line.trim(),
        index: at + line.indexOf(line.trim()),
        direction: mine ? 'owe' : 'wait',
        personName: mine ? undefined : owner,
        titleSource: rest,
      });
      break;
    }
  }

  for (const s of sentences(body)) {
    if (out.some((a) => a.kind === 'action' && a.quote.includes(s.text))) continue;
    // A first-person promise wins over a verb that could be read as an instruction:
    // "I'll send the report" is a promise, "Send the report" is a request.
    const strong = REQUEST.some((re) => re.test(s.text));
    const isPromise = !strong && PROMISE.some((re) => re.test(s.text));
    const isRequest = strong || (!isPromise && IMPERATIVE.test(s.text));
    if (!isRequest && !isPromise) continue;
    // A question with no verb of doing ("Can you believe it?") is skipped by length.
    if (s.text.split(/\s+/).length < 4) continue;
    const kind: AskKind = isRequest ? 'request' : 'promise';
    // Request from them: I owe them. Promise from them: I wait on them. From me: reversed.
    const direction: Direction = (kind === 'request') !== ctx.fromMe ? 'owe' : 'wait';
    push({ kind, quote: s.text, index: s.index, direction, personName: other?.name });
  }
  return out.sort((a, b) => a.index - b.index);
}
