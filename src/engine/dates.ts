/**
 * Days, working days and the date phrases people actually type.
 *
 * A day is a `YYYY-MM-DD` string in the user's own time zone. Arithmetic is done on
 * a day number (days since 1970-01-01 counted in UTC), so a day never shifts when the
 * clocks change and "today" is never Greenwich's today: it comes from `toDay(new
 * Date())`, which reads the local calendar.
 */
import type { DateOrder, Day } from './types';

export type Calendar = {
  /** 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  holidays: Day[];
};

export const DEFAULT_CALENDAR: Calendar = { workDays: [1, 2, 3, 4, 5], holidays: [] };

const MS_DAY = 86_400_000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The local calendar day of an instant. */
export function toDay(d: Date): Day {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDay(s: unknown): s is Day {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function dayNum(day: Day): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

export function fromNum(n: number): Day {
  const d = new Date(n * MS_DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function makeDay(y: number, m: number, d: number): Day | null {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function addDays(day: Day, n: number): Day {
  return fromNum(dayNum(day) + n);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: Day): number {
  // 1970-01-01 was a Thursday.
  return (((dayNum(day) + 4) % 7) + 7) % 7;
}

export function compareDays(a: Day, b: Day): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDay(...days: (Day | undefined | null)[]): Day | undefined {
  let best: Day | undefined;
  for (const d of days) if (d && (!best || d > best)) best = d;
  return best;
}

export function minDay(...days: (Day | undefined | null)[]): Day | undefined {
  let best: Day | undefined;
  for (const d of days) if (d && (!best || d < best)) best = d;
  return best;
}

export function isWorkingDay(day: Day, cal: Calendar): boolean {
  const wd = cal.workDays.length ? cal.workDays : DEFAULT_CALENDAR.workDays;
  return wd.includes(weekday(day)) && !cal.holidays.includes(day);
}

/** The day itself when it is a working day, else the next one. */
export function onOrAfterWorking(day: Day, cal: Calendar): Day {
  let d = day;
  for (let i = 0; i < 400 && !isWorkingDay(d, cal); i++) d = addDays(d, 1);
  return d;
}

/** The day itself when it is a working day, else the one before. */
export function onOrBeforeWorking(day: Day, cal: Calendar): Day {
  let d = day;
  for (let i = 0; i < 400 && !isWorkingDay(d, cal); i++) d = addDays(d, -1);
  return d;
}

/**
 * Move by working days. Zero lands on the day itself if it is a working day, else
 * the next one; a positive count counts forward from the day, a negative one back.
 */
export function addWorkingDays(day: Day, n: number, cal: Calendar): Day {
  if (n === 0) return onOrAfterWorking(day, cal);
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  let d = day;
  for (let guard = 0; left > 0 && guard < 5000; guard++) {
    d = addDays(d, step);
    if (isWorkingDay(d, cal)) left--;
  }
  return d;
}

/**
 * Working days from `a` to `b`: the working days in (a, b]. Asked on a Monday, it is
 * one working day old on Tuesday. When `b` is before `a` the count is negative, so a
 * delivery two working days ahead of its promise reads as -2.
 */
export function workingDaysBetween(a: Day, b: Day, cal: Calendar): number {
  if (a === b) return 0;
  const forward = a < b;
  let lo = forward ? a : b;
  const hi = forward ? b : a;
  let count = 0;
  for (let guard = 0; lo < hi && guard < 5000; guard++) {
    lo = addDays(lo, 1);
    if (isWorkingDay(lo, cal)) count++;
  }
  return forward ? count : -count;
}

/** The last working day of the week holding `day` (Friday on a normal week). */
export function endOfWeek(day: Day, cal: Calendar): Day {
  const toSat = 6 - weekday(day);
  return onOrBeforeWorking(addDays(day, toSat), cal);
}

export function endOfMonth(day: Day, cal: Calendar): Day {
  const [y, m] = day.split('-').map(Number);
  return onOrBeforeWorking(makeDay(y, m, daysInMonth(y, m))!, cal);
}

/** Add calendar months, holding the day of the month where it exists. */
export function addMonths(day: Day, n: number): Day {
  const [y, m, d] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return makeDay(ny, nm, Math.min(d, daysInMonth(ny, nm)))!;
}

const WEEKDAYS: [RegExp, number][] = [
  [/^sun(day)?$/, 0],
  [/^mon(day)?$/, 1],
  [/^tue(s|sday)?$/, 2],
  [/^wed(s|nesday)?$/, 3],
  [/^thu(r|rs|rsday)?$/, 4],
  [/^fri(day)?$/, 5],
  [/^sat(urday)?$/, 6],
];

export function weekdayFromWord(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  for (const [re, n] of WEEKDAYS) if (re.test(w)) return n;
  return null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "Nov", "nov.", "November", "Sept" → 11, 11, 11, 9. At least three letters. */
export function monthFromWord(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  if (w === 'sept') return 9;
  const i = MONTHS.findIndex((m) => m.startsWith(w));
  return i < 0 ? null : i + 1;
}

/** The Monday of the week holding `day`; Sunday belongs to the week before. */
export function mondayOf(day: Day): Day {
  return addDays(day, -((weekday(day) + 6) % 7));
}

/** The next occurrence of a weekday strictly after `day`. */
function nextWeekday(day: Day, target: number): Day {
  const diff = (target - weekday(day) + 7) % 7 || 7;
  return addDays(day, diff);
}

/** A two-digit year is this century; a date with no year is the next one on or after today. */
function resolveYear(y: number | null, m: number, d: number, today: Day): Day | null {
  if (y !== null) {
    const full = y < 100 ? 2000 + y : y;
    return makeDay(full, m, d);
  }
  const ty = Number(today.slice(0, 4));
  const thisYear = makeDay(ty, m, d);
  if (!thisYear) return null;
  // A date more than a month behind today is next year's; a recent one stays (it is
  // more likely a date somebody missed than one eleven months away).
  if (dayNum(thisYear) < dayNum(today) - 31) return makeDay(ty + 1, m, d);
  return thisYear;
}

export type DateMatch = {
  day: Day;
  /** The exact text that was read as a date, so it can be taken out of a title. */
  text: string;
  index: number;
};

type Rule = { re: RegExp; resolve: (m: RegExpExecArray, today: Day, cal: Calendar, order: DateOrder) => Day | null };

const W = '(?:sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day|nesday|sday|rsday|urday)?';
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

const RULES: Rule[] = [
  // ISO, always unambiguous.
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, resolve: (m) => makeDay(+m[1], +m[2], +m[3]) },
  // 11/14, 11/14/26, 14.11.2026 — read in the user's order. A dot needs all three
  // parts, or "rev 1.5" would be read as the fifth of January.
  {
    re: /\b(\d{1,4})(?:\/(\d{1,2})(?:\/(\d{2,4}))?|\.(\d{1,2})\.(\d{2,4}))\b/,
    resolve: (m, today, _cal, order) => {
      const a = +m[1];
      const b = +(m[2] ?? m[4]);
      const c = (m[3] ?? m[5]) ? +(m[3] ?? m[5]) : null;
      if (order === 'YMD' && m[1].length === 4) return makeDay(a, b, c ?? 0);
      if (m[1].length > 2) return null;
      // Dotted dates are written day first wherever they are written at all.
      const dayFirst = order === 'DMY' || m[4] !== undefined;
      const [mo, d] = dayFirst ? [b, a] : [a, b];
      return resolveYear(c, mo, d, today);
    },
  },
  // Nov 14, November 14th, Nov 14 2026
  {
    re: new RegExp(`\\b(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'),
    resolve: (m, today) => {
      const mo = monthFromWord(m[1]);
      return mo ? resolveYear(m[3] ? +m[3] : null, mo, +m[2], today) : null;
    },
  },
  // 14 Nov, 14th November 2026
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH})(?:,?\\s+(\\d{4}))?\\b`, 'i'),
    resolve: (m, today) => {
      const mo = monthFromWord(m[2]);
      return mo ? resolveYear(m[3] ? +m[3] : null, mo, +m[1], today) : null;
    },
  },
  { re: /\b(?:by\s+)?(?:eod|end of (?:the )?day|today|tonight|cob|close of business)\b/i, resolve: (_m, today) => today },
  { re: /\bday after tomorrow\b/i, resolve: (_m, today) => addDays(today, 2) },
  { re: /\b(?:tomorrow|tmrw|tmw|tomorow)\b/i, resolve: (_m, today) => addDays(today, 1) },
  { re: /\b(?:end of next week|eonw)\b/i, resolve: (_m, today, cal) => endOfWeek(addDays(today, 7), cal) },
  { re: /\b(?:eow|end of (?:the |this )?week|this week)\b/i, resolve: (_m, today, cal) => endOfWeek(today, cal) },
  { re: /\bnext week\b/i, resolve: (_m, today, cal) => endOfWeek(addDays(today, 7), cal) },
  { re: /\b(?:eom|end of (?:the |this )?month)\b/i, resolve: (_m, today, cal) => endOfMonth(today, cal) },
  { re: /\b(?:end of next month|next month)\b/i, resolve: (_m, today, cal) => endOfMonth(addMonths(today, 1), cal) },
  // in 3 days, in 2 weeks, in 4 working days, +3d, +2w
  {
    re: /\b(?:in|within)\s+(\d{1,3}|a|one|two|three|four|five|six|seven|ten)\s+(working |business )?(days?|weeks?|months?)\b/i,
    resolve: (m, today, cal) => {
      const words: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };
      const n = /\d/.test(m[1]) ? +m[1] : words[m[1].toLowerCase()];
      const unit = m[3].toLowerCase();
      if (unit.startsWith('month')) return addMonths(today, n);
      if (unit.startsWith('week')) return addDays(today, 7 * n);
      return m[2] ? addWorkingDays(today, n, cal) : addDays(today, n);
    },
  },
  {
    re: /(?:^|\s)\+(\d{1,3})(d|w|wd|m)\b/i,
    resolve: (m, today, cal) => {
      const n = +m[1];
      const u = m[2].toLowerCase();
      if (u === 'w') return addDays(today, 7 * n);
      if (u === 'm') return addMonths(today, n);
      if (u === 'wd') return addWorkingDays(today, n, cal);
      return addDays(today, n);
    },
  },
  // next fri, this fri, fri, on friday, by friday
  {
    re: new RegExp(`\\b(next|this|coming)?\\s*(${W})\\b`, 'i'),
    resolve: (m, today) => {
      const target = weekdayFromWord(m[2]);
      if (target === null) return null;
      const first = nextWeekday(today, target);
      // "Next Friday" said on a Monday means the Friday of next week, not this one.
      if ((m[1] ?? '').toLowerCase() === 'next' && mondayOf(first) === mondayOf(today)) return addDays(first, 7);
      return first;
    },
  },
];

/**
 * Find the first date phrase in a piece of text. Returns the day and the exact text
 * that was read, so the caller can take it out of a title and show what it heard.
 */
export function findDate(text: string, today: Day, cal: Calendar = DEFAULT_CALENDAR, order: DateOrder = 'MDY'): DateMatch | null {
  let best: DateMatch | null = null;
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.replace('g', ''));
    const m = re.exec(text);
    if (!m) continue;
    const day = rule.resolve(m, today, cal, order);
    if (!day || !isDay(day)) continue;
    // Leading whitespace swallowed by a pattern is not part of the phrase.
    const lead = m[0].length - m[0].trimStart().length;
    const cand: DateMatch = { day, text: m[0].trim(), index: m.index + lead };
    if (!best || cand.index < best.index) best = cand;
  }
  return best;
}

/** Read a whole string as a date, or null if any of it is not a date. */
export function parseDateInput(text: string, today: Day, cal: Calendar = DEFAULT_CALENDAR, order: DateOrder = 'MDY'): Day | null {
  const t = text.trim().replace(/^(?:by|on|due|before)\s+/i, '');
  if (!t) return null;
  const iso: string = t;
  if (isDay(iso)) return iso;
  const m = findDate(t, today, cal, order);
  return m && m.index === 0 && m.text.length >= t.length - 1 ? m.day : null;
}

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Fri 10/30" in the user's order, with the year only when it is not this year's. */
export function fmtDay(day: Day | undefined | null, order: DateOrder = 'MDY', today?: Day): string {
  if (!day || !isDay(day)) return '';
  const [y, m, d] = day.split('-').map(Number);
  const sameYear = today ? today.slice(0, 4) === day.slice(0, 4) : true;
  const yy = String(y).slice(2);
  let core: string;
  if (order === 'YMD') core = sameYear ? `${pad(m)}-${pad(d)}` : day;
  else if (order === 'DMY') core = sameYear ? `${d}/${m}` : `${d}/${m}/${yy}`;
  else core = sameYear ? `${m}/${d}` : `${m}/${d}/${yy}`;
  return `${SHORT_WD[weekday(day)]} ${core}`;
}

/** "15 Oct 2026", for a page somebody reads rather than scans. */
export function fmtDayLong(day: Day | undefined | null): string {
  if (!day || !isDay(day)) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${SHORT_MONTH[m - 1]} ${y}`;
}

/** "today", "tomorrow", "in 3 working days", "2 working days ago". */
export function relDay(day: Day, today: Day, cal: Calendar): string {
  if (day === today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  if (day === addDays(today, -1)) return 'yesterday';
  const n = workingDaysBetween(today, day, cal);
  if (n > 0) return `in ${n} working day${n === 1 ? '' : 's'}`;
  if (n < 0) return `${-n} working day${n === -1 ? '' : 's'} ago`;
  return day > today ? 'after the weekend' : 'over the weekend';
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
