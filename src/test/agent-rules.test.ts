// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.10 (FAZ4A-DUZELTME-2.md, part I): one test per rule of
// the second repair round, each named by the finding it closes
// (haritalar/_faz4a9-dogrulama.md). The high findings are also sequences of
// the oracle (src/test/oracle/known.ts); these are the same rules, and the
// lower ones, as plain scenarios. `npm run mutate` breaks each rule in turn
// and expects a test here (or the oracle) to fail.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { pruneList } from '../main/agent-restore'
import { applyBatch } from '../renderer/src/commands'
import { requireFreshId } from '../renderer/src/commands/require'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, projectDuration, type Asset, type Project } from '../renderer/src/types'
import { anchorTrack } from '../renderer/src/agent/content'
import { acceptDraft, acceptPreview, currentDraft, draftState, forgetAgentSession, freshDraft, keep, keptCount, rejectDraft, reviveOp, takeNews, watchLive } from '../renderer/src/agent/drafts'
import { editTool, MAX_RANGES_PER_EDIT, runEdit } from '../renderer/src/agent/edit'
import { changesText, projectText } from '../renderer/src/agent/format'
import { ensureRestorePoint, restoreTo, setRestoreIo, type RestoreIo } from '../renderer/src/agent/restore'
import { useAgentStore } from '../renderer/src/agent/store'
import { setSeams } from '../renderer/src/agent/seams'
import { agentTools } from '../renderer/src/agent/tools'
import type { AnalysisResult } from '../renderer/src/agent/answers'
import { diffProjects } from '../renderer/src/history/versions'
import { setLastProjectPath } from '../renderer/src/media/projectio'
import { clipOf, ctxOf, draftCalls, kept, open, read, talk, videoAsset } from './agent-kit'
import { SHAPES } from './oracle/fixture'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
})

const user = (name: string, params: unknown): void => void S().runBatch([{ name, params }] as never)
const edit = (ops: Record<string, unknown>[], base: string, extra: Parameters<typeof ctxOf>[0] = {}): Promise<string> => editTool({ ops, base }, ctxOf(extra))
const outcomes = (): { name: string; applied: boolean; reason?: string; notes?: string[] }[] => currentDraft()!.outcomes

/** A talk on V1 (source 0–30) with B-roll footage over 8–14 s on V2, a music
 *  bed on A1 and a spare shot in the pool. */
function withBroll(): Project {
  const p = talk(30, true)
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push({ ...videoAsset('b', 30), hasAudio: false } as Asset, { ...videoAsset('m', 90), kind: 'audio' } as Asset, videoAsset('spare', 20))
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['b1'] })
  p.clips.b1 = clipOf('b1', 'b', 'V2', 8, 0, 6)
  p.clips.m1 = clipOf('m1', 'm', a1.id, 0, 0, 30, { volume: 0.3 })
  a1.clipIds = ['m1']
  void v1
  return p
}

/** An analysis result of this session, as the analyze tool keeps it. */
function result(id: string, token: string, project: Project, items: { cut: [number, number]; keep?: [number, number] }[]): AnalysisResult {
  return { id, kind: 'repeats', token, project, live: S().projectVersion, head: '', items: items.map((i) => ({ line: 'x', ...i })), apply: (chosen) => (chosen.length ? [{ name: 'timeline.cutRanges', params: { ranges: chosen.map((i) => i.cut!) } }] : []) }
}

// ---- A: the core rules ---------------------------------------------------------

test('core#1 / A1: a clip of another track slid under a waiting cut is not the clip the agent saw there: that range is left', async () => {
  open(withBroll())
  await edit([{ op: 'timeline.cutRanges', ranges: [[10, 12], [20, 21]] }], read())
  user('clip.move', { clipId: 'b1', start: 11 })
  const o = outcomes()[0]
  assert.equal(o.applied, true)
  assert.match(o.notes!.join(' '), /range 1: clip b1 lies in it now and did not \(there\) when you read it \(something you did not make\); not cut/)
  assert.equal(currentDraft()!.project.clips.b1.duration, 6, 'the B-roll is whole')
  rejectDraft()
})

test('core#1 / A1: a title the user moves from the edge of a waiting cut into it is not taken with the cut', async () => {
  open(talk(20, true))
  user('text.add', { time: 11.5, text: 'Chapter', id: 'T1' })
  await edit([{ op: 'timeline.cutRanges', ranges: [[10, 12]] }], read())
  assert.equal(outcomes()[0].applied, true)
  user('caption.update', { id: 'T1', patch: { start: 10.2, end: 11 } })
  assert.equal(outcomes()[0].applied, false)
  assert.ok(currentDraft()!.project.captions.some((c) => c.id === 'T1'), 'the title is still there')
  rejectDraft()
})

test('core#2 / A2: without subtitles the anchor is the track of talking pictures, never the longest sound; two such tracks: none', () => {
  const p = talk(20)
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push({ ...videoAsset('m', 90), kind: 'audio' } as Asset)
  p.clips.m1 = clipOf('m1', 'm', a1.id, 0, 0, 60)
  a1.clipIds = ['m1']
  assert.equal(anchorTrack(p), p.tracks.find((t) => t.kind === 'video')!.id, 'the talk, not the music that is three times as long')
  // The same with the talk's track locked: which track it is does not change.
  const locked = { ...p, tracks: p.tracks.map((t) => (t.kind === 'video' ? { ...t, locked: true } : t)) }
  assert.equal(anchorTrack(locked), p.tracks.find((t) => t.kind === 'video')!.id)
  // A second track of talking pictures: it cannot be told.
  const two = structuredClone(p)
  two.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['x1'] })
  two.assets.push(videoAsset('x', 30))
  two.clips.x1 = clipOf('x1', 'x', 'V2', 0, 0, 10)
  assert.equal(anchorTrack(two), null)
})

test('core#2 / A2: a placement asks that the other sound under its moment lies as it lay (a music bed slid under the talk)', async () => {
  open(withBroll())
  await edit([{ op: 'text.add', time: 5, text: 'Here' }], read())
  assert.equal(outcomes()[0].applied, true)
  user('clip.move', { clipId: 'm1', start: 2 })
  assert.equal(outcomes()[0].applied, false)
  assert.match(outcomes()[0].reason!, /clip m1 lies under it now and did not \(there\) when you read it/)
  rejectDraft()
})

