/**
 * The on-device model, as the screens use it. `on` is the user's choice in Settings;
 * the model itself is loaded the first time something asks for it, and the screens
 * show its progress from `useAiStatus()`.
 */
import { getEngine } from '../ai/manager';
import { checkReply, extractActions, writeBrief, writeChaser, type TaskContext } from '../ai/tasks';
import { calendarOf } from '../engine/ops';
import type { ChaseLevel, Item, Person } from '../engine/types';
import { useApp } from './state';

export function useAi() {
  const { state } = useApp();
  const s = state.doc.settings;
  const on = s.ai.mode === 'local';
  const tctx: TaskContext = { today: state.today, cal: calendarOf(s), order: s.dateOrder, people: state.doc.people, myName: s.myName };
  const engine = () => getEngine(s.ai.model);
  return {
    on,
    model: s.ai.model,
    extract: async (text: string, who: { fromMe: boolean; sender?: string; recipient?: string }, onProgress?: (d: number, t: number) => void) => extractActions(await engine(), text, tctx, who, onProgress),
    chaser: async (items: Item[], person: Person | undefined, level: ChaseLevel) => writeChaser(await engine(), items, person, level, tctx),
    reply: async (item: Item, reply: string) => checkReply(await engine(), item, reply, tctx),
    brief: async (kind: 'week' | 'person', facts: string) => writeBrief(await engine(), kind, facts, s.myName),
    tctx,
  };
}
