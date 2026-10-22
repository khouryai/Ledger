/**
 * The model, run on this laptop's graphics chip with WebLLM.
 *
 * The library is loaded only when the AI is switched on, and the model's files are
 * downloaded once (from Hugging Face) and kept in the browser's storage. After that it
 * runs with no network at all. Nothing it reads or writes leaves the machine.
 */
import { explainLoadError, freeMB, shouldRetryOnIndexedDb, spaceProblem, type CacheBackend, type LoadProblem } from './download';
import { modelChoice, type AiEngine, type AiRequest } from './engine';

type WebLlm = typeof import('@mlc-ai/web-llm');
type Engine = Awaited<ReturnType<WebLlm['CreateMLCEngine']>>;

let lib: Promise<WebLlm> | null = null;

function load(): Promise<WebLlm> {
  if (!lib) lib = import('@mlc-ai/web-llm');
  return lib;
}

const STORAGE_KEY = 'ledger-ai-storage';

/**
 * Where the model's files are kept. The Cache API is WebLLM's default and best tested;
 * IndexedDB is the fallback, used from file:// (no Cache API there) and from then on
 * on any machine where the Cache API refused once.
 */
function preferredBackend(): CacheBackend {
  if (typeof location !== 'undefined' && location.protocol === 'file:') return 'indexeddb';
  try {
    return localStorage.getItem(STORAGE_KEY) === 'indexeddb' ? 'indexeddb' : 'cache';
  } catch {
    return 'cache';
  }
}

function rememberBackend(b: CacheBackend) {
  try {
    localStorage.setItem(STORAGE_KEY, b);
  } catch {
    /* asked again next time */
  }
}

async function appConfig(backend: CacheBackend = preferredBackend()) {
  const w = await load();
  return { ...w.prebuiltAppConfig, cacheBackend: backend };
}

/** A failed load, already explained: what the person sees, and the raw error under it. */
export class ModelLoadError extends Error {
  constructor(readonly problem: LoadProblem) {
    super(problem.message);
    this.name = 'ModelLoadError';
  }
}

/** Before a download: is there room, and can Hugging Face be reached at all? */
async function preflight(model: string): Promise<void> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const estimate = await storage?.estimate?.().catch(() => undefined);
  const need = modelChoice(model).downloadMB;
  const room = spaceProblem(freeMB(estimate), need);
  if (room) throw new ModelLoadError({ kind: 'space', message: room, detail: `estimate: ${JSON.stringify(estimate ?? null)}` });
  // Ask the browser not to clear a two-gigabyte download to make room for something else.
  await storage?.persist?.().catch(() => false);
  const w = await load();
  const rec = w.prebuiltAppConfig.model_list.find((m) => m.model_id === model);
  if (!rec) return;
  const url = `${rec.model.replace(/\/?$/, '/')}resolve/main/mlc-chat-config.json`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Hugging Face could not be reached: HTTP ${res.status} for ${url}`);
  } catch (err) {
    throw new ModelLoadError(explainLoadError(/could not be reached/.test(String(err)) ? err : new Error(`Hugging Face could not be reached: ${(err as Error).message}`), need));
  }
}

export type GpuReport = { ok: boolean; reason?: string; vendor?: string; architecture?: string; f16?: boolean; maxBufferMB?: number };

type GpuAdapterLike = {
  features: { has(f: string): boolean };
  limits: { maxBufferSize: number };
  info?: { vendor?: string; architecture?: string };
};

/** Can this browser run the model at all? WebGPU is the requirement. */
export async function checkGpu(): Promise<GpuReport> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: (o?: unknown) => Promise<GpuAdapterLike | null> } }).gpu;
  if (!gpu) return { ok: false, reason: 'This browser has no WebGPU. Use a current Microsoft Edge or Google Chrome.' };
  let adapter: GpuAdapterLike | null = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (err) {
    return { ok: false, reason: `The graphics chip could not be opened: ${(err as Error).message}` };
  }
  if (!adapter) return { ok: false, reason: 'WebGPU is present but no graphics adapter was offered. It may be switched off by policy, or the driver is too old.' };
  return {
    ok: true,
    vendor: adapter.info?.vendor,
    architecture: adapter.info?.architecture,
    f16: adapter.features.has('shader-f16'),
    maxBufferMB: Math.round(adapter.limits.maxBufferSize / 1048576),
  };
}

/** Downloaded already, in either kind of storage. Finding it in IndexedDB makes that the one used. */
export async function isDownloaded(model: string): Promise<boolean> {
  const w = await load();
  for (const b of ['cache', 'indexeddb'] as const) {
    if (b === 'cache' && typeof location !== 'undefined' && location.protocol === 'file:') continue;
    try {
      if (await w.hasModelInCache(model, await appConfig(b))) {
        if (b === 'indexeddb') rememberBackend(b);
        return true;
      }
    } catch {
      /* that storage is not available here */
    }
  }
  return false;
}

/** Delete the model's files from both kinds of storage, including a half-finished download. */
export async function removeDownload(model: string): Promise<void> {
  const w = await load();
  for (const b of ['cache', 'indexeddb'] as const) await w.deleteModelAllInfoInCache(model, await appConfig(b)).catch(() => undefined);
}

export class WebLlmEngine implements AiEngine {
  private constructor(
    readonly model: string,
    private readonly engine: Engine,
  ) {}

  static async create(model: string, onProgress: (progress: number, text: string) => void): Promise<WebLlmEngine> {
    const w = await load();
    const need = modelChoice(model).downloadMB;
    if (!(await isDownloaded(model))) await preflight(model);
    const attempt = (backend: CacheBackend) =>
      w.CreateMLCEngine(model, {
        appConfig: { ...w.prebuiltAppConfig, cacheBackend: backend },
        initProgressCallback: (r) => onProgress(r.progress, r.text),
      });
    const first = preferredBackend();
    try {
      return new WebLlmEngine(model, await attempt(first));
    } catch (err) {
      const problem = explainLoadError(err, need);
      if (!shouldRetryOnIndexedDb(problem, first)) throw new ModelLoadError(problem);
      // The Cache API refused though the network worked: start again in IndexedDB,
      // clearing what the failed attempt left behind.
      onProgress(0, "The browser's cache refused the files; trying its other storage");
      await w.deleteModelAllInfoInCache(model, { ...w.prebuiltAppConfig, cacheBackend: 'cache' }).catch(() => undefined);
      try {
        const engine = await attempt('indexeddb');
        rememberBackend('indexeddb');
        return new WebLlmEngine(model, engine);
      } catch (again) {
        const p2 = explainLoadError(again, need);
        throw new ModelLoadError({ ...p2, detail: `${problem.detail}\nThen, in IndexedDB: ${p2.detail}` });
      }
    }
  }

  async complete(req: AiRequest): Promise<string> {
    const res = await this.engine.chat.completions.create({
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 600,
      ...(req.schema ? { response_format: { type: 'json_object' as const, schema: JSON.stringify(req.schema) } } : {}),
    });
    return res.choices[0]?.message?.content ?? '';
  }

  async unload(): Promise<void> {
    await this.engine.unload();
  }
}
