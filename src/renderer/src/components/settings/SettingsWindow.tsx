// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Settings window (SnippStudio TERMINAL-YOK-PLAN.md, 6–9): one window,
// a menu on the left — General, Agent connection, Keyboard shortcuts, Help,
// About. The agent connection lives here alone: since SIHIRBAZ-PLAN.md a
// wizard (ConnectWizard.tsx), one program and five steps. No key is ever
// shown or copied: every line reads it from the profile's file.
import { useEffect, useState } from 'react'
import type { AgentInstallation } from '../../../../preload/index'
import { listenSession, refreshSession, useSession } from '../../agent/session'
import { AgentsCard } from '../agent/AgentsCard'
import { api } from '../../platform'
import { useStore } from '../../state/store'
import { ACTIONS, bindingLabel, defaultBindings, eventToBinding, type ActionId, type Bindings } from '../../shortcuts'
import { PRESETS, presetBindings, presetOf, type PresetId } from '../../shortcuts-presets'
import { readSpokenDefault, writeSpokenDefault, type SpokenDefault } from '../../subtitles/spoken-default'
import { WHISPER_SPOKEN_LANGUAGES } from '../../subtitles/models'
import { spokenLanguageName } from '../../ui/language-names'
import { uiPlatform } from '../../os-platform'
import { readHomePref, writeHomePref } from '../app/launch-home'
import { Button, Dialog, Field, InfoMark, Segmented, Select, Tabs, Toggle, notify, t as t0, useT, type SelectOption, type StringKey } from '../../ui'
import { useTimelineView } from '../timeline/view-state'
import { TRACK_SCALES } from '../../timeline/view-math'
import { MOTION_PREFS, useMotion } from '../../ui/motion'
import { requestShell } from '../app/requests'
import { SETTINGS_PAGES, useSettings, type SettingsPage } from './open'
import { ConnectWizard, copyText } from './ConnectWizard'
import { PRODUCT_NAME } from '../../../../shared/product'
import './settings.css'

const PAGE_NAME: Record<SettingsPage, StringKey> = {
  general: 'settings.page.general',
  agent: 'settings.page.agent',
  keys: 'settings.page.keys',
  help: 'settings.page.help',
  about: 'settings.page.about'
}


// ---- General ------------------------------------------------------------------

