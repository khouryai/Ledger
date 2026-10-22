/**
 * The one thing the rest of the application knows about a language model: give it a
 * system prompt and a user message, optionally a JSON schema its answer must follow,
 * and get text back. The model runs on this laptop (WebLLM, on the graphics chip);
 * nothing is sent anywhere.
 */
export type AiRequest = {
  system: string;
  user: string;
  /** A JSON schema the answer is constrained to. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
};

export interface AiEngine {
  readonly model: string;
  complete(req: AiRequest): Promise<string>;
}

/** Pull the JSON object out of a model's answer, forgiving code fences and preamble. */
export function parseJsonAnswer<T>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t) as T;
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1)) as T;
    throw new Error('The model did not answer in the expected format.');
  }
}

/** `downloadMB` is roughly what is fetched and stored; `vramMB` is WebLLM's graphics-memory estimate. */
export type ModelChoice = { id: string; label: string; maker: string; vramMB: number; downloadMB: number; note: string };

/**
 * The models offered. Each is a prebuilt WebLLM model; the memory figure is WebLLM's
 * own estimate of the graphics memory it needs. The maker is shown because some
 * companies have a policy on which ones may be used.
 */
export const MODELS: ModelChoice[] = [
  { id: 'Phi-4-mini-instruct-q4f16_1-MLC', label: 'Phi-4 mini', maker: 'Microsoft', vramMB: 3438, downloadMB: 2200, note: 'Best quality of the four. MIT licence.' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', maker: 'Meta', vramMB: 2264, downloadMB: 1800, note: 'Faster, slightly weaker.' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 3B', maker: 'Alibaba', vramMB: 2505, downloadMB: 1750, note: 'Strong at structured answers. Check your company policy on Chinese-made models.' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', maker: 'Meta', vramMB: 879, downloadMB: 750, note: 'For laptops with little graphics memory. Noticeably weaker.' },
];

export function modelChoice(id: string): ModelChoice {
  return MODELS.find((m) => m.id === id) ?? { id, label: id, maker: 'Unknown', vramMB: 0, downloadMB: 2200, note: '' };
}
