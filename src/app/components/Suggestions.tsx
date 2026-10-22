/**
 * Suggested items, from the rules or the on-device model, each shown with the
 * sentence it came from. Nothing is added until it is ticked and accepted, and every
 * part of it (direction, wording, person, date) can be corrected first.
 */
import { useEffect, useState } from 'react';
import type { Ask } from '../../engine/asks';
import { addItem, addPerson, calendarOf } from '../../engine/ops';
import type { Day, Direction, LedgerDoc, Source } from '../../engine/types';
import { makeFmt } from '../format';
import { useApp } from '../state';
import { AutoTextarea, DateField, PersonField } from './fields';
import { Icon } from './icons';
import { Badge } from './ui';

export type Draft = {
  key: string;
  on: boolean;
  added: boolean;
  direction: Direction;
  title: string;
  personId?: string;
  newPerson?: string;
  due?: Day;
  askedOn?: Day;
  quote: string;
  from: 'rule' | 'ai' | 'outlook';
  note?: string;
  quoteFound?: boolean;
  messageId?: string;
  source?: Source;
};

/** A suggestion from the rules or the model, ready to edit. Ambiguous names are left unset. */
export function draftFromAsk(a: Ask, i: number, from: 'rule' | 'ai'): Draft {
  return {
    key: `${from}-${i}-${a.title}`,
    on: true,
    added: false,
    direction: a.direction,
    title: a.title,
    personId: a.match?.kind === 'one' ? a.match.person.id : undefined,
    newPerson: a.match?.kind === 'none' && a.personName ? a.personName : undefined,
    due: a.due,
    quote: a.quote,
    from,
    quoteFound: a.quoteFound,
    note: a.match?.kind === 'many' ? `More than one person is called ${a.personName}; pick one.` : a.match?.kind === 'one' && a.match.how === 'first' ? `Matched on the first name "${a.personName}".` : undefined,
  };
}

export function SuggestionList({ drafts, setDrafts, source, emptyText }: { drafts: Draft[]; setDrafts: (d: Draft[]) => void; source?: Source; emptyText?: string }) {
  const { state, actions } = useApp();
  const fmt = makeFmt(state.doc.settings.dateOrder, state.today, calendarOf(state.doc.settings));
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [drafts]);
  const update = (key: string, patch: Partial<Draft>) => setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const pending = drafts.filter((d) => d.on && !d.added);

  const addAll = () => {
    setBusy(true);
    let count = 0;
    actions.apply((doc: LedgerDoc) => {
      let out = doc;
      for (const d of pending) {
        if (!d.title.trim()) continue;
        let personId = d.personId;
        if (!personId && d.newPerson) {
          const existing = out.people.find((p) => p.name.toLowerCase() === d.newPerson!.toLowerCase());
          if (existing) personId = existing.id;
          else {
            const r = addPerson(out, { name: d.newPerson }, new Date());
            out = r.doc;
            personId = r.person.id;
          }
        }
        const by = d.from === 'ai' ? 'ai' : d.from === 'outlook' ? 'outlook' : 'rule';
        const r = addItem(
          out,
          {
            title: d.title.trim(),
            direction: d.direction,
            personId,
            due: d.due,
            askedOn: d.askedOn,
            source: d.source ?? source,
            by,
            createdNote: d.quote ? `From: "${d.quote.slice(0, 200)}"` : undefined,
          },
          new Date(),
        );
        out = r.doc;
        count++;
      }
      return out;
    }, () => `Added ${count} item${count === 1 ? '' : 's'}.`);
    setDrafts(drafts.map((d) => (d.on && !d.added ? { ...d, added: true } : d)));
  };

  if (!drafts.length) return <div className="empty">{emptyText ?? 'No actions found.'}</div>;
  return (
    <div>
      {drafts.map((d) => (
        <div key={d.key} className={`sugg${d.added ? ' is-added' : ''}`} data-testid="suggestion">
          <div className="flex items-start gap-3">
            <input type="checkbox" className="mt-2" checked={d.on} disabled={d.added} aria-label="Include" onChange={(e) => update(d.key, { on: e.target.checked })} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="seg">
                  <button type="button" aria-pressed={d.direction === 'owe'} onClick={() => update(d.key, { direction: 'owe' })} disabled={d.added}>
                    I owe
                  </button>
                  <button type="button" aria-pressed={d.direction === 'wait'} onClick={() => update(d.key, { direction: 'wait' })} disabled={d.added}>
                    Waiting on
                  </button>
                </div>
                <AutoTextarea className="input sugg-title min-w-0 flex-1" value={d.title} disabled={d.added} onChange={(e) => update(d.key, { title: e.target.value.replace(/[\r\n]+/g, ' ') })} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} aria-label="Title" />
                {d.from === 'ai' && (
                  <span className="ai-mark">
                    <Icon name="sparkle" size={11} /> model
                  </span>
                )}
                {d.added && <Badge tone="good">Added</Badge>}
              </div>
              <div className={`sugg-fields${d.added ? ' is-added' : ''}`}>
                {!d.added && (
                  <>
                    {d.newPerson ? (
                      <div className="field">
                        <span className="field-l">{d.direction === 'owe' ? 'For' : 'From'}</span>
                        <span className="chip is-new">
                          <span className="chip-l">New person</span> {d.newPerson}
                        </span>{' '}
                        <button type="button" className="link text-[12px]" onClick={() => update(d.key, { newPerson: undefined })}>
                          someone else
                        </button>
                      </div>
                    ) : (
                      <PersonField label={d.direction === 'owe' ? 'For' : 'From'} value={d.personId} onChange={(id, name) => update(d.key, name ? { newPerson: name, personId: undefined } : { personId: id })} />
                    )}
                    <DateField label={d.direction === 'owe' ? 'Due' : 'They promised'} value={d.due} onChange={(v) => update(d.key, { due: v })} />
                  </>
                )}
                {(d.quote || d.askedOn) && (
                  <div className="sugg-src">
                    {d.quote && (
                      <div className={`sugg-quote${d.from === 'ai' ? ' is-ai' : ''}`}>
                        "{d.quote}"
                        {d.from === 'ai' && d.quoteFound === false && <span className="not-italic text-[var(--warn)]"> (the model's words; not found in the text)</span>}
                      </div>
                    )}
                    {d.askedOn && <div className="hint mt-1">Asked {fmt.day(d.askedOn)}</div>}
                  </div>
                )}
              </div>
              {d.note && <div className="hint">{d.note}</div>}
            </div>
          </div>
        </div>
      ))}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={!pending.length || busy} onClick={addAll} data-testid="add-suggestions">
          <Icon name="plus" size={14} /> Add {pending.length || ''} {pending.length === 1 ? 'item' : 'items'}
        </button>
        <span className="hint">Untick anything that is not an action. Nothing is added until you press Add.</span>
      </div>
    </div>
  );
}
