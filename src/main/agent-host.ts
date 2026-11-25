// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent server's life in the app: turned on and off, its sessions, each
// call sent to the editor window its session works in, the answers brought
// back. (The endpoint is agent-server.ts, the protocol agent-protocol.ts, the
// tools themselves the page's: renderer agent/.)
//
// Sessions (SnippStudio phase 4A): an agent's `initialize` opens one (MCP
// Streamable HTTP's Mcp-Session-Id); its first tool call ties it to the
// editor window it reached, and every later call goes to that same window —
// not to whichever the user focused last. A call the page has not answered in
// time is cancelled there, so it is never done after its answer was given up.
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { errorResult, type ToolResult } from './agent-protocol'
import { connectCommands, newToken, PREVIOUS_TOKEN_GRACE_MS, readAgentSettings, startAgentServer, writeAgentSettings, type AgentSessions, type AgentSettings, type RunningAgentServer } from './agent-server'
import { PRODUCT_NAME } from '../shared/product'
import { waitBudgetMs } from '../renderer/src/agent/wait'

/** What a page is told about the server. Never the secret key, nor a line or
 *  a header that holds it (security patch, item 7; K-G4): a page that was
 *  taken over must not learn it. The session's own config gets it from
 *  `connection()`, in the main process. */
export interface AgentStatus {
  enabled: boolean
  running: boolean
  port: number
  url: string
  error: string | null
}

export interface AgentHostDeps {
  /** The profile folder (agent.json lives in it). */
  userData: () => string
  port: number
  version: string
  /** The name agents know this copy by ('snipp', or 'snipp-dev'). */
  name: string
  /** On for this run whatever the settings say (--agent): a test, a script. */
  forced: boolean
  /** The editor window a new session starts in, and its project file. */
  target: () => { win: BrowserWindow; projectPath: string | null } | null
  /** The project file of a window, now. */
  projectPathOf?: (win: BrowserWindow) => string | null
  /** How long a call may take (default CALL_TIMEOUT_MS; shorter in a test run). */
  timeoutMs?: number
  /** An agent from outside began working, or a session ended: the editor
   *  windows refresh what they show of the connection. */
  changed?: () => void
  /** A request was refused for its key: the detected agents' registrations
   *  may be repaired (only when the user left auto-repair on). Called at most
   *  as often as refused(); the repair itself is the caller's to rate-limit. */
  keyRefused?: () => void
}

/** How long the page has to answer one tool call. A code film's first frame
 *  waits for its page to start (up to two minutes, as an export does). */
export const CALL_TIMEOUT_MS = 150_000

/** Calls of one session waiting for the page at a time (phase 4A.10, D5,
 *  safety#9): one agent cannot pile up calls without end. */
export const SESSION_CALLS_MAX = 6

/** Sessions the server keeps at most, and one client's at most (phase
 *  4A.11, S2): past them one of that client's own sessions is forgotten
 *  first — the one evictable() names, never the oldest as such (D22, K5). */
export const SESSIONS_MAX = 32
export const SESSIONS_PER_CLIENT = 8

/**
 * The session to forget when there are too many (D22, the audit's K5). It
 * used to be the OLDEST: every `claude` started and every "check the
 * connection" opens a session under the same program name, so the ninth one
 * ended the session that had been working since the morning (it got 404,
 * the page forgot it: the project lost its holder, its notes went back).
 * Now: never a session with a call waiting (a `wait` it is in included);
 * of the others, one that never called a tool first (a health check), then
 * the one that has been silent the longest. Null: every one of them has a
 * call waiting — none is ended. Pure.
 */
export function evictable(sessions: readonly Pick<Session, 'id' | 'created' | 'seen' | 'called'>[], busy: (id: string) => boolean): string | null {
  const free = sessions.filter((s) => !busy(s.id))
  if (!free.length) return null
  const heard = (s: Pick<Session, 'created' | 'seen'>): number => s.seen ?? s.created
  return free.reduce((a, b) => (Number(!!a.called) - Number(!!b.called) || heard(a) - heard(b)) <= 0 ? a : b).id
}

interface Pending {
  session: string
  contentsId: number
  contents: Electron.WebContents
  resolve: (r: ToolResult) => void
  timer: ReturnType<typeof setTimeout>
}