test('core#3, drafts#2, drafts#3 / A3: another session\'s work is a change the session did not make (its marker is not taken by an older cut; its value is not written over)', async () => {
  open(talk(20, true), 'direct')
  const b = read('other')
  const s2 = read('test')
  // Session s1 of program "test" lands a marker and a volume.
  await edit([{ op: 'marker.add', time: 11, note: 'by s1' }, { op: 'clip.setVolume', clipId: 'c1', volume: 0.2 }], read('test'))
  // Another program, on its older read: its cut leaves the marker.
  const cut = await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[10, 13]] }], base: b }, ctxOf({ session: 'sB', client: 'other' }))
  assert.match(cut, /marker .* lies in it now and did not \(there\) when you read it/)
  assert.equal(S().project.markers?.length, 1)
  // A second session of the SAME program, on its older read: not its own value.
  const vol = await editTool({ ops: [{ op: 'clip.setVolume', clipId: 'c1', volume: 0.9 }], base: s2 }, ctxOf({ session: 's2', client: 'test' }))
  assert.match(vol, /volume of this clip was changed after you read it \(not by you\)/)
  assert.equal(S().project.clips.c1.volume, 0.2)
})

test('core#4 / A4: a still cut in two by the user is not the clip the op named (a setting is dropped; a delete too)', async () => {
  for (const op of [{ op: 'clip.setOpacity', clipId: 'i1', opacity: 0.3 }, { op: 'clip.delete', ids: ['i1'] }]) {
    const p = talk(20)
    p.assets.push({ ...videoAsset('pic', 0), kind: 'image', hasAudio: false } as Asset)
    p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['i1'] })
    p.clips.i1 = clipOf('i1', 'pic', 'V2', 0, 0, 10)
    open(p)
    await edit([op], read())
    assert.equal(outcomes()[0].applied, true)
    user('clip.split', { clipIds: ['i1'], time: 5 })
    assert.equal(outcomes()[0].applied, false)
    assert.match(outcomes()[0].reason!, /i1 was cut in two, moved or changed in length after you read it/)
    rejectDraft()
  }
})

test('core#4 / A4: a still the agent\'s own cut cut in two is set whole (both pieces)', async () => {
  const p = talk(20)
  p.assets.push({ ...videoAsset('pic', 0), kind: 'image', hasAudio: false } as Asset)
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['i1'] })
  p.clips.i1 = clipOf('i1', 'pic', 'V2', 0, 0, 10)
  open(p)
  const v = read()
  await edit([{ op: 'timeline.cutRanges', ranges: [[4, 5]] }, { op: 'clip.setOpacity', clipId: 'i1', opacity: 0.3 }], v)
  const pieces = Object.values(currentDraft()!.project.clips).filter((c) => c.assetId === 'pic')
  assert.equal(pieces.length, 2)
  assert.deepEqual(pieces.map((c) => c.opacity), [0.3, 0.3])
  rejectDraft()
})

test('core#5 / A5: a head trim does not delete the piece the user split off and carried to another track', async () => {
  open(withBroll())
  await edit([{ op: 'clip.trimHead', clipId: 'c1', edge: 10 }], read())
  assert.equal(outcomes()[0].applied, true)
  user('clip.split', { clipIds: ['c1'], time: 4 })
  user('clip.moveToTrack', { clipId: 'c1', trackId: 'V2' })
  user('clip.move', { clipId: 'c1', start: 40 })
  assert.equal(outcomes()[0].applied, false)
  assert.match(outcomes()[0].reason!, /was moved or changed since: not trimmed/)
  assert.ok(currentDraft()!.project.clips.c1, 'the piece on V2 is there')
  rejectDraft()
})

test('core#6 / A6: marks the user set after the read are not replaced by the agent\'s', async () => {
  open(talk(20, true))
  await edit([{ op: 'caption.update', id: 'L1', patch: { marks: [0] } }], read())
  assert.equal(outcomes()[0].applied, true)
  user('caption.update', { id: 'L1', patch: { marks: [2] } })
  assert.equal(outcomes()[0].applied, false)
  assert.match(outcomes()[0].reason!, /the marks of this line were changed after you read it \(not by you\)/)
  assert.deepEqual(currentDraft()!.project.captions.find((c) => c.id === 'L1')!.marks, [2])
  rejectDraft()
})

test('core#9 / A7: a transition goes only into the clip that followed when it was read', async () => {
  open(withBroll())
  user('clip.split', { clipIds: ['c1'], time: 5 })
  const right = Object.values(S().project.clips).find((c) => c.assetId === 'a1' && c.id !== 'c1')!.id
  await edit([{ op: 'clip.setTransition', clipId: 'c1', transition: { type: 'mix', duration: 0.5 } }], read())
  assert.equal(outcomes()[0].applied, true)
  user('clip.delete', { ids: [right] })
  user('clip.add', { assetId: 'spare', trackId: S().project.clips.c1.trackId, start: 5 })
  assert.equal(outcomes()[0].applied, false)
  assert.match(outcomes()[0].reason!, /the clip that follows it is not the one that followed when you read it/)
  rejectDraft()
})

test('core#8 / A7: a delete does not take away a transition the user set (after the read) on the clip before', async () => {
  open(talk(20))
  user('clip.split', { clipIds: ['c1'], time: 10 })
  const right = Object.values(S().project.clips).find((c) => c.id !== 'c1')!.id
  await edit([{ op: 'clip.delete', ids: [right] }], read())
  assert.equal(outcomes()[0].applied, true)
  user('clip.setTransition', { clipId: 'c1', transition: { type: 'mix', duration: 0.5 } })
  assert.equal(outcomes()[0].applied, false)
  assert.match(outcomes()[0].reason!, /a transition into this clip was set on c1 after you read it/)
  rejectDraft()
})

test('core#7 / A8: a title\'s whole length is what it was written for: footage that comes back under it drops it', async () => {
  open(talk(30, true))
  S().rippleDeleteMany([[11, 15]])
  await edit([{ op: 'text.add', time: 10, text: 'Over the cut' }], read())
  assert.equal(outcomes()[0].applied, true)
  S().undo()
  assert.equal(outcomes()[0].applied, false)
  assert.match(outcomes()[0].reason!, /footage came back \(or was put\) under its length/)
  rejectDraft()
})

