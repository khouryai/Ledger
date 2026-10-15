import React, { useEffect } from 'react';
import { today as todayList, todayCount } from '../../engine/decide';
import { reviewDue, reviewQueue } from '../../engine/review';
import { buildLabel, BUILD_COMMIT, BUILD_TIME } from '../build';
import { fmtDateTime } from '../format';
import { href } from '../router';
import { useApp } from '../state';
import { applyUpdate, useUpdateReady } from '../update';
import { ChaseDialog } from './ChaseDialog';
import { CommandMenu } from './CommandMenu';
import { Icon, type IconName } from './icons';
import { ItemDrawer } from './ItemDrawer';
import { focusQuickAdd, QuickAdd } from './QuickAdd';
import { Kbd } from './ui';

type NavItem = { id: string; label: string; icon: IconName; count?: number; hot?: boolean };

export function Layout({ screen, children }: { screen: string; children: React.ReactNode }) {
  const { state, ctx, ui, actions } = useApp();
  const doc = state.doc;
  const updateReady = useUpdateReady();
  const t = todayList(ctx);
  const open = doc.items.filter((i) => i.status === 'open');
  const queue = reviewQueue(ctx);
  const nav: { section: string; items: NavItem[] }[] = [
    {
      section: 'Work',
      items: [
        { id: 'today', label: 'Today', icon: 'today', count: todayCount(t), hot: true },
        { id: 'owe', label: 'I owe', icon: 'owe', count: open.filter((i) => i.direction === 'owe').length },
        { id: 'wait', label: 'Waiting on', icon: 'wait', count: open.filter((i) => i.direction === 'wait').length },
        { id: 'capture', label: 'Capture', icon: 'inbox' },
        { id: 'meetings', label: 'Meetings', icon: 'calendar' },
      ],
    },
    {
      section: 'Keep it honest',
      items: [
        { id: 'review', label: 'Weekly review', icon: 'review', count: queue.length || undefined, hot: reviewDue(doc, state.today) },
        { id: 'people', label: 'People', icon: 'users' },
        ...(doc.settings.outlook.enabled ? [{ id: 'outlook', label: 'Outlook', icon: 'outlook' as IconName }] : []),
        { id: 'all', label: 'Everything', icon: 'search' },
      ],
    },
    { section: 'Setup', items: [{ id: 'settings', label: 'Settings', icon: 'gear' }] },
  ];

  // Shortcuts that work everywhere: Ctrl+K, Ctrl+N or n, Ctrl+Z.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = !!t.closest('input, textarea, select, [contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        actions.setUi({ command: !ui.command });
      } else if ((mod && e.key.toLowerCase() === 'n') || (!typing && !mod && e.key === 'n' && !ui.openItem && !ui.chase)) {
        e.preventDefault();
        actions.setUi({ openItem: null, command: false });
        focusQuickAdd();
      } else if (mod && e.key.toLowerCase() === 'z' && !typing && !e.shiftKey) {
        e.preventDefault();
        actions.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, ui.command, ui.openItem, ui.chase]);

  const where = state.mode === 'folder' ? state.where : state.mode === 'browser' ? 'This browser' : 'Not saving';

  return (
    <div className="flex h-screen">
      <aside className="sidenav flex w-56 shrink-0 flex-col">
        <div className="sidenav-brand">
          <div className="sidenav-brand-name">LEDGER</div>
          <div className="sidenav-brand-sub">What I owe · what I am owed</div>
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
                  {n.count ? <span className={n.hot ? 'nav-count' : 'mono opacity-60'}>{n.count}</span> : n.hot ? <span className="nav-count">due</span> : null}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidenav-foot">
          <div className="mb-2 flex items-center gap-2">
            <Kbd>Ctrl K</Kbd> <span>commands</span>
          </div>
          <div className="truncate" title={where}>
            {where}
          </div>
          <div className="mt-0.5 opacity-70" data-testid="save-state">
            {state.saving ? 'Saving…' : state.dirty && state.mode !== 'memory' ? 'Unsaved' : state.lastSavedAt ? `Saved ${fmtDateTime(state.lastSavedAt)}` : state.mode === 'memory' ? 'Nothing is saved' : 'Saved'}
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
              <b>Could not save.</b> {state.saveError} Your changes are still here.
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
          <div className="strip strip-error">
            <b>Nothing is being saved.</b> You are looking around. Choose where to keep your ledger in <a href={href('settings')}>Settings</a> before real work.
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
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
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
      </main>
      <ItemDrawer />
      <ChaseDialog />
      {ui.command && <CommandMenu />}
    </div>
  );
}
