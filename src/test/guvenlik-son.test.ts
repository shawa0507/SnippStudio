// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The final security audit (23 Nov 2026, haritalar/_guvenlik-son-rapor.md).
// G1: PowerShell reads the typographic single quotes (U+2018 to U+201B) as a
// quote. The lines the connection wizard copies and the app's own key check
// put the profile's path inside '…'; a path holding ’ (a user folder named
// O’Brien) ended the string there: the line broke, and a crafted path ran
// its own command. Run here by Windows' own PowerShell.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { antigravityPrintLine, antigravityRegisterLine, claudeAddLine, codexEnvQueryArgs, codexPersistLine, codexRegisterLine, openCodeRegisterLine, psq, startLine, tokenSetupLine } from '../main/agent-connect'
import { codexTokenEnv } from '../shared/product'

const Q = ['\u2018', '\u2019', '\u201A', '\u201B']

test('psq doubles every quote PowerShell knows, and only those', () => {
  assert.equal(psq("a'b"), "'a''b'")
  for (const q of Q) assert.equal(psq(`O${q}Brien`), `'O${q}${q}Brien'`)
  // (Double quotes need nothing inside a single-quoted string.)
  assert.equal(psq('a"b\u201Cc'), "'a\"b\u201Cc'")
})

test('every line built for Windows quotes the path with psq', () => {
  const file = `C:\\Users\\O\u2019Brien\\AppData\\Roaming\\SnippStudio\\agent.json`
  const quoted = psq(file)
  const url = 'http://127.0.0.1:47811/mcp'
  const lines = [
    claudeAddLine(file, url, 'snippstudio', 'win32'),
    codexPersistLine(file, 'snippstudio', 'win32')!,
    codexRegisterLine(file, url, 'snippstudio', 'win32'),
    openCodeRegisterLine(file, url, 'snippstudio', 'win32'),
    antigravityPrintLine(file, url, 'win32'),
    antigravityRegisterLine(file, url, 'snippstudio', 'win32'),
    tokenSetupLine(file, 'win32'),
    startLine(tokenSetupLine(file, 'win32'), 'opencode', 'win32', `C:\\Users\\O\u2019Brien\\bin\\opencode.cmd`),
    codexEnvQueryArgs('snippstudio', file).at(-1)!
  ]
  for (const l of lines) {
    assert.ok(l.includes(quoted), l)
    assert.equal(l.includes(`'${file}'`), false, l)
  }
})

test('the OpenCode reconnect: its config entry updated in place, the key only in the environment', () => {
  const line = openCodeRegisterLine('C:\\p\\agent.json', 'http://127.0.0.1:47810/mcp', 'snippstudio', 'win32', 'C:\\Program Files\\opencode\\opencode.cmd')
  assert.match(line, /SetEnvironmentVariable\('SNIPP_MCP_TOKEN'/)
  assert.match(line, /mcp add snippstudio --url 'http:\/\/127\.0\.0\.1:47810\/mcp' --header 'Authorization=Bearer \{env:SNIPP_MCP_TOKEN\}' --global/)
  assert.ok(line.includes('& \'C:\\Program Files\\opencode\\opencode.cmd\''))
  // (The line never holds a key: it reads the profile's file itself.)
  assert.equal(/Bearer [A-Za-z0-9_-]{20,}/.test(line), false)
})

test('PowerShell: a profile path holding typographic quotes is read as a path, never run', { skip: process.platform !== 'win32' }, () => {
  const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const root = mkdtempSync(path.join(tmpdir(), 'g1-'))
  try {
    for (const q of Q) {
      // A folder name that, unquoted right, ends the string and runs a command.
      const dir = path.join(root, `a${q}; Set-Content -LiteralPath ran.txt -Value x; ${q}b`)
      mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'agent.json')
      const token = 'T' + 'k'.repeat(40)
      writeFileSync(file, JSON.stringify({ enabled: true, token }))
      const name = 'snippstudio-dev'
      const env = { ...process.env, [codexTokenEnv(name)]: token }
      const run = (args: string[]): string => execFileSync(ps, args, { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 60_000 }).trim()
      // The app's own check: one word, Same.
      assert.equal(run(codexEnvQueryArgs(name, file, 'Process')), 'Same', `quote ${q.codePointAt(0)!.toString(16)}`)
      // A copied line: it reads the key from that file.
      assert.equal(run(['-NoProfile', '-NonInteractive', '-Command', `${tokenSetupLine(file, 'win32', 'G1_TOKEN')}; Write-Output $env:G1_TOKEN`]), token)
      assert.equal(existsSync(path.join(root, 'ran.txt')), false, 'a command of the path ran')
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// G2: the install lines the Settings window copies are run by the user as
// they are. Each names the maker's own package or script; a change here is
// made on purpose, after reading the maker's page (never a guessed name: the
// OpenCode line named `@opencode/cli`, a package OpenCode does not publish).
test('the install lines name each maker\'s own package', async () => {
  const { SETUP } = await import('../renderer/src/components/settings/agents')
  assert.deepEqual(Object.fromEntries(Object.entries(SETUP).map(([k, v]) => [k, v.command])), {
    claude: 'winget install Anthropic.ClaudeCode',
    codex: 'npm i -g @openai/codex',
    opencode: 'npm install -g opencode-ai',
    antigravity: 'irm https://antigravity.google/cli/install.ps1 | iex'
  })
  for (const v of Object.values(SETUP)) assert.match(v.url, /^https:\/\/(code\.claude\.com|developers\.openai\.com|opencode\.ai|antigravity\.google)\//)
})
