// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Code films in the editor (CODE-FILM-CLIP-PLAN.md): each film's page runs in
// a hidden iframe of its own origin (snippfilm://<id>/, served by main), on
// Snipp's host page (main/codefilm-host.ts), and answers frame requests over
// a MessagePort: `PREP(T)` when asked, `renderOut(T)`, its canvases copied
// into an ImageBitmap. The preview asks with codefilm-schedule.ts's plan; the
// export awaits each exact frame.

import type { Asset, Clip, Project } from '../types'
import { bumpFramesVersion } from '../playback/scrub'
import { codeFilmMix, useStore } from '../state/store'
import { api } from '../platform'
import { dropPeaks } from './peakCache'
import { drawChecker, seeThrough } from './checker'
import { filmAlphaKnown, noteFilmAlpha } from './film-alpha'
import { dropInput } from './sources'
import { addNote, setNoteStatus } from '../notes/model'
import { t as tr } from '../ui/strings'
import { chanceAtLoad, exportScaleOf, filmQuery, isSlow, mayLoadAtScale, samePicture } from './codefilm-limits'
import { clampParamDefs, valuesQuery, type ParamDef } from './codefilm-params'
import { editsQuery } from './codefilm-values'
import { BLANK_LINE, blankPicture, CHECK_READY_MS, checkLines, checkMoments, differingShare, recordLines, verdictOf, type CheckResult, type CheckVerdict } from './codefilm-limits'
import { clampFilmDuration, clampFilmFps, clampFilmSize, clampMs, clampRecord, frameFits, LIVE_PAGES, markerOf, pagePicture, pagesToRelease, PING_MS, unresponsiveLimit, type FilmRecord } from './codefilm-limits'
import {
  arrive,
  clearPlan,
  forget,
  markOld,
  newPlan,
  noteAsked,
  pick,
  replaceable,
  want,
  type ClipPlan,
  type FrameMode
} from './codefilm-schedule'

type Bmp = ImageBitmap

/** 'limited': needed while LIVE_PAGES other films needed at the same time
 *  hold every page; it waits for one (its `error` says so). */
export type FilmState = 'booting' | 'ready' | 'error' | 'limited'

export interface FilmStatus {
  state: FilmState
  error?: string
  width: number
  height: number
  fps: number | null
  duration: number | null
  /** The page's own boot time and its last frame's draw time, ms. */
  bootMs?: number
  drawMs?: number
  /** The page answered nothing for UNRESPONSIVE_MS and was let go. */
  unresponsive?: boolean
  /** What the page's __config.transparent said (null: nothing; its own
   *  background colour decides, phase 5b decision 1). */
  transparent?: boolean | null
  /** Its WebGL context was lost (an error until it comes back). */
  lost?: boolean
  /** How the page is played (Asset.code.mode), once known. */
  mode?: 'fast' | 'canvas' | 'page'
  /** On the app's clock: a moment drawn by jumping to it equals the one
   *  reached by stepping (phase 5c, decision 4): it is jumped both ways. */
  pure?: boolean
  /** While the preview played, it brought fewer pictures a second than
   *  SLOW_FPS (phase 5d.2, decision 5): not an error, said by a chip. */
  slow?: boolean
  /** Pictures a second it brought in its last measured stretch of playing. */
  playFps?: number
  /** Some of its CSS animations or transitions started away from the
   *  clock's steps (a load, a network answer, an animation event): the same
   *  moment may come out differently by playing to it and by seeking to it
   *  ("unstable"; the checker of phase 5e tells for sure). */
  unsteady?: boolean
  /** The page wrote down errors after it was ready (5c + 5d audit S-6,
   *  phase 5e): how many, and the first such line. */
  runErrors?: number
  runError?: string
  /** The parameters its page said (window.__params; phase 5f, decision 2):
   *  null when it said none (no Parameters section). */
  params?: ParamDef[] | null
  /** Its page read the project look (window.__snippLook; phase 5f). */
  readsLook?: boolean
}


/** While playing, frames come at most this wide (the preview is smaller than
 *  the film; a smaller picture crosses between the processes faster). */
const PLAY_MAX_W = 1280
/** An exported frame that takes longer than this stops the export. */
const FRAME_TIMEOUT_MS = 60_000
/** A page not ready after this is a failed page. */
const BOOT_TIMEOUT_MS = 125_000
/** A host page that says nothing this long after its frame loaded is loaded
 *  again, at most this many times. */
const HELLO_MS = 4000
const HELLO_RETRIES = 2

interface Waiter {
  resolve: (b: Bmp) => void
  reject: (e: Error) => void
  sentAt: number
  /** The preview plan that asked (null: an export ask). */
  plan: ClipPlan<Bmp> | null
  /** The size asked for: a frame of another size is refused. */
  w: number
  h: number
  /** The film time asked for. */
  t: number
}

/** What the editor talks to a film's host page through: the page's own port
 *  (a frame of the editor), or the main process (a drawing window). */
interface Link {
  postMessage: (m: unknown) => void
  close: () => void
}

/** A picture of a film's drawing window, as the preload hands it over. */
interface PageTexture {
  getVideoFrame: () => VideoFrame
  release: () => void
}
interface PageTextureMeta {
  key: string
  seq: number
  width: number
  height: number
  rows: number
}

export { FILM_QUERY, SLOW_FPS, exportScaleOf, filmQuery } from './codefilm-limits'

/** Bitmaps let go a moment later, never in the middle of a draw that holds one. */
function retire(bmps: Bmp[]): void {
  if (!bmps.length) return
  setTimeout(() => {
    for (const b of bmps) b.close()
  }, 300)
}

class FilmHost {
  readonly assetId: string
  readonly url: string
  readonly query: string
  status: FilmStatus
  /** The page's frame in the editor (tiers 1 and 2); none for a page drawn
   *  by a window of its own (tier 3). */
  private frame: HTMLIFrameElement | null = null
  private port: Link | null = null
  /** Tier 3 (phase 5d.1): the name of this film's drawing window in the
   *  main process, the page's own draw time per frame, and whether the
   *  window's process is to be ended when it is let go (it does not answer). */
  private pageKey: string | null = null
  private pageMs = new Map<number, number>()
  private killPage = false
  private readonly rowPx = new Uint8Array(32)
  /** The host page said hello; how often its frame was loaded again because
   *  it did not (connect). */
  private greeted = false
  private loads = 0
  private helloTimer: ReturnType<typeof setTimeout> | null = null
  private nextId = 1
  private waiting = new Map<number, Waiter>()
  private readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = []
  private bootTimer: ReturnType<typeof setTimeout> | null = null
  readonly plans = new Map<string, ClipPlan<Bmp>>()
  /** A fast-path page that read Math.random, crypto or the clock while it
   *  loaded (5c + 5d audit, K1): loaded again, it may draw another picture. */
  loadChance = false
  /** The folder's fingerprint when its page last loaded (main's filmStamp):
   *  a different one before a frame is drawn starts the page again. */
  stamp: string | null = null
  closed = false
  /** Its iframe is gone (closed, or let go as not responding). */
  dead = false
  /** When a clip near the playhead, the export or a strip last asked for it. */
  lastUsed = performance.now()
  /** When the page last said anything. */
  private lastHeard = performance.now()
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pingN = 0
  /** The longest the page was silent while it started, and its slowest frame
   *  (ms): how long it legitimately holds its thread (unresponsiveLimit). */
  private bootSilence = 0
  private slowest = 0
  private diagWaiters = new Map<number, (r: FilmRecord | null) => void>()
  private readonly name: string
  /** What the editor tells the page when it opens it (phase 5c): how it was
   *  played before (unless its code changed since), its frame grid, and the
   *  project's size for a page that says none. */
  private readonly openWith: { mode?: string; fps: number; fallbackWidth: number; fallbackHeight: number }
  /** How its start went, step by step (ms since it was made): a page that
   *  stays "booting" names the step it stopped at (5d.1 step 0). */
  readonly trace: string[] = []
  private readonly born = performance.now()
  private note(what: string): void {
    if (this.trace.length < 40) this.trace.push(`${Math.round(performance.now() - this.born)} ${what}`)
  }
  /** What the host page says of its start (null: no answer in 2 s). */
  hostStage: string | null = null

  /** The page's drawing scale: 1, or an export's k (phase 5d.2, decision 6:
   *  its page loaded with devicePixelRatio k, its drawing window made at k). */
  readonly scale: number
  /** The preview's stretch of playing being measured for "slow". */
  private playFrom = 0
  private playLast = 0
  private playGot = 0
  /** The page's error count when it was ready (-1: not yet) and the last one
   *  it said; frames drawn while it grew (phase 5e, S-6). */
  private errsBase = -1
  private errsSeen = 0
  private readonly badIds = new Set<number>()

