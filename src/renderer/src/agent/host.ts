// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The editor page's side of the agent server (main/agent-server.ts): a tool
// call arrives for this window's project, is done here, and its answer goes
// back as text and pictures. The tools are declared once, in agent/tools.ts
// (served by the main process); this file runs them (SnippStudio phase 4A,
// tools v2), records each call as an activity event (agent/store.ts), and
// keeps each agent session on the project it started on.
//
// Phase 4A.8: edits are done one at a time per window; analyses one at a time
// (at most 8 waiting) and stoppable; a session's state goes when it ends;
// agent access turned off stops everything in flight (the waiting draft
// stays for the user); the test hook window.__agent exists only in a test run.
import { notesListText, notesReadOnly, touchedToLive } from './notes-tool'
import type { AgentCall } from '../../../preload/index'
import { api } from '../platform'
import { projectSession, useStore } from '../state/store'
import { projectDuration, type Project } from '../types'
import { codeFilms } from '../media/codefilm'
import { notify, t } from '../ui'
import { startReview } from '../notes/review'
import { notesFilter, pickNotes, planNoteUpdate, updateText } from '../notes/agent'
import { framePicture, savedPictures } from '../notes/image'
import { isSendable, noteByNum, setNoteStatus } from '../notes/model'
import type { NoteStatus } from '../types'
import { analyze, analyzeKey, ANALYZE_KINDS, type AnalysisResult, type AnalyzeArgs } from './analyze'
import { resultText } from './answers'
import { editTool, type EditContext } from './edit'
import { checkClip, createDone, prepareCreate } from './code-clip'
import { contactSheet, FRAMES_MAX_PIXELS } from './frames'
import { changesText, projectText, rangeContext, sec, transcriptText } from './format'
import { acceptPreview, callsMoving, changesFor, currentDraft, heldBy, draftState, forgetAgentSession, forgetOwnWrites, forgetSessionNews, landing, liveToken, markDisconnected, rejectDraft, removeRange, reviveOp, takeNews, view, watchLive, type AcceptPlan } from './drafts'
import { jobById, jobText, markStep, startJob, startTranscribeChecked, undoStep, waitFor, type StepMark } from './jobs'
import { cancelAgentJobs, startTranscribe, transcribeJobNow } from './transcribe-job'
import { analysisQueue, queueAnalysis } from './queue'
import { acceptSaved, ensureRestorePoint, forgetRestoreSession, matchesPoint, onRestoreNotice, restorePoints, restoreTo } from './restore'
import { useAgentStore } from './store'
import { currentSelection } from './session'
import { recordStep } from './steps'
import { saidOf as saidOfChanges } from './said'
import { changeCount, draftChanges } from './draft-words'
import { wroteOf } from './activity'
import { answerSize, type AnswerSize } from './tokens'
import { rawAnalysis, rawFrames, rawProject, rawTokens, rawTranscript, SAME_AS_RAW, type RawAnswer } from './raw'
import { planArg, PLAN_NOTED } from './plan'
import { enrichAsset, serializeProject, setLastProjectPath } from '../media/projectio'
import { importWrittenFiles, probeMedia } from '../media/import'
import { dropInput, releaseAllMedia } from '../media/sources'
import { dropPeaks } from '../media/peakCache'
import { dropCachedFrames } from '../playback/scrub'
import { dropStripImage } from '../components/Filmstrip'
import { dropItemsTo, giveBackItems, inboxText, rememberSent, waitForItems, watchInboxProject, type InboxItem } from './inbox'
import { NOTHING_YET, waitedForNothing, waitSeconds, withOther } from './wait'
import type { Cancel } from '../audio/silence'
import { PRODUCT_NAME } from '../../../shared/product'
import { takeLabel } from './crew'
import { forgetRegions } from './region-state'
import { collidedAfter, regionOwner } from './drop-words'
import { agentDisplayName, checkHandedOff, checkWriter, chooseAgent, forgetHolderSession, otherAgent, useHolder } from './holder'

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
interface Result {
  content: Content[]
  isError?: boolean
}

const text = (s: string): Result => ({ content: [{ type: 'text', text: s }] })
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// ---- sessions -------------------------------------------------------------

interface Session {
  id: string
  client: string
  /** The project (store.projectSession()) the session works on. */
  projectSession: number
  results: Map<string, AnalysisResult>
  /** Analyses already made (question + version → result id). */
  answered: Map<string, string>
  resultSeq: number
  /** Notes it took, with the status they had (given back if it goes quiet). */
  taken: Map<string, NoteStatus>
  lastCall: number
  /** The other agent its wait was last told the project is with (D22): told
   *  at once the first time, at the end of its time after that. */
  toldWith?: string
}

const sessions = new Map<string, Session>()
/** Bumped when agent access is turned off: everything started before stops. */
let offEpoch = 0

function sessionOf(call: AgentCall): Session {
  const id = call.session?.id ?? 'default'
  let s = sessions.get(id)
  if (!s) {
    s = { id, client: call.session?.client ?? 'agent', projectSession: projectSession(), results: new Map(), answered: new Map(), resultSeq: 0, taken: new Map(), lastCall: Date.now() }
    sessions.set(id, s)
  }
  s.lastCall = Date.now()
  return s
}

/** Its notes still "with agent" go back to what they were (in the project
 *  open now: a closed project's notes are left to the sweep, releaseIdleNotes). */
function releaseTaken(s: Session): number {
  if (s.taken.size === 0) return 0
  const st = useStore.getState()
  const back = s.projectSession === projectSession() ? [...s.taken].filter(([id]) => st.project.notes?.find((n) => n.id === id)?.status === 'agent') : []
  if (back.length) st.editNotes((p) => back.forEach(([id, was]) => void setNoteStatus(p, id, was)), false)
  s.taken.clear()
  return back.length
}

/** A session ended (DELETE), was forgotten by the server, or agent access
 *  went off (G9): what the page kept for it goes. Its draft stays (the
 *  user decides); a session of the same program may take it over. */
