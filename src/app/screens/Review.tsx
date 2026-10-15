/**
 * The weekly review: every item nobody has touched in a while, one at a time, each
 * kept, chased, snoozed, closed or dropped with one key. Then what the ledger itself
 * suggests (escalations, dead items, risks), and the week in a few lines.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAiStatus } from '../../ai/manager';
import { age, chasePlan, suggestions } from '../../engine/decide';
import { calendarOf, drop, markReviewed, updateSettings } from '../../engine/ops';
import { reviewQueue, weekSummary, weekSummaryText, weekdayName } from '../../engine/review';
import type { Item } from '../../engine/types';
import { useAi } from '../ai';
import { Icon } from '../components/icons';
import { historyWord } from '../components/ItemDrawer';
import { ItemRow, snoozeChoices, useItemActions } from '../components/ItemRow';
import { Badge, copyRich, Empty, Hero, Kbd, Section } from '../components/ui';
import { fmtWhen, makeFmt } from '../format';
import { useApp } from '../state';

export function Review() {
  const [tab, setTab] = useState<'walk' | 'suggest' | 'week'>('walk');
  const { state, ctx } = useApp();
  const sugg = suggestions(ctx);
  return (
    <div>
      <Hero
        eyebrow="Keep it honest"
        title="Weekly review"
        sub={`Ten minutes on ${weekdayName(state.doc.settings.review.weekday)}s keeps the list worth trusting.${state.doc.settings.review.lastDone ? ` Last done ${state.doc.settings.review.lastDone}.` : ''}`}
        actions={
          <div className="seg" role="tablist">
            <button type="button" aria-pressed={tab === 'walk'} onClick={() => setTab('walk')}>
              Gone quiet
            </button>
            <button type="button" aria-pressed={tab === 'suggest'} onClick={() => setTab('suggest')}>
              Suggestions {sugg.length ? `(${sugg.length})` : ''}
            </button>
            <button type="button" aria-pressed={tab === 'week'} onClick={() => setTab('week')}>
              The week
            </button>
          </div>
        }
      />
      <div className="page page-narrow">{tab === 'walk' ? <Walk /> : tab === 'suggest' ? <Suggest /> : <Week />}</div>
    </div>
  );
}

function Walk() {
  const { state, ctx, actions } = useApp();
  const queue = useMemo(() => reviewQueue(ctx), [ctx]);
  // The list is fixed when the review starts, so acting on an item does not reshuffle it.
  const [ids] = useState(() => queue.map((i) => i.id));
  const [pos, setPos] = useState(0);
  const items = ids.map((id) => state.doc.items.find((i) => i.id === id)).filter((i): i is Item => !!i);
  const cur = items[pos];
  const a = useItemActions();
  const s = state.doc.settings;
  const cal = calendarOf(s);
  const fmt = makeFmt(s.dateOrder, state.today, cal);

  const next = () => setPos((p) => p + 1);
  const keep = () => {
    if (!cur) return;
    actions.apply((d) => markReviewed(d, cur.id, new Date()));
    next();
  };
  const finish = () => actions.apply((d) => updateSettings(d, { review: { ...d.settings.review, lastDone: state.today } }), 'Review done for this week.');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!cur || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === 'k') keep();
      else if (k === 'c' && cur.direction === 'wait' && cur.status === 'open') a.chase([cur.id]);
      else if (k === 's') {
        a.snooze(cur, snoozeChoices(state.today, cal)[2].day);
        next();
      } else if (k === 'd') {
        a.close(cur);
        next();
      } else if (k === 'x') {
        actions.apply((d) => drop(d, cur.id, 'Dropped in the weekly review', new Date()), `Dropped #${cur.num}`);
        next();
      } else if (k === 'arrowright' || k === 'j') next();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!items.length)
    return (
      <div className="card">
        <Empty title="Nothing has gone quiet.">Every open item has been touched in the last {s.review.staleAfter} working days.</Empty>
        <div className="text-center">
          <button type="button" className="btn btn-primary" onClick={finish}>
            Mark this week's review done
          </button>
        </div>
      </div>
    );
  if (!cur)
    return (
      <div className="card">
        <Empty title={`All ${items.length} looked at.`}>Have a look at the suggestions and the week, then mark it done.</Empty>
        <div className="text-center">
          <button type="button" className="btn btn-primary" onClick={finish} data-testid="review-finish">
            Mark this week's review done
          </button>
        </div>
      </div>
    );

  const plan = chasePlan(cur, ctx);
  const recent = [...cur.history].reverse().slice(0, 4);
  return (
    <div className="review-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="hint">
          {pos + 1} of {items.length} untouched for {s.review.staleAfter}+ working days
        </span>
        <span className="hint">
          <Kbd>K</Kbd> keep <Kbd>C</Kbd> chase <Kbd>S</Kbd> snooze <Kbd>D</Kbd> done <Kbd>X</Kbd> drop <Kbd>J</Kbd> skip
        </span>
      </div>
      <div className="progress mb-3">
        <span style={{ width: `${(pos / items.length) * 100}%` }} />
      </div>
      <div className="list-card rows">
        <ItemRow item={cur} />
      </div>
      <div className="card mt-3 text-[13px]">
        <div>
          Waiting {age(cur, ctx).waited} working days; untouched for {age(cur, ctx).idle}.{plan ? ` Next chase ${fmt.both(plan.day)}: ${plan.reason}.` : ''}
        </div>
        <ul className="history mt-2">
          {recent.map((h, i) => (
            <li key={i}>
              <span className="h-when">{fmtWhen(h.at)}</span>
              <span>
                {historyWord(h.kind, cur)}
                {h.text ? `: ${h.text}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={keep} data-testid="review-keep">
          Keep
        </button>
        {cur.direction === 'wait' && (
          <button type="button" className="btn" onClick={() => a.chase([cur.id])}>
            <Icon name="mail" size={14} /> Chase
          </button>
        )}
        <button type="button" className="btn" onClick={() => (a.snooze(cur, snoozeChoices(state.today, cal)[2].day), next())}>
          <Icon name="moon" size={14} /> Snooze to Monday
        </button>
        <button type="button" className="btn" onClick={() => (a.close(cur), next())}>
          <Icon name="check" size={14} /> {cur.direction === 'wait' ? 'Received' : 'Done'}
        </button>
        <button type="button" className="btn" onClick={() => (actions.apply((d) => drop(d, cur.id, 'Dropped in the weekly review', new Date()), `Dropped #${cur.num}`), next())}>
          Drop
        </button>
        <button type="button" className="btn btn-mini ml-auto" onClick={next}>
          Skip
        </button>
      </div>
    </div>
  );
}

function Suggest() {
  const { state, ctx, actions } = useApp();
  const list = suggestions(ctx);
  const byKind = (k: string) => list.filter((s) => s.kind === k);
  const item = (id: string) => state.doc.items.find((i) => i.id === id)!;
  const block = (title: string, kind: 'escalate' | 'dead' | 'risk', act: (it: Item) => ReactNode) => {
    const xs = byKind(kind);
    if (!xs.length) return null;
    return (
      <Section title={title} count={xs.length}>
        <div className="list-card rows">
          {xs.map((s) => (
            <div key={s.itemId}>
              <ItemRow item={item(s.itemId)} reason={s.reason} />
              <div className="flex gap-2 border-b border-[var(--gray-100)] px-4 pb-3 pl-[82px]">{act(item(s.itemId))}</div>
            </div>
          ))}
        </div>
      </Section>
    );
  };
  if (!list.length) return <div className="card"><Empty title="Nothing to suggest.">No item has been chased into silence, gone dead, or put something you owe at risk.</Empty></div>;
  return (
    <div>
      {block('Escalate', 'escalate', (it) => (
        <button type="button" className="btn btn-mini btn-primary" onClick={() => actions.setUi({ chase: { itemIds: [it.id], level: 'escalate' } })}>
          Draft the escalation
        </button>
      ))}
      {block('Looks dead', 'dead', (it) => (
        <>
          <button type="button" className="btn btn-mini" onClick={() => actions.apply((d) => drop(d, it.id, 'Looked dead in the weekly review', new Date()), `Dropped #${it.num}`)}>
            Drop it
          </button>
          <button type="button" className="btn btn-mini" onClick={() => actions.setUi({ chase: { itemIds: [it.id], level: 'escalate' } })}>
            Escalate instead
          </button>
        </>
      ))}
      {block('At risk', 'risk', (it) => (
        <button type="button" className="btn btn-mini" onClick={() => actions.setUi({ openItem: it.id })}>
          Open it
        </button>
      ))}
      <p className="hint mt-4">
        <Badge tone="muted">How</Badge> These come from your own history: chases with no movement, silence well past what this person usually takes, and inputs likely to land after your deadline.
      </p>
    </div>
  );
}

function Week() {
  const { state, ctx, actions } = useApp();
  const ai = useAi();
  const aiStatus = useAiStatus();
  const s = weekSummary(ctx);
  const text = weekSummaryText(s, ctx);
  const [para, setPara] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <div className="card">
        <pre className="whitespace-pre-wrap font-[inherit] text-[13px]" data-testid="week-text">
          {text}
        </pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => void copyRich(text).then((ok) => actions.toast(ok ? 'Copied.' : 'Could not reach the clipboard.', ok ? 'info' : 'error'))}>
            <Icon name="copy" size={14} /> Copy
          </button>
          {ai.on && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const sugg = suggestions(ctx)
                    .slice(0, 5)
                    .map((x) => `- ${x.kind}: #${state.doc.items.find((i) => i.id === x.itemId)?.num} ${x.reason}`);
                  setPara(await ai.brief('week', `${text}\n\nWatch:\n${sugg.join('\n')}`));
                } catch (err) {
                  actions.toast(`The model could not write it: ${(err as Error).message}`, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="sparkle" size={14} /> {busy ? (aiStatus.state === 'loading' ? `Loading ${Math.round(aiStatus.progress * 100)}%` : 'Writing…') : 'Write it as a paragraph'}
            </button>
          )}
        </div>
      </div>
      {para && (
        <div className="card mt-3">
          <span className="ai-mark">
            <Icon name="sparkle" size={11} /> written by the on-device model; check it before sending
          </span>
          <p className="mt-2 whitespace-pre-wrap text-[13.5px]">{para}</p>
          <button type="button" className="btn btn-mini mt-2" onClick={() => void copyRich(para)}>
            Copy
          </button>
        </div>
      )}
    </div>
  );
}
