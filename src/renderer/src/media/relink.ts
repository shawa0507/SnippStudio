// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Pointing an asset at a file again, and reading a changed file again
// (SnippStudio phase Ç2a.2, decision 2; report P7, P12, P15). The new file is
// probed (duration, size, sound, kind): a file of another kind is refused,
// and the clips that now run past the new file's end are counted for the
// user. Where a file lives is no edit (no undo step: state/slices/project.ts
// updateAsset). The probe and the cache drops come from the caller
// (media/relink-ui.ts in the app; stand-ins in the tests).
import { projectSession, useStore } from '../state/store'
import type { Asset, AssetKind, Clip, Project } from '../types'
import type { ChangedMedia } from './projectio'
import { holdReread } from './reread-gate'

/** A file as main hands it over (preload ImportedFile). */
export interface PickedFile {
  url: string
  name: string
  path: string
  size: number
  mtime?: number
}

export interface RelinkDeps {
  /** Reads a file as media (kind, duration, size, sound); null: not media. */
  probe: (file: PickedFile) => Promise<Asset | null>
  /** Forgets everything cached for an asset id (decoders, frames, peaks,
   *  strips, its proxy). */
  drop: (assetId: string) => void
}

const PAST_END_EPS = 1e-3

/** How many clips of asset `id` (inside compounds too) read past `duration`. */
export function clipsPastEnd(p: Project, id: string, duration: number): number {
  let n = 0
  const walk = (list: Iterable<Clip>): void => {
    for (const c of list) {
      if (c.nested) walk(c.nested.clips)
      else if (c.assetId === id && c.freeze === undefined && c.inPoint + c.duration * (c.speed ?? 1) > duration + PAST_END_EPS) n++
    }
  }
  walk(Object.values(p.clips))
  return n
}

/** The fields a probe gives an asset. */
function probed(info: Asset, file: PickedFile): Partial<Asset> {
  return {
    // (The write time in the address: the browser's own cache of the old
    // media:// answer would otherwise keep playing the old file.)
    url: typeof file.mtime === 'number' ? `${file.url}${file.url.includes('?') ? '&' : '?'}v=${file.mtime}` : file.url,
    path: file.path,
    size: file.size,
    ...(typeof file.mtime === 'number' ? { mtime: file.mtime } : {}),
    missing: undefined,
    duration: info.duration,
    width: info.width,
    height: info.height,
    hasAudio: info.hasAudio,
    // (Written again with the next save, from the new path.)
    relPath: undefined,
    ...(info.thumbnail ? { thumbnail: info.thumbnail } : {})
  }
}

export type RelinkResult =
  | { ok: true; pastEnd: number }
  | { ok: false; why: 'gone' | 'unreadable' }
  | { ok: false; why: 'kind'; want: AssetKind; got: AssetKind }

/**
 * Points asset `assetId` at `file` (report P7): the file is probed first; one
 * that is not media, or of another kind (a picture for a video), is refused
 * and nothing changes. Otherwise the asset takes the file's place, duration,
 * size and sound, its caches go, and the clips that now run past the file's
 * end are counted.
 */
export async function relinkAsset(assetId: string, file: PickedFile, deps: RelinkDeps): Promise<RelinkResult> {
  const ps = projectSession()
  const was = useStore.getState().project.assets.find((a) => a.id === assetId)
  if (!was) return { ok: false, why: 'gone' }
  const info = await deps.probe(file).catch(() => null)
  if (projectSession() !== ps || !useStore.getState().project.assets.some((a) => a.id === assetId)) return { ok: false, why: 'gone' }
  if (!info) return { ok: false, why: 'unreadable' }
  if (info.kind !== was.kind) return { ok: false, why: 'kind', want: was.kind, got: info.kind }
  deps.drop(assetId)
  useStore.getState().updateAsset(assetId, probed(info, file))
  return { ok: true, pastEnd: clipsPastEnd(useStore.getState().project, assetId, info.duration) }
}

/** The file name of a stored path (either slash). */
const baseName = (p: string): string => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1)

/**
 * "Found one, look for the rest in the same folder" (decision 3): every other
 * missing file of the project (not a code film) is looked for by its file
 * name in the folder of `picked` (`find`: main says which are there), and
 * each one found is relinked as above (read, kind checked). How many were.
 */
export async function relinkTheRest(picked: PickedFile, find: (picked: string, names: string[]) => Promise<PickedFile[]>, deps: RelinkDeps): Promise<number> {
  // File name (any case) → the missing assets of that name; the names as
  // stored, once each.
  const wanted = new Map<string, string[]>()
  const names: string[] = []
  for (const a of useStore.getState().project.assets) {
    if (!a.missing || a.kind === 'code') continue
    const name = baseName(a.path || a.name)
    if (!name) continue
    const key = name.toLowerCase()
    if (!wanted.has(key)) names.push(name)
    wanted.set(key, [...(wanted.get(key) ?? []), a.id])
  }
  if (names.length === 0) return 0
  const found = await find(picked.path, names).catch(() => [] as PickedFile[])
  let n = 0
  for (const f of found) {
    for (const id of wanted.get(f.name.toLowerCase()) ?? []) {
      // By name AND the size the project recorded, as the opening's own search
      // (project-media.ts locateMedia): a card's repeated names (DSC0001.MP4)
      // in another folder are other footage (phase 11b, A5). One of another
      // size is left for the user to pick by hand.
      const a = useStore.getState().project.assets.find((x) => x.id === id)
      if (a && a.size > 0 && f.size > 0 && a.size !== f.size) continue
      if ((await relinkAsset(id, f, deps)).ok) n++
    }
  }
  return n
}

/**
 * The media files that changed on disk since the project last read them
 * (report P15), read again once the project is loaded: each takes its new
 * duration, size and sound and its new fingerprint (the project is then
 * unsaved, so the next save keeps them). One that cannot be read, or reads as
 * another kind now, is not used: the asset goes back to the path the project
 * stored and is missing (the relink button shows; a save writes that path),
 * its other details as the project had them (Ç2a patch, item 2). An
 * autosave waits for it (phase Ç2b, E2: media/reread-gate.ts).
 */
export function refreshChangedMedia(changed: readonly ChangedMedia[], deps: RelinkDeps): Promise<{ updated: number; failed: number; pastEnd: number }> {
  return changed.length ? holdReread(rereadChanged(changed, deps)) : Promise.resolve({ updated: 0, failed: 0, pastEnd: 0 })
}

async function rereadChanged(changed: readonly ChangedMedia[], deps: RelinkDeps): Promise<{ updated: number; failed: number; pastEnd: number }> {
  const ps = projectSession()
  let updated = 0
  let failed = 0
  let pastEnd = 0
  for (const ch of changed) {
    const a = useStore.getState().project.assets.find((x) => x.id === ch.id)
    if (!a || !a.path || a.missing) continue
    deps.drop(a.id)
    const info = await deps.probe({ url: a.url, name: a.name, path: a.path, size: ch.size, mtime: ch.mtime }).catch(() => null)
    if (projectSession() !== ps) break
    if (!info || info.kind !== a.kind) {
      useStore.getState().updateAsset(a.id, { path: ch.stored ?? a.path, url: '', missing: true })
      failed++
      continue
    }
    useStore.getState().updateAsset(a.id, probed(info, { url: a.url, name: a.name, path: a.path, size: ch.size, mtime: ch.mtime }))
    updated++
    pastEnd += clipsPastEnd(useStore.getState().project, a.id, info.duration)
  }
  return { updated, failed, pastEnd }
}
