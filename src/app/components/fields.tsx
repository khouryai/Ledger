import { useEffect, useState } from 'react';
import { parseDateInput } from '../../engine/dates';
import { calendarOf } from '../../engine/ops';
import type { Day, Person } from '../../engine/types';
import { makeFmt } from '../format';
import { useApp } from '../state';

/**
 * A date typed the way the quick-add line reads it: "fri", "11/14", "+3d". What it
 * was read as is shown under the box, and nothing is saved until it reads cleanly.
 */
export function DateField({ value, onChange, placeholder = 'fri, 11/14, +3d', label, testid }: { value?: Day; onChange: (d: Day | undefined) => void; placeholder?: string; label: string; testid?: string }) {
  const { state } = useApp();
  const s = state.doc.settings;
  const cal = calendarOf(s);
  const fmt = makeFmt(s.dateOrder, state.today, cal);
  const [text, setText] = useState(value ? fmt.day(value) : '');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value ? fmt.day(value) : '');
  }, [value, editing]);
  const parsed = text.trim() ? parseDateInput(text.replace(/^(mon|tue|wed|thu|fri|sat|sun)\s+(?=\d)/i, ''), state.today, cal, s.dateOrder) : undefined;
  const bad = editing && text.trim() !== '' && !parsed;
  const commit = () => {
    setEditing(false);
    if (!text.trim()) onChange(undefined);
    else if (parsed) onChange(parsed);
  };
  return (
    <label className="field block">
      <span className="field-l">{label}</span>
      <input
        className="input w-full"
        style={bad ? { borderColor: 'var(--bad)' } : undefined}
        value={text}
        placeholder={placeholder}
        data-testid={testid}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(value ? fmt.day(value) : '');
            setEditing(false);
          }
        }}
      />
      <span className="form-hint">{bad ? 'Not a date I can read. Try fri, 11/14 or +3d.' : parsed ? fmt.both(parsed) : value ? fmt.both(value) : 'None'}</span>
    </label>
  );
}

export function PersonField({ value, onChange, label = 'Person', allowNone = true }: { value?: string; onChange: (id: string | undefined, newName?: string) => void; label?: string; allowNone?: boolean }) {
  const { state } = useApp();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const people = [...state.doc.people].sort((a: Person, b: Person) => a.name.localeCompare(b.name));
  return (
    <label className="field block">
      <span className="field-l">{label}</span>
      {adding ? (
        <span className="flex gap-2">
          <input className="input min-w-0 flex-1" autoFocus value={name} placeholder="Full name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              onChange(undefined, name.trim());
              setAdding(false);
              setName('');
            }
            if (e.key === 'Escape') setAdding(false);
          }} />
          <button type="button" className="btn btn-mini" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <select
          className="input w-full"
          value={value ?? ''}
          onChange={(e) => {
            if (e.target.value === '__new') setAdding(true);
            else onChange(e.target.value || undefined);
          }}
        >
          {allowNone && <option value="">Nobody</option>}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.company ? ` · ${p.company}` : ''}
            </option>
          ))}
          <option value="__new">New person…</option>
        </select>
      )}
    </label>
  );
}

/** A text box that saves when it loses focus, not on every keystroke. */
export function CommitInput({ value, onCommit, className = 'input w-full', placeholder, multiline, testid, ariaLabel }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; multiline?: boolean; testid?: string; ariaLabel?: string }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  const props = {
    className,
    value: text,
    placeholder,
    'data-testid': testid,
    'aria-label': ariaLabel,
    onFocus: () => setFocused(true),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: () => {
      setFocused(false);
      if (text !== value) onCommit(text);
    },
  };
  return multiline ? (
    <textarea {...props} rows={3} />
  ) : (
    <input
      {...props}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}
