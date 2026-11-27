// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useCallback, useEffect, useRef, useState } from 'react'
import { Inspector } from './components/Inspector'
import { WorkspaceDock } from './components/WorkspaceDock'
import { DOCK_CATS_PX, useDockOpen } from './components/app/dock-open'
import { deleteTemplate } from './templates/model'
import { agentAccessOn, decideReview, endReview, newNote, removeNote, stepNote, toggleReviewBefore, togglePointNote } from './notes/review'
import { previewActualSize, previewFit, stepPlayRate } from './components/preview/actions'
import { usePreviewUi } from './components/preview/pv-ui'
import { stepFrame } from './ui/timecode'
import { PreviewCanvas } from './components/PreviewCanvas'
import { PreviewToolbar } from './components/PreviewToolbar'
import { ShortsPanel } from './components/ShortsPanel'
import { TransportBar } from './components/TransportBar'
import { ExportWindow, openExportWindow } from './components/ExportWindow'
import { onShellRequest } from './components/app/requests'
import { Tour } from './components/Tour'
import { makeSampleProject } from './media/sample-project'
import { setExportMark } from './export/marks'
import { Timeline } from './components/Timeline'
import { TopBar } from './components/TopBar'
import { PreviewSlot } from './components/PreviewSlot'
import { WatchMode } from './components/watch/WatchMode'
import { toggleWatch, useWatch } from './components/watch/watch-state'
import { createPortal } from 'react-dom'
import { engine } from './playback/engine'
import { exportProjectMp4, preloadImagesForExport, type ExportSettings } from './export/exporter'
import { formatOf, safeFileName, uniqueFileNames } from './export/formats'
import { runExportJob } from './export/run-job'
import { wasCancelled } from './export/job'
import { checkRenderCancelled } from './export/cancel'
import { plainFileError } from './export/file-target'
import { ExportProgress } from './components/ExportProgress'
import { youtubePackage } from './export/youtube'
import type { AspectId, Asset, ShortSegment } from './types'
import { projectDuration, isSubtitle } from './types'
import { fitTimeline, zoomToRange } from './components/timeline/view-state'
import { timelineDropAt } from './timeline/droptarget'
import { codeFilms } from './media/codefilm'
import { codeFilmImport, computeFilmstrip, importDroppedFiles, importMediaFiles, type ImportResult } from './media/import'
import { startRecoveryWriter } from './media/recovery-writer'
import { adoptRecovery, BackupFailedError, clearOwnRecovery, ChangedOnDiskError, openBackup, clearRecovery, enrichAsset, getLastProjectPath, NewerFormatError, openProject, openProjectByPath, readRecovery, releaseRecovery, repairSummary, saveProject, moveProjectPath, setLastProjectPath, setRecoveredProjectPath, writeRecovery } from './media/projectio'
import type { RepairNote } from './model/repair'
import { NewerFileDialog } from './components/app/NewerFileDialog'
import { BackupsDialog, backupTime, type BackupEntry } from './components/app/BackupsDialog'
import { refreshChangedAndTell } from './media/relink-ui'
import { watchMediaFiles } from './media/live-watch'
import { listenChat } from './agent/chat'
import { autosaveOnce } from './media/autosave'
import { releaseAllMedia } from './media/sources'
import { IconButton, dismissToast, notify, t, useT } from './ui'
import { t as tr } from './ui/strings'
import { capturePlayheadThumbnail, upsertRecent } from './media/recents'
import { ProjectHome } from './components/ProjectHome'
import { noteLaunch, setHomeShowing, whenLaunchSettled } from './components/app/launch-home'
import { api, downloadBlob } from './platform'
import { projectSession, useStore } from './state/store'
import { copyNotice, type LegacyPart } from './media/legacy'
import { eventToBinding, loadBindings, modalOpen, saveBindings, shortcutsAllowed, shuttleStep, spaceWorksControl, type Bindings } from './shortcuts'
import { focusCameByKeyboard, installFocusOrigin } from './ui/focus-origin'
import { keyTimes, stepKey } from './timeline/key-nav'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastStack } from './ui/Toasts'
import { installHints } from './components/explanations'
import { captionsToSrt } from './subtitles/srt'
import { voiceSet } from './subtitles/voice-set'
import { cancelTranscription, transcribeProjectRange, type TranscribeProgress } from './subtitles/transcribe'
import { claimWhisper, transcribeIntoProject } from './subtitles/run'
import { isCaptionSource } from './subtitles/source'
import { describeExport, exportBusy, loadLayout, saveLayout } from './components/app/layout'
import { BIN_MAX_PX, BIN_MIN_PX, SPLITTER_KEY_STEP_PX, TIMELINE_DEFAULT_RATIO, ratioFromPx, timelinePx } from './components/app/timeline-size'
import type { Toast, PanelLayout } from './components/app/layout'
import { MissingMediaDialog, AskDialog, ConfirmHost, ModeHelp, Splitter } from './components/app/dialogs'
import { SettingsWindow } from './components/settings/SettingsWindow'
import { openSettings } from './components/settings/open'
import { confirmDialog } from './ui/confirm'
import { projectNameShown } from './ui/format'
import { addDefaultNearPlayhead, putTransition, selectTransition, selectedTransition } from './components/timeline/transition-state'
import { useSession } from './agent/session'

