// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent server: one HTTP endpoint on this computer only, where an AI agent
// the user runs (Claude Code, Codex, …) reaches the open project through the
// tools of agent-protocol.ts.
//
// Security (SECURITY-REVIEW.md, "Agent server"):
// - Off unless the user turned it on (or launched with --agent).
// - Listens on 127.0.0.1 only: nothing on the network can connect.
// - Every request needs the secret token of this profile (agent.json).
// - A request that carries an Origin header is refused: that is a web page in
//   a browser, and no page may drive the editor. The Host header must be this
//   loopback address too (DNS rebinding).
// - It is a server, not a client: Snipp still opens no connection to anywhere.
//   The renderer's own firewall (network.ts) is unchanged.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { handleRpc, type CallTool } from './agent-protocol'
import { AGENT_ID, PRODUCT_NAME } from '../shared/product'
import { SECRET_FILE_MODE } from './platform-system'
import { renameWithRetry, tempPathFor } from './safe-write'

export const AGENT_PATH = '/mcp'
const MAX_BODY_BYTES = 1024 * 1024
/** How long a client has to send a whole request, headers and body
 *  (security patch, item 8). Not the time a call may take to be answered. */
export const REQUEST_TIMEOUT_MS = 10_000
/** Connections held at a time; one over is dropped at once. */
export const CONNECTIONS_MAX = 64

export interface AgentSettings {
  enabled: boolean
  token: string
  /** A key that still opens the door after a renew (until previousUntil):
   *  an agent reconnecting in the first minutes is not cut off mid-turn. */
  previous?: string
  previousUntil?: number
  /** A refused key starts a repair of the detected agents' registrations
   *  (default true: absent means on). */
  autoRepair?: boolean
}

/** How long the key before a renew keeps working (agent-server.ts). */
export const PREVIOUS_TOKEN_GRACE_MS = 10 * 60_000

export const newToken = (): string => randomBytes(32).toString('base64url')

const TOKEN_RE = /^[A-Za-z0-9_-]{32,}$/

const settingsFile = (dir: string): string => path.join(dir, 'agent.json')
const backupFile = (dir: string): string => path.join(dir, 'agent.json.bak')

function parsed(raw: unknown): AgentSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<AgentSettings>
  if (typeof o.token !== 'string' || !TOKEN_RE.test(o.token)) return null
  const out: AgentSettings = { enabled: o.enabled === true, token: o.token }
  // (A previous key is trusted only with its own time; without one it is
  // never accepted.)
  if (typeof o.previous === 'string' && TOKEN_RE.test(o.previous) && typeof o.previousUntil === 'number' && Number.isFinite(o.previousUntil)) {
    out.previous = o.previous
    out.previousUntil = o.previousUntil
  }
  if (typeof o.autoRepair === 'boolean') out.autoRepair = o.autoRepair
  return out
}

/** This profile's agent settings. The token is stable across launches: a
 *  missing file is written at once, and a damaged one is recovered from the
 *  backup the last write kept (a new token only when neither is readable).
 *  Before, a damaged file read as "off, with a NEW key" on every launch:
 *  every agent the user had registered was refused with 401. */
export async function readAgentSettings(dir: string): Promise<AgentSettings> {
  try {
    const raw = parsed(JSON.parse(await fs.readFile(settingsFile(dir), 'utf8')))
    if (raw) return raw
  } catch {
    /* no settings, or damaged */
  }
  try {
    const kept = parsed(JSON.parse(await fs.readFile(backupFile(dir), 'utf8')))
    if (kept) {
      // (The backup is the same settings the last good write kept: put it
      // back, so the next read finds it whole.)
      await writeAgentSettings(dir, kept).catch(() => undefined)
      return kept
    }
  } catch {
    /* no backup either */
  }
  const fresh: AgentSettings = { enabled: false, token: newToken() }
  // (Written now: a token that is not kept would change at every launch.)
  await writeAgentSettings(dir, fresh).catch(() => undefined)
  return fresh
}

/** Written readable by the user alone (phase 10a, P10: on macOS / Linux the
 *  default mode let other local users read the token; a file made before
 *  is narrowed too).
 *
 *  Whole or not at all (D22, the audit's K13): fs.writeFile truncates and
 *  writes in place, so a crash in the middle left a damaged file — read at
 *  the next launch as "off, with a NEW key", and every agent the user had
 *  registered got 401. The new text goes to a temp file beside it (made
 *  with the secret's mode from the start), is flushed to the disk and is
 *  renamed over the old one, as safe-write.ts does for project files. */
export async function writeAgentSettings(dir: string, settings: AgentSettings): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  const text = JSON.stringify(settings, null, 2) + '\n'
  const write = async (file: string): Promise<void> => {
    const tmp = tempPathFor(file)
    let fh: Awaited<ReturnType<typeof fs.open>> | null = null
    try {
      fh = await fs.open(tmp, 'w', SECRET_FILE_MODE)
      await fh.writeFile(text, 'utf8')
      await fh.sync()
      await fh.close()
      fh = null
      await renameWithRetry(tmp, file)
    } catch (err) {
      if (fh) await fh.close().catch(() => undefined)
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      throw err
    }
    await fs.chmod(file, SECRET_FILE_MODE).catch(() => undefined)
  }
  // (The backup is the same settings, written only after the file itself is
  // in place: a damaged file then reads back as the same key, not a new one.)
  await write(settingsFile(dir))
  await write(backupFile(dir)).catch(() => undefined)
}

