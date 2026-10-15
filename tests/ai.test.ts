import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../src/ai/fake';
import { checkActions, checkReply, chunks, extractActions, writeChaser } from '../src/ai/tasks';
import { parseJsonAnswer } from '../src/ai/engine';
import { checkReplyRules } from '../src/engine/reply';
import { add, docWith, pid, TODAY } from './helpers';

const doc = docWith(['Sam Lee', 'Priya Shah']);
const ctx = { today: TODAY, cal: { workDays: [1, 2, 3, 4, 5], holidays: [] }, order: 'MDY' as const, people: doc.people, myName: 'Alex Khoury' };

describe('checking what the model says', () => {
  it('works dates out itself and flags a quote it cannot find', () => {
    const text = 'Sam: could you send the cable schedule by next Tuesday?';
    const asks = checkActions(
      [
        { direction: 'owe', person: 'Sam', title: 'Send the cable schedule', when: 'by next Tuesday', quote: 'could you send the cable schedule by next Tuesday?' },
        { direction: 'wait', person: 'Morgan', title: 'Invented thing', when: '', quote: 'Something not in the text' },
        { direction: 'owe', person: '', title: 'send the cable schedule', when: '', quote: 'dup' },
      ],
      text,
      ctx,
    );
    expect(asks.length).toBe(2);
    expect(asks[0]).toMatchObject({ kind: 'ai', direction: 'owe', due: '2026-10-20', quoteFound: true });
    expect(asks[0].match).toMatchObject({ kind: 'one', person: { name: 'Sam Lee' } });
    expect(asks[1]).toMatchObject({ quoteFound: false });
    expect(asks[1].match?.kind).toBe('none');
  });
  it('never takes the reader for the other person', () => {
    const [a] = checkActions([{ direction: 'owe', person: 'Alex', title: 'Book the room', when: '', quote: '' }], 'x', ctx);
    expect(a.personName).toBeUndefined();
  });
  it('reads JSON out of fences and preamble', () => {
    expect(parseJsonAnswer<{ a: number }>('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonAnswer('no json here')).toThrow();
  });
  it('splits long text into pieces the model can hold', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'word '.repeat(60)}`).join('\n\n');
    const parts = chunks(text, 2000);
    expect(parts.length).toBeGreaterThanOrEqual(5);
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
    expect(parts.join('\n\n')).toBe(text);
  });
});

describe('the pipeline, with the stand-in model', () => {
  it('extracts actions from an email', async () => {
    const engine = new FakeEngine({ myName: 'Alex Khoury', today: TODAY });
    const asks = await extractActions(engine, "Hi Alex, could you please send the IXL test plan by Friday? I'll send the cable schedule next Tuesday.", ctx, { fromMe: false, sender: 'Sam Lee' });
    expect(asks.map((a) => [a.direction, a.title, a.due])).toEqual([
      ['owe', 'Send the IXL test plan', '2026-10-16'],
      ['wait', 'Send the cable schedule', '2026-10-20'],
    ]);
    expect(engine.calls[0].system).toContain('written by Sam Lee to Alex Khoury');
  });
  it('writes a chaser and strips any subject line', async () => {
    const { doc: d2, item } = add(doc, { title: 'ATS report', personId: pid(doc, 'Sam') });
    const p = d2.people.find((x) => x.id === item.personId);
    const body = await writeChaser(new FakeEngine({ myName: 'Alex Khoury' }), [item], p, 'firm', ctx);
    expect(body).toContain('Hi Sam');
    expect(body).toContain('ATS report');
  });
  it('checks a reply, keeping only a date that is in the reply', async () => {
    const { item } = add(doc, { title: 'ATS report' });
    const r = await checkReply(new FakeEngine({ today: TODAY }), item, 'Sorry, running behind, will have it to you next Wednesday.', ctx);
    expect(r).toMatchObject({ verdict: 'stall', promise: '2026-10-21', by: 'ai' });
  });
});

describe('reply rules', () => {
  const cal = ctx.cal;
  it('reads delivered, partial, stall and unclear', () => {
    expect(checkReplyRules('Please find attached the report.', TODAY, cal, 'MDY').verdict).toBe('delivered');
    expect(checkReplyRules('Attached is part of it, the rest to come.', TODAY, cal, 'MDY').verdict).toBe('partial');
    expect(checkReplyRules("I'll get it to you by 10/22.", TODAY, cal, 'MDY')).toMatchObject({ verdict: 'stall', promise: '2026-10-22' });
    expect(checkReplyRules('Noted.', TODAY, cal, 'MDY').verdict).toBe('unclear');
  });
});
