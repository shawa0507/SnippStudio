// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { cleanBackdrop } from '../playback/backdrop'
import { api, downloadBlob, pickFilesBrowser } from '../platform'
import type { Asset, Project, TemplateBlock } from '../types'
import { defaultCaptionStyle, defaultProject, newProjectUid } from '../types'
import { sanitizeTemplates } from '../templates/model'
import { sanitizeNotes } from '../notes/model'
import { stripLegacy, type LegacyPart } from './legacy'
import { safeFileName } from '../export/formats'
import { CURRENT_FORMAT, convertProject, formatOf } from '../model/format'
import { Repairs, repairProject, repairShape, type RepairNote, type RepairOptions } from '../model/repair'
import { fingerprintState } from './fingerprint'
import type { ResolvedMedia } from '../../../preload/index'
import { t, type StringKey } from '../ui/strings'

/** Fills in fields added after a project file was saved and makes loaded
 *  data safe to draw (every file, whatever its format: the format's own
 *  conversions are model/format.ts). */
function normalizeProject(project: Project, fixed: Repairs): void {
  const defaults = defaultProject()
  project.captionStyle = { ...defaultCaptionStyle(), ...project.captionStyle }
  project.snap = { ...defaults.snap, ...project.snap }
  const templates = sanitizeTemplates(project)
  const unknown = project.unknownTemplates?.length ?? 0
  fixed.add('template-unknown', unknown)
  fixed.add('template-dropped', templates - unknown)
  // Work notes are drawn and sent to an agent: the same repair (a project
  // saved before they existed has none, and stays as it is).
  fixed.add('note-dropped', sanitizeNotes(project))
  const raw = (project as { backdrop?: unknown }).backdrop
  const backdrop = cleanBackdrop(raw)
  if (backdrop) project.backdrop = backdrop
  else delete project.backdrop
  // (A background that could not be read is said, as a look: phase 11b, A4.
  // "black" is no background, as before.)
  const black = !!raw && typeof raw === 'object' && (raw as { style?: unknown }).style === 'black'
  if (raw !== undefined && raw !== null && !backdrop && !black) fixed.add('look')
}
import { computeFilmstrip, importMediaFiles } from './import'
import { dropInput, getInput, getVideoSink, releaseAllMedia } from './sources'
import { hdrOf } from './hdr'
import { PRODUCT_NAME } from '../../../shared/product'

/** A file that cannot be opened as a project, and why (phase Ç2a.1, P8):
 *  `damaged` (not readable: cut short, not JSON), `not-project` (readable,
 *  but no Snipp project), `newer-type` (a Snipp project of a kind this build
 *  cannot read at all). Its message is the user's. */
export class ProjectFileError extends Error {
  constructor(readonly kind: 'damaged' | 'not-project' | 'newer-type') {
    super(t(kind === 'damaged' ? 'project.file.damaged' : kind === 'not-project' ? 'project.file.notProject' : 'project.file.newerType'))
  }
}

export interface ReadProject {
  project: Project
  removed: LegacyPart[]
  saveId: string
  recoveredPath?: string
  /** What the file had wrong that the reading mended (model/repair.ts). */
  repaired: RepairNote[]
  /** The file's format when it is newer than this build's (model/format.ts). */
  newerFormat?: number
}

/** A project file's text as the project it holds: converted from its format
 *  (model/format.ts), brought up to date (fields added since it was saved),
 *  what this app does not have taken out (media/legacy.ts), and mended where
 *  it breaks the model's rules (model/repair.ts). One reading for Open, the
 *  Projects list, crash recovery and the agent's restore points. Throws a
 *  ProjectFileError on a file that is not a readable Snipp project. */
