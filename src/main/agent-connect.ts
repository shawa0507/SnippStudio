// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// How an agent outside the app connects to its agent server (SnippStudio
// TERMINAL-YOK-PLAN.md; before it, phase 4B.1's embedded session, removed on
// the user's decision of 21 Nov 2026): the agent programs installed, their
// versions, and the lines the USER runs in a terminal of their own to add
// this copy to Claude Code or Codex once (or the parts for OpenCode and
// Antigravity). The app never starts an agent and never writes an agent's
// settings; the key never reaches the page or the clipboard: every line reads
// it from the profile's own file in the user's shell.
//
// The only processes started here are read-only questions to an installed
// agent program (its version; `mcp get`), each ended with its whole process
// tree when its window closes or the app quits (taskkill /T on our own
// child's pid; never a process by its name).
import { spawnSync, spawn as spawnChild } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'
import { systemTool, systemToolCwd } from './system-tool'
import { codexTokenEnv } from '../shared/product'

export { codexTokenEnv }

export const AGENT_IDS = ['claude', 'codex', 'opencode', 'antigravity'] as const
export type AgentId = typeof AGENT_IDS[number]
export type AgentKind = AgentId | 'test'

/** The program's file name, without its extension (Antigravity's CLI is
 *  `agy`: antigravity.google/docs/getting-started, CLI tab, read 20 Nov 2026). */
const PROGRAM: Record<AgentId, string> = { claude: 'claude', codex: 'codex', opencode: 'opencode', antigravity: 'agy' }

/** The server's name in the parts the user merges by hand (OpenCode,
 *  Antigravity), and the variable OpenCode's part reads the key from. */
const MANUAL_SERVER = 'snippstudio'
const TOKEN_ENV = 'SNIPP_MCP_TOKEN'
/** The variable OpenCode's config reads its header from. */
export const openCodeTokenEnv = (): string => TOKEN_ENV

export interface AgentFound {
  id: AgentKind
  /** The program's file (or, for a test agent, the program and its args). */
  path: string
  args?: string[]
}

/** Where an agent program may be, besides PATH: the install places of each
 *  platform (Windows as before phase 10; macOS and Linux since 10b.4: an app
 *  started from Finder or a desktop menu gets a short PATH, without Homebrew
 *  or the user's own bin folders). */
