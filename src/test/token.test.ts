// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Tokens and progress (SnippStudio TOKEN-PLAN.md; YOL-HARITASI.md 1.3, 1.4):
//   - the token card's parts add up to the bar's number; the definitions
//     are counted once;
//   - "compared with raw": each answer kind's raw size, a ratio only when
//     every answer was measured, never a saving that is not there;
//   - progress: the agent's own plan, the notes the job came with, how
//     long similar jobs took (the profile keeps at most 20);
//   - nothing more goes to the agent: the raw measure reads its inputs and
//     changes none of them; the wait tool without a plan is what it was.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { jobOf, jobKindOf, notesProgressOf, phaseOf, planOf, savedPercent, similarMs, tokenPartsOf, totalsOf } from '../renderer/src/agent/activity'
import { planArg, PLAN_MAX, PLAN_NAME_MAX, PLAN_NOTED } from '../renderer/src/agent/plan'
import { rawAnalysis, rawFrames, rawProject, rawTokens, rawTranscript, SAME_AS_RAW } from '../renderer/src/agent/raw'
import { JOBS_KEPT, useAgentStore, withJob, type JobRecord, type ToolEvent } from '../renderer/src/agent/store'
import { imageTokens, textTokens, tokensOf } from '../renderer/src/agent/tokens'
import { agentTools } from '../renderer/src/agent/tools'
import { defaultProject, type Project } from '../renderer/src/types'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_TOKEN } from '../renderer/src/ui/strings-token'

let n = 0
const ev = (tool: string, started: number, extra: Partial<ToolEvent> = {}): ToolEvent => ({ id: `t${++n}`, session: 's', client: 'claude-code', tool, started, ms: 100, done: true, ...extra })
const T = 2_000_000

function deepFreeze<X>(x: X): X {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v)
  }
  return x
}

function project(): Project {
  const p = defaultProject()
  p.settings = { width: 1920, height: 1080, fps: 30 }
  p.captions = [
    { id: 'cap000000001', start: 0, end: 2, text: 'hello there', words: [{ text: 'hello', start: 0, end: 0.5 }, { text: 'there', start: 0.6, end: 1.2 }] },
    { id: 'cap000000002', start: 3, end: 5, text: 'and again', words: [{ text: 'and', start: 3, end: 3.4 }, { text: 'again', start: 3.5, end: 4.2 }] }
  ]
  return p
}

test('the card: definitions once + words + pictures = the bar\'s number', () => {
  const pic = { width: 1024, height: 288 }
  const a = ev('project', T, { chars: 360, images: [], tokens: tokensOf({ chars: 360, images: [] }) })
  const b = ev('frames', T + 1000, { chars: 90, images: [pic], tokens: tokensOf({ chars: 90, images: [pic] }) })
  const job = jobOf([a, b])!
  const phase = phaseOf(job, true, true, T + 5000)
  const parts = tokenPartsOf(job, () => 3300, () => a.id)
  const totals = totalsOf(job, phase, T + 5000, () => 3300, () => a.id)
  assert.equal(parts.total, totals.tokens, 'the card\'s total is the bar\'s')
  assert.equal(parts.defs + parts.text + parts.images, parts.total)
  assert.equal(parts.defs, 3300)
  assert.equal(parts.images, Math.round(imageTokens(pic.width, pic.height)))
  assert.equal(parts.text, Math.round(textTokens(360)) + Math.round(textTokens(90) + imageTokens(pic.width, pic.height)) - parts.images)
  // A later job of the same session: the definitions are not counted again.
  assert.equal(tokenPartsOf(job, () => 3300, () => 'earlier').defs, 0)
  // A call still running is not counted yet.
  const open = { ...ev('frames', T + 2000), done: false, ms: undefined }
  assert.equal(tokenPartsOf(jobOf([a, b, open])!, () => 0, () => undefined).total, parts.total - 3300)
})

test('compared with raw: a ratio only when every answer was measured, and only a real saving', () => {
  const a = ev('project', T, { tokens: 100, raw: 900 })
  const b = ev('edit', T + 1000, { tokens: 50, raw: 50 })
  const parts = tokenPartsOf(jobOf([a, b])!, () => 0, () => undefined)
  assert.deepEqual([parts.total, parts.raw], [150, 950])
  assert.equal(savedPercent(parts), 84)
  // With the definitions on both sides.
  const withDefs = tokenPartsOf(jobOf([a, b])!, () => 3000, () => a.id)
  assert.deepEqual([withDefs.total, withDefs.raw, savedPercent(withDefs)], [3150, 3950, 20])
  // One answer not measured: no ratio at all.
  const c = ev('frames', T + 2000, { tokens: 400 })
  const unknown = tokenPartsOf(jobOf([a, b, c])!, () => 0, () => undefined)
  assert.equal(unknown.raw, null)
  assert.equal(savedPercent(unknown), null)
  // Raw no bigger than what was sent: no saving is said.
  assert.equal(savedPercent(tokenPartsOf(jobOf([ev('edit', T, { tokens: 80, raw: 80 })])!, () => 0, () => undefined)), null)
})

