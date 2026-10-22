/**
 * The model's lifecycle in this window: checking the laptop can run it, downloading
 * and loading it, and handing it to whoever asks. One model is loaded at a time and
 * kept for the life of the window, because loading takes seconds to minutes and
 * answering takes seconds.
 *
 * Tests swap in a stand-in by setting `window.__LEDGER_FAKE_AI__` before the app
 * starts; nothing else can.
 */
import { useSyncExternalStore } from 'react';
import type { AiEngine } from './engine';

export type AiStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'unsupported'; reason: string }
  | { state: 'loading'; model: string; progress: number; text: string }
  | { state: 'ready'; model: string }
  | { state: 'error'; model: string; message: string; detail?: string };

let status: AiStatus = { state: 'idle' };
let engine: AiEngine | null = null;
let loading: Promise<AiEngine> | null = null;
const listeners = new Set<() => void>();

function set(next: AiStatus) {
  status = next;
  listeners.forEach((l) => l());
}

export function aiStatus(): AiStatus {
  return status;
}

export function useAiStatus(): AiStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => status,
  );
}

type FakeHook = { myName?: string; today?: string } | true;

function fakeHook(): FakeHook | undefined {
  return typeof window !== 'undefined' ? (window as unknown as { __LEDGER_FAKE_AI__?: FakeHook }).__LEDGER_FAKE_AI__ : undefined;
}

/** Get the loaded model, loading it first if need be. */
export async function getEngine(model: string): Promise<AiEngine> {
  if (engine && engine.model === model) return engine;
  if (loading) return loading;
  const fake = fakeHook();
  loading = (async () => {
    try {
      if (fake) {
        const { FakeEngine } = await import('./fake');
        engine = new FakeEngine(fake === true ? {} : fake);
        set({ state: 'ready', model });
        return engine;
      }
      set({ state: 'checking' });
      const { checkGpu, WebLlmEngine } = await import('./webllm');
      const gpu = await checkGpu();
      if (!gpu.ok) {
        set({ state: 'unsupported', reason: gpu.reason ?? 'WebGPU is not available.' });
        throw new Error(gpu.reason);
      }
      if (engine && 'unload' in engine) await (engine as unknown as { unload: () => Promise<void> }).unload().catch(() => undefined);
      engine = null;
      set({ state: 'loading', model, progress: 0, text: 'Starting' });
      const e = await WebLlmEngine.create(model, (progress, text) => set({ state: 'loading', model, progress, text }));
      engine = e;
      set({ state: 'ready', model });
      return e;
    } catch (err) {
      if (status.state !== 'unsupported') {
        const problem = (err as { problem?: { message: string; detail: string } }).problem;
        set({ state: 'error', model, message: problem?.message ?? (err as Error).message, detail: problem?.detail });
      }
      throw err;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function aiIsFake(): boolean {
  return !!fakeHook();
}

export async function unloadEngine(): Promise<void> {
  const e = engine;
  engine = null;
  if (e && 'unload' in e) await (e as unknown as { unload: () => Promise<void> }).unload().catch(() => undefined);
  set({ state: 'idle' });
}
