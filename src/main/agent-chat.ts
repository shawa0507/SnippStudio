// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The in-app chat's agent process (AGENT-CHAT-PLAN.md): the Claude Code CLI
// the user already has, started for one editor window, in the project's
// folder, with this copy's MCP server given to it for that process only.
// Stream-json in and out; the page gets one event per change of a turn. The
// key travels in the child's environment (the config file names the
// variable), never in argv or a page.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ChatContext, ChatEvent, ChatImage, ChatMcpStatus, ChatMode, ChatModels, ChatPhase } from '../shared/agent-chat'
import { PRODUCT_NAME } from '../shared/product'
import { agentEnv, executableSpec, killTree, type AgentFound } from './agent-connect'
import { systemTool } from './system-tool'

/** The variable the CLI's MCP config reads the key from. */
export const CHAT_TOKEN_ENV = 'SNIPP_CHAT_TOKEN'

/** One line of the CLI's stream beyond this is refused (a film's frame list
 *  is large, not endless). */
const MAX_LINE = 4 * 1024 * 1024
const MAX_STDERR = 8 * 1024

/** What the chat's agent is told once, before the app's own server words:
 *  it is in a chat, not a headless job, and `wait` has no one to wait for. */
export const CHAT_SYSTEM_PROMPT =
  `You are the in-app chat assistant inside ${PRODUCT_NAME}, a video editor running on this computer. ` +
  'The user chats with you in the editor while the project is open beside you. ' +
  "Work on that project through the app's MCP tools; the app's tools and file edits in the project folder are allowed. " +
  'Do not call the wait tool: when your turn is done, reply to the user. Never render or export. Keep replies short.'

/** The MCP config file for one chat process: a variable in the header, so
 *  the key is never in the file or in argv. */
export function chatMcpConfig(serverName: string, url: string): string {
  return JSON.stringify({ mcpServers: { [serverName]: { type: 'http', url, headers: { Authorization: `Bearer \${${CHAT_TOKEN_ENV}}` } } } })
}

/** The arguments of one chat process. The app's own server is the only MCP
 *  server (`--strict-mcp-config`); its `wait` is disallowed in a chat. Shell
 *  commands are the user's choice: `Bash` in the allow list, never prompts
 *  (print mode has no one to ask). `resume` continues a saved session (the
 *  CLI's own `--resume`, same session id). */
export function chatArgs(configFile: string, serverName: string, model?: string, shell = false, mode: ChatMode = 'acceptEdits', resume?: string): string[] {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config', configFile,
    '--strict-mcp-config',
    ...(resume ? ['--resume', resume] : []),
    '--permission-mode', mode,
    '--allowedTools', shell ? `mcp__${serverName} Bash` : `mcp__${serverName}`,
    '--disallowedTools', `mcp__${serverName}__wait`,
    ...(model ? ['--model', model] : []),
    '--append-system-prompt', CHAT_SYSTEM_PROMPT
  ]
}

/** One user message as the CLI's streaming input takes it: its words, then
 *  its pictures (base64, as the API's image block). */
export function chatUserLine(text: string, images: readonly ChatImage[] = []): string {
  const content: unknown[] = []
  if (text) content.push({ type: 'text', text })
  for (const image of images) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })
  if (!content.length) content.push({ type: 'text', text: '' })
  return JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null })
}

/** The models the picker offers: the CLI's own setting (as the current) and
 *  the ids in the environment it reads, deduplicated. No provider name is
 *  written here; whatever the user configured is what is offered. */
export function chatModels(env: Record<string, string | undefined> = process.env): ChatModels {
  const keys = ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']
  const seen = new Set<string>()
  const suggestions: string[] = []
  for (const key of keys) {
    const value = (env[key] ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    suggestions.push(value)
  }
  return { current: (env.ANTHROPIC_MODEL ?? '').trim() || null, suggestions }
}

function tokens(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** The text of a tool result, short enough for one card. */
function summaryOf(content: unknown): string {
  const texts: string[] = []
  if (typeof content === 'string') texts.push(content)
  else if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') texts.push((part as { text: string }).text)
    }
  }
  const text = texts.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > 300 ? text.slice(0, 299) + '…' : text
}

