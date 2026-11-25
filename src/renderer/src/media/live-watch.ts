// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A media file changing on disk while the project is open (a rebuilt mix
// written over the old one, a new take under the same name): main watches
// the paths this window shows and answers when one's size or write time
// changes; the asset is read again there and then, so the picture and the
// sound follow the file without closing the app.
import { api } from '../platform'
import { useStore } from '../state/store'
import { refreshChangedAndTell } from './relink-ui'
import type { ChangedMedia } from './projectio'

let started = false
let lastKey = ''
let timer: ReturnType<typeof setTimeout> | null = null

/** The files a live change matters for (the bin's own media; a code clip's
 *  page and sound are watched by the film watcher). */
function mediaFiles(): { path: string; size: number; mtime?: number }[] {
  return useStore
    .getState()
    .project.assets.filter((a) => !a.missing && !!a.path && (a.kind === 'video' || a.kind === 'audio' || a.kind === 'image'))
    .map((a) => ({ path: a.path!, size: a.size, ...(typeof a.mtime === 'number' ? { mtime: a.mtime } : {}) }))
}

function send(): void {
  if (!api) return
  const files = mediaFiles()
  const key = files.map((f) => `${f.path}:${f.size}:${f.mtime ?? ''}`).join('|')
  if (key === lastKey) return
  lastKey = key
  api.watchMedia(files)
}

/** Starts it once (App.tsx): every project change re-names the files to
 *  watch, a settled list only. */
export function watchMediaFiles(): void {
  if (started || !api) return
  started = true
  useStore.subscribe((s, prev) => {
    if (s.project === prev.project) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(send, 600)
  })
  api.onMediaChanged((files) => {
    const project = useStore.getState().project
    const changed: ChangedMedia[] = []
    for (const f of files) {
      const key = f.path.toLowerCase()
      const asset = project.assets.find((a) => a.path && a.path.toLowerCase() === key)
      if (asset) changed.push({ id: asset.id, size: f.size, mtime: f.mtime })
    }
    if (changed.length) void refreshChangedAndTell(changed)
  })
  send()
}
