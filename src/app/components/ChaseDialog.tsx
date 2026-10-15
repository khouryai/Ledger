/**
 * Writing a chase. The draft starts from the template for the level the item has
 * reached (or the on-device model writes it), every word can be changed, and nothing
 * is sent from here: it goes to Outlook as a draft. Whichever way it leaves, the
 * chase is logged on each item it covers, with an Undo.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAiStatus } from '../../ai/manager';
import { draftChase, draftText, emlFile, emlName, mailtoFits, mailtoUrl, type Draft } from '../../engine/chaser';
import { chaseLevel } from '../../engine/decide';
import { calendarOf, chase, levelWord } from '../../engine/ops';
import type { ChaseLevel, Item } from '../../engine/types';
import { useAi } from '../ai';
import { useApp } from '../state';
import { Icon } from './icons';
import { copyRich, downloadFile, Modal } from './ui';

const LEVELS: ChaseLevel[] = ['nudge', 'firm', 'escalate'];

export function ChaseDialog() {
  const { state, ui, actions } = useApp();
  if (!ui.chase) return null;
  const items = ui.chase.itemIds.map((id) => state.doc.items.find((i) => i.id === id)).filter((i): i is Item => !!i && i.status === 'open');
  if (!items.length) return null;
  return <Dialog items={items} initialLevel={ui.chase.level} onClose={() => actions.setUi({ chase: null })} />;
}

function Dialog({ items, initialLevel, onClose }: { items: Item[]; initialLevel?: ChaseLevel; onClose: () => void }) {
  const { state, actions } = useApp();
  const doc = state.doc;
  const s = doc.settings;
  const cal = calendarOf(s);
  const ai = useAi();
  const aiStatus = useAiStatus();
  const person = doc.people.find((p) => p.id === items[0].personId);
  const suggested = items.map((i) => chaseLevel(i, s)).sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level))[0];
  const [level, setLevel] = useState<ChaseLevel>(initialLevel ?? suggested.level);
  const [included, setIncluded] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const chosen = items.filter((i) => included.has(i.id));
  const base: Draft | null = useMemo(
    () => (chosen.length ? draftChase({ items: chosen, person, level, settings: s, today: state.today, cal }) : null),
    [chosen.map((c) => c.id).join(), level, person, s, state.today],
  );
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [writing, setWriting] = useState(false);
  const [byAi, setByAi] = useState(false);

  useEffect(() => {
    if (!base) return;
    setTo(base.to.join('; '));
    setCc(base.cc.join('; '));
    setSubject(base.subject);
    setBody(base.body);
    setByAi(false);
  }, [base]);

  const draft: Draft = { to: to.split(/;\s*/).filter(Boolean), cc: cc.split(/;\s*/).filter(Boolean), subject, body };
  const fits = mailtoFits(draft);

  const log = (channel: string) => {
    const ids = chosen.map((c) => c.id);
    actions.apply((d) => chase(d, ids, level, channel, new Date()), `${levelWord(level)} logged on ${ids.length === 1 ? `#${chosen[0].num}` : `${ids.length} items`}`);
    onClose();
  };

  const rewrite = async () => {
    setWriting(true);
    try {
      setBody(await ai.chaser(chosen, person, level));
      setByAi(true);
    } catch (err) {
      actions.toast(`The model could not write it: ${(err as Error).message}`, 'error');
    } finally {
      setWriting(false);
    }
  };

  return (
    <Modal
      wide
      title={
        <>
          Chase {person ? person.name : 'them'}
          {items.length > 1 ? `: ${chosen.length} of ${items.length} items` : `: #${items[0].num}`}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <span className="hint mr-auto self-center">Nothing is sent from Ledger. It opens in Outlook for you to send.</span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void copyRich(draftText(draft)).then((ok) => {
                actions.toast(ok ? 'Copied. Paste it into an email.' : 'Could not reach the clipboard.', ok ? 'info' : 'error');
                if (ok) log('email (copied)');
              });
            }}
          >
            <Icon name="copy" size={14} /> Copy
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              downloadFile(emlName(draft), emlFile(draft), 'message/rfc822');
              actions.toast('Draft downloaded. Open it from the download bar and press Send in Outlook.', 'info');
              log('email');
            }}
            data-testid="chase-eml"
          >
            <Icon name="download" size={14} /> Outlook draft (.eml)
          </button>
          <a
            className={`btn btn-primary${fits ? '' : ' pointer-events-none opacity-50'}`}
            href={fits ? mailtoUrl(draft) : undefined}
            onClick={() => fits && log('email')}
            data-testid="chase-mailto"
            title={fits ? 'Opens a new message in your mail program' : 'Too long for a mail link; use the Outlook draft'}
          >
            <Icon name="mail" size={14} /> Open in Outlook
          </a>
        </>
      }
    >
      {items.length > 1 && (
        <div className="mb-3 flex flex-col gap-1">
          {items.map((i) => (
            <label key={i.id} className="check">
              <input
                type="checkbox"
                checked={included.has(i.id)}
                onChange={(e) =>
                  setIncluded((cur) => {
                    const n = new Set(cur);
                    if (e.target.checked) n.add(i.id);
                    else n.delete(i.id);
                    return n;
                  })
                }
              />
              #{i.num} {i.title}
            </label>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="seg" role="group" aria-label="Tone">
          {LEVELS.map((l) => (
            <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}>
              {levelWord(l)}
            </button>
          ))}
        </div>
        <span className="hint">Suggested: {levelWord(suggested.level).toLowerCase()}, {suggested.reason}.</span>
        {ai.on && (
          <button type="button" className="btn btn-mini ml-auto" onClick={() => void rewrite()} disabled={writing || !chosen.length} data-testid="chase-ai">
            <Icon name="sparkle" size={13} />
            {writing ? (aiStatus.state === 'loading' ? `Loading the model ${Math.round(aiStatus.progress * 100)}%` : 'Writing…') : 'Write it with the on-device model'}
          </button>
        )}
      </div>
      {level === 'escalate' && !person?.escalateTo && (
        <div className="notice notice-warn mb-3">Nobody is set to copy on an escalation for {person?.name ?? 'this person'}. Add one on their page under People.</div>
      )}
      {!person?.email && <div className="notice notice-warn mb-3">{person ? `${person.name} has no email address yet. Add it under People, or type it below.` : 'This item has nobody to send it to.'}</div>}
      <div className="grid2">
        <label className="field block">
          <span className="field-l">To</span>
          <input className="input w-full" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="field block">
          <span className="field-l">Cc</span>
          <input className="input w-full" value={cc} onChange={(e) => setCc(e.target.value)} />
        </label>
      </div>
      <label className="field block">
        <span className="field-l">Subject</span>
        <input className="input w-full" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="field block">
        <span className="field-l flex items-center justify-between">
          <span>Message</span>
          {byAi && (
            <span className="ai-mark">
              <Icon name="sparkle" size={11} /> written by the on-device model; check it before sending
            </span>
          )}
        </span>
        <textarea className="textarea" style={{ minHeight: 220 }} value={body} onChange={(e) => setBody(e.target.value)} data-testid="chase-body" />
      </label>
      {!fits && <div className="hint">This one is too long for a mail link, so use the Outlook draft or Copy.</div>}
    </Modal>
  );
}
