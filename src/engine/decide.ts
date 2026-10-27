/**
 * Decisions from the ledger's own history: when to chase, what to do first, what is
 * at risk, what looks dead.
 *
 * Every decision carries the reason it was made, in words, because a suggestion
 * nobody can check is a suggestion nobody should follow. None of it is stored: it is
 * worked out on each render from the items, so it is always as current as the data,
 * and only what the user accepts is ever written down.
 */
import { addWorkingDays, fmtDay, maxDay, plural, workingDaysBetween, type Calendar } from './dates';
import { firstName } from './people';
import { allSeries, outcome } from './series';
import { chasesSinceMovement, lastChase, lastMovement, lastResponse, lastTouch, median, personStats, type PersonStats } from './stats';
import type { ChaseLevel, Day, Item, LedgerDoc, Person, Settings } from './types';

export type Ctx = {
  doc: LedgerDoc;
  today: Day;
  cal: Calendar;
  /** Person statistics, worked out once per render and shared. */
  stats: Map<string, PersonStats>;
};

export function makeCtx(doc: LedgerDoc, today: Day): Ctx {
  const cal = { workDays: doc.settings.workDays, holidays: doc.settings.holidays };
  const stats = new Map<string, PersonStats>();
  for (const p of doc.people) stats.set(p.id, personStats(doc.items, p.id, doc.settings, cal));
  return { doc, today, cal, stats };
}

function person(ctx: Ctx, id: string | undefined): Person | undefined {
  return id ? ctx.doc.people.find((p) => p.id === id) : undefined;
}

function who(ctx: Ctx, it: Item): string {
  const p = person(ctx, it.personId);
  return p ? firstName(p) : 'them';
}

function d(ctx: Ctx, day: Day): string {
  return fmtDay(day, ctx.doc.settings.dateOrder, ctx.today);
}

export function isSnoozed(it: Item, today: Day): boolean {
  return !!it.snoozeUntil && it.snoozeUntil > today;
}

export function isOpen(it: Item): boolean {
  return it.status === 'open';
}

// ── Age ─────────────────────────────────────────────────────────────────────

export type Tone = 'good' | 'warn' | 'bad' | 'muted' | 'info';

export type Age = {
  /** Working days since it was asked. */
  waited: number;
  /** Working days since anybody touched it. */
  idle: number;
  tone: Tone;
  label: string;
};

export function age(it: Item, ctx: Ctx): Age {
  const s = ctx.doc.settings;
  const waited = Math.max(0, workingDaysBetween(it.askedOn, ctx.today, ctx.cal));
  const idle = Math.max(0, workingDaysBetween(lastTouch(it), ctx.today, ctx.cal));
  if (it.status !== 'open') return { waited, idle, tone: 'muted', label: it.status === 'done' ? (it.direction === 'wait' ? 'Received' : 'Done') : it.history.some((h) => h.kind === 'skipped') ? 'Skipped' : 'Dropped' };
  // A recurring delivery is due on its schedule: it is not "waiting" before its day.
  if (it.direction === 'owe' || (it.recur && it.due)) {
    if (!it.due) return { waited, idle, tone: 'muted', label: 'No deadline' };
    const left = workingDaysBetween(ctx.today, it.due, ctx.cal);
    if (it.due < ctx.today) return { waited, idle, tone: 'bad', label: `Overdue ${plural(-left || 1, 'day')}` };
    if (it.due === ctx.today) return { waited, idle, tone: 'bad', label: 'Due today' };
    if (left <= 2) return { waited, idle, tone: 'warn', label: left <= 1 ? 'Due tomorrow' : `Due in ${left} days` };
    return { waited, idle, tone: 'good', label: `Due in ${left} days` };
  }
  if (it.due && it.due < ctx.today) return { waited, idle, tone: 'bad', label: `Promise missed ${plural(Math.max(1, workingDaysBetween(it.due, ctx.today, ctx.cal)), 'day')}` };
  const tone: Tone = idle >= s.ageing.red ? 'bad' : idle >= s.ageing.amber ? 'warn' : 'good';
  return { waited, idle, tone, label: `Waiting ${plural(waited, 'day')}` };
}

