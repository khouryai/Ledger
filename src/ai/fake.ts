/**
 * A stand-in model for the tests. It answers each kind of request the way the rules
 * would, in the model's own answer format, so the whole pipeline (prompt, answer,
 * checking) runs without a graphics chip. It is never offered to the user.
 */
import { checkReplyRules } from '../engine/reply';
import { toDay } from '../engine/dates';
import type { AiEngine, AiRequest } from './engine';
import { asksAsModelJson, EXTRACT_SCHEMA, REPLY_SCHEMA } from './tasks';

export class FakeEngine implements AiEngine {
  readonly model = 'fake';
  calls: AiRequest[] = [];

  constructor(private readonly opts: { myName?: string; today?: string } = {}) {}

  async complete(req: AiRequest): Promise<string> {
    this.calls.push(req);
    const body = /---\n([\s\S]*?)\n---/.exec(req.user)?.[1] ?? req.user;
    const today = this.opts.today ?? toDay(new Date());
    const cal = { workDays: [1, 2, 3, 4, 5], holidays: [] };
    if (req.schema === EXTRACT_SCHEMA) {
      const me = this.opts.myName || 'the reader';
      const fromMe = req.system.includes(`This text was written by ${me}`);
      const other = fromMe ? /written by .*? to ([^.\n]+)\./.exec(req.system)?.[1] : /written by (.+?) to /.exec(req.system)?.[1];
      return asksAsModelJson(body, { today, cal, order: 'MDY', people: [], myName: this.opts.myName ?? '' }, fromMe, other);
    }
    if (req.schema === REPLY_SCHEMA) {
      const r = checkReplyRules(body, today, cal, 'MDY');
      return JSON.stringify({ verdict: r.verdict, when: r.promisePhrase ?? '', summary: r.summary });
    }
    const first = /To: (\S+)/.exec(req.user)?.[1] ?? 'there';
    const items = req.user.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).replace(/ \(.*$/, ''));
    if (/weekly status/.test(req.system)) return `This week in brief: ${req.user.split('\n').slice(0, 3).join(' ')}`;
    if (/before a call/.test(req.system)) return `Before the call: ${req.user.split('\n').slice(0, 2).join(' ')}`;
    return `Hi ${first},\n\nChecking in on ${items.join(' and ')}. Could you let me know where it stands?\n\nThanks,\n${this.opts.myName ?? ''}`;
  }
}
