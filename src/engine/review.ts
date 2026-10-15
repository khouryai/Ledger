/**
 * The weekly review, the week's summary, a meeting's agenda and searching.
 */
import { addDays, fmtDay, mondayOf, plural, weekday, workingDaysBetween } from './dates';
import { age, isSnoozed, type Ctx } from './decide';
import { firstName, normName } from './people';
import { eventDay, lastTouch } from './stats';
import type { Day, Item, LedgerDoc, Meeting } from './types';

/**
 * Items nobody has touched in a while, oldest first. A tracker that is not reviewed
 * fills up with dead items until nobody trusts it, so this is the list that keeps it
 * honest: each one is kept, chased, snoozed, closed or dropped.
 */
export function reviewQueue(ctx: Ctx): Item[] {
  const n = ctx.doc.settings.review.staleAfter;
  return ctx.doc.items
    .filter((it) => it.status === 'open' && !isSnoozed(it, ctx.today))
    .map((it) => ({ it, idle: workingDaysBetween(lastTouch(it), ctx.today, ctx.cal) }))
    .filter((x) => x.idle >= n)
    .sort((a, b) => b.idle - a.idle || a.it.num - b.it.num)
    .map((x) => x.it);
}

/** True on or after the review day of a week in which the review has not been done. */
export function reviewDue(doc: LedgerDoc, today: Day): boolean {
  const s = doc.settings.review;
  const monday = mondayOf(today);
  const reviewDay = addDays(monday, (s.weekday + 6) % 7);
  if (today < reviewDay) return false;
  return !s.lastDone || s.lastDone < reviewDay;
}

export type WeekSummary = {
  from: Day;
  to: Day;
  opened: Item[];
  done: Item[];
  received: Item[];
  dropped: Item[];
  overdue: Item[];
  waiting: Item[];
  oldestWaiting?: { item: Item; days: number };
  owesMost: { personId: string; name: string; count: number }[];
};