/** What the agent is told when the page did not answer in time (phase
 *  4A.8, G5): the page itself refuses an edit too close to the deadline, so
 *  a missing answer is not "nothing applied" — it is "look first". */
export const NO_ANSWER = (seconds: number): string =>
  `${PRODUCT_NAME} did not answer within ${seconds} seconds (no answer; the call was cancelled). Read changes (or project) before retrying: do not send the same edit again blindly.`

/** What a call in flight is told when agent access is turned off (phase
 *  4A.9, V-limits-sessions-6): the page may be in the middle of applying an
 *  edit at that moment, so this does not say "cancelled, nothing done". */
export const ACCESS_OFF =
  `Agent access was turned off in ${PRODUCT_NAME} before it answered. An edit sent just then may or may not have been applied: when access is on again, read changes (or project) before sending it again.`

/** What a call the agent gave up on is answered (nobody reads it). */
export const GIVEN_UP = 'The call was cancelled by the agent.'

export interface Session {
  id: string
  client: string
  created: number
  /** initialize + tools/list sent to it (characters): its fixed cost. */
  defsChars: number
  /** The window it works in (after its first call). */
  win: BrowserWindow | null
  /** It asked for the tools or called one: an agent at work, not a mere
   *  health check (`claude mcp get` connects too). DIS-MCP-PLAN.md, 6. */
  active?: boolean
  /** Its last request that the host saw (open, tools/list, a call). */
  seen?: number
  /** It called a tool: it works on a project (not only listed the tools). */
  called?: boolean
}

/** A session from outside counts as connected this
 *  long after its last request (an HTTP agent may leave without a word). */
export const EXTERNAL_QUIET_MS = 30 * 60_000

export class AgentHost implements AgentSessions {
  private settings: AgentSettings | null = null
  private server: RunningAgentServer | null = null
  private error: string | null = null
  private readonly pending = new Map<string, Pending>()
  private readonly sessions = new Map<string, Session>()
  /** Each agent program's last active session, by its MCP client name, and
   *  when (SIHIRBAZ-PLAN.md, 4: "agent connected, last at 14:32"); kept after
   *  its session ends, dropped with a new key. */
  private readonly seenBy = new Map<string, number>()
  /** The latest request refused for its key (401) or an unknown session (404). */
  private lastRefused: { why: 'key' | 'session'; at: number } | null = null
  private refusedToldAt = 0
  /** The one word owed for refusals that came inside the second (refused). */
  private refusedLater: ReturnType<typeof setTimeout> | null = null
  /** One start or stop at a time: two quick toggles must not race. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: AgentHostDeps) {}

  private async load(): Promise<AgentSettings> {
    this.settings ??= await readAgentSettings(this.deps.userData())
    return this.settings
  }

  /** At launch: the server starts when the user had it on (or --agent). */
  init(): Promise<void> {
    return this.queue(async () => {
      const s = await this.load()
      if (s.enabled || this.deps.forced) await this.start(s)
    })
  }

  setEnabled(on: boolean): Promise<AgentStatus> {
    return this.queue(async () => {
      const s = await this.load()
      s.enabled = on
      await writeAgentSettings(this.deps.userData(), s).catch(() => undefined)
      // (Off is off, also in a run started with --agent: that switch only
      // means "on at launch". Phase 4B: the switch must close the port.)
      if (on) await this.start(s)
      else await this.stop()
      return this.statusOf(s)
    })
  }

  /** What a session needs to connect (phase 4B: the session's own config
   *  file). Null while the server is not running. */
  connection(): Promise<{ url: string; token: string; port: number } | null> {
    return this.queue(async () => {
      const s = await this.load()
      return this.server ? { url: connectCommands(this.deps.port, s.token, this.deps.name).url, token: s.token, port: this.deps.port } : null
    })
  }

  status(): Promise<AgentStatus> {
    return this.queue(async () => this.statusOf(await this.load()))
  }

