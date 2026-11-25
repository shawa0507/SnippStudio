// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What an agent is told of the user's limits (KAPSAM-AJAN-PLAN.md §5): one
// line on a limited note, in the `notes` and `wait` answers, with no new tool
// and no new field (the definitions stay as they were); an animation asked
// for gets the stretch, its length, the canvas and what is said there — no
// word on how to draw it (principle 6); a locked clip says so in the
// project answer, and a project without one answers the same bytes.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { addNote, setNoteStatus } from '../renderer/src/notes/model'
import { noteLines, notesText } from '../renderer/src/notes/agent'
import { inboxText } from '../renderer/src/agent/inbox'
import { projectText } from '../renderer/src/agent/format'
import { clipOf, talk } from './agent-kit'
import { agentTools, SERVER_INSTRUCTIONS } from '../renderer/src/agent/tools'
import { AGENT_ID, PRODUCT_NAME } from '../shared/product'

/** initialize + tools/list, as an agent receives them (agent-tools.test.ts). */
function definitionsSize(): number {
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } }, serverInfo: { name: AGENT_ID, title: PRODUCT_NAME, version: '0.0.0' }, instructions: SERVER_INSTRUCTIONS } })
  const list = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: agentTools() } })
  return init.length + list.length
}

test('a limited note says so in one line, in the notes and the wait answers; an unlimited one does not', () => {
  const p = talk(20, true)
  const a = addNote(p, { start: 5, end: 10, kind: 'fix', text: 'tighten', only: {} })
  const b = addNote(p, { start: 12, end: 14, kind: 'fix', text: 'free' })
  setNoteStatus(p, a.id, 'agent')
  const la = noteLines(p, a)
  assert.equal(la.filter((l) => /only here/.test(l)).length, 1)
  assert.ok(la.includes('   only here: the app applies no edit outside 5.00–10.00 s'), la.join('\n'))
  assert.ok(!noteLines(p, b).some((l) => /only/.test(l)))
  assert.match(notesText(p, null, 'all'), /only here: the app applies no edit outside 5\.00–10\.00 s/)
  assert.match(inboxText([{ id: 1, at: 0, kind: 'notes', notes: [a.id] }], p), /only here: the app applies no edit outside 5\.00–10\.00 s/)
})

test('a note limited to clips names them (as they are now: a piece of a cut clip too)', () => {
  const p = talk(20)
  const v1 = p.tracks[0]
  p.clips.c1.duration = 10
  p.clips.c2 = clipOf('c2', 'a1', v1.id, 10, 10, 6)
  p.clips.c3 = clipOf('c3', 'a1', v1.id, 16, 16, 4, { instance: 'c2' })
  v1.clipIds = ['c1', 'c2', 'c3']
  const n = addNote(p, { start: 10, end: 20, kind: 'fix', text: 'x', only: { clips: ['c2'] } })
  assert.ok(noteLines(p, n).includes('   only clips c2, c3 (10.00–20.00 s): the app applies no edit to anything else'))
})

test('an animation asked for: the stretch, its length, the canvas, what is said there; nothing on how to draw it', () => {
  const p = talk(20, true)
  const n = addNote(p, { start: 0.5, end: 3.5, kind: 'animate', text: '', only: {} })
  const text = noteLines(p, n).join('\n')
  assert.match(text, /0\.50–3\.50 s \(3\.00 s\) · animate \(make an animation for this stretch\) · canvas 1920x1080/)
  assert.match(text, /said there: «hello there friends»/)
  for (const w of ['colour', 'color', 'font', 'style', 'template', 'layout', 'should look', 'like this']) assert.ok(!text.toLowerCase().includes(w), w)
})

// (11 495 when the scope work was written; 11 953 after cogalt; 12 961
// with media; new_project adds the clean start. The limit is 14 000.)
test('the definitions stay within the new limit after new_project (14 000)', () => {
  assert.ok(definitionsSize() <= 14_000, String(definitionsSize()))
})

test('the project answer: a locked clip says "agent-locked"; without a lock, not a byte more', () => {
  const p = talk(20)
  const plain = projectText(p, { version: 'v1', state: 'live' })
  assert.ok(!plain.includes('agent-locked'))
  p.clips.c1.agentLock = true
  const locked = projectText(p, { version: 'v1', state: 'live' })
  assert.match(locked, /c1 0\.00–20\.00 .* agent-locked/)
  assert.equal(locked.replace(' agent-locked', ''), plain)
})