export function knownDirs(env: Record<string, string | undefined>, platform: string = process.platform): string[] {
  if (platform !== 'win32') return posixKnownDirs(env, platform)
  const home = env.USERPROFILE ?? env.HOME ?? ''
  const out: string[] = []
  if (env.APPDATA) out.push(path.join(env.APPDATA, 'npm'))
  if (home) out.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.codex', 'bin'))
  if (home) out.push(path.join(home, '.opencode', 'bin'), path.join(home, 'scoop', 'shims'))
  if (env.LOCALAPPDATA) out.push(path.join(env.LOCALAPPDATA, 'Programs', 'claude'), path.join(env.LOCALAPPDATA, 'Programs', 'codex'), path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'), path.join(env.LOCALAPPDATA, 'agy', 'bin'))
  return out
}

/** The Codex desktop app (a Microsoft Store package) carries its own
 *  `codex.exe` in `…\WindowsApps\OpenAI.Codex_<version>…\app\resources`,
 *  not in PATH (DENEME-2, item 10: the user's Codex was "not installed").
 *  That folder cannot be listed, but the app's execution aliases in
 *  %LOCALAPPDATA%\Microsoft\WindowsApps point into it: their link target
 *  names the package folder of the version installed now. */
export function codexAppDirs(env: Record<string, string | undefined>, readlink: (p: string) => string | null, platform: string = process.platform): string[] {
  if (platform !== 'win32' || !env.LOCALAPPDATA) return []
  const aliases = path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps')
  const out: string[] = []
  for (const alias of ['codex-core-command-runner.exe', 'codex-chrome-native-host.exe', 'chatgpt-desktop.exe']) {
    const target = readlink(path.win32.join(aliases, alias))
    const pkg = target ? /^(.*\\OpenAI\.Codex_[^\\]+)\\/i.exec(target)?.[1] : undefined
    if (pkg) {
      const dir = path.win32.join(pkg, 'app', 'resources')
      if (!out.includes(dir)) out.push(dir)
    }
  }
  return out
}

/** The Codex desktop app's own command-line program (23 Nov 2026: the app
 *  installed on this computer keeps it in
 *  %LOCALAPPDATA%\OpenAI\Codex\bin\<a folder that changes with each
 *  version>\codex.exe and does not put it in PATH, so the wizard's lines said
 *  a bare `codex` that PowerShell could not find). The folders there, newest
 *  name first; `listDir` gives a folder's subfolders (none when it is not
 *  there). */
export function codexBinDirs(env: Record<string, string | undefined>, listDir: (p: string) => string[], platform: string = process.platform): string[] {
  if (platform !== 'win32' || !env.LOCALAPPDATA) return []
  const bin = path.win32.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
  const names = listDir(bin).filter((n) => n && !n.includes('\\') &&!n.includes('/') && n !== '.' && n !== '..')
  names.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
  const out = [bin]
  for (const n of names) out.push(path.win32.join(bin, n))
  return out
}

/** macOS and Linux: the user's own install places (npm's, the agents' own
 *  installers', bun, volta), then the system's. Absolute paths only. */
function posixKnownDirs(env: Record<string, string | undefined>, platform: string): string[] {
  const home = env.HOME ?? ''
  const out: string[] = []
  if (path.posix.isAbsolute(home)) {
    for (const d of ['.local/bin', '.claude/local', '.codex/bin', '.opencode/bin', '.npm-global/bin', '.bun/bin', '.volta/bin']) out.push(path.posix.join(home, d))
  }
  if (env.npm_config_prefix && path.posix.isAbsolute(env.npm_config_prefix)) out.push(path.posix.join(env.npm_config_prefix, 'bin'))
  if (platform === 'darwin') out.push('/opt/homebrew/bin', '/usr/local/bin')
  else out.push('/usr/local/bin', '/snap/bin')
  return out
}

/**
 * The agent programs installed: looked for in PATH and the known places
 * in chooser order. Pure but for `exists`, so the tests
 * cover it with a made-up disk.
 */
export function findAgents(env: Record<string, string | undefined>, exists: (p: string) => boolean, platform = process.platform, readlink?: (p: string) => string | null, listDir?: (p: string) => string[]): AgentFound[] {
  const sep = platform === 'win32' ? ';' : ':'
  const dirs = [...(env.PATH ?? env.Path ?? '').split(sep).filter(Boolean), ...knownDirs(env, platform), ...(readlink ? codexAppDirs(env, readlink, platform) : []), ...(listDir ? codexBinDirs(env, listDir, platform) : [])]
  // (Windows: path.join as before; a POSIX platform's paths joined with '/'
  // wherever the tests run.)
  const join = platform === 'win32' ? path.join : path.posix.join
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']
  const found: AgentFound[] = []
  for (const id of AGENT_IDS) {
    let hit: string | null = null
    for (const d of dirs) {
      const dir = d.replace(/^"|"$/g, '')
      if (!(platform === 'win32' ? path.win32 : path.posix).isAbsolute(dir)) continue
      for (const ext of exts) {
        const p = join(dir, PROGRAM[id] + ext)
        if (exists(p)) {
          hit = p
          break
        }
      }
      if (hit) break
    }
    if (hit) found.push({ id, path: hit })
  }
  return found
}

/** The version queries still running, each with the window that asked
 *  (phase 7 audit, S2): the app quitting or that window closing ends them
 *  at once, so none outlives the app (its own 5 s timer dies with it). */
const versionQueries = new Map<() => void, number | null>()

/** Ends the version queries still running: all, or only one window's. Each
 *  query's own process tree, by its PID (never a process by its name). */
export function stopVersionQueries(owner?: number): number {
  let n = 0
  for (const [end, who] of [...versionQueries]) {
    if (owner !== undefined && who !== owner) continue
    end()
    n++
  }
  return n
}

/** Version queries running now (tests). */
export const versionQueriesRunning = (): number => versionQueries.size

/** Ask the installed executable only for its version. Never use the project
 * directory as cwd and never pass the MCP credential to this process. */
export async function agentVersion(agent: AgentFound, cwd: string, owner: number | null = null): Promise<string | null> {
  const r = await agentQuery(agent, ['--version'], cwd, owner, 5_000, false)
  // Display the version, not arbitrary terminal/command output.
  return r && r.code === 0 ? r.output.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0] ?? null : null
}

