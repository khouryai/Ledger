/**
 * Schedules: built by clicking, read back in words, and shown as the dates they will
 * fall on before anything is saved. The dates come from engine/recur.ts, the same
 * code that puts each next occurrence on the list, so what is shown is what happens.
 */
import { useState } from 'react';
import { minDay, weekday } from '../../engine/dates';
import { newId } from '../../engine/doc';
import { addItem, addPerson, calendarOf, restartSeries, skip, updateItem } from '../../engine/ops';
import { describeRecurrence, firstOccurrence, fullRule, nextOccurrence, occurrencesAfter, ordinal, ruleOf, shortRecurrence, upcomingDates } from '../../engine/recur';
import { allSeries, type Series } from '../../engine/series';
import type { Day, Direction, Item, Recurrence, Step } from '../../engine/types';
import { makeFmt } from '../format';
import { useApp } from '../state';
import { DateField, PersonField } from './fields';
import { Icon } from './icons';
import { Modal } from './ui';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first: the order a working week is read in. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The schedule in a few words with its icon, the whole of it on hover. */
export function RecurLabel({ recur, className = '' }: { recur: Recurrence; className?: string }) {
  const { state } = useApp();
  return (
    <span className={`recur-label ${className}`} title={describeRecurrence(recur, { order: state.doc.settings.dateOrder, today: state.today })}>
      <Icon name="repeat" size={12} /> {shortRecurrence(recur)}
    </span>
  );
}