  constructor(asset: Asset, private readonly onChange: (h: FilmHost) => void, fresh = false, scale = 1) {
    this.assetId = asset.id
    this.url = asset.url
    this.scale = scale > 1 ? scale : 1
    this.query = queryOf(asset, this.scale)
    this.name = asset.name
    const ps = useStore.getState().project.settings
    // A page that says no size takes the project's size the first time it
    // runs; from then on (its size is the asset's, known from a run: it
    // has a mode) it is opened again at that size, whatever the project's
    // size is now (5c + 5d audit, K2: an export's page opened at the
    // project's new size drew another picture and changed the asset).
    const known = !!asset.code?.mode && asset.width > 0 && asset.height > 0
    this.openWith = {
      ...(asset.code?.mode === 'canvas' && !fresh ? { mode: 'canvas' } : {}),
      fps: asset.code?.fps ?? 60,
      fallbackWidth: known ? asset.width : ps.width > 0 ? ps.width : 1920,
      fallbackHeight: known ? asset.height : ps.height > 0 ? ps.height : 1080
    }
    const w = asset.width > 0 ? asset.width : 1920
    const h = asset.height > 0 ? asset.height : 1080
    this.status = { state: 'booting', width: w, height: h, fps: asset.code?.fps ?? null, duration: asset.duration || null }
    this.note('made')
    // Its code or its mix changing on disk starts it again (step 9).
    watchFilm(filmIdOf(asset.url), true)
    // And the folder as it was when this page loaded: refreshStamp tells
    // whether it is the same one now (freshen, before frames are drawn).
    void this.refreshStamp()
    this.bootTimer = setTimeout(() => {
      this.fail('The film page did not start in time.')
      // (A page still busy starting, a loop, keeps no process running.)
      this.killPage = true
      this.dropPage()
    }, BOOT_TIMEOUT_MS)
    // Is it still there? Once it runs, a page that answers nothing for
    // UNRESPONSIVE_MS (a loop that never ends) is let go (phase 5a, decision
    // 7); while it starts, BOOT_TIMEOUT_MS decides (a big film builds its
    // scenes in one go: the heavy test film's start holds its page for over a minute on
    // a busy machine, FAZ5-PLAN.md); while an export waits on it, its frame
    // timeout.
    this.pingTimer = setInterval(() => this.checkAlive(), PING_MS)
    // A page known to show more than canvases: its drawing window at once.
    if (asset.code?.mode === 'page' && !fresh) {
      this.openPage()
      return
    }
    this.makeFrame()
  }

  /** The film's frame in the editor: the app's host page on the film's own
   *  origin (made again when its host page did not come up: connect). */
  private makeFrame(): void {
    const w = this.status.width
    const h = this.status.height
    const f = document.createElement('iframe')
    // Laid out (a display:none frame has no layout, and the host reads where
    // the film's canvases are), but off every screen and never in the way.
    f.style.cssText = `position:fixed;left:-30000px;top:0;width:${w}px;height:${h}px;border:0;pointer-events:none;opacity:0`
    f.setAttribute('aria-hidden', 'true')
    f.tabIndex = -1
    f.title = tr('f9y.codeFilm.frame', { name: this.name })
    // Its frames (the host, the film, any frame inside them, any document
    // they open) can open no box and no window, and start no sound: a
    // sandbox without modals or popups, autoplay not allowed. The browser
    // holds them to it; nothing in the page can undo it (5a/5b patch, audit
    // C-5: the guard's own patches were bypassed four ways; they stay as a
    // courtesy). allow-same-origin keeps the film's own origin (its files,
    // its modules, its storage).
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    f.setAttribute('allow', "autoplay 'none'")
    f.addEventListener('load', () => {
      if (this.frame !== f) return
      this.note('frame load')
      this.connect()
    })
    f.src = `${this.url}__snipp/host.html`
    this.frame = f
    document.body.appendChild(f)
  }

  /** Tier 3 (phase 5d.1): the page shows more than canvases, so a hidden
   *  window of the main process draws it whole (main/film-window.ts). The
   *  editor talks to that window's host page as it does to a frame's, through
   *  the main process; the frames come as pictures of the window. */
  private openPage(): void {
    if (this.closed || this.dead) return
    this.port?.close()
    this.port = null
    this.frame?.remove()
    this.frame = null
    this.status = { ...this.status, mode: 'page' }
    const page = api?.codeFilm.page
    if (!page) {
      this.fail(tr('codeFilm.pageBlocked', { name: this.name }))
      return
    }
    const key = `${this.assetId}:${++pageSeq}`
    this.pageKey = key
    pageHosts.set(key, this)
    watchPages()
    this.port = {
      postMessage: (m) => page.send(key, m),
      close: () => {
        pageHosts.delete(key)
        page.close(key, this.killPage)
      }
    }
    this.note('window asked')
    this.lastHeard = performance.now()
    void page.open({ key, id: filmIdOf(this.url), width: this.openWith.fallbackWidth, height: this.openWith.fallbackHeight, ...(this.scale > 1 ? { scale: this.scale } : {}) }).then(
      (r) => {
        if (!r.ok) this.fail(`The film page could not be opened: ${r.error ?? 'no window'}`)
      },
      (e: unknown) => this.fail(`The film page could not be opened: ${String(e).slice(0, 200)}`)
    )
  }

  /** What the drawing window's host page (or the main process, about the
   *  window) says. */
  fromPage(m: unknown): void {
    this.onMessage(m)
  }

  /** A picture of the drawing window: the frame whose number its marker row
   *  carries, if that frame is waited for (answers its number; 0: not one
   *  waited for). The picture's own rows are copied out of the texture, at
   *  the size asked for. */
  async texture(tex: PageTexture, meta: PageTextureMeta): Promise<number> {
    if (this.closed || this.dead || meta.key !== this.pageKey) return 0
    const vf = tex.getVideoFrame()
    try {
      const pic = pagePicture(vf.codedWidth, vf.codedHeight, meta.rows)
      if (!pic) return 0
      await vf.copyTo(this.rowPx, { rect: { x: 0, y: pic.row, width: 8, height: 1 } })
      const id = markerOf(this.rowPx, vf.format === 'BGRA' || vf.format === 'BGRX')
      const w = id > 0 ? this.waiting.get(id) : undefined
      if (!w || this.closed || this.dead) return 0
      const bmp = await createImageBitmap(vf, 0, 0, pic.width, pic.height, w.w !== pic.width || w.h !== pic.height ? { resizeWidth: w.w, resizeHeight: w.h, resizeQuality: 'high' } : undefined)
      const ms = this.pageMs.get(id)
      this.pageMs.delete(id)
      this.onMessage({ type: 'frame', id, t: w.t, bmp, ms })
      return id
    } finally {
      vf.close()
    }
  }

  private checkAlive(): void {
    if (this.dead || this.closed) return
    const silent = performance.now() - this.lastHeard
    if (this.status.state !== 'ready') {
      if (this.port && this.status.state === 'booting') this.bootSilence = Math.max(this.bootSilence, silent)
      if (this.port) this.port.postMessage({ type: 'ping', n: ++this.pingN })
      return
    }
    if (silent > (exportLock > 0 ? FRAME_TIMEOUT_MS : unresponsiveLimit(this.bootSilence, this.slowest))) {
      this.status = { ...this.status, unresponsive: true }
      this.fail(tr('codeFilm.unresponsive', { name: this.name, s: Math.round(silent / 1000) }))
      // (A drawing window that does not answer: its process is ended.)
      this.killPage = true
      this.dropPage()
      return
    }
    if (this.port) this.port.postMessage({ type: 'ping', n: ++this.pingN })
  }

  /** The page goes (its iframe removed: its process can end); the host stays
   *  with its status until the film is reloaded or let go. */
  private dropPage(): void {
    if (this.dead) return
    this.dead = true
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    for (const r of this.diagWaiters.values()) r(null)
    this.diagWaiters.clear()
    this.port?.close()
    this.port = null
    this.frame?.remove()
  }

  /** The folder's files now, against the ones this page loaded: true when
   *  they differ (then the page is drawn from old code until reloaded). The
   *  first answer only records them. */
  async refreshStamp(): Promise<boolean> {
    if (!api) return false
    const s = await api.codeFilm.stamp(filmIdOf(this.url)).catch(() => null)
    if (typeof s !== 'string' || !s) return false
    const changed = this.stamp !== null && this.stamp !== s
    this.stamp = s
    return changed
  }