/**
 * One line of the CLI's stream-json output, as page events. Pure, so the
 * shapes are tested without a process; unknown lines give nothing (the CLI
 * adds kinds between versions, and one of them must not end a chat).
 * `lastUsed` is the current conversation's size as the last assistant
 * message reported it: the result's own usage is the turn's sum over every
 * API call, which counts the prompt again at each tool step.
 */
export function chatEventsFrom(line: string, fallbackWindow = 0, lastUsed = 0): ChatEvent[] {
  let message: Record<string, unknown>
  try {
    message = JSON.parse(line) as Record<string, unknown>
  } catch {
    return []
  }
  if (!message || typeof message !== 'object') return []
  const type = message.type
  if (type === 'system') {
    if (message.subtype !== 'init') return []
    const mcp = Array.isArray(message.mcp_servers)
      ? message.mcp_servers
          .filter((s): s is { name: string; status: string } => !!s && typeof s === 'object' && typeof (s as { name?: unknown }).name === 'string' && typeof (s as { status?: unknown }).status === 'string')
          .map((s): ChatMcpStatus => ({ name: s.name, status: s.status }))
      : undefined
    const commands = Array.isArray(message.slash_commands)
      ? message.slash_commands.filter((c): c is string => typeof c === 'string' && !!c)
      : undefined
    return [{
      type: 'status',
      phase: 'ready',
      ...(typeof message.session_id === 'string' ? { sessionId: message.session_id } : {}),
      ...(mcp ? { mcp } : {}),
      ...(typeof message.model === 'string' ? { model: message.model } : {}),
      ...(commands ? { commands } : {})
    }]
  }
  if (type === 'assistant' || type === 'user') {
    const inner = message.message as { content?: unknown; usage?: Record<string, unknown> } | undefined
    const content = inner?.content
    if (!Array.isArray(content)) return []
    // The message's own usage is its request's prompt plus its answer: the
    // conversation's size right then. A subagent's message (a tool call
    // raised it) is another conversation with its own window, so it is not
    // this chat's size.
    const used = tokens(inner?.usage?.input_tokens) + tokens(inner?.usage?.cache_read_input_tokens) + tokens(inner?.usage?.cache_creation_input_tokens) + tokens(inner?.usage?.output_tokens)
    const events: ChatEvent[] = type === 'assistant' && !message.parent_tool_use_id && used > 0 ? [{ type: 'usage', used }] : []
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (type === 'assistant') {
        if (b.type === 'thinking') events.push({ type: 'thinking' })
        else if (b.type === 'text' && typeof b.text === 'string' && b.text) events.push({ type: 'text', text: b.text })
        else if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
          events.push({ type: 'tool', id: b.id, name: b.name, input: b.input, state: 'running' })
        }
      } else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        events.push({ type: 'tool', id: b.tool_use_id, name: '', state: b.is_error === true ? 'error' : 'done', summary: summaryOf(b.content) })
      }
    }
    return events
  }
  if (type === 'result') {
    const seconds = typeof message.duration_ms === 'number' ? message.duration_ms / 1000 : undefined
    const usage = (message.usage ?? {}) as Record<string, unknown>
    const summed = tokens(usage.input_tokens) + tokens(usage.cache_read_input_tokens) + tokens(usage.cache_creation_input_tokens) + tokens(usage.output_tokens)
    // The last assistant message's size when the turn had one; the turn's
    // sum only when it did not (a failed turn before any answer).
    const used = lastUsed > 0 ? lastUsed : summed
    let window = 0
    const perModel = message.modelUsage
    if (perModel && typeof perModel === 'object') {
      for (const entry of Object.values(perModel as Record<string, { contextWindow?: unknown }>)) {
        if (entry && typeof entry.contextWindow === 'number' && entry.contextWindow > window) window = entry.contextWindow
      }
    }
    if (!window) window = fallbackWindow
    const context: ChatContext | undefined = used > 0 && window > 0 ? { used, window } : undefined
    return [
      {
        type: 'result',
        text: typeof message.result === 'string' ? message.result : undefined,
        isError: message.is_error === true || (typeof message.subtype === 'string' && message.subtype !== 'success'),
        seconds,
        costUsd: typeof message.total_cost_usd === 'number' ? message.total_cost_usd : undefined,
        turns: typeof message.num_turns === 'number' ? message.num_turns : undefined,
        ...(context ? { context } : {})
      }
    ]
  }
  if (type === 'error') {
    const e = message.error as { message?: unknown } | undefined
    return [{ type: 'error', message: typeof e?.message === 'string' ? e.message : 'The agent reported an error.' }]
  }
  return []
}

