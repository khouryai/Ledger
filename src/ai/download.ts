/**
 * Getting the model onto the machine, and saying plainly why it did not arrive.
 *
 * WebLLM keeps the model's files in the browser's storage: the Cache API by default,
 * or IndexedDB. A download can fail for three different reasons, and each needs a
 * different answer from the person:
 *
 * - blocked: huggingface.co could not be reached at all, which on a company laptop
 *   is usually the network's filter. Another network fixes it; nothing in the app can.
 * - space: the browser would not store a couple of gigabytes for this site.
 * - storage: the Cache API itself refused (it can, on some machines and for some
 *   responses) though the network worked. IndexedDB is tried instead, once, and
 *   remembered.
 *
 * Pure: the browser calls are passed in, so the reasoning is tested in Node.
 */
export type CacheBackend = 'cache' | 'indexeddb';

export type LoadProblem = { kind: 'blocked' | 'space' | 'storage' | 'other'; message: string; detail: string };

const GB = 1024;

function fmtGB(mb: number): string {
  return `${(mb / GB).toFixed(1)} GB`;
}

/** What went wrong, in words, from whatever the browser or WebLLM threw. */
export function explainLoadError(err: unknown, needMB: number): LoadProblem {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (/quota|QuotaExceeded|no space|disk full/i.test(detail))
    return {
      kind: 'space',
      message: `The browser would not keep the model: it needs about ${fmtGB(needMB)} free for this site. Free some disk space, or choose a smaller model.`,
      detail,
    };
  if (/hugging ?face could not be reached|failed to fetch|networkerror|network error|load failed|err_|net::|request failed|blocked/i.test(detail) && !/cache\.add|on 'Cache'/i.test(detail))
    return {
      kind: 'blocked',
      message:
        'The download from huggingface.co was blocked or cut off. Company networks often block it: try once on another network (home Wi-Fi or a phone hotspot). After that the model runs with no network at all.',
      detail,
    };
  if (/cache|CacheStorage|caches|SecurityError|IndexedDB/i.test(detail))
    return { kind: 'storage', message: "The browser's storage refused the model's files.", detail };
  return { kind: 'other', message: 'The model could not be loaded.', detail };
}

/** Whether to try again on the other storage: only when the network was not the problem. */
export function shouldRetryOnIndexedDb(problem: LoadProblem, backend: CacheBackend): boolean {
  return backend === 'cache' && (problem.kind === 'storage' || problem.kind === 'other');
}

/** Free space the browser will give this site, or null when it will not say. */
export function freeMB(estimate: { quota?: number; usage?: number } | undefined): number | null {
  if (!estimate || typeof estimate.quota !== 'number') return null;
  return Math.max(0, (estimate.quota - (estimate.usage ?? 0)) / 1048576);
}

/** A refusal before downloading anything, when the space is plainly not there. */
export function spaceProblem(free: number | null, needMB: number): string | null {
  if (free === null || free >= needMB * 1.1) return null;
  return `The browser has about ${fmtGB(free)} free for this site and the model needs about ${fmtGB(needMB)}. Free some disk space, or choose a smaller model.`;
}
