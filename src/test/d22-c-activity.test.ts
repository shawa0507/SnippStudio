// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker C (YOL-HARITASI.md 1.1, 1.2; the audit's A7, L5): what the
// agent is doing, read off the calls the app records — and nothing sent to
// the agent for it.
//   - the job (the calls since the user's last send), its phase (working,
//     quiet, done) and what is counted of it;
//   - the sentence of every tool and every kind of analysis, in both
//     languages (a tool without one fails here);
//   - the flag's place and what it shows, the trail (read faint, written
//     solid), what an edit wrote;
//   - the one chip of the top bar; the working agent's selector;
//   - not one character more to the agent: the tool definitions are no
//     bigger than before, and an edit's answer is the same bytes with and
//     without the app's own reading of what it wrote.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { JOB_GAP_MS, QUIET_MS, WORK_GAP_MS, doingOf, flagOf, jobOf, phaseOf, totalsOf, trailOf, touchedOf, wroteOf } from '../renderer/src/agent/activity'
import { ANALYSIS_WORDS, TOOL_WORDS, activityPlace, activityWords } from '../renderer/src/agent/activity-words'
import { ANALYZE_KINDS } from '../renderer/src/agent/analyze'
import { draftChanges } from '../renderer/src/agent/draft-words'
import { rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { editTool } from '../renderer/src/agent/edit'
import { focusClient, programOf } from '../renderer/src/agent/program'
import { LOCAL_CLIENT } from '../renderer/src/agent/ready'
import { editSaid, wordsText } from '../renderer/src/agent/said'
import { agentTools, SERVER_INSTRUCTIONS } from '../renderer/src/agent/tools'
import { AGENT_ID, PRODUCT_NAME } from '../shared/product'
import { useAgentStore, type ToolEvent } from '../renderer/src/agent/store'
import { chipState } from '../renderer/src/components/agent/AgentTop'
import { programRows } from '../renderer/src/components/agent/AgentsCard'
import { GLOW_GAP_MS } from '../renderer/src/components/agent/AgentLayers'
import { useStore } from '../renderer/src/state/store'
import { STRINGS } from '../renderer/src/ui/strings'
import { clipOf, ctxOf, open, read, talk, videoAsset } from './agent-kit'

const S = useStore.getState

/** What initialize and tools/list put on the wire (main/agent-protocol.ts). */
function definitionsSize(): number {
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } }, serverInfo: { name: AGENT_ID, title: PRODUCT_NAME, version: '0.0.0' }, instructions: SERVER_INSTRUCTIONS } })
  const list = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: agentTools() } })
  return init.length + list.length
}

const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
  S().setUiLang('en')
})

let n = 0
const ev = (tool: string, started: number, extra: Partial<ToolEvent> = {}): ToolEvent => ({ id: `e${++n}`, session: 's', client: 'claude-code', tool, started, ms: 100, done: true, ...extra })
const T = 1_000_000

test('the job: the calls since the last wait that brought something; a gap of over ten minutes starts another', () => {
  assert.equal(jobOf([]), null)
  const a = ev('project', T)
  const b = ev('transcript', T + 5000)
  const sent = ev('wait', T + 20_000, { ms: 30_000 })
  const c = ev('edit', T + 60_000)
  const d = ev('frames', T + 70_000, { at: [3] })
  const job = jobOf([a, b, sent, c, d])!
  assert.deepEqual(job.events, [c, d], 'what came before the user sent the job is not this job')
  assert.equal(job.start, T + 50_000, 'it began when the send was taken')
  assert.equal(job.sent, true)
  // No send: the run of calls with no long gap.
  const late = ev('project', T + 70_000 + JOB_GAP_MS + 1000)
  assert.deepEqual(jobOf([a, b, late])!.events, [late])
  assert.deepEqual(jobOf([a, b])!.events, [a, b])
  assert.equal(jobOf([a, b])!.start, T)
  // The send was just taken and the agent has not called since: the job
  // before it is still the one shown ("Done" stays until new work starts).
  const taken = jobOf([a, b, sent])!
  assert.deepEqual([taken.events, taken.took], [[a, b], sent])
  assert.equal(phaseOf(taken, false, true, sent.started + 30_000 + 1000).phase, 'working', 'it just took what the user sent')
  assert.equal(phaseOf(taken, false, true, sent.started + 30_000 + 1000).current, sent)
  assert.equal(phaseOf(taken, true, true, sent.started + 40_000).phase, 'done')
  // Its first call after the send is the new job.
  assert.deepEqual(jobOf([a, b, sent, c])!.events, [c])
  // Nothing before the send: no job to show yet, only the moment it was taken.
  assert.deepEqual(jobOf([sent])!.events, [])
  assert.equal(phaseOf(jobOf([sent])!, true, true, sent.started + 40_000).phase, 'none')
})