// ── When to chase ───────────────────────────────────────────────────────────

export type ChasePlan = {
  day: Day;
  reason: string;
  /** False when the user set the date by hand. */
  derived: boolean;
  level: ChaseLevel;
  levelReason: string;
};

/** The rhythm for one person: set by hand, learned from them, or the default. */
export function rhythm(ctx: Ctx, personId: string | undefined): { every: number; reason: string } {
  const s = ctx.doc.settings;
  const p = person(ctx, personId);
  if (p?.chaseEvery) return { every: p.chaseEvery, reason: `every ${plural(p.chaseEvery, 'working day')}, as set for ${firstName(p)}` };
  const st = p ? ctx.stats.get(p.id) : undefined;
  if (p && st?.learned && st.deliveryDays !== null) {
    const every = Math.min(15, Math.max(2, Math.round(st.deliveryDays) + 1));
    return { every, reason: `${firstName(p)} usually delivers in ${plural(Math.round(st.deliveryDays), 'working day')} (from ${st.samples} items), so chase at day ${every}` };
  }
  return { every: s.chase.every, reason: `every ${plural(s.chase.every, 'working day')} (your default)` };
}

export function chaseLevel(it: Item, settings: Settings): { level: ChaseLevel; reason: string } {
  const n = chasesSinceMovement(it);
  if (n >= settings.chase.escalateAfter) return { level: 'escalate', reason: `${plural(n, 'chase')} with no movement` };
  if (n >= 1) return { level: 'firm', reason: `${plural(n, 'chase')} already` };
  return { level: 'nudge', reason: 'first chase' };
}

/** When a waiting item should next be chased, and why. */
export function chasePlan(it: Item, ctx: Ctx): ChasePlan | null {
  if (it.direction !== 'wait' || it.status !== 'open') return null;
  const { level, reason: levelReason } = chaseLevel(it, ctx.doc.settings);
  if (it.nextChase) return { day: it.nextChase, reason: 'set by you', derived: false, level, levelReason };
  const last = lastChase(it);
  // A promise is honoured until it passes: chasing before it only annoys. Once it has
  // passed, the working day after it is the chase, unless that chase has been made.
  if (it.due) {
    const after = addWorkingDays(it.due, 1, ctx.cal);
    if (!last || last < after) {
      const reason = it.due >= ctx.today ? `${who(ctx, it)} promised ${d(ctx, it.due)}, so the working day after` : `${who(ctx, it)} promised ${d(ctx, it.due)} and it has not arrived`;
      return { day: after, reason, derived: true, level, levelReason };
    }
  }
  const base = maxDay(it.askedOn, last, lastResponse(it))!;
  const r = rhythm(ctx, it.personId);
  const from = last && last >= base ? `Last chased ${d(ctx, last)}` : base === it.askedOn ? `Asked ${d(ctx, base)}` : `Last heard ${d(ctx, base)}`;
  return { day: addWorkingDays(base, r.every, ctx.cal), reason: `${from}; ${r.reason}`, derived: true, level, levelReason };
}

// ── Expected arrival and risk ───────────────────────────────────────────────

export type Expectation = { day: Day | null; reason: string };

/** When a waiting item is actually likely to arrive, from the person's record. */
export function expectedArrival(it: Item, ctx: Ctx): Expectation {
  const st = it.personId ? ctx.stats.get(it.personId) : undefined;
  const name = who(ctx, it);
  if (it.due) {
    if (st?.learned && st.lateDays !== null && st.lateDays > 0) {
      const late = Math.round(st.lateDays);
      return { day: addWorkingDays(it.due, late, ctx.cal), reason: `${name} promised ${d(ctx, it.due)} but usually runs ${plural(late, 'working day')} late` };
    }
    return { day: it.due, reason: `${name} promised ${d(ctx, it.due)}` };
  }
  if (st?.learned && st.deliveryDays !== null) {
    const n = Math.round(st.deliveryDays);
    return { day: addWorkingDays(it.askedOn, n, ctx.cal), reason: `${name} usually takes ${plural(n, 'working day')}` };
  }
  return { day: null, reason: `${name} has not given a date` };
}

