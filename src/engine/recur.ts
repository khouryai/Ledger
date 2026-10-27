/**
 * Recurring items: the schedule, when the next one is due, and the schedule in words.
 *
 * A recurring item is a series of occurrences. Only the one in hand is on the list: it
 * is an item like any other, with its own history. The ones after it are worked out
 * from the schedule whenever they are wanted and never stored, and closing the one in
 * hand puts the next one on the list.
 *
 * Every occurrence keeps to the schedule's own days. One that falls on a weekend or a
 * holiday is due on the working day before, and the next goes back to the schedule.
 * Counting on from the moved date drifted: a Friday routine with one Friday off came
 * back every Thursday after it.
 */
import { addDays, addWorkingDays, dayNum, daysInMonth, fmtDay, isDay, makeDay, mondayOf, onOrAfterWorking, onOrBeforeWorking, weekday, weekdayFromWord, type Calendar } from './dates';
import type { DateOrder, Day, Item, Recurrence } from './types';

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NTH = new Map<number, string>([
  [1, 'first'],
  [2, 'second'],
  [3, 'third'],
  [4, 'fourth'],
  [-1, 'last'],
]);

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Weekdays once each, Monday first, Sunday last: the order a week is read in. */
export function cleanDays(days: number[]): number[] {
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => mod(a - 1, 7) - mod(b - 1, 7));
}

/**
 * The schedule with every part filled in. What is missing is taken from `anchor`, the
 * day it was set from: the weekday of a weekly one, the day of the month of a monthly
 * one, and the day it counts from.
 */
export function fullRule(r: Recurrence, anchor: Day): Recurrence {
  const every = Math.max(1, Math.floor(r.every) || 1);
  const from = r.from ?? anchor;
  const base: Recurrence = { every, unit: r.unit, from, ...(r.until ? { until: r.until } : {}), ...(r.catchUp ? { catchUp: true } : {}) };
  if (r.unit === 'day') return base;
  const days = r.days?.length ? cleanDays(r.days) : [weekday(from)];
  if (r.unit === 'week') return { ...base, days };
  if (r.nth) return { ...base, nth: r.nth >= 1 && r.nth <= 4 ? Math.floor(r.nth) : -1, days };
  return { ...base, monthDay: r.monthDay === -1 || (r.monthDay && r.monthDay >= 1 && r.monthDay <= 31) ? r.monthDay : Number(from.slice(8, 10)) };
}

/** An item's schedule, filled in from the item: the date it was due counts as where it started. */
export function ruleOf(it: Pick<Item, 'recur' | 'due' | 'askedOn'>): Recurrence | undefined {
  return it.recur ? fullRule(it.recur, it.recur.from ?? it.due ?? it.askedOn) : undefined;
}

function weekIndex(d: Day): number {
  return Math.floor(dayNum(mondayOf(d)) / 7);
}

function monthIndex(d: Day): number {
  return Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
}

/** The days a monthly schedule falls on in one month, before any is moved off a day off. */
function monthDays(rule: Recurrence, mi: number): Day[] {
  const y = Math.floor(mi / 12);
  const m = mod(mi, 12) + 1;
  const last = daysInMonth(y, m);
  if (rule.nth && rule.days?.length) {
    const nth = rule.nth;
    return rule.days
      .map((wd) => {
        if (nth > 0) {
          const first = makeDay(y, m, 1)!;
          return makeDay(y, m, 1 + mod(wd - weekday(first), 7) + 7 * (nth - 1))!;
        }
        const end = makeDay(y, m, last)!;
        return addDays(end, -mod(weekday(end) - wd, 7));
      })
      .sort();
  }
  const md = rule.monthDay ?? 1;
  return [makeDay(y, m, md === -1 ? last : Math.min(md, last))!];
}

/** The first day the schedule falls on strictly after `after`, before any moving. Weekly and monthly only. */
function nextScheduled(rule: Recurrence, after: Day): Day {
  const from = rule.from ?? after;
  if (rule.unit === 'week') {
    const days = rule.days?.length ? rule.days : [weekday(from)];
    for (let i = 1; i <= 7 * (rule.every + 1); i++) {
      const d = addDays(after, i);
      if (days.includes(weekday(d)) && mod(weekIndex(d) - weekIndex(from), rule.every) === 0) return d;
    }
  } else {
    const start = monthIndex(after);
    for (let k = 0; k <= 2 * rule.every + 1; k++) {
      if (mod(start + k - monthIndex(from), rule.every) !== 0) continue;
      const hit = monthDays(rule, start + k).find((d) => d > after);
      if (hit) return hit;
    }
  }
  // Unreachable for a filled-in schedule; a week on is the safe answer.
  return addDays(after, 7);
}

