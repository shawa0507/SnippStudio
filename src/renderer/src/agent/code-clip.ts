// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The code_clip tool (phase 5e, decision 5). create: the main process makes
// `anim\<name>\` beside the saved project (an empty page with a transparent
// body; a folder that is there already is used as it is), the folder comes
// into the project as a code film, and a clip of it goes on a new track over
// the picture through the edit pipeline (into the draft, like any edit).
// check: the checker (media/codefilm.ts) on the clip's film, over the film
// seconds the clip shows. The app never deletes the agent's folder: a draft
// rejected or a clip undone leaves it on disk.
import { api } from '../platform'
import { projectSession, useStore } from '../state/store'
import { codeFilms } from '../media/codefilm'
import { checkText } from '../media/codefilm-limits'
import { codeFilmImport } from '../media/import'
import { getLastProjectPath, saveProject, saveProjectTo } from '../media/projectio'
import { notify, t } from '../ui'
import type { Asset } from '../types'
import { filmCameIn, keptOf, lastRead, view } from './drafts'
import { sec } from './format'
import { useAgentStore } from './store'
import { PRODUCT_NAME } from '../../../shared/product'

/** Names Windows keeps for devices (a folder of that name cannot be made or
 *  removed as usual). */
const WINDOWS_KEEPS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** The longest code clip a create makes (s). */
const MAX_LENGTH = 6 * 3600

/** Turned into the edit the clip is placed with (agent/edit.ts runs it). */
export interface PlaceClip {
  ops: Record<string, unknown>[]
  base: string
}

export interface CreateArgs {
  name: string
  start: number
  end: number
  track?: string
}

function createArgs(raw: unknown): CreateArgs {
  const o = (raw ?? {}) as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error('create.name: letters, digits, - and _ (at most 64), e.g. "intro".')
  // (Audit A4: refused before a folder is made.)
  if (WINDOWS_KEEPS.test(name)) throw new Error(`create.name: "${name}" is a name Windows keeps for devices; give another.`)
  const start = typeof o.start === 'number' && Number.isFinite(o.start) ? o.start : NaN
  const end = typeof o.end === 'number' && Number.isFinite(o.end) ? o.end : NaN
  if (!(start >= 0) || !(end > start)) throw new Error('create: start ≥ 0 and end > start (timeline seconds).')
  if (end - start > MAX_LENGTH) throw new Error('create: at most 6 hours long.')
  return { name, start, end, ...(typeof o.track === 'string' && o.track ? { track: o.track } : {}) }
}

// ---- films a create brought in (audit A3) ----------------------------------------
// A create's film comes into the live project (its media), its clip into the
// draft. A film of those that no clip uses — in the project or in a draft
// waiting — leaves the project (no undo step of its own: an undo or redo
// that brings its clips back brings it back): the draft was rejected, its
// placement dropped, the accept undone. Its folder stays on disk.
const created = new Set<string>()
/** What a create still placing its clip brought in (the film and its
 *  sound), by the film's id. */
const placing = new Map<string, string[]>()
let createdIn = -1
let sweeping = false

function sweep(): void {
  if (sweeping || !created.size) return
  if (createdIn !== projectSession()) {
    created.clear()
    return
  }
  // (While a draft waits its clips may use them, and any of its ops could
  // come back: nothing goes.)
  if (useAgentStore.getState().draft) return
  const p = useStore.getState().project
  const used = new Set(Object.values(p.clips).map((c) => c.assetId))
  const busy = new Set([...placing.values()].flat())
  const gone = [...created].filter((id) => !busy.has(id) && !used.has(id) && p.assets.some((a) => a.id === id))
  if (!gone.length) return
  sweeping = true
  try {
    for (const id of gone) useStore.getState().deleteAsset(id, true)
  } finally {
    sweeping = false
  }
}
let watching = false
function watch(): void {
  if (watching) return
  watching = true
  const later = (): void => queueMicrotask(sweep)
  useStore.subscribe((s, prev) => {
    if (s.project !== prev.project) later()
  })
  useAgentStore.subscribe((s, prev) => {
    if (s.draft !== prev.draft) later()
  })
}

/** The create of that film has placed its clip (or failed): it may go now
 *  when nothing uses it. */
export function createDone(assetId: string): void {
  placing.delete(assetId)
  queueMicrotask(sweep)
}

/** The film of a folder in the project, or brought in (its length the clip's). */
async function filmOf(folder: string, length: number): Promise<{ asset: Asset; from: number; to: number }> {
  const same = (a: Asset): boolean => a.kind === 'code' && (a.path ?? '').toLowerCase() === folder.toLowerCase()
  const had = useStore.getState().project.assets.find(same)
  const v = (): number => useStore.getState().projectVersion
  if (had) return { asset: had, from: v(), to: v() }
  const info = await api!.codeFilm.register(folder)
  if (!info) throw new Error(`The folder ${folder} could not be opened as a code clip.`)
  const r = await codeFilmImport(info)
  const ps = useStore.getState().project.settings
  const code = r.assets.find((a) => a.kind === 'code')!
  // A new page says nothing yet: the clip's length and the project's size.
  const fresh: Asset = { ...code, duration: info.meta.duration ?? length, width: ps.width > 0 ? ps.width : code.width, height: ps.height > 0 ? ps.height : code.height }
  // (The versions this one call makes: nothing else runs in between.)
  const from = v()
  // (Brought in by a create: it leaves the project when no clip uses it.)
  watch()
  if (createdIn !== projectSession()) created.clear()
  createdIn = projectSession()
  const others = r.assets.filter((a) => a !== code)
  // (Marked before it comes in: the store's change runs the sweep.)
  placing.set(fresh.id, [fresh.id, ...others.map((a) => a.id)])
  const added = useStore.getState().addAssets([fresh, ...others]).map((a) => a.id)
  for (const id of added) created.add(id)
  const asset = useStore.getState().project.assets.find(same) ?? fresh
  if (asset.id !== fresh.id) {
    placing.delete(fresh.id)
    placing.set(asset.id, added)
  }
  return { asset, from, to: v() }
}

