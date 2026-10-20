import { describe, expect, it } from 'vitest';
import { createVault, fromB64, openVault, seal, toB64, unseal, WrongPassphrase } from '../src/cloud/vault';

// Fewer rounds than the real 600,000 keep the suite fast; the derivation is the same.
const FAST = 310_000;
const USER = '6f1c2d3e-0000-4000-8000-000000000001';

describe('end-to-end encryption', () => {
  it('round-trips a ledger, and every save gets a fresh IV', async () => {
    const { key } = await createVault('correct horse battery', USER, FAST);
    const text = JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => ({ title: `Item ${i}`, notes: 'é ü 中文' })) });
    const a = await seal(key, text, USER, 'ledger');
    const b = await seal(key, text, USER, 'ledger');
    expect(a.iv).not.toBe(b.iv);
    expect(a.cipher).not.toContain('Item');
    expect(await unseal(key, a, USER, 'ledger')).toBe(text);
  });

  it('opens with the right passphrase and refuses a wrong one', async () => {
    const { record } = await createVault('correct horse battery', USER, FAST);
    const key = await openVault('correct horse battery', record, USER);
    expect(key.extractable).toBe(false);
    await expect(openVault('wrong horse battery', record, USER)).rejects.toBeInstanceOf(WrongPassphrase);
  });

  it('will not open a blob moved to another account or another slot', async () => {
    const { key } = await createVault('correct horse battery', USER, FAST);
    const s = await seal(key, 'secret', USER, 'ledger');
    await expect(unseal(key, s, 'someone-else', 'ledger')).rejects.toThrow();
    await expect(unseal(key, s, USER, 'check')).rejects.toThrow();
  });

  it('will not open a ciphertext that was altered', async () => {
    const { key } = await createVault('correct horse battery', USER, FAST);
    const s = await seal(key, 'secret', USER, 'ledger');
    const b = fromB64(s.cipher);
    b[0] ^= 1;
    await expect(unseal(key, { iv: s.iv, cipher: toB64(b) }, USER, 'ledger')).rejects.toThrow();
  });

  it('refuses a short passphrase and a weakened vault', async () => {
    await expect(createVault('short', USER, FAST)).rejects.toThrow(/At least/);
    const { record } = await createVault('correct horse battery', USER, FAST);
    await expect(openVault('correct horse battery', { ...record, iterations: 1000 }, USER)).rejects.toThrow(/too few/);
  });
});
