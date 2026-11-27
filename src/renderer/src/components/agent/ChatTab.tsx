// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Chat tab (AGENT-CHAT-PLAN.md): the installed Claude Code CLI, talked
// to from the editor while the project is open beside it. The transcript is
// the agent's words, one card per tool call and the user's pictures; the
// input grows with what is written and keeps a long message's scroll. The
// model is the CLI's (`--model` at start, `/model` in a running chat); the
// slash menu lists what the CLI itself advertised. The process lives in the
// main process (main/agent-chat.ts); external agents are untouched.
import { useEffect, useRef, useState } from 'react'
import { Button, Icon, IconButton, InfoMark, Select, TextArea, Toggle, Tooltip, confirmDialog, useT, type StringKey } from '../../ui'
import type { ChatMode } from '../../../../shared/agent-chat'
import { connectAgent, useSession } from '../../agent/session'
import { useChat, type ChatItem, type ChatNoteItem, type ChatTextItem, type ChatToolItem } from '../../agent/chat'
import { openSettings } from '../settings/open'
import { api } from '../../platform'
import { Markdown } from './markdown-view'
import './chat.css'

/** 29469 → "29k", 1048576 → "1.0M". */
function tokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

/** The tool's own name without the server's prefix. */
function toolName(name: string): string {
  return name.includes('__') ? name.slice(name.lastIndexOf('__') + 2) : name
}

function firstOp(input: unknown): string {
  const ops = (input as { ops?: { op?: unknown }[] } | undefined)?.ops
  return ops && typeof ops[0]?.op === 'string' ? ops[0].op : 'edit'
}

function toolLabel(t: ReturnType<typeof useT>, tool: ChatToolItem): string {
  const input = (tool.input ?? {}) as { kind?: unknown; times?: unknown; ops?: unknown }
  switch (toolName(tool.name)) {
    case 'project':
      return t('agent.tool.project')
    case 'transcript':
      return t('agent.tool.transcript')
    case 'frames':
      return t('agent.tool.frames', { count: Array.isArray(input.times) ? input.times.length : 0 })
    case 'changes':
      return t('agent.tool.changes')
    case 'analyze':
      return t('agent.tool.analyze', { kind: typeof input.kind === 'string' ? input.kind : 'analyze' })
    case 'edit':
      return t('agent.tool.edit', { kind: firstOp(tool.input) })
    case 'notes':
      return t('agent.tool.notes')
    case 'job':
      return t('agent.tool.job', { kind: typeof input.kind === 'string' ? input.kind : 'job' })
    case 'media':
      return t('d22c.act.mediaImport')
    case 'wait':
      return t('agent.tool.wait')
    default:
      return t('agent.tool.other', { tool: toolName(tool.name) || 'tool' })
  }
}

const REFUSALS: Record<string, StringKey> = {
  'no-project': 'chat.err.noProject',
  'server-off': 'chat.err.serverOff',
  'claude-missing': 'chat.err.claudeMissing',
  'not-started': 'chat.err.notStarted',
  'send-failed': 'chat.err.sendFailed',
  'bad-text': 'chat.err.badText'
}

function noteText(t: ReturnType<typeof useT>, note: ChatNoteItem): string {
  const seconds = note.seconds !== undefined ? note.seconds.toFixed(1) : '—'
  switch (note.code) {
    case 'result':
      return note.costUsd !== undefined
        ? t('chat.result', { seconds, cost: `$${note.costUsd.toFixed(2)}` })
        : t('chat.result.noCost', { seconds })
    case 'result-failed':
      return t('chat.result.failed', { seconds })
    case 'stopped':
      return t('chat.stopped')
    case 'mcp-failed':
      return t('chat.mcpFailed', { name: note.text ?? '' })
    case 'agent-error':
      return t('chat.error', { why: note.text ?? '' })
    case 'model':
      return t('chat.modelSet', { model: note.text ?? '' })
    case 'modelNext':
      return t('chat.modelNext', { model: note.text ?? '' })
    case 'shellOn':
      return t('chat.shell.on')
    case 'shellOff':
      return t('chat.shell.off')
    case 'mode': {
      const label = note.text === 'auto' ? t('chat.mode.auto') : note.text === 'plan' ? t('chat.mode.plan') : t('chat.mode.acceptEdits')
      return t('chat.mode.note', { mode: label })
    }
    case 'imageLimit':
      return t('chat.imageLimit')
    case 'imageType':
      return t('chat.imageType')
    case 'imageTooBig':
      return t('chat.imageTooBig')
    case 'rewindFailed':
      return t('chat.rewindFailed')
    case 'sessionLost':
      return t('chat.sessionLost')
    default:
      return t(REFUSALS[note.code ?? ''] ?? 'chat.err.notStarted')
  }
}

