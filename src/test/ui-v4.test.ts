// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Arayüz v4 (tarifler/UI-V4.md, UI-V4-PLAN.md): the slider's drag and keys
// with Shift (ten steps) and Alt (a tenth of a step, a tenth of the way), the
// name-handle of a number (ScrubField), the 1 % steps, the left panel's
// categories and the Inspector's cards.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { modeStep, sliderDragValue, sliderKeyValue, sliderModeOf, trackFraction } from '../renderer/src/ui/logic'
import { scrubValue } from '../renderer/src/ui/ScrubField'
import { STRINGS } from '../renderer/src/ui/strings'

const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const walk = (dir: string): string[] => readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
const pct = { min: 0, max: 1, step: 0.01 }

test('the modifier: Alt is fine, Shift coarse (Alt wins), neither normal', () => {
  assert.equal(sliderModeOf({ shiftKey: false, altKey: false }), 'normal')
  assert.equal(sliderModeOf({ shiftKey: true, altKey: false }), 'coarse')
  assert.equal(sliderModeOf({ shiftKey: false, altKey: true }), 'fine')
  assert.equal(sliderModeOf({ shiftKey: true, altKey: true }), 'fine')
  assert.equal(modeStep(0.01, 'coarse'), 0.1)
  assert.equal(modeStep(0.01, 'fine'), 0.001)
})

test('a drag without a modifier is the native range: under the pointer, on the step grid', () => {
  assert.equal(trackFraction(7, 114), 0, 'the thumb half at the left end is 0')
  assert.equal(trackFraction(107, 114), 1)
  assert.equal(trackFraction(57, 114), 0.5)
  assert.equal(sliderDragValue(0.5, 'normal', pct), 0.5)
  assert.equal(sliderDragValue(0.333, 'normal', pct), 0.33)
  assert.equal(sliderDragValue(1.4, 'normal', pct), 1, 'kept in range')
})

test('Shift: ten steps a notch; Alt: a tenth of the way from where it was, a tenth of a step', () => {
  assert.equal(sliderDragValue(0.333, 'coarse', pct), 0.3)
  assert.equal(sliderDragValue(0.37, 'coarse', pct), 0.4)
  // From 0.50 at 40 % of the track, the pointer 10 % further: 1 % of the range.
  assert.equal(sliderDragValue(0.5, 'fine', pct, { frac: 0.4, value: 0.5 }), 0.51)
  assert.equal(sliderDragValue(0.43, 'fine', pct, { frac: 0.4, value: 0.5 }), 0.503)
  assert.equal(sliderDragValue(0.3, 'fine', pct, { frac: 0.4, value: 0.5 }), 0.49)
  // A whole-number slider: Alt goes by tenths.
  assert.equal(sliderDragValue(0.6, 'fine', { min: 0, max: 100, step: 1 }, { frac: 0.5, value: 40 }), 41)
})

test('keys: the native range answers plain keys; Shift + arrow ten steps, Alt + arrow a tenth', () => {
  assert.equal(sliderKeyValue('ArrowRight', 'normal', 0.5, pct), null)
  assert.equal(sliderKeyValue('Home', 'coarse', 0.5, pct), null)
  assert.equal(sliderKeyValue('ArrowRight', 'coarse', 0.5, pct), 0.6)
  assert.equal(sliderKeyValue('ArrowRight', 'coarse', 0.51, pct), 0.61, 'ten steps from where it is')
  assert.equal(sliderKeyValue('ArrowDown', 'coarse', 0.05, pct), 0, 'kept in range')
  assert.equal(sliderKeyValue('ArrowUp', 'fine', 0.5, pct), 0.501)
  assert.equal(sliderKeyValue('ArrowLeft', 'fine', 0.5, pct), 0.499)
})

test('the name-handle of a number: a step a pixel, Shift ten, Alt a tenth, kept in range', () => {
  assert.equal(scrubValue(0, 12, 1, 'normal'), 12)
  assert.equal(scrubValue(0, -12, 1, 'coarse'), -120)
  assert.equal(scrubValue(10, 7, 1, 'fine'), 10.7)
  assert.equal(scrubValue(1900, 50, 1, 'normal', -1920, 1920), 1920)
})

