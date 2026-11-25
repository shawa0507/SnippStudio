// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.7: the budget an agent pays for the app's answers
// (ANA-PLAN.md §2 "A"), measured on the test material's 10-minute talk
// (testdata\ham\ham-10dk-tr: its truth words and subtitles). A change that
// makes an answer bigger than its ceiling fails here. Phase 4A.8 (T14): the
// ceilings are ≈ 1.3 × what was measured (FAZ4A-PLAN.md 6), and analyze is
// measured per kind on what the finders really write.
//   initialize + tools/list   ≤ 14 000 characters (agent-tools.test.ts)
import './dom-stub'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import type { Project } from '../renderer/src/types'
import { applyBatch } from '../renderer/src/commands'
import { changesText, projectText, transcriptText } from '../renderer/src/agent/format'
import { editAnswer, labelOf, resultText, silenceLine, type AnalysisResult } from '../renderer/src/agent/answers'
import { analyze } from '../renderer/src/agent/analyze'
import { autoThresholdDb, silenceRangesFromDb } from '../renderer/src/audio/silence'
import { readProjectFile } from '../renderer/src/media/projectio'
import { diffProjects } from '../renderer/src/history/versions'
import { cutsOfSegments, segmentsAfterCuts } from '../renderer/src/history/versions'
import { haveTalk as have, materialDir, talkProject, type Truth } from './talk-fixture'

/** Measured (10-minute talk) × ≈ 1.3. */
export const CEIL = {
  project: 480,
  project150: 540,
  projectOther: 440,
  changes150: 1310,
  edit150: 810,
  transcriptLines: 14600,
  transcriptWords: 21700,
  // (fillers 59 → 72, phase 4A.11, N4: an uncertain sound's line says why,
  // "(the sentence goes on)"; measured 66.6 on the made-up lines below.)
  analyze: { silences: 24, repeats: 85, keywords: 37, fillers: 72, broll_plan: 87, image_plan: 74 }
}

/** 150 cuts, as a rough cut of pauses makes them: inside the gaps between words. */
function rough150(truth: Truth): [number, number][] {
  const gaps: [number, number][] = []
  for (let i = 1; i < truth.words.length; i++) {
    const a = truth.words[i - 1].end + 0.01
    const b = truth.words[i].start - 0.01
    if (b - a >= 0.03) gaps.push([a, b])
  }
  gaps.sort((x, y) => y[1] - y[0] - (x[1] - x[0]))
  return gaps.slice(0, 150).sort((x, y) => x[0] - y[0])
}

const sizes: Record<string, number> = {}
test.after(() => console.log('  budget (chars):', JSON.stringify(sizes)))

