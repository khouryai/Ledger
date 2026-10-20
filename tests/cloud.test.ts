/**
 * The account as a place to keep the ledger: two devices on one (in-memory) server,
 * through the whole sign-in, saving over each other and merging.
 */
import { describe, expect, it } from 'vitest';
import type { CloudApi } from '../src/cloud/api';
import { CloudStore } from '../src/cloud/cloudStore';
import { FAKE_CODE, FAKE_EMAIL, FakeServer, fakeApi } from '../src/cloud/fakeApi';
import { createVault, openVault } from '../src/cloud/vault';
import { addNote, updateItem } from '../src/engine/ops';
import { add, at, docWith, TODAY } from './helpers';

const PASS = 'a long sign-in password';
const PHRASE = 'correct horse battery';

async function signedIn(api: CloudApi, first: boolean) {
  if (first) await api.signUp(FAKE_EMAIL, PASS);
  else await api.signIn(FAKE_EMAIL, PASS);
  let st = await api.state();
  if (st.kind === 'enrol') {
    const e = await api.enrolTotp();
    await api.verifyTotp(e.factorId, FAKE_CODE);
  } else if (st.kind === 'challenge') await api.verifyTotp(st.factorId, FAKE_CODE);
  st = await api.state();
  if (st.kind !== 'ready') throw new Error(st.kind);
  return st.userId;
}

async function twoDevices() {
  const server = new FakeServer();
  const laptopApi = fakeApi(server);
  const userId = await signedIn(laptopApi, true);
  const { record, key } = await createVault(PHRASE, userId, 310_000);
  await laptopApi.createVault(record);
  const phoneApi = fakeApi(server);
  await signedIn(phoneApi, false);
  const phoneKey = await openVault(PHRASE, (await phoneApi.getVault())!, userId);
  return { server, laptop: new CloudStore(laptopApi, key, userId, 'laptop'), phone: new CloudStore(phoneApi, phoneKey, userId, 'phone') };
}

describe('the ledger in an account', () => {
  it('needs both sign-in steps before anything is readable', async () => {
    const server = new FakeServer();
    const api = fakeApi(server);
    await api.signUp(FAKE_EMAIL, PASS);
    expect((await api.state()).kind).toBe('enrol');
    await expect(api.getLedger()).rejects.toThrow(/row-level security/);
    const e = await api.enrolTotp();
    await expect(api.verifyTotp(e.factorId, '000000')).rejects.toThrow(/Invalid/);
    await api.verifyTotp(e.factorId, FAKE_CODE);
    expect((await api.state()).kind).toBe('ready');
    await api.signOut(false);
    await api.signIn(FAKE_EMAIL, PASS);
    expect((await api.state()).kind).toBe('challenge');
  });

  it('refuses an address that was not invited', async () => {
    await expect(fakeApi(new FakeServer()).signUp('someone@else.com', PASS)).rejects.toThrow(/invitation/);
  });

  it('stores only ciphertext', async () => {
    const { server, laptop } = await twoDevices();
    const doc = add(docWith(), { title: 'Signed TAWR for Saturday' }).doc;
    await laptop.save(doc, TODAY);
    const raw = JSON.stringify(server.data);
    expect(raw).not.toContain('TAWR');
    expect(raw).not.toContain('Sam Lee');
  });

  it('opens on the other device what one device saved', async () => {
    const { laptop, phone } = await twoDevices();
    const doc = add(docWith(), { title: 'ATS report' }).doc;
    await laptop.save(doc, TODAY);
    const r = await phone.load();
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.doc.items[0].title).toBe('ATS report');
  });

  it('merges when both devices saved from the same copy', async () => {
    const { laptop, phone, server } = await twoDevices();
    const base = add(docWith(), { title: 'ATS report' }).doc;
    await laptop.save(base, TODAY);
    const onPhone = await phone.load();
    if (onPhone.kind !== 'ok') throw new Error('load');
    await laptop.load();
    const id = base.items[0].id;
    // The laptop saves first; the phone saved from the older copy.
    expect(await laptop.save(addNote(base, id, 'Called Sam', at(TODAY, 11)), TODAY)).toBeUndefined();
    const before = server.saves;
    const out = await phone.save(updateItem(onPhone.doc, id, { due: '2026-10-20' }, at(TODAY, 12)), TODAY);
    expect(out).toBeDefined();
    expect(server.saves - before).toBe(2);
    const item = out!.doc.items[0];
    expect(item.due).toBe('2026-10-20');
    expect(item.history.some((h) => h.text === 'Called Sam')).toBe(true);
    // And the laptop, reading again, sees both.
    expect(await laptop.changedOutside()).toBe(true);
    const back = await laptop.load();
    if (back.kind !== 'ok') throw new Error('load');
    expect(back.doc.items[0].due).toBe('2026-10-20');
    expect(back.doc.items[0].history.some((h) => h.text === 'Called Sam')).toBe(true);
  });

  it('keeps the start of each day as a backup that opens', async () => {
    const { laptop } = await twoDevices();
    const v1 = add(docWith(), { title: 'First' }).doc;
    await laptop.save(v1, TODAY);
    await laptop.save(add(v1, { title: 'Second' }).doc, '2026-10-16');
    const list = await laptop.listBackups();
    expect(list.map((b) => b.day)).toEqual(['2026-10-16']);
    const back = await laptop.readBackup(list[0].path);
    expect(back.items.map((i) => i.title)).toEqual(['First']);
  });

  it('reports a ledger that will not decrypt instead of overwriting it', async () => {
    const { laptop, server } = await twoDevices();
    await laptop.save(docWith(), TODAY);
    const id = Object.keys(server.data.ledgers)[0];
    server.data.ledgers[id] = { ...server.data.ledgers[id], cipher: server.data.ledgers[id].cipher.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) };
    expect((await laptop.load()).kind).toBe('broken');
  });
});
