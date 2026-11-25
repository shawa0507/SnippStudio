// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// IPC for projects: the open dialog, a folder, archiving, batch writes, crash
// recovery, a project waiting to open. Moved out of registerIpc
// (src/main/index.ts) in SnippStudio phase 2B; registerIpc calls it where these
// stood.
import { app, dialog } from 'electron'
import { mt } from '../strings-main'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isLocalFilePath, isSafeOutput } from '../security'
import { onePerPath, readDiskStamp, renameWithRetry, stampKey, writeFileAtomic, writeViaPart } from '../safe-write'
import { ipcMain, allowedMediaPaths, knownProjectPaths, claimedRecoveryPaths, editorState, ownerWindow, windowUsingProject, normalize, stripBom, parseJsonFile, MEDIA_EXTENSIONS, focusEditorWindow } from '../state'
import { resolveProjectMedia } from '../media'
import { windowRecoveryPath, claimPendingRecovery } from '../project-files'
import { listBackups, readBackup } from '../backups'
import { withRelativePaths } from '../project-media'
import { writeAllFaulted } from './file-ipc'
import { PRODUCT_NAME } from '../../shared/product'
import { foldKey } from '../platform-path'
import { locateMedia } from '../project-media'

const RECOVERY_NAME = /^(?:recovery\.autocut|recovery-.*\.autocut)$/i

/** Moves one crash snapshot aside when the file it was of was saved after it
 *  (its unsaved state is in that save, or was left behind on purpose): kept
 *  under recovery-stale\, never offered as work to recover. */
async function quarantineStale(dir: string, file: string): Promise<boolean> {
  let parsed: { recoveredFromFile?: unknown }
  try {
    const stat = await fs.stat(file)
    parsed = parseJsonFile(await fs.readFile(file, 'utf8')) as { recoveredFromFile?: unknown }
    const of = parsed.recoveredFromFile
    if (!isLocalFilePath(of)) return false
    const source = await fs.stat(of).catch(() => null)
    if (!source?.isFile() || source.mtimeMs <= stat.mtimeMs + 2_000) return false
    const stale = path.join(dir, 'recovery-stale')
    await fs.mkdir(stale, { recursive: true })
    await renameWithRetry(file, path.join(stale, `${path.basename(file)}-${Date.now().toString(36)}`))
    claimedRecoveryPaths.delete(foldKey(file))
    return true
  } catch {
    return false
  }
}

/** Every stale snapshot in the profile is set aside before one is offered:
 *  a crash long ago does not stand in front of a project saved since. */
async function pruneStaleRecoveries(dir: string): Promise<void> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    if (!RECOVERY_NAME.test(name)) continue
    const file = path.join(dir, name)
    if (claimedRecoveryPaths.has(foldKey(file))) continue
    await quarantineStale(dir, file)
  }
}

