# Ledger: the plan, and what was built

Written from the planning conversation of 15 October 2026 and kept as the record of
what was asked for. Everything below the line "Built" was built in the first version.

## What it is for

One place for everything I owe people and everything people owe me, so nothing is
forgotten and chasing is one click.

**Decisions made in planning:**

| Question | Answer |
| --- | --- |
| Who uses it | One person. No team mode: a meeting's actions go out as Excel or an email. |
| Machines | One laptop. No merging between machines. |
| Existing action list to import | None. Start empty; add people from an email's To line. |
| Where the data lives | One JSON file in a folder the user picks (OneDrive), like P6-KPI. No server, no account. |
| Sending email | Never from the app. Drafts go to Outlook (mailto or an unsent .eml). |
| AI | Open source, running on the laptop (WebLLM, in the browser). Nothing leaves the machine. Optional; rules do every job without it. |
| Decisions | Made from the ledger's own history by counting, never by a model, always with the reason shown. |
| Name | Ledger. |

## Built

### 1. The core

- [x] One item, two directions (**I owe** / **Waiting on**), with one person, tags,
  asked-on date, due or promised date, hand-set chase date, snooze, links, notes,
  blocked-by, recurrence, source, and an append-only history.
- [x] Working days, with a holiday list, used for every age and every date.
- [x] The quick-add line with chips before Enter: `@person`, `#tag`, dates in the user's
  order (`fri`, `next tue`, `11/14`, `eow`, `+3d`, `end of month`…), `since …`,
  `every …`, `owe:`/`wait:`, Tab to switch direction; new people offered, ambiguous
  names asked about.
- [x] Today / I owe / Waiting on / Everything, with search and filters.
- [x] Age in working days with amber and red thresholds; promise missed.
- [x] Snooze, done/received with a note, drop with a reason, reopen, undo (Ctrl+Z
  and on every toast).
- [x] Chaser drafts from templates: mailto link or unsent `.eml`; logged with Undo.
- [x] Excel action log and copy-as-table (HTML for Outlook and Word).
- [x] People from a pasted To/Cc line.
- [x] Daily backups (30 kept); a file that will not read is never overwritten.
- [x] Notices a change made to the file from outside the window.

### 2. Chasing properly, and decisions from the data

- [x] One email for several items to one person; tick which to include.
- [x] Escalation steps (nudge → firm → escalation copying a named contact), suggested
  from the chases since the last movement; templates editable.
- [x] Chase rhythm: the day after a promise; else the person's own rhythm once five
  items have been received from them; else the default; or set per person; or set by
  hand on one item. Every plan shows its reason.
- [x] Person record: received, usual working days to deliver, promises kept, chases
  needed. Private: never exported.
- [x] Expected arrival from the record; **at risk** when an input is likely to land
  inside my own deadline less a buffer; "no date" when an input has none.
- [x] Today ordered by a score made of the same facts as the reason: due, chase due,
  at risk, unblocked, back from snooze, coming up.
- [x] Weekly review: untouched items one at a time (K/C/S/D/X), suggestions (escalate,
  looks dead, at risk), the week summarised; prompted on the chosen weekday.
- [x] Recurring items: closing one creates the next, moved back to a working day.

### 3. Meetings and email

- [x] Meetings register; a session's agenda is every open item from earlier sessions.
- [x] Meeting mode: quick-add with the attendees as one-click chips, notes, actions
  found in the notes, copy as table, email to attendees, Excel.
- [x] Capture: paste an email, a thread or notes, or drop `.eml` / `.msg`; messages
  split by their header blocks; who wrote it decides who owes whom; requests,
  promises and action lines found by rule, each with its sentence; new people from
  the headers.
- [x] Did a reply close it: delivered / part / not delivered with a new date / unclear,
  with one-click follow-ups.

### 4. On-device AI

- [x] WebLLM, loaded only when switched on; four models offered with maker and memory.
- [x] Laptop check (WebGPU, adapter, 16-bit shaders), download with progress, remove.
- [x] Finding actions, writing chasers, judging replies, weekly paragraph, call brief.
- [x] Every answer checked: dates re-derived, people matched exactly, quotes verified,
  JSON constrained by schema; nothing written until accepted.

### 5. Outlook (needs IT)

- [x] Sign-in with MSAL against the user's own Entra app registration.
- [x] Sent emails asking for something with no reply after N working days.
- [x] Flagged emails as things I owe. Today's meetings into meeting mode.
- [x] Dismissed and already-tracked messages never suggested again.

## Left out on purpose

- Team mode, sharing, accounts.
- Sending email from the app.
- Priority matrices: due dates and Today do that job.
- Background reminders: the app runs no service. Start it at log-on instead.

## Not yet done, and why

- **Loading the model's files from a folder** instead of Hugging Face, for networks
  that block the download. WebLLM fetches by URL; serving a `models\` folder from
  `start.cmd` would do it, but needs the local server to map WebLLM's file layout.
- **Outlook against a real tenant.** Built and tested against a fake mailbox; the real
  sign-in needs the app registration in docs/OUTLOOK.md before it can be tried.
- **The real model on real hardware.** The pipeline is tested with a stand-in; the
  first run on the laptop is **Settings → On-device AI → Try it on a sample**.
