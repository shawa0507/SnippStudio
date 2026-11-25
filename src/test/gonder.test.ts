// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// GONDER-PLAN.md: the agent's inbox and the `wait` tool. The inbox's rules
// (numbers, each item once by the cursor, a lost delivery given back), what a
// wait answers, how long it waits per agent program, the server cancelling a
// call the agent gave up on, and who may write to the inbox (the interface
// only).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:net'
import { emptyInbox, giveBack, inboxText, pushItem, queuedNotes, remember, RECENT_MAX, resetInbox, sendToInbox, takeItems, useInbox, waitForItems } from '../renderer/src/agent/inbox'
import { NOTHING_YET, WAIT_DEFAULT, WAIT_MARGIN_MS, WAIT_MAX, waitBudgetMs, waitClient, waitSeconds } from '../renderer/src/agent/wait'
import { agentTools, RESERVED_TOOLS, SERVER_INSTRUCTIONS } from '../renderer/src/agent/tools'
import { matchReady } from '../renderer/src/agent/command'
import { AGENT_PATH, startAgentServer, type AgentSessions } from '../main/agent-server'
const BANNED = /prefer|style|font|colou?r|palette|layout|should look|template/i
import { defaultProject, type Project, type WorkNote } from '../renderer/src/types'

const SRC = path.join(__dirname, '..', '..', 'src')

test('the inbox: numbered items, each handed over once (the cursor), the rest in line', () => {
  const box = emptyInbox()
  const a = pushItem(box, { kind: 'task', text: 'tighten the intro' }, 1)
  const b = pushItem(box, { kind: 'notes', notes: ['n1', 'n2'] }, 2)
  assert.deepEqual([a.id, b.id], [1, 2])
  assert.deepEqual([...queuedNotes(box)], ['n1', 'n2'])
  const first = takeItems(box)
  assert.deepEqual(first.map((i) => i.id), [1, 2])
  assert.equal(box.delivered, 2, 'the cursor is past them')
  assert.deepEqual(takeItems(box), [], 'never handed over twice')
  assert.equal(queuedNotes(box).size, 0)
  const c = pushItem(box, { kind: 'draft', outcome: 'rejected', text: 'too many cuts' }, 3)
  assert.equal(c.id, 3)
  assert.deepEqual(takeItems(box).map((i) => i.id), [3], 'only what came after the cursor')
})

test('the inbox: a lost delivery goes back in line with new numbers; the recent list keeps 12, newest first', () => {
  const box = emptyInbox()
  pushItem(box, { kind: 'task', text: 'one' }, 1)
  const taken = takeItems(box)
  remember(box, taken, 'claude-code', 5)
  assert.equal(box.recent[0].to, 'claude-code')
  pushItem(box, { kind: 'task', text: 'two' }, 6)
  const back = giveBack(box, taken, 7)
  assert.equal(back[0].id, 3)
  assert.equal(back[0].again, true)
  assert.equal(box.recent.length, 0, 'it left the recent list')
  assert.deepEqual(takeItems(box).map((i) => (i.kind === 'task' ? i.text : '')), ['two', 'one'])
  for (let i = 0; i < 20; i++) remember(box, [pushItem(box, { kind: 'task', text: `t${i}` }, 10 + i)], 'x', 10 + i)
  assert.equal(box.recent.length, RECENT_MAX)
  assert.equal((box.recent[0] as { text: string }).text, 't19')
})

function noted(): Project {
  const p = defaultProject()
  p.name = 'Demo'
  const note = (id: string, num: number, start: number, text: string): WorkNote => ({ id, num, start, end: start + 1, kind: 'fix', text, status: 'open', created: '2026-11-21T10:00:00Z' }) as unknown as WorkNote
  p.notes = [note('a', 1, 4, 'shorter here'), note('b', 2, 1, 'brighter')]
  return p
}