export function weekSummary(ctx: Ctx): WeekSummary {
  const from = mondayOf(ctx.today);
  const to = ctx.today;
  const inWeek = (d?: Day) => !!d && d >= from && d <= to;
  const items = ctx.doc.items;
  const created = (it: Item) => {
    const e = it.history.find((h) => h.kind === 'created');
    return e ? eventDay(e) : it.askedOn;
  };
  const waiting = items.filter((i) => i.status === 'open' && i.direction === 'wait');
  const oldest = waiting
    .map((item) => ({ item, days: workingDaysBetween(item.askedOn, ctx.today, ctx.cal) }))
    .sort((a, b) => b.days - a.days)[0];
  const counts = new Map<string, number>();
  for (const w of waiting) if (w.personId) counts.set(w.personId, (counts.get(w.personId) ?? 0) + 1);
  const owesMost = [...counts.entries()]
    .map(([personId, count]) => ({ personId, count, name: ctx.doc.people.find((p) => p.id === personId)?.name ?? 'Unknown' }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3);
  return {
    from,
    to,
    opened: items.filter((i) => inWeek(created(i))),
    done: items.filter((i) => i.status === 'done' && i.direction === 'owe' && inWeek(i.closedOn)),
    received: items.filter((i) => i.status === 'done' && i.direction === 'wait' && inWeek(i.closedOn)),
    dropped: items.filter((i) => i.status === 'dropped' && inWeek(i.closedOn)),
    overdue: items.filter((i) => i.status === 'open' && i.direction === 'owe' && !!i.due && i.due < ctx.today),
    waiting,
    oldestWaiting: oldest,
    owesMost,
  };
}

export function weekSummaryText(s: WeekSummary, ctx: Ctx): string {
  const o = ctx.doc.settings.dateOrder;
  const name = (it: Item) => {
    const p = ctx.doc.people.find((x) => x.id === it.personId);
    return p ? ` (${p.name})` : '';
  };
  const lines = [
    `Week of ${fmtDay(s.from, o)} to ${fmtDay(s.to, o)}`,
    '',
    `Opened: ${s.opened.length}. Closed: ${s.done.length + s.received.length} (${s.done.length} done, ${s.received.length} received)${s.dropped.length ? `, ${s.dropped.length} dropped` : ''}.`,
    `Still waiting on others: ${s.waiting.length}. Overdue from me: ${s.overdue.length}.`,
  ];
  if (s.oldestWaiting) lines.push(`Oldest wait: "${s.oldestWaiting.item.title}"${name(s.oldestWaiting.item)}, ${plural(s.oldestWaiting.days, 'working day')}.`);
  if (s.owesMost.length) lines.push(`Most outstanding: ${s.owesMost.map((x) => `${x.name} (${x.count})`).join(', ')}.`);
  if (s.done.length || s.received.length) {
    lines.push('', 'Closed this week:');
    for (const it of [...s.done, ...s.received]) lines.push(`- ${it.title}${name(it)}`);
  }
  if (s.overdue.length) {
    lines.push('', 'Overdue from me:');
    for (const it of s.overdue) lines.push(`- ${it.title}${name(it)}, due ${fmtDay(it.due, o)}`);
  }
  return lines.join('\n');
}

// ── Meetings ────────────────────────────────────────────────────────────────

/** Open items raised at earlier sessions of a meeting: the next session's agenda. */
export function agenda(meeting: Meeting, doc: LedgerDoc, beforeSession?: string): Item[] {
  return doc.items
    .filter((it) => it.status === 'open' && it.source?.meetingId === meeting.id && it.source.sessionId !== beforeSession)
    .sort((a, b) => a.askedOn.localeCompare(b.askedOn) || a.num - b.num);
}

export function sessionItems(meeting: Meeting, sessionId: string, doc: LedgerDoc): Item[] {
  return doc.items.filter((it) => it.source?.meetingId === meeting.id && it.source.sessionId === sessionId).sort((a, b) => a.num - b.num);
}

// ── Search ──────────────────────────────────────────────────────────────────

/** Every word must appear somewhere in the item: title, person, tags, notes, source, number. */
export function matches(it: Item, query: string, doc: LedgerDoc): boolean {
  const q = normName(query);
  if (!q) return true;
  const p = doc.people.find((x) => x.id === it.personId);
  const hay = normName(
    [
      `#${it.num}`,
      String(it.num),
      it.title,
      p?.name,
      p?.company,
      p ? firstName(p) : '',
      it.tags.join(' '),
      it.notes,
      it.source?.ref,
      it.closeNote,
      it.history.map((h) => h.text ?? '').join(' '),
    ]
      .filter(Boolean)
      .join(' '),
  );
  return q.split(' ').every((w) => hay.includes(w));
}

export type ItemFilter = {
  direction?: 'owe' | 'wait';
  status?: 'open' | 'closed' | 'all' | 'snoozed';
  personId?: string;
  tag?: string;
  query?: string;
};

export function filterItems(ctx: Ctx, f: ItemFilter): Item[] {
  return ctx.doc.items.filter((it) => {
    if (f.direction && it.direction !== f.direction) return false;
    const st = f.status ?? 'open';
    if (st === 'open' && (it.status !== 'open' || isSnoozed(it, ctx.today))) return false;
    if (st === 'snoozed' && (it.status !== 'open' || !isSnoozed(it, ctx.today))) return false;
    if (st === 'closed' && it.status === 'open') return false;
    if (f.personId && it.personId !== f.personId) return false;
    if (f.tag && !it.tags.some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false;
    if (f.query && !matches(it, f.query, ctx.doc)) return false;
    return true;
  });
}

/** Sort for a working list: worst first by the same tone the row shows. */
export function sortWorking(items: Item[], ctx: Ctx): Item[] {
  const rank = { bad: 0, warn: 1, info: 2, good: 3, muted: 4 } as const;
  return [...items].sort((a, b) => {
    const ta = rank[age(a, ctx).tone];
    const tb = rank[age(b, ctx).tone];
    if (ta !== tb) return ta - tb;
    const da = a.due ?? '9999';
    const db = b.due ?? '9999';
    if (da !== db) return da < db ? -1 : 1;
    return a.askedOn.localeCompare(b.askedOn) || a.num - b.num;
  });
}

export function allTags(doc: LedgerDoc): string[] {
  const set = new Map<string, string>();
  for (const it of doc.items) for (const t of it.tags) if (!set.has(t.toLowerCase())) set.set(t.toLowerCase(), t);
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}

/** Is this the user's weekday name for the review day? "Friday". */
export function weekdayName(n: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n] ?? '';
}

export { weekday };
