// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// IPC for the agent connection (SnippStudio TERMINAL-YOK-PLAN.md; before it
// phase 4B.1's embedded session, removed on 21 Nov 2026): agent access on or
// off, how it stands (the server, the agents installed, an agent working from
// outside), and the Settings window's "Agent connection" page: the lines the
// user runs to add this copy to Claude Code or Codex once, the read-only
// checks of those registrations, OpenCode's and Antigravity's parts, and a
// new key. The in-app Chat tab (AGENT-CHAT-PLAN.md) is the one place the app
// starts an agent itself: the installed Claude Code CLI, per project, while
// the user chats in that window. Otherwise the app starts no agent and writes
// no agent's settings; the key never leaves the main process.
import { app, dialog, webContents, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { systemTool, systemToolCwd } from '../system-tool'
import type { AgentHost, AgentStatus } from '../agent-host'
import { AGENT_IDS, agentEnv, agentQuery, agentVersion, antigravityPrintLine, claudeAddLine, codexAddLine, codexEnvLine, codexEnvVerdict, codexPersistLine, codexLaunchLine, codexRegisterLine, codexRegistrationState, codexTokenEnv, fileExists, findAgents, openCodeConfig, openCodeRegisterLine, openCodeTokenEnv, registrationState, startLine, stopVersionQueries, tokenEnvQueryArgs, tokenSetupLine, type AgentFound, type AgentId, type CodexEnvVerdict, type Registration } from '../agent-connect'
import { CHANNEL, agentNameFor } from '../channel'
import { filterName } from '../strings-main'
import { registeredServerName } from '../../shared/product'
import { ClaudeChat, chatModels } from '../agent-chat'
import { CHAT_MODES, type ChatEvent, type ChatImage, type ChatMode, type ChatStatus } from '../../shared/agent-chat'
import { e2eMode } from '../e2e-hooks'
import { ipcMain } from '../state'

export interface SessionStatus {
  server: AgentStatus | null
  /** The agent programs found (Claude Code first). */
  agents: { id: AgentId; path: string }[]
  /** An agent working from outside (DIS-MCP-PLAN.md, 6): its program's name
   *  and when it was last heard from. */
  external: { client: string; seen: number } | null
  /** What the connection wizard shows live (SIHIRBAZ-PLAN.md, 4): each
   *  program's last active session and the latest refused request (401: an
   *  old key; 404: an agent window older than the server). */
  heard: { seen: { client: string; at: number }[]; refused: { why: 'key' | 'session'; at: number } | null }
}

const settingsFile = (): string => path.join(app.getPath('userData'), 'agent.json')

function agentsNow(): AgentFound[] {
  const env = process.env
  // (A test run looks in PATH only: never the computer's own install places.)
  if (e2eMode()) {
    const empty = path.join(app.getPath('userData'), 'agent-search')
    return findAgents({ PATH: env.PATH, USERPROFILE: empty, APPDATA: empty, LOCALAPPDATA: empty, HOME: empty }, fileExists)
  }
  return findAgents(env, fileExists, process.platform, readLink, subfolders)
}

/** A folder's subfolders by name, or none (the Codex app's own bin folder). */
function subfolders(p: string): string[] {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

/** A link's target, or null (the Codex app's execution aliases). */
function readLink(p: string): string | null {
  try {
    return fs.readlinkSync(p)
  } catch {
    return null
  }
}

/** Does the user's own Codex variable hold this copy's key (Windows)?
 *  PowerShell compares the two itself and prints one word (codexEnvQueryArgs):
 *  no value reaches this process, the page or a log. A test run asks the
 *  process scope instead, the variable put there from the test's
 *  e2e-user-env.json in its own profile (never the computer's environment). */
function codexEnvCheck(name: string, platform: string = process.platform): Promise<CodexEnvVerdict> {
  return tokenEnvCheck(codexTokenEnv(name), platform)
}

/** The same for any variable this copy's key lives in (OpenCode's
 *  SNIPP_MCP_TOKEN). The value never leaves PowerShell. */
function tokenEnvCheck(variable: string, platform: string = process.platform): Promise<CodexEnvVerdict> {
  if (platform !== 'win32') return Promise.resolve('unknown')
  let extra: Record<string, string> = {}
  if (e2eMode()) {
    try {
      const given = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'e2e-user-env.json'), 'utf8')) as Record<string, unknown>
      if (typeof given[variable] === 'string') extra = { [variable]: given[variable] as string }
    } catch {
      /* none: the variable is missing */
    }
  }
  // (Windows' own PowerShell by its full path, started in System32; the
  // app's own environment without any key variable: agentEnv.)
  const tool = systemTool('powershell', platform)
  const args = tokenEnvQueryArgs(settingsFile(), variable, e2eMode() ? 'Process' : 'User')
  return new Promise((resolve) => {
    execFile(tool, args, { cwd: systemToolCwd(platform), env: agentEnv(process.env, extra), timeout: 15_000, windowsHide: true }, (err, out) => {
      resolve(err ? 'unknown' : codexEnvVerdict(String(out ?? '')))
    })
  })
}

