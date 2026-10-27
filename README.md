# Ledger

**What I owe, and what I am owed.** One list of everything you owe people and
everything people owe you, with the chasing worked out for you.

- Runs on your laptop. **No Node.js, no installer, no admin rights.**
- Your ledger is **one file** (`ledger.json`) in a folder you choose, usually in
  OneDrive, with a copy kept beside it each day for 30 days.
- **Nothing is sent anywhere.** Ledger never sends email: it drafts, and Outlook sends.
- An optional **AI model that runs on the laptop itself** (in the browser, on the
  graphics chip). It reads emails for actions, writes chasers, judges replies and
  writes up your week. Nothing it reads leaves the machine. With it off, rules do
  the same jobs.
- Shares its look with cx-portal and P6-KPI: the same token sheet and typefaces.
- **Or on every device**: the hosted build on GitHub Pages keeps the ledger in your
  own Supabase account, **encrypted on the device** with a passphrase only you know,
  behind a password and an authenticator code. Installs as an app on the laptop and
  on a phone's home screen. See [docs/CLOUD.md](docs/CLOUD.md).

## Running it

Two ways, both needing nothing installed. See [docs/INSTALL.md](docs/INSTALL.md).

- **`start.cmd`**: serves Ledger on `http://localhost:47810` with the PowerShell that
  ships with Windows. Recommended, and needed for the Outlook connection.
- **`Create Desktop App.cmd`**: run once; makes a desktop and taskbar app that opens
  the single-file version straight from disk, with no server.

On first run, choose **Keep it in a folder** and pick (or make) a folder such as
`OneDrive\Ledger`. Put your name and email in **Settings** first: chasers are signed
with it, and Capture uses it to tell which emails in a thread are yours.

## What it does

| Job | Where |
| --- | --- |
| Add something in five seconds | **The line at the top**, everywhere. `@Sam ATS report rev B by fri #BART` reads as waiting on Sam, due Friday, tagged BART. What it read appears as chips **before** you press Enter, so nothing is added on a guess you could not see. **Tab** switches between I owe and Waiting on. `since monday` sets when it was asked; `every friday`, `every mon and thu`, `every other tuesday`, `every month end` or `the first monday of every month` make it recur, with `until 12/18` or `starting 11/2` if it has an end or a start; a name it does not know is offered as a new person; two Sams make it ask which. |
| See what needs you today | **Today**: what you owe that is due, who to chase and why, what is at risk, what just got unblocked, what came back from snooze, and what you got done today. Three chases to Sam become one button: **One email to Sam (3)**. The side column shows the week at a glance, day by day, and how the recurring items are going. |
| Plan the week | **Week**: each day's deadlines, the dates others promised, when to chase, every recurring item, and what got done. Drag something you owe onto another day to move it, or a chase to make it that day (or use **Move** on the card, from the keyboard or a phone). What is overdue from before and what has no date yet sit underneath, ready to be given a day. **Copy the week** gives it as lines for an email. `←` and `→` step through the weeks. |
| Things that come back | **Recurring**: every recurring item, defined once with its schedule in words (every working day, every Friday, Mon and Thu, every other Tuesday, the 15th, the last working day, the first Monday of the month, every quarter, until a date) and the steps it takes each time. Each shows when the next is due and how it has gone: on time, late, skipped, how many in a row. A grid shows the week day by day. **Done**, **Skip this one**, **Pause until…**, **Change the schedule** or **Stop repeating**. Only the one in hand is on your lists; closing it puts the next on, on the schedule's own day. |
| Break it down | **Steps** on any item: a checklist on the item, each tick in its history. A recurring item's next one starts with them unticked. |
| Chase | **Chase** on any waiting item opens a draft in the right tone for how many times you have already asked (nudge, firm, escalation copying their manager), from templates you can edit. **Open in Outlook** (mail link) or **Outlook draft (.eml)**, which classic Outlook opens with a Send button. Logged on the item either way, with Undo. |
| Know when to chase | Worked out per item, with the reason shown: the day after a promise, or the person's own rhythm once Ledger has seen five items from them (*"Sam usually delivers in 6 working days, so chase at day 7"*), or your default. Override it on the item, or set a rhythm per person. |
| Know what is at risk | Link what you owe to what you are waiting on for it. If Sam usually runs two days late and that lands inside your own deadline, the item you owe is flagged at risk, with the dates. |
| Capture from email and notes | **Capture**: paste an email, a whole thread, or meeting notes, or drop a saved `.eml` or `.msg`. It finds requests ("could you send…"), promises ("I'll send…") and action lines ("Sam to confirm…", "Action: Priya - …"), works out who owes whom from who wrote it, and shows each with the sentence it came from. You tick what to keep. |
| Run a meeting | **Meetings**: open items from earlier sessions are the agenda; type actions as they are agreed, attendees one click away; copy the list as a table, email it round, or export it to Excel. |
| Keep the list honest | **Weekly review**: every item untouched for a week, one at a time: **K**eep, **C**hase, **S**nooze, **D**one, **X** drop. Plus what the ledger suggests (escalate, looks dead, at risk, a recurring item usually late or usually skipped), the week in a few lines to paste into a report, and **Plan next week**. |
| Before a call | **People**: everything open both ways with one person, their record (how long they usually take, promises kept, chases needed), Chase all, and a brief to copy. Add everyone on an email in one go by pasting its To line. |
| Hand over an action log | **Excel** or **Copy as table** on any list; Outlook keeps the formatting. |
| Outlook (needs IT) | **Outlook**: emails you sent that asked for something and got no reply, flagged emails, and today's meetings (one click to meeting mode). Read-only. Needs an app registration: [docs/OUTLOOK.md](docs/OUTLOOK.md). |