test('the phase: working while a call is open or ended under 8 s ago; quiet to 60 s; done when the wait opens or after a minute', () => {
  const open1 = ev('edit', T, { done: false, ms: undefined })
  const job1 = jobOf([open1])!
  assert.equal(phaseOf(job1, false, true, T + 500_000).phase, 'working', 'a call in flight is work, however long')
  const done1 = ev('edit', T, { ms: 1000 })
  const job = jobOf([done1])!
  const end = T + 1000
  assert.deepEqual([phaseOf(job, false, true, end + 100).phase, phaseOf(job, false, true, end + 100).until], ['working', end + WORK_GAP_MS])
  assert.equal(phaseOf(job, false, true, end + WORK_GAP_MS + 1).phase, 'quiet', 'the old chip said "working" for 120 s here')
  assert.equal(phaseOf(job, false, true, end + WORK_GAP_MS + 1).until, end + QUIET_MS)
  assert.equal(phaseOf(job, false, true, end + QUIET_MS + 1).phase, 'done')
  assert.equal(phaseOf(job, false, true, end + 5 * 60_000).phase, 'done', 'done stays: nothing ends it but a new call')
  assert.equal(phaseOf(job, true, true, end + 100).phase, 'done', 'the agent waits for the user: it said it is done')
  assert.equal(phaseOf(job, false, false, end + WORK_GAP_MS + 1).phase, 'done', 'its session is gone')
  assert.equal(phaseOf(null, false, false, T).phase, 'none')
  // The same clock as the light round the preview.
  assert.equal(GLOW_GAP_MS, WORK_GAP_MS)
  // A call after "done" carries the same job on.
  const more = ev('frames', end + QUIET_MS + 30_000, { at: [1], done: false, ms: undefined })
  const again = jobOf([done1, more])!
  assert.equal(again.events.length, 2)
  assert.equal(again.start, T)
  assert.equal(phaseOf(again, false, true, end + QUIET_MS + 31_000).phase, 'working')
})

test('what is counted: steps, the tokens sent (the definitions once), the time, the changes', () => {
  const a = ev('project', T, { tokens: 300, ms: 200 })
  const b = ev('edit', T + 3000, { tokens: 120, ms: 400, changed: 3 })
  const job = jobOf([a, b])!
  const done = phaseOf(job, true, true, T + 99_000)
  const totals = totalsOf(job, done, T + 99_000, () => 3000, () => a.id)
  assert.deepEqual(totals, { steps: 2, tokens: 3420, ms: 3400, changed: 3 }, 'done: the time to its last call; the definitions were sent with its first call')
  assert.equal(totalsOf(job, done, T + 99_000, () => 3000, () => 'an-earlier-call').tokens, 420, 'a later job of the same session: the definitions are not counted again')
  const running = phaseOf(job, false, true, T + 4000)
  assert.equal(totalsOf(job, running, T + 4000, () => 0, () => undefined).ms, 4000, 'while it runs: to now')
})

test('every tool and every kind of analysis has its sentence, in both languages', () => {
  const served = agentTools().map((t) => t.name).sort()
  assert.deepEqual([...TOOL_WORDS].sort(), served, 'TOOL_WORDS names the tools the app serves')
  const strings = STRINGS as Record<string, { en: string; tr?: string }>
  const said = (e: ToolEvent, draft = true): string => {
    const w = activityWords(e, draft)
    assert.ok(strings[w.key]?.en && strings[w.key]?.tr, `${w.key} is in both languages`)
    return wordsText(w)
  }
  S().setUiLang('en')
  for (const tool of TOOL_WORDS) {
    assert.notEqual(activityWords(ev(tool, T, { done: false }), true).key, 'd22c.act.other', `${tool} has a sentence of its own`)
    said(ev(tool, T, { done: false }))
    said(ev(tool, T))
  }
  assert.deepEqual(Object.keys(ANALYSIS_WORDS).sort(), [...ANALYZE_KINDS].sort(), 'every kind of analysis')
  for (const kind of ANALYZE_KINDS) assert.notEqual(activityWords(ev('analyze', T, { kind, done: false }), true).key, 'd22c.act.analyze', kind)
  assert.equal(said(ev('project', T)), 'Looking at the project')
  assert.equal(said(ev('transcript', T, { range: [12, 45] })), 'Reading the transcript')
  assert.equal(activityPlace(ev('transcript', T, { range: [12, 45] })), '0:12–0:45')
  assert.equal(said(ev('frames', T, { at: [17, 18, 19] })), 'Looking at 3 frames')
  assert.equal(said(ev('frames', T, { at: [17] })), 'Looking at 1 frame')
  assert.equal(activityPlace(ev('frames', T, { at: [19, 17] })), '0:17')
  assert.equal(said(ev('analyze', T, { kind: 'silences', done: false })), 'Looking for silences')
  assert.equal(said(ev('analyze', T, { kind: 'silences', found: [[1, 2], [3, 4]] })), 'Found 2 places')
  assert.equal(said(ev('edit', T, { ops: 4, done: false })), 'Writing to the draft · 4 operations')
  assert.equal(said(ev('edit', T, { ops: 1, done: false }), false), 'Changing the timeline · 1 operation')
  assert.equal(said(ev('edit', T, { said: 'other.mp4 moves 3 s later (0:02 → 0:05)' })), 'In the draft: other.mp4 moves 3 s later (0:02 → 0:05)')
  assert.equal(said(ev('edit', T, { nothing: true })), 'An edit of which nothing was applied')
  assert.equal(said(ev('code_clip', T, { kind: 'create' })), 'Writing a code clip')
  assert.equal(said(ev('job', T, { kind: 'transcribe' })), 'Turning the speech into text')
  assert.equal(said(ev('edit', T, { error: 'cancelled' })), 'The agent is trying again: its last step did not go through', 'a failed call is a sentence, not a red chip')
  S().setUiLang('tr')
  assert.equal(said(ev('transcript', T)), 'Konuşma metnini okuyor')
  assert.equal(said(ev('frames', T, { at: [1, 2, 3] })), '3 kareye bakıyor')
  assert.equal(said(ev('analyze', T, { kind: 'silences', done: false })), 'Sessizlikleri arıyor')
  assert.equal(said(ev('edit', T, { ops: 4, done: false })), 'Taslağa yazıyor · 4 işlem')
  S().setUiLang('en')
})

