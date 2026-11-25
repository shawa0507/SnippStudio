// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The in-app chat as the page keeps it (AGENT-CHAT-PLAN.md): the user's
// messages (with their pictures), the agent's words, one card per tool call,
// the turn's result and the model for the next message. The main process
// owns the process; this store only draws what it reports.
import { create } from 'zustand'
import type { ChatContext, ChatEvent, ChatImage, ChatMode, ChatPhase } from '../../../shared/agent-chat'
import { CHAT_MODES } from '../../../shared/agent-chat'
import { api } from '../platform'

export interface ChatTextItem {
  kind: 'text'
  id: number
  role: 'user' | 'assistant'
  text: string
  /** A user message's pictures, as data URLs for the bubble. */
  images?: string[]
  at: number
}

export interface ChatToolItem {
  kind: 'tool'
  id: string
  name: string
  input?: unknown
  state: 'running' | 'done' | 'error'
  summary?: string
  at: number
}

/** A line of the app's own: a refusal, a result, a model change, or why the
 *  chat ended. */
export interface ChatNoteItem {
  kind: 'note'
  id: number
  tone: 'error' | 'result'
  /** A word key ('no-project', 'mcp-failed', 'model'); `text` carries its
   *  parameter (a model id, a server name). */
  code?: string
  text?: string
  seconds?: number
  costUsd?: number
  at: number
}

export interface ChatAttachment {
  id: number
  name: string
  mediaType: string
  /** Base64, as the CLI's image block takes it. */
  data: string
  /** The same as a data URL, for the bubble and the thumbnail. */
  url: string
}

export type ChatItem = ChatTextItem | ChatToolItem | ChatNoteItem

const MODEL_KEY = 'snipp-chat-model'
const SHELL_KEY = 'snipp-chat-shell'
const MODE_KEY = 'snipp-chat-mode'
const modelAtStart = (): string => {
  try {
    return localStorage.getItem(MODEL_KEY) ?? ''
  } catch {
    return ''
  }
}
const shellAtStart = (): boolean => {
  try {
    return localStorage.getItem(SHELL_KEY) === '1'
  } catch {
    return false
  }
}
const modeAtStart = (): ChatMode => {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    return (CHAT_MODES as readonly string[]).includes(saved ?? '') ? (saved as ChatMode) : 'acceptEdits'
  } catch {
    return 'acceptEdits'
  }
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const IMAGE_MAX = 8 * 1024 * 1024
const IMAGES_MAX = 4

interface ChatUi {
  items: ChatItem[]
  attachments: ChatAttachment[]
  busy: boolean
  /** The current turn has shown something (words, a tool card, an error). */
  responded: boolean
  thinking: boolean
  phase: ChatPhase
  installed: boolean
  /** A refusal code from the main process, for the status line. */
  error: string | null
  /** The model chosen here ('' = the CLI's own setting). */
  model: string
  /** The model ids the CLI's environment holds, and the one in use now. */
  models: string[]
  activeModel: string | null
  /** The slash commands the CLI advertised at its last start. */
  commands: string[]
  /** The last turn's context use against the model's window (null until a
   *  result arrives, and after a chat ends). */
  context: ChatContext | null
  /** The user turned shell commands on (Bash, no prompts). */
  shell: boolean
  setShell: (on: boolean) => Promise<void>
  /** The permission mode for the next process. */
  mode: ChatMode
  setMode: (mode: ChatMode) => Promise<void>
  draft: string
  setDraft: (text: string) => void
  setModel: (model: string) => Promise<void>
  attach: (file: File) => Promise<void>
  addImage: () => Promise<void>
  removeAttachment: (id: number) => void
  send: (text: string) => Promise<void>
  compact: () => Promise<void>
  stop: () => Promise<void>
  clear: () => void
  refresh: () => Promise<void>
  event: (event: ChatEvent) => void
}

let nextId = 1
const uid = (): number => nextId++

