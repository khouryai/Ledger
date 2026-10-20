/**
 * End-to-end encryption. The ledger is encrypted on the device before it is sent,
 * and decrypted on the device after it is read: Supabase stores, and anyone with
 * access to the database sees, only ciphertext.
 *
 * - The key is derived from a passphrase the user chooses (PBKDF2, SHA-256,
 *   600,000 iterations, a random 16-byte salt per account): OWASP's 2023 figure for
 *   PBKDF2-HMAC-SHA256. It is a different secret from the sign-in password, which
 *   Supabase does see, so a compromised account still cannot read the ledger.
 * - The ledger is gzipped, then sealed with AES-256-GCM and a fresh random 12-byte
 *   IV on every save. GCM authenticates: a ciphertext that was altered, or swapped
 *   for another account's, fails to open instead of decrypting to rubbish.
 * - What it is (`ledger`, `check`) and whose it is (the account id) are bound in as
 *   additional data, so a blob cannot be moved between accounts or between slots.
 * - The vault stores the salt and a sealed known value, so a wrong passphrase is
 *   reported as wrong instead of producing an unreadable ledger.
 * - The derived key is a non-extractable CryptoKey: script on the page can use it
 *   but cannot read its bytes out.
 *
 * Forget the passphrase and the ledger cannot be recovered by anyone. That is the
 * point; Settings offers a plain download of the whole ledger for that reason.
 *
 * Pure WebCrypto (browser and Node both have it): no I/O, tested in Node.
 */
export const KDF_ITERATIONS = 600_000;
/** Lower than this is refused when reading a vault: it would be a downgrade. */
export const MIN_ITERATIONS = 310_000;
export const MIN_PASSPHRASE = 10;
const FORMAT = 'ledger/v1';
const CHECK = 'ledger-key-check';

export type VaultRecord = { salt: string; iterations: number; check_iv: string; check_cipher: string };
export type Sealed = { iv: string; cipher: string };
export type Slot = 'ledger' | 'check';

export class WrongPassphrase extends Error {
  constructor() {
    super('That passphrase does not open this ledger.');
    this.name = 'WrongPassphrase';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Copies into a fresh ArrayBuffer-backed array, which is what WebCrypto's types want. */
function bytes(b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(b.byteLength));
  out.set(b);
  return out;
}

export function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function random(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes(data)]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const gzip = (b: Uint8Array) => pipe(b, new CompressionStream('gzip'));
const gunzip = (b: Uint8Array) => pipe(b, new DecompressionStream('gzip'));

function aad(userId: string, slot: Slot): Uint8Array<ArrayBuffer> {
  return bytes(enc.encode(`${FORMAT}|${userId}|${slot}`));
}

export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', bytes(enc.encode(passphrase.normalize('NFC'))), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, text: string, userId: string, slot: Slot): Promise<Sealed> {
  const iv = random(12);
  const plain = bytes(await gzip(enc.encode(text)));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(userId, slot) }, key, plain));
  return { iv: toB64(iv), cipher: toB64(cipher) };
}

export async function unseal(key: CryptoKey, s: Sealed, userId: string, slot: Slot): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(s.iv), additionalData: aad(userId, slot) }, key, fromB64(s.cipher));
  return dec.decode(await gunzip(new Uint8Array(plain)));
}

export function passphraseProblem(p: string): string | null {
  if (p.length < MIN_PASSPHRASE) return `At least ${MIN_PASSPHRASE} characters. A few unrelated words is easiest to remember.`;
  if (/^(.)\1+$/.test(p)) return 'Not one character repeated.';
  return null;
}

/** A new vault for an account: the record to store, and the key to use now. */
export async function createVault(passphrase: string, userId: string, iterations = KDF_ITERATIONS): Promise<{ record: VaultRecord; key: CryptoKey }> {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const salt = random(16);
  const key = await deriveKey(passphrase, salt, iterations);
  const check = await seal(key, CHECK, userId, 'check');
  return { record: { salt: toB64(salt), iterations, check_iv: check.iv, check_cipher: check.cipher }, key };
}

/** The key for an existing vault, or WrongPassphrase. */
export async function openVault(passphrase: string, record: VaultRecord, userId: string): Promise<CryptoKey> {
  if (!(record.iterations >= MIN_ITERATIONS)) throw new Error('This vault uses too few key-derivation rounds to be trusted.');
  const key = await deriveKey(passphrase, fromB64(record.salt), record.iterations);
  try {
    if ((await unseal(key, { iv: record.check_iv, cipher: record.check_cipher }, userId, 'check')) === CHECK) return key;
  } catch {
    /* falls through */
  }
  throw new WrongPassphrase();
}