/** Gives an unsaved project a `.snipp` file on disk without a dialog.
 *  Never re-saves over a file the user already chose. */
export async function ensureProjectFile(opts?: { dir?: string; name?: string }): Promise<{ path: string; created: boolean }> {
  const known = getLastProjectPath()
  if (known) return { path: known, created: false }
  if (!api?.createProjectFile) throw new Error(`Giving a project a file needs the ${PRODUCT_NAME} app.`)

  const project = useStore.getState().project
  const made = await api.createProjectFile({
    ...(opts?.dir !== undefined ? { dir: opts.dir } : {}),
    name: opts?.name ?? project.name
  })
  if (!made?.ok || !made.path) throw new Error(made?.error || 'the project could not be given a file')

  const seq = useStore.getState().editSeq
  const file = await saveProjectTo(made.path, project)
  if (useStore.getState().editSeq === seq) useStore.getState().setDirty(false)
  notify({
    text: t('project.autoSaved', { file }),
    action: { label: t('project.showInFolder'), run: () => void api?.revealPath(file) }
  })
  return { path: file, created: true }
}

/** create: the folder and the film; what the edit pipeline then places. */
export async function prepareCreate(raw: unknown, projectPath: string | null, client: string, session: string): Promise<{ place: PlaceClip; head: string; assetId: string; createdFile?: string }> {
  const a = createArgs(raw)
  if (!api?.codeFilm.makeAnim) throw new Error(`Code clips need the ${PRODUCT_NAME} app.`)
  // (Audit A2: the seconds are of the agent's newest read, as an edit's are
  // of its base: a change made since is carried or the op drops with its
  // reason. Asked before anything is made: a version gone is refused here.)
  const base = lastRead(client)
  const seen = base ? keptOf(client, base).project : view().project
  // (Audit A4: a track that is not there is refused before anything is made.)
  if (a.track && !seen.tracks.some((t) => t.id === a.track)) throw new Error(`create.track: there is no track "${a.track}" (tracks: ${seen.tracks.map((t) => t.id).join(', ')}); give none for a new one over the picture.`)
  let createdFile: string | undefined
  if (!projectPath) {
    const ensured = await ensureProjectFile()
    projectPath = ensured.path
    if (ensured.created) createdFile = ensured.path
  }
  const made = await api.codeFilm.makeAnim(projectPath, a.name)
  if (!made.ok || !made.folder) {
    if (made.error === 'save the project first') {
      notify({ text: t('codeFilm.saveFirst'), action: { label: t('codeFilm.saveProject'), run: () => void saveProject(useStore.getState().project) } })
      throw new Error('save the project first: the clip\'s folder goes beside the project file.')
    }
    throw new Error(`create: ${made.error ?? 'the folder could not be made'}`)
  }
  const film = await filmOf(made.folder, a.end - a.start)
  // (A film of an earlier create used again: not swept while this one places.)
  if (created.has(film.asset.id) && !placing.has(film.asset.id)) placing.set(film.asset.id, [film.asset.id])
  // A folder made now: "being written" on the timeline until its code changes.
  if (!made.existed) codeFilms.markWriting(film.asset.id)
  filmCameIn(client, session, film.asset, film.from, film.to)
  const v = base ? { token: base } : view(undefined, client)
  // A new track goes on top of the video tracks: over the picture.
  const ops: Record<string, unknown>[] = [
    ...(a.track ? [] : [{ op: 'track.add', kind: 'video', id: 'code' }]),
    { op: 'clip.add', assetId: film.asset.id, trackId: a.track ?? 'code', start: a.start, id: 'clip' }
  ]
  // (The clip is as long as its film: trimmed to the range asked when the
  // folder's page already says a longer length.)
  if (film.asset.duration > a.end - a.start + 1e-6) ops.push({ op: 'clip.trimEnd', clipId: 'clip', delta: a.end - a.start - film.asset.duration })
  const fileLine = createdFile ? ` Project file: ${createdFile}.` : ''
  const head = `Folder: ${made.folder}${made.existed ? ' (it was there: its files are kept as they are)' : ' (index.html: an empty page)'}. Film ${sec(a.end - a.start)} s.${fileLine}`
  return { place: { ops, base: v.token }, head, assetId: film.asset.id, ...(createdFile ? { createdFile } : {}) }
}

/** check: the checker on the clip's film, over the seconds the clip shows. */
export async function checkClip(clipId: unknown, client: string): Promise<string> {
  if (typeof clipId !== 'string' || !clipId) throw new Error('check: a clip id (create answers it in "New:").')
  const v = view(undefined, client)
  const clip = v.project.clips[clipId] ?? useStore.getState().project.clips[clipId]
  if (!clip) throw new Error(`There is no clip "${clipId}".`)
  const asset = useStore.getState().project.assets.find((x) => x.id === clip.assetId) ?? v.project.assets.find((x) => x.id === clip.assetId)
  if (!asset || asset.kind !== 'code') throw new Error(`"${clipId}" is not a code clip.`)
  const from = clip.inPoint ?? 0
  const span: [number, number] = [from, from + clip.duration * (clip.speed ?? 1)]
  const r = await codeFilms.check(asset, span)
  return checkText(r, clipId)
}
