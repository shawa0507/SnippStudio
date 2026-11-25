// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// GONDER2-PLAN.md: the text Copy puts on the clipboard for the agent's chat,
// where a send stands, a copied item leaving the line, and the chip's phases.
// The agent's own bytes do not change (the definitions stay 11 936).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { addNote } from '../renderer/src/notes/model'
import { pasteText } from '../renderer/src/agent/paste'
import { lineState } from '../renderer/src/agent/send-line'
import { resetInbox, sendToInbox, useInbox, withdrawItem } from '../renderer/src/agent/inbox'
import { setLang, t } from '../renderer/src/ui/strings'
import { chipState } from '../renderer/src/components/agent/AgentTop'
import { definitionsSize } from './agent-tools.test'
import { defaultProject, type Project } from '../renderer/src/types'

const project = (): Project => ({ ...defaultProject(), name: 'Demo' })

test('the text for the chat: numbers, times, kinds, words, the project; no key, no path', () => {
  const p = project()
  const a = addNote(p, { start: 12.4, end: 15, kind: 'fix', text: '  shorter   here ' })
  const b = addNote(p, { start: 2, end: 2, kind: 'cut', text: '' })
  setLang('en')
  const en = pasteText({ kind: 'notes', notes: [a.id, b.id] }, p, t)
  assert.equal(en, ['2 work notes from SnippStudio:', '#2 · 0:02.0 · Cut', '#1 · 0:12.4–0:15.0 · Fix · "shorter here"', '(In the project "Demo" open in SnippStudio.)'].join('\n'))
  setLang('tr')
  const tr = pasteText({ kind: 'task', text: 'girişi sıkılaştır', selection: 'clips c1' }, p, t)
  assert.equal(tr, ['SnippStudio programından iş: "girişi sıkılaştır"', 'O an seçili: clips c1', '(SnippStudio programında açık "Demo" projesinde.)'].join('\n'))
  assert.equal(pasteText({ kind: 'notes', notes: ['gone'] }, p, t), '')
  for (const s of [en, tr]) assert.doesNotMatch(s, /token|key|127\.0\.0\.1|localhost|[A-Z]:[\\/]/i)
  setLang('en')
})

test('a send stands taken, in line, or copied; a copied item leaves the line', () => {
  resetInbox()
  const r = sendToInbox({ kind: 'task', text: 'x' })
  assert.equal(r.taken, false)
  assert.equal(lineState(r.id, useInbox.getState().queuedIds, null), 'queued')
  assert.equal(withdrawItem(r.id), true)
  assert.equal(useInbox.getState().queued, 0)
  assert.equal(withdrawItem(r.id), false, 'not twice')
  assert.equal(lineState(r.id, [], r.id), 'copied')
  assert.equal(lineState(r.id, [], null), 'taken')
  resetInbox()
})

test('the chip: waiting for you, awaits your reply, done', () => {
  assert.equal(chipState({ draft: false, phase: 'done', waiting: true, closed: false, alive: true }), 'waiting')
  assert.equal(chipState({ draft: false, phase: 'done', waiting: false, closed: false, alive: true }), 'reply')
  assert.equal(chipState({ draft: false, phase: 'done', waiting: false, closed: false, alive: false }), 'done')
  assert.equal(chipState({ draft: false, phase: 'none', waiting: false, closed: false, alive: true }), 'idle')
  for (const s of ['working', 'quiet', 'waiting', 'reply', 'draft', 'done', 'idle'] as const) assert.ok(t(`gonder2.phase.${s}`).length <= 18, s)
})

test('what goes to the agent stays within its budget: at most 14 000 characters', () => {
  // (11 953 after cogalt; 12 961 with media; new_project adds the clean start.)
  assert.ok(definitionsSize() <= 14_000, String(definitionsSize()))
})