export type Refusal = { status: number; message: string; headers?: Record<string, string> }

function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Is this request allowed to reach the tools? null: yes. Pure, so the tests
 * cover every refusal without a socket.
 */
export function refusalFor(
  req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined> },
  token: string,
  port: number,
  previous?: string,
  previousUntil?: number
): Refusal | null {
  const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '')
  // A browser page always sends Origin on a cross-site POST; an agent never does.
  if (one(req.headers.origin)) return { status: 403, message: 'Requests from web pages are not accepted.' }
  const host = one(req.headers.host).toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return { status: 403, message: 'Unknown host.' }
  const url = (req.url ?? '').split('?')[0]
  if (url !== AGENT_PATH) return { status: 404, message: 'Not found.' }
  const auth = one(req.headers.authorization)
  const given = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? ''
  // (For a while after a renew the key before it still opens the door: an
  // agent that reconnects in the meantime is not refused mid-work.)
  const grace = previous && previousUntil !== undefined && Date.now() < previousUntil
  if (!given || (!sameToken(given, token) && !(grace && sameToken(given, previous)))) return { status: 401, message: 'Missing or wrong token.', headers: { 'WWW-Authenticate': 'Bearer' } }
  // No server-to-agent stream is offered: POST, and DELETE to end a session.
  if (req.method !== 'POST' && req.method !== 'DELETE') return { status: 405, message: 'Use POST.', headers: { Allow: 'POST, DELETE' } }
  return null
}

/** The agent sessions the server keeps (agent-host.ts). */
export interface AgentSessions {
  /** initialize: a new session for this agent program; its id. */
  open(client: string): string
  has(id: string): boolean
  end(id: string): void
  /** The session of a request that names none (an older client). */
  fallback(): string
  /** Characters of definitions sent to it (initialize, tools/list). */
  sent(id: string, chars: number): void
  /** The session asked for the tool list: an agent about to work. */
  listed?(id: string): void
  /** A request was refused for its key (401) or for a session this server
   *  no longer knows (404, an agent window older than the server): what the
   *  connection wizard tells (SIHIRBAZ-PLAN.md, 4). Nothing of the request. */
  refused?(why: 'key' | 'session'): void
}

export const SESSION_HEADER = 'mcp-session-id'

/** What is still taken in (and thrown away) of a body that was refused as
 *  too large, so that its sender gets to read the 413; past this the
 *  connection is cut. */
const DISCARD_MAX_BYTES = 16 * 1024 * 1024

/** The request's body, or null when it is over 1 MB. An oversized body is
 *  not kept: the answer (413) goes out at once and the rest is read and
 *  thrown away up to DISCARD_MAX_BYTES (security patch, item 8, K-G6: the
 *  request used to be destroyed first, so the 413 never reached the client). */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    const refuse = (): void => {
      over = true
      chunks.length = 0
      resolve(null)
    }
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) refuse()
    req.on('data', (c: Buffer) => {
      size += c.length
      if (over) {
        if (size > DISCARD_MAX_BYTES) req.destroy()
        return
      }
      if (size > MAX_BODY_BYTES) return refuse()
      chunks.push(c)
    })
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', () => resolve(null))
  })
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    res.writeHead(status, headers)
    res.end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store', ...headers })
  res.end(text)
}

export interface AgentServerOptions {
  port: number
  token: string
  /** The key before a renew, accepted until previousUntil (ms). */
  previous?: string
  previousUntil?: number
  /** A tool call, with the session it belongs to. `signal` ends when the
   *  agent gave the call up (its connection closed before the answer, or it
   *  sent notifications/cancelled): GONDER-PLAN.md, 6. */
  call: (name: string, args: Record<string, unknown>, session: string, signal?: AbortSignal) => ReturnType<CallTool>
  version: string
  sessions: AgentSessions
}

export interface RunningAgentServer {
  port: number
  close: () => Promise<void>
}

/** Starts the endpoint. Rejects when the port is taken (another copy of the
 *  app, or another program): the caller reports it, it is never fatal. */