export function forgetSession(id: string): void {
  const s = sessions.get(id)
  if (s) releaseTaken(s)
  sessions.delete(id)
  // (What the draft core kept for it: its own writes; its program's kept
  // versions when no other session of that program is left.)
  const last = !!s && ![...sessions.values()].some((x) => x.client === s.client)
  if (s) forgetAgentSession(id, s.client, last)
  forgetRegions(id)
  // (An answer on its draft that waited for it: nobody will take it now.)
  if (s && last) dropItemsTo(s.client)
  forgetSessionNews(id)
  forgetRestoreSession(id)
  forgetHolderSession(id)
  stopNext.delete(id)
}

/** A session stays on the project it started on: another project open now is
 *  said plainly; `project` moves it over (and forgets what it measured and
 *  the notes it took there). */
function checkProject(s: Session, tool: string): void {
  if (s.projectSession === projectSession()) return
  if (tool === 'project') {
    s.projectSession = projectSession()
    s.results.clear()
    s.answered.clear()
    s.taken.clear()
    forgetOwnWrites(s.id)
    return
  }
  throw new Error(`Another project was opened in ${PRODUCT_NAME} ("${useStore.getState().project.name || 'Untitled'}"); what you read belongs to the one before. Call project to work on this one.`)
}

/** Notes a session took and left: after 10 quiet minutes they are open again. */
export const NOTE_RELEASE_MS = 10 * 60_000

/** Notes "with agent" that no session holds (a project opened again, a
 *  session that moved on): when first seen so. */
const orphanSince = new Map<string, number>()

export function releaseIdleNotes(now = Date.now()): number {
  let released = 0
  for (const s of sessions.values()) {
    if (now - s.lastCall < NOTE_RELEASE_MS || s.taken.size === 0) continue
    released += releaseTaken(s)
  }
  // Orphans: "with agent" but no session here took them: open again after
  // the same quiet time (the agent that took them is gone).
  const st = useStore.getState()
  const held = new Set([...sessions.values()].flatMap((s) => [...s.taken.keys()]))
  const orphans = (st.project.notes ?? []).filter((n) => n.status === 'agent' && !held.has(n.id))
  const seen = new Set(orphans.map((n) => n.id))
  for (const id of [...orphanSince.keys()]) if (!seen.has(id)) orphanSince.delete(id)
  const due: string[] = []
  for (const n of orphans) {
    const since = orphanSince.get(n.id)
    if (since === undefined) orphanSince.set(n.id, now)
    else if (now - since >= NOTE_RELEASE_MS) due.push(n.id)
  }
  if (due.length) {
    st.editNotes((p) => due.forEach((id) => void setNoteStatus(p, id, 'open')), false)
    due.forEach((id) => orphanSince.delete(id))
    released += due.length
  }
  return released
}

// ---- one at a time ----------------------------------------------------------

/** Edits run one after another in this window (D6): an edit is prepared and
 *  applied on a view no other edit changes meanwhile. */
let editChain: Promise<unknown> = Promise.resolve()
function oneEditAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = editChain.then(work, work)
  editChain = next.catch(() => undefined)
  return next
}

// Analyses: one at a time, a few waiting, by client (queue.ts
// analysisQueue / queueAnalysis: phase 4A.11, S1).

// ---- the tools --------------------------------------------------------------

/** "Compared with raw" (TOKEN-PLAN.md): how an answer's raw size is worked
 *  out, by call id, set by the tool that made it and measured after the
 *  answer went (agent/raw.ts). Nothing of it reaches the agent. */
const rawOf = new Map<string, (sent: AnswerSize) => RawAnswer>()

async function frames(args: Record<string, unknown>, s: Session, callId = ''): Promise<Result> {
  const v = view(args.state, s.client)
  const times = Array.isArray(args.times) ? args.times.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(0, 12) : []
  if (!times.length) throw new Error('times: 1 to 12 timeline seconds.')
  if (projectDuration(v.project) <= 0) throw new Error('The timeline is empty: there is no picture.')
  // (A code clip edited on disk since its page loaded is started again
  // first: the frames are of the code as it is now, never of the old page.)
  await codeFilms.freshen(v.project).catch(() => undefined)
  // (The setting is one frame's width; a grid shrinks it: frames.ts sheetWidth.)
  const sheet = await contactSheet(v.project, times, { width: num(args.width), setting: useAgentStore.getState().frameWidth, captions: args.captions !== false, maxPixels: FRAMES_MAX_PIXELS })
  if (!sheet) throw new Error('Could not draw the frames.')
  const head = sheet.times.length === 1 ? `Frame at ${sec(sheet.times[0])} s` : `${sheet.times.length} frames (${sheet.times.map(sec).join(', ')} s), numbered`
  const left = sheet.leftOut?.length ? ' ' + sheet.leftOut.join(' ') : ''
  const ctx = args.context === true ? '\n' + rangeContext(v.project, sheet.times) : ''
  const shown = sheet.times.length
  rawOf.set(callId, (sent) => rawFrames(sent, shown, v.project))
  return { content: [{ type: 'text', text: `${head}, ${sheet.width}x${sheet.height}. v ${v.token}${left}${ctx}` }, { type: 'image', data: sheet.data, mimeType: 'image/jpeg' }] }
}

/** new_project: an empty project in this window, and the session goes with
 *  it. Only a clean project with no waiting draft: nothing of the user's is
 *  thrown away. */
function newProjectTool(a: Record<string, unknown>, s: Session): Result {
  if (currentDraft()) throw new Error('A draft is waiting for the user; a new project waits until it is accepted or rejected. Nothing was changed.')
  if (useStore.getState().dirty) throw new Error('The open project has unsaved changes; a new one is started only after the user saves or discards it. Nothing was changed.')
  const aspect = a.aspect === undefined ? '16:9' : a.aspect
  if (aspect !== '16:9' && aspect !== '9:16' && aspect !== '1:1') throw new Error('aspect: 16:9, 9:16 or 1:1.')
  const name = typeof a.name === 'string' ? a.name.trim().slice(0, 120) : ''
  setLastProjectPath(null)
  releaseAllMedia()
  useStore.getState().newProject(aspect)
  if (name) useStore.getState().setProjectName(name)
  // (The session is on the new project from here: what it read before is
  // not this one's.)
  s.projectSession = projectSession()
  s.results.clear()
  s.answered.clear()
  s.taken.clear()
  forgetOwnWrites(s.id)
  const p = useStore.getState().project
  return text(`New project "${p.name}" (${p.settings.width}×${p.settings.height}, ${p.settings.fps} fps). It has no file yet: the user saves it. Call project for its tracks.`)
}

