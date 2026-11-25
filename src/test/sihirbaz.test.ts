// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The connection wizard (SnippStudio SIHIRBAZ-PLAN.md): its rules (the four
// check rows and the five steps) in the four broken states and the good one;
// what the main process tells it (the sessions heard, the requests refused);
// Codex's key compared inside PowerShell (only a word comes out); the lines
// its steps copy.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkButtonBusy, checkRows, clientFamily, defaultProgram, stepStates, timeOfDay, type Facts } from '../renderer/src/components/settings/wizard-model'
import { codexEnvQueryArgs, codexEnvVerdict, codexRegisterLine, startLine } from '../main/agent-connect'
import { AgentHost } from '../main/agent-host'
import { startAgentServer } from '../main/agent-server'

const base = (over: Partial<Facts> = {}): Facts => ({
  program: 'codexApp',
  running: true,
  error: null,
  registration: 'ok',
  codexKey: 'same',
  heard: { seen: [], refused: null },
  asked: true,
  ...over
})
const marks = (f: Facts): Record<string, string> => Object.fromEntries(checkRows(f).map((r) => [r.id, `${r.mark}:${r.say}`]))

test('all right: four ticks, every step done', () => {
  const f = base({ heard: { seen: [{ client: 'codex-mcp-client', at: 1000 }], refused: null } })
  assert.deepEqual(marks(f), { registered: 'ok:found', key: 'ok:ok', listening: 'ok:ok', connected: 'ok:ok' })
  assert.deepEqual(stepStates(f), ['ok', 'ok', 'ok', 'ok', 'ok'])
})

test('broken 1, access off: "not listening" with a way to turn it on; step 1 is the one to do', () => {
  const f = base({ running: false })
  const rows = checkRows(f)
  assert.deepEqual(marks(f).listening, 'bad:off')
  assert.deepEqual(rows.find((r) => r.id === 'listening')?.fix, { access: true })
  assert.equal(marks(f).connected, 'none:notYet', 'nothing to say of the agent while nothing listens')
  assert.deepEqual(stepStates(f), ['now', 'ok', 'todo', 'todo', 'todo'])
  assert.equal(marks(base({ running: false, error: 'port taken' })).listening, 'bad:error')
})

test('broken 2, no registration: "no registration: reconnect, or do step 2"; step 2 is the one to do', () => {
  const f = base({ registration: 'missing' })
  assert.equal(marks(f).registered, 'bad:missing')
  // (Codex and Claude Code have their own CLI: the row reconnects itself.)
  assert.deepEqual(checkRows(f)[0].fix, { repair: 'codex' })
  assert.equal(marks(f).connected, 'none:notYet', 'never connected is not the problem yet')
  assert.deepEqual(stepStates(f), ['ok', 'now', 'todo', 'todo', 'todo'])
  assert.equal(marks(base({ registration: 'stale' })).registered, 'bad:stale')
  assert.equal(marks(base({ registration: 'notInstalled' })).registered, 'bad:notInstalled')
  assert.equal(marks(base({ registration: 'unknown' })).registered, 'none:unknown')
})

test('broken 3, an old key: Codex\'s variable, Claude Code\'s header, or a 401 the server saw', () => {
  const codexOld = base({ codexKey: 'different' })
  assert.equal(marks(codexOld).key, 'bad:old')
  assert.deepEqual(checkRows(codexOld)[1].fix, { repair: 'codex' })
  assert.deepEqual(stepStates(codexOld), ['ok', 'now', 'todo', 'todo', 'todo'])
  const claudeOld = base({ program: 'claude', registration: 'oldKey', codexKey: null })
  assert.equal(marks(claudeOld).key, 'bad:old')
  assert.equal(marks(claudeOld).registered, 'ok:found', 'registered, at the right address')
  // (The reconnect runs step 2's line itself.)
  assert.deepEqual(checkRows(claudeOld)[1].fix, { repair: 'claude' })
  assert.deepEqual(stepStates(claudeOld), ['ok', 'now', 'todo', 'todo', 'todo'])
  assert.deepEqual(checkRows(base({ program: 'claude', registration: 'missing', codexKey: null }))[0].fix, { repair: 'claude' })
  // (OpenCode has no registration to read, so its row stays a copy; its
  // Reconnect button is in step 2.)
  assert.equal(marks(base({ codexKey: 'missing' })).key, 'bad:notSaved')
  assert.deepEqual(checkRows(base({ codexKey: 'missing' }))[1].fix, { repair: 'codex' })
  // A refused key, newer than the last good session: for any program.
  const r = base({ program: 'opencode', registration: null, codexKey: null, heard: { seen: [{ client: 'opencode', at: 100 }], refused: { why: 'key', at: 200 } } })
  assert.equal(marks(r).key, 'bad:refused')
  assert.equal(checkRows(r)[1].at, 200)
  // Codex's variable checked right after the refusal: history; checked before it: not.
  const c = base({ heard: { seen: [], refused: { why: 'key', at: 200 } } })
  assert.equal(marks({ ...c, checkedAt: 300 }).key, 'ok:ok')
  assert.equal(marks({ ...c, checkedAt: 100 }).key, 'bad:refused')
  // An older refusal is history: the agent connected since.
  assert.equal(marks({ ...r, heard: { seen: [{ client: 'opencode', at: 300 }], refused: { why: 'key', at: 200 } } }).key, 'ok:ok')
})

