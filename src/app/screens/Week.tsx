/**
 * The week: each day's deadlines, promises, chases and recurring items, what got done
 * on it, what is carried over and what has no date yet. Drag something you owe onto
 * another day to move its deadline, or a chase to make it on that day; the Move menu
 * on each card does the same from the keyboard or a phone.
 */
import { useLayoutEffect, useMemo, useState } from 'react';
import { addDays, dayNum, fmtDayLong, isDay, mondayOf, weekday } from '../../engine/dates';
import { firstName } from '../../engine/people';
import { ruleOf } from '../../engine/recur';
import type { Day, Item } from '../../engine/types';
import { weekOf, weekPlan, weekPlanText, type WeekDay, type WeekEntry, type WeekEntryKind } from '../../engine/week';
import { Icon } from '../components/icons';
import { useItemActions } from '../components/ItemRow';
import { GridKey, RoutineGrid } from '../components/RoutineGrid';
import { RecurLabel } from '../components/Schedule';
import { copyRich, Empty, Hero, IconButton, MenuButton, Section, Stat } from '../components/ui';
import { makeFmt } from '../format';
import { href, type Route } from '../router';
import { dialogOpen, useApp } from '../state';

const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const KIND_WORD: Record<WeekEntryKind, string> = { due: 'Due', promise: 'Promised', chase: 'Chase', planned: 'Comes round', closed: 'Done' };
const LEVEL_WORD = { nudge: 'nudge', firm: 'firm chase', escalate: 'escalation' } as const;
/** What a dragged card carries: which item, and whether its deadline or its chase moves. */
const DRAG = 'application/x-ledger-move';
type Drag = { id: string; what: 'due' | 'chase' };
type Show = 'all' | 'owe' | 'wait';

