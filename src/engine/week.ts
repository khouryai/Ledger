/**
 * A week at a glance: what falls due each day, what others promised and when to chase
 * them, what got done, and every recurring item's occurrences, done, due or still to
 * come. Worked out on every render, like Today: nothing here is stored.
 */
import { addDays, fmtDay, isWorkingDay, mondayOf, weekday } from './dates';
import { chasePlan, isSnoozed, type Ctx } from './decide';
import { firstName } from './people';
import { occurrencesAfter, ruleOf } from './recur';
import { allSeries, occurrenceDay, outcome, type Series } from './series';
import type { ChaseLevel, Day, Item } from './types';

export type WeekEntryKind = 'due' | 'promise' | 'chase' | 'planned' | 'closed';

export type WeekEntry = {
  kind: WeekEntryKind;
  item: Item;
  day: Day;
  /** Why it is on this day, in words. */
  reason: string;
  /** For a chase: which step of chasing it is. */
  level?: ChaseLevel;
};

export type WeekDay = {
  day: Day;
  /** False on a weekend or a holiday. */
  working: boolean;
  /** One of the usual working days that is a holiday this week. */
  holiday: boolean;
  entries: WeekEntry[];
};

export type WeekPlan = {
  /** Its Monday and its Sunday. */
  from: Day;
  to: Day;
  /** The usual working days, and any other day that has something on it. */
  days: WeekDay[];
  /** What I owe that fell due before this week and is still open. */
  overdue: Item[];
  /** What I owe with no date: things to give a day. */
  undated: Item[];
  counts: Record<WeekEntryKind, number>;
};

const ORDER: Record<WeekEntryKind, number> = { due: 0, promise: 1, chase: 2, planned: 3, closed: 4 };

function who(ctx: Ctx, it: Item): string {
  const p = ctx.doc.people.find((x) => x.id === it.personId);
  return p ? firstName(p) : 'They';
}

/** The Monday of the week `n` weeks from the one holding `day`. */
export function weekOf(day: Day, n = 0): Day {
  return addDays(mondayOf(day), 7 * n);
}

/**
 * Recurring occurrences still to come in [from, to]: worked out from each series'
 * occurrence in hand. Before today only those still owed (catching up) are shown; the
 * rest will be passed over when the one in hand is closed.
 */
function planned(ctx: Ctx, series: Series[], from: Day, to: Day): WeekEntry[] {
  const out: WeekEntry[] = [];
  for (const s of series) {
    const cur = s.current;
    if (!s.active || !cur?.due || !s.rule) continue;
    for (const day of occurrencesAfter(s.rule, cur.due, to, ctx.cal)) {
      if (day < from || (day < ctx.today && !s.rule.catchUp)) continue;
      out.push({ kind: 'planned', item: cur, day, reason: `Comes round again ${fmtDay(day, ctx.doc.settings.dateOrder, ctx.today)}` });
    }
  }
  return out;
}

export function weekPlan(ctx: Ctx, monday: Day): WeekPlan {
  const from = mondayOf(monday);
  const to = addDays(from, 6);
  const order = ctx.doc.settings.dateOrder;
  const d = (day: Day) => fmtDay(day, order, ctx.today);
  const inWeek = (day?: Day) => !!day && day >= from && day <= to;
  const entries: WeekEntry[] = [];
  const open = ctx.doc.items.filter((i) => i.status === 'open');

  for (const it of open) {
    if (!inWeek(it.due)) continue;
    if (it.direction === 'owe') entries.push({ kind: 'due', item: it, day: it.due!, reason: it.due! < ctx.today ? `Was due ${d(it.due!)}` : 'You are due' });
    else entries.push({ kind: 'promise', item: it, day: it.due!, reason: it.recur ? `Due from ${who(ctx, it)}` : `${who(ctx, it)} promised` });
  }
  // Chases from today on: one already due is today's. Past days have had theirs.
  if (ctx.today <= to) {
    for (const it of open) {
      if (it.direction !== 'wait' || isSnoozed(it, ctx.today)) continue;
      const plan = chasePlan(it, ctx);
      if (!plan) continue;
      const day = plan.day < ctx.today ? ctx.today : plan.day;
      if (!inWeek(day)) continue;
      entries.push({ kind: 'chase', item: it, day, level: plan.level, reason: plan.day < ctx.today ? `Chase due since ${d(plan.day)}. ${plan.reason}` : plan.reason });
    }
  }
  entries.push(...planned(ctx, allSeries(ctx.doc), from, to));
  for (const it of ctx.doc.items) {
    if (it.status === 'done' && inWeek(it.closedOn)) entries.push({ kind: 'closed', item: it, day: it.closedOn!, reason: it.direction === 'wait' ? 'Received' : 'Done' });
  }

  const usual = ctx.cal.workDays.length ? ctx.cal.workDays : [1, 2, 3, 4, 5];
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(from, i);
    const mine = entries
      .filter((e) => e.day === day)
      .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.item.num - b.item.num);
    const regular = usual.includes(weekday(day));
    if (!regular && !mine.length) continue;
    const working = isWorkingDay(day, ctx.cal);
    days.push({ day, working, holiday: regular && !working, entries: mine });
  }
  const counts = { due: 0, promise: 0, chase: 0, planned: 0, closed: 0 };
  for (const e of entries) counts[e.kind]++;
  return {
    from,
    to,
    days,
    overdue: open.filter((i) => i.direction === 'owe' && !!i.due && i.due < from && i.due < ctx.today).sort((a, b) => a.due!.localeCompare(b.due!) || a.num - b.num),
    undated: open.filter((i) => i.direction === 'owe' && !i.due && !isSnoozed(i, ctx.today)).sort((a, b) => a.num - b.num),
    counts,
  };
}

