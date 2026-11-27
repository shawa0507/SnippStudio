// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// IPC for writing files: save dialogs, a chosen path, a long export streamed
// into its file, a file beside the video, the clipboard. Moved out of
// registerIpc (src/main/index.ts) in SnippStudio phase 2B; registerIpc calls it
// where these stood.
import { app, clipboard, dialog } from 'electron'
import { filterName } from '../strings-main'
import type { WebContents } from 'electron'
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { isLocalFilePath, isSafeOutput } from '../security'
import { checkReplaceable, onePerPath, renameWithRetry, writeFileAtomic, writeViaPart } from '../safe-write'
import { withRelativePaths } from '../project-media'
import { e2eMode, testBuild } from '../e2e-hooks'
import { ipcMain, knownProjectPaths, rememberDiskStamp, editorState, ownerWindow, windowUsingProject, normalize, focusEditorWindow } from '../state'
import { PRODUCT_NAME } from '../../shared/product'
import { registerExportPlaceIpc, rememberExportFolder } from './export-place-ipc'

/** Test runs only (an e2e window of an unpackaged build; phase Ç3b): a disk
 *  that is full once an export has written `fullAfter` bytes (its writes
 *  then fail with ENOSPC, as Node's own do), and the free space an export's
 *  precheck sees. Null: the real disk. */
const diskFault: { fullAfter: number | null; free: number | null; slowMs: number | null } = { fullAfter: null, free: null, slowMs: null }

const enospc = (): Error => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', errno: -4055, syscall: 'write' })

/** Test runs only (phase Ç3 patch): an export's file operations made slow, so
 *  a test can press Cancel while one is in flight. */
export async function testSlowIo(): Promise<void> {
  if (diskFault.slowMs) await new Promise((r) => setTimeout(r, diskFault.slowMs!))
}

/** A whole file's bytes into `fh`, failing as a full disk does past the test
 *  hook's `fullAfter` (what was written before stays written). */
export async function writeAllFaulted(fh: FileHandle, data: Uint8Array): Promise<void> {
  await testSlowIo()
  const full = diskFault.fullAfter
  if (full !== null && data.byteLength > full) {
    await fh.write(data, 0, full, 0)
    throw enospc()
  }
  await fh.writeFile(data)
}

