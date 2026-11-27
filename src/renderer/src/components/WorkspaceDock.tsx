// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The left panel (arayüz v4, UI-V4-PLAN.md §5): a narrow column of categories
// (an icon over its word) on the ground, the chosen category's page beside it
// on a card. The categories are what the program has: Media, Audio (sounds
// and music), Text (titles and templates), Captions, Effects, Transitions,
// Filters (the looks), Code (code films and templates), Chats (the project's
// saved agent chats). The old two tabs (Media / Library) and their pages are
// spread over them.
import { onShellRequest, requestShell } from './app/requests'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from '../state/store'
import { assetById } from '../types'
import { EffectsPage, TransitionsPage, useLookPicks } from './picks/pages'
import { PickBar, PickEmpty } from './picks/PickBar'
import { pickUsed } from './picks/picks'
import { MediaBin, addCodeFilm } from './MediaBin'
import { SoundEffectsPanel } from './SoundEffectsPanel'
import { TextPage } from './TextPage'
import { setDockOpen, useDockOpen } from './app/dock-open'
import { CodeTemplates } from './CodeTemplates'
import { CaptionsPage } from './CaptionsPage'
import { VoiceoverPage } from './VoiceoverPage'
import { ChatsPage } from './agent/ChatsPage'
import type { CaptionSource } from '../subtitles/source'
import { LookTiles } from './inspector/clip-look'
import { api } from '../platform'
import { BareButton, Button, Icon, IconButton, Tooltip, useT, type IconName, type StringKey } from '../ui'
import { rovingIndex } from '../ui/logic'
import { SectionScope } from '../ui/Section'

/** The categories, in the column's order. The ids of the old pages are kept
 *  (media, sounds, templates, effects): their test ids are dock.page.<id>. */
export type DockView = 'media' | 'sounds' | 'templates' | 'captions' | 'voiceover' | 'effects' | 'transitions' | 'filters' | 'code' | 'chats'

const CATS: [DockView, IconName, StringKey, StringKey][] = [
  ['media', 'image', 'dock.cat.media', 'dock.cat.media.hint'],
  ['sounds', 'eighth-notes', 'dock.cat.audio', 'dock.cat.audio.hint'],
  ['templates', 'type', 'dock.cat.text', 'dock.cat.text.hint'],
  ['captions', 'captions', 'dock.cat.captions', 'dock.cat.captions.hint'],
  ['voiceover', 'mic', 'dock.cat.voiceover', 'dock.cat.voiceover.hint'],
  ['effects', 'sparkles', 'dock.cat.effects', 'dock.cat.effects.hint'],
  ['transitions', 'blend', 'dock.cat.transitions', 'dock.cat.transitions.hint'],
  ['filters', 'swatch-book', 'dock.cat.filters', 'dock.cat.filters.hint'],
  ['code', 'code', 'dock.cat.code', 'dock.cat.code.hint'],
  ['chats', 'bot', 'dock.cat.chats', 'dock.cat.chats.hint']
]

const KEY = 'snipp-workspace-dock'

function readView(): DockView {
  try {
    const saved = localStorage.getItem(KEY) as DockView | null
    return saved && CATS.some(([id]) => id === saved) ? saved : 'media'
  } catch {
    return 'media'
  }
}

