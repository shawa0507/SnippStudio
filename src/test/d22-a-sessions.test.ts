// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker A, items 3 and 5 (the audit's K5 and K13): which session the
// server forgets when one program has too many, and agent.json written whole
// or not at all.
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AgentHost, evictable, SESSIONS_MAX, SESSIONS_PER_CLIENT } from '../main/agent-host'
import { readAgentSettings, writeAgentSettings } from '../main/agent-server'

type Call = (tool: string, args: unknown, session: string) => Promise<{ content: { text: string }[]; isError?: boolean }>

function hostWithWindow(): { host: AgentHost; call: Call; sent: [string, { id?: string; kind?: string }][]; answer: (callId: string) => void } {
  const sent: [string, { id?: string; kind?: string }][] = []
  const contents = { id: 7, isDestroyed: () => false, send: (ch: string, v: { id?: string }) => void sent.push([ch, v]) }
  const win = { isDestroyed: () => false, webContents: contents } as never
  const host = new AgentHost({ userData: () => '.', port: 1, version: '1', name: 'snipp', forced: false, target: () => ({ win, projectPath: null }), timeoutMs: 60_000 })
  const call = (host as unknown as { call: Call }).call.bind(host)
  return { host, call, sent, answer: (callId) => host.answer(7, callId, { content: [{ type: 'text', text: 'ok' }] }) }
}

test('K5: which session goes: never one with a call waiting; a session that never called a tool first; then the one silent the longest', () => {
  const s = (id: string, seen: number, called = true) => ({ id, created: 0, seen, called })
  const none = (): boolean => false
  assert.equal(evictable([s('old-but-working', 900), s('quiet', 100), s('newer', 500)], none), 'quiet', 'not the oldest: the quietest')
  assert.equal(evictable([s('working', 100), s('check', 800, false), s('other', 300)], none), 'check', 'a health check goes before a session that worked')
  assert.equal(evictable([s('check-1', 800, false), s('check-2', 200, false)], none), 'check-2')
  assert.equal(evictable([s('waits', 100), s('b', 500)], (id) => id === 'waits'), 'b', 'the quietest is in a wait: not it')
  assert.equal(evictable([s('a', 1), s('b', 2)], () => true), null, 'every one has a call waiting: none')
  assert.equal(evictable([{ id: 'x', created: 5 }, { id: 'y', created: 3 }], none), 'y', 'never heard from again: by when it was opened')
})

test('K5: the session that works since the morning outlives eight later sessions of the same program', async () => {
  const { host, call, sent, answer } = hostWithWindow()
  const working = host.open('claude-code')
  // It works: a call, answered.
  const first = call('project', {}, working)
  answer(sent.at(-1)![1].id!)
  await first
  // It is in a wait now (a call the page has not answered).
  void call('wait', { seconds: 240 }, working)
  // Eight more sessions under the same name (every `claude` started, every
  // "check the connection"): none of them ends the one that works.
  const later = Array.from({ length: SESSIONS_PER_CLIENT }, () => host.open('claude-code'))
  assert.equal(host.has(working), true, 'the working session is still there')
  assert.equal(later.filter((id) => host.has(id)).length, SESSIONS_PER_CLIENT - 1, 'one of the idle ones went instead')
  assert.equal(host.has(later[0]), false, 'the idle one silent the longest')
  assert.deepEqual(sent.filter(([ch, v]) => ch === 'agent:session' && v.kind === 'ended').map(([, v]) => v.id), [], 'a session that never reached a window has no page to tell')
  // Not in a wait either, but it called a tool and the others did not: it stays.
  const b = hostWithWindow()
  const worked = b.host.open('claude-code')
  const c1 = b.call('project', {}, worked)
  b.answer(b.sent.at(-1)![1].id!)
  await c1
  const checks = Array.from({ length: SESSIONS_PER_CLIENT + 3 }, () => b.host.open('claude-code'))
  assert.equal(b.host.has(worked), true)
  assert.equal(checks.filter((id) => b.host.has(id)).length, SESSIONS_PER_CLIENT - 1)
  await b.host.close()
  await host.close()
})

test('K5: when every session of the program has a call waiting, none is ended (up to the server\'s own limit)', async () => {
  const { host, call } = hostWithWindow()
  const busy = Array.from({ length: SESSIONS_PER_CLIENT }, () => host.open('claude-code'))
  for (const id of busy) void call('wait', { seconds: 240 }, id)
  const ninth = host.open('claude-code')
  assert.ok(busy.every((id) => host.has(id)), 'nobody in a wait was ended')
  assert.equal(host.has(ninth), true)
  // The server's own limit still holds.
  const more = Array.from({ length: SESSIONS_MAX }, () => host.open('claude-code'))
  assert.ok(busy.every((id) => host.has(id)))
  assert.ok([ninth, ...more].filter((id) => host.has(id)).length <= SESSIONS_MAX - busy.length)
  await host.close()
})

test('K13: agent.json is written whole or not at all (a temp file beside it, renamed over it)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'd22a-agent-'))
  try {
    const one = { enabled: true, token: 'a'.repeat(43) }
    await writeAgentSettings(dir, one)
    assert.deepEqual(await readAgentSettings(dir), one)
    assert.deepEqual((await fs.readdir(dir)).sort(), ['agent.json', 'agent.json.bak'], 'no temp file is left')
    // Written again: the new one, whole.
    const two = { enabled: false, token: 'b'.repeat(43) }
    await writeAgentSettings(dir, two)
    assert.deepEqual(await readAgentSettings(dir), two)
    assert.equal(await fs.readFile(path.join(dir, 'agent.json'), 'utf8'), JSON.stringify(two, null, 2) + '\n')
    // A write that fails leaves the old file as it was (here: the folder
    // of the temp file cannot be written — the target is a directory's name).
    const blocked = path.join(dir, 'sub')
    await fs.mkdir(path.join(blocked, 'agent.json'), { recursive: true })
    await assert.rejects(writeAgentSettings(blocked, one))
    assert.deepEqual((await fs.readdir(blocked)).sort(), ['agent.json'], 'the failed write left no temp file')
    assert.deepEqual(await readAgentSettings(dir), two)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
