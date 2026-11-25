// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The connection wizard's rules (SnippStudio SIHIRBAZ-PLAN.md, 2 and 4),
// pure: from what is known now (access, the program's registration as its
// own program reads it, Codex's key compared in the user's PowerShell, the
// sessions the server heard and the requests it refused) to the four check
// rows and the state of the five steps. No key ever comes here: only
// verdicts, program names and times. Tested in src/test/sihirbaz.test.ts.
import type { AgentInstallation, AgentRegistration, AgentSessionStatus } from '../../../../preload/index'

/** The programs the wizard knows, in the chooser's order. */
export const PROGRAMS = ['claude', 'codexCli', 'codexApp', 'opencode', 'other'] as const
export type Program = typeof PROGRAMS[number]

/** Which agent family a program is (the server knows the family by the
 *  MCP client name; both Codexes share one registration). */
export type Family = 'claude' | 'codex' | 'opencode' | 'other'
export const familyOf = (p: Program): Family => (p === 'codexCli' || p === 'codexApp' ? 'codex' : p)

/** The family of an MCP client name (the same rule as agent/holder.ts
 *  agentDisplayName). */
export function clientFamily(client: string): Family {
  if (/claude/i.test(client)) return 'claude'
  if (/codex/i.test(client)) return 'codex'
  if (/opencode/i.test(client)) return 'opencode'
  return 'other'
}

/** Programs whose own command says how they have the app registered. */
export const checkable = (p: Program): boolean => familyOf(p) === 'claude' || familyOf(p) === 'codex'

export type CodexKey = 'same' | 'different' | 'missing' | 'unknown'
export type Mark = 'ok' | 'bad' | 'none'
export type RowId = 'registered' | 'key' | 'listening' | 'connected'
/** What a row's button does: go to a step, copy the step 2 line again, turn
 *  access on, or run the line itself (the program's own reconnect). */
export type Fix = { go: 1 | 2 | 3 } | { copy: true } | { access: true } | { repair: 'claude' | 'codex' }

export interface Row {
  id: RowId
  mark: Mark
  /** The sentence: `wiz.row.<id>.<say>`. */
  say: string
  at?: number
  fix?: Fix
}

export interface Facts {
  program: Program
  running: boolean
  error: string | null
  /** The registration check's verdict (Claude Code, Codex), null before one. */
  registration: AgentRegistration | 'checking' | null
  /** Codex on Windows: does the user's variable hold this copy's key. */
  codexKey: CodexKey | null
  heard: AgentSessionStatus['heard']
  /** The user pressed "Check the connection" in this visit. */
  asked: boolean
  /** When the registration and key verdicts came (a refused key older than a
   *  check that found the key right is history). */
  checkedAt?: number | null
}

/** The family's latest active session the server heard. */
export function lastSeen(f: Pick<Facts, 'program' | 'heard'>): { client: string; at: number } | null {
  const fam = familyOf(f.program)
  return f.heard.seen.find((s) => clientFamily(s.client) === fam) ?? null
}

/** A refusal that is the latest word: newer than every session heard since
 *  (the server cannot tell which program a refused request came from, so a
 *  program that connected after it, of any family, makes it history). */
function freshRefusal(f: Facts, why: 'key' | 'session'): number | null {
  const r = f.heard.refused
  if (!r || r.why !== why) return null
  return f.heard.seen.every((s) => r.at > s.at) ? r.at : null
}

function registeredRow(f: Facts): Row {
  const id = 'registered'
  if (!checkable(f.program)) return { id, mark: 'none', say: 'manual' }
  switch (f.registration) {
    case null: return { id, mark: 'none', say: 'unchecked' }
    case 'checking': return { id, mark: 'none', say: 'checking' }
    case 'ok':
    case 'oldKey': return { id, mark: 'ok', say: 'found' }
    case 'missing': return { id, mark: 'bad', say: 'missing', fix: f.program === 'claude' ? { repair: 'claude' } : f.program.startsWith('codex') ? { repair: 'codex' } : { go: 2 } }
    case 'stale': return { id, mark: 'bad', say: 'stale', fix: f.program === 'claude' ? { repair: 'claude' } : f.program.startsWith('codex') ? { repair: 'codex' } : { go: 2 } }
    case 'notInstalled': return { id, mark: 'bad', say: 'notInstalled' }
    default: return { id, mark: 'none', say: 'unknown' }
  }
}

/** What the program's own registration says of the key: 'ok', 'old',
 *  'notSaved' (Codex's variable missing), or null (nothing to read). */
