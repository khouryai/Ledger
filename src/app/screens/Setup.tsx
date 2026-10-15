/**
 * Where the ledger lives. Shown on first run, when the folder needs permission again,
 * and when the file will not read.
 */
import { useEffect, useState } from 'react';
import { readDoc } from '../../engine/doc';
import { fsaSupported } from '../folder';
import { useApp } from '../state';
import { Icon } from '../components/icons';
import { downloadFile } from '../components/ui';

export function Setup() {
  const { state, actions } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setErr((e as Error).message);
    }
  };

  if (state.status === 'loading') return <div className="setup text-[var(--text-muted)]">Opening your ledger…</div>;
  if (state.status === 'broken') return <Broken />;

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="eyebrow">Ledger</div>
        <h1 className="ph-title mt-1" style={{ fontSize: 30 }}>
          What I owe, and what I am owed.
        </h1>
        <p className="mt-2 text-[14px] text-[var(--text-muted)]">
          One list of everything you owe people and everything people owe you, with the chasing done for you. It runs on this laptop and keeps everything in one file
          in a folder you choose. Nothing is sent anywhere.
        </p>

        {state.status === 'reconnect' ? (
          <div className="card mt-6">
            <div className="card-title">Open your ledger folder again</div>
            <p className="hint mt-1">
              The browser asks once per session before letting Ledger into <b>{state.where}</b>. To stop it asking, choose "Allow on every visit" when it does.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-primary" onClick={() => void run(actions.reconnect)} data-testid="reconnect">
                Open {state.where}
              </button>
              <button type="button" className="btn" onClick={() => void run(actions.forgetStorage)}>
                Choose somewhere else
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <button type="button" className="opt" disabled={!fsaSupported()} onClick={() => void run(actions.chooseFolder)} data-testid="setup-folder">
              <div className="opt-t flex items-center gap-2">
                <Icon name="lock" size={16} /> Keep it in a folder <span className="badge badge-good">Recommended</span>
              </div>
              <div className="opt-d">
                Pick a folder in OneDrive (for example <span className="mono">OneDrive\Ledger</span>). Your ledger is one file there, backed up by OneDrive and by a daily copy
                Ledger keeps beside it. If the folder already has a ledger, it opens.
                {!fsaSupported() && ' This browser cannot open folders: use Microsoft Edge or Google Chrome.'}
              </div>
            </button>
            <button type="button" className="opt" onClick={() => void run(actions.useBrowser)} data-testid="setup-browser">
              <div className="opt-t">Keep it in this browser</div>
              <div className="opt-d">No folder needed. It lives in this browser profile only, and clearing browsing data erases it. You can move it to a folder later.</div>
            </button>
            <button type="button" className="opt" onClick={() => actions.useMemory(true)} data-testid="setup-demo">
              <div className="opt-t">Look around with sample data</div>
              <div className="opt-d">A made-up fortnight of items, people and a meeting. Nothing is saved.</div>
            </button>
          </div>
        )}
        {(err || state.saveError) && <div className="notice notice-error mt-4">{err ?? state.saveError}</div>}
      </div>
    </div>
  );
}

function Broken() {
  const { state, actions } = useApp();
  const [backups, setBackups] = useState<{ path: string; day: string }[]>([]);
  useEffect(() => {
    void actions
      .store()
      ?.listBackups()
      .then(setBackups)
      .catch(() => setBackups([]));
  }, [actions]);
  return (
    <div className="setup">
      <div className="setup-card card">
        <div className="card-title flex items-center gap-2 text-[var(--bad)]">
          <Icon name="alert" /> The ledger file will not read
        </div>
        <p className="mt-2 text-[13px]">
          <span className="mono">ledger.json</span> in <b>{state.where}</b> is not valid ({state.broken?.error}). It has not been changed, and nothing will be written over it unless
          you choose to below.
        </p>
        <ul className="mt-3 list-disc pl-5 text-[13px]">
          <li>OneDrive keeps earlier versions: right-click the file in File Explorer, then Version history.</li>
          <li>Or restore one of Ledger's own daily copies:</li>
        </ul>
        <div className="mt-2 flex flex-col gap-1">
          {backups.length === 0 && <span className="hint">No daily copies found.</span>}
          {backups.slice(0, 10).map((b) => (
            <button
              key={b.path}
              type="button"
              className="btn btn-mini self-start"
              onClick={() =>
                void actions
                  .store()!
                  .readBackup(b.path)
                  .then((doc) => actions.replaceDoc(doc, `Restored the copy from ${b.day}.`))
              }
            >
              Restore the copy from {b.day}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => downloadFile('ledger-unreadable.json', state.broken?.text ?? '', 'application/json')}>
            Download the unreadable file
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm('Start an empty ledger in its place? Download the unreadable file first if you might want it.')) actions.replaceDoc(readDoc({}).doc, 'Started a new ledger.');
            }}
          >
            Start an empty ledger instead
          </button>
        </div>
      </div>
    </div>
  );
}