export function WorkspaceDock({ onImport, onTranscribe, onTranscribeRange }: { onImport: () => void; onTranscribe?: (source?: CaptionSource) => void; onTranscribeRange?: () => void }): JSX.Element {
  const t = useT()
  const [view, setView] = useState<DockView>(readView)
  const open = useDockOpen()
  /** A category's page, opened (the panel opens with it). */
  const choose = (next: DockView): void => {
    setView(next)
    setDockOpen(true)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* not remembered: fine */
    }
    // The captions themselves are edited in the Inspector: its tab opens with the page.
    if (next === 'captions') useStore.getState().focusInspector('subs')
  }
  // Shapes asked for: adding them is Text → Shapes and highlights (it was
  // Effects → Shapes; YAZI-PANELI-PLAN.md §5).
  const focus = useStore((s) => s.inspectorFocus)
  useEffect(() => {
    if (focus?.section === 'shapes') requestShell('dock:text')
  }, [focus])
  // An empty Template tab's button (phase 9b): Text (the templates).
  useEffect(() => onShellRequest((what) => {
    if (what === 'dock:templates' || what === 'dock:text') choose('templates')
    // A part of the Inspector pointing at what is made or brought in here
    // (DENEME-4, worker W): the looks to browse, the subtitles to make.
    else if (what === 'dock:filters') choose('filters')
    else if (what === 'dock:captions') choose('captions')
    // A note's text put into the script (REF-AB, worker S).
    else if (what === 'dock:voiceover') choose('voiceover')
  }), [])
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  // A click on the open page's icon closes the panel; on another, or on any
  // while it is closed, opens that page (DENEME-1, P2).
  const press = (id: DockView): void => {
    if (open && id === view) setDockOpen(false)
    else choose(id)
  }
  const at = CATS.findIndex(([id]) => id === view)
  const onKey = (e: KeyboardEvent): void => {
    const i = rovingIndex(Math.max(0, at), e.key, CATS.length, () => false, 'vertical')
    if (i === null) return
    e.preventDefault()
    choose(CATS[i][0])
    refs.current[i]?.focus()
  }
  const name = (id: DockView): string => t(CATS.find((c) => c[0] === id)![2])
  return (
    <aside className={open ? 'workspace-dock' : 'workspace-dock is-closed'} aria-label={t('dock.label')}>
      <div className="dock-rail">
        <div className="dock-cats" role="tablist" aria-orientation="vertical" aria-label={t('dock.cats')} data-testid="dock.cats" onKeyDown={onKey}>
          {CATS.map(([id, icon, label, hint], i) => {
            const on = open && id === view
            return (
              <Tooltip key={id} side="right" delay={500} content={t(hint)} heading={open ? undefined : t('dock.cat.closed', { name: t(label) })}>
                <BareButton
                  ref={(el) => {
                    refs.current[i] = el
                  }}
                  role="tab"
                  aria-selected={on}
                  aria-controls={`dock-page-${id}`}
                  tabIndex={id === view ? 0 : -1}
                  className={on ? 'dock-cat is-on' : 'dock-cat'}
                  testid={`dock.page.${id}`}
                  onClick={() => press(id)}
                >
                  <Icon name={icon} size={18} />
                  <span className="dock-cat-label">{t(label)}</span>
                </BareButton>
              </Tooltip>
            )
          })}
        </div>
        {/* The panel's own close, at its edge; closed, the same place opens it. */}
        <IconButton
          icon={open ? 'panel-left-close' : 'panel-left-open'}
          label={open ? t('dock.close') : t('dock.cat.closed', { name: name(view) })}
          testid={open ? 'dock.close' : 'dock.open'}
          className="dock-toggle"
          onClick={() => setDockOpen(!open)}
        />
      </div>
      <div className="dock-body ui-sliders-stacked" hidden={!open}>
        <div className="dock-page" id="dock-page-media" role="tabpanel" aria-label={name('media')} hidden={view !== 'media'}><MediaBin onImport={onImport} /></div>
        <div className="dock-page" id="dock-page-sounds" role="tabpanel" aria-label={name('sounds')} hidden={view !== 'sounds'}><SoundEffectsPanel active={view === 'sounds'} /></div>
        <div className="dock-page" id="dock-page-templates" role="tabpanel" aria-label={name('templates')} hidden={view !== 'templates'}><SectionScope name="dock.text" open={['Text: styles']}><TextPage active={open && view === 'templates'} /></SectionScope></div>
        <div className="dock-page dock-scroll" id="dock-page-captions" role="tabpanel" aria-label={name('captions')} hidden={view !== 'captions'}>{view === 'captions' && <SectionScope name="dock.captions" open={['Generate', 'Captions']}><CaptionsPage onTranscribe={onTranscribe} onTranscribeRange={onTranscribeRange} /></SectionScope>}</div>
        <div className="dock-page dock-scroll" id="dock-page-voiceover" role="tabpanel" aria-label={name('voiceover')} hidden={view !== 'voiceover'}>{view === 'voiceover' && <VoiceoverPage active={open} />}</div>
        <div className="dock-page dock-effects" id="dock-page-effects" role="tabpanel" aria-label={name('effects')} hidden={view !== 'effects'}>{view === 'effects' && <EffectsPage />}</div>
        <div className="dock-page dock-effects" id="dock-page-transitions" role="tabpanel" aria-label={name('transitions')} hidden={view !== 'transitions'}>{view === 'transitions' && <TransitionsPage />}</div>
        <div className="dock-page dock-scroll" id="dock-page-filters" role="tabpanel" aria-label={name('filters')} hidden={view !== 'filters'}>{view === 'filters' && <FiltersPage />}</div>
        <div className="dock-page dock-scroll" id="dock-page-code" role="tabpanel" aria-label={name('code')} hidden={view !== 'code'}>{view === 'code' && <CodePage />}</div>
        <div className="dock-page dock-scroll" id="dock-page-chats" role="tabpanel" aria-label={name('chats')} hidden={view !== 'chats'}>{view === 'chats' && <ChatsPage />}</div>
      </div>
    </aside>
  )
}