  /** What the app's guard in the page wrote down (null: no answer in 2 s). */
  diag(): Promise<FilmRecord | null> {
    const port = this.port
    if (this.dead || !port) return Promise.resolve(null)
    const n = ++this.pingN
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.diagWaiters.delete(n)
        resolve(null)
      }, 2000)
      this.diagWaiters.set(n, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      port.postMessage({ type: 'diag', n })
    })
  }

  private connect(): void {
    if (this.closed || this.dead || this.port || !this.frame) return
    const ch = new MessageChannel()
    this.port = ch.port1
    ch.port1.onmessage = (e) => this.onMessage(e.data)
    const cw = this.frame.contentWindow
    this.note(cw ? 'port sent' : 'port not sent: no window')
    cw?.postMessage({ type: 'snipp-port' }, '*', [ch.port2])
    // The host page answers "hello" as soon as it gets the port. A frame
    // that "loaded" and says nothing did not load the host page (seen once
    // in 130 starts, phase 5d.1 step 0: the frame's load came 8 ms after it
    // was made, 50–75 ms in a good start, and the film stayed "booting" for
    // two minutes; a host page refused by the main process gives exactly
    // that): a new frame is made, twice at most.
    if (this.helloTimer) clearTimeout(this.helloTimer)
    this.helloTimer = setTimeout(() => {
      this.helloTimer = null
      if (this.closed || this.dead || this.greeted || !this.frame || this.loads >= HELLO_RETRIES) return
      this.loads++
      this.note(`no hello in ${HELLO_MS} ms: the frame is made again (${this.loads})`)
      console.warn('[code film]', `"${this.name}": its host page did not answer; opening it again (${this.loads})`)
      this.port?.close()
      this.port = null
      this.frame.remove()
      this.frame = null
      this.makeFrame()
    }, HELLO_MS)
  }

  private onMessage(m: any): void {
    if (this.closed || this.dead || !m) return
    this.lastHeard = performance.now()
    if (m.type === 'pong') {
      this.noteErrs(m.errs)
      return
    }
    if (m.type === 'diag') {
      const r = this.diagWaiters.get(+m.n)
      this.diagWaiters.delete(+m.n)
      if (typeof m.where === 'string') this.hostStage = m.where.slice(0, 400)
      r?.(clampRecord(m.record))
      return
    }
    if (m.type === 'size') return
    if (m.type === 'painted') {
      // (A drawing window's page stands at this frame: its own draw time.)
      if (typeof m.id === 'number' && this.waiting.has(m.id)) this.pageMs.set(m.id, clampMs(m.ms))
      this.noteLate(m.late)
      if (this.noteErrs(m.errs) && typeof m.id === 'number') this.badIds.add(m.id)
      return
    }
    if (m.type === 'gone') {
      // The main process ended the drawing window (decision 3, phase 5d.1):
      // it did not respond, its process held too much memory or stopped, or
      // its picture cannot be handed over on this machine.
      const silent = Math.round((performance.now() - this.lastHeard) / 1000)
      if (m.reason === 'unresponsive') this.status = { ...this.status, unresponsive: true }
      this.fail(
        m.reason === 'unresponsive'
          ? tr('codeFilm.unresponsive', { name: this.name, s: silent })
          : m.reason === 'memory'
            ? tr('codeFilm.pageMemory', { name: this.name, mb: String(m.detail ?? '').slice(0, 12) })
            : m.reason === 'blocked'
              ? tr('codeFilm.pageBlocked', { name: this.name })
              : tr('codeFilm.pageStopped', { name: this.name, why: String(m.detail ?? '').slice(0, 40) })
      )
      this.dropPage()
      return
    }
    if (m.type === 'hello') {
      this.greeted = true
      this.note('hello')
      this.port?.postMessage({ type: 'open', query: this.query, width: this.status.width, height: this.status.height, ...this.openWith })
      return
    }
    if (m.type === 'ready') {
      if (this.bootTimer) clearTimeout(this.bootTimer)
      this.note(`ready ${m.mode}`)
      this.lastHeard = performance.now()
      // What the page says about itself, clamped (phase 5a, decision 6).
      const size = clampFilmSize(m.width, m.height, this.status)
      this.status = {
        state: 'ready',
        width: size.width,
        height: size.height,
        fps: clampFilmFps(m.fps) ?? this.status.fps,
        duration: clampFilmDuration(m.duration) ?? this.status.duration,
        bootMs: clampMs(m.ms),
        transparent: typeof m.transparent === 'boolean' ? m.transparent : null,
        mode: m.mode === 'canvas' ? 'canvas' : m.mode === 'page' ? 'page' : 'fast',
        ...(m.mode === 'canvas' || m.mode === 'page' ? { pure: m.pure === true } : {}),
        params: clampParamDefs(m.params),
        readsLook: m.look === true
      }
      this.loadChance = m.mode === 'fast' && chanceAtLoad(m.uses)
      this.errsBase = this.errsSeen = typeof m.errs === 'number' && m.errs >= 0 ? m.errs : 0
      if (this.frame) {
        this.frame.style.width = `${this.status.width}px`
        this.frame.style.height = `${this.status.height}px`
      }
      for (const r of this.readyWaiters.splice(0)) r.resolve()
      this.onChange(this)
      return
    }
    if (m.type === 'frame') {
      const w = this.waiting.get(m.id)
      this.waiting.delete(m.id)
      this.noteLate(m.late)
      // (Drawn while the page wrote down an error: shown only when no good
      // frame is held; phase 5e, decision 2.)
      const grew = this.noteErrs(m.errs)
      const bad = this.badIds.delete(m.id) || grew
      if (w?.plan && previewPlaying) this.playGot++
      if (typeof m.ms === 'number') {
        this.status.drawMs = clampMs(m.ms)
        this.slowest = Math.max(this.slowest, this.status.drawMs)
      }
      // Only the frame asked for, of the size asked for.
      if (!w || !frameFits(m, w, (x): x is ImageBitmap => typeof ImageBitmap !== 'undefined' && x instanceof ImageBitmap)) {
        if (m.bmp && typeof m.bmp.close === 'function') m.bmp.close()
        if (w?.plan) forget(w.plan, [m.id])
        w?.reject(new Error('The film page sent a frame of the wrong size.'))
        return
      }
      const got = m.bmp ? Promise.resolve(m.bmp as Bmp) : createImageBitmap(new ImageData(new Uint8ClampedArray(m.pixels as ArrayBuffer), m.w, m.h))
      void got.then(
        (bmp) => {
          if (!w) return retire([bmp])
          if (w.plan) {
            retire(arrive(w.plan, m.id, { t: m.t, w: bmp.width, h: bmp.height, bmp, ...(bad ? { bad: true as const } : {}) }, (performance.now() - w.sentAt) / 1000))
            if (!previewPlaying) bumpFramesVersion()
          }
          w.resolve(bmp)
        },
        (e: unknown) => w?.reject(e instanceof Error ? e : new Error(String(e)))
      )
      return
    }
    if (m.type === 'lost') {
      this.lose()
      return
    }
    if (m.type === 'restored') {
      this.restore()
      return
    }
    if (m.type === 'dropped') {
      const w = this.waiting.get(m.id)
      this.waiting.delete(m.id)
      if (w?.plan) forget(w.plan, [m.id])
      w?.reject(new Error('dropped'))
      return
    }
    if (m.type === 'error') {
      if (typeof m.id === 'number') {
        const w = this.waiting.get(m.id)
        this.waiting.delete(m.id)
        if (w?.plan) forget(w.plan, [m.id])
        if (m.lost === true) {
          // Its graphics context is gone (audit C-4): said once, by lose().
          this.lose()
          w?.reject(new Error(this.lostMessage()))
          return
        }
        w?.reject(new Error(String(m.message).slice(0, 2000)))
        if (w?.plan) reportOnce(`code film frame:${this.assetId}`, `The code film could not draw ${(+m.t || 0).toFixed(2)} s: ${String(m.message).split('\n')[0].slice(0, 300)}`)
      } else if (m.kind === 'page') {
        // It shows more than canvases (phase 5c, decision 3): the whole page
        // is drawn by a window of its own (phase 5d.1).
        this.note(`page: ${String(m.what ?? '').slice(0, 60)}`)
        this.openPage()
      } else this.fail(String(m.message).slice(0, 2000))
    }
  }

  /** The page's error count (5c + 5d audit S-6, phase 5e): one written after
   *  it was ready makes the clip "error" (badge, note, the agent's changes);
   *  its first such line is read from the page's record. True: it grew now. */
  private noteErrs(n: unknown): boolean {
    if (typeof n !== 'number' || !(n >= 0) || this.errsBase < 0 || this.status.state !== 'ready') return false
    if (n <= this.errsSeen) return false
    if (!this.status.runErrors) this.note(`errors after ready ${n - this.errsBase}`)
    this.errsSeen = n
    this.status = { ...this.status, runErrors: n - this.errsBase }
    // Its line: the newest error the page's record holds now (a page loaded
    // again to go back may hold none yet: asked again at the next growth).
    if (!this.status.runError && !this.readingErr) {
      this.readingErr = true
      void this.diag().then((r) => {
        this.readingErr = false
        const last = r?.errors[r.errors.length - 1]
        if (this.closed || !last || this.status.runError) return
        this.status = { ...this.status, runError: last.split('\n')[0].slice(0, 300) }
        runErrorSeen(this)
      })
    }
    return true
  }
  private readingErr = false

  /** The page says how many of its animations started away from the clock's
   *  steps: one is enough for "unstable" (phase 5d.2). */
  private noteLate(n: unknown): void {
    if (!(typeof n === 'number' && n > 0) || this.status.unsteady || this.status.state !== 'ready') return
    this.status = { ...this.status, unsteady: true }
    this.note(`unsteady ${n}`)
    for (const l of listeners) l()
  }

  /** The preview asked a frame of this film while playing (phase 5d.2,
   *  decision 5): every SLOW_WINDOW_MS of playing, how many pictures came;
   *  fewer than SLOW_FPS a second (or its own rate, when lower) is "slow".
   *  A pause of the asking (the clip left the playhead, playing stopped)
   *  starts a new stretch. */
  notePlaying(now: number): void {
    const SLOW_WINDOW_MS = 3000
    if (this.status.state !== 'ready') return
    if (!this.playFrom || now - this.playLast > 500) {
      this.playFrom = now
      this.playGot = 0
    }
    this.playLast = now
    const span = now - this.playFrom
    if (span < SLOW_WINDOW_MS) return
    const fps = Math.round((this.playGot * 10000) / span) / 10
    const slow = isSlow(fps, this.status.fps)
    this.playFrom = now
    this.playGot = 0
    if (slow !== !!this.status.slow || this.status.playFps !== fps) {
      const flip = slow !== !!this.status.slow
      this.status = { ...this.status, slow, playFps: fps }
      if (flip) for (const l of listeners) l()
    }
  }

  private fail(message: string): void {
    if (this.closed || this.status.state === 'error') return
    this.note(`error ${message.slice(0, 80)}`)
    if (this.bootTimer) clearTimeout(this.bootTimer)
    this.status = { ...this.status, state: 'error', error: message }
    for (const r of this.readyWaiters.splice(0)) r.reject(new Error(message))
    for (const [, w] of this.waiting) w.reject(new Error(message))
    this.waiting.clear()
    this.onChange(this)
  }

  private lostMessage(): string {
    return tr('codeFilm.glLost', { name: this.name })
  }

  /** Its WebGL context was lost (5a/5b patch, audit C-4): an error state
   *  (the preview goes on with the other clips; an export stops naming it)
   *  until the context comes back. The page stays. */
  private lose(): void {
    if (this.closed || this.status.state !== 'ready') return
    const message = this.lostMessage()
    this.status = { ...this.status, state: 'error', error: message, lost: true }
    for (const [, w] of this.waiting) w.reject(new Error(message))
    this.waiting.clear()
    this.onChange(this)
  }

  private restore(): void {
    if (this.closed || !this.status.lost) return
    this.status = { ...this.status, state: 'ready', error: undefined, lost: false }
    for (const r of this.readyWaiters.splice(0)) r.resolve()
    this.onChange(this)
  }

  whenReady(): Promise<void> {
    if (this.status.state === 'ready') return Promise.resolve()
    if (this.status.state === 'error') return Promise.reject(new Error(this.status.error))
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve, reject }))
  }

  /** Asks for second t of the film, w × h. */
  ask(t: number, prep: boolean, w: number, h: number, plan: ClipPlan<Bmp> | null): { id: number; done: Promise<Bmp> } {
    const id = this.nextId++
    let resolve!: (b: Bmp) => void
    let reject!: (e: Error) => void
    const done = new Promise<Bmp>((res, rej) => {
      resolve = res
      reject = rej
    })
    // Nobody may wait on a preview ask: its failure is not an error.
    if (plan) done.catch(() => {})
    this.waiting.set(id, { resolve, reject, sentAt: performance.now(), plan, w, h, t })
    if (plan) noteAsked(plan, { id, t, w, h, prep, key: 0 })
    this.port?.postMessage({ type: 'frame', id, t, prep, w, h })
    return { id, done }
  }

  drop(ids: number[]): void {
    if (ids.length) this.port?.postMessage({ type: 'drop', ids })
  }

  /** Asks not answered yet, or someone waiting for it to start (an export,
   *  a frame for a note or the agent): such a page is not let go. */
  get busy(): boolean {
    return this.waiting.size > 0 || this.readyWaiters.length > 0
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.bootTimer) clearTimeout(this.bootTimer)
    if (this.helloTimer) clearTimeout(this.helloTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    for (const r of this.diagWaiters.values()) r(null)
    this.diagWaiters.clear()
    for (const [, w] of this.waiting) w.reject(new Error(`The code film "${this.name}" was closed.`))
    this.waiting.clear()
    for (const r of this.readyWaiters.splice(0)) r.reject(new Error(`The code film "${this.name}" was closed.`))
    for (const plan of this.plans.values()) retire(clearPlan(plan))
    this.plans.clear()
    this.port?.close()
    this.frame?.remove()
    this.dead = true
    watchFilm(filmIdOf(this.url), false)
  }
}

