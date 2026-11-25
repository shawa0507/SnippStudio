// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The team mode (EKIP-PLAN.md; YOL-HARITASI.md part 3, steps 1 and 2): the
// optional worker label of a call, what it costs in the definitions, that
// a call without it is the very call it was, the workers' colours, the
// flags on the ruler, the draft's groups and the sentence that says which
// worker's change an op dropped after.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { agentTools, SERVER_INSTRUCTIONS } from '../renderer/src/agent/tools'
import { cleanLabel, flagWidth, groupsOf, placeFlags, roundedTo, takeLabel, tokensByWorker, withWorker, workersOf } from '../renderer/src/agent/crew'
import { collidedAfter, collidedWith, dropKey } from '../renderer/src/agent/drop-words'
import { definitionsSize } from './agent-tools.test'

// ---- step 1: the label ------------------------------------------------------------

test('a call without a label is the very object sent: nothing of it changes', () => {
  const args = { ops: [{ op: 'clip.split', clipId: 'a', at: 2 }], base: 'abc-1' }
  const out = takeLabel(args)
  assert.equal(out.args, args, 'the same object')
  assert.equal(out.as, undefined)
  assert.deepEqual(Object.keys(out), ['args'])
})

test('a label comes off the call (the tool never sees it), cleaned, never an error', () => {
  const args = { kind: 'silences', as: 'kesim' }
  const out = takeLabel(args)
  assert.equal(out.as, 'kesim')
  assert.deepEqual(out.args, { kind: 'silences' })
  assert.equal(args.as, 'kesim', 'what was sent is not changed')
  assert.equal(cleanLabel('altyazı-2'), 'altyazı-2', 'letters of any language, digits, hyphen')
  assert.equal(cleanLabel('b roll!'), 'broll')
  assert.equal(cleanLabel('a-very-long-worker-name'), 'a-very-long-')
  assert.equal(cleanLabel('a-very-long-worker-name')!.length, 12)
  for (const bad of ['', '  ', '!!!', 3, null, undefined, {}]) assert.equal(cleanLabel(bad), undefined, String(bad))
  // A label that cleans to nothing: the call runs unlabelled, without the field.
  const empty = takeLabel({ start: 0, as: '***' })
  assert.equal(empty.as, undefined)
  assert.deepEqual(empty.args, { start: 0 })
})

test('the definitions: one short property in every tool, one sentence in the instructions, under 14 000', () => {
  for (const t of agentTools()) assert.deepEqual((t.inputSchema as { properties: Record<string, unknown> }).properties.as, { type: 'string' }, t.name)
  assert.match(SERVER_INSTRUCTIONS, /Subagents may add as:"<name>" \(≤12 letters, digits, -\) to each call\.$/)
  // (No visual or style advice in what the agent is sent: principle 6.)
  for (const w of ['colour', 'color', 'flag', 'chip', 'style']) assert.ok(!SERVER_INSTRUCTIONS.toLowerCase().includes(w), w)
  const size = definitionsSize()
  // 11 953 after the worker label and cogalt; 12 961 with the media tool;
  // new_project adds the clean start: the limit is 14 000.
  assert.ok(size <= 14_000, String(size))
})

test('workers in the order first seen; a run of calls with no label has no team', () => {
  let order: string[] = []
  for (const w of ['kesim', 'altyazı', undefined, 'kesim', 'b-roll']) order = withWorker(order, w)
  assert.deepEqual(order, ['kesim', 'altyazı', 'b-roll'])
  assert.deepEqual(workersOf([{ as: 'b-roll' }, {}, { as: 'kesim' }, { as: 'kesim' }], order), ['kesim', 'b-roll'])
  assert.deepEqual(workersOf([{}, {}], order), [], 'no label: no team')
})

// ---- the flags: two rows at most, the rest "+N" ---------------------------------------

test('flags that would overlap take a second row; what fits on neither is "+N" beside the one in its way', () => {
  const f = (key: string, x: number): { key: string; x: number; w: number } => ({ key, x, w: flagWidth(key) })
  // Far apart: one row.
  let r = placeFlags([f('kesim', 0), f('altyazı', 300), f('müzik', 600)])
  assert.deepEqual(r.placed.map((p) => p.row), [0, 0, 0])
  assert.equal(r.more.length, 0)
  // Five at one place: two rows, three counted.
  r = placeFlags([f('a', 100), f('b', 100), f('c', 102), f('d', 104), f('e', 106)])
  assert.deepEqual(r.placed.map((p) => [p.key, p.row]), [['a', 0], ['b', 1]])
  assert.equal(r.more.length, 1)
  assert.deepEqual(r.more[0].keys, ['c', 'd', 'e'])
  const b = r.placed[1]
  assert.equal(r.more[0].x, b.x + b.w + 2)
  // Two close and a third further: the third back on the first row.
  r = placeFlags([f('kesim', 100), f('altyazı', 110), f('b-roll', 400)])
  assert.deepEqual(r.placed.map((p) => [p.key, p.row]), [['kesim', 0], ['altyazı', 1], ['b-roll', 0]])
  assert.ok(flagWidth('kesim') < flagWidth('a-very-long-'))
})

// ---- tokens per worker --------------------------------------------------------------

