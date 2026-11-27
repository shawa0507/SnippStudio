// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { contextBridge, ipcRenderer, sharedTexture, webUtils } from 'electron'
import type { Slot as CodeValueSlot } from '../shared/codeval/types'
import type { ChatEvent, ChatImage, ChatMode, ChatModels, ChatRewindResult, ChatSessionDraft, ChatSessionMeta, ChatSessionRecord, ChatStatus } from '../shared/agent-chat'

export interface ImportedFile {
  path: string
  name: string
  size: number
  /** The file's last-modified time (ms, rounded): with the size, its
   *  fingerprint (phase Ç2a.2, decision 2). */
  mtime?: number
  url: string
}

export interface LibrarySound extends ImportedFile { id: string }

/** A code film folder as main registered it (main/codefilm.ts). */
export interface CodeFilmInfo {
  id: string
  root: string
  url: string
  name: string
  mix: { path: string; url: string; size: number } | null
  meta: { duration: number | null; fps: number | null }
}

/** A picture of a code film's drawing window (main/film-window.ts), as
 *  Electron hands a shared texture to a page. */
export interface FilmPageTexture {
  getVideoFrame: () => VideoFrame
  release: () => void
}
/** Which window it is of (`key`), its number, its size in device pixels and
 *  how many of its last rows are the marker row. */
export interface FilmPageTextureMeta {
  key: string
  seq: number
  width: number
  height: number
  rows: number
}
let pageTextureTaker: ((texture: FilmPageTexture, meta: FilmPageTextureMeta) => Promise<void>) | null = null
try {
  // (Experimental in Electron 43; a page that never draws a code film's
  // whole page never gets one.)
  sharedTexture.setSharedTextureReceiver(async (data, meta: FilmPageTextureMeta) => {
    const texture = data.importedSharedTexture
    if (pageTextureTaker) await pageTextureTaker(texture, meta)
    else texture.release()
  })
} catch {
  /* no shared textures here: such a page says so when it is asked a frame */
}

export interface ImportedFolder {
  folder: string
  files: (ImportedFile & { folder: string })[]
  /** The folder held more media than one scan takes: only the first
   *  `files.length` of `total` (in numbered name order) came back. */
  truncated?: boolean
  total?: number
}

/** A project's media file as main found it (main/media.ts ResolvedMedia):
 *  its URL, its fingerprint (size, mtime) and where it is now. */
export interface ResolvedMedia {
  url: string
  size: number
  mtime?: number
  path?: string
  /** How it was found (main/project-media.ts MediaFound): a file found away from its own path stood for the asset only when its stored size confirmed it, or by relPath when it has none (Ç2a patch). */
  via?: 'path' | 'rel' | 'name'
  /** A code film folder that is there but may not run yet (security patch,
   *  item 6): no address; the user is asked (codeFilm.trustAsks). */
  untrusted?: true
}

export interface OpenedProject {
  json?: string
  path?: string
  resolved?: Record<string, ResolvedMedia | null>
  error?: string
}

export interface RecentEntry {
  path: string
  name: string
  thumbnail?: string
  durationSec: number
  width: number
  height: number
  lastOpened: number
  sizeBytes: number
  /** Set by the read: the file is not there now (moved, deleted, a drive
   *  not connected). The entry stays until the user removes it. */
  missing?: boolean
}

/** "Find projects" while it runs: folders searched, projects found. */
export interface FindProgress {
  phase: 'search' | 'read'
  dirs: number
  found: number
  current: string
}

/** What the parallel export's worker count is picked from (main's view). */
export interface RenderMachine {
  cpus: number
  totalMem: number
  freeMem: number
  gpu: boolean
}

/** A render process's answer: its stretch written (and where, for the
 *  join), or why not; the pixel hashes of the frames it was asked to probe
 *  (the exactness check). */
export interface RenderWorkerResult {
  ok: boolean
  error?: string
  probes?: Record<number, string>
  url?: string
}

export interface FindResult {
  found: number
  added: number
  dirs: number
  truncated: boolean
  cancelled: boolean
  roots: string[]
}

/** One tool call from the agent server to this window's page. */
export interface AgentCall {
  id: string
  tool: string
  args: Record<string, unknown>
  /** This window's project file, when it has been saved. */
  projectPath: string | null
  /** The MCP session the call belongs to (phase 4A): its agent program and
   *  the size of the tool definitions it was sent. */
  session?: { id: string; client: string; defsChars: number }
  /** Past this moment (Date.now()) the server has given up: not done. */
  deadline?: number
  /** The whole time the call was given (ms): the page keeps a margin of it
   *  before the deadline (phase 4A.8, G5). */
  budget?: number
}

/** The agent server as the page shows it. The server's secret is not part of
 *  it and never reaches the page (security patch, item 7): it stays in the
 *  profile's files and in the main process. */
export interface AgentStatus {
  /** The user turned it on (kept across launches). */
  enabled: boolean
  /** It is listening now. */
  running: boolean
  port: number
  url: string
  /** Why it is not running although it is on (the port is taken, …). */
  error: string | null
}

/** The agents the Settings window knows (main/agent-connect.ts). */
export type AgentKindId = 'claude' | 'codex' | 'opencode' | 'antigravity'

/** The agent connection as the page shows it (main/ipc/agent-session-ipc.ts). */
export interface AgentSessionStatus {
  server: AgentStatus | null
  /** The agent programs found on this computer. */
  agents: { id: AgentKindId; path: string }[]
  /** An agent working from outside: its program's name, last heard from. */
  external: { client: string; seen: number } | null
  /** Each program's last active session and the latest refused request
   *  (SIHIRBAZ-PLAN.md, 4): names and times only. */
  heard: { seen: { client: string; at: number }[]; refused: { why: 'key' | 'session'; at: number } | null }
}

