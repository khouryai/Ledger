/**
 * The quick-add line.
 *
 *   @Sam ATS report rev B fri #BART
 *
 * reads as: waiting on Sam, "ATS report rev B", due Friday, tagged BART. Everything it
 * recognised is returned as a token, so the line can show what it heard as chips
 * BEFORE Enter: an item is never added on a reading nobody could see.
 *
 * Syntax:
 *   @Sam  @"Sam Lee"  @sam_lee     the other person
 *   #tag                           a tag
 *   by fri / due 11/14 / fri       the due date (for a waiting item, their promise)
 *   since mon / asked 10/12        when the request was made, if not today
 *   every week / every 2 weeks / every month / every day
 *   owe: … / wait: …               direction, as an alternative to the Tab toggle
 */
import { addDays, addMonths, findDate, weekdayFromWord, type Calendar } from './dates';
import { matchPerson, nameFromHandle, type PersonMatch } from './people';
import type { DateOrder, Day, Direction, Person, Recurrence } from './types';

export type QuickToken =
  | { kind: 'person'; text: string; match: PersonMatch; name: string }
  | { kind: 'tag'; text: string; tag: string }
  | { kind: 'due'; text: string; day: Day }
  | { kind: 'asked'; text: string; day: Day }
  | { kind: 'recur'; text: string; recur: Recurrence }
  | { kind: 'direction'; text: string; direction: Direction };

export type QuickAdd = {
  title: string;
  direction: Direction;
  tokens: QuickToken[];
  person?: { kind: 'one'; person: Person } | { kind: 'new'; name: string } | { kind: 'many'; name: string; people: Person[] };
  tags: string[];
  due?: Day;
  askedOn?: Day;
  recur?: Recurrence;
};

export type QuickContext = {
  today: Day;
  cal: Calendar;
  order: DateOrder;
  people: Person[];
  direction: Direction;
};

function cut(text: string, index: number, length: number): string {
  return `${text.slice(0, index)} ${text.slice(index + length)}`;
}

/** Tidy what is left once the recognised parts are taken out. */
export function tidyTitle(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  // Joining words left stranded at either end by a removed date or name.
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/^(?:[-–—:,;]|to|for|from|re|re:|about)\s+/i, '')
      .replace(/\s+(?:by|on|due|before|until|for|from|to|asked|since|-|–|,|;)$/i, '')
      .trim();
  }
  t = t.replace(/\s+([,.;:!?])/g, '$1').replace(/^[,.;:\s]+|[,;:\s]+$/g, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function parseQuickAdd(input: string, ctx: QuickContext): QuickAdd {
  const tokens: QuickToken[] = [];
  let text = ` ${input} `;
  let direction = ctx.direction;

  const dir = /^\s*(owe|i owe|wait|waiting|waiting on|w|o)\s*:\s*/i.exec(text);
  if (dir) {
    direction = /^(w|wait)/i.test(dir[1]) ? 'wait' : 'owe';
    tokens.push({ kind: 'direction', text: dir[0].trim(), direction });
    text = text.slice(dir[0].length - 1);
  }

  // Recurrence first: "every friday" must not leave "friday" behind as a due date.
  let recur: Recurrence | undefined;
  let recurDay: number | null = null;
  const rec = /\s(every|each)\s+(?:(\d{1,2}|other)\s+)?(working day|workday|weekday|day|week|month|(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*)s?\b/i.exec(text);
  if (rec) {
    const n = rec[2] ? (rec[2].toLowerCase() === 'other' ? 2 : Number(rec[2])) : 1;
    const unitWord = rec[3].toLowerCase();
    const wd = weekdayFromWord(unitWord);
    if (wd !== null) {
      recur = { every: n, unit: 'week' };
      recurDay = wd;
    } else if (unitWord.startsWith('month')) recur = { every: n, unit: 'month' };
    else if (unitWord.startsWith('week') && unitWord !== 'weekday') recur = { every: n, unit: 'week' };
    else recur = { every: n, unit: 'day' };
    tokens.push({ kind: 'recur', text: rec[0].trim(), recur });
    text = cut(text, rec.index, rec[0].length);
  }

  // People: @Sam, @"Sam Lee", @sam_lee
  let person: QuickAdd['person'];
  const at = /(^|\s)@(?:"([^"]+)"|([A-Za-z0-9][\w.'-]*))/.exec(text);
  if (at) {
    const handle = at[2] ?? at[3];
    const match = matchPerson(ctx.people, handle.includes('@') ? { email: handle } : { name: handle.replace(/_/g, ' ') });
    const name = match.kind === 'one' ? match.person.name : nameFromHandle(handle);
    tokens.push({ kind: 'person', text: at[0].trim(), match, name });
    if (match.kind === 'one') person = { kind: 'one', person: match.person };
    else if (match.kind === 'many') person = { kind: 'many', name: handle, people: match.people };
    else person = { kind: 'new', name };
    text = cut(text, at.index, at[0].length);
  }

  // Tags
  const tags: string[] = [];
  for (let m = /(^|\s)#([\w./-]+)/.exec(text); m; m = /(^|\s)#([\w./-]+)/.exec(text)) {
    if (!tags.some((t) => t.toLowerCase() === m![2].toLowerCase())) tags.push(m[2]);
    tokens.push({ kind: 'tag', text: `#${m[2]}`, tag: m[2] });
    text = cut(text, m.index, m[0].length);
  }

  // When it was asked: "since mon", "asked 10/12"
  let askedOn: Day | undefined;
  const since = /\s(since|asked(?: on)?|raised(?: on)?)\s+(last\s+)?/i.exec(text);
  if (since) {
    const rest = text.slice(since.index + since[0].length);
    const d = findDate(rest, ctx.today, ctx.cal, ctx.order);
    if (d && d.index === 0) {
      // Asked is always in the past: a weekday means the most recent one, a date with
      // no year means the most recent occurrence of it.
      let day = d.day;
      if (day > ctx.today) day = weekdayFromWord(d.text.replace(/^(?:this|next|coming)\s+/i, '')) !== null ? addDays(day, -7) : addMonths(day, -12);
      if (day <= ctx.today) {
        askedOn = day;
        tokens.push({ kind: 'asked', text: `${since[1]} ${since[2] ?? ''}${d.text}`.replace(/\s+/g, ' '), day });
        text = cut(text, since.index, since[0].length + d.text.length);
      }
    }
  }

  // Due date: the first date phrase left.
  let due: Day | undefined;
  const d = findDate(text, ctx.today, ctx.cal, ctx.order);
  if (d) {
    due = d.day;
    let start = d.index;
    let len = d.text.length;
    const before = /\s(by|due|on|before|until)\s+$/i.exec(text.slice(0, start));
    if (before) {
      start = before.index;
      len = d.index + d.text.length - before.index;
    }
    tokens.push({ kind: 'due', text: text.slice(start, start + len).trim(), day: due });
    text = cut(text, start, len);
  }
  // "every friday" with no date of its own is due on the next Friday.
  if (!due && recurDay !== null) {
    const m = findDate(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][recurDay], ctx.today, ctx.cal, ctx.order);
    if (m) due = m.day;
  }

  return {
    title: tidyTitle(text),
    direction,
    tokens,
    person,
    tags,
    due,
    askedOn,
    recur,
  };
}