test('budget: project on the 10-minute talk, also after 150 cuts; changes and edit after them', { skip: !have('ham-10dk-tr') && 'no test material' }, () => {
  const { project, truth } = talkProject('ham-10dk-tr')
  const info = { version: 'a1b2c-1', state: 'live' as const, path: 'C:\\Videos\\ham-10dk-tr.snipp' }
  const before = projectText(project, info)
  const cuts = rough150(truth)
  assert.equal(cuts.length, 150)
  const after = applyBatch(project, [{ name: 'timeline.cutRanges', params: { ranges: cuts } }]).project
  assert.ok(Object.keys(after.clips).length >= 300, `${Object.keys(after.clips).length} clips after the cuts`)
  const cut = projectText(after, info)
  sizes.project = before.length
  sizes.project150 = cut.length
  assert.ok(before.length <= CEIL.project, `project: ${before.length} (ceiling ${CEIL.project})`)
  assert.ok(cut.length <= CEIL.project150, `project after 150 cuts: ${cut.length} (ceiling ${CEIL.project150}):\n${cut}`)
  // The linked sound is one row with its picture; the pieces are one row.
  assert.match(cut, /the sound of .+'s clips \(linked\)/)
  assert.match(cut, /151 pieces \(first \S+, last \S+\), src 0\.00–600\.00/)
  // Changes after them: bounded.
  const lists = [cuts]
  const ch = changesText({ from: 1, to: 2, cuts: cutsOfSegments(segmentsAfterCuts(lists)), ...diffProjects(project, after) }, 'a1b2c-1', 'a1b2c-2', [])
  sizes.changes150 = ch.length
  assert.ok(ch.length <= CEIL.changes150, `changes: ${ch.length} (ceiling ${CEIL.changes150})`)
  // The edit answer of those 150 cuts.
  const outcomes = [{ index: 0, name: 'timeline.cutRanges', applied: true, result: { ranges: cuts, total: 100 }, cuts }]
  const ans = editAnswer({ draft: true, created: true, label: labelOf(outcomes), pending: 1, length: 480, outcomes })
  sizes.edit150 = ans.length
  assert.ok(ans.length <= CEIL.edit150, `edit answer: ${ans.length} (ceiling ${CEIL.edit150})`)
})

test('budget: transcript lines and words (all) on the 10-minute talk', { skip: !have('ham-10dk-tr') && 'no test material' }, () => {
  const { project } = talkProject('ham-10dk-tr')
  const lines = transcriptText(project, 'a1b2c-1')
  const words = transcriptText(project, 'a1b2c-1', { words: true })
  sizes.transcriptLines = lines.length
  sizes.transcriptWords = words.length
  assert.ok(lines.length <= CEIL.transcriptLines, `transcript lines: ${lines.length} (ceiling ${CEIL.transcriptLines})`)
  assert.ok(words.length <= CEIL.transcriptWords, `transcript words: ${words.length} (ceiling ${CEIL.transcriptWords})`)
  assert.ok(!/Stopped/.test(words), 'all of it in one answer')
  // Words: the line text is not repeated and times are after the line start.
  assert.match(words.split('\n')[1], /^0000abcd-ef01 @0\.00 0:Nisan@0 1:1986\.@\.4 \|1\.44$/)
})

test('budget: analyze answers per result, measured on what the finders really write (T14)', { skip: !(have('ham-10dk-tr') && existsSync(path.join(materialDir('voiceover'), 'proje.snipp'))) && 'no test material' }, async () => {
  const { project, truth } = talkProject('ham-10dk-tr')
  const per = (r: AnalysisResult, p = project): number => resultText(r, p).length / Math.max(1, r.items.length)
  void per
  const results: AnalysisResult[] = []
  // Silences: the finder's own ranges (silenceRangesFromDb), on a loudness
  // made from the true words (the sound itself is not read in Node).
  const WIN = 0.04
  const dbs = new Array(Math.ceil(truth.sure / WIN)).fill(-60)
  for (const w of truth.words) for (let i = Math.floor(w.start / WIN); i < Math.ceil(w.end / WIN); i++) dbs[i] = -18
  const thr = autoThresholdDb(dbs, 'balanced')
  const regions = silenceRangesFromDb(dbs, thr, { minDuration: 0.25, pad: 0.11, pace: 'natural' })
  const total = regions.reduce((n, r) => n + r.end - r.start, 0)
  results.push({ id: 'r1', kind: 'silences', token: 'a1b2c-1', head: `${regions.length} pauses to cut, ${total.toFixed(2)} s (each keeps a natural breath; threshold ${thr.toFixed(0)} dB)`, items: regions.map((r) => ({ line: silenceLine(r.start, r.end) })), apply: () => [] })
  // The others through analyze itself.
  // (Without clips: the sound itself cannot be read in Node.)
  const words = { ...project, clips: {}, tracks: project.tracks.map((t) => ({ ...t, clipIds: [] })) }
  results.push(await analyze(words, { kind: 'repeats' }, 'r2', 'a1b2c-1'))
  results.push(await analyze(words, { kind: 'keywords' }, 'r3', 'a1b2c-1'))
  // Fillers: there are none in the material (testdata\README.md): the
  // made-up lines of analysis.test.ts (30 lines, 25 sounds in them).
  const fp = { ...project, clips: {}, tracks: project.tracks.map((t) => ({ ...t, clipIds: [] })), captions: Array.from({ length: 30 }, (_, i) => ['Eee,', 'şey', 'ııı', 'Um', 'hmm', 'so'][i % 6]).map((w, i) => ({ id: `f${String(i).padStart(12, '0')}`, start: i * 2, end: i * 2 + 1.5, text: `${w} well then`, words: [{ text: w, start: i * 2, end: i * 2 + 0.4 }, { text: 'well', start: i * 2 + 0.5, end: i * 2 + 0.9 }, { text: 'then', start: i * 2 + 1, end: i * 2 + 1.5 }] })) }
  const fillers = await analyze(fp, { kind: 'fillers' }, 'r4', 'a1b2c-1')
  // Pictures said by name: ten words of the talk as picture files.
  const said = [...new Set(truth.words.map((w) => w.text.replace(/[^\p{L}]/gu, '')).filter((w) => w.length >= 7))].slice(0, 10)
  const bp = { ...project, assets: [...project.assets, ...said.map((w, i) => ({ id: `img${String(i).padStart(10, '0')}`, kind: 'image' as const, name: `${w}.jpg`, url: 'media://x', size: 1 }))] }
  const broll = await analyze(bp as Project, { kind: 'broll_plan' }, 'r5', 'a1b2c-1')
  // Numbered pictures on the faceless channel's subtitles (the voice-over
  // project of the test material, talk-fixture materialDir).
  const faceless = readProjectFile(readFileSync(path.join(materialDir('voiceover'), 'proje.snipp'), 'utf8')).project
  // Its 20 pictures (1.jpg … 20.jpg), as scenario 23 imports them.
  faceless.assets = [...faceless.assets, ...Array.from({ length: 20 }, (_, i) => ({ id: `pic${String(i + 1).padStart(10, '0')}`, kind: 'image' as const, name: `${i + 1}.jpg`, url: 'media://x', size: 1, duration: 5, width: 640, height: 360, hasAudio: false }))]
  const images = await analyze(faceless, { kind: 'image_plan' }, 'r6', 'a1b2c-1')
  for (const r of [...results, fillers, broll, images]) {
    const p = r === fillers ? fp : r === broll ? bp : r === images ? faceless : project
    const v = per(r, p as Project)
    sizes[`analyze.${r.kind}`] = Math.round(v)
    assert.ok(r.items.length >= 3, `${r.kind}: ${r.items.length} items`)
    assert.ok(v <= CEIL.analyze[r.kind as keyof typeof CEIL.analyze], `${r.kind}: ${v.toFixed(1)} per result (ceiling ${CEIL.analyze[r.kind as keyof typeof CEIL.analyze]})`)
  }
})
test('budget: the 2- and 30-minute talks keep project small too', { skip: !(have('ham-02dk-en') && have('ham-30dk-en')) && 'no test material' }, () => {
  for (const name of ['ham-02dk-en', 'ham-30dk-en']) {
    const { project } = talkProject(name)
    const s = projectText(project, { version: 'a1b2c-1', state: 'live' })
    sizes[`project.${name}`] = s.length
    assert.ok(s.length <= CEIL.projectOther, `${name}: ${s.length} (ceiling ${CEIL.projectOther})`)
    // The 30-minute words page at 40 000 characters (call again from there).
    const w = transcriptText(project, 'a1b2c-1', { words: true })
    assert.ok(w.length <= 40_100, `${name} words: ${w.length}`)
  }
})
