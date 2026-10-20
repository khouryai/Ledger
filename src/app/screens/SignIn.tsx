/**
 * Signing in to the hosted app, in three steps, every one required:
 *
 *   1. Password       the account (Supabase Auth). Sign-up is by invitation: the
 *                     database refuses any address that is not a member.
 *   2. Authenticator  a six-digit code from an authenticator app (TOTP). Until it is
 *                     given, the database shows this account nothing, whatever the
 *                     password: row-level security requires the session's aal2.
 *   3. Passphrase     the key the ledger is encrypted with on this device. Supabase
 *                     never sees it. Remembered on this device if asked to.
 *
 * Each screen says what it is for in one line, and errors say what to do.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { friendly, MIN_PASSWORD, passwordProblem, type AuthState, type CloudApi, type Enrolment } from '../../cloud/api';
import { getCloudApi } from '../../cloud';
import { CloudStore } from '../../cloud/cloudStore';
import { device, deviceName } from '../../cloud/device';
import { createVault, MIN_PASSPHRASE, openVault, passphraseProblem, type VaultRecord } from '../../cloud/vault';
import { Icon, LogoMark } from '../components/icons';
import { useApp } from '../state';

type View = 'signin' | 'signup' | 'reset';

export function SignIn() {
  const { actions } = useApp();
  const [api, setApi] = useState<CloudApi | null>(null);
  const [st, setSt] = useState<AuthState | null>(null);
  /** undefined while not yet asked; null when the account has no vault yet. */
  const [vault, setVault] = useState<VaultRecord | null | undefined>(undefined);
  const [view, setView] = useState<View>('signin');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const finish = useCallback(
    async (a: CloudApi, s: Extract<AuthState, { kind: 'ready' }>, key: CryptoKey) => {
      const store = new CloudStore(a, key, s.userId, deviceName(), { get: () => device.getRow(s.userId), put: (r) => device.putRow(s.userId, r) });
      await actions.openCloud(store, s.email);
    },
    [actions],
  );

  const refresh = useCallback(
    async (a: CloudApi) => {
      const s = await a.state();
      setSt(s);
      if (s.kind !== 'ready') return;
      // A key remembered here opens straight away, with or without a connection.
      const key = await device.getKey(s.userId);
      if (key) return finish(a, s, key);
      setVault(await a.getVault());
    },
    [finish],
  );

  useEffect(() => {
    let live = true;
    void getCloudApi()
      .then(async (a) => {
        if (!live) return;
        setApi(a);
        await refresh(a);
      })
      .catch((e) => live && setErr(friendly(e)));
    return () => {
      live = false;
    };
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const step = !st || st.kind === 'signed-out' || st.kind === 'recovery' ? 1 : st.kind === 'enrol' || st.kind === 'challenge' ? 2 : 3;
  let body: React.ReactNode;
  if (!api || !st) body = <p className="auth-sub">Opening…</p>;
  else if (st.kind === 'signed-out') {
    body =
      view === 'signin' ? (
        <SignInForm busy={busy} onSubmit={(e, p) => run(async () => (await api.signIn(e, p), await refresh(api)))} onView={(v) => (setView(v), setErr(null), setNote(null))} />
      ) : view === 'signup' ? (
        <SignUpForm
          busy={busy}
          note={note}
          onSubmit={(e, p) =>
            run(async () => {
              const r = await api.signUp(e, p);
              if (r === 'confirm') setNote(`A link to confirm ${e} is on its way. Open it in this browser to carry on.`);
              else await refresh(api);
            })
          }
          onBack={() => (setView('signin'), setErr(null), setNote(null))}
        />
      ) : (
        <ResetForm
          busy={busy}
          note={note}
          onSubmit={(e) =>
            run(async () => {
              await api.sendReset(e);
              setNote(`If ${e} has an account, a link to choose a new password is on its way. Open it in this browser.`);
            })
          }
          onBack={() => (setView('signin'), setErr(null), setNote(null))}
        />
      );
  } else if (st.kind === 'recovery') {
    body = <NewPassword busy={busy} email={st.email} onSubmit={(p) => run(async () => (await api.setPassword(p), await refresh(api)))} />;
  } else if (st.kind === 'enrol') {
    body = <Enrol api={api} busy={busy} run={run} onDone={() => refresh(api)} onSignOut={() => run(async () => (await api.signOut(false), await refresh(api)))} />;
  } else if (st.kind === 'challenge') {
    body = (
      <Challenge
        busy={busy}
        email={st.email}
        onSubmit={(code) => run(async () => (await api.verifyTotp(st.factorId, code), await refresh(api)))}
        onSignOut={() => run(async () => (await api.signOut(false), await refresh(api)))}
      />
    );
  } else if (vault === undefined) body = <p className="auth-sub">Opening…</p>;
  else
    body = (
      <Passphrase
        busy={busy}
        fresh={vault === null}
        onSubmit={(phrase, remember) =>
          run(async () => {
            let key: CryptoKey;
            if (vault === null) {
              const v = await createVault(phrase, st.userId);
              await api.createVault(v.record);
              key = v.key;
            } else key = await openVault(phrase, vault, st.userId);
            if (remember) await device.putKey(st.userId, key);
            await finish(api, st, key);
          })
        }
        onSignOut={() => run(async () => (await api.signOut(false), await device.clear(), setVault(undefined), await refresh(api)))}
      />
    );

  return (
    <div className="setup">
      <main className="auth-card" aria-labelledby="auth-title">
        <div className="flex items-center gap-3">
          <LogoMark size={34} />
          <div>
            <div className="eyebrow">Ledger</div>
            <div className="auth-brand">What I owe, and what I am owed</div>
          </div>
        </div>
        <ol className="auth-steps" aria-label="Signing in">
          {['Password', 'Authenticator', 'Passphrase'].map((t, i) => (
            <li key={t} className={i + 1 < step ? 'is-done' : i + 1 === step ? 'is-on' : ''} aria-current={i + 1 === step ? 'step' : undefined}>
              <span className="auth-step-n">{i + 1 < step ? <Icon name="check" size={11} /> : i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
        {body}
        {err && (
          <div className="notice notice-error mt-3" role="alert">
            {err}
          </div>
        )}
        <p className="auth-foot">
          <Icon name="shield" size={14} /> Encrypted on your device before it is sent. Only your account, with its authenticator code, can fetch it, and only your passphrase can read it.
        </p>
      </main>
    </div>
  );
}

function Secret({ label, value, onChange, autoComplete, autoFocus, testid, hint }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean; testid?: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field block">
      <span className="field-l">{label}</span>
      <span className="secret">
        <input
          className="input w-full"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="none"
          data-testid={testid}
        />
        <button type="button" className="secret-eye" onClick={() => setShow((v) => !v)} aria-label={show ? `Hide the ${label.toLowerCase()}` : `Show the ${label.toLowerCase()}`} aria-pressed={show}>
          <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
        </button>
      </span>
      {hint && <span className="form-hint">{hint}</span>}
    </label>
  );
}

function Email({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="field block">
      <span className="field-l">Email</span>
      <input className="input w-full" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} data-testid="auth-email" />
    </label>
  );
}

function SignInForm({ busy, onSubmit, onView }: { busy: boolean; onSubmit: (email: string, password: string) => void; onView: (v: View) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  return (
    <form
      className="mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim() && pw) onSubmit(email, pw);
      }}
    >
      <h1 className="auth-title" id="auth-title">
        Sign in
      </h1>
      <p className="auth-sub">Your ledger, on this device and your others.</p>
      <Email value={email} onChange={setEmail} autoFocus />
      <Secret label="Password" value={pw} onChange={setPw} autoComplete="current-password" testid="auth-password" />
      <button type="submit" className="btn btn-primary auth-go" disabled={busy || !email.trim() || !pw} data-testid="auth-signin">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <div className="auth-links">
        <button type="button" className="link" onClick={() => onView('reset')}>
          Forgot the password
        </button>
        <button type="button" className="link" onClick={() => onView('signup')} data-testid="auth-to-signup">
          First time: create the account
        </button>
      </div>
    </form>
  );
}

function SignUpForm({ busy, note, onSubmit, onBack }: { busy: boolean; note: string | null; onSubmit: (email: string, password: string) => void; onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const problem = pw ? passwordProblem(pw) : null;
  const mismatch = again && again !== pw ? 'The two passwords differ.' : null;
  return (
    <form
      className="mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && !mismatch && pw === again) onSubmit(email, pw);
      }}
    >
      <h1 className="auth-title" id="auth-title">
        Create the account
      </h1>
      <p className="auth-sub">Only an address that has been invited can have one. Anything else is refused.</p>
      {note ? (
        <div className="notice notice-info">{note}</div>
      ) : (
        <>
          <Email value={email} onChange={setEmail} autoFocus />
          <Secret label="Password" value={pw} onChange={setPw} autoComplete="new-password" testid="auth-password" hint={problem ?? `${MIN_PASSWORD} characters or more. A password manager's is best.`} />
          <Secret label="The same again" value={again} onChange={setAgain} autoComplete="new-password" testid="auth-password-again" hint={mismatch ?? undefined} />
          <button type="submit" className="btn btn-primary auth-go" disabled={busy || !email.trim() || !!problem || !pw || pw !== again} data-testid="auth-signup">
            {busy ? 'Creating…' : 'Create the account'}
          </button>
        </>
      )}
      <div className="auth-links">
        <button type="button" className="link" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    </form>
  );
}

function ResetForm({ busy, note, onSubmit, onBack }: { busy: boolean; note: string | null; onSubmit: (email: string) => void; onBack: () => void }) {
  const [email, setEmail] = useState('');
  return (
    <form
      className="mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim()) onSubmit(email);
      }}
    >
      <h1 className="auth-title" id="auth-title">
        Choose a new password
      </h1>
      <p className="auth-sub">A link is emailed to you. Your authenticator and passphrase stay as they are; a new password does not open the ledger without them.</p>
      {note ? (
        <div className="notice notice-info">{note}</div>
      ) : (
        <>
          <Email value={email} onChange={setEmail} autoFocus />
          <button type="submit" className="btn btn-primary auth-go" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Email me a link'}
          </button>
        </>
      )}
      <div className="auth-links">
        <button type="button" className="link" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    </form>
  );
}