export function readProjectFile(json: string, opts: RepairOptions = {}): ReadProject {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ProjectFileError('damaged')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProjectFileError('not-project')
  const extra = raw as Record<string, unknown>
  if (typeof extra.version === 'number' && extra.version > 1) throw new ProjectFileError('newer-type')
  if (extra.version !== 1) throw new ProjectFileError('not-project')
  // What only the file carries (phase 4A.11, P1 / P3) never stays in the
  // project: its save id, and in a crash snapshot the file it was of.
  const saveId = typeof extra.saveId === 'string' && /^[A-Za-z0-9]{1,40}$/.test(extra.saveId) ? extra.saveId : `h${fnv(json)}`
  const recoveredPath = typeof extra[RECOVERED_PATH] === 'string' ? (extra[RECOVERED_PATH] as string) : undefined
  delete extra.saveId
  delete extra[RECOVERED_PATH]
  const format = formatOf(extra)
  const fixed = new Repairs()
  repairShape(extra, fixed)
  const project = extra as unknown as Project
  const removed = stripLegacy(project)
  // (A conversion that reads the layout runs after the repair: Ç2b patch,
  // item 6, model/format.ts afterRepair.)
  convertProject(project, format, () => {
    normalizeProject(project, fixed)
    repairProject(project, fixed, opts)
  })
  return { project, removed, saveId, ...(recoveredPath ? { recoveredPath } : {}), repaired: fixed.list(), ...(format > CURRENT_FORMAT ? { newerFormat: format } : {}) }
}

/** What the main process said when it could not hand a file over: a file
 * that is not JSON is a damaged project file, said in the user's words. */
function openError(message: string | undefined): Error {
  if (message && /not valid JSON/i.test(message)) return new ProjectFileError('damaged')
  return new Error(message ?? 'Could not open project')
}

/** The repairs of a reading, in one line for the user (empty: none). */
export function repairSummary(list: readonly RepairNote[]): string {
  return list.map((x) => t(`project.repair.${x.code.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}` as StringKey, { n: x.count })).join('; ')
}

/** FNV-1a, 32 bits, as 8 hex digits: the save id of a file written before
 *  save ids (or by another program), from its text. */
function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** A crash snapshot's field naming the file its project was of. */
const RECOVERED_PATH = 'recoveredFromFile'

/** A new save id: written into the file at every save (phase 4A.11, P3). */
export const newSaveId = (): string => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** A project identity the copies of the file can be kept under (the folder
 *  name main/backups.ts accepts). */
const BACKUP_UID = /^[A-Za-z0-9_-]{1,80}$/

/** A project file read to be OPENED (the dialog, a path, the Projects list,
 *  crash recovery): one from before projects had an identity gets one now,
 *  written with its next save (phase 4A.10, E1). One whose identity cannot
 *  name its copies' folder (written by hand, another program) gets a new one
 *  too, told as a repair, so the file is copied before its first save and
 *  can be autosaved at all (Ç2a patch, item 4). A file read for any other
 *  reason (a restore point) is left exactly as it is. */
export function readProjectToOpen(json: string, opts: RepairOptions = {}): ReadProject {
  const out = readProjectFile(json, opts)
  if (typeof out.project.uid !== 'string' || !out.project.uid) out.project.uid = newProjectUid()
  else if (!BACKUP_UID.test(out.project.uid)) {
    out.project.uid = newProjectUid()
    out.repaired = [...out.repaired, { code: 'uid', count: 1 }]
  }
  return out
}

/** The project alone (see readProjectFile). */
export function parseProjectFile(json: string): Project {
  return readProjectFile(json).project
}

/** Strips runtime-only data so the project file stays small and portable.
 *  `file` adds what only the file carries: its save id (a save), or the
 *  file a crash snapshot's project was of. */