test('the flag: where the agent touched the timeline last, and what it did there', () => {
  assert.equal(doingOf(ev('transcript', T)), 'read')
  assert.equal(doingOf(ev('analyze', T)), 'read')
  assert.equal(doingOf(ev('frames', T)), 'look')
  assert.equal(doingOf(ev('edit', T)), 'write')
  assert.equal(doingOf(ev('code_clip', T, { kind: 'create' })), 'write')
  assert.equal(doingOf(ev('code_clip', T, { kind: 'check' })), 'read')
  const job = jobOf([ev('project', T), ev('transcript', T + 1000, { range: [12, 20] }), ev('frames', T + 2000, { at: [17.5, 17] }), ev('notes', T + 3000)])!
  const flag = flagOf(job)!
  assert.deepEqual([flag.at, flag.doing], [17, 'look'], 'the notes have no place on the timeline: the flag stays at the frames')
  const wrote = jobOf([...job.events, ev('edit', T + 4000, { wrote: [[7.2, 9], [12, 13]], clips: ['a'] })])!
  assert.deepEqual([flagOf(wrote)!.at, flagOf(wrote)!.doing], [7.2, 'write'])
  assert.equal(flagOf(jobOf([ev('notes', T)])), null)
  assert.deepEqual(touchedOf(wrote), ['a'])
})

test('the trail: what the job read is faint, what it wrote is solid; stretches that touch are one, each with its calls', () => {
  const r1 = ev('transcript', T, { range: [0, 14] })
  const r2 = ev('transcript', T + 1000, { range: [12, 20] })
  const look = ev('frames', T + 2000, { at: [30] })
  const w1 = ev('edit', T + 3000, { wrote: [[5, 9]] })
  const w2 = ev('edit', T + 4000, { wrote: [[9, 9.9]] })
  const failed = ev('edit', T + 5000, { wrote: [[50, 60]], error: 'x' })
  const parts = trailOf(jobOf([r1, r2, look, w1, w2, failed])!, 100)
  assert.deepEqual(parts.map((p) => [p.from, p.to, p.wrote, p.events.length]), [[0, 20, false, 2], [30, 30, false, 1], [5, 9.9, true, 2]])
  // A read of the whole film.
  assert.deepEqual(trailOf(jobOf([ev('project', T)])!, 42).map((p) => [p.from, p.to]), [[0, 42]])
})

test('what an edit wrote: the stretches and the clips, from the two projects (never from the agent)', () => {
  const before = talk(20)
  before.assets.push(videoAsset('b1'))
  before.clips.x = clipOf('x', 'b1', before.tracks[0].id, 30, 0, 4)
  before.tracks[0].clipIds.push('x')
  const after = structuredClone(before)
  after.clips.x.start = 40
  const moved = wroteOf(draftChanges(before, after, []), before, after, [])
  assert.deepEqual(moved, { wrote: [[40, 44]], clips: ['x'] })
  const plain = talk(20)
  const cut = wroteOf(draftChanges(plain, plain, [[5, 6]]), plain, plain, [[5, 6]])
  assert.deepEqual(cut.wrote, [[5, 6]], 'a cut: where it closed, at least a visible stretch')
})