test('what a wait answers: the notes (number, time, text), the task with its selection, the draft answer; short English', () => {
  const p = noted()
  const text = inboxText(
    [
      { id: 1, at: 0, kind: 'notes', notes: ['a', 'b'] },
      { id: 2, at: 0, kind: 'task', text: '  make the   intro tighter ', selection: 'clips c1,c2' },
      { id: 3, at: 0, kind: 'draft', outcome: 'rejected', text: 'too many cuts' },
      { id: 4, at: 0, kind: 'draft', outcome: 'partial' }
    ],
    p
  )
  const lines = text.split('\n')
  assert.match(lines[0], /^From the user in .+ \("Demo"\):$/)
  assert.match(text, /2 notes sent, now "with agent" \(answer with notes update\)\. Times are timeline seconds\./)
  assert.ok(text.indexOf('#2 ') < text.indexOf('#1 '), 'in timeline order')
  assert.match(text, /"shorter here"/)
  assert.match(text, /^Task: "make the intro tighter"$/m)
  assert.match(text, /^ {3}selected then: clips c1,c2$/m)
  assert.match(text, /^The user REJECTED your draft\. In their words: "too many cuts"$/m)
  assert.match(text, /accepted part of your draft \(read changes/)
  assert.equal(lines.at(-1), 'When done, call wait again.')
  assert.match(inboxText([{ id: 1, at: 0, kind: 'notes', notes: ['a'] }], p, true), /seconds of your draft/)
  // A note gone meanwhile: nothing said of it.
  assert.doesNotMatch(inboxText([{ id: 1, at: 0, kind: 'notes', notes: ['zz'] }], p), /note/)
  assert.equal(BANNED.exec(text.replace(/"[^"]*"/g, '')), null)
})

test('how long a wait waits: under each agent program\'s limit, 5–240 s, the server\'s time a margin longer', () => {
  assert.equal(waitClient('claude-code'), 'claude')
  assert.equal(waitClient('codex-mcp-client'), 'codex')
  assert.equal(waitClient('opencode'), 'opencode')
  assert.equal(waitClient('e2e-script'), 'other')
  assert.equal(waitSeconds(undefined, 'claude-code'), WAIT_MAX)
  assert.equal(waitSeconds(undefined, 'codex-mcp-client'), WAIT_DEFAULT.codex)
  assert.ok(WAIT_DEFAULT.codex < 60, 'under Codex\'s documented 60 s')
  assert.equal(waitSeconds(undefined, 'something'), 45)
  assert.equal(waitSeconds(1, 'claude-code'), 5)
  assert.equal(waitSeconds(10_000, 'claude-code'), WAIT_MAX)
  assert.ok(WAIT_MAX < 300, 'under fetch\'s 300 s for an answer without headers')
  assert.equal(waitBudgetMs(30, 'x'), 30_000 + WAIT_MARGIN_MS)
})

test('the wait tool: twelve tools in all, a short definition, the loop in one sentence of the instructions', () => {
  const tools = agentTools()
  assert.equal(tools.length + RESERVED_TOOLS.length, 12)
  const w = tools.find((t) => t.name === 'wait')!
  assert.ok(w, 'wait is offered')
  // (The optional plan: TOKEN-PLAN.md.)
  assert.deepEqual(w.inputSchema, { type: 'object', properties: { seconds: { type: 'integer', minimum: 5, maximum: 240 }, plan: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 24 } }, as: { type: 'string' } }, additionalProperties: false })
  // (607 with the worker label every tool has, EKIP-PLAN.md: 24 more.)
  assert.ok(JSON.stringify(w).length <= 624, `${JSON.stringify(w).length} characters`)
  assert.match(w.description, /^Returns when the user sends you something from the app/)
  assert.equal(BANNED.exec(JSON.stringify(w)), null, 'principle 6: nothing of how to work')
  assert.match(SERVER_INSTRUCTIONS, /When your work is done, call wait for the user's next request, and again while nothing came\. /)
  assert.equal(NOTHING_YET, 'Nothing from the user yet; call wait again.')
})

test('a ready job\'s exact words are done here; anything else goes to the agent', () => {
  assert.equal(matchReady('Sessizlikleri kes!'), 'silences')
  assert.equal(matchReady('cut the silences'), 'silences')
  assert.equal(matchReady('ALTYAZI ÜRET'), 'subtitles')
  assert.equal(matchReady('cut the silences and add a title'), null)
  assert.equal(matchReady(''), null)
})

test('a window\'s wait: what is in line at once, else the next send, else nothing at its time, null when stopped', async () => {
  resetInbox()
  sendToInbox({ kind: 'task', text: 'first' })
  const now = await waitForItems({ call: 'c1', client: 'x', until: Date.now() + 5000, stop: () => false })
  assert.deepEqual(now?.map((i) => (i.kind === 'task' ? i.text : '')), ['first'])
  assert.equal(useInbox.getState().queued, 0)

  const later = waitForItems({ call: 'c2', client: 'claude-code', until: Date.now() + 5000, stop: () => false })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(useInbox.getState().waiting?.client, 'claude-code', 'the tab says the agent waits')
  const r = sendToInbox({ kind: 'task', text: '  second  ' })
  assert.equal(r.taken, true, 'a waiting agent took it at once')
  assert.deepEqual((await later)?.map((i) => (i.kind === 'task' ? i.text : '')), ['second'])

  const empty = await waitForItems({ call: 'c3', client: 'x', until: Date.now() + 300, stop: () => false })
  assert.deepEqual(empty, [], 'nothing in its time')
  let stop = false
  const stopped = waitForItems({ call: 'c4', client: 'x', until: Date.now() + 5000, stop: () => stop })
  stop = true
  assert.equal(await stopped, null)
  const q = sendToInbox({ kind: 'notes', notes: ['n1'] })
  assert.equal(q.taken, false, 'nobody waits: in line')
  assert.deepEqual(useInbox.getState().queuedNotes, ['n1'])
  resetInbox()
})

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => res(port))
    })
  })
}