/** The media tool: files the agent names come into the bin, or an asset is
 *  pointed at a new file (a rebuilt mix: no restart, no hand-edited .snipp). */
async function mediaTool(a: Record<string, unknown>): Promise<Result> {
  if (!api) throw new Error(`Media needs the ${PRODUCT_NAME} app.`)
  const hasImport = Array.isArray(a.import)
  const replace = a.replace && typeof a.replace === 'object' ? (a.replace as { asset?: unknown; path?: unknown }) : null
  if (hasImport === !!replace) throw new Error('media: give import:[paths] or replace:{asset,path}.')
  if (hasImport) {
    const paths = (a.import as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0).slice(0, 50)
    if (!paths.length) throw new Error('import: a list of local file paths (video, sound, picture).')
    const files = await api.importMediaPaths(paths)
    if (!files.length) throw new Error('import: none of those paths is a media file that is there (video, sound, picture).')
    const r = await importWrittenFiles(files)
    const added = r.assets.length ? useStore.getState().addAssets(r.assets) : []
    const bin = useStore.getState().project.assets
    const key = (p: string | undefined): string => (p ?? '').replace(/\\/g, '/').toLowerCase()
    const lines = files.map((f) => {
      const was = added.find((x) => key(x.path) === key(f.path)) ?? bin.find((x) => key(x.path) === key(f.path))
      if (was && !added.includes(was)) return `${was.name} (${was.id}) was already in the bin`
      return was ? `${was.kind} ${was.name} (${was.id})${was.duration > 0 ? ` ${sec(was.duration)} s` : ''}` : `${f.name} was not imported`
    })
    const bad = r.errors.length ? `\nNot imported: ${r.errors.slice(0, 10).join('; ')}` : ''
    return text(`Imported ${added.length} file${added.length === 1 ? '' : 's'}: ${lines.join(', ')}.${bad}`)
  }
  const ref = typeof replace?.asset === 'string' ? replace.asset.trim() : ''
  const filePath = typeof replace?.path === 'string' ? replace.path.trim() : ''
  if (!ref || !filePath) throw new Error('replace: "asset" (its id or name) and "path" (the new file).')
  const project = useStore.getState().project
  const asset = project.assets.find((x) => x.id === ref) ?? project.assets.find((x) => x.name === ref)
  if (!asset) throw new Error(`replace: there is no asset "${ref}".`)
  if (asset.kind === 'code') throw new Error('replace: a code clip is its folder; edit the folder\'s files and it reloads.')
  const [file] = await api.importMediaPaths([filePath])
  if (!file) throw new Error('replace: that path is not a media file that is there.')
  const info = await probeMedia({ url: file.url, name: file.name, path: file.path, size: file.size, mtime: file.mtime }).catch(() => null)
  if (!info) throw new Error(`replace: "${file.name}" could not be read.`)
  if (info.kind !== asset.kind) throw new Error(`replace: "${file.name}" is a ${info.kind}, and "${asset.name}" is a ${asset.kind}: give a file of the same kind.`)
  // (Everything read from the old file goes; the address carries the new
  // write time so the browser's cache cannot play the old one.)
  dropInput(asset.id)
  dropCachedFrames(asset.id)
  dropPeaks(asset.id)
  dropStripImage(asset.id)
  useStore.getState().updateAsset(asset.id, {
    url: `${file.url}${file.url.includes('?') ? '&' : '?'}v=${file.mtime}`,
    path: file.path,
    size: file.size,
    mtime: file.mtime,
    missing: undefined,
    relPath: undefined,
    duration: info.duration,
    width: info.width,
    height: info.height,
    hasAudio: info.hasAudio,
    filmstrip: undefined,
    filmstripCols: undefined,
    ...(info.thumbnail ? { thumbnail: info.thumbnail } : {})
  })
  const fresh = useStore.getState().project.assets.find((x) => x.id === asset.id)
  if (fresh) void enrichAsset(fresh, (id, patch) => useStore.getState().setAssetDerived(id, patch))
  return text(`"${asset.name}" now reads ${file.name}${info.duration > 0 ? ` (${sec(info.duration)} s)` : ''}. Its clips use the new file.`)
}

/** Phase 5e, decision 2: each code clip whose verdict is not "ok" (an error
 *  its page wrote down, a check's blank, unstable or error), one line. */
function codeClipLines(p: Project): string[] {
  const out: string[] = []
  for (const a of p.assets) {
    if (a.kind !== 'code') continue
    const v = codeFilms.verdict(a.id)
    if (!v || v.verdict === 'ok') continue
    for (const c of Object.values(p.clips)) if (c.assetId === a.id) out.push(`Code clip ${c.id} (${a.name}): ${v.verdict}${v.lines[0] ? `: ${v.lines[0].slice(0, 200)}` : ''}`)
  }
  return out.slice(0, 20)
}

function changes(args: Record<string, unknown>, s: Session): Result {
  if (typeof args.since !== 'string') throw new Error('since: a version you read, like "' + liveToken() + '".')
  const news = takeNews(s.id)
  const { changes: ch, to } = changesFor(s.client, args.since)
  return text([changesText(ch, args.since, to, news), ...codeClipLines(view(undefined, s.client).project)].join('\n'))
}

/** An analysis call's findings, by call id, for its activity event (the
 *  timeline shows them appear: phase 4B.4). */
const foundOf = new Map<string, [number, number][]>()
const rangesOfResult = (r: AnalysisResult): [number, number][] => r.items.map((i) => i.cut ?? i.range).filter((x): x is [number, number] => !!x)

