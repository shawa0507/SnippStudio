// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The left panel's Chats page (AGENT-CHAT-PLAN.md): this project's saved
// chats, newest first, each named by its first message. A row opens it in the
// Chat tab; the trash button deletes it, its CLI transcript too.
import { useEffect, useState } from 'react'
import type { ChatSessionMeta } from '../../../../shared/agent-chat'
import { useChat } from '../../agent/chat'
import { api } from '../../platform'
import { useStore } from '../../state/store'
import { BareButton, IconButton, confirmDialog, useT } from '../../ui'
import { requestShell } from '../app/requests'
import './chats.css'

const WHEN = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return null
  }
})()

const when = (ms: number): string => {
  if (!ms || !WHEN) return ''
  try {
    return WHEN.format(new Date(ms))
  } catch {
    return ''
  }
}

export function ChatsPage(): JSX.Element {
  const t = useT()
  const [list, setList] = useState<ChatSessionMeta[]>([])
  const current = useChat((s) => s.chatKey)
  // (The open chat's row follows it as its messages land.)
  const items = useChat((s) => s.items.length)
  const openSession = useChat((s) => s.openSession)
  const refresh = (): void => {
    void api?.agentChat?.sessions().then(setList).catch(() => undefined)
  }
  useEffect(refresh, [items])
  const open = async (key: string): Promise<void> => {
    await openSession(key)
    requestShell('inspector:open')
    useStore.getState().focusInspector('chat')
  }
  const remove = async (meta: ChatSessionMeta): Promise<void> => {
    const yes = await confirmDialog({
      title: t('chats.deleteAsk'),
      message: meta.title || t('chats.untitled'),
      confirm: t('chats.deleteOk'),
      cancel: t('agent.cancel'),
      danger: true
    })
    if (!yes) return
    await api?.agentChat?.deleteSession(meta.key).catch(() => undefined)
    // (The open one goes at once, without being saved again over the delete.)
    if (meta.key === current) {
      await api?.agentChat?.stop().catch(() => undefined)
      useChat.getState().forget()
    }
    refresh()
  }
  return (
    <div className="dock-page-body chats-page" data-testid="chats.page">
      <div className="dock-intro">
        <strong>{t('chats.title')}</strong>
      </div>
      {list.length === 0 ? (
        <p className="dock-note" data-testid="chats.empty">{t('chats.empty')}</p>
      ) : (
        <ul className="chats-list" data-testid="chats.list">
          {list.map((meta) => (
            <li key={meta.key} className={meta.key === current ? 'chats-row is-current' : 'chats-row'} data-testid="chats.row">
              <BareButton className="chats-open" onClick={() => void open(meta.key)} testid="chats.open">
                <span className="chats-title">{meta.title || t('chats.untitled')}</span>
                <span className="chats-when">{meta.key === current ? t('chats.current') : when(meta.updatedAt)}</span>
              </BareButton>
              <IconButton icon="trash" size="sm" variant="ghost" label={t('chats.delete')} onClick={() => void remove(meta)} testid="chats.delete" />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