test('raw sizes per answer kind; the inputs are not touched', () => {
  const p = deepFreeze(project())
  // The project: its JSON; one part of it: its own size.
  const whole = rawProject(p, undefined)
  assert.ok(whole !== null && whole !== 'same')
  assert.equal(whole.chars, JSON.stringify(p).length)
  assert.equal(rawProject(p, 'V1'), 'same')
  // The transcript: the lines the answer holds, as JSON (words when asked).
  const answer = 'v x. 0.00–5.00 of 5.00 s: 1 of 2 lines.\ncap000000001 [0.00–2.00] hello there'
  const lines = rawTranscript(p, answer, false)
  assert.ok(lines !== null && lines !== 'same')
  const { words: _w, ...line } = p.captions[0]
  void _w
  assert.equal(lines.chars, Math.max(answer.length, JSON.stringify([line]).length))
  const words = rawTranscript(p, answer, true)
  assert.ok(words !== null && words !== 'same' && words.chars === JSON.stringify([p.captions[0]]).length)
  assert.equal(rawTranscript(p, 'No subtitles yet', false), 'same')
  // Frames: each frame at the project's size; the words as sent.
  const sent = deepFreeze({ chars: 80, images: [{ width: 1024, height: 288 }] })
  assert.deepEqual(rawFrames(sent, 2, p), { chars: 80, images: [{ width: 1920, height: 1080 }, { width: 1920, height: 1080 }] })
  assert.equal(rawTokens(rawFrames(sent, 2, p), sent), tokensOf({ chars: 80, images: [{ width: 1920, height: 1080 }, { width: 1920, height: 1080 }] }))
  assert.equal(rawFrames(sent, 0, p), null)
  // An analysis: its findings as JSON, never less than what was sent.
  const items = deepFreeze([{ line: '1.00–2.00', range: [1, 2] as [number, number] }])
  const an = rawAnalysis('1 pause', items, '1 pause\n1.00–2.00')
  assert.ok(an !== null && an !== 'same' && an.chars === '1 pause'.length + JSON.stringify(items).length)
  // Its own size, and unknown.
  assert.equal(rawTokens('same', sent), tokensOf(sent))
  assert.equal(rawTokens(null, sent), null)
  assert.deepEqual([...SAME_AS_RAW].sort(), ['changes', 'code_clip', 'edit', 'job', 'media', 'new_project', 'notes', 'wait'])
})

test('the store keeps an answer\'s raw on its event; unknown leaves it out', () => {
  const st = useAgentStore.getState()
  st.callStarted({ id: 'r1', session: 's9', tool: 'project', client: 'claude-code', defsChars: 0 })
  // (Kept with the rest of its end: the store is written twice per call, start and end.)
  st.callFinished('r1', { size: { chars: 360, images: [] }, raw: 1234.4 })
  assert.equal(useAgentStore.getState().events.find((e) => e.id === 'r1')!.raw, 1234)
  st.callStarted({ id: 'r2', session: 's9', tool: 'frames', client: 'claude-code', defsChars: 0 })
  st.callFinished('r2', { size: { chars: 10, images: [] }, raw: null })
  assert.equal('raw' in useAgentStore.getState().events.find((e) => e.id === 'r2')!, false)
})

test('the agent\'s plan: steps left, current first; numbered from the longest plan of the job', () => {
  assert.deepEqual(planArg(['  read the   talk ', 'cut', '', 'a name far longer than twenty-four characters']), ['read the talk', 'cut', 'a name far longer than t'])
  assert.equal(planArg(Array.from({ length: 12 }, (_, i) => `s${i}`))!.length, PLAN_MAX)
  assert.throws(() => planArg('read, cut'), /plan: a list of up to 8 step names/)
  assert.equal(planArg(7, true), null)
  assert.equal(PLAN_NAME_MAX, 24)
  const sent = ev('wait', T, { kind: 'task' })
  const p1 = ev('wait', T + 1000, { kind: 'plan', plan: ['read', 'cut', 'subtitles'] })
  const read = ev('transcript', T + 2000)
  const p2 = ev('wait', T + 3000, { kind: 'plan', plan: ['cut', 'subtitles'] })
  const job = jobOf([ev('project', T - 5000), sent, p1, read, p2])!
  assert.equal(job.sent, true, 'a plan is not a delivery: the job is still the one the task brought')
  assert.deepEqual(job.events.map((e) => e.id), [p1.id, read.id, p2.id])
  assert.deepEqual(planOf(job), { step: 2, of: 3, name: 'cut' })
  assert.deepEqual(planOf(jobOf([sent, p1])!), { step: 1, of: 3, name: 'read' })
  // Everything done (an empty plan), or none given: nothing is said.
  assert.equal(planOf(jobOf([sent, p1, ev('wait', T + 4000, { kind: 'plan', plan: [] })])!), null)
  assert.equal(planOf(jobOf([sent, read])!), null)
  assert.equal(PLAN_NOTED, 'Plan noted.')
})

