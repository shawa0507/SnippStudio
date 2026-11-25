// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The edit tool (SnippStudio phase 4A.9, FAZ4A-YENIDEN.md A3): many
// operations in one call, each a command by name or an analyze result
// applied. Every op is read as content in the version the agent names
// (`base`: required), then applied where that content is now (replay.ts):
// into the session's draft (default) or straight onto the timeline as one
// undo step (the user's "apply directly" setting). An op whose content is
// gone or changed is dropped and said; the rest of the call is applied. Only
// a malformed call (an unknown command, a wrong field) is refused whole.
import { commandByName, CommandError, checkParams, mergedMove, moveGroups, type Command } from '../commands'
import { projectSession, useStore } from '../state/store'
import { projectDuration } from '../types'
import { resolveAddresses, type WordTime } from './address'
import { mayAdd, addToDraft, applyDirect, currentDraft, keptOf, type Entry, type Outcome } from './drafts'
import { enter, type NewCall, type ReplayContext } from './replay'
import { chosenItems, type AnalysisResult } from './analyze'
import { editAnswer, labelOf, madeIds, moveLines, newEntries } from './answers'
import { mergeCutRanges } from '../commands/timeline'
import { useAgentStore } from './store'
import { seams } from './seams'
import { toDraft } from './draft-words'
import { opsHelp } from './tools'
import type { Project } from '../types'
import { PRODUCT_NAME } from '../../../shared/product'
import { sayRange, taken } from './regions'
import { claimRegion, rebaseRegions, regionsFor, releaseRegion } from './region-state'

/** The most ranges one edit call may cut, over all its ops, and the most
 *  ops that are not a plain setting (phase 4A.10, safety#4: one call must
 *  not hold the editor for minutes; measured in agent-scale.test.ts). */
export const MAX_RANGES_PER_EDIT = 600
export const MAX_OPS_PER_EDIT = 200

/** What an agent's clip.move means when the op does not say (D22, A1). */
export const AGENT_MOVE: Readonly<Record<string, boolean>> = { linkAV: true, push: false }

/** The fields of a command that would name the id of the NEW record it
 *  makes: an agent never chooses that (the app makes ids; a chosen one could
 *  be a name every object has, or one a later replay cannot keep). */
export function newIdFields(cmd: Command): string[] {
  const shape = (cmd.params as { meta?: { shape?: Record<string, { meta?: { kind?: string }; json?: { description?: string } }> } }).meta?.shape ?? {}
  return Object.entries(shape).filter(([, v]) => v.meta?.kind === 'id' && (v.json?.description ?? '').startsWith('An id for the new')).map(([k]) => k)
}

export interface EditContext {
  session: string
  client: string
  /** The worker that sent the call (EKIP-PLAN.md): its entry keeps it. */
  as?: string
  results: Map<string, AnalysisResult>
  /** Before the session's first change: the restore point (restore.ts).
   *  Throws when it could not be written (then nothing is applied). */
  beforeFirstEdit: () => Promise<void>
  /** A toast for a change made straight on the timeline. */
  told: (what: string) => void
  /** What the call changed, as the user is told it (D22, the audit's A13):
   *  given the project before and after and the ranges it cut, it answers
   *  the words the toast and the timeline's mark say instead of the
   *  commands' names. Unset: the names (the label). Called for a draft's
   *  call too (the Steps list says it). */
  words?: (before: Project, after: Project, cuts: readonly [number, number][]) => string
  /** The server gave up on the call: nothing may be applied any more. */
  cancelled?: () => boolean
  /** When the server gives up on the call, and how much time it must be
   *  left at least for an edit to be applied (phase 4A.8, G5). */
  deadline?: number
  margin?: number
  /** Is that agent session still there (a reconnecting one may take over its draft)? */
  alive?: (session: string) => boolean
  /** Always into a draft, whatever the apply setting (the command box's
   *  ready commands: phase 4B.2). */
  draft?: boolean
}

/** The ops as command calls, each with the project its numbers were read
 *  in. Throws (nothing applied) on a malformed op. */
