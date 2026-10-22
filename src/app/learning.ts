/**
 * The learning model in the interface: built from the ledger's examples whenever they
 * change (it is derived, never stored), and applied to suggestions as they are made.
 */
import { useMemo } from 'react';
import { sentences, titleFrom } from '../engine/asks';
import { findDate, type Calendar } from '../engine/dates';
import { findMissed, judgeAction, relative, train, type Model } from '../engine/learn';
import { matchPerson } from '../engine/people';
import type { DateOrder, Day, Person } from '../engine/types';
import type { Draft } from './components/Suggestions';
import { useApp } from './state';

export type Learned = { action: Model; reply: Model };

export function useLearned(): Learned {
  const { state } = useApp();
  const examples = state.doc.examples;
  return useMemo(() => ({ action: train(examples, 'action'), reply: train(examples, 'reply') }), [examples]);
}

export type DraftContext = {
  /** The text the suggestions came from, to look for what the rules missed. */
  text?: string;
  fromMe: boolean;
  sender?: { name: string; email?: string };
  people: Person[];
  today: Day;
  cal: Calendar;
  order: DateOrder;
};

/**
 * Suggestions as the learning would have them: each marked with what was proposed
 * (so the user's decision can be learned from), unticked or turned round where the
 * learning is sure, and joined by sentences the rules passed over. Every change says
 * why, in the suggestion's own note.
 */
export function withLearning(drafts: Draft[], m: Model, ctx: DraftContext): Draft[] {
  const out = drafts.map((d): Draft => {
    const base: Draft = { ...d, fromMe: ctx.fromMe, proposed: relative(d.direction, ctx.fromMe) };
    if (!d.quote) return base;
    const j = judgeAction(m, d.quote, ctx.fromMe, d.direction);
    if (j.advice === 'untick') return { ...base, on: false, learnedNote: j.reason };
    if (j.advice === 'flip') return { ...base, direction: d.direction === 'owe' ? 'wait' : 'owe', learnedNote: j.reason };
    return base;
  });
  if (!ctx.text) return out;
  const missed = findMissed(
    m,
    sentences(ctx.text),
    ctx.fromMe,
    out.map((d) => d.quote),
  );
  const senderMatch = !ctx.fromMe && ctx.sender ? matchPerson(ctx.people, ctx.sender) : undefined;
  for (const x of missed) {
    const date = findDate(x.quote, ctx.today, ctx.cal, ctx.order);
    out.push({
      key: `learned-${x.index}`,
      on: true,
      added: false,
      direction: x.direction,
      title: titleFrom(x.quote, date?.text),
      // From someone else, they are the other party; from me, the user picks.
      personId: senderMatch?.kind === 'one' ? senderMatch.person.id : undefined,
      newPerson: senderMatch?.kind === 'none' ? ctx.sender?.name : undefined,
      due: date && date.day >= ctx.today ? date.day : undefined,
      quote: x.quote,
      from: 'learned',
      fromMe: ctx.fromMe,
      proposed: relative(x.direction, ctx.fromMe),
      learnedNote: x.reason,
    });
  }
  return out;
}
