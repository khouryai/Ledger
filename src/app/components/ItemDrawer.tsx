/**
 * One item, everything about it: its fields, when it will be chased and why, what it
 * is waiting on, what happened to it. Opened from any list; Esc closes it.
 */
import { useEffect, useState } from 'react';
import { useAiStatus } from '../../ai/manager';
import { age, chasePlan, expectedArrival, isSnoozed, risk } from '../../engine/decide';
import { learn, judgeReply, type ReplyLabel } from '../../engine/learn';
import { addNote, addPerson, addStep, calendarOf, complete, drop, link, moveStep, recordPromise, removeStep, renameStep, reopen, toggleStep, unlink, updateItem, levelWord, wouldCycle, type ItemPatch } from '../../engine/ops';
import { describeRecurrence, nextOccurrence, ruleOf } from '../../engine/recur';
import { checkReplyRules, type ReplyCheck } from '../../engine/reply';
import { occurrenceDay, outcome, seriesOf } from '../../engine/series';
import { personStats } from '../../engine/stats';
import type { Item, LedgerDoc } from '../../engine/types';
import { useAi } from '../ai';
import { useLearned } from '../learning';
import { fmtWhen, makeFmt } from '../format';
import { href } from '../router';
import { useApp } from '../state';
import { CommitInput, DateField, PersonField } from './fields';
import { Icon } from './icons';
import { snoozeChoices, useItemActions } from './ItemRow';
import { RecurLabel } from './Schedule';
import { Avatar, Badge, IconButton, MenuButton, Modal } from './ui';

export function ItemDrawer() {
  const { state, ui, actions } = useApp();
  const item = state.doc.items.find((i) => i.id === ui.openItem);
  useEffect(() => {
    if (!ui.openItem) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !ui.chase) actions.setUi({ openItem: null });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ui.openItem, ui.chase, actions]);
  if (!item) return null;
  return (
    <>
      <div className="drawer-scrim" onMouseDown={() => actions.setUi({ openItem: null })} />
      <aside className="drawer" role="dialog" aria-label={`Item ${item.num}`}>
        <Body item={item} key={item.id} />
      </aside>
    </>
  );
}

