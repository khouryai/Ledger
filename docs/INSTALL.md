# Installing Ledger on a locked-down Windows laptop

**Nothing needs installing.** No Node.js, no npm, no admin rights, no installer for IT
to approve. It is the same arrangement as P6-KPI.

| | **A. Local server** (recommended) | **B. Taskbar app** |
| --- | --- | --- |
| Set up with | `start.cmd` | `Create Desktop App.cmd`, once |
| Needs PowerShell to run a script | Yes | No |
| Anything running in the background | A server window | No |
| Own window and taskbar icon | Yes | Yes |
| On-device AI | Yes | Yes |
| Outlook connection | **Yes** | No (sign-in needs a web address to return to) |

**Try A first. Fall back to B if PowerShell is blocked**; the app is the same.

## First: put the folder somewhere permanent

Copy the whole folder out of `Downloads` to a fixed path such as `C:\Tools\Ledger`.
Then copy **all of it**: `start.cmd`, `Create Desktop App.cmd`, `Update.cmd`, `dist\`,
`standalone\`, `server\` and `public\`.

## A. The local server

1. Double-click **`start.cmd`**. A server window opens and stays open; Edge opens
   Ledger at `http://localhost:47810/`.
2. To install it properly: open `http://localhost:47810/` in a normal Edge tab, then
   `…` → **Apps** → **Install this site as an app**, then pin it to the taskbar.
3. To have the server start with Windows: **Task Scheduler** → **Create Basic Task**,
   trigger **When I log on**, action **Start a program** pointing at `start.cmd`. Tick
   **Hidden** in its properties. No admin rights needed.

If Windows asks **"Do you want to run this script?"**, that is your company's
PowerShell policy. Answer **R**, then run `start.cmd` again (it finds the running
server). If it asks every time, use B.

Ledger uses port **47810**, so it can run beside P6-KPI on 47800.

## B. The taskbar app

1. Double-click **`Create Desktop App.cmd`**. It makes a **Ledger** desktop shortcut
   that opens `standalone\index.html` in Edge's app mode, and opens it.
2. Right-click the icon → **Show more options** → **Pin to taskbar**.

If policy blocks the shortcut being made, the script prints the command line to paste
into a hand-made shortcut, and saves it in `taskbar-shortcut-target.txt`.

## Where your ledger lives

On first run Ledger asks. Choose **Keep it in a folder** and pick (or make) a folder
in OneDrive, for example `OneDrive\Ledger`. Inside it Ledger keeps:

| File | What it is |
| --- | --- |
| `ledger.json` | Everything: items, people, meetings, settings. Rewritten a moment after every change. |
| `backups\ledger-YYYY-MM-DD.json` | The file as it stood at the start of each day you used it. The newest 30 are kept. |

Right-click the folder in Explorer → **Always keep on this device**, so OneDrive
never leaves a cloud-only placeholder.

The browser asks once per session before letting Ledger back into the folder. Click
**Open** on the first screen; choose **Allow on every visit** when Edge offers it and
it stops asking.

**If the file will not read** (a bad sync, a hand edit), Ledger does not overwrite it.
It opens on a page offering its own daily copies and OneDrive's version history.

**If you launch both ways (A and B)**, use the folder: the browser keeps its own
storage separately for `http://localhost:47810` and for the file on disk, but the
folder is the same file whichever way you open it.

## Updating

Double-click **`Update.cmd`**. It fetches the current version from GitHub into the
app folder and never touches your ledger, which is in your OneDrive folder. Then
reload (A shows a green bar; for B close and reopen the window).

**The repository is private**, so the download route needs the folder to be a git
clone signed in to GitHub (Update.cmd then runs `git pull`), or the repository made
public. Without either, download the folder from GitHub and copy `dist`,
`standalone`, `server` and `public` over the top.

## The on-device AI on a work laptop

- It needs **WebGPU**, which current Edge and Chrome have. **Settings → On-device AI →
  Check this laptop** says whether yours can use it.
- The first **Download and load** fetches the model from `huggingface.co` and its
  engine from `raw.githubusercontent.com`: about 1 to 2.5 GB, once. If your network
  blocks either, ask IT to allow them, or leave the AI off: the rules do the same jobs.
- Loading takes from a few seconds (already downloaded) to several minutes (first
  time). After that, an email takes seconds.

## Troubleshooting

- **"The built application is missing"**: only one file was copied. Copy the whole folder.
- **"Could not listen on port 47810"**: change `set "PORT=47810"` in `start.cmd`.
- **"Could not save … OneDrive may be holding the file"**: OneDrive briefly locks a
  file while uploading. Ledger retries; press **Try again** if the red bar stays.
  Nothing typed is lost.
- **"The ledger file changed outside this window"**: it was edited from somewhere
  else (another window, or OneDrive restoring a version). Choose which to keep.
