# Working with an agent

[Türkçe](ajanlar.md) · [User guide](guide.md)

SnippStudio can let an AI coding agent you already use read your project and edit it. The agent is your own program, signed in to your own account; SnippStudio gives it a small set of tools over a local connection and shows you what it does. Nothing of the agent runs while **Agent access** is off.

## Which agents

| Agent | How it connects | State |
|---|---|---|
| Claude Code | Added to Claude Code once (`claude mcp add`); from then on every Claude Code chat has the tools | tested |
| Codex | Added to Codex once (`codex mcp add`); it reads the key from an environment variable of the terminal you start Codex from | experimental · unverified |
| OpenCode | SnippStudio gives you the connection settings to copy; you add them to OpenCode's settings | experimental · unverified |
| Antigravity (`agy`) | SnippStudio copies a command that prints the entry for Antigravity's MCP settings file; you add it there | experimental · unverified (never tried with a real Antigravity) |

The agent must be installed and signed in on this computer (with a plan that includes command-line use). **Settings → Agent connection** shows which ones it found, their versions, and for a missing one the install command and the official link to copy. SnippStudio starts no agent on its own; the **Chat** tab starts your installed Claude Code only when you send it a message. It never reads, keeps or types your agent's keys or tokens: signing in is the agent's own flow. You give the agent its work in the agent's own chat, or send it from SnippStudio (see **Sending from the app to the agent** below).

## Connecting

All in one place: **Settings → Agent connection** (the gear in the top bar, **File → Settings…** or Ctrl+,; ⌘, on a Mac). Pick your program at the top (**Claude Code**, **Codex (terminal)**, **Codex (desktop)**, **OpenCode** or **Other**, for Antigravity and the rest: experimental), then follow the five numbered steps. Each step is one job with one button and shows its result as it happens; under each, **If it did not work** gives the most common reasons.