test('the one chip of the top bar; the agent\'s colour by program; who the interface is about', () => {
  assert.equal(chipState({ draft: false, phase: 'working', waiting: false, closed: false }), 'working')
  assert.equal(chipState({ draft: true, phase: 'done', waiting: true, closed: false }), 'draft', 'a waiting draft comes before "waiting for you"')
  assert.equal(chipState({ draft: true, phase: 'working', waiting: false, closed: false }), 'working')
  assert.equal(chipState({ draft: false, phase: 'quiet', waiting: false, closed: false }), 'quiet')
  assert.equal(chipState({ draft: false, phase: 'done', waiting: true, closed: false }), 'waiting')
  assert.equal(chipState({ draft: false, phase: 'done', waiting: false, closed: false }), 'done')
  // (GONDER2-PLAN.md: done with its session there and no wait: it awaits the user's reply in its chat.)
  assert.equal(chipState({ draft: false, phase: 'done', waiting: false, closed: false, alive: true }), 'reply')
  assert.equal(chipState({ draft: false, phase: 'done', waiting: false, closed: true, alive: true }), 'reply')
  assert.equal(chipState({ draft: false, phase: 'done', waiting: false, closed: true }), 'idle')
  assert.deepEqual(['claude-code', 'codex-mcp-client', 'opencode', 'antigravity-agent', 'my-own-agent'].map(programOf), ['claude', 'codex', 'opencode', 'antigravity', 'other'])
  const s = (client: string, lastCall: number) => ({ id: client, client, started: 0, lastCall, calls: 1, tokens: 0, defsTokens: 0 })
  const sessions = { a: s('claude-code', 5), b: s('codex-mcp-client', 9) }
  assert.equal(focusClient('claude-code', null, sessions), 'claude-code', 'the working agent')
  assert.equal(focusClient(null, { client: 'claude-code' }, sessions), 'claude-code', "the waiting draft's owner")
  assert.equal(focusClient(null, null, sessions), 'codex-mcp-client', 'else the one that called last')
  assert.equal(focusClient(null, { client: LOCAL_CLIENT }, sessions), null, "the app's own draft: no agent")
})

test('the working agent\'s selector: every connected program once, with its chats; the holder, the pick and those that asked', () => {
  const s = (id: string, client: string, started: number) => ({ id, client, started, lastCall: started, calls: 1, tokens: 0, defsTokens: 0 })
  const rows = programRows({ a: s('a', 'claude-code', 50), b: s('b', 'claude-code', 20), c: s('c', 'codex-mcp-client', 30) }, 'claude-code', null, ['codex-mcp-client', 'opencode'])
  assert.deepEqual(rows, [
    { client: 'claude-code', chats: 2, since: 20, asked: false },
    { client: 'codex-mcp-client', chats: 1, since: 30, asked: true },
    { client: 'opencode', chats: 0, since: null, asked: true }
  ])
})

test('nothing more goes to the agent: the definitions are no bigger, and an edit answers the same bytes with and without the app\'s own reading', async () => {
  const size = definitionsSize()
  // (11 483 when this was written; 11 495 with track.setMagnet, merged the same day;
  // 11 637 with the wait tool's optional plan, TOKEN-PLAN.md: 142 characters;
  // 11 938 with the optional worker label, EKIP-PLAN.md: 301 characters.)
  // (cogalt, 23 Nov: 11 953 with clip.duplicate and job start + wait;
  // 12 961 with the media tool; new_project adds the clean start. Limit 14 000.)
  assert.ok(size <= 14_000, `initialize + tools/list: ${size} characters`)
  const run = async (words: boolean): Promise<string> => {
    open(talk(20, true), 'draft')
    return editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[4, 5]] }, { op: 'marker.add', time: 2, note: 'here' }], base: read() }, ctxOf(words ? { words: editSaid } : {}))
  }
  const plain = await run(false)
  const withWords = await run(true)
  // (The version token in the answer is the project's own; both runs open the same project.)
  // (The ids the app makes for new records are its own, made anew each run.)
  const strip = (s: string): string => s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}\b/g, 'ID')
  assert.equal(strip(withWords), strip(plain))
  // And the store keeps what the app read for itself on the call's event.
  const st = useAgentStore.getState()
  st.callStarted({ id: 'w1', session: 's', tool: 'edit', client: 'claude-code', defsChars: 0, ops: 2 })
  st.callFinished('w1', { said: 'x', wrote: [[4, 5]], clips: ['c1'], changed: 2 })
  const e = useAgentStore.getState().events.find((x) => x.id === 'w1')!
  assert.deepEqual([e.client, e.ops, e.wrote, e.clips, e.changed], ['claude-code', 2, [[4, 5]], ['c1'], 2])
})
