// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TemplateInspector } from './TemplateInspector'
import { useStore } from '../state/store'
import { NotesPanel, NotesTabBadge } from './NotesPanel'
import { useFontVersion } from './inspector/fonts'
import { ClipTab } from './inspector/clip-tab'
import { SubsTab } from './inspector/subs-tab'
import { FxTab } from './inspector/fx-tab'
import { PROJECT_PART_KEY, PART_OF, ProjectTabs } from './inspector/project-tab'
import type { ProjectPart } from './inspector/project-tab'
export { FxTab } from './inspector/fx-tab'
import { AgentTab } from './agent/AgentTab'
import { ChatTab } from './agent/ChatTab'
import { CommandBox } from './agent/CommandBox'
import { useAgentOn, useAgentTabShown } from './agent/useAgentShown'
import { useAgentStore } from '../agent/store'
import { IconButton, Tabs, useT, type TabItem } from '../ui'
import { SectionScope } from '../ui/Section'
import { isSendable } from '../notes/model'
import { useTransitionUi } from './timeline/transition-state'
import { revealIn } from '../ui/reveal'
import { watching } from './watch/watch-state'
import { motionOff } from '../ui/motion'
import { assetById } from '../types'
import { clipScopeKind, scopeOf, type ScopeKind } from './inspector/scopes'

type Tab = 'clip' | 'subs' | 'fx' | 'project' | 'tmpl' | 'notes' | 'chat' | 'agent'
/** The tabs drawn as cards (arayüz v4). */
const CARD_TABS: ReadonlySet<Tab> = new Set<Tab>(['clip', 'subs', 'fx', 'project', 'tmpl'])