export const useChat = create<ChatUi>((set, get) => ({
  items: [],
  attachments: [],
  busy: false,
  responded: false,
  thinking: false,
  phase: 'off',
  installed: true,
  error: null,
  model: modelAtStart(),
  models: [],
  activeModel: null,
  commands: [],
  context: null,
  shell: shellAtStart(),
  mode: modeAtStart(),
  draft: '',
  setDraft: (draft) => set({ draft }),

  setShell: async (on) => {
    set({ shell: on })
    try {
      localStorage.setItem(SHELL_KEY, on ? '1' : '0')
    } catch {
      /* not remembered: fine */
    }
    await api?.agentChat?.setShell(on).catch(() => undefined)
    set((s) => ({
      items: [...s.items, { kind: 'note', id: uid(), tone: 'result', code: on ? 'shellOn' : 'shellOff', at: Date.now() }]
    }))
  },

  setMode: async (mode) => {
    set({ mode })
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* not remembered: fine */
    }
    await api?.agentChat?.setMode(mode).catch(() => undefined)
    set((s) => ({ items: [...s.items, { kind: 'note', id: uid(), tone: 'result', code: 'mode', text: mode, at: Date.now() }] }))
  },

  setModel: async (model) => {
    set({ model })
    try {
      localStorage.setItem(MODEL_KEY, model)
    } catch {
      /* not remembered: fine */
    }
    if (!model) return
    const result = (await api?.agentChat?.setModel(model).catch(() => null)) ?? null
    // (The CLI confirmed the switch; its next init repeats it, but the status
    // says it now.)
    if (result?.applied) set({ activeModel: model })
    set((s) => ({
      items: [...s.items, { kind: 'note', id: uid(), tone: 'result', code: result?.applied ? 'model' : 'modelNext', text: model, at: Date.now() }]
    }))
  },

  attach: async (file) => {
    const s = get()
    if (s.attachments.length >= IMAGES_MAX) {
      set((st) => ({ items: [...st.items, { kind: 'note', id: uid(), tone: 'error', code: 'imageLimit', at: Date.now() }] }))
      return
    }
    if (!IMAGE_TYPES.includes(file.type)) {
      set((st) => ({ items: [...st.items, { kind: 'note', id: uid(), tone: 'error', code: 'imageType', at: Date.now() }] }))
      return
    }
    if (file.size > IMAGE_MAX) {
      set((st) => ({ items: [...st.items, { kind: 'note', id: uid(), tone: 'error', code: 'imageTooBig', at: Date.now() }] }))
      return
    }
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    }).catch(() => '')
    if (!url) return
    const comma = url.indexOf(',')
    if (comma < 0) return
    set((st) => ({
      attachments: [...st.attachments, { id: uid(), name: file.name || 'image', mediaType: file.type, data: url.slice(comma + 1), url }]
    }))
  },

  addImage: async () => {
    const image = await api?.agentChat?.pickImage().catch(() => null)
    if (!image) return
    const s = get()
    if (s.attachments.length >= IMAGES_MAX) {
      set((st) => ({ items: [...st.items, { kind: 'note', id: uid(), tone: 'error', code: 'imageLimit', at: Date.now() }] }))
      return
    }
    set((st) => ({
      attachments: [...st.attachments, { id: uid(), name: image.name, mediaType: image.mediaType, data: image.data, url: `data:${image.mediaType};base64,${image.data}` }]
    }))
  },

  removeAttachment: (id) => set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),

  send: async (text) => {
    const trimmed = text.trim()
    const state = get()
    if ((!trimmed && !state.attachments.length) || state.busy) return
    const images: ChatImage[] = state.attachments.map((a) => ({ name: a.name, mediaType: a.mediaType, data: a.data }))
    const urls = state.attachments.map((a) => a.url)
    set((s) => ({
      draft: '',
      attachments: [],
      busy: true,
      responded: false,
      thinking: false,
      error: null,
      items: [...s.items, { kind: 'text', id: uid(), role: 'user', text: trimmed, ...(urls.length ? { images: urls } : {}), at: Date.now() }]
    }))
    const result = (await api?.agentChat?.send(trimmed, state.model, images, state.shell, state.mode).catch(() => ({ ok: false, error: 'send-failed' }))) ?? { ok: false, error: 'send-failed' }
    if (!result.ok) {
      // (The message never left: its pictures go back to the box.)
      set((s) => ({
        busy: false,
        responded: true,
        thinking: false,
        error: result.error ?? 'send-failed',
        attachments: state.attachments,
        items: [...s.items, { kind: 'note', id: uid(), tone: 'error', code: result.error ?? 'send-failed', at: Date.now() }]
      }))
    }
  },

  /** Compaction is the CLI's own (`/compact`); its answer is empty and the
   *  transcript goes on with the summary of what came before. */
  compact: async () => {
    if (get().busy) return
    await get().send('/compact')
  },

  stop: async () => {
    await api?.agentChat?.stop().catch(() => undefined)
    set((s) => ({
      busy: false,
      responded: true,
      thinking: false,
      phase: 'stopped',
      context: null,
      items: [...s.items, { kind: 'note', id: uid(), tone: 'result', code: 'stopped', at: Date.now() }]
    }))
  },

  clear: () => {
    void api?.agentChat?.stop().catch(() => undefined)
    set({ items: [], attachments: [], busy: false, responded: false, thinking: false, error: null, phase: 'off', context: null })
  },

  refresh: async () => {
    const status = (await api?.agentChat?.status().catch(() => null)) ?? null
    if (!status) return
    set({ phase: status.phase, installed: status.installed, error: status.error ?? null })
  },

  event: (event) => {
    switch (event.type) {
      case 'status': {
        if (event.phase === 'ready') {
          const failed = event.mcp?.find((m) => m.status !== 'connected')
          set((s) => ({
            phase: 'ready',
            installed: true,
            ...(event.model ? { activeModel: event.model } : {}),
            ...(event.commands?.length ? { commands: event.commands } : {}),
            items: failed ? [...s.items, { kind: 'note', id: uid(), tone: 'error', code: 'mcp-failed', text: failed.name, at: Date.now() }] : s.items
          }))
        } else {
          set({ phase: event.phase })
        }
        return
      }
      case 'text': {
        set((s) => {
          const last = s.items[s.items.length - 1]
          const items: ChatItem[] = last && last.kind === 'text' && last.role === 'assistant'
            ? [...s.items.slice(0, -1), { ...last, text: last.text.endsWith('\n') ? last.text + event.text : `${last.text}\n\n${event.text}` }]
            : [...s.items, { kind: 'text', id: uid(), role: 'assistant', text: event.text, at: Date.now() }]
          return { items, busy: true, responded: true, thinking: false }
        })
        return
      }
      case 'thinking':
        set({ thinking: true })
        return
      // Each answer of the turn restates the conversation's size; the window
      // stays the one the last result named (it changes only with the model).
      case 'usage': {
        const current = get().context
        if (current && current.window > 0) set({ context: { used: event.used, window: current.window } })
        return
      }
      case 'tool':
        set((s) => {
          const at = s.items.findIndex((x) => x.kind === 'tool' && x.id === event.id)
          if (at < 0) {
            const items: ChatItem[] = [...s.items, { kind: 'tool', id: event.id, name: event.name, input: event.input, state: event.state, summary: event.summary, at: Date.now() }]
            return { items, busy: true, responded: true, thinking: false }
          }
          const items = [...s.items]
          const old = items[at] as ChatToolItem
          items[at] = { ...old, state: event.state, ...(event.name ? { name: event.name } : {}), ...(event.summary !== undefined ? { summary: event.summary } : {}) }
          return { items, busy: true, responded: true, thinking: false }
        })
        return
      case 'result':
        set((s) => ({
          busy: false,
          responded: true,
          thinking: false,
          ...(event.context ? { context: event.context } : {}),
          items: [...s.items, { kind: 'note', id: uid(), tone: event.isError ? 'error' : 'result', code: event.isError ? 'result-failed' : 'result', seconds: event.seconds, costUsd: event.costUsd, at: Date.now() }]
        }))
        return
      case 'error':
        set((s) => ({
          busy: false,
          responded: true,
          thinking: false,
          error: event.message,
          items: [...s.items, { kind: 'note', id: uid(), tone: 'error', code: 'agent-error', text: event.message, at: Date.now() }]
        }))
        return
      case 'turn':
        set({ busy: event.state === 'start', ...(event.state === 'start' ? { responded: false } : {}), ...(event.state === 'end' ? { thinking: false } : {}) })
        return
    }
  }
}))

let listening = false
/** The chat's events, once for the whole page (App.tsx). */
export function listenChat(): void {
  if (listening || !api?.agentChat) return
  listening = true
  api.agentChat.onEvent((event) => useChat.getState().event(event))
  void useChat.getState().refresh()
  void api.agentChat.models().then((models) => {
    useChat.setState({ models: models.suggestions, ...(models.current ? { activeModel: models.current } : {}) })
  }).catch(() => undefined)
}
