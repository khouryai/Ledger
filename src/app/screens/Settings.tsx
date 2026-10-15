import { useEffect, useState } from 'react';
import { MODELS, modelChoice } from '../../ai/engine';
import { aiIsFake, getEngine, unloadEngine, useAiStatus } from '../../ai/manager';
import { isDay } from '../../engine/dates';
import { readDoc } from '../../engine/doc';
import { calendarOf, updateSettings } from '../../engine/ops';
import { DEFAULT_TEMPLATES, type ChaseLevel, type Settings as S } from '../../engine/types';
import { useAi } from '../ai';
import { buildLabel, runningFrom } from '../build';
import { CommitInput, DateField } from '../components/fields';
import { Icon } from '../components/icons';
import { downloadFile, Hero, Kbd, Section } from '../components/ui';
import { makeFmt } from '../format';
import { useApp } from '../state';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Settings() {
  const { state, actions } = useApp();
  const s = state.doc.settings;
  const set = (patch: Partial<S>) => actions.apply((d) => updateSettings(d, patch));
  return (
    <div>
      <Hero eyebrow="Setup" title="Settings" sub="Everything here is saved in the ledger file itself, so it travels with it." />
      <div className="page page-narrow">
        <Storage />
        <Section title="You">
          <div className="card grid2">
            <label className="field block">
              <span className="field-l">Your name</span>
              <CommitInput value={s.myName} placeholder="Alex Khoury" onCommit={(v) => set({ myName: v.trim() })} testid="set-name" />
              <span className="form-hint">Chasers are signed with it.</span>
            </label>
            <label className="field block">
              <span className="field-l">Your email</span>
              <CommitInput value={s.myEmail} placeholder="you@company.com" onCommit={(v) => set({ myEmail: v.trim().toLowerCase() })} testid="set-email" />
              <span className="form-hint">Tells Capture which emails in a thread are yours.</span>
            </label>
          </div>
        </Section>
        <WorkingWeek />
        <Chasing />
        <Templates />
        <AiSettings />
        <OutlookSettings />
        <About />
      </div>
    </div>
  );
}