function NewPassword({ busy, email, onSubmit }: { busy: boolean; email: string; onSubmit: (p: string) => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const problem = pw ? passwordProblem(pw) : null;
  return (
    <form
      className="mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && pw === again) onSubmit(pw);
      }}
    >
      <h1 className="auth-title" id="auth-title">
        New password
      </h1>
      <p className="auth-sub">For {email}.</p>
      <Secret label="New password" value={pw} onChange={setPw} autoComplete="new-password" autoFocus hint={problem ?? `${MIN_PASSWORD} characters or more.`} />
      <Secret label="The same again" value={again} onChange={setAgain} autoComplete="new-password" hint={again && again !== pw ? 'The two passwords differ.' : undefined} />
      <button type="submit" className="btn btn-primary auth-go" disabled={busy || !!problem || !pw || pw !== again}>
        {busy ? 'Saving…' : 'Save the new password'}
      </button>
    </form>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field block">
      <span className="field-l">Six-digit code</span>
      <input
        className="input auth-code w-full"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
        autoFocus
        data-testid="auth-code"
      />
    </label>
  );
}

function Enrol({ api, busy, run, onDone, onSignOut }: { api: CloudApi; busy: boolean; run: (fn: () => Promise<void>) => Promise<void>; onDone: () => Promise<void>; onSignOut: () => void }) {
  const [en, setEn] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run(async () => setEn(await api.enrolTotp()));
  }, [api, run]);
  return (
    <form
      className="mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (en && code.length === 6) void run(async () => (await api.verifyTotp(en.factorId, code), await onDone()));
      }}
    >
      <h1 className="auth-title" id="auth-title">
        Add an authenticator
      </h1>
      <p className="auth-sub">
        Every sign-in will also need a code from an app on your phone, so a stolen password is not enough. Use Microsoft Authenticator, Google Authenticator or your password manager.
      </p>
      {en ? (
        <>
          <ol className="auth-howto">
            <li>In the app, add an account and scan this code.</li>
            <li>Type the six digits it then shows.</li>
          </ol>
          <div className="auth-qr">
            <img src={en.qr} alt="QR code for your authenticator app" width={168} height={168} />
          </div>
          <details className="auth-secret">
            <summary>Cannot scan? Type this key instead</summary>
            <code data-testid="auth-secret">{en.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          </details>
          <CodeInput value={code} onChange={setCode} />
          <button type="submit" className="btn btn-primary auth-go" disabled={busy || code.length !== 6} data-testid="auth-verify">
            {busy ? 'Checking…' : 'Turn it on'}
          </button>
        </>
      ) : (
        <p className="auth-sub">{busy ? 'Preparing…' : ''}</p>
      )}
      <div className="auth-links">
        <button type="button" className="link" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </form>
  );
}