test('the notes a job came with: how many are done now', () => {
  const sent = ev('wait', T, { kind: 'notes', sent: ['n1', 'n2', 'n3', 'n4'] })
  const job = jobOf([sent, ev('notes', T + 1000)])!
  assert.equal(jobKindOf(job), 'notes')
  const status: Record<string, string> = { n1: 'ready', n2: 'approved', n3: 'agent', n4: 'agent' }
  assert.deepEqual(notesProgressOf(job, (id) => status[id]), { done: 2, of: 4 })
  // A note deleted since: not counted.
  delete status.n4
  assert.deepEqual(notesProgressOf(job, (id) => status[id]), { done: 2, of: 3 })
  assert.equal(notesProgressOf(jobOf([ev('wait', T, { kind: 'task' }), ev('project', T + 1)])!, () => 'open'), null)
  assert.equal(jobKindOf(jobOf([ev('project', T)])!), 'free')
})

test('similar jobs: the median of the last five of the same kind and program; none under two', () => {
  const rec = (kind: string, ms: number, start: number, client = 'claude-code'): JobRecord => ({ client, kind, start, ms, steps: 3, changed: 1, tokens: 100 })
  const h = [rec('notes', 60_000, 1), rec('task', 999_000, 2), rec('notes', 180_000, 3), rec('notes', 120_000, 4, 'codex')]
  assert.equal(similarMs(h, 'claude-code', 'notes'), 120_000)
  assert.equal(similarMs(h, 'claude-code', 'task'), null)
  assert.equal(similarMs([...h, rec('notes', 240_000, 5)], 'claude-code', 'notes'), 180_000)
  // The job itself is not its own example.
  assert.equal(similarMs([...h, rec('notes', 240_000, 5)], 'claude-code', 'notes', 5), 120_000)
  // The profile keeps the last 20; the same job again replaces its record.
  let list: JobRecord[] = []
  for (let i = 0; i < 30; i++) list = withJob(list, rec('task', 1000 + i, i))
  assert.equal(list.length, JOBS_KEPT)
  assert.equal(list[0].start, 10)
  list = withJob(list, { ...rec('task', 5, 29), changed: 9 })
  assert.equal(list.length, JOBS_KEPT)
  assert.equal(list.filter((r) => r.start === 29).length, 1)
  assert.equal(list[list.length - 1].changed, 9)
})

test('nothing more to the agent: the wait tool without a plan is what it was; the plan field is short and optional', () => {
  const w = agentTools().find((t) => t.name === 'wait')!
  const schema = w.inputSchema as { properties: Record<string, unknown>; required?: string[] }
  assert.equal(schema.required, undefined, 'nothing is required')
  // (as: the optional worker label every tool has, EKIP-PLAN.md.)
  const { plan, as: _as, ...before } = schema.properties
  assert.deepEqual(before, { seconds: { type: 'integer', minimum: 5, maximum: 240 } })
  assert.deepEqual(plan, { type: 'array', maxItems: PLAN_MAX, items: { type: 'string', maxLength: PLAN_NAME_MAX } })
  assert.match(w.description, /^Returns when the user sends you something from the app: notes \(now "with agent"\), a task, or their answer on your draft; each once\. If nothing comes within seconds it says so: call again\. /)
})

test('the words: both languages, the same parameters', () => {
  for (const [key, v] of Object.entries(STRINGS_TOKEN)) {
    const val = v as { en: string; tr?: string }
    assert.ok(val.tr, `${key}: Turkish`)
    const params = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(params(val.tr!), params(val.en), key)
    assert.ok(key in STRINGS, `${key} is in STRINGS`)
  }
})

test('a number\'s Turkish ending: as it is said', async () => {
  const { trOf } = await import('../renderer/src/agent/count')
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 20, 30, 40, 50, 60, 70, 80, 90, 100, 1000].map(trOf), ['1’i', '2’si', '3’ü', '4’ü', '5’i', '6’sı', '7’si', '8’i', '9’u', '10’u', '12’si', '20’si', '30’u', '40’ı', '50’si', '60’ı', '70’i', '80’i', '90’ı', '100’ü', '1000’i'])
})

test('the card\'s numbers: groups of three, the same through t() in both languages', async () => {
  const { whole } = await import('../renderer/src/components/agent/TokenCard')
  const { setLang, t } = await import('../renderer/src/ui/strings')
  try {
    setLang('en')
    assert.equal(t('token.n', { n: whole(3233) }), '≈ 3,233')
    setLang('tr')
    // (Not "3.233": t() would take it for a decimal and write "3,233".)
    assert.equal(t('token.n', { n: whole(11029) }), '≈ 11 029')
    assert.equal(t('token.n', { n: whole(870) }), '≈ 870')
  } finally {
    setLang('en')
  }
})