function Storage() {
  const { state, actions } = useApp();
  const [backups, setBackups] = useState<{ path: string; day: string }[]>([]);
  useEffect(() => {
    void actions
      .store()
      ?.listBackups()
      .then(setBackups)
      .catch(() => setBackups([]));
  }, [actions, state.lastSavedAt]);
  const where = state.mode === 'folder' ? `The folder "${state.where}"` : state.mode === 'browser' ? 'This browser (IndexedDB)' : 'Nowhere: nothing is being saved';
  return (
    <Section title="Where your ledger lives">
      <div className="card">
        <div className="text-[13px]">
          <b>{where}</b>
          {state.mode === 'folder' && (
            <span className="hint">
              {' '}
              as <span className="mono">ledger.json</span>, with a copy kept each day in <span className="mono">backups</span> for 30 days.
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {state.mode !== 'folder' && (
            <button type="button" className="btn btn-primary" onClick={() => void actions.moveToFolder().catch((e) => (e as DOMException).name !== 'AbortError' && actions.toast((e as Error).message, 'error'))}>
              Move this ledger into a folder
            </button>
          )}
          <button type="button" className="btn" onClick={() => void actions.chooseFolder().catch((e) => (e as DOMException).name !== 'AbortError' && actions.toast((e as Error).message, 'error'))}>
            {state.mode === 'folder' ? 'Open a different folder' : 'Open a folder that has a ledger'}
          </button>
          <button type="button" className="btn" onClick={() => downloadFile(`ledger-${state.today}.json`, JSON.stringify(state.doc, null, 1), 'application/json')}>
            <Icon name="download" size={14} /> Download a copy
          </button>
          <label className="btn cursor-pointer">
            Open a ledger file
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const { doc, problems } = readDoc(JSON.parse(await f.text()));
                  if (window.confirm(`Replace what is here with ${f.name} (${doc.items.length} items, ${doc.people.length} people)? You can undo it.`)) actions.replaceDoc(doc, `Opened ${f.name}.${problems.length ? ` ${problems.join(' ')}` : ''}`);
                } catch (err) {
                  actions.toast(`That file is not a ledger: ${(err as Error).message}`, 'error');
                }
                e.target.value = '';
              }}
            />
          </label>
          <button type="button" className="btn btn-mini ml-auto self-center" onClick={() => window.confirm('Close this ledger and choose where to keep one? Nothing is deleted.') && void actions.forgetStorage()}>
            Close this ledger
          </button>
        </div>
        {backups.length > 0 && (
          <div className="mt-4">
            <span className="field-l">Daily copies</span>
            <div className="flex flex-wrap gap-2">
              {backups.slice(0, 12).map((b) => (
                <button
                  key={b.path}
                  type="button"
                  className="chip"
                  onClick={() =>
                    void actions
                      .store()!
                      .readBackup(b.path)
                      .then((doc) => window.confirm(`Go back to the ledger as it was at the start of ${b.day}? You can undo it.`) && actions.replaceDoc(doc, `Restored the copy from ${b.day}.`))
                  }
                >
                  {b.day}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function WorkingWeek() {
  const { state, actions } = useApp();
  const s = state.doc.settings;
  const fmt = makeFmt(s.dateOrder, state.today, calendarOf(s));
  const set = (patch: Partial<S>) => actions.apply((d) => updateSettings(d, patch));
  return (
    <Section title="Working week and dates">
      <div className="card">
        <span className="field-l">Working days</span>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="check chip">
              <input type="checkbox" checked={s.workDays.includes(i)} onChange={(e) => set({ workDays: (e.target.checked ? [...s.workDays, i] : s.workDays.filter((x) => x !== i)).sort() })} />
              {d}
            </label>
          ))}
        </div>
        <div className="mt-4 grid2">
          <label className="field block">
            <span className="field-l">Dates are written</span>
            <select className="input w-full" value={s.dateOrder} onChange={(e) => set({ dateOrder: e.target.value as S['dateOrder'] })}>
              <option value="MDY">Month first: 10/30</option>
              <option value="DMY">Day first: 30/10</option>
              <option value="YMD">Year first: 2026-10-30</option>
            </select>
          </label>
          <DateField
            label="Add a holiday"
            value={undefined}
            onChange={(d) => d && isDay(d) && !s.holidays.includes(d) && set({ holidays: [...s.holidays, d].sort() })}
            placeholder="11/26"
          />
        </div>
        {s.holidays.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {s.holidays.map((h) => (
              <span key={h} className="chip">
                {fmt.day(h)}
                <button type="button" className="link" aria-label={`Remove ${h}`} onClick={() => set({ holidays: s.holidays.filter((x) => x !== h) })}>
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="hint mt-2">Holidays and weekends are skipped when counting how long something has waited and when the next chase is due.</p>
      </div>
    </Section>
  );
}

function Num({ label, value, onChange, hint, min = 0 }: { label: string; value: number; onChange: (n: number) => void; hint?: string; min?: number }) {
  return (
    <label className="field block">
      <span className="field-l">{label}</span>
      <CommitInput
        value={String(value)}
        onCommit={(v) => {
          const n = Math.round(Number(v));
          if (Number.isFinite(n) && n >= min) onChange(n);
        }}
      />
      {hint && <span className="form-hint">{hint}</span>}
    </label>
  );
}

function Chasing() {
  const { state, actions } = useApp();
  const s = state.doc.settings;
  const set = (patch: Partial<S>) => actions.apply((d) => updateSettings(d, patch));
  return (
    <Section title="Chasing and the review">
      <div className="card grid2">
        <Num label="Chase every (working days)" value={s.chase.every} min={1} onChange={(n) => set({ chase: { ...s.chase, every: n } })} hint="Until a person's own pattern is learned." />
        <Num label="Suggest escalating after (chases)" value={s.chase.escalateAfter} min={1} onChange={(n) => set({ chase: { ...s.chase, escalateAfter: n } })} hint="Chases with no movement in between." />
        <Num label="Amber after (working days untouched)" value={s.ageing.amber} min={1} onChange={(n) => set({ ageing: { ...s.ageing, amber: n } })} />
        <Num label="Red after (working days untouched)" value={s.ageing.red} min={1} onChange={(n) => set({ ageing: { ...s.ageing, red: n } })} />
        <Num label="Slack before my deadline (working days)" value={s.riskBuffer} onChange={(n) => set({ riskBuffer: n })} hint="An input landing later than this is flagged at risk." />
        <Num label="Learn a person after (items received)" value={s.learnAfter} min={1} onChange={(n) => set({ learnAfter: n })} />
        <Num label="Review: gone quiet after (working days)" value={s.review.staleAfter} min={1} onChange={(n) => set({ review: { ...s.review, staleAfter: n } })} />
        <Num label="Looks dead after (working days of silence)" value={s.review.deadAfter} min={1} onChange={(n) => set({ review: { ...s.review, deadAfter: n } })} />
        <label className="field block">
          <span className="field-l">Review day</span>
          <select className="input w-full" value={s.review.weekday} onChange={(e) => set({ review: { ...s.review, weekday: Number(e.target.value) } })}>
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Section>
  );
}

const TEMPLATE_NAMES: Record<ChaseLevel | 'batch', string> = { nudge: 'Nudge (first chase)', firm: 'Firm (second)', escalate: 'Escalation (copies their manager)', batch: 'Round-up (several items to one person)' };

function Templates() {
  const { state, actions } = useApp();
  const t = state.doc.settings.templates;
  const set = (k: keyof S['templates'], patch: Partial<S['templates'][keyof S['templates']]>) => actions.apply((d) => updateSettings(d, { templates: { ...d.settings.templates, [k]: { ...d.settings.templates[k], ...patch } } }));
  return (
    <Section title="Chaser wording">
      <div className="card">
        <p className="hint mb-3">
          Placeholders: <span className="mono">{'{first} {name} {title} {asked} {waited} {promised} {subject} {me} {escalateTo} {list} {count}'}</span>. A line whose placeholders all come out empty is left out.
        </p>
        {(Object.keys(TEMPLATE_NAMES) as (keyof S['templates'])[]).map((k) => (
          <details key={k} className="mb-2">
            <summary className="cursor-pointer text-[13px] font-semibold">{TEMPLATE_NAMES[k]}</summary>
            <div className="mt-2">
              <label className="field block">
                <span className="field-l">Subject</span>
                <CommitInput value={t[k].subject} onCommit={(v) => set(k, { subject: v })} />
              </label>
              <label className="field block">
                <span className="field-l">Message</span>
                <CommitInput multiline className="textarea mono-ta" value={t[k].body} onCommit={(v) => set(k, { body: v })} />
              </label>
              <button type="button" className="btn btn-mini" onClick={() => set(k, DEFAULT_TEMPLATES[k])}>
                Put back the original
              </button>
            </div>
          </details>
        ))}
      </div>
    </Section>
  );
}

function AiSettings() {
  const { state, actions } = useApp();
  const s = state.doc.settings;
  const status = useAiStatus();
  const ai = useAi();
  const [gpu, setGpu] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const set = (patch: Partial<S['ai']>) => actions.apply((d) => updateSettings(d, { ai: { ...d.settings.ai, ...patch } }));
  const m = modelChoice(s.ai.model);

  useEffect(() => {
    if (s.ai.mode !== 'local' || aiIsFake()) return;
    void import('../../ai/webllm').then((w) => w.isDownloaded(s.ai.model).then(setDownloaded));
  }, [s.ai.mode, s.ai.model, status.state]);

  return (
    <Section title="On-device AI">
      <div className="card">
        <p className="text-[13px]">
          An open-source language model that runs on this laptop's graphics chip, inside the browser. It reads emails and notes for actions, writes chasers, judges replies and writes your
          week up. <b>Nothing it reads leaves the laptop.</b> The model is downloaded once (from Hugging Face) and kept in the browser. Everything it suggests is checked and has to be
          accepted; with it off, the rules do the same jobs.
        </p>
        <label className="check mt-3">
          <input type="checkbox" checked={s.ai.mode === 'local'} onChange={(e) => set({ mode: e.target.checked ? 'local' : 'off' })} data-testid="ai-toggle" /> Use the on-device model
        </label>
        {s.ai.mode === 'local' && (
          <>
            <div className="mt-3 flex flex-col gap-2">
              {MODELS.map((x) => (
                <label key={x.id} className="opt" style={{ padding: '10px 12px' }}>
                  <span className="flex items-start gap-3">
                    <input type="radio" name="model" className="mt-1" checked={s.ai.model === x.id} onChange={() => set({ model: x.id })} />
                    <span>
                      <span className="opt-t">
                        {x.label} <span className="hint font-normal">· {x.maker} · needs about {(x.vramMB / 1024).toFixed(1)} GB of graphics memory</span>
                      </span>
                      <span className="opt-d block">{x.note}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const { checkGpu } = await import('../../ai/webllm');
                  const r = await checkGpu();
                  setGpu(r.ok ? `WebGPU works. Graphics: ${[r.vendor, r.architecture].filter(Boolean).join(' ') || 'unnamed'}; ${r.f16 ? 'supports' : 'does not support'} 16-bit shaders; largest buffer ${r.maxBufferMB} MB.` : `Not usable: ${r.reason}`);
                }}
              >
                Check this laptop
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={status.state === 'loading' || status.state === 'checking'}
                onClick={() => void getEngine(s.ai.model).catch((e) => actions.toast((e as Error).message, 'error'))}
                data-testid="ai-load"
              >
                {downloaded ? 'Load the model' : `Download and load ${m.label}`}
              </button>
              <button
                type="button"
                className="btn"
                disabled={status.state !== 'ready'}
                onClick={async () => {
                  setTest('Reading a sample email…');
                  try {
                    const asks = await ai.extract("Hi, could you send the IXL test plan by Friday? I'll get the cable schedule to you next Tuesday. Thanks, Sam", { fromMe: false, sender: 'Sam' });
                    setTest(asks.length ? asks.map((a) => `${a.direction === 'owe' ? 'I owe' : 'Waiting on'}: ${a.title}${a.duePhrase ? ` (${a.duePhrase})` : ''}`).join(' · ') : 'It found nothing in the sample. Try another model.');
                  } catch (e) {
                    setTest(`It failed: ${(e as Error).message}`);
                  }
                }}
              >
                Try it on a sample
              </button>
              {downloaded && (
                <button
                  type="button"
                  className="btn btn-mini"
                  onClick={async () => {
                    if (!window.confirm(`Delete the downloaded ${m.label} from this browser? It would be downloaded again next time.`)) return;
                    await unloadEngine();
                    const w = await import('../../ai/webllm');
                    await w.removeDownload(s.ai.model);
                    setDownloaded(false);
                  }}
                >
                  Remove the download
                </button>
              )}
            </div>
            <div className="mt-2 text-[12.5px]" data-testid="ai-status">
              {status.state === 'idle' && <span className="hint">{downloaded ? 'Downloaded. It loads the first time it is used.' : 'Not downloaded yet.'}</span>}
              {status.state === 'checking' && 'Checking the graphics chip…'}
              {status.state === 'loading' && (
                <>
                  <div className="progress my-1">
                    <span style={{ width: `${Math.round(status.progress * 100)}%` }} />
                  </div>
                  <span className="hint">{status.text}</span>
                </>
              )}
              {status.state === 'ready' && <span className="badge badge-good">Ready: {modelChoice(status.model).label}</span>}
              {status.state === 'unsupported' && <span className="notice notice-warn block">{status.reason}</span>}
              {status.state === 'error' && <span className="notice notice-error block">{status.message}</span>}
            </div>
            {gpu && <div className="hint mt-2">{gpu}</div>}
            {test && <div className="notice notice-info mt-2">{test}</div>}
          </>
        )}
      </div>
    </Section>
  );
}

function OutlookSettings() {
  const { state, actions } = useApp();
  const o = state.doc.settings.outlook;
  const set = (patch: Partial<S['outlook']>) => actions.apply((d) => updateSettings(d, { outlook: { ...d.settings.outlook, ...patch } }));
  const redirect = typeof location !== 'undefined' && location.protocol.startsWith('http') ? `${location.origin}/auth.html` : 'http://localhost:47810/auth.html';
  return (
    <Section title="Outlook">
      <div className="card">
        <p className="text-[13px]">
          Reads your sent mail, flags and calendar through Microsoft Graph to suggest items. It needs IT to register Ledger in Microsoft Entra (a single-page app, redirect address{' '}
          <span className="mono">{redirect}</span>, delegated permissions Mail.Read and Calendars.Read). The steps are in <span className="mono">docs/OUTLOOK.md</span>.
        </p>
        <label className="check mt-3">
          <input type="checkbox" checked={o.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="outlook-toggle" /> Use Outlook
        </label>
        {o.enabled && (
          <div className="mt-3 grid2">
            <label className="field block">
              <span className="field-l">Application (client) id</span>
              <CommitInput value={o.clientId} placeholder="00000000-0000-0000-0000-000000000000" onCommit={(v) => set({ clientId: v.trim() })} />
            </label>
            <label className="field block">
              <span className="field-l">Directory (tenant) id</span>
              <CommitInput value={o.tenantId} placeholder="organizations" onCommit={(v) => set({ tenantId: v.trim() || 'organizations' })} />
            </label>
            <Num label="Read sent mail from the last (days)" value={o.lookback} min={1} onChange={(n) => set({ lookback: n })} />
            <Num label="Suggest after no reply for (working days)" value={o.noReplyAfter} min={1} onChange={(n) => set({ noReplyAfter: n })} />
          </div>
        )}
      </div>
    </Section>
  );
}

function About() {
  const { actions } = useApp();
  return (
    <Section title="About and shortcuts">
      <div className="card text-[13px]">
        <div>
          Build {buildLabel()}, running from <span className="mono">{runningFrom()}</span>.
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1">
          <span>
            <Kbd>Ctrl K</Kbd> commands and search
          </span>
          <span>
            <Kbd>Ctrl N</Kbd> or <Kbd>N</Kbd> add an item
          </span>
          <span>
            <Kbd>Tab</Kbd> in the add line: I owe / Waiting on
          </span>
          <span>
            <Kbd>Ctrl Z</Kbd> undo
          </span>
          <span>
            <Kbd>J</Kbd> <Kbd>K</Kbd> move in a list, <Kbd>Enter</Kbd> open
          </span>
          <span>
            <Kbd>C</Kbd> chase, <Kbd>D</Kbd> done, <Kbd>S</Kbd> snooze
          </span>
        </div>
        <button type="button" className="btn btn-mini mt-3" onClick={actions.undo} disabled={!actions.canUndo}>
          <Icon name="undo" size={12} /> Undo the last change
        </button>
      </div>
    </Section>
  );
}