const hosts = new Map<string, FilmHost>()
/** The films drawn by a window of their own (tier 3), by their window's name. */
const pageHosts = new Map<string, FilmHost>()
let pageSeq = 0
let pagesWatched = false
/** What the main process says about the drawing windows, and their pictures,
 *  each to its film (once per editor page). */
function watchPages(): void {
  const page = api?.codeFilm.page
  if (pagesWatched || !page) return
  pagesWatched = true
  page.onMessage((key, m) => pageHosts.get(key)?.fromPage(m))
  page.onTexture(async (texture, meta) => {
    let id = 0
    try {
      const h = pageHosts.get(meta.key)
      if (h) id = await h.texture(texture, meta)
    } catch {
      id = 0
    } finally {
      try {
        texture.release()
      } catch {
        /* already let go */
      }
    }
    page.ack(meta.key, meta.seq, id)
  })
}
/** Films whose code changed since their page last ran (phase 5c, shared
 *  decision 1: the way to play a page is chosen again then). */
const rechoose = new Set<string>()

/** The snippfilm host (main's id for the folder) of a film's address. */
function filmIdOf(url: string): string {
  return /^snippfilm:\/\/([a-f0-9]{16})\//.exec(url)?.[1] ?? ''
}

let watching: (() => void) | null = null
/** Hosts of each film that want its folder watched: a second page of the
 *  same film (an export's scale check, the checker's fresh load) closing
 *  must not stop the watch the first one needs (phase 5e). */
const watchers = new Map<string, number>()
/** (Cila K) Told when a film's code files changed on disk (the values panel reads them again). */
const codeWatchers = new Set<(assetId: string) => void>()
/** Main tells this window when a watched film's files change. */
function watchFilm(id: string, on: boolean): void {
  if (!id || !api) return
  const n = (watchers.get(id) ?? 0) + (on ? 1 : -1)
  if (n > 0) watchers.set(id, n)
  else watchers.delete(id)
  if (on ? n === 1 : n === 0) api.codeFilm.watch(id, on)
  if (on && !watching) watching = api.codeFilm.onChanged((e) => void filmChanged(e.id, e.files))
}

/** A film's files changed: its sound (audio/…) is read again; anything else
 *  (its code, its pictures) starts its page again. */