export function serializeProject(project: Project, file?: { saveId?: string; recoveredPath?: string | null }): string {
  const clean: Project = structuredClone(project)
  const extra = clean as unknown as Record<string, unknown>
  // The format the file is written in (model/format.ts), and the graphics of
  // an unknown kind back where the file had them (phase Ç2a.1).
  extra.formatVersion = CURRENT_FORMAT
  const unknown = clean.unknownTemplates
  delete clean.unknownTemplates
  if (unknown?.length) clean.templates = [...(clean.templates ?? []), ...(unknown as unknown as TemplateBlock[])]
  if (file?.saveId) extra.saveId = file.saveId
  if (file?.recoveredPath) extra[RECOVERED_PATH] = file.recoveredPath
  for (const asset of clean.assets) {
    delete asset.thumbnail
    delete asset.waveform
    delete asset.missing
    delete asset.undecodable
    delete asset.hdr
    // The filmstrip is a wide JPEG as a data URL — the largest thing an asset
    // carries by far, and it was written into every .snipp file AND into every
    // autosaved recovery snapshot. It is derived from the media and cached on
    // disk by path, so it is rebuilt on open exactly like the thumbnail.
    delete asset.filmstrip
    delete asset.filmstripCols
    // The path relative to the project file is the FILE's (phase Ç2a.2,
    // decision 3): main writes it with each save, from where the file goes
    // (main/project-media.ts withRelativePaths). One read from a file says
    // where that file was.
    delete asset.relPath
    asset.url = ''
  }
  return JSON.stringify(clean, null, 2)
}

/**
 * "Collect files": copies every media file the project uses into a folder the
 * user picks and writes a copy of the project beside them, pointing at those
 * copies.
 *
 * Media is referenced by absolute path. That is right for editing — nothing is
 * duplicated, nothing is hidden in a library — and wrong the moment the project
 * has to travel: a second drive, another PC, or just a tidy-up of the capture
 * folder, and the edit opens with everything missing. This makes one folder
 * that contains the whole thing.
 */
export async function archiveProject(
  project: Project,
  onProgress?: (done: number, total: number, name: string) => void
): Promise<{ ok: boolean; folder?: string; copied: number; bytes: number; failed: string[] }> {
  if (!api) return { ok: false, copied: 0, bytes: 0, failed: [] }
  const folder = await api.chooseFolder()
  if (!folder) return { ok: false, copied: 0, bytes: 0, failed: [] }
  const clean: Project = structuredClone(project)
  const failed: string[] = []
  let copied = 0
  let bytes = 0
  // Same source file twice in a project (two clips off one capture) is one copy.
  const done = new Map<string, string>()
  const assets = clean.assets.filter((a) => a.path)
  for (const [i, asset] of assets.entries()) {
    onProgress?.(i, assets.length, asset.name)
    const src = asset.path as string
    const already = done.get(src)
    if (already) {
      asset.path = already
      continue
    }
    // Prefix with the asset id so two files called "clip.mp4" from different
    // folders don't collide into one.
    const base = `${asset.id.slice(0, 6)}-${asset.name}`
    const result = await api.archiveCopy(src, base)
    if (!result.ok || !result.path) {
      failed.push(asset.name)
      continue
    }
    done.set(src, result.path)
    asset.path = result.path
    copied++
    bytes += result.bytes ?? 0
  }
  // The LUT files too (phase 11b, A17: the archived project said "(missing)").
  for (const [i, lut] of (clean.luts ?? []).entries()) {
    const result = await api.archiveCopyLut?.({ path: lut.path, ...(lut.relPath ? { relPath: lut.relPath } : {}), ...(lut.size ? { size: lut.size } : {}), name: `${i + 1}-${safeFileName(lut.name, 'look')}.cube` })
    if (!result?.ok || !result.path) {
      failed.push(lut.name)
      continue
    }
    lut.path = result.path
    delete lut.relPath
    copied++
    bytes += result.bytes ?? 0
  }
  onProgress?.(assets.length, assets.length, '')
  const json = serializeProject(clean)
  const write = await api.batchWrite(`${safeFileName(clean.name, 'project')}.snipp`, new TextEncoder().encode(json))
  if (!write.saved) return { ok: false, folder, copied, bytes, failed }
  return { ok: true, folder, copied, bytes, failed }
}

/** Path of the last saved/opened project file (enables Ctrl+S + autosave). */
let lastProjectPath: string | null = null
export const getLastProjectPath = (): string | null => lastProjectPath
/** The file the open project is of, for what is kept by its path (the
 *  agent's restore points): its path, and after a crash recovery the file the
 *  recovered project was of, although it is saved nowhere yet (phase 4A.11,
 *  P1: the recovered project keeps its points). */
