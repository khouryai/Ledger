/**
 * The downloaded model, copied to a folder and back.
 *
 * WebLLM keeps each of a model's files in the browser under the web address it came
 * from: three Cache API caches (or IndexedDB databases) named webllm/config,
 * webllm/model and webllm/wasm. Saving copies those files into a folder with a small
 * manifest; loading puts each one back under the same address. WebLLM then finds the
 * model already in the browser and never asks the network for it.
 *
 * That is how a model downloaded once (at home, on a hotspot) reaches a laptop whose
 * network blocks Hugging Face, or another browser on the same laptop, through OneDrive
 * or a USB stick.
 *
 * A folder can only put files back at addresses that belong to the model it names:
 * under that model's own Hugging Face address, or its engine program's GitHub address,
 * both taken from WebLLM's own list. A folder cannot plant anything else.
 */
import type { CacheBackend } from './download';

export const MANIFEST = 'ledger-model.json';
export const SCOPES = ['webllm/config', 'webllm/model', 'webllm/wasm'] as const;
export type Scope = (typeof SCOPES)[number];

export type FileEntry = { scope: Scope; url: string; path: string; bytes: number };
export type Manifest = { kind: 'ledger-model'; version: 1; model: string; savedAt: string; files: FileEntry[] };

/** Where a model's files live, from WebLLM's record of it. */
export type ModelUrls = { model: string; base: string; lib: string };

/** WebLLM's own rule: a model address is read from under resolve/main/. */
export function modelBase(model: string): string {
  if (model.includes('resolve')) return model.endsWith('/') ? model : `${model}/`;
  return `${model.replace(/\/?$/, '/')}resolve/main/`;
}

export function belongs(url: string, u: ModelUrls): boolean {
  return url === u.lib || (url.startsWith(u.base) && !url.slice(u.base.length).includes('..'));
}

/** The file's name in the folder: the scope's folder, then its path under the model. */
export function pathFor(scope: Scope, url: string, u: ModelUrls): string {
  const rel = url === u.lib ? (url.split('/').pop() ?? 'model.wasm') : url.slice(u.base.length);
  return `${scope.split('/')[1]}/${rel.replace(/[\\:*?"<>|]+/g, '_')}`;
}

/** A manifest that is safe to load: right shape, this model, and only this model's addresses. */
export function checkManifest(raw: unknown, u: ModelUrls & { id: string }): Manifest {
  const m = raw as Partial<Manifest>;
  if (!m || m.kind !== 'ledger-model' || m.version !== 1 || !Array.isArray(m.files)) throw new Error(`This folder has no ${MANIFEST} that Ledger wrote.`);
  if (m.model !== u.id) throw new Error(`This folder holds ${m.model}, not ${u.id}. Choose that model first, or another folder.`);
  for (const f of m.files) {
    if (!f || !SCOPES.includes(f.scope as Scope) || typeof f.url !== 'string' || typeof f.path !== 'string' || typeof f.bytes !== 'number') throw new Error('The folder’s list of files is damaged.');
    if (!belongs(f.url, u)) throw new Error(`The folder lists a file that does not belong to this model (${f.url}). Nothing was loaded.`);
    if (f.path.split('/').some((p) => p === '..' || p === '')) throw new Error('The folder’s list of files is damaged.');
  }
  if (!m.files.some((f) => f.url.endsWith('/tensor-cache.json'))) throw new Error('The folder is missing the model’s list of weights (tensor-cache.json).');
  return m as Manifest;
}

// ------------------------------------------------------------- browser I/O

type Stored = { scope: Scope; url: string; read: () => Promise<Blob> };

