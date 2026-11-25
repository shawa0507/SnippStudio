// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors

import { app, BrowserWindow, dialog, Menu, protocol, session } from 'electron'
import { mt, setMainLang } from './strings-main'
import type { Session } from 'electron'
import { existsSync, rmSync } from 'node:fs'

import path from 'node:path'
import { corsHeaders, editorOrigin, isAllowedAppRequest, isTrustedDocument, ownFilesRoot } from './network'
import { isLocalFilePath } from './security'


import { FILM_CSP, FILM_SCHEME, filmFolderArg, filmFrameMayGo, filmProjectPath, serveFilm } from './codefilm'
import { filmValues } from './codefilm-values'
import { closeAllRenderWorkers, registerRenderWorkers, startRenderWorker } from './render-workers'
import { appendAwakeSwitches } from './awake'
import { agentNameFor, agentPortFor, appNameFor, BRANCH, CHANNEL, profileDirFor, windowTitleFor } from './channel'
import { PRODUCT_NAME } from '../shared/product'
import { inheritOnFirstStart, registerProfileIpc } from './profile-inherit-run'
import { hideFromDock, menuTemplate, windowKey } from './app-menu'
import { argvForOpenFile, LaunchQueue } from './launch-queue'
import { AgentHost } from './agent-host'
import { demoteRestorePoint, listRestorePoints, noteRestoreSave, openedRestoreFile, readRestorePoint, rekeyRestorePoints, writeRestorePoint } from './agent-restore'
import { e2eAgentPort, e2eAgentTimeout, e2eFailHostPage, e2eFilmMemoryKb, e2eFilmPolicy, e2eMode, e2eNoteRequest, e2eNoteWebRequest, guardE2ePage, installE2eHooks } from './e2e-hooks'
import { admitted, FENCE_HEADER, fenceAnswer, type Asker } from './film-fence'
import { closeAllFilmWindows, registerFilmWindows } from './film-window'
import { stopVersionKeepers } from './codefilm-versions'
import { randomBytes } from 'node:crypto'

/** This run's stamp for requests the filter admitted (film-fence.ts). */
const FENCE_SECRET = randomBytes(24).toString('hex')
const stamped = (request: Request): boolean => admitted(request.method, request.headers.get(FENCE_HEADER), FENCE_SECRET)
import { changedOnDisk, onePerPath, readDiskStamp, stampKey, writeFileAtomic } from './safe-write'
import { backupProjectFile } from './backups'
import { withRelativePaths } from './project-media'
import { devUrl, rendererEntry, ourPage, trustedSender, renderWorker, ipcMain, allowedMediaPaths, knownProjectPaths, editorWindows, claimedRecoveryPaths, awakeHolds, awakeWatched, newEditorWindowState, rememberDiskStamp, editorState, ownerWindow, windowUsingProject, normalize, pathToMediaUrl, mediaUrlToPath, preloadPath, loadPage, allowProjectPath, focusEditorWindow } from './state'
import { films, serveMedia } from './media'

import { registerModelIpc } from './models-ipc'
import { rendersWatcher, registerRendersIpc } from './renders-ipc'
import { isUserProjectPath } from './project-files'
import { registerMediaIpc } from './ipc/media-ipc'
import { registerSampleIpc } from './ipc/sample-ipc'
import { guardPermissions, registerVoiceoverIpc } from './voiceover'
import { registerLutIpc } from './ipc/lut-ipc'
import { registerFileIpc } from './ipc/file-ipc'
import { registerProjectIpc } from './ipc/project-ipc'
import { registerRecentsIpc } from './ipc/recents-ipc'
import { registerAnalysisIpc } from './ipc/analysis-ipc'
import { registerAgentSessionIpc } from './ipc/agent-session-ipc'
import { registerHelpIpc } from './ipc/help-ipc'
import { foldKey } from './platform-path'
import { devToolsAllowed, launchRefusal, TEST_HOOKS_ARG, testHooksAllowed, type LaunchFacts } from './launch-guard'

// A packaged copy does not start with a debugging switch (security patch,
// item 3; launch-guard.ts): --remote-debugging-port / -pipe, --inspect*,
// --load-extension hand the whole editor to any local program. Before
// anything else: the profile folder, the single-instance lock, a window.
// The one exception is the packaged e2e gate in full (e2e-hooks.ts e2eMode).
const launchFacts: LaunchFacts = { packaged: app.isPackaged, testCopy: e2eMode() }
{
  const refused = launchRefusal(process.argv, launchFacts, process.platform, (s) => app.commandLine.hasSwitch(s))
  if (refused) {
    console.error(`${PRODUCT_NAME} does not start with ${refused}.`)
    app.exit(64)
    process.exit(64)
  }
}