export type Risk = { level: 'risk' | 'unknown'; reason: string; blockers: string[] };

/**
 * Whether something I owe is at risk because of what I am waiting on for it. It is
 * at risk when a blocker is likely to land later than the deadline less the buffer
 * I want for my own part.
 */
export function risk(it: Item, ctx: Ctx): Risk | null {
  if (it.direction !== 'owe' || it.status !== 'open' || !it.blockedBy.length) return null;
  const open = it.blockedBy.map((id) => ctx.doc.items.find((x) => x.id === id)).filter((x): x is Item => !!x && x.status === 'open');
  if (!open.length) return null;
  const reasons: string[] = [];
  let level: Risk['level'] | null = null;
  for (const b of open) {
    const exp = expectedArrival(b, ctx);
    if (!exp.day) {
      reasons.push(`Waiting on ${who(ctx, b)} for "${b.title}" with no date`);
      if (it.due) level = level ?? 'unknown';
      continue;
    }
    if (!it.due) continue;
    const latestUseful = addWorkingDays(it.due, -ctx.doc.settings.riskBuffer, ctx.cal);
    if (exp.day > latestUseful) {
      const left = workingDaysBetween(exp.day, it.due, ctx.cal);
      reasons.push(
        `${exp.reason}, so likely ${d(ctx, exp.day)}; you are due ${d(ctx, it.due)}${left > 0 ? `, leaving ${plural(left, 'working day')}` : left === 0 ? ', the same day' : ', after your deadline'}`,
      );
      level = 'risk';
    }
  }
  if (!level) return null;
  return { level, reason: reasons.join('. '), blockers: open.map((b) => b.id) };
}

// ── Suggestions ─────────────────────────────────────────────────────────────

export type Suggestion =
  | { kind: 'escalate'; itemId: string; reason: string }
  | { kind: 'dead'; itemId: string; reason: string }
  | { kind: 'risk'; itemId: string; reason: string }
  | { kind: 'slipping'; itemId: string; reason: string }
  | { kind: 'unneeded'; itemId: string; reason: string };

export function looksDead(it: Item, ctx: Ctx): string | null {
  if (it.direction !== 'wait' || it.status !== 'open' || isSnoozed(it, ctx.today)) return null;
  const s = ctx.doc.settings;
  const st = it.personId ? ctx.stats.get(it.personId) : undefined;
  const quiet = workingDaysBetween(lastMovement(it), ctx.today, ctx.cal);
  const usual = st?.learned && st.deliveryDays !== null ? Math.max(s.review.deadAfter, Math.round(3 * st.deliveryDays)) : s.review.deadAfter;
  const n = chasesSinceMovement(it);
  if (quiet >= usual && n >= s.chase.escalateAfter) {
    return `No movement in ${plural(quiet, 'working day')} and ${plural(n, 'chase')} unanswered${st?.learned ? `; ${who(ctx, it)} usually takes ${Math.round(st.deliveryDays ?? 0)}` : ''}`;
  }
  return null;
}