test('tokens per worker: their sum is the answers\' total; rounded rows still add up', () => {
  const rows = tokensByWorker([
    { as: 'kesim', tokens: 120.4, done: true },
    { as: 'altyazı', tokens: 300.3, done: true },
    { tokens: 50.2, done: true },
    { as: 'kesim', tokens: 80, done: true },
    { as: 'kesim', tokens: 999, done: false }
  ])
  assert.deepEqual(rows.map((r) => r.as), ['altyazı', 'kesim', ''])
  assert.ok(Math.abs(rows.reduce((n, r) => n + r.tokens, 0) - 550.9) < 1e-9)
  const whole = roundedTo(rows.map((r) => r.tokens), 551)
  assert.equal(whole.reduce((a, b) => a + b, 0), 551)
  assert.deepEqual(roundedTo([1.5, 1.5, 1], 4).reduce((a, b) => a + b, 0), 4)
})

// ---- step 2: the draft's groups -----------------------------------------------------------

test('a draft\'s groups: by worker, in the colours\' order; the unlabelled ops first', () => {
  const g = groupsOf([{ key: '1:0', as: 'altyazı' }, { key: '2:0', as: 'kesim' }, { key: '2:1', as: 'kesim' }, { key: '3:0' }, { key: '4:0', as: 'yeni' }], ['kesim', 'altyazı'])
  assert.deepEqual(g, [{ as: '', keys: ['3:0'] }, { as: 'kesim', keys: ['2:0', '2:1'] }, { as: 'altyazı', keys: ['1:0'] }, { as: 'yeni', keys: ['4:0'] }])
})

test('a collision is said to the user (which worker\'s change), never to the agent; the rule is the one of 4A.8', () => {
  const reason = 'its ids and times are of the version you read, and an earlier edit of yours (#1 timeline.cutRanges of your call #2) moved or cut what was there: read again and send it with that v (what only ADDS — a clip, a title, a track — does not move anything)'
  const workers: Record<number, string> = { 1: 'kesim', 2: 'altyazı' }
  const of = (n: number): string | null => (n in workers ? workers[n] : null)
  assert.equal(collidedWith(reason, 'kesim', of), 'altyazı', 'another worker')
  assert.equal(collidedWith(reason, 'altyazı', of), undefined, 'its own worker: no collision')
  assert.equal(collidedWith(reason, undefined, (n) => (n === 2 ? 'altyazı' : null)), 'altyazı')
  assert.equal(collidedWith(reason, 'kesim', (n) => (n === 2 ? '' : null)), '', 'the agent\'s own unlabelled call')
  assert.equal(collidedWith(reason, 'kesim', () => null), undefined, 'a call the draft no longer holds: not guessed')
  assert.equal(collidedWith('its ids … an earlier edit of yours (in an earlier call) moved …', 'kesim', of), undefined, 'no call named: not guessed')
  assert.equal(collidedWith('(#2 clip.move of this call)', 'kesim', of), undefined)
  // The reason's own sort is unchanged.
  assert.equal(dropKey(reason), 'd22c.drop.ownEarlier')
})

test('a collision named by the app when the answer does not name the call: only one other worker\'s moves came after', () => {
  const answer = 'Nothing applied: every op was dropped.\n#1 clip.move: its ids and times are of the version you read, and an earlier edit of yours (in an earlier call) moved or cut what was there: read again and send it with that v'
  const calls = [
    { seq: 1, as: 'kesim', moves: true },
    { seq: 2, as: 'altyazı', moves: false },
    { seq: 3, as: 'renk', moves: false }
  ]
  assert.equal(collidedAfter(answer, 'b-roll', calls, undefined), 'kesim', 'the version held none: kesim\'s cut came after')
  assert.equal(collidedAfter(answer, 'b-roll', calls, [1]), undefined, 'the version held kesim\'s cut: not it')
  assert.equal(collidedAfter(answer, 'kesim', calls, undefined), undefined, 'its own worker')
  assert.equal(collidedAfter(answer, 'b-roll', [...calls, { seq: 4, as: 'müzik', moves: true }], undefined), undefined, 'two workers moved: not guessed')
  assert.equal(collidedAfter(answer.replace('(in an earlier call)', '(#1 timeline.cutRanges of your call #3)'), 'b-roll', calls, undefined), 'renk', 'a named call wins')
  assert.equal(collidedAfter(answer.replace('(in an earlier call)', '(#2 clip.move of this call)'), 'b-roll', calls, undefined), undefined, 'its own call')
  assert.equal(collidedAfter('Applied 1 op.', 'b-roll', calls, undefined), undefined)
})

test('the calls a kept version held: the same with the version written as a read prints it ("v 4987d-2")', async () => {
  const { open, talk, draftCalls, read } = await import('./agent-kit')
  const { heldBy, rejectDraft } = await import('../renderer/src/agent/drafts')
  open(talk())
  draftCalls('s1', 'test', [{ name: 'marker.add', params: { time: 1 } }])
  const v = read('test')
  const seqs = heldBy('test', v)
  assert.ok(seqs && seqs.length === 1, `the draft's call (${JSON.stringify(seqs)})`)
  assert.deepEqual(heldBy('test', `v ${v}`), seqs, 'with "v " before it')
  assert.deepEqual(heldBy('test', `  V  ${v} `), seqs, 'spaces and a capital V')
  assert.equal(heldBy('test', `vs${v}`), undefined, 'not any word before it')
  rejectDraft()
})
