import { useEffect, useState } from 'react';
import { addWorkingDays } from '../../engine/dates';
import { age, chasePlan, isSnoozed, risk } from '../../engine/decide';
import { calendarOf, complete, snooze } from '../../engine/ops';
import type { Day, Item } from '../../engine/types';
import { makeFmt } from '../format';
import { href } from '../router';
import { useApp } from '../state';
import { Icon } from './icons';
import { Badge, IconButton, MenuButton } from './ui';

/** Snooze choices, as days from today. */
export function snoozeChoices(today: Day, cal: ReturnType<typeof calendarOf>): { label: string; day: Day }[] {
  const nextMon = (() => {
    const d = new Date(`${today}T12:00:00`);
    const add = ((8 - d.getDay()) % 7) || 7;
    d.setDate(d.getDate() + add);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  return [
    { label: 'Tomorrow', day: addWorkingDays(today, 1, cal) },
    { label: 'In 3 working days', day: addWorkingDays(today, 3, cal) },
    { label: 'Next Monday', day: nextMon },
    { label: 'In two weeks', day: addWorkingDays(today, 10, cal) },
  ];
}

export function useItemActions() {
  const { state, actions } = useApp();
  const cal = calendarOf(state.doc.settings);
  return {
    close: (it: Item, note?: string) =>
      actions.apply(
        (d) => complete(d, it.id, note, new Date()).doc,
        () => `${it.direction === 'wait' ? 'Received' : 'Done'}: #${it.num}${it.recur ? '. The next one is on the list.' : ''}`,
      ),
    snooze: (it: Item, day: Day | undefined) => actions.apply((d) => snooze(d, it.id, day, new Date()), day ? `Snoozed #${it.num}` : `Woke #${it.num}`),
    chase: (ids: string[]) => actions.setUi({ chase: { itemIds: ids } }),
    open: (it: Item) => actions.setUi({ openItem: it.id }),
    snoozeChoices: () => snoozeChoices(state.today, cal),
  };
}

export function ItemRow({ item, reason, selected, onSelect }: { item: Item; reason?: string; selected?: boolean; onSelect?: () => void }) {
  const { state, ctx } = useApp();
  const doc = state.doc;
  const fmt = makeFmt(doc.settings.dateOrder, state.today, ctx.cal);
  const a = useItemActions();
  const p = doc.people.find((x) => x.id === item.personId);
  const ag = age(item, ctx);
  const plan = chasePlan(item, ctx);
  const rk = risk(item, ctx);
  const blockers = item.blockedBy.map((id) => doc.items.find((x) => x.id === id)).filter((x): x is Item => !!x && x.status === 'open');
  const snoozed = isSnoozed(item, state.today);

  return (
    <div
      className={`row${selected ? ' is-sel' : ''}`}
      role="button"
      tabIndex={-1}
      data-item={item.num}
      onClick={() => {
        onSelect?.();
        a.open(item);
      }}
    >
      <div className="row-num">#{item.num}</div>
      <div className="row-dir">
        <span className={`dir-ico dir-${item.direction}`} title={item.direction === 'owe' ? 'I owe' : 'Waiting on'}>
          <Icon name={item.direction} size={14} />
        </span>
      </div>
      <div className="min-w-0">
        <div className="row-title">{item.title}</div>
        <div className="row-meta">
          {p && (
            <a href={href('people', { id: p.id })} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[var(--text)] no-underline hover:underline">
              <Icon name="user" size={12} /> {p.name}
            </a>
          )}
          <Badge tone={ag.tone}>{ag.label}</Badge>
          {item.due && item.status === 'open' && (
            <span title={item.direction === 'owe' ? 'Your deadline' : 'The date they promised'}>
              {item.direction === 'owe' ? 'Due' : 'Promised'} {fmt.day(item.due)}
            </span>
          )}
          {plan && item.status === 'open' && !snoozed && (
            <span title={plan.reason} className={plan.day <= state.today ? 'font-semibold text-[var(--hitachi-red-hover)]' : ''}>
              Chase {plan.day <= state.today ? 'now' : fmt.day(plan.day)}
              {plan.level !== 'nudge' ? ` (${plan.level === 'firm' ? 'firm' : 'escalate'})` : ''}
            </span>
          )}
          {snoozed && (
            <span>
              <Icon name="moon" size={12} /> Snoozed to {fmt.day(item.snoozeUntil)}
            </span>
          )}
          {blockers.length > 0 && <span title={blockers.map((b) => `#${b.num} ${b.title}`).join('\n')}>Needs {blockers.map((b) => `#${b.num}`).join(', ')}</span>}
          {rk && <Badge tone={rk.level === 'risk' ? 'bad' : 'warn'} title={rk.reason}>{rk.level === 'risk' ? 'At risk' : 'Input has no date'}</Badge>}
          {item.recur && <Icon name="repeat" size={12} title="Recurs" />}
          {item.tags.map((t) => (
            <span key={t} className="mono">
              #{t}
            </span>
          ))}
        </div>
        {reason && <div className="row-why">{reason}</div>}
      </div>
      {item.status === 'open' ? (
        <div className="row-acts">
          {item.direction === 'wait' && <IconButton icon="mail" label="Chase" onClick={() => a.chase([item.id])} testid={`chase-${item.num}`} />}
          <IconButton icon="check" label={item.direction === 'wait' ? 'Received' : 'Done'} onClick={() => a.close(item)} testid={`done-${item.num}`} />
          <MenuButton
            label="Snooze"
            icon="moon"
            testid={`snooze-${item.num}`}
            items={[...a.snoozeChoices().map((c) => ({ label: `${c.label} (${fmt.day(c.day)})`, onClick: () => a.snooze(item, c.day) })), ...(snoozed ? [{ label: 'Wake now', onClick: () => a.snooze(item, undefined) }] : [])]}
          />
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}

/** Keyboard for a screen's list: j/k or arrows to move, Enter to open, c/d/s to act. */
export function useListKeys(items: Item[], enabled = true) {
  const { ui } = useApp();
  const a = useItemActions();
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (ui.openItem || ui.chase || ui.command || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const i = items.findIndex((x) => x.id === sel);
      const cur = i >= 0 ? items[i] : undefined;
      const move = (n: number) => {
        const next = items[Math.min(items.length - 1, Math.max(0, (i < 0 ? -1 : i) + n))];
        if (next) {
          setSel(next.id);
          document.querySelector(`[data-item="${next.num}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      };
      if (e.key === 'j' || e.key === 'ArrowDown') move(1);
      else if (e.key === 'k' || e.key === 'ArrowUp') move(-1);
      else if (e.key === 'Enter' && cur) a.open(cur);
      else if (e.key === 'c' && cur?.direction === 'wait' && cur.status === 'open') a.chase([cur.id]);
      else if (e.key === 'd' && cur?.status === 'open') a.close(cur);
      else if (e.key === 's' && cur?.status === 'open') a.snooze(cur, a.snoozeChoices()[2].day);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, sel, enabled, ui.openItem, ui.chase, ui.command, a]);
  return { sel, setSel };
}
