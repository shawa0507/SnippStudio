// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Adding the app to Claude Code once (SnippStudio DIS-MCP-PLAN.md): the line
// the user runs (three platforms, two copies, quoting), what the check reads
// out of `claude mcp get`, and the line itself run by a real PowerShell / sh
// against a stand-in `claude` that only writes down its arguments.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createServer } from 'node:net'
import { AgentHost, EXTERNAL_QUIET_MS } from '../main/agent-host'
import { claudeAddLine, registrationState } from '../main/agent-connect'
import { agentPortFor } from '../main/channel'
import { registeredServerName } from '../shared/product'

const urlOf = (channel: 'dev' | 'release'): string => `http://127.0.0.1:${agentPortFor(channel)}/mcp`

test('each copy has its own name and port: release snippstudio 47810, dev snippstudio-dev 47811', () => {
  assert.equal(registeredServerName('release'), 'snippstudio')
  assert.equal(registeredServerName('dev'), 'snippstudio-dev')
  assert.equal(urlOf('release'), 'http://127.0.0.1:47810/mcp')
  assert.equal(urlOf('dev'), 'http://127.0.0.1:47811/mcp')
})

test('Windows: one PowerShell line; the key is read from the profile file, never written in it', () => {
  for (const channel of ['release', 'dev'] as const) {
    const name = registeredServerName(channel)
    const file = `C:\\Users\\a\\AppData\\Roaming\\SnippStudio${channel === 'dev' ? ' Dev' : ''}\\agent.json`
    const line = claudeAddLine(file, urlOf(channel), name, 'win32', 'C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd')
    assert.equal(line, [
      "$env:NoDefaultCurrentDirectoryInExePath = '1'",
      `$k = (Get-Content -LiteralPath '${file}' -Raw | ConvertFrom-Json).token`,
      `if ($k) { & 'C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd' mcp remove --scope user ${name} *> $null; & 'C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd' mcp add --transport http --scope user ${name} '${urlOf(channel)}' --header "Authorization: Bearer $k" }`
    ].join('; '))
    // --header takes many values: it is the last option, after the name and the address.
    assert.ok(line.indexOf('--header') > line.indexOf(urlOf(channel)))
    assert.equal(line.includes('\n'), false)
  }
  // Not found: a bare claude. A quote in a path is doubled for PowerShell.
  const bare = claudeAddLine("C:\\Users\\o'neil\\SnippStudio\\agent.json", urlOf('release'), 'snippstudio', 'win32')
  assert.ok(bare.includes("-LiteralPath 'C:\\Users\\o''neil\\SnippStudio\\agent.json'"), bare)
  assert.ok(bare.includes('{ claude mcp remove --scope user snippstudio *> $null; claude mcp add '), bare)
  // A relative program path is never used.
  assert.ok(claudeAddLine('C:\\p\\agent.json', urlOf('dev'), 'snippstudio-dev', 'win32', 'claude.cmd').includes('{ claude mcp remove'))
})

test('macOS and Linux: sh; the key read by sed from the profile file', () => {
  for (const platform of ['darwin', 'linux']) {
    for (const channel of ['release', 'dev'] as const) {
      const name = registeredServerName(channel)
      const file = "/Users/o'neil/Library/Application Support/SnippStudio/agent.json"
      const line = claudeAddLine(file, urlOf(channel), name, platform, '/opt/homebrew/bin/claude')
      assert.equal(line, [
        `k="$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' '/Users/o'\\''neil/Library/Application Support/SnippStudio/agent.json')"`,
        `if [ -n "$k" ]; then '/opt/homebrew/bin/claude' mcp remove --scope user ${name} >/dev/null 2>&1; '/opt/homebrew/bin/claude' mcp add --transport http --scope user ${name} '${urlOf(channel)}' --header "Authorization: Bearer $k"; fi`
      ].join('; '))
      assert.equal(/\$env:|Get-Content/.test(line), false)
    }
  }
  assert.ok(claudeAddLine('/a/agent.json', urlOf('release'), 'snippstudio', 'linux').includes('then claude mcp remove'))
})

test('only a plain server name goes into the line', () => {
  for (const bad of ['', 'Snipp Studio', 'x;rm', "a'b", '-x', 'a$b']) assert.throws(() => claudeAddLine('C:\\a.json', urlOf('dev'), bad, 'win32'), RangeError, bad || 'empty')
})

const TOKEN = 'k'.repeat(43)
const want = { url: urlOf('release'), token: TOKEN, serverOn: true }
const GOT = (lines: string[]): { code: number; output: string } => ({ code: 0, output: lines.join('\n') + '\n' })
const OK = [
  'snippstudio:',
  '  Scope: User config (available in all your projects)',
  '  Status: ✔ Connected',
  '  Type: http',
  '  URL: http://127.0.0.1:47810/mcp',
  '  Headers:',
  `    Authorization: Bearer ${TOKEN}`,
  '',
  'To remove this server, run: claude mcp remove snippstudio -s user'
]

