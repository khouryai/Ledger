/**
 * The quick-add line. What it read is shown as chips under it before Enter, so an
 * item is never added on a reading nobody saw: a date it took from the text, a person
 * it matched, a new person it will create, a "which Sam?" it cannot decide alone.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { calendarOf, addItem, addPerson } from '../../engine/ops';
import { parseQuickAdd, type QuickAdd as Parsed } from '../../engine/quickadd';
import type { Direction, Item, LedgerDoc, Person, Source } from '../../engine/types';
import { makeFmt } from '../format';
import { useApp } from '../state';
import { Icon } from './icons';

export function focusQuickAdd() {
  document.querySelector<HTMLInputElement>('[data-quickadd="main"]')?.focus();
}

type Props = {
  id?: string;
  source?: Source;
  /** People to offer as one-click chips (meeting attendees). */
  offer?: Person[];
  placeholder?: string;
  onAdded?: (item: Item) => void;
  autoFocus?: boolean;
};

export function QuickAdd({ id = 'main', source, offer, placeholder, onAdded, autoFocus }: Props) {
  const { state, actions } = useApp();
  const doc = state.doc;
  const [text, setText] = useState('');
  const [direction, setDirection] = useState<Direction>(() => {
    try {
      return localStorage.getItem('ledger-qa-dir') === 'owe' ? 'owe' : 'wait';
    } catch {
      return 'wait';
    }
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const cal = calendarOf(doc.settings);
  const fmt = makeFmt(doc.settings.dateOrder, state.today, cal);

  useEffect(() => {
    try {
      localStorage.setItem('ledger-qa-dir', direction);
    } catch {
      /* a preference, nothing more */
    }
  }, [direction]);

  const parsed: Parsed | null = useMemo(
    () => (text.trim() ? parseQuickAdd(text, { today: state.today, cal, order: doc.settings.dateOrder, people: doc.people, direction }) : null),
    [text, direction, doc.people, state.today, doc.settings.dateOrder, doc.settings.workDays, doc.settings.holidays],
  );

  useEffect(() => setChosen(null), [parsed?.person?.kind === 'many' ? parsed.person.name : '']);

  const submit = () => {
    if (!parsed) return;
    if (!parsed.title) {
      actions.toast('Type what it is, as well as who and when.', 'error');
      return;
    }
    const p = parsed.person;
    if (p?.kind === 'many' && !chosen) {
      actions.toast(`More than one person matches "${p.name}". Pick one under the line.`, 'error');
      return;
    }
    let made: Item | null = null;
    actions.apply((d: LedgerDoc) => {
      let doc2 = d;
      let personId: string | undefined;
      if (p?.kind === 'one') personId = p.person.id;
      else if (p?.kind === 'many') personId = chosen ?? undefined;
      else if (p?.kind === 'new') {
        const r = addPerson(doc2, { name: p.name }, new Date());
        doc2 = r.doc;
        personId = r.person.id;
      }
      const r = addItem(
        doc2,
        { title: parsed.title, direction: parsed.direction, personId, tags: parsed.tags, due: parsed.due, askedOn: parsed.askedOn, recur: parsed.recur, source },
        new Date(),
      );
      made = r.item;
      return r.doc;
    }, () => (made ? `Added #${(made as Item).num}: ${(made as Item).title}` : 'Added.'));
    if (made) onAdded?.(made as Item);
    setText('');
    setChosen(null);
  };

  const insertPerson = (person: Person) => {
    const handle = person.name.includes(' ') ? `@"${person.name}"` : `@${person.name}`;
    setText((t) => (t.includes('@') ? t.replace(/@(?:"[^"]*"|\S+)/, handle) : `${handle} ${t}`.trim() + ' '));
    ref.current?.focus();
  };

  return (
    <div>
      <div className="qa">
        <button
          type="button"
          className={`qa-dir dir-${parsed?.direction ?? direction}`}
          onClick={() => setDirection((d) => (d === 'owe' ? 'wait' : 'owe'))}
          title="Switch between I owe and Waiting on (Tab while typing)"
          data-testid={`qa-dir-${id}`}
        >
          {(parsed?.direction ?? direction) === 'owe' ? 'I owe' : 'Waiting on'}
        </button>
        <input
          ref={ref}
          className="qa-input"
          data-quickadd={id}
          aria-label="Add an item"
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder ?? 'Add something: @Sam ATS report rev B by fri #BART'}
          aria-describedby={`qa-hint-${id}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Tab' && !e.shiftKey && text.trim()) {
              e.preventDefault();
              setDirection((d) => (d === 'owe' ? 'wait' : 'owe'));
            } else if (e.key === 'Escape') {
              setText('');
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!parsed?.title}>
          <Icon name="plus" size={14} /> Add
        </button>
      </div>
      {/* Always there, so the page never jumps as the first character is typed: hints
          when the line is empty, what was read once it is not. */}
      <div className="qa-chips" aria-live="polite" id={`qa-hint-${id}`}>
        {!parsed && !offer?.length && (
          <span className="qa-hints">
            <span>
              <b>@</b> person
            </span>
            <span>
              <b>#</b> tag
            </span>
            <span>
              <b>fri</b>, <b>11/14</b>, <b>+3d</b> due
            </span>
            <span>
              <b>since mon</b> asked
            </span>
            <span>
              <b>every week</b> repeats
            </span>
            <span>
              <b>Tab</b> I owe / Waiting on
            </span>
            <span>
              <b>Enter</b> adds
            </span>
          </span>
        )}
        {(parsed || offer?.length) ? (
        <>
          {offer?.map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => insertPerson(p)} title={`Make this about ${p.name}`}>
              <Icon name="user" size={12} /> {p.name}
            </button>
          ))}
          {parsed && (
            <>
              {parsed.title && (
                <span className="chip">
                  <span className="chip-l">What</span> {parsed.title}
                </span>
              )}
              {parsed.person?.kind === 'one' && (
                <span className="chip">
                  <span className="chip-l">{parsed.direction === 'owe' ? 'For' : 'From'}</span> {parsed.person.person.name}
                </span>
              )}
              {parsed.person?.kind === 'new' && (
                <span className="chip is-new" title="Nobody by that name yet. Adding this creates them.">
                  <span className="chip-l">New person</span> {parsed.person.name}
                </span>
              )}
              {parsed.person?.kind === 'many' && (
                <>
                  <span className="chip is-warn">
                    <span className="chip-l">Which</span> {parsed.person.name}?
                  </span>
                  {parsed.person.people.map((p) => (
                    <button key={p.id} type="button" className={`chip${chosen === p.id ? ' is-new' : ''}`} onClick={() => setChosen(p.id)}>
                      {p.name}
                      {p.company ? ` · ${p.company}` : ''}
                    </button>
                  ))}
                </>
              )}
              {parsed.due && (
                <span className="chip">
                  <span className="chip-l">{parsed.direction === 'owe' ? 'Due' : 'Promised'}</span> {fmt.both(parsed.due)}
                </span>
              )}
              {parsed.askedOn && (
                <span className="chip">
                  <span className="chip-l">Asked</span> {fmt.day(parsed.askedOn)}
                </span>
              )}
              {parsed.recur && (
                <span className="chip">
                  <Icon name="repeat" size={12} /> every {parsed.recur.every > 1 ? `${parsed.recur.every} ` : ''}
                  {parsed.recur.unit === 'day' ? 'working day' : parsed.recur.unit}
                  {parsed.recur.every > 1 ? 's' : ''}
                </span>
              )}
              {parsed.tags.map((t) => (
                <span key={t} className="chip">
                  #{t}
                </span>
              ))}
            </>
          )}
        </>
        ) : null}
      </div>
    </div>
  );
}