let keyPath: string | null = null
export const getProjectKeyPath = (): string | null => keyPath
/** Keeps quick-save/autosave pointed at the file after a rename moves it. */
export const setLastProjectPath = (p: string | null): void => {
  lastProjectPath = p
  keyPath = p
  // The due copy is the file's: it goes with no file, follows a rename (the
  // same file), and an open sets its own right after (openedForBackup).
  backupNext = p === null || !backupNext ? null : { ...backupNext, file: p }
  fileEpoch++
  if (newerFile && newerFile.path !== p) newerFile = null
  api?.setCurrentProjectPath(p)
}
/**
 * When the project file is copied into the profile before it is written
 * (phase Ç2a.2, decision 4; main/backups.ts): 'auto' — before the next
 * autosave (the file is as the user opened or saved it); 'any' — before the
 * next save of any kind (the file was opened repaired or from a newer Snipp:
 * what the reading changed is not on disk yet); null — no copy is due.
 * Tied to the file it is for (Ç2a patch, item 3): a save of another file —
 * one that was open when the save began — neither uses nor changes it.
 */
let backupNext: { file: string; when: 'auto' | 'any' } | null = null
/** Bumped whenever the open file is set (an open, a rename, a Save As, no
 *  file): a save that began before leaves the due copy alone. */
let fileEpoch = 0
/** The file just opened is the open project's now (its path is set): a copy
 *  is due before the first autosave, or before any first save when the
 *  reading changed the project. */
function openedForBackup(file: string, changedByReading: boolean): void {
  backupNext = { file, when: changedByReading ? 'any' : 'auto' }
}
/** A crash recovery: the project is saved nowhere (Save asks for a name),
 *  but it is still the project of `file` for its restore points. */
export const setRecoveredProjectPath = (file: string | null): void => {
  setLastProjectPath(null)
  keyPath = file
}

/** The OPEN project got another path (saved under a new name, renamed): what
 *  is kept for it by its path goes along (the agent's restore points: moved
 *  for a rename, copied for a Save As — the file it was saved from keeps its
 *  own, phase 4A.11, P2). Not for opening another file, which sets the path
 *  before that project loads. */
export type MoveKind = 'rename' | 'saveAs'
const movedListeners: ((from: string | null, to: string, how: MoveKind) => void)[] = []
export function onProjectMoved(fn: (from: string | null, to: string, how: MoveKind) => void): () => void {
  movedListeners.push(fn)
  return () => void movedListeners.splice(movedListeners.indexOf(fn), 1)
}
export function moveProjectPath(to: string, how: MoveKind = 'rename'): void {
  const from = keyPath
  setLastProjectPath(to)
  if (from !== to) for (const fn of movedListeners) fn(from, to, how)
}

/** The project was saved to `file` with save id `saveId` (phase 4A.11, P3). */
const savedListeners: ((file: string, saveId: string) => void)[] = []
export function onProjectSaved(fn: (file: string, saveId: string) => void): () => void {
  savedListeners.push(fn)
  return () => void savedListeners.splice(savedListeners.indexOf(fn), 1)
}
/** A save wrote the project to `file` with save id `saveId`: a Save As
 *  (`saveAs`) gives the open project that path first (its points copied
 *  there), then what is kept for the file learns its save id (phase 4A.11,
 *  P2 / P3). The one place both saves go through. */
export function projectWritten(file: string, saveId: string, how: 'quick' | 'saveAs'): void {
  if (how === 'saveAs') moveProjectPath(file, 'saveAs')
  savedListeners.forEach((fn) => fn(file, saveId))
}

/** A crash snapshot of `project`: the file it is of goes with it (P1). */
export const recoveryText = (project: Project): string => serializeProject(project, { recoveredPath: keyPath })

/** The file just opened and the save id it holds, until the project it
 *  holds is loaded (agent/restore.ts takes it then: phase 4A.11, P3). */
