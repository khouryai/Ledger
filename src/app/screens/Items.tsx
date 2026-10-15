/**
 * I owe, Waiting on, and Everything: one list with filters, exportable as the action
 * log people expect in a meeting.
 */
import { useEffect, useMemo, useState } from 'react';
import { allTags, filterItems, sortWorking, type ItemFilter } from '../../engine/review';
import { rowsToHtml, rowsToText, toRows } from '../../engine/table';
import type { Item } from '../../engine/types';
import { Icon } from '../components/icons';
import { ItemRow, useListKeys } from '../components/ItemRow';
import { copyRich, downloadFile, Empty, Hero, Stat } from '../components/ui';
import type { Route } from '../router';
import { useApp } from '../state';

const TITLES: Record<string, { eyebrow: string; title: string; sub: string }> = {
  owe: { eyebrow: 'Work', title: 'I owe', sub: 'Everything you have said you would do, worst first.' },
  wait: { eyebrow: 'Work', title: 'Waiting on', sub: 'Everything other people owe you, with when each is next chased and why.' },
  all: { eyebrow: 'Keep it honest', title: 'Everything', sub: 'Every item, both ways, open and closed. Search reads titles, people, tags, notes and history.' },
};

export function Items({ route }: { route: Route }) {
  const { state, ctx, actions } = useApp();
  const kind = route.screen === 'owe' || route.screen === 'wait' ? route.screen : 'all';
  const [status, setStatus] = useState<NonNullable<ItemFilter['status']>>(kind === 'all' ? 'all' : 'open');
  const [personId, setPersonId] = useState(route.params.get('person') ?? '');
  const [tag, setTag] = useState(route.params.get('tag') ?? '');
  const [query, setQuery] = useState(route.params.get('q') ?? '');
  useEffect(() => setStatus(kind === 'all' ? 'all' : 'open'), [kind]);

  const items = useMemo(() => {
    const list = filterItems(ctx, { direction: kind === 'all' ? undefined : kind, status, personId: personId || undefined, tag: tag || undefined, query: query || undefined });
    return status === 'closed' ? [...list].sort((a, b) => (b.closedOn ?? '').localeCompare(a.closedOn ?? '') || b.num - a.num) : sortWorking(list, ctx);
  }, [ctx, kind, status, personId, tag, query]);
  const { sel, setSel } = useListKeys(items);

  const exportXlsx = async (list: Item[]) => {
    const { actionLogWorkbook } = await import('../../io/xlsx');
    const bytes = actionLogWorkbook(toRows(list, ctx), TITLES[kind].title);
    downloadFile(`Ledger ${TITLES[kind].title} ${state.today}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    actions.toast(`Downloaded the action log: ${list.length} item${list.length === 1 ? '' : 's'}.`, 'info');
  };

  useEffect(() => {
    if (route.params.get('export') === '1') {
      void exportXlsx(items);
      history.replaceState(null, '', `#/${route.screen}`);
    }
  }, [route]);

  const people = [...state.doc.people].sort((a, b) => a.name.localeCompare(b.name));
  const tags = allTags(state.doc);
  const open = items.filter((i) => i.status === 'open');
  const meta = TITLES[kind];

  return (
    <div>
      <Hero
        eyebrow={meta.eyebrow}
        title={meta.title}
        sub={meta.sub}
        stats={
          <>
            <Stat label="Shown" value={items.length} />
            {kind !== 'owe' && <Stat label="Waiting" value={open.filter((i) => i.direction === 'wait').length} tone="blue" />}
            {kind !== 'wait' && <Stat label="Owed by me" value={open.filter((i) => i.direction === 'owe').length} tone="red" />}
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn"
              disabled={!items.length}
              onClick={() => {
                const rows = toRows(items, ctx);
                void copyRich(rowsToText(rows), rowsToHtml(rows)).then((ok) => actions.toast(ok ? 'Copied as a table. Paste it into an email or Word.' : 'Could not reach the clipboard.', ok ? 'info' : 'error'));
              }}
            >
              <Icon name="copy" size={14} /> Copy as table
            </button>
            <button type="button" className="btn" disabled={!items.length} onClick={() => void exportXlsx(items)} data-testid="export-xlsx">
              <Icon name="download" size={14} /> Excel
            </button>
          </>
        }
      />
      <div className="page">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label="Status">
            {(['open', 'snoozed', 'closed', 'all'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
                {s === 'open' ? 'Open' : s === 'snoozed' ? 'Snoozed' : s === 'closed' ? 'Closed' : 'All'}
              </button>
            ))}
          </div>
          <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="Person">
            <option value="">Anyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {tags.length > 0 && (
            <select className="input" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
              <option value="">Any tag</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          )}
          <input className="input min-w-[220px] flex-1" placeholder="Search, or #12 for an item" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" data-testid="items-search" />
        </div>
        <div className="list-card rows">
          {items.map((it) => (
            <ItemRow key={it.id} item={it} selected={sel === it.id} onSelect={() => setSel(it.id)} />
          ))}
          {!items.length && (
            <Empty title={query || personId || tag ? 'Nothing matches.' : status === 'open' ? (kind === 'owe' ? 'You owe nobody anything. Enjoy it.' : kind === 'wait' ? 'Nobody owes you anything right now.' : 'Nothing open.') : 'Nothing here.'}>
              {status === 'open' && !query && 'Add one in the line at the top.'}
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}