test('the check reads `claude mcp get`: there, not there, an old key, another address', () => {
  assert.equal(registrationState(GOT(OK), want), 'ok')
  assert.equal(registrationState({ code: 0, output: GOT(OK).output.replace(/\n/g, '\r\n') }, want), 'ok')
  assert.equal(registrationState({ code: 1, output: 'No MCP server named "snippstudio". Configured servers: videohub\n' }, want), 'missing')
  assert.equal(registrationState(GOT(OK.map((l) => l.replace(TOKEN, 'x'.repeat(43)))), want), 'oldKey', 'another key')
  assert.equal(registrationState(GOT(OK.map((l) => l.replace('47810', '47811'))), want), 'stale', 'another port')
  assert.equal(registrationState(GOT(OK.map((l) => l.replace('Type: http', 'Type: stdio'))), want), 'stale')
  // Headers not shown (or masked): the server's answer decides.
  const hidden = OK.filter((l) => !l.includes('Authorization'))
  assert.equal(registrationState(GOT(hidden), want), 'ok')
  assert.equal(registrationState(GOT(OK.map((l) => l.replace(TOKEN, '***'))), want), 'ok')
  const refused = hidden.map((l) => l.replace('✔ Connected', '! Needs authentication'))
  assert.equal(registrationState(GOT(refused), want), 'oldKey')
  assert.equal(registrationState(GOT(refused), { ...want, serverOn: false }), 'ok', 'server off: nothing to say about the key')
  // Failed to connect while access is off: still registered.
  assert.equal(registrationState(GOT(OK.map((l) => l.replace('✔ Connected', '✘ Failed to connect'))), { ...want, serverOn: false }), 'ok')
  // Did not run, timed out, or said something else.
  assert.equal(registrationState(null, want), 'unknown')
  assert.equal(registrationState({ code: null, output: '' }, want), 'unknown')
  assert.equal(registrationState({ code: 2, output: 'error: unknown command' }, want), 'unknown')
  assert.equal(registrationState({ code: 0, output: 'hello' }, want), 'unknown')
  // Colours in the output are no obstacle.
  assert.equal(registrationState({ code: 0, output: GOT(OK).output.replace('✔ Connected', '\x1b[32m✔ Connected\x1b[39m') }, want), 'ok')
})

/** A stand-in claude: writes each call's arguments down as a JSON line. */
function standIn(dir: string): { cmd: string; sh: string; calls: () => string[][] } {
  const log = path.join(dir, 'calls.jsonl')
  const js = path.join(dir, 'log.js')
  writeFileSync(js, `require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n')\n`)
  const cmd = path.join(dir, 'claude.cmd')
  writeFileSync(cmd, `@"${process.execPath}" "%~dp0log.js" %*\r\n`)
  const sh = path.join(dir, 'claude')
  writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, '/')}" "${js.replace(/\\/g, '/')}" "$@"\n`, { mode: 0o755 })
  return { cmd, sh, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]) : []) }
}

test('the Windows line, run by PowerShell, hands claude exactly these arguments (key from the file, a path with a quote and a space)', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dis mcp o'neil "))
  try {
    const fake = standIn(dir)
    const file = path.join(dir, 'agent.json')
    writeFileSync(file, JSON.stringify({ enabled: true, token: TOKEN }))
    const line = claudeAddLine(file, urlOf('dev'), 'snippstudio-dev', 'win32', fake.cmd)
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', line], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(fake.calls(), [
      ['mcp', 'remove', '--scope', 'user', 'snippstudio-dev'],
      ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'snippstudio-dev', 'http://127.0.0.1:47811/mcp', '--header', `Authorization: Bearer ${TOKEN}`]
    ])
    assert.equal(line.includes(TOKEN), false)
    assert.equal(r.stdout.includes(TOKEN), false, 'the key is not printed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const hasSh = (): boolean => {
  try {
    return spawnSync('sh', ['-c', 'exit 0'], { timeout: 10_000, windowsHide: true }).status === 0
  } catch {
    return false
  }
}