/**
 * When the occurrence after one due on `after` is due: the first day of the schedule
 * whose due date (moved back off a day off) is later than `after`, and not before
 * `notBefore` when that is given. Null once the schedule has ended.
 */
export function nextOccurrence(r: Recurrence, after: Day, cal: Calendar, notBefore?: Day): Day | null {
  const rule = fullRule(r, r.from ?? after);
  if (rule.unit === 'day') {
    let d = addWorkingDays(after, rule.every, cal);
    // Catching up keeps the step: every two working days stays on the same beat.
    for (let i = 0; notBefore && d < notBefore && i < 5000; i++) d = addWorkingDays(d, rule.every, cal);
    return rule.until && d > rule.until ? null : d;
  }
  let n = after;
  for (let i = 0; i < 2000; i++) {
    n = nextScheduled(rule, n);
    if (rule.until && n > rule.until) return null;
    const due = onOrBeforeWorking(n, cal);
    if (due > after && (!notBefore || due >= notBefore)) return due;
  }
  return null;
}

/** The first occurrence due on or after `day`: where a schedule set up that day starts. */
export function firstOccurrence(r: Recurrence, day: Day, cal: Calendar): Day | null {
  const rule = fullRule(r, r.from ?? day);
  if (rule.unit === 'day') {
    const d = onOrAfterWorking(day, cal);
    return rule.until && d > rule.until ? null : d;
  }
  return nextOccurrence(rule, addDays(day, -1), cal, day);
}

/** The occurrences after the one due on `after`, up to and including `to`. */
export function occurrencesAfter(r: Recurrence, after: Day, to: Day, cal: Calendar, max = 400): Day[] {
  const rule = fullRule(r, r.from ?? after);
  const out: Day[] = [];
  let d: Day | null = after;
  while (out.length < max) {
    d = nextOccurrence(rule, d, cal);
    if (!d || d > to) break;
    out.push(d);
  }
  return out;
}

/** The first `count` due dates of a schedule that starts on or after `day`. */
export function upcomingDates(r: Recurrence, day: Day, cal: Calendar, count = 5): Day[] {
  const first = firstOccurrence(r, day, cal);
  if (!first) return [];
  return [first, ...occurrencesAfter(fullRule(r, r.from ?? day), first, '9999-12-31', cal, count - 1)];
}

/** Two schedules that would put the same dates on the list. */
export function sameRecurrence(a: Recurrence | undefined, b: Recurrence | undefined): boolean {
  return recurKey(a) === recurKey(b);
}

function recurKey(r: Recurrence | undefined): string {
  if (!r) return '';
  return JSON.stringify([r.every, r.unit, r.days ?? null, r.monthDay ?? null, r.nth ?? null, r.from ?? null, r.until ?? null, !!r.catchUp]);
}

/** A schedule read from a file. Anything that does not make sense is left out, never guessed. */
export function readRecurrence(raw: unknown): Recurrence | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const unit = r.unit;
  if (unit !== 'day' && unit !== 'week' && unit !== 'month') return undefined;
  const every = typeof r.every === 'number' && Number.isFinite(r.every) && r.every >= 1 ? Math.min(999, Math.floor(r.every)) : 1;
  const out: Recurrence = { every, unit };
  const days = Array.isArray(r.days) ? cleanDays(r.days.filter((d): d is number => typeof d === 'number')) : [];
  const nth = typeof r.nth === 'number' && (r.nth === -1 || (Number.isInteger(r.nth) && r.nth >= 1 && r.nth <= 4)) ? r.nth : undefined;
  const md = typeof r.monthDay === 'number' && (r.monthDay === -1 || (Number.isInteger(r.monthDay) && r.monthDay >= 1 && r.monthDay <= 31)) ? r.monthDay : undefined;
  if (unit === 'week' && days.length) out.days = days;
  if (unit === 'month' && nth && days.length) Object.assign(out, { nth, days });
  else if (unit === 'month' && md) out.monthDay = md;
  if (isDay(r.from)) out.from = r.from;
  if (isDay(r.until)) out.until = r.until;
  if (r.catchUp === true) out.catchUp = true;
  return out;
}

