# Ledger on every device: the account, the phone app and GitHub Pages

Ledger runs two ways, and they are the same application:

| | Laptop build (`dist/`, `standalone/`) | Hosted build (GitHub Pages) |
| --- | --- | --- |
| Where the ledger lives | `ledger.json` in a folder you pick | Your account in Supabase, encrypted |
| Sign-in | None | Password, authenticator code, passphrase |
| Devices | That laptop | Laptop, phone, tablet: any browser |
| Install | `Create Desktop App.cmd` | "Install" in Edge/Chrome; "Add to Home Screen" on a phone |

The hosted build is the laptop build plus `cloud.json` (which Supabase project to use).
`npm run build:pages` makes it in `site/`; `.github/workflows/pages.yml` publishes it.

**This repository's deployment:** the app is at `https://khouryai.github.io/Ledger/`
and its database is the Supabase project `ledger` (`kjjncbvvmdpwvkdqftbd`, us-west-1)
in the organisation Alex's.

## What protects the ledger

Three layers, each enough on its own to stop someone who got past the one before.

**1. The ledger is encrypted on your device.** Before anything is saved it is gzipped
and sealed with AES-256-GCM under a key derived from your *passphrase* (PBKDF2-SHA256,
600,000 rounds, a random salt per account). The passphrase never leaves the device and
is not your password. Supabase stores ciphertext; its staff, a leaked database dump, or
someone holding the project's keys cannot read it. Each save has a fresh random IV, and
the ciphertext is bound to your account id, so it cannot be swapped or replayed into
another account. (`src/cloud/vault.ts`, tested in `tests/vault.test.ts`.)

**2. The database only answers your account, after the second step.** Every table
has row-level security that allows the row's owner only, only when the session has
passed the authenticator-app code (`aal2`), and only while the address is a member.
Without the code, a correct password sees nothing at all. The anonymous key can read
nothing. A save that is refused raises an error rather than reporting success.
(`supabase/schema.sql`, tested against real Postgres in `tests/sql.test.ts`.)

**3. Sign-up is by invitation.** A trigger on `auth.users` refuses any address that is
not in `ledger_members`, so nobody else can create an account, whatever the form shows.

And around them:

- **Content-Security-Policy** on the hosted page: scripts only from the site itself (no
  inline script, no `eval`), connections only to your Supabase project, the AI model's
  download hosts and Microsoft's sign-in. An injected script could not load more code
  or send the ledger elsewhere. No referrer is sent.
- **Passwords** of at least 12 characters. The authenticator is Microsoft
  Authenticator, Google Authenticator or a password manager (TOTP).
- **Links in emails** (confirm the address, reset the password) use PKCE: a link only
  works in the browser that asked for it, and no token ever appears in the address bar.
- **On a device**: the key can be remembered (stored as a *non-extractable* key that
  scripts can use but cannot read out). Signing out, or **Forget the passphrase here**,
  deletes it and the encrypted copy kept for offline use. **Sign out everywhere** ends
  every session.
- **Two devices at once**: each saves against the version it read. When the other
  device saved first, the two are merged (`src/engine/merge.ts`): nothing in either
  history is lost, and a field changed on both keeps the one you just typed.
- **Backups**: the start of each day is kept for 30 days, still encrypted, in
  Settings → Where your ledger lives.

**The one thing to know:** if the passphrase is forgotten, the ledger cannot be
recovered, by you or anyone. Write it down somewhere safe. Settings → **Download a
copy** saves a plain (unencrypted) copy whenever you want one.

## Setting it up

### 1. The Supabase project

Create a project (a separate one: the invitation trigger applies to the whole project's
sign-ups). Then, in its **SQL editor** (not through an AI tool's migration call: those
hold any statement containing `drop` or `delete` for a confirmation, and the script has
both):

1. Run all of `supabase/schema.sql`.
2. Add your address, the only one allowed an account:

   ```sql
   insert into public.ledger_members (email) values ('you@example.com');
   ```

In **Authentication → Sign In / Providers → Email**: keep *Allow new users to sign up*
**on** (the trigger is the control; turning this off refuses you too), keep *Confirm
email* on, and set the minimum password length to 12.

In **Authentication → Multi-Factor**: TOTP enabled (the default).

In **Authentication → URL Configuration**: set *Site URL* to the Pages address,
`https://khouryai.github.io/Ledger/`, and add the same under *Redirect URLs*.

### 2. Tell the app which project

Put the project's URL and its **publishable** (anon) key in `cloud.json`:

```json
{ "url": "https://xxxxxxxx.supabase.co", "key": "sb_publishable_..." }
```

The publishable key is public by design: it names the project and grants nothing that
row-level security does not. Never put the `service_role` / secret key anywhere in this
repository.

### 3. Publish

In the repository: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. Every push to `main` then publishes the hosted app; the address is shown on
the workflow run.

### 4. First sign-in

Open the address on the laptop, choose **First time: create the account**, confirm the
email from the link (open it in the same browser), scan the QR code with the
authenticator app, and choose the passphrase. To bring the laptop's existing ledger
across: Settings → **Bring in a ledger file**, and pick `ledger.json` from its folder.

### 5. Install it

- **Laptop (Edge or Chrome):** the install icon at the right of the address bar, or
  menu → Apps → Install Ledger. It opens in its own window, from the Start menu and
  taskbar.
- **iPhone (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** menu → **Install app**.

On each device: sign in, enter the code, enter the passphrase once (ticking *Remember it
on this device* on your own devices). After that it opens straight to Today, and opens
with no signal from the copy it keeps, saving when the connection is back.

## What does not move across

- **The on-device AI** needs a laptop's graphics chip. On a phone, the rules do every
  job without it.
- **Outlook** needs its own app registration (docs/OUTLOOK.md) with the hosted
  address's `auth.html` as a redirect.
- **Opening `.msg` files** works on the laptop; on a phone, paste the email's text into
  Capture.
