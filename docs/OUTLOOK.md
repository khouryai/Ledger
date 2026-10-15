# Connecting Ledger to Outlook

Optional, and off by default. With it on, **Outlook** in Ledger reads:

- your **sent mail** for the last N days, and suggests the emails that asked for
  something and have had no reply from anyone in the thread for N working days;
- your **flagged** emails, as things you owe;
- **today's meetings**, one click from meeting mode with the attendees filled in.

It only reads. It never sends, moves, flags or deletes anything, and every suggestion
has to be accepted by hand. A suggestion you dismiss is never offered again.

It works in the served version (`start.cmd`, `http://localhost:47810`). The single
file opened from disk cannot sign in, because sign-in has to return to a web address.

## What IT needs to do (once)

Register Ledger as an application in **Microsoft Entra ID**:

1. **Entra admin center → Applications → App registrations → New registration.**
   - Name: `Ledger`.
   - Supported account types: *Accounts in this organizational directory only*.
   - Redirect URI: platform **Single-page application (SPA)**, address
     `http://localhost:47810/auth.html`.
2. **API permissions → Add a permission → Microsoft Graph → Delegated**:
   `User.Read`, `Mail.Read`, `Calendars.Read`. If users may not consent for themselves
   in this tenant, **Grant admin consent**.
3. From **Overview**, give the user the **Application (client) ID** and the
   **Directory (tenant) ID**.

No client secret is needed (a single-page app cannot keep one), and nothing is
hosted: the app runs on the user's laptop and calls Microsoft Graph directly with the
user's own delegated token. The token is held by Microsoft's sign-in library (MSAL) in
the browser's storage for `localhost:47810`.

## What you do

**Settings → Outlook**: tick **Use Outlook**, paste the client id and tenant id. Open
**Outlook** in the left-hand menu and press **Check Outlook**; the first time, a
Microsoft sign-in window opens.

## What is read, exactly

| Call | Fields |
| --- | --- |
| `GET /me` | display name, email |
| `GET /me/mailFolders/sentitems/messages` (sent in the last N days) | id, conversation, subject, sent time, recipients, body |
| `GET /me/messages?$filter=conversationId eq …` (for each of those) | id, sender, sent and received time |
| `GET /me/messages?$filter=flag/flagStatus eq 'flagged'` | id, subject, sender, received time, body, flag |
| `GET /me/calendarView` (today) | id, subject, start, end, attendees, organiser |

Message bodies are read on the laptop to find the ask and are not kept. If you accept
a suggestion, the ledger stores the item, the email's subject, its message id (so it
is not suggested twice) and, in the item's history, the sentence the item came from.