let opened: { file: string; saveId: string } | null = null
export const noteOpenedFile = (file: string, saveId: string): void => void (opened = { file, saveId })
export function takeOpenedFile(): { file: string; saveId: string } | null {
  const o = opened
  opened = null
  return o
}

/** A quick save found the project file written by another program (a film
 *  tool) since this window opened or saved it; nothing was written. Saving
 *  again with `force` writes over it. */
export class ChangedOnDiskError extends Error {
  constructor(readonly path: string) {
    super('This project file was changed by another program since you opened it.')
  }
}

/** A quick save would write over a file a NEWER Snipp saved (its format is
 *  above this build's, model/format.ts): nothing was written. Saving again
 *  with `overNewer` writes over it (phase Ç2a.1). */
export class NewerFormatError extends Error {
  constructor(
    readonly path: string,
    readonly format: number
  ) {
    super(t('project.newer.message', { file: format, mine: CURRENT_FORMAT }))
  }
}

/** A save found that the file could not be copied into the profile first
 *  (decision 4): nothing was written over it. */
export class BackupFailedError extends Error {
  constructor(readonly path: string) {
    super(t('project.backup.failed'))
  }
}

/** The open file, when a newer Snipp wrote it (until it is saved over). */
let newerFile: { path: string; format: number } | null = null
/** The file just opened was written in format `format` (newer than this build). */
export function noteNewerFile(path: string | null, format: number | undefined): void {
  newerFile = path && format !== undefined && format > CURRENT_FORMAT ? { path, format } : null
}

/** Writes `project` directly to a known or newly allocated `filePath` without a dialog. */
export async function saveProjectTo(filePath: string, project: Project): Promise<string> {
  if (!api) throw new Error(`Saving requires the ${PRODUCT_NAME} app.`)
  const saveId = newSaveId()
  const json = serializeProject(project, { saveId })

  const r = await api.saveProjectDirect(filePath, json, true)
  if (!r.saved || !r.path) throw new Error(r.error || 'the project file could not be written')

  // Sets lastProjectPath, informs main of the window's path, rekeys version/restore
  // points, and triggers savedListeners (withRelativePaths runs inside project:save-direct).
  projectWritten(r.path, saveId, 'saveAs')
  backupNext = { file: r.path, when: 'auto' }
  return r.path
}

export async function saveProject(project: Project, opts: { quick?: boolean; force?: boolean; overNewer?: boolean; auto?: boolean } = {}): Promise<boolean> {
  const saveId = newSaveId()
  const json = serializeProject(project, { saveId })
  const name = `${safeFileName(project.name, 'project')}.snipp`
  if (api) {
    // Quick save writes straight to the known file, no dialog.
    if (opts.quick && lastProjectPath) {
      const file = lastProjectPath
      // Asked first: what a newer Snipp wrote and this one does not know
      // would be lost.
      if (newerFile && newerFile.path === file && !opts.overNewer) throw new NewerFormatError(file, newerFile.format)
      // The file as it is now is copied into the profile first when a copy
      // is due (decision 4): main writes nothing over it if it cannot.
      const due = backupNext?.file === file ? backupNext.when : null
      const backup = due === 'any' || (opts.auto === true && due === 'auto') ? (project.uid ?? '') : null
      const epoch = fileEpoch
      const result = await api.saveProjectDirect(file, json, opts.force === true, backup !== null ? { backup } : undefined)
      if (result.saved) {
        if (newerFile?.path === file) newerFile = null
        // After an autosave no copy is due until the next open or explicit
        // save; after an explicit save, before the next autosave. Only while
        // this file is still the open one, as it was when the save began
        // (another project opened meanwhile keeps its own due copy).
        if (lastProjectPath === file && fileEpoch === epoch) backupNext = opts.auto === true ? null : { file, when: 'auto' }
        projectWritten(file, saveId, 'quick')
        return true
      }
      if (result.error === 'changed-on-disk') throw new ChangedOnDiskError(lastProjectPath)
      if (result.error === 'backup-failed') throw new BackupFailedError(file)
      if (result.error && result.error !== 'unknown path') throw new Error(result.error)
      // Path no longer valid — fall through to the dialog.
    }
    const result = await api.saveFile({
      defaultName: name,
      filterName: `${PRODUCT_NAME} project`,
      extensions: ['snipp'],
      data: json
    })
    if (result.error) throw new Error(result.error)
    if (result.saved && result.path) {
      projectWritten(result.path, saveId, 'saveAs')
      backupNext = { file: result.path, when: 'auto' }
    }
    return result.saved
  }
  downloadBlob(new Blob([json], { type: 'application/json' }), name)
  return true
}

