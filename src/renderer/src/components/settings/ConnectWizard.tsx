// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Settings → Agent connection as a wizard (SnippStudio SIHIRBAZ-PLAN.md; the
// mock-up's sixth tab, tasarim\maket-ajan): the agent program on top, then
// five numbered steps, each one job, one button, what to see and its live
// result, with a folded "If it did not work". The rules are pure
// (wizard-model.ts); this file only shows them and runs the buttons.
//
// Safety as before: the app never runs `claude mcp add` / `codex mcp add` and
// never writes an agent's settings. It hands the user lines to copy (none
// holds the key: each reads it from the profile's file in the user's own
// command window) and reads verdicts: the registration (`mcp get`, in the
// main process), Codex's key compared inside PowerShell, the sessions the
// server heard and the requests it refused.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentInstallation } from '../../../../preload/index'
import { connectAgent, refreshSession, useSession } from '../../agent/session'
import { api } from '../../platform'
import { uiPlatform } from '../../os-platform'
import { Button, Icon, Segmented, notify, t as t0, useT, type StringKey } from '../../ui'
import { PRODUCT_NAME } from '../../../../shared/product'
import { revealIn } from '../../ui/reveal'
import { SETUP } from './agents'
import { PROGRAMS, checkButtonBusy, checkRows, checkable, defaultProgram, familyOf, lastSeen, stepStates, timeOfDay, type CodexKey, type Family, type Fix, type Mark, type Program, type Row, type StepState } from './wizard-model'
import type { AgentRegistration } from '../../../../preload/index'
import './connect-wizard.css'

/** The copied lines are PowerShell's on Windows, sh's elsewhere (main/agent-connect.ts). */
const windowsShell = (): boolean => uiPlatform() === 'win32'

/** Copies a value the user asked for, with a word on the result. */
export async function copyText(value: string, done: string): Promise<boolean> {
  const ok = (await api?.clipboardWriteText(value).catch(() => false)) ?? false
  notify({ text: ok ? done : t0('settings.copyFailed'), kind: ok ? 'info' : 'error' })
  return ok
}

const PROGRAM_KEY = 'snippstudio-connect-program'
const remembered = (): string | null => {
  try {
    return localStorage.getItem(PROGRAM_KEY)
  } catch {
    return null
  }
}
const remember = (p: Program): void => {
  try {
    localStorage.setItem(PROGRAM_KEY, p)
  } catch {
    /* not kept: the next visit picks again */
  }
}

/** The family names the agent in a sentence. */
const AGENT: Record<ReturnType<typeof familyOf>, StringKey> = {
  claude: 'agent.name.claude',
  codex: 'agent.name.codex',
  opencode: 'agent.name.opencode',
  antigravity: 'agent.name.antigravity',
  other: 'wiz.prog.other'
}

/** The lines this program's steps copy (fetched only while access is on:
 *  fetching them turns access on, and the page never does that by itself). */
interface Lines {
  register: string
  launch?: string
}

async function fetchLines(p: Program): Promise<Lines | null> {
  const s = api?.agentSession
  if (!s) return null
  const fam = familyOf(p)
  if (fam === 'claude') {
    const r = await s.claudeSetup().catch(() => null)
    return r ? { register: r.command } : null
  }
  if (fam === 'codex') {
    const r = await s.codexSetup().catch(() => null)
    return r ? { register: r.register, launch: r.launch } : null
  }
  if (fam === 'opencode') {
    const r = await s.openCodeSetup().catch(() => null)
    return r ? { register: r.config, launch: r.launch } : null
  }
  const r = await s.antigravitySetup().catch(() => null)
  return r ? { register: r.command } : null
}

