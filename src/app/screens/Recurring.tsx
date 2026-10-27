/**
 * Recurring: everything that comes back on a schedule, defined in one place. Each one
 * shows its schedule in words, when the next is due and how it has gone; this week's
 * are a grid of days. Only the one in hand is on the working lists; the next goes on
 * when it is closed or skipped.
 */
import { useEffect, useMemo } from 'react';
import { age } from '../../engine/decide';
import { describeRecurrence } from '../../engine/recur';
import { allSeries, occurrenceDay, outcome, type Outcome, type Series } from '../../engine/series';
import type { Item } from '../../engine/types';
import { routineGrid, weekOf, weekPlan } from '../../engine/week';
import { Icon } from '../components/icons';
import { useItemActions } from '../components/ItemRow';
import { GridKey, RoutineGrid, useSeriesMenu } from '../components/RoutineGrid';
import { Avatar, Badge, Empty, Hero, IconButton, MenuButton, Section, Stat } from '../components/ui';
import { makeFmt } from '../format';
import { href, type Route } from '../router';
import { useApp } from '../state';

const OUTCOME_WORD: Record<Outcome, string> = { done: 'done on time', late: 'done late', skipped: 'skipped', dropped: 'dropped' };

export function Recurring({ route }: { route: Route }) {
  const { state, ctx, actions } = useApp();
  const doc = state.doc;
  const series = useMemo(() => allSeries(doc), [doc]);
  const active = series.filter((s) => s.active);
  const stopped = series.filter((s) => !s.active);
  const monday = weekOf(state.today);
  const days = useMemo(() => weekPlan(ctx, monday).days.map((d) => d.day), [ctx, monday]);
  const cells = useMemo(() => routineGrid(ctx, monday).flatMap((r) => r.cells), [ctx, monday]);
  const doneThisWeek = cells.filter((c) => c.state === 'done' || c.state === 'late').length;
  const dueThisWeek = cells.filter((c) => c.state !== 'skipped' && c.state !== 'dropped').length;
  const overdue = active.filter((s) => s.current?.due && s.current.due < state.today).length;
  const done = active.reduce((n, s) => n + s.record.done, 0);
  const onTime = active.reduce((n, s) => n + s.record.onTime, 0);

  // #/recurring?new=1 opens the form, from the command menu or a link.
  useEffect(() => {
    if (route.params.get('new') !== '1') return;
    actions.setUi({ newRecurring: true });
    history.replaceState(null, '', '#/recurring');
  }, [route, actions]);

  const groups = [
    { title: 'Daily', items: active.filter((s) => s.rule?.unit === 'day') },
    { title: 'Weekly', items: active.filter((s) => s.rule?.unit === 'week') },
    { title: 'Monthly and less often', items: active.filter((s) => s.rule?.unit === 'month') },
  ];

  return (
    <div>
      <Hero
        eyebrow="Work"
        title="Recurring"
        sub="Everything that comes back on a schedule, in one place: what it is, when it comes round, and how it has gone. Only the one in hand is on your lists; closing or skipping it puts the next one on."
        stats={
          <>
            <Stat label="Repeating" value={active.length} />
            <Stat label="Done this week" value={`${doneThisWeek} of ${dueThisWeek}`} tone={dueThisWeek && doneThisWeek === dueThisWeek ? 'good' : 'blue'} />
            <Stat label="Overdue" value={overdue} tone={overdue ? 'red' : 'muted'} />
            {done > 0 && <Stat label="On time" value={`${Math.round((onTime / done) * 100)}%`} tone={onTime / done >= 0.8 ? 'good' : 'amber'} />}
          </>
        }
        actions={
          <button type="button" className="btn btn-primary" onClick={() => actions.setUi({ newRecurring: true })} data-testid="recurring-new">
            <Icon name="plus" size={14} /> New recurring item
          </button>
        }
      />
      <div className="page">
        {!series.length ? (
          <FirstRecurring />
        ) : (
          <>
            <Section
              title="This week"
              aside={
                <a className="rail-link" href={href('week')}>
                  The whole week <Icon name="chevron" size={12} />
                </a>
              }
            >
              <div className="list-card">
                <RoutineGrid monday={monday} days={days} empty={<Empty icon="check" title="Nothing recurring falls this week." />} />
              </div>
              <GridKey />
            </Section>
            {groups.map(
              (g) =>
                g.items.length > 0 && (
                  <Section key={g.title} title={g.title} count={g.items.length}>
                    <div className="list-card rows">
                      {g.items.map((s) => (
                        <SeriesRow key={s.id} series={s} />
                      ))}
                    </div>
                  </Section>
                ),
            )}
            {stopped.length > 0 && (
              <Section title="Stopped" count={stopped.length}>
                <div className="list-card rows">
                  {stopped.map((s) => (
                    <SeriesRow key={s.id} series={s} />
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The last few occurrences as dots, oldest first: how it has been going at a glance. */
function Outcomes({ items }: { items: Item[] }) {
  const { state, ctx } = useApp();
  const fmt = makeFmt(state.doc.settings.dateOrder, state.today, ctx.cal);
  if (!items.length) return null;
  const words = items.map((i) => `${fmt.day(occurrenceDay(i))} ${OUTCOME_WORD[outcome(i)!]}`).join(', ');
  return (
    <span className="dots" role="img" aria-label={`The last ${items.length}: ${words}`} title={words}>
      {items.map((i) => (
        <span key={i.id} className={`dot dot-${outcome(i)}`} />
      ))}
    </span>
  );
}

function SeriesRow({ series: s }: { series: Series }) {
  const { state, ctx, actions } = useApp();
  const doc = state.doc;
  const fmt = makeFmt(doc.settings.dateOrder, state.today, ctx.cal);
  const a = useItemActions();
  const menu = useSeriesMenu();
  const cur = s.current;
  const p = doc.people.find((x) => x.id === s.head.personId);
  const r = s.record;
  const recent = s.items.filter((i) => i.status !== 'open').slice(-8);
  const ag = cur ? age(cur, ctx) : null;
  const steps = cur?.steps;
  return (
    <div className={`row series-row${s.active ? '' : ' is-closed'}`} data-testid="series" data-series={s.head.title}>
      <span className={`dir-ico dir-${s.head.direction}`} title={s.head.direction === 'owe' ? 'I owe' : 'Waiting on'}>
        <Icon name={s.head.direction} size={14} />
      </span>
      <div className="min-w-0">
        <button type="button" className="row-open" onClick={() => a.open(cur ?? s.head)} aria-label={`${s.head.title}. ${s.rule ? describeRecurrence(s.rule) : 'No longer repeats'}.`}>
          <span className="row-title">{s.head.title}</span>
        </button>
        <div className="series-when">
          <span className="series-sched">
            <Icon name="repeat" size={13} />
            <b>{s.rule && s.active ? describeRecurrence(s.rule, { order: doc.settings.dateOrder, today: state.today }) : 'No longer repeats'}</b>
          </span>
          {p && (
            <a href={href('people', { id: p.id })} className="row-person">
              <Avatar name={p.name} size={18} /> {s.head.direction === 'owe' ? 'for' : 'from'} {p.name}
            </a>
          )}
        </div>
        <div className="row-meta">
          {cur?.due ? (
            <>
              {ag && <Badge tone={ag.tone}>{ag.label}</Badge>}
              <span title="When the one in hand is due">{fmt.day(cur.due)}</span>
            </>
          ) : cur ? (
            <Badge tone="muted">No date</Badge>
          ) : null}
          <Outcomes items={recent} />
          {r.done > 0 ? (
            <span>
              On time {r.onTime} of {r.done}
              {r.streak > 1 ? ` · ${r.streak} in a row` : ''}
            </span>
          ) : (
            s.active && <span>None done yet</span>
          )}
          {r.skipped > 0 && <span>{r.skipped} skipped</span>}
          {!s.active && r.lastDone && <span>Last done {fmt.day(r.lastDone)}</span>}
          {steps && (
            <span className="inline-flex items-center gap-1">
              <Icon name="steps" size={12} /> {steps.filter((x) => x.done).length}/{steps.length} steps
            </span>
          )}
          {s.head.tags.map((t) => (
            <span key={t} className="row-tag">
              #{t}
            </span>
          ))}
        </div>
      </div>
      <div className="row-acts">
        {cur ? (
          <>
            <IconButton icon="check" label={`${cur.direction === 'wait' ? 'Received' : 'Done'}: ${s.head.title}`} onClick={() => a.close(cur)} testid={`series-done-${cur.num}`} />
            {cur.recur && <IconButton icon="skip" label={`Skip this one: ${s.head.title}`} onClick={() => a.skip(cur)} testid={`series-skip-${cur.num}`} />}
            <MenuButton label={`More for ${s.head.title}`} icon="more" items={menu(cur)} testid={`series-more-${cur.num}`} />
          </>
        ) : (
          <button type="button" className="btn btn-mini" onClick={() => actions.setUi({ schedule: { kind: 'restart', seriesId: s.id } })} data-testid="series-restart">
            <Icon name="repeat" size={12} /> Start again
          </button>
        )}
      </div>
    </div>
  );
}

function FirstRecurring() {
  const { actions } = useApp();
  return (
    <div className="card">
      <div className="card-title">Nothing recurring yet</div>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">
        A timesheet every Friday, a report on the last working day of the month, results someone sends every Monday. Define each one once, with its schedule and the steps it takes,
        and it comes back on its own: only the one in hand is on your lists.
      </p>
      <button type="button" className="btn btn-primary mt-3" onClick={() => actions.setUi({ newRecurring: true })}>
        <Icon name="plus" size={14} /> New recurring item
      </button>
      <p className="mt-4 text-[13px]">Or type one in the line at the top:</p>
      <ul className="mt-2 flex flex-col gap-2 text-[13px]">
        <li>
          <span className="mono">owe: timesheet every friday</span>
        </li>
        <li>
          <span className="mono">owe: progress report every last working day</span>
        </li>
        <li>
          <span className="mono">@Sam regression results every other monday</span>
        </li>
        <li>
          <span className="mono">owe: site diary every working day until 12/18</span>
        </li>
      </ul>
    </div>
  );
}
