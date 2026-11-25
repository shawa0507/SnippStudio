// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The editor's panel sizes as they are saved, and the timeline's height
// (phase 3c.Y, K1 of tarifler\FAZ3C-YERLESIM.md). Pure: no window, no store
// (src/test/timeline-size.test.ts).

export interface PanelLayout {
  bin: number
  inspector: number
  /** The timeline's height as a share of the window's (phase 3c.Y, K1): it
   *  keeps its proportion when the window grows or shrinks. */
  timelineRatio: number
  /** The Inspector is shown (the default) or folded away, its width given
   *  to the preview and the timeline. */
  inspectorOpen: boolean
}

export const LAYOUT_KEY = 'autocut-panel-layout'

// ---- The timeline's height (phase 3c.Y, K1 of tarifler\FAZ3C-YERLESIM.md) ----
// The timeline is where the work is done: by default 42 % of the window
// (1080 → 454 px; it was a fixed 300 px). At least 240 px, at most 65 % of
// the window, and the preview row always keeps 220 px: in a small window the
// timeline gives way first. The geometry inside it does not change.

export const TIMELINE_DEFAULT_RATIO = 0.42
export const TIMELINE_MIN_PX = 240
export const TIMELINE_MAX_RATIO = 0.65
export const PREVIEW_MIN_PX = 220
/** The rows above the timeline that are not the preview: the top bar and the
 *  splitter. */
export const TOP_BAR_PX = 48
export const SPLITTER_PX = 6
/** The ground under the timeline's card (v3: --gap-card, the window's own
 *  edge; tarifler/UI-YENI.md). */
export const FRAME_PX = 6
/** One arrow key on the focused splitter. */
export const SPLITTER_KEY_STEP_PX = 16
/** The old fixed default: a saved 300 is a layout nobody dragged. */
export const OLD_TIMELINE_DEFAULT_PX = 300
/** The left panel (arayüz v4): its default, limits and the old default. */
export const BIN_DEFAULT_PX = 328
export const BIN_MIN_PX = 200
export const BIN_MAX_PX = 440
export const OLD_BIN_DEFAULT_PX = 220

/** The timeline's height in pixels for a share of a window `winH` tall. */
export function timelinePx(ratio: number, winH: number): number {
  const h = Math.max(0, winH)
  const room = Math.max(0, h - TOP_BAR_PX - SPLITTER_PX - FRAME_PX - PREVIEW_MIN_PX)
  const max = Math.min(Math.floor(TIMELINE_MAX_RATIO * h), room)
  const want = Math.round((Number.isFinite(ratio) ? ratio : TIMELINE_DEFAULT_RATIO) * h)
  return Math.max(0, Math.min(Math.max(want, TIMELINE_MIN_PX), max))
}

/** The share kept for a timeline dragged to `px` in a window `winH` tall
 *  (held within the same limits). */
export function ratioFromPx(px: number, winH: number): number {
  if (!(winH > 0)) return TIMELINE_DEFAULT_RATIO
  return timelinePx(px / winH, winH) / winH
}

const clampRatio = (r: number): number => (Number.isFinite(r) && r > 0 ? Math.min(TIMELINE_MAX_RATIO, Math.max(0.05, r)) : TIMELINE_DEFAULT_RATIO)

/** A saved layout (of any version) → today's. An old one holds the timeline
 *  in pixels: exactly 300 (the old default, never dragged) becomes the new
 *  default; any other value was the user's drag and becomes its share of
 *  the window it is opened in. */
export function readLayout(saved: unknown, winH: number): PanelLayout {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  // Arayüz v4: the left panel holds its column of categories (64 px) beside
  // the page, so it starts wider (328) and stops narrower at 200; the old
  // untouched default (220) becomes the new one.
  const savedBin = Number(s.bin) || BIN_DEFAULT_PX
  const bin = Math.min(BIN_MAX_PX, Math.max(BIN_MIN_PX, savedBin === OLD_BIN_DEFAULT_PX ? BIN_DEFAULT_PX : savedBin))
  const inspector = Math.min(520, Math.max(200, Number(s.inspector) || 320))
  let timelineRatio = TIMELINE_DEFAULT_RATIO
  if (typeof s.timelineRatio === 'number') timelineRatio = clampRatio(s.timelineRatio)
  else if (typeof s.timeline === 'number' && Number.isFinite(s.timeline) && s.timeline !== OLD_TIMELINE_DEFAULT_PX && winH > 0) timelineRatio = clampRatio(s.timeline / winH)
  return { bin, inspector, timelineRatio, inspectorOpen: s.inspectorOpen !== false }
}