/** How an agent has this copy registered (main/agent-connect.ts registrationState). */
export type AgentRegistration = 'ok' | 'missing' | 'stale' | 'oldKey' | 'notInstalled' | 'unknown'

export interface AgentInstallation {
  id: AgentKindId
  installed: boolean
  version: string | null
}

/**
 * The path of a file the user dropped on the window, taken from the File
 * object itself (22 Nov, K4). The page never says a path for "this was
 * dropped": it hands over the File, and only a File that came from the
 * system (a drop, a file input) has a path; one a script made has none, and
 * text is not a File. (The handlers took the path as text from the page: a
 * script in the page could then name any project file on the disk as
 * "dropped" and save over it, rename it or bin it with no window asked.)
 */
function droppedPath(file: unknown): string {
  if (!file || typeof file !== 'object') return ''
  try {
    return webUtils.getPathForFile(file as File)
  } catch {
    return ''
  }
}

const api = {
  /** Local user-owned SFX library; only the native picker may add files. */
  listSoundEffects: (): Promise<LibrarySound[]> => ipcRenderer.invoke('sfx:list'),
  importSoundEffects: (): Promise<LibrarySound[]> => ipcRenderer.invoke('sfx:import'),
  openMediaDialog: (): Promise<ImportedFile[]> => ipcRenderer.invoke('dialog:open-media'),
  /** Pick exactly one still image for an in-place timeline replacement. */
  openImageDialog: (): Promise<ImportedFile | null> => ipcRenderer.invoke('dialog:open-image'),
  /** A dropped item that turns out to be a folder: its media comes back tagged
   *  with the folder name. Null when it isn't a directory. (The dropped File,
   *  never a path: droppedPath above.) */
  registerDroppedFolder: (file: File): Promise<ImportedFolder | null> => ipcRenderer.invoke('media:register-dropped-folder', droppedPath(file)),
  saveFile: (args: {
    defaultName: string
    filterName: string
    extensions: string[]
    data: Uint8Array | string
  }): Promise<{ saved: boolean; path?: string; error?: string }> => ipcRenderer.invoke('dialog:save-file', args),
  openProjectDialog: (): Promise<OpenedProject | null> => ipcRenderer.invoke('dialog:open-project'),
  /** Resolves a dropped File to its on-disk path (empty string if synthetic). */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** Registers a dropped media file (validated in main) and returns its media:// info. */
  /** Relink (phase Ç2a.2): which of `names` are media files in the folder
   *  of `picked` (a file just chosen in the open dialog). */
  // A project's .cube LUT file, read by the path the project stores (found
  // beside the project file when it moved): null when it is not there.
  lutRead: (lut: { path: string; relPath?: string; size?: number }): Promise<{ text: string; path: string; size: number; mtime: number; via: 'path' | 'rel' | 'name' } | null> =>
    ipcRenderer.invoke('lut:read', lut),
  findMediaInFolder: (picked: string, names: string[]): Promise<ImportedFile[]> => ipcRenderer.invoke('media:find-in-folder', picked, names),
  /** (The dropped File, never a path: droppedPath above.) */
  registerDroppedMedia: (file: File): Promise<ImportedFile | null> =>
    ipcRenderer.invoke('media:register-dropped', droppedPath(file)),
  /** The agent's import: local paths it names (validated in main: a media
   *  extension, a file that is there) come back as media:// info. */
  importMediaPaths: (paths: string[]): Promise<ImportedFile[]> => ipcRenderer.invoke('media:import-paths', paths),
  /** Tell main which media files this window shows (path, size, mtime): a
   *  file changed on disk comes back over onMediaChanged. */
  watchMedia: (files: { path: string; size: number; mtime?: number }[]): void => ipcRenderer.send('media:watch', files),
  onMediaChanged: (cb: (files: { path: string; size: number; mtime: number }[]) => void): (() => void) => {
    const listener = (_e: unknown, files: { path: string; size: number; mtime: number }[]): void => cb(files)
    ipcRenderer.on('media:changed', listener)
    return () => {
      ipcRenderer.removeListener('media:changed', listener)
    }
  },
  /** Quick-save to a project path already chosen via a dialog this session.
   *  error 'changed-on-disk' (diskTime: the file's time now): another program
   *  wrote the file since this window opened or saved it, and nothing was
   *  written; `force` writes over it (the user said Overwrite). `backup`
   *  (the project's uid): the file as it is is copied into the profile's
   *  yedekler folder first (phase Ç2a.2, main/backups.ts); error
   *  'backup-failed': it could not be, and nothing was written. */
  saveProjectDirect: (
    p: string,
    json: string,
    force = false,
    opts?: { backup?: string }
  ): Promise<{ saved: boolean; path?: string; error?: string; diskTime?: number }> =>
    ipcRenderer.invoke('project:save-direct', { path: p, json, force: force === true, ...(typeof opts?.backup === 'string' ? { backup: opts.backup } : {}) }),
  /** Allocates and registers a new .snipp path without showing a save dialog. */
  createProjectFile: (args?: { dir?: string; name?: string }): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('project:create-file', args ?? {}),
  /** Tells the main process whether the project has unsaved changes. */
  setDirty: (dirty: boolean): void => ipcRenderer.send('app:dirty', dirty),
  /** Holds the PC awake (on) or lets go (off) while an export or a
   *  transcription runs; every on is matched by one off. */
  keepAwake: (on: boolean, why: string): void => ipcRenderer.send('app:keep-awake', on, why),
  /** Opens another independent editor window in the shared Snipp process. */
  newWindow: (): void => ipcRenderer.send('app:new-window'),
  /** The language the page shows ('en' / 'tr'): the system dialogs and the
   *  crash and quit boxes speak it too (phase 9b). */
  setUiLang: (lang: string): void => ipcRenderer.send('app:set-lang', lang),
  /** Identifies the project owned by this editor window. Used to avoid opening
   * the same writable file in two windows while allowing different projects. */
  setCurrentProjectPath: (path: string | null): void => ipcRenderer.send('project:set-current', path),
  /** Fired when the user chose "Save and quit" in the close dialog. */
  onSaveAndQuit: (cb: () => void): void => {
    ipcRenderer.on('app:save-and-quit', cb)
  },
  /** The window is trying to close with unsaved changes: the renderer shows its
   *  own themed dialog and replies via confirmQuit(). */
  onConfirmQuit: (cb: () => void): void => {
    ipcRenderer.on('app:confirm-quit', cb)
  },
  /** Confirms the app may now close (after a successful save). */
  confirmQuit: (): void => ipcRenderer.send('app:quit-confirmed'),
  /** The user (or --reload) asked for a save and a clean restart. */
  onSaveAndRestart: (cb: () => void): void => {
    ipcRenderer.on('app:save-and-restart', cb)
  },
  /** Restarts the app at once; only after the project was saved (main
   *  refuses while it still has unsaved changes). */
  restartApp: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('app:restart'),
  /** A project file the OS asked us to open — a double-clicked .snipp, at
   *  launch or while the window is already up. Main allowlists the path before
   *  sending it, so opening it goes through the same guarded reader as a
   *  dialog pick. */
  /** The project the app was launched with, if any. Claimed once, on mount —
   *  a push at page-load time arrives before React is listening. */
  takePendingProject: (): Promise<string | null> => ipcRenderer.invoke('project:pending-open'),
  onOpenProject: (cb: (path: string) => void): void => {
    ipcRenderer.on('app:open-project', (_e, p: string) => {
      if (typeof p === 'string') cb(p)
    })
  },
  /** Two-step save: choose the destination BEFORE rendering, then write to it
   *  afterwards — so a long export asks "where?" first and can abort for free. */
  /** (Only the chosen file becomes writable; an export's other outputs are
   *  asked for with exportPlace.approve: 22 Nov, K1.) */
  chooseSavePath: (args: { defaultName: string; filterName: string; extensions: string[] }): Promise<string | null> =>
    ipcRenderer.invoke('dialog:choose-save', args),
  /** The export window's name and place (REF-AB item 11): whether a folder
   *  is one the user chose (and is there), the system's folder window, and
   *  the window's files in such a folder made writable (`exists`: names
   *  already there, asked about first; `replace` when the user agreed). */
  exportPlace: {
    known: (dir: string): Promise<string | null> => ipcRenderer.invoke('export:place-known', dir),
    chooseFolder: (at?: string): Promise<string | null> => ipcRenderer.invoke('dialog:choose-export-folder', at),
    approve: (dir: string, files: string[], replace = false): Promise<{ ok: boolean; paths?: string[]; exists?: string[]; error?: string }> =>
      ipcRenderer.invoke('export:approve', { dir, files, replace })
  },
  writeChosenFile: (path: string, data: Uint8Array): Promise<{ saved: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('file:write-chosen', { path, data }),
  /** A long export written as it is made, to a path chosen above: opened,
   *  written at positions, then kept (renamed into place) or dropped. A
   *  12-minute film is about 3 GB: more than one buffer can hold. */
  streamFile: {
    open: (path: string): Promise<string> => ipcRenderer.invoke('file:stream-open', path),
    write: (id: string, position: number, data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('file:stream-write', id, position, data),
    close: (id: string, keep: boolean): Promise<boolean> => ipcRenderer.invoke('file:stream-close', id, keep),
    /** The written file read back before it is kept (the export's check). */
    read: (id: string, position: number, length: number): Promise<Uint8Array> => ipcRenderer.invoke('file:stream-read', id, position, length),
    size: (id: string): Promise<number> => ipcRenderer.invoke('file:stream-size', id)
  },
  /** The free space (bytes) where a chosen file goes; null when not known. */
  freeSpace: (path: string): Promise<number | null> => ipcRenderer.invoke('file:free-space', path),
  /** A path in the batch folder, made writable for a streamed export. */
  batchChoosePath: (name: string): Promise<string | null> => ipcRenderer.invoke('batch:choose-path', name),
  /** <video>.youtube.txt beside a video saved to a chosen path (the
   *  YouTube package: chapters and a description draft). */
  writeBeside: (path: string, kind: 'youtube', text: string): Promise<{ saved: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('file:write-beside', { path, kind, text }),
  /** Text to the system clipboard (written by main: the page's own
   *  navigator.clipboard is refused by the locked-down permissions). */
  clipboardWriteText: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:write-text', text),
  /** Batch export: pick a destination folder once, then write files into it
   *  without a dialog per file. Main owns the path and confines the writes. */
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:choose-folder'),
  /** Copies one of the project's media files into <chosen folder>/media/.
   *  Used by "Archive project", which makes a project self-contained. */
  archiveCopy: (source: string, name: string): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }> =>
    ipcRenderer.invoke('archive:copy', { source, name }),
  /** Copies one of the project's LUT files into <chosen folder>/luts/ (phase 11b, A17). */
  archiveCopyLut: (lut: { path: string; relPath?: string; size?: number; name: string }): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }> =>
    ipcRenderer.invoke('archive:copy-lut', lut),
  batchWrite: (name: string, data: Uint8Array): Promise<{ saved: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('batch:write', { name, data }),
  /** Crash recovery: a snapshot in userData that also covers never-saved
   *  projects. The main process owns the file path; we only pass JSON. */
  recoveryWrite: (json: string): Promise<boolean> => ipcRenderer.invoke('recovery:write', json),
  recoveryRead: (): Promise<{
    json: string
    savedAt: number
    resolved: Record<string, ResolvedMedia | null>
  } | null> => ipcRenderer.invoke('recovery:read'),
  /** Discard: the offered snapshot is removed for good. */
  recoveryClear: (): Promise<boolean> => ipcRenderer.invoke('recovery:clear'),
  /** Nothing unsaved any more: this window's own snapshot is removed (never
   *  one only offered; phase Ç2a.2). */
  recoveryClearOwn: (): Promise<boolean> => ipcRenderer.invoke('recovery:clear-own'),
  /** Recover: the offered snapshot becomes this window's own. */
  recoveryAdopt: (): Promise<boolean> => ipcRenderer.invoke('recovery:adopt'),
  /** Later (Esc, a click beside the question): the offered snapshot stays on
   *  disk and is offered again by the next window or launch. */
  recoveryRelease: (): Promise<boolean> => ipcRenderer.invoke('recovery:release'),
  /** Earlier versions of a project file (phase Ç2a.2, main/backups.ts): the
   *  copies taken before an autosave wrote over it, newest first, and one
   *  copy's text with its media resolved as an open does. */
  backupsList: (uid: string): Promise<{ name: string; at: number; size: number }[]> => ipcRenderer.invoke('backups:list', uid),
  backupsRead: (uid: string, name: string): Promise<{ json: string; resolved: Record<string, ResolvedMedia | null> } | null> =>
    ipcRenderer.invoke('backups:read', uid, name),
  /** Recent-projects index (metadata + tiny thumbnails) in userData. */
  recentsRead: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recents:read'),
  /** Adds or refreshes one entry (an open or a save): main merges it into the
   *  list on disk. Only a file the user chose (or already listed) is taken. */
  recentsUpsert: (entry: Omit<RecentEntry, 'lastOpened' | 'missing'>): Promise<boolean> => ipcRenderer.invoke('recents:upsert', entry),
  recentsRemove: (p: string): Promise<boolean> => ipcRenderer.invoke('recents:remove', p),
  /** "Find projects": a folder dialog, then a search of those folders; what
   *  is found joins the list. Null when the dialog was cancelled. */
  findProjects: (): Promise<FindResult | null> => ipcRenderer.invoke('recents:find'),
  cancelFindProjects: (): Promise<boolean> => ipcRenderer.invoke('recents:find-cancel'),
  onFindProgress: (cb: (p: FindProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: FindProgress): void => cb(p)
    ipcRenderer.on('recents:find-progress', listener)
    return () => {
      ipcRenderer.removeListener('recents:find-progress', listener)
    }
  },
  /** Open a project by an explicit path (a recents entry), media resolved in main. */
  openProjectPath: (p: string): Promise<OpenedProject | null> => ipcRenderer.invoke('project:open-path', p),
  /** A project file dropped on the window: its path once main has taken it
   *  as chosen (null: not a project file). Then openProjectPath opens it.
   *  (The dropped File, never a path: droppedPath above.) */
  registerDroppedProject: (file: File): Promise<string | null> => ipcRenderer.invoke('project:register-dropped', droppedPath(file)),
  /** Move a project file to the OS trash (recoverable). */
  trashProject: (p: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('project:trash', p),
  revealPath: (p: string): Promise<boolean> => ipcRenderer.invoke('path:reveal', p),
  /** Show an exported file in Explorer / open it in the default player. Only
   *  works for paths this session's own save dialog or batch folder produced. */
  revealOutput: (p: string): Promise<boolean> => ipcRenderer.invoke('output:reveal', p),
  openOutput: (p: string): Promise<boolean> => ipcRenderer.invoke('output:open', p),
  /** Rename a project: update the name inside the file AND rename the file on
   *  disk to "<name>.<ext>". Returns the new path. */
  renameProject: (path: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('project:rename', { path, name }),
  /** Derived-analysis cache (waveform peaks, filmstrips) keyed by file+mtime. */
  analysisGet: (mediaPath: string, kind: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('analysis:get', mediaPath, kind),
  analysisPut: (mediaPath: string, kind: string, data: Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke('analysis:put', mediaPath, kind, data),
  /** Reclaimable cache (redundant model copies + derived analysis), and
   *  clearing it. IndexedDB is left alone here: it also holds the user's
   *  imported fonts and LUTs (the renderer drops only the model store). */
  cacheSize: (): Promise<{ bytes: number }> => ipcRenderer.invoke('cache:size'),
  cacheClear: (): Promise<{ freed: number }> => ipcRenderer.invoke('cache:clear'),
  /** A processed audio file (a cleaned voice) written in pieces into the
   *  app's own folder; the last piece returns it as media. */
  saveProcessed: (args: { id: string; chunk: ArrayBuffer; first: boolean; last: boolean; name: string }): Promise<ImportedFile | { ok: true } | null> =>
    ipcRenderer.invoke('media:processed', args),
  /** The parallel export (the craft run, round 7): render processes (each
   *  a hidden copy of the app with its own GPU process) drawing stretches of
   *  a film while the editor draws its own share (main/render-workers.ts). */
  render: {
    /** What the worker count is picked from: threads, memory, a GPU. */
    machine: (): Promise<RenderMachine> => ipcRenderer.invoke('render:machine'),
    /** Starts n render processes; their ids once each is listening. */
    open: (n: number): Promise<number[]> => ipcRenderer.invoke('render:open', n),
    /** Gives one a stretch; resolves with its answer and the stretch's
     *  address (media://) for the join. */
    run: (id: number, job: unknown): Promise<RenderWorkerResult> => ipcRenderer.invoke('render:run', id, job),
    /** A stretch the editor draws itself, written in pieces, then its address. */
    write: (k: number, position: number, data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('render:write', k, position, data),
    written: (k: number): Promise<string> => ipcRenderer.invoke('render:written', k),
    /** Ends every render process this editor started (the stretches stay). */
    close: (): Promise<boolean> => ipcRenderer.invoke('render:close'),
    /** The export is over: the processes ended, the stretches deleted. */
    finish: (): Promise<boolean> => ipcRenderer.invoke('render:finish'),
    /** Frames each process has drawn of its current stretch. */
    onProgress: (cb: (p: { id: number; frames: number }) => void): (() => void) => {
      const listener = (_e: unknown, p: { id: number; frames: number }): void => cb(p)
      ipcRenderer.on('render:progress', listener)
      return () => {
        ipcRenderer.removeListener('render:progress', listener)
      }
    },
    // A render process's own window.
    workerReady: (): void => ipcRenderer.send('render-worker:ready'),
    onJob: (cb: (job: unknown) => void): void => {
      ipcRenderer.on('render-worker:job', (_e, job: unknown) => cb(job))
    },
    workerProgress: (frames: number): void => ipcRenderer.send('render-worker:progress', frames),
    workerWrite: (position: number, data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('render-worker:write', position, data),
    workerDone: (result: RenderWorkerResult): void => ipcRenderer.send('render-worker:done', result)
  },
  /** The Renders panel: every export's status file in <project>\cikti\.renders
   *  (main/render-status.ts), this app's own or another program's. */
  renders: {
    /** The folder and every status file's text (the page checks them). */
    list: (): Promise<{ dir: string; files: string[] }> => ipcRenderer.invoke('renders:list'),
    /** This app's export writes its status (a RenderStatus as JSON). */
    write: (json: string): Promise<boolean> => ipcRenderer.invoke('renders:write', json),
    /** Cancel asked from the panel; the writer sees it and stops. */
    cancel: (id: string): Promise<boolean> => ipcRenderer.invoke('renders:cancel', id),
    cancelAsked: (id: string): Promise<boolean> => ipcRenderer.invoke('renders:cancel-asked', id),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('renders:remove', id),
    /** The finished video (the path in its status file) in the default player / in Explorer. */
    open: (id: string): Promise<boolean> => ipcRenderer.invoke('renders:open', id),
    reveal: (id: string): Promise<boolean> => ipcRenderer.invoke('renders:reveal', id),
    /** A status file was written or removed (the folder is watched). */
    onChanged: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('renders:changed', listener)
      return () => {
        ipcRenderer.removeListener('renders:changed', listener)
      }
    }
  },
  /** Code films (CODE-FILM-CLIP-PLAN.md): a film folder with an index.html,
   *  served over snippfilm://<id>/, its audio/mix.wav as media. */
  /** The sample project (phase 9b): a new folder under the profile, and the
   *  clip files the page made for it (only the names main knows). */
  sample: {
    create: (): Promise<{ dir: string; project: string } | null> => ipcRenderer.invoke('sample:create'),
    write: (name: string, data: Uint8Array): Promise<{ path: string; name: string; size: number; mtime: number; url: string } | null> => ipcRenderer.invoke('sample:write', name, data)
  },
  /** The voice-over (REF-AB, worker S): `arm` right before the page asks
   *  for the microphone (the one permission main grants, once per press);
   *  `write` gives main the take's WAV; main picks the folder and name. */
  voiceover: {
    arm: (): Promise<boolean> => ipcRenderer.invoke('voiceover:arm'),
    write: (data: Uint8Array): Promise<{ path: string; name: string; size: number; mtime: number; url: string; inProject: boolean } | null> => ipcRenderer.invoke('voiceover:write', data)
  },
  codeFilm: {
    /** The folder dialog; null when cancelled or not a film folder. */
    pick: (): Promise<CodeFilmInfo | null> => ipcRenderer.invoke('codefilm:pick'),
    /** A film folder the app already runs or made itself (a template's copy,
     *  the agent's new clip, a film of the open project): null for any other
     *  folder (the main process trusts nothing because the page names it). */
    register: (folder: string): Promise<CodeFilmInfo | null> => ipcRenderer.invoke('codefilm:register', folder),
    /** A folder dropped on the window (the dropped File, never a path:
     *  droppedPath above): null when it is not a film folder. */
    registerDropped: (file: File): Promise<CodeFilmInfo | null> => ipcRenderer.invoke('codefilm:register-dropped', droppedPath(file)),
    /** The film this window was opened for (VideoHub's "Snipp'te aç"), once, and the project file to save it to. */
    takePending: (): Promise<{ info: CodeFilmInfo; project: string } | null> => ipcRenderer.invoke('codefilm:pending'),
    /** Code film folders this window may not run yet (security patch, item
     *  6): a project file or a launch named them, they are outside the
     *  project folder and the user never brought them in on this computer.
     *  `why`: 'project' (an opened project's clip) or 'launch' (--code-film). */
    trustAsks: (): Promise<{ folder: string; why: 'project' | 'launch' }[]> => ipcRenderer.invoke('codefilm:trust-asks'),
    /** The user's answer about one of them. "Run": the folder is trusted
     *  from now on and comes back as a film; else null. Only a folder the
     *  main process asked this window about counts. */
    trust: (folder: string, run: boolean): Promise<CodeFilmInfo | null> => ipcRenderer.invoke('codefilm:trust', folder, run === true),
    onTrustAsk: (cb: (ask: { folder: string; why: 'project' | 'launch' }) => void): (() => void) => {
      const listener = (_e: unknown, m: { folder: string; why: 'project' | 'launch' }): void => cb(m)
      ipcRenderer.on('codefilm:trust-ask', listener)
      return () => {
        ipcRenderer.removeListener('codefilm:trust-ask', listener)
      }
    },
    /** Tell this window when the film's files change (or stop). */
    watch: (id: string, on: boolean): void => ipcRenderer.send('codefilm:watch', id, on),
    /** A fingerprint of the film folder's files now (size + write time): the
     *  frame paths compare it before drawing, so an edit is never missed. */
    stamp: (id: string): Promise<string | null> => ipcRenderer.invoke('codefilm:stamp', id),
    /** The addresses the main process refused the film (its own folder only; never media://). */
    blocked: (id: string): Promise<string[]> => ipcRenderer.invoke('codefilm:blocked', id),
    /** A code clip folder's versions (phase 5e): how many, and the one "back" puts in place. */
    versions: (id: string): Promise<{ count: number; next: number | null; over?: boolean }> => ipcRenderer.invoke('codefilm:versions', id),
    /** Back to the previous version (the files now become a version too). */
    versionBack: (id: string): Promise<{ ok: boolean; n?: number; saved?: number | null; error?: string; reason?: string }> => ipcRenderer.invoke('codefilm:version-back', id),
    /** Cila K, "code values": the places of the film's files whose value can be changed by hand (read now). */
    valuesScan: (id: string): Promise<{ slots: CodeValueSlot[]; files: number; skipped: number; bytes: number; ms: number } | null> => ipcRenderer.invoke('codefilm:values-scan', id),
    /** The list of changes (under its name) the film's pages loaded next are served with. */
    valuesSet: (id: string, key: string, edits: unknown[]): Promise<boolean> => ipcRenderer.invoke('codefilm:values-set', id, key, edits),
    /** The changes written into the clip's own files (the version keeper keeps the files as they are first). */
    valuesWrite: (id: string, edits: unknown[]): Promise<{ ok: boolean; files?: number; places?: number; version?: number | null; error?: string; reason?: string }> => ipcRenderer.invoke('codefilm:values-write', id, edits),
    /** The code_clip tool's folder: anim<name> beside the saved project, with an empty index.html unless it has one. */
    makeAnim: (projectPath: string, name: string): Promise<{ ok: boolean; folder?: string; existed?: boolean; error?: string }> => ipcRenderer.invoke('codefilm:make-anim', projectPath, name),
    /** The code templates (phase 5f): their folder and ids. */
    templates: (): Promise<{ dir: string; ids: string[] }> => ipcRenderer.invoke('codefilm:templates'),
    /** One template copied into anim<id>[-n] beside this window's saved project. */
    addTemplate: (id: string): Promise<{ ok: boolean; folder?: string; error?: string }> => ipcRenderer.invoke('codefilm:add-template', id),
    onChanged: (cb: (e: { id: string; files: string[] }) => void): (() => void) => {
      const listener = (_e: unknown, m: { id: string; files: string[] }): void => cb(m)
      ipcRenderer.on('codefilm:changed', listener)
      return () => {
        ipcRenderer.removeListener('codefilm:changed', listener)
      }
    },
    /** A film page that shows more than canvases is drawn by a hidden window
     *  of the main process (phase 5d.1, main/film-window.ts). `key` names
     *  one such window of this editor. */
    page: {
      open: (o: { key: string; id: string; width: number; height: number; scale?: number }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('codefilm:page-open', o),
      /** Says something to the window's host page (what the editor says to a film's host page over its port). */
      send: (key: string, m: unknown): void => ipcRenderer.send('codefilm:page-send', key, m),
      /** Picture `seq` was looked at: it carried frame `id` (0: none waited for). */
      ack: (key: string, seq: number, id: number): void => ipcRenderer.send('codefilm:page-ack', key, seq, id),
      /** The window closed (`kill`: its process ended first: a page that does not answer). */
      close: (key: string, kill?: boolean): void => ipcRenderer.send('codefilm:page-close', key, kill === true),
      /** What the window's host page (or the main process, about the window) says. */
      onMessage: (cb: (key: string, m: unknown) => void): (() => void) => {
        const listener = (_e: unknown, key: string, m: unknown): void => cb(key, m)
        ipcRenderer.on('codefilm:page-msg', listener)
        return () => {
          ipcRenderer.removeListener('codefilm:page-msg', listener)
        }
      },
      /** A picture of a window (a GPU shared texture): `texture.getVideoFrame()`
       *  gives it as a VideoFrame; `texture.release()` when done. One taker. */
      onTexture: (cb: (texture: FilmPageTexture, meta: FilmPageTextureMeta) => Promise<void>): void => {
        pageTextureTaker = cb
      }
    }
  },
  /** The agent server (main/agent-server.ts): an AI agent the user runs asks
   *  for a tool, the page does it on the open project and answers. */
  agent: {
    /** A tool call for this window's project. */
    onCall: (cb: (call: AgentCall) => void): (() => void) => {
      const listener = (_e: unknown, call: AgentCall): void => cb(call)
      ipcRenderer.on('agent:call', listener)
      return () => {
        ipcRenderer.removeListener('agent:call', listener)
      }
    },
    /** Its answer (an MCP tool result: text and pictures). */
    reply: (id: string, result: unknown): void => ipcRenderer.send('agent:result', id, result),
    /** A call the server gave up on (it ran past its time): stop it. */
    onCancel: (cb: (id: string) => void): (() => void) => {
      const listener = (_e: unknown, id: string): void => cb(id)
      ipcRenderer.on('agent:cancel', listener)
      return () => {
        ipcRenderer.removeListener('agent:cancel', listener)
      }
    },
    /** A session ended or was forgotten by the server, or agent access was
     *  turned off (phase 4A.8, G7 / G9). */
    onSession: (cb: (e: { kind: 'ended' | 'off'; id?: string }) => void): (() => void) => {
      const listener = (_e: unknown, ev: { kind: 'ended' | 'off'; id?: string }): void => cb(ev)
      ipcRenderer.on('agent:session', listener)
      return () => {
        ipcRenderer.removeListener('agent:session', listener)
      }
    },
    /** The point before the agent: the project file's text, kept in the
     *  profile (agent-restore\: per project its point before the agent and
     *  its last five). */
    restoreWrite: (json: string, label: string): Promise<{ name: string; path: string } | null> => ipcRenderer.invoke('agent:restore-write', json, label),
    restoreRead: (name: string): Promise<{ json: string } | null> => ipcRenderer.invoke('agent:restore-read', name),
    restoreList: (): Promise<{ name: string; size: number }[]> => ipcRenderer.invoke('agent:restore-list'),
    /** The project got another path: its points go with it (new names by old). */
    restoreRekey: (from: string, to: string, copy?: boolean): Promise<Record<string, string>> => ipcRenderer.invoke('agent:restore-rekey', from, to, copy === true),
    /** The app saved the file of this key with this save id (phase 4A.11, P3). */
    restoreSaved: (key: string, id: string): Promise<boolean> => ipcRenderer.invoke('agent:restore-saved', key, id),
    /** The file of this key was opened holding this save id: when it differs
     *  from the last one known, its points before the agent become session
     *  points (new names by old). */
    restoreOpened: (key: string, id: string): Promise<Record<string, string>> => ipcRenderer.invoke('agent:restore-opened', key, id),
    /** The user went back to this point before the agent: a session point from now on. */
    restoreDemote: (name: string): Promise<string | null> => ipcRenderer.invoke('agent:restore-demote', name),
    /** Is the server on, and what an agent needs to connect. */
    status: (): Promise<AgentStatus> => ipcRenderer.invoke('agent:status'),
    setEnabled: (on: boolean): Promise<AgentStatus> => ipcRenderer.invoke('agent:set-enabled', on === true)
  },
  /** The agent connection (TERMINAL-YOK-PLAN.md): access on or off, how it
   *  stands, and the Settings window's "Agent connection" page. The app never
   *  starts an agent; no key ever comes here. */
  agentSession: {
    /** On: the agent server; off: the server closes. */
    connect: (on: boolean): Promise<AgentSessionStatus> => ipcRenderer.invoke('agent:connect', on === true),
    status: (): Promise<AgentSessionStatus> => ipcRenderer.invoke('agentLink:status'),
    catalog: (): Promise<AgentInstallation[]> => ipcRenderer.invoke('agentLink:catalog'),
    openCodeSetup: (): Promise<{ config: string; environment: string; launch: string } | null> => ipcRenderer.invoke('agentLink:openCodeSetup'),
    antigravitySetup: (): Promise<{ command: string } | null> => ipcRenderer.invoke('agentLink:antigravitySetup'),
    claudeSetup: (): Promise<{ command: string; name: string } | null> => ipcRenderer.invoke('agentLink:claudeSetup'),
    codexSetup: (): Promise<{ command: string; register: string; launch?: string; environment: string; persist?: string; name: string; variable: string } | null> => ipcRenderer.invoke('agentLink:codexSetup'),
    /** Whether the user's Codex variable holds this copy's key: a verdict, never a value. */
    codexEnv: (): Promise<'same' | 'different' | 'missing' | 'unknown'> => ipcRenderer.invoke('agentLink:codexEnv'),
    /** Read only (`claude mcp get`, `codex mcp get --json`, Antigravity `mcp_config.json`): the verdict only. */
    check: (which: 'claude' | 'codex' | 'antigravity'): Promise<AgentRegistration> => ipcRenderer.invoke('agentLink:check', which),
    /** Runs the step-2 line itself (Claude Code, Codex, OpenCode, Antigravity): a
     *  reconnect without the command window. The key stays in the profile's
     *  file (an environment variable at most). */
    repair: (which: 'claude' | 'codex' | 'opencode' | 'antigravity'): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('agentLink:repair', which),
    autoRepair: (): Promise<boolean> => ipcRenderer.invoke('agentLink:autoRepair'),
    setAutoRepair: (on: boolean): Promise<boolean> => ipcRenderer.invoke('agentLink:setAutoRepair', on === true),
    renewKey: (): Promise<AgentSessionStatus | null> => ipcRenderer.invoke('agentLink:renewKey'),
    /** An agent from outside began or ended work: ask for the status again. */
    onChanged: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('agentLink:changed', listener)
      return () => {
        ipcRenderer.removeListener('agentLink:changed', listener)
      }
    }
  },
  /** The in-app chat (AGENT-CHAT-PLAN.md): the installed Claude Code CLI in
   *  the project's folder, one process per window, started on the first
   *  message. Events are text, tool cards and the turn's result; the key
   *  never comes here. */
  agentChat: {
    start: (): Promise<ChatStatus> => ipcRenderer.invoke('agentChat:start'),
    status: (): Promise<ChatStatus> => ipcRenderer.invoke('agentChat:status'),
    /** The model ids the CLI's environment holds, and the one it uses now. */
    models: (): Promise<ChatModels> => ipcRenderer.invoke('agentChat:models'),
    /** Empty: the CLI's own setting for the next chat; a running chat is
     *  switched in place (`/model`, context kept). */
    setModel: (model: string): Promise<{ ok: boolean; applied: boolean }> => ipcRenderer.invoke('agentChat:setModel', model),
    /** The system's image picker; the picture comes back as base64. */
    pickImage: (): Promise<ChatImage | null> => ipcRenderer.invoke('agentChat:pickImage'),
    /** Shell commands on or off: ends the chat (a process's tools are fixed
     *  at start); the next message starts with the new setting. */
    setShell: (on: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke('agentChat:setShell', on === true),
    /** The permission mode: ends the chat; the next message starts with it. */
    setMode: (mode: ChatMode): Promise<{ ok: boolean }> => ipcRenderer.invoke('agentChat:setMode', mode),
    /** `key` is the saved chat, `resume` the CLI session to continue (a new
     *  process starts with them when the old one ended). */
    send: (text: string, model?: string, images?: ChatImage[], shell?: boolean, mode?: ChatMode, key?: string, resume?: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('agentChat:send', text, model ?? '', images ?? [], shell === true, mode ?? 'acceptEdits', key ?? '', resume ?? ''),
    stop: (): Promise<void> => ipcRenderer.invoke('agentChat:stop'),
    /** The chat's transcript and CLI session, saved for the Chats list. */
    saveSession: (draft: ChatSessionDraft): Promise<{ ok: boolean }> => ipcRenderer.invoke('agentChat:saveSession', draft),
    sessions: (): Promise<ChatSessionMeta[]> => ipcRenderer.invoke('agentChat:sessions'),
    loadSession: (key: string): Promise<ChatSessionRecord | null> => ipcRenderer.invoke('agentChat:loadSession', key),
    deleteSession: (key: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('agentChat:deleteSession', key),
    /** Cuts this chat back to just before the message at `at` (words and
     *  time): the CLI session loses it and everything after. */
    rewind: (args: { key: string; at: number; text: string }): Promise<ChatRewindResult> => ipcRenderer.invoke('agentChat:rewind', args),
    onEvent: (cb: (event: ChatEvent) => void): (() => void) => {
      const listener = (_e: unknown, payload: { event: ChatEvent }): void => cb(payload.event)
      ipcRenderer.on('agentChat:event', listener)
      return () => {
        ipcRenderer.removeListener('agentChat:event', listener)
      }
    }
  },
  /** The Settings window's Help and About (main/ipc/help-ipc.ts): the
   *  version, and the fixed files beside the program opened by the system. */
  help: {
    info: (): Promise<{ version: string; channel: string }> => ipcRenderer.invoke('help:info'),
    open: (which: 'guide' | 'agents' | 'license' | 'notices' | 'licenses', lang: 'en' | 'tr'): Promise<{ ok: boolean; path: string }> => ipcRenderer.invoke('help:open', which, lang)
  },
  /** The first start of a new profile (phase 9a, decision 3): what was copied
   *  from the older app's profile, once (null afterwards or when nothing was). */
  profileInherited: (): Promise<{ from: string; copied: string[] } | null> => ipcRenderer.invoke('profile:inherited'),
  /** Dev-only (no handler in packaged builds): may the building blocks page
   *  (#ui-kit) open? true only in a build that is not packaged. */
  testUiKit: (): Promise<boolean> => ipcRenderer.invoke('test:ui-kit'),
  /** Dev-only (no handler in packaged builds): is this an end-to-end test
   *  window (a source build started with --e2e and its own profile)? Only
   *  then does the page install its agent test hook (agent/host.ts). */
  testE2e: (): Promise<boolean> => ipcRenderer.invoke('test:e2e'),
  /** May the page install its test hooks (window.__store, __exporter, …)?
   *  A source build, or a packaged copy under the e2e gate; never the
   *  packaged product (security patch, item 3; main/launch-guard.ts). Said by
   *  the main process in this window's own arguments, which a page cannot change. */
  testHooks: Array.isArray(process.argv) && process.argv.includes('--snipp-test-hooks'),
  /** Test runs only (phase 5a): the code films' frames, the window's sound,
   *  the requests the app's schemes saw. Null outside a test window. */
  testFilmProbe: (q: { kind: 'frames' | 'audible' | 'mute' | 'requests' | 'web' | 'film-policy' | 'windows' | 'film-memory' | 'pid-alive' | 'fail-host' | 'codeval-forget'; on?: boolean; since?: number; mb?: number; pid?: number; n?: number }): Promise<unknown> => ipcRenderer.invoke('test:film-probe', q),
  /** Test runs only: the project file main ties this window to. */
  testCurrentProject: (): Promise<string | null> => ipcRenderer.invoke('test:current-project'),
  /** Dev-only (no handler exists in packaged builds). */
  testRegisterMedia: (p: string): Promise<ImportedFile | null> => ipcRenderer.invoke('test:register-media', p),
  /** Dev-only (no handler in packaged builds): the film tool's output path
   *  counts as chosen, so an export can stream into it. */
  testChooseSave: (p: string): Promise<string | null> => ipcRenderer.invoke('test:choose-save', p),
  /** Test runs only (phase Ç3b): an export's disk full after `fullAfter`
   *  bytes, and the free space its precheck sees (null: the real disk). */
  testDiskFault: (f: { fullAfter?: number | null; free?: number | null; slowMs?: number | null }):Promise<boolean> => ipcRenderer.invoke('test:disk-fault', f),
  /** Whisper model store — bundled real files on disk, never fetched at runtime.
   *  Gigabyte files move in chunks (Electron IPC caps messages at ~256 MB). */
  modelGet: (key: string): Promise<ArrayBuffer | null> => ipcRenderer.invoke('model:get', key),
  modelPut: (key: string, data: ArrayBuffer): Promise<boolean> => ipcRenderer.invoke('model:put', key, data),
  modelCount: (needle: string): Promise<number> => ipcRenderer.invoke('model:count', needle),
  modelSize: (key: string): Promise<number | null> => ipcRenderer.invoke('model:size', key),
  modelRead: (key: string, offset: number, length: number): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke('model:read', key, offset, length),
  modelAppend: (key: string, chunk: ArrayBuffer, first: boolean): Promise<boolean> =>
    ipcRenderer.invoke('model:append', key, chunk, first),
  modelCommit: (key: string): Promise<boolean> => ipcRenderer.invoke('model:commit', key),
  /** The machine's memory in bytes: free now (what the OS can hand out) and
   *  in total. Checked before loading a speech model of gigabytes. */
  systemMemory: (): Promise<{ free: number; total: number }> => ipcRenderer.invoke('sys:memory')
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
