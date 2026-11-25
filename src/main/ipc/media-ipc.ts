// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// IPC for media: the sound-effect library, dropped files and folders, code
// films, the open dialogs for media, pictures and picture folders, and the
// dev-only test hooks. Moved out of registerIpc (src/main/index.ts) in
// SnippStudio phase 2B; registerIpc calls it where these stood.
import { createHash } from 'crypto'
import { app, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isLocalFilePath, isSafeOutput } from '../security'
import { filmStamp, watchFilm } from '../codefilm'
import { keepVersions, makeAnimFolder } from '../codefilm-versions'
import { filmValues, forgetScans, scanFolder, writeValues } from '../codefilm-values'
import { addCodeTemplate, CODE_TEMPLATE_IDS } from '../code-templates'
import { copyFileAtomic, writeFileAtomic } from '../safe-write'
import { e2eFilmProbe, e2eMode, testBuild } from '../e2e-hooks'
import { ipcMain, allowedMediaPaths, editorState, ownerWindow, normalize, MEDIA_EXTENSIONS, IMAGE_EXTENSIONS, AUDIO_EXTENSIONS, pathToMediaUrl } from '../state'
import { sfxDir, sfxIndex, readSfxEntries, listSfxFiles, scanMediaFolder, films, codeFilmAt, filmWatches, isMediaPath } from '../media'
import { findInFolder } from '../project-media'
import { PRODUCT_NAME } from '../../shared/product'
import { mt } from '../strings-main'
import { foldKey } from '../platform-path'
import { answerTrust, askTrust, filmMayRun, trustAsksOf, trustOwnHand } from '../film-trust'

/** The code templates: beside the app when packaged (extraResources), the
 *  source tree's resources folder else (phase 5f). */
export const codeTemplatesDir = (): string => (app.isPackaged ? path.join(process.resourcesPath ?? '', 'kod-sablonlari') : path.join(app.getAppPath(), 'resources', 'kod-sablonlari'))