1. **Turn agent access on** (the same switch as the top bar's).
2. **Introduce SnippStudio to the program**: **Copy the command**, open a command window (type "Terminal" in Start), paste it and press Enter. Once. The command never shows the key: your own command window reads it from SnippStudio's settings file. For Claude Code it runs `claude mcp add --transport http --scope user snippstudio …`; for Codex it keeps the key for your Windows user (`SNIPPSTUDIO_TOKEN`) and runs `codex mcp add snippstudio --url … --bearer-token-env-var SNIPPSTUDIO_TOKEN`. OpenCode: copy the setting into `opencode.json`. Other: the command prints the setting with the key, for your program's agent settings (Antigravity, experimental: `.agents/mcp_config.json`; there the key stands as plain text). SnippStudio itself never writes an agent's settings.
3. **Restart the program**. The order matters: first SnippStudio with access on, then the agent. A window opened before it does not see the tools (Claude Code: `/mcp` → Reconnect; the Codex app: quit it completely and open it again).
4. **Check**: four lines, each ticked or crossed with what to do: the registration was found, the key is up to date, SnippStudio is listening, the agent connected (with its time). It only reads (`claude mcp get`, `codex mcp get --json`, and on Windows whether your Codex key matches, compared inside PowerShell).
5. **Try it**: copy the sentence for the agent; when it connects the step says so.

The development copy (SnippStudio Dev) is added under its own name (`snippstudio-dev`), its own port and, for Codex, its own variable (`SNIPPSTUDIO_DEV_TOKEN`); neither writes over the other. **Renew key** makes a new key (asked twice): every connected agent is cut off and the old key stops working after 10 minutes. **Reconnect** (in step 2, or on the check row that found an old key) runs step 2 for you for a program it found: Claude Code, Codex and OpenCode each write their own registration; SnippStudio only starts that program's own command. With **Repair detected agents automatically** on (the default, under Details), a request refused for its key repairs the registration of the programs found here by itself; the agent that was refused still reconnects or restarts. It never changes anything else of your agent settings, and writes nothing into the project folder.

Turning **Agent access** off closes the server: nothing listens.

### The connection itself
- An MCP server over HTTP on this computer only (`127.0.0.1`), with a token the agent reads from SnippStudio's settings file. Requests from web pages are refused.
- Each session belongs to one window and its project.
- Keep the key private: while access is on, anything that knows it can edit your projects.

## Chat inside SnippStudio

The **Chat** tab (right panel, while agent access is on) talks to the Claude Code CLI on this computer without leaving the editor. The first message starts it in the open project's folder; its words and every tool call appear there, with the turn's time and cost. The next message keeps the same chat's context; **New chat** starts again with none, and **Stop** ends the turn and the program.

- It uses the Claude Code you already installed and signed in (found the same way the connection page finds it). An agent from outside, connected through Settings, still works exactly as before.
- What it may do: the app's own tools (project, transcript, frames, analyze, edit, notes, job, code clips, media; every call arrives in the editor as any agent's does) and file edits in the project's folder. **Shell** is off until you turn it on under the message box; on, the agent may run any command on this computer without asking, so turn it on only when you trust what you will ask.
- **Model** picks from the model ids your CLI environment holds (Default is the CLI's own choice). A switch in an open chat keeps the conversation's context. **Mode** is the CLI's permission mode: Accept edits (the default), Auto (the CLI's classifier decides) or Plan.
- **Compact** sends the CLI's own `/compact`; so does typing it. The transcript continues with the summary. Typing `/` lists the commands the CLI offers. Under the message box, **Context** shows the last turn's size against the model's window; it turns amber near 70 %, red near 90 %, and says **Compact soon** near the top.
- Pictures: the **+** button or a paste attaches up to four images (PNG, JPEG, WebP, GIF; 8 MB each), shown as thumbnails with an × to remove one.
- Hovering a message shows **Copy** under it; your own messages also offer **Rewind to here**, which takes that message and everything after it out of the conversation and puts the message (with its pictures) back in the box to say it differently. The CLI's own transcript is cut with it, so the next answer no longer remembers what you removed. On the first message it asks first: rewinding there ends the whole chat.
- **Chats** (left panel) lists this project's chats. Each is saved as you talk and named by your first words; a row opens it — after quitting and reopening the app the CLI continues that same conversation — and the trash button deletes it, its CLI transcript too.
- The app's `wait` tool is not offered in the chat: it is for an agent whose own chat is elsewhere. When the turn is done, the agent replies.
- The **hide-panel** button in the tab strip folds the Inspector away (remembered): the preview and the timeline take the full width; the chevron at the window's right edge brings it back.
- Only the **Claude Code** CLI is hosted in this version. Codex and OpenCode stay external agents; their adapters can come behind the same tab.
- The chat process is the app's child: closing the window, turning agent access off, or quitting ends it and everything it started. Its key goes to the process in its environment, never on a page or a command line.

## What the agent can do: the tools

| Tool | What it does |
|---|---|
| `project` | The open project: size, length, version, tracks and clips, subtitles, markers, media not yet placed. Called first. |
| `new_project` | Starts an empty project in this window (16:9, 9:16 or 1:1, optional name). Only when the open one has no unsaved changes and no waiting draft; it has no file yet unless `save:true`. |
| `transcript` | What is said, line by line with times; word times only for a range that must be cut finely. |
| `frames` | The picture at 1–12 moments, drawn as the export draws it, in one image (a grid with the times). |
| `changes` | What changed since a version it read: cheaper than reading everything again. |
| `analyze` | Measurements made by SnippStudio on this computer: silences, filler sounds, repeated sentences, loudness and tempo, a pre-export check, picture plans for numbered images, keywords. SnippStudio finds; the agent (and you) decide. |
| `edit` | Edits: cuts, moves, titles, transitions, templates and more, in one step. |
| `notes` | Your work notes: it reads the ones waiting and answers them; you approve. |
| `job` | Long work: subtitles written by SnippStudio's own speech model. The language is the project's spoken language (the Subtitles tab's choice; a new project takes the interface's language), or Turkish or English when the agent names one. The `project` answer says which it is. |
| `code_clip` | A code clip: makes its folder with an empty `index.html` (giving an unsaved project a file beside Documents first if needed) and places it; checks a page (errors, blank or unstable frames, its length). |
| `media` | The bin: brings local video, sound and picture files in by path (`import`), and points an asset at a new file of the same kind (`replace`: a rebuilt mix, a new take) without closing the app. |
| `wait` | Waits for what you send from SnippStudio: returns the moment you send (notes, a job you wrote, your answer on the draft); if nothing comes it says "nothing yet" after a few minutes and the agent calls it again. |