test('the server: a call the agent gives up (notifications/cancelled, or its connection closed) is cancelled', async () => {
  const TOKEN = 'k'.repeat(43)
  const sessions: AgentSessions = { open: () => 's1', has: () => true, end: () => undefined, fallback: () => 'default', sent: () => undefined }
  const aborted: string[] = []
  const port = await freePort()
  const server = await startAgentServer({
    port,
    token: TOKEN,
    version: '1',
    sessions,
    call: (_name, args, _session, signal) =>
      new Promise((res) => {
        signal?.addEventListener('abort', () => {
          aborted.push(String(args.seconds))
          res({ content: [{ type: 'text', text: 'cancelled' }] })
        })
        setTimeout(() => res({ content: [{ type: 'text', text: NOTHING_YET }] }), 4000)
      })
  })
  const post = (body: unknown, signal?: AbortSignal): Promise<Response> =>
    fetch(`http://127.0.0.1:${port}${AGENT_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body), signal })
  try {
    // notifications/cancelled names the request (the connection stays open).
    const waiting = post({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'wait', arguments: { seconds: 11 } } })
    await new Promise((r) => setTimeout(r, 200))
    const n = await post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7, reason: 'user' } })
    assert.equal(n.status, 202)
    await waiting
    assert.deepEqual(aborted, ['11'])
    // The connection closed before the answer.
    const ac = new AbortController()
    const gone = post({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'wait', arguments: { seconds: 12 } } }, ac.signal).catch(() => null)
    await new Promise((r) => setTimeout(r, 200))
    ac.abort()
    await gone
    await new Promise((r) => setTimeout(r, 200))
    assert.deepEqual(aborted, ['11', '12'])
  } finally {
    await server.close()
  }
})

test('only the interface writes to the inbox: no agent tool, no main-process file sends to it', () => {
  const writers: string[] = []
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name)
      if (f.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(f.name) && /\bsendToInbox\(/.test(readFileSync(p, 'utf8'))) writers.push(path.relative(SRC, p).replace(/\\/g, '/'))
    }
  }
  walk(path.join(SRC, 'renderer'))
  walk(path.join(SRC, 'main'))
  assert.deepEqual(writers.sort(), ['renderer/src/agent/inbox.ts', 'renderer/src/agent/scope-band.ts', 'renderer/src/components/agent/AgentsCard.tsx', 'renderer/src/components/agent/CommandBox.tsx', 'renderer/src/components/agent/draft-text.ts', 'renderer/src/notes/actions.ts'])
  // (notes/actions.ts: the Notes tab's button calls it. agent/scope-band.ts: the
  // range box's Send and the clip menu's ready notes, on the user's press.)
  assert.match(readFileSync(path.join(SRC, 'renderer/src/components/NotesPanel.tsx'), 'utf8'), /onClick=\{\(\) => void sendNotesToAgent\(\)\}/)
  // The page's tool runner only takes from it.
  assert.doesNotMatch(readFileSync(path.join(SRC, 'renderer/src/agent/host.ts'), 'utf8'), /sendToInbox|pushItem/)
})