function keyVerdict(f: Facts): 'ok' | 'old' | 'notSaved' | null {
  const fam = familyOf(f.program)
  if (fam === 'claude') return f.registration === 'oldKey' ? 'old' : f.registration === 'ok' ? 'ok' : null
  if (fam === 'codex') return f.codexKey === 'different' ? 'old' : f.codexKey === 'missing' ? 'notSaved' : f.codexKey === 'same' ? 'ok' : null
  return null
}

function keyRow(f: Facts): Row {
  const id = 'key'
  const verdict = keyVerdict(f)
  const family = familyOf(f.program)
  const reconnect: Fix = family === 'claude' ? { repair: 'claude' } : family === 'codex' ? { repair: 'codex' } : { copy: true }
  if (verdict === 'old' || verdict === 'notSaved') return { id, mark: 'bad', say: verdict, fix: reconnect }
  const refused = freshRefusal(f, 'key')
  if (refused !== null && !(verdict === 'ok' && (f.checkedAt ?? 0) > refused)) return { id, mark: 'bad', say: 'refused', at: refused, fix: reconnect }
  if (verdict === 'ok' || lastSeen(f)) return { id, mark: 'ok', say: 'ok' }
  return { id, mark: 'none', say: 'later' }
}

function listeningRow(f: Facts): Row {
  const id = 'listening'
  if (f.running) return { id, mark: 'ok', say: 'ok' }
  return { id, mark: 'bad', say: f.error ? 'error' : 'off', fix: { access: true } }
}

function connectedRow(f: Facts, others: Row[]): Row {
  const id = 'connected'
  const old = freshRefusal(f, 'session')
  if (old !== null) return { id, mark: 'bad', say: 'oldWindow', at: old, fix: { go: 3 } }
  const seen = lastSeen(f)
  if (seen && f.running) return { id, mark: 'ok', say: 'ok', at: seen.at }
  // (Never connected: a cross only once the rest is right and the user asked:
  // that is when it is the one thing left to do.)
  if (f.asked && f.running && others.every((r) => r.mark !== 'bad')) return { id, mark: 'bad', say: 'never', fix: { go: 3 } }
  return { id, mark: 'none', say: 'notYet' }
}

/** The four rows of step 4, in order. */
export function checkRows(f: Facts): Row[] {
  const rows = [registeredRow(f), keyRow(f), listeningRow(f)]
  return [...rows, connectedRow(f, rows)]
}

export type StepState = 'ok' | 'now' | 'todo'

/** The five steps: each done or not; the first not done is the one to do now. */
export function stepStates(f: Facts, rows: Row[] = checkRows(f)): StepState[] {
  const row = (id: RowId): Row => rows.find((r) => r.id === id) as Row
  const connected = row('connected').mark === 'ok'
  const done = [
    f.running,
    checkable(f.program) ? row('registered').mark === 'ok' && row('key').mark !== 'bad' : connected,
    connected,
    connected && rows.every((r) => r.mark !== 'bad'),
    connected
  ]
  const now = done.findIndex((d) => !d)
  return done.map((d, i) => (d ? 'ok' : i === now ? 'now' : 'todo'))
}

/** Step 4's "Check" button is off (and says "Checking…") while a check
 *  runs: from the press, through reading the session, to the program's
 *  answer. (Before, it went off only once the registration was being read,
 *  so a press in the first part, or one right after a program was chosen,
 *  looked heard and was dropped.) */
export const checkButtonBusy = (registration: Facts['registration'], inCheck: boolean): boolean => inCheck || registration === 'checking'

/** The program to show first: the one remembered, else the first found
 *  (Claude Code; Codex: its desktop app when that is the Codex found). */
export function defaultProgram(remembered: string | null, catalog: readonly AgentInstallation[] | null, codexPath: string | null): Program {
  if (remembered && (PROGRAMS as readonly string[]).includes(remembered)) return remembered as Program
  const has = (id: AgentInstallation['id']): boolean => !!catalog?.find((e) => e.id === id)?.installed
  if (has('claude')) return 'claude'
  if (has('codex')) return codexPath && isCodexApp(codexPath) ? 'codexApp' : 'codexCli'
  if (has('opencode')) return 'opencode'
  if (has('antigravity')) return 'other'
  return 'claude'
}

/** The Codex found is the desktop app's own (a Microsoft Store package). */
export const isCodexApp = (p: string): boolean => /[\\/]WindowsApps[\\/]OpenAI\.Codex_/i.test(p)

/** "14:32": a time of day, local, 24 hours. */
export function timeOfDay(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