/** One read-only question to the installed agent program (its version; how
 *  Claude Code has the app registered: `mcp get`): its exit code and the
 *  first 16 KB of what it printed, or null when it could not run or took
 *  longer than `ms` (then its whole process tree is ended, by its PID).
 *  Never in the project folder, never with the MCP credential. */
export function agentQuery(agent: AgentFound, args: string[], cwd: string, owner: number | null, ms: number, withErrors = true): Promise<{ code: number | null; output: string } | null> {
  const max = 16 * 1024
  return new Promise((resolve) => {
    const spec = executableSpec(agent.path, [...(agent.args ?? []), ...args], {}, process.platform, systemTool('cmd'))
    const shell = typeof spec.args === 'string'
    const child = spawnChild(spec.file, typeof spec.args === 'string' ? [spec.args] : spec.args, {
      cwd, env: agentEnv(process.env, spec.env),
      windowsVerbatimArguments: shell, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    const end = (): void => {
      clearTimeout(timer)
      versionQueries.delete(end)
      if (child.exitCode === null && child.signalCode === null) {
        killTree(child.pid)
        child.kill()
      }
      child.stdout?.destroy()
      child.stderr?.destroy()
      resolve(null)
    }
    const timer = setTimeout(end, ms)
    versionQueries.set(end, owner)
    const take = (chunk: Buffer): void => {
      if (output.length < max) output += chunk.toString('utf8', 0, max - output.length)
    }
    child.stdout.on('data', take)
    if (withErrors) child.stderr.on('data', take)
    else child.stderr.resume()
    child.once('error', () => { clearTimeout(timer); versionQueries.delete(end); resolve(null) })
    child.once('close', (code) => {
      clearTimeout(timer)
      versionQueries.delete(end)
      resolve({ code, output })
    })
  })
}

/**
 * The line that adds this copy to Claude Code, once, for every project of
 * the user (SnippStudio DIS-MCP-PLAN.md). The USER runs it in a terminal of
 * their own: the app never writes the agent's settings. As with
 * antigravityPrintLine, the key never reaches the page or the clipboard: the
 * user's own shell reads it from the profile's file.
 *
 * Checked against `claude mcp add --help` (Claude Code 2.1.318):
 * `claude mcp add [options] <name> <commandOrUrl>`, `--transport http`,
 * `--scope user`, `--header <header...>`. --header takes many values, so it
 * comes last (before the name it would swallow the name and the address). A
 * name already there is refused ("MCP server <name> already exists in user
 * config"), so the line first removes this copy's own entry, quietly (when
 * there is none, that step fails and the add runs all the same).
 *
 * Windows: PowerShell (with the switch against running a program from the
 * current folder); elsewhere sh. `program`: the found Claude
 * Code's own file, by its full path (PowerShell could take a bare `claude`
 * to be claude.ps1, which a restricted execution policy refuses); a bare
 * `claude` only when none was found.
 */
export function claudeAddLine(settingsFile: string, url: string, name: string, platform: string = process.platform, program?: string): string {
  // (Ours only, never from outside: a guard against a caller's mistake.)
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new RangeError(name)
  if (platform !== 'win32') {
    const run = program && path.posix.isAbsolute(program) ? shq(program) : 'claude'
    return [
      `k="$(${posixTokenRead(settingsFile)})"`,
      `if [ -n "$k" ]; then ${run} mcp remove --scope user ${name} >/dev/null 2>&1; ${run} mcp add --transport http --scope user ${name} ${shq(url)} --header "Authorization: Bearer $k"; fi`
    ].join('; ')
  }
  const run = program && path.win32.isAbsolute(program) ? `& ${psq(program)}` : 'claude'
  return [
    PS_NO_CWD_SEARCH,
    `$k = (Get-Content -LiteralPath ${psq(settingsFile)} -Raw | ConvertFrom-Json).token`,
    `if ($k) { ${run} mcp remove --scope user ${name} *> $null; ${run} mcp add --transport http --scope user ${name} ${psq(url)} --header "Authorization: Bearer $k" }`
  ].join('; ')
}

/** How an agent has this copy registered, as the Settings window says it.
 *  `notInstalled`: the agent's program was not found. `oldKey`: there, at
 *  this address, but with another key (SIHIRBAZ-PLAN.md, 4: the connection
 *  wizard's "key up to date" row; before it this was `stale`). */
export type Registration = 'ok' | 'missing' | 'stale' | 'oldKey' | 'notInstalled' | 'unknown'

/**
 * Reads `claude mcp get <name>` (pure; the output never leaves the main
 * process: it may hold the key). `ok`: there, at this address, with this
 * key. `missing`: not there. `stale`: there, but another address or not an
 * HTTP server. `oldKey`: at this address with another key, or refused by a
 * running server (401). `unknown`: the program did not answer as expected.
 */
export function registrationState(result: { code: number | null; output: string } | null, want: { url: string; token: string; serverOn: boolean }): Registration {
  if (!result || result.code === null) return 'unknown'
  // eslint-disable-next-line no-control-regex
  const out = result.output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '')
  if (/No MCP server (?:named|found)/i.test(out)) return 'missing'
  if (result.code !== 0) return 'unknown'
  const field = (key: string): string | null => out.match(new RegExp(`^\\s*${key}:[ \\t]*(.*)$`, 'mi'))?.[1].trim() ?? null
  const type = field('Type')
  const url = field('URL')
  if (!type && !url) return 'unknown'
  if ((type && type.toLowerCase() !== 'http') || url !== want.url) return 'stale'
  const auth = out.match(/^\s*Authorization:\s*Bearer\s+(\S+)\s*$/mi)?.[1]
  if (auth !== undefined && !/^\*+$|\.\.\.|…/.test(auth) && auth !== want.token) return 'oldKey'
  if (want.serverOn && /needs auth|401|unauthori|wrong token/i.test(field('Status') ?? '')) return 'oldKey'
  return 'ok'
}

/**
 * The line that adds this copy to Codex, once (TERMINAL-YOK-PLAN.md, 9). The
 * user runs it; the app never writes Codex's settings.
 *
 * Checked against Codex's own help (`codex mcp add --help`, codex-cli
 * 0.167.0-alpha.3.2): `codex mcp add [OPTIONS] <NAME> (--url <URL> | --
 * <COMMAND>...)`, `--url` a streamable HTTP server, `--bearer-token-env-var
 * <ENV_VAR>` the environment variable the bearer token is read from. There
 * is no header option: Codex's settings get the variable's NAME, never the
 * key; the key is in the environment Codex starts from (codexEnvLine). What
 * an `add` over a name already there does is not in the help, so, as for
 * Claude Code, the line first removes this copy's own entry, quietly.
 */
export function codexAddLine(url: string, name: string, platform: string = process.platform, program?: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new RangeError(name)
  const env = codexTokenEnv(name)
  if (platform !== 'win32') {
    const run = program && path.posix.isAbsolute(program) ? shq(program) : 'codex'
    return `${run} mcp remove ${name} >/dev/null 2>&1; ${run} mcp add ${name} --url ${shq(url)} --bearer-token-env-var ${env}`
  }
  const run = program && path.win32.isAbsolute(program) ? `& ${psq(program)}` : 'codex'
  return [PS_NO_CWD_SEARCH, `${run} mcp remove ${name} *> $null`, `${run} mcp add ${name} --url ${psq(url)} --bearer-token-env-var ${env}`].join('; ')
}

/** Windows: the line that keeps this copy's key in the user's own
 *  environment for good (DENEME-2, item 10), so every new terminal Codex
 *  starts from has it. The key is read by the line itself from the
 *  profile's file: it never passes through the page or the clipboard. */
export function envPersistLine(settingsFile: string, variable: string, platform: string = process.platform): string | undefined {
  if (platform !== 'win32') return undefined
  if (!/^[A-Z][A-Z0-9_]{0,62}$/.test(variable)) throw new RangeError(variable)
  return `[Environment]::SetEnvironmentVariable('${variable}', (Get-Content -LiteralPath ${psq(settingsFile)} -Raw | ConvertFrom-Json).token, 'User')`
}

/** The same for Codex's own variable. */
export function codexPersistLine(settingsFile: string, name: string, platform: string = process.platform): string | undefined {
  if (platform !== 'win32') return undefined
  return envPersistLine(settingsFile, codexTokenEnv(name), platform)
}

/** What the Codex key query answers: the user's variable holds this copy's
 *  key (`same`), another value (`different`), nothing (`missing`). */
export type CodexEnvVerdict = 'same' | 'different' | 'missing' | 'unknown'

/**
 * Windows: compares the user's own variable with the key in the profile's
 * file INSIDE PowerShell (SIHIRBAZ-PLAN.md, 4; audit A9c, K12a: before it
 * only "is it set" was asked, so a renewed key went unseen). Neither value is
 * on the command line or in the output: PowerShell prints one word, Same,
 * Different or Missing. `scope`: 'User' (the real one); a test run asks the
 * process's own ('Process'), where the test put the variable.
 */
export function codexEnvQueryArgs(name: string, settingsFile: string, scope: 'User' | 'Process' = 'User'): string[] {
  return tokenEnvQueryArgs(settingsFile, codexTokenEnv(name), scope)
}

/** The same comparison for any variable this copy's key lives in (Codex's
 *  own, OpenCode's SNIPP_MCP_TOKEN): one word out. */
export function tokenEnvQueryArgs(settingsFile: string, variable: string, scope: 'User' | 'Process' = 'User'): string[] {
  if (!/^[A-Z][A-Z0-9_]{0,62}$/.test(variable)) throw new RangeError(variable)
  const script = [
    `$v = [Environment]::GetEnvironmentVariable('${variable}', '${scope}')`,
    `if (-not $v) { 'Missing' } else { $k = $null; try { $k = (Get-Content -LiteralPath ${psq(settingsFile)} -Raw | ConvertFrom-Json).token } catch { }`,
    `if ($k -and [string]::Equals($v, [string]$k, [StringComparison]::Ordinal)) { 'Same' } else { 'Different' } }`
  ].join('; ')
  return ['-NoProfile', '-NonInteractive', '-Command', script]
}

/** PowerShell's one word (codexEnvQueryArgs), read (pure). */
export function codexEnvVerdict(out: string | null): CodexEnvVerdict {
  const said = (out ?? '').trim()
  return said === 'Same' ? 'same' : said === 'Different' ? 'different' : said === 'Missing' ? 'missing' : 'unknown'
}

/** The connection wizard's step 2 for Codex (SIHIRBAZ-PLAN.md, K3): one line
 *  doing both jobs: on Windows the key kept for the user (codexPersistLine)
 *  and the add line; elsewhere the add line only (the key comes with the
 *  start line, startLine). */
export function codexRegisterLine(settingsFile: string, url: string, name: string, platform: string = process.platform, program?: string): string {
  const add = codexAddLine(url, name, platform, program)
  const persist = codexPersistLine(settingsFile, name, platform)
  return persist ? `${persist}; ${add}` : add
}

/** A line that puts the key in the command window's environment and starts
 *  the agent program there (OpenCode; Codex outside Windows): `envLine`
 *  (tokenSetupLine / codexEnvLine), then the program by its full path when
 *  found (a bare name could be PowerShell's .ps1 shim, which a restricted
 *  execution policy refuses), else its bare name. */
export function startLine(envLine: string, bare: string, platform: string = process.platform, program?: string): string {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(bare)) throw new RangeError(bare)
  if (platform !== 'win32') return `${envLine}; ${program && path.posix.isAbsolute(program) ? shq(program) : bare}`
  return `${PS_NO_CWD_SEARCH}; ${envLine}; ${program && path.win32.isAbsolute(program) ? `& ${psq(program)}` : bare}`
}