/** A page's title line. */
function PageHead({ title, hint }: { title: string; hint: string }): JSX.Element {
  return (
    <div className="dock-intro">
      <strong>{title}</strong>
      <Tooltip content={hint}>
        <span className="ui-section-info" role="note" tabIndex={0} aria-label={hint}>
          <Icon name="info" size={14} />
        </span>
      </Tooltip>
    </div>
  )
}

/** Filters: the built-in looks for the selected clip (pointing at one shows
 *  it in the preview, a click gives it the clip: the Color card's tiles). */
function FiltersPage(): JSX.Element {
  const t = useT()
  const clip = useStore((s) => (s.selectedClipIds[0] ? s.project.clips[s.selectedClipIds[0]] : undefined))
  const kind = useStore((s) => (clip ? assetById(s.project, clip.assetId)?.kind : undefined))
  const name = useStore((s) => (clip ? assetById(s.project, clip.assetId)?.name : undefined))
  const usable = !!clip && (clip.adjustment || kind === 'video' || kind === 'image' || kind === 'code' || !!clip.nested)
  // REF-AB item 6: search, favourites and recents of the looks.
  const pick = useLookPicks()
  return (
    <div className="dock-page-body">
      <PageHead title={t('dock.cat.filters')} hint={t('dock.cat.filters.hint')} />
      {/* DENEME-2, item 6: the looks are always shown; with no picture clip
          selected, on a strip of sample colours and not to be clicked. */}
      <p className="dock-note">{usable ? t('dock.filters.for', { name: name ?? t('insp.clip.adjustment') }) : t('dock.filters.none')}</p>
      <PickBar view={pick} testid="filters.pick" />
      <PickEmpty view={pick} testid="filters.pick.empty" />
      {(!pick.narrowed || pick.shown.length > 0) && <LookTiles clip={usable ? clip : undefined} only={pick.only} mark={pick.mark} onUse={(id) => pickUsed('filters', id)} />}
    </div>
  )
}

/** Code: a code film from its folder, and the code templates. */
function CodePage(): JSX.Element {
  const t = useT()
  return (
    <div className="dock-page-body">
      <PageHead title={t('dock.cat.code')} hint={t('dock.cat.code.hint')} />
      {api && (
        <Tooltip content={t('bin.codeFilm.hint')}>
          <Button variant="secondary" icon="folder-open" testid="media.code-film" className="dock-wide" onClick={() => void addCodeFilm()}>
            {t('dock.code.film')}
          </Button>
        </Tooltip>
      )}
      <CodeTemplates />
    </div>
  )
}