export function parseOps(ops: unknown, base: Project, ctx: Pick<EditContext, 'results'>, under?: Project, baseLive = -1): NewCall[] {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('ops must be a list of operations, e.g. [{"op":"timeline.cutRanges","ranges":[[1.2,3.4]]}]')
  let out: (NewCall & { gone?: true })[] = []
  const problems: string[] = []
  ops.forEach((raw, i) => {
    const n = i + 1
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('an op is an object: {"op": name, …fields}')
      const { op, ...fields } = raw as Record<string, unknown>
      if (typeof op !== 'string') throw new Error('"op" (the command name) is missing')
      if (op === 'apply') {
        const id = fields.result
        if (typeof id !== 'string') throw new Error('"result" (an analyze result id, like "r1") is missing')
        const r = ctx.results.get(id)
        if (!r) throw new Error(`there is no result "${id}" in this session${ctx.results.size ? ` (have ${[...ctx.results.keys()].join(', ')})` : ''}`)
        if (!r.apply) throw new Error(`${r.kind} results are facts to read; there is nothing to apply`)
        // A result is read in the version it was measured on, whatever base
        // says — and "did anyone change the film since" is asked from that
        // version too (drafts#5). A retake's range carries the take it is
        // cut for (analyses#5).
        const items = chosenItems(r, fields.except, fields.only, fields.include)
        // (Nothing chosen — every item is an uncertain one, or only / except
        // leave none: that op is dropped and says so; the rest of the call
        // is not refused for it.)
        if (!items.length) {
          out.push({ call: { name: 'timeline.cutRanges', params: { ranges: [] } }, from: id, sent: i, base, refused: 'no item is chosen (only / except / include leave nothing; uncertain items need "include")' })
          return
        }
        for (const call of r.apply(items)) {
          const ranges = call.name === 'timeline.cutRanges' ? ((call.params as { ranges?: [number, number][] }).ranges ?? []) : []
          const keeps = ranges.map(([a, b]) => items.filter((it) => it.keep && it.cut && it.cut[0] >= a - 1e-6 && it.cut[1] <= b + 1e-6).map((it) => it.keep!))
          // (K1: the records as the agent last read them — the result's
          // version when it was measured after the call's base, else the base.)
          const later = r.project && r.live !== undefined && r.live > baseLive
          out.push({ call, base: r.project ?? base, seen: later ? r.project! : base, ...(under && !later ? { under } : {}), from: id, sent: i, ...(r.live !== undefined ? { baseLive: r.live } : {}), ...(keeps.some((k) => k.length) ? { keeps } : {}) })
        }
        return
      }
      if (op.startsWith('note.')) throw new Error('notes are answered with the notes tool')
      const cmd = commandByName(op)
      // The app makes the id of what an op creates. An `id` given there is
      // only a NAME for it, for later ops of the same call (safety#1, S14).
      let alias: string | undefined
      for (const k of newIdFields(cmd)) {
        if (fields[k] === undefined) continue
        if (typeof fields[k] !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(fields[k] as string) || (fields[k] as string) in Object.prototype) throw new Error(`"${k}": a name for what the op makes (letters, digits, - and _), used by later ops of the same call; the real id is in the answer's "New:" line`)
        alias = fields[k] as string
        delete fields[k]
      }
      // An agent's move (D22, A1): the linked picture / sound goes along, and
      // a move that would shift clips it does not name is refused, unless
      // the op says otherwise. (The command's own defaults are the editor's.)
      if (op === 'clip.move') for (const [k, v] of Object.entries(AGENT_MOVE)) if (fields[k] === undefined) fields[k] = v
      const words: WordTime[] = []
      const params = resolveAddresses(cmd.params as never, fields, base, (w) => words.push(w))
      out.push({ call: { name: op, params: checkParams(cmd, params) }, base, ...(under ? { under } : {}), sent: i, ...(alias !== undefined ? { alias } : {}), ...(words.length ? { words } : {}) })
    } catch (e) {
      problems.push(`#${n}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  if (problems.length) throw new CommandError('edit', 'nothing was applied', problems)
  // Shifts of the same amount are ONE move of all their clips, from where
  // the clips were in the version read (D22, A1 / K8: sent one by one, each
  // landed on the next and only the first was applied).
  for (const g of moveGroups(out.map((c) => (c.refused ? { name: '' } : c.call)), false)) {
    out[g[0]] = { ...out[g[0]], call: { name: 'clip.move', params: mergedMove(g.map((i) => out[i].call.params as Record<string, unknown>)) }, also: g.slice(1).map((i) => out[i].sent ?? i) }
    for (const i of g.slice(1)) out[i] = { ...out[i], gone: true }
  }
  out = out.filter((c) => !c.gone)
  // One call's work is bounded.
  const ranges = out.reduce((n, c) => n + (Array.isArray((c.call.params as { ranges?: unknown[] } | undefined)?.ranges) ? (c.call.params as { ranges: unknown[] }).ranges.length : 0), 0)
  if (ranges > MAX_RANGES_PER_EDIT) throw new CommandError('edit', 'nothing was applied', [`${ranges} ranges in one call: at most ${MAX_RANGES_PER_EDIT}: send the rest in a next call with the same base (an analyze result: "only":[n…] the items left)`])
  if (out.length > MAX_OPS_PER_EDIT) throw new CommandError('edit', 'nothing was applied', [`${out.length} ops in one call: at most ${MAX_OPS_PER_EDIT}`])
  return out
}

export interface EditDone {
  text: string
  outcomes: Outcome[]
  /** The draft entry it became. */
  seq?: number
  /** The entry as it was applied (straight onto the timeline too). */
  entry?: Entry
}

/** The edit tool, with what became of each op (the answer is `text`). */
export async function runEdit(args: Record<string, unknown>, ctx: EditContext): Promise<EditDone> {
  // Project, session and time are looked at when the work starts, not when
  // the call was queued (G8).
  const session0 = projectSession()
  const kept = keptOf(ctx.client, args.base)
  parseOps(args.ops, kept.project, ctx)
  // An edit that will be refused writes no point (D9): another session's
  // draft waits.
  mayAdd(ctx.session, ctx.client, ctx.alive)
  // The point before the agent: written before the first change lands.
  // Writing it waits on the disk; a project opened meanwhile gets nothing.
  await ctx.beforeFirstEdit()
  if (projectSession() !== session0) throw new Error(`Another project was opened in ${PRODUCT_NAME} while this edit waited; nothing was applied. Call project to work on the one open now.`)
  // The page decides whether there is still time (G5): a change is applied
  // only with a margin left before the server gives up on the call.
  if (ctx.cancelled?.()) throw new Error('cancelled: the call ran past its time; nothing was applied')
  if (ctx.deadline !== undefined && ctx.deadline - Date.now() < (ctx.margin ?? 10_000)) throw new Error('Too little time was left before this call times out, so nothing was applied. Send it again.')
  // (K1: the records as the agent read them; under a draft it read, also
  // the live project the draft stood on.)
  const kept2 = keptOf(ctx.client, args.base)
  const calls = parseOps(args.ops, kept2.project, ctx, kept2.under, kept2.live)
  const build = (head: Project, seq: number, seed: number, rc: ReplayContext): ReturnType<typeof enter> => enter(head, { seq, seed, label: '', at: seams.now(), baseLive: kept.live, ...(ctx.as ? { as: ctx.as } : {}), ...(kept2.seqs ? { on: kept2.seqs } : {}) }, calls, rc)
  // The work is done; before anything of it is kept: is the call still
  // wanted (the server may have given up on it while the page worked)?
  const guard = (): void => {
    if (ctx.cancelled?.() || (ctx.deadline !== undefined && Date.now() > ctx.deadline)) throw new Error('cancelled: the call ran past its time; nothing was applied')
  }
  // Were the cuts made where the agent wrote them, or where that footage
  // is by now (an older base, a draft with earlier cuts)? The answer says.
  const moved = (outs: readonly Outcome[]): boolean =>
    outs.some((o) => {
      const sent = (calls[o.index]?.call.params as { ranges?: [number, number][] } | undefined)?.ranges
      if (!o.applied || !o.cuts || !sent) return false
      const want = mergeCutRanges(sent)
      return want.length !== o.cuts.length || want.some(([a, b], i) => Math.abs(a - o.cuts![i][0]) > 1e-3 || Math.abs(b - o.cuts![i][1]) > 1e-3)
    })
  /** The names the agent gave, with the ids the app made for them. */
  const namesOf = (outs: readonly Outcome[]): [string, string][] => outs.flatMap((o) => (o.applied && calls[o.index]?.alias ? madeIds([o.result]).slice(0, 1).map((id): [string, string] => [calls[o.index].alias!, id]) : []))
  // (direct:true: the agent's own choice for this call, whatever the user's
  // setting. A draft already waiting is the user's: it is accepted or
  // rejected first, never bypassed.)
  if (args.direct === true && currentDraft()) throw new Error('A draft is waiting for the user; a direct edit waits until it is accepted or rejected. Send it without direct to add it to the draft.')
  const mode = args.direct === true ? 'direct' : useAgentStore.getState().mode
  if (currentDraft() || mode === 'draft' || ctx.draft) {
    const head0 = currentDraft()?.project ?? useStore.getState().project
    const r = addToDraft(ctx.session, ctx.client, build, ctx.alive, guard)
    const label = labelOf(r.outcomes)
    r.entry.label = label
    const d = currentDraft()
    const kept1 = r.outcomes.some((o) => o.applied)
    if (kept1 && d) ctx.words?.(head0, d.project, cutsOf(r.outcomes))
    return {
      // (Calls that wait: those of which something is applied.)
      text: editAnswer({ draft: true, created: r.created, label, pending: d ? d.entries.filter((e) => d.outcomes.some((o) => o.seq === e.seq && o.applied)).length : 0, length: projectDuration((d ?? { project: useStore.getState().project }).project), before: projectDuration(head0), changes: d ? moveLines(head0, d.project) : [], outcomes: r.outcomes, moved: moved(r.outcomes), names: namesOf(r.outcomes), made: newEntries(r.outcomes, namesOf(r.outcomes), d?.project ?? head0, head0, kept2.project) }),
      outcomes: r.outcomes,
      ...(kept1 ? { seq: r.entry.seq, entry: r.entry } : {})
    }
  }
  const live0 = useStore.getState().project
  const before = projectDuration(live0)
  const r = applyDirect(ctx.session, ctx.client, build, guard)
  const label = labelOf(r.outcomes)
  if (r.applied) {
    // (D22, A13: in the user's words, not "clip.move".)
    const said = ctx.words?.(live0, useStore.getState().project, cutsOf(r.outcomes)) ?? label
    ctx.told(said)
    // (What the bar's "Undo" takes back, while the project still stands here.)
    useAgentStore.getState().setLastDirect({ version: useStore.getState().projectVersion, at: Date.now() })
    // (DENEME-2, item 6: what the agent just did glows on the timeline.)
    flashDirect(live0, useStore.getState().project, r.outcomes, said)
  }
  return { text: editAnswer({ draft: false, label, before, length: projectDuration(useStore.getState().project), changes: moveLines(live0, useStore.getState().project), outcomes: r.outcomes, moved: moved(r.outcomes), names: namesOf(r.outcomes), made: newEntries(r.outcomes, namesOf(r.outcomes), useStore.getState().project, live0, kept2.project) }), outcomes: r.outcomes, ...(r.entry ? { entry: r.entry } : {}) }
}

/** The ranges a call's applied ops cut, merged. */
const cutsOf = (outcomes: readonly Outcome[]): [number, number][] => mergeCutRanges(outcomes.flatMap((o) => (o.applied && o.cuts ? o.cuts : [])))

/** {"op":"help","names":[…]} (phase 5e, decision 4): the fields of the
 *  operations listed by name only. It goes alone in a call: no draft, no
 *  base, nothing applied. null: not a help call. */
export function helpCall(ops: unknown): string | null {
  if (!Array.isArray(ops) || !ops.some((o) => (o as { op?: unknown } | null)?.op === 'help')) return null
  if (ops.length !== 1) throw new Error('{"op":"help","names":[…]} goes alone in an edit call; nothing was applied.')
  return opsHelp((ops[0] as { names?: unknown }).names)
}

export async function editTool(args: Record<string, unknown>, ctx: EditContext): Promise<string> {
  const help = helpCall(args.ops)
  if (help !== null) return help
  // (The schema no longer requires base, for help; every other call does:
  // keptOf says "base is required: …" with the v to send, nothing applied.)
  const rg = regionOps(args.ops)
  if (!rg) {
    if (!regionsFor(ctx.client).length) return (await runEdit(args, ctx)).text
    try {
      return (await runEdit(args, ctx)).text
    } finally {
      rebaseRegions(ctx.client, currentDraft()?.project ?? useStore.getState().project)
    }
  }
  // (The team mode, step 3: the worker's region first, then its ops.)
  const said = takeRegions(rg, args, ctx)
  if (!rg.rest.length) return said
  try {
    return `${said}\n${(await runEdit({ ...args, ops: rg.rest }, ctx)).text}`
  } catch (e) {
    throw new Error(`${said}\n${e instanceof Error ? e.message : String(e)}`)
  } finally {
    rebaseRegions(ctx.client, currentDraft()?.project ?? useStore.getState().project)
  }
}

// ---- a worker's region (EKIP-3-PLAN.md §2) -----------------------------------

interface RegionOps {
  claims: Record<string, unknown>[]
  release: boolean
  rest: unknown[]
}

/** The call's region ops apart from the others; null when it has none (the
 *  call then runs exactly as before). */
export function regionOps(ops: unknown): RegionOps | null {
  const is = (o: unknown, name: string): boolean => (o as { op?: unknown } | null)?.op === name
  if (!Array.isArray(ops) || !ops.some((o) => is(o, 'region.claim') || is(o, 'region.release'))) return null
  return { claims: ops.filter((o) => is(o, 'region.claim')) as Record<string, unknown>[], release: ops.some((o) => is(o, 'region.release')), rest: ops.filter((o) => !is(o, 'region.claim') && !is(o, 'region.release')) }
}

/** Takes or gives back the calling worker's region; the answer's line.
 *  Throws (nothing taken, nothing applied) when the stretch is another
 *  worker's, or the op is malformed. */
export function takeRegions(rg: RegionOps, args: Record<string, unknown>, ctx: Pick<EditContext, 'as' | 'client' | 'session'>): string {
  const as = ctx.as
  if (!as) throw new Error('region.claim / region.release: a region belongs to a worker: send the call with as:"<name>"; nothing was applied.')
  if (rg.claims.length > 1 || (rg.claims.length && rg.release)) throw new Error('One region per worker: send one region.claim (it replaces your earlier one) or region.release; nothing was applied.')
  if (rg.release) return releaseRegion(ctx.client, as) ? `Region released ("${as}").` : `"${as}" had no region.`
  const base = keptOf(ctx.client, args.base).project
  const c = rg.claims[0]
  const r = c.range
  if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'number' || typeof r[1] !== 'number' || !(r[0] >= 0) || !(r[1] > r[0])) throw new Error('region.claim: "range": [start, end] in seconds of base; nothing was applied.')
  let tracks: string[] | undefined
  if (c.tracks !== undefined) {
    if (!Array.isArray(c.tracks) || !c.tracks.length || c.tracks.some((t) => typeof t !== 'string')) throw new Error('region.claim: "tracks": a list of track ids or names; nothing was applied.')
    tracks = (c.tracks as string[]).map((t) => {
      const hit = base.tracks.find((x) => x.id === t) ?? base.tracks.find((x) => x.name === t)
      if (!hit) throw new Error(`region.claim: there is no track "${t.slice(0, 40)}"; nothing was applied.`)
      return hit.id
    })
  }
  const range: [number, number] = [r[0], r[1]]
  const hit = taken(regionsFor(ctx.client), as, base, range, tracks)
  if (hit) throw new Error(`region.claim: ${sayRange(range)} is taken: worker "${hit.by.as}" has ${sayRange(hit.at)}${hit.by.tracks ? ` on tracks ${hit.by.tracks.join(', ')}` : ''}; nothing was applied. Take a stretch outside it.`)
  claimRegion(ctx.client, ctx.session, as, base, range, tracks)
  return `Region ${sayRange(range)}${tracks ? ` on tracks ${tracks.join(', ')}` : ''} is "${as}"'s: only its ops change what is inside, and they hold while other workers cut or add elsewhere.`
}

/** Marks a direct change on the timeline for a moment: the clips it moved,
 *  added or changed, and where its cuts closed (live seconds after it). */
export function flashDirect(before: Project, after: Project, outcomes: readonly Outcome[], label: string): void {
  const cuts = cutsOf(outcomes)
  const clips: string[] = []
  for (const c of Object.values(after.clips)) {
    const b = before.clips[c.id]
    // (A clip only carried along by a cut is not what the agent changed.)
    if (b && Math.abs(toDraft(b.start, cuts) - c.start) < 1e-3 && JSON.stringify({ ...b, start: 0 }) === JSON.stringify({ ...c, start: 0 })) continue
    clips.push(c.id)
  }
  const ranges = cuts.map(([a]): [number, number] => {
    const at = toDraft(a, cuts)
    return [at, at]
  })
  if (!clips.length && !ranges.length) return
  useAgentStore.getState().setFlash({ at: Date.now(), clips: clips.slice(0, 200), ranges: ranges.slice(0, 200), label, lengths: { before: projectDuration(before), after: projectDuration(after) } })
}