export function registerProjectIpc(): void {
  // Opens a project JSON. The main process itself parses it and registers the
  // media paths it references (after checking they exist), so the renderer
  // never gets to allowlist arbitrary paths.
  ipcMain.handle('dialog:open-project', async (event) => {
    const win = ownerWindow(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: mt('project.open'),
      properties: ['openFile'],
      filters: [{ name: mt('filter.project', { app: PRODUCT_NAME }), extensions: ['snipp', 'autocut', 'json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const projectPath = result.filePaths[0]
    if (!isLocalFilePath(projectPath)) return { error: 'Network paths are disabled in offline mode.' }
    const alreadyOpen = windowUsingProject(projectPath, event.sender.id)
    if (alreadyOpen) {
      focusEditorWindow(alreadyOpen)
      return { error: `This project is already open in another ${PRODUCT_NAME} window.` }
    }
    knownProjectPaths.add(normalize(projectPath))
    // Stamped BEFORE it is read: a write landing in between then reads as a
    // change at the next save (asked about), never as no change.
    const stamp = await readDiskStamp(projectPath)
    let json: string
    try {
      json = stripBom(await fs.readFile(projectPath, 'utf-8'))
    } catch {
      return { error: 'Could not read project file.' }
    }
    let parsed: unknown
    try {
      parsed = parseJsonFile(json)
    } catch {
      return { error: 'Project file is not valid JSON.' }
    }
    const state = editorState(event.sender)
    // The window is tied to the file only when the page has read and accepted
    // it (project:set-current, phase Ç2a.2, report P14): a file the page
    // refuses (from a newer Snipp, not a project) leaves the window's file as
    // it was.
    if (stamp) state.diskStamps.set(stampKey(projectPath), stamp)
    return { json, path: projectPath, resolved: await resolveProjectMedia(parsed, projectPath, event.sender) }
  })

  // ---- Batch export -------------------------------------------------------
  // The renderer may write several files in one run without a dialog each
  // time. It never names the directory: the user picks it here, we remember
  // it, and writes are confined to that folder with sanitized basenames.
  ipcMain.handle('dialog:choose-folder', async (event) => {
    const win = ownerWindow(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: mt('project.exportFolder'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const folder = normalize(result.filePaths[0])
    editorState(event.sender).batchExportDir = folder
    return folder
  })

  /**
   * Archive ("collect files"): copy one of the project's media files into the
   * folder the user picked for the batch. Both ends are already allowlisted —
   * the source has to be media this session opened, the destination is the
   * folder chosen through the native dialog — so the renderer can neither read
   * an arbitrary file nor write outside that folder.
   *
   * Copies are skipped when the destination already exists with the same size,
   * which makes re-archiving a project cheap instead of re-copying gigabytes.
   */
  ipcMain.handle('archive:copy', async (event, args: { source: string; name: string }) => {
    const batchExportDir = editorState(event.sender).batchExportDir
    if (!batchExportDir) return { ok: false, error: 'no folder chosen' }
    const src = normalize(String(args?.source ?? ''))
    if (!allowedMediaPaths.has(foldKey(src))) return { ok: false, error: 'unknown media' }
    const base = path.basename(String(args?.name ?? '')).replace(/[\\/:*?"<>|]/g, '_')
    if (!base || base === '.' || base === '..') return { ok: false, error: 'bad name' }
    const dir = path.join(batchExportDir, 'media')
    const target = path.join(dir, base)
    if (!MEDIA_EXTENSIONS.has(path.extname(target).toLowerCase())) return { ok: false, error: 'Unsupported media type' }
    if (!normalize(target).startsWith(batchExportDir)) return { ok: false, error: 'outside folder' }
    try {
      await fs.mkdir(dir, { recursive: true })
      const [srcStat, dstStat] = await Promise.all([
        fs.stat(args.source).catch(() => null),
        fs.stat(target).catch(() => null)
      ])
      if (!srcStat) return { ok: false, error: 'source missing' }
      if (!dstStat || dstStat.size !== srcStat.size) await fs.copyFile(args.source, target)
      allowedMediaPaths.add(foldKey(normalize(target)))
      return { ok: true, path: target, bytes: srcStat.size }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  /**
   * Archive, the project's LUT files (phase 11b, A17: the archived project
   * said "(missing)" for each). A .cube the project names, found as lut:read
   * finds it (its path, then beside the window's project), no larger than a
   * LUT is, with a LUT's header, copied into <chosen folder>/luts/.
   */
  ipcMain.handle('archive:copy-lut', async (event, raw: unknown) => {
    const state = editorState(event.sender)
    const batchExportDir = state.batchExportDir
    if (!batchExportDir) return { ok: false, error: 'no folder chosen' }
    const args = (raw ?? {}) as { path?: unknown; relPath?: unknown; size?: unknown; name?: unknown }
    const isCube = (p: string): boolean => path.extname(p).toLowerCase() === '.cube'
    if (!isLocalFilePath(args.path) || !isCube(normalize(args.path))) return { ok: false, error: 'not a LUT' }
    const base = path.basename(String(args.name ?? '')).replace(/[\\/:*?"<>|]/g, '_')
    if (!base || base === '.' || base === '..' || !isCube(base)) return { ok: false, error: 'bad name' }
    const found = await locateMedia({ path: normalize(args.path), relPath: args.relPath, size: args.size }, state.currentProjectPath, { accept: isCube })
    if (!found || found.size > 64 * 1024 * 1024) return { ok: false, error: 'source missing' }
    const head = await fs.readFile(found.path, 'utf8').catch(() => null)
    if (head === null || !/^\s*LUT_3D_SIZE\s+\d+\s*$/m.test(head)) return { ok: false, error: 'not a LUT' }
    const dir = path.join(batchExportDir, 'luts')
    const target = path.join(dir, base)
    if (!normalize(target).startsWith(batchExportDir)) return { ok: false, error: 'outside folder' }
    try {
      await fs.mkdir(dir, { recursive: true })
      await writeFileAtomic(target, head)
      return { ok: true, path: target, bytes: found.size }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // A file of the batch streamed as it is made (phase Ç3b, decision 5; report
  // R23: the Shorts batch held each Short in memory and wrote it whole):
  // its path in the chosen folder, made "chosen" for file:stream-open.
  ipcMain.handle('batch:choose-path', (event, raw: unknown) => {
    const batchExportDir = editorState(event.sender).batchExportDir
    if (!batchExportDir) return null
    const base = path.basename(String(raw ?? '')).replace(/[\\/:*?"<>|]/g, '_')
    if (!base || base === '.' || base === '..') return null
    const target = path.join(batchExportDir, base)
    if (!isSafeOutput(target) || /\.(snipp|autocut)$/i.test(target)) return null
    const p = normalize(target)
    if (!p.startsWith(batchExportDir)) return null
    editorState(event.sender).chosenSavePaths.add(p)
    return target
  })

  ipcMain.handle('batch:write', async (event, args: { name: string; data: Uint8Array }) => {
    const batchExportDir = editorState(event.sender).batchExportDir
    if (!batchExportDir) return { saved: false, error: 'no folder chosen' }
    // Basename only — strip any path separators or traversal the renderer sent.
    const base = path.basename(String(args.name)).replace(/[\\/:*?"<>|]/g, '_')
    if (!base || base === '.' || base === '..') return { saved: false, error: 'bad name' }
    const target = path.join(batchExportDir, base)
    if (!isSafeOutput(target)) return { saved: false, error: 'Unsupported output file type' }
    if (!normalize(target).startsWith(batchExportDir)) return { saved: false, error: 'outside folder' }
    try {
      if (/\.(snipp|autocut)$/i.test(target)) {
        // A project file: whole or not at all (safe-write.ts), its media
        // also relative to it (phase Ç2a.2: the archive's folder moves whole).
        const text = withRelativePaths(Buffer.from(args.data).toString('utf8'), target)
        await onePerPath(target, () => writeFileAtomic(target, text))
        knownProjectPaths.add(normalize(target))
      } else {
        // Beside the target, then put in place (phase Ç3 patch, R-2).
        await onePerPath(target, () => writeViaPart(target, Buffer.from(args.data), { write: writeAllFaulted }))
      }
      return { saved: true, path: target }
    } catch (err) {
      return { saved: false, error: String(err) }
    }
  })

  // ---- Crash recovery -----------------------------------------------------
  // Every editor window owns a snapshot. A single global file let one open
  // project overwrite another's recovery every three minutes.
  //
  // A crash snapshot offered to a window (recovery:read) is only PENDING
  // there: "Later", Esc and a click beside the question used to leave it as
  // the window's own snapshot, so the next one wrote over it and a clean close
  // removed it, the crashed work gone for good. Now only Recover makes it the
  // window's own (recovery:adopt), Discard removes it (recovery:clear), and
  // Later or closing lets go of it (recovery:release), kept for the next
  // window or launch to offer again.
  ipcMain.handle('recovery:write', async (event, json: string) => {
    if (typeof json !== 'string' || json.length > 200 * 1024 * 1024) return false
    const state = editorState(event.sender)
    let recovery = state.recoveryPath ?? windowRecoveryPath(event.sender.id)
    // Never over a snapshot that is still waiting for an answer.
    if (foldKey(state.pendingRecoveryPath) === foldKey(recovery)) recovery = windowRecoveryPath(event.sender.id, Date.now().toString(36))
    state.recoveryPath = recovery
    claimedRecoveryPaths.add(foldKey(recovery))
    try {
      // Whole or not at all: a reset mid-write must not spoil the one copy.
      await onePerPath(recovery, () => writeFileAtomic(recovery, json))
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('recovery:read', async (event) => {
    const state = editorState(event.sender)
    // (Snapshots of a file saved since are not this crash's unsaved work.)
    await pruneStaleRecoveries(app.getPath('userData'))
    let p = state.pendingRecoveryPath
    const own = state.recoveryPath
    if (!p && own && (await fs.stat(own).catch(() => null))?.isFile()) {
      // A new page in a window that already wrote a snapshot: the page was
      // reloaded (its editor had crashed). Its last snapshot is offered like a
      // crashed window's, under a name the next snapshot does not use.
      const pending = own.replace(/\.autocut$/i, `-pending-${Date.now().toString(36)}.autocut`)
      try {
        await renameWithRetry(own, pending)
        claimedRecoveryPaths.delete(foldKey(own))
        claimedRecoveryPaths.add(foldKey(pending))
        p = pending
      } catch {
        // Offered under its own name; recovery:write then writes elsewhere.
        p = own
      }
      state.recoveryPath = null
    }
    // The page that crashed is answered for: from here the window's close and
    // quit treat its snapshots as usual again.
    state.crashed = false
    p ??= await claimPendingRecovery(event.sender.id)
    if (!p) return null
    state.pendingRecoveryPath = p
    let json: string
    let savedAt = 0
    try {
      const stat = await fs.stat(p)
      savedAt = stat.mtimeMs
      json = await fs.readFile(p, 'utf-8')
    } catch {
      // Not readable now: left for a later window or launch.
      claimedRecoveryPaths.delete(foldKey(p))
      state.pendingRecoveryPath = null
      return null
    }
    let parsed: unknown
    try {
      parsed = parseJsonFile(json)
    } catch {
      // A broken snapshot (an older build wrote them in place) can never be
      // recovered, and kept it would stand in front of older good ones.
      await fs.rm(p, { force: true }).catch(() => {})
      claimedRecoveryPaths.delete(foldKey(p))
      state.pendingRecoveryPath = null
      return null
    }
    const of = (parsed as { recoveredFromFile?: unknown })?.recoveredFromFile
    // A snapshot older than the file it was of is superseded: that file was
    // saved after this snapshot was written, so its unsaved state is either
    // in that save or was left behind on purpose. It is moved aside (kept,
    // never offered as "your unsaved work" after a clean close).
    if (isLocalFilePath(of)) {
      const source = await fs.stat(of).catch(() => null)
      if (source?.isFile() && source.mtimeMs > savedAt + 2_000) {
        const stale = path.join(app.getPath('userData'), 'recovery-stale')
        try {
          await fs.mkdir(stale, { recursive: true })
          await renameWithRetry(p, path.join(stale, `${path.basename(p)}-${Date.now().toString(36)}`))
        } catch {
          /* left where it is; not offered this time */
        }
        claimedRecoveryPaths.delete(foldKey(p))
        state.pendingRecoveryPath = null
        return null
      }
    }
    // Same media-path vetting as opening a project: only files that really
    // exist get allowlisted for the media:// protocol (looked for beside the
    // file the snapshot was of, too).
    return { json, savedAt, resolved: await resolveProjectMedia(parsed, isLocalFilePath(of) ? of : null, event.sender) }
  })

  // Recover: the offered snapshot becomes this window's own (its next
  // snapshots replace it; a clean close removes it).
  ipcMain.handle('recovery:adopt', (event) => {
    const state = editorState(event.sender)
    const pending = state.pendingRecoveryPath
    if (!pending) return false
    state.pendingRecoveryPath = null
    // An own snapshot already written stays on disk for a later window or
    // launch to offer: nothing of it is thrown away unasked.
    if (state.recoveryPath && foldKey(state.recoveryPath) !== foldKey(pending)) claimedRecoveryPaths.delete(foldKey(state.recoveryPath))
    state.recoveryPath = pending
    claimedRecoveryPaths.add(foldKey(pending))
    return true
  })

  // Later (and Esc, and a click beside the question): the snapshot stays on
  // disk, unclaimed, and is offered again by the next window or launch.
  ipcMain.handle('recovery:release', (event) => {
    const state = editorState(event.sender)
    const pending = state.pendingRecoveryPath
    if (pending) {
      claimedRecoveryPaths.delete(foldKey(pending))
      state.pendingRecoveryPath = null
    }
    return true
  })

  // Nothing unsaved any more (a save, another project opened, a new one:
  // phase Ç2a.2, decision 5; report P3): this window's OWN snapshot is
  // removed. One only offered (pending) is never touched here.
  ipcMain.handle('recovery:clear-own', async (event) => {
    const state = editorState(event.sender)
    const own = state.recoveryPath
    if (!own) return true
    state.recoveryPath = null
    claimedRecoveryPaths.delete(foldKey(own))
    await onePerPath(own, () => fs.rm(own, { force: true })).catch(() => {})
    return true
  })

  // Discard: the offered snapshot (or, with none offered, this window's own)
  // is removed for good.
  ipcMain.handle('recovery:clear', async (event) => {
    const state = editorState(event.sender)
    const pending = state.pendingRecoveryPath
    const recovery = pending ?? state.recoveryPath
    if (recovery) {
      await fs.rm(recovery, { force: true }).catch(() => {})
      claimedRecoveryPaths.delete(foldKey(recovery))
      if (pending) state.pendingRecoveryPath = null
      else state.recoveryPath = null
    }
    return true
  })

  // ---- Earlier versions of a project file (phase Ç2a.2, decision 4) --------
  // Copies taken before an autosave wrote over the file (backups.ts). Listed
  // and read by the project's identity and a name backups.ts made; a version
  // opens as a copy tied to no file (its media resolved as an open does).
  ipcMain.handle('backups:list', (_event, uid: unknown) => listBackups(app.getPath('userData'), uid))
  ipcMain.handle('backups:read', async (event, uid: unknown, name: unknown) => {
    const json = await readBackup(app.getPath('userData'), uid, name)
    if (json === null) return null
    let parsed: unknown
    try {
      parsed = parseJsonFile(json)
    } catch {
      return { json, resolved: {} }
    }
    // (A version of the open project: its code clips' folders are judged beside that project's file.)
    return { json: stripBom(json), resolved: await resolveProjectMedia(parsed, editorState(event.sender).currentProjectPath, event.sender) }
  })

  // ---- Recent projects ----------------------------------------------------
  // A small index in userData listing the projects the user has saved/opened,
  // so the Projects home can show them with thumbnails. Only metadata + a tiny
  // data-URL thumbnail live here; the media stays on disk at its own path.
  // Whatever the app was launched with, claimed exactly once.
  ipcMain.handle('project:pending-open', (event) => {
    const state = editorState(event.sender)
    const p = state.pendingOpenPath
    state.pendingOpenPath = null
    return p
  })
}