// ── Recurring items, a week at a time ───────────────────────────────────────

export type CellState = 'done' | 'late' | 'skipped' | 'dropped' | 'due' | 'overdue' | 'planned' | 'missed';

export type GridCell = {
  day: Day;
  state: CellState;
  /** The occurrence itself; for a planned or missed one, the one in hand. */
  item: Item;
};

export type GridRow = {
  series: Series;
  cells: GridCell[];
  /** The occurrence in hand fell due before this week and is still open. */
  overdueSince?: Day;
};

/**
 * Each recurring series' occurrences in a week, day by day: done (on time or late),
 * skipped, due, overdue, still to come, or passed by without being done. A series is
 * in it when it has something in the week, or is overdue from before it.
 */
export function routineGrid(ctx: Ctx, monday: Day): GridRow[] {
  const from = mondayOf(monday);
  const to = addDays(from, 6);
  const inWeek = (day?: Day) => !!day && day >= from && day <= to;
  const rows: GridRow[] = [];
  for (const s of allSeries(ctx.doc)) {
    const cells: GridCell[] = [];
    for (const it of s.items) {
      const day = occurrenceDay(it);
      if (!inWeek(day)) continue;
      const o = outcome(it);
      if (o) cells.push({ day, state: o, item: it });
      else if (it === s.current) cells.push({ day, state: day < ctx.today ? 'overdue' : 'due', item: it });
    }
    const rule = s.rule ?? (s.current ? ruleOf(s.current) : undefined);
    if (s.active && s.current?.due && rule) {
      for (const day of occurrencesAfter(rule, s.current.due, to, ctx.cal)) {
        if (day < from || cells.some((c) => c.day === day)) continue;
        cells.push({ day, state: day < ctx.today ? 'missed' : 'planned', item: s.current });
      }
    }
    const overdueSince = s.current?.due && s.current.due < from && s.current.due < ctx.today ? s.current.due : undefined;
    if (!cells.length && !overdueSince) continue;
    rows.push({ series: s, cells: cells.sort((a, b) => a.day.localeCompare(b.day)), overdueSince });
  }
  return rows;
}

const KIND_WORD: Record<WeekEntryKind, string> = { due: 'Due', promise: 'Expected', chase: 'Chase', planned: 'Recurring', closed: 'Done' };

/** The week in lines, to paste into an email or a status report. */
export function weekPlanText(plan: WeekPlan, ctx: Ctx): string {
  const o = ctx.doc.settings.dateOrder;
  const name = (it: Item) => {
    const p = ctx.doc.people.find((x) => x.id === it.personId);
    return p ? ` (${p.name})` : '';
  };
  const last = plan.days[plan.days.length - 1]?.day ?? plan.to;
  const lines = [`Week of ${fmtDay(plan.from, o)} to ${fmtDay(last, o)}`];
  for (const d of plan.days) {
    if (!d.entries.length) continue;
    lines.push('', `${fmtDay(d.day, o)}${d.holiday ? ' (holiday)' : ''}`);
    for (const e of d.entries) lines.push(`- ${KIND_WORD[e.kind]}: ${e.item.title}${name(e.item)}`);
  }
  if (plan.overdue.length) {
    lines.push('', 'Carried over:');
    for (const it of plan.overdue) lines.push(`- ${it.title}${name(it)}, due ${fmtDay(it.due, o)}`);
  }
  if (plan.undated.length) {
    lines.push('', 'No date yet:');
    for (const it of plan.undated) lines.push(`- ${it.title}${name(it)}`);
  }
  return lines.join('\n');
}