export function suggestions(ctx: Ctx): Suggestion[] {
  const out: Suggestion[] = [];
  for (const it of ctx.doc.items) {
    if (it.status !== 'open') continue;
    const dead = looksDead(it, ctx);
    if (dead) {
      out.push({ kind: 'dead', itemId: it.id, reason: dead });
      continue;
    }
    if (it.direction === 'wait' && !isSnoozed(it, ctx.today)) {
      const lv = chaseLevel(it, ctx.doc.settings);
      const plan = chasePlan(it, ctx);
      if (lv.level === 'escalate' && plan && plan.day <= ctx.today) out.push({ kind: 'escalate', itemId: it.id, reason: `Chased ${lv.reason}` });
    }
    const r = risk(it, ctx);
    if (r?.level === 'risk') out.push({ kind: 'risk', itemId: it.id, reason: r.reason });
  }
  // A recurring item whose record says its schedule does not fit: done late most of
  // the last four times, or skipped most of them. Only with three or more to go on.
  for (const s of allSeries(ctx.doc)) {
    if (!s.active || !s.current) continue;
    const last = s.items.filter((i) => i.status !== 'open').slice(-4);
    if (last.length < 3) continue;
    const late = last.filter((i) => outcome(i) === 'late');
    const skipped = last.filter((i) => outcome(i) === 'skipped').length;
    if (late.length >= 3) {
      const by = Math.round(median(late.map((i) => workingDaysBetween(i.due!, i.closedOn!, ctx.cal))) ?? 1);
      out.push({ kind: 'slipping', itemId: s.current.id, reason: `Done late ${late.length} of the last ${last.length} times, usually ${plural(by, 'working day')} after its day` });
    } else if (skipped >= 3) out.push({ kind: 'unneeded', itemId: s.current.id, reason: `Skipped ${skipped} of the last ${last.length} times` });
  }
  return out;
}

// ── Today ───────────────────────────────────────────────────────────────────

export type TodayEntry = { item: Item; reason: string; score: number };

export type Today = {
  due: TodayEntry[];
  chase: TodayEntry[];
  risk: TodayEntry[];
  unblocked: TodayEntry[];
  woke: TodayEntry[];
  soon: TodayEntry[];
};

function blocksSoon(it: Item, ctx: Ctx): Item | undefined {
  return ctx.doc.items.find(
    (o) => o.status === 'open' && o.direction === 'owe' && o.blockedBy.includes(it.id) && o.due && workingDaysBetween(ctx.today, o.due, ctx.cal) <= 5,
  );
}

/**
 * The day's list. Each item appears once, in the first section that claims it, and is
 * ordered within it by a score whose parts are the same facts the reason states.
 */
