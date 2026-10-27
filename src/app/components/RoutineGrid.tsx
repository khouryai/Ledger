/**
 * Recurring items a week at a time: a row each, a column a day, and on each day one
 * falls a mark for how it went or is going. A mark opens what it stands for; the
 * row's own buttons close, skip or pause the one in hand.
 */
import { useMemo } from 'react';
import { weekday } from '../../engine/dates';
import { updateItem } from '../../engine/ops';
import { firstName } from '../../engine/people';
import type { Day, Item } from '../../engine/types';
import { routineGrid, type CellState, type GridCell } from '../../engine/week';
import { makeFmt } from '../format';
import { useApp } from '../state';
import { Icon, type IconName } from './icons';
import { useItemActions } from './ItemRow';
import { RecurLabel } from './Schedule';
import { Badge, IconButton, MenuButton } from './ui';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const CELL_WORD: Record<CellState, string> = {
  done: 'done on time',
  late: 'done late',
  skipped: 'skipped',
  dropped: 'dropped',
  due: 'due',
  overdue: 'overdue',
  planned: 'still to come',
  missed: 'went by while the one before was open',
};

const GLYPH: Partial<Record<CellState, IconName>> = { done: 'check', late: 'check', skipped: 'skip', dropped: 'x' };

function Mark({ cell, title }: { cell: GridCell; title: string }) {
  const { state, ctx, actions } = useApp();
  const fmt = makeFmt(state.doc.settings.dateOrder, state.today, ctx.cal);
  const label = `${title}, ${fmt.day(cell.day)}: ${CELL_WORD[cell.state]}`;
  const glyph = GLYPH[cell.state];
  return (
    <button type="button" className={`mark mark-${cell.state}`} aria-label={label} title={label} onClick={() => actions.setUi({ openItem: cell.item.id })} data-state={cell.state}>
      {glyph ? <Icon name={glyph} size={12} /> : cell.state === 'overdue' ? '!' : null}
    </button>
  );
}

/** The menu of what can be done to a recurring item's one in hand. */
export function useSeriesMenu() {
  const { actions } = useApp();
  const a = useItemActions();
  return (it: Item) => [
    ...(it.recur ? [{ label: 'Skip this one', onClick: () => a.skip(it) }, { label: 'Pause until…', onClick: () => a.pause(it) }] : []),
    { label: it.recur ? 'Change the schedule' : 'Make it repeat', onClick: () => a.schedule(it) },
    ...(it.recur
      ? [{ label: 'Stop repeating', onClick: () => actions.apply((d) => updateItem(d, it.id, { recur: undefined }, new Date()), `#${it.num} no longer repeats. It stays on your list as a one-off.`) }]
      : []),
    { label: 'Open it', onClick: () => a.open(it) },
  ];
}

export function RoutineGrid({ monday, days, empty }: { monday: Day; days: Day[]; empty?: React.ReactNode }) {
  const { state, ctx } = useApp();
  const doc = state.doc;
  const fmt = makeFmt(doc.settings.dateOrder, state.today, ctx.cal);
  const a = useItemActions();
  const menu = useSeriesMenu();
  const rows = useMemo(() => routineGrid(ctx, monday), [ctx, monday]);
  // Every day with a mark gets a column, even one the week would not show.
  const cols = useMemo(() => [...new Set([...days, ...rows.flatMap((r) => r.cells.map((c) => c.day))])].sort(), [days, rows]);
  if (!rows.length) return <>{empty ?? null}</>;
  return (
    <div className="rgrid-wrap">
      <table className="rgrid" data-testid="routine-grid">
        <thead>
          <tr>
            <th scope="col" className="rgrid-name">
              Recurring
            </th>
            {cols.map((d) => (
              <th key={d} scope="col" className={d === state.today ? 'is-today' : ''} aria-label={fmt.day(d)}>
                <span>{WD[weekday(d)]}</span>
                <b>{Number(d.slice(8, 10))}</b>
              </th>
            ))}
            <th scope="col" className="rgrid-acts">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const s = row.series;
            const cur = s.current;
            const p = doc.people.find((x) => x.id === s.head.personId);
            return (
              <tr key={s.id} data-series={s.head.title}>
                <th scope="row" className="rgrid-name">
                  <button type="button" className="rgrid-title" onClick={() => a.open(cur ?? s.head)}>
                    {s.head.title}
                  </button>
                  <span className="rgrid-sub">
                    {s.rule && <RecurLabel recur={s.rule} />}
                    {p && (
                      <span>
                        {s.head.direction === 'owe' ? 'for' : 'from'} {firstName(p)}
                      </span>
                    )}
                    {row.overdueSince && <Badge tone="bad">Overdue since {fmt.day(row.overdueSince)}</Badge>}
                  </span>
                </th>
                {cols.map((d) => {
                  const c = row.cells.find((x) => x.day === d);
                  return (
                    <td key={d} className={d === state.today ? 'is-today' : ''}>
                      {c ? <Mark cell={c} title={s.head.title} /> : <span className="mark-none" aria-hidden="true" />}
                    </td>
                  );
                })}
                <td className="rgrid-acts">
                  {cur?.status === 'open' && (
                    <span className="flex justify-end">
                      <IconButton icon="check" label={`${cur.direction === 'wait' ? 'Received' : 'Done'}: ${s.head.title}, due ${fmt.day(cur.due)}`} onClick={() => a.close(cur)} testid={`grid-done-${cur.num}`} />
                      <MenuButton label={`More for ${s.head.title}`} icon="more" items={menu(cur)} testid={`grid-more-${cur.num}`} />
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The key to the marks, for the foot of a grid. */
export function GridKey() {
  const shown: CellState[] = ['done', 'late', 'skipped', 'due', 'overdue', 'planned', 'missed'];
  return (
    <div className="rgrid-key" aria-hidden="true">
      {shown.map((st) => (
        <span key={st}>
          <span className={`mark mark-${st} is-key`}>{GLYPH[st] ? <Icon name={GLYPH[st]!} size={10} /> : st === 'overdue' ? '!' : null}</span>
          {CELL_WORD[st] === 'went by while the one before was open' ? 'missed' : CELL_WORD[st]}
        </span>
      ))}
    </div>
  );
}