async function filmChanged(id: string, files: string[]): Promise<void> {
  const s = useStore.getState()
  const films = s.project.assets.filter((a) => a.kind === 'code' && filmIdOf(a.url) === id)
  if (!films.length) return
  const sound = files.some((f) => /^audio\/mix\.wav$/i.test(f))
  const code = files.some((f) => !/^audio\//i.test(f))
  for (const a of films) {
    if (code) rechoose.add(a.id)
    if (code) codeChanged(a.id)
    if (code) for (const w of codeWatchers) w(a.id)
    if (code && hosts.has(a.id)) codeFilms.reload(a.id)
    if (!sound || !a.path || !api) continue
    const mix = codeFilmMix(s.project, a)
    const info = await api.codeFilm.register(a.path).catch(() => null)
    if (!mix || !info?.mix) continue
    const { codeFilmImport } = await import('./import')
    const probed = (await codeFilmImport(info)).assets.find((x) => x.kind === 'audio')
    dropPeaks(mix.id)
    dropInput(mix.id)
    useStore.getState().setAssetDerived(mix.id, { url: `${info.mix.url}?v=${Date.now()}`, size: info.mix.size, ...(probed ? { duration: probed.duration } : {}) })
  }
  bumpFramesVersion()
}
let previewPlaying = false
let exportLock = 0
/** The running export's output height (its films drawn at its scale). */
let exportHeight: number | null = null
const listeners = new Set<() => void>()
const reported = new Set<string>()

function reportOnce(key: string, message: string): void {
  if (reported.has(key)) return
  reported.add(key)
  console.warn('[code film]', message)
  void import('../ui/toast').then((m) => m.toast(message, { error: true })).catch(() => {})
}

// ---- the checker, its verdict, the error return (phase 5e) -----------------

/** A film's verdict now: the checker's last result, and an error its page
 *  wrote down after it was ready (S-6). Both go when its code changes. */
interface Verdict {
  check?: CheckResult
  runError?: string
}
const verdicts = new Map<string, Verdict>()
/** A check running, by film: the code state it checks (`gen`), and whether a
 *  newer save called it off (it then writes no verdict and no note). */
interface Running {
  gen: number
  p: Promise<CheckResult>
  off: boolean
  /** Rejects when it is called off (whatever it waits on ends at once). */
  stopped: Promise<never>
  stop: () => void
}
const checking = new Map<string, Running>()
/** Counts each film's code changes (audit D1): a check's result belongs to
 *  the count it started at. */
const codeGen = new Map<string, number>()
const genOf = (assetId: string): number => codeGen.get(assetId) ?? 0
/** How long a check waits for the live page (audit D5; the 20 s of decision
 *  1 is measured on the fresh load). */
const LIVE_READY_MS = 60_000
class CalledOff extends Error {}
/** When a film's code last changed on disk (the clip's short "saved" flash),
 *  and films made by the code_clip tool whose code was not written yet
 *  ("writing"). */
const savedAt = new Map<string, number>()
const writing = new Set<string>()
/** A code change is checked once it settles (decision 1). */
export const CHECK_SETTLE_MS = 2000
const settleTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** The note the checker put on each clip (session only): updated, not
 *  added again, by the next verdict. */
const checkNotes = new Map<string, string>()

function tell(): void {
  for (const l of listeners) l()
}

/** Its code changed on disk: the verdict is gone, the clip flashes "saved",
 *  and it is checked when the change has settled. */
function codeChanged(assetId: string): void {
  codeGen.set(assetId, genOf(assetId) + 1)
  // (A check of the code before is called off: its pages are of that code.)
  checking.get(assetId)?.stop()
  verdicts.delete(assetId)
  writing.delete(assetId)
  savedAt.set(assetId, Date.now())
  const old = settleTimers.get(assetId)
  if (old) clearTimeout(old)
  settleTimers.set(
    assetId,
    setTimeout(() => {
      settleTimers.delete(assetId)
      const a = useStore.getState().project.assets.find((x) => x.id === assetId)
      // (Not again when the tool already checked this very code.)
      if (a && a.kind === 'code' && !a.missing && exportLock === 0 && !(checkedGen.get(assetId) === genOf(assetId) && verdicts.get(assetId)?.check)) void codeFilms.check(a).catch(() => {})
    }, CHECK_SETTLE_MS)
  )
  tell()
}

/** The film's page wrote down an error after it was ready (S-6). */
function runErrorSeen(h: FilmHost): void {
  if (hosts.get(h.assetId) !== h || !h.status.runError) return
  const v = verdicts.get(h.assetId) ?? {}
  v.runError = h.status.runError
  verdicts.set(h.assetId, v)
  returnVerdict(h.assetId, 'error', [h.status.runError])
  tell()
}

/** A film's verdict now (null: nothing known): the error its page wrote
 *  down after it was ready, else the checker's, else the early signs of its
 *  page (it failed; animations born off the clock: "unstable"). One badge. */
function verdictNow(assetId: string): { verdict: CheckVerdict; lines: string[] } | null {
  const v = verdicts.get(assetId)
  if (v?.runError) return { verdict: 'error', lines: [v.runError] }
  if (v?.check) return { verdict: v.check.verdict, lines: v.check.lines }
  const st = hosts.get(assetId)?.status
  if (st?.state === 'error' && st.error) return { verdict: 'error', lines: [st.error] }
  if (st?.state === 'ready' && st.unsteady) return { verdict: 'unstable', lines: [] }
  return null
}

/** Verdicts waiting for a clip of their film in the project. */
const pendingNotes = new Map<string, { verdict: CheckVerdict; lines: string[] }>()
let clipsWatched = false
function watchForClips(): void {
  if (clipsWatched) return
  clipsWatched = true
  useStore.subscribe((s, prev) => {
    if (!pendingNotes.size || s.project.clips === prev.project.clips) return
    for (const [id, v] of [...pendingNotes]) {
      if (!Object.values(s.project.clips).some((c) => c.assetId === id)) continue
      pendingNotes.delete(id)
      // (Its current verdict, if a newer one came meanwhile.)
      const now = verdictNow(id)
      queueMicrotask(() => returnVerdict(id, now?.verdict ?? v.verdict, now?.lines ?? v.lines))
    }
  })
}

/** Decision 2: a verdict that is not "ok" goes into a note on each of the
 *  film's clips in the project (one per clip, updated by the next verdict);
 *  "ok" marks that note done. */
function returnVerdict(assetId: string, verdict: CheckVerdict, lines: string[]): void {
  const st = useStore.getState()
  const clips = Object.values(st.project.clips).filter((c) => c.assetId === assetId)
  if (!clips.length) {
    // (Its clip is only in the agent's draft so far: the note comes when a
    // clip of it is in the project, the draft accepted.)
    pendingNotes.set(assetId, { verdict, lines })
    watchForClips()
    return
  }
  pendingNotes.delete(assetId)
  const text = tr('codeFilm.checkNote', { verdict: tr(`codeFilm.verdict.${verdict}`), line: (lines[0] ?? '').slice(0, 300) }).trim()
  st.editNotes((p) => {
    for (const c of clips) {
      const id = checkNotes.get(c.id)
      const n = id ? p.notes?.find((x) => x.id === id) : undefined
      if (verdict === 'ok') {
        if (n && n.status === 'open') setNoteStatus(p, n.id, 'ready', { reply: tr('codeFilm.checkPasses') })
        continue
      }
      if (n && (n.status === 'open' || n.status === 'agent')) {
        n.text = text
        continue
      }
      const made = addNote(p, { start: c.start, end: c.start + c.duration, kind: 'fix', text, prefer: [c.id] })
      checkNotes.set(c.id, made.id)
    }
  }, false)
}

/** Decision 1: is the page ready within 20 s; its 10 %, 50 % and 90 %
 *  moments drawn, another moment drawn, the same three again, and the same
 *  three on a fresh load of the page beside it. `span`: the film seconds a
 *  clip shows (default: the whole film). */
async function runCheck(asset: Asset, span: [number, number] | undefined, stopped: Promise<never>): Promise<CheckResult> {
  const t0 = performance.now()
  const lines: string[] = []
  const done = (verdict: CheckVerdict, h: FilmHost | null, moments: number[] = []): CheckResult => ({
    verdict,
    lines: [...new Set(lines)].slice(0, 8),
    length: h?.status.duration ?? (asset.duration || null),
    width: h?.status.width ?? asset.width,
    height: h?.status.height ?? asset.height,
    ...(h?.status.mode ? { mode: h.status.mode } : {}),
    moments,
    ms: performance.now() - t0,
    at: Date.now()
  })
  // (Called off by a newer save: every wait ends at once, CalledOff.)
  const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
    Promise.race([p, stopped, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(what)), ms))])
  const h = hostOf(asset, true)
  if (!h) {
    lines.push('its folder is missing')
    return done('error', null)
  }
  try {
    // (Audit D5: the live page may be loading again after quick saves, slowed
    // by the loads before it: its wait is not the 20 s measure. A fresh load
    // made once it is ready is: that one is held to CHECK_READY_MS.)
    await within(h.whenReady(), LIVE_READY_MS, `not ready in ${LIVE_READY_MS / 1000} s`)
  } catch (e) {
    lines.push(e instanceof Error ? e.message.split('\n')[0].slice(0, 300) : String(e))
    lines.push(...recordLines(await h.diag()))
    return done('error', h)
  }
  const W = h.status.width
  const H = h.status.height
  const w = Math.min(W, 480)
  const hh = Math.max(1, Math.round((H * w) / W))
  const d = h.status.duration ?? asset.duration ?? 0
  const [a, b] = span ?? [0, d > 0 ? d : 1]
  const { moments, between } = checkMoments(a, b)
  const pixels = (bmp: ImageBitmap): Uint8ClampedArray => {
    const o = new OffscreenCanvas(w, hh)
    const g = o.getContext('2d') as OffscreenCanvasRenderingContext2D
    g.drawImage(bmp, 0, 0, w, hh)
    bmp.close()
    return g.getImageData(0, 0, w, hh).data
  }
  const draw = async (host: FilmHost, t: number): Promise<Uint8ClampedArray> => pixels(await within(host.ask(t, true, w, hh, null).done, FRAME_TIMEOUT_MS, `${t} s was not drawn within a minute`))
  const first: Uint8ClampedArray[] = []
  const again: Uint8ClampedArray[] = []
  const fresh: Uint8ClampedArray[] = []
  let n: FilmHost | null = null
  try {
    for (const t of moments) first.push(await draw(h, t))
    await draw(h, between)
    for (const t of moments) again.push(await draw(h, t))
    // A fresh load beside it (not one of the live pages; closed after).
    n = new FilmHost(asset, () => {}, false, 1)
    await within(n.whenReady(), CHECK_READY_MS, `a fresh load was not ready in ${CHECK_READY_MS / 1000} s`)
    for (const t of moments) fresh.push(await draw(n, t))
  } catch (e) {
    lines.push(e instanceof Error ? e.message.split('\n')[0].slice(0, 300) : String(e))
  }
  const records = await Promise.all([h.diag(), n ? n.diag() : Promise.resolve(null)])
  // (What the main process refused it: not what the page says, its own list.)
  const refused = api?.codeFilm.blocked ? await api.codeFilm.blocked(filmIdOf(h.url)).catch(() => [] as string[]) : []
  // (Audit D8a: console.error lines, refused addresses and scripts that could
  // not load are facts — kept as lines, never the verdict alone.)
  const split = records.map(checkLines)
  const errs = [...lines, ...split.flatMap((x) => x.errors)]
  const facts = [...split.flatMap((x) => x.facts), ...refused.map((x) => `blocked: ${x.slice(0, 300)}`)]
  if (h.status.runError) errs.push(h.status.runError)
  n?.close()
  lines.length = 0
  lines.push(...errs)
  const blank = first.length === moments.length && first.every(blankPicture)
  if (blank && !errs.length) lines.push(BLANK_LINE)
  let unstable = false
  moments.forEach((t, i) => {
    for (const [other, how] of [[again[i], 'drawn again'], [fresh[i], 'on a fresh load']] as const) {
      if (!first[i] || !other || samePicture(first[i], other)) continue
      unstable = true
      if (!errs.length && !blank) lines.push(`${t} s ${how} differs (${(differingShare(first[i], other) * 100).toFixed(1)} % of the pixels)`)
    }
  })
  lines.push(...facts)
  return done(verdictOf({ errors: errs.length, blank, unstable }), h, moments)
}

/** A check of the film's code as it is at `gen`. Its result becomes the
 *  verdict (and goes back as a note) only while that is still the code and
 *  no newer save called it off. */
function startCheck(asset: Asset, span: [number, number] | undefined, gen: number): Running {
  const run = { gen, off: false } as Running
  run.stopped = new Promise<never>((_, reject) => {
    run.stop = () => {
      if (run.off) return
      run.off = true
      reject(new CalledOff('called off: its code changed'))
    }
  })
  run.stopped.catch(() => undefined)
  run.p = runCheck(asset, span, run.stopped)
    .then((r) => {
      const cur = useStore.getState().project.assets.find((x) => x.id === asset.id)
      if (!run.off && genOf(asset.id) === gen && cur && cur.url === asset.url) {
        verdicts.set(asset.id, { ...verdicts.get(asset.id), check: r })
        checkedGen.set(asset.id, gen)
        returnVerdict(asset.id, r.verdict, r.lines)
        tell()
      }
      return r
    })
    .finally(() => {
      if (checking.get(asset.id) === run) checking.delete(asset.id)
    })
  checking.set(asset.id, run)
  return run
}
/** The code count each film's kept verdict is of. */
const checkedGen = new Map<string, number>()

function changed(h: FilmHost): void {
  // The page's own size, length and fps (when they differ from what was
  // known before it ran): data derived from the film, not an edit.
  if (h.status.state === 'ready') {
    const s = useStore.getState()
    const a = s.project.assets.find((x) => x.id === h.assetId)
    if (a) {
      const patch: Partial<Asset> = {}
      if (a.width !== h.status.width) patch.width = h.status.width
      if (a.height !== h.status.height) patch.height = h.status.height
      if (h.status.duration && Math.abs(a.duration - h.status.duration) > 1e-3) patch.duration = h.status.duration
      if (h.status.fps && a.code && a.code.fps !== h.status.fps) patch.code = { ...a.code, fps: h.status.fps }
      if (h.status.mode && a.code && a.code.mode !== h.status.mode) patch.code = { ...(patch.code ?? a.code), mode: h.status.mode }
      if (Object.keys(patch).length) s.setAssetDerived(a.id, patch)
    }
  }
  // (A page that shows more than canvases and failed: kept, so its next
  // start goes straight to its drawing window.)
  if (h.status.state === 'error' && h.status.mode === 'page') {
    const s = useStore.getState()
    const a = s.project.assets.find((x) => x.id === h.assetId)
    if (a?.code && a.code.mode !== 'page') s.setAssetDerived(a.id, { code: { ...a.code, mode: 'page' } })
  }
  if (h.status.state === 'ready') void stripOf(h.assetId)
  if (h.status.state === 'error') reportOnce(`code film:${h.assetId}:${h.status.error}`, h.status.unresponsive || h.status.lost ? String(h.status.error) : `The code film did not start: ${h.status.error}`)
  bumpFramesVersion()
  for (const l of listeners) l()
}