export function Week({ route }: { route: Route }) {
  const { state, ctx, ui, actions } = useApp();
  const w = route.params.get('w');
  const monday = w && isDay(w) ? mondayOf(w) : weekOf(state.today);
  const plan = useMemo(() => weekPlan(ctx, monday), [ctx, monday]);
  const fmt = makeFmt(state.doc.settings.dateOrder, state.today, ctx.cal);
  const offset = Math.round((dayNum(monday) - dayNum(weekOf(state.today))) / 7);
  const title = offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : `Week of ${fmtDayLong(monday)}`;
  const weekHref = (n: number) => (offset + n === 0 ? href('week') : href('week', { w: addDays(monday, 7 * n) }));
  const last = plan.days[plan.days.length - 1]?.day ?? plan.to;
  const [show, setShow] = useState<Show>('all');

  // Left and right arrows step a week back and on, from the moment the week is drawn.
  // The week is read from the address at the key press, not from this render, so two
  // quick presses go two weeks.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen(ui) || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const shown = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('w');
      const to = addDays(shown && isDay(shown) ? mondayOf(shown) : weekOf(state.today), e.key === 'ArrowLeft' ? -7 : 7);
      window.location.hash = to === weekOf(state.today) ? href('week') : href('week', { w: to });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui, state.today]);

  return (
    <div>
      <Hero
        eyebrow={`${fmt.day(plan.from)} to ${fmt.day(last)}`}
        title={title}
        sub="Each day's deadlines, the dates others promised, when to chase, and every recurring item. Drag something you owe to another day to move it; drag a chase to make it that day instead."
        stats={
          <>
            <Stat label="Due from me" value={plan.counts.due} tone={plan.counts.due ? 'red' : 'muted'} />
            <Stat label="Promised to me" value={plan.counts.promise} tone="blue" />
            <Stat label="To chase" value={plan.counts.chase} tone={plan.counts.chase ? 'amber' : 'muted'} />
            <Stat label="Done" value={plan.counts.closed} tone={plan.counts.closed ? 'good' : 'muted'} />
          </>
        }
        actions={
          <>
            <span className="week-nav" role="group" aria-label="Which week">
              <a className="btn" href={weekHref(-1)} aria-label="The week before" title="The week before (←)" data-testid="week-prev">
                <Icon name="chevronLeft" size={14} />
              </a>
              <a className={`btn${offset === 0 ? ' is-on' : ''}`} href={href('week')} aria-current={offset === 0 ? 'page' : undefined}>
                This week
              </a>
              <a className="btn" href={weekHref(1)} aria-label="The week after" title="The week after (→)" data-testid="week-next">
                <Icon name="chevron" size={14} />
              </a>
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => void copyRich(weekPlanText(plan, ctx)).then((ok) => actions.toast(ok ? 'Copied the week. Paste it into an email or a report.' : 'Could not reach the clipboard.', ok ? 'info' : 'error'))}
            >
              <Icon name="copy" size={14} /> Copy the week
            </button>
          </>
        }
      />
      <div className="page">
        <Section
          title="Recurring"
          aside={
            <a className="rail-link" href={href('recurring')}>
              Every recurring item <Icon name="chevron" size={12} />
            </a>
          }
        >
          <div className="list-card">
            <RoutineGrid
              monday={monday}
              days={plan.days.map((d) => d.day)}
              empty={
                <Empty icon="repeat" title="Nothing recurring this week.">
                  <button type="button" className="link" onClick={() => actions.setUi({ newRecurring: true })}>
                    Add a recurring item
                  </button>{' '}
                  or type <span className="mono">every friday</span> in the line at the top.
                </Empty>
              }
            />
          </div>
          <GridKey />
        </Section>
        <Section
          title="Day by day"
          aside={
            <div className="seg" role="group" aria-label="Show">
              {(['all', 'owe', 'wait'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
                  {k === 'all' ? 'Everything' : k === 'owe' ? 'I owe' : 'Waiting on'}
                </button>
              ))}
            </div>
          }
        >
          <div className="week-board" style={{ ['--cols' as string]: plan.days.length }} data-testid="week-board">
            {plan.days.map((d) => (
              <DayColumn key={d.day} day={show === 'all' ? d : { ...d, entries: d.entries.filter((e) => e.item.direction === show) }} days={plan.days} />
            ))}
          </div>
        </Section>
        {(plan.overdue.length > 0 || plan.undated.length > 0) && (
          <div className="week-more">
            {plan.overdue.length > 0 && (
              <Section title="Carried over" count={plan.overdue.length}>
                <p className="hint mb-2">Overdue from before this week. Drag one onto a day, or use Move, to give it a new date.</p>
                <div className="wday-list">
                  {plan.overdue.map((it) => (
                    <Card key={it.id} entry={{ kind: 'due', item: it, day: it.due!, reason: `Was due ${fmt.day(it.due)}` }} days={plan.days} note={`was due ${fmt.day(it.due)}`} />
                  ))}
                </div>
              </Section>
            )}
            {plan.undated.length > 0 && (
              <Section title="No date yet" count={plan.undated.length}>
                <p className="hint mb-2">Things you owe with no deadline. Give each a day and it comes up in time.</p>
                <div className="wday-list">
                  {plan.undated.map((it) => (
                    <Card key={it.id} entry={{ kind: 'due', item: it, day: '', reason: 'No date' }} days={plan.days} />
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function readDrag(e: React.DragEvent): Drag | null {
  try {
    const d = JSON.parse(e.dataTransfer.getData(DRAG)) as Drag;
    return typeof d.id === 'string' && (d.what === 'due' || d.what === 'chase') ? d : null;
  } catch {
    return null;
  }
}

function DayColumn({ day, days }: { day: WeekDay; days: WeekDay[] }) {
  const { state, ctx } = useApp();
  const a = useItemActions();
  const fmt = makeFmt(state.doc.settings.dateOrder, state.today, ctx.cal);
  const [over, setOver] = useState(false);
  const isToday = day.day === state.today;
  // A deadline or a chase can be moved to today or later; the past has been.
  const takes = day.day >= state.today;
  const open = day.entries.filter((e) => e.kind !== 'closed').length;
  return (
    <div
      role="group"
      className={`wday${isToday ? ' is-today' : ''}${day.day < state.today ? ' is-past' : ''}${day.working ? '' : ' is-off'}${over ? ' is-over' : ''}`}
      aria-label={`${WD[weekday(day.day)]} ${fmt.day(day.day)}${isToday ? ', today' : ''}${day.holiday ? ', a holiday' : ''}`}
      data-day={day.day}
      onDragOver={(e) => {
        if (!takes || !e.dataTransfer.types.includes(DRAG)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const d = readDrag(e);
        const it = d && state.doc.items.find((x) => x.id === d.id);
        if (!d || !it) return;
        if (d.what === 'chase') a.chaseOn(it, day.day);
        else if (it.due !== day.day) a.move(it, day.day);
      }}
    >
      <header className="wday-h">
        <span className="wday-name">{WD[weekday(day.day)].slice(0, 3)}</span>
        <span className="wday-date">{Number(day.day.slice(8, 10))}</span>
        {isToday && <span className="wday-tag">Today</span>}
        {day.holiday && <span className="wday-tag is-off">Holiday</span>}
        <span className="wday-n" aria-label={`${open} to do`}>
          {open || ''}
        </span>
      </header>
      <div className="wday-list">
        {day.entries.map((e) => (
          <Card key={`${e.kind}-${e.item.id}-${e.day}`} entry={e} days={days} />
        ))}
        {!day.entries.length && <div className="wday-empty">{day.working ? 'Nothing yet' : 'Day off'}</div>}
      </div>
    </div>
  );
}

/** Where a card can be moved to: the days of this week from today, and next week's first. */
function moveTargets(it: Item, what: 'due' | 'chase', days: WeekDay[], today: Day, fmtDay: (d: Day) => string, a: ReturnType<typeof useItemActions>) {
  const current = what === 'due' ? it.due : undefined;
  const choices = days.filter((d) => d.day >= today && d.working && d.day !== current).map((d) => ({ label: `${WD[weekday(d.day)]} ${fmtDay(d.day).split(' ')[1]}`, day: d.day }));
  const nextMonday = a.moveChoices().find((c) => c.label === 'Start of next week');
  if (nextMonday && !choices.some((c) => c.day === nextMonday.day)) choices.push({ label: `Next week (${fmtDay(nextMonday.day)})`, day: nextMonday.day });
  return choices.map((c) => ({ label: c.label, onClick: () => (what === 'chase' ? a.chaseOn(it, c.day) : a.move(it, c.day)) }));
}

function Card({ entry, days, note }: { entry: WeekEntry; days: WeekDay[]; note?: string }) {
  const { state, ctx } = useApp();
  const a = useItemActions();
  const fmt = makeFmt(state.doc.settings.dateOrder, state.today, ctx.cal);
  const it = entry.item;
  const p = state.doc.people.find((x) => x.id === it.personId);
  const open = it.status === 'open';
  const what: 'due' | 'chase' | null = open && entry.kind === 'due' && it.direction === 'owe' ? 'due' : open && entry.kind === 'chase' ? 'chase' : null;
  const rule = ruleOf(it);
  const late = entry.kind === 'due' && !!it.due && it.due < state.today;
  return (
    <div
      className={`wcard wcard-${entry.kind}${late ? ' is-late' : ''}${what ? ' is-movable' : ''}`}
      title={entry.reason}
      draggable={!!what}
      onDragStart={(e) => {
        if (!what) return;
        e.dataTransfer.setData(DRAG, JSON.stringify({ id: it.id, what } satisfies Drag));
        e.dataTransfer.effectAllowed = 'move';
      }}
      data-item={it.num}
      data-kind={entry.kind}
    >
      <button type="button" className="wcard-open" onClick={() => a.open(it)} aria-label={`${KIND_WORD[entry.kind]}: #${it.num} ${it.title}. ${entry.reason}.`}>
        <span className="wcard-kind">
          {KIND_WORD[entry.kind]}
          {late && ' · late'}
        </span>
        <span className="wcard-title">{it.title}</span>
      </button>
      <span className="wcard-foot">
        <span className="wcard-sub">
          {p && <span className="wcard-who">{firstName(p)}</span>}
          {note && <span>{note}</span>}
          {entry.kind === 'chase' && entry.level && <span>{LEVEL_WORD[entry.level]}</span>}
          {entry.kind === 'promise' && <span>{rule ? 'due from them' : 'their date'}</span>}
          {rule && <RecurLabel recur={rule} />}
        </span>
        {open && entry.kind !== 'planned' && (
          <span className="wcard-acts">
            {entry.kind === 'chase' && <IconButton icon="mail" label={`Chase #${it.num}`} onClick={() => a.chase([it.id])} />}
            {(entry.kind === 'due' || entry.kind === 'promise') && <IconButton icon="check" label={`${it.direction === 'wait' ? 'Received' : 'Done'}: #${it.num}`} onClick={() => a.close(it)} testid={`week-done-${it.num}`} />}
            {what && <MenuButton label={`Move #${it.num}`} icon="move" items={moveTargets(it, what, days, state.today, fmt.day, a)} testid={`week-move-${it.num}`} />}
          </span>
        )}
      </span>
    </div>
  );
}