function Challenge({ busy, email, onSubmit, onSignOut }: { busy: boolean; email: string; onSubmit: (code: string) => void; onSignOut: () => void }) {
  const [code, setCode] = useState('');
  return (
    <form
      className="mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) onSubmit(code);
      }}
    >
      <h1 className="auth-title" id="auth-title">
        Authenticator code
      </h1>
      <p className="auth-sub">The six digits your authenticator app shows for Ledger ({email}).</p>
      <CodeInput value={code} onChange={setCode} />
      <button type="submit" className="btn btn-primary auth-go" disabled={busy || code.length !== 6} data-testid="auth-verify">
        {busy ? 'Checking…' : 'Continue'}
      </button>
      <div className="auth-links">
        <button type="button" className="link" onClick={onSignOut}>
          Use a different account
        </button>
      </div>
    </form>
  );
}

function Passphrase({ busy, fresh, onSubmit, onSignOut }: { busy: boolean; fresh: boolean; onSubmit: (phrase: string, remember: boolean) => void; onSignOut: () => void }) {
  const [phrase, setPhrase] = useState('');
  const [again, setAgain] = useState('');
  const [remember, setRemember] = useState(true);
  const [understood, setUnderstood] = useState(false);
  const problem = fresh && phrase ? passphraseProblem(phrase) : null;
  const ok = fresh ? !problem && phrase.length > 0 && phrase === again && understood : phrase.length > 0;
  return (
    <form
      className="mt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit(phrase, remember);
      }}
    >
      <h1 className="auth-title" id="auth-title">
        {fresh ? 'Choose a passphrase' : 'Your passphrase'}
      </h1>
      <p className="auth-sub">
        {fresh
          ? 'Your ledger is locked with this before it leaves the device. It is never sent anywhere, so nobody, including Supabase, can read your ledger without it. It is not your password.'
          : 'The one your ledger is locked with. It never leaves this device.'}
      </p>
      <Secret
        label="Passphrase"
        value={phrase}
        onChange={setPhrase}
        autoComplete={fresh ? 'new-password' : 'current-password'}
        autoFocus
        testid="auth-passphrase"
        hint={fresh ? (problem ?? `${MIN_PASSPHRASE} characters or more. Four unrelated words works well.`) : undefined}
      />
      {fresh && (
        <>
          <Secret label="The same again" value={again} onChange={setAgain} autoComplete="new-password" testid="auth-passphrase-again" hint={again && again !== phrase ? 'The two differ.' : undefined} />
          <label className="auth-check">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} data-testid="auth-understood" />
            <span>
              I have written it down. <b>If it is lost, the ledger cannot be opened by anyone</b>, and there is no reset.
            </span>
          </label>
        </>
      )}
      <label className="auth-check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Remember it on this device. Untick on a computer that is not yours.</span>
      </label>
      <button type="submit" className="btn btn-primary auth-go" disabled={busy || !ok} data-testid="auth-unlock">
        {busy ? (fresh ? 'Locking…' : 'Opening…') : fresh ? 'Lock my ledger with it' : 'Open my ledger'}
      </button>
      <div className="auth-links">
        <button type="button" className="link" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </form>
  );
}
