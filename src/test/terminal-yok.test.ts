// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// No embedded terminal, one Settings window (SnippStudio TERMINAL-YOK-PLAN.md,
// 21 Nov 2026): the Codex line (checked against `codex mcp add --help`) and
// what its check reads, the line run by a real PowerShell against a stand-in
// `codex`, the Help and About files, the spoken language of new projects,
// the Settings shortcut, and that nothing of the terminal is left in the
// sources, the package or the bridge.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { codexAddLine, codexEnvLine, codexRegistrationState, tokenSetupLine } from '../main/agent-connect'
import { besideProgram, helpFileName } from '../main/help-files'
import { agentPortFor } from '../main/channel'
import { codexTokenEnv, registeredServerName } from '../shared/product'
import { withSpokenDefault } from '../renderer/src/subtitles/spoken-default'
import { defaultProject } from '../renderer/src/types'
import { ACTIONS, defaultBindings } from '../renderer/src/shortcuts'

const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')
const urlOf = (channel: 'dev' | 'release'): string => `http://127.0.0.1:${agentPortFor(channel)}/mcp`
const TOKEN = 'a'.repeat(48)

// ---- Codex ------------------------------------------------------------------

test('each copy has its own Codex variable: SNIPPSTUDIO_TOKEN, SNIPPSTUDIO_DEV_TOKEN', () => {
  assert.equal(codexTokenEnv(registeredServerName('release')), 'SNIPPSTUDIO_TOKEN')
  assert.equal(codexTokenEnv(registeredServerName('dev')), 'SNIPPSTUDIO_DEV_TOKEN')
})

