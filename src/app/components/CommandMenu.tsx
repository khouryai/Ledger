/**
 * Ctrl+K: every screen, every common action, and every item and person by name or
 * number, from one box. It adds no behaviour of its own; each entry does what a
 * button somewhere else does.
 */
import { useEffect, useMemo, useState } from 'react';
import { matches } from '../../engine/review';
import { navigate } from '../router';
import { useApp } from '../state';
import { focusQuickAdd } from './QuickAdd';

type Entry = { group: string; label: string; hint?: string; run: () => void };

export function CommandMenu() {
  const { state, actions } = useApp();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const close = () => actions.setUi({ command: false });
  const doc = state.doc;

  const entries = useMemo(() => {
    const go = (screen: string, params?: Record<string, string>) => () => {
      navigate(screen, params);
      close();
    };
    const base: Entry[] = [
      { group: 'Do', label: 'Add an item', hint: 'Ctrl N', run: () => (close(), setTimeout(focusQuickAdd)) },
      { group: 'Do', label: 'Undo the last change', hint: 'Ctrl Z', run: () => (actions.undo(), close()) },
      { group: 'Do', label: 'Capture from an email or notes', run: go('capture') },
      { group: 'Do', label: 'Start the weekly review', run: go('review') },
      { group: 'Do', label: 'Export the action log to Excel', run: go('all', { export: '1' }) },
      { group: 'Go to', label: 'Today', run: go('today') },
      { group: 'Go to', label: 'I owe', run: go('owe') },
      { group: 'Go to', label: 'Waiting on', run: go('wait') },
      { group: 'Go to', label: 'Meetings', run: go('meetings') },
      { group: 'Go to', label: 'People', run: go('people') },
      { group: 'Go to', label: 'Everything (search)', run: go('all') },
      { group: 'Go to', label: 'Settings', run: go('settings') },
      ...(doc.settings.outlook.enabled ? [{ group: 'Go to', label: 'Outlook', run: go('outlook') }] : []),
    ];
    const query = q.trim();
    const items: Entry[] = query
      ? doc.items
          .filter((it) => matches(it, query, doc))
          .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.num - a.num)
          .slice(0, 8)
          .map((it) => ({ group: 'Items', label: `#${it.num} ${it.title}`, hint: it.status === 'open' ? (it.direction === 'owe' ? 'I owe' : 'Waiting') : 'Closed', run: () => (actions.setUi({ openItem: it.id, command: false })) }))
      : [];
    const people: Entry[] = query
      ? doc.people
          .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 5)
          .map((p) => ({ group: 'People', label: p.name, hint: p.company, run: go('people', { id: p.id }) }))
      : [];
    const filtered = query ? base.filter((e) => e.label.toLowerCase().includes(query.toLowerCase())) : base;
    return [...items, ...people, ...filtered];
  }, [q, doc]);

  useEffect(() => setI(0), [q]);

  let lastGroup = '';
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal cmd" role="dialog" aria-label="Commands">
        <input
          className="cmd-input"
          autoFocus
          placeholder="Search items and people, or type a command"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setI((n) => Math.min(entries.length - 1, n + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setI((n) => Math.max(0, n - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              entries[i]?.run();
            } else if (e.key === 'Escape') close();
          }}
        />
        <div className="cmd-list" role="listbox">
          {entries.length === 0 && <div className="empty">Nothing matches.</div>}
          {entries.map((e, n) => {
            const head = e.group !== lastGroup ? <div className="cmd-group">{e.group}</div> : null;
            lastGroup = e.group;
            return (
              <div key={`${e.group}-${e.label}`}>
                {head}
                <div className={`cmd-item${n === i ? ' is-on' : ''}`} role="option" aria-selected={n === i} onMouseEnter={() => setI(n)} onClick={e.run}>
                  <span className="truncate">{e.label}</span>
                  {e.hint && <span className="hint shrink-0">{e.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