const found = (id: AgentId): AgentFound | null => agentsNow().find((a) => a.id === id) ?? null

/** The shell that runs a copied line for the user (repair): PowerShell on
 *  Windows, sh elsewhere. `platform` is handed in, so the branch stays here. */
function repairShell(platform: string, line: string): { file: string; args: string[] } {
  return platform === 'win32'
    ? { file: systemTool('powershell', platform), args: ['-NoProfile', '-NonInteractive', '-Command', line] }
    : { file: '/bin/sh', args: ['-lc', line] }
}

export function registerAgentSessionIpc(deps: {
  host: () => AgentHost | null
  /** The project an editor window has open now (the chat's folder). */
  projectPathOf: (contentsId: number) => string | null
}): { stop: () => void; windowGone: (contentsId: number) => void; repairDetected: () => Promise<AgentId[]> } {
  const status = async (): Promise<SessionStatus> => {
    const host = deps.host()
    const server = host ? await host.status() : null
    return {
      server,
      agents: agentsNow().map((a) => ({ id: a.id as AgentId, path: a.path })),
      external: server?.running ? host?.external() ?? null : null,
      heard: host?.heard() ?? { seen: [], refused: null }
    }
  }
  const name = (): string => registeredServerName(CHANNEL)

  // ---- the in-app chat (AGENT-CHAT-PLAN.md) -------------------------------
  // One Claude Code process per editor window, started on the first message,
  // in the project's folder. Its MCP config names this copy's server; a turn
  // streams back as agentChat:event. A project change starts a new process.
  const chats = new Map<number, { chat: ClaudeChat; project: string; model: string; shell: boolean; mode: ChatMode }>()
  const cleanMode = (raw: unknown): ChatMode => (typeof raw === 'string' && (CHAT_MODES as readonly string[]).includes(raw) ? (raw as ChatMode) : 'acceptEdits')
  /** One message's pictures: images only, four at most, base64 (the CLI's
   *  image block); anything else is dropped. */
  const cleanImages = (raw: unknown): ChatImage[] => {
    if (!Array.isArray(raw)) return []
    const types = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    const out: ChatImage[] = []
    for (const item of raw.slice(0, 4)) {
      if (!item || typeof item !== 'object') continue
      const m = item as { name?: unknown; mediaType?: unknown; data?: unknown }
      if (typeof m.mediaType !== 'string' || !types.includes(m.mediaType)) continue
      if (typeof m.data !== 'string' || !m.data || m.data.length > 12_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(m.data)) continue
      out.push({ name: typeof m.name === 'string' ? m.name.slice(0, 120) : 'image', mediaType: m.mediaType, data: m.data })
    }
    return out
  }
  const cleanModel = (raw: unknown): string | null => (typeof raw === 'string' && /^[A-Za-z0-9._:/[\]-]{1,120}$/.test(raw) ? raw : null)
  const chatEvent = (contentsId: number, event: ChatEvent): void => {
    const page = webContents.fromId(contentsId)
    if (page && !page.isDestroyed()) page.send('agentChat:event', { event })
  }
  const chatStatus = (contentsId: number): ChatStatus => {
    const entry = chats.get(contentsId)
    const installed = !!found('claude')
    return { ok: !!entry && entry.chat.alive(), phase: entry?.chat.phase ?? 'off', harness: installed ? 'claude' : null, installed, projectPath: entry?.project }
  }
  /** Starts the window's chat process for the project it has open now, or
   *  answers why it cannot. Nothing is started while agent access is off. */
  const ensureChat = async (contentsId: number, model = '', shell = false, mode: ChatMode = 'acceptEdits'): Promise<ChatStatus> => {
    const project = deps.projectPathOf(contentsId)
    const installed = !!found('claude')
    if (!project) return { ok: false, phase: 'off', harness: installed ? 'claude' : null, installed, error: 'no-project' }
    let existing = chats.get(contentsId)
    // (Shell commands and the permission mode are fixed for a process: a
    // change ends it, and the next message starts a new chat.)
    if (existing && (existing.project !== project || existing.shell !== shell || existing.mode !== mode)) {
      existing.chat.stop()
      chats.delete(contentsId)
      existing = undefined
    }
    if (existing && existing.chat.alive()) {
      // (Another model picked while the chat is open: the CLI changes it in
      // the same session, context kept; an empty choice is for the next chat.)
      if (model && model !== existing.model) {
        existing.model = model
        await existing.chat.send(`/model ${model}`)
      }
      return chatStatus(contentsId)
    }
    if (existing) {
      existing.chat.stop()
      chats.delete(contentsId)
    }
    const claude = found('claude')
    if (!claude) return { ok: false, phase: 'off', harness: null, installed: false, error: 'claude-missing' }
    const k = await deps.host()?.key()
    if (!k?.running) return { ok: false, phase: 'off', harness: 'claude', installed: true, error: 'server-off' }
    const chat = new ClaudeChat({
      program: claude,
      cwd: path.dirname(project),
      url: k.url,
      token: k.token,
      serverName: agentNameFor(CHANNEL),
      model: model || undefined,
      shell,
      mode,
      send: (event) => chatEvent(contentsId, event)
    })
    chats.set(contentsId, { chat, project, model, shell, mode })
    await chat.start()
    return { ...chatStatus(contentsId), projectPath: project }
  }
  ipcMain.handle('agentChat:start', async (event) => ensureChat(event.sender.id))
  ipcMain.handle('agentChat:status', (event) => chatStatus(event.sender.id))
  ipcMain.handle('agentChat:models', () => chatModels(process.env))
  /** The model for the next message: a running chat is switched in place
   *  (`/model`, context kept); one not started uses it at start. */
  ipcMain.handle('agentChat:setModel', async (event, model: unknown): Promise<{ ok: boolean; applied: boolean }> => {
    const clean = model === '' ? '' : cleanModel(model)
    if (clean === null) return { ok: false, applied: false }
    const entry = chats.get(event.sender.id)
    if (entry && clean && entry.chat.alive() && entry.model !== clean) {
      entry.model = clean
      await entry.chat.send(`/model ${clean}`)
      return { ok: true, applied: true }
    }
    if (entry && !clean) entry.model = ''
    return { ok: true, applied: false }
  })
  /** One picture for the message being written: the system's own picker,
   *  read here (the page never gets a path). */
  ipcMain.handle('agentChat:pickImage', async (event): Promise<ChatImage | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const imageFilter = { name: filterName('image'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
    const picked = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [imageFilter] })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: [imageFilter] })
    if (picked.canceled || !picked.filePaths[0]) return null
    const file = picked.filePaths[0]
    const media = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(file).toLowerCase()]
    if (!media) return null
    try {
      if (fs.statSync(file).size > 8 * 1024 * 1024) return null
      return { name: path.basename(file), mediaType: media, data: fs.readFileSync(file).toString('base64') }
    } catch {
      return null
    }
  })
  ipcMain.handle('agentChat:setShell', (event) => {
    const entry = chats.get(event.sender.id)
    entry?.chat.stop()
    chats.delete(event.sender.id)
    return { ok: true }
  })
  ipcMain.handle('agentChat:setMode', (event) => {
    const entry = chats.get(event.sender.id)
    entry?.chat.stop()
    chats.delete(event.sender.id)
    return { ok: true }
  })
  ipcMain.handle('agentChat:send', async (event, text: unknown, model: unknown, images: unknown, shell: unknown, mode: unknown): Promise<{ ok: boolean; error?: string }> => {
    const pictures = cleanImages(images)
    if (typeof text !== 'string' || text.length > 20_000 || (!text.trim() && !pictures.length)) return { ok: false, error: 'bad-text' }
    const started = await ensureChat(event.sender.id, cleanModel(model) ?? '', shell === true, cleanMode(mode))
    if (!started.ok) return { ok: false, error: started.error ?? 'not-started' }
    const entry = chats.get(event.sender.id)
    if (!entry) return { ok: false, error: 'not-started' }
    try {
      await entry.chat.send(typeof text === 'string' ? text.trim() : '', pictures)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'send-failed' }
    }
  })
  ipcMain.handle('agentChat:stop', (event) => {
    const entry = chats.get(event.sender.id)
    entry?.chat.stop()
    chats.delete(event.sender.id)
  })

  ipcMain.handle('agent:connect', async (_event, on: unknown) => {
    await deps.host()?.setEnabled(on === true)
    return status()
  })
  ipcMain.handle('agentLink:status', () => status())
  ipcMain.handle('agentLink:catalog', async (event) => {
    const list = agentsNow()
    const owner = event.sender.id
    return Promise.all(AGENT_IDS.map(async (id: AgentId) => {
      const agent = list.find((a) => a.id === id)
      return { id, installed: !!agent, version: agent ? await agentVersion(agent, app.getPath('userData'), owner) : null }
    }))
  })
  // Each part turns access on first: the key is then in the profile's file,
  // where the lines read it.
  const key = async (): Promise<{ url: string; token: string; running: boolean } | null> => {
    const host = deps.host()
    await host?.setEnabled(true)
    return (await host?.key()) ?? null
  }
  /** The line that repairs one program's registration with the key now in
   *  the profile (the same line step 2 copies). */
  const repairLineFor = (which: 'claude' | 'codex' | 'opencode', k: { url: string }): string =>
    which === 'claude'
      ? claudeAddLine(settingsFile(), k.url, name(), process.platform, found('claude')?.path)
      : which === 'codex'
        ? codexRegisterLine(settingsFile(), k.url, name(), process.platform, found('codex')?.path)
        : openCodeRegisterLine(settingsFile(), k.url, name(), process.platform, found('opencode')?.path)
  const runRepairLine = async (line: string): Promise<boolean> => {
    const shell = repairShell(process.platform, line)
    return new Promise<boolean>((resolve) => {
      execFile(shell.file, shell.args, { cwd: systemToolCwd(), env: agentEnv(process.env, {}), timeout: 45_000, windowsHide: true }, (err) => resolve(!err))
    })
  }
  /** Is this copy's entry in OpenCode's global config, and at this address?
   *  (A JSONC file is read as text: only the entry's own chunk is looked at.) */
  const openCodeEntry = (url: string): 'missing' | 'current' | 'stale' => {
    for (const file of ['opencode.json', 'opencode.jsonc']) {
      try {
        const text = fs.readFileSync(path.join(app.getPath('home'), '.config', 'opencode', file), 'utf8')
        const at = text.indexOf(`"${name()}"`)
        if (at < 0) continue
        return text.slice(at, at + 1200).includes(url) ? 'current' : 'stale'
      } catch {
        /* next file */
      }
    }
    return 'missing'
  }
  /** A key was refused: repair the detected programs whose own registration
   *  still holds another key (or address). The agent that was refused still
   *  has to reconnect or restart; its next attempt then works. */
  const repairDetected = async (): Promise<AgentId[]> => {
    const host = deps.host()
    if (!host || !(await host.autoRepairOn())) return []
    const k = await host.key()
    if (!k?.running) return []
    const fixed: AgentId[] = []
    const fix = async (which: 'claude' | 'codex' | 'opencode'): Promise<void> => {
      if (await runRepairLine(repairLineFor(which, k)).catch(() => false)) fixed.push(which)
    }
    const claude = found('claude')
    if (claude) {
      const r = await agentQuery(claude, ['mcp', 'get', name()], app.getPath('userData'), null, 20_000).catch(() => null)
      const st = registrationState(r, { url: k.url, token: k.token, serverOn: true })
      if (st === 'oldKey' || st === 'stale') await fix('claude')
    }
    const codex = found('codex')
    if (codex) {
      const r = await agentQuery(codex, ['mcp', 'get', name(), '--json'], app.getPath('userData'), null, 20_000).catch(() => null)
      const st = codexRegistrationState(r, { url: k.url, env: codexTokenEnv(name()) })
      const env = await tokenEnvCheck(codexTokenEnv(name()))
      // (An entry that points here with the wrong address or variable, or a
      // right entry whose variable holds another key/missing: repaired. One
      // never configured is left alone.)
      if (st === 'stale' || (st === 'ok' && (env === 'different' || env === 'missing'))) await fix('codex')
    }
    const oc = found('opencode')
    if (oc) {
      const entry = openCodeEntry(k.url)
      const env = await tokenEnvCheck(openCodeTokenEnv())
      if (entry === 'stale' || (entry === 'current' && (env === 'different' || env === 'missing'))) await fix('opencode')
    }
    return fixed
  }
  ipcMain.handle('agentLink:openCodeSetup', async () => {
    const k = await key()
    return k ? { config: openCodeConfig(k.url), environment: tokenSetupLine(settingsFile()), launch: startLine(tokenSetupLine(settingsFile()), 'opencode', process.platform, found('opencode')?.path) } : null
  })
  ipcMain.handle('agentLink:antigravitySetup', async () => {
    const k = await key()
    return k ? { command: antigravityPrintLine(settingsFile(), k.url) } : null
  })
  ipcMain.handle('agentLink:claudeSetup', async () => {
    const k = await key()
    return k ? { command: claudeAddLine(settingsFile(), k.url, name(), process.platform, found('claude')?.path), name: name() } : null
  })
  ipcMain.handle('agentLink:codexSetup', async () => {
    const k = await key()
    const codex = found('codex')?.path
    // (register: the wizard's one line; launch: outside Windows, the key and
    // codex in one line, each time.)
    return k ? {
      command: codexAddLine(k.url, name(), process.platform, codex),
      register: codexRegisterLine(settingsFile(), k.url, name(), process.platform, codex),
      launch: codexLaunchLine(settingsFile(), name(), process.platform, codex),
      environment: codexEnvLine(settingsFile(), name()),
      persist: codexPersistLine(settingsFile(), name(), process.platform),
      name: name(),
      variable: codexTokenEnv(name())
    } : null
  })
  // (Whether the user's Codex variable holds this copy's key: a verdict only.)
  ipcMain.handle('agentLink:codexEnv', () => codexEnvCheck(name()))
  // The wizard's one-click repair (a page's "Reconnect"): it runs the same
  // line step 2 copies, in the user's own PowerShell/sh, reading the key from
  // the profile's file. The key never reaches this process's command line or
  // the page. Each detected program's own CLI updates its registration;
  // OpenCode's key goes into the user's environment (Windows), never the file.
  ipcMain.handle('agentLink:repair', async (_event, which: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (which !== 'claude' && which !== 'codex' && which !== 'opencode') return { ok: false, error: 'that program has no reconnect here' }
    const k = await key()
    if (!k) return { ok: false, error: 'agent access is off' }
    return (await runRepairLine(repairLineFor(which, k))) ? { ok: true } : { ok: false, error: 'the command did not finish cleanly' }
  })
  // (A refused key repairs the detected programs' own registrations by itself
  // when this is on: the default. The agent that was refused still has to
  // reconnect or restart; the old key stays valid 10 minutes after a renew.)
  ipcMain.handle('agentLink:autoRepair', async () => (await deps.host()?.autoRepairOn()) ?? true)
  ipcMain.handle('agentLink:setAutoRepair', async (_e, on: unknown) => (await deps.host()?.setAutoRepair(on === true)) ?? false)
  // The read-only checks: only the verdict leaves (the output may hold the key).
  ipcMain.handle('agentLink:check', async (event, which: unknown): Promise<Registration> => {
    if (which !== 'claude' && which !== 'codex') return 'unknown'
    const agent = found(which)
    const k = await deps.host()?.key()
    if (!agent) return 'notInstalled'
    if (!k) return 'unknown'
    if (which === 'claude') {
      const result = await agentQuery(agent, ['mcp', 'get', name()], app.getPath('userData'), event.sender.id, 30_000)
      return registrationState(result, { url: k.url, token: k.token, serverOn: k.running })
    }
    const result = await agentQuery(agent, ['mcp', 'get', name(), '--json'], app.getPath('userData'), event.sender.id, 30_000)
    return codexRegistrationState(result, { url: k.url, env: codexTokenEnv(name()) })
  })
  ipcMain.handle('agentLink:renewKey', async () => {
    await deps.host()?.renewKey()
    return status()
  })

  return {
    // (The app quitting, or agent access going off: every version query
    // still running, each by its own PID: audit S2; and every chat process,
    // with everything it started.)
    stop: () => {
      stopVersionQueries()
      for (const entry of chats.values()) entry.chat.stop()
      chats.clear()
    },
    windowGone: (contentsId) => {
      stopVersionQueries(contentsId)
      chats.get(contentsId)?.chat.stop()
      chats.delete(contentsId)
    },
    repairDetected
  }
}
