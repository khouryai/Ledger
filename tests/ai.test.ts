import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../src/ai/fake';
import { checkActions, checkReply, chunks, extractActions, writeChaser } from '../src/ai/tasks';
import { parseJsonAnswer } from '../src/ai/engine';
import { checkReplyRules } from '../src/engine/reply';
import { add, docWith, pid, TODAY } from './helpers';

const doc = docWith(['Sam Lee', 'Priya Shah']);
const ctx = { today: TODAY, cal: { workDays: [1, 2, 3, 4, 5], holidays: [] }, order: 'MDY' as const, people: doc.people, myName: 'Alex Khoury' };

describe('checking what the model says', () => {
  it('works dates out itself and flags a quote it cannot find', () => {
    const text = 'Sam: could you send the cable schedule by next Tuesday?';
    const asks = checkActions(
      [
        { direction: 'owe', person: 'Sam', title: 'Send the cable schedule', when: 'by next Tuesday', quote: 'could you send the cable schedule by next Tuesday?' },
        { direction: 'wait', person: 'Morgan', title: 'Invented thing', when: '', quote: 'Something not in the text' },
        { direction: 'owe', person: '', title: 'send the cable schedule', when: '', quote: 'dup' },
      ],
      text,
      ctx,
    );
    expect(asks.length).toBe(2);
    expect(asks[0]).toMatchObject({ kind: 'ai', direction: 'owe', due: '2026-10-20', quoteFound: true });
    expect(asks[0].match).toMatchObject({ kind: 'one', person: { name: 'Sam Lee' } });
    expect(asks[1]).toMatchObject({ quoteFound: false });
    expect(asks[1].match?.kind).toBe('none');
  });
  it('never takes the reader for the other person', () => {
    const [a] = checkActions([{ direction: 'owe', person: 'Alex', title: 'Book the room', when: '', quote: '' }], 'x', ctx);
    expect(a.personName).toBeUndefined();
  });
  it('reads JSON out of fences and preamble', () => {
    expect(parseJsonAnswer<{ a: number }>('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonAnswer('no json here')).toThrow();
  });
  it('splits long text into pieces the model can hold', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'word '.repeat(60)}`).join('\n\n');
    const parts = chunks(text, 2000);
    expect(parts.length).toBeGreaterThanOrEqual(5);
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
    expect(parts.join('\n\n')).toBe(text);
  });
});

describe('the pipeline, with the stand-in model', () => {
  it('extracts actions from an email', async () => {
    const engine = new FakeEngine({ myName: 'Alex Khoury', today: TODAY });
    const asks = await extractActions(engine, "Hi Alex, could you please send the IXL test plan by Friday? I'll send the cable schedule next Tuesday.", ctx, { fromMe: false, sender: 'Sam Lee' });
    expect(asks.map((a) => [a.direction, a.title, a.due])).toEqual([
      ['owe', 'Send the IXL test plan', '2026-10-16'],
      ['wait', 'Send the cable schedule', '2026-10-20'],
    ]);
    expect(engine.calls[0].system).toContain('written by Sam Lee to Alex Khoury');
  });
  it('writes a chaser and strips any subject line', async () => {
    const { doc: d2, item } = add(doc, { title: 'ATS report', personId: pid(doc, 'Sam') });
    const p = d2.people.find((x) => x.id === item.personId);
    const body = await writeChaser(new FakeEngine({ myName: 'Alex Khoury' }), [item], p, 'firm', ctx);
    expect(body).toContain('Hi Sam');
    expect(body).toContain('ATS report');
  });
  it('checks a reply, keeping only a date that is in the reply', async () => {
    const { item } = add(doc, { title: 'ATS report' });
    const r = await checkReply(new FakeEngine({ today: TODAY }), item, 'Sorry, running behind, will have it to you next Wednesday.', ctx);
    expect(r).toMatchObject({ verdict: 'stall', promise: '2026-10-21', by: 'ai' });
  });
});

describe('reply rules', () => {
  const cal = ctx.cal;
  it('reads delivered, partial, stall and unclear', () => {
    expect(checkReplyRules('Please find attached the report.', TODAY, cal, 'MDY').verdict).toBe('delivered');
    expect(checkReplyRules('Attached is part of it, the rest to come.', TODAY, cal, 'MDY').verdict).toBe('partial');
    expect(checkReplyRules("I'll get it to you by 10/22.", TODAY, cal, 'MDY')).toMatchObject({ verdict: 'stall', promise: '2026-10-22' });
    expect(checkReplyRules('Noted.', TODAY, cal, 'MDY').verdict).toBe('unclear');
  });
});

describe('when the model will not download', () => {
  it('tells a blocked network from a full disk from a refusing cache', async () => {
    const { explainLoadError, shouldRetryOnIndexedDb } = await import('../src/ai/download');
    const blocked = explainLoadError(new TypeError('Failed to fetch'), 2200);
    expect(blocked.kind).toBe('blocked');
    expect(blocked.message).toMatch(/another network/);
    expect(shouldRetryOnIndexedDb(blocked, 'cache')).toBe(false);

    const full = explainLoadError(Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' }), 2200);
    expect(full.kind).toBe('space');
    expect(full.message).toMatch(/2\.1 GB/);
    expect(shouldRetryOnIndexedDb(full, 'cache')).toBe(false);

    // WebLLM's own error when Cache.add() fails: the network worked (it was checked
    // first), so the other storage is tried, once.
    const cache = explainLoadError(new TypeError("Failed to execute 'add' on 'Cache': Cache.add() encountered a network error"), 2200);
    expect(cache.kind).toBe('storage');
    expect(shouldRetryOnIndexedDb(cache, 'cache')).toBe(true);
    expect(shouldRetryOnIndexedDb(cache, 'indexeddb')).toBe(false);
    expect(cache.detail).toContain('Cache.add()');
  });

  it('refuses before downloading when the space is plainly not there', async () => {
    const { freeMB, spaceProblem } = await import('../src/ai/download');
    expect(freeMB(undefined)).toBeNull();
    expect(spaceProblem(null, 2200)).toBeNull();
    const free = freeMB({ quota: 1024 * 1048576, usage: 0 });
    expect(free).toBe(1024);
    expect(spaceProblem(free, 2200)).toMatch(/about 1\.0 GB free .* about 2\.1 GB/);
    expect(spaceProblem(10_000, 2200)).toBeNull();
  });
});

describe('a model saved to a folder', () => {
  const u = {
    id: 'Phi-4-mini-instruct-q4f16_1-MLC',
    model: 'https://huggingface.co/mlc-ai/Phi-4-mini-instruct-q4f16_1-MLC',
    base: 'https://huggingface.co/mlc-ai/Phi-4-mini-instruct-q4f16_1-MLC/resolve/main/',
    lib: 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_86/base/Phi-4-mini-instruct-q4f16_1_cs1k-webgpu.wasm',
  };
  const ok = (extra: object[] = []) => ({
    kind: 'ledger-model',
    version: 1,
    model: u.id,
    savedAt: '2026-10-22T00:00:00Z',
    files: [
      { scope: 'webllm/model', url: `${u.base}tensor-cache.json`, path: 'model/tensor-cache.json', bytes: 10 },
      { scope: 'webllm/model', url: `${u.base}params_shard_0.bin`, path: 'model/params_shard_0.bin', bytes: 10 },
      { scope: 'webllm/wasm', url: u.lib, path: 'wasm/x.wasm', bytes: 10 },
      ...extra,
    ],
  });

  it('files each piece under the address WebLLM reads it from', async () => {
    const { modelBase, pathFor, belongs } = await import('../src/ai/modelFolder');
    expect(modelBase(u.model)).toBe(u.base);
    expect(modelBase(`${u.model}/`)).toBe(u.base);
    expect(pathFor('webllm/model', `${u.base}params_shard_3.bin`, u)).toBe('model/params_shard_3.bin');
    expect(pathFor('webllm/wasm', u.lib, u)).toBe('wasm/Phi-4-mini-instruct-q4f16_1_cs1k-webgpu.wasm');
    expect(belongs(`${u.base}tokenizer.json`, u)).toBe(true);
    expect(belongs('https://huggingface.co/mlc-ai/Other-Model/resolve/main/tokenizer.json', u)).toBe(false);
  });

  it('loads only this model, and only at its own addresses', async () => {
    const { checkManifest } = await import('../src/ai/modelFolder');
    expect(checkManifest(ok(), u).files).toHaveLength(3);
    expect(() => checkManifest({ ...ok(), model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC' }, u)).toThrow(/holds Llama/);
    // A folder cannot plant a file anywhere else: not another site, not another model.
    expect(() => checkManifest(ok([{ scope: 'webllm/model', url: 'https://evil.example/x.js', path: 'model/x', bytes: 1 }]), u)).toThrow(/does not belong/);
    expect(() => checkManifest(ok([{ scope: 'webllm/model', url: `${u.base}../../../Other/x`, path: 'model/x', bytes: 1 }]), u)).toThrow(/does not belong/);
    expect(() => checkManifest(ok([{ scope: 'webllm/model', url: `${u.base}a.bin`, path: 'model/../../a.bin', bytes: 1 }]), u)).toThrow(/damaged/);
    expect(() => checkManifest({ ...ok(), files: ok().files.slice(1) }, u)).toThrow(/tensor-cache/);
    expect(() => checkManifest({ hello: 1 }, u)).toThrow(/no ledger-model\.json/);
  });
});
