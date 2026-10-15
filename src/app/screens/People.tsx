/**
 * People: everyone in the ledger, and one person's page: what is open both ways,
 * their record, how they are chased, and a brief for the next call with them.
 */
import { useMemo, useState } from 'react';
import { useAiStatus } from '../../ai/manager';
import { rhythm } from '../../engine/decide';
import { parseAddressList, matchPerson } from '../../engine/people';
import { addPerson, calendarOf, mergePeople, removePerson, updatePerson } from '../../engine/ops';
import { personStats } from '../../engine/stats';
import { sortWorking } from '../../engine/review';
import type { Item, Person } from '../../engine/types';
import { useAi } from '../ai';
import { CommitInput } from '../components/fields';
import { Icon } from '../components/icons';
import { ItemRow } from '../components/ItemRow';
import { Badge, copyRich, Empty, Hero, Section } from '../components/ui';
import { makeFmt } from '../format';
import { href, navigate, type Route } from '../router';
import { useApp } from '../state';

export function People({ route }: { route: Route }) {
  const { state } = useApp();
  const [q, setQ] = useState('');
  const id = route.params.get('id');
  const people = useMemo(() => [...state.doc.people].sort((a, b) => a.name.localeCompare(b.name)), [state.doc.people]);
  const shown = people.filter((p) => !q || `${p.name} ${p.company ?? ''} ${p.email ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const person = people.find((p) => p.id === id);
  const counts = (pid: string) => state.doc.items.filter((i) => i.personId === pid && i.status === 'open').length;

  return (
    <div>
      <Hero eyebrow="Keep it honest" title="People" sub="Everyone you owe or are waiting on. Each person's record is counted from what has actually happened with them." />
      <div className="page">
        <div className="people">
          <div>
            <input className="input mb-2 w-full" placeholder="Find someone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find someone" />
            <div className="list-card p-list">
              {shown.map((p) => (
                <a key={p.id} href={href('people', { id: p.id })} className={p.id === id ? 'is-on' : ''}>
                  <span className="min-w-0 truncate">
                    {p.name}
                    {p.company && <span className="hint"> · {p.company}</span>}
                  </span>
                  {counts(p.id) > 0 && <span className="mono text-[var(--text-subtle)]">{counts(p.id)}</span>}
                </a>
              ))}
              {!shown.length && <Empty title={q ? 'Nobody matches.' : 'Nobody yet.'} />}
            </div>
            <AddPeople />
          </div>
          <div className="min-w-0">{person ? <PersonCard person={person} key={person.id} /> : <div className="card hint">Pick someone on the left, or add people below the list.</div>}</div>
        </div>
      </div>
    </div>
  );
}

function AddPeople() {
  const { state, actions } = useApp();
  const [text, setText] = useState('');
  const found = useMemo(() => parseAddressList(text), [text]);
  const fresh = found.filter((a) => matchPerson(state.doc.people, a).kind === 'none');
  return (
    <div className="card mt-3">
      <div className="card-title text-[13px]">Add people</div>
      <p className="hint mt-1">Type a name, or paste an email's To or Cc line to add everyone on it.</p>
      <textarea className="textarea mt-2" style={{ minHeight: 70 }} value={text} placeholder="Sam Lee <sam.lee@example.com>; Priya Shah <priya@example.com>" onChange={(e) => setText(e.target.value)} data-testid="people-paste" />
      {found.length > 0 && (
        <div className="mt-2">
          <div className="hint">
            {fresh.length} new{found.length > fresh.length ? `, ${found.length - fresh.length} already here` : ''}: {fresh.map((a) => a.name).join(', ')}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-mini mt-2"
            disabled={!fresh.length}
            onClick={() => {
              actions.apply((d) => fresh.reduce((doc, a) => addPerson(doc, { name: a.name, email: a.email }, new Date()).doc, d), `Added ${fresh.length} ${fresh.length === 1 ? 'person' : 'people'}.`);
              setText('');
            }}
            data-testid="people-add"
          >
            Add {fresh.length}
          </button>
        </div>
      )}
    </div>
  );
}

function PersonCard({ person }: { person: Person }) {
  const { state, ctx, actions } = useApp();
  const doc = state.doc;
  const s = doc.settings;
  const cal = calendarOf(s);
  const fmt = makeFmt(s.dateOrder, state.today, cal);
  const ai = useAi();
  const aiStatus = useAiStatus();
  const st = personStats(doc.items, person.id, s, cal);
  const r = rhythm(ctx, person.id);
  const mine = doc.items.filter((i) => i.personId === person.id);
  const theyOwe = sortWorking(mine.filter((i) => i.status === 'open' && i.direction === 'wait'), ctx);
  const iOwe = sortWorking(mine.filter((i) => i.status === 'open' && i.direction === 'owe'), ctx);
  const closed = mine.filter((i) => i.status !== 'open').sort((a, b) => (b.closedOn ?? '').localeCompare(a.closedOn ?? ''));
  const [brief, setBrief] = useState('');
  const [writing, setWriting] = useState(false);
  const set = (patch: Partial<Person>) => actions.apply((d) => updatePerson(d, person.id, patch));

  const facts = () => {
    const line = (i: Item) => `- ${i.title} (asked ${fmt.day(i.askedOn)}${i.due ? `, ${i.direction === 'owe' ? 'due' : 'promised'} ${fmt.day(i.due)}${i.due < state.today ? ', overdue' : ''}` : ''})`;
    return [
      `Person: ${person.name}${person.company ? `, ${person.company}` : ''}${person.role ? `, ${person.role}` : ''}`,
      `They owe me (${theyOwe.length}):`,
      ...theyOwe.map(line),
      `I owe them (${iOwe.length}):`,
      ...iOwe.map(line),
      st.samples ? `Record: ${st.samples} received before, usually in ${st.deliveryDays} working days${st.promisesKept !== null ? `, ${Math.round(st.promisesKept * 100)}% of promises kept` : ''}.` : 'Record: nothing received from them yet.',
    ].join('\n');
  };

  return (
    <div>
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CommitInput className="title-edit" value={person.name} onCommit={(v) => v.trim() && set({ name: v.trim() })} ariaLabel="Name" />
            <div className="mt-1 flex flex-wrap gap-2">
              <Badge tone={st.learned ? 'purple' : 'muted'} title={st.learned ? 'Their own pattern is used for chasing and for expecting arrivals' : `The defaults apply until ${s.learnAfter} items have been received from them`}>
                {st.learned ? `Learned from ${st.samples} items` : `${st.samples} of ${s.learnAfter} items to learn from`}
              </Badge>
              <span className="hint">Chased {r.reason}.</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {theyOwe.length > 0 && (
              <button type="button" className="btn btn-primary" onClick={() => actions.setUi({ chase: { itemIds: theyOwe.map((i) => i.id) } })} data-testid="chase-all">
                <Icon name="mail" size={14} /> Chase {theyOwe.length > 1 ? `all ${theyOwe.length}` : 'it'}
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => void copyRich(brief || facts()).then((ok) => actions.toast(ok ? 'Copied the brief.' : 'Could not reach the clipboard.', ok ? 'info' : 'error'))}
            >
              <Icon name="copy" size={14} /> Copy brief
            </button>
            {ai.on && (
              <button
                type="button"
                className="btn"
                disabled={writing}
                onClick={async () => {
                  setWriting(true);
                  try {
                    setBrief(await ai.brief('person', facts()));
                  } catch (err) {
                    actions.toast(`The model could not write it: ${(err as Error).message}`, 'error');
                  } finally {
                    setWriting(false);
                  }
                }}
              >
                <Icon name="sparkle" size={14} /> {writing ? (aiStatus.state === 'loading' ? `Loading ${Math.round(aiStatus.progress * 100)}%` : 'Writing…') : 'Brief me'}
              </button>
            )}
          </div>
        </div>
        {brief && (
          <div className="notice notice-info mt-3 whitespace-pre-wrap">
            <span className="ai-mark mb-1 block">
              <Icon name="sparkle" size={11} /> written by the on-device model
            </span>
            {brief}
          </div>
        )}

        <div className="mt-4 grid grid-cols-4 gap-3">
          <Fact label="Received" value={String(st.samples)} />
          <Fact label="Usually takes" value={st.deliveryDays !== null ? `${st.deliveryDays} days` : '—'} />
          <Fact label="Promises kept" value={st.promisesKept !== null ? `${Math.round(st.promisesKept * 100)}%` : '—'} sub={st.promised ? `of ${st.promised}` : undefined} />
          <Fact label="Chases needed" value={st.chasesNeeded !== null ? String(st.chasesNeeded) : '—'} sub="median" />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4">
          <label className="field block">
            <span className="field-l">Email</span>
            <CommitInput value={person.email ?? ''} placeholder="name@company.com" onCommit={(v) => set({ email: v.trim() || undefined })} />
          </label>
          <label className="field block">
            <span className="field-l">Company</span>
            <CommitInput value={person.company ?? ''} onCommit={(v) => set({ company: v.trim() || undefined })} />
          </label>
          <label className="field block">
            <span className="field-l">Role</span>
            <CommitInput value={person.role ?? ''} onCommit={(v) => set({ role: v.trim() || undefined })} />
          </label>
          <label className="field block">
            <span className="field-l">Chase every (working days)</span>
            <CommitInput
              value={person.chaseEvery ? String(person.chaseEvery) : ''}
              placeholder="learned, or your default"
              onCommit={(v) => {
                const n = Number(v);
                set({ chaseEvery: v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined });
              }}
            />
          </label>
          <label className="field block">
            <span className="field-l">Copy on an escalation: name</span>
            <CommitInput value={person.escalateTo?.name ?? ''} placeholder="Their manager" onCommit={(v) => set({ escalateTo: v.trim() ? { name: v.trim(), email: person.escalateTo?.email } : undefined })} />
          </label>
          <label className="field block">
            <span className="field-l">Copy on an escalation: email</span>
            <CommitInput
              value={person.escalateTo?.email ?? ''}
              onCommit={(v) => set({ escalateTo: person.escalateTo || v.trim() ? { name: person.escalateTo?.name ?? v.trim(), email: v.trim() || undefined } : undefined })}
            />
          </label>
        </div>
        <label className="field block">
          <span className="field-l">Notes</span>
          <CommitInput multiline className="textarea" value={person.notes ?? ''} onCommit={(v) => set({ notes: v.trim() || undefined })} />
        </label>
      </div>

      <Section title="They owe me" count={theyOwe.length}>
        <div className="list-card rows">
          {theyOwe.map((i) => (
            <ItemRow key={i.id} item={i} />
          ))}
          {!theyOwe.length && <Empty title="Nothing outstanding from them." />}
        </div>
      </Section>
      <Section title="I owe them" count={iOwe.length}>
        <div className="list-card rows">
          {iOwe.map((i) => (
            <ItemRow key={i.id} item={i} />
          ))}
          {!iOwe.length && <Empty title="You owe them nothing." />}
        </div>
      </Section>
      {closed.length > 0 && (
        <Section title="Closed" count={closed.length}>
          <div className="list-card rows">
            {closed.slice(0, 20).map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
          </div>
        </Section>
      )}
      <Section title="Tidy up">
        <div className="card flex flex-wrap items-center gap-3">
          <select
            className="input"
            value=""
            onChange={(e) => {
              const keep = doc.people.find((p) => p.id === e.target.value);
              if (keep && window.confirm(`Merge ${person.name} into ${keep.name}? Every item moves to ${keep.name}.`)) {
                actions.apply((d) => mergePeople(d, keep.id, person.id, new Date()), `Merged into ${keep.name}.`);
                navigate('people', { id: keep.id });
              }
            }}
          >
            <option value="">Merge into someone else (a duplicate)…</option>
            {doc.people
              .filter((p) => p.id !== person.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={mine.length > 0}
            title={mine.length ? 'People with items cannot be removed; merge them instead.' : undefined}
            onClick={() => {
              actions.apply((d) => removePerson(d, person.id), `Removed ${person.name}.`);
              navigate('people');
            }}
          >
            <Icon name="trash" size={14} /> Remove
          </button>
        </div>
      </Section>
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
      <div className="kpi-label" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <div className="text-[18px] font-semibold">
        {value} {sub && <span className="hint font-normal">{sub}</span>}
      </div>
    </div>
  );
}
