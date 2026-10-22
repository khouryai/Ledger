import { describe, expect, it } from 'vitest';
import { readDoc } from '../src/engine/doc';
import {
  accuracy,
  direction,
  features,
  findMissed,
  forget,
  judgeAction,
  judgeReply,
  KEEP,
  learn,
  ready,
  relative,
  signature,
  train,
  words,
  type Example,
  type ExampleDraft,
} from '../src/engine/learn';
import { mergeDocs } from '../src/engine/merge';
import { at, docWith, TODAY } from './helpers';

const NOW = at(TODAY, 15);

let seq = 0;
function ex(task: Example['task'], text: string, label: string, extra: Partial<Example> = {}): Example {
  seq++;
  return { id: `ex_${seq}`, at: new Date(Date.UTC(2026, 9, 1, 0, seq)).toISOString(), task, text, label, ...extra };
}

/** A user who gets emails from others and has habits the rules do not know. */
function habits(): Example[] {
  const out: Example[] = [];
  const things = ['ATS report', 'cable schedule', 'IXL test plan', 'radio survey', 'possession plan', 'ICD update', 'tunnel drawings', 'site walk notes'];
  things.forEach((t, i) => {
    // Requests to me: kept, as I owe (the reader does it).
    out.push(ex('action', `Could you send the ${t} by Friday?`, 'other', { fromMe: false, proposed: 'other' }));
    // "FYI" lines the rules catch on "please" but are never actions for this user.
    out.push(ex('action', `FYI please note the ${t} was issued last week.`, 'none', { fromMe: false, proposed: 'other' }));
    // "Pls action" is this user's team's way of asking, which the rules miss.
    out.push(ex('action', `Pls action the ${t} review before the ${i + 3}th.`, 'other', { fromMe: false, proposed: 'none' }));
    // "Our side will" from others: the rules read a promise from the writer (waiting
    // on), but on this project it means the user's own team, so the user turns it round.
    out.push(ex('action', `Our side will update the ${t} next week.`, 'other', { fromMe: false, proposed: 'writer' }));
  });
  return out;
}

describe('what the model sees', () => {
  it('folds dates, days, numbers and links so they generalise', () => {
    expect(words('Send by Fri 11/14, see https://x.y/z, ping a@b.com, 3 copies, EOW')).toEqual([
      'send',
      'by',
      '_day',
      '_date',
      'see',
      '_url',
      'ping',
      '_email',
      '_num',
      'copies',
      '_soon',
    ]);
    const f = features('Could you send it by Friday?', false);
    expect(f).toContain('could you');
    expect(f).toContain('#question');
    expect(f).toContain('#by-when');
    expect(f).toContain('#from-them');
  });

  it('learns who owes it relative to the writer', () => {
    for (const fromMe of [true, false])
      for (const d of ['owe', 'wait'] as const) expect(direction(relative(d, fromMe), fromMe)).toBe(d);
    // "Could you send" from them: the reader (me) does it, so I owe.
    expect(relative('owe', false)).toBe('other');
    // The same words from me: the reader (them) does it, so I wait.
    expect(direction('other', true)).toBe('wait');
  });
});