test('broken 4, the agent in an old window (404) or never connected', () => {
  const old = base({ heard: { seen: [], refused: { why: 'session', at: 500 } } })
  assert.equal(marks(old).connected, 'bad:oldWindow')
  assert.deepEqual(checkRows(old)[3].fix, { go: 3 })
  assert.deepEqual(stepStates(old), ['ok', 'ok', 'now', 'todo', 'todo'])
  // Never: a cross only once the rest is right and the user asked.
  assert.equal(marks(base()).connected, 'bad:never')
  assert.equal(marks(base({ asked: false })).connected, 'none:notYet')
  assert.equal(marks(base({ registration: 'missing' })).connected, 'none:notYet')
  // A refusal before another program connected is history (which program it was is not known).
  assert.equal(marks(base({ heard: { seen: [{ client: 'claude-code', at: 600 }], refused: { why: 'session', at: 500 } } })).connected, 'bad:never')
  // Another program connected: not this one.
  assert.equal(marks(base({ heard: { seen: [{ client: 'claude-code', at: 9 }], refused: null } })).connected, 'bad:never')
})

test('programs without a registration to read: a dash, done once the agent connects', () => {
  const f = base({ program: 'other', registration: null, codexKey: null })
  assert.equal(marks(f).registered, 'none:manual')
  assert.equal(marks(f).key, 'none:later')
  assert.deepEqual(stepStates(f), ['ok', 'now', 'todo', 'todo', 'todo'])
  const on = { ...f, heard: { seen: [{ client: 'antigravity', at: 5 }], refused: null } }
  assert.deepEqual(stepStates(on), ['ok', 'ok', 'ok', 'ok', 'ok'])
})

test('the client names, the first program shown, the time of day', () => {
  assert.deepEqual(['claude-code', 'codex-mcp-client', 'Codex Desktop', 'opencode', 'antigravity', 'x'].map(clientFamily), ['claude', 'codex', 'codex', 'opencode', 'other', 'other'])
  const cat = (ids: string[]): { id: 'claude' | 'codex' | 'opencode' | 'antigravity'; installed: boolean; version: null }[] => (['claude', 'codex', 'opencode', 'antigravity'] as const).map((id) => ({ id, installed: ids.includes(id), version: null }))
  assert.equal(defaultProgram('opencode', cat([]), null), 'opencode', 'remembered')
  assert.equal(defaultProgram('nonsense', cat(['claude', 'codex']), null), 'claude')
  assert.equal(defaultProgram(null, cat(['codex']), 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1_x64__2p\\app\\resources\\codex.exe'), 'codexApp')
  assert.equal(defaultProgram(null, cat(['codex']), 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd'), 'codexCli')
  assert.equal(defaultProgram(null, cat(['antigravity']), null), 'other')
  assert.equal(defaultProgram(null, null, null), 'claude')
  assert.match(timeOfDay(Date.UTC(2026, 10, 22, 14, 2)), /^\d\d:02$/)
})

test('the host keeps each program\'s last active session and the latest refusal (no key, no session id)', () => {
  let told = 0
  const host = new AgentHost({ userData: () => '.', port: 1, version: '1', name: 'snipp', forced: false, target: () => null, changed: () => { told++ } } as never)
  assert.deepEqual(host.heard(), { seen: [], refused: null })
  const a = host.open('codex-mcp-client')
  assert.deepEqual(host.heard().seen, [], 'opened only (a health check) is not connected')
  host.listed(a)
  assert.equal(host.heard().seen[0].client, 'codex-mcp-client')
  host.end(a)
  assert.equal(host.heard().seen.length, 1, 'kept after the session ended')
  host.refused('key', 10_000)
  host.refused('session', 10_500)
  assert.deepEqual(host.heard().refused, { why: 'session', at: 10_500 })
  const before = told
  host.refused('key', 10_600)
  assert.equal(told, before, 'at most one word a second')
  assert.equal(JSON.stringify(host.heard()).includes(a), false, 'no session id')
})

test('a refusal inside the quiet second is still told, once, when the second ends', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let told = 0
    const host = new AgentHost({ userData: () => '.', port: 1, version: '1', name: 'snipp', forced: false, target: () => null, changed: () => { told++ } } as never)
    host.refused('key', 50_000)
    assert.equal(told, 1)
    host.refused('session', 50_300)
    host.refused('session', 50_400)
    assert.equal(told, 1, 'not at once')
    assert.deepEqual(host.heard().refused, { why: 'session', at: 50_400 })
    mock.timers.tick(699)
    assert.equal(told, 1)
    mock.timers.tick(1)
    assert.equal(told, 2, 'the latest word, told when the second ends')
    mock.timers.tick(5_000)
    assert.equal(told, 2, 'and only once')
  } finally {
    mock.timers.reset()
  }
})

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

test('the server tells the host of a wrong key (401) and of a session it does not know (404)', async () => {
  const port = await freePort()
  const why: string[] = []
  const sessions = { open: () => 's1', has: (id: string) => id === 's1', end: () => undefined, fallback: () => 's1', sent: () => undefined, refused: (w: 'key' | 'session') => { why.push(w) } }
  const server = await startAgentServer({ port, token: 'k'.repeat(40), version: '1', sessions, call: async () => ({ content: [] }) as never })
  try {
    const post = (token: string, session?: string): Promise<Response> => fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(session ? { 'mcp-session-id': session } : {}) }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' })
    assert.equal((await post('x'.repeat(40))).status, 401)
    assert.equal((await post('k'.repeat(40), 'gone')).status, 404)
    assert.equal((await post('k'.repeat(40), 's1')).status, 200)
    assert.deepEqual(why, ['key', 'session'])
  } finally {
    await server.close()
  }
})

test('Codex\'s key: compared inside PowerShell, one word out, no value on the command line', () => {
  const file = 'C:\\Users\\o\'n\\AppData\\Roaming\\Snipp Dev\\agent.json'
  const args = codexEnvQueryArgs('snippstudio-dev', file)
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command'])
  assert.match(args[3], /GetEnvironmentVariable\('SNIPPSTUDIO_DEV_TOKEN', 'User'\)/)
  assert.ok(args[3].includes("'C:\\Users\\o''n\\AppData\\Roaming\\Snipp Dev\\agent.json'"), 'the file, quoted for PowerShell')
  assert.match(codexEnvQueryArgs('snippstudio', file, 'Process')[3], /'Process'\)/)
  assert.equal(codexEnvVerdict('Same\r\n'), 'same')
  assert.equal(codexEnvVerdict('Different'), 'different')
  assert.equal(codexEnvVerdict('Missing'), 'missing')
  assert.equal(codexEnvVerdict('kkkk'), 'unknown')
  assert.equal(codexEnvVerdict(null), 'unknown')
})

