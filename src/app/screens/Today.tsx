import { fmtDayLong, weekday } from '../../engine/dates';
import { today as todayList, type TodayEntry } from '../../engine/decide';
import { reviewDue } from '../../engine/review';
import { Icon } from '../components/icons';
import { ItemRow, useListKeys } from '../components/ItemRow';
import { Empty, Hero, Section, Stat } from '../components/ui';
import { href } from '../router';
import { useApp } from '../state';

const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function Today() {
  const { state, ctx, actions } = useApp();
  const t = todayList(ctx);
  const doc = state.doc;
  const flat = [...t.due, ...t.chase, ...t.risk, ...t.unblocked, ...t.woke, ...t.soon].map((e) => e.item);
  const { sel, setSel } = useListKeys(flat);
  const waiting = doc.items.filter((i) => i.status === 'open' && i.direction === 'wait').length;
  const empty = doc.items.length === 0;

  // Chases grouped by person, so three items for Sam become one email.
  const byPerson = new Map<string, TodayEntry[]>();
  for (const e of t.chase) if (e.item.personId) byPerson.set(e.item.personId, [...(byPerson.get(e.item.personId) ?? []), e]);
  const batches = [...byPerson.entries()].filter(([, es]) => es.length > 1);

  const list = (entries: TodayEntry[]) => (
    <div className="list-card rows">
      {entries.map((e) => (
        <ItemRow key={e.item.id} item={e.item} reason={e.reason} selected={sel === e.item.id} onSelect={() => setSel(e.item.id)} />
      ))}
    </div>
  );

  return (
    <div>
      <Hero
        eyebrow={`${WD[weekday(state.today)]} ${fmtDayLong(state.today)}`}
        title="Today"
        sub="What needs you today, and why. The order comes from your own history: who usually delivers when, and what is holding up what."
        stats={
          <>
            <Stat label="Due from me" value={t.due.length} tone={t.due.length ? 'red' : 'muted'} />
            <Stat label="To chase" value={t.chase.length} tone={t.chase.length ? 'amber' : 'muted'} />
            <Stat label="At risk" value={t.risk.length} tone={t.risk.length ? 'red' : 'muted'} />
            <Stat label="Waiting on others" value={waiting} tone="blue" />
          </>
        }
      />
      <div className="page page-narrow">
        {reviewDue(doc, state.today) && !empty && (
          <div className="notice notice-info mb-4 flex items-center justify-between gap-3">
            <span>
              <b>Time for the weekly review.</b> Ten minutes to keep, chase, snooze or close what has gone quiet.
            </span>
            <a className="btn btn-mini btn-primary" href={href('review')}>
              Start
            </a>
          </div>
        )}
        {empty ? (
          <FirstRun />
        ) : (
          <>
            {t.due.length > 0 && <Section title="Due from me" count={t.due.length}>{list(t.due)}</Section>}
            {t.chase.length > 0 && (
              <Section
                title="Chase today"
                count={t.chase.length}
                aside={
                  batches.length ? (
                    <span className="flex flex-wrap gap-2">
                      {batches.map(([pid, es]) => (
                        <button key={pid} type="button" className="btn btn-mini" onClick={() => actions.setUi({ chase: { itemIds: es.map((e) => e.item.id) } })}>
                          <Icon name="mail" size={13} /> One email to {doc.people.find((p) => p.id === pid)?.name.split(' ')[0]} ({es.length})
                        </button>
                      ))}
                    </span>
                  ) : undefined
                }
              >
                {list(t.chase)}
              </Section>
            )}
            {t.risk.length > 0 && <Section title="At risk" count={t.risk.length}>{list(t.risk)}</Section>}
            {t.unblocked.length > 0 && <Section title="Unblocked" count={t.unblocked.length}>{list(t.unblocked)}</Section>}
            {t.woke.length > 0 && <Section title="Back from snooze" count={t.woke.length}>{list(t.woke)}</Section>}
            {t.soon.length > 0 && <Section title="Coming up" count={t.soon.length}>{list(t.soon)}</Section>}
            {flat.length === 0 && (
              <div className="list-card">
                <Empty title="Nothing needs you today.">
                  Everything you owe is in hand and nobody is due a chase. <a href={href('wait')}>See what you are waiting on</a>.
                </Empty>
              </div>
            )}
            <p className="hint mt-6">
              Keys: <b>j</b>/<b>k</b> move, <b>Enter</b> opens, <b>c</b> chases, <b>d</b> marks done, <b>s</b> snoozes to Monday, <b>n</b> adds.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function FirstRun() {
  const { state } = useApp();
  return (
    <div className="card">
      <div className="card-title">Start with the next thing on your mind</div>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">Type it in the line at the top and press Enter. A few examples of what it understands:</p>
      <ul className="mt-3 flex flex-col gap-2 text-[13px]">
        <li>
          <span className="mono">@Sam ATS test report rev B by fri #BART</span>: waiting on Sam, due Friday, tagged BART.
        </li>
        <li>
          <span className="mono">owe: IXL test plan to Priya next tue</span>: something you owe, due next Tuesday.
        </li>
        <li>
          <span className="mono">@Jordan cable schedule since monday</span>: you asked on Monday, so the wait counts from then.
        </li>
        <li>
          <span className="mono">owe: timesheet every friday</span>: comes back every week once done.
        </li>
      </ul>
      <p className="mt-4 text-[13px]">
        Or paste an email into <a href={href('capture')}>Capture</a> and let it find the actions, or add your contacts in one go from an email's To line under{' '}
        <a href={href('people')}>People</a>.
      </p>
      {!state.doc.settings.myName && (
        <p className="notice notice-info mt-4">
          Put your name and email in <a href={href('settings')}>Settings</a> first: chasers are signed with it, and Capture uses it to tell which emails are yours.
        </p>
      )}
    </div>
  );
}