async function analyzeTool(args: Record<string, unknown>, s: Session, cancelled: () => boolean, callId = ''): Promise<Result> {
  const kind = args.kind as AnalyzeArgs['kind']
  if (!ANALYZE_KINDS.includes(kind)) throw new Error(`kind: one of ${ANALYZE_KINDS.join(', ')}.`)
  const v = view(args.state, s.client)
  // The same question on the same version: the answer kept (no new reading).
  const key = `${analyzeKey(args)}@${v.token}`
  const known = s.answered.get(key)
  if (known && s.results.has(known)) {
    const r = s.results.get(known)!
    foundOf.set(callId, rangesOfResult(r))
    const out = resultText(r, v.project)
    rawOf.set(callId, () => rawAnalysis(r.head, r.items, out))
    return text(out)
  }
  const id = `r${++s.resultSeq}`
  // (The live version the measured project stands on: "did anyone change
  // the film since" is asked from here when the result is applied.)
  const live = useStore.getState().projectVersion
  const epoch = offEpoch
  const ps = projectSession()
  // Stops when agent access goes off, the session ends, or another project opens.
  const signal: Cancel = { cancelled: () => epoch !== offEpoch || !sessions.has(s.id) || projectSession() !== ps }
  let late = false
  const run = queueAnalysis(() => analyze(v.project, args as unknown as AnalyzeArgs, id, v.token, signal), signal, s).then((r) => {
    r.live = live
    s.results.set(r.id, r)
    s.answered.set(key, r.id)
    foundOf.set(callId, rangesOfResult(r))
    const out = resultText(r, v.project)
    // (Handed on as a job: this call was answered already; its raw is its own size.)
    if (!late) rawOf.set(callId, () => rawAnalysis(r.head, r.items, out))
    return out
  })
  // A long one (a 30-minute sound read, or one waiting behind others) goes on as a job.
  const quick = await Promise.race([run.then((x) => ({ x })), new Promise<null>((r) => setTimeout(() => r(null), 45_000))])
  if (quick) return text(quick.x)
  late = true
  rawOf.set(callId, () => 'same')
  if (cancelled()) throw new Error('cancelled')
  const job = startJob(`analyze ${kind}`, () => run)
  return text(`${kind} is still running as job ${job.id}: job {"id":"${job.id}","wait":60}.`)
}