function GeneralPage(): JSX.Element {
  const t = useT()
  const uiLang = useStore((s) => s.uiLang)
  const setUiLang = useStore((s) => s.setUiLang)
  const [spoken, setSpoken] = useState<SpokenDefault>(readSpokenDefault)
  const [homeAtLaunch, setHomeAtLaunch] = useState(readHomePref)
  // The lane height (DENEME-3, item 12: moved here from the timeline's
  // toolbar, where S / M / L took room for a choice made once).
  const trackScale = useTimelineView((v) => v.trackScale)
  const setTrackScale = useTimelineView((v) => v.setTrackScale)
  const motionPref = useMotion((m) => m.pref)
  const setMotionPref = useMotion((m) => m.setPref)
  const systemStill = useMotion((m) => m.systemReduced)
  const options: SelectOption[] = [
    { value: 'follow', label: t('settings.general.spoken.follow') },
    { value: 'turkish', label: t('subs.lang.turkish') },
    { value: 'english', label: t('subs.lang.english') },
    ...WHISPER_SPOKEN_LANGUAGES.filter((l) => l !== 'turkish' && l !== 'english').map((l) => ({ value: l, label: spokenLanguageName(l) }))
  ]
  return (
    <div className="settings-page" data-testid="settings.general">
      <Field label={t('settings.general.uiLang')} hint={t('settings.general.uiLang.hint')}>
        <Select
          value={uiLang}
          options={[{ value: 'en', label: t('top.file.lang.en') }, { value: 'tr', label: t('top.file.lang.tr') }]}
          onChange={(v) => setUiLang(v === 'tr' ? 'tr' : 'en')}
          testid="settings.general.uiLang"
        />
      </Field>
      <Field label={t('settings.general.spoken')} hint={t('cila3.set.spoken')} more={t('settings.general.spoken.hint')}>
        <Select
          value={spoken}
          options={options}
          onChange={(v) => {
            const next = v as SpokenDefault
            writeSpokenDefault(next)
            setSpoken(next)
          }}
          testid="settings.general.spoken"
        />
      </Field>
      <Field label={t('settings.general.lanes')} hint={t('cila3.set.lanes')} more={t('settings.general.lanes.hint')}>
        <Segmented
          label={t('settings.general.lanes')}
          testid="settings.general.lanes"
          value={trackScale}
          onChange={setTrackScale}
          options={TRACK_SCALES.map((scale) => ({ value: scale, label: t(`settings.general.lanes.${scale}`), hint: t(`timeline.height.${scale}`) }))}
        />
      </Field>
      {/* 22 November, L2: the interface's own motion (ui/motion.ts). The
          system's "less motion" is said on its choice, so a still interface
          is not a riddle. */}
      <Field label={t('d22d.motion')} hint={t('cila3.set.motion')} more={t('d22d.motion.hint')}>
        <Segmented
          label={t('d22d.motion')}
          testid="settings.general.motion"
          value={motionPref}
          onChange={setMotionPref}
          options={MOTION_PREFS.map((pref) => ({ value: pref, label: t(pref === 'system' && systemStill ? 'd22d.motion.system.off' : `d22d.motion.${pref}`), hint: t(`d22d.motion.${pref}.hint`) }))}
        />
      </Field>
      {/* REF-AB item 1: the Projects window first at launch (on by default). */}
      <Field label={t('refp.home.atLaunch')} hint={t('cila3.set.atLaunch')} more={t('refp.home.atLaunch.hint')}>
        <Toggle
          checked={homeAtLaunch}
          ariaLabel={t('refp.home.atLaunch')}
          onChange={(on) => {
            writeHomePref(on)
            setHomeAtLaunch(on)
          }}
          testid="settings.general.homeAtLaunch"
        />
      </Field>
      <div className="settings-group">
        <div className="settings-label settings-label-more">
          {t('settings.general.autosave')}
          <InfoMark text={t('settings.general.autosave.text')} testid="settings.general.autosave.more" />
        </div>
        {/* (One short line; the whole of it in the info mark: cila3, 4.) */}
        <p className="settings-text" data-testid="settings.general.autosave">
          <span className="ui-field-short" aria-hidden="true">{t('cila3.set.autosave')}</span>
          <span className="ui-field-more">{t('settings.general.autosave.text')}</span>
        </p>
      </div>
      <div className="settings-group">
        <div className="settings-label">{t('settings.general.restart')}</div>
        <p className="settings-text">{t('settings.general.restart.hint', { app: PRODUCT_NAME })}</p>
        <div className="settings-row">
          <Button size="sm" variant="secondary" icon="rotate-cw" onClick={() => requestShell('restart')} testid="settings.general.restart">
            {t('settings.general.restart')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---- Agent connection -----------------------------------------------------------
// The wizard (ConnectWizard.tsx, SIHIRBAZ-PLAN.md) on top; the agents on
// this project; the address, the key and the notes folded under Details.

function RenewKey(): JSX.Element {
  const t = useT()
  const [asking, setAsking] = useState(false)
  const renew = async (): Promise<void> => {
    setAsking(false)
    const next = (await api?.agentSession.renewKey().catch(() => null)) ?? null
    if (next) useSession.getState().setStatus(next)
    notify({ text: t(next ? 'settings.agent.renewed' : 'settings.agent.renewFailed'), kind: next ? 'info' : 'error' })
  }
  return (
    <div className="settings-row">
      {asking ? (
        <>
          <span className="settings-text">{t('settings.agent.renewAsk')}</span>
          <Button size="sm" variant="danger" onClick={() => void renew()} testid="settings.agent.renew.confirm">{t('settings.agent.renewConfirm')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)} testid="settings.agent.renew.cancel">{t('agent.cancel')}</Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" icon="rotate-cw" onClick={() => setAsking(true)} testid="settings.agent.renew">{t('settings.agent.renew')}</Button>
      )}
    </div>
  )
}

function AgentPage(): JSX.Element {
  const t = useT()
  const status = useSession((s) => s.status)
  const [catalog, setCatalog] = useState<AgentInstallation[] | null>(null)
  const [more, setMore] = useState(false)
  const [autoRepair, setAutoRepair] = useState<boolean | null>(null)
  useEffect(() => {
    listenSession()
    void refreshSession()
    let live = true
    void api?.agentSession.catalog().then((c) => { if (live) setCatalog(c) }, () => { if (live) setCatalog([]) })
    void api?.agentSession.autoRepair().then((on) => { if (live) setAutoRepair(on) }, () => { if (live) setAutoRepair(true) })
    return () => { live = false }
  }, [])
  const server = status?.server
  return (
    <div className="settings-page" data-testid="settings.agent">
      <ConnectWizard catalog={catalog} agents={status?.agents ?? []} />
      {/* The agents on this project (DENEME-4, item 9). */}
      <AgentsCard sessions testid="settings.agents" />
      <div className="settings-group wiz-more">
        <div className="settings-row">
          <Button size="sm" variant="ghost" className="wiz-ifnot-btn" icon={more ? 'chevron-down' : 'chevron-right'} aria-expanded={more} onClick={() => setMore(!more)} testid="settings.agent.more">{t('wiz.more')}</Button>
        </div>
        {more && (
          <>
            <div className="settings-label">{t('settings.agent.address')}</div>
            <div className="settings-row">
              <code className="settings-code" data-testid="settings.agent.url">{server?.url ?? ''}</code>
              <Button size="sm" variant="ghost" icon="copy" disabled={!server?.url} onClick={() => void copyText(server?.url ?? '', t('settings.copied'))} testid="settings.agent.url.copy">{t('settings.agent.copyAddress')}</Button>
            </div>
            <p className="settings-text" data-testid="settings.agent.port">{t('settings.agent.port', { port: String(server?.port ?? '') })}</p>
            <div className="settings-label">{t('settings.agent.key')}</div>
            <p className="settings-text">{t('settings.agent.keyHelp')}</p>
            <RenewKey />
            {autoRepair !== null && (
              <Field label={t('settings.agent.autoRepair')} hint={t('settings.agent.autoRepair.hint')} more={t('settings.agent.autoRepair.more')}>
                <Toggle
                  checked={autoRepair}
                  ariaLabel={t('settings.agent.autoRepair')}
                  onChange={(on) => {
                    setAutoRepair(on)
                    void api?.agentSession.setAutoRepair(on).then((kept) => setAutoRepair(kept)).catch(() => setAutoRepair(autoRepair))
                  }}
                  testid="settings.agent.autoRepair"
                />
              </Field>
            )}
            <p className="settings-text" data-testid="settings.agent.plan">{t('agent.picker.plan')}</p>
            <p className="settings-text" data-testid="settings.agent.privacy">{t('settings.agent.privacy')}</p>
            <p className="settings-note" role="note" data-testid="settings.agent.security">{t('settings.agent.security')}</p>
          </>
        )}
      </div>
    </div>
  )
}

// ---- Keyboard shortcuts ---------------------------------------------------------

/** The ready set last chosen (phase 10): two sets can give the same keys
 *  (CapCut's checked keys are SnippStudio's own), so the box shows the one
 *  picked while the keys are still exactly it. A per-window convenience. */
const PRESET_KEY = 'snippstudio-shortcut-preset'
const rememberedPreset = (): string | null => {
  try {
    return localStorage.getItem(PRESET_KEY)
  } catch {
    return null
  }
}
const rememberPreset = (id: PresetId): void => {
  try {
    localStorage.setItem(PRESET_KEY, id)
  } catch {
    /* not kept: the box falls back to the first set that matches */
  }
}

/** What the set box shows for these bindings. */
function shownPreset(bindings: Bindings): PresetId | 'custom' {
  const platform = uiPlatform()
  const picked = PRESETS.find((p) => p.id === rememberedPreset() && p.verified)
  if (picked) {
    const want = presetBindings(picked.id, platform)
    if (Object.keys(want).every((k) => want[k as ActionId] === bindings[k as ActionId])) return picked.id
  }
  return presetOf(bindings, platform) ?? 'custom'
}

function KeysPage({ bindings, onChange }: { bindings: Bindings; onChange: (b: Bindings) => void }): JSX.Element {
  const t = useT()
  const [capturing, setCapturing] = useState<ActionId | null>(null)
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(null)
        return
      }
      const binding = eventToBinding(e)
      if (!binding) return
      onChange({ ...bindings, [capturing]: binding })
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, bindings, onChange])
  return (
    <div className="settings-page" data-testid="settings.keys">
      <Field label={t('keys.preset.label')} hint={t('keys.preset.hint')}>
        <Select
          testid="shortcuts.preset"
          value={shownPreset(bindings)}
          options={[
            ...PRESETS.map((p): SelectOption => ({
              value: p.id,
              label: t(p.nameKey),
              disabled: !p.verified,
              hint: !p.verified ? t('keys.preset.unverified') : p.id === 'capcut' ? t('keys.preset.capcutSame') : undefined
            })),
            { value: 'custom', label: t('keys.preset.custom'), disabled: true }
          ]}
          onChange={(v) => {
            const p = PRESETS.find((x) => x.id === v)
            if (!p || !p.verified) return
            rememberPreset(p.id)
            onChange(presetBindings(p.id, uiPlatform()))
          }}
        />
      </Field>
      <p className="settings-text">{t('win.keys.hint')}</p>
      <div className="shortcut-list">
        {ACTIONS.map((a) => {
          const name = a.labelKey ? t(a.labelKey) : a.label
          return (
            <div key={a.id} className="shortcut-row">
              <span className="sc-label">{name}</span>
              <Button size="sm" className="sc-key" testid={`shortcuts.key.${a.id}`} pressed={capturing === a.id} aria-label={t('win.keys.of', { action: name })} onClick={() => setCapturing(a.id)}>
                {capturing === a.id ? t('win.keys.press') : bindingLabel(bindings[a.id])}
              </Button>
            </div>
          )
        })}
      </div>
      <div className="settings-row">
        <Button
          testid="shortcuts.reset"
          onClick={() => {
            rememberPreset('snippstudio')
            onChange(defaultBindings())
          }}
        >
          {t('win.keys.reset')}
        </Button>
      </div>
    </div>
  )
}