/** The environment of the chat process: the user's own, without the desktop
 *  host's session variables (a child that inherits them waits for a host
 *  that is not there). */
export function chatEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const env = agentEnv(base, extra)
  for (const key of Object.keys(env)) {
    if (/^(?:CLAUDECODE|CLAUDE_PID)$/.test(key) || /^CLAUDE_CODE_(?:ENTRYPOINT|PROVIDER_MANAGED_BY_HOST|HOST_AUTH_ENV_VAR|HOST_SESSION_ID|HOST_SHORT_TEMP_DIRS|MESSAGING_SOCKET|MESSAGING_TOKEN|EXECPATH|SESSION_ID|SSE_PORT)$/i.test(key)) delete env[key]
  }
  return env
}

/** The program and arguments of one chat process (Windows shims through
 *  cmd.exe, as every other agent process in the app). */
function chatSpawn(options: ClaudeChatOptions, args: string[], platform: NodeJS.Platform = process.platform): { file: string; args: string[] | string; env: Record<string, string> } {
  return executableSpec(options.program.path, args, { [CHAT_TOKEN_ENV]: options.token }, platform, options.comspec ?? systemTool('cmd', platform))
}

export interface ClaudeChatOptions {
  program: AgentFound
  /** The project's folder. */
  cwd: string
  url: string
  token: string
  /** This copy's MCP server name (`snipp`, `snipp-dev`). */
  serverName: string
  /** The model for this process; empty: the CLI's own setting. */
  model?: string
  /** A saved session to continue (`--resume`), or none: a new one. */
  resume?: string
  /** The user allowed shell commands (Bash, no prompts). */
  shell?: boolean
  mode?: ChatMode
  send: (event: ChatEvent) => void
  /** Tests: the platform and cmd.exe of a made-up machine. */
  platform?: NodeJS.Platform
  comspec?: string
}

/** One Claude Code chat process: a turn at a time, its context kept between
 *  turns by the process itself. `stop` ends it and everything it started. */
export class ClaudeChat {
  private child: ChildProcessWithoutNullStreams | null = null
  private configDir: string | null = null
  private buffer = ''
  private stderr = ''
  private stopping = false
  private exited = false
  private textThisTurn = false
  /** The conversation's size as the turn's last assistant message reported
   *  it (0 before the turn's first answer). */
  private lastUsed = 0
  private phaseValue: ChatPhase = 'off'

  constructor(private readonly options: ClaudeChatOptions) {}

  get phase(): ChatPhase {
    return this.phaseValue
  }

  alive(): boolean {
    return !!this.child && !this.exited && this.child.exitCode === null
  }