**Keyboard:** `Ctrl K` commands and search · `Ctrl N` or `N` add · `Tab` I owe / Waiting
on · `1`–`5` Today, Week, I owe, Waiting on, Recurring · `←`/`→` weeks · `J`/`K` move ·
`Enter` open · `C` chase · `D` done · `S` snooze · `Ctrl Z` undo.

## The on-device AI

Off by default. Switch it on in **Settings → On-device AI**, pick a model, and press
**Download and load**. It needs a graphics chip the browser can use (WebGPU, in a
current Edge or Chrome); **Check this laptop** says whether yours can. The model is
downloaded once from Hugging Face and kept in the browser. See [docs/AI.md](docs/AI.md)
for what it does, which models are offered and how its answers are checked.

## How the decisions are made

Most of what Ledger decides needs no model at all. It is counted from the history
every item keeps (created, chased, promised, received), and it is never stored: it is
worked out again on every screen, so it cannot go stale, and every decision shows its
reason. What it may do on its own is order your day, work out chase dates, flag risk and put
the next occurrence of a recurring item on the list when the last is closed, on the
schedule's own day (one that falls on a day off is due the working day before, and the
next goes back to the schedule). Escalating, dropping, closing and adding are only ever suggested. It never
sends anything, deletes anything, or changes a date someone promised you.

## For developers

```
npm install
npm run dev          # http://localhost:47810 with hot reload
npm test             # the engine, in Node (no browser), about a second
npm run build        # typecheck, dist/ and standalone/ (both committed)
npm run test:ui      # the built app in Chromium, every screen
```

| Path | What it is |
| --- | --- |
| `src/engine/` | Everything that decides anything: dates and working days, the quick-add reader, operations on the ledger, person statistics, chase plans, risk, Today, recurring schedules and series, the week, the asks finder, email parsing, chasers. Pure TypeScript, tested in Node. |
| `src/ai/` | The on-device model: the engine interface, WebLLM, the prompts and the checks on every answer, and a stand-in for the tests. |
| `src/graph/` | Outlook through Microsoft Graph: sign-in and reading (`client.ts`), and the suggestions worked out from what it returns (`suggest.ts`, pure). |
| `src/storage/` | The folder (File System Access API), the browser (IndexedDB) and memory, with atomic writes and OneDrive retries; `ledgerStore.ts` is the file layout and the daily backups. |
| `src/app/` | The React interface. |
| `tests/`, `tests-ui/` | Node tests and browser tests. |
| `docs/PLAN.md` | The plan this was built from, and what was built. |

Conventions are in [CLAUDE.md](CLAUDE.md).