// The copy's name and profile folder come from the product module (channel.ts,
// shared/product.ts; phase 9a, decision 1): a dev copy is "<name> Dev" with a
// profile of its own. Before anything asks for the profile folder, and before
// the single-instance lock (which is kept in it): the product and a dev copy
// can be open together.
app.setName(appNameFor(CHANNEL))
{
  const profile = profileDirFor(CHANNEL, app.getPath('appData'), app.commandLine.hasSwitch('user-data-dir'))
  if (profile) {
    app.setPath('userData', profile)
    // The first start of a new profile folder copies the older app's settings
    // (phase 9a, decision 3; profile-inherit.ts). Before Chromium opens its
    // storage in the folder.
    inheritOnFirstStart(profile, app.getPath('appData'))
  }
}

/** The agent server (agent-host.ts), once the app is ready. Its calls go to
 *  the editor window the user last worked in. */
let agentHost: AgentHost | null = null
/** The agent connection's IPC (agent-session-ipc.ts): its read-only
 *  questions to installed agent programs end with their window or the app. */
let agentSession: { stop: () => void; windowGone: (contentsId: number) => void; repairDetected: () => Promise<string[]> } | null = null
/** The last automatic repair a refused key started (401s come in runs). */
let lastAutoRepair = 0
let lastEditorId: number | null = null
function agentTarget(): { win: BrowserWindow; projectPath: string | null } | null {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && editorWindows.has(w.webContents.id))
  const win = wins.find((w) => w.webContents.id === lastEditorId) ?? wins[0]
  return win ? { win, projectPath: editorWindows.get(win.webContents.id)?.currentProjectPath ?? null } : null
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    // corsEnabled + secure are required for renderer fetch()/crossOrigin
    // loads to succeed — without them Chromium rejects CORS-mode requests
    // to the scheme before they ever reach our handler.
    privileges: { stream: true, supportFetchAPI: true, standard: true, secure: true, corsEnabled: true }
  },
  {
    // A code film's folder (main/codefilm.ts): its page runs in an iframe of
    // its own origin, snippfilm://<id>/, and loads its files by relative URL.
    scheme: FILM_SCHEME,
    privileges: { stream: true, supportFetchAPI: true, standard: true, secure: true, corsEnabled: true }
  }
])