test('the sh line, run by sh, hands claude exactly these arguments', { skip: !hasSh() }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dis mcp sh o'neil "))
  try {
    const fake = standIn(dir)
    const file = path.join(dir, 'agent.json')
    writeFileSync(file, JSON.stringify({ enabled: true, token: TOKEN }, null, 2))
    const posix = (p: string): string => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, '/') : p)
    const line = claudeAddLine(posix(file), urlOf('release'), 'snippstudio', 'linux', posix(fake.sh))
    const r = spawnSync('sh', ['-c', line], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(fake.calls(), [
      ['mcp', 'remove', '--scope', 'user', 'snippstudio'],
      ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'snippstudio', 'http://127.0.0.1:47810/mcp', '--header', `Authorization: Bearer ${TOKEN}`]
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- the host: an agent from outside, a new key ----------------------------

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

async function rpc(port: number, token: string, method: string, session?: string): Promise<{ status: number; session: string | null }> {
  const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, ...(session ? { 'Mcp-Session-Id': session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '9' } } : {} })
  })
  await r.text()
  return { status: r.status, session: r.headers.get('mcp-session-id') }
}

test('an agent from outside is "connected" once it asks for the tools; a bare health check is not', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dis-mcp-host-'))
  const port = await freePort()
  let changed = 0
  const host = new AgentHost({ userData: () => dir, port, version: '1', name: 'snipp-dev', forced: false, target: () => null, changed: () => changed++ })
  try {
    await host.setEnabled(true)
    const key = await host.key()
    assert.equal(key.url, `http://127.0.0.1:${port}/mcp`)
    assert.equal(key.running, true)
    // `claude mcp get` connects: initialize only.
    const check = await rpc(port, key.token, 'initialize')
    assert.equal(check.status, 200)
    assert.equal(host.external(), null)
    assert.equal(changed, 0)
    // An agent at work asks for the tools.
    const agent = await rpc(port, key.token, 'initialize')
    assert.equal((await rpc(port, key.token, 'tools/list', agent.session!)).status, 200)
    assert.equal(host.external()?.client, 'claude-code')
    assert.equal(changed, 1)
    // Quiet for longer than EXTERNAL_QUIET_MS: no longer said to be connected.
    assert.equal(host.external(Date.now() + EXTERNAL_QUIET_MS + 1000), null)
    // It says goodbye: gone, and the windows are told.
    await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'DELETE', headers: { Authorization: `Bearer ${key.token}`, 'Mcp-Session-Id': agent.session! } })
    assert.equal(host.external(), null)
    assert.equal(changed, 2)
  } finally {
    await host.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a new key: written to the profile, the server starts again with it, the old one keeps a short grace', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dis-mcp-key-'))
  const port = await freePort()
  const host = new AgentHost({ userData: () => dir, port, version: '1', name: 'snipp-dev', forced: false, target: () => null })
  try {
    await host.setEnabled(true)
    const old = (await host.key()).token
    const agent = await rpc(port, old, 'initialize')
    await rpc(port, old, 'tools/list', agent.session!)
    assert.ok(host.external())
    const st = await host.renewKey()
    assert.equal(st.running, true)
    assert.equal(JSON.stringify(st).includes(old), false)
    const fresh = (await host.key()).token
    assert.notEqual(fresh, old)
    const saved = JSON.parse(readFileSync(path.join(dir, 'agent.json'), 'utf8')) as { token: string; enabled: boolean; previous?: string; previousUntil?: number }
    assert.equal(saved.token, fresh)
    assert.equal(saved.previous, old)
    assert.ok((saved.previousUntil ?? 0) > Date.now(), 'the key before the renew has its grace window')
    assert.equal(host.external(), null, 'every session ended')
    // (An agent its turn away does not have to be re-registered that
    // second: the key before still opens the door while the grace lasts.)
    assert.equal((await rpc(port, old, 'initialize')).status, 200)
    assert.equal((await rpc(port, fresh, 'initialize')).status, 200)
    // Access off: a new key all the same, nothing listens.
    await host.setEnabled(false)
    const st2 = await host.renewKey()
    assert.equal(st2.running, false)
    assert.notEqual((await host.key()).token, fresh)
  } finally {
    await host.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a refused key asks for a repair of the detected agents; a refused session does not', () => {
  let asked = 0
  const host = new AgentHost({ userData: () => '.', port: 1, version: '1', name: 'snipp', forced: false, target: () => null, keyRefused: () => asked++ })
  host.refused('key')
  host.refused('key')
  assert.equal(asked, 2)
  host.refused('session')
  assert.equal(asked, 2, 'an old window is not a key problem')
})

test('auto-repair is on by default, and its switch is kept in the profile', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dis-mcp-auto-'))
  try {
    const one = new AgentHost({ userData: () => dir, port: 1, version: '1', name: 'snipp', forced: false, target: () => null })
    assert.equal(await one.autoRepairOn(), true)
    assert.equal(await one.setAutoRepair(false), false)
    const two = new AgentHost({ userData: () => dir, port: 1, version: '1', name: 'snipp', forced: false, target: () => null })
    assert.equal(await two.autoRepairOn(), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
