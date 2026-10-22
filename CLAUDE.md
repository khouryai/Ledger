# CLAUDE.md: conventions for Ledger

## Git

Commit and push to `main`. No feature branches or pull requests unless asked.
Rebuild and commit `dist/` and `standalone/` **in the same commit** as any change to
`src/`, `server/`, `public/`, `index.html` or `vite.config.ts`: they are the delivered
product (the laptop has no Node), and CI fails when source has moved on since they were
last built.

## Verify after every change

```
npm run typecheck   # strict TypeScript, no emit
npm test            # the engine, in Node
npm run build       # typecheck + dist/ + standalone/
npm run build:pages # the hosted app into site/ (LEDGER_ALLOW_EMPTY_CLOUD=1 if cloud.json is empty)
npm run test:ui     # both builds in Chromium; any console error fails a test
```

## Architecture

- `src/engine/` decides everything and imports nothing from the browser or React. It
  is pure TypeScript and tested in Node. **A new rule goes here, with a test, before
  any screen uses it.**
- `src/app/` is the React interface. It reads the engine and changes the ledger only
  through `actions.apply(op)` with an `Op` from `engine/ops.ts`, which keeps undo and
  autosave working. Nothing mutates the document in place.
- `src/ai/` is the on-device model. `tasks.ts` builds every prompt and checks every
  answer; nothing in `src/app/` talks to the engine directly. `download.ts` explains a
  failed download; `modelFolder.ts` copies a downloaded model to a folder and back.
- `src/engine/learn.ts` is the model that learns from the user's decisions (docs/AI.md).
  Examples are stored in the ledger (`doc.examples`); the model is rebuilt from them,
  never stored. `src/app/learning.ts` applies it to suggestions.
- `src/graph/` is Outlook. `suggest.ts` is pure and tested; `client.ts` is the only
  file that knows MSAL or Graph URLs.
- `src/storage/` is copied from P6-KPI (folder, IndexedDB, memory; atomic writes and
  OneDrive retries). `ledgerStore.ts` is Ledger's file layout and backups, and the
  `DocStore` interface both places a ledger can live implement.
- `src/cloud/` is the account (docs/CLOUD.md). `api.ts` is the interface;
  `supabaseApi.ts` is the only file that knows supabase-js; `fakeApi.ts` answers the
  same from memory for the tests (`?cloud=fake` in a browser); `vault.ts` is the
  encryption; `cloudStore.ts` saves, and merges with `engine/merge.ts` on a conflict.
  `supabase/schema.sql` is the database, tested against Postgres in `tests/sql.test.ts`.

## Builds

- `npm run build` makes `dist/` and `standalone/`: the laptop app, no account. Committed.
- `npm run build:pages` makes `site/` with `cloud.json`: the hosted app, signed in.
  Never committed; `.github/workflows/pages.yml` publishes it. It refuses to build with
  an empty `cloud.json` unless `LEDGER_ALLOW_EMPTY_CLOUD=1` (CI and the tests).
- Paths are relative everywhere (`base: './'`, the manifest, the service worker), so
  one build works at a site's root and under `/Ledger/`.

## Rules that are deliberate

- **Derived state is never stored.** Ages, chase dates, risk, person records and
  Today are worked out on every render from the items and their histories. Only what
  the user typed or accepted is in `ledger.json`.
- **History is append-only.** Person statistics are counted from it; an event that
  sets a due date carries it as `due`, so the original promise can always be found.
- **Every decision carries its reason, in words**, and the reason is made of the same
  facts the decision used.
- **A name is matched exactly or not at all** (`engine/people.ts`): an unknown name is
  offered as a new person, two matches are asked about, nothing picks the likeliest.
- **The model's answers are checked, never trusted**: dates re-derived from its words
  with our parser, people matched exactly, quotes looked for in the text.
- **Nothing is sent from the app.** Chasers leave as a mailto link or an unsent .eml.
- **What is shown before Enter is what is added.** The quick-add chips are the reading
  the item will be made from.
- **A file that will not read is never overwritten**; the user is offered the backups.
- **The server never sees the ledger.** It is encrypted in `cloud/vault.ts` before it
  is sent; the passphrase is not the password and never leaves the device. Nothing may
  send the plain ledger to Supabase, and nothing may log it.
- **Permissions are enforced in Postgres, never in the interface.** Every table's
  policy requires the owner, the second sign-in step (`aal2`) and membership. A change
  to what an account may do is a change to `schema.sql` and `tests/sql.test.ts`.
- **A refused UPDATE is not an error** in Postgres: `save_ledger()` checks the row
  count and raises, and any new write path must too.
- **Two devices merge; neither overwrites.** A save is against the version read; on a
  conflict `engine/merge.ts` merges three ways, and histories are unioned.
- **The hosted page's CSP is the boundary for injected script**: no inline script, no
  `eval`, connections only to listed hosts. A new outside host is added to `csp()` in
  `vite.config.ts` deliberately, as narrowly as the host allows.
- **The learning changes nothing silently.** It unticks, turns round or adds a
  suggestion only with the reason in words, and only once it has seen enough; a
  decision is learned from once. Its accuracy is reported against what was proposed.
- **The service worker clears only its own caches** (`ledger-*`). The site's cache
  storage also holds the downloaded model (`webllm/*`); clearing it on each update
  deleted the model and broke downloads in progress.
- Colours go through the tokens in `src/app/index.css` (shared with cx-portal and
  P6-KPI). No emoji as icons: `src/app/components/icons.tsx`.

## Adding things

- **A new field on an item**: add it to `Item` in `engine/types.ts`, read it in
  `readDoc()` in `engine/doc.ts` (old files must still load), and if it should be in
  the history, give `updateItem()` a label for it in `FIELD_LABEL`.
- **A new screen**: a module in `src/app/screens/`, a case in `App.tsx`, an entry in
  the nav in `components/Layout.tsx`, and an entry in `components/CommandMenu.tsx`.
- **A new model task**: prompt, schema and answer checks in `src/ai/tasks.ts`, a
  method on `useAi()` in `src/app/ai.ts`, a rule-based fallback for when the model is
  off, and a case in `src/ai/fake.ts` so the browser tests can exercise it.