test('the comparison, run by PowerShell: same, different, missing', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wiz o'neil "))
  try {
    const file = path.join(dir, 'agent.json')
    const token = 'T'.repeat(43)
    writeFileSync(file, JSON.stringify({ enabled: true, token }))
    const run = (value: string | undefined): string => {
      const env: Record<string, string> = { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', PATH: process.env.PATH ?? '' }
      if (value !== undefined) env.SNIPPSTUDIO_DEV_TOKEN = value
      return execFileSync('powershell.exe', codexEnvQueryArgs('snippstudio-dev', file, 'Process'), { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 }).trim()
    }
    assert.equal(run(token), 'Same')
    assert.equal(run(token.toLowerCase()), 'Different', 'case counts')
    assert.equal(run('x'), 'Different')
    assert.equal(run(undefined), 'Missing')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the lines the steps copy: Codex\'s one line, the start lines', () => {
  const file = 'C:\\p\\agent.json'
  const url = 'http://127.0.0.1:47811/mcp'
  const win = codexRegisterLine(file, url, 'snippstudio-dev', 'win32', 'C:\\npm\\codex.cmd')
  assert.ok(win.startsWith("[Environment]::SetEnvironmentVariable('SNIPPSTUDIO_DEV_TOKEN', (Get-Content -LiteralPath 'C:\\p\\agent.json' -Raw | ConvertFrom-Json).token, 'User'); "), win)
  assert.ok(win.endsWith("& 'C:\\npm\\codex.cmd' mcp add snippstudio-dev --url 'http://127.0.0.1:47811/mcp' --bearer-token-env-var SNIPPSTUDIO_DEV_TOKEN"), win)
  assert.equal(codexRegisterLine('/h/agent.json', url, 'snippstudio', 'linux'), "codex mcp remove snippstudio >/dev/null 2>&1; codex mcp add snippstudio --url 'http://127.0.0.1:47811/mcp' --bearer-token-env-var SNIPPSTUDIO_TOKEN")
  assert.equal(startLine('$env:X = 1', 'opencode', 'win32', 'C:\\npm\\opencode.cmd'), "$env:NoDefaultCurrentDirectoryInExePath = '1'; $env:X = 1; & 'C:\\npm\\opencode.cmd'")
  assert.equal(startLine('export X=1', 'codex', 'darwin'), 'export X=1; codex')
  assert.throws(() => startLine('x', 'rm -rf', 'linux'), RangeError)
})

test('the Check button is off for the whole of a check, not only while the registration is read', () => {
  assert.equal(checkButtonBusy(null, false), false)
  assert.equal(checkButtonBusy('missing', false), false)
  assert.equal(checkButtonBusy('checking', false), true)
  // A check under way whose registration is not asked yet (the session read
  // first): the button already says so.
  assert.equal(checkButtonBusy(null, true), true)
  assert.equal(checkButtonBusy('missing', true), true)
})