function registerIpc() {
  registerRendersIpc()
  registerModelIpc()
  // The parallel export's render processes (render-workers.ts).
  registerRenderWorkers({
    isEditor: trustedSender,
    isOurPage: ourPage,
    preload: preloadPath(),
    load: loadPage,
    allowedMediaOf: (urls) => urls.map(mediaUrlToPath).filter((p): p is string => !!p && allowedMediaPaths.has(foldKey(p))),
    allowMedia: (p) => {
      allowedMediaPaths.add(foldKey(normalize(p)))
      return pathToMediaUrl(p)
    },
    forgetMedia: (p) => {
      allowedMediaPaths.delete(foldKey(normalize(p)))
    }
  })
  registerMediaIpc()
  registerSampleIpc()
  registerVoiceoverIpc()
  registerHelpIpc()
  registerLutIpc()
  registerFileIpc()

  // Quick-save (Ctrl+S / autosave): only to a path the user already chose
  // through a native dialog in this session.
  // The file is written whole or not at all, one save at a time (safe-write.ts).
  // A file another program wrote since this window last read or saved it (a
  // script, an agent) is not written over:
  // the answer is 'changed-on-disk' until the user says to overwrite (force).
  ipcMain.handle('project:save-direct', async (event, args: { path: string; json: string; force?: boolean; backup?: string }) => {
    const p = normalize(args.path)
    if (!knownProjectPaths.has(p)) return { saved: false, error: 'unknown path' }
    if (typeof args.json !== 'string') return { saved: false, error: 'bad project data' }
    const alreadyOpen = windowUsingProject(p, event.sender.id)
    if (alreadyOpen) {
      focusEditorWindow(alreadyOpen)
      return { saved: false, error: `This project is already open in another ${PRODUCT_NAME} window.` }
    }
    const state = editorState(event.sender)
    return onePerPath(p, async () => {
      const now = await readDiskStamp(p)
      if (args.force !== true && changedOnDisk(state.diskStamps.get(stampKey(p)), now)) {
        return { saved: false, error: 'changed-on-disk', diskTime: now?.mtimeMs ?? 0 }
      }
      // The file as it is now, copied into the profile before it is written
      // over (phase Ç2a.2, decision 4: the first autosave after an open or an
      // explicit save). No copy, no write.
      if (args.backup !== undefined && !(await backupProjectFile(app.getPath('userData'), p, args.backup)).ok) {
        return { saved: false, error: 'backup-failed' }
      }
      // (Its media also relative to it: phase Ç2a.2, decision 3.)
      await writeFileAtomic(p, withRelativePaths(args.json, p))
      state.currentProjectPath = p
      await rememberDiskStamp(state, p)
      return { saved: true, path: p }
    })
  })

  ipcMain.on('app:dirty', (event, dirty: boolean) => {
    editorState(event.sender).dirty = !!dirty
  })
  // The language the page shows (phase 9b): the system dialogs and the
  // crash and quit boxes speak it too (strings-main.ts).
  ipcMain.on('app:set-lang', (_event, l: unknown) => setMainLang(l))
  ipcMain.on('app:new-window', () => {
    createWindow()
  })

  // The agent server (agent-host.ts): on or off, and the page's answers.
  ipcMain.handle('agent:status', () => agentHost?.status() ?? null)
  ipcMain.handle('agent:set-enabled', (_e, on: unknown) => {
    // (Off ends the version questions still running too.)
    if (on !== true) agentSession?.stop()
    return agentHost?.setEnabled(on === true) ?? null
  })
  ipcMain.on('agent:result', (event, id: unknown, result: unknown) => agentHost?.answer(event.sender.id, id, result))
  agentSession = registerAgentSessionIpc({ host: () => agentHost, projectPathOf: (contentsId) => editorWindows.get(contentsId)?.currentProjectPath ?? null })
  // The point before the agent (phase 4A): in the profile, the last five.
  ipcMain.handle('agent:restore-write', (_e, json: unknown, label: unknown) => writeRestorePoint(app.getPath('userData'), json, label))
  ipcMain.handle('agent:restore-read', (_e, name: unknown) => readRestorePoint(app.getPath('userData'), name))
  ipcMain.handle('agent:restore-list', () => listRestorePoints(app.getPath('userData')))
  ipcMain.handle('agent:restore-rekey', (_e, from: unknown, to: unknown, copy: unknown) => rekeyRestorePoints(app.getPath('userData'), from, to, copy === true))
  ipcMain.handle('agent:restore-saved', (_e, key: unknown, id: unknown) => noteRestoreSave(app.getPath('userData'), key, id))
  ipcMain.handle('agent:restore-opened', (_e, key: unknown, id: unknown) => openedRestoreFile(app.getPath('userData'), key, id))
  ipcMain.handle('agent:restore-demote', (_e, name: unknown) => demoteRestorePoint(app.getPath('userData'), name))
  ipcMain.on('app:quit-confirmed', (event) => {
    const state = editorState(event.sender)
    state.forceClose = true
    ownerWindow(event.sender)?.destroy()
  })
  // A clean restart (the page saved first; --reload asks it to): the app
  // starts again with the same project, no quit dialog and no recovery box.
  ipcMain.handle('app:restart', (event) => {
    const win = ownerWindow(event.sender)
    if (!win || win.isDestroyed()) return { ok: false, error: 'no window' }
    // (Another editor window's unsaved work is not thrown away: it saves or
    // the restart waits.)
    if ([...editorWindows.values()].some((s) => s.dirty)) return { ok: false, error: 'unsaved changes' }
    for (const s of editorWindows.values()) {
      s.forceClose = true
      if (s.recoveryPath) {
        try {
          rmSync(s.recoveryPath, { force: true })
          claimedRecoveryPaths.delete(foldKey(s.recoveryPath))
        } catch {
          /* the next launch offers it */
        }
      }
    }
    // (app.exit does not fire will-quit, where the chat's agent process and
    // the version queries would end: end them here.)
    agentSession?.stop()
    app.relaunch({ args: restartArgs(process.argv, editorState(event.sender).currentProjectPath) })
    app.exit(0)
    return { ok: true }
  })
  // An export or a transcription keeps the PC from sleeping while it runs
  // (awake.ts). A page that closes, reloads or crashes lets go of its holds.
  ipcMain.on('app:keep-awake', (event, on: unknown, why: unknown) => {
    if (typeof on !== 'boolean' || typeof why !== 'string' || why.length === 0 || why.length > 64) return
    const contents = event.sender
    const id = contents.id
    if (on && !awakeWatched.has(id)) {
      awakeWatched.add(id)
      const end = (): void => awakeHolds.release(id)
      contents.once('destroyed', () => {
        awakeWatched.delete(id)
        end()
      })
      // Once a new page is really there (did-navigate): a navigation the
      // will-navigate guard blocks (a file dropped outside a drop zone) must
      // not drop the hold of an export still running in the old page.
      contents.on('did-navigate', end)
      contents.on('render-process-gone', end)
    }
    awakeHolds.set(id, on, why)
  })
  ipcMain.on('project:set-current', (event, raw: string | null) => {
    const state = editorState(event.sender)
    if (raw === null) {
      state.currentProjectPath = null
      return
    }
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return
    const p = normalize(raw)
    if (isUserProjectPath(p)) state.currentProjectPath = p
  })
  registerProjectIpc()
  registerRecentsIpc()
  registerAnalysisIpc()
  registerProfileIpc()
}