export function App(): JSX.Element {
  // The shell's own words (the splitter's name, the asks) come from t(): a
  // change of language draws them again at once (audit E1).
  useT()
  const [layout, setLayout] = useState<PanelLayout>(loadLayout)
  const [bindings, setBindings] = useState<Bindings>(loadBindings)
  const [missingPrompt, setMissingPrompt] = useState(false)
  // The one preview: it is drawn into this, and this is shown in the
  // editor's preview.
  const [previewHost] = useState(() => {
    const el = document.createElement('div')
    el.className = 'preview-host'
    return el
  })

  // The left panel's page can be closed (DENEME-1, P2): its width goes to the preview.
  const dockOpen = useDockOpen()
  // The watch-and-note mode (IZLE-PLAN.md): a layer over the editor, which stays as it is under it.
  const watching = useWatch((w) => w.on)
  const patchLayout = useCallback((patch: Partial<PanelLayout>) => {
    setLayout((prev) => {
      const next = {
        bin: Math.min(BIN_MAX_PX, Math.max(BIN_MIN_PX, patch.bin ?? prev.bin)),
        inspector: Math.min(520, Math.max(200, patch.inspector ?? prev.inspector)),
        timelineRatio: patch.timelineRatio ?? prev.timelineRatio,
        inspectorOpen: patch.inspectorOpen ?? prev.inspectorOpen
      }
      saveLayout(next)
      return next
    })
  }, [])
  // The timeline is a share of the window (phase 3c.Y, K1): its pixels follow
  // the window's height.
  const [winH, setWinH] = useState(() => window.innerHeight)
  useEffect(() => {
    const on = (): void => setWinH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const timelineH = timelinePx(layout.timelineRatio, winH)
  const resizeTimeline = (px: number): void => patchLayout({ timelineRatio: ratioFromPx(px, window.innerHeight) })

  // The shell's toasts go to the one stack (phase 3c.4b); one with a button
  // or an error stays long enough to be reached for (toastTimeout).
  const showToast = useCallback((text: string, error = false, action?: Toast['action']) => {
    notify({ text, kind: error ? 'error' : 'info', action })
  }, [])

  // A preview failure (a frozen picture, a stuck playhead) is said, not hidden.
  useEffect(() => {
    const on = (e: Event): void => showToast(t('app.previewProblem', { what: (e as CustomEvent<string>).detail }), true)
    window.addEventListener('snipp-preview-error', on)
    return () => window.removeEventListener('snipp-preview-error', on)
  }, [showToast])

  const ingest = useCallback(
    ({ assets, errors }: ImportResult): Asset[] => {
      let added: Asset[] = []
      if (assets.length > 0) {
        // Waveforms are computed lazily by the timeline's waveform cache.
        // Only the assets that were really added come back: re-importing a file
        // the project already has reuses the existing one, and reporting it as
        // imported (while decoding a filmstrip for an id nothing references)
        // made a no-op look like a success.
        added = useStore.getState().addAssets(assets)
        // Build the filmstrip in the background (non-blocking).
        for (const a of added) {
          if (a.kind === 'video') {
            void computeFilmstrip(a, (id, patch) => useStore.getState().setAssetDerived(id, patch))
          }
        }
        const skipped = assets.length - added.length
        if (added.length === 0) {
          showToast(t('app.import.none'))
        } else {
          showToast(
            t(added.length === 1 ? 'app.import.one' : 'app.import.many', { n: added.length }) +
              (skipped > 0 ? ' ' + t('app.import.skipped', { n: skipped }) : '')
          )
        }
        // Proxies stay MANUAL (the ⚡ button in the media bin). Building one
        // decodes and re-encodes the whole clip, so doing it automatically
        // burns minutes of CPU on footage that may never need it.
      }
      if (errors.length > 0) showToast(errors.join(' · '), true)
      return added
    },
    [showToast]
  )

  const handleImport = useCallback(async () => {
    try {
      ingest(await importMediaFiles())
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true)
    }
  }, [ingest, showToast])

  // Drag & drop import: hold media over the editor and release anywhere.
  const [dropping, setDropping] = useState(false)
  useEffect(() => {
    let depth = 0
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        depth++
        setDropping(true)
      }
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDragLeave = (e: DragEvent) => {
      // Only balance the enters we actually counted: decrementing on an
      // internal (non-file) drag drove the counter out of step with reality.
      if (!e.dataTransfer?.types.includes('Files')) return
      if (--depth <= 0) {
        depth = 0
        setDropping(false)
      }
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDropping(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length === 0) return
      // A project file dropped on its own is opened (asking first about
      // unsaved work, as Open does), not imported as media: it used to come
      // back as "unsupported or unreadable file" (KLISTE-PLAN.md, item 2).
      if (files.length === 1 && api && /\.(snipp|autocut)$/i.test(files[0].name)) {
        // (The File itself goes over: the bridge takes its path, 22 Nov K4.)
        void api.registerDroppedProject(files[0]).then((p) => {
          if (p) void openPathRef.current(p)
          else showToast(t('app.dropProject.refused', { name: files[0].name }), true)
        })
        return
      }

      // Dropped over the timeline? Remember exactly where (the timeline's own
      // reading of the pointer: the time, snapped like a move unless Shift,
      // the row, a "+" strip), so the media lands there directly instead of
      // only in the media bin.
      const placement = timelineDropAt(e.clientX, e.clientY, e.shiftKey, 0)

      void importDroppedFiles(files)
        .then((result) => {
          if (!placement) {
            ingest(result)
            return
          }
          if (result.errors.length > 0) showToast(result.errors.join(' · '), true)
          if (result.assets.length === 0) return
          // Into the project and onto the timeline as ONE undo step, so Ctrl+Z
          // takes the files out again with their clips. A file the project
          // already has is placed again (its asset reused), never refused.
          const { added, clipIds } = useStore.getState().addClipsAt(
            result.assets.map((a) => a.id),
            placement.trackId,
            placement.time,
            { assets: result.assets, newTrack: placement.newTrack }
          )
          for (const a of added) {
            if (a.kind === 'video') {
              void computeFilmstrip(a, (id, patch) => useStore.getState().setAssetDerived(id, patch))
            }
          }
          const reused = result.assets.length - added.length
          if (clipIds.length > 0) {
            const at = useStore.getState().project.clips[clipIds[0]]?.start ?? placement.time
            showToast(
              t(clipIds.length === 1 ? 'app.placed.one' : 'app.placed.many', { n: clipIds.length, at: at.toFixed(1) }) +
                (reused > 0 ? ' ' + t('app.placed.reused', { n: reused }) : '')
            )
          }
        })
        .catch((err) => showToast(err instanceof Error ? err.message : String(err), true))
    }
    // The overlay used to rely solely on drop/dragleave to disappear, so it got
    // stranded whenever neither arrived: the drag cancelled with Esc, released
    // outside the window, or consumed by a child that stops propagation (the
    // timeline does exactly that for internal asset drags). These three guards
    // make hiding it unconditional.
    const clear = (): void => {
      depth = 0
      setDropping(false)
    }
    // Capture phase: fires before any child can stop propagation.
    const onDropCapture = (): void => clear()
    let lastOver = 0
    const watchdog = window.setInterval(() => {
      // A live drag fires dragover continuously; if it has gone quiet, the drag
      // is over however it ended.
      if (depth > 0 && performance.now() - lastOver > 500) clear()
    }, 400)
    const markOver = (): void => {
      lastOver = performance.now()
    }
    window.addEventListener('drop', onDropCapture, true)
    window.addEventListener('dragend', clear)
    window.addEventListener('dragover', markOver)
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.clearInterval(watchdog)
      window.removeEventListener('drop', onDropCapture, true)
      window.removeEventListener('dragend', clear)
      window.removeEventListener('dragover', markOver)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [ingest, showToast])

  // A quick save that found the file written by another program (a film tool)
  // since it was opened here: asked about, never written over unasked.
  const [diskConflict, setDiskConflict] = useState<string | null>(null)
  // A quick save over a file a newer Snipp saved: asked first (phase Ç2a.1).
  const [newerFile, setNewerFile] = useState<number | null>(null)
  const autosaveConflictToldRef = useRef(false)
  const handleSave = useCallback(
    async (quick = false, force = false, overNewer = false) => {
      try {
        // An edit made while the file is written is not saved by it.
        const seq = useStore.getState().editSeq
        const saved = await saveProject(useStore.getState().project, { quick, force, overNewer })
        if (saved) {
          if (useStore.getState().editSeq === seq) useStore.getState().setDirty(false)
          const p = getLastProjectPath()
          if (p) void upsertRecent(useStore.getState().project, p, capturePlayheadThumbnail())
          showToast(t('app.saved'))
        }
        return saved
      } catch (err) {
        if (err instanceof ChangedOnDiskError) {
          setDiskConflict(err.path)
          return false
        }
        if (err instanceof NewerFormatError) {
          setNewerFile(err.format)
          return false
        }
        showToast(err instanceof Error ? err.message : String(err), true)
        return false
      }
    },
    [showToast]
  )

  // The panels' help texts: one line each, the rest on hover or click.
  useEffect(() => installHints(), [])
  // A media file changed on disk while the project is open is read again
  // (main watches the paths; the asset, its peaks and its picture follow).
  useEffect(() => watchMediaFiles(), [])
  // The in-app chat's stream (AGENT-CHAT-PLAN.md): one listener for the page.
  useEffect(() => {
    listenChat()
  }, [])

  /**
   * Nothing survives the mouse coming up.
   *
   * A control ARMS an undo step on press and closes it on release, so a whole
   * slider drag is one Ctrl+Z. But a window that never gets closed — a drag
   * that ended off-window, a box that never blurred — stays open, and the NEXT
   * edit collapses into the same step. That is how moving a title and then
   * changing its size ended up as a single undo: one press had left the door
   * open and the next edit walked through it.
   */
  useEffect(() => {
    const close = (): void => useStore.getState().endGesture()
    window.addEventListener('pointerup', close)
    window.addEventListener('pointercancel', close)
    return () => {
      window.removeEventListener('pointerup', close)
      window.removeEventListener('pointercancel', close)
    }
  }, [])

  // Keep the main process informed about unsaved changes (quit confirmation).
  useEffect(() => {
    const bridge = api
    if (!bridge) return
    let last = false
    const unsub = useStore.subscribe((s) => {
      if (s.dirty !== last) {
        last = s.dirty
        bridge.setDirty(s.dirty)
      }
    })
    bridge.onSaveAndQuit(() => {
      void handleSave(true).then((saved) => {
        if (saved) bridge.confirmQuit()
      })
    })
    // Unsaved changes on close: the main process hands the question over so it
    // can be asked in the app's own dialog instead of a white system box.
    bridge.onConfirmQuit(() => setQuitPrompt(true))
    // A clean restart (Settings, or --reload): save, then start again.
    bridge.onSaveAndRestart(() => {
      void handleSave(true).then(async (saved) => {
        if (!saved) return showToast(t('settings.general.restart.failed'), true)
        const r = await bridge.restartApp().catch(() => ({ ok: false }))
        if (!r.ok) showToast(t('settings.general.restart.busy'), true)
      })
    })
    return unsub
  }, [handleSave, showToast])

  // Autosave. Every 5 minutes the project is written back to its own file, if
  // it has one. Independently, every 3 minutes a recovery snapshot goes to
  // app data — that one also covers projects that were never saved, which is
  // the case where a crash used to cost the user everything.
  useEffect(() => {
    const tick = (): Promise<void> => {
      // (Before the first autosave after an open or an explicit save, the
      // file as it is is copied into the profile: phase Ç2a.2, decision 4.)
      return autosaveOnce({
        enabled: () => localStorage.getItem('autocut-autosave') !== 'off',
        path: getLastProjectPath,
        save: (project) => saveProject(project, { quick: true, auto: true })
      }).then(
        (r) => {
          if (r === 'saved' || r === 'stale') showToast(t('app.autosaved'))
        },
        (err) => {
          // Autosave never writes over a file another program changed: it
          // says so once and leaves the choice to the next Ctrl+S.
          if (err instanceof ChangedOnDiskError && !autosaveConflictToldRef.current) {
            autosaveConflictToldRef.current = true
            showToast(t('app.autosave.stale'), true)
          }
          // (A file a newer Snipp saved is never written over unasked.)
          if (err instanceof NewerFormatError && !autosaveConflictToldRef.current) {
            autosaveConflictToldRef.current = true
            notify({ text: tr('project.newer.autosave'), kind: 'error' })
          }
          // Nor over one it could not copy first (decision 4): said once.
          if (err instanceof BackupFailedError && !autosaveConflictToldRef.current) {
            autosaveConflictToldRef.current = true
            notify({ text: err.message, kind: 'error' })
          }
        }
      )
    }
    const id = window.setInterval(() => void tick(), 5 * 60 * 1000)
    // The test hook: the autosave now, as the timer runs it (scripts/e2e).
    ;(window as unknown as Record<string, unknown>).__autosaveNow = tick
    return () => window.clearInterval(id)
  }, [showToast])

  // The crash snapshot (phase Ç2a.2, decision 5; media/recovery-writer.ts):
  // written 10 s after the last change while anything is unsaved, whatever
  // the project holds; this window's own one removed when nothing is unsaved
  // any more (a save, another project opened, a new one).
  useEffect(
    () =>
      startRecoveryWriter({
        store: useStore,
        write: (p) => writeRecovery(p),
        clear: () => clearOwnRecovery(),
        enabled: () => localStorage.getItem('autocut-autosave') !== 'off'
      }),
    []
  )

  /** What the reading mended (model/repair.ts): one notice, kept until closed.
   *  The repaired project is unsaved work: the next save keeps the repair. */
  const sayRepaired = useCallback((list: RepairNote[]) => {
    if (list.length === 0) return
    useStore.getState().setDirty(true)
    notify({ text: tr('project.repaired', { list: repairSummary(list) }), kind: 'info', timeout: 0 })
  }, [])

  // On launch, offer to restore a snapshot left behind by a crash. A clean
  // exit clears the file, so anything still here means we went down hard.
  const [recovery, setRecovery] = useState<Awaited<ReturnType<typeof readRecovery>>>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const rec = await readRecovery()
      // (The Projects window at launch waits for this: REF-AB item 1.)
      noteLaunch('recovery', !!rec)
      if (!cancelled && rec) setRecovery(rec)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const acceptRecovery = useCallback(() => {
    const rec = recovery
    setRecovery(null)
    if (!rec) return
    // Saved nowhere (Save asks for a name), but still the project of the
    // file it was of: its agent restore points stay its own (phase 4A.11, P1).
    setRecoveredProjectPath(rec.path)
    useStore.getState().loadProject(rec.project)
    // Unsaved from the start: loading cleared "unsaved" (and this window's
    // own snapshot with it, media/recovery-writer.ts) BEFORE the offered one
    // becomes the own one below, so it is never the one removed.
    useStore.getState().setDirty(true)
    // The snapshot is this window's own from now on (its next snapshots
    // replace it, a clean close removes it).
    void adoptRecovery()
    // (Media files changed on disk since: read again, phase Ç2a.2.)
    void refreshChangedAndTell(rec.changed, rec.unconfirmed)
    // Same as opening a file: the derived extras (thumbnail, filmstrip) are
    // not in the snapshot, so they are rebuilt here rather than leaving a
    // recovered project looking like a wall of blank clips.
    for (const asset of rec.project.assets) {
      if (!asset.missing) void enrichAsset(asset, (id, patch) => useStore.getState().setAssetDerived(id, patch))
    }
    useStore.getState().setDirty(true)
    sayRepaired(rec.repaired)
    if (rec.missing.length > 0) setMissingPrompt(true)
    else showToast(t('app.recovered'))
  }, [recovery, showToast, sayRepaired])

  const discardRecovery = useCallback(() => {
    setRecovery(null)
    void clearRecovery()
  }, [])

  /** Later, Esc, or a click beside the question: the snapshot stays on disk
   *  and is offered again next time (never written over or removed). */
  const laterRecovery = useCallback(() => {
    setRecovery(null)
    void releaseRecovery()
  }, [])

  /** "Loaded". */
  const sayLoaded = useCallback(
    () => {
      showToast(t('app.loaded'))
    },
    [showToast]
  )
  /** A file that held what this app does not have opened as a copy: unsaved
   *  work (Save asks for a new name), and one line says why. */
  const sayCopy = useCallback(
    (removed: LegacyPart[]) => {
      useStore.getState().setDirty(true)
      showToast(copyNotice(removed))
    },
    [showToast]
  )

  /**
   * Opening replaces the whole project and clears the undo history with it, so
   * whatever was unsaved is gone for good. "New project" has always asked
   * before doing that; both open paths just did it.
   */
  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!useStore.getState().dirty) return true
    return confirmDialog({ title: t('ask.openOther.title'), message: t('ask.openOther.why'), confirm: t('ask.openOther.ok'), danger: true, icon: 'folder-open' })
  }, [])

  const handleOpen = useCallback(async () => {
    if (!(await confirmDiscard())) return
    try {
      const result = await openProject()
      if (!result) return
      useStore.getState().loadProject(result.project)
      void refreshChangedAndTell(result.changed, result.unconfirmed)
      sayRepaired(result.repaired)
      for (const asset of result.project.assets) {
        if (!asset.missing) void enrichAsset(asset, (id, patch) => useStore.getState().setAssetDerived(id, patch))
      }
      const p = getLastProjectPath()
      if (p) void upsertRecent(result.project, p)
      if (result.missing.length > 0) setMissingPrompt(true)
      if (result.removed.length) sayCopy(result.removed)
      else if (result.missing.length === 0) sayLoaded()
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), true)
    }
  }, [showToast, confirmDiscard, sayLoaded, sayCopy, sayRepaired])

  const [showProjects, setShowProjects] = useState(false)
  // REF-AB item 1: the Projects window first, when the launch brought
  // nothing else (no crash to recover, no project or film handed over) and
  // Settings → General leaves it on.
  useEffect(() => whenLaunchSettled((open) => open && setShowProjects(true)), [])
  useEffect(() => setHomeShowing(showProjects), [showProjects])
  // File → Earlier versions… (phase Ç2a.2, decision 4).
  const [showBackups, setShowBackups] = useState(false)
  const openVersion = useCallback(
    async (entry: BackupEntry) => {
      const uid = useStore.getState().project.uid
      if (!uid || !(await confirmDiscard())) return
      setShowBackups(false)
      try {
        const result = await openBackup(uid, entry.name)
        if (!result) {
          notify({ text: tr('backups.unreadable'), kind: 'error' })
          return
        }
        useStore.getState().loadProject(result.project)
        void refreshChangedAndTell(result.changed, result.unconfirmed)
        for (const asset of result.project.assets) {
          if (!asset.missing) void enrichAsset(asset, (id, patch) => useStore.getState().setAssetDerived(id, patch))
        }
        // A copy: unsaved work, tied to no file (Save asks for a name).
        useStore.getState().setDirty(true)
        sayRepaired(result.repaired)
        if (result.missing.length > 0) setMissingPrompt(true)
        notify({ text: tr('backups.opened', { when: backupTime(entry.at) }), kind: 'info' })
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), true)
      }
    },
    [showToast, confirmDiscard, sayRepaired]
  )

  const handleOpenRecent = useCallback(
    // ask false: the open project is the one just made from this file (the
    // sample project, phase 9b), nothing of the person's to lose.
    async (path: string, ask = true) => {
      if (ask && !(await confirmDiscard())) return
      setShowProjects(false)
      try {
        const result = await openProjectByPath(path)
        if (!result) return
        useStore.getState().loadProject(result.project)
        void refreshChangedAndTell(result.changed, result.unconfirmed)
        sayRepaired(result.repaired)
        for (const asset of result.project.assets) {
          if (!asset.missing) void enrichAsset(asset, (id, patch) => useStore.getState().setAssetDerived(id, patch))
        }
        const p = getLastProjectPath()
        if (p) void upsertRecent(result.project, p)
        if (result.missing.length > 0) setMissingPrompt(true)
        if (result.removed.length) sayCopy(result.removed)
        else if (result.missing.length === 0) sayLoaded()
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), true)
      }
    },
    [showToast, confirmDiscard, sayLoaded, sayCopy, sayRepaired]
  )

  /**
   * A project file handed over by the OS — a double-clicked .snipp, or "Open
   * with". The installer has always registered the association; nothing was
   * listening, so double-clicking a project opened an empty editor.
   *
   * Registered exactly once, through a ref, because the preload's listener has
   * no way to be removed: re-running this effect would stack up handlers and
   * open the same file several times over.
   */
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  const openPathRef = useRef(handleOpenRecent)
  openPathRef.current = handleOpenRecent
  useEffect(() => {
    api?.onOpenProject?.((p) => void openPathRef.current(p))
    // ...and the one it was launched with, which happened before this listener
    // (or React itself) existed.
    // (Each one tells the launch's Projects window whether it brought
    // something: REF-AB item 1, components/app/launch-home.ts.)
    const pendingProject = api?.takePendingProject?.()
    if (!pendingProject) noteLaunch('project', false)
    void pendingProject?.then((p) => {
      noteLaunch('project', !!p)
      if (p) void openPathRef.current(p)
    }, () => noteLaunch('project', false))
    // A film handed over by VideoHub ("Snipp'te aç") with no project yet: it
    // goes on the timeline with its sound and is saved beside the film, so the
    // next press opens this same project.
    const pendingFilm = api?.codeFilm?.takePending?.()
    if (!pendingFilm) noteLaunch('film', false)
    pendingFilm?.catch(() => noteLaunch('film', false))
    void pendingFilm?.then(async (pending) => {
      noteLaunch('film', !!pending)
      if (!pending) return
      setShowProjects(false)
      try {
        const r = await codeFilmImport(pending.info)
        const s = useStore.getState()
        s.setProjectName(pending.info.name)
        const film = s.addAssets(r.assets).find((a) => a.kind === 'code')
        if (film) {
          codeFilms.ensure(film)
          useStore.getState().addToTimeline(film.id)
        }
        if (r.errors.length) showToast(r.errors.join(' · '), true)
        // (The new project gets its file: what is kept by its path goes along.)
        moveProjectPath(pending.project)
        await saveRef.current(true)
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), true)
      }
    })
  }, [])

  const handleNew = useCallback(async (aspect: AspectId) => {
    // Asked when there is unsaved work, as Open asks. It used to ask only when
    // the timeline had clips: files imported but not placed went without a
    // word (and a saved project with
    // clips was asked about changes it did not have).
    if (useStore.getState().dirty) {
      if (!(await confirmDialog({ title: t('ask.newProject.title'), message: t('ask.newProject.why'), confirm: t('ask.newProject.ok'), danger: true, icon: 'plus' }))) return
    }
    setLastProjectPath(null)
    // (The last project's decoders and proxies go: phase Ç2a.2, P12.)
    releaseAllMedia()
    useStore.getState().newProject(aspect)
  }, [])

  const handleExport = useCallback(() => {
    if (exportBusy()) return
    if (useStore.getState().transcribeStatus) {
      showToast(t('app.busy.transcribing'), true)
      return
    }
    useStore.getState().setPlaying(false)
    openExportWindow('video')
  }, [])

  // What the empty states' buttons ask for (phase 9b; components/app/requests.ts).
  useEffect(() => onShellRequest((what) => {
    if (what === 'import') void handleImport()
    else if (what === 'export') handleExport()
    // (A saved chat picked in the left panel: its tab needs the panel open.)
    else if (what === 'inspector:open') patchLayout({ inspectorOpen: true })
    else if (what === 'restart') {
      void handleSave(true).then(async (saved) => {
        if (!saved) return showToast(t('settings.general.restart.failed'), true)
        const r = (await api?.restartApp().catch(() => ({ ok: false }))) ?? { ok: false }
        if (!r.ok) showToast(t('settings.general.restart.busy'), true)
      })
    }
  }), [handleImport, handleExport, handleSave, patchLayout, showToast])

  // The sample project (phase 9b): made as a new copy, then opened from its
  // file like any project (File → Help, the Projects window).
  const handleSample = useCallback(async () => {
    if (!(await confirmDiscard())) return
    const toast = notify({ text: t('sample.making'), timeout: 0 })
    try {
      const file = await makeSampleProject()
      if (file) await openPathRef.current(file, false)
    } catch (err) {
      showToast(t('sample.failed', { why: err instanceof Error ? err.message : String(err) }), true)
    } finally {
      dismissToast(toast)
    }
  }, [confirmDiscard, showToast])
  useEffect(() => onShellRequest((what) => { if (what === 'sample') void handleSample() }), [handleSample])

  // `chosen`: the file already chosen (the export window's several outputs
  // in one run, DENEME-4 worker W: the save dialog asked once, for the
  // first). True when the file is in place.
  const performExport = useCallback(async (settings: ExportSettings, chosen?: string): Promise<boolean> => {
    const s = useStore.getState()
    if (exportBusy()) return false
    const fmt = formatOf(settings.container)
    // (A name Windows takes: a title's question mark or colon is refused.)
    const name = `${safeFileName(s.project.name)}.${fmt.ext}`
    // Ask WHERE to save before doing any work — cancelling here costs nothing,
    // instead of rendering for minutes and only then popping a save dialog.
    let savePath: string | null = chosen ?? null
    if (api && !savePath) {
      savePath = await api.chooseSavePath({ defaultName: name, filterName: fmt.filter, extensions: [fmt.ext] })
      if (!savePath) return false // cancelled — nothing rendered
    }
    const project = s.project
    // In the Renders panel by the file's name (cikti\.renders\<name>.json).
    const render = { name: (savePath ?? name).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''), output: savePath ?? undefined, fps: settings.fps ?? project.settings.fps }
    return runExportJob(fmt.audioOnly ? 'sound' : 'video', { detail: describeExport(project, settings), target: savePath ?? name, render }, async (signal, progress, plan) => {
      // The sound alone needs no pictures or fonts.
      if (!fmt.audioOnly) {
        progress(0, 'Loading the pictures and fonts')
        await preloadImagesForExport(project)
      }
      let lanes = 1
      const onPlan = (p: { workers: number; why?: string; stretches: [number, number][] }): void => {
        // Asked for several at once and drawn in one window for a reason the
        // person can change (an imported font or LUT): said, not silent.
        if (settings.workers === 'auto' && p.workers === 1 && lanes <= 1 && /imported/.test(p.why ?? '')) showToast(t('app.oneWindow', { why: p.why!.replace(/^one window \((.*)\)$/, '$1') }))
        lanes = p.workers
        plan({ workers: p.workers, frames: p.stretches.reduce((n, [a, b]) => n + (b - a), 0) })
      }
      // A video streams into its file as it is made (a long film is more than
      // one buffer can hold: export/file-target.ts); the sound alone is made
      // whole and written by the exporter the same way, beside its target
      // and then put in place (phase Ç3 patch, R-2).
      const streamed = !!(api?.streamFile && savePath)
      // A streamed file's size: read from the file kept (its array is empty).
      let written = 0
      const exportWith = (s: ExportSettings): Promise<Uint8Array> =>
        exportProjectMp4(project, { settings: s, signal, onProgress: progress, onPlan, ...(streamed ? { toPath: savePath!, onWritten: (n: number) => { written = n } } : {}) })
      let data: Uint8Array
      try {
        data = await exportWith(settings)
      } catch (err) {
        // Drawn several at once and a lane failed (a render process that
        // crashed or ran out of graphics memory beside this window's
        // preview): once more in this window alone, as every export was drawn
        // before the dialog asked for lanes. The same frames; a cancel stays
        // a cancel, and a failure in one window is not tried twice. Only the
        // lanes' own failures (a lane, a stretch, the join) are: anything else
        // (the film's own things, a file that cannot be written) would fail
        // the same way again after drawing the whole film a second time.
        const laneFault = /render lane|render process|stretch \d|lanes'/i.test(err instanceof Error ? err.message : String(err))
        if (lanes <= 1 || !laneFault || wasCancelled(signal, err)) throw err
        console.warn('the export drawn several at once failed; drawing it in this window alone:', err)
        progress(0, 'Drawing it again in this window alone')
        data = await exportWith({ ...settings, workers: undefined })
      }
      progress(0.995, 'Saving the file')
      if (api && savePath) {
        if (!streamed) checkRenderCancelled(signal)
        const result = streamed ? { saved: true, path: savePath } : await api.writeChosenFile(savePath, data)
        if (!result.saved) throw new Error(('error' in result && result.error) || 'could not write file')
        // The YouTube package beside it (round 9): its chapters from the
        // stretch exported.
        if (settings.youtube && !fmt.audioOnly && api.writeBeside) {
          try {
            const text = youtubePackage(project, { range: settings.range, name: project.name })
            const y = await api.writeBeside(savePath, 'youtube', text)
            if (!y.saved) console.warn('the YouTube package was not written:', y.error)
          } catch (err) {
            // A Snipp whose main process is older than this window (a dev
            // reload) has no handler: the video is saved all the same.
            console.warn('the YouTube package was not written:', err)
          }
        }
        return { path: result.path ?? savePath, bytes: data.byteLength || written }
      }
      downloadBlob(new Blob([data as BlobPart], { type: fmt.mime }), name)
      return { bytes: data.byteLength }
    })
  }, [showToast])

  // Exports each marked segment as its own 9:16 Short, sequentially, using the
  // settings the user picked in the export dialog.
  const runExportShorts = useCallback(
    async (segments: ShortSegment[], chosen: ExportSettings) => {
      const s = useStore.getState()
      if (exportBusy() || segments.length === 0) return
      s.setPlaying(false)
      const fmt = formatOf(chosen.container)
      const fileName = (seg: ShortSegment): string => `${safeFileName(useStore.getState().project.name)} - ${safeFileName(seg.name, 'Short')}.${fmt.ext}`
      // Each its own file in the folder (two named alike went to one file).
      const names = uniqueFileNames(segments.map(fileName))
      // Several segments in one run: ask for a destination folder ONCE and
      // drop every file in there, instead of a save dialog per segment. One
      // segment: its own save dialog, asked before rendering as the main
      // export does (it used to come up only after the render).
      let folder: string | null = null
      let savePath: string | null = null
      if (api && segments.length > 1) {
        folder = await api.chooseFolder()
        if (!folder) return // user cancelled the whole batch
      } else if (api) {
        savePath = await api.chooseSavePath({ defaultName: fileName(segments[0]), filterName: fmt.filter, extensions: [fmt.ext] })
        if (!savePath) return
      }
      // Past the point of no return: the queue has been handed over, so it
      // stops being pending work.
      useStore.getState().clearExportQueue()
      const target = folder ? `${segments.length} Shorts → ${folder}` : savePath ?? `${segments.length} segment${segments.length === 1 ? '' : 's'}`
      // In the Renders panel as one job (every Short's frames together).
      const fps = chosen.fps ?? s.project.settings.fps
      const render = {
        name: `${safeFileName(s.project.name)} Shorts`,
        output: folder ? undefined : savePath ?? undefined,
        fps,
        frames: fmt.audioOnly ? 0 : segments.reduce((n, seg) => n + Math.max(1, Math.round((seg.end - seg.start) * fps)), 0)
      }
      // The project as it is now, for every Short of the batch (phase Ç3b,
      // decision 5; report R23): each Short used to read the live project,
      // so an edit during the batch changed the Shorts after it.
      const project = useStore.getState().project
      await runExportJob('shorts', { detail: describeExport(project, { ...chosen, target: 'shorts' }), target, render }, async (signal, progress) => {
        progress(0, 'Loading the pictures and fonts')
        await preloadImagesForExport(project)
        let bytes = 0
        let lastPath: string | undefined
        let done = 0
        for (const seg of segments) {
          // Everything the user chose, with the 9:16 target and this segment's
          // range forced on top.
          const settings: ExportSettings = { ...chosen, target: 'shorts', range: [seg.start, seg.end] }
          const index = done + 1
          const name = names[done]
          // Each Short streams into its own file as it is made (R23: each was
          // held whole in memory, then written in one go, with no .part); a
          // Short's sound alone is written the same way (phase Ç3 patch, R-2).
          let data: Uint8Array
          let written = 0
          try {
            const toPath = !api?.streamFile ? null : folder ? await api.batchChoosePath(name) : savePath
            data = await exportProjectMp4(project, {
              settings,
              signal,
              ...(toPath ? { toPath, onWritten: (n: number) => { written = n } } : {}),
              // Spread each segment's progress across the whole batch.
              onProgress: (fraction, label) => progress((done + fraction) / segments.length, `Short ${index} of ${segments.length} (${seg.name}): ${label}`)
            })
            if (toPath) {
              lastPath = toPath
            } else if (folder && api) {
              checkRenderCancelled(signal)
              const result = await api.batchWrite(name, data)
              if (!result.saved) throw plainFileError(result.error ?? 'could not write file')
              lastPath = result.path ?? lastPath
            } else if (api && savePath) {
              checkRenderCancelled(signal)
              const result = await api.writeChosenFile(savePath, data)
              if (!result.saved) throw plainFileError(result.error ?? 'could not write file')
              lastPath = result.path ?? savePath
            } else {
              downloadBlob(new Blob([data as BlobPart], { type: fmt.mime }), name)
            }
          } catch (err) {
            // Stopped part-way (phase Ç3 patch, R-4): which Short, how many
            // were saved before it and where they are.
            const where = folder ?? (savePath ? savePath.replace(/[\\/][^\\/]*$/, '') : '')
            const saved = done > 0 ? tr('export.batch.saved', { k: done, n: segments.length, where }) : tr('export.batch.none')
            const at = { i: index, n: segments.length, name: seg.name }
            if (wasCancelled(signal, err)) throw Object.assign(new DOMException('Export cancelled', 'AbortError'), { said: `${tr('export.batch.cancelled', at)} ${saved}` })
            throw new Error(`${tr('export.batch.failed', { ...at, why: err instanceof Error ? err.message : String(err) })} ${saved}`)
          }
          bytes += data.byteLength || written
          done++
        }
        return { bytes, folder: folder ?? undefined, path: folder ? undefined : lastPath }
      })
    },
    []
  )

  // Clicking export on a segment (or "export all") opens the same settings
  // dialog the main export uses — resolution, fps, quality/bitrate and format
  // were previously hardcoded here, so the output was a black box.
  const [quitPrompt, setQuitPrompt] = useState(false)
  const handleExportShorts = useCallback((segments: ShortSegment[]) => {
    if (exportBusy() || segments.length === 0) return
    useStore.getState().setPlaying(false)
    openExportWindow('video', segments)
  }, [])
  // The test hook: a Shorts batch, as the Shorts panel starts it (scripts/e2e 57).
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__exportShorts = handleExportShorts
  }, [handleExportShorts])

  const writeSrt = useCallback(
    async (perWord: boolean) => {
      const s = useStore.getState()
      const srt = captionsToSrt(s.project.captions, { perWord })
      if (!srt.trim()) {
        showToast(t('app.srt.none'), true)
        return
      }
      const name = `${safeFileName(s.project.name, 'subtitles')}${perWord ? '-words' : ''}.srt`
      // Where first (cancelling it shows nothing), then the export window
      // says it is saved and where — it used to be a toast that went by.
      let savePath: string | null = null
      if (api) {
        savePath = await api.chooseSavePath({ defaultName: name, filterName: 'SubRip subtitles', extensions: ['srt'] })
        if (!savePath) return
      }
      const cues = srt.split(/\r?\n\r?\n/).filter((b) => b.trim()).length
      await runExportJob('srt', { detail: `${cues} cue${cues === 1 ? '' : 's'} · ${perWord ? 'one per word' : 'one per line'}`, target: savePath ?? name }, async (_signal, progress) => {
        progress(0.4, 'Writing the subtitles')
        const data = new TextEncoder().encode(srt)
        progress(0.8, 'Saving the SRT file')
        if (api && savePath) {
          const result = await api.writeChosenFile(savePath, data)
          if (!result.saved) throw plainFileError(result.error ?? 'could not write file', 'file')
          return { path: result.path ?? savePath, bytes: data.byteLength }
        }
        downloadBlob(new Blob([srt], { type: 'text/plain' }), name)
        return { bytes: data.byteLength }
      })
    },
    [showToast]
  )

  /** Asked before writing: one cue per sentence, or one per word. */
  const [srtPrompt, setSrtPrompt] = useState(false)

  const handleExportSrt = useCallback(() => {
    const s = useStore.getState()
    // Only the subtitle lane is exportable; a project holding nothing but text
    // layers has no subtitles to write.
    if (!s.project.captions.some((c) => (c.layer ?? 0) === 0 && !c.shape)) {
      showToast(t('app.srt.graphics'), true)
      return
    }
    // Word timings only exist when Whisper produced them; without any there is
    // nothing to choose between, so the question isn't asked.
    const hasWords = s.project.captions.some((c) => (c.layer ?? 0) === 0 && (c.words?.length ?? 0) > 0)
    if (!hasWords) {
      void writeSrt(false)
      return
    }
    setSrtPrompt(true)
  }, [showToast, writeSrt])

  /**
   * The films' input set: <name>.srt, <name>-words.srt and <name>.mp3 in one
   * folder the user picks. The sound is the whole timeline's mix from 0 s,
   * effects and all, so the subtitles line up with it as they do on the
   * timeline; the two SRTs are the single SRT export's own files. The MP3 is
   * made first and everything written at the end, so a Cancel leaves no half
   * set behind. Files of the same names in that folder are replaced, as the
   * Shorts batch replaces its own.
   */
  const writeVoiceSet = useCallback(async () => {
    if (exportBusy()) return
    useStore.getState().setPlaying(false)
    // Where first (cancelling it costs nothing), as every export asks.
    let folder: string | null = null
    if (api) {
      folder = await api.chooseFolder()
      if (!folder) return
    }
    // One project for all three, so the sound is the one these cues were read from.
    const project = useStore.getState().project
    const set = voiceSet(project.name, project.captions)
    if (!set) {
      showToast(t('app.srt.none'), true)
      return
    }
    const { names } = set
    const detail = `${set.cues.sentences} sentence cue${set.cues.sentences === 1 ? '' : 's'} · ${set.cues.words} word cue${set.cues.words === 1 ? '' : 's'} · the whole timeline's sound (MP3)`
    await runExportJob('voiceset', { detail, target: folder ? `3 files → ${folder}` : names.sound }, async (signal, progress) => {
      // The whole timeline from 0 s, as it is heard: no range, no loudness
      // change. Into the folder beside its target, then put in place (phase
      // Ç3 patch, R-2), when this window can stream a file.
      const soundPath = folder && api?.streamFile ? await api.batchChoosePath(names.sound) : null
      const sound = await exportProjectMp4(project, { settings: { container: 'mp3' }, signal, onProgress: (f, label) => progress(f * 0.98, label), ...(soundPath ? { toPath: soundPath } : {}) })
      // A Cancel pressed while the sound was mixed: nothing written.
      if (signal.aborted && !soundPath) throw new DOMException('Export cancelled', 'AbortError')
      progress(0.99, 'Saving the three files')
      // The sound first: the SRTs never stand there without the sound they were timed on.
      const files: [string, Uint8Array, string][] = [
        ...(soundPath ? [] : [[names.sound, sound, 'audio/mpeg'] as [string, Uint8Array, string]]),
        [names.sentences, new TextEncoder().encode(set.sentences), 'text/plain'],
        [names.words, new TextEncoder().encode(set.words), 'text/plain']
      ]
      let bytes = soundPath ? sound.byteLength : 0
      let shown: string | undefined = soundPath ?? undefined
      for (const [name, data, mime] of files) {
        if (folder && api) {
          const result = await api.batchWrite(name, data)
          if (!result.saved) throw new Error(`${name}: ${result.error ?? 'could not write file'}`)
          shown ??= result.path
        } else {
          downloadBlob(new Blob([data as BlobPart], { type: mime }), name)
        }
        bytes += data.byteLength
      }
      // Open folder shows the files themselves (a folder alone opens its parent).
      return { bytes, path: shown }
    })
  }, [showToast])

  /** Asked before the set when a subtitle has no word timings. */
  const [voiceSetPrompt, setVoiceSetPrompt] = useState(false)

  const handleExportVoiceSet = useCallback(() => {
    if (exportBusy()) return
    const s = useStore.getState()
    // The same rule as the single SRT export: the subtitle lane only.
    if (!s.project.captions.some((c) => (c.layer ?? 0) === 0 && !c.shape)) {
      showToast(t('app.srt.graphics'), true)
      return
    }
    const set = voiceSet(s.project.name, s.project.captions)
    if (!set) {
      showToast(t('app.srt.none'), true)
      return
    }
    // A subtitle without word timings goes into the word SRT as its whole
    // sentence: said before anything is asked or made.
    if (!set.wordTimed) {
      setVoiceSetPrompt(true)
      return
    }
    void writeVoiceSet()
  }, [showToast, writeVoiceSet])

  const onTranscribeProgress = useCallback((p: TranscribeProgress) => {
    const st = useStore.getState()
    st.setTranscribeProgress(p)
    st.setTranscribeStatus(p.label)
  }, [])

  const handleTranscribe = useCallback(async (source?: unknown) => {
    // The run itself is shared with the agent's transcribe job
    // (subtitles/run.ts, phase 4A); only what the user is told is here.
    // The Captions page names what is heard (REF-AB, worker S); a button
    // wired straight to this hands over its click, which is all the sound.
    const r = await transcribeIntoProject({ onProgress: onTranscribeProgress, exportBusy, source: isCaptionSource(source) ? source : undefined })
    if (r.ok) {
      showToast(r.estimated ? t('app.subs.addedEstimated', { n: r.count }) : t('app.subs.added', { n: r.count }))
    } else if (r.reason === 'busy') showToast(r.message, true)
    else if (r.reason === 'failed') showToast(t('app.transcribe.failed', { error: r.message }), true)
    else if (r.reason !== 'running') showToast(r.message)
  }, [showToast, onTranscribeProgress])

  // Re-transcribes only the range between the two C cut marks and swaps the
  // captions inside it — for stretches the first pass missed.
  const handleTranscribeRange = useCallback(async () => {
    const s = useStore.getState()
    if (s.cutMarks.length < 2) return
    if (exportBusy()) {
      showToast(t('app.busy.exporting'), true)
      return
    }
    // One speech model run at a time, the agent's included (claimed before
    // anything is awaited).
    const release = claimWhisper()
    if (!release) return
    // Widened to whole lines: a subtitle crossing a mark was deleted and only
    // its part inside the range came back.
    const subs = s.project.captions.filter(isSubtitle)
    const a0 = Math.min(...s.cutMarks)
    const b0 = Math.max(...s.cutMarks)
    const a = Math.min(a0, ...subs.filter((c) => c.start < a0 && c.end > a0 + 0.01).map((c) => c.start))
    const b = Math.max(b0, ...subs.filter((c) => c.start < b0 - 0.01 && c.end > b0).map((c) => c.end))
    const session = projectSession()
    const from = s.project
    s.setPlaying(false)
    await engine.suspendAudio()
    api?.keepAwake(true, 'transcription')
    try {
      s.setTranscribeStatus('Starting…')
      const captions = await transcribeProjectRange(
        s.project,
        a,
        b,
        onTranscribeProgress,
        s.project.captionStyle.maxLineChars
      )
      if (projectSession() !== session) {
        showToast(t('app.transcribe.gone'))
        return
      }
      // Edited meanwhile: the range is where it was when it started. Only
      // re-placed when the timeline really changed under it.
      if (useStore.getState().project !== from) {
        showToast(t('app.transcribe.changed'), true)
        return
      }
      useStore.getState().replaceCaptionsInRange(a, b, captions)
      useStore.getState().clearCutMarks()
      const estimated = captions.some((caption) => caption.words?.some((word) => word.estimated))
      showToast(estimated ? t('app.retranscribed.estimated', { s: (b - a).toFixed(1), n: captions.length }) : t('app.retranscribed', { s: (b - a).toFixed(1), n: captions.length }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('cancelled')) showToast(t('app.transcribe.cancelled'))
      else showToast(t('app.transcribe.failed', { error: msg }), true)
    } finally {
      release()
      api?.keepAwake(false, 'transcription')
      engine.resumeAudio()
      useStore.getState().setTranscribeStatus(null)
      useStore.getState().setTranscribeProgress(null)
    }
  }, [showToast])

  // Tracks the last press of the cutter key to detect a double-tap, and the
  // marks that press may have cleared so a double-tap can restore them.
  const cutterTapRef = useRef(0)
  const cutterPrevRef = useRef<{ marks: number[]; trackId: string | 'captions' | null } | null>(null)

  // J/K/L shuttle: J rewinds, L fast-forwards, each extra tap in the same
  // direction doubles the speed (1×/2×/4×); K (or the opposite key) stops.
  // It also stops by itself (shuttleStep): at either end, when Play starts or
  // an export runs, and when anything else moves the playhead (a scrub, a
  // click on the ruler) — two clocks must never drive the playhead at once.
  const shuttleRef = useRef<{ raf: number; dir: number; speed: number; last: number; wrote: number | null } | null>(null)
  const shuttle = useCallback((dir: -1 | 0 | 1) => {
    const st = useStore.getState()
    const cur = shuttleRef.current
    if (dir === 0) {
      if (cur) cancelAnimationFrame(cur.raf)
      shuttleRef.current = null
      return
    }
    st.setPlaying(false)
    if (cur && cur.dir === dir) {
      cur.speed = Math.min(8, cur.speed * 2) // same direction again → faster
      return
    }
    if (cur) cancelAnimationFrame(cur.raf)
    const state = { raf: 0, dir, speed: 1, last: performance.now(), wrote: null as number | null }
    const loop = (now: number) => {
      const dt = (now - state.last) / 1000
      state.last = now
      const s = useStore.getState()
      const step = shuttleStep({
        currentTime: s.currentTime,
        wrote: state.wrote,
        duration: projectDuration(s.project),
        dir: state.dir,
        speed: state.speed,
        dt,
        playing: s.playing,
        exporting: exportBusy()
      })
      if (step.time !== null) {
        s.setTime(step.time)
        state.wrote = useStore.getState().currentTime
      }
      if (!step.go) {
        if (shuttleRef.current === state) shuttleRef.current = null
        return
      }
      state.raf = requestAnimationFrame(loop)
    }
    state.raf = requestAnimationFrame(loop)
    shuttleRef.current = state
  }, [])

  // Whether the focus came by the keyboard or a click (Space reads it, below).
  useEffect(() => installFocusOrigin(window), [])

  // Keyboard shortcuts (user-rebindable).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A panel that handled the key itself (the transcript's Delete, a word
      // handle's arrows) wins: one press is one edit, never two.
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement
      if (!shortcutsAllowed(target, e)) return
      // A modal dialog is open: nothing acts on the timeline hidden behind it.
      // Escape still passes (the dialogs close on it).
      if (e.key !== 'Escape' && modalOpen(document)) return
      const s = useStore.getState()
      const binding = eventToBinding(e)
      if (!binding) return
      const b = bindings
      // Escape always exits the cut tools + mask drawing.
      if (e.key === 'Escape') {
        // The shortcut list over the preview closes first, and only it.
        if (usePreviewUi.getState().keyList) return usePreviewUi.getState().setKeyList(false)
        s.setCutterMode(false)
        s.setSplitToolMode(false)
        s.setSlipToolMode(false)
        if (s.maskDrawMode) s.setMaskDrawMode(false)
        selectTransition(null)
        // A work note: the drawing tool is put down first; then a note with
        // nothing written or drawn yet is let go.
        if (s.noteTool) s.setNoteTool(null)
        else if (s.noteDraft && !s.noteDraft.text.trim() && s.noteDraft.shapes.length === 0) s.cancelNoteDraft()
        // And a review of what the agent changed ends.
        else if (s.noteReview) endReview()
        return
      }
      const run = (fn: () => void, prevent = true) => {
        if (prevent) e.preventDefault()
        fn()
      }
      // A review's own keys, read before the global ones while it is open
      // (ONIZLEME-UYGULA-PLAN.md, K1): B before / after, Y approve.
      if (s.noteReview && !e.repeat) {
        if (binding === b.reviewBefore) return run(() => toggleReviewBefore())
        if (binding === b.reviewApprove) return run(() => decideReview('approved'))
      }
      switch (binding) {
        case b.settings:
          return run(() => openSettings())
        case b.playPause:
          // A button, tab, switch or check box the keyboard reached: Space is
          // that control's own key (audit E2), and the focus stays.
          if (binding === 'space' && spaceWorksControl(target, focusCameByKeyboard())) return
          // One a click left focused lets go of the focus (its own Space would
          // press it again) and Space plays.
          if (target && target !== document.body && typeof target.blur === 'function') target.blur()
          return run(() => {
            shuttle(0) // space overrides any J/L shuttle in progress
            s.setPlaying(!s.playing)
          })
        case 'shift+delete':
          return run(() => {
            if (s.selectedClipIds.length > 0) s.deleteClips(s.selectedClipIds, false)
          }, false)
        case b.delete:
        case 'delete':
          return run(() => {
            // No confirmation or toast here on purpose: deleting is constant
            // during a fast edit, and Ctrl+Z already covers a mistake.
            if (s.cutMarks.length >= 2) s.deleteBetweenCuts()
            else if (s.selectedCaptionIds.length > 0) s.deleteCaptions(s.selectedCaptionIds)
            else if (s.selectedClipIds.length === 0 && selectedTransition()) {
              // The selected transition (core polish T): one undo step.
              putTransition(selectedTransition()!.clipId, null)
              selectTransition(null)
            }
            else if (s.selectedClipIds.length > 0) {
              s.deleteClips(s.selectedClipIds, false)
            }
            else if (s.templateSel) {
              const id = s.templateSel
              s.editTemplates((p) => deleteTemplate(p, id))
              s.selectTemplate(null)
            } else if (s.noteSel) {
              // The picked work note, when nothing else is selected.
              removeNote(s.noteSel)
            }
          }, false)
        case b.split:
          return run(() => s.splitAtPlayhead(), false)
        case b.splitHere:
          return run(() => s.splitTargetAtPlayhead())
        case b.trimLeft:
          return run(() => s.rippleTrimToPlayhead('left'))
        case b.trimRight:
          return run(() => s.rippleTrimToPlayhead('right'))
        case b.closeGap:
          return run(() => s.closeGapAtPlayhead())
        // Q / W work on the clip's own track (and its linked sound), Alt+Q /
        // Alt+W on every unlocked track (DENEME-1-PLAN-C.md, item 2); close
        // gap: with Alt its own track only (phase Ç2b.1, decision 1).
        case `alt+${b.trimLeft}`:
          return run(() => s.rippleTrimToPlayhead('left', true))
        case `alt+${b.trimRight}`:
          return run(() => s.rippleTrimToPlayhead('right', true))
        case `alt+${b.closeGap}`:
          return run(() => s.closeGapAtPlayhead(true))
        case b.shuttleBack:
          if (e.repeat) return
          return run(() => shuttle(-1))
        case b.shuttleForward:
          if (e.repeat) return
          return run(() => shuttle(1))
        case b.shuttlePause:
          return run(() => shuttle(0))
        case b.splitTool:
          if (e.repeat) return
          return run(() => s.setSplitToolMode(!s.splitToolMode), false)
        case b.slipTool:
          if (e.repeat) return
          return run(() => s.setSlipToolMode(!s.slipToolMode), false)
        case b.cutter:
          if (e.repeat) return
          return run(() => {
            // Double-tap C: drop a cut mark exactly at the playhead — same as
            // entering the cutter and left-clicking, but with no pixel-perfect
            // clicking needed (e.g. at the very start of the video).
            if (performance.now() - cutterTapRef.current < 450) {
              s.setCutterMode(true)
              // The first tap of the double may have toggled the cutter off,
              // clearing existing marks — restore them before adding.
              const prev = cutterPrevRef.current
              if (prev) for (const m of prev.marks) s.addCutMark(m, prev.trackId)
              s.addCutMark(s.currentTime, useStore.getState().cutTrackId)
              cutterTapRef.current = 0
            } else {
              cutterTapRef.current = performance.now()
              cutterPrevRef.current = { marks: [...s.cutMarks], trackId: s.cutTrackId }
              s.setCutterMode(!s.cutterMode)
            }
          }, false)
        case b.selectTool:
          return run(() => {
            s.setCutterMode(false)
            s.setSplitToolMode(false)
            s.setSlipToolMode(false)
          }, false)
        case b.selectAll:
          // preventDefault matters here: Ctrl+A's browser default is "select
          // every piece of text on the page", which highlights the whole UI.
          return run(() => s.selectAll())
        case b.save:
          return run(() => void handleSave(true))
        case b.redo:
        case 'ctrl+y':
          return run(() => s.redo())
        case b.undo:
          return run(() => s.undo())
        case b.nudgeLeft:
        case b.nudgeRight:
          if (s.selectedClipIds.length === 0) return
          return run(() => {
            const step = (binding === b.nudgeLeft ? -1 : 1) / s.project.settings.fps
            // Every selected clip by the same delta, so a multi-selection keeps
            // its spacing: one undo step, the drag's rules.
            s.nudgeSelection(step)
          })
        // These are the arrow/Home keys: preventDefault so the browser doesn't
        // ALSO scroll the timeline's horizontal scroll container as it steps.
        case b.goStart:
          return run(() => s.setTime(0))
        // A frame on the frame grid; held down, the key's own repeat steps
        // frame after frame. A step stops playback and the shuttle
        // (ONIZLEME-UYGULA-PLAN.md, K3).
        case b.frameBack:
        case b.frameForward:
          return run(() => {
            shuttle(0)
            if (s.playing) s.setPlaying(false)
            s.setTime(stepFrame(useStore.getState().currentTime, s.project.settings.fps, binding === b.frameBack ? -1 : 1))
          })
        // VideoHub's review page's keys (ONIZLEME-UYGULA-PLAN.md).
        case b.goToTime:
          if (e.repeat) return
          return run(() => usePreviewUi.getState().setTimeEdit(true))
        case b.slower:
        case b.faster:
          if (e.repeat) return
          return run(() => stepPlayRate(binding === b.slower ? -1 : 1))
        case b.previewActual:
          return run(() => previewActualSize())
        case b.previewFit:
          return run(() => previewFit())
        case b.prevNote:
        case b.nextNote:
          return run(() => void stepNote(binding === b.prevNote ? -1 : 1))
        case b.narration:
          if (e.repeat) return
          return run(() => usePreviewUi.getState().setNarration(!usePreviewUi.getState().narration))
        case b.shortcutList:
          if (e.repeat) return
          return run(() => usePreviewUi.getState().setKeyList(!usePreviewUi.getState().keyList))
        case b.secondBack:
          return run(() => s.setTime(s.currentTime - 1))
        case b.secondForward:
          return run(() => s.setTime(s.currentTime + 1))
        // I / O: the export's in and out points (phase Ç3b, decision 9); in a
        // Shorts project, the active Short's bounds as before.
        case b.shortIn:
          if (s.project.mode !== 'shorts') return run(() => setExportMark('in', s.currentTime), false)
          return run(() => s.markShortBound('in'), false)
        case b.shortOut:
          if (s.project.mode !== 'shorts') return run(() => setExportMark('out', s.currentTime), false)
          return run(() => s.markShortBound('out'), false)
        case 'ctrl+c':
          return run(() => {
            s.copySelection()
          }, false)
        case 'ctrl+v':
          return run(() => {
            s.pasteClipboard()
          }, false)
        case 'ctrl+shift+v':
          return run(() => s.pasteAttributes(), false)
        case 'ctrl+d':
          return run(() => s.duplicateSelection())
        case 'm':
          return run(() => s.addMarkerAtPlayhead(), false)
        case b.zoomFit:
          // (The timeline's own zoom, phase 3c.T: a short glide, the film's
          // first frame at the left; components/timeline/view-state.ts.)
          return run(() => fitTimeline())
        case b.zoomSelection:
          return run(() => {
            const sel = s.selectedClipIds.map((id) => s.project.clips[id]).filter(Boolean)
            if (sel.length === 0) return
            zoomToRange(Math.min(...sel.map((c) => c.start)), Math.max(...sel.map((c) => c.start + c.duration)))
          })
        case b.prevEdit:
        case b.nextEdit:
          return run(() => {
            // Every clip boundary on any track, plus 0 — the points you actually
            // navigate between when cutting.
            const edges = new Set<number>([0])
            for (const c of Object.values(s.project.clips)) {
              edges.add(c.start)
              edges.add(c.start + c.duration)
            }
            const sorted = [...edges].sort((x, y) => x - y)
            const t = s.currentTime
            const target =
              binding === b.nextEdit
                ? sorted.find((x) => x > t + 1e-4)
                : [...sorted].reverse().find((x) => x < t - 1e-4)
            if (target !== undefined) s.setTime(target)
          })
        case b.toggleLoop:
          return run(() => {
            if (s.loopRange) {
              s.setLoopRange(null)
              showToast(t('app.loop.off'))
            } else if (s.cutMarks.length >= 2) {
              const a = Math.min(...s.cutMarks)
              const c = Math.max(...s.cutMarks)
              s.setLoopRange([a, c])
              s.setTime(a)
              showToast(t('app.loop.range', { a: a.toFixed(1), b: c.toFixed(1) }))
            } else if (s.selectedClipIds.length > 0) {
              const sel = s.selectedClipIds.map((id) => s.project.clips[id]).filter(Boolean)
              const a = Math.min(...sel.map((c) => c.start))
              const c = Math.max(...sel.map((cl) => cl.start + cl.duration))
              s.setLoopRange([a, c])
              s.setTime(a)
              showToast(t('app.loop.selection'))
            } else {
              showToast(t('app.loop.nothing'), true)
            }
          })
        case b.nextMarker:
        case b.prevMarker:
          return run(() => {
            const times = (s.project.markers ?? []).map((m) => m.time).sort((x, y) => x - y)
            const t = s.currentTime
            const target =
              binding === b.nextMarker
                ? times.find((x) => x > t + 1e-4)
                : [...times].reverse().find((x) => x < t - 1e-4)
            if (target !== undefined) s.setTime(target)
          })
        // From key to key, and a key at the playhead (phase Ç2c.2,
        // decision 5): the selected clips and titles, every one when none.
        case b.prevKeyframe:
        case b.nextKeyframe:
          return run(() => {
            const to = stepKey(keyTimes(s.project, s.selectedClipIds, s.selectedCaptionIds), s.currentTime, binding === b.nextKeyframe ? 1 : -1)
            if (to !== undefined) s.setTime(to)
          })
        case b.toggleKeyframe:
          if (e.repeat) return
          return run(() => void s.toggleKeyframeAtPlayhead())
        // The default transition at the selected transition's cut, or the cut
        // nearest the playhead (core polish T).
        case b.addTransition:
          if (e.repeat) return
          return run(() => {
            if (!addDefaultNearPlayhead()) notify({ text: t('ct.noCut') })
          })
        case b.newNote:
          // (Notes are shown only with agent access on: DENEME-2.)
          if (e.repeat || !useSession.getState().status?.server?.running) return
          return run(() => newNote())
        // The preview toolbar's "Note": click-and-type on the preview, only
        // while the agent's access is on (DENEME-2-PLAN-N.md, K4 / K5).
        case b.watchMode:
          if (e.repeat) return
          return run(() => toggleWatch())
        case b.pointNote:
          if (e.repeat || !agentAccessOn()) return
          return run(() => togglePointNote())
        case b.toggleDisable:
          return run(() => {
            if (s.selectedClipIds.length === 0) return
            const anyOn = s.selectedClipIds.some((id) => !s.project.clips[id]?.disabled)
            s.setClipsDisabled(s.selectedClipIds, anyOn)
          })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave, bindings])

  return (
    <div
      className={`app${watching ? ' is-watch' : ''}${layout.inspectorOpen ? '' : ' is-inspector-closed'}`}
      style={{
        gridTemplateRows: `48px 1fr 6px ${timelineH}px`,
        gridTemplateColumns: layout.inspectorOpen ? `minmax(0, 1fr) 6px ${layout.inspector}px` : 'minmax(0, 1fr)'
      }}
    >
      {/* Each big panel in its own error boundary: one that fails shows a
          small "Reload panel" box in its place, the rest keeps working (and
          the autosave, recovery and quit dialog with it). */}
      <ErrorBoundary name="top bar">
      <TopBar
        onProjects={() => setShowProjects(true)}
        onNew={handleNew}
        onNewWindow={() => api?.newWindow()}
        onOpen={handleOpen}
        onSave={() => void handleSave(false)}
        onQuickSave={() => void handleSave(true)}
        onExport={handleExport}
        onExportSrt={handleExportSrt}
        onExportVoiceSet={handleExportVoiceSet}
        onBackups={() => setShowBackups(true)}
        onCancelTranscribe={cancelTranscription}
      />
      </ErrorBoundary>
      <div
        className="main"
        style={{ gridTemplateColumns: `${dockOpen ? layout.bin : DOCK_CATS_PX}px 6px 1fr` }}
      >
        <ErrorBoundary name="media and tools"><WorkspaceDock onImport={handleImport} onTranscribe={handleTranscribe} onTranscribeRange={handleTranscribeRange} /></ErrorBoundary>
        {/* (Closed, the left panel is its category column alone: nothing to size.) */}
        {dockOpen ? <Splitter dir="v" testid="splitter.bin" onDrag={(d) => patchLayout({ bin: layout.bin + d })} /> : <span className="splitter-gap" aria-hidden="true" />}
        <div className="preview">
          <ErrorBoundary name="preview toolbar"><PreviewToolbar /></ErrorBoundary>
          <PreviewSlot host={previewHost} active={!watching} />
          <ErrorBoundary name="transport"><TransportBar /></ErrorBoundary>
          <ErrorBoundary name="Shorts"><ShortsPanel onExportSegments={handleExportShorts} /></ErrorBoundary>
          <ModeHelp />
        </div>
      </div>
      {/* The inspector is the window's full-height right column: it reaches
          the bottom, and the timeline (below) starts at its left edge. It is
          folded away from its own tab strip; this button brings it back. */}
      {layout.inspectorOpen && <Splitter dir="v" testid="splitter.inspector" onDrag={(d) => patchLayout({ inspector: layout.inspector - d })} />}
      <ErrorBoundary name="inspector"><Inspector onTranscribe={handleTranscribe} onCollapse={() => patchLayout({ inspectorOpen: false })} /></ErrorBoundary>
      {!layout.inspectorOpen && (
        <IconButton className="inspector-reopen" icon="chevron-left" variant="secondary" label={t('insp.show')} onClick={() => patchLayout({ inspectorOpen: true })} testid="inspector.reopen" />
      )}
      <Splitter
        dir="h"
        testid="splitter.timeline"
        onDrag={(d) => resizeTimeline(timelineH - d)}
        onReset={() => patchLayout({ timelineRatio: TIMELINE_DEFAULT_RATIO })}
        keyStep={SPLITTER_KEY_STEP_PX}
        label={t('layout.splitter.timeline')}
        value={timelineH}
      />
      <ErrorBoundary name="timeline"><Timeline /></ErrorBoundary>
      {watching && <ErrorBoundary name="watch"><WatchMode previewHost={previewHost} /></ErrorBoundary>}
      {createPortal(<ErrorBoundary name="preview"><PreviewCanvas /></ErrorBoundary>, previewHost)}
      {showProjects && (
        <ProjectHome
          onClose={() => setShowProjects(false)}
          onOpenRecent={handleOpenRecent}
          onNew={() => {
            setShowProjects(false)
            void handleNew('16:9')
          }}
          onOpenDialog={() => {
            setShowProjects(false)
            void handleOpen()
          }}
        />
      )}
      {quitPrompt && (
        <AskDialog
          icon="save"
          tone="warn"
          testid="ask.quit"
          title={t('win.quit.title')}
          message={t('win.quit.why')}
          facts={[
            { label: t('win.ask.project'), value: projectNameShown(useStore.getState().project.name) },
            { label: t('win.ask.clips'), value: String(Object.keys(useStore.getState().project.clips).length) }
          ]}
          onDismiss={() => setQuitPrompt(false)}
          actions={[
            {
              label: t('win.quit.save'),
              icon: 'save',
              testid: 'save',
              kind: 'primary',
              onClick: () => {
                setQuitPrompt(false)
                void handleSave(true).then((saved) => {
                  if (saved) api?.confirmQuit()
                })
              }
            },
            {
              label: t('win.quit.discard'),
              testid: 'discard',
              kind: 'danger',
              onClick: () => {
                setQuitPrompt(false)
                api?.confirmQuit()
              }
            },
            { label: t('win.cancel'), testid: 'cancel', onClick: () => setQuitPrompt(false) }
          ]}
        />
      )}
      {diskConflict && (
        <AskDialog
          icon="triangle-exclamation-point"
          tone="warn"
          testid="ask.disk-conflict"
          title={t('win.conflict.title')}
          message={t('win.conflict.why')}
          facts={[{ label: t('win.conflict.file'), value: diskConflict.split(/[\\/]/).pop() ?? diskConflict }]}
          onDismiss={() => setDiskConflict(null)}
          actions={[
            {
              label: t('win.conflict.overwrite'),
              testid: 'overwrite',
              kind: 'primary',
              onClick: () => {
                setDiskConflict(null)
                autosaveConflictToldRef.current = false
                void handleSave(true, true)
              }
            },
            { label: t('win.cancel'), testid: 'cancel', onClick: () => setDiskConflict(null) }
          ]}
        />
      )}
      {showBackups && <BackupsDialog uid={useStore.getState().project.uid} onOpen={(e) => void openVersion(e)} onClose={() => setShowBackups(false)} />}
      {newerFile !== null && (
        <NewerFileDialog
          format={newerFile}
          onCancel={() => setNewerFile(null)}
          onSaveAs={() => {
            setNewerFile(null)
            void handleSave(false)
          }}
          onSaveOver={() => {
            setNewerFile(null)
            autosaveConflictToldRef.current = false
            void handleSave(true, false, true)
          }}
        />
      )}
      {recovery && (
        <AskDialog
          icon="triangle-exclamation-point"
          tone="warn"
          testid="ask.recovery"
          title={t('win.recovery.title')}
          message={t('win.recovery.why')}
          facts={[
            { label: t('win.ask.project'), value: projectNameShown(recovery.project.name) },
            // The file it was of, by name (phase Ç2a.2, decision 5).
            ...(recovery.path ? [{ label: tr('recovery.file'), value: recovery.path.slice(Math.max(recovery.path.lastIndexOf('\\'), recovery.path.lastIndexOf('/')) + 1) }] : []),
            { label: t('win.ask.clips'), value: String(Object.keys(recovery.project.clips).length) },
            { label: t('win.recovery.autosaved'), value: new Date(recovery.savedAt).toLocaleString() }
          ]}
          note={t('win.recovery.note')}
          onDismiss={laterRecovery}
          actions={[
            { label: t('win.recovery.recover'), icon: 'rotate-cw', testid: 'recover', kind: 'primary', onClick: acceptRecovery },
            { label: t('win.recovery.discard'), testid: 'discard', kind: 'danger', onClick: discardRecovery },
            { label: t('win.recovery.later'), testid: 'later', onClick: laterRecovery }
          ]}
        />
      )}
      {srtPrompt && (
        <AskDialog
          icon="download"
          testid="ask.srt"
          title={t('win.srt.title')}
          message={t('win.srt.why')}
          onDismiss={() => setSrtPrompt(false)}
          actions={[
            {
              label: t('win.srt.sentences'),
              testid: 'sentences',
              kind: 'primary',
              onClick: () => {
                setSrtPrompt(false)
                void writeSrt(false)
              }
            },
            {
              label: t('win.srt.words'),
              testid: 'words',
              onClick: () => {
                setSrtPrompt(false)
                void writeSrt(true)
              }
            },
            { label: t('win.cancel'), testid: 'cancel', onClick: () => setSrtPrompt(false) }
          ]}
        />
      )}
      {voiceSetPrompt && (
        <AskDialog
          icon="download"
          tone="warn"
          testid="ask.voice-set"
          title={t('win.voiceSet.title')}
          message={t('win.voiceSet.why')}
          onDismiss={() => setVoiceSetPrompt(false)}
          actions={[
            {
              label: t('win.voiceSet.export'),
              testid: 'export',
              kind: 'primary',
              onClick: () => {
                setVoiceSetPrompt(false)
                void writeVoiceSet()
              }
            },
            { label: t('win.cancel'), testid: 'cancel', onClick: () => setVoiceSetPrompt(false) }
          ]}
        />
      )}
      {missingPrompt && <MissingMediaDialog onClose={() => setMissingPrompt(false)} />}
      <ExportProgress />
      {/* The one toast stack (ui/Toasts.tsx, notify(); the shell's showToast
          too since phase 3c.4b), at its own place: the window's foot. */}
      <ToastStack />
      <Tour />
      <ConfirmHost />
      {dropping &&<div className="drop-overlay">{t('app.drop')}</div>}
      <ExportWindow onVideo={(settings, path) => performExport(settings, path)} onSegments={(segs, settings) => void runExportShorts(segs, settings)} />
      <SettingsWindow
        bindings={bindings}
        onBindings={(b) => {
          setBindings(b)
          saveBindings(b)
        }}
      />
    </div>
  )
}