/** Outside Windows (no lasting place for the key there): the key and codex
 *  in one line, pasted each time Codex is started (the wizard's step 3).
 *  Windows: none (step 2 kept the key for the user). */
export function codexLaunchLine(settingsFile: string, name: string, platform: string = process.platform, program?: string): string | undefined {
  return platform === 'win32' ? undefined : startLine(codexEnvLine(settingsFile, name, platform), 'codex', platform, program)
}

/** The line that puts this copy's key into the environment of the terminal
 *  Codex is started from (each time; read from the profile's file there). */
export const codexEnvLine = (settingsFile: string, name: string, platform: string = process.platform): string => tokenSetupLine(settingsFile, platform, codexTokenEnv(name))

/**
 * Reads `codex mcp get <name> --json` (pure). `ok`: an HTTP server at this
 * address reading its key from this copy's variable. `missing`: "No MCP
 * server named …". `stale`: another address, another variable, or not HTTP.
 */
export function codexRegistrationState(result: { code: number | null; output: string } | null, want: { url: string; env: string }): Registration {
  if (!result || result.code === null) return 'unknown'
  if (/No MCP server (?:named|found)/i.test(result.output)) return 'missing'
  if (result.code !== 0) return 'unknown'
  let entry: Record<string, unknown>
  try {
    const at = result.output.indexOf('{')
    entry = JSON.parse(result.output.slice(at)) as Record<string, unknown>
  } catch {
    return 'unknown'
  }
  const transport = (entry.transport && typeof entry.transport === 'object' ? entry.transport : entry) as Record<string, unknown>
  const url = typeof transport.url === 'string' ? transport.url : null
  if (!url) return typeof transport.command === 'string' ? 'stale' : 'unknown'
  if (url !== want.url) return 'stale'
  return transport.bearer_token_env_var === want.env ? 'ok' : 'stale'
}