function createWindow(initialProjectPath: string | null = null): BrowserWindow {
  // --show-inactive (dev runs on the user's PC: the speed check): shown
  // without taking the focus; =offscreen also places it off the screens,
  // still drawing (with the no-occlusion switches), so nothing pops up.
  const inactive = app.commandLine.hasSwitch('show-inactive')
  const win = new BrowserWindow({
    ...(inactive ? { show: false } : {}),
    width: 1500,
    height: 950,
    // 1200 lets the window sit on half of a 2560 screen (or a 1280 laptop);
    // the toolbars fold into their ⋯ menus instead of squeezing.
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#101014',
    title: windowTitleFor(CHANNEL, BRANCH),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // The packaged product opens no DevTools and its page installs no test
      // hooks (security patch, item 3; launch-guard.ts): the preload reads
      // the argument, a page cannot change its own.
      devTools: devToolsAllowed(launchFacts),
      additionalArguments: testHooksAllowed(launchFacts) ? [TEST_HOOKS_ARG] : [],
      // The editor draws exports and runs Whisper: covered or minimised, it
      // keeps its full speed.
      backgroundThrottling: false,
      // Sound starts only in a frame the person has used (the editor, once
      // anything was clicked or typed). A code film's frames are never used
      // by the person (hidden, sandboxed, autoplay not allowed to them), so
      // nothing a film does can make a sound (5a/5b patch, audit C-5; there
      // is no per-frame mute, and muting the window would mute the editor).
      autoplayPolicy: 'document-user-activation-required'
    }
  })
  if (inactive) {
    win.once('ready-to-show', () => {
      if (app.commandLine.getSwitchValue('show-inactive') === 'offscreen') win.setPosition(-6000, -6000)
      win.showInactive()
    })
  }
  guardE2ePage(win.webContents)
  const contentsId = win.webContents.id
  const openedPath = initialProjectPath ? allowProjectPath(initialProjectPath) : null
  const state = newEditorWindowState(openedPath)
  editorWindows.set(contentsId, state)
  // The window an agent's calls go to: the one last worked in.
  lastEditorId = contentsId
  win.on('focus', () => {
    lastEditorId = contentsId
  })

  // F12 (or Ctrl+Shift+I) toggles DevTools in a source build and in a
  // packaged test copy; the packaged product has none (security patch, item
  // 3, B-G6: a pasted line in its console would reach the whole bridge). F11
  // stays full screen, as it was in Electron's default menu (which the app no
  // longer has: its Ctrl+R reloaded the editor past the unsaved-changes check).
  // (macOS also Cmd+Opt+I and Ctrl+Cmd+F: app-menu.ts windowKey, phase 10a.)
  win.webContents.on('before-input-event', (_e, input) => {
    const what = windowKey(input, process.platform)
    if (what === 'devtools') {
      if (devToolsAllowed(launchFacts)) win.webContents.toggleDevTools()
    } else if (what === 'fullscreen') win.setFullScreen(!win.isFullScreen())
  })

  // A new page starts with nothing unsaved (a reload, after a crash): it only
  // says so when that changes, so the window must not keep asking about the
  // old page's changes.
  win.webContents.on('did-navigate', () => {
    state.dirty = false
  })

  // The editor page died (out of memory or a GPU fault: an English
  // transcription loads about 2 GB into it). The window used to stay blank,
  // and closing it removed the last crash-recovery snapshot, the only copy of
  // the unsaved work. Now the snapshot is kept, and Reload offers it.
  let crashAsked = false
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || state.forceClose || win.isDestroyed()) return
    state.crashed = true
    if (crashAsked) return
    crashAsked = true
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        buttons: [mt('crash.reload'), mt('crash.close')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message: mt('crash.message', { reason: details.reason }),
        detail: state.recoveryPath ? mt('crash.kept', { app: PRODUCT_NAME }) : mt('crash.none')
      })
      .then(({ response }) => {
        crashAsked = false
        if (win.isDestroyed()) return
        if (response === 0) {
          // `crashed` stays until the new page has read its snapshot
          // (recovery:read): closing before that still keeps it.
          win.webContents.reload()
        } else {
          state.forceClose = true
          win.destroy()
        }
      })
  })

  // Closing with unsaved changes asks first — in the app's OWN dialog. The
  // native message box is a white system window that looks nothing like the
  // editor; the renderer draws the question instead and answers over IPC.
  let quitAsked = 0
  win.on('close', (event) => {
    // A dead page cannot answer, and its snapshot is kept ('closed').
    if (!state.dirty || state.forceClose || state.crashed) return
    event.preventDefault()
    // Safety net: if the renderer is wedged and never draws the dialog, the
    // window would be impossible to close. A second close attempt after the
    // grace period falls back to the native box.
    const now = Date.now()
    if (now - quitAsked < 4000) {
      void dialog
        .showMessageBox(win, {
          type: 'question',
          buttons: [mt('quit.discard'), mt('quit.cancel')],
          defaultId: 1,
          cancelId: 1,
          message: mt('quit.message'),
          detail: mt('quit.detail')
        })
        .then(({ response }) => {
          if (response === 0) {
            state.forceClose = true
            win.destroy()
          }
        })
      return
    }
    quitAsked = now
    win.webContents.send('app:confirm-quit')
  })

  win.on('closed', () => {
    editorWindows.delete(contentsId)
    agentHost?.windowGone(contentsId)
    agentSession?.windowGone(contentsId)
    // A crash snapshot offered here and not answered: kept, for the next
    // window or launch to offer again.
    if (state.pendingRecoveryPath) claimedRecoveryPaths.delete(foldKey(state.pendingRecoveryPath))
    if (state.recoveryPath) {
      claimedRecoveryPaths.delete(foldKey(state.recoveryPath))
      // After the page died, its last snapshot is the only copy of the work.
      if (state.crashed) return
      try {
        rmSync(state.recoveryPath, { force: true })
      } catch {
        /* best-effort cleanup during a normal window close */
      }
    }
  })

  win.webContents.setWindowOpenHandler(() => {
    // No external browser escape hatch: even an accidental link remains local.
    return { action: 'deny' }
  })

  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}

