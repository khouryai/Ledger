/**
 * Capture: paste an email, a whole thread or your meeting notes, or drop a saved
 * .eml or .msg file, and pick out the actions in it. The rules read it at once; the
 * on-device model, when it is switched on, reads it again in its own way. Every
 * suggestion is checked against the text and accepted by hand.
 */
import { useMemo, useState } from 'react';
import { useAiStatus } from '../../ai/manager';
import { findAsks } from '../../engine/asks';
import { isMe, parseEml, parsePasted, type Message } from '../../engine/email';
import { addPerson, calendarOf } from '../../engine/ops';
import { matchPerson } from '../../engine/people';
import type { Source } from '../../engine/types';
import { useAi } from '../ai';
import { Icon } from '../components/icons';
import { draftFromAsk, SuggestionList, type Draft } from '../components/Suggestions';
import { Hero } from '../components/ui';
import { makeFmt } from '../format';
import { useApp } from '../state';

export function Capture() {
  const { state, actions } = useApp();
  const doc = state.doc;
  const s = doc.settings;
  const cal = calendarOf(s);
  const fmt = makeFmt(s.dateOrder, state.today, cal);
  const ai = useAi();
  const aiStatus = useAiStatus();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Message[] | null>(null);
  const [pick, setPick] = useState(0);
  const [fromMeOverride, setFromMeOverride] = useState<boolean | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const messages: Message[] = useMemo(() => files ?? (text.trim() ? parsePasted(text) : []), [files, text]);
  const msg = messages[Math.min(pick, messages.length - 1)];
  const me = { name: s.myName, email: s.myEmail };
  // Text with no From line above it is your own: notes, or the reply you were writing.
  const fromMe = fromMeOverride ?? (msg?.from ? isMe(msg.from, me) : true);
  const sender = !fromMe ? msg?.from : undefined;
  const recipient = fromMe ? msg?.to.find((a) => !isMe(a, me)) : undefined;
  const isNotes = !msg?.from && !msg?.subject;
  const source: Source | undefined = msg ? (isNotes ? { kind: 'conversation', ref: 'Notes', date: state.today } : { kind: 'email', ref: msg.subject, date: msg.date }) : undefined;
  const newPeople = msg ? [msg.from, ...msg.to, ...msg.cc].filter((a): a is NonNullable<typeof a> => !!a && !isMe(a, me) && matchPerson(doc.people, a).kind === 'none') : [];

  const runRules = () => {
    if (!msg) return;
    const asks = findAsks(msg.body, { today: state.today, cal, order: s.dateOrder, people: doc.people, fromMe, sender, recipient, myName: s.myName });
    setDrafts(asks.map((a, i) => ({ ...draftFromAsk(a, i, 'rule'), askedOn: msg.date && msg.date < state.today ? msg.date : undefined })));
  };

  const runAi = async () => {
    if (!msg) return;
    setAiBusy('Starting');
    try {
      const asks = await ai.extract(msg.body, { fromMe, sender: sender?.name, recipient: recipient?.name }, (d, t) => setAiBusy(t > 1 ? `Reading part ${Math.min(d + 1, t)} of ${t}` : 'Reading'));
      setDrafts(asks.map((a, i) => ({ ...draftFromAsk(a, i, 'ai'), askedOn: msg.date && msg.date < state.today ? msg.date : undefined })));
    } catch (err) {
      actions.toast(`The model could not read it: ${(err as Error).message}. The rules still work.`, 'error');
    } finally {
      setAiBusy(null);
    }
  };

  const loadFiles = async (list: FileList | File[]) => {
    const out: Message[] = [];
    for (const f of Array.from(list)) {
      try {
        if (/\.msg$/i.test(f.name)) {
          const { parseMsg } = await import('../../io/msg');
          out.push(parseMsg(await f.arrayBuffer()));
        } else {
          const buf = new Uint8Array(await f.arrayBuffer());
          let latin = '';
          for (let i = 0; i < buf.length; i += 8192) latin += String.fromCharCode(...buf.subarray(i, i + 8192));
          out.push(parseEml(latin));
        }
      } catch (err) {
        actions.toast(`Could not read ${f.name}: ${(err as Error).message}`, 'error');
      }
    }
    if (out.length) {
      setFiles(out);
      setText('');
      setPick(0);
      setDrafts(null);
      setFromMeOverride(null);
    }
  };

  const reset = () => {
    setText('');
    setFiles(null);
    setDrafts(null);
    setPick(0);
    setFromMeOverride(null);
  };

  return (
    <div>
      <Hero
        eyebrow="Work"
        title="Capture"
        sub="Paste an email, a thread, or your notes from a meeting, or drop a saved email file. Ledger picks out what was asked, promised or given as an action, and you choose what to keep."
      />
      <div className="page page-narrow">
        {!messages.length ? (
          <div
            className="dropzone p-4"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) void loadFiles(e.dataTransfer.files);
              else {
                const t = e.dataTransfer.getData('text/plain');
                if (t) setText(t);
              }
            }}
          >
            <textarea
              className="textarea"
              style={{ minHeight: 220 }}
              placeholder={'Paste here.\n\nFrom Outlook: open the email, Ctrl+A, Ctrl+C, then paste. A whole thread is fine.\nMeeting notes work too: "Sam to send the cable schedule by Friday", "Action: Priya - update the ICD".'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              data-testid="capture-text"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="hint">Or drop a saved .eml or .msg file here (in classic Outlook, drag the email onto the desktop first).</span>
              <label className="btn btn-mini cursor-pointer">
                <Icon name="inbox" size={13} /> Choose a file
                <input type="file" accept=".eml,.msg,message/rfc822" multiple className="hidden" onChange={(e) => e.target.files && void loadFiles(e.target.files)} />
              </label>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {isNotes ? (
                  <div className="card-title">Notes</div>
                ) : (
                  <>
                    <div className="card-title truncate">{msg?.subject || '(no subject)'}</div>
                    <div className="hint mt-0.5">
                      {msg?.from ? `From ${msg.from.name}` : 'From you (the newest part of the paste)'}
                      {msg?.date ? `, ${fmt.day(msg.date)}` : ''}
                      {msg?.to.length ? ` · to ${msg.to.map((a) => a.name).join(', ')}` : ''}
                    </div>
                  </>
                )}
              </div>
              <button type="button" className="btn btn-mini" onClick={reset}>
                Start again
              </button>
            </div>
            {messages.length > 1 && (
              <div className="mt-3">
                <span className="field-l">This thread has {messages.length} messages. Read:</span>
                <div className="flex flex-wrap gap-2">
                  {messages.map((m, i) => (
                    <button key={i} type="button" className={`chip${i === pick ? ' is-new' : ''}`} onClick={() => (setPick(i), setDrafts(null), setFromMeOverride(null))}>
                      {i === 0 ? 'Newest' : `${i + 1}`}: {m.from?.name ?? 'you'}
                      {m.date ? `, ${fmt.day(m.date)}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="field-l mb-0">Written by</span>
              <div className="seg">
                <button type="button" aria-pressed={fromMe} onClick={() => (setFromMeOverride(true), setDrafts(null))}>
                  Me
                </button>
                <button type="button" aria-pressed={!fromMe} onClick={() => (setFromMeOverride(false), setDrafts(null))}>
                  {msg?.from && !isMe(msg.from, me) ? msg.from.name : 'Someone else'}
                </button>
              </div>
              {!s.myName && <span className="hint">Add your name in Settings and this is worked out for you.</span>}
            </div>
            <div className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--line-soft)] bg-[var(--surface-2)] p-3 text-[12.5px]">{msg?.body || '(empty)'}</div>
            {newPeople.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="hint">Not in your people yet: {newPeople.map((a) => a.name).join(', ')}.</span>
                <button
                  type="button"
                  className="btn btn-mini"
                  onClick={() => actions.apply((d) => newPeople.reduce((doc2, a) => addPerson(doc2, { name: a.name, email: a.email }, new Date()).doc, d), `Added ${newPeople.length} ${newPeople.length === 1 ? 'person' : 'people'}.`)}
                >
                  Add them
                </button>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" onClick={runRules} data-testid="capture-rules">
                Find the actions
              </button>
              {ai.on && (
                <button type="button" className="btn" disabled={!!aiBusy} onClick={() => void runAi()} data-testid="capture-ai">
                  <Icon name="sparkle" size={14} />
                  {aiBusy ? (aiStatus.state === 'loading' ? `Loading the model ${Math.round(aiStatus.progress * 100)}%` : aiStatus.state === 'checking' ? 'Checking the laptop' : aiBusy) : 'Find them with the on-device model'}
                </button>
              )}
            </div>
            {aiStatus.state === 'loading' && aiBusy && <div className="hint mt-2">{aiStatus.text}</div>}
          </div>
        )}
        {drafts && (
          <div className="mt-5">
            <div className="section-h">
              <h2 className="section-t">{drafts.length ? `${drafts.length} found` : 'Found nothing'}</h2>
              <span className="section-n">{drafts[0]?.from === 'ai' ? 'by the on-device model' : 'by the rules'}</span>
            </div>
            <SuggestionList drafts={drafts} setDrafts={setDrafts} source={source} emptyText="Nothing reads as a request, a promise or an action. Add it with the line at the top if there is one." />
          </div>
        )}
      </div>
    </div>
  );
}
