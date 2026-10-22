/**
 * Did a reply close the item? The rule-based answer, used when the on-device model is
 * off and as the check on the model's answer when it is on.
 */
import { findDate, type Calendar } from './dates';
import type { DateOrder, Day } from './types';

export type ReplyVerdict = 'delivered' | 'partial' | 'stall' | 'unclear';

export type ReplyCheck = {
  verdict: ReplyVerdict;
  /** A new date they gave, read from their words. */
  promise?: Day;
  promisePhrase?: string;
  summary: string;
  /** Who read it: the rules, the on-device model, what was learned from the user, or the user. */
  by: 'rule' | 'ai' | 'learned' | 'you';
};

const DELIVERED = /\b(attached|please find|here (is|are)|enclosed|i('ve| have) (sent|uploaded|shared|attached|completed|done|issued|submitted)|(has|have) been (sent|uploaded|shared|completed|done|issued|submitted|approved)|done\b|completed\b|now (closed|resolved|fixed|available)|see (the )?(link|attached))/i;
const PARTIAL = /\b(part of|some of|partial|first (half|part|batch)|the rest|remaining|still (need|to come|outstanding)|except)\b/i;
const STALL = /\b(will|i'll|we'll|going to|by|next|tomorrow|later|soon|look into|looking into|chasing|waiting (on|for)|not yet|haven't|have not|delayed|behind|asap|as soon as)\b/i;

export function checkReplyRules(reply: string, today: Day, cal: Calendar, order: DateOrder): ReplyCheck {
  const t = reply.trim();
  if (!t) return { verdict: 'unclear', summary: 'Nothing to read.', by: 'rule' };
  const d = findDate(t, today, cal, order);
  const promise = d && d.day >= today ? d : undefined;
  if (DELIVERED.test(t) && PARTIAL.test(t)) return { verdict: 'partial', promise: promise?.day, promisePhrase: promise?.text, summary: 'Some of it has arrived; the rest is still to come.', by: 'rule' };
  if (DELIVERED.test(t) && !/\b(will|i'll|we'll)\b/i.test(t)) return { verdict: 'delivered', summary: 'Reads as delivered.', by: 'rule' };
  if (promise) return { verdict: 'stall', promise: promise.day, promisePhrase: promise.text, summary: `Not delivered; they gave a new date ("${promise.text}").`, by: 'rule' };
  if (STALL.test(t)) return { verdict: 'stall', summary: 'Not delivered, and no date given.', by: 'rule' };
  return { verdict: 'unclear', summary: 'Could not tell whether this delivers it.', by: 'rule' };
}