test('contract#5 / A9: "at the start" survives the agent\'s own cut of the first seconds (cut first, title after, one call)', async () => {
  open(talk(20, true), 'direct')
  const out = await edit([{ op: 'timeline.cutRanges', ranges: [[0, 0.9]] }, { op: 'text.add', time: 0, text: 'Opening' }], read())
  assert.doesNotMatch(out, /Dropped/)
  assert.equal(S().project.captions.find((c) => c.text === 'Opening')!.start, 0)
})

test('core#10 / A12: a track locked since the read stays behind a cut, and the answer says so', async () => {
  open(withBroll())
  await edit([{ op: 'timeline.cutRanges', ranges: [[10, 12]] }], read())
  S().setTrackFlags('V2', { locked: true })
  const o = outcomes()[0]
  assert.equal(o.applied, true)
  assert.match(o.notes!.join(' '), /track V2 is locked: left as it is/)
  assert.equal(currentDraft()!.project.clips.b1.start, 8)
  rejectDraft()
})

test('drafts#5 / A10: an analysis result asks "did anyone change it" from the version it was measured on, whatever base the edit names', async () => {
  for (const mode of ['direct', 'draft'] as const) {
    open(talk(20, true), mode)
    const x = read()
    const results = new Map([['r1', result('r1', x, S().project, [{ cut: [4, 6] }])]])
    user('marker.add', { time: 5, note: 'mine' })
    const out = await edit([{ op: 'apply', result: 'r1' }], read(), { results })
    assert.match(out, /marker .* lies in it now and did not \(there\) when you read it/)
    assert.equal((mode === 'draft' ? (currentDraft()?.project ?? S().project) : S().project).markers?.length, 1, 'the marker is there')
    rejectDraft()
  }
})

test('analyses#5 / A10: a retake is cut FOR the take that is kept: with that take gone, the cut is left', async () => {
  open(talk(20, true), 'direct')
  const x = read()
  // "hello there friends" (1–3 s) was found as the earlier take of 6–8 s.
  const results = new Map([['r1', result('r1', x, S().project, [{ cut: [1, 3], keep: [6, 8] }])]])
  S().rippleDeleteMany([[5.9, 8.1]])
  const out = await edit([{ op: 'apply', result: 'r1' }], read(), { results })
  assert.match(out, /Nothing applied/)
  assert.match(out, /range 1: the take it was cut for is gone; not cut/)
  assert.ok(S().project.captions.some((c) => c.text.includes('hello')), 'the take that is left is still there')
})

test('K-1 run literally (fixed in phase Ç2b.1): deleting the music bed after a split of the voice keeps every subtitle word', async () => {
  // (The command layer's fault K-1: after a split of the voice, deleting the
  // music bed takes subtitle words. As a setting-family op it is a sequence
  // of the oracle — src/test/oracle/cases.ts, seed 269; here as an op that
  // runs as it is written, on a fresh read. Since phase Ç2b.1 a ripple
  // delete takes the bed's time out of every track — the talk with it — so
  // the delete here is a plain one.)
  open(SHAPES[1]().project)
  await edit([{ op: 'clip.split', clipIds: ['a1'], time: 13.66 }], read())
  const words = (): number => currentDraft()!.project.captions.reduce((n, c) => n + (c.words?.length ?? 0), 0)
  const before = words()
  const out = await edit([{ op: 'clip.delete', ids: ['m1'] }], read())
  // (Before the fix the follow pass took the bed for the lines' voice and the
  // core refused: "a subtitle word whose sound is still there would be lost".)
  assert.doesNotMatch(out, /not made/)
  assert.equal(words(), before)
  assert.ok(!currentDraft()!.project.clips.m1, 'the music is gone')
  rejectDraft()
})

// ---- A11: robustness -------------------------------------------------------------

test('safety#1 / A11: the app makes every new id; a name an agent gives is only a name, and never a name of the map\'s prototype', async () => {
  open(talk(20), 'direct')
  const proto = Object.getPrototypeOf(S().project.clips)
  await assert.rejects(edit([{ op: 'clip.add', assetId: 'a1', trackId: null, start: 25, id: '__proto__' }], read()), /a name for what the op makes/)
  await assert.rejects(edit([{ op: 'text.add', time: 2, text: 'x', id: 'constructor' }], read()), /a name for what the op makes/)
  const out = await edit([{ op: 'text.add', time: 2, text: 'named', id: 'mine' }], read())
  const made = S().project.captions.find((c) => c.text === 'named')!
  assert.notEqual(made.id, 'mine', 'the id is the app\'s')
  assert.match(out, new RegExp(`New: mine=${made.id}`))
  assert.equal(Object.getPrototypeOf(S().project.clips), proto)
  assert.ok(Number.isFinite(projectDuration(S().project)))
  // The command layer itself refuses such an id (and looks ids up as own properties).
  assert.throws(() => requireFreshId(S().project, '__proto__', 'x'), /cannot be an id/)
  assert.throws(() => applyBatch(S().project, [{ name: 'clip.add', params: { assetId: 'a1', trackId: null, start: 25, id: 'hasOwnProperty' } }]), /cannot be an id/)
  await assert.rejects(edit([{ op: 'clip.setVolume', clipId: '__proto__', volume: 0.5 }], read()).then((t) => assert.match(t, /there is no clip __proto__/)).then(() => Promise.reject(new Error('dropped'))), /dropped/)
})