export interface LoadedProject {
  project: Project
  missing: string[]
  /** What the file held that this app does not have. Not empty: the project
   *  is a copy — not tied to the file (Save asks for a new name). */
  removed: LegacyPart[]
  /** What the reading mended (model/repair.ts): told once, saved with the
   *  next save. */
  repaired: RepairNote[]
  /** Media files changed on disk since the project last read them (phase
   *  Ç2a.2, decision 2): read again once the project is loaded
   *  (media/relink.ts refreshChangedMedia). */
  changed: ChangedMedia[]
  /** Media files found by the path relative to the project file although
   *  the project stored no size to confirm them (a project folder moved
   *  whole): their names, told with the open (Ç2a patch, item 1). */
  unconfirmed: string[]
}

/** A media file whose fingerprint differs from the asset's: the asset, and
 *  the file's fingerprint now. */
export interface ChangedMedia {
  id: string
  size: number
  mtime: number
  /** The path the project stored, when the file was found elsewhere: the
   *  asset goes back to it if the file cannot be read again (Ç2a patch). */
  stored?: string
}

/** Re-derives thumbnails and waveforms for freshly re-linked assets. */
export async function enrichAsset(
  asset: Asset,
  update: (id: string, patch: Partial<Asset>) => void
): Promise<void> {
  try {
    if (asset.kind === 'image') {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = asset.url
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = Math.max(2, Math.round((160 * img.naturalHeight) / Math.max(1, img.naturalWidth)))
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      update(asset.id, { thumbnail: canvas.toDataURL('image/jpeg', 0.7) })
      return
    }
    if (asset.kind === 'video') {
      // Alpha (phase 5b, decision 4): read before anything decodes it, so its
      // first frames already keep it (a project saved before 5b did not say).
      const track = await getInput(asset).getPrimaryVideoTrack().catch(() => null)
      const alpha = track ? await track.canBeTransparent().catch(() => false) : false
      if (alpha !== !!asset.alpha) {
        update(asset.id, { alpha })
        asset = { ...asset, alpha }
      }
      // The strip comes back from the on-disk analysis cache when this file has
      // been in a project before, which is the usual case; otherwise it decodes
      // exactly as it did at import.
      void computeFilmstrip(asset, update)
      // Decodable on this computer (phase Ç3a, decision 6): badged if not.
      if (track && !(await track.canDecode().catch(() => true))) update(asset.id, { undecodable: true })
      const hdr = track ? hdrOf(await track.getColorSpace().catch(() => null)) : null
      if (hdr) update(asset.id, { hdr })
      const sink = await getVideoSink(asset, 160)
      const wrapped = await sink?.getCanvas(Math.min(0.5, asset.duration / 2))
      if (wrapped) {
        const canvas = document.createElement('canvas')
        canvas.width = wrapped.canvas.width
        canvas.height = wrapped.canvas.height
        canvas.getContext('2d')!.drawImage(wrapped.canvas, 0, 0)
        update(asset.id, { thumbnail: canvas.toDataURL('image/jpeg', 0.7) })
      }
    }
    // Waveforms are handled by the lazy waveform cache, not stored on assets.
  } catch {
    // Non-fatal: the asset still works without a thumbnail/waveform.
  }
}