// On a hybrid-graphics laptop (integrated iGPU + discrete NVIDIA/AMD) Chromium
// may pick the integrated chip, which is far slower for WebGPU transcription
// and video decode. Ask for the discrete GPU explicitly.
app.commandLine.appendSwitch('force_high_performance_gpu')

// Wheel scrolling in Electron lands in one hard jump per notch. In a panel of
// sliders and lists that reads as a ratchet — the inspector, the media bin and
// the transcript all "step" instead of moving. This is the same animated
// scrolling Chrome ships with on Windows, off by default here only because
// Electron doesn't enable it.
app.commandLine.appendSwitch('enable-smooth-scrolling')

// Never throttled behind other windows, in every Snipp process (awake.ts).
appendAwakeSwitches(app.commandLine)

app.enableSandbox()
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-domain-reliability')
app.commandLine.appendSwitch('disable-quic')
// (No `force-webrtc-ip-handling-policy` switch: Electron ignores it, a film
// page still sent UDP to any address (5c + 5d audit, Y1). Every webContents
// gets the policy itself: 'web-contents-created' below.)
if (app.isPackaged) {
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND')
  app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:9')
  app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>')
}

/** Who asked, as Chromium names it: the asking frame's and its ancestors'
 *  addresses and origins, and the referrer (film-fence.ts). */
function askerFrom(details: Electron.OnBeforeRequestListenerDetails): Asker {
  const frames: string[] = []
  try {
    for (let f: Electron.WebFrameMain | null | undefined = details.frame; f; f = f.parent) {
      frames.push(f.url, f.origin)
    }
  } catch {
    /* a frame gone meanwhile: what was read so far */
  }
  return { frames, referrer: details.referrer || '' }
}

/** The only local files a page may ask for over file: (security patch, item
 *  4; network.ts): the folder the app's own page is served from.
 *  What this filter does NOT see is what a worker asks for itself (as with
 *  media://: film-fence.ts): the page's own policy covers a worker made from
 *  a blob (connect-src names no file: address: renderer/index.html); a worker
 *  started from a .js file lying on the disk is the known limit
 *  (SECURITY-REVIEW.md). A file: handler of the session was tried for it and
 *  taken out again: Chromium never asks it for a worker's requests either. */
const OWN_FILES = ownFilesRoot(rendererEntry)