/** What a message offers when it is hovered: its words on the clipboard, and
 *  for the user's own, the way back to just before it. */
function MsgActions({ item, onRewound }: { item: ChatTextItem; onRewound?: () => void }): JSX.Element {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  const items = useChat((s) => s.items)
  const rewindTo = useChat((s) => s.rewindTo)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async (): Promise<void> => {
    // (Main writes the clipboard: the page's own is refused by the app's scheme.)
    const ok = (await api?.clipboardWriteText(item.text).catch(() => false)) ?? false
    if (!ok) return
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1400)
  }
  // (The first message has nothing before it: rewinding there would end the
  // whole chat, so it asks first.)
  const rewind = async (): Promise<void> => {
    const first = items.find((x) => x.kind === 'text' && x.role === 'user')
    if (first && first.id === item.id) {
      const yes = await confirmDialog({ title: t('chat.rewindAllAsk'), message: t('chat.rewindAllText'), confirm: t('chat.rewindAllOk'), cancel: t('agent.cancel'), danger: true })
      if (!yes) return
    }
    await rewindTo(item.id)
    onRewound?.()
  }
  return (
    <div className="chat-msg-actions" data-testid="chat.actions" data-role={item.role}>
      <IconButton icon={copied ? 'check' : 'copy'} size="sm" variant="ghost" label={copied ? t('chat.copied') : t('chat.copy')} onClick={() => void copy()} testid="chat.copy" />
      {item.role === 'user' && (
        <Tooltip content={t('chat.rewind.hint')} heading={t('chat.rewind')}>
          <IconButton icon="rotate-ccw" size="sm" variant="ghost" tooltip={false} label={t('chat.rewind')} onClick={() => void rewind()} testid="chat.rewind" />
        </Tooltip>
      )}
    </div>
  )
}

function Item({ item, onRewound }: { item: ChatItem; onRewound?: () => void }): JSX.Element {
  const t = useT()
  if (item.kind === 'text') {
    return (
      <div className={`chat-msg is-${item.role}`} data-testid={`chat.msg.${item.role}`}>
        <div className="chat-msg-body">
          <div className="chat-bubble">
            {item.images?.length ? (
              <div className="chat-bubble-images">
                {item.images.map((src, i) => (
                  <img className="chat-image" src={src} alt="" key={i} />
                ))}
              </div>
            ) : null}
            {item.role === 'assistant' ? <Markdown text={item.text} /> : item.text ? <span className="chat-para">{item.text}</span> : null}
          </div>
          <MsgActions item={item} onRewound={onRewound} />
        </div>
      </div>
    )
  }
  if (item.kind === 'tool') {
    return (
      <div className="chat-tool" data-state={item.state} data-testid="chat.tool" data-tool={toolName(item.name)}>
        <Icon name={item.state === 'running' ? 'loader-circle' : item.state === 'error' ? 'circle-x' : 'check'} size={14} />
        <span className="chat-tool-text">
          <span className="chat-tool-label">{toolLabel(t, item)}</span>
          {item.summary && <span className="chat-tool-summary">{item.summary}</span>}
        </span>
      </div>
    )
  }
  return (
    <div className={`chat-note is-${item.tone}`} data-testid="chat.note" data-code={item.code}>
      {noteText(t, item)}
    </div>
  )
}

