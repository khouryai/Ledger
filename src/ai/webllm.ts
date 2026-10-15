/**
 * The model, run on this laptop's graphics chip with WebLLM.
 *
 * The library is loaded only when the AI is switched on, and the model's files are
 * downloaded once (from Hugging Face) and kept in the browser's storage. After that it
 * runs with no network at all. Nothing it reads or writes leaves the machine.
 */
import type { AiEngine, AiRequest } from './engine';

type WebLlm = typeof import('@mlc-ai/web-llm');
type Engine = Awaited<ReturnType<WebLlm['CreateMLCEngine']>>;

let lib: Promise<WebLlm> | null = null;

function load(): Promise<WebLlm> {
  if (!lib) lib = import('@mlc-ai/web-llm');
  return lib;
}

/**
 * The single-file version runs from file://, where the browser's Cache API is not
 * available, so the model's files are kept in IndexedDB there instead.
 */
async function appConfig() {
  const w = await load();
  const onDisk = typeof location !== 'undefined' && location.protocol === 'file:';
  return { ...w.prebuiltAppConfig, cacheBackend: onDisk ? ('indexeddb' as const) : ('cache' as const) };
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

export async function isDownloaded(model: string): Promise<boolean> {
  try {
    const w = await load();
    return await w.hasModelInCache(model, await appConfig());
  } catch {
    return false;
  }
}

export async function removeDownload(model: string): Promise<void> {
  const w = await load();
  await w.deleteModelAllInfoInCache(model, await appConfig());
}

export class WebLlmEngine implements AiEngine {
  private constructor(
    readonly model: string,
    private readonly engine: Engine,
  ) {}

  static async create(model: string, onProgress: (progress: number, text: string) => void): Promise<WebLlmEngine> {
    const w = await load();
    const engine = await w.CreateMLCEngine(model, {
      appConfig: await appConfig(),
      initProgressCallback: (r) => onProgress(r.progress, r.text),
    });
    return new WebLlmEngine(model, engine);
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