function secureSession(ses: Session): void {
  // Every permission refused but the voice-over's microphone, for the
  // editor's own page right after its Record press (voiceover.ts).
  guardPermissions(ses)
  ses.webRequest.onBeforeRequest((details, callback) => {
    let cancel = !isAllowedAppRequest(details.url, devUrl, OWN_FILES)
    // (Only a test run: one film host page refused, e2e-hooks.ts 'fail-host'.)
    if (!cancel && e2eFailHostPage(details.url)) cancel = true
    // The app's own schemes: may THIS requester have THIS address (the
    // user's media, a film's folder)? Decided here, per request, from the
    // frame Chromium names, not by the page (film-fence.ts; 5a/5b patch C-1).
    if (!cancel && /^(media|snippfilm):/i.test(details.url)) {
      const asker = askerFrom(details)
      const v = fenceAnswer(details.url, asker)
      if (!v.allow) {
        cancel = true
        if (v.film) films.noteBlocked(v.film, details.url)
      }
      e2eNoteWebRequest({ url: details.url, frames: [...asker.frames],referrer: asker.referrer, type: details.resourceType, film: v.film || null, allowed: v.allow })
    }
    callback({ cancel })
  })
  // What the filter let through is stamped; the handlers serve nothing else
  // (film-fence.ts FENCE_HEADER: a worker's requests skip this filter).
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders }
    for (const k of Object.keys(requestHeaders)) if (k.toLowerCase() === FENCE_HEADER) delete requestHeaders[k]
    if (/^(media|snippfilm):/i.test(details.url)) requestHeaders[FENCE_HEADER] = FENCE_SECRET
    callback({ requestHeaders })
  })
  ses.on('will-download', (event) => event.preventDefault())
  if (app.isPackaged) {
    // Covers Chromium background traffic too; Windows Firewall is the separate
    // OS-level boundary for native/Node sockets and all Snipp child processes.
    void ses.setProxy({ mode: 'fixed_servers', proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9;socks=127.0.0.1:9', proxyBypassRules: '<-loopback>' })
  }
}
app.on('session-created', secureSession)

/** Keep one Electron MAIN process so Chromium storage and the shared model
 * cache stay coherent. Each subsequent Snipp.exe launch creates an independent
 * editor WINDOW in that process; it is still multi-project, without competing
 * processes corrupting the same userData directory. */
// A render worker has its own user data folder and never takes the lock (it
// is not another editor).
const isPrimaryInstance = renderWorker || app.requestSingleInstanceLock()
// A render worker (a hidden copy drawing part of an export) has no Dock icon
// on macOS (phase 10a, W5).
if (hideFromDock(process.platform, renderWorker)) app.dock?.hide()
if (!isPrimaryInstance) app.quit()

/**
 * A project file handed to us by the OS: double-clicking a .snipp, or "Open
 * with". The installer registers the association, so Windows sends the path as
 * an argument — and nothing was reading it, which meant double-clicking a
 * project opened an empty editor.
 */
function projectPathFromArgv(argv: string[]): string | null {
  // A restart names the project it had open (`--reopen=<path>`): the path is
  // the one this app itself wrote, never one an agent chose.
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    const raw = /^--reopen=(.+)$/i.test(a) ? a.slice('--reopen='.length) : a.toLowerCase() === '--reopen' ? argv[i + 1] : undefined
    const p = raw?.replace(/^"(.*)"$/, '$1').trim()
    if (p && isLocalFilePath(p) && existsSync(path.normalize(p))) return path.normalize(p)
  }
  // Every argument, not argv.slice(1): at launch argv[0] is the executable, but
  // the array handed to `second-instance` is not guaranteed to start with it,
  // and dropping the first entry there dropped the file. The executable is
  // called Snipp.exe, so scanning all of them costs nothing. Switches (--foo)
  // are never file names.
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue
    if (!/\.(snipp|autocut)$/i.test(arg)) continue
    if (!isLocalFilePath(arg)) continue
    const p = path.normalize(arg)
    if (existsSync(p)) return p
  }
  return null
}

/** A project file named on the command line that is not there (a typo
 *  opened a blank editor without a word: the window looked like a new
 *  project). Null when every name is fine. */
function missingProjectArg(argv: string[]): string | null {
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue
    if (!/\.(snipp|snip|autocut)$/i.test(arg)) continue
    if (!isLocalFilePath(arg)) continue
    const p = path.normalize(arg)
    if (!existsSync(p)) return p
  }
  return null
}

/** The arguments a clean restart comes back with: the same ones, without
 *  --reload, and with this window's project named (the app may have been
 *  launched without one, and a project picked in it is not in argv). */
function restartArgs(argv: string[], project: string | null): string[] {
  const rest = argv.slice(1).filter((a) => !/^--reload$/i.test(a) && !/^--reopen(?:=|$)/i.test(a))
  const had = project && rest.some((a) => foldKey(normalize(a)) === foldKey(normalize(project)))
  return project && !had ? [...rest, `--reopen=${project}`] : rest
}

/** `--reload`: the running app saves and starts again (a code change, a new
 *  build). */
const reloadArg = (argv: string[]): boolean => argv.some((a) => /^--reload$/i.test(a))

/** A repeated icon launch opens a blank editor. A project file opens in its own
 * editor too, unless that exact file is already open — concurrent writes to
 * one .snipp file are never safe, so that window is focused instead. */
function openLaunchInEditor(argv: string[]): void {
  // --reload: the open editor saves and the app starts again, instead of a
  // second bare window (the window's own close would otherwise ask about
  // unsaved changes and wait).
  if (reloadArg(argv)) {
    const win =
      BrowserWindow.getFocusedWindow() && editorWindows.has(BrowserWindow.getFocusedWindow()!.webContents.id)
        ? BrowserWindow.getFocusedWindow()!
        : BrowserWindow.getAllWindows().find((w) => w.webContents.id === lastEditorId && editorWindows.has(w.webContents.id)) ??
          BrowserWindow.getAllWindows().find((w) => editorWindows.has(w.webContents.id))
    if (win) {
      focusEditorWindow(win)
      win.webContents.send('app:save-and-restart')
      return
    }
    // (Nothing open: --reload is a plain launch.)
  }
  if (openFilmLaunch(argv)) return
  const p = projectPathFromArgv(argv)
  if (p) {
    const key = foldKey(normalize(p))
    for (const win of BrowserWindow.getAllWindows()) {
      if (foldKey(editorWindows.get(win.webContents.id)?.currentProjectPath) === key) {
        focusEditorWindow(win)
        return
      }
    }
  }
  // A named project that is not there: said, not opened as a blank editor.
  const missing = p ? null : missingProjectArg(argv)
  if (missing) {
    const open = BrowserWindow.getAllWindows().find((w) => editorWindows.has(w.webContents.id))
    const show = (target: BrowserWindow | null): void => {
      const box = { type: 'error' as const, message: mt('open.missing'), detail: missing, buttons: [mt('ok')] }
      if (target) void dialog.showMessageBox(target, box)
      else void dialog.showMessageBox(box)
    }
    if (open) {
      focusEditorWindow(open)
      show(open)
      return
    }
    const win = createWindow(null)
    win.once('ready-to-show', () => show(win))
    return
  }
  createWindow(p)
}