export function ChatTab(): JSX.Element {
  const t = useT()
  const items = useChat((s) => s.items)
  const attachments = useChat((s) => s.attachments)
  const busy = useChat((s) => s.busy)
  const responded = useChat((s) => s.responded)
  const thinking = useChat((s) => s.thinking)
  const phase = useChat((s) => s.phase)
  const installed = useChat((s) => s.installed)
  const error = useChat((s) => s.error)
  const draft = useChat((s) => s.draft)
  const model = useChat((s) => s.model)
  const models = useChat((s) => s.models)
  const activeModel = useChat((s) => s.activeModel)
  const commands = useChat((s) => s.commands)
  const context = useChat((s) => s.context)
  const shell = useChat((s) => s.shell)
  const setShell = useChat((s) => s.setShell)
  const mode = useChat((s) => s.mode)
  const setMode = useChat((s) => s.setMode)
  const setDraft = useChat((s) => s.setDraft)
  const setModel = useChat((s) => s.setModel)
  const attach = useChat((s) => s.attach)
  const addImage = useChat((s) => s.addImage)
  const removeAttachment = useChat((s) => s.removeAttachment)
  const send = useChat((s) => s.send)
  const compact = useChat((s) => s.compact)
  const stop = useChat((s) => s.stop)
  const clear = useChat((s) => s.clear)
  const refresh = useChat((s) => s.refresh)
  const serverOn = useSession((s) => !!s.status?.server?.running)
  const [turningOn, setTurningOn] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items, busy, thinking, responded])
  // The input grows with the message up to seven lines, then scrolls.
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    const height = Math.min(el.scrollHeight, 140)
    el.style.height = `${height}px`
    el.style.overflowY = el.scrollHeight > 140 ? 'auto' : 'hidden'
  }, [draft, phase, installed, serverOn])

  const turnOn = async (): Promise<void> => {
    setTurningOn(true)
    try {
      await connectAgent(true)
      await refresh()
    } finally {
      setTurningOn(false)
    }
  }
  const toggleShell = async (on: boolean): Promise<void> => {
    if (!on) {
      await setShell(false)
      return
    }
    const yes = await confirmDialog({
      title: t('chat.shell.askTitle'),
      message: t('chat.shell.askText'),
      confirm: t('chat.shell.askOk'),
      cancel: t('agent.cancel'),
      danger: true
    })
    if (yes) await setShell(true)
  }
  const ready = serverOn && installed
  const status =
    !installed
      ? t('chat.noClaude')
      : !serverOn
        ? t('chat.serverOff')
        : phase === 'ready'
          ? activeModel
            ? t('chat.status.readyModel', { model: activeModel })
            : t('chat.status.ready')
          : phase === 'starting'
            ? t('chat.status.starting')
            : phase === 'stopped'
              ? t('chat.status.stopped')
              : phase === 'error'
                ? t('chat.status.error', { why: error ?? t('chat.err.agentError') })
                : t('chat.status.off')

  const suggestions = [...models]
  if (model && !suggestions.includes(model)) suggestions.push(model)
  if (activeModel && !suggestions.includes(activeModel)) suggestions.push(activeModel)
  const modelOptions = [{ value: '', label: t('chat.model.default') }, ...suggestions.map((m) => ({ value: m, label: m }))]
  const modeOptions = [
    { value: 'acceptEdits', label: t('chat.mode.acceptEdits') },
    { value: 'auto', label: t('chat.mode.auto') },
    { value: 'plan', label: t('chat.mode.plan') }
  ]
  const slash =
    draft.startsWith('/') && !draft.includes(' ') && commands.length
      ? commands.filter((c) => `/${c}`.startsWith(draft.toLowerCase())).slice(0, 8)
      : []
  const contextPct = context ? Math.min(100, Math.round((context.used / context.window) * 100)) : 0

  return (
    <div className="chat-tab" data-testid="chat.tab">
      <div className="chat-head">
        <Icon name="bot" size={14} />
        <span className="chat-name">{t('chat.harness')}</span>
        <span className={`chat-phase is-${installed && serverOn ? phase : 'off'}`} data-testid="chat.phase">{status}</span>
        <InfoMark text={t('chat.hint')} testid="chat.hint" />
        <IconButton icon="plus" size="sm" variant="ghost" label={t('chat.new')} onClick={clear} testid="chat.new" />
      </div>

      {!installed && (
        <div className="agent-card">
          <div className="agent-line">{t('chat.noClaude')}</div>
          <div className="agent-row">
            <Button size="sm" variant="secondary" icon="settings" onClick={() => openSettings('agent')} testid="chat.openSettings">
              {t('chat.openSettings')}
            </Button>
          </div>
        </div>
      )}
      {installed && !serverOn && (
        <div className="agent-card">
          <div className="agent-line">{t('chat.serverOff')}</div>
          <div className="agent-row">
            <Button size="sm" variant="secondary" onClick={() => void turnOn()} disabled={turningOn} testid="chat.turnOn">
              {t('chat.turnOn')}
            </Button>
          </div>
        </div>
      )}

      <div className="chat-list" ref={list} role="log" aria-label={t('chat.name')} data-testid="chat.list">
        {items.length === 0 && <div className="chat-empty">{t('chat.empty')}</div>}
        {items.map((item) => (
          <Item key={item.id} item={item} onRewound={() => window.setTimeout(() => input.current?.focus(), 0)} />
        ))}
        {(thinking || (busy && !responded)) && (
          <div className="chat-typing" data-testid={thinking ? 'chat.thinking' : 'chat.typing'} aria-live="polite">
            <span className="chat-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {thinking ? t('chat.thinking') : t('chat.responding')}
          </div>
        )}
      </div>

      {slash.length > 0 && (
        <div className="chat-slash-menu" role="listbox" aria-label={t('chat.slash')} data-testid="chat.slash">
          {slash.map((command) => (
            <Button
              key={command}
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(`/${command} `)
                input.current?.focus()
              }}
              testid={`chat.slash.${command}`}
            >
              {`/${command}`}
            </Button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="chat-attachments" aria-label={t('chat.attach')}>
          {attachments.map((a) => (
            <div className="chat-attachment" key={a.id}>
              <img src={a.url} alt="" />
              <IconButton icon="x" size="sm" variant="ghost" className="chat-attachment-x" label={t('chat.removeImage')} onClick={() => removeAttachment(a.id)} testid={`chat.attachment.remove.${a.id}`} />
            </div>
          ))}
        </div>
      )}

      <div className="chat-composer">
        <div className="chat-input">
          <IconButton
            icon="plus"
            size="sm"
            variant="ghost"
            className="chat-add"
            label={t('chat.attach')}
            onClick={() => void addImage()}
            disabled={!ready || attachments.length >= 4}
            testid="chat.attach"
          />
          <TextArea
            ref={input}
            value={draft}
            onChange={setDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (ready && !busy) void send(draft)
              }
            }}
            onSubmit={() => {
              if (ready && !busy) void send(draft)
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
              if (!files.length) return
              e.preventDefault()
              for (const file of files) void attach(file)
            }}
            label={t('chat.input')}
            placeholder={t('chat.placeholder')}
            disabled={!ready}
            rows={1}
            testid="chat.input"
          />
          {busy ? (
            <IconButton icon="square" size="sm" variant="secondary" className="chat-send" label={t('chat.stop')} onClick={() => void stop()} testid="chat.stop" />
          ) : (
            <IconButton
              icon="send"
              size="sm"
              variant="secondary"
              className="chat-send"
              label={t('chat.send')}
              onClick={() => void send(draft)}
              disabled={!ready || (!draft.trim() && !attachments.length)}
              testid="chat.send"
            />
          )}
        </div>
        {context && (
          <div
            className={`chat-context${contextPct >= 90 ? ' is-danger' : contextPct >= 70 ? ' is-warn' : ''}`}
            title={t('chat.context.hint')}
            data-testid="chat.context"
          >
            <span className="chat-context-label" data-testid="chat.context.label">
              {t('chat.context.used', { used: tokenCount(context.used), window: tokenCount(context.window), pct: contextPct })}
            </span>
            <span className="chat-context-bar" aria-hidden="true">
              <span style={{ width: `${contextPct}%` }} />
            </span>
            {contextPct >= 80 && <span className="chat-context-note">{t('chat.context.compact')}</span>}
          </div>
        )}
        <div className="chat-meta">
          <Select value={model} options={modelOptions} onChange={(value) => void setModel(value)} label={t('chat.model')} size="sm" testid="chat.model" disabled={!ready} />
          <Select value={mode} options={modeOptions} onChange={(value) => void setMode(value as ChatMode)} label={t('chat.mode')} size="sm" testid="chat.mode" disabled={!ready} />
          <Toggle checked={shell} onChange={(on) => void toggleShell(on)} label={t('chat.shell.short')} disabled={!installed} testid="chat.shell" />
          <Button size="sm" variant="ghost" onClick={() => void compact()} disabled={!ready || busy} testid="chat.compact">
            {t('chat.compact')}
          </Button>
        </div>
      </div>
    </div>
  )
}
