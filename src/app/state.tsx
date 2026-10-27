/**
 * The application's state: where the ledger lives, the document itself, saving,
 * undo, and the transient things on screen (the open item, the chase dialog, toasts).
 *
 * Every change is an `Op` from `engine/ops.ts` applied through `apply()`, which keeps
 * the previous document for undo and schedules a save. Nothing writes to the
 * document any other way.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { makeCtx, type Ctx } from '../engine/decide';
import { toDay } from '../engine/dates';
import { emptyDoc } from '../engine/doc';
import { demoDoc } from '../engine/demo';
import type { ChaseLevel, LedgerDoc } from '../engine/types';
import { FileSystemAdapter } from '../storage/fileSystemAdapter';
import { FsaDirectory } from '../storage/fsaDirectory';
import { IndexedDbAdapter } from '../storage/indexedDbAdapter';
import { MemoryAdapter } from '../storage/memoryAdapter';
import { LedgerStore, type DocStore } from '../storage/ledgerStore';
import { mergeDocs } from '../engine/merge';
import { cloudWanted, getCloudApi } from '../cloud';
import { device } from '../cloud/device';
import { isNetworkError, OFFLINE_NOTE } from '../cloud/cloudStore';
import { fsaSupported, loadFolderHandle, pickFolder, queryPermission, requestPermission, saveFolderHandle, forgetFolderHandle } from './folder';

export type Mode = 'folder' | 'browser' | 'memory' | 'cloud';
export type Status = 'loading' | 'setup' | 'reconnect' | 'broken' | 'ready' | 'signin';

export type Toast = { id: number; text: string; kind: 'ok' | 'info' | 'error'; undo?: boolean };

type ChaseRequest = { itemIds: string[]; level?: ChaseLevel };

/** A schedule being changed, an item being made to repeat, or an ended series started again. */
export type ScheduleRequest = { kind: 'edit' | 'start'; itemId: string } | { kind: 'restart'; seriesId: string };

type State = {
  status: Status;
  mode?: Mode;
  where: string;
  doc: LedgerDoc;
  today: string;
  dirty: boolean;
  saving: boolean;
  lastSavedAt?: string;
  saveError?: string;
  problems: string[];
  broken?: { text: string; error: string };
  outside: boolean;
  toast?: Toast;
};

type Ui = {
  openItem: string | null;
  chase: ChaseRequest | null;
  command: boolean;
  schedule: ScheduleRequest | null;
  /** The recurring item being paused. */
  pause: string | null;
  /** The form for a new recurring item is open. */
  newRecurring: boolean;
};

const CLOSED: Ui = { openItem: null, chase: null, command: false, schedule: null, pause: null, newRecurring: false };

/** True while a dialog is over the screen, so a list's single-key shortcuts stand down. */
export function dialogOpen(ui: Ui): boolean {
  return !!(ui.openItem || ui.chase || ui.command || ui.schedule || ui.pause || ui.newRecurring);
}

type Actions = {
  apply: (op: (doc: LedgerDoc) => LedgerDoc, toast?: string | (() => string)) => void;
  undo: () => void;
  canUndo: boolean;
  saveNow: () => Promise<void>;
  chooseFolder: () => Promise<void>;
  /** Put the ledger in use now into a folder; a folder that already has one is opened instead, if the user agrees. */
  moveToFolder: () => Promise<void>;
  useBrowser: () => Promise<void>;
  useMemory: (demo?: boolean) => void;
  reconnect: () => Promise<void>;
  forgetStorage: () => Promise<void>;
  reloadFromDisk: () => Promise<void>;
  keepMine: () => Promise<void>;
  replaceDoc: (doc: LedgerDoc, toast: string) => void;
  store: () => DocStore | null;
  /** The account's ledger is open: called by the sign-in screen once every step is done. */
  openCloud: (store: DocStore, who: string) => Promise<void>;
  /** Sign out here (or on every device), and forget the key and the copy kept here. */
  signOut: (everywhere: boolean) => Promise<void>;
  /** Forget the remembered passphrase here: the next open asks for it. */
  lock: () => Promise<void>;
  toast: (text: string, kind?: Toast['kind']) => void;
  setUi: (patch: Partial<Ui>) => void;
};

type AppValue = { state: State; ctx: Ctx; ui: Ui; actions: Actions };

const AppContext = createContext<AppValue | null>(null);

const MODE_KEY = 'ledger-mode';
const SAVE_DELAY = 400;

function readMode(): Mode | undefined {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === 'folder' || m === 'browser' ? m : undefined;
  } catch {
    return undefined;
  }
}