/** Films whose strip is being made (once per page start). */
const stripping = new Set<string>()

/** The bin's thumbnail and the timeline's filmstrip of a code film: small
 *  frames asked from its page once it runs (like a video's, from its code). */
async function stripOf(assetId: string): Promise<void> {
  if (stripping.has(assetId)) return
  stripping.add(assetId)
  try {
    const a0 = useStore.getState().project.assets.find((x) => x.id === assetId)
    if (!a0 || a0.kind !== 'code' || a0.duration <= 0) return
    // The timeline's strip cells (components/Filmstrip.tsx, STRIP_CELL).
    const cellW = 96
    const cellH = 54
    const cols = Math.max(8, Math.min(48, Math.round(a0.duration / 4)))
    const strip = document.createElement('canvas')
    strip.width = cellW * cols
    strip.height = cellH
    const g = strip.getContext('2d')
    if (!g) return
    let thumb: string | undefined
    // Does any sampled frame let something through (phase 5b, decision 2)?
    let alpha = false
    let sampled = 0
    for (let i = 0; i < cols; i++) {
      // The preview comes first: a strip never delays a frame being watched.
      while (previewPlaying || exportLock > 0) await new Promise((r) => setTimeout(r, 500))
      const a = useStore.getState().project.assets.find((x) => x.id === assetId)
      if (!a || !hosts.has(assetId)) return
      const bmp = await codeFilms.exactFrame(a, ((i + 0.5) / cols) * a.duration, undefined, 160).catch(() => null)
      if (!bmp) continue
      sampled++
      if (!alpha) alpha = seeThrough(bmp)
      // Covered, at the film's own aspect; a checker under where it is
      // transparent (a JPEG strip has no alpha of its own).
      drawChecker(g, i * cellW, 0, cellW, cellH)
      const k = Math.max(cellW / bmp.width, cellH / bmp.height)
      g.drawImage(bmp, i * cellW + (cellW - bmp.width * k) / 2, (cellH - bmp.height * k) / 2, bmp.width * k, bmp.height * k)
      if (i === Math.min(1, cols - 1)) {
        const c = document.createElement('canvas')
        c.width = bmp.width
        c.height = bmp.height
        const cg = c.getContext('2d')
        if (cg) {
          drawChecker(cg, 0, 0, c.width, c.height)
          cg.drawImage(bmp, 0, 0)
        }
        thumb = c.toDataURL('image/jpeg', 0.7)
      }
      bmp.close()
    }
    const a1 = useStore.getState().project.assets.find((x) => x.id === assetId)
    if (sampled > 0) noteFilmAlpha(assetId, alpha)
    // (Also when it was not said at all: an opaque film is "false", known.)
    const code = a1?.code && sampled > 0 && a1.code.hasAlpha !== alpha ? { code: { ...a1.code, hasAlpha: alpha } } : {}
    useStore.getState().setAssetDerived(assetId, { ...(thumb ? { thumbnail: thumb } : {}), filmstrip: strip.toDataURL('image/jpeg', 0.55), filmstripCols: cols, ...code })
  } finally {
    stripping.delete(assetId)
  }
}

/** The films the preview needs now (under the playhead or inside the
 *  pre-roll), as the engine said at its last tick (5a/5b patch, C-3). */
let neededNow = new Set<string>()
/** Films the preview needs now that got no page: more were needed at once
 *  than LIVE_PAGES (their status says so; they wait for a free page). */
const limited = new Map<string, FilmStatus>()

function limitedStatus(asset: Asset): FilmStatus {
  return { state: 'limited', error: tr('codeFilm.tooMany', { n: LIVE_PAGES }), width: asset.width, height: asset.height, fps: asset.code?.fps ?? null, duration: asset.duration || null }
}

/** The host of a code film (made, and its page started, when first needed).
 *  A changed address or flag starts it again. `force` (an export, a still
 *  frame, a strip): a page even past the limit. Otherwise at most LIVE_PAGES
 *  live: room is made only by letting go of a page that is not needed now
 *  and not busy; when there is none, the film gets no page (it is `limited`)
 *  and no page needed now is ever let go for it (a page needed now let go
 *  for another needed now was the endless open-and-close loop, audit C-3). */
function hostOf(asset: Asset, force = false): FilmHost | null {
  if (asset.kind !== 'code' || !asset.url || asset.missing || typeof document === 'undefined') return null
  let h = hosts.get(asset.id)
  if (h && h.url !== asset.url) {
    h.close()
    hosts.delete(asset.id)
    h = undefined
  }
  // Its parameter values or the project look changed (phase 5f): the page
  // is opened again with them; what the preview holds stays meanwhile.
  if (h && h.query !== queryOf(asset, h.scale)) h = rescale(h, asset, h.scale)
  // An export draws the film at its scale (phase 5d.2, decision 6): a page
  // at another scale is loaded again for it (and at 1 again afterwards:
  // lockForExport). What the preview held of it stays on screen meanwhile.
  let scale = force && exportLock > 0 && exportHeight ? exportScaleOf(exportHeight, asset.height) : null
  // (5c + 5d audit, K1: a fast-path page that read chance or the clock while
  // it loaded is loaded at the export's scale only once a page loaded so was
  // found to draw what the preview's page draws: checkScale. Until then, and
  // if not, the page the preview has draws the export, enlarged.)
  if (scale !== null && scale !== 1) {
    const ready = !!h && h.status.state === 'ready' && !h.dead
    // (A fast-path page whose chance is not known yet counts as not known.)
    const mode = ready ? h!.status.mode : asset.code?.mode === 'fast' ? undefined : asset.code?.mode
    if (!mayLoadAtScale(mode, ready ? h!.loadChance : null, scaleOk.get(asset.id))) scale = h ? h.scale : 1
  }
  if (h && scale !== null && h.scale !== scale) return rescale(h, asset, scale)
  if (!h) {
    if (!force && exportLock === 0 && !roomFor(asset.id)) {
      if (!limited.has(asset.id)) {
        limited.set(asset.id, limitedStatus(asset))
        reportOnce('code film limit', tr('codeFilm.tooMany', { n: LIVE_PAGES }))
        bumpFramesVersion()
        for (const l of listeners) l()
      }
      return null
    }
    if (limited.delete(asset.id)) for (const l of listeners) l()
    // (Its code changed since it last ran: how to play it is chosen again.)
    h = new FilmHost(asset, changed, rechoose.delete(asset.id), scale ?? 1)
    hosts.set(asset.id, h)
    startSweep()
    for (const l of listeners) l()
  }
  h.lastUsed = performance.now()
  return h
}

/** The address query a film's page is opened with: the app's mark, the
 *  export's scale, and (phase 5f) the user's parameter values and the
 *  project look ('' parts left out: a film without them is opened as before). */
function queryOf(asset: Asset, scale: number): string {
  const v = valuesQuery(asset.code?.params, useStore.getState().project.look)
  // (Cila K: and the name of its hand-made changes, written into the page
  // as it is served: media/codefilm-values.ts.)
  const e = editsQuery(asset, filmIdOf(asset.url))
  return filmQuery(scale) + (v ? '&' + v : '') + (e ? '&' + e : '')
}

/** A film's page made again at another drawing scale (an export's, or 1
 *  after it); the frames the preview holds stay on screen, asked again. */
function rescale(h: FilmHost, asset: Asset, scale: number): FilmHost {
  const kept = new Map(h.plans)
  h.plans.clear()
  h.close()
  hosts.delete(asset.id)
  const n = new FilmHost(asset, changed, false, scale)
  hosts.set(asset.id, n)
  for (const [cid, plan] of kept) {
    plan.asked = []
    markOld(plan)
    n.plans.set(cid, plan)
  }
  startSweep()
  bumpFramesVersion()
  for (const l of listeners) l()
  return n
}

/** (K1) Per film, during one export: may its page be loaded again at the
 *  export's scale (found by checkScale), and the checks running. */
const scaleOk = new Map<string, boolean>()
const scaleChecks = new Map<string, Promise<void>>()

/** Before an export asks a film's frame: a fast-path page that read chance
 *  or the clock while it loaded (5c + 5d audit, K1) is loaded once more at
 *  the export's scale BESIDE the page the preview has, and both are asked
 *  the same moments (the one asked, 30 % and 70 % of the film). The same
 *  pictures (phase 5c's margin): the new page takes the old one's place and
 *  draws the export at its scale. Not the same, or it fails: it is closed,
 *  and the preview's own page draws the export, enlarged (the export window
 *  already warns of it); the preview keeps that page, unchanged. */
async function checkScale(asset: Asset, t: number): Promise<void> {
  if (!(exportLock > 0 && exportHeight)) return
  const k = exportScaleOf(exportHeight, asset.height)
  if (k === 1 || scaleOk.has(asset.id)) return
  let p = scaleChecks.get(asset.id)
  if (!p) {
    p = verifyScale(asset, k, t)
      .catch(() => {
        scaleOk.set(asset.id, false)
      })
      .finally(() => scaleChecks.delete(asset.id))
    scaleChecks.set(asset.id, p)
  }
  await p
}