  /** Starts the CLI if it is not running. The MCP config is written for this
   *  process alone; the key goes in its environment. */
  async start(): Promise<void> {
    if (this.alive()) return
    this.phaseValue = 'starting'
    this.emit({ type: 'status', phase: 'starting' })
    try {
      this.configDir = await mkdtemp(path.join(tmpdir(), 'snipp-chat-'))
      const configFile = path.join(this.configDir, 'mcp.json')
      await writeFile(configFile, chatMcpConfig(this.options.serverName, this.options.url), { mode: 0o600 })
      const spec = chatSpawn(this.options, chatArgs(configFile, this.options.serverName, this.options.model, this.options.shell === true, this.options.mode, this.options.resume), this.options.platform)
      const shell = typeof spec.args === 'string'
      const spawnArgs: string[] = typeof spec.args === 'string' ? [spec.args] : spec.args
      const child = spawn(spec.file, spawnArgs, {
        cwd: this.options.cwd,
        env: chatEnv(process.env, spec.env),
        windowsVerbatimArguments: shell,
        windowsHide: true,
        detached: !shell,
        stdio: ['pipe', 'pipe', 'pipe']
      }) as ChildProcessWithoutNullStreams
      this.child = child
      this.exited = false
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => this.consume(chunk))
      child.stderr.on('data', (chunk: string) => {
        this.stderr = (this.stderr + chunk).slice(-MAX_STDERR)
      })
      child.once('error', (e) => this.failed(e.message))
      child.once('exit', (code) => this.ended(code))
      child.stdin.on('error', () => undefined)
    } catch (e) {
      await this.cleanup()
      this.failed(e instanceof Error ? e.message : String(e))
    }
  }

  /** Sends one user message (with its pictures), starting the process first
   *  when needed. */
  async send(text: string, images: readonly ChatImage[] = []): Promise<void> {
    if (!this.alive()) await this.start()
    if (!this.alive() || !this.child) return
    this.textThisTurn = false
    this.lastUsed = 0
    this.emit({ type: 'turn', state: 'start' })
    this.child.stdin.write(chatUserLine(text, images) + '\n')
  }

  /** Ends the process and everything it started. */
  stop(): void {
    if (!this.child) {
      this.phaseValue = 'stopped'
      return
    }
    this.stopping = true
    killTree(this.child.pid)
    this.phaseValue = 'stopped'
    this.emit({ type: 'status', phase: 'stopped' })
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    let at = this.buffer.indexOf('\n')
    while (at >= 0) {
      const line = this.buffer.slice(0, at).trim()
      this.buffer = this.buffer.slice(at + 1)
      if (line) this.line(line)
      at = this.buffer.indexOf('\n')
    }
    if (this.buffer.length > MAX_LINE) {
      this.failed('The agent sent a line too large to read.')
      this.stop()
    }
  }

  private line(line: string): void {
    const fallbackWindow = Number(process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS) || 0
    for (const event of chatEventsFrom(line, fallbackWindow, this.lastUsed)) {
      if (event.type === 'usage') this.lastUsed = event.used
      if (event.type === 'text') this.textThisTurn = true
      // (A failed turn whose words never arrived: the result's text is the
      // only account of it, said as the error.)
      if (event.type === 'result' && event.isError && event.text && !this.textThisTurn) this.emit({ type: 'error', message: event.text })
      if (event.type === 'result') this.emit({ type: 'turn', state: 'end' })
      if (event.type === 'status' && event.phase === 'ready') this.phaseValue = 'ready'
      this.emit(event)
    }
  }

  private failed(message: string): void {
    if (this.stopping || this.exited) return
    this.phaseValue = 'error'
    this.emit({ type: 'status', phase: 'error', detail: message })
    this.emit({ type: 'error', message })
    this.emit({ type: 'turn', state: 'end' })
  }

  private ended(code: number | null): void {
    if (this.exited) return
    this.exited = true
    void this.cleanup()
    this.emit({ type: 'turn', state: 'end' })
    if (this.stopping) {
      this.phaseValue = 'stopped'
      return
    }
    this.phaseValue = 'error'
    const tail = this.stderr.replace(/\u001b\[[0-9;]*m/g, '').trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ')
    const detail = tail || `The agent program ended (${code ?? 'no code'}).`
    this.emit({ type: 'status', phase: 'error', detail })
    this.emit({ type: 'error', message: detail })
  }

  private async cleanup(): Promise<void> {
    const dir = this.configDir
    this.configDir = null
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }

  private emit(event: ChatEvent): void {
    try {
      this.options.send(event)
    } catch {
      /* the window is gone: the session's own end cleans up */
    }
  }
}
