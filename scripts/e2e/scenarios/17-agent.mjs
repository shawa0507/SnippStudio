// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent server through its real door (phase 4A, tools v2): HTTP on
// 127.0.0.1, the profile's token, an MCP session from initialize. The eight
// tools, each called: project, transcript (lines, words), frames (one, a
// grid), analyze silences, edit (apply the result into the draft, a title by
// word address), changes, the draft accepted as one undo step and Ctrl+Z,
// notes (read, one picture, a batch answer). Also: no token / a web page's
// Origin are refused.
import { WORDED, captionsOf } from './04-text-edit.mjs'
import { connectAgent, itemsOf, resultOf, versionOf } from '../agent-client.mjs'
export const name = 'agent-server-tools-v2'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run((caps) => {
    const s = window.__store.getState()
    s.setSubtitles(caps)
    s.startNoteDraft({ start: 1, end: 2 })
    s.patchNoteDraft({ text: 'cut this', kind: 'cut' })
    s.saveNoteDraft()
    s.startNoteDraft({ start: 9, end: 10 })
    s.patchNoteDraft({ text: 'a title here', kind: 'fix' })
    s.saveNoteDraft()
    s.setDirty(false)
    window.__agent.setMode('draft')
  }, captionsOf(WORDED))

  const ag = await connectAgent({ c, app, assert })
  // Refusals.
  assert.equal((await fetch(ag.url, { method: 'POST', body: '{}' })).status, 401, 'no token')
  assert.equal((await ag.rpc('tools/list', {}, { origin: 'http://evil.example' })).status, 403, 'a web page')
  assert.deepEqual(ag.tools.map((t) => t.name), ['project', 'new_project', 'transcript', 'frames', 'changes', 'analyze', 'edit', 'notes', 'job', 'code_clip', 'media', 'wait'])
  assert.ok(ag.defsChars <= 14_000, `definitions ${ag.defsChars}`) // (phase 5e; GONDER-PLAN.md 8; media; new_project)

  const sum = await ag.call('project')
  assert.match(sum.text, /talk\.mp4/)
  const v0 = versionOf(sum.text)
  assert.ok(v0, 'a version')
  const lines = await ag.call('transcript')
  assert.match(lines.text, /^w2 \[4\.60–7\.80\] then it walked over the bridge$/m)
  const words = await ag.call('transcript', { words: true, start: 4, end: 8 })
  assert.match(words.text, /^w2 @4\.60 0:then@0 1:it@\.4 2:walked@\.6 3:over@1\.2 4:the@1\.7 5:bridge@2 \|3\.2$/m)
  const one = await ag.call('frames', { times: [2] })
  assert.equal(one.images.length, 1)
  assert.equal(one.images[0].width, 512)
  const grid = await ag.call('frames', { times: [1, 5, 9], width: 200 })
  assert.equal(grid.images.length, 1, 'three moments, one picture')
  assert.ok(grid.images[0].width >= 400, 'a grid')

  // The two gaps of talk.mp4 (3–4.5 and 8–9.5 s).
  const sil = await ag.call('analyze', { kind: 'silences' })
  const rid = resultOf(sil.text)
  assert.equal(itemsOf(sil.text).length, 2, sil.text)
  // Asked again on the same version: the kept answer, the same result.
  assert.equal(resultOf((await ag.call('analyze', { kind: 'silences' })).text), rid)
  const depth0 = await lib.undoDepth(c)
  const e1 = await ag.call('edit', { ops: [{ op: 'apply', result: rid }], base: v0 })
  assert.match(e1.text, /^Draft started: cut 2 ranges/)
  // Reads show the draft: the second line now starts earlier.
  const after = await ag.call('transcript')
  assert.ok(!/^w2 \[4\.60/m.test(after.text), 'the draft is what is read')
  // A title on a word, by its address.
  const e2 = await ag.call('edit', { ops: [{ op: 'text.add', time: 'w3#0', text: 'Home' }], base: versionOf(after.text) })
  assert.match(e2.text, /2 calls wait for the user/)
  const ch = await ag.call('changes', { since: v0 })
  assert.match(ch.text, /^Cut \(in /m)
  assert.match(ch.text, /Lines: \+1/)
  // Nothing happened to the live project yet.
  assert.equal(await lib.undoDepth(c), depth0)
  assert.equal(await c.ev('window.__agent.store.getState().draft.summary.calls'), 2)
  // The user accepts: one undo step.
  await c.run(() => window.__agent.accept())
  const cut = await c.waitFor('the cut in the window', async () => { const l = await lib.clipList(c); const n = l.reduce((a, k) => a + k.duration, 0); return n < 11 ? n : null })
  assert.ok(cut < 11, `cut (${cut})`)
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one undo step')
  assert.equal(await c.st((s) => s.project.captions.filter((k) => k.text === 'Home').length), 1)
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.waitFor('Ctrl+Z took it back', async () => (await lib.clipList(c)).length === 1)
  assert.equal(await c.st((s) => s.project.captions.filter((k) => k.text === 'Home').length), 0)

  const notes = await ag.call('notes')
  assert.match(notes.text, /cut this/)
  assert.equal(await c.st((s) => s.project.notes[0].status), 'agent', 'taken: "with agent"')
  const ni = await ag.call('notes', { image: 1 })
  assert.equal(ni.images.length, 1, 'one picture')
  const up = await ag.call('notes', { update: [{ id: 1, status: 'ready', reply: 'Cut it.', touched: [[1, 1.5]] }] })
  assert.match(up.text, /#1 → ready/)
  const n = await c.st((s) => s.project.notes[0])
  assert.equal(n.status, 'ready')
  assert.equal(n.reply, 'Cut it.')
  await c.click('inspector.tab.notes')
  await c.select('notes.filter', 'ready')
  await c.waitId(`notes.card.${n.id}.approve`)
  // The other note it took and left: after 10 quiet minutes, open again.
  assert.equal(await c.st((s) => s.project.notes[1].status), 'agent')
  assert.equal(await c.run(() => window.__agent.releaseIdleNotes(Date.now() + 11 * 60_000)), 1)
  assert.equal(await c.st((s) => s.project.notes[1].status), 'open')
  assert.equal(await c.st((s) => s.project.notes[0].status), 'ready', 'an answered note stays')
  // Phase 4A.8 (rule 24): a note put "with agent" through update is released
  // after 10 quiet minutes too.
  await ag.call('notes', { update: [{ id: 2, status: 'agent' }] })
  assert.equal(await c.st((s) => s.project.notes[1].status), 'agent')
  assert.equal(await c.run(() => window.__agent.releaseIdleNotes(Date.now() + 11 * 60_000)), 1)
  assert.equal(await c.st((s) => s.project.notes[1].status), 'open')
  // A draft accepted in part: of three calls only the second, as ONE undo
  // step (the same replay on the live project, its id kept); the other two
  // stay as the draft; then that draft rejected: the live project as it was.
  const depth1 = await lib.undoDepth(c)
  // Phase 4A.9 (A3): base is required. Without it an edit is refused in one
  // sentence, whatever it carries.
  const blind = await ag.call('edit', { ops: [{ op: 'marker.add', time: 1, note: 'one' }] }, { allowError: true })
  assert.match(blind.text, /base:? is required/) // (the page says it since phase 5e: help needs no base)
  const vNow = versionOf((await ag.call('project')).text)
  const first = await ag.call('edit', { ops: [{ op: 'marker.add', time: 1, note: 'one' }], base: vNow })
  assert.doesNotMatch(first.text, /\bv [0-9a-z]+-\d+/, 'an edit answer names no version: a base is the v of a read')
  // A second call on the same read needs no new one.
  const second = await ag.call('edit', { ops: [{ op: 'text.add', time: 5, text: 'Second', id: 'second00title' }], base: vNow })
  // (The id an op gives is a NAME for what it makes: the app makes the id.)
  const secondId = /New: second00title=([^,\s]+)/.exec(second.text)?.[1]
  assert.ok(secondId && secondId !== 'second00title', second.text)
  const vDraft = versionOf((await ag.call('project')).text)
  assert.notEqual(vDraft, vNow, 'a read shows the draft')
  await ag.call('edit', { ops: [{ op: 'marker.add', time: 3, note: 'three' }], base: vDraft })
  const seqs = await c.ev('window.__agent.draft().entries.map((e) => e.seq)')
  assert.equal(seqs.length, 3)
  // The card: what will be applied, what not; accepting with what it showed.
  const card = await c.run((s) => window.__agent.preview([s]), seqs[1])
  assert.deepEqual(card.apply.map((x) => x.seq), [seqs[1]])
  assert.equal(card.drop.filter((x) => x.reason === 'not selected').length, 2)
  await c.run((a) => window.__agent.accept([a.seq], a.shown), { seq: seqs[1], shown: card.shown })
  assert.equal((await lib.undoDepth(c)) - depth1, 1, 'one undo step')
  assert.deepEqual(await c.st((s) => s.project.captions.filter((k) => k.text === 'Second').map((k) => k.id)), [secondId], 'the chosen call, its id kept')
  assert.equal(await c.st((s) => (s.project.markers ?? []).filter((m) => m.note === 'one' || m.note === 'three').length), 0, 'the others are not in the live project')
  assert.deepEqual(await c.ev('window.__agent.draft().entries.map((e) => e.seq)'), [seqs[0], seqs[2]], 'and still wait as the draft')
  assert.match((await ag.call('project')).text, /Draft: the user accepted calls #\d+: they are in the live project now; #\d+, #\d+ still wait/)
  const live0 = await c.run(() => window.__agent.serialize())
  await c.run(() => window.__agent.reject())
  assert.equal(await c.run(() => window.__agent.serialize()), live0, 'rejected: nothing changed')
  assert.equal(await c.ev('window.__agent.store.getState().draft'), null)
  // The agent is told, and that draft's numbers are refused plainly now.
  const news = await ag.call('changes', { since: vDraft }, { allowError: true })
  assert.match(news.text, /belongs to a draft that was rejected/)
  // Every call left an event with its size (4A.6).
  const events = await c.ev('window.__agent.store.getState().events.length')
  // (The edit without base never reached the page: the server's own
  // schema check refused it.)
  assert.ok(events >= ag.log.length - 1, `${events} events`)
  // Phase 4A.8 (G9): a session that ends (DELETE) is forgotten by the page.
  const other = await connectAgent({ c, app, assert, client: 'short-lived' })
  await other.call('project')
  assert.ok((await c.run(() => window.__agent.sessions())).includes(other.session))
  await fetch(other.url, { method: 'DELETE', headers: { authorization: `Bearer ${other.token}`, 'mcp-session-id': other.session } })
  await c.waitFor('the page forgot the ended session', async () => !(await c.run(() => window.__agent.sessions())).includes(other.session))
  // G7: agent access off — the waiting draft stays for the user, marked;
  // the page forgets its sessions.
  await ag.call('edit', { ops: [{ op: 'marker.add', time: 2, note: 'kept' }], base: versionOf((await ag.call('project')).text) })
  await c.run(() => window.__agent.off())
  assert.equal(await c.ev('window.__agent.store.getState().draft.disconnected'), true)
  assert.equal(await c.ev('window.__agent.draft().entries.length'), 1, 'the draft stays')
  assert.deepEqual(await c.run(() => window.__agent.sessions()), [])
  await c.run(() => window.__agent.reject())
  console.log('     ' + ag.summary('agent v2').split('\n')[0])
}