/** OpenCode v2's project config. The user merges it into their own file. */
export function openCodeConfig(url: string): string {
  const remote = { type: 'remote', url, oauth: false, headers: { Authorization: `Bearer {env:${TOKEN_ENV}}` } }
  return JSON.stringify({ mcp: { servers: { [MANUAL_SERVER]: remote } } }, null, 2)
}

/** OpenCode's own `mcp add` line (checked against `opencode mcp add --help`,
 *  25 Nov 2026: `--url`, `--header name=value`, `--global`; an entry already
 *  there is updated in place). The header holds the variable, never the key. */
export function openCodeAddLine(url: string, name: string, platform: string = process.platform, program?: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new RangeError(name)
  const header = `Authorization=Bearer {env:${TOKEN_ENV}}`
  const run = program && (platform === 'win32' ? path.win32.isAbsolute(program) : path.posix.isAbsolute(program)) ? (platform === 'win32' ? `& ${psq(program)}` : shq(program)) : 'opencode'
  const q = platform === 'win32' ? psq : shq
  return `${platform === 'win32' ? `${PS_NO_CWD_SEARCH}; ` : ''}${run} mcp add ${name} --url ${q(url)} --header ${q(header)} --global`
}

/** One line that reconnects OpenCode: its config entry updated (an existing
 *  one in place) and, on Windows, the key kept in the user's environment for
 *  every new OpenCode start. Elsewhere the start line sets the variable. */