/** `--code-film=<folder>` (VideoHub's "Snipp'te aç"): the film's own Snipp
 *  project (<film>/snipp/<film>.snipp) opens, or is focused when a window has
 *  it open (its page already follows the film's code). With no project yet, a
 *  new window puts the film on the timeline and saves it there. */
function openFilmLaunch(argv: string[]): boolean {
  const raw = filmFolderArg(argv)
  if (!raw || !isLocalFilePath(raw)) return false
  const folder = path.normalize(raw)
  if (!existsSync(path.join(folder, 'index.html'))) return false
  const project = filmProjectPath(folder)
  const key = foldKey(normalize(project))
  for (const win of BrowserWindow.getAllWindows()) {
    const state = editorWindows.get(win.webContents.id)
    if (foldKey(state?.currentProjectPath) === key || foldKey(state?.pendingFilm?.project) === key) {
      focusEditorWindow(win)
      return true
    }
  }
  if (existsSync(project)) {
    createWindow(project)
    return true
  }
  const win = createWindow(null)
  const state = editorWindows.get(win.webContents.id)
  if (state) state.pendingFilm = { folder, project: allowProjectPath(project) }
  return true
}

/** The app's copy of three.js 0.170.0 (phase 5c, decision 5): beside the
 *  app when packaged (extraResources), the source tree's vendor folder else. */
const threeDir = (): string => (app.isPackaged ? path.join(process.resourcesPath ?? '', 'three') : path.join(app.getAppPath(), 'vendor', 'three'))

// Launches before the app is ready wait, in order (launch-queue.ts): a second
// launch's arguments, and on macOS a file opened from Finder (open-file, which
// can come before ready; phase 10a, W2). Windows sends files as arguments only.
const launches = new LaunchQueue<string[]>((argv) => openLaunchInEditor(argv))
app.on('second-instance', (_e, argv) => {
  if (renderWorker) return
  launches.push(argv)
})
app.on('open-file', (event, file) => {
  event.preventDefault()
  if (renderWorker) return
  launches.push(argvForOpenFile(file))
})