export function startAgentServer(opts: AgentServerOptions): Promise<RunningAgentServer> {
  const firstRequest = new WeakMap<object, ReturnType<typeof setTimeout>>()
  // Tool calls under way, by session and JSON-RPC id: an agent's
  // notifications/cancelled names one (MCP: its connection may stay open).
  const inFlight = new Map<string, AbortController>()
  const flightKey = (session: string, id: unknown): string => `${session} ${typeof id === 'number' || typeof id === 'string' ? String(id) : ''}`
  // A client has ten seconds to send a whole request, headers and body
  // (security patch, item 8, K-G7: Node's default left a half-sent request
  // open for a minute and a half); looked at every second. The time a call
  // may take to be ANSWERED is not this (agent-host.ts CALL_TIMEOUT_MS).
  const server: Server = createServer({ headersTimeout: REQUEST_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS, connectionsCheckingInterval: 1_000 }, (req, res) => {
    void (async () => {
      const refusal = refusalFor(req, opts.token, opts.port, opts.previous, opts.previousUntil)
      if (refusal) {
        if (refusal.status === 401) opts.sessions.refused?.('key')
        send(res, refusal.status, { error: refusal.message }, refusal.headers)
        return
      }
      const named = req.headers[SESSION_HEADER]
      const asked = (Array.isArray(named) ? named[0] : named)?.trim() || null
      if (req.method === 'DELETE') {
        if (asked) opts.sessions.end(asked)
        send(res, 200, {})
        return
      }
      const body = await readBody(req)
      if (body === null) {
        send(res, 413, { error: 'Request too large.' })
        return
      }
      let message: unknown
      try {
        message = JSON.parse(body)
      } catch {
        send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } })
        return
      }
      // Which session: initialize opens one (said back in the header); a
      // request naming one this server does not know is told to start over
      // (404, as MCP says); one naming none shares a fallback session.
      const method = message && typeof message === 'object' && !Array.isArray(message) ? (message as { method?: unknown }).method : undefined
      let session: string
      const headers: Record<string, string> = {}
      if (method === 'initialize') {
        const info = (message as { params?: { clientInfo?: { name?: unknown } } }).params?.clientInfo
        session = opts.sessions.open(typeof info?.name === 'string' ? info.name : 'agent')
        headers['Mcp-Session-Id'] = session
      } else if (asked) {
        if (!opts.sessions.has(asked)) {
          opts.sessions.refused?.('session')
          send(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found: initialize again.' } })
          return
        }
        session = asked
      } else session = opts.sessions.fallback()
      // The agent gave a call up: what the page does for it stops (a wait
      // gives back what it had taken, so nothing sent is lost).
      if (method === 'notifications/cancelled') {
        const asked = (message as { params?: { requestId?: unknown } }).params?.requestId
        inFlight.get(flightKey(session, asked))?.abort()
      }
      const rpcId = (message as { id?: unknown }).id
      const abort = new AbortController()
      const key = method === 'tools/call' ? flightKey(session, rpcId) : null
      if (key) inFlight.set(key, abort)
      // The connection closed before the answer went: the call is given up too.
      res.on('close', () => {
        if (!res.writableFinished) abort.abort()
      })
      let response: Awaited<ReturnType<typeof handleRpc>>
      try {
        response = await handleRpc(message, {
          call: (name, args) => opts.call(name, args, session, abort.signal),
          serverInfo: { name: AGENT_ID, title: PRODUCT_NAME, version: opts.version }
        })
      } finally {
        if (key && inFlight.get(key) === abort) inFlight.delete(key)
      }
      if (response === null) {
        send(res, 202, undefined, headers)
        return
      }
      // What the agent is sent once per session: its fixed cost (4A.6).
      if (method === 'initialize' || method === 'tools/list') opts.sessions.sent(session, JSON.stringify(response).length)
      if (method === 'tools/list' && 'result' in response) opts.sessions.listed?.(session)
      send(res, 200, response, headers)
    })().catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'Internal error.' })
      else res.end()
    })
  })
  // An agent may hold a connection open between calls; a stuck one must not
  // keep the app from quitting.
  server.keepAliveTimeout = 5_000
  // No more than this many connections at a time: one over is dropped at
  // once, so a local program cannot pile sockets up without end.
  server.maxConnections = CONNECTIONS_MAX
  // A connection that brings no request at all goes after the same ten
  // seconds (Node's own timers start with a request's first byte). Its first
  // request ends the wait; nothing listens on the socket itself.
  server.on('connection', (socket) => {
    const timer = setTimeout(() => socket.destroy(), REQUEST_TIMEOUT_MS)
    timer.unref()
    firstRequest.set(socket, timer)
    socket.once('close', () => clearTimeout(timer))
  })
  server.on('request', (req) => {
    clearTimeout(firstRequest.get(req.socket))
    firstRequest.delete(req.socket)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve({
        port: opts.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            server.closeAllConnections()
          })
      })
    })
  })
}

/** What the user pastes into a terminal to connect an agent (shown in the
 *  app; the token is this computer's own secret). Claude Code's line is
 *  checked against `claude mcp add --help` (2.1.318); other agents get the
 *  address and the header until their own line is checked (PLAN.md 0.6). */
export function connectCommands(port: number, token: string, name = 'snipp'): { url: string; header: string; claude: string } {
  const url = `http://127.0.0.1:${port}${AGENT_PATH}`
  const header = `Authorization: Bearer ${token}`
  return { url, header, claude: `claude mcp add --transport http ${name} ${url} --header "${header}"` }
}