function Body({ item }: { item: Item }) {
  const { state, ctx, actions } = useApp();
  const doc = state.doc;
  const s = doc.settings;
  const cal = calendarOf(s);
  const fmt = makeFmt(s.dateOrder, state.today, cal);
  const a = useItemActions();
  const ai = useAi();
  const aiStatus = useAiStatus();
  const person = doc.people.find((p) => p.id === item.personId);
  const ag = age(item, ctx);
  const plan = chasePlan(item, ctx);
  const exp = item.direction === 'wait' && item.status === 'open' ? expectedArrival(item, ctx) : null;
  const rk = risk(item, ctx);
  const st = person ? personStats(doc.items, person.id, s, cal) : null;
  const blockers = item.blockedBy.map((id) => doc.items.find((x) => x.id === id)).filter((x): x is Item => !!x);
  const blocks = doc.items.filter((x) => x.blockedBy.includes(item.id));
  const candidates = doc.items.filter((x) => x.id !== item.id && x.status === 'open' && x.direction === 'wait' && !item.blockedBy.includes(x.id) && !wouldCycle(doc, item.id, x.id));
  const [note, setNote] = useState('');
  const [linkText, setLinkText] = useState('');
  const [reply, setReply] = useState('');
  const [check, setCheck] = useState<ReplyCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [taught, setTaught] = useState(false);
  const learned = useLearned();
  const [editChase, setEditChase] = useState(!!item.nextChase);
  const [showReply, setShowReply] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dropWhy, setDropWhy] = useState('');

  const patch = (p: ItemPatch, msg?: string) =>
    actions.apply(
      (d) =>
        updateItem(d, item.id, p, new Date(), (field, from, to) => {
          const name = (id: unknown) => doc.people.find((x) => x.id === id)?.name ?? 'nobody';
          if (field === 'personId') return `Person: ${name(from)} → ${name(to)}`;
          if (field === 'direction') return `Changed to ${to === 'owe' ? 'I owe' : 'Waiting on'}`;
          if (field === 'title') return `Renamed from "${from}"`;
          const label = field === 'due' ? (item.direction === 'owe' ? 'Due' : 'Promised') : field === 'askedOn' ? 'Asked on' : 'Next chase';
          return `${label}: ${from ? fmt.day(from as string) : 'none'} → ${to ? fmt.day(to as string) : 'none'}`;
        }),
      msg,
    );

  // Where the learning is sure and disagrees, its reading is shown instead, with why.
  const withLearned = (c: ReplyCheck): ReplyCheck => {
    setTaught(false);
    const j = judgeReply(learned.reply, reply, c.verdict);
    return j ? { ...c, verdict: j.verdict, summary: j.reason, by: 'learned' } : c;
  };
  // What the user did with a verdict is what it is learned from, once per check.
  const teach = (d: LedgerDoc, label: ReplyLabel): LedgerDoc => (taught || !check ? d : learn(d, [{ task: 'reply', text: reply, label, proposed: check.verdict }], new Date()));
  const VERDICT: Record<ReplyLabel, string> = { delivered: 'Delivered', partial: 'Part delivered', stall: 'Not delivered', unclear: 'Unclear' };

  const runCheck = async () => {
    if (!reply.trim()) return;
    setChecking(true);
    try {
      setCheck(withLearned(ai.on ? await ai.reply(item, reply) : checkReplyRules(reply, state.today, cal, s.dateOrder)));
    } catch (err) {
      actions.toast(`The model could not check it (${(err as Error).message}). Checked by rules instead.`, 'error');
      setCheck(withLearned(checkReplyRules(reply, state.today, cal, s.dateOrder)));
    } finally {
      setChecking(false);
    }
  };

  const rule = ruleOf(item);
  const series = seriesOf(doc, item);

  const dirWord = item.direction === 'owe' ? 'I owe' : 'Waiting on';
  const isOpen = item.status === 'open';
  const snoozeItems = [
    ...snoozeChoices(state.today, cal).map((c) => ({ label: `${c.label} (${fmt.day(c.day)})`, onClick: () => a.snooze(item, c.day) })),
    ...(isSnoozed(item, state.today) ? [{ label: 'Wake now', onClick: () => a.snooze(item, undefined) }] : []),
  ];

  return (
    <>
      <div className="drawer-h">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`dir-ico dir-${item.direction}`} aria-hidden="true">
              <Icon name={item.direction} size={14} />
            </span>
            <span className="eyebrow">
              {dirWord} · #{item.num}
            </span>
            <Badge tone={ag.tone}>{ag.label}</Badge>
            {rule && <RecurLabel recur={rule} className="hint" />}
          </div>
          <IconButton icon="x" label="Close (Esc)" onClick={() => actions.setUi({ openItem: null })} />
        </div>
        <div className="mt-2">
          <CommitInput grow className="title-edit" value={item.title} onCommit={(v) => v.trim() && patch({ title: v.trim() })} ariaLabel="Title" testid="item-title" />
        </div>
        {person && (
          <a className="drawer-person" href={href('people', { id: person.id })} onClick={() => actions.setUi({ openItem: null })}>
            <Avatar name={person.name} size={22} />
            <span>
              {item.direction === 'owe' ? 'For' : 'From'} <b>{person.name}</b>
              {person.company ? ` · ${person.company}` : ''}
            </span>
          </a>
        )}
        <div className="drawer-acts mt-3 flex flex-wrap gap-2">
          {isOpen ? (
            <>
              {item.direction === 'wait' && (
                <button type="button" className="btn btn-primary" onClick={() => a.chase([item.id])} data-testid="drawer-chase">
                  <Icon name="mail" size={14} /> Chase
                </button>
              )}
              <button type="button" className={`btn${item.direction === 'owe' ? ' btn-primary' : ''}`} onClick={() => a.close(item, note || undefined)} data-testid="drawer-done">
                <Icon name="check" size={14} /> {item.direction === 'wait' ? 'Received' : 'Done'}
              </button>
              <MenuButton label="Snooze" icon="moon" showLabel className="btn" items={snoozeItems} />
              <button type="button" className="btn" onClick={() => setDropping(true)}>
                <Icon name="x" size={14} /> Drop
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => actions.apply((d) => reopen(d, item.id, new Date()), `Reopened #${item.num}`)}>
              <Icon name="undo" size={14} /> Reopen
            </button>
          )}
        </div>
      </div>

      <div className="drawer-b">
        {!isOpen && (
          <div className="notice notice-info mb-4">
            {item.status === 'done' ? (item.direction === 'wait' ? 'Received' : 'Done') : 'Dropped'} {fmt.day(item.closedOn)}
            {item.closeNote ? `: ${item.closeNote}` : '.'}
          </div>
        )}

        {isOpen && (plan || rk || exp || item.direction === 'owe') && (
          <section className="d-sec" aria-labelledby="d-stands">
            <h3 className="d-h" id="d-stands">
              Where it stands
            </h3>
            {plan && (
              <div className="plan" data-testid="chase-plan">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <b>{plan.day <= state.today ? 'Chase now' : `Next chase ${fmt.both(plan.day)}`}</b>
                    <span className="hint">
                      {' '}
                      · {levelWord(plan.level).toLowerCase()}, {plan.levelReason}
                    </span>
                  </div>
                  <button type="button" className="link text-[12px]" onClick={() => setEditChase((v) => !v)} aria-expanded={editChase}>
                    {item.nextChase ? 'Change the date you set' : 'Choose a date instead'}
                  </button>
                </div>
                <div className="hint mt-1">{plan.reason}.</div>
                {editChase && (
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <div className="w-56">
                      <DateField label="Chase on" value={item.nextChase} onChange={(d) => patch({ nextChase: d })} placeholder="fri, 11/14, +3d" />
                    </div>
                    {item.nextChase && (
                      <button type="button" className="link mb-3 text-[12px]" onClick={() => patch({ nextChase: undefined })}>
                        Go back to the worked-out date
                      </button>
                    )}
                  </div>
                )}
                {exp && (
                  <div className="plan-line">
                    <Icon name="clock" size={13} /> {exp.day ? `Likely to arrive ${fmt.both(exp.day)}` : 'No telling when it will arrive yet'}. {exp.reason}.
                  </div>
                )}
              </div>
            )}
            {item.direction === 'owe' && !rk && (
              <div className="plan">
                <b>{item.due ? `${item.due < state.today ? 'Was due' : 'Due'} ${fmt.both(item.due)}` : 'No deadline set'}</b>
                {!item.due && <span className="hint"> · give it one below, and Today will bring it up in time.</span>}
              </div>
            )}
            {rk && (
              <div className={`notice ${rk.level === 'risk' ? 'notice-error' : 'notice-warn'}`}>
                <b>{rk.level === 'risk' ? 'At risk.' : 'Cannot tell yet.'}</b> {rk.reason}.
              </div>
            )}
            {person && st && (
              <div className="hint mt-2">
                {st.samples > 0
                  ? `${person.name.split(' ')[0]} has delivered ${st.samples} before: usually in ${st.deliveryDays} working days${st.promisesKept !== null ? `, ${Math.round(st.promisesKept * 100)}% of promises kept` : ''}.`
                  : st.recurring > 0
                    ? `${person.name.split(' ')[0]} has sent ${st.recurring} on a schedule but nothing you asked for yet, so the defaults apply.`
                    : `Nothing received from ${person.name.split(' ')[0]} yet, so the defaults apply.`}
              </div>
            )}
          </section>
        )}

        {series && <Repeats item={item} />}

        {(isOpen || item.steps) && <Steps item={item} />}

        <section className="d-sec" aria-labelledby="d-details">
          <h3 className="d-h" id="d-details">
            Details
          </h3>
          <div className="grid2">
            <div className="field">
              <span className="field-l">Type</span>
              <div className="seg">
                <button type="button" aria-pressed={item.direction === 'owe'} onClick={() => patch({ direction: 'owe' })}>
                  I owe
                </button>
                <button type="button" aria-pressed={item.direction === 'wait'} onClick={() => patch({ direction: 'wait' })}>
                  Waiting on
                </button>
              </div>
            </div>
            <PersonField
              value={item.personId}
              label={item.direction === 'owe' ? 'For' : 'From'}
              onChange={(id, newName) => {
                if (newName) {
                  actions.apply((d) => {
                    const r = addPerson(d, { name: newName }, new Date());
                    return updateItem(r.doc, item.id, { personId: r.person.id }, new Date(), () => `Person: ${person?.name ?? 'nobody'} → ${newName}`);
                  });
                } else patch({ personId: id });
              }}
            />
            <DateField label="Asked on" value={item.askedOn} onChange={(d) => d && patch({ askedOn: d })} />
            <DateField label={item.direction === 'owe' ? 'Due' : 'They promised'} value={item.due} onChange={(d) => patch({ due: d })} testid="item-due" />
            <label className="field block">
              <span className="field-l">Tags</span>
              <CommitInput
                value={item.tags.map((t) => `#${t}`).join(' ')}
                placeholder="#BART #IXL"
                onCommit={(v) => patch({ tags: [...new Set(v.split(/[\s,]+/).map((t) => t.replace(/^#/, '')).filter(Boolean))] })}
              />
            </label>
            <div className="field">
              <span className="field-l">Repeats</span>
              {rule && isOpen ? (
                <button type="button" className="btn btn-mini" onClick={() => a.schedule(item)} data-testid="drawer-schedule">
                  <Icon name="repeat" size={12} /> {describeRecurrence(rule, { order: s.dateOrder, today: state.today })}
                </button>
              ) : rule ? (
                <span className="hint">{describeRecurrence(rule, { order: s.dateOrder, today: state.today })}</span>
              ) : isOpen ? (
                <button type="button" className="btn btn-mini" onClick={() => a.schedule(item)} data-testid="drawer-make-repeat">
                  <Icon name="repeat" size={12} /> Make it repeat…
                </button>
              ) : (
                <span className="hint">Does not repeat</span>
              )}
            </div>
          </div>
          {item.source && (
            <div className="hint">
              Came from {item.source.kind === 'meeting' ? 'a meeting' : item.source.kind === 'email' ? 'an email' : item.source.kind === 'outlook' ? 'Outlook' : item.source.kind}
              {item.source.ref ? `: ${item.source.ref}` : ''}
              {item.source.date ? `, ${fmt.day(item.source.date)}` : ''}.
            </div>
          )}
        </section>

        <section className="d-sec" aria-labelledby="d-needs">
          <h3 className="d-h" id="d-needs">
            {item.direction === 'owe' ? 'Waiting on for this' : 'Needs first'}
          </h3>
          {blockers.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 py-1 text-[13px]">
              <button type="button" className="link text-left" onClick={() => actions.setUi({ openItem: b.id })}>
                #{b.num} {b.title}
              </button>
              <span className="flex items-center gap-2">
                <Badge tone={age(b, ctx).tone}>{age(b, ctx).label}</Badge>
                <IconButton icon="x" label={`Remove the link to #${b.num}`} onClick={() => actions.apply((d) => unlink(d, item.id, b.id, new Date()))} />
              </span>
            </div>
          ))}
          {isOpen && candidates.length > 0 && (
            <select className="input mt-1 w-full" aria-label="Link something this needs" value="" onChange={(e) => e.target.value && actions.apply((d) => link(d, item.id, e.target.value, new Date()), 'Linked.')}>
              <option value="">{blockers.length ? 'Add another…' : 'Link something it needs first…'}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.num} {c.title}
                  {c.personId ? ` (${doc.people.find((p) => p.id === c.personId)?.name ?? ''})` : ''}
                </option>
              ))}
            </select>
          )}
          {!blockers.length && !candidates.length && <p className="hint">Nothing linked.</p>}
          {blocks.length > 0 && (
            <div className="hint mt-2">
              Holding up:{' '}
              {blocks.map((b) => (
                <button key={b.id} type="button" className="link mr-2" onClick={() => actions.setUi({ openItem: b.id })}>
                  #{b.num} {b.title}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="d-sec" aria-labelledby="d-links">
          <h3 className="d-h" id="d-links">
            Links and notes
          </h3>
          {item.links.map((l) => (
            <div key={l} className="flex items-center justify-between gap-2 py-0.5 text-[12.5px]">
              {/^https?:\/\//i.test(l) ? (
                <a className="link truncate" href={l} target="_blank" rel="noreferrer noopener">
                  {l}
                </a>
              ) : (
                <span className="mono truncate" title="Copy this path into File Explorer">
                  {l}
                </span>
              )}
              <span className="flex">
                <IconButton icon="copy" label="Copy" onClick={() => void navigator.clipboard.writeText(l).then(() => actions.toast('Copied.', 'info'))} />
                <IconButton icon="x" label="Remove" onClick={() => patch({ links: item.links.filter((x) => x !== l) })} />
              </span>
            </div>
          ))}
          <input
            className="input mb-3 w-full"
            value={linkText}
            aria-label="Add a link or file path"
            placeholder="Paste a link or a file path, then Enter"
            onChange={(e) => setLinkText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && linkText.trim()) {
                patch({ links: [...new Set([...item.links, linkText.trim()])] });
                setLinkText('');
              }
            }}
          />
          <CommitInput multiline grow className="textarea notes-ta" value={item.notes ?? ''} placeholder="Notes worth keeping with it" ariaLabel="Notes" onCommit={(v) => patch({ notes: v.trim() || undefined })} />
        </section>

        <section className="d-sec" aria-labelledby="d-activity">
          <h3 className="d-h" id="d-activity">
            Activity
          </h3>
          {isOpen && (
            <div className="mb-3 flex gap-2">
              <input
                className="input min-w-0 flex-1"
                value={note}
                aria-label="Log what happened"
                placeholder="Log what happened: called Sam, on it by end of week"
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && note.trim()) {
                    actions.apply((d) => addNote(d, item.id, note, new Date()), 'Noted.');
                    setNote('');
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={!note.trim()}
                onClick={() => {
                  actions.apply((d) => addNote(d, item.id, note, new Date()), 'Noted.');
                  setNote('');
                }}
              >
                Log it
              </button>
            </div>
          )}

          {isOpen && item.direction === 'wait' && !showReply && (
            <button type="button" className="btn btn-mini mb-3" onClick={() => setShowReply(true)} data-testid="reply-toggle">
              <Icon name="inbox" size={13} /> They replied: check whether it closes this
            </button>
          )}
          {isOpen && item.direction === 'wait' && showReply && (
            <div className="reply-box">
              <div className="mb-1 flex items-center justify-between">
                <span className="field-l mb-0">Their reply</span>
                {ai.on && (
                  <span className="ai-mark">
                    <Icon name="sparkle" size={11} /> read by the on-device model
                  </span>
                )}
              </div>
              <textarea className="textarea" style={{ minHeight: 90 }} value={reply} placeholder="Paste their reply" onChange={(e) => setReply(e.target.value)} data-testid="reply-text" autoFocus />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-mini btn-primary" disabled={!reply.trim() || checking} onClick={() => void runCheck()} data-testid="reply-check">
                  {checking ? (aiStatus.state === 'loading' ? `Loading the model ${Math.round(aiStatus.progress * 100)}%` : 'Reading…') : 'Check'}
                </button>
                <button type="button" className="btn btn-mini" onClick={() => (setShowReply(false), setReply(''), setCheck(null))}>
                  Cancel
                </button>
                {check && (
                  <span className="text-[12.5px]">
                    <Badge tone={check.verdict === 'delivered' ? 'good' : check.verdict === 'partial' ? 'info' : check.verdict === 'stall' ? 'warn' : 'muted'}>
                      {check.verdict === 'delivered' ? 'Delivered' : check.verdict === 'partial' ? 'Part delivered' : check.verdict === 'stall' ? 'Not delivered' : 'Unclear'}
                    </Badge>{' '}
                    {check.summary} <span className="hint">({check.by === 'ai' ? 'model' : check.by === 'learned' ? 'learned from you' : check.by === 'you' ? 'yours' : 'rules'})</span>
                  </span>
                )}
              </div>
              {check && check.by !== 'you' && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="reply-correct">
                  <span className="hint">Not right? It was:</span>
                  {(['delivered', 'partial', 'stall', 'unclear'] as const)
                    .filter((v) => v !== check.verdict)
                    .map((v) => (
                      <button
                        key={v}
                        type="button"
                        className="chip"
                        onClick={() => {
                          actions.apply((d) => teach(d, v));
                          setTaught(true);
                          setCheck({ ...check, verdict: v, summary: 'As you said. Ledger learns from it.', by: 'you' });
                        }}
                      >
                        {VERDICT[v]}
                      </button>
                    ))}
                </div>
              )}
              {check && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {check.verdict === 'delivered' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-mini"
                      onClick={() => actions.apply((d) => teach(complete(d, item.id, 'Delivered (from their reply)', new Date()).doc, 'delivered'), `Received: #${item.num}`)}
                    >
                      Mark received
                    </button>
                  )}
                  {check.promise && (
                    <button
                      type="button"
                      className="btn btn-mini"
                      onClick={() => {
                        actions.apply(
                          (d) => teach(recordPromise(d, item.id, check.promise, `"${check.promisePhrase}" in their reply`, new Date(), check.by), check.verdict === 'partial' ? 'partial' : 'stall'),
                          `New promise: ${fmt.day(check.promise)}`,
                        );
                        setReply('');
                        setCheck(null);
                        setShowReply(false);
                      }}
                    >
                      Record their new date: {fmt.day(check.promise)}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-mini"
                    onClick={() => {
                      actions.apply((d) => addNote(d, item.id, `Reply: ${reply.trim().slice(0, 280)}`, new Date()), 'Kept as a note.');
                      setReply('');
                      setCheck(null);
                      setShowReply(false);
                    }}
                  >
                    Keep the reply as a note
                  </button>
                </div>
              )}
            </div>
          )}

          <ol className="history" aria-label="History">
            {[...item.history].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`} className={`tl-${h.kind}`}>
                <span className="tl-dot" aria-hidden="true" />
                <div>
                  <div className="tl-what">
                    <b>{historyWord(h.kind, item)}</b>
                    {h.due && (h.kind === 'promise' || h.kind === 'created') ? ` ${h.kind === 'promise' ? 'for' : 'due'} ${fmt.day(h.due)}` : ''}
                    {h.by && h.by !== 'you' && <span className="h-by">{h.by === 'ai' ? 'model' : h.by}</span>}
                  </div>
                  {h.text && <div className="tl-text">{h.text}</div>}
                  <div className="tl-when">{fmtWhen(h.at)}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {dropping && (
        <Modal
          title={`Drop #${item.num}?`}
          onClose={() => setDropping(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDropping(false)}>
                Keep it
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  actions.apply((d) => drop(d, item.id, dropWhy, new Date()), `Dropped #${item.num}`);
                  setDropping(false);
                }}
                data-testid="drop-confirm"
              >
                Drop it
              </button>
            </>
          }
        >
          <p className="text-[13px]">It leaves every working list and stays in Everything, with its history. You can reopen it, or undo.</p>
          <label className="field mt-3 block">
            <span className="field-l">Why (optional)</span>
            <input className="input w-full" value={dropWhy} onChange={(e) => setDropWhy(e.target.value)} placeholder="Not needed any more" data-autofocus />
          </label>
        </Modal>
      )}
    </>
  );
}

