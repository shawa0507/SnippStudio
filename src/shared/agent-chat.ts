// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words the in-app chat passes between the main process and the page
// (AGENT-CHAT-PLAN.md): one event per change of a turn, never the key and
// never a whole transcript kept in the main process.

export type ChatPhase = 'off' | 'starting' | 'ready' | 'stopped' | 'error'

/** The permission modes the chat offers (the CLI's own). */
export const CHAT_MODES = ['acceptEdits', 'auto', 'plan'] as const
export type ChatMode = typeof CHAT_MODES[number]

export interface ChatMcpStatus {
  name: string
  status: string
}

export type ChatEvent =
  /** The process started (`ready`), or ended (`stopped`, `error`). The init
   *  line also says the model in use and the slash commands the CLI offers. */
  | { type: 'status'; phase: ChatPhase; detail?: string; sessionId?: string; mcp?: ChatMcpStatus[]; model?: string; commands?: string[] }
  /** A finished block of the agent's own words. */
  | { type: 'text'; text: string }
  /** The agent is thinking (no words are shown). */
  | { type: 'thinking' }
  | { type: 'tool'; id: string; name: string; input?: unknown; state: 'running' | 'done' | 'error'; summary?: string }
  /** How large the conversation is after one API call of the turn: that
   *  call's prompt plus its answer. (A turn's result sums every call, so a
   *  tool loop counts the same prompt once per step; this is the real size.) */
  | { type: 'usage'; used: number }
  /** The turn ended: the result line (time, cost), whether it failed, and
   *  the context the next turn starts from. */
  | { type: 'result'; text?: string; isError: boolean; seconds?: number; costUsd?: number; turns?: number; context?: ChatContext }
  | { type: 'error'; message: string }
  /** A turn started or ended: the input box's state. */
  | { type: 'turn'; state: 'start' | 'end' }

/** The conversation's size against the model's window: the latest answer's
 *  own usage (not the turn's sum over its tool steps). */
export interface ChatContext {
  used: number
  window: number
}

/** What the page is told when it asks to start or send, or at mount. */
export interface ChatStatus {
  ok: boolean
  phase: ChatPhase
  harness: 'claude' | null
  /** The installed Claude Code CLI was found. */
  installed: boolean
  /** The project the open chat works in. */
  projectPath?: string
  /** A refusal the page turns into words: 'no-project', 'server-off',
   *  'claude-missing', 'not-started'. */
  error?: string
}

/** One picture attached to a message, as the CLI's stream-json input takes
 *  it: base64, no file path (the picture is not copied into the project). */
export interface ChatImage {
  name: string
  mediaType: string
  data: string
}

/** The models offered in the chat's picker: the CLI's own choice (empty) and
 *  the user's, from the environment the CLI reads. */
export interface ChatModels {
  current: string | null
  suggestions: string[]
}