export function Inspector({ onTranscribe, onCollapse }: { onTranscribe: () => void; onCollapse?: () => void }): JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<Tab>('clip')
  const [part, setPartState] = useState<ProjectPart>(() => {
    try {
      const saved = localStorage.getItem(PROJECT_PART_KEY)
      return saved === 'script' || saved === 'settings' ? saved : 'sound'
    } catch {
      return 'sound'
    }
  })
  const setPart = (p: ProjectPart): void => {
    setPartState(p)
    try {
      localStorage.setItem(PROJECT_PART_KEY, p)
    } catch {
      /* not remembered: fine */
    }
  }
  useFontVersion() // refresh font dropdowns when a custom font is imported
  const primarySelected = useStore((s) => s.selectedClipIds[0] ?? null)
  // A look layer picked while the Look tab is open stays in it: that tab
  // edits the selected look layer (a Grain move with nothing selected makes
  // one and selects it; the panel jumping to the Clip tab under the pointer
  // was the "menu slid down": DENEME-1-PLAN-C.md, item 1).
  const lookLayerPicked = useStore((s) => !!(primarySelected && s.project.clips[primarySelected]?.adjustment))
  const [lastSel, setLastSel] = useState<string | null>(null)
  if (primarySelected && primarySelected !== lastSel) {
    setLastSel(primarySelected)
    if (!(tab === 'fx' && lookLayerPicked)) setTab('clip')
  }

  // A transition picked on the timeline opens in the Clip tab (core polish T).
  const transSel = useTransitionUi((u) => u.sel)
  const [lastTrans, setLastTrans] = useState<string | null>(null)
  if (transSel !== lastTrans) {
    setLastTrans(transSel)
    if (transSel) setTab('clip')
  }

  // Selecting a text/caption jumps straight to Subtitles, where its editor
  // lives — so adding a text and typing into it is one uninterrupted move.
  const primaryCaption = useStore((s) => s.selectedCaptionIds[0] ?? null)
  const primaryIsShape = useStore(
    (s) => !!s.project.captions.find((c) => c.id === s.selectedCaptionIds[0])?.shape
  )
  const titlePicked = useStore((s) => {
    const c = s.project.captions.find((x) => x.id === s.selectedCaptionIds[0])
    return !!c && !!c.manual && !c.shape
  })
  const linePicked = useStore((s) => {
    const c = s.project.captions.find((x) => x.id === s.selectedCaptionIds[0])
    return !!c && !c.manual && !c.shape
  })
  const transitionPicked = useTransitionUi((u) => !!u.sel)
  const primaryAssetKind = useStore((s) => {
    const c = primarySelected ? s.project.clips[primarySelected] : undefined
    return c ? assetById(s.project, c.assetId)?.kind : undefined
  })
  const clipKind: ScopeKind = primarySelected ? clipScopeKind(primaryAssetKind) : transitionPicked ? 'transition' : primaryIsShape ? 'shape' : 'clip'
  const [lastCap, setLastCap] = useState<string | null>(null)
  if (primaryCaption !== lastCap) {
    setLastCap(primaryCaption)
    // A shape's controls live in the Clip tab (as a selected transition's:
    // DENEME-4, worker W); text's live in Subtitles. Landing on the wrong one
    // is how a rectangle ended up showing font pickers.
    if (primaryCaption && !primaryIsShape) setTab('subs')
    if (primaryCaption && primaryIsShape) setTab('clip')
  }

  // Same for a template block: its words and pictures open on the right.
  const tplSel = useStore((s) => s.templateSel)
  const [lastTpl, setLastTpl] = useState<string | null>(null)
  if (tplSel !== lastTpl) {
    setLastTpl(tplSel)
    if (tplSel) setTab('tmpl')
  }
  const hasTemplates = useStore((s) => (s.project.templates?.length ?? 0) > 0)
  if (tab === 'tmpl' && !hasTemplates) setTab('clip')
  // Phase 3c.Y, K2: the Agent tab only while the agent is switched on, or
  // something of it waits for the user (a draft, a call, a restore point).
  const agentShown = useAgentTabShown()
  // (The badge is a count: no empty bubble when nothing waits to be sent.)
  const hasNotes = useStore((s) => (s.project.notes ?? []).some(isSendable))
  if (tab === 'agent' && !agentShown) setTab('clip')
  // DENEME-2 (the user's decision): work notes are for the agent; with agent
  // access off their tab is not shown (the notes are kept).
  const agentOn = useAgentOn()
  if (tab === 'notes' && !agentOn) setTab('clip')
  // (The in-app chat is agent access's own tab too: off, it is not shown.)
  if (tab === 'chat' && !agentOn) setTab('clip')
  // The top bar's "Draft waits · Review" opens the Agent tab (DENEME-2).
  const wantAgent = useAgentStore((s) => s.openTab)
  // A call of the agent in flight: a thin line runs under its tab (DENEME-2, item 4).
  const agentBusy = useAgentStore((s) => s.events.some((e) => !e.done))
  const [lastWant, setLastWant] = useState(0)
  if (wantAgent !== lastWant) {
    setLastWant(wantAgent)
    if (wantAgent && agentShown) setTab('agent')
  }
  // A work note picked on the N lane, or one just started (a drag on the
  // lane, the N key): its tab opens, as a title's does.
  const noteKey = useStore((s) => (s.noteDraft ? 'draft' : s.noteSel ?? ''))
  const [lastNote, setLastNote] = useState('')
  if (noteKey !== lastNote) {
    setLastNote(noteKey)
    // (Not while watching: the tab stays as it was under the watch mode, IZLE-PLAN.md K4.)
    if (noteKey && agentOn && !watching()) setTab('notes')
  }

  // Mask overlay 'auto' mode shows only while the Clip tab is open.
  const setClipTabActive = useStore((s) => s.setClipTabActive)
  useEffect(() => {
    setClipTabActive(tab === 'clip')
    return () => setClipTabActive(false)
  }, [tab, setClipTabActive])

  // A timeline shortcut (e.g. right-click → "Animate in…") asked us to open a
  // specific section: switch to the Clip tab, scroll it into view and flash it.
  const inspectorFocus = useStore((s) => s.inspectorFocus)
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!inspectorFocus) return
    // 'shapes' (adding them) lives in the left panel's Text page; everything
    // else that asks for focus is a section of a tab here.
    if (inspectorFocus.section === 'shapes') return
    // The left panel's Captions page (arayüz v4): the Subtitles tab.
    if (inspectorFocus.section === 'subs') {
      setTab('subs')
      return
    }
    // The left panel's Chats page (a saved chat picked there).
    if (inspectorFocus.section === 'chat') {
      setTab('chat')
      return
    }
    const projectPart = PART_OF[inspectorFocus.section]
    if (projectPart) setPart(projectPart)
    setTab(
      projectPart
        ? 'project'
        : inspectorFocus.section.startsWith('template')
            ? 'tmpl'
            : 'clip'
    )
    // Wait a frame so the Clip tab has actually rendered the section.
    const id = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector(`[data-section="${inspectorFocus.section}"]`)
      if (!el) return
      // A folded card asked for opens (kullanım, item 5).
      if (!el.classList.contains('is-open')) el.querySelector<HTMLElement>(':scope > .ui-section-title > .ui-section-head')?.click()
      // Only this panel scrolls (22 November, L1: scrollIntoView also slid
      // the whole window up). At once with motion off: a script's smooth
      // scroll is not stopped by the stylesheet's rule (audit E15).
      // (Under the Project tab's own row of parts, which stays at the panel's
      // top: the section's title is not left behind it.)
      const parts = bodyRef.current?.querySelector<HTMLElement>(':scope > .insp-parts')
      revealIn(el, 'start', { smooth: !motionOff(), margin: parts ? parts.offsetHeight + 6 : 0 })
      el.classList.add('flash')
      window.setTimeout(() => el.classList.remove('flash'), 1200)
    }, 60)
    return () => window.clearTimeout(id)
  }, [inspectorFocus])

  // Each tab opens where it was left, the first time at its top (interface
  // audit G5: one scroll position for every tab dropped a new tab in the
  // middle of its panel, its first rows out of sight).
  const scrolls = useRef<Partial<Record<Tab, number>>>({})
  useLayoutEffect(() => {
    const b = bodyRef.current
    if (b) b.scrollTop = scrolls.current[tab] ?? 0
  }, [tab])

  // Audio and Script live in Project now (its Sound and Script parts): four
  // tabs, plus Template while the project has one.
  const tabs: TabItem<Tab>[] = [
    { value: 'clip', label: t('insp.tab.clip'), hint: t('insp.tab.clip.hint') },
    { value: 'fx', label: t('insp.tab.look'), hint: t('insp.tab.look.hint') },
    // (A title picked: the tab holds its settings and says "Text". The same
    // tab, the same place: YAZI2-PLAN.md, addendum 7.)
    { value: 'subs', label: t('insp.tab.subs'), hint: t('insp.tab.subs.hint'), ...(titlePicked ? { label: t('yz.tab.text') } : {}) },
    ...(hasTemplates ? [{ value: 'tmpl' as Tab, label: t('insp.tab.tmpl'), hint: t('insp.tab.tmpl.hint') }] : []),
    // The in-app chat (AGENT-CHAT-PLAN.md): the agent, talked to here.
    ...(agentOn ? [{ value: 'chat' as Tab, label: t('chat.tab'), hint: t('chat.tab.hint') }] : []),
    // Work notes (SnippStudio phase 1).
    ...(agentOn ? [{ value: 'notes' as Tab, label: t('insp.tab.notes'), hint: t('insp.tab.notes.hint'), badge: hasNotes ? <NotesTabBadge /> : undefined }] : []),
    // The agent's own tab (phase 4B, amber): connection, draft, steps.
    ...(agentShown ? [{ value: 'agent' as Tab, label: t('agent.tab'), hint: t('agent.tabTitle'), agent: true }] : []),
    { value: 'project', label: t('insp.tab.project'), hint: t('insp.tab.project.hint') }
  ]

  return (
    <div className="inspector" role="complementary" aria-label={t('insp.name')}>
      <div className={agentBusy ? 'insp-tabs is-agent-busy' : 'insp-tabs'}>
        <Tabs value={tab} tabs={tabs} onChange={setTab} label={t('insp.name')} testid="inspector.tab" />
        <IconButton className="insp-collapse" icon="chevron-right" size="sm" variant="ghost" label={t('insp.collapse')} onClick={onCollapse} testid="inspector.collapse" />
      </div>
      {/* Arayüz v4: the Clip, Look, Subtitles and Project tabs are cards on
          the ground (ui-cards); the others are one panel as before. */}
      {/* The chat keeps its composer fixed: its own transcript is the only
          part that scrolls (the body is not a scroll box there). */}
      <div className={`body ui-sliders-stacked${CARD_TABS.has(tab) ? ' ui-cards' : ''}${tab === 'chat' ? ' is-chat' : ''}`} ref={bodyRef} role="tabpanel" aria-label={tabs.find((x) => x.value === tab)?.label} onScroll={(e) => (scrolls.current[tab] = e.currentTarget.scrollTop)}>
        {tab === 'clip' && <SectionScope {...scopeOf(clipKind)}><ClipTab /></SectionScope>}
        {tab === 'subs' && <SectionScope {...scopeOf(titlePicked ? 'text' : linePicked ? 'line' : 'subs')}><SubsTab /></SectionScope>}
        {tab === 'fx' && <SectionScope {...scopeOf('look')}><FxTab view="look" /></SectionScope>}
        {tab === 'project' && <ProjectTabs part={part} onPart={setPart} />}
        {tab === 'tmpl' && <TemplateInspector />}
        {tab === 'notes' && <NotesPanel />}
        {tab === 'chat' && <ChatTab />}
        {tab === 'agent' && <AgentTab />}
      </div>
      {/* The command box: always there (phase 4B.2). */}
      <CommandBox onTranscribe={onTranscribe} />
    </div>
  )
}