// ---------------------------------------------------------------------------
// Crash recovery. The normal autosave can only write to a path the user has
// already chosen, so a project that was never saved had no protection at all.
// These write a snapshot to app data instead, which covers that case.
// ---------------------------------------------------------------------------

/** Writes a recovery snapshot. Best-effort: failures are silent. */
export async function writeRecovery(project: Project): Promise<void> {
  if (!api) return
  try {
    // (The file the project is of goes with it: phase 4A.11, P1.)
    await api.recoveryWrite(recoveryText(project))
  } catch {
    /* recovery is best-effort */
  }
}

export async function clearRecovery(): Promise<void> {
  if (!api) return
  try {
    await api.recoveryClear()
  } catch {
    /* ignore */
  }
}

/** Nothing unsaved any more: this window's own crash snapshot goes (phase
 *  Ç2a.2, media/recovery-writer.ts). One only offered is kept. */
export async function clearOwnRecovery(): Promise<void> {
  try {
    await api?.recoveryClearOwn()
  } catch {
    /* ignore */
  }
}

/** Recover: the offered crash snapshot becomes this window's own. */
export async function adoptRecovery(): Promise<void> {
  try {
    await api?.recoveryAdopt()
  } catch {
    /* ignore */
  }
}

/** Later: the offered crash snapshot stays on disk, offered again next time. */
export async function releaseRecovery(): Promise<void> {
  try {
    await api?.recoveryRelease()
  } catch {
    /* ignore */
  }
}

/** What main said about each media path of a file it handed over. */
type Resolved = Record<string, ResolvedMedia | null> | undefined

/** The file main found for an asset (or none). */
const foundFor = (resolved: Resolved, a: { path?: string }): ResolvedMedia | null => (a.path ? resolved?.[a.path] ?? null : null)

/** The reading's options for a file main handed over: an asset whose file
 *  changed on disk keeps its clips as they are (their stored duration is not
 *  trusted; phase Ç2a.2, decision 2). */
const readOptions = (resolved: Resolved): RepairOptions => ({ untrustedDuration: (a) => fingerprintState(a, foundFor(resolved, a)) === 'changed' })

/** Points each asset at the file main found for it (or marks it missing):
 *  the names of the missing ones, and the files changed on disk since the
 *  project last read them (decision 2). An asset saved before fingerprints
 *  takes the file's now. */
function linkMedia(project: Project, resolved: Resolved, opening = true): { missing: string[]; changed: ChangedMedia[]; unconfirmed: string[] } {
  const missing: string[] = []
  const changed: ChangedMedia[] = []
  const unconfirmed: string[] = []
  // Another project: the last one's decoders and proxies go (report P12).
  // (A crash snapshot only offered is no project switch yet.)
  if (opening) releaseAllMedia()
  for (const asset of project.assets) {
    dropInput(asset.id)
    const entry = foundFor(resolved, asset)
    if (entry?.untrusted) {
      // A code film folder that is there but may not run yet (security
      // patch, item 6): nothing of it is loaded, the clip stays empty, and
      // the user is asked (security/trust.ts shows the question). It is not
      // "missing media": the Relink dialog has nothing to say about it.
      asset.url = ''
      asset.missing = true
      continue
    }
    if (entry) {
      asset.url = entry.url
      asset.missing = false
      const stored = asset.path
      // Found elsewhere (a moved project folder: beside the project file,
      // phase Ç2a.2, decision 3): that is where it lives now. Main took a
      // file found away from its own path only when the stored size confirms
      // it, or by relPath when there is no stored size: those are told
      // (Ç2a patch, item 1).
      if (entry.path && entry.path !== asset.path) {
        if (entry.via === 'rel' && !(typeof asset.size === 'number' && Number.isFinite(asset.size) && asset.size > 0)) unconfirmed.push(asset.name)
        asset.path = entry.path
      }
      const print = fingerprintState(asset, entry)
      if (print === 'fill') asset.mtime = entry.mtime
      else if (print === 'changed') changed.push({ id: asset.id, size: entry.size, mtime: entry.mtime ?? 0, ...(stored && stored !== asset.path ? { stored } : {}) })
    } else {
      asset.url = ''
      asset.missing = true
      missing.push(asset.name)
    }
  }
  return { missing, changed, unconfirmed }
}