test('contract#1 / S14: what an op makes can be named and used by the ops after it in the same call; when it is dropped they say so', async () => {
  const p = talk(20)
  p.assets.push({ ...videoAsset('pic', 0), kind: 'image', hasAudio: false } as Asset, { ...videoAsset('pic2', 0), kind: 'image', hasAudio: false } as Asset)
  open(p, 'direct')
  const out = await edit([{ op: 'track.add', kind: 'video', id: 'top' }, { op: 'clip.add', assetId: 'pic', trackId: 'top', start: 3 }, { op: 'clip.add', assetId: 'pic2', trackId: 'top', start: 9 }], read())
  assert.doesNotMatch(out, /Dropped/)
  const top = S().project.tracks[0]
  assert.deepEqual(top.clipIds.map((id) => [S().project.clips[id].assetId, S().project.clips[id].start]), [['pic', 3], ['pic2', 9]])
  // A name whose op was dropped: the op that needs it says which.
  const again = await edit([{ op: 'clip.add', assetId: 'nope', trackId: null, start: 1, id: 'x' }, { op: 'clip.setOpacity', clipId: 'x', opacity: 0.5 }], read())
  assert.match(again, /#2 clip\.setOpacity: it needs what op #1 of this call makes \("x"\), and that op was dropped/)
  assert.doesNotMatch(again, /Read again/, 'reading again does not help with a name that is no media')
})

test('safety#4 / A11: one call cuts at most 600 ranges; a call the server gave up on while it was worked out lands nothing', async () => {
  open(talk(20, true), 'direct')
  const many = Array.from({ length: MAX_RANGES_PER_EDIT + 1 }, (_, i) => [i * 0.01, i * 0.01 + 0.005])
  await assert.rejects(edit([{ op: 'timeline.cutRanges', ranges: many }], read()), /601 ranges in one call: at most 600/)
  // (And at most 200 ops.)
  await assert.rejects(edit(Array.from({ length: 201 }, (_, i) => ({ op: 'marker.add', time: 1 + i * 0.05 })), read()), /201 ops in one call: at most 200/)
  assert.deepEqual(S().project.markers ?? [], [])
  // Cancelled between the first look and the end of the work.
  let asked = 0
  const v = S().projectVersion
  await assert.rejects(edit([{ op: 'timeline.cutRanges', ranges: [[2, 3]] }], read(), { cancelled: () => ++asked > 1 }), /cancelled: the call ran past its time; nothing was applied/)
  assert.equal(S().projectVersion, v)
  assert.deepEqual(kept(S().project), [[0, 20]])
  // (And in draft mode nothing is kept of it either.)
  open(talk(20, true), 'draft')
  asked = 0
  await assert.rejects(edit([{ op: 'timeline.cutRanges', ranges: [[2, 3]] }], read(), { cancelled: () => ++asked > 1 }), /cancelled/)
  assert.equal(draftState(), null)
})

test('drafts#10 / A11: an op that could not be read at all cannot be brought back', async () => {
  open(withBroll())
  S().setTrackFlags('V2', { locked: true })
  await edit([{ op: 'clip.setVolume', clipId: 'b1', volume: 0.2 }, { op: 'marker.add', time: 3, note: 'm' }], read())
  const d = currentDraft()!
  assert.equal(d.outcomes[0].applied, false)
  assert.equal(reviveOp(d.entries[0].seq, 0), false)
  rejectDraft()
})

test('drafts#11 / A11: an error no one foresaw inside a replay is a drop; a replay that fails leaves a draft that can be read and rejected', async () => {
  open(talk(20, true))
  await edit([{ op: 'marker.add', time: 3, note: 'm' }, { op: 'marker.add', time: 4, note: 'n' }], read())
  const errors: unknown[] = []
  const was = console.error
  console.error = (...a: unknown[]) => void errors.push(a)
  try {
    // (A fault of the app's, made up: an op of a family it has no data for.)
    draftState()!.entries[0].ops[0].family = 'own'
    user('marker.add', { time: 9 })
    const d = currentDraft()!
    assert.equal(d.outcomes[0].applied, false)
    assert.match(d.outcomes[0].reason!, /internal error, not applied/)
    assert.equal(d.outcomes[1].applied, true, 'the rest goes on')
    assert.ok(errors.length > 0, 'the fault is written down')
    // (And one the replay itself cannot get past.)
    draftState()!.entries[0].ops.push(null as never)
    user('marker.add', { time: 10 })
    assert.doesNotThrow(() => currentDraft())
    assert.ok(draftState()!.broken)
    assert.equal(useAgentStore.getState().draft?.broken, draftState()!.broken)
    assert.throws(() => acceptDraft(undefined, 'now'), /can be rejected, not accepted/)
    rejectDraft()
    assert.equal(draftState(), null)
  } finally {
    console.error = was
  }
})

// ---- B: the draft and the accept -----------------------------------------------------

test('drafts#4 / B1: accept carries what the card showed, the locks included: a lock set after the card adopts nothing', async () => {
  open(withBroll())
  await edit([{ op: 'timeline.cutRanges', ranges: [[20, 22]] }], read())
  const card = acceptPreview()
  S().setTrackFlags(S().project.tracks.find((t) => t.kind === 'audio')!.id, { locked: true })
  const v = S().projectVersion
  const out = acceptDraft(undefined, card.shown)
  assert.equal(out.changed, true)
  assert.equal(out.version, null)
  assert.equal(S().projectVersion, v)
  // The card drawn again is what is accepted.
  assert.notEqual(acceptDraft(undefined, acceptPreview().shown).version, null)
  assert.equal(S().project.clips.m1.duration, 30, 'the locked music was left, as the second card showed')
})

test('liveness#5, contract#2 / B2: a range a waiting cut leaves out later is told to the agent once, is a row of the card, and makes the accept partial', async () => {
  open(talk(20, true))
  await edit([{ op: 'timeline.cutRanges', ranges: [[4, 5], [12, 13]] }], read())
  takeNews('s1')
  user('marker.add', { time: 12.5, note: 'keep' })
  currentDraft()
  const news = takeNews('s1').join('\n')
  assert.match(news, /dropped range 2 of call #1 op #1 timeline\.cutRanges: marker .* lies in it now/)
  assert.deepEqual(takeNews('s1'), [], 'told once')
  const card = acceptPreview()
  assert.equal(card.all, false)
  assert.match(card.drop[0].label, /range 2 of timeline\.cutRanges/)
  assert.equal(useAgentStore.getState().draft!.dropped.length, 1)
  acceptDraft(undefined, card.shown)
  assert.equal(useAgentStore.getState().outcome?.kind, 'partial')
})

test('drafts#6 / B2: what drops AT a partial accept is told to the agent (and not wiped by the draft\'s own news)', () => {
  open(talk(20, true))
  draftCalls('s1', 'test', [{ name: 'text.add', params: { time: 2, text: 'T', id: 't1' } }])
  draftCalls('s1', 'test', [{ name: 'caption.update', params: { id: 't1', patch: { text: 'Styled' } } }, { name: 'marker.add', params: { time: 9, note: 'm' } }])
  takeNews('s1')
  const out = acceptDraft([2], 'now')
  assert.deepEqual(out.applied, ['2:1'])
  const news = takeNews('s1').join('\n')
  assert.match(news, /accept: caption\.update \(#2\) was dropped at the accept: there is no t1 any more/)
  assert.match(news, /what was not dropped of them is in the live project now; #1 still waits/)
  rejectDraft()
})

test('drafts#7 / B2: a drop the agent was told of stays told across a partial accept (B11: its later edit retires it)', async () => {
  open(talk(20, true))
  const v0 = read()
  await edit([{ op: 'text.add', time: 6.5, text: 'Go' }, { op: 'marker.add', time: 15, note: 'a' }], v0)
  await edit([{ op: 'marker.add', time: 16, note: 'b' }], v0)
  S().rippleDeleteMany([[6, 7]])
  currentDraft()
  assert.match(takeNews('s1').join('\n'), /dropped call #1 op #\d+ text\.add: content was removed/)
  acceptDraft([2], 'now')
  await edit([{ op: 'text.add', time: 8.5, text: 'Go' }], v0)
  const first = currentDraft()!.entries[0].ops[0]
  assert.match(first.retired ?? '', /dropped before your later edit/)
  rejectDraft()
})

test('drafts#9 / A3: what a REJECTED draft wrote is not the session\'s own', async () => {
  open(talk(20))
  const v0 = read()
  await edit([{ op: 'clip.setVolume', clipId: 'c1', volume: 0 }], v0)
  rejectDraft()
  user('clip.setVolume', { clipId: 'c1', volume: 0 })
  const out = await edit([{ op: 'clip.setVolume', clipId: 'c1', volume: 0.8 }], v0)
  assert.match(out, /volume of this clip was changed after you read it \(not by you\)/)
  assert.equal(draftState(), null)
})

test('drafts#12 / B4: while the live project has changed and the draft is not replayed on it, the card says "updating"; showing it replays', async () => {
  open(talk(20, true))
  await edit([{ op: 'marker.add', time: 3, note: 'm' }], read())
  // (A project on which a replay takes too long for the timer.)
  draftState()!.lastMs = 1000
  user('marker.add', { time: 9 })
  assert.equal(useAgentStore.getState().draft?.updating, true)
  assert.equal(draftState()!.stale, true)
  freshDraft()
  assert.equal(useAgentStore.getState().draft?.updating, undefined)
  rejectDraft()
})

test('drafts#13 / B4: versions of a closed project and the state of a session that is gone are let go', () => {
  open(talk(20))
  read('gone')
  read('gone', 'live')
  assert.ok(keptCount('gone') >= 1)
  open(talk(20))
  read('gone')
  assert.equal(keptCount('gone'), 1, 'the closed project\'s versions went with the first read of the new one')
  forgetAgentSession('sX', 'gone', true)
  assert.equal(keptCount('gone'), 0)
  // (Two sessions of a program: its versions stay while one is left.)
  read('pair')
  forgetAgentSession('s1', 'pair', false)
  assert.equal(keptCount('pair'), 1)
  keep('pair', 'x-1', { project: S().project, live: 0, draft: 0, projectSession: -1 })
  assert.equal(keptCount('pair'), 1, 'a version of another project pushes this one\'s out')
})

test('drafts#8 / B4: a waiting draft that goes because another file is opened lets its point go: the file\'s next "before the agent" keeps the user\'s later work', async () => {
  const files = new Map<string, string>()
  let n = 0
  const io: RestoreIo = {
    write: async (json, label) => {
      const name = `${1_700_000_000_000 + ++n}-${label}-${(n + 0xabcdef).toString(16).slice(-6)}.snipp`
      files.set(name, json)
      for (const old of pruneList([...files.keys()], /^(?:pre|pt)-([a-z0-9]+)-/.exec(label)?.[1])) if (old !== name) files.delete(old)
      return { name }
    },
    read: async (name) => (files.has(name) ? { json: files.get(name)! } : null),
    list: async () => [...files.keys()].map((name) => ({ name })),
    rekey: async () => ({}),
    demote: async (name) => {
      if (!files.has(name) || !/^\d{13}-pre-/.test(name)) return null
      const next = name.replace('-pre-', '-pt-')
      files.set(next, files.get(name)!)
      files.delete(name)
      return next
    }
  }
  const undo = setRestoreIo(io)
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  const opens = (p: Project, file: string): void => {
    setLastProjectPath(file)
    S().loadProject(p)
  }
  const ctx = (session: string): Parameters<typeof ctxOf>[0] => ({ session, beforeFirstEdit: async () => void (await ensureRestorePoint(session)) })
  try {
    rejectDraft()
    opens(talk(20), 'C:\\Videos\\f.snipp')
    useAgentStore.getState().setMode('draft')
    await edit([{ op: 'timeline.cutRanges', ranges: [[2, 4]] }], read(), ctx('s1'))
    assert.ok([...files.keys()].some((f) => /-pre-/.test(f)), 'the point before the agent is written')
    // Another file is opened: the draft goes with the project.
    opens({ ...defaultProject(), name: 'G' }, 'C:\\Videos\\g.snipp')
    currentDraft()
    await settle()
    assert.equal(draftState(), null)
    assert.ok(![...files.keys()].some((f) => /-pre-/.test(f)), 'no agent change landed: it is a session point now')
    // The first file again; the user works; then an agent change lands.
    opens(talk(20), 'C:\\Videos\\f.snipp')
    useAgentStore.getState().setMode('direct')
    user('marker.add', { time: 10, note: 'the user\'s own work after reopening' })
    await edit([{ op: 'timeline.cutRanges', ranges: [[12, 14]] }], read(), ctx('s2'))
    await restoreTo()
    assert.deepEqual((S().project.markers ?? []).map((m) => m.note), ['the user\'s own work after reopening'])
    assert.deepEqual(kept(S().project), [[0, 20]], 'and the agent\'s cut is taken back')
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('liveness#2 / C6: a draft of which only empty tracks would be left is not adopted', async () => {
  open(talk(20, true))
  await edit([{ op: 'track.add', kind: 'video' }, { op: 'silence.apply', regions: [{ clipId: 'c1', start: 9, end: 10 }] }], read())
  user('marker.add', { time: 2 })
  const v = S().projectVersion
  const out = acceptDraft(undefined, 'now')
  assert.equal(out.version, null)
  assert.equal(S().projectVersion, v)
  assert.match(takeNews('s1').join('\n'), /only empty tracks would be left of the draft: nothing was adopted/)
  rejectDraft()
})

// ---- B3, C6: what the answers say -------------------------------------------------------

test('contract#3, #10 / B3: a cut that could follow no footage still says what it cut; the seconds are what went, not the sum of what was asked', async () => {
  open(talk(20), 'direct')
  const past = await edit([{ op: 'timeline.cutRanges', ranges: [[18, 21]] }], read())
  assert.match(past, /cut 1 range \(2\.00 s\)\. Length 20\.00 → 18\.00 s/)
  assert.match(past, /Cut \(.*\): \[18\.00,20\.00\]/)
  const overlap = await edit([{ op: 'timeline.cutRanges', ranges: [[6, 8], [7, 9]] }], read())
  assert.match(overlap, /cut 1 range \(3\.00 s\)\. Length 18\.00 → 15\.00 s/)
})

test('contract#4, #9 / B3: "already cut" names whose doing it was; an older base says the cut was made where the footage was found', async () => {
  open(talk(20, true), 'direct')
  const v0 = read()
  const twice = await edit([{ op: 'timeline.cutRanges', ranges: [[10, 12]] }, { op: 'timeline.cutRanges', ranges: [[10, 12]] }], v0)
  assert.match(twice, /#2 timeline\.cutRanges: already cut by your own earlier edit: its footage is gone, nothing to resend/)
  const again = await edit([{ op: 'timeline.cutRanges', ranges: [[10, 12]] }], v0)
  assert.match(again, /Nothing applied/)
  assert.doesNotMatch(again, /Read again/, 'reading again and resending would cut other footage')
  const tiny = await edit([{ op: 'timeline.cutRanges', ranges: [[5, 5.01]] }], read())
  assert.match(tiny, /too short to cut \(under 0\.02 s\)/)
  // An older base: [14, 15] of v0 is at [12, 13] now.
  const moved = await edit([{ op: 'timeline.cutRanges', ranges: [[14, 15]] }], v0)
  assert.match(moved, /Cut \(where that footage was found, NOT the seconds you sent/)
  assert.match(moved, /\[12\.00,13\.00\]/)
  // The user's cut is the user's.
  open(talk(20, true), 'direct')
  const v1 = read()
  S().rippleDeleteMany([[9, 13]])
  assert.match(await edit([{ op: 'timeline.cutRanges', ranges: [[10, 12]] }], v1), /already cut: its footage is no longer on the timeline \(it was removed after you read it\)/)
})

test('contract#8 / C6: a setting says how much it reached; the row of a run names its first and last piece as such', async () => {
  open(talk(20), 'direct')
  await edit([{ op: 'timeline.cutRanges', ranges: [[5, 6], [10, 11]] }], read())
  const text = projectText(S().project, { version: 'x-1', state: 'live' })
  assert.match(text, /3 pieces \(first c1, last \S+\), src 0\.00–20\.00/)
  const out = await edit([{ op: 'clip.setVolume', clipId: 'c1', volume: 0.3 }], read())
  assert.match(out, /clip\.setVolume \(1 clip, 0\.00–5\.00 s\)/)
})

test('liveness#1, contract#7 / C1: the project read lists media not on the timeline and markers with their ids; pages list all of them', () => {
  const p = talk(20)
  for (let i = 0; i < 45; i++) p.assets.push(videoAsset(`shot${i}`, 6))
  p.markers = Array.from({ length: 25 }, (_, i) => ({ id: `mk${i}`, time: i, color: '#ffffff', note: `n${i}` })) as Project['markers']
  const text = projectText(p, { version: 'x-1', state: 'live' })
  assert.match(text, /Media not on the timeline \(id kind name length\): 45\n {2}shot0 video shot0\.mp4 6\.00 s/)
  assert.match(text, /… 5 more: project \{"track":"media"\}/)
  assert.match(text, /Markers \(id time\): mk0 0\.00 "n0", .* \+5: project \{"track":"markers"\}/)
  assert.match(projectText(p, { version: 'x-1', state: 'live' }, 'media'), /shot44 video shot44\.mp4/)
  assert.match(projectText(p, { version: 'x-1', state: 'live' }, 'markers'), /mk24 24\.00 "n24"/)
  const list = agentTools().find((t) => t.name === 'project')!
  assert.match((list.inputSchema as { properties: { track: { description: string } } }).properties.track.description, /"media", "markers", "titles"/)
})

test('contract#12 / C6: the changes tool says "of a read", and says when it has no cut list although times moved', () => {
  assert.match(agentTools().find((t) => t.name === 'changes')!.description, /since version v \(of a read\)/)
  const a = talk(20, true)
  const b = applyBatch(a, [{ name: 'clip.move', params: { clipId: 'c1', start: 3 } }]).project
  const text = changesText({ from: 1, to: 2, ...diffProjects(a, b) }, 'x-1', 'x-2', [])
  assert.match(text, /Cuts: not known \(more than cuts happened since\): read again for the new times\./)
})

test('liveness#4 / C6: ops applied after dropped ones of the same call are said (the dropped ones are to be planned again)', async () => {
  open(talk(20, true), 'direct')
  const out = await runEdit({ ops: [{ op: 'timeline.cutRanges', ranges: [[2, 3]] }, { op: 'silence.apply', regions: [{ clipId: 'c1', start: 9, end: 10 }] }, { op: 'marker.add', time: 15, note: 'm' }], base: read() }, ctxOf())
  assert.deepEqual(out.outcomes.map((o) => o.applied), [true, false, true])
  assert.match(out.text, /#2 silence\.apply: its ids and times are of the version you read, and an earlier edit of yours \(#1 timeline\.cutRanges of this call\) moved or cut what was there/)
  assert.match(out.text, /Ops after the dropped ones were applied: plan the dropped ones again from a new read/)
})

test('liveness#6 / C6: a name that is no media is not answered with "read again"; the card counts the copies an op was sent again as, and does not list them', async () => {
  open(talk(20, true))
  const v0 = read()
  const none = await edit([{ op: 'clip.append', assetId: 'nope' }], v0)
  assert.match(none, /Nothing applied/)
  assert.doesNotMatch(none, /read again/i)
  // A title dropped (its footage was cut), told, and sent again: one row.
  await edit([{ op: 'text.add', time: 6.5, text: 'Go' }, { op: 'marker.add', time: 15, note: 'a' }], v0)
  S().rippleDeleteMany([[6, 7]])
  currentDraft()
  assert.match(takeNews('s1').join('\n'), /dropped call #1 op #\d+ text\.add/)
  await edit([{ op: 'text.add', time: 8.5, text: 'Go' }], v0)
  const plan = acceptPreview()
  assert.equal(plan.replaced, 1)
  assert.deepEqual(plan.drop, [])
  rejectDraft()
})

test('contract#6 / C6: a call of which nothing is applied any more is not counted among the calls that wait', async () => {
  open(talk(20, true))
  const v0 = read()
  await edit([{ op: 'silence.apply', regions: [{ clipId: 'c1', start: 9, end: 10 }] }], v0)
  await edit([{ op: 'marker.add', time: 3, note: 'a' }], read())
  takeNews('s1')
  user('marker.add', { time: 17, note: 'mine' })
  currentDraft()
  assert.match(takeNews('s1').join('\n'), /dropped call #1 op #\d+ silence\.apply/)
  const out = await edit([{ op: 'marker.add', time: 4, note: 'b' }], read())
  assert.match(out, /2 calls wait for the user/)
  assert.equal(currentDraft()!.entries.length, 3)
  rejectDraft()
})

test('oracle#7 (M02): a line the user retyped after the read is not retyped over by the agent', async () => {
  open(talk(20, true))
  const v0 = read()
  const line = S().project.captions[1]
  user('caption.update', { id: line.id, patch: { text: 'we do on' } })
  const out = await edit([{ op: 'caption.update', id: line.id, patch: { text: 'the agent says' } }], v0)
  assert.match(out, /the text of this line was changed after you read it \(not by you\)/)
  assert.equal(S().project.captions.find((c) => c.id === line.id)!.text, 'we do on')
  assert.equal(draftState(), null)
})

test('oracle#8 (M14): a cut over clips that lie over each other on the talk\'s track is not made (it has no one meaning)', async () => {
  const p = talk(10, true)
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  p.clips.c2 = clipOf('c2', 'a1', v1.id, 8, 30, 10)
  v1.clipIds = ['c1', 'c2']
  open(p)
  const out = await edit([{ op: 'timeline.cutRanges', ranges: [[3, 4]] }], read())
  assert.match(out, /Nothing applied/)
  assert.match(out, /clips c1 and c2 lie over each other on track \S+: a cut there has no one meaning; not cut/)
  assert.equal(draftState(), null)
})

test('oracle#9 (M13): footage the timeline shows twice is not a place: an op at a second of it is dropped, not put at the first of the two', async () => {
  open(talk(20, true))
  const v0 = read()
  // The user splits the talk at 10 s, carries the second half off and pulls
  // the first half's end out again: source 10–14 plays in two clips now.
  user('clip.split', { clipIds: ['c1'], time: 10 })
  const second = Object.values(S().project.clips).find((c) => c.id !== 'c1')!
  user('clip.move', { clipId: second.id, start: 30 })
  user('clip.trimEnd', { clipId: 'c1', delta: 4 })
  assert.equal(S().project.clips.c1.duration, 14)
  const out = await edit([{ op: 'marker.add', time: 12, note: 'here' }, { op: 'clip.split', clipIds: ['c1'], time: 12 }], v0)
  assert.match(out, /Nothing applied/)
  assert.match(out, /#1 marker\.add: the footage at its time is on the timeline more than once/)
  assert.match(out, /#2 clip\.split: the footage at its point is on the timeline more than once/)
  assert.equal(draftState(), null)
})

test('oracle#4 (M16): a cut takes the footage it meant and no other footage of the talk (a piece of the same clip on another track, over the range)', async () => {
  const p = talk(10, true)
  // A piece of the same clip (source 12–18) lies on a track above, over 2–8 s.
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['c1b'] })
  p.clips.c1b = clipOf('c1b', 'a1', 'V2', 2, 12, 6, { instance: 'c1' } as never)
  open(p)
  const out = await edit([{ op: 'timeline.cutRanges', ranges: [[3, 4]] }], read())
  assert.match(out, /Nothing applied/)
  assert.match(out, /it would cut footage the edit did not mean/)
  assert.equal(draftState(), null)
})

test('oracle#10 (M19): an op of the placement family adds one title or one marker and changes nothing else — whatever command it names', async () => {
  open(talk(20, true))
  await edit([{ op: 'marker.add', time: 5, note: 'a' }], read())
  // (No command of this family does more today. Held to it all the same: the
  // op is made to name a command that cuts the clip at its time.)
  const op = draftState()!.entries[0].ops[0]
  op.name = 'clip.split'
  op.params = { clipIds: ['c1'] }
  user('marker.add', { time: 17, note: 'mine' })
  const o = outcomes()[0]
  assert.equal(o.applied, false)
  assert.match(o.reason ?? '', /it would now also change other things/)
  assert.equal(Object.keys(currentDraft()?.project.clips ?? S().project.clips).length, 1)
  rejectDraft()
})

test('oracle#10 (M20): a setting that would now change a field it did not change when it was sent is dropped (a volume set on a clip the user muted since would unmute it)', async () => {
  open(talk(20))
  const v0 = read()
  await edit([{ op: 'clip.setVolume', clipId: 'c1', volume: 0.5 }, { op: 'marker.add', time: 3, note: 'a' }], v0)
  user('clip.setMuted', { clipId: 'c1', muted: true })
  const o = outcomes()[0]
  assert.equal(o.applied, false)
  assert.match(o.reason ?? '', /it would now also change muted, which it did not when you sent it/)
  assert.equal(currentDraft()!.project.clips.c1.muted, true)
  rejectDraft()
})

test('core#10 / A12 (N11): a track unlocked since the read is footage the agent did not see go with its cut: that range is left', async () => {
  const p = withBroll()
  p.tracks.find((t) => t.id === 'V2')!.locked = true
  open(p)
  const v0 = read()
  S().setTrackFlags('V2', { locked: false })
  const out = await edit([{ op: 'timeline.cutRanges', ranges: [[2, 3], [9, 10]] }], v0)
  assert.match(out, /range 2: clip b1 lies in it now and did not \(there\) when you read it \(something you did not make\); not cut/)
  assert.equal(currentDraft()!.project.clips.b1.duration, 6)
  rejectDraft()
})

test('drafts#13 / B4 (N26b): what a session wrote is its own only while the session is there (one that is gone leaves nothing behind for its id)', async () => {
  open(talk(20), 'direct')
  const v0 = read()
  await edit([{ op: 'clip.setVolume', clipId: 'c1', volume: 0.5 }], v0)
  // Still there: its own value is no one else's change.
  assert.match(await edit([{ op: 'clip.setVolume', clipId: 'c1', volume: 0.6 }], v0), /Applied/)
  forgetAgentSession('s1')
  const out = await edit([{ op: 'clip.setVolume', clipId: 'c1', volume: 0.8 }], v0)
  assert.match(out, /volume of this clip was changed after you read it \(not by you\)/)
  assert.equal(S().project.clips.c1.volume, 0.6)
})

test('liveness#3 / C2 (N35): an op that names only media and a track (ids that last) is not tied to the version it was read in: it runs after the call\'s own cut', async () => {
  open(withBroll())
  const v1 = S().project.tracks.find((t) => t.kind === 'video' && t.id !== 'V2')!.id
  // (The append only adds; moving a track adds nothing and names a track.)
  const out = await runEdit({ ops: [{ op: 'timeline.cutRanges', ranges: [[2, 3]] }, { op: 'clip.append', assetId: 'spare', trackId: v1 }, { op: 'track.move', trackId: 'V2', dir: 1 }], base: read() }, ctxOf())
  assert.deepEqual(out.outcomes.map((o) => [o.applied, o.reason]), [[true, undefined], [true, undefined], [true, undefined]])
  const last = Object.values(currentDraft()!.project.clips).find((c) => c.assetId === 'spare')!
  assert.equal(last.start, 29, 'at the end of the talk as the cut left it')
  assert.deepEqual(currentDraft()!.project.tracks.filter((t) => t.kind === 'video').map((t) => t.id), [v1, 'V2'])
  rejectDraft()
})

test('oracle#4 (N44): a cut that would leave footage it meant to cut is not made (the same footage also plays in a piece on a locked track)', async () => {
  const p = talk(10, true)
  // A piece of the same clip, showing source 3–4.5, lies on a locked track above, later.
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['c1b'], locked: true })
  p.clips.c1b = clipOf('c1b', 'a1', 'V2', 12, 3, 1.5, { instance: 'c1' } as never)
  open(p)
  const out = await edit([{ op: 'timeline.cutRanges', ranges: [[3, 4]] }], read())
  assert.match(out, /Nothing applied/)
  assert.match(out, /it would leave footage it meant to cut/)
  assert.equal(draftState(), null)
})

test('A3 (N42): two sessions\' edits straight onto the timeline do not share one stream of ids (a record one made, deleted since, does not come back as the other\'s)', async () => {
  const back = setSeams({ entrySeed: (seq) => seq * 7919 })
  try {
    open(talk(20, true), 'direct')
    // (Two sessions that have made nothing yet: each one's first edit.)
    await edit([{ op: 'marker.add', time: 5, note: 'a' }], read(), { session: 'first-of-a' })
    const first = S().project.markers![0].id
    user('marker.delete', { id: first })
    await edit([{ op: 'marker.add', time: 5.5, note: 'b' }], read('other'), { session: 'first-of-b', client: 'other' })
    assert.equal(S().project.markers!.length, 1)
    assert.notEqual(S().project.markers![0].id, first)
  } finally {
    back()
  }
})

test('C6: an apply that chooses nothing (every item uncertain) is a dropped op that says so; the rest of the call is applied', async () => {
  open(talk(20, true))
  const v0 = read()
  const r = result('r9', v0, S().project, [{ cut: [5, 6] }])
  r.items[0].uncertain = true
  const ctx = ctxOf({ results: new Map([['r9', r]]) })
  const out = await runEdit({ ops: [{ op: 'marker.add', time: 3, note: 'a' }, { op: 'apply', result: 'r9' }], base: v0 }, ctx)
  assert.deepEqual(out.outcomes.map((o) => o.applied), [true, false])
  assert.match(out.text, /#2 apply r9: no item is chosen \(only \/ except \/ include leave nothing; uncertain items need "include"\)/)
  assert.doesNotMatch(out.text, /read again/i)
  // (And it is nothing the user could bring back.)
  assert.equal(reviveOp(1, 1), false)
  rejectDraft()
  // Alone in a call: nothing applied, said the same way.
  assert.match(await editTool({ ops: [{ op: 'apply', result: 'r9' }], base: read() }, ctx), /Nothing applied[\s\S]*apply r9: no item is chosen/)
})

test('the edit tool: direct:true is one step on the timeline; a waiting draft is never jumped over', async () => {
  open(talk(20))
  const before = S().projectVersion
  const out = await editTool({ ops: [{ op: 'marker.add', time: 2, note: 'direct' }], base: read(), direct: true }, ctxOf())
  assert.match(out, /Applied \(one undo step\)/)
  assert.equal(currentDraft(), null, 'no draft was made')
  assert.ok((S().project.markers ?? []).some((m) => m.note === 'direct'))
  assert.notEqual(S().projectVersion, before)
  // (A draft the user has not answered is theirs: direct waits for it.)
  open(talk(20))
  await edit([{ op: 'marker.add', time: 3, note: 'draft' }], read())
  assert.ok(currentDraft())
  await assert.rejects(editTool({ ops: [{ op: 'marker.add', time: 4, note: 'x' }], base: read(), direct: true }, ctxOf()), /A draft is waiting/)
})

// ---- Part II (FAZ4A-PLAN.md 9): the three rules only the oracle run saw ----------
// N39, N40 and N49 of scripts/mutate.mjs broke no unit test: only the short
// oracle run saw them. The sequences it saw them in, kept as fixed runs (the
// generator is seeded): each must stay free of violations and of dropped
// ops that had to stay alive.

async function oracleSeeds(seeds: [kind: 'full' | 'two', seed: number][]): Promise<string[]> {
  const { addTo, emptyTally, livenessBreaks, runSequence } = await import('./oracle/gen')
  const bad: string[] = []
  for (const [kind, seed] of seeds) {
    const r = await runSequence({ seed, two: kind === 'two' })
    const t = emptyTally()
    addTo(t, r)
    const breaks = livenessBreaks(t)
    if (r.violations.length || breaks.length) bad.push(`${kind} ${seed}: ${r.violations.map((v) => v.kind).join(',')} ${JSON.stringify(breaks)}`)
  }
  return bad
}

test("A3 (N39): a title or marker the session's own cut moved is not someone else's change — its later cuts stay alive", async () => {
  assert.deepEqual(await oracleSeeds([['full', 134], ['full', 300], ['full', 349]]), [])
})

test('A1 (N40): a marker the session made itself may be taken by its own later cut — the cut stays alive', async () => {
  assert.deepEqual(await oracleSeeds([['full', 81], ['full', 307], ['two', 70]]), [])
})

test("A1 / drafts#1 (N49): a piece the session's cut split off someone else's clip is not the session's to take", async () => {
  assert.deepEqual(await oracleSeeds([['full', 82], ['full', 265]]), [])
})