The agent writes a code clip's page as it wishes: SnippStudio does not tell it how to draw, and plays the page as written (no network).

## Sending from the app to the agent

Without a terminal, you can send work straight into the agent's chat:
- **Notes** tab, **Send to agent (n)**: the open notes go.
- Write a job in the **command box** ("tighten the intro") and press **Send** (Ctrl+Enter). What you selected (clips, files, a range, a region) goes with it as one line. A ready job's exact words ("cut silences") do not go to the agent: they are done here.
- On the **draft card**, **Accept** or **Reject**: your answer goes to the agent, with the short word you wrote in the card's field ("not now").

How it arrives: when the agent finishes its work it calls the `wait` tool and waits. The moment you send, that call returns, what you sent appears in the agent's chat and it starts working. The **Agent** tab says how it stands: "Agent waiting: it gets what you send at once" or "The agent is working or not waiting: what you send waits in line" (what is in line goes with the agent's next `wait` call). Under it, **Sent recently**. Each thing goes once.

- What you send goes only to that window's agent and is kept only in memory: opening another project or closing the program drops what is still in line. Notes are not lost: they stay in the project, and the agent reads them with `notes` too.
- If the agent is not waiting (the top bar says **Awaits your reply**: it ended its turn), the line under the button says **In line · paste it into the chat** with **Copy**: Copy puts what you sent (the notes' numbers, times, kinds and words, or the job) on the clipboard as plain text and takes it out of the line; paste it into the agent's chat. The copy button beside every Send gives the same text without sending.
- With two agents connected, what you send goes to the one working on the project (the one that changed it, or the one you handed it to), not to whichever waits. Your answer on a draft goes to the agent that made the draft. The other agent can read the project; when it waits or asks for the notes it is told whose the project is, and it takes no notes.
- What you send reaches the agent as data; SnippStudio runs nothing itself. The agent cannot write to this inbox.

## Drafts: you decide

- By default the agent's edits gather in **one draft**. The **Agent** tab's draft card shows what it would change (cuts, seconds shorter, added, dropped), **Before** / **After** / **Preview**, and **Accept all**, **Accept selected** or **Reject**.
- **Agent settings → Apply directly** lets edits go straight into the project instead; each one is still a single undo step.
- If you edit while a draft waits, the draft is worked out again on your latest version. An edit whose content is gone is dropped and said, never put somewhere wrong.
- **Back to before the agent** returns the project to how it was before the agent changed it, as one undo step (Ctrl+Z brings the agent's work back). The steps list lets you go back to any step of the session.

## Tokens: using little

- SnippStudio does the measuring locally (silences, fillers, repeats, loudness) and answers with short numbered lists; the agent decides from them instead of reading the whole film.
- The tool definitions are kept small, and `changes` saves re-reading.
- Pictures are sent only when the agent asks for frames, at the **Default frame width** you choose (384, 512 or 768 px).
- The **Agent** tab's meter shows how many tokens SnippStudio's tools sent the agent and how they split (text, frames, definitions). The agent's own thinking and writing are not included.
- **Ready jobs** in the command box (cut silences and others) run in SnippStudio itself: nothing goes to the agent, 0 tokens. The tags over the box (selected clips, files, a range, a region drawn on the frame) show in the agent's next `project` call.

## What goes to the agent, what does not

Goes to the agent (and so to its provider): the project's structure (tracks, clips, times, names), the subtitles' text, the frames it asks for, your work notes and their drawings, the results of the analyses, and the jobs you write in its chat or send from SnippStudio.

Does not go: your media files themselves (videos, sound), anything outside the open project, your agent keys. SnippStudio itself sends nothing over the internet; the agent's own program talks to its provider.

## The tools' language

The tools' answers are in **English** whatever the interface's language: they are read by the agent, not by you. Your notes and the jobs you write go as you write them.