/** Reads a pending recovery snapshot, re-linking media the same way as open. */
export async function readRecovery(): Promise<(LoadedProject & { savedAt: number; path: string | null }) | null> {
  if (!api) return null
  let result: Awaited<ReturnType<NonNullable<typeof api>['recoveryRead']>>
  try {
    result = await api.recoveryRead()
  } catch {
    return null
  }
  if (!result?.json) return null
  let project: Project
  let removed: LegacyPart[]
  let recoveredPath: string | undefined
  let repaired: RepairNote[]
  try {
    ;({ project, removed, recoveredPath, repaired } = readProjectToOpen(result.json, readOptions(result.resolved)))
  } catch {
    return null
  }
  const { missing, changed, unconfirmed } = linkMedia(project, result.resolved, false)
  return { project, missing, removed, repaired, changed, unconfirmed, savedAt: result.savedAt, path: recoveredPath ?? null }
}

/** A project file main handed over (the dialog or a path): read, tied to its
 *  path (unless it held what this app does not have: then it is a copy, tied
 *  to no file), its media linked. */
function openedFile(result: { json?: string; path?: string; resolved?: Resolved; error?: string }): LoadedProject {
  if (result.error || !result.json) throw openError(result.error)
  const { project, removed, saveId, repaired, newerFormat } = readProjectToOpen(result.json, readOptions(result.resolved))
  if (removed.length) setLastProjectPath(null)
  else if (result.path) {
    setLastProjectPath(result.path)
    noteOpenedFile(result.path, saveId)
    noteNewerFile(result.path, newerFormat)
    openedForBackup(result.path, repaired.length > 0 || newerFormat !== undefined)
  }
  const { missing, changed, unconfirmed } = linkMedia(project, result.resolved)
  return { project, missing, removed, repaired, changed, unconfirmed }
}

/** Opens a project by explicit path (a recents entry). Re-links media the same
 *  way the dialog open does, and remembers the path for quick-save/autosave —
 *  unless the file held what this app does not have: then the project is a
 *  copy, tied to no file. */
export async function openProjectByPath(filePath: string): Promise<LoadedProject | null> {
  if (!api) return null
  const result = await api.openProjectPath(filePath)
  if (!result) return null
  return openedFile(result)
}

/** An earlier version of the open project's file (decision 4,
 *  main/backups.ts), opened as a copy: tied to no file, so the project file
 *  is never touched (Save asks for a name). */
export async function openBackup(uid: string, name: string): Promise<LoadedProject | null> {
  if (!api) return null
  const result = await api.backupsRead(uid, name)
  if (!result) return null
  const { project, removed, repaired } = readProjectToOpen(result.json, readOptions(result.resolved))
  setLastProjectPath(null)
  const { missing, changed, unconfirmed } = linkMedia(project, result.resolved)
  return { project, missing, removed, repaired, changed, unconfirmed }
}

/** The copies of the project `uid`, newest first. */
export async function listBackups(uid: string | undefined): Promise<{ name: string; at: number; size: number }[]> {
  if (!api || !uid) return []
  return api.backupsList(uid).catch(() => [])
}

export async function openProject(): Promise<LoadedProject | null> {
  if (api) {
    const result = await api.openProjectDialog()
    if (!result) return null
    return openedFile(result)
  }

  // Browser fallback: pick the project file; media must be re-imported.
  const files = await pickFilesBrowser('.snipp,.autocut,application/json', false)
  if (files.length === 0) return null
  const { project, removed, repaired } = readProjectToOpen(await files[0].text())
  const missing: string[] = []
  for (const asset of project.assets) {
    dropInput(asset.id)
    asset.url = ''
    asset.missing = true
    missing.push(asset.name)
  }
  return { project, missing, removed, repaired, changed: [], unconfirmed: [] }
}

export { importMediaFiles }
