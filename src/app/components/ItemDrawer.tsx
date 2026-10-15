/**
 * One item, everything about it: its fields, when it will be chased and why, what it
 * is waiting on, what happened to it. Opened from any list; Esc closes it.
 */
import { useEffect, useState } from 'react';
import { useAiStatus } from '../../ai/manager';
import { age, chasePlan, expectedArrival, isSnoozed, risk } from '../../engine/decide';
import { addNote, addPerson, calendarOf, drop, link, recordPromise, reopen, unlink, updateItem, levelWord, wouldCycle, type ItemPatch } from '../../engine/ops';
import { checkReplyRules, type ReplyCheck } from '../../engine/reply';
import { personStats } from '../../engine/stats';
import type { Item, Recurrence } from '../../engine/types';
import { useAi } from '../ai';
import { fmtWhen, makeFmt } from '../format';
import { href } from '../router';
import { useApp } from '../state';
import { CommitInput, DateField, PersonField } from './fields';
import { Icon } from './icons';
import { snoozeChoices, useItemActions } from './ItemRow';
import { Badge, IconButton, MenuButton } from './ui';

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

  const runCheck = async () => {
    if (!reply.trim()) return;
    setChecking(true);
    try {
      setCheck(ai.on ? await ai.reply(item, reply) : checkReplyRules(reply, state.today, cal, s.dateOrder));
    } catch (err) {
      actions.toast(`The model could not check it (${(err as Error).message}). Checked by rules instead.`, 'error');
      setCheck(checkReplyRules(reply, state.today, cal, s.dateOrder));
    } finally {
      setChecking(false);
    }
  };

  const recurValue = item.recur ? `${item.recur.every}:${item.recur.unit}` : '';

  return (
    <>
      <div className="drawer-h">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="mono text-[var(--text-subtle)]">#{item.num}</span>
            <div className="seg">
              <button type="button" aria-pressed={item.direction === 'owe'} onClick={() => patch({ direction: 'owe' })}>
                I owe
              </button>
              <button type="button" aria-pressed={item.direction === 'wait'} onClick={() => patch({ direction: 'wait' })}>
                Waiting on
              </button>
            </div>
            <Badge tone={ag.tone}>{ag.label}</Badge>
          </div>
          <IconButton icon="x" label="Close" onClick={() => actions.setUi({ openItem: null })} />
        </div>
        <div className="mt-3">
          <CommitInput className="title-edit" value={item.title} onCommit={(v) => v.trim() && patch({ title: v.trim() })} ariaLabel="Title" testid="item-title" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {item.status === 'open' ? (
            <>
              {item.direction === 'wait' && (
                <button type="button" className="btn btn-primary" onClick={() => a.chase([item.id])} data-testid="drawer-chase">
                  <Icon name="mail" size={14} /> Chase
                </button>
              )}
              <button type="button" className={`btn${item.direction === 'owe' ? ' btn-primary' : ''}`} onClick={() => a.close(item, note || undefined)} data-testid="drawer-done">
                <Icon name="check" size={14} /> {item.direction === 'wait' ? 'Received' : 'Done'}
              </button>
              <MenuButton
                label="Snooze"
                className="btn"
                items={[
                  ...snoozeChoices(state.today, cal).map((c) => ({ label: `${c.label} (${fmt.day(c.day)})`, onClick: () => a.snooze(item, c.day) })),
                  ...(isSnoozed(item, state.today) ? [{ label: 'Wake now', onClick: () => a.snooze(item, undefined) }] : []),
                ]}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const why = window.prompt('Why is it being dropped? (optional)');
                  if (why === null) return;
                  actions.apply((d) => drop(d, item.id, why, new Date()), `Dropped #${item.num}`);
                }}
              >
                Drop
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
        {item.status !== 'open' && (
          <div className="notice notice-info mb-4">
            {item.status === 'done' ? (item.direction === 'wait' ? 'Received' : 'Done') : 'Dropped'} {fmt.day(item.closedOn)}
            {item.closeNote ? `: ${item.closeNote}` : '.'}
          </div>
        )}

        <div className="grid2">
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
          <label className="field block">
            <span className="field-l">Tags</span>
            <CommitInput
              value={item.tags.map((t) => `#${t}`).join(' ')}
              placeholder="#BART #IXL"
              onCommit={(v) => patch({ tags: [...new Set(v.split(/[\s,]+/).map((t) => t.replace(/^#/, '')).filter(Boolean))] })}
            />
          </label>
          <DateField label="Asked on" value={item.askedOn} onChange={(d) => d && patch({ askedOn: d })} />
          <DateField label={item.direction === 'owe' ? 'Due' : 'They promised'} value={item.due} onChange={(d) => patch({ due: d })} testid="item-due" />
          <label className="field block">
            <span className="field-l">Repeats</span>
            <select
              className="input w-full"
              value={recurValue}
              onChange={(e) => {
                const [n, u] = e.target.value.split(':');
                patch({ recur: e.target.value ? ({ every: Number(n), unit: u } as Recurrence) : undefined });
              }}
            >
              <option value="">Does not repeat</option>
              <option value="1:day">Every working day</option>
              <option value="1:week">Every week</option>
              <option value="2:week">Every two weeks</option>
              <option value="1:month">Every month</option>
              {recurValue && !['1:day', '1:week', '2:week', '1:month'].includes(recurValue) && <option value={recurValue}>Every {item.recur!.every} {item.recur!.unit}s</option>}
            </select>
          </label>
          {item.source && (
            <div className="field">
              <span className="field-l">Came from</span>
              <div className="text-[13px]">
                {item.source.kind === 'meeting' ? 'Meeting' : item.source.kind === 'email' ? 'Email' : item.source.kind === 'outlook' ? 'Outlook' : item.source.kind}
                {item.source.ref ? `: ${item.source.ref}` : ''}
                {item.source.date ? `, ${fmt.day(item.source.date)}` : ''}
              </div>
            </div>
          )}
        </div>

        {plan && item.status === 'open' && (
          <div className="plan mb-3" data-testid="chase-plan">
            <div>
              <b>Next chase {plan.day <= state.today ? 'is due now' : fmt.both(plan.day)}</b>, a {levelWord(plan.level).toLowerCase()} ({plan.levelReason}).
            </div>
            <div className="hint mt-1">{plan.reason}.</div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <div className="w-56">
                <DateField label="Chase on (override)" value={item.nextChase} onChange={(d) => patch({ nextChase: d })} placeholder="leave empty to work it out" />
              </div>
              {item.nextChase && (
                <button type="button" className="link mb-6 text-[12px]" onClick={() => patch({ nextChase: undefined })}>
                  Use the worked-out date
                </button>
              )}
            </div>
            {exp && (
              <div className="hint">
                Likely to arrive: {exp.day ? fmt.both(exp.day) : 'no idea yet'}. {exp.reason}.
              </div>
            )}
          </div>
        )}
        {rk && (
          <div className={`notice ${rk.level === 'risk' ? 'notice-error' : 'notice-warn'} mb-3`}>
            <b>{rk.level === 'risk' ? 'At risk.' : 'Cannot tell yet.'}</b> {rk.reason}.
          </div>
        )}
        {person && st && (
          <div className="hint mb-3">
            <a href={href('people', { id: person.id })} onClick={() => actions.setUi({ openItem: null })} className="link">
              {person.name}
            </a>
            {st.samples > 0
              ? `: ${st.samples} received before; usually ${st.deliveryDays} working days${st.promisesKept !== null ? `, kept ${Math.round(st.promisesKept * 100)}% of promises` : ''}.`
              : ': nothing received from them yet, so the defaults apply.'}
          </div>
        )}

        <div className="field">
          <span className="field-l">{item.direction === 'owe' ? 'Needs (waiting on)' : 'Needs'}</span>
          {blockers.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 py-1 text-[13px]">
              <button type="button" className="link text-left" onClick={() => actions.setUi({ openItem: b.id })}>
                #{b.num} {b.title}
              </button>
              <span className="flex items-center gap-2">
                <Badge tone={age(b, ctx).tone}>{age(b, ctx).label}</Badge>
                <IconButton icon="x" label="Remove the link" onClick={() => actions.apply((d) => unlink(d, item.id, b.id, new Date()))} />
              </span>
            </div>
          ))}
          {item.status === 'open' && candidates.length > 0 && (
            <select className="input mt-1 w-full" value="" onChange={(e) => e.target.value && actions.apply((d) => link(d, item.id, e.target.value, new Date()), 'Linked.')}>
              <option value="">Add something this needs first…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.num} {c.title}
                  {c.personId ? ` (${doc.people.find((p) => p.id === c.personId)?.name ?? ''})` : ''}
                </option>
              ))}
            </select>
          )}
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
        </div>

        <div className="field">
          <span className="field-l">Links</span>
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
            className="input w-full"
            value={linkText}
            placeholder="Paste a link or a file path, then Enter"
            onChange={(e) => setLinkText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && linkText.trim()) {
                patch({ links: [...new Set([...item.links, linkText.trim()])] });
                setLinkText('');
              }
            }}
          />
        </div>

        <div className="field">
          <span className="field-l">Notes</span>
          <CommitInput multiline className="textarea" value={item.notes ?? ''} placeholder="Anything worth keeping with it" onCommit={(v) => patch({ notes: v.trim() || undefined })} />
        </div>

        {item.status === 'open' && (
          <div className="field">
            <span className="field-l">Log what happened</span>
            <div className="flex gap-2">
              <input className="input min-w-0 flex-1" value={note} placeholder="Called Sam: on it, end of week" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Enter' && note.trim()) {
                  actions.apply((d) => addNote(d, item.id, note, new Date()), 'Noted.');
                  setNote('');
                }
              }} />
              <button type="button" className="btn" disabled={!note.trim()} onClick={() => {
                actions.apply((d) => addNote(d, item.id, note, new Date()), 'Noted.');
                setNote('');
              }}>
                Add note
              </button>
            </div>
          </div>
        )}

        {item.status === 'open' && item.direction === 'wait' && (
          <div className="field">
            <span className="field-l flex items-center justify-between">
              <span>Did their reply close it?</span>
              {ai.on && (
                <span className="ai-mark">
                  <Icon name="sparkle" size={11} /> on-device AI
                </span>
              )}
            </span>
            <textarea className="textarea" style={{ minHeight: 90 }} value={reply} placeholder="Paste their reply" onChange={(e) => setReply(e.target.value)} data-testid="reply-text" />
            <div className="mt-2 flex items-center gap-2">
              <button type="button" className="btn" disabled={!reply.trim() || checking} onClick={() => void runCheck()} data-testid="reply-check">
                {checking ? (aiStatus.state === 'loading' ? `Loading the model ${Math.round(aiStatus.progress * 100)}%` : 'Reading…') : 'Check'}
              </button>
              {check && (
                <span className="text-[12.5px]">
                  <Badge tone={check.verdict === 'delivered' ? 'good' : check.verdict === 'partial' ? 'info' : check.verdict === 'stall' ? 'warn' : 'muted'}>
                    {check.verdict === 'delivered' ? 'Delivered' : check.verdict === 'partial' ? 'Part delivered' : check.verdict === 'stall' ? 'Not delivered' : 'Unclear'}
                  </Badge>{' '}
                  {check.summary} <span className="hint">({check.by === 'ai' ? 'model' : 'rules'})</span>
                </span>
              )}
            </div>
            {check && (
              <div className="mt-2 flex flex-wrap gap-2">
                {check.verdict === 'delivered' && (
                  <button type="button" className="btn btn-primary btn-mini" onClick={() => a.close(item, 'Delivered (from their reply)')}>
                    Mark received
                  </button>
                )}
                {check.promise && (
                  <button
                    type="button"
                    className="btn btn-mini"
                    onClick={() => {
                      actions.apply((d) => recordPromise(d, item.id, check.promise, `"${check.promisePhrase}" in their reply`, new Date(), check.by), `New promise: ${fmt.day(check.promise)}`);
                      setReply('');
                      setCheck(null);
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
                  }}
                >
                  Keep the reply as a note
                </button>
              </div>
            )}
          </div>
        )}

        <div className="field mt-4">
          <span className="field-l">History</span>
          <ul className="history">
            {[...item.history].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span className="h-when">{fmtWhen(h.at)}</span>
                <span>
                  <b>{historyWord(h.kind, item)}</b>
                  {h.due && (h.kind === 'promise' || h.kind === 'created') ? ` ${h.kind === 'promise' ? 'for' : 'due'} ${fmt.day(h.due)}` : ''}
                  {h.text ? `: ${h.text}` : ''}
                  {h.by && h.by !== 'you' && <span className="h-by">{h.by === 'ai' ? 'model' : h.by}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
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
    default:
      return 'Changed';
  }
}