export function registerFileIpc(): void {
  registerExportPlaceIpc()
  if (testBuild())
    ipcMain.handle('test:disk-fault', (_e, raw: unknown) => {
      if (!e2eMode()) return false
      const f = (raw ?? {}) as { fullAfter?: unknown; free?: unknown; slowMs?: unknown }
      const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
      diskFault.fullAfter = num(f.fullAfter)
      diskFault.free = num(f.free)
      diskFault.slowMs = num(f.slowMs)
      return true
    })

  ipcMain.handle(
    'dialog:save-file',
    async (event, args: { defaultName: string; filterName: string; extensions: string[]; data: Uint8Array | string }) => {
      const win = ownerWindow(event.sender)
      if (!win) return { saved: false }
      const result = await dialog.showSaveDialog(win, {
        defaultPath: args.defaultName,
        filters: [{ name: filterName(args.filterName), extensions: args.extensions }]
      })
      if (result.canceled || !result.filePath) return { saved: false }
      if (!isSafeOutput(result.filePath)) return { saved: false, error: 'Unsupported output path or file type' }
      if (/\.(snipp|autocut)$/i.test(result.filePath)) {
        const alreadyOpen = windowUsingProject(result.filePath, event.sender.id)
        if (alreadyOpen) {
          focusEditorWindow(alreadyOpen)
          return { saved: false, error: `This project is already open in another ${PRODUCT_NAME} window.` }
        }
      }
      const target = result.filePath
      // A project file: its media also relative to it (phase Ç2a.2, decision 3).
      const data = typeof args.data === 'string' ? (/\.(snipp|autocut)$/i.test(target) ? withRelativePaths(args.data, target) : args.data) : Buffer.from(args.data)
      // Whole or not at all (safe-write.ts); a failure still throws, as before.
      await onePerPath(target, async () => {
        await writeFileAtomic(target, data)
        if (/\.(snipp|autocut)$/i.test(target)) {
          const projectPath = normalize(target)
          knownProjectPaths.add(projectPath)
          const state = editorState(event.sender)
          state.currentProjectPath = projectPath
          await rememberDiskStamp(state, projectPath)
        }
      })
      return { saved: true, path: result.filePath }
    }
  )

  // Give an unsaved project a .snipp path without a native save dialog
  // (e.g. when an agent creates a code clip or calls project({save})).
  ipcMain.handle('project:create-file', async (event, rawArgs?: unknown) => {
    const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as { dir?: unknown; name?: unknown }
    const docs = app.getPath('documents')
    if (!isLocalFilePath(docs)) return { ok: false, error: 'Only local drive paths are supported in offline mode' }

    let dir: string
    if (args.dir !== undefined && args.dir !== null && args.dir !== '') {
      if (typeof args.dir !== 'string' || !isLocalFilePath(args.dir)) {
        return { ok: false, error: 'Only local drive paths are supported in offline mode' }
      }
      dir = normalize(args.dir)
    } else {
      dir = path.join(docs, PRODUCT_NAME)
    }

    const safe =
      String(typeof args.name === 'string' && args.name.trim() ? args.name : 'project')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 80) || 'project'

    await fs.mkdir(dir, { recursive: true })

    // Never overwrite an existing project: Name.snipp, Name 2.snipp, ...
    let target = path.join(dir, `${safe}.snipp`)
    for (let n = 2; await fs.stat(target).catch(() => null); n++) {
      target = path.join(dir, `${safe} ${n}.snipp`)
    }

    const p = normalize(target)
    knownProjectPaths.add(p)
    // Set currentProjectPath synchronously here so the next IPC
    // (codefilm:make-anim) sees it without racing api.setCurrentProjectPath.
    editorState(event.sender).currentProjectPath = p

    return { ok: true, path: p }
  })

  // Two-step save for long renders: pick the destination BEFORE producing the
  // data, then write to it after. Lets the export dialog ask "where?" up front
  // (and abort with zero work if cancelled) instead of after rendering.
  ipcMain.handle(
    'dialog:choose-save',
    async (event, args: { defaultName: string; filterName: string; extensions: string[] }) => {
      const win = ownerWindow(event.sender)
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        defaultPath: args.defaultName,
        filters: [{ name: filterName(args.filterName), extensions: args.extensions }]
      })
      if (result.canceled || !result.filePath) return null
      if (!isSafeOutput(result.filePath)) return null
      const p = normalize(result.filePath)
      editorState(event.sender).chosenSavePaths.add(p)
      // Its folder is one the user chose: the export window's place from now
      // on (REF-AB item 11, export-place-ipc.ts).
      await rememberExportFolder(path.dirname(p))
      // ONLY the file the user chose becomes writable. The export window's
      // other outputs of the run (the same name with another extension, the
      // cover) used to be opened here too, as "siblings", with no look at
      // what was already there: the system's "replace it?" covers the chosen
      // file alone, so a tanitim.wav beside the chosen tanitim.mp4 was
      // written over unasked, and any output type could be named (.snipp,
      // .json, .txt). They go through export:approve now (export-place-ipc.ts:
      // export file types only, a file already there is asked about first):
      // one door (22 Nov, K1).
      return result.filePath
    }
  )

  ipcMain.handle('file:write-chosen', async (event, args: { path: string; data: Uint8Array }) => {
    const p = normalize(args.path)
    // Only paths the user picked through the dialog above are writable here.
    if (!isSafeOutput(p)) return { saved: false, error: 'Unsupported output file type' }
    if (!editorState(event.sender).chosenSavePaths.has(p)) return { saved: false, error: 'path not chosen' }
    // Beside the target, then put in place (safe-write.ts writeViaPart; phase
    // Ç3 patch, R-2): a failed write leaves the old file of that name whole.
    try {
      await onePerPath(p, () => writeViaPart(p, Buffer.from(args.data), { write: writeAllFaulted }))
      return { saved: true, path: args.path }
    } catch (err) {
      return { saved: false, error: String(err) }
    }
  })

  // A long export written as it is made (2026-10-12: a 12-minute film is
  // about 3 GB, more than one buffer in the renderer can hold, so the
  // export failed with "Array buffer allocation failed"). Opened on a path
  // this window's save dialog chose, written at positions into <path>.part,
  // then kept (renamed into place) or dropped.
  const streams = new Map<string, { fh: FileHandle; path: string; part: string; owner: number }>()
  // A page that closes, reloads or crashes mid-export never closes its
  // stream: its file handle and its (often multi-GB) .part go with it.
  const closeStreamsOf = async (owner: number): Promise<void> => {
    for (const [id, s] of [...streams]) {
      if (s.owner !== owner) continue
      streams.delete(id)
      await s.fh.close().catch(() => {})
      await fs.rm(s.part, { force: true }).catch(() => {})
    }
  }
  const streamOwnersWatched = new Set<number>()
  const watchStreamOwner = (contents: WebContents): void => {
    const id = contents.id
    if (streamOwnersWatched.has(id)) return
    streamOwnersWatched.add(id)
    const end = (): void => void closeStreamsOf(id)
    contents.once('destroyed', () => {
      streamOwnersWatched.delete(id)
      end()
    })
    // Once a new page is really there (did-navigate, as in app:keep-awake): a
    // navigation the will-navigate guard blocks must not drop a running export.
    contents.on('did-navigate', end)
    contents.on('render-process-gone', end)
  }
  ipcMain.handle('file:stream-open', async (event, raw: unknown) => {
    const p = normalize(String(raw ?? ''))
    if (!isSafeOutput(p)) throw new Error('Unsupported output file type')
    if (!editorState(event.sender).chosenSavePaths.has(p)) throw new Error('path not chosen')
    // The film is put in place by a rename at the very end. A file of that
    // name open in a player that does not let it go would refuse it then,
    // after all the rendering: so it is asked now.
    if ((await checkReplaceable(p)) === 'busy') {
      throw new Error(`${path.basename(p)} is open in another program (a video player?). Close it there, then export again.`)
    }
    const part = `${p}.part`
    // (Read and write: the export reads its file back before it is kept.)
    const fh = await fs.open(part, 'w+')
    const id = `${event.sender.id}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    streams.set(id, { fh, path: p, part, owner: event.sender.id })
    watchStreamOwner(event.sender)
    return id
  })
  ipcMain.handle('file:stream-write', async (event, id: unknown, position: unknown, data: unknown) => {
    const s = streams.get(String(id))
    if (!s || s.owner !== event.sender.id) throw new Error('no such stream')
    if (!(data instanceof Uint8Array) || !Number.isSafeInteger(position) || (position as number) < 0) throw new Error('bad write')
    if (diskFault.fullAfter !== null && (position as number) + data.byteLength > diskFault.fullAfter)
      throw enospc()
    await testSlowIo()
    await s.fh.write(data, 0, data.byteLength, position as number)
    return true
  })
  // The finished .part read back before it is put in place (phase Ç3b,
  // decision 5; report R19): the export opens what it wrote and checks it.
  ipcMain.handle('file:stream-read', async (event, id: unknown, position: unknown, length: unknown) => {
    const s = streams.get(String(id))
    if (!s || s.owner !== event.sender.id) throw new Error('no such stream')
    if (!Number.isSafeInteger(position) || (position as number) < 0 || !Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > 64 * 2 ** 20) throw new Error('bad read')
    await testSlowIo()
    const buf = Buffer.alloc(length as number)
    const { bytesRead } = await s.fh.read(buf, 0, length as number, position as number)
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead)
  })
  ipcMain.handle('file:stream-size', async (event, id: unknown) => {
    const s = streams.get(String(id))
    if (!s || s.owner !== event.sender.id) throw new Error('no such stream')
    return (await s.fh.stat()).size
  })
  // The free space where a chosen file goes (phase Ç3b, decision 5; R25):
  // the export compares it with its size before it draws anything. Null:
  // not known (the export goes ahead).
  ipcMain.handle('file:free-space', async (event, raw: unknown) => {
    const p = normalize(String(raw ?? ''))
    if (!editorState(event.sender).chosenSavePaths.has(p)) return null
    if (diskFault.free !== null) return diskFault.free
    try {
      const st = await fs.statfs(path.dirname(p))
      return Number(st.bavail) * Number(st.bsize)
    } catch {
      return null
    }
  })
  ipcMain.handle('file:stream-close', async (event, id: unknown, keep: unknown) => {
    const s = streams.get(String(id))
    if (!s || s.owner !== event.sender.id) return false
    streams.delete(String(id))
    await s.fh.close().catch(() => {})
    if (keep === true) {
      // No delete first: the rename replaces the old file (MoveFileEx with
      // REPLACE_EXISTING), and if it cannot, the old film is still there.
      try {
        await renameWithRetry(s.part, s.path).catch(async () => {
          // Last: a read-only old file is not replaced by a rename, but it
          // can be removed. (Its own copy, the new film, is whole by now.)
          await fs.rm(s.path, { force: true })
          await renameWithRetry(s.part, s.path)
        })
      } catch {
        // The finished film stays as the .part, and the message says where.
        throw new Error(`The film is finished, but ${path.basename(s.path)} could not be replaced (it is open in another program?). The finished film is saved as ${s.part}. Close the other program and rename it, or export again.`)
      }
      return true
    }
    await fs.rm(s.part, { force: true }).catch(() => {})
    return false
  })

  // A text file beside a video this window's save dialog chose (round 9:
  // <video>.youtube.txt, the YouTube package). The kind picks the name; the
  // renderer never names a path of its own.
  ipcMain.handle('file:write-beside', async (event, args: { path: string; kind: string; text: string }) => {
    const p = normalize(String(args?.path ?? ''))
    if (!editorState(event.sender).chosenSavePaths.has(p)) return { saved: false, error: 'path not chosen' }
    const suffix = args?.kind === 'youtube' ? '.youtube.txt' : null
    if (!suffix) return { saved: false, error: 'unknown kind' }
    if (typeof args.text !== 'string' || args.text.length > 256 * 1024) return { saved: false, error: 'bad text' }
    const target = path.join(path.dirname(p), `${path.basename(p, path.extname(p))}${suffix}`)
    if (!isSafeOutput(target)) return { saved: false, error: 'Unsupported output path' }
    try {
      // (Whole or not at all, as every other output: phase 11b, A16.)
      await writeFileAtomic(target, args.text)
      return { saved: true, path: target }
    } catch (err) {
      return { saved: false, error: String(err) }
    }
  })

  // Text to the clipboard (Copy chapters). The page's own
  // navigator.clipboard goes through the permission handlers, which refuse
  // everything (secureSession), so the button said "Copied" over an
  // unchanged clipboard. Main writes it instead: text only, size-capped.
  ipcMain.handle('clipboard:write-text', (_e, text: unknown) => {
    if (typeof text !== 'string' || text.length > 1024 * 1024) return false
    clipboard.writeText(text)
    return true
  })
}