export function openCodeRegisterLine(settingsFile: string, url: string, name: string, platform: string = process.platform, program?: string): string {
  const add = openCodeAddLine(url, name, platform, program)
  const persist = envPersistLine(settingsFile, TOKEN_ENV, platform)
  return persist ? `${persist}; ${add}` : add
}

/**
 * Antigravity's MCP config entry, printed by the user's own PowerShell
 * (phase 9a). Antigravity reads remote servers from `serverUrl` + `headers`
 * in .agents/mcp_config.json (the project) or ~/.gemini/config/mcp_config.json
 * (antigravity.google/docs/mcp, CLI tab, read 20 Nov 2026), and its headers
 * take no environment variable: the key has to be in that file. So the app
 * hands over a command, not the key: it reads the key from the profile's file
 * and prints the entry in the user's terminal (the key never reaches the
 * page or the clipboard; the app writes nothing of Antigravity's). The user
 * merges the entry into their file.
 */
export function antigravityPrintLine(settingsFile: string, url: string, platform: string = process.platform): string {
  // macOS and Linux: the same entry printed by sh (phase 10b.7: the line
  // was PowerShell's on every system).
  if (platform !== 'win32') {
    const json = `{"mcpServers":{"${MANUAL_SERVER}":{"serverUrl":"${url.replace(/["\\]/g, '')}","headers":{"Authorization":"Bearer %s"}}}}`
    return `k="$(${posixTokenRead(settingsFile)})"; printf '${json}\\n' "$k"`
  }
  return [
    `$k = (Get-Content -LiteralPath ${psq(settingsFile)} -Raw | ConvertFrom-Json).token`,
    `@{ mcpServers = @{ ${MANUAL_SERVER} = @{ serverUrl = ${psq(url)}; headers = @{ Authorization = "Bearer $k" } } } } | ConvertTo-Json -Depth 4`
  ].join('; ')
}

/** sh: the token from the settings file, with sed only (no node, python or
 *  jq is assumed on the user's computer); the file's path quoted for sh. */