// ---- Help and About -------------------------------------------------------------

async function openHelp(which: 'guide' | 'agents' | 'license' | 'notices' | 'licenses'): Promise<void> {
  const r = await api?.help?.open(which, useStore.getState().uiLang === 'tr' ? 'tr' : 'en').catch(() => null)
  if (!r?.ok) notify({ text: t0('settings.help.openFailed', { path: r?.path ?? '' }), kind: 'error' })
}

function HelpPage(): JSX.Element {
  const t = useT()
  const close = useSettings((s) => s.close)
  return (
    <div className="settings-page" data-testid="settings.help">
      <div className="settings-group">
        <div className="settings-row">
          <Button icon="circle-question-mark" onClick={() => { close(); requestShell('tour') }} testid="settings.help.tour">{t('help.tour')}</Button>
          <span className="settings-text">{t('help.tour.hint')}</span>
        </div>
        <div className="settings-row">
          <Button icon="film" onClick={() => { close(); requestShell('sample') }} testid="settings.help.sample">{t('help.sample')}</Button>
          <span className="settings-text">{t('help.sample.hint')}</span>
        </div>
      </div>
      <div className="settings-group">
        <div className="settings-label">{t('settings.help.guides')}</div>
        <div className="settings-row">
          <Button icon="external-link" variant="secondary" onClick={() => void openHelp('guide')} testid="settings.help.guide">{t('settings.help.guide')}</Button>
          <Button icon="external-link" variant="secondary" onClick={() => void openHelp('agents')} testid="settings.help.agents">{t('settings.help.agents')}</Button>
        </div>
        <p className="settings-text">{t('settings.help.guidesNote')}</p>
      </div>
    </div>
  )
}