function idbOpen(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('urls')) r.result.createObjectStore('urls', { keyPath: 'url' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function idbAll(db: IDBDatabase): Promise<{ url: string; data: unknown }[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction('urls', 'readonly').objectStore('urls').getAll();
    req.onsuccess = () => resolve(req.result as { url: string; data: unknown }[]);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, url: string, data: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction('urls', 'readwrite');
    t.objectStore('urls').put({ url, data });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function idbDelete(db: IDBDatabase, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction('urls', 'readwrite');
    t.objectStore('urls').delete(url);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/**
 * Delete every file of this model from one kind of storage, a half-finished download
 * included. Straight from storage: no network, unlike WebLLM's own delete.
 */
export async function clearModel(u: ModelUrls, backend: CacheBackend): Promise<number> {
  let n = 0;
  for (const scope of SCOPES) {
    if (backend === 'cache') {
      const cache = await caches.open(scope);
      for (const req of await cache.keys()) if (belongs(req.url, u) && (await cache.delete(req))) n++;
    } else {
      const db = await idbOpen(scope);
      try {
        for (const row of await idbAll(db)) if (belongs(row.url, u)) (await idbDelete(db, row.url), n++);
      } finally {
        db.close();
      }
    }
  }
  return n;
}

function asBlob(data: unknown): Blob {
  if (data instanceof ArrayBuffer) return new Blob([data]);
  if (ArrayBuffer.isView(data)) return new Blob([data as unknown as ArrayBuffer]);
  if (data instanceof Blob) return data;
  return new Blob([typeof data === 'string' ? data : JSON.stringify(data)], { type: 'application/json' });
}

/** Every file of this model the browser holds, in the storage WebLLM is using. */
async function stored(backend: CacheBackend, u: ModelUrls): Promise<Stored[]> {
  const out: Stored[] = [];
  for (const scope of SCOPES) {
    if (backend === 'cache') {
      const cache = await caches.open(scope);
      for (const req of await cache.keys()) {
        if (!belongs(req.url, u)) continue;
        out.push({ scope, url: req.url, read: async () => (await cache.match(req))!.blob() });
      }
    } else {
      const db = await idbOpen(scope);
      try {
        for (const row of await idbAll(db)) if (belongs(row.url, u)) out.push({ scope, url: row.url, read: async () => asBlob(row.data) });
      } finally {
        db.close();
      }
    }
  }
  return out;
}

async function dirAt(root: FileSystemDirectoryHandle, path: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let d = root;
  for (const p of path) d = await d.getDirectoryHandle(p, { create });
  return d;
}

export type Progress = (done: number, total: number, text: string) => void;

/** Copy the model's files into `ledger-model-<id>` inside the folder chosen. */
export async function saveModel(root: FileSystemDirectoryHandle, id: string, u: ModelUrls, backend: CacheBackend, onProgress: Progress): Promise<{ folder: string; files: number; bytes: number }> {
  const files = await stored(backend, u);
  if (!files.some((f) => f.url.endsWith('/tensor-cache.json'))) throw new Error('The model is not fully downloaded in this browser, so there is nothing whole to save.');
  const folderName = `ledger-model-${id}`;
  const dir = await root.getDirectoryHandle(folderName, { create: true });
  const entries: FileEntry[] = [];
  let bytes = 0;
  for (const [i, f] of files.entries()) {
    const path = pathFor(f.scope, f.url, u);
    onProgress(i, files.length, `Saving ${path}`);
    const blob = await f.read();
    const parts = path.split('/');
    const fh = await (await dirAt(dir, parts.slice(0, -1), true)).getFileHandle(parts.at(-1)!, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    entries.push({ scope: f.scope, url: f.url, path, bytes: blob.size });
    bytes += blob.size;
  }
  // The manifest last: a folder with one is a folder that was finished.
  const manifest: Manifest = { kind: 'ledger-model', version: 1, model: id, savedAt: new Date().toISOString(), files: entries };
  const mh = await dir.getFileHandle(MANIFEST, { create: true });
  const mw = await mh.createWritable();
  await mw.write(JSON.stringify(manifest, null, 1));
  await mw.close();
  onProgress(files.length, files.length, 'Saved');
  return { folder: folderName, files: entries.length, bytes };
}

/** The folder chosen, or the one `ledger-model-…` folder inside it. */
async function manifestDir(root: FileSystemDirectoryHandle, id: string): Promise<FileSystemDirectoryHandle> {
  try {
    await root.getFileHandle(MANIFEST);
    return root;
  } catch {
    try {
      const inner = await root.getDirectoryHandle(`ledger-model-${id}`);
      await inner.getFileHandle(MANIFEST);
      return inner;
    } catch {
      throw new Error(`No saved model here. Choose the folder named ledger-model-${id}, or the folder that holds it.`);
    }
  }
}

/** Put each saved file back where WebLLM looks for it. */
export async function loadModel(root: FileSystemDirectoryHandle, u: ModelUrls & { id: string }, backend: CacheBackend, onProgress: Progress): Promise<{ files: number; bytes: number }> {
  const dir = await manifestDir(root, u.id);
  const manifest = checkManifest(JSON.parse(await (await (await dir.getFileHandle(MANIFEST)).getFile()).text()), u);
  let bytes = 0;
  for (const [i, f] of manifest.files.entries()) {
    onProgress(i, manifest.files.length, `Loading ${f.path}`);
    const parts = f.path.split('/');
    const file = await (await (await dirAt(dir, parts.slice(0, -1), false)).getFileHandle(parts.at(-1)!)).getFile();
    if (file.size !== f.bytes) throw new Error(`${f.path} is ${file.size} bytes, not the ${f.bytes} saved. The copy is incomplete; save it again.`);
    if (backend === 'cache') {
      const cache = await caches.open(f.scope);
      await cache.put(new Request(f.url), new Response(file, { headers: { 'Content-Type': f.url.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Content-Length': String(file.size) } }));
    } else {
      // WebLLM keeps the weights' list as parsed JSON in IndexedDB, and everything else as bytes.
      const data = f.url.endsWith('/tensor-cache.json') ? JSON.parse(await file.text()) : await file.arrayBuffer();
      const db = await idbOpen(f.scope);
      try {
        await idbPut(db, f.url, data);
      } finally {
        db.close();
      }
    }
    bytes += file.size;
  }
  onProgress(manifest.files.length, manifest.files.length, 'Loaded');
  return { files: manifest.files.length, bytes };
}