// ── In words ────────────────────────────────────────────────────────────────

/** 1st, 2nd, 3rd, 11th, 22nd. */
export function ordinal(n: number): string {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${s}`;
}

/** "a", "a and b", "a, b and c". */
export function listWords(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function dayList(days: number[], short: boolean): string {
  return listWords(cleanDays(days).map((d) => (short ? WD3[d] : WEEKDAY[d])));
}

function isWeekdays(days: number[] | undefined): boolean {
  return !!days && cleanDays(days).join() === '1,2,3,4,5';
}

/**
 * The schedule as a person would say it: "Every Friday", "Every other Tuesday",
 * "Monthly on the last working day", "Every 3 months on the 15th, until Fri 12/18".
 */
export function describeRecurrence(r: Recurrence, o: { order?: DateOrder; today?: Day } = {}): string {
  const n = Math.max(1, r.every);
  let s: string;
  if (r.unit === 'day') s = n === 1 ? 'Every working day' : `Every ${n} working days`;
  else if (r.unit === 'week') {
    const days = r.days?.length ? r.days : null;
    if (!days) s = n === 1 ? 'Every week' : n === 2 ? 'Every other week' : `Every ${n} weeks`;
    else if (n === 1) s = isWeekdays(days) ? 'Every weekday' : `Every ${dayList(days, days.length > 2)}`;
    else if (n === 2) s = `Every other ${dayList(days, days.length > 2)}`;
    else s = `Every ${n} weeks on ${dayList(days, days.length > 2)}`;
  } else {
    const head = n === 1 ? 'Monthly' : n === 2 ? 'Every other month' : n === 12 ? 'Every year' : `Every ${n} months`;
    let on = '';
    if (r.nth && r.days?.length) on = ` on the ${NTH.get(r.nth) ?? 'last'} ${dayList(r.days, false)}`;
    else if (r.monthDay === -1) on = ' on the last working day';
    else if (r.monthDay) on = ` on the ${ordinal(r.monthDay)}`;
    if (on && n % 12 === 0 && r.from) on += ` of ${MONTH[Number(r.from.slice(5, 7)) - 1]}`;
    s = head + on;
  }
  if (r.until) s += `, until ${fmtDay(r.until, o.order ?? 'MDY', o.today)}`;
  return s;
}

/** The schedule in a few characters, for a row: "Every Fri", "Mon, Wed, Fri", "Monthly, 15th". */
export function shortRecurrence(r: Recurrence): string {
  const n = Math.max(1, r.every);
  const days = r.days?.length ? cleanDays(r.days) : null;
  if (r.unit === 'day') return n === 1 ? 'Every working day' : `Every ${n} working days`;
  if (r.unit === 'week') {
    const list = days ? (isWeekdays(days) ? 'weekday' : days.map((d) => WD3[d]).join(', ')) : '';
    if (n === 1) return days ? `Every ${list}` : 'Weekly';
    if (n === 2) return days ? `Every other ${list}` : 'Every other week';
    return `Every ${n} weeks${days ? `, ${list}` : ''}`;
  }
  const head = n === 1 ? 'Monthly' : n === 12 ? 'Yearly' : `Every ${n} months`;
  if (r.nth && days) return `${head}, ${r.nth === -1 ? 'last' : ordinal(r.nth)} ${days.map((d) => WD3[d]).join('/')}`;
  if (r.monthDay === -1) return `${head}, last working day`;
  if (r.monthDay) return `${head}, ${ordinal(r.monthDay)}`;
  return head;
}

// ── Reading it from what was typed ──────────────────────────────────────────

type Tok = { lower: string; start: number; end: number };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /[A-Za-z]+|\d{1,4}(?:st|nd|rd|th)?|[,&/+-]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ lower: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return out;
}

function weekdayTok(tok: Tok | undefined): number | null {
  if (!tok || !/^[a-z]{3,}$/.test(tok.lower)) return null;
  const direct = weekdayFromWord(tok.lower);
  if (direct !== null) return direct;
  // Plurals: "mondays", "fridays".
  return tok.lower.endsWith('s') ? weekdayFromWord(tok.lower.slice(0, -1)) : null;
}

const SEP = new Set([',', 'and', '&', '/', '+']);

/** Weekdays from token `i`: "mon", "mon and thu", "mon, wed & fri", "tuesdays and thursdays". */
function weekdayList(toks: Tok[], i: number): { days: number[]; next: number } | null {
  const first = weekdayTok(toks[i]);
  if (first === null) return null;
  const days = [first];
  let j = i + 1;
  for (;;) {
    let k = j;
    while (k < toks.length && k - j < 2 && SEP.has(toks[k].lower)) k++;
    const wd = weekdayTok(toks[k]);
    if (wd === null) break;
    days.push(wd);
    j = k + 1;
  }
  return { days: cleanDays(days), next: j };
}

const ORD_WORDS = new Map<string, number>([
  ['first', 1],
  ['second', 2],
  ['third', 3],
  ['fourth', 4],
  ['last', -1],
]);

function ordinalTok(tok: Tok | undefined): number | null {
  if (!tok) return null;
  const w = ORD_WORDS.get(tok.lower);
  if (w !== undefined) return w;
  const m = /^(\d{1,2})(st|nd|rd|th)$/.exec(tok.lower);
  return m ? Number(m[1]) : null;
}

type Unit = { unit: Recurrence['unit']; times: number; next: number };

function unitAt(toks: Tok[], j: number): Unit | null {
  const w = toks[j]?.lower;
  if (!w) return null;
  if ((w === 'working' || w === 'business' || w === 'work') && /^days?$/.test(toks[j + 1]?.lower ?? '')) return { unit: 'day', times: 1, next: j + 2 };
  if (/^(days?|workdays?|weekdays?)$/.test(w)) return { unit: 'day', times: 1, next: j + 1 };
  if (/^weeks?$/.test(w)) return { unit: 'week', times: 1, next: j + 1 };
  if (/^fortnights?$/.test(w)) return { unit: 'week', times: 2, next: j + 1 };
  if (/^months?$/.test(w)) return { unit: 'month', times: 1, next: j + 1 };
  if (/^quarters?$/.test(w)) return { unit: 'month', times: 3, next: j + 1 };
  if (/^years?$/.test(w)) return { unit: 'month', times: 12, next: j + 1 };
  return null;
}

/** Past "of the month", "of every month", "in the month", when they follow. */
function ofTheMonth(toks: Tok[], k: number): number {
  const [a, b, c] = [toks[k]?.lower, toks[k + 1]?.lower, toks[k + 2]?.lower];
  if ((a === 'of' || a === 'in') && (b === 'the' || b === 'each' || b === 'every') && c === 'month') return k + 3;
  return k;
}

/** "15th", "last day", "last working day", "first monday", "last friday": a day in a month. */
function monthSpec(toks: Tok[], k: number): { part: Partial<Recurrence>; next: number } | null {
  const ord = ordinalTok(toks[k]);
  if (ord === null) return null;
  const u = unitAt(toks, k + 1);
  if (ord === -1 && u?.unit === 'day' && u.times === 1) return { part: { monthDay: -1 }, next: ofTheMonth(toks, u.next) };
  if (ord === 1 && /^days?$/.test(toks[k + 1]?.lower ?? '')) return { part: { monthDay: 1 }, next: ofTheMonth(toks, k + 2) };
  const wl = weekdayList(toks, k + 1);
  if (wl) return ord === -1 || (ord >= 1 && ord <= 4) ? { part: { nth: ord, days: wl.days }, next: ofTheMonth(toks, wl.next) } : null;
  if (/\d/.test(toks[k].lower) && ord >= 1 && ord <= 31) return { part: { monthDay: ord }, next: ofTheMonth(toks, k + 1) };
  return null;
}

/** "on the 15th", "on day 15", "on the last working day", "on the first monday". */
function monthOn(toks: Tok[], j: number): { part: Partial<Recurrence>; next: number } | null {
  if (toks[j]?.lower !== 'on') return null;
  let k = j + 1;
  if (toks[k]?.lower === 'the') k++;
  if (toks[k]?.lower === 'day' && /^\d{1,2}$/.test(toks[k + 1]?.lower ?? '')) {
    const n = Number(toks[k + 1].lower);
    return n >= 1 && n <= 31 ? { part: { monthDay: n }, next: k + 2 } : null;
  }
  return monthSpec(toks, k);
}

function isMonthEnd(toks: Tok[], k: number): number | null {
  const [a, b, c, d] = [toks[k]?.lower, toks[k + 1]?.lower, toks[k + 2]?.lower, toks[k + 3]?.lower];
  if (a === 'end' && b === 'of' && c === 'month') return k + 3;
  if (a === 'end' && b === 'of' && c === 'the' && d === 'month') return k + 4;
  return null;
}

/** Everything after "every" or "each" at token `i`. */
function afterEvery(toks: Tok[], i: number): { recur: Recurrence; next: number } | null {
  let j = i + 1;
  let count = 1;
  const t = toks[j]?.lower ?? '';
  const ord = /^\d{1,2}$/.test(t) || t === 'other' ? null : ordinalTok(toks[j]);
  if (/^\d{1,2}$/.test(t)) {
    count = Number(t);
    j++;
  } else if (t === 'other') {
    count = 2;
    j++;
  } else if (ord !== null) j++;
  if (count < 1) return null;

  const end = isMonthEnd(toks, j);
  if (end !== null && ord === null) return { recur: { every: count, unit: 'month', monthDay: -1 }, next: end };

  const wl = weekdayList(toks, j);
  if (wl) {
    // "Every first Monday" is a month's; "every other Friday" and "every 2 Fridays" a fortnight's.
    if (ord !== null) return ord === -1 || (ord >= 1 && ord <= 4) ? { recur: { every: 1, unit: 'month', nth: ord, days: wl.days }, next: ofTheMonth(toks, wl.next) } : null;
    return { recur: { every: count, unit: 'week', days: wl.days }, next: wl.next };
  }
  if (ord !== null) {
    const spec = monthSpec(toks, j - 1);
    if (spec) return { recur: { every: 1, unit: 'month', ...spec.part }, next: spec.next };
    // "every second week", "every third month".
    if (ord < 2) return null;
    count = ord;
  }

  const u = unitAt(toks, j);
  if (!u) return null;
  const every = count * u.times;
  if (u.unit === 'week') {
    const l = toks[u.next]?.lower === 'on' ? weekdayList(toks, u.next + 1) : null;
    return l ? { recur: { every, unit: 'week', days: l.days }, next: l.next } : { recur: { every, unit: 'week' }, next: u.next };
  }
  if (u.unit === 'month') {
    // "every month end", "every month-end"
    const e = toks[u.next]?.lower === 'end' ? u.next + 1 : toks[u.next]?.lower === '-' && toks[u.next + 1]?.lower === 'end' ? u.next + 2 : null;
    if (e !== null) return { recur: { every, unit: 'month', monthDay: -1 }, next: e };
    const on = monthOn(toks, u.next);
    return on ? { recur: { every, unit: 'month', ...on.part }, next: on.next } : { recur: { every, unit: 'month' }, next: u.next };
  }
  return { recur: { every, unit: 'day' }, next: u.next };
}

export type RecurMatch = { recur: Recurrence; text: string; index: number };

/**
 * The first schedule in a piece of text, with the exact words it was read from so the
 * caller can take them out of a title and show what it heard. It needs "every" or
 * "each": a "Weekly report" or a "Monthly invoice" is a title, not a schedule.
 *
 *   every friday · each mon and thu · every other tuesday · every 2 weeks on mon
 *   every working day · every 3 days · every month on the 15th · every 15th
 *   every month end · every last working day · every first monday · every quarter
 *   the last friday of every month · on the 1st of each month
 */
export function findRecurrence(text: string): RecurMatch | null {
  const toks = tokenize(text);
  const found: { recur: Recurrence; first: number; next: number }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i].lower;
    if (w === 'every' || w === 'each') {
      const r = afterEvery(toks, i);
      if (r) found.push({ recur: r.recur, first: i, next: r.next });
    }
    // "the first Monday of every month": the day comes before the "every".
    if ((w === 'of' || w === 'in') && (toks[i + 1]?.lower === 'every' || toks[i + 1]?.lower === 'each') && toks[i + 2]?.lower === 'month') {
      for (let s = i - 1; s >= Math.max(0, i - 4); s--) {
        const spec = monthSpec(toks, s);
        if (!spec || spec.next !== i + 3) continue;
        let first = s;
        if (toks[first - 1]?.lower === 'the') first--;
        if (toks[first - 1]?.lower === 'on') first--;
        found.push({ recur: { every: 1, unit: 'month', ...spec.part }, first, next: spec.next });
        break;
      }
    }
  }
  if (!found.length) return null;
  // The earliest wins: "the first Monday of every month" over the "every month" inside it.
  const best = found.reduce((a, b) => (b.first < a.first ? b : a));
  const start = toks[best.first].start;
  return { recur: best.recur, text: text.slice(start, toks[best.next - 1].end), index: start };
}