function AboutPage(): JSX.Element {
  const t = useT()
  const [info, setInfo] = useState<{ version: string; channel: string } | null>(null)
  useEffect(() => {
    let live = true
    void api?.help?.info().then((i) => { if (live) setInfo(i) }, () => undefined)
    return () => { live = false }
  }, [])
  return (
    <div className="settings-page" data-testid="settings.about">
      <div className="settings-group">
        <div className="settings-card-title">{PRODUCT_NAME}</div>
        <p className="settings-text" data-testid="settings.about.version">{info ? t(info.channel === 'dev' ? 'settings.about.versionDev' : 'settings.about.version', { version: info.version }) : ''}</p>
        <p className="settings-text">{t('settings.about.license')}</p>
      </div>
      <div className="settings-row">
        <Button variant="secondary" icon="external-link" onClick={() => void openHelp('license')} testid="settings.about.licenseFile">{t('settings.about.licenseFile')}</Button>
        <Button variant="secondary" icon="external-link" onClick={() => void openHelp('notices')} testid="settings.about.notices">{t('settings.about.notices')}</Button>
        <Button variant="secondary" icon="folder-open" onClick={() => void openHelp('licenses')} testid="settings.about.licenses">{t('settings.about.licenses')}</Button>
      </div>
    </div>
  )
}

// ---- the window ----------------------------------------------------------------

export function SettingsWindow({ bindings, onBindings }: { bindings: Bindings; onBindings: (b: Bindings) => void }): JSX.Element | null {
  const t = useT()
  const open = useSettings((s) => s.open)
  const page = useSettings((s) => s.page)
  const setPage = useSettings((s) => s.setPage)
  const close = useSettings((s) => s.close)
  if (!open) return null
  return (
    <Dialog open title={t('settings.title')} onClose={close} width="lg" className="settings-window" testid="settings">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.nav')}>
          <Tabs<SettingsPage>
            value={page}
            tabs={SETTINGS_PAGES.map((p) => ({ value: p, label: t(PAGE_NAME[p]), agent: p === 'agent' }))}
            onChange={setPage}
            label={t('settings.nav')}
            idBase="settings"
            testid="settings.nav"
          />
        </nav>
        <div className="settings-body" role="tabpanel" id={`settings-${page}`} aria-labelledby={`settings-tab-${page}`}>
          {page === 'general' && <GeneralPage />}
          {page === 'agent' && <AgentPage />}
          {page === 'keys' && <KeysPage bindings={bindings} onChange={onBindings} />}
          {page === 'help' && <HelpPage />}
          {page === 'about' && <AboutPage />}
        </div>
      </div>
    </Dialog>
  )
}