test('no slider steps by 5 % (or 2 %) any more: 1 %, or its unit’s fine step', () => {
  const bad: string[] = []
  for (const f of walk('components').filter((x) => x.endsWith('.tsx'))) {
    const lines = readFileSync(join(SRC, f), 'utf8').split('\n')
    lines.forEach((l, i) => {
      if (/step=\{0\.0[25]\}/.test(l) && !/UndoNumber|NumberField/.test(l)) bad.push(`${f}:${i + 1}`)
    })
  }
  assert.deepEqual(bad, [])
})

test('the left panel: ten categories, each a word in both languages, none the program lacks', () => {
  const dock = readFileSync(join(SRC, 'components', 'WorkspaceDock.tsx'), 'utf8')
  const ids = [...dock.matchAll(/\['(\w+)', '[a-z-]+', 'dock\.cat\.(\w+)'/g)].map((m) => m[1])
  // Voiceover since REF-AB (worker S): the program records a voice-over now.
  // Chats since the saved sessions: the project's own agent chats.
  assert.deepEqual(ids, ['media', 'sounds', 'templates', 'captions', 'voiceover', 'effects', 'transitions', 'filters', 'code', 'chats'])
  for (const m of dock.matchAll(/'(dock\.cat\.\w+(?:\.hint)?)'/g)) {
    const s = (STRINGS as Record<string, { en: string; tr?: string }>)[m[1]]
    assert.ok(s?.en && s.tr, `${m[1]} in English and Turkish`)
  }
  assert.ok(existsSync(join(SRC, 'audio', 'recorder.ts')), 'the Voiceover category has its recorder')
  assert.ok(existsSync(join(SRC, 'components', 'agent', 'ChatsPage.tsx')), 'the Chats category has its page')
})

test('the Clip tab is cards in the brief’s order, and every control of the old panel is in one', () => {
  const tab = readFileSync(join(SRC, 'components', 'inspector', 'clip-tab.tsx'), 'utf8')
  const order = ['id="Clip"', '<AudioSection', 'id="Speed"', 'id="Opacity"', '<ColorSection', '<EffectsBlock', '<MaskSection', '<CropSection', '<ChromaSection', 'id="Tracker"', '<MotionBlock', 'id="Cinematic motion"', '<ClipMoves', '<KeyframesSection', '<TransitionSection']
  const at = order.map((x) => tab.indexOf(x, tab.indexOf('return (\n    <>\n      <div className="insp-clip-head"')))
  assert.ok(at.every((x) => x > 0), `all there: ${order.filter((_, i) => at[i] < 0).join(', ')}`)
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in order')
  // The old panel's actions, each still wired.
  for (const act of ['centerClip', 'fillFrame', 'fitFrame', 'addClipKeyframe', 'insertFreezeFrame', 'toggleReverse', 'setClipFlip', 'rotate90', 'setClipTracker', 'rerollMotionFx', "'scale'", "'x'", "'y'", "'rotation'", "'opacity'", '<SpeedRow', '<BlendField', '<CodeFilmSection']) {
    assert.ok(tab.includes(act), act)
  }
  const audio = readFileSync(join(SRC, 'components', 'inspector', 'clip-audio.tsx'), 'utf8')
  for (const act of ['toggleClipMute', 'setClipVolume', 'setClipFades', 'addVolumeKeyframe', 'clearVolumeKeyframes', 'deleteVolumeKeyframe', '<LoudnessRow', '<CleanVoice', 'setClipAudioFx', 'setClipKeepPitch']) assert.ok(audio.includes(act), act)
  const look = readFileSync(join(SRC, 'components', 'inspector', 'clip-look.tsx'), 'utf8')
  assert.ok(look.includes('setClipBlendMode') && look.includes('export function BlendField'), 'the blend mode moved, not lost')
})