async function verifyScale(asset: Asset, k: number, t: number): Promise<void> {
  const h = hostOf(asset, true)
  if (!h) return
  await h.whenReady()
  // (On the app's clock a page draws the same on every load: hostOf loads it
  // at k. A fast-path page that read no chance: the same.)
  if (h.status.mode !== 'fast') return
  if (!h.loadChance) {
    scaleOk.set(asset.id, true)
    return
  }
  const W = h.status.width
  const H = h.status.height
  const d = Math.max(0.1, h.status.duration ?? asset.duration ?? 1)
  const moments = [...new Set([t, d * 0.3, d * 0.7].map((x) => Math.round(Math.max(0, Math.min(x, d)) * 1000) / 1000))]
  const within = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])
  const pixels = (b: Bmp): Uint8ClampedArray => {
    const o = new OffscreenCanvas(W, H)
    const g = o.getContext('2d') as OffscreenCanvasRenderingContext2D
    g.drawImage(b, 0, 0, W, H)
    return g.getImageData(0, 0, W, H).data
  }
  let n: FilmHost | null = new FilmHost(asset, (x) => {
    if (hosts.get(x.assetId) === x) changed(x)
  }, false, k)
  let same = false
  try {
    await within(n.whenReady(), BOOT_TIMEOUT_MS)
    same = n.status.mode === 'fast'
    for (const at of moments) {
      if (!same) break
      const a = await within(h.ask(at, true, W, H, null).done, FRAME_TIMEOUT_MS)
      const b = await within(n.ask(at, true, W, H, null).done, FRAME_TIMEOUT_MS)
      same = samePicture(pixels(a), pixels(b))
      a.close()
      b.close()
    }
  } catch {
    same = false
  }
  if (same && hosts.get(asset.id) === h && !h.closed) {
    // The page at k takes the place of the preview's (its held frames stay
    // on screen, asked again later, as rescale does).
    const kept = new Map(h.plans)
    h.plans.clear()
    h.close()
    hosts.set(asset.id, n)
    for (const [cid, plan] of kept) {
      plan.asked = []
      markOld(plan)
      n.plans.set(cid, plan)
    }
    n = null
    bumpFramesVersion()
    for (const l of listeners) l()
  }
  n?.close()
  scaleOk.set(asset.id, same)
}

/** Is there a page for one more film? Fewer than LIVE_PAGES live, or one
 *  that is neither needed now nor busy can go (the least recently used). */
function roomFor(id: string): boolean {
  const live = [...hosts.values()].filter((x) => !x.dead && x.assetId !== id)
  if (live.length < LIVE_PAGES) return true
  const free = live.filter((x) => !x.busy && !neededNow.has(x.assetId)).sort((a, b) => a.lastUsed - b.lastUsed)[0]
  if (!free) return false
  free.close()
  hosts.delete(free.assetId)
  bumpFramesVersion()
  return true
}

/** Pages let go (phase 5a, decision 7): unused for IDLE_RELEASE_MS, or the
 *  least recently used beyond LIVE_PAGES. Never while an export draws. A page
 *  already let go as not responding keeps its status (and no page) until it
 *  is unused too. */
function releasePages(keep?: string): void {
  if (exportLock > 0) return
  const all = [...hosts.values()]
  // (A page needed now counts as busy: it is never let go for another.)
  const live = all.filter((h) => !h.dead).map((h) => ({ id: h.assetId, lastUsed: h.lastUsed, busy: h.busy || neededNow.has(h.assetId) }))
  const dead = all.filter((h) => h.dead).map((h) => ({ id: h.assetId, lastUsed: h.lastUsed, busy: false }))
  const go = [...pagesToRelease(live, performance.now(), LIVE_PAGES, keep), ...pagesToRelease(dead, performance.now(), Infinity, keep)]
  for (const id of go) {
    const h = hosts.get(id)
    if (!h) continue
    h.close()
    hosts.delete(id)
  }
  if (go.length) {
    bumpFramesVersion()
    for (const l of listeners) l()
  }
}

let sweep: ReturnType<typeof setInterval> | null = null
function startSweep(): void {
  if (sweep) return
  sweep = setInterval(() => {
    releasePages()
    if (!hosts.size && sweep) {
      clearInterval(sweep)
      sweep = null
    }
  }, 5000)
}

function planOf(h: FilmHost, clipId: string): ClipPlan<Bmp> {
  let p = h.plans.get(clipId)
  if (!p) {
    p = newPlan<Bmp>()
    h.plans.set(clipId, p)
  }
  return p
}

