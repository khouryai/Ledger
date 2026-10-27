import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { today as todayList, todayCount } from '../../engine/decide';
import { reviewDue, reviewQueue } from '../../engine/review';
import { allSeries } from '../../engine/series';
import { buildLabel, BUILD_COMMIT, BUILD_TIME } from '../build';
import { fmtDateTime } from '../format';
import { href } from '../router';
import { dialogOpen, useApp } from '../state';
import { applyUpdate, useUpdateReady } from '../update';
import { ChaseDialog } from './ChaseDialog';
import { CommandMenu } from './CommandMenu';
import { Icon, LogoMark, type IconName } from './icons';
import { ItemDrawer } from './ItemDrawer';
import { focusQuickAdd, QuickAdd } from './QuickAdd';
import { ScheduleDialogs } from './Schedule';
import { Kbd, Modal } from './ui';

/** `hot` draws the count in red; `flag` is a word shown when there is no count. */
type NavItem = { id: string; label: string; icon: IconName; count?: number; hot?: boolean; flag?: string };

export function Layout({ screen, children }: { screen: string; children: React.ReactNode }) {
  const { state, ctx, ui, actions } = useApp();
  const doc = state.doc;
  const updateReady = useUpdateReady();
  const t = todayList(ctx);
  const open = doc.items.filter((i) => i.status === 'open');
  const queue = reviewQueue(ctx);
  // Recurring items due today or late are the ones to flag; the rest is a plain count.
  const repeating = allSeries(doc).filter((s) => s.active);
  const routinesDue = repeating.filter((s) => s.current?.due && s.current.due <= state.today).length;
  const nav: { section: string; items: NavItem[] }[] = [
    {
      section: 'Work',
      items: [
        { id: 'today', label: 'Today', icon: 'today', count: todayCount(t), hot: todayCount(t) > 0 },
        { id: 'week', label: 'Week', icon: 'week' },
        { id: 'owe', label: 'I owe', icon: 'owe', count: open.filter((i) => i.direction === 'owe').length },
        { id: 'wait', label: 'Waiting on', icon: 'wait', count: open.filter((i) => i.direction === 'wait').length },
        { id: 'recurring', label: 'Recurring', icon: 'repeat', count: routinesDue || repeating.length || undefined, hot: routinesDue > 0 },
        { id: 'capture', label: 'Capture', icon: 'inbox' },
        { id: 'meetings', label: 'Meetings', icon: 'calendar' },
      ],
    },
    {
      section: 'Keep it honest',
      items: [
        { id: 'review', label: 'Weekly review', icon: 'review', count: queue.length || undefined, hot: reviewDue(doc, state.today), flag: reviewDue(doc, state.today) ? 'due' : undefined },
        { id: 'people', label: 'People', icon: 'users' },
        ...(doc.settings.outlook.enabled ? [{ id: 'outlook', label: 'Outlook', icon: 'outlook' as IconName }] : []),
        { id: 'all', label: 'Everything', icon: 'search' },
      ],
    },
    { section: 'Setup', items: [{ id: 'settings', label: 'Settings', icon: 'gear' }] },
  ];

  const [help, setHelp] = useState(false);
  // On a phone the screens are a tab bar, and the rest of the menu slides over.
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [screen]);
  const mainRef = useRef<HTMLDivElement>(null);

  // A new screen starts at its top, and a screen chosen from the menu takes the focus,
  // so the keyboard and a screen reader land on what was just opened.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    if (document.activeElement?.closest('.sidenav')) main.focus({ preventScroll: true });
  }, [screen]);

  // Shortcuts that work everywhere: Ctrl+K, Ctrl+N or n, Ctrl+Z, ?, and 1 to 5. Attached
  // as the screen is drawn, so a key pressed the moment it appears is not lost.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = !!t.closest('input, textarea, select, [contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        actions.setUi({ command: !ui.command });
      } else if ((mod && e.key.toLowerCase() === 'n') || (!typing && !mod && e.key === 'n' && !dialogOpen(ui))) {
        e.preventDefault();
        actions.setUi({ openItem: null, command: false });
        focusQuickAdd();
      } else if (mod && e.key.toLowerCase() === 'z' && !typing && !e.shiftKey) {
        e.preventDefault();
        actions.undo();
      } else if (!typing && !mod && e.key === '?') {
        e.preventDefault();
        setHelp((h) => !h);
      } else if (!typing && !mod && !e.altKey && !dialogOpen(ui) && GO[e.key]) {
        e.preventDefault();
        window.location.hash = href(GO[e.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, ui]);

  const where = state.mode === 'folder' || state.mode === 'cloud' ? state.where : state.mode === 'browser' ? 'This browser' : 'Not saving';
  const saved = state.saving
    ? 'Saving…'
    : state.dirty && state.mode !== 'memory'
      ? state.saveError
        ? 'Not saved yet'
        : 'Saving shortly'
      : state.mode === 'memory'
        ? 'Nothing is saved'
        : state.lastSavedAt
          ? `Saved ${fmtSaved(state.lastSavedAt)}`
          : 'Saved';
  // On a phone: Today, the week and the two lists; the rest is under More.
  const tabs: NavItem[] = [nav[0].items[0], nav[0].items[1], nav[0].items[2], nav[0].items[3]];

  return (
    <div className={`app-shell flex${menu ? ' menu-open' : ''}`}>
      <button type="button" className="skip-link" onClick={() => mainRef.current?.focus()}>
        Skip to the content
      </button>
      {menu && <div className="menu-scrim" onClick={() => setMenu(false)} aria-hidden="true" />}
      <aside className="sidenav flex w-56 shrink-0 flex-col" aria-label="Menu">
        <div className="sidenav-brand flex items-center gap-3">
          <LogoMark size={30} />
          <div>
            <div className="sidenav-brand-name">LEDGER</div>
            <div className="sidenav-brand-sub">Follow-up tracker</div>
          </div>
        </div>
        <nav className="sidenav-links flex-1 overflow-auto" aria-label="Screens">
          {nav.map((g) => (
            <div key={g.section}>
              <div className="sidenav-section-label">{g.section}</div>
              {g.items.map((n) => (
                <a key={n.id} href={href(n.id)} className={`nav-link${screen === n.id ? ' active' : ''}`} aria-current={screen === n.id ? 'page' : undefined}>
                  <span className="flex items-center gap-2">
                    <Icon name={n.icon} size={15} /> {n.label}
                  </span>
                  {n.count ? (
                    <span className={n.hot ? 'nav-count' : 'nav-num'} aria-label={`${n.count} ${n.hot ? 'needing you' : 'open'}`}>
                      {n.count}
                    </span>
                  ) : n.flag ? (
                    <span className="nav-count">{n.flag}</span>
                  ) : null}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidenav-foot">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" className="foot-btn" onClick={() => actions.setUi({ command: true })}>
              <Kbd>Ctrl K</Kbd> commands
            </button>
            <button type="button" className="foot-btn" onClick={() => setHelp(true)}>
              <Kbd>?</Kbd> keys
            </button>
          </div>
          <div className="truncate" title={where}>
            {where}
          </div>
          <div className="mt-0.5 opacity-70" data-testid="save-state">
            {saved}
          </div>
          <div className="mt-1 truncate opacity-60" title={`Build ${BUILD_COMMIT}${BUILD_TIME ? ` built ${fmtDateTime(BUILD_TIME)}` : ''}`}>
            {buildLabel()}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <QuickAdd />
        {state.saveError && (
          <div className="strip strip-error flex items-center justify-between gap-3">
            <span>
              <b>Not saved yet.</b> {state.saveError}
              {/kept here/.test(state.saveError) ? '' : ' Your changes are still here.'}
            </span>
            <button type="button" className="btn btn-mini" onClick={() => void actions.saveNow()}>
              Try again
            </button>
          </div>
        )}
        {state.outside && (
          <div className="strip strip-warn flex items-center justify-between gap-3">
            <span>
              <b>The ledger file changed outside this window</b> while you had unsaved changes here.
            </span>
            <span className="flex gap-2">
              <button type="button" className="btn btn-mini" onClick={() => void actions.reloadFromDisk()}>
                Load the file (lose mine)
              </button>
              <button type="button" className="btn btn-mini btn-primary" onClick={() => void actions.keepMine()}>
                Keep mine (overwrite)
              </button>
            </span>
          </div>
        )}
        {state.mode === 'memory' && (
          <div className="strip strip-warn flex items-center justify-between gap-3">
            <span>
              <b>Nothing is being saved.</b> You are looking around with sample data.
            </span>
            <a className="btn btn-mini" href={href('settings')}>
              Choose where to keep a ledger
            </a>
          </div>
        )}
        {state.mode === 'browser' && (
          <div className="strip strip-warn">
            <b>Saving in this browser only.</b> Clearing browsing data erases it. Move it to a OneDrive folder in <a href={href('settings')}>Settings</a>.
          </div>
        )}
        {updateReady && (
          <div className="strip strip-new flex items-center justify-between gap-3">
            <span>
              <b>A newer version is on disk.</b> Reloading switches to it; your ledger is in its file, not in the app.
            </span>
            <button type="button" className="btn btn-mini btn-primary" disabled={state.dirty} onClick={applyUpdate}>
              {state.dirty ? 'Saving first…' : 'Reload now'}
            </button>
          </div>
        )}
        {state.problems.length > 0 && (
          <div className="strip strip-warn">
            {state.problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        )}
        <div id="main" ref={mainRef} tabIndex={-1} className="min-h-0 flex-1 overflow-auto outline-none">
          {children}
        </div>
        {state.toast && (
          <div className={`toast notice-${state.toast.kind === 'error' ? 'error' : state.toast.kind === 'ok' ? 'ok' : 'info'}`} role="status">
            {state.toast.text}
            {state.toast.undo && actions.canUndo && (
              <span className="toast-actions">
                <button type="button" onClick={actions.undo}>
                  Undo
                </button>
              </span>
            )}
          </div>
        )}
        <nav className="tabbar" aria-label="Screens">
          {tabs.map((n) => (
            <a key={n.id} href={href(n.id)} className={screen === n.id ? 'is-on' : ''} aria-current={screen === n.id ? 'page' : undefined}>
              <span className="tab-ico">
                <Icon name={n.icon} size={20} />
                {n.count && n.hot ? <span className="tab-badge">{n.count}</span> : null}
              </span>
              {n.label}
            </a>
          ))}
          <button type="button" className={menu ? 'is-on' : ''} onClick={() => setMenu((m) => !m)} aria-expanded={menu} data-testid="tab-more">
            <span className="tab-ico">
              <Icon name="list" size={20} />
              {nav[1].items[0].hot ? <span className="tab-badge tab-dot" /> : null}
            </span>
            More
          </button>
        </nav>
      </main>
      <ItemDrawer />
      <ChaseDialog />
      <ScheduleDialogs />
      {ui.command && <CommandMenu />}
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
    </div>
  );
}

/** "2:45 PM" today, "Oct 19, 2:45 PM" before. */
function fmtSaved(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Number keys go straight to the screens used most, in the order of the menu. */
const GO: Record<string, string> = { '1': 'today', '2': 'week', '3': 'owe', '4': 'wait', '5': 'recurring' };

const SHORTCUTS: { keys: string[][]; what: string }[] = [
  { keys: [['Ctrl', 'K']], what: 'Commands, and search for any item or person' },
  { keys: [['Ctrl', 'N'], ['N']], what: 'Add something in the line at the top' },
  { keys: [['1'], ['2'], ['3'], ['4'], ['5']], what: 'Today, Week, I owe, Waiting on, Recurring' },
  { keys: [['←'], ['→']], what: 'On Week: the week before, the week after' },
  { keys: [['Tab']], what: 'In the add line: switch between I owe and Waiting on' },
  { keys: [['J'], ['↓']], what: 'Next item in a list' },
  { keys: [['K'], ['↑']], what: 'Previous item' },
  { keys: [['Enter']], what: 'Open the selected item' },
  { keys: [['C']], what: 'Chase the selected item' },
  { keys: [['D']], what: 'Done, or received' },
  { keys: [['S']], what: 'Snooze to Monday' },
  { keys: [['Ctrl', 'Z']], what: 'Undo the last change' },
  { keys: [['Esc']], what: 'Close whatever is open' },
  { keys: [['?']], what: 'This list' },
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="shortcuts">
        {SHORTCUTS.map(({ keys, what }) => (
          <div key={what}>
            <dt>
              {keys.map((combo, i) => (
                <span key={combo.join('+')}>
                  {i > 0 && <span className="hint"> or </span>}
                  {combo.map((k, j) => (
                    <span key={k}>
                      {j > 0 && '+'}
                      <Kbd>{k}</Kbd>
                    </span>
                  ))}
                </span>
              ))}
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