/** "Every Friday" inside a sentence: "now repeats every Friday". */
function inSentence(r: Recurrence): string {
  const s = describeRecurrence(r);
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Two schedules that fall on the same days, whatever their end or catching up. */
function sameDays(a: Recurrence, b: Recurrence): boolean {
  return a.unit === b.unit && a.every === b.every && (a.days ?? []).join() === (b.days ?? []).join() && a.monthDay === b.monthDay && a.nth === b.nth;
}

type EditorProps = {
  value: Recurrence;
  onChange: (r: Recurrence) => void;
  start: Day;
  onStart: (d: Day) => void;
  startLabel?: string;
};

/**
 * How often, which days, from when and until when. Every change is a whole schedule:
 * switching to weekly picks the start's weekday, to monthly its day of the month, and
 * the last day of a week cannot be unticked.
 */
export function ScheduleEditor({ value: r, onChange, start, onStart, startLabel = 'First one on or after' }: EditorProps) {
  const { state } = useApp();
  const startDay = Number(start.slice(8, 10));
  const set = (patch: Partial<Recurrence>) => onChange({ ...r, ...patch });
  const unit = (u: Recurrence['unit']) => {
    if (u === r.unit) return;
    if (u === 'day') onChange({ every: 1, unit: 'day', until: r.until, catchUp: r.catchUp, from: r.from });
    else if (u === 'week') onChange({ every: 1, unit: 'week', days: [weekday(start)], until: r.until, catchUp: r.catchUp, from: r.from });
    else onChange({ every: 1, unit: 'month', monthDay: startDay, until: r.until, catchUp: r.catchUp, from: r.from });
  };
  const monthMode = r.nth ? 'nth' : r.monthDay === -1 ? 'last' : 'day';
  const unitWord = r.unit === 'day' ? 'working day' : r.unit;
  return (
    <div className="sched" data-testid="schedule-editor">
      <div className="field">
        <span className="field-l">Repeats</span>
        <div className="seg" role="group" aria-label="Repeats">
          {(['day', 'week', 'month'] as const).map((u) => (
            <button key={u} type="button" aria-pressed={r.unit === u} onClick={() => unit(u)} data-testid={`sched-unit-${u}`}>
              {u === 'day' ? 'Every working day' : u === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
      </div>
      <label className="field sched-every block">
        <span className="field-l">Every</span>
        <span className="flex items-center gap-2">
          <input
            className="input w-20"
            type="number"
            min={1}
            max={99}
            value={r.every}
            aria-label="How many"
            data-testid="sched-every"
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (Number.isFinite(n) && n >= 1 && n <= 99) set({ every: n });
            }}
          />
          <span className="text-[13px]">
            {unitWord}
            {r.every > 1 ? 's' : ''}
          </span>
        </span>
      </label>
      {r.unit === 'week' && (
        <div className="field">
          <span className="field-l">On</span>
          <div className="day-picks" role="group" aria-label="Days of the week">
            {WEEK_ORDER.map((d) => {
              const on = !!r.days?.includes(d);
              const off = !state.doc.settings.workDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`day-pick${off ? ' is-off' : ''}`}
                  aria-pressed={on}
                  aria-label={DAY_LONG[d]}
                  data-testid={`sched-day-${d}`}
                  onClick={() => {
                    const days = on ? (r.days ?? []).filter((x) => x !== d) : [...(r.days ?? []), d];
                    if (days.length) set({ days });
                  }}
                >
                  {DAY_SHORT[d]}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {r.unit === 'month' && (
        <div className="field sched-month" role="radiogroup" aria-label="Which day of the month">
          <span className="field-l">On</span>
          <label className="check">
            <input type="radio" name="sched-month" checked={monthMode === 'day'} onChange={() => onChange({ ...r, nth: undefined, days: undefined, monthDay: startDay })} />
            the
            <select className="input" aria-label="Day of the month" value={r.monthDay && r.monthDay > 0 ? r.monthDay : startDay} onChange={(e) => onChange({ ...r, nth: undefined, days: undefined, monthDay: Number(e.target.value) })}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {ordinal(n)}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="radio" name="sched-month" checked={monthMode === 'nth'} onChange={() => onChange({ ...r, monthDay: undefined, nth: Math.min(4, Math.ceil(startDay / 7)), days: [weekday(start)] })} />
            the
            <select className="input" aria-label="Which one" value={r.nth ?? 1} onChange={(e) => onChange({ ...r, monthDay: undefined, nth: Number(e.target.value), days: r.days?.length ? [r.days[0]] : [weekday(start)] })}>
              {[1, 2, 3, 4, -1].map((n) => (
                <option key={n} value={n}>
                  {n === -1 ? 'last' : ['first', 'second', 'third', 'fourth'][n - 1]}
                </option>
              ))}
            </select>
            <select className="input" aria-label="Weekday" value={r.days?.[0] ?? weekday(start)} onChange={(e) => onChange({ ...r, monthDay: undefined, nth: r.nth ?? 1, days: [Number(e.target.value)] })}>
              {WEEK_ORDER.map((d) => (
                <option key={d} value={d}>
                  {DAY_LONG[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="radio" name="sched-month" checked={monthMode === 'last'} onChange={() => onChange({ ...r, nth: undefined, days: undefined, monthDay: -1 })} data-testid="sched-last-working" />
            the last working day
          </label>
        </div>
      )}
      <div className="grid2">
        <DateField label={startLabel} value={start} onChange={(d) => d && onStart(d)} testid="sched-start" />
        <DateField label="Ends (leave empty for never)" value={r.until} onChange={(d) => set({ until: d })} placeholder="12/18, end of year" testid="sched-until" />
      </div>
      <label className="check text-[12.5px]">
        <input type="checkbox" checked={!!r.catchUp} onChange={(e) => set({ catchUp: e.target.checked || undefined })} />
        Each one is owed even when one is late (a timesheet, not a meeting)
      </label>
    </div>
  );
}

/** The schedule in words, and the dates it will fall on. */
export function SchedulePreview({ rule, dates, lead }: { rule: Recurrence; dates: Day[]; lead?: React.ReactNode }) {
  const { state, ctx } = useApp();
  const fmt = makeFmt(state.doc.settings.dateOrder, state.today, ctx.cal);
  return (
    <div className="sched-preview" data-testid="schedule-preview" aria-live="polite">
      <div className="flex items-center gap-2">
        <Icon name="repeat" size={14} />
        <b>{describeRecurrence(rule, { order: state.doc.settings.dateOrder, today: state.today })}</b>
      </div>
      {lead && <div className="mt-1">{lead}</div>}
      <div className="sched-dates">
        {dates.length ? dates.map((d) => <span key={d}>{fmt.day(d)}</span>) : <span className="hint">No dates: it ends before it starts.</span>}
      </div>
    </div>
  );
}

type DialogMode = { kind: 'edit'; item: Item } | { kind: 'start'; item: Item } | { kind: 'restart'; series: Series };

/**
 * Change an item's schedule, make a one-off repeat, or start an ended series again.
 * The one in hand moves to the new schedule only when its days change: changing when
 * it ends leaves a date the user moved by hand where they put it.
 */
export function ScheduleDialog({ mode, onClose }: { mode: DialogMode; onClose: () => void }) {
  const { state, actions } = useApp();
  const cal = calendarOf(state.doc.settings);
  const fmt = makeFmt(state.doc.settings.dateOrder, state.today, cal);
  const item = mode.kind === 'restart' ? mode.series.head : mode.item;
  const known = mode.kind === 'restart' ? (mode.series.rule ?? [...mode.series.items].reverse().map(ruleOf).find(Boolean)) : ruleOf(mode.item);
  const initialStart = mode.kind === 'edit' ? (minDay(item.due, state.today) ?? state.today) : mode.kind === 'start' ? (item.due ?? state.today) : state.today;
  const [rule, setRule] = useState<Recurrence>(() => {
    const base = known ?? fullRule({ every: 1, unit: 'week' }, initialStart);
    return mode.kind === 'restart' ? { ...base, until: undefined, from: undefined } : base;
  });
  const [start, setStart] = useState<Day>(initialStart);
  const [startTouched, setStartTouched] = useState(false);

  const original = mode.kind === 'edit' ? ruleOf(mode.item)! : undefined;
  const reshaped = !original || !sameDays(original, rule) || startTouched;
  // Where it counts from: kept while its days are, so "every other week" stays on its weeks.
  const next: Recurrence = { ...rule, from: reshaped || !original ? start : original.from };
  const due =
    mode.kind === 'edit'
      ? reshaped
        ? firstOccurrence(next, start, cal)
        : (item.due ?? null)
      : mode.kind === 'start' && item.due && !startTouched
        ? item.due
        : firstOccurrence(next, start, cal);
  const later = due ? occurrencesAfter(next, due, '9999-12-31', cal, 4) : [];
  const moved = mode.kind !== 'restart' && due && item.due && due !== item.due;

  const save = () => {
    if (!due) return;
    if (mode.kind === 'restart') {
      actions.apply((d) => restartSeries(d, item.id, next, due, new Date()).doc, `Started again: the next is due ${fmt.day(due)}.`);
    } else {
      actions.apply(
        (d) => updateItem(d, item.id, { recur: next, ...(due !== item.due ? { due } : {}) }, new Date()),
        mode.kind === 'start' ? `#${item.num} now repeats ${inSentence(next)}.` : `Schedule changed for #${item.num}.`,
      );
    }
    onClose();
  };

  return (
    <Modal
      title={mode.kind === 'edit' ? `Schedule for #${item.num}` : mode.kind === 'start' ? `Make #${item.num} repeat` : `Start "${item.title}" again`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!due} onClick={save} data-testid="schedule-save">
            {mode.kind === 'edit' ? 'Save the schedule' : mode.kind === 'start' ? 'Make it repeat' : 'Start again'}
          </button>
        </>
      }
    >
      <ScheduleEditor
        value={rule}
        onChange={setRule}
        start={start}
        onStart={(d) => {
          setStart(d);
          setStartTouched(true);
        }}
        startLabel={mode.kind === 'edit' ? 'This one, or the first on or after' : 'First one on or after'}
      />
      <SchedulePreview
        rule={next}
        dates={due ? [due, ...later] : []}
        lead={
          due && mode.kind !== 'restart' ? (
            <span className={moved ? 'tone-warn' : 'hint'}>
              {moved ? `This one moves from ${fmt.day(item.due)} to ${fmt.day(due)}.` : item.due ? `This one stays due ${fmt.day(item.due)}.` : `This one becomes due ${fmt.day(due)}.`}
            </span>
          ) : undefined
        }
      />
      {rule.unit === 'week' && rule.days?.some((d) => !state.doc.settings.workDays.includes(d)) && <p className="hint mt-2">One that falls on a day you do not work is due the working day before.</p>}
    </Modal>
  );
}

/** Pass over every occurrence before a day: holidays, a shutdown, a quiet month. */
export function PauseDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { state, actions } = useApp();
  const cal = calendarOf(state.doc.settings);
  const fmt = makeFmt(state.doc.settings.dateOrder, state.today, cal);
  const [until, setUntil] = useState<Day | undefined>();
  const rule = ruleOf(item);
  const after = item.due ?? state.today;
  const next = rule && until ? nextOccurrence(rule, after, cal, until > state.today ? until : state.today) : null;
  return (
    <Modal
      title={`Pause "${item.title}"`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!until || until <= state.today}
            data-testid="pause-save"
            onClick={() => {
              actions.apply((d) => skip(d, item.id, new Date(), until).doc, next ? `Paused: the next is due ${fmt.day(next)}.` : 'Paused, and it has no dates after that.');
              onClose();
            }}
          >
            Pause
          </button>
        </>
      }
    >
      <p className="text-[13px]">The one in hand and every one before the day you pick are passed over: each is in its history as skipped, never as late.</p>
      <div className="mt-3 w-64">
        <DateField label="Back on" value={until} onChange={setUntil} placeholder="11/30, next month" testid="pause-until" />
      </div>
      {until && <p className="hint">{until <= state.today ? 'Pick a day after today.' : next ? `The next one will be due ${fmt.both(next)}.` : 'The schedule ends before then: nothing more will come.'}</p>}
    </Modal>
  );
}

/**
 * A new recurring item, defined in one place: what, for or from whom, the schedule,
 * and the steps each one takes.
 */
export function NewRecurringDialog({ onClose, onAdded }: { onClose: () => void; onAdded?: (it: Item) => void }) {
  const { state, actions } = useApp();
  const cal = calendarOf(state.doc.settings);
  const [title, setTitle] = useState('');
  const [direction, setDirection] = useState<Direction>('owe');
  const [personId, setPersonId] = useState<string | undefined>();
  const [newPerson, setNewPerson] = useState<string | undefined>();
  const [steps, setSteps] = useState('');
  const [start, setStart] = useState<Day>(state.today);
  const [rule, setRule] = useState<Recurrence>(() => fullRule({ every: 1, unit: 'week', days: [5] }, state.today));
  const next: Recurrence = { ...rule, from: start };
  const dates = upcomingDates(next, start, cal, 5);
  const ok = !!title.trim() && dates.length > 0;

  const save = () => {
    if (!ok) return;
    let made: Item | null = null;
    actions.apply(
      (d) => {
        // A person typed as new is made in the same change as the item, so one undo takes both.
        let doc = d;
        let pid = personId;
        if (newPerson) {
          const r = addPerson(doc, { name: newPerson }, new Date());
          doc = r.doc;
          pid = r.person.id;
        }
        const stepList: Step[] = steps
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((text) => ({ id: newId('st'), text, done: false }));
        const r = addItem(doc, { title, direction, personId: pid, due: dates[0], recur: next, steps: stepList }, new Date());
        made = r.item;
        return r.doc;
      },
      () => (made ? `Added #${(made as Item).num}: ${(made as Item).title}, ${inSentence(next)}.` : 'Added.'),
    );
    if (made) onAdded?.(made as Item);
    onClose();
  };

  return (
    <Modal
      title="A new recurring item"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ok} onClick={save} data-testid="recurring-add">
            <Icon name="plus" size={14} /> Add it
          </button>
        </>
      }
    >
      <label className="field block">
        <span className="field-l">What</span>
        <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Timesheet, weekly report to BART, site diary" data-autofocus data-testid="recurring-title" />
      </label>
      <div className="grid2">
        <div className="field">
          <span className="field-l">Type</span>
          <div className="seg" role="group" aria-label="Type">
            <button type="button" aria-pressed={direction === 'owe'} onClick={() => setDirection('owe')}>
              I owe it
            </button>
            <button type="button" aria-pressed={direction === 'wait'} onClick={() => setDirection('wait')}>
              Someone owes me
            </button>
          </div>
        </div>
        <PersonField
          label={direction === 'owe' ? 'For' : 'From'}
          value={personId}
          onChange={(id, name) => {
            setPersonId(id);
            setNewPerson(name);
          }}
        />
      </div>
      {newPerson && <p className="hint -mt-2 mb-2">{newPerson} will be added to your people.</p>}
      <ScheduleEditor value={rule} onChange={setRule} start={start} onStart={setStart} />
      <label className="field mt-3 block">
        <span className="field-l">Steps each time (optional, one a line)</span>
        <textarea className="textarea" style={{ minHeight: 76 }} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'Collect the hours\nCheck against the diary\nSubmit'} data-testid="recurring-steps" />
      </label>
      <SchedulePreview rule={next} dates={dates} lead={dates[0] ? <span className="hint">The first is due {makeFmt(state.doc.settings.dateOrder, state.today, cal).both(dates[0])}.</span> : undefined} />
    </Modal>
  );
}

/** Whichever schedule dialog is open, over any screen. Layout renders this once. */
export function ScheduleDialogs() {
  const { state, ui, actions } = useApp();
  const doc = state.doc;
  if (ui.newRecurring) return <NewRecurringDialog onClose={() => actions.setUi({ newRecurring: false })} />;
  if (ui.pause) {
    const item = doc.items.find((i) => i.id === ui.pause);
    return item ? <PauseDialog item={item} onClose={() => actions.setUi({ pause: null })} key={item.id} /> : null;
  }
  const req = ui.schedule;
  if (!req) return null;
  const close = () => actions.setUi({ schedule: null });
  if (req.kind === 'restart') {
    const series = allSeries(doc).find((s) => s.id === req.seriesId);
    return series ? <ScheduleDialog mode={{ kind: 'restart', series }} onClose={close} key={series.id} /> : null;
  }
  const item = doc.items.find((i) => i.id === req.itemId);
  return item ? <ScheduleDialog mode={{ kind: req.kind, item }} onClose={close} key={`${req.kind}-${item.id}`} /> : null;
}
