// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The in-app chat's saved sessions (AGENT-CHAT-PLAN.md): each chat's
// transcript and the Claude Code session it continues, in the profile, one
// small file per chat and per project. A rewind cuts that CLI session back
// to the message the user picked, so the next process resumes the shortened
// conversation rather than the one they took out.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ChatSessionDraft, ChatSessionMeta, ChatSessionRecord } from '../shared/agent-chat'

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ITEMS = 4000
const MAX_TITLE = 80
const MAX_RECORD_CHARS = 40 * 1024 * 1024
/** How far a message's own time may be from its line's (process start and
 *  queueing sit between them). */
const TIME_WINDOW_MS = 120_000

export const isSessionKey = (raw: unknown): raw is string => typeof raw === 'string' && KEY.test(raw)

export function chatsDir(userData: string): string {
  return path.join(userData, 'chat-sessions')
}

/** The page's draft, made safe: a session key, a short title, the CLI's own
 *  uuid (or none) and the items the page drew. The project is the window's. */
export function cleanDraft(raw: unknown, project: string): ChatSessionRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Partial<ChatSessionDraft>
  if (!isSessionKey(d.key) || !Array.isArray(d.items) || d.items.length > MAX_ITEMS) return null
  const title = typeof d.title === 'string' ? d.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : ''
  return {
    key: d.key,
    title,
    project,
    sessionId: isSessionKey(d.sessionId) ? d.sessionId : '',
    updatedAt: Date.now(),
    items: d.items
  }
}

export async function saveSession(userData: string, record: ChatSessionRecord): Promise<boolean> {
  let text: string
  try {
    text = JSON.stringify({ version: 1, ...record })
  } catch {
    return false
  }
  if (text.length > MAX_RECORD_CHARS) return false
  const file = path.join(chatsDir(userData), `${record.key}.json`)
  try {
    await fsp.mkdir(chatsDir(userData), { recursive: true })
    await fsp.writeFile(`${file}.tmp`, text, 'utf8')
    await fsp.rename(`${file}.tmp`, file)
    return true
  } catch {
    return false
  }
}

function readFileRecord(file: string): ChatSessionRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ChatSessionRecord
    if (!raw || !isSessionKey(raw.key) || !Array.isArray(raw.items)) return null
    if (path.basename(file) !== `${raw.key}.json`) return null
    return {
      key: raw.key,
      title: typeof raw.title === 'string' ? raw.title : '',
      project: typeof raw.project === 'string' ? raw.project : '',
      sessionId: isSessionKey(raw.sessionId) ? raw.sessionId : '',
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
      items: raw.items
    }
  } catch {
    return null
  }
}

/** This project's chats, newest first. */
export function listSessions(userData: string, project: string): ChatSessionMeta[] {
  let names: string[]
  try {
    names = fs.readdirSync(chatsDir(userData))
  } catch {
    return []
  }
  const out: ChatSessionMeta[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const record = readFileRecord(path.join(chatsDir(userData), name))
    if (!record || record.project !== project) continue
    out.push({ key: record.key, title: record.title, project: record.project, sessionId: record.sessionId, updatedAt: record.updatedAt })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function readSession(userData: string, key: string, project: string): ChatSessionRecord | null {
  if (!isSessionKey(key)) return null
  const record = readFileRecord(path.join(chatsDir(userData), `${key}.json`))
  return record && record.project === project ? record : null
}

/** Removes this project's chat; the record it removed (for the caller's own
 *  cleanup) or null. */
export async function removeSession(userData: string, key: string, project: string): Promise<ChatSessionRecord | null> {
  const record = readSession(userData, key, project)
  if (!record) return null
  await fsp.rm(path.join(chatsDir(userData), `${record.key}.json`), { force: true }).catch(() => undefined)
  return record
}

/** The CLI's own transcript of one session, in the folder it stores the
 *  conversations of this project's directory. */
export function cliSessionFile(cwd: string, sessionId: string): string | null {
  if (!isSessionKey(sessionId)) return null
  return path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`)
}

/** The chat message one line of the CLI's transcript holds, when it is the
 *  chat's own: not a tool result, not a subagent's. */
export function userLineOf(line: string): { at: number; text: string } | null {
  let message: { type?: unknown; isSidechain?: unknown; timestamp?: unknown; message?: { content?: unknown } }
  try {
    message = JSON.parse(line) as typeof message
  } catch {
    return null
  }
  if (!message || message.type !== 'user' || message.isSidechain) return null
  const content = message.message?.content
  const at = Date.parse(String(message.timestamp ?? '')) || 0
  if (typeof content === 'string') return { at, text: content }
  if (!Array.isArray(content)) return null
  if (content.some((part) => !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'tool_result')) return null
  const text = content
    .filter((part): part is { type: string; text: string } => !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string')
    .map((part) => part.text)
    .join('\n')
  return { at, text }
}

/** The line to cut at: the target message's own line, everything from it on
 *  removed. Matched by its words and its time (a repeated message would
 *  otherwise cut the wrong one). -1 when it is not found. */
export function findRewindCut(lines: readonly string[], target: { at: number; text: string }): number {
  const want = target.text.trim()
  let best = -1
  let bestDelta = Number.POSITIVE_INFINITY
  for (let i = 0; i < lines.length; i++) {
    const user = userLineOf(lines[i])
    if (!user || user.text.trim() !== want) continue
    const delta = Math.abs(user.at - target.at)
    if (delta < bestDelta) {
      bestDelta = delta
      best = i
    }
  }
  return best >= 0 && bestDelta <= TIME_WINDOW_MS ? best : -1
}

/** Cuts the CLI's transcript at `cut`: the lines before it stay, the rest go
 *  (the message and everything after). The file as it was is kept beside it
 *  as `<name>.snipp-bak`. */
export async function cutSessionFile(file: string, cut: number): Promise<{ ok: boolean; empty: boolean; error?: string }> {
  let text: string
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch {
    return { ok: false, empty: false, error: 'missing' }
  }
  const lines = text.split('\n')
  if (cut < 0 || cut >= lines.length) return { ok: false, empty: false, error: 'out-of-range' }
  const kept = lines.slice(0, cut)
  try {
    await fsp.writeFile(`${file}.snipp-bak`, text, 'utf8')
    await fsp.writeFile(file, kept.length ? `${kept.join('\n')}\n` : '', 'utf8')
  } catch {
    return { ok: false, empty: false, error: 'write-failed' }
  }
  const empty = !kept.some((line) => {
    try {
      const m = JSON.parse(line) as { type?: unknown; isSidechain?: unknown }
      return (m.type === 'user' || m.type === 'assistant') && !m.isSidechain
    } catch {
      return false
    }
  })
  return { ok: true, empty }
}

/** Removes the CLI's own transcript of this chat (deleting the session). */
export async function deleteCliSession(cwd: string, sessionId: string): Promise<void> {
  const file = cliSessionFile(cwd, sessionId)
  if (!file) return
  const root = path.resolve(os.homedir(), '.claude', 'projects') + path.sep
  if (!path.resolve(file).startsWith(root)) return
  await fsp.rm(file, { force: true }).catch(() => undefined)
}