function posixTokenRead(settingsFile: string): string {
  return `sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' ${shq(settingsFile)}`
}

/** The user can load the app-owned MCP credential into their own terminal
 *  without putting its value on the clipboard or a command line. `name`: the
 *  variable (OpenCode's part reads SNIPP_MCP_TOKEN; Codex its copy's own). */
export function tokenSetupLine(settingsFile: string, platform: string = process.platform, name: string = TOKEN_ENV): string {
  if (!/^[A-Z][A-Z0-9_]{0,62}$/.test(name)) throw new RangeError(name)
  // macOS and Linux: sh's own (phase 10b.7); Windows PowerShell.
  if (platform !== 'win32') return `export ${name}="$(${posixTokenRead(settingsFile)})"`
  return `$env:${name} = (Get-Content -LiteralPath ${psq(settingsFile)} -Raw | ConvertFrom-Json).token`
}

type ExecutableSpec = { file: string; args: string[] | string; env: Record<string, string> }

/** The program to start for an agent's own file, and its arguments: on
 *  Windows a .cmd/.bat shim runs through cmd.exe, every argument passed by
 *  name so no value is parsed twice (the in-app chat uses this too). */
export function executableSpec(file: string, args: string[], env: Record<string, string>, platform: string, comspec: string): ExecutableSpec {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args, env }
  // The npm shim needs cmd. Its arguments are paths or generated arguments,
  // never user commands. Quoted expansion avoids reinterpreting % in a path.
  const values = Object.fromEntries([file, ...args].map((value, i) => [`SNIPP_AGENT_ARG_${i}`, value]))
  const line = Object.keys(values).map((key) => `"%${key}%"`).join(' ')
  return { file: comspec, args: `/d /s /v:off /c "${line}"`, env: { ...env, ...values } }
}

/** A PowerShell literal string. PowerShell takes the typographic single
 *  quotes (U+2018 to U+201B) for a quote too: a path holding one (a user
 *  folder named O’Brien) ended the string early, so the copied lines broke
 *  and a crafted path could run a command in the app's own key check
 *  (final security audit, 23 Nov 2026, G1). Each is doubled, as ' is. */
export const psq = (s: string): string => `'${s.replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q)}'`

/** Windows' own switch against running a program from the current folder
 *  (security patch, item 1; K-G1, K-G2, B-G1): with it set, cmd.exe looks a
 *  bare program name up in PATH only. An npm shim (codex.cmd, an older
 *  claude.cmd) names `node` without a path; without the switch a node.bat or
 *  node.exe lying in the project folder, where the agent runs, would run in
 *  its place. Every process the app starts for an agent gets it (agentEnv),
 *  and the lines the user copies set it in their own PowerShell. */
export const NO_CWD_SEARCH = 'NoDefaultCurrentDirectoryInExePath'
const PS_NO_CWD_SEARCH = `$env:${NO_CWD_SEARCH} = '1'`

/** Kills a process and everything it started (our own child only). */
export function killTree(pid: number | null | undefined): void {
  if (!pid) return
  // (Windows' own taskkill by its full path, started in System32, never a
  // taskkill.exe of the current folder: security patch, item 2.)
  if (process.platform === 'win32') spawnSync(systemTool('taskkill'), ['/PID', String(pid), '/T', '/F'], { cwd: systemToolCwd(), stdio: 'ignore', windowsHide: true })
  else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* gone */
      }
    }
  }
}

/** The environment the agent program gets: the user's own, without what
 *  only Electron should see. */
export function agentEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>, platform: string = process.platform): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || /^(?:ELECTRON_|CHROME_|NODE_OPTIONS$|SNIPP_MCP_TOKEN$|SNIPP_AGENT_|SNIPPSTUDIO(?:_DEV)?_TOKEN$)/i.test(k)) continue
    env[k] = v
  }
  const all = { ...env, ...extra }
  if (platform !== 'win32') return all
  // Windows: never a program from the current folder (NO_CWD_SEARCH above).
  // One spelling of the name, and nothing handed in can switch it off.
  for (const k of Object.keys(all)) if (k.toLowerCase() === NO_CWD_SEARCH.toLowerCase()) delete all[k]
  return { ...all, [NO_CWD_SEARCH]: '1' }
}

/** A word for sh, in single quotes. */
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export const fileExists = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}