app.whenReady().then(() => {
  // The losing instance is already on its way out; it must not open a window
  // or register handlers on the way.
  if (!isPrimaryInstance) return
  // An end-to-end test window (scripts/e2e): the OS dialogs, Explorer and the
  // clipboard answered by the test. If they cannot be replaced, no window.
  try {
    installE2eHooks()
  } catch (err) {
    console.error(String(err))
    app.exit(3)
    return
  }
  // No application menu. Electron's default one (made when an app sets
  // none) reloaded the editor on Ctrl+R / Ctrl+Shift+R past the
  // unsaved-changes check, zoomed the whole UI on Ctrl+- / Ctrl++, closed the
  // window on Ctrl+W and toggled DevTools twice on Ctrl+Shift+I. Copy, paste
  // and undo in text fields work without it on Windows; F12, Ctrl+Shift+I and
  // F11 are handled in createWindow (before-input-event). macOS gets a small
  // menu of its own (app-menu.ts: Edit's roles reach text fields only from a
  // menu there, and Cmd+Q), still without reload, zoom or DevTools items.
  const menu = menuTemplate(process.platform, appNameFor(CHANNEL))
  Menu.setApplicationMenu(menu ? Menu.buildFromTemplate(menu as Electron.MenuItemConstructorOptions[]) : null)
  protocol.handle('media', (request) => {
    e2eNoteRequest('media', request, stamped(request))
    // Only what the request filter judged (film-fence.ts): a worker's request
    // never passed it.
    if (!stamped(request)) return new Response('Forbidden', { status: 403, headers: corsHeaders(editorOrigin(devUrl)) })
    return serveMedia(request, editorOrigin(devUrl))
  })
  protocol.handle(FILM_SCHEME, (request) => {
    e2eNoteRequest(FILM_SCHEME, request, stamped(request))
    if (!stamped(request)) return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store', 'Content-Security-Policy': FILM_CSP } })
    return serveFilm(films, request, e2eFilmPolicy(), threeDir(), filmValues)
  })

  secureSession(session.defaultSession)

  // Lock navigation to our own UI.
  app.on('web-contents-created', (_e, contents) => {
    // WebRTC sends no UDP but through a proxy, and there is none: a code film
    // (in the editor's frame or in its drawing window) cannot reach a STUN /
    // TURN address of its choosing (5c + 5d audit, Y1; e2e 65).
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedDocument(url, rendererEntry, devUrl)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedDocument(url, rendererEntry, devUrl)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    // Frames inside a page (a code film's host and its film) stay on their
    // own registered snippfilm:// folder: a film never on another film's
    // (phase 5a, decision 5; codefilm.ts filmFrameMayGo).
    contents.on('will-frame-navigate', (details) => {
      if (details.isMainFrame) return
      let ok = false
      let why = ''
      let from: (string | null)[] = []
      try {
        const u = new URL(details.url)
        const known = (id: string): boolean => !!films.root(id)
        from = [details.frame?.parent?.url ?? null, details.initiator?.url ?? null]
        ok = details.url === 'about:blank' || (u.protocol === FILM_SCHEME + ':' && filmFrameMayGo(details.url, from[0], from[1], known))
      } catch (e) {
        ok = false
        why = String(e).slice(0, 200)
      }
      // (A test run reads what was decided here: a film that never starts.)
      if (/^snippfilm:/i.test(details.url)) e2eNoteWebRequest({ url: details.url, frames: from.map((f) => String(f)), referrer: why, type: 'will-frame-navigate', film: null, allowed: ok })
      if (!ok) details.preventDefault()
    })
  })

  // A render worker: one hidden window drawing stretches of another's film.
  if (renderWorker) {
    startRenderWorker({
      isOurPage: ourPage,
      preload: preloadPath(),
      load: loadPage,
      allowMedia: (paths) => {
        for (const p of paths) if (isLocalFilePath(p)) allowedMediaPaths.add(foldKey(normalize(p)))
      }
    })
    return
  }

  registerIpc()
  // The drawing windows of code films that show more than canvases (phase
  // 5d.1, film-window.ts): each in a session of its own that serves its own
  // film's folder and nothing else.
  registerFilmWindows({
    known: (id) => !!films.root(id),
    serve: (request) => {
      e2eNoteRequest(FILM_SCHEME, request, stamped(request))
      if (!stamped(request)) return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store', 'Content-Security-Policy': FILM_CSP } })
      return serveFilm(films, request, e2eFilmPolicy(), threeDir(), filmValues)
    },
    noteBlocked: (id, url) => films.noteBlocked(id, url),
    memoryLimitKb: e2eFilmMemoryKb
  })
  // The agent server: off unless the user turned it on (or --agent). It
  // listens on this computer only and opens no connection itself.
  agentHost = new AgentHost({
    userData: () => app.getPath('userData'),
    port: e2eAgentPort() ?? agentPortFor(CHANNEL),
    version: app.getVersion(),
    name: agentNameFor(CHANNEL),
    forced: app.commandLine.hasSwitch('agent'),
    target: agentTarget,
    projectPathOf: (win) => editorWindows.get(win.webContents.id)?.currentProjectPath ?? null,
    timeoutMs: e2eAgentTimeout() ?? undefined,
    // (An agent from outside began or ended: the editor windows ask again.)
    changed: () => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && editorWindows.has(w.webContents.id)) w.webContents.send('agentLink:changed')
    },
    // (A key was refused: once a minute, repair the detected programs whose
    // registration still holds another one. The refused request's own
    // program still has to reconnect or restart.)
    keyRefused: () => {
      const now = Date.now()
      if (now - lastAutoRepair < 60_000) return
      lastAutoRepair = now
      void agentSession?.repairDetected().then((fixed) => {
        if (!fixed.length) return
        for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && editorWindows.has(w.webContents.id)) w.webContents.send('agentLink:changed')
      })
    }
  })
  void agentHost.init()
  if (!openFilmLaunch(process.argv)) createWindow(projectPathFromArgv(process.argv))
  launches.ready()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

// A clean shutdown drops only snapshots owned by live windows. Unclaimed files
// came from an earlier crash and must remain available to recover.
app.on('will-quit', () => {
  // The parallel export's render processes go with the app.
  closeAllRenderWorkers()
  closeAllFilmWindows()
  stopVersionKeepers()
  rendersWatcher?.close()
  // The read-only questions to agent programs still running go now.
  agentSession?.stop()
  void agentHost?.close()
  for (const state of editorWindows.values()) {
    // Only the windows' own snapshots: never one still waiting for an answer,
    // nor the last one of a page that died.
    if (!state.recoveryPath || state.crashed) continue
    try {
      rmSync(state.recoveryPath, { force: true })
    } catch {
      /* nothing useful to do while quitting */
    }
  }
})