  /** The agent working from outside (a Claude Code or a Codex that has the
   *  app registered…): the latest session that asked for the tools or called
   *  one, heard from in the last EXTERNAL_QUIET_MS. */
  external(now = Date.now()): { client: string; seen: number } | null {
    let best: Session | null = null
    for (const s of this.sessions.values()) {
      if (!s.active || now - (s.seen ?? 0) > EXTERNAL_QUIET_MS) continue
      if (!best || (s.seen ?? 0) > (best.seen ?? 0)) best = s
    }
    return best ? { client: best.client, seen: best.seen ?? 0 } : null
  }

  /** What the registration check compares with (main process only: it
   *  holds the key). */
  key(): Promise<{ url: string; token: string; running: boolean }> {
    return this.queue(async () => {
      const s = await this.load()
      return { url: connectCommands(this.deps.port, s.token, this.deps.name).url, token: s.token, running: !!this.server }
    })
  }

  /** Whether a refused key starts repairing the detected agents (default on). */
  autoRepairOn(): Promise<boolean> {
    return this.queue(async () => (await this.load()).autoRepair !== false)
  }

  /** Leaves auto-repair on or off for the next refusals. */
  setAutoRepair(on: boolean): Promise<boolean> {
    return this.queue(async () => {
      const s = await this.load()
      s.autoRepair = on
      await writeAgentSettings(this.deps.userData(), s).catch(() => undefined)
      return s.autoRepair
    })
  }

  /** A new key (DIS-MCP-PLAN.md, 5): written first, then a running server
   *  starts again with it; every open session ends. The key before it keeps
   *  working for PREVIOUS_TOKEN_GRACE_MS (an agent reconnecting just then is
   *  not cut off mid-turn); after that only the new one opens the door. */
  renewKey(): Promise<AgentStatus> {
    return this.queue(async () => {
      const s = await this.load()
      const next: AgentSettings = { ...s, token: newToken(), previous: s.token, previousUntil: Date.now() + PREVIOUS_TOKEN_GRACE_MS }
      await writeAgentSettings(this.deps.userData(), next)
      this.settings = next
      // (What was heard before is of the old key.)
      this.seenBy.clear()
      this.lastRefused = null
      if (this.server) {
        await this.stop()
        await this.start(next)
      }
      this.deps.changed?.()
      return this.statusOf(next)
    })
  }