test('the Codex line: remove quietly, then mcp add <name> --url <url> --bearer-token-env-var <VAR>; no key in it', () => {
  const win = codexAddLine(urlOf('dev'), 'snippstudio-dev', 'win32', 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd')
  assert.equal(win, "$env:NoDefaultCurrentDirectoryInExePath = '1'; & 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd' mcp remove snippstudio-dev *> $null; & 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd' mcp add snippstudio-dev --url 'http://127.0.0.1:47811/mcp' --bearer-token-env-var SNIPPSTUDIO_DEV_TOKEN")
  // (Not installed: a bare codex.)
  assert.match(codexAddLine(urlOf('release'), 'snippstudio', 'win32'), /; codex mcp add snippstudio --url 'http:\/\/127\.0\.0\.1:47810\/mcp' --bearer-token-env-var SNIPPSTUDIO_TOKEN$/)
  assert.equal(codexAddLine(urlOf('release'), 'snippstudio', 'linux', "/home/o'n/.npm-global/bin/codex"), "'/home/o'\\''n/.npm-global/bin/codex' mcp remove snippstudio >/dev/null 2>&1; '/home/o'\\''n/.npm-global/bin/codex' mcp add snippstudio --url 'http://127.0.0.1:47810/mcp' --bearer-token-env-var SNIPPSTUDIO_TOKEN")
  assert.throws(() => codexAddLine(urlOf('dev'), 'x; rm -rf /', 'linux'), RangeError)
  // The key line: the variable set from the profile's file, in the user's shell.
  assert.equal(codexEnvLine('C:\\p\\agent.json', 'snippstudio-dev', 'win32'), "$env:SNIPPSTUDIO_DEV_TOKEN = (Get-Content -LiteralPath 'C:\\p\\agent.json' -Raw | ConvertFrom-Json).token")
  assert.match(codexEnvLine('/home/u/.config/SnippStudio/agent.json', 'snippstudio', 'darwin'), /^export SNIPPSTUDIO_TOKEN="\$\(sed -n /)
  assert.throws(() => tokenSetupLine('x', 'win32', 'A; Remove-Item'), RangeError)
})

test('the Codex check reads `codex mcp get <name> --json`: added, not added, another address or variable', () => {
  const want = { url: urlOf('dev'), env: 'SNIPPSTUDIO_DEV_TOKEN' }
  const entry = (transport: Record<string, unknown>): { code: number; output: string } => ({ code: 0, output: JSON.stringify({ name: 'snippstudio-dev', enabled: true, transport }) })
  assert.equal(codexRegistrationState(entry({ type: 'streamable_http', url: want.url, bearer_token_env_var: want.env }), want), 'ok')
  assert.equal(codexRegistrationState({ code: 1, output: "Error: No MCP server named 'snippstudio-dev' found." }, want), 'missing')
  assert.equal(codexRegistrationState(entry({ type: 'streamable_http', url: urlOf('release'), bearer_token_env_var: want.env }), want), 'stale')
  assert.equal(codexRegistrationState(entry({ type: 'streamable_http', url: want.url, bearer_token_env_var: 'SNIPP_MCP_TOKEN' }), want), 'stale')
  assert.equal(codexRegistrationState(entry({ type: 'streamable_http', url: want.url }), want), 'stale')
  assert.equal(codexRegistrationState(entry({ type: 'stdio', command: 'node', args: [] }), want), 'stale')
  assert.equal(codexRegistrationState(null, want), 'unknown')
  assert.equal(codexRegistrationState({ code: 0, output: 'not json' }, want), 'unknown')
  assert.equal(codexRegistrationState({ code: 2, output: 'error: unexpected argument' }, want), 'unknown')
})

test('the Codex lines, run by PowerShell, hand codex exactly these arguments and set the variable from the file', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex o'neil "))
  try {
    const log = path.join(dir, 'calls.jsonl')
    const js = path.join(dir, 'log.js')
    writeFileSync(js, `require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + String.fromCharCode(10))`)
    const cmd = path.join(dir, 'codex.cmd')
    writeFileSync(cmd, `@"${process.execPath}" "%~dp0log.js" %*` + String.fromCharCode(13, 10))
    const file = path.join(dir, 'agent.json')
    writeFileSync(file, JSON.stringify({ enabled: true, token: TOKEN }))
    const add = codexAddLine(urlOf('dev'), 'snippstudio-dev', 'win32', cmd)
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', add], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
    assert.equal(r.status, 0, r.stderr)
    const calls = readFileSync(log, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l) as string[])
    assert.deepEqual(calls, [
      ['mcp', 'remove', 'snippstudio-dev'],
      ['mcp', 'add', 'snippstudio-dev', '--url', 'http://127.0.0.1:47811/mcp', '--bearer-token-env-var', 'SNIPPSTUDIO_DEV_TOKEN']
    ])
    const env = codexEnvLine(file, 'snippstudio-dev', 'win32')
    assert.equal(env.includes(TOKEN), false)
    const e = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${env}; [Console]::Out.Write($env:SNIPPSTUDIO_DEV_TOKEN.Length)`], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
    assert.equal(e.status, 0, e.stderr)
    assert.equal(e.stdout.trim(), String(TOKEN.length))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- Help and About, General, the shortcut ---------------------------------------

test('Help and About open fixed files beside the program, in the window\'s language', () => {
  assert.equal(helpFileName('guide', 'tr', true), path.join('docs', 'kullanim.md'))
  assert.equal(helpFileName('guide', 'en', true), path.join('docs', 'guide.md'))
  assert.equal(helpFileName('agents', 'tr', false), path.join('docs', 'ajanlar.md'))
  assert.equal(helpFileName('license', 'en', true), 'LICENSE.txt')
  assert.equal(helpFileName('license', 'en', false), 'LICENSE')
  assert.equal(besideProgram(false, 'x', '/repo'), '/repo')
  assert.equal(besideProgram(true, path.join('C:', 'Program Files', 'SnippStudio', 'SnippStudio.exe'), '/x', 'win32'), path.join('C:', 'Program Files', 'SnippStudio'))
  assert.equal(besideProgram(true, path.join('/A', 'SnippStudio.app', 'Contents', 'MacOS', 'SnippStudio'), '/x', 'darwin'), path.join('/A', 'SnippStudio.app', 'Contents'))
  // Every file a source build opens is in the repository; the package carries docs/.
  for (const which of ['guide', 'agents', 'license', 'notices', 'licenses'] as const) {
    for (const lang of ['en', 'tr'] as const) assert.ok(existsSync(path.join(ROOT, helpFileName(which, lang, false))), `${which} ${lang}`)
  }
  assert.match(readFileSync(path.join(ROOT, 'electron-builder.config.cjs'), 'utf8'), /\{ from: 'docs', to: 'docs'/)
})

test('the spoken language of new projects: as the interface by default, else the one chosen', () => {
  const tr = defaultProject('16:9', 'tr')
  assert.equal(withSpokenDefault(tr, 'follow'), tr)
  assert.equal(withSpokenDefault(tr, 'german').transcription?.language, 'german')
  assert.equal(withSpokenDefault(defaultProject('9:16', 'en'), 'turkish').transcription?.language, 'turkish')
  // (Read where there is no browser storage: the default.)
  assert.equal(withSpokenDefault(tr), tr)
})

test('Ctrl+, opens the settings (⌘, on a Mac) and takes no other action\'s key', () => {
  const b = defaultBindings()
  assert.equal(b.settings, 'ctrl+,')
  assert.equal(ACTIONS.filter((a) => a.default === 'ctrl+,').length, 1)
  const app = readFileSync(path.join(SRC, 'renderer', 'src', 'App.tsx'), 'utf8')
  assert.match(app, /case b\.settings:\s*return run\(\(\) => openSettings\(\)\)/)
})

// ---- nothing of the terminal is left -------------------------------------------

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

test('no embedded terminal: no node-pty or xterm in the package, the sources or the bridge', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
  for (const name of ['node-pty', '@xterm/xterm', '@xterm/addon-fit']) {
    assert.equal(name in pkg.dependencies || name in pkg.devDependencies, false, name)
  }
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> }
  for (const key of Object.keys(lock.packages)) assert.equal(/node_modules\/(node-pty|@xterm\/)/.test(key), false, `the lock still has ${key}`)
  assert.equal(/node-pty|conpty/i.test(readFileSync(path.join(ROOT, 'electron-builder.config.cjs'), 'utf8')), false, 'electron-builder.config.cjs')
  // The in-app chat (AGENT-CHAT-PLAN.md) is the one user of the CLI's own
  // --mcp-config: it starts Claude Code for the Chat tab, not a terminal.
  const chatCli = path.join(SRC, 'main', 'agent-chat.ts')
  for (const f of walk(SRC).filter((x) => /\.(ts|tsx|css)$/.test(x) && !x.includes(`${path.sep}test${path.sep}`))) {
    const s = readFileSync(f, 'utf8')
    assert.equal(/node-pty|@xterm|\bIPty\b|useConptyDll|agentTerm:|openSystemTerminal|TerminalView/.test(s), false, path.relative(SRC, f))
    if (f !== chatCli) assert.equal(s.includes('--mcp-config'), false, path.relative(SRC, f))
  }
  const preload = readFileSync(path.join(SRC, 'preload', 'index.ts'), 'utf8')
  const bridge = preload.slice(preload.indexOf('  agentSession: {'), preload.indexOf('\n  },', preload.indexOf('  agentSession: {')))
  for (const gone of ['send:', 'input:', 'resize:', 'output:', 'start:', 'stop:', 'openSystem', 'prepareFallback']) assert.equal(bridge.includes(gone), false, `preload agentSession: ${gone}`)
  for (const gone of ['recipes', 'agentTerm:']) assert.equal(preload.includes(gone), false, `preload: ${gone}`)
})