function IfNot({ items, testid }: { items: string[]; testid: string }): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="wiz-ifnot">
      <Button size="sm" variant="ghost" className="wiz-ifnot-btn" icon={open ? 'chevron-down' : 'chevron-right'} aria-expanded={open} onClick={() => setOpen(!open)} testid={testid}>
        {t('wiz.ifNot')}
      </Button>
      {open && (
        <ul className="wiz-ifnot-list" data-testid={`${testid}.list`}>
          {items.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
    </div>
  )
}

const MARK_ICON: Record<Mark, 'check' | 'x' | 'minus'> = { ok: 'check', bad: 'x', none: 'minus' }

function Result({ mark, children, testid }: { mark: Mark; children: ReactNode; testid: string }): JSX.Element {
  return (
    <div className={`wiz-res is-${mark}`} role="status" data-testid={testid} data-state={mark}>
      <Icon name={MARK_ICON[mark]} size={14} />
      <span>{children}</span>
    </div>
  )
}

function Step({ n, state, title, text, children, wide, action, flash, stepRef }: { n: number; state: StepState; title: string; text?: string; children?: ReactNode; wide?: ReactNode; action?: ReactNode; flash: boolean; stepRef: (el: HTMLDivElement | null) => void }): JSX.Element {
  return (
    <div ref={stepRef} className={`wiz-step is-${state}${flash ? ' is-flash' : ''}`} data-testid={`settings.agent.step.${n}`} data-state={state}>
      <span className="wiz-n" aria-hidden="true">{state === 'ok' ? <Icon name="check" size={12} /> : n}</span>
      <div className="wiz-body">
        <div className="wiz-title">{title}</div>
        {text && <p className="wiz-text">{text}</p>}
        {children}
      </div>
      <div className="wiz-act">{action}</div>
      {/* (Step 4's rows: under the words and the button both, so a row's
          own button lines up with the step's.) */}
      {wide && <div className="wiz-wide">{wide}</div>}
    </div>
  )
}

export function ConnectWizard({ catalog, agents }: { catalog: AgentInstallation[] | null; agents: { id: string; path: string }[] }): JSX.Element {
  const t = useT()
  const status = useSession((s) => s.status)
  const busy = useSession((s) => s.busy)
  const server = status?.server
  const running = !!server?.running
  const codexPath = agents.find((a) => a.id === 'codex')?.path ?? null
  const [program, setProgram] = useState<Program | null>(null)
  const [registration, setRegistration] = useState<AgentRegistration | 'checking' | null>(null)
  const [codexKey, setCodexKey] = useState<CodexKey | null>(null)
  const [asked, setAsked] = useState(false)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [lines, setLines] = useState<Lines | null>(null)
  const [flash, setFlash] = useState<number | null>(null)
  const steps = useRef<(HTMLDivElement | null)[]>([])
  const shown = useRef<Program | null>(null)
  const checking = useRef(false)
  // (The same, for the button: it is off for the whole of a check, so a press
  // it shows as possible is never dropped by the guard in check.)
  const [inCheck, setInCheck] = useState(false)
  // (A reconnect running: its button is off until the program answered.)
  const [repairing, setRepairing] = useState(false)
  const lastCheck = useRef(0)
  const app = PRODUCT_NAME

  // The program first shown: remembered, else the first one found.
  useEffect(() => {
    if (program || !catalog) return
    setProgram(defaultProgram(remembered(), catalog, codexPath))
  }, [catalog, codexPath, program])
  shown.current = program

  const check = useCallback(async (p: Program, byHand: boolean): Promise<void> => {
    if (checking.current) return
    checking.current = true
    setInCheck(true)
    lastCheck.current = Date.now()
    if (byHand) setAsked(true)
    try {
      await refreshSession()
      const fam = familyOf(p)
      if (fam !== 'claude' && fam !== 'codex' && fam !== 'antigravity') return
      setRegistration('checking')
      const [reg, key] = await Promise.all([
        api?.agentSession.check(fam).catch(() => 'unknown' as const),
        fam === 'codex' && windowsShell() ? api?.agentSession.codexEnv?.().catch(() => 'unknown' as const) : Promise.resolve(null)
      ])
      if (shown.current !== p) return
      setRegistration(reg ?? 'unknown')
      setCodexKey(key ?? null)
      setCheckedAt(Date.now())
    } finally {
      checking.current = false
      setInCheck(false)
    }
  }, [])

  // A program chosen: its state read afresh.
  useEffect(() => {
    if (!program) return
    setRegistration(null)
    setCodexKey(null)
    setCheckedAt(null)
    setAsked(false)
    void check(program, false)
  }, [program, check])

  // Its lines, while access is on (they read the key from the profile's file).
  useEffect(() => {
    let live = true
    setLines(null)
    if (program && running) void fetchLines(program).then((l) => { if (live) setLines(l) })
    return () => { live = false }
  }, [program, running])

  // Back from the command window: read again (at most every 3 s).
  useEffect(() => {
    const onFocus = (): void => {
      if (shown.current && Date.now() - lastCheck.current > 3_000) void check(shown.current, false)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [check])

  useEffect(() => {
    if (flash === null) return
    const timer = window.setTimeout(() => setFlash(null), 1_400)
    return () => window.clearTimeout(timer)
  }, [flash])

  const p: Program = program ?? 'claude'
  const fam = familyOf(p)
  const facts = { program: p, running, error: server?.error ?? null, registration, codexKey, heard: status?.heard ?? { seen: [], refused: null }, asked, checkedAt }
  const rows = checkRows(facts)
  const states = stepStates(facts, rows)
  const seen = lastSeen(facts)
  const agent = t(AGENT[fam])
  const params = { app, agent }
  const rowText = (r: Row): string => t(`wiz.row.${r.id}.${r.say}` as StringKey, { ...params, time: r.at ? timeOfDay(r.at) : '', error: server?.error ?? '' })
  const win = windowsShell()

  const copyRegister = async (): Promise<void> => {
    // Access goes on first (the key is then in the profile's file).
    const l = running && lines ? lines : await fetchLines(p)
    await refreshSession()
    if (!l) return void notify({ text: t('settings.agent.accessFailed'), kind: 'error' })
    setLines(l)
    await copyText(l.register, t('wiz.copied'))
  }
  const copyStart = async (): Promise<void> => {
    const l = running && lines ? lines : await fetchLines(p)
    await refreshSession()
    if (!l?.launch) return void notify({ text: t('settings.agent.accessFailed'), kind: 'error' })
    setLines(l)
    await copyText(l.launch, t('wiz.copied'))
  }
  const goTo = (n: number): void => {
    revealIn(steps.current[n - 1], 'nearest', { margin: 8 })
    setFlash(n)
  }
  const repairNow = async (fam: 'claude' | 'codex' | 'opencode' | 'antigravity'): Promise<void> => {
    if (repairing) return
    setRepairing(true)
    try {
      const r = await api?.agentSession.repair(fam).catch(() => null)
      notify({ text: t(r?.ok ? 'wiz.repaired' : 'wiz.repairFailed'), kind: r?.ok ? 'info' : 'error' })
      if (r?.ok) await check(p, true)
    } finally {
      setRepairing(false)
    }
  }
  const canRepair = (fam: Family): fam is 'claude' | 'codex' | 'opencode' | 'antigravity' =>
    fam === 'claude' || fam === 'codex' || fam === 'opencode' || fam === 'antigravity'
  const runFix = (fix: Fix): void => {
    if ('go' in fix) goTo(fix.go)
    else if ('copy' in fix) void copyRegister()
    else if ('repair' in fix) void repairNow(fix.repair)
    else void connectAgent(true)
  }
  const fixLabel = (fix: Fix): string => ('go' in fix ? t('wiz.fix.step', { n: String(fix.go) }) : 'copy' in fix ? t('wiz.fix.copy') : 'repair' in fix ? t('wiz.fix.repair') : t('wiz.fix.access'))
  const ref = (i: number) => (el: HTMLDivElement | null): void => {
    steps.current[i] = el
  }

  // ---- the program found? ----
  const entry = catalog?.find((e) => e.id === (fam === 'other' ? 'antigravity' : fam))
  const found = (): JSX.Element => {
    if (fam === 'other') return <span className="wiz-found">{t('wiz.prog.other.hint')}</span>
    if (!catalog) return <span className="wiz-found">{t('wiz.looking')}</span>
    if (entry?.installed) return <span className="wiz-found is-ok" data-testid="settings.agent.found" data-state="found">{entry.version ? t('wiz.found', { version: entry.version }) : t('wiz.foundNoVersion')}</span>
    const id = fam as keyof typeof SETUP
    return (
      <>
        <span className="wiz-found" data-testid="settings.agent.found" data-state="missing">{t('wiz.notFound')}</span>
        <Button size="sm" variant="secondary" icon="copy" onClick={() => void copyText(p === 'codexApp' ? SETUP[id].url : SETUP[id].command, t('settings.copied'))} testid={`settings.agent.${id}.install`}>
          {t(p === 'codexApp' ? 'wiz.copyPage' : 'wiz.copyInstall')}
        </Button>
      </>
    )
  }

  // ---- step texts ----
  const s2title = t(`wiz.s2.title.${fam}` as StringKey, params)
  const s2text =
    fam === 'opencode'
      ? t('wiz.s2.text.opencode')
      : fam === 'other'
        ? t(win ? 'wiz.s2.text.other.win' : 'wiz.s2.text.other.shell')
        : fam === 'antigravity'
          ? t(win ? 'wiz.s2.text.antigravity.win' : 'wiz.s2.text.antigravity.shell')
          : t(win ? 'wiz.s2.text.win' : 'wiz.s2.text.shell')
  const s2if =
    fam === 'other'
      ? [t('wiz.s2.if1.other'), t('wiz.s2.if2.other'), t('wiz.s2.if3')]
      : fam === 'antigravity'
        ? [t('wiz.s2.if1.antigravity'), t('wiz.s2.if2.other'), t('wiz.s2.if3')]
        : [
            fam === 'opencode' ? t('wiz.s2.if1.opencode') : p === 'codexApp' ? t('wiz.s2.if1.app') : t('wiz.s2.if1', { program: fam }),
            ...(win && fam !== 'opencode' ? [t('wiz.s2.if1.win')] : []),
            t('wiz.s2.if2'),
            t('wiz.s2.if3')
          ].slice(0, 3)
  const s3text =
    p === 'claude'
      ? t('wiz.s3.text.claude', params)
      : p === 'codexCli'
        ? t(win ? 'wiz.s3.text.codexCli' : 'wiz.s3.text.codexCli.shell')
        : p === 'codexApp'
          ? t('wiz.s3.text.codexApp')
          : p === 'opencode'
            ? t('wiz.s3.text.opencode')
            : p === 'antigravity'
              ? t('wiz.s3.text.antigravity')
              : t('wiz.s3.text.other')
  const s3copy = p === 'opencode' || (p === 'codexCli' && !win)
  const registeredRowNow = rows[0]
  const keyRowNow = rows[1]
  const connectedRow = rows[3]
  // (Step 2's own words: "do step 2" is no help inside step 2.)
  const s2result = checkable(p) ? (keyRowNow.mark === 'bad' ? keyRowNow : registeredRowNow.say === 'unknown' ? null : registeredRowNow) : null
  const action = (n: number, node: (variant: 'primary' | 'secondary') => JSX.Element): JSX.Element => node(states[n - 1] === 'now' ? 'primary' : 'secondary')

  return (
    <div className="wiz" data-testid="settings.agent.wizard" data-program={p}>
      <div className="wiz-head">
        <div className="wiz-h">{t('wiz.title')}</div>
        <Segmented<Program>
          label={t('wiz.program')}
          testid="settings.agent.program"
          value={p}
          onChange={(next) => {
            remember(next)
            setProgram(next)
          }}
          options={PROGRAMS.map((id) => ({ value: id, label: t(`wiz.prog.${id}` as StringKey), hint: id === 'codexCli' || id === 'codexApp' || id === 'other' ? t(`wiz.prog.${id}.hint` as StringKey) : undefined }))}
        />
      </div>
      <div className="wiz-foundline">{found()}</div>

      <Step n={1} state={states[0]} title={t('wiz.s1.title')} text={t('wiz.s1.text', params)} flash={flash === 1} stepRef={ref(0)}
        action={action(1, (v) => (
          <Button size="sm" variant={running ? 'secondary' : v} disabled={busy || !status} aria-pressed={running} onClick={() => void connectAgent(!running)} testid="settings.agent.access" data-state={running ? 'on' : 'off'}>
            {t(running ? 'wiz.s1.off' : 'wiz.s1.on')}
          </Button>
        ))}>
        {running ? (
          <Result mark="ok" testid="settings.agent.step.1.result">{t('wiz.s1.isOn')}</Result>
        ) : (
          <Result mark="bad" testid="settings.agent.step.1.result">{server?.enabled && server.error ? t('wiz.s1.error', { error: server.error }) : t('wiz.s1.isOff')}</Result>
        )}
        <IfNot testid="settings.agent.step.1.ifnot" items={[t('wiz.s1.if1', params), t('wiz.s1.if2', params), t('wiz.s1.if3')]} />
      </Step>

      <Step n={2} state={states[1]} title={s2title} text={s2text} flash={flash === 2} stepRef={ref(1)}
        action={action(2, (v) => (
          <div className="settings-row">
            <Button size="sm" variant={v} icon="copy" onClick={() => void copyRegister()} testid="settings.agent.register">
              {t(fam === 'opencode' ? 'wiz.s2.copySetting' : 'wiz.s2.copy')}
            </Button>
            {canRepair(fam) && (
              <Button size="sm" variant="secondary" icon="rotate-cw" disabled={repairing} onClick={() => void repairNow(fam)} testid="settings.agent.repair">
                {t('wiz.fix.repair')}
              </Button>
            )}
          </div>
        ))}>
        {lines && <div className="wiz-cmd" data-testid="settings.agent.register.text">{lines.register}</div>}
        {s2result && s2result.mark !== 'none' && <Result mark={s2result.mark} testid="settings.agent.step.2.result">{t(`wiz.s2.res.${s2result.say}` as StringKey, { agent, time: s2result.at ? timeOfDay(s2result.at) : '' })}</Result>}
        <IfNot testid="settings.agent.step.2.ifnot" items={s2if} />
      </Step>

      <Step n={3} state={states[2]} title={t(`wiz.s3.title.${fam}` as StringKey)} text={s3text} flash={flash === 3} stepRef={ref(2)}
        action={s3copy ? action(3, (v) => (
          <Button size="sm" variant={v} icon="copy" onClick={() => void copyStart()} testid="settings.agent.start">{t('wiz.s3.copy')}</Button>
        )) : undefined}>
        {s3copy && lines?.launch && <div className="wiz-cmd" data-testid="settings.agent.start.text">{lines.launch}</div>}
        {(connectedRow.mark === 'ok' || connectedRow.say === 'oldWindow') && <Result mark={connectedRow.mark} testid="settings.agent.step.3.result">{rowText(connectedRow)}</Result>}
        <IfNot testid="settings.agent.step.3.ifnot" items={[t('wiz.s3.if1', params), p === 'claude' ? t('wiz.s3.if2.claude') : p === 'codexApp' ? t('wiz.s3.if2.codexApp') : p === 'antigravity' ? t('wiz.s3.if2.antigravity') : t('wiz.s3.if2'), t('wiz.s3.if3')]} />
      </Step>

      <Step n={4} state={states[3]} title={t('wiz.s4.title')} flash={flash === 4} stepRef={ref(3)}
        action={action(4, (v) => (
          <Button size="sm" variant={v} icon="circle-check" disabled={checkButtonBusy(registration, inCheck)} onClick={() => void check(p, true)} testid="settings.agent.check">
            {t(checkButtonBusy(registration, inCheck) ? 'wiz.s4.checking' : 'wiz.s4.check')}
          </Button>
        ))}
        wide={<>
        <div className="wiz-checks" data-testid="settings.agent.checks">
          {rows.map((r) => (
            <div key={r.id} className={`wiz-row is-${r.mark}`} data-testid={`settings.agent.row.${r.id}`} data-state={r.mark} data-say={r.say}>
              <Icon name={MARK_ICON[r.mark]} size={14} />
              <span className="wiz-row-text">{rowText(r)}</span>
              {r.fix && r.mark === 'bad' && (
                <Button size="sm" variant="secondary" className="wiz-fix" icon={'copy' in r.fix ? 'copy' : 'repair' in r.fix ? 'rotate-cw' : undefined} onClick={() => runFix(r.fix as Fix)} testid={`settings.agent.row.${r.id}.fix`}>
                  {fixLabel(r.fix)}
                </Button>
              )}
            </div>
          ))}
        </div>
        <IfNot testid="settings.agent.step.4.ifnot" items={[t('wiz.s4.if1'), t('wiz.s4.if2'), t('wiz.s4.if3', params)]} />
        </>} />

      <Step n={5} state={states[4]} title={t('wiz.s5.title')} text={t(`wiz.s5.text.${fam}` as StringKey)} flash={flash === 5} stepRef={ref(4)}
        action={action(5, (v) => (
          <Button size="sm" variant={v} icon="copy" onClick={() => void copyText(t('wiz.s5.prompt', params), t('wiz.copied'))} testid="settings.agent.try">{t('wiz.s5.copy')}</Button>
        ))}>
        <div className="wiz-cmd is-prompt" data-testid="settings.agent.try.text">{t('wiz.s5.prompt', params)}</div>
        {seen && running && connectedRow.mark === 'ok' && <Result mark="ok" testid="settings.agent.connected">{t('wiz.s5.done', params)}</Result>}
        <IfNot testid="settings.agent.step.5.ifnot" items={[t('wiz.s5.if1'), t('wiz.s5.if2'), t('wiz.s5.if3', params)]} />
      </Step>
    </div>
  )
}
