// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.Y, K1 (tarifler\FAZ3C-YERLESIM.md): the timeline is 42 % of the
// window by default, at least 240 px, at most 65 %, and the preview always
// keeps 220 px; it is saved as a share; an old saved 300 px (the untouched
// old default) becomes the new default, any other old value its share.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OLD_TIMELINE_DEFAULT_PX,
  PREVIEW_MIN_PX,
  SPLITTER_PX,
  FRAME_PX,
  TIMELINE_DEFAULT_RATIO,
  TIMELINE_MIN_PX,
  TOP_BAR_PX,
  ratioFromPx,
  readLayout,
  timelinePx
} from '../renderer/src/components/app/timeline-size'

test('the default height for a window', () => {
  const table: [number, number][] = [
    [1080, 454],
    [1440, 605],
    [2160, 907],
    [950, 399],
    [720, 302],
    [600, 252],
    // Small windows: the minimum 240 first, then the preview's 220 wins.
    [560, 240],
    [500, 220], // (v3: 6 px of ground under the timeline; 226 before)
    [400, 120],
    [200, 0]
  ]
  for (const [h, want] of table) assert.equal(timelinePx(TIMELINE_DEFAULT_RATIO, h), want, `window ${h}`)
})

test('limits: never under 240 (room allowing), never over 65 %, the preview keeps 220', () => {
  for (const h of [300, 480, 600, 720, 900, 1080, 1440, 2160]) {
    for (const r of [0, 0.01, 0.2, 0.42, 0.6, 0.65, 0.9, 1, 5, Number.NaN]) {
      const px = timelinePx(r, h)
      const preview = h - TOP_BAR_PX - SPLITTER_PX - FRAME_PX - px
      assert.ok(preview >= PREVIEW_MIN_PX || px === 0, `preview ${preview} at ${h}, ${r}`)
      assert.ok(px <= Math.floor(0.65 * h), `max at ${h}, ${r}`)
      if (h - TOP_BAR_PX - SPLITTER_PX - FRAME_PX - PREVIEW_MIN_PX >= TIMELINE_MIN_PX) assert.ok(px >= TIMELINE_MIN_PX, `min at ${h}, ${r}`)
    }
  }
})

test('a drag is kept as a share: the same proportion in another window', () => {
  const r = ratioFromPx(540, 1080)
  assert.equal(r, 0.5)
  assert.equal(timelinePx(r, 1440), 720)
  assert.equal(timelinePx(r, 720), 360)
  // Dragged past a limit: held at it.
  assert.equal(ratioFromPx(2000, 1080), Math.floor(0.65 * 1080) / 1080)
  assert.equal(ratioFromPx(10, 1080), TIMELINE_MIN_PX / 1080)
})

test('saved layouts of every version', () => {
  const table: [unknown, number, { bin: number; inspector: number; timelineRatio: number; inspectorOpen: boolean }][] = [
    // Nothing saved, or junk: the defaults.
    [null, 1080, { bin: 328, inspector: 320, timelineRatio: 0.42, inspectorOpen: true }],
    ['x', 1080, { bin: 328, inspector: 320, timelineRatio: 0.42, inspectorOpen: true }],
    [{}, 1080, { bin: 328, inspector: 320, timelineRatio: 0.42, inspectorOpen: true }],
    // The old untouched default (300 px): the new default.
    [{ bin: 328, inspector: 292, timeline: OLD_TIMELINE_DEFAULT_PX }, 1080, { bin: 328, inspector: 292, timelineRatio: 0.42, inspectorOpen: true }],
    [{ bin: 340, inspector: 292, timeline: 300 }, 720, { bin: 340, inspector: 292, timelineRatio: 0.42, inspectorOpen: true }],
    // The user's own drag: its share of the window it opens in.
    [{ bin: 260, inspector: 300, timeline: 432 }, 1080, { bin: 260, inspector: 300, timelineRatio: 0.4, inspectorOpen: true }],
    [{ bin: 328, inspector: 292, timeline: 216 }, 1080, { bin: 328, inspector: 292, timelineRatio: 0.2, inspectorOpen: true }],
    // Already a share: as it is (within reason).
    [{ bin: 328, inspector: 292, timelineRatio: 0.55, inspectorOpen: true }, 900, { bin: 328, inspector: 292, timelineRatio: 0.55, inspectorOpen: true }],
    [{ bin: 328, inspector: 292, timelineRatio: 3 }, 900, { bin: 328, inspector: 292, timelineRatio: 0.65, inspectorOpen: true }],
    [{ bin: 328, inspector: 292, timelineRatio: -1 }, 900, { bin: 328, inspector: 292, timelineRatio: 0.42, inspectorOpen: true }],
    // Arayüz v4: the left panel's own limits (200 – 440); a saved 220 was the
    // old untouched default and becomes the new one (328).
    [{ bin: 220, inspector: 320 }, 1080, { bin: 328, inspector: 320, timelineRatio: 0.42, inspectorOpen: true }],
    [{ bin: 150, inspector: 320 }, 1080, { bin: 200, inspector: 320, timelineRatio: 0.42, inspectorOpen: true }],
    [{ bin: 230, inspector: 320 }, 1080, { bin: 230, inspector: 320, timelineRatio: 0.42, inspectorOpen: true }],
    // The Inspector keeps its old limits.
    [{ bin: 9999, inspector: 1, timeline: 300 }, 1080, { bin: 440, inspector: 200, timelineRatio: 0.42, inspectorOpen: true }],
    // The Inspector folded away: remembered, and open when the file says nothing.
    [{ bin: 328, inspector: 292, timelineRatio: 0.55, inspectorOpen: false }, 900, { bin: 328, inspector: 292, timelineRatio: 0.55, inspectorOpen: false }]
  ]
  for (const [saved, h, want] of table) assert.deepEqual(readLayout(saved, h), want, JSON.stringify(saved))
})