export function today(ctx: Ctx): Today {
  const out: Today = { due: [], chase: [], risk: [], unblocked: [], woke: [], soon: [] };
  const placed = new Set<string>();
  const put = (k: keyof Today, item: Item, reason: string, score: number) => {
    if (placed.has(item.id)) return;
    placed.add(item.id);
    out[k].push({ item, reason, score });
  };
  const open = ctx.doc.items.filter((i) => i.status === 'open');

  for (const it of open) {
    if (it.direction !== 'owe' || !it.due || isSnoozed(it, ctx.today)) continue;
    if (it.due <= ctx.today) {
      const late = workingDaysBetween(it.due, ctx.today, ctx.cal);
      put('due', it, late > 0 ? `Due ${d(ctx, it.due)}, ${plural(late, 'working day')} ago` : 'Due today', 100 + late * 10);
    }
  }
  for (const it of open) {
    if (it.direction !== 'wait' || isSnoozed(it, ctx.today)) continue;
    const plan = chasePlan(it, ctx);
    if (!plan || plan.day > ctx.today) continue;
    const overdue = workingDaysBetween(plan.day, ctx.today, ctx.cal);
    const blocks = blocksSoon(it, ctx);
    const missed = it.due && it.due < ctx.today;
    let reason = plan.reason;
    if (missed) reason = `Promise of ${d(ctx, it.due!)} missed. ${reason}`;
    if (blocks) reason += `. Your #${blocks.num} is due ${d(ctx, blocks.due!)}`;
    put('chase', it, reason, 50 + overdue * 5 + (blocks ? 30 : 0) + (missed ? 20 : 0) + age(it, ctx).waited);
  }
  for (const it of open) {
    const r = risk(it, ctx);
    if (r) put('risk', it, r.reason, r.level === 'risk' ? 40 : 20);
  }
  for (const it of open) {
    if (it.direction !== 'owe' || !it.blockedBy.length || isSnoozed(it, ctx.today)) continue;
    const blockers = it.blockedBy.map((id) => ctx.doc.items.find((x) => x.id === id)).filter((x): x is Item => !!x);
    if (!blockers.length || blockers.some((b) => b.status === 'open')) continue;
    const latest = blockers.map((b) => b.closedOn ?? '').sort().pop() ?? '';
    if (latest && workingDaysBetween(latest, ctx.today, ctx.cal) <= 3) {
      const names = blockers.map((b) => who(ctx, b)).filter((v, i, a) => a.indexOf(v) === i).join(' and ');
      put('unblocked', it, `${names} delivered ${d(ctx, latest)}; nothing is holding this up now`, 30);
    }
  }
  for (const it of open) {
    if (!it.snoozeUntil || it.snoozeUntil > ctx.today) continue;
    if (workingDaysBetween(it.snoozeUntil, ctx.today, ctx.cal) > 1) continue;
    put('woke', it, `Snoozed until ${d(ctx, it.snoozeUntil)}`, 10);
  }
  for (const it of open) {
    if (it.direction !== 'owe' || !it.due || isSnoozed(it, ctx.today)) continue;
    const left = workingDaysBetween(ctx.today, it.due, ctx.cal);
    if (left >= 1 && left <= 3) put('soon', it, `Due ${d(ctx, it.due)}`, 10 - left);
  }
  for (const k of Object.keys(out) as (keyof Today)[]) out[k].sort((a, b) => b.score - a.score || a.item.num - b.item.num);
  return out;
}

export function todayCount(t: Today): number {
  return t.due.length + t.chase.length + t.risk.length + t.unblocked.length + t.woke.length;
}

// ── The days ahead, and who owes what ───────────────────────────────────────

export type Upcoming = { item: Item; day: Day; kind: 'due' | 'promise' };

/**
 * What lands in the next few working days: my deadlines after today, and the dates
 * others promised me. Today's own deadlines are in Today's first section already.
 */
export function upcoming(ctx: Ctx, workingDays = 5): Upcoming[] {
  const until = addWorkingDays(ctx.today, workingDays, ctx.cal);
  const out: Upcoming[] = [];
  for (const it of ctx.doc.items) {
    if (it.status !== 'open' || !it.due || isSnoozed(it, ctx.today)) continue;
    if (it.due <= ctx.today || it.due > until) continue;
    out.push({ item: it, day: it.due, kind: it.direction === 'owe' ? 'due' : 'promise' });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.item.num - b.item.num);
}

export type Owed = { person: Person; count: number; oldest: number; chaseNow: string[] };

/** Open waiting items by person, most first: who owes me the most, and for how long. */
export function waitingByPerson(ctx: Ctx): Owed[] {
  const by = new Map<string, Owed>();
  for (const it of ctx.doc.items) {
    if (it.status !== 'open' || it.direction !== 'wait' || !it.personId) continue;
    const person = person_(ctx, it.personId);
    if (!person) continue;
    const cur = by.get(person.id) ?? { person, count: 0, oldest: 0, chaseNow: [] };
    cur.count++;
    cur.oldest = Math.max(cur.oldest, workingDaysBetween(it.askedOn, ctx.today, ctx.cal));
    const plan = chasePlan(it, ctx);
    if (plan && plan.day <= ctx.today && !isSnoozed(it, ctx.today)) cur.chaseNow.push(it.id);
    by.set(person.id, cur);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.oldest - a.oldest || a.person.name.localeCompare(b.person.name));
}

function person_(ctx: Ctx, id: string): Person | undefined {
  return ctx.doc.people.find((p) => p.id === id);
}