export function historyWord(kind: Item['history'][number]['kind'], it: Item): string {
  switch (kind) {
    case 'created':
      return 'Added';
    case 'chased':
      return 'Chased';
    case 'promise':
      return 'New date given';
    case 'note':
      return 'Note';
    case 'snoozed':
      return 'Snoozed';
    case 'reviewed':
      return 'Kept in review';
    case 'received':
      return 'Received';
    case 'done':
      return it.direction === 'wait' ? 'Received' : 'Done';
    case 'dropped':
      return 'Dropped';
    case 'reopened':
      return 'Reopened';
    case 'linked':
      return 'Linked';
    case 'unlinked':
      return 'Unlinked';
    case 'skipped':
      return 'Skipped';
    case 'step':
      return 'Step';
    default:
      return 'Changed';
  }
}

/**
 * A recurring item's schedule and record: what comes after this one if it is closed
 * now, how the series has gone, the occurrences before it, and what can be done to
 * the series from here.
 */
function Repeats({ item }: { item: Item }) {
  const { state, ctx, actions } = useApp();
  const doc = state.doc;
  const fmt = makeFmt(doc.settings.dateOrder, state.today, ctx.cal);
  const a = useItemActions();
  const series = seriesOf(doc, item)!;
  const rule = ruleOf(item);
  const isOpen = item.status === 'open';
  // What closing it now would put on the list: the same reckoning as complete().
  const next = rule && isOpen ? nextOccurrence(rule, item.due ?? state.today, ctx.cal, rule.catchUp ? undefined : state.today) : null;
  const then = rule && next ? nextOccurrence(rule, next, ctx.cal) : null;
  const r = series.record;
  const past = series.items.filter((i) => i.id !== item.id && i.status !== 'open').slice(-6).reverse();
  const WORD = { done: 'Done on time', late: 'Done late', skipped: 'Skipped', dropped: 'Dropped' } as const;
  return (
    <section className="d-sec" aria-labelledby="d-repeats" data-testid="drawer-repeats">
      <h3 className="d-h" id="d-repeats">
        Repeats
      </h3>
      <div className="plan">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <b>{rule ? describeRecurrence(rule, { order: doc.settings.dateOrder, today: state.today }) : 'No longer repeats'}</b>
          {rule && isOpen && (
            <button type="button" className="link text-[12px]" onClick={() => a.schedule(item)}>
              Change the schedule
            </button>
          )}
          {!isOpen && series.current && series.current.id !== item.id && (
            <button type="button" className="link text-[12px]" onClick={() => actions.setUi({ openItem: series.current!.id })}>
              Open the one in hand
            </button>
          )}
        </div>
        {isOpen && rule && (
          <div className="hint mt-1">
            {next ? `Close this one and the next is due ${fmt.both(next)}${then ? `, then ${fmt.day(then)}` : ''}.` : 'This is the last one: the schedule ends with it.'}
            {rule.catchUp ? ' Each one is owed, even when one is late.' : ' One closed late is followed by the first still to come.'}
          </div>
        )}
        {r.done + r.skipped > 0 && (
          <div className="plan-line">
            <Icon name="check" size={13} /> On time {r.onTime} of {r.done}
            {r.late ? `, ${r.late} late` : ''}
            {r.skipped ? `, ${r.skipped} skipped` : ''}
            {r.streak > 1 ? `. ${r.streak} on time in a row.` : '.'}
          </div>
        )}
        {isOpen && rule && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-mini" onClick={() => a.skip(item)} data-testid="drawer-skip">
              <Icon name="skip" size={12} /> Skip this one
            </button>
            <button type="button" className="btn btn-mini" onClick={() => a.pause(item)}>
              <Icon name="pause" size={12} /> Pause until…
            </button>
            <button
              type="button"
              className="btn btn-mini"
              onClick={() => actions.apply((d) => updateItem(d, item.id, { recur: undefined }, new Date()), `#${item.num} no longer repeats. It stays on your list as a one-off.`)}
            >
              Stop repeating
            </button>
          </div>
        )}
        {!series.active && !isOpen && series.head.id === item.id && (
          <button type="button" className="btn btn-mini mt-2" onClick={() => actions.setUi({ schedule: { kind: 'restart', seriesId: series.id } })}>
            <Icon name="repeat" size={12} /> Start it again
          </button>
        )}
      </div>
      {past.length > 0 && (
        <ul className="occ-list" aria-label="Earlier ones">
          {past.map((p) => {
            const o = outcome(p)!;
            return (
              <li key={p.id}>
                <span className={`dot dot-${o}`} aria-hidden="true" />
                <button type="button" className="link" onClick={() => actions.setUi({ openItem: p.id })}>
                  {fmt.day(occurrenceDay(p))}
                </button>
                <span className="hint">
                  {WORD[o]}
                  {o !== 'skipped' && p.closedOn && p.closedOn !== occurrenceDay(p) ? ` ${fmt.day(p.closedOn)}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A checklist. Ticks are in the history; a recurring item's next one starts unticked. */
function Steps({ item }: { item: Item }) {
  const { actions } = useApp();
  const [text, setText] = useState('');
  const steps = item.steps ?? [];
  const done = steps.filter((x) => x.done).length;
  const isOpen = item.status === 'open';
  const add = () => {
    if (!text.trim()) return;
    actions.apply((d) => addStep(d, item.id, text, new Date()));
    setText('');
  };
  return (
    <section className="d-sec" aria-labelledby="d-steps" data-testid="drawer-steps">
      <h3 className="d-h" id="d-steps">
        Steps{steps.length ? ` · ${done} of ${steps.length} done` : ''}
      </h3>
      {steps.length > 0 && (
        <>
          <div className="progress mb-2" aria-hidden="true">
            <span style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <ul className="steps">
            {steps.map((st, i) => (
              <li key={st.id} className={st.done ? 'is-done' : ''}>
                <input type="checkbox" checked={st.done} disabled={!isOpen} onChange={() => actions.apply((d) => toggleStep(d, item.id, st.id, new Date()))} aria-label={`Done: ${st.text}`} data-testid={`step-${i}`} />
                <CommitInput className="step-text" value={st.text} ariaLabel={`Step ${i + 1}`} onCommit={(v) => actions.apply((d) => renameStep(d, item.id, st.id, v, new Date()))} />
                <span className="step-acts">
                  {i > 0 && <IconButton icon="up" label={`Move "${st.text}" up`} onClick={() => actions.apply((d) => moveStep(d, item.id, st.id, -1, new Date()))} />}
                  <IconButton icon="x" label={`Remove "${st.text}"`} onClick={() => actions.apply((d) => removeStep(d, item.id, st.id, new Date()), 'Step removed.')} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {isOpen && (
        <input
          className="input w-full"
          value={text}
          aria-label="Add a step"
          placeholder={steps.length ? 'Another step, then Enter' : 'Break it into steps: type one, then Enter'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          data-testid="step-add"
        />
      )}
      {item.recur && steps.length > 0 && <p className="hint mt-1">The next one starts with these, unticked.</p>}
    </section>
  );
}