  private touch(id: string, active: boolean): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.seen = Date.now()
    if (active) {
      this.seenBy.delete(s.client)
      this.seenBy.set(s.client, s.seen)
      // (A few programs at most: the oldest goes past 16 names.)
      if (this.seenBy.size > 16) this.seenBy.delete(this.seenBy.keys().next().value as string)
    }
    if (active && !s.active) {
      s.active = true
      this.deps.changed?.()
    }
  }

  /** A refused request (agent-server.ts): only its kind and time are kept.
   *  The windows are told at most once a second (a local program sending
   *  401s without end must not flood them), and the latest one is always
   *  told: a refusal inside that second is told when it ends. (Before, it
   *  was kept but never told: a 404 a moment after a 401 left the wizard
   *  saying "old key" until something else changed.) */
  refused(why: 'key' | 'session', now = Date.now()): void {
    this.lastRefused = { why, at: now }
    // (A key refused: a registration somewhere holds an old one. The app can
    // repair the detected agents' own files; the request that was just
    // refused still needs its program to reconnect.)
    if (why === 'key') this.deps.keyRefused?.()
    const wait = 1_000 - (now - this.refusedToldAt)
    if (wait <= 0) {
      this.refusedToldAt = now
      this.deps.changed?.()
      return
    }
    if (this.refusedLater) return
    this.refusedLater = setTimeout(() => {
      this.refusedLater = null
      this.refusedToldAt = Date.now()
      this.deps.changed?.()
    }, Math.min(wait, 1_000))
    this.refusedLater.unref?.()
  }

  /** What the connection wizard reads: each program's last active session
   *  (latest first) and the latest refusal. No key, no session id. */
  heard(): { seen: { client: string; at: number }[]; refused: { why: 'key' | 'session'; at: number } | null } {
    const seen = [...this.seenBy].map(([client, at]) => ({ client, at })).sort((a, b) => b.at - a.at)
    return { seen, refused: this.lastRefused ? { ...this.lastRefused } : null }
  }

  listed(id: string): void {
    this.touch(id, true)
  }

  private queue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job)
    this.chain = next.catch(() => undefined)
    return next
  }

  private statusOf(s: AgentSettings): AgentStatus {
    const c = connectCommands(this.deps.port, s.token, this.deps.name)
    return { enabled: s.enabled, running: !!this.server, port: this.deps.port, url: c.url, error: this.error }
  }

  private async start(s: AgentSettings): Promise<void> {
    if (this.server) return
    // The token must outlive this run: the agent's own settings hold it.
    await writeAgentSettings(this.deps.userData(), s).catch(() => undefined)
    // (A previous key only while its grace lasts.)
    const prev = s.previous && s.previousUntil !== undefined && s.previousUntil > Date.now() ? { previous: s.previous, previousUntil: s.previousUntil } : {}
    try {
      this.server = await startAgentServer({ port: this.deps.port, token: s.token, ...prev, version: this.deps.version, sessions: this, call: (tool, args, session, signal) => this.call(tool, args, session, signal) })
      this.error = null
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      this.error = code === 'EADDRINUSE' ? `Port ${this.deps.port} is in use by another program.` : e instanceof Error ? e.message : 'The agent server could not start.'
    }
  }

  private async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.error = null
    // Every page that took part: its calls in flight are cancelled there, and
    // it is told agent access is off (it stops analyses and the agent's jobs,
    // forgets its sessions; a waiting draft stays for the user). G7.
    const pages = new Map<number, Electron.WebContents>()
    for (const s of this.sessions.values()) if (s.win && !s.win.isDestroyed()) pages.set(s.win.webContents.id, s.win.webContents)
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      if (!p.contents.isDestroyed()) {
        p.contents.send('agent:cancel', id)
        pages.set(p.contentsId, p.contents)
      }
      p.resolve(errorResult(ACCESS_OFF))
      this.pending.delete(id)
    }
    for (const c of pages.values()) if (!c.isDestroyed()) c.send('agent:session', { kind: 'off' })
    const outside = [...this.sessions.values()].some((s) => s.active)
    this.sessions.clear()
    if (outside) this.deps.changed?.()
    await server?.close()
  }

  /** Tells a session's page it is gone (G9): the page drops what it kept. */
  private ended(s: Session | undefined): void {
    if (s?.win && !s.win.isDestroyed()) s.win.webContents.send('agent:session', { kind: 'ended', id: s.id })
  }

  // ---- sessions (AgentSessions) -------------------------------------------

  open(client: string): string {
    const id = randomUUID()
    const name = client.slice(0, 80) || 'agent'
    const forget = (s: Session): void => {
      this.ended(s)
      this.sessions.delete(s.id)
    }
    // Sessions of an agent that went away without saying so are forgotten —
    // a client's OWN first (phase 4A.11, S2: one client opening session
    // after session ended every other client's): a client keeps at most
    // SESSIONS_PER_CLIENT, and when the server is full one of the opener's
    // goes before anyone else's. Which one: evictable() (D22, K5) — the
    // quietest, never one with a call waiting. When every session of the
    // client has a call waiting none is ended (the client then has more than
    // its number, up to the server's).
    const busy = (sid: string): boolean => {
      for (const p of this.pending.values()) if (p.session === sid) return true
      return false
    }
    const drop = (list: Session[]): boolean => {
      const gone = evictable(list, busy)
      if (gone !== null) forget(this.sessions.get(gone)!)
      return gone !== null
    }
    const own = [...this.sessions.values()].filter((s) => s.client === name)
    if (own.length >= SESSIONS_PER_CLIENT) drop(own)
    if (this.sessions.size >= SESSIONS_MAX) {
      const all = [...this.sessions.values()]
      // (The server's own limit holds: with every session busy, the one
      // silent the longest goes after all.)
      if (!drop(all.filter((s) => s.client === name)) && !drop(all)) forget(all.reduce((a, b) => ((a.seen ?? a.created) <= (b.seen ?? b.created) ? a : b)))
    }
    this.sessions.set(id, { id, client: name, created: Date.now(), defsChars: 0, win: null, seen: Date.now() })
    return id
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  end(id: string): void {
    const s = this.sessions.get(id)
    this.ended(s)
    this.sessions.delete(id)
    if (s?.active) this.deps.changed?.()
  }

  /** The session of a request without a session header (an older client). */
  fallback(): string {
    if (!this.sessions.has('default')) this.sessions.set('default', { id: 'default', client: 'agent', created: Date.now(), defsChars: 0, win: null })
    return 'default'
  }

  sent(id: string, chars: number): void {
    const s = this.sessions.get(id)
    if (s) s.defsChars += chars
  }

  /** One tool call: asked of the session's window, answered when it replies. */
  private call(tool: string, args: Record<string, unknown>, sessionId: string, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return Promise.resolve(errorResult(GIVEN_UP))
    const s = this.sessions.get(sessionId)
    if (!s) return Promise.resolve(errorResult('This session is closed: connect again.'))
    this.touch(sessionId, true)
    s.called = true
    if (s.win && s.win.isDestroyed()) return Promise.resolve(errorResult(`The ${PRODUCT_NAME} window this session worked in was closed. Connect again to work in another one.`))
    let win = s.win
    let projectPath: string | null = null
    if (!win) {
      const target = this.deps.target()
      if (!target || target.win.isDestroyed()) return Promise.resolve(errorResult(`No ${PRODUCT_NAME} editor window is open.`))
      win = s.win = target.win
      projectPath = target.projectPath
    } else projectPath = this.deps.projectPathOf?.(win) ?? null
    let mine = 0
    for (const p of this.pending.values()) if (p.session === s.id) mine++
    if (mine >= SESSION_CALLS_MAX) return Promise.resolve(errorResult(`${mine} calls of this session are still waiting for ${PRODUCT_NAME}: wait for their answers before sending more.`))
    const id = randomUUID()
    const contents = win.webContents
    // The wait tool has its own time (agent/wait.ts: the seconds it waits and
    // a margin, so the page answers "nothing yet" first); every other call
    // the usual one.
    const timeout = tool === 'wait' ? waitBudgetMs(args.seconds, s.client) : (this.deps.timeoutMs ?? CALL_TIMEOUT_MS)
    const deadline = Date.now() + timeout
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        // The page stops it and never does it later; whether it did it in
        // time is the page's to say (it refuses an edit too close to the
        // deadline), so the agent is told to look, not "nothing applied".
        if (!contents.isDestroyed()) contents.send('agent:cancel', id)
        resolve(errorResult(NO_ANSWER(Math.round(timeout / 1000))))
      }, timeout)
      this.pending.set(id, { session: s.id, contentsId: contents.id, contents, resolve, timer })
      // The agent gave the call up: the page stops it now (a wait that had
      // just answered gives back what it took: agent/host.ts).
      signal?.addEventListener(
        'abort',
        () => {
          const p = this.pending.get(id)
          if (!p) {
            if (!contents.isDestroyed()) contents.send('agent:cancel', id)
            return
          }
          clearTimeout(p.timer)
          this.pending.delete(id)
          if (!contents.isDestroyed()) contents.send('agent:cancel', id)
          resolve(errorResult(GIVEN_UP))
        },
        { once: true }
      )
      contents.send('agent:call', { id, tool, args, projectPath, session: { id: s.id, client: s.client, defsChars: s.defsChars }, deadline, budget: timeout })
    })
  }

  /** The page's answer. Only the window that was asked may answer a call. */
  answer(contentsId: number, id: unknown, result: unknown): void {
    if (typeof id !== 'string') return
    const p = this.pending.get(id)
    if (!p || p.contentsId !== contentsId) return
    clearTimeout(p.timer)
    this.pending.delete(id)
    // Checked again in agent-protocol.ts (cleanToolResult) before it leaves.
    p.resolve(result as ToolResult)
  }

  /** A window closed (or its page died): its open calls end now. */
  windowGone(contentsId: number): void {
    for (const [id, p] of this.pending) {
      if (p.contentsId !== contentsId) continue
      clearTimeout(p.timer)
      this.pending.delete(id)
      p.resolve(errorResult(`The ${PRODUCT_NAME} window closed before it answered.`))
    }
  }

  close(): Promise<void> {
    return this.queue(() => this.stop())
  }
}