export const codeFilms = {
  /** The film's page, started if it was not. */
  ensure(asset: Asset): void {
    hostOf(asset)
  },

  /** Pages whose folder changed since they loaded start again, and the
   *  caller waits for them: the frame paths call it before drawing, so an
   *  edit is seen even when no watcher event came (an atomic save, a network
   *  folder). Cheap: one stat walk per code film. */
  async freshen(project: Project): Promise<void> {
    if (!api || exportLock > 0) return
    const live = new Set(project.assets.filter((a) => a.kind === 'code' && !a.missing).map((a) => a.id))
    for (const [assetId, h] of [...hosts]) {
      if (!live.has(assetId) || h.closed || h.dead) continue
      const changed = await h.refreshStamp().catch(() => false)
      if (!changed) continue
      this.reload(assetId)
      await hosts.get(assetId)?.whenReady().catch(() => undefined)
    }
  },

  /** The films the preview needs now (under the playhead or inside the
   *  pre-roll), every tick, in timeline order: each gets its page while there
   *  is room; those needed now are never let go for one another. */
  need(assets: readonly Asset[]): void {
    neededNow = new Set(assets.map((a) => a.id))
    let gone = false
    for (const id of [...limited.keys()]) if (!neededNow.has(id)) gone = limited.delete(id) || gone
    if (gone) for (const l of listeners) l()
    for (const a of assets) hostOf(a)
  },

  /** The preview tells whether it plays (frames ahead) or is still (exact). */
  setPlaying(playing: boolean): void {
    if (playing === previewPlaying) return
    previewPlaying = playing
    // Exact asks queued for a still frame are not wanted once it plays.
    if (playing)
      for (const h of hosts.values())
        for (const plan of h.plans.values()) {
          const ids = replaceable(plan)
          h.drop(ids)
        }
  },

  /** The preview's frame of a code clip at film time t: the best one held
   *  (null before the first arrives), and the next asked for. */
  frameFor(clip: Clip, asset: Asset, t: number): CanvasImageSource | null {
    const h = hostOf(asset)
    if (!h) return null
    const plan = planOf(h, clip.id)
    const mode: FrameMode = previewPlaying ? 'play' : 'exact'
    const fps = h.status.fps ?? asset.code?.fps ?? 60
    const key = 0
    const held = pick(plan, t, mode, fps, key)
    if (h.status.state !== 'ready' || exportLock > 0) return held?.bmp ?? null
    if (mode === 'play') h.notePlaying(performance.now())
    const W = h.status.width
    const H = h.status.height
    const w = mode === 'play' ? Math.min(W, PLAY_MAX_W) : W
    const hh = Math.max(1, Math.round((H * w) / W))
    const next = want(plan, Math.max(0, t), mode, fps, w, hh, key)
    if (next) {
      if (mode === 'exact') h.drop(replaceable(plan))
      h.ask(next.t, next.prep, next.w, next.h, plan)
    }
    return held?.bmp ?? null
  },

  /** The export's frame: second t of the film, PREP awaited, full size (or
   *  `width` wide: thumbnails). */
  async exactFrame(asset: Asset, t: number, signal?: AbortSignal, width?: number): Promise<ImageBitmap> {
    // (An export at a scale: may its page be loaded again at it? K1.)
    await checkScale(asset, t)
    // (Past the live-page limit if it must: an export or a still needs it.)
    const h = hostOf(asset, true)
    if (!h) throw new Error(`The code film "${asset.name}" cannot be opened (its folder is missing).`)
    let timer: ReturnType<typeof setTimeout> | null = null
    let id = -1
    const onAbort = (): void => {
      if (id >= 0) h.drop([id])
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      // (Inside the try: a page that failed, or lost its graphics context,
      // is named in the message like any other failure.)
      await h.whenReady()
      const W = h.status.width
      const H = h.status.height
      // Full size: the film's own, times the export's scale (phase 5d.2,
      // decision 6) when its page was loaded again for it.
      const full = Math.max(1, Math.round(W * h.scale))
      const w = width && width > 0 && width < full ? Math.round(width) : full
      const asked = h.ask(Math.max(0, t), true, w, Math.max(1, Math.round((H * w) / W)), null)
      id = asked.id
      const done = asked.done
      return await Promise.race([
        done,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`The code film "${asset.name}" did not draw ${t.toFixed(2)} s within a minute.`)), FRAME_TIMEOUT_MS)
        })
      ])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (signal?.aborted) throw new Error('Export cancelled')
      throw new Error(msg.startsWith('The code film') ? msg : `The code film "${asset.name}" could not draw ${t.toFixed(2)} s: ${msg.split('\n')[0]}`)
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  },

  /** Every code film a clip in [a, b] shows, started and ready (or an error
   *  naming the film). */
  async ready(project: Project, range: [number, number], signal?: AbortSignal): Promise<void> {
    // (Before any frame: a folder edited since its page loaded starts again.)
    await this.freshen(project).catch(() => undefined)
    const used = new Map<string, Asset>()
    for (const c of Object.values(project.clips)) {
      if (c.disabled || c.start >= range[1] || c.start + c.duration <= range[0]) continue
      const a = project.assets.find((x) => x.id === c.assetId)
      const tr = project.tracks.find((t) => t.id === c.trackId)
      if (a?.kind === 'code' && !tr?.hidden) used.set(a.id, a)
    }
    for (const a of used.values()) {
      if (a.missing || !a.url) throw new Error(`The video was not exported. The code film "${a.name}" can't be found (its folder was moved or deleted) — relink it or take it off the timeline, then export again.`)
      const h = hostOf(a, true)!
      const aborted = new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('Export cancelled')), { once: true }))
      try {
        await Promise.race([h.whenReady(), aborted])
      } catch (e) {
        if (signal?.aborted) throw new Error('Export cancelled')
        throw new Error(`The video was not exported. The code film "${a.name}" did not start: ${e instanceof Error ? e.message : String(e)}`)
      }
      // Whether it lets the tracks under it through, if nothing knows yet
      // (its strip waits while an export runs): worked out here, as the
      // strip does, so a look or a light on it is drawn the right way from
      // the first frame (5a/5b patch, audit S-9).
      if (!filmAlphaKnown(a)) {
        let alpha = false
        let sampled = 0
        for (let i = 0; i < 8 && !alpha; i++) {
          const bmp = await codeFilms.exactFrame(a, ((i + 0.5) / 8) * Math.max(0.1, a.duration), signal, 160).catch(() => null)
          if (signal?.aborted) throw new Error('Export cancelled')
          if (!bmp) continue
          sampled++
          alpha = seeThrough(bmp)
          bmp.close()
        }
        if (sampled > 0) {
          noteFilmAlpha(a.id, alpha)
          const cur = useStore.getState().project.assets.find((x) => x.id === a.id)
          if (cur?.code && cur.code.hasAlpha !== alpha) useStore.getState().setAssetDerived(a.id, { code: { ...cur.code, hasAlpha: alpha } })
        }
      }
    }
  },

  /** While an export draws, the preview asks nothing (the page only moves
   *  forward for the export). Counted: nested exports. */
  lockForExport(on: boolean): void {
    exportLock = Math.max(0, exportLock + (on ? 1 : -1))
    if (exportLock > 0) return
    exportHeight = null
    scaleOk.clear()
    // The pages loaded again at the export's scale go back to 1 (phase
    // 5d.2, decision 6): one the preview needs now at once, the others
    // when next needed.
    let gone = false
    for (const h of [...hosts.values()]) {
      if (h.scale === 1) continue
      const a = useStore.getState().project.assets.find((x) => x.id === h.assetId)
      if (a && neededNow.has(a.id) && !h.dead) {
        rescale(h, a, 1)
        continue
      }
      h.close()
      hosts.delete(h.assetId)
      gone = true
    }
    if (gone) {
      bumpFramesVersion()
      for (const l of listeners) l()
    }
  },

  /** The running export's output height (call after lockForExport(true)):
   *  its code films are drawn at k = outH / their height, 1 … 2 (phase 5d.2,
   *  decision 6). */
  exportHeight(outH: number): void {
    if (exportLock > 0 && Number.isFinite(outH) && outH > 0) exportHeight = outH
  },

  /** The scale a film's page draws at now (1, or an export's). */
  scaleOf(assetId: string): number {
    return hosts.get(assetId)?.scale ?? 1
  },

  /** (Cila K) `fn` is told when the film's code files change on disk, for
   *  as long as the returned function is not called (its folder is watched
   *  meanwhile, page or no page). */
  watchCode(asset: Asset, fn: (assetId: string) => void): () => void {
    const id = filmIdOf(asset.url)
    watchFilm(id, true)
    codeWatchers.add(fn)
    return () => {
      codeWatchers.delete(fn)
      watchFilm(id, false)
    }
  },

  /** Its page started again (its code changed, or by hand). */
  reload(assetId: string): void {
    const h = hosts.get(assetId)
    if (!h) return
    // The frames on screen stay there until the new page draws (no black
    // flash while it starts); only what was asked of the old page is gone.
    const kept = new Map(h.plans)
    h.plans.clear()
    h.close()
    hosts.delete(assetId)
    reported.clear()
    const a = useStore.getState().project.assets.find((x) => x.id === assetId)
    const n = a ? hostOf(a) : null
    if (n) {
      for (const [cid, plan] of kept) {
        plan.asked = []
        // Of the page before the change: shown meanwhile, asked for again.
        markOld(plan)
        n.plans.set(cid, plan)
      }
    } else {
      for (const plan of kept.values()) retire(clearPlan(plan))
      for (const l of listeners) l()
    }
  },

  /** Pages of films no longer in the project are closed. */
  release(alive: ReadonlySet<string>): void {
    for (const id of [...limited.keys()]) if (!alive.has(id)) limited.delete(id)
    // Never while an export draws (like releasePages): it may hold a page of
    // a film the project no longer shows (5a/5b patch, audit C-7). The next
    // pruning after it lets it go.
    if (exportLock > 0) return
    for (const [id, h] of hosts) {
      if (alive.has(id)) continue
      h.close()
      hosts.delete(id)
    }
  },

  /** Frames held for clips no longer on the timeline are let go. */
  releaseClips(alive: ReadonlySet<string>): void {
    for (const h of hosts.values())
      for (const [cid, plan] of h.plans) {
        if (alive.has(cid)) continue
        retire(clearPlan(plan))
        h.plans.delete(cid)
      }
  },

  status(assetId: string): FilmStatus | null {
    return hosts.get(assetId)?.status ?? limited.get(assetId) ?? null
  },

  /** What the app's guard in the film's page wrote down: its errors, the
   *  addresses its policy refused, its boxes, its sounds (null: no page, or
   *  no answer in 2 s). */
  async diag(assetId: string): Promise<FilmRecord | null> {
    const h = hosts.get(assetId)
    if (!h) return null
    // What the main process refused it (main/film-fence.ts) comes first: the
    // page's own record is what the page says, this is not (5a/5b patch).
    const [rec, refused] = await Promise.all([h.diag(), api?.codeFilm.blocked ? api.codeFilm.blocked(filmIdOf(h.url)).catch(() => [] as string[]) : Promise.resolve([] as string[])])
    if (!rec && !refused.length) return null
    const base = rec ?? { errors: [], blocked: [], failed: [], dialogs: [], media: 0, audio: 0, opened: 0, uses: [] as string[] }
    return { ...base, blocked: [...refused, ...base.blocked].slice(0, 50) }
  },

  /** The film-times of the frames the preview holds for a clip (its page as
   *  it is now): what a check reads to know the paused frame came. */
  heldTimes(assetId: string, clipId: string): number[] {
    return (hosts.get(assetId)?.plans.get(clipId)?.frames ?? []).filter((f) => !f.old).map((f) => f.t)
  },

  /** How a film's start went (its host's steps, and what the host page says
   *  of its own start): for a page that stays "booting". */
  async bootTrace(assetId: string): Promise<{ steps: string[]; host: string | null; live: number } | null> {
    const h = hosts.get(assetId)
    if (!h) return null
    await h.diag()
    return { steps: [...h.trace], host: h.hostStage, live: [...hosts.values()].filter((x) => !x.dead).length }
  },

  /** Phase 5e, decision 1: the checker. Its result is the film's verdict
   *  (one badge; it rules over the page's early "unstable" sign) and goes
   *  back as decision 2 says (a note on its clips). One check per film at a
   *  time (asked again meanwhile: the running one's result). Refused while
   *  an export draws. */
  async check(asset: Asset, span?: [number, number]): Promise<CheckResult> {
    if (exportLock > 0) throw new Error('An export is running; check the clip after it.')
    // Audit D1 + D5: the answer is always of the code as it is when the
    // check ends. A check of older code (called off by a save) is waited
    // out — it writes nothing — and the code of now is checked; a check of
    // the same code is joined. The code changing all the time: given up.
    for (let round = 0; round < 6; round++) {
      const gen = genOf(asset.id)
      const running = checking.get(asset.id)
      if (running && (running.gen !== gen || running.off)) {
        running.stop()
        await running.p.catch(() => undefined)
        continue
      }
      const run = running ?? startCheck(useStore.getState().project.assets.find((x) => x.id === asset.id && x.kind === 'code') ?? asset, span, gen)
      const r = await run.p.catch((e: unknown) => {
        if (run.off) return null
        throw e
      })
      if (r && !run.off && genOf(asset.id) === gen) return r
      if (exportLock > 0) throw new Error('An export is running; check the clip after it.')
    }
    throw new Error('Its code kept changing while it was checked: check it again once it is written.')
  },

  /** The film's verdict now (null: nothing known yet). */
  verdict(assetId: string): { verdict: CheckVerdict; lines: string[]; checked: boolean } | null {
    const v = verdictNow(assetId)
    return v ? { ...v, checked: !!verdicts.get(assetId)?.check } : null
  },

  /** What the timeline shows on a code clip (decision 2): "writing" (made by
   *  the agent, its code not written yet), when its code was last saved, and
   *  whether its verdict is an error. Read on a change, never per frame. */
  activity(assetId: string): { writing: boolean; savedAt: number; checking: boolean } {
    return { writing: writing.has(assetId), savedAt: savedAt.get(assetId) ?? 0, checking: checking.has(assetId) }
  },

  /** A film the code_clip tool just made: "writing" until its code changes. */
  markWriting(assetId: string): void {
    writing.add(assetId)
    tell()
  },

  /** The id the main process gave the film's folder (its snippfilm host). */
  folderId(asset: Asset): string {
    return filmIdOf(asset.url)
  },

  /** The films whose pages live now. */
  livePages(): string[] {
    return [...hosts.values()].filter((h) => !h.dead).map((h) => h.assetId)
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
}