async function notesTool(args: Record<string, unknown>, s: Session, projectPath: string | null, callId = ''): Promise<Result> {
  const st = useStore.getState()
  if (args.image !== undefined) {
    // (Raw: each frame the picture shows, at the project's full size.)
    const project = st.project
    let rawCount = 1
    rawOf.set(callId, (sent) => rawFrames(sent, rawCount, project))
    const id = num(args.image)
    const n = id === undefined ? undefined : noteByNum(st.project, id)
    if (!n) throw new Error(`There is no note #${String(args.image)}.`)
    // One picture: the frame as the user saw it with the drawing, or the
    // note's start (and end, for a range) as a pair in one image.
    if (n.shapes?.length && n.regionImage) {
      const saved = await savedPictures(n.regionImage, n.shapes, 640)
      if (saved) return { content: [{ type: 'text', text: `Note #${n.num}: the frame at ${sec(n.at ?? n.start)} s with the user's drawing (${saved.whole.width}x${saved.whole.height}).` }, { type: 'image', data: saved.whole.data, mimeType: 'image/jpeg' }] }
    }
    if (n.shapes?.length) {
      const live = await framePicture(st.project, n.at ?? n.start, { maxWidth: 640, shapes: n.shapes })
      if (live) return { content: [{ type: 'text', text: `Note #${n.num}: the frame at ${sec(n.at ?? n.start)} s now, with the drawing.` }, { type: 'image', data: live.data, mimeType: 'image/jpeg' }] }
    }
    const times = n.end - n.start > 1e-3 ? [n.start, n.end] : [n.start]
    rawCount = times.length
    const sheet = await contactSheet(st.project, times, { width: times.length > 1 ? 320 : 512 })
    if (!sheet) throw new Error('The timeline is empty: there is no picture.')
    return { content: [{ type: 'text', text: `Note #${n.num} (no drawing): ${times.length > 1 ? 'its start and end' : 'its frame'} now.` }, { type: 'image', data: sheet.data, mimeType: 'image/jpeg' }] }
  }
  if (Array.isArray(args.update)) {
    const out: string[] = []
    for (const u of args.update) {
      try {
        // The agent's seconds are those of what it reads: its draft while one
        // waits. A note is the live project's: the ranges are carried there
        // by their footage (accept then moves them with the cuts, once).
        const live = useStore.getState().project
        const d = currentDraft()
        const seen = d && d.session === s.id ? d.project : live
        const plan = planNoteUpdate(seen, (u ?? {}) as Record<string, unknown>)
        touchedToLive(plan, seen, live)
        const id = plan.note.id
        useStore.getState().editNotes((p) => void setNoteStatus(p, id, plan.status ?? plan.note.status, { reply: plan.reply, touched: plan.touched }), false)
        // Taken by update too (rule 24): released after 10 quiet minutes.
        if (plan.status === 'agent' && plan.note.status !== 'agent' && !s.taken.has(id)) s.taken.set(id, plan.note.status)
        if (plan.status && plan.status !== 'agent') s.taken.delete(id)
        const after = noteByNum(useStore.getState().project, plan.note.num) ?? plan.note
        if (plan.status === 'ready' && plan.note.status !== 'ready') {
          notify({ text: t('agent.noteAnswered', { num: after.num, reply: (after.reply ?? '').slice(0, 90) }), action: { label: t('agent.look'), run: () => startReview(id) } })
        }
        out.push(updateText(useStore.getState().project, after, plan.remarks))
      } catch (e) {
        out.push(`! ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return text(out.join('\n'))
  }
  const filter = notesFilter(args.status)
  // The notes are the working agent's to take (D22, the audit's A8: an
  // agent that had been refused took them, and the one that holds the
  // project no longer saw a waiting note): another agent only reads them.
  const other = otherAgent(s.client)
  const waiting = args.take === false || other !== null ? [] : pickNotes(st.project, filter).filter(isSendable)
  if (waiting.length > 0) {
    for (const n of waiting) if (!s.taken.has(n.id)) s.taken.set(n.id, n.status)
    // A status, not an edit: no undo step (FAZ1-PLAN.md, K6).
    st.editNotes((p) => waiting.forEach((n) => void setNoteStatus(p, n.id, 'agent')), false)
  }
  // (The notes as they were picked — before they were taken — in the frame
  // the agent reads: its draft while one waits, the frame an update's
  // ranges are read in: phase 4A.10, table#5.)
  const d = currentDraft()
  const list = notesListText(st.project, d && d.session === s.id ? d.project : st.project, projectPath, filter, waiting.length)
  return text(other !== null && args.take !== false ? notesReadOnly(list, agentDisplayName(other)) : list)
}

async function jobTool(args: Record<string, unknown>, s: Session, cancelled: () => boolean): Promise<Result> {
  if (args.start === 'transcribe') {
    // The same project version asked again (any language): the same job.
    let job = transcribeJobNow()
    if (!job) {
      // Project, cancel and "replace" are checked before the restore point
      // is written and again after it (jobs.ts startTranscribeChecked).
      let mark: StepMark | null = null
      job = await startTranscribeChecked({
        replace: args.replace === true,
        cancelled,
        ensurePoint: () => ensureRestorePoint(s.id),
        start: () =>
          startTranscribe(
            args.language,
            (count, replaced) =>
              notify(replaced
                // "Undo" undoes THAT step: only while it is the newest one.
                ? { text: t('agent.retranscribed', { count }), action: { label: t('agent.undo'), run: () => void (undoStep(mark) || notify({ text: t('agent.undoNotNewest') })) } }
                : { text: t('agent.transcribed', { count }) }),
            { beforeWrite: landing.before, afterWrite: () => { landing.after(); mark = markStep() } }
          )
      })
    }
    if (num(args.wait)) await waitFor(job, num(args.wait)!, cancelled)
    return text(jobText(job))
  }
  if (typeof args.id !== 'string') throw new Error('Give start:"transcribe", or the id of a job to wait for.')
  const job = jobById(args.id)
  if (!job) throw new Error(`There is no job "${args.id}".`)
  await waitFor(job, num(args.wait) ?? 0, cancelled)
  return text(jobText(job))
}

// ---- wait: what the user sends from the app (GONDER-PLAN.md) ------------------

/** Waits that handed something over, kept a minute: a cancel that comes
 *  right after (the agent gave the call up just as it was answered) gives
 *  the items back and the notes their status, so nothing sent is lost. */
const handed = new Map<string, { items: InboxItem[]; session: string; project: number; took: [string, NoteStatus][]; at: number }>()
const HANDED_KEEP_MS = 60_000

/** The items a wait hands over, as the agent reads them; null when none is
 *  left to send (notes taken with the notes tool meanwhile, or deleted). */
function handOver(items: InboxItem[], s: Session, callId: string): string | null {
  const st = useStore.getState()
  const live = st.project
  const sent: InboxItem[] = []
  for (const it of items) {
    if (it.kind !== 'notes') sent.push(it)
    else {
      const ids = it.notes.filter((id) => {
        const n = live.notes?.find((x) => x.id === id)
        return !!n && isSendable(n)
      })
      if (ids.length) sent.push({ ...it, notes: ids })
    }
  }
  if (!sent.length) return null
  // The notes in the frame the agent reads (its draft while one waits), as
  // the notes tool lists them; their statuses are the live ones.
  const d = currentDraft()
  const inDraft = !!d && d.session === s.id
  let seen = live
  if (inDraft) {
    const there = new Map((d.project.notes ?? []).map((n) => [n.id, n]))
    seen = { ...d.project, notes: (live.notes ?? []).map((n) => { const x = there.get(n.id); return x ? { ...n, start: x.start, end: x.end, ...(x.at !== undefined ? { at: x.at } : {}) } : n }) }
  }
  const out = inboxText(sent, seen, inDraft)
  // Taken, as the notes tool takes them: "with agent", given back after 10
  // quiet minutes. A status, not an edit: no undo step.
  const took: [string, NoteStatus][] = []
  for (const it of sent) if (it.kind === 'notes') for (const id of it.notes) took.push([id, live.notes!.find((x) => x.id === id)!.status])
  if (took.length) {
    for (const [id, was] of took) if (!s.taken.has(id)) s.taken.set(id, was)
    st.editNotes((p) => took.forEach(([id]) => void setNoteStatus(p, id, 'agent')), false)
  }
  const now = Date.now()
  for (const [k, v] of handed) if (now - v.at > HANDED_KEEP_MS) handed.delete(k)
  handed.set(callId, { items: sent, session: s.id, project: projectSession(), took, at: now })
  rememberSent(sent, s.client)
  return out
}

/** A call the server cancelled after this page had answered it: a wait's
 *  items go back in line, its notes back to what they were. */
function handedBack(callId: string): void {
  const h = handed.get(callId)
  if (!h) return
  handed.delete(callId)
  giveBackItems(h.items, h.project)
  if (h.project !== projectSession() || !h.took.length) return
  const st = useStore.getState()
  const back = h.took.filter(([id]) => st.project.notes?.find((n) => n.id === id)?.status === 'agent')
  if (back.length) st.editNotes((p) => back.forEach(([id, was]) => void setNoteStatus(p, id, was)), false)
  const s = sessions.get(h.session)
  if (s) for (const [id] of h.took) s.taken.delete(id)
}

async function waitTool(call: AgentCall, s: Session, cancelled: () => boolean): Promise<Result> {
  // The agent's own plan (TOKEN-PLAN.md): kept for the agent bar, answered
  // at once; nothing of the user's is taken. Without it: the wait as always.
  if (call.args.plan !== undefined) {
    planArg(call.args.plan)
    return text(PLAN_NOTED)
  }
  // (Its time: what it asked, or its program's safe default; always ending
  // before the server gives the call up.)
  const until = Math.min(Date.now() + waitSeconds(call.args.seconds, s.client) * 1000, (call.deadline ?? Infinity) - 3000)
  const ps = projectSession()
  const epoch = offEpoch
  // The project is with another agent (D22, the audit's A2): this wait gets
  // only what is for its own program (the answer on its draft). It is told
  // so at once the first time — its user can be told in the chat — and after
  // that at the end of its time (an agent that waits in a loop is not sent
  // round at once every time).
  const other0 = otherAgent(s.client)
  const first = other0 !== null && s.toldWith !== other0
  if (other0 === null) delete s.toldWith
  for (;;) {
    const items = await waitForItems({ call: call.id, client: s.client, session: s.id, until: first ? 0 : until, stop: () => cancelled() || epoch !== offEpoch || !sessions.has(s.id) || projectSession() !== ps || useHolder.getState().handedOff[s.id] !== undefined })
    if (items === null) {
      checkHandedOff(s.id)
      if (projectSession() !== ps) throw new Error(`Another project was opened in ${PRODUCT_NAME}: call project, then wait.`)
      throw new Error('cancelled')
    }
    if (!items.length) {
      const other = otherAgent(s.client)
      if (other === null) return text(NOTHING_YET)
      s.toldWith = other
      return text(withOther(agentDisplayName(other), PRODUCT_NAME))
    }
    const out = handOver(items, s, call.id)
    if (out) return text(out)
  }
}

/** What an edit call changed, in the user's words, by call id: its step
 *  says it (D22, A13) — and where it wrote, which clips, how many changes
 *  (D22, worker C: the ruler's flag, the trail, the frame on a changed
 *  clip). The app's own reading of the two projects; nothing of it goes to
 *  the agent. */
const saidOf = new Map<string, { said: string; wrote: [number, number][]; clips: string[]; changed: number }>()

/** The user pressed Stop on the agent bar (D22, worker C): the calls of
 *  that agent program that run now are cancelled and answered with these
 *  words; when none ran (the agent was thinking), its next call is. */
export const stopText = (ran: boolean): string => `The user pressed Stop in ${PRODUCT_NAME}: stop working on this now and ask them what to do next. ${ran ? 'Nothing of this call was applied.' : 'This call was not run.'}`
const stoppedCalls = new Set<string>()
const stopNext = new Set<string>()
const callSession = new Map<string, string>()

export function stopAgent(client: string | null): number {
  let n = 0
  for (const id of inFlight) {
    const s = sessions.get(callSession.get(id) ?? '')
    if (!s || (client !== null && s.client !== client) || waitingCalls.has(id)) continue
    cancelledCalls.add(id)
    stoppedCalls.add(id)
    n++
  }
  if (n === 0) for (const s of sessions.values()) if (client === null || s.client === client) stopNext.add(s.id)
  useAgentStore.getState().setStopped(Date.now())
  return n
}
const waitingCalls = new Set<string>()
/** The worker label of each call in flight (EKIP-PLAN.md): its edit's
 *  entry carries it (the draft's groups). */
const callLabel = new Map<string, string>()

/** What an edit is done with (the edit tool, and code_clip's create). */
function editContext(call: AgentCall, s: Session, cancelled: () => boolean): EditContext {
  const budget = typeof call.budget === 'number' ? call.budget : undefined
  const as = callLabel.get(call.id)
  return {
    session: s.id,
    client: s.client,
    ...(as ? { as } : {}),
    results: s.results,
    beforeFirstEdit: async () => void (await ensureRestorePoint(s.id)),
    // (Said once: the agent bar says it, with its Undo, while it is on screen;
    // the toast only when there is no bar to say it.)
    told: (what) => void (useAgentStore.getState().barShown || notify({ text: t('agent.edited', { what }) })),
    words: (before, after, cuts) => {
      const changes = draftChanges(before, after, cuts)
      const said = saidOfChanges(changes)
      saidOf.set(call.id, { said, ...wroteOf(changes, before, after, cuts), changed: changeCount(changes) })
      return said
    },
    cancelled,
    deadline: call.deadline,
    margin: budget !== undefined ? Math.min(10_000, budget / 4) : 10_000,
    alive: (id) => sessions.has(id)
  }
}

/** Does this call change the project (DENEME-4, item 9: one agent at a time)? */
export function writes(tool: string, a: Record<string, unknown>): boolean {
  if (tool === 'edit') return !(Array.isArray(a.ops) && a.ops.length === 1 && (a.ops[0] as { op?: unknown } | null)?.op === 'help')
  if (tool === 'media' || tool === 'new_project') return true
  if (tool === 'code_clip') return a.create !== undefined
  if (tool === 'job') return typeof a.start === 'string'
  if (tool === 'notes') return a.update !== undefined
  return false
}

async function run(call: AgentCall, s: Session, cancelled: () => boolean): Promise<Result> {
  // (The user handed the project to another agent: told when it would
  // change it — checkWriter — and in its wait. It may still READ: "reading
  // stays open to every agent" (D22, the audit's A11: it could not).)
  // (The user pressed Stop while the agent was between two calls.)
  if (call.tool !== 'wait' && stopNext.delete(s.id)) throw new Error(stopText(false))
  checkProject(s, call.tool)
  const a = call.args
  if (writes(call.tool, a)) checkWriter(s.id, s.client, (id) => sessions.has(id))
  switch (call.tool) {
    case 'project': {
      const v = view(a.state, s.client)
      const d = currentDraft()
      const st = useStore.getState()
      const marks = st.cutMarks ?? []
      const news = takeNews(s.id)
      const out = projectText(v.project, {
        version: v.token,
        state: v.kind,
        draft: d ? `${d.entries.length} call${d.entries.length === 1 ? '' : 's'} pending` : undefined,
        selection: currentSelection(st.selectedClipIds, marks),
        path: call.projectPath
      }, typeof a.track === 'string' ? a.track : undefined)
      const part = typeof a.track === 'string' ? a.track : undefined
      rawOf.set(call.id, () => rawProject(v.project, part))
      return text([out, ...news.map((n) => `Draft: ${n}`)].join('\n'))
    }
    case 'transcript': {
      const v = view(a.state, s.client)
      const out = transcriptText(v.project, v.token, { start: num(a.start), end: num(a.end), words: a.words === true })
      rawOf.set(call.id, () => rawTranscript(v.project, out, a.words === true))
      return text(out)
    }
    case 'frames':
      return frames(a, s, call.id)
    case 'changes':
      return changes(a, s)
    case 'analyze':
      return analyzeTool(a, s, cancelled, call.id)
    case 'edit': {
      const out = await oneEditAtATime(() => editTool(a, editContext(call, s, cancelled)))
      const news = takeNews(s.id)
      return text([out, ...news.map((n) => `Draft: ${n}`)].join('\n'))
    }
    case 'media':
      return mediaTool(a)
    case 'new_project':
      return newProjectTool(a, s)
    case 'code_clip': {
      // Phase 5e, decision 5: one of create or check.
      if ((a.create === undefined) === (a.check === undefined)) throw new Error('code_clip: give create:{name,start,end} or check:"<clip id>".')
      if (a.check !== undefined) return text(await checkClip(a.check, s.client))
      const made = await oneEditAtATime(async () => {
        const p = await prepareCreate(a.create, call.projectPath, s.client, s.id)
        const direct = (a.create as { direct?: unknown }).direct === true
        try {
          return { head: p.head, out: await editTool({ ...(p.place as unknown as Record<string, unknown>), ...(direct ? { direct: true } : {}) }, editContext(call, s, cancelled)) }
        } finally {
          // (Its film may leave the project now if no clip uses it: audit A3.)
          createDone(p.assetId)
        }
      })
      const news = takeNews(s.id)
      return text([made.head, made.out, ...news.map((n) => `Draft: ${n}`)].join('\n'))
    }
    case 'notes':
      return notesTool(a, s, call.projectPath, call.id)
    case 'job':
      return jobTool(a, s, cancelled)
    case 'wait':
      // (The agent's own wait with no plan: its work is done, its workers'
      // regions go — EKIP-3-PLAN.md §1.)
      if (a.plan === undefined && !callLabel.has(call.id)) forgetRegions(s.id)
      return waitTool(call, s, cancelled)
    default:
      throw new Error(`This ${PRODUCT_NAME} does not know the tool "${call.tool}".`)
  }
}

/** What the call is about, for the activity log (the timeline's tracing in 4B). */
function about(call: AgentCall): { kind?: string; range?: [number, number]; at?: number[]; ops?: number; plan?: string[]; sent?: string[] } {
  const a = call.args
  const range = num(a.start) !== undefined || num(a.end) !== undefined ? ([num(a.start) ?? 0, num(a.end) ?? projectDuration(view().project)] as [number, number]) : undefined
  switch (call.tool) {
    case 'analyze':
      return { kind: String(a.kind), ...(range ? { range } : {}) }
    case 'transcript':
      return { kind: a.words ? 'words' : 'lines', ...(range ? { range } : {}) }
    case 'frames':
      return { at: Array.isArray(a.times) ? a.times.filter((x): x is number => typeof x === 'number') : [] }
    case 'edit':
      return { kind: Array.isArray(a.ops) ? [...new Set(a.ops.slice(0, 50).map((o) => String((o as { op?: unknown })?.op)))].join(',') : undefined, ...(Array.isArray(a.ops) ? { ops: a.ops.length } : {}) }
    case 'job':
      return { kind: typeof a.start === 'string' ? a.start : 'wait' }
    case 'media':
      return { kind: a.replace !== undefined ? 'replace' : 'import' }
    case 'new_project':
      return { kind: 'new' }
    case 'code_clip':
      return { kind: a.check !== undefined ? 'check' : 'create' }
    case 'wait': {
      // (The plan it carried, or what it brought: the job's kind and notes.)
      if (a.plan !== undefined) {
        const plan = planArg(a.plan, true)
        return { kind: 'plan', ...(plan ? { plan } : {}) }
      }
      const h = handed.get(call.id)
      if (!h) return {}
      const notes = h.items.flatMap((it) => (it.kind === 'notes' ? it.notes : []))
      return { kind: h.items[0]?.kind ?? '', ...(notes.length ? { sent: notes.slice(0, 200) } : {}) }
    }
    default:
      return {}
  }
}

/** Calls cancelled by the server (they ran past its time), and those still
 *  running here. */
const cancelledCalls = new Set<string>()
const inFlight = new Set<string>()

/** Agent access was turned off (G7): every call in flight is cancelled,
 *  analyses and the agent's jobs stop, the sessions are forgotten; the
 *  waiting draft stays for the user, marked "agent connection closed". */
export function agentAccessOff(): void {
  offEpoch++
  for (const id of inFlight) cancelledCalls.add(id)
  // Every analysis that waits ends now ("cancelled"): one that had been
  // handed on as a job does not stay "running" (V-limits-sessions-3).
  analysisQueue.clear('cancelled: agent access was turned off')
  cancelAgentJobs()
  for (const id of [...sessions.keys()]) forgetSession(id)
  markDisconnected()
}

/** Starts answering the agent server's calls (the editor window only). */
export function startAgentHost(): void {
  if (!api?.agent) return
  watchLive()
  // What the restore points have to tell the user (a point that could not
  // be written; points before the agent kept past the usual number).
  onRestoreNotice((n) => notify({ text: 'params' in n ? t(n.key, n.params) : t(n.key) }))
  // Notes a quiet session took go back to open (checked twice a minute;
  // nothing is sent anywhere).
  setInterval(() => void releaseIdleNotes(), 30_000)
  watchInboxProject()
  api.agent.onCancel?.((id) => {
    cancelledCalls.add(id)
    handedBack(id)
  })
  api.agent.onSession?.((e) => {
    if (e.kind === 'off') agentAccessOff()
    else if (e.id) forgetSession(e.id)
  })
  api.agent.onCall((sent) => {
    // (The worker label comes off the call before anything reads it: the
    // tools never see it; without one the call is the very object sent.)
    const { as, args } = takeLabel(sent.args)
    const call = args === sent.args ? sent : { ...sent, args }
    if (as) callLabel.set(call.id, as)
    const s = sessionOf(call)
    const cancelled = (): boolean => cancelledCalls.has(call.id) || (call.deadline !== undefined && Date.now() > call.deadline)
    const store = useAgentStore.getState()
    inFlight.add(call.id)
    callSession.set(call.id, s.id)
    if (call.tool === 'wait') waitingCalls.add(call.id)
    // A wait is not a step while it waits (the agent is not working then: the
    // Agent tab says it waits); one that brought something is one step.
    const quiet = call.tool === 'wait'
    const started = (): void => store.callStarted({ id: call.id, session: s.id, tool: call.tool, client: s.client, ...(as ? { as } : {}), defsChars: call.session?.defsChars ?? 0, ...about(call) })
    if (!quiet) started()
    void (async (): Promise<Result> => {
      // Too late already (the page was busy past the server's time): not done.
      if (cancelled()) throw new Error('cancelled')
      return run(call, s, cancelled)
    })()
      .catch((e): Result => ({ content: [{ type: 'text', text: e instanceof Error ? e.message : 'The tool failed.' }], isError: true }))
      .then((done) => {
        // (Stopped by the user: a call that was cancelled says so; one that
        // had already finished keeps its answer and the next call is told.)
        let result = done
        if (stoppedCalls.delete(call.id)) {
          if (done.isError) result = { content: [{ type: 'text', text: stopText(true) }], isError: true }
          else stopNext.add(s.id)
        }
        callSession.delete(call.id)
        callLabel.delete(call.id)
        waitingCalls.delete(call.id)
        const found = foundOf.get(call.id)
        foundOf.delete(call.id)
        const words = saidOf.get(call.id)
        saidOf.delete(call.id)
        const said = (result.content[0] as { text?: string } | undefined)?.text
        const record = !quiet || (!result.isError && !waitedForNothing(said))
        if (quiet && record) started()
        // Compared with raw (TOKEN-PLAN.md): worked out from what the answer
        // was made of, kept on its event with the rest (one store write); the
        // answer itself is untouched.
        const rawOne = rawOf.get(call.id)
        rawOf.delete(call.id)
        if (record) {
          const sent = answerSize(result.content)
          let r: RawAnswer = null
          try {
            r = result.isError || (!rawOne && SAME_AS_RAW.has(call.tool)) ? 'same' : rawOne ? rawOne(sent) : null
          } catch {
            r = null
          }
          // (Team mode: an op of this worker dropped after another worker's
          // call — the answer names it; the user's step says whose. The
          // answer itself is untouched.)
          const d = as && (call.tool === 'edit' || call.tool === 'code_clip') && !result.isError ? currentDraft() : null
          const after = d ? collidedAfter(said ?? '', as, callsMoving(d), heldBy(s.client, call.args.base)) : undefined
          const region = call.tool === 'edit' && !result.isError ? regionOwner(said ?? '') : undefined
          useAgentStore.getState().callFinished(call.id, { ...(after !== undefined ? { after } : {}), ...(region ? { region } : {}), size: sent, raw: rawTokens(r, sent), ...(result.isError ? { error: said?.slice(0, 200) } : {}), ...(found && !result.isError ? { found } : {}), ...((call.tool === 'edit' || call.tool === 'code_clip') && !result.isError && /^Nothing applied/m.test(said ?? '') ? { nothing: true } : {}), ...(words && !result.isError ? { said: words.said, wrote: words.wrote, clips: words.clips, changed: words.changed } : {}) })
          recordStep(call.id)
        }
        cancelledCalls.delete(call.id)
        inFlight.delete(call.id)
        api?.agent.reply(call.id, result)
      })
  })
  // Test hooks (e2e only: a source build started with --e2e and its own
  // profile; never in the packaged app). Phase 4B's card calls the module's
  // functions (drafts.ts, restore.ts) itself.
  void Promise.resolve(api.testE2e?.())
    .catch(() => false)
    .then((on) => {
      if (on !== true) return
      ;(window as unknown as Record<string, unknown>).__agent = {
        store: useAgentStore,
        draft: () => draftState(),
        /** `shown` (what preview gave): nothing is adopted when the project
         *  or the outcome is no longer what was shown. */
        /** The card's accept (restore.ts acceptSaved): the point first. */
        accept: (seqs?: number[], shown?: AcceptPlan['shown'], ops?: string[]) => acceptSaved(seqs, shown ?? 'now', ops),
        preview: (seqs?: number[]) => {
          const p = acceptPreview(seqs)
          return { apply: p.apply, drop: p.drop, all: p.all, shown: p.shown }
        },
        removeRange: (seq: number, index: number, range: number) => removeRange(seq, index, range),
        reviveOp: (seq: number, index: number) => reviveOp(seq, index),
        reject: () => rejectDraft(),
        setMode: (m: 'draft' | 'direct') => useAgentStore.getState().setMode(m),
        restorePoints: () => restorePoints().map((p) => ({ name: p.name, at: p.at, session: p.session, kind: p.kind, key: p.key, bytes: p.json?.length ?? 0 })),
        restore: async (name?: string) => {
          const p = await restoreTo(name)
          notify({ text: t('agent.restored') })
          return { name: p.name, same: matchesPoint(p) }
        },
        releaseIdleNotes,
        sessions: () => [...sessions.keys()],
        /** The user's pick of the working agent (D22: the Agent tab's
         *  selector calls holder.ts chooseAgent), and how it stands. */
        choose: (client: string | null, session?: string) => chooseAgent(client, session),
        holder: () => {
          const h = useHolder.getState()
          return { holder: h.holder, chosen: h.chosen, asked: h.asked.map((a) => a.client) }
        },
        /** What the page does when agent access is turned off (G7). */
        off: () => agentAccessOff(),
        /** The live project as its file would be written (byte checks). */
        serialize: () => serializeProject(useStore.getState().project)
      }
    })
}