describe('learning from what the user decides', () => {
  it('says nothing until it has seen enough', () => {
    const m = train(habits().slice(0, 12), 'action');
    expect(ready(m)).toBe(false);
    const j = judgeAction(m, 'FYI please note the plan was issued.', false, 'owe');
    expect(j.advice).toBe('keep');
    expect(j.reason).toBeUndefined();
  });

  it('unticks what the user always unticks, and says why', () => {
    const m = train(habits(), 'action');
    expect(ready(m)).toBe(true);
    const j = judgeAction(m, 'FYI please note the signal design was issued yesterday.', false, 'owe');
    expect(j.advice).toBe('untick');
    expect(j.reason).toMatch(/^Unticked: sentences like this were not actions for you/);
    expect(j.reason).toMatch(/"fyi"|"please note"|"fyi please"/);
    // A plain request is left alone.
    expect(judgeAction(m, 'Could you send the commissioning plan by Friday?', false, 'owe').advice).toBe('keep');
  });

  it('turns round what the user always turns round', () => {
    const m = train(habits(), 'action');
    // The rules read "will" from them as a promise to me (waiting on).
    const j = judgeAction(m, 'Our side will update the interface matrix next week.', false, 'wait');
    expect(j.advice).toBe('flip');
    expect(direction(j.label as 'writer' | 'other', false)).toBe('owe');
    expect(j.reason).toMatch(/^Switched to I owe/);
    expect(j.reason).toMatch(/"our side"/);
  });

  it('finds an action the rules passed over, with the reason', () => {
    const m = train(habits(), 'action');
    const found = findMissed(
      m,
      [
        { text: 'Pls action the fire alarm interface review before the 20th.', index: 0 },
        { text: 'The weather was good on site.', index: 60 },
      ],
      false,
      [],
    );
    expect(found).toHaveLength(1);
    expect(found[0].quote).toMatch(/^Pls action/);
    expect(found[0].direction).toBe('owe');
    expect(found[0].reason).toMatch(/^Found by what it learned from you, not by the rules: "pls action"|"pls"/);
    // Never offers what is already suggested.
    expect(findMissed(m, [{ text: 'Pls action the fire alarm interface review before the 20th.', index: 0 }], false, ['pls action the fire alarm interface review before the 20th.'])).toHaveLength(0);
  });

  it('reads replies the way the user reads them', () => {
    const xs: Example[] = [];
    for (const t of ['ATS report', 'cable schedule', 'test plan', 'survey', 'drawings', 'ICD']) {
      xs.push(ex('reply', `The ${t} is on its way to you, should land shortly.`, 'stall', { proposed: 'unclear' }));
      xs.push(ex('reply', `Uploaded the ${t} to the SharePoint folder.`, 'delivered', { proposed: 'delivered' }));
      xs.push(ex('reply', `Sorry, still chasing the vendor for the ${t}.`, 'stall', { proposed: 'stall' }));
      xs.push(ex('reply', `Half of the ${t} is in the folder, rest to follow.`, 'partial', { proposed: 'partial' }));
    }
    const m = train(xs, 'reply');
    expect(ready(m)).toBe(true);
    const j = judgeReply(m, 'The signal plan is on its way, should land shortly.', 'unclear');
    expect(j?.verdict).toBe('stall');
    expect(j?.reason).toMatch(/^Read as not delivered from your earlier verdicts/);
    // When the learning agrees with what is shown, it says nothing.
    expect(judgeReply(m, 'Uploaded the plan to the folder.', 'delivered')).toBeNull();
  });

  it('measures itself honestly, against what was proposed', () => {
    const a = accuracy(habits(), 'action');
    expect(a?.n).toBe(32);
    // The rules were right on the plain requests only: a quarter of these.
    expect(a?.proposed).toBeCloseTo(0.25);
    expect(a!.learned).toBeGreaterThan(0.8);
  });

  it('names the phrases that mean "an action" to this user', () => {
    const m = train(habits(), 'action');
    expect(signature(m, 'none', ['writer', 'other'])).toEqual(expect.arrayContaining(['"fyi please"', '"please note"']));
  });
});

describe('keeping the examples', () => {
  const draft = (text: string, label = 'other'): ExampleDraft => ({ task: 'action', text, label, fromMe: false });

  it('adds examples, newest kept, and forgets on request', () => {
    let doc = docWith();
    doc = learn(doc, [draft('Could you send it?'), draft('   ')], NOW);
    expect(doc.examples).toHaveLength(1);
    expect(doc.examples[0].id).toMatch(/^ex_/);
    doc = { ...doc, examples: Array.from({ length: KEEP }, (_, i) => ex('action', `s${i}`, 'none')) };
    doc = learn(doc, [draft('the newest')], NOW);
    expect(doc.examples.filter((e) => e.task === 'action')).toHaveLength(KEEP);
    expect(doc.examples.at(-1)?.text).toBe('the newest');
    expect(doc.examples.some((e) => e.text === 's0')).toBe(false);
    expect(forget(doc, 'action').examples).toHaveLength(0);
  });

  it('keeps what both devices learned', () => {
    const base = docWith();
    const mine = learn(base, [draft('Learned on the phone')], NOW);
    const theirs = learn(base, [draft('Learned on the laptop')], at(TODAY, 16));
    const r = mergeDocs(base, mine, theirs, NOW);
    expect(r.doc.examples.map((e) => e.text).sort()).toEqual(['Learned on the laptop', 'Learned on the phone']);
  });

  it('reads old files with none, and drops malformed ones', () => {
    const { doc } = readDoc({ schema: 1, items: [], people: [] });
    expect(doc.examples).toEqual([]);
    const r = readDoc({ schema: 1, examples: [ex('action', 'ok', 'none'), { id: 1 }, { id: 'x', at: 'y', task: 'other', text: 't', label: 'l' }] });
    expect(r.doc.examples).toHaveLength(1);
  });
});