export function registerMediaIpc(): void {
  // User-picked SFX are copied into the local app library. The renderer never
  // supplies source or destination paths, and list only re-opens indexed files.
  ipcMain.handle('sfx:list', async () => listSfxFiles())
  ipcMain.handle('sfx:import', async (event) => {
    const win = ownerWindow(event.sender)
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      title: mt('sfx.title', { app: PRODUCT_NAME }),
      buttonLabel: mt('sfx.button'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: mt('filter.audio'), extensions: [...AUDIO_EXTENSIONS].map((ext) => ext.slice(1)) }]
    })
    if (result.canceled) return listSfxFiles()
    await fs.mkdir(sfxDir(), { recursive: true })
    const entries = await readSfxEntries()
    for (const raw of result.filePaths) {
      const source = normalize(raw)
      const ext = path.extname(source).toLowerCase()
      if (!AUDIO_EXTENSIONS.has(ext)) continue
      const stat = await fs.stat(source).catch(() => null)
      if (!stat?.isFile() || stat.size > 250 * 1024 * 1024) continue
      const id = `${createHash('sha256').update(foldKey(source)).update(String(stat.size)).update(String(stat.mtimeMs)).digest('hex').slice(0, 32)}${ext}`
      const target = path.join(sfxDir(), id)
      // Whole or not at all: a file already there is taken as it is.
      if (!await fs.stat(target).catch(() => null)) await copyFileAtomic(source, target)
      if (!entries.some((entry) => entry.id === id)) entries.push({ id, name: path.basename(source) })
    }
    await writeFileAtomic(sfxIndex(), JSON.stringify(entries))
    return listSfxFiles()
  })
  /**
   * A folder dropped onto the editor: every media file inside it (and below)
   * comes back tagged with the folder's name, so the bin can show it as one
   * item you open instead of scattering a whole shoot through the list.
   * Returns null when the path isn't a directory, so the caller can fall back
   * to treating it as a single file.
   */
  ipcMain.handle('media:register-dropped-folder', async (_e, raw: string) => {
    return scanMediaFolder(raw)
  })

  // Code films (CODE-FILM-CLIP-PLAN.md): a film folder chosen in the folder
  // dialog, or dropped (the same consent as a dropped media folder).
  ipcMain.handle('codefilm:pick', async (event) => {
    const win = ownerWindow(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { title: mt('codeFilm.title'), properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const info = await codeFilmAt(result.filePaths[0])
    // (Chosen by the user's own hand: a trusted folder from now on. Security patch, item 6.)
    if (info) trustOwnHand(normalize(result.filePaths[0]), editorState(event.sender).currentProjectPath)
    return info
  })
  // A folder the PAGE names (22 Nov, the addendum to K4): only one that may
  // run already, i.e. inside the window's own project folder or on the
  // profile's trusted list. That is every folder the app itself hands the
  // page (a template's copy and the agent's new clip are made and trusted by
  // the handlers below; a film of the open project runs already). This
  // handler trusts nothing new. It used to trust whatever folder the page
  // named ("a dropped folder…"): a script in the page could make any folder
  // with an index.html a trusted code clip, for good. A dropped folder comes
  // by codefilm:register-dropped now, its path taken from the dropped File.
  ipcMain.handle('codefilm:register', async (event, raw: unknown) => {
    if (typeof raw !== 'string' || !isLocalFilePath(raw)) return null
    const folder = normalize(raw)
    const project = editorState(event.sender).currentProjectPath
    if (!filmMayRun(folder, project)) return null
    const info = await codeFilmAt(folder)
    // A code clip's own folder (anim<name> beside the window's saved project:
    // audit D3): its versions are kept (phase 5e).
    if (info) keepVersions(folder, project)
    return info
  })
  // A folder dropped on the window: the path is the one the preload took
  // from the dropped File (preload droppedPath), never text from the page.
  // Brought in by the user's own hand on this computer, so trusted from now
  // on (item 6), like one chosen in the folder dialog above.
  ipcMain.handle('codefilm:register-dropped', async (event, raw: unknown) => {
    const info = await codeFilmAt(raw)
    if (info && typeof raw === 'string') {
      keepVersions(normalize(raw), editorState(event.sender).currentProjectPath)
      trustOwnHand(normalize(raw), editorState(event.sender).currentProjectPath)
    }
    return info
  })
  // Security patch, item 6: the code film folders this window may not run
  // yet, and the user's answer about one of them (film-trust.ts).
  ipcMain.handle('codefilm:trust-asks', (event) => trustAsksOf(event.sender))
  ipcMain.handle('codefilm:trust', async (event, raw: unknown, run: unknown) => {
    const folder = answerTrust(event.sender, raw, run === true)
    if (!folder) return null
    const info = await codeFilmAt(folder)
    if (info) keepVersions(folder, editorState(event.sender).currentProjectPath)
    return info
  })
  // Phase 5e, decision 3: the versions of a code clip's folder, and one put back.
  ipcMain.handle('codefilm:versions', async (event, id: unknown) => {
    const root = typeof id === 'string' ? films.root(id) : null
    const k = root ? keepVersions(root, editorState(event.sender).currentProjectPath) : null
    return k ? k.info() : { count: 0, next: null, over: false }
  })
  ipcMain.handle('codefilm:version-back', async (event, id: unknown) => {
    const root = typeof id === 'string' ? films.root(id) : null
    const k = root ? keepVersions(root, editorState(event.sender).currentProjectPath) : null
    if (!k) return { ok: false, error: 'not a code clip folder' }
    try {
      return { ok: true, ...(await k.back()) }
    } catch (e) {
      // (Audit D2: "over-limit" is said in the user's words by the inspector.)
      const reason = (e as { reason?: unknown })?.reason
      return { ok: false, error: e instanceof Error ? e.message : String(e), ...(typeof reason === 'string' ? { reason } : {}) }
    }
  })
  // Phase 5e, decision 5: the code_clip tool's folder beside the saved project.
  ipcMain.handle('codefilm:make-anim', async (event, pagePath: unknown, name: unknown) => {
    // (The window's own saved project, never a path the page names, as
    // add-template below; a page that names another one is refused: phase
    // 11b, DG4.)
    const projectPath = editorState(event.sender).currentProjectPath
    if (typeof projectPath !== 'string' || typeof name !== 'string' || !isLocalFilePath(projectPath)) return { ok: false, error: 'save the project first' }
    if (typeof pagePath === 'string' && normalize(pagePath) !== normalize(projectPath)) return { ok: false, error: 'save the project first' }
    try {
      const r = await makeAnimFolder(normalize(projectPath), name)
      keepVersions(r.folder, editorState(event.sender).currentProjectPath)
      trustOwnHand(r.folder, normalize(projectPath))
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // Phase 5f, decision 1: the code templates (the user's tool). Their folder
  // (also the one line the command box's "fast" way names), and one copied
  // into anim\<id>[-n]\ beside the saved project.
  ipcMain.handle('codefilm:templates', () => ({ dir: codeTemplatesDir(), ids: [...CODE_TEMPLATE_IDS] }))
  ipcMain.handle('codefilm:add-template', async (event, id: unknown) => {
    // (The window's own saved project: never a path the page names.)
    const projectPath = editorState(event.sender).currentProjectPath
    if (typeof projectPath !== 'string' || !isLocalFilePath(projectPath)) return { ok: false, error: 'save the project first' }
    try {
      const r = await addCodeTemplate(codeTemplatesDir(), normalize(projectPath), String(id))
      keepVersions(r.folder, projectPath)
      trustOwnHand(r.folder, normalize(projectPath))
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // Cila K, "code values" (codefilm-values.ts): the places of a film's files
  // whose value can be changed by hand (read when the panel asks, never
  // otherwise); the editor's list of changes for the pages it loads next;
  // and "Write to the files", only into a clip's own folder whose versions
  // are kept (the state before is kept first, or nothing is written).
  ipcMain.handle('codefilm:values-scan', async (_e, id: unknown) => {
    const root = typeof id === 'string' ? films.root(id) : null
    return root ? scanFolder(root) : null
  })
  ipcMain.handle('codefilm:values-set', (_e, id: unknown, key: unknown, edits: unknown) => typeof id === 'string' && !!films.root(id) && filmValues.put(id, key, edits))
  ipcMain.handle('codefilm:values-write', async (event, id: unknown, edits: unknown) => {
    const root = typeof id === 'string' ? films.root(id) : null
    const k = root ? keepVersions(root, editorState(event.sender).currentProjectPath) : null
    if (!root || !k) return { ok: false, reason: 'no-versions', error: 'not a code clip folder whose versions are kept' }
    try {
      return { ok: true, ...(await writeValues(root, edits, k)) }
    } catch (e) {
      const reason = (e as { reason?: unknown })?.reason
      return { ok: false, error: e instanceof Error ? e.message : String(e), ...(typeof reason === 'string' ? { reason } : {}) }
    }
  })
  // The addresses the main process refused a film (main/film-fence.ts).
  ipcMain.handle('codefilm:blocked', (_e, id: unknown) => (typeof id === 'string' ? films.blocked(id) : []))
  // The film folder's files as they are now: the frame paths compare it
  // before drawing, so an edit is never missed by a watcher event.
  ipcMain.handle('codefilm:stamp', (_e, id: unknown) => {
    const root = typeof id === 'string' ? films.root(id) : null
    return root ? filmStamp(root) : null
  })
  // The film this window was opened for (`--code-film`), once; its project's
  // folder is made so the page can save straight to it.
  ipcMain.handle('codefilm:pending', async (event) => {
    const state = editorState(event.sender)
    const pending = state.pendingFilm
    state.pendingFilm = null
    if (!pending) return null
    // (Security patch, item 6, B-G7: another program can start the app with
    // --code-film=<any folder>. A folder that is not trusted runs, and gets
    // its project folder made, only after the user said so in this window.)
    if (!filmMayRun(pending.folder, pending.project) && !(await askTrust(event.sender, pending.folder, 'launch', true))) return null
    const info = await codeFilmAt(pending.folder)
    if (!info) return null
    await fs.mkdir(path.dirname(pending.project), { recursive: true })
    return { info, project: pending.project }
  })
  ipcMain.on('codefilm:watch', (event, id: unknown, on: unknown) => {
    if (typeof id !== 'string') return
    const root = films.root(id)
    const sender = event.sender
    let mine = filmWatches.get(sender.id)
    if (!mine) {
      mine = new Map()
      filmWatches.set(sender.id, mine)
      sender.once('destroyed', () => {
        for (const stop of filmWatches.get(sender.id)?.values() ?? []) stop()
        filmWatches.delete(sender.id)
      })
    }
    mine.get(id)?.()
    mine.delete(id)
    if (on !== true || !root) return
    mine.set(id, watchFilm(root, (files) => {
      if (!sender.isDestroyed()) sender.send('codefilm:changed', { id, files })
    }))
  })

  // A media file the agent names (its import tool): a local path, a media
  // extension, a file that is there. It is allowlisted like one the user
  // dropped, so the page can read it over media://.
  ipcMain.handle('media:import-paths', async (_e, paths: unknown) => {
    if (!Array.isArray(paths)) return []
    const out: { path: string; name: string; size: number; mtime: number; url: string }[] = []
    for (const raw of paths.slice(0, 100)) {
      if (typeof raw !== 'string' || !isLocalFilePath(raw)) continue
      const p = normalize(raw)
      if (!MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase())) continue
      const stat = await fs.stat(p).catch(() => null)
      if (!stat?.isFile()) continue
      allowedMediaPaths.add(foldKey(p))
      out.push({ path: p, name: path.basename(p), size: stat.size, mtime: Math.round(stat.mtimeMs), url: pathToMediaUrl(p) })
    }
    return out
  })
  // A file changed on disk (a rebuilt mix over an old one): the window that
  // shows it is told, once the write is quiet. fs.watch misses some editors'
  // atomic saves (temp file renamed over), so this polls the size and write
  // time of the files the page named; a handful of media files is cheap.
  const mediaWatches = new Map<number, { files: Map<string, { size: number; mtime: number }>; timer: ReturnType<typeof setInterval> | null }>()
  const stopMediaWatch = (id: number): void => {
    const w = mediaWatches.get(id)
    if (!w) return
    if (w.timer) clearInterval(w.timer)
    mediaWatches.delete(id)
  }
  ipcMain.on('media:watch', (event, list: unknown) => {
    const sender = event.sender
    if (sender.isDestroyed()) return
    let w = mediaWatches.get(sender.id)
    if (!w) {
      w = { files: new Map(), timer: null }
      mediaWatches.set(sender.id, w)
      sender.once('destroyed', () => stopMediaWatch(sender.id))
    }
    w.files.clear()
    if (Array.isArray(list)) {
      for (const f of list.slice(0, 500)) {
        const o = f as { path?: unknown; size?: unknown; mtime?: unknown }
        if (typeof o.path !== 'string' || !isLocalFilePath(o.path)) continue
        if (typeof o.size !== 'number' || typeof o.mtime !== 'number') continue
        w.files.set(o.path, { size: o.size, mtime: o.mtime })
      }
    }
    if (w.timer) {
      clearInterval(w.timer)
      w.timer = null
    }
    if (!w.files.size) return
    const mine = w
    mine.timer = setInterval(() => {
      void (async () => {
        if (sender.isDestroyed()) return stopMediaWatch(sender.id)
        const changed: { path: string; size: number; mtime: number }[] = []
        for (const [p, was] of mine.files) {
          const st = await fs.stat(p).catch(() => null)
          if (!st || !st.isFile()) continue
          const mtime = Math.round(st.mtimeMs)
          if (st.size !== was.size || mtime !== was.mtime) {
            mine.files.set(p, { size: st.size, mtime })
            changed.push({ path: p, size: st.size, mtime })
          }
        }
        if (changed.length && !sender.isDestroyed()) sender.send('media:changed', changed)
      })()
    }, 1_500)
    mine.timer.unref?.()
  })

  ipcMain.handle('dialog:open-media', async (event) => {
    const win = ownerWindow(event.sender)
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      title: mt('media.title'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: mt('filter.media'), extensions: [...MEDIA_EXTENSIONS].map((e) => e.slice(1)) },
        { name: mt('filter.all'), extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    const files: { path: string; name: string; size: number; mtime: number; url: string }[] = []
    for (const raw of result.filePaths) {
      const p = normalize(raw)
      if (!MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase())) continue
      const stat = await fs.stat(p).catch(() => null)
      if (!stat?.isFile()) continue
      allowedMediaPaths.add(foldKey(p))
      files.push({ path: p, name: path.basename(p), size: stat.size, mtime: Math.round(stat.mtimeMs), url: pathToMediaUrl(p) })
    }
    return files
  })

  ipcMain.handle('dialog:open-image', async (event) => {
    const win = ownerWindow(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: mt('image.title'),
      buttonLabel: mt('image.button'),
      properties: ['openFile'],
      filters: [
        { name: mt('filter.images'), extensions: [...IMAGE_EXTENSIONS].map((extension) => extension.slice(1)) }
      ]
    })
    const raw = result.filePaths[0]
    if (result.canceled || !raw) return null
    const imagePath = normalize(raw)
    if (!IMAGE_EXTENSIONS.has(path.extname(imagePath).toLowerCase())) return null
    const stat = await fs.stat(imagePath).catch(() => null)
    if (!stat?.isFile()) return null
    allowedMediaPaths.add(foldKey(imagePath))
    return {
      path: imagePath,
      name: path.basename(imagePath),
      size: stat.size,
      mtime: Math.round(stat.mtimeMs),
      url: pathToMediaUrl(imagePath)
    }
  })

  // Drag-and-drop import: the renderer sends the dropped file's path (resolved
  // by the preload via webUtils, so it corresponds to a real dropped file).
  // Main still validates extension + existence before allowlisting.
  // Relink, "found one, look for the rest in the same folder" (phase Ç2a.2,
  // decision 3): which of these file names are media files in the folder of
  // a file the user just picked (an allowlisted media file's folder only).
  ipcMain.handle('media:find-in-folder', async (_e, picked: unknown, names: unknown) => {
    if (!isLocalFilePath(picked) || !Array.isArray(names)) return []
    const file = normalize(picked)
    if (!allowedMediaPaths.has(foldKey(file))) return []
    const found = await findInFolder(path.dirname(file), names, { accept: isMediaPath })
    return Object.values(found).map((f) => {
      allowedMediaPaths.add(foldKey(f.path))
      return { path: f.path, name: path.basename(f.path), size: f.size, mtime: f.mtime, url: pathToMediaUrl(f.path) }
    })
  })

  ipcMain.handle('media:register-dropped', async (_e, raw: string) => {
    if (!isLocalFilePath(raw)) return null
    const p = normalize(raw)
    if (!MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase())) return null
    const stat = await fs.stat(p).catch(() => null)
    if (!stat?.isFile()) return null
    allowedMediaPaths.add(foldKey(p))
    return { path: p, name: path.basename(p), size: stat.size, mtime: Math.round(stat.mtimeMs), url: pathToMediaUrl(p) }
  })

  // Dev/test-only: a test names its output without the native dialog; in a dev build that path counts as
  // chosen, so the export can stream into it. NOT registered when packaged (but in a package the e2e run marked: e2e-hooks.ts testBuild).
  if (testBuild()) {
    ipcMain.handle('test:choose-save', (event, raw: unknown) => {
      const p = normalize(String(raw ?? ''))
      if (!isSafeOutput(p)) return null
      editorState(event.sender).chosenSavePaths.add(p)
      return p
    })
  }

  // Dev/test-only: the building blocks page (#ui-kit, SnippStudio phase 3a)
  // opens only where this answers. NOT registered when packaged.
  if (!app.isPackaged) ipcMain.handle('test:ui-kit', () => true)
  // Dev/test-only: an end-to-end test window (--e2e and its own profile):
  // the page installs its agent test hook (window.__agent) only where this
  // answers true (SnippStudio phase 4A.8). NOT registered when packaged (but in a package the e2e run marked: e2e-hooks.ts testBuild).
  if (testBuild()) ipcMain.handle('test:e2e', () => e2eMode())
  // Test runs only: the code films' frames, the window's sound, the requests
  // the app's schemes saw (phase 5a). NOT registered when packaged (but in a package the e2e run marked: e2e-hooks.ts testBuild).
  if (testBuild())
    ipcMain.handle('test:film-probe', (event, q: unknown) => {
      if (!e2eMode()) return null
      // (Cila K, the speed baseline: the scans kept by content are forgotten,
      // so the next scan of a folder is a first one, without rewriting its
      // files: a file just written is read slowly the first time.)
      if ((q as { kind?: unknown } | null)?.kind === 'codeval-forget') return { forgot: forgetScans() }
      return e2eFilmProbe(event.sender, q)
    })
  // Test runs only: the project file main ties this window to (phase Ç2a.2,
  // P14: a file the page refused must not be it).
  if (testBuild()) ipcMain.handle('test:current-project', (event) => (e2eMode() ? editorState(event.sender).currentProjectPath : null))

  // Dev/test-only: lets automated tests allowlist a media file without the
  // native dialog. NOT registered in a packaged build — an env var is not a
  // lock, and a shipped binary should not carry a switch that widens what the
  // sandboxed renderer may reach, however small the widening is. The one
  // exception (phase 9a, decision 6: the package itself under test) needs a
  // file in the program's own folder, which a package never holds and whose
  // writer could replace the program as well (e2e-hooks.ts testBuild).
  if (testBuild()) {
    ipcMain.handle('test:register-media', async (_e, raw: string) => {
      const p = normalize(raw)
      if (!MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase())) return null
      const stat = await fs.stat(p).catch(() => null)
      if (!stat?.isFile()) return null
      allowedMediaPaths.add(foldKey(p))
      return { path: p, name: path.basename(p), size: stat.size, mtime: Math.round(stat.mtimeMs), url: pathToMediaUrl(p) }
    })
  }
}