function writeMode(m: Mode | undefined) {
  try {
    if (m && m !== 'memory' && m !== 'cloud') localStorage.setItem(MODE_KEY, m);
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* storage blocked: the choice is asked again next time */
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(() => ({
    status: 'loading',
    where: '',
    doc: emptyDoc(),
    today: toDay(new Date()),
    dirty: false,
    saving: false,
    problems: [],
    outside: false,
  }));
  const [ui, setUiState] = useState<Ui>(CLOSED);
  const storeRef = useRef<DocStore | null>(null);
  const idbRef = useRef<IndexedDbAdapter | null>(null);
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const undoRef = useRef<LedgerDoc[]>([]);
  const docRef = useRef(state.doc);
  docRef.current = state.doc;
  const stateRef = useRef(state);
  stateRef.current = state;
  const [, setUndoTick] = useState(0);

  const idb = () => (idbRef.current ??= new IndexedDbAdapter());

  // Going to another screen closes whatever was open over the last one.
  useEffect(() => {
    const close = () => setUiState((u) => (dialogOpen(u) ? CLOSED : u));
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok', undo = false) => {
    const id = Date.now() + Math.random();
    setState((s) => ({ ...s, toast: { id, text, kind, undo } }));
    window.setTimeout(() => setState((s) => (s.toast?.id === id ? { ...s, toast: undefined } : s)), undo ? 7000 : 4000);
  }, []);

  const open = useCallback(async (store: DocStore, mode: Mode, where: string) => {
    const r = await store.load();
    storeRef.current = store;
    undoRef.current = [];
    if (r.kind === 'broken') {
      setState((s) => ({ ...s, status: 'broken', mode, where, broken: { text: r.text, error: r.error } }));
      return;
    }
    const doc = r.kind === 'ok' ? r.doc : emptyDoc();
    setState((s) => ({ ...s, status: 'ready', mode, where, doc, problems: r.kind === 'ok' ? r.problems : [], dirty: r.kind === 'empty', broken: undefined, outside: false }));
    writeMode(mode);
  }, []);

  const openFolder = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      handleRef.current = handle;
      const store = new LedgerStore(new FileSystemAdapter(new FsaDirectory(handle), handle.name));
      await open(store, 'folder', handle.name);
    },
    [open],
  );

  // Start-up: test hooks, then whatever was chosen last time.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(location.search);
      // A build with an account opens nothing else: the sign-in screen takes it from here.
      if (cloudWanted()) {
        if (!cancelled) setState((s) => ({ ...s, status: 'signin', mode: 'cloud' }));
        return;
      }
      if (params.has('demo') || params.has('memory')) {
        const store = new LedgerStore(new MemoryAdapter());
        storeRef.current = store;
        if (params.has('demo')) await store.save(demoDoc(), toDay(new Date()));
        if (!cancelled) await open(store, 'memory', 'Not saving');
        return;
      }
      const mode = readMode();
      if (mode === 'browser') {
        await open(new LedgerStore(idb()), 'browser', 'This browser');
        return;
      }
      if (mode === 'folder' && fsaSupported()) {
        const handle = await loadFolderHandle(idb()).catch(() => undefined);
        if (handle) {
          handleRef.current = handle;
          let perm = await queryPermission(handle);
          if (perm !== 'granted') perm = await requestPermission(handle);
          if (perm === 'granted') {
            await openFolder(handle);
            return;
          }
          if (!cancelled) setState((s) => ({ ...s, status: 'reconnect', mode: 'folder', where: handle.name }));
          return;
        }
      }
      if (!cancelled) setState((s) => ({ ...s, status: 'setup' }));
    })().catch((err) => {
      if (!cancelled) setState((s) => ({ ...s, status: 'setup', saveError: (err as Error).message }));
    });
    return () => {
      cancelled = true;
    };
  }, [open, openFolder]);

  // Saving: a moment after the last change.
  const savingRef = useRef(false);
  const save = useCallback(async () => {
    const store = storeRef.current;
    if (!store || savingRef.current) return;
    savingRef.current = true;
    const doc = docRef.current;
    setState((s) => ({ ...s, saving: true }));
    try {
      const out = await store.save(doc, toDay(new Date()));
      const ok = { saving: false, lastSavedAt: new Date().toISOString(), saveError: undefined };
      if (out) {
        // The other device had saved: its changes are merged in. Anything typed here
        // while that happened is merged on top, and saved next.
        const cur = docRef.current;
        const next = cur === doc ? out.doc : mergeDocs(doc, cur, out.doc, new Date()).doc;
        docRef.current = next;
        // Undo would step back over the other device's changes as well; it starts again.
        undoRef.current = [];
        setUndoTick((n) => n + 1);
        setState((s) => ({ ...s, ...ok, doc: next, dirty: next !== out.doc, problems: s.problems.filter((p) => p !== OFFLINE_NOTE) }));
        const bits = [out.clashes ? `${out.clashes} ${out.clashes === 1 ? 'change was' : 'changes were'} made on both, and yours kept` : '', out.renumbered ? `${out.renumbered} new ${out.renumbered === 1 ? 'item was' : 'items were'} renumbered` : '']
          .filter(Boolean)
          .join('; ');
        toast(`Brought in what changed on your other device${bits ? `: ${bits}` : ''}.`, 'info');
      } else setState((s) => ({ ...s, ...ok, dirty: s.doc !== doc, problems: s.problems.filter((p) => p !== OFFLINE_NOTE) }));
    } catch (err) {
      const msg = isNetworkError(err) ? 'No connection. Your changes are kept here and saved when it is back.' : (err as Error).message;
      setState((s) => ({ ...s, saving: false, saveError: msg }));
    } finally {
      savingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (state.status !== 'ready' || !state.dirty || state.saving || state.outside) return;
    const t = window.setTimeout(() => void save(), SAVE_DELAY);
    return () => window.clearTimeout(t);
  }, [state.status, state.dirty, state.saving, state.doc, state.outside, save]);

  // A save that failed (no signal) is tried again when the connection is back, and
  // every half minute meanwhile.
  useEffect(() => {
    if (state.status !== 'ready' || !state.dirty || !state.saveError || state.saving) return;
    const retry = () => void save();
    const t = window.setTimeout(retry, 30_000);
    window.addEventListener('online', retry);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('online', retry);
    };
  }, [state.status, state.dirty, state.saveError, state.saving, save]);

  // Unsaved work is never lost to a closed window without a warning.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (state.dirty && state.mode !== 'memory') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [state.dirty, state.mode]);

  // The day turns over, and the file may have been changed from elsewhere.
  useEffect(() => {
    const tick = () => setState((s) => (s.today === toDay(new Date()) ? s : { ...s, today: toDay(new Date()) }));
    const onFocus = async () => {
      tick();
      const store = storeRef.current;
      if (!store || state.status !== 'ready' || state.mode === 'memory') return;
      try {
        if (!(await store.changedOutside())) return;
        if (state.mode === 'cloud') {
          // The other device saved. With nothing unsaved here, show its ledger; with
          // something unsaved, saving merges the two.
          if (state.dirty) {
            void save();
            return;
          }
          const r = await store.load();
          if (r.kind === 'ok' && docRef.current === state.doc) {
            undoRef.current = [];
            docRef.current = r.doc;
            setState((s) => ({ ...s, doc: r.doc, problems: r.problems }));
          }
          return;
        }
        if (!state.dirty) {
          const r = await store.load();
          if (r.kind === 'ok') {
            undoRef.current = [];
            setState((s) => ({ ...s, doc: r.doc, problems: r.problems }));
            toast('The ledger file changed outside this window, so it was reloaded.', 'info');
          }
        } else setState((s) => ({ ...s, outside: true }));
      } catch {
        /* a folder that cannot be read right now is reported on the next save */
      }
    };
    // A phone rarely fires focus: coming back to the app is a visibility change. The
    // account is also checked every minute while the app is on screen.
    const onShow = () => document.visibilityState === 'visible' && void onFocus();
    const id = window.setInterval(() => {
      tick();
      if (state.mode === 'cloud' && document.visibilityState === 'visible') void onFocus();
    }, 60_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [state.status, state.mode, state.dirty, state.doc, save, toast]);

  // Signed out somewhere else (Sign out everywhere, a password change): back to sign-in.
  useEffect(() => {
    if (state.mode !== 'cloud' || state.status !== 'ready') return;
    let off: (() => void) | undefined;
    let live = true;
    void getCloudApi().then((api) => {
      if (!live) return;
      off = api.onChange(() => {
        void api.state().then((st) => {
          if (st.kind !== 'ready') {
            storeRef.current = null;
            undoRef.current = [];
            setState((s) => ({ ...s, status: 'signin', doc: emptyDoc(), dirty: false, problems: [] }));
          }
        });
      });
    });
    return () => {
      live = false;
      off?.();
    };
  }, [state.mode, state.status]);

  const apply = useCallback(
    (op: (doc: LedgerDoc) => LedgerDoc, message?: string | (() => string)) => {
      let next: LedgerDoc;
      try {
        next = op(docRef.current);
      } catch (err) {
        toast((err as Error).message, 'error');
        return;
      }
      if (next === docRef.current) return;
      undoRef.current = [...undoRef.current.slice(-49), docRef.current];
      docRef.current = next;
      setUndoTick((n) => n + 1);
      setState((s) => ({ ...s, doc: next, dirty: true }));
      if (message) toast(typeof message === 'function' ? message() : message, 'ok', true);
    },
    [toast],
  );

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    docRef.current = prev;
    setUndoTick((n) => n + 1);
    setState((s) => ({ ...s, doc: prev, dirty: true, toast: { id: Date.now(), text: 'Undone.', kind: 'info' } }));
  }, []);

  const actions: Actions = useMemo(
    () => ({
      apply,
      undo,
      get canUndo() {
        return undoRef.current.length > 0;
      },
      saveNow: save,
      chooseFolder: async () => {
        const handle = await pickFolder();
        await saveFolderHandle(idb(), handle);
        await openFolder(handle);
      },
      moveToFolder: async () => {
        const handle = await pickFolder();
        const store = new LedgerStore(new FileSystemAdapter(new FsaDirectory(handle), handle.name));
        const there = await store.load();
        if (there.kind !== 'empty') {
          const n = there.kind === 'ok' ? `${there.doc.items.length} items` : 'a file that will not read';
          if (!window.confirm(`"${handle.name}" already has a ledger (${n}). Open that one instead? Yours stays where it is.`)) return;
          await saveFolderHandle(idb(), handle);
          await openFolder(handle);
          return;
        }
        await store.save(docRef.current, toDay(new Date()));
        await saveFolderHandle(idb(), handle);
        await openFolder(handle);
        toast(`Your ledger is now in "${handle.name}".`, 'ok');
      },
      useBrowser: async () => {
        await open(new LedgerStore(idb()), 'browser', 'This browser');
      },
      useMemory: (demo = false) => {
        const store = new LedgerStore(new MemoryAdapter());
        storeRef.current = store;
        const doc = demo ? demoDoc() : emptyDoc();
        undoRef.current = [];
        setState((s) => ({ ...s, status: 'ready', mode: 'memory', where: 'Not saving', doc, dirty: false, problems: [] }));
        writeMode(undefined);
      },
      reconnect: async () => {
        const h = handleRef.current;
        if (!h) return;
        const perm = await requestPermission(h);
        if (perm === 'granted') await openFolder(h);
        else toast('The folder was not opened. Choose it again if it has moved.', 'error');
      },
      forgetStorage: async () => {
        await forgetFolderHandle(idb()).catch(() => undefined);
        writeMode(undefined);
        storeRef.current = null;
        handleRef.current = null;
        setState((s) => ({ ...s, status: 'setup', mode: undefined, where: '', doc: emptyDoc(), dirty: false }));
      },
      reloadFromDisk: async () => {
        const store = storeRef.current;
        if (!store) return;
        const r = await store.load();
        if (r.kind === 'ok') {
          undoRef.current = [];
          setState((s) => ({ ...s, doc: r.doc, problems: r.problems, dirty: false, outside: false }));
          toast('Reloaded from the file.', 'info');
        }
      },
      keepMine: async () => {
        setState((s) => ({ ...s, outside: false }));
        await save();
      },
      replaceDoc: (doc: LedgerDoc, message: string) => {
        undoRef.current = [...undoRef.current.slice(-49), docRef.current];
        docRef.current = doc;
        setState((s) => ({ ...s, doc, dirty: true, status: 'ready', broken: undefined }));
        toast(message, 'ok', true);
      },
      store: () => storeRef.current,
      openCloud: async (store: DocStore, who: string) => {
        await open(store, 'cloud', who);
      },
      signOut: async (everywhere: boolean) => {
        if (stateRef.current.dirty && !window.confirm('Some changes have not reached your account yet, and signing out loses them. Sign out anyway?')) return;
        const api = await getCloudApi();
        await api.signOut(everywhere).catch(() => undefined);
        await device.clear();
        storeRef.current = null;
        undoRef.current = [];
        setState((s) => ({ ...s, status: 'signin', doc: emptyDoc(), dirty: false, problems: [], saveError: undefined }));
      },
      lock: async () => {
        if (stateRef.current.dirty) await save();
        await device.clear();
        storeRef.current = null;
        undoRef.current = [];
        setState((s) => ({ ...s, status: 'signin', doc: emptyDoc(), dirty: false, problems: [] }));
      },
      toast: (text: string, kind?: Toast['kind']) => toast(text, kind),
      setUi: (patch: Partial<Ui>) => setUiState((u) => ({ ...u, ...patch })),
    }),
    [apply, undo, save, open, openFolder, toast],
  );

  const ctx = useMemo(() => makeCtx(state.doc, state.today), [state.doc, state.today]);

  return <AppContext.Provider value={{ state, ctx, ui, actions }}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
