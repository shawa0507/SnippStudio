// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent tools, v2 (SnippStudio phase 4A, ANA-PLAN.md §2): the edit tool's
// operations generated from the command schemas (commands/), the way to use
// each tool written once, in its own description. Pure: the main process
// serves this list (main/agent-protocol.ts), the editor page runs the tools
// (agent/host.ts), and a test keeps initialize + tools/list under its budget
// (14 000 characters).
//
// Twelve tools in all: code_clip (phase 5e), wait (the user's sends from the
// app, GONDER-PLAN.md), media (the agent's import and replace) and new_project
// (a clean window's empty project).
import { AGENT_COMMANDS, type Command, type JsonSchema, type Schema } from '../commands'

export interface AgentTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
}

/** Tool names kept and not used. (range_context, kept since phase 5e, went:
 *  its place is the wait tool's, GONDER-PLAN.md 8.) */
export const RESERVED_TOOLS: readonly string[] = []

export const SERVER_INSTRUCTIONS =
  'A video editor on this computer; these tools read and edit the project open in it. Times are timeline seconds. ' +
  'Start with project; new_project starts an empty one (clean projects only). The app measures (analyze), you decide; send many changes in one edit. Never render or export. ' +
  'A code clip needs a project file; when there is none, one is made and you are told where. ' +
  'When your work is done, call wait for the user\'s next request, and again while nothing came. ' +
  'Subagents may add as:"<name>" (≤12 letters, digits, -) to each call.'

/** Commands an agent edits the film with: every one not marked internal,
 *  except the work-note ones (the notes tool answers notes). */
export function editCommands(): Command[] {
  return Object.values(AGENT_COMMANDS).filter((c) => !c.name.startsWith('note.'))
}

// ---- a command's parameters as one short line ------------------------------

/** Parts of schemas used by several commands get a short name, written once. */
interface Named {
  names: Map<string, string>
  defs: string[]
}

const key = (j: JsonSchema): string => JSON.stringify(j)

/** A nested object longer than this is shown as {…} (the agent rarely
 *  writes it by hand: an analyze result is applied instead). */
const NESTED_MAX = 90

/** A number's range as the signature shows it (phase 4A.8, T4): n0-4,
 *  n.25-4, n0+ (no upper bound). */
const short = (v: number): string => String(v).replace(/^(-?)0\./, '$1.')
function span(j: JsonSchema): string {
  if (j.minimum !== undefined && j.maximum !== undefined) return `${short(j.minimum)}-${short(j.maximum)}`
  if (j.minimum !== undefined && j.minimum !== 0) return `${short(j.minimum)}+`
  return ''
}
/** A unit the description names (radians, px, %, 0..1 of the frame). */
function unit(j: JsonSchema): string {
  const d = (j.description ?? '').toLowerCase()
  if (/radian/.test(d)) return 'rad'
  if (/\bpx\b|pixel/.test(d)) return 'px'
  if (/percent/.test(d)) return '%'
  if (/second/.test(d)) return '(s)'
  return ''
}

function sig(x: Schema<unknown>, named: Named, depth: number): string {
  const j = x.json
  const m = x.meta
  const name = named.names.get(key(j))
  if (name) return name
  if (m?.kind === 'time') return 't'
  if (m?.kind === 'range') return '[a,b]'
  if (m?.inner) return `${sig(m.inner, named, depth)}|null`
  if (j.enum) return j.enum.join('|')
  switch (j.type) {
    case 'number':
      return `n${span(j)}${unit(j)}`
    case 'integer':
      return `int${span(j)}`
    case 'string':
      return j.pattern ? '#rgb' : 's'
    case 'boolean':
      return 'bool'
    case 'array':
      return `[${m?.item ? sig(m.item, named, depth) : '?'}]`
    case 'object': {
      if (!m?.shape) return '{…}'
      const req = new Set(j.required ?? [])
      const out = '{' + Object.entries(m.shape).map(([k, v]) => `${k}${req.has(k) ? '' : '?'}:${sig(v, named, depth + 1)}`).join(',') + '}'
      return depth > 0 && out.length > NESTED_MAX ? '{…}' : out
    }
  }
  return '?'
}

/** Sub-schemas (objects and enums) that several commands share, long enough
 *  to be worth a name: Tr, Xf, St… */
function sharedParts(cmds: readonly Command[]): Named {
  const count = new Map<string, { x: Schema<unknown>; n: number }>()
  const visit = (x: Schema<unknown> | undefined, top: boolean): void => {
    if (!x) return
    const j = x.json
    if (!top && (j.enum || x.meta?.shape)) {
      const k = key(j)
      const c = count.get(k)
      if (c) c.n++
      else count.set(k, { x, n: 1 })
    }
    const m = x.meta
    if (m?.shape) for (const v of Object.values(m.shape)) visit(v, false)
    if (m?.item) visit(m.item, false)
    if (m?.inner) visit(m.inner, false)
    if (m?.values) visit(m.values, false)
  }
  for (const c of cmds) visit(c.params as Schema<unknown>, true)
  const named: Named = { names: new Map(), defs: [] }
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  const shared = [...count.values()].filter((c) => c.n >= 2 && key(c.x.json).length > 60).sort((a, b) => key(a.x.json).length - key(b.x.json).length)
  for (const c of shared) {
    const label = labels[named.defs.length]
    if (!label) break
    // Defined with the names given so far (a style inside a transition…);
    // a named part is always written out whole.
    named.defs.push(`${label}=${sig(c.x, named, -100)}`)
    named.names.set(key(c.x.json), label)
  }
  return named
}

/** The first sentence of a command's summary, kept short. A short aside in
 *  brackets stays (it names a unit or a direction: "(radians)", "up (-1)":
 *  phase 4A.8, T4); a long one goes. */
function brief(summary: string): string {
  const first = summary
    .replace(/\s*\(([^)]*)\)/g, (m, inner: string) => (inner.length <= 22 ? m : ''))
    .split(/(?<=[.;:])\s/)[0]
    .replace(/[.;:]$/, '')
  return first.length > 56 ? first.slice(0, 55).replace(/[\s,]+\S*$/, '') + '…' : first
}

/** Commands whose fields an agent never writes by hand: an analyze result
 *  fills them (phase 4A.8, T4: their long inner shapes make room for the
 *  units and ranges of the others). */
const FROM_RESULT: Record<string, string> = { 'automation.placeImages': 'image_plan' }
/** Commands written out by hand, in a short form (phase 4A.11, T1: an
 *  agent sends broll.place itself, words for times included). */
const BY_HAND: Record<string, string> = { 'broll.place': 'broll.place{placements:[{assetId,start:t,end:t}],look:card|full} pictures/clips on a new layer' }
/** Commands whose line in the list is written by hand (D22, A1: what an
 *  agent's move does when the op does not say — agent/edit.ts AGENT_MOVE —
 *  is not what the command's own summary says: that one is the editor's);
 *  help answers the same line. */
const LINE: Record<string, string> = {
  'clip.move': 'clip.move{clipId|clipIds:[s],start:t|by:n(s),linkAV?:bool,push?:bool} to start, or by ± s (clipIds: all at once, spacing kept). Linked picture/sound go along (linkAV false: not). Landing on other clips is refused (push true: they move later)'
}

/** Phase 5e, decision 4: the operations written out in full in the edit
 *  tool's description (the ones a rough cut, a caption pass or a code clip
 *  uses); every other one is listed by name only and its fields are read
 *  with {"op":"help","names":[…]} (no draft, no base). */
export const FULL_OPS: readonly string[] = [
  'timeline.cutRanges',
  'clip.add',
  'clip.append',
  'clip.move',
  'clip.trimHead',
  'clip.trimEnd',
  'clip.split',
  'clip.delete',
  // (D22: the one-field setters — setTransform, setOpacity, setVolume,
  // setMuted, setFades, setSpeed — are listed by name: clip.set, written out
  // whole, has every one of their fields with its unit and range. So are
  // caption.setShape and silence.apply, which no agent writes by hand.)
  'clip.set',
  'clip.setTransition',
  'text.add',
  'caption.update',
  'caption.editLine',
  'caption.delete',
  'caption.setStyle',
  'caption.setOwnStyle',
  'marker.*',
  'track.add',
  'track.delete',
  'broll.place',
  'automation.placeImages'
]

export const isFullOp = (name: string): boolean => FULL_OPS.some((f) => (f.endsWith('.*') ? name.startsWith(f.slice(0, -1)) : f === name))

/** The legend of the short signatures. */
const LEGEND = 't time (s), [a,b] range (s; both may be word addresses), n number (n0-4: 0 to 4), s text.'

/** The operations of the edit tool, one line each: name, fields, what it does
 *  (the full ones); then the others by name. */
export function editOperations(): string {
  const cmds = editCommands()
  const full = cmds.filter((c) => isFullOp(c.name))
  const named = sharedParts(full.filter((c) => !FROM_RESULT[c.name] && !BY_HAND[c.name] && !LINE[c.name]))
  const lines = full.map((c) => {
    if (BY_HAND[c.name] ?? LINE[c.name]) return BY_HAND[c.name] ?? LINE[c.name]
    if (FROM_RESULT[c.name]) return `${c.name}{…} (made by applying a ${FROM_RESULT[c.name]} result)`
    const params = sig(c.params as Schema<unknown>, named, 0)
    return `${c.name}${params === '{}' ? '' : params} ${brief(c.summary)}`
  })
  // The others by name, grouped by family: clip.{slip,keepRange}.
  const fam = new Map<string, string[]>()
  for (const c of cmds) {
    if (isFullOp(c.name)) continue
    const [f, ...rest] = c.name.split('.')
    fam.set(f, [...(fam.get(f) ?? []), rest.join('.')])
  }
  const others = [...fam].map(([f, ns]) => (ns.length === 1 ? `${f}.${ns[0]}` : `${f}.{${ns.join(',')}}`))
  return [...lines, `${named.defs.join('; ')}. ${LEGEND}`, `Also: ${others.join(', ')}; fields: {"op":"help","names":[…]} alone, no base.`].join('\n')
}

/** The answer of {"op":"help","names":[…]}: each named operation's whole
 *  signature and summary (nothing is applied, no draft is made). */
export function opsHelp(names: unknown): string {
  const list = Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string').slice(0, 60) : []
  if (!list.length) throw new Error('help: "names": a list of operation names, e.g. {"op":"help","names":["clip.slip"]}.')
  const known = new Map(editCommands().map((c) => [c.name, c]))
  const none: Named = { names: new Map(), defs: [] }
  const out = list.map((n) => {
    const c = known.get(n)
    if (!c) return `${n}: no such operation.`
    if (BY_HAND[n] ?? LINE[n]) return BY_HAND[n] ?? LINE[n]
    const params = sig(c.params as Schema<unknown>, none, -100)
    return `${n}${params === '{}' ? '' : params} ${c.summary}`
  })
  return [...out, LEGEND].join('\n')
}

// ---- the tools ---------------------------------------------------------------

const VIEW = { type: 'string', enum: ['draft', 'live'] }
/** The optional worker label (EKIP-PLAN.md): one short property in every
 *  tool, said once in the instructions (SERVER_INSTRUCTIONS); the page takes
 *  it off the call before the tool runs (agent/crew.ts takeLabel). */
const AS = { type: 'string' }
const withLabel = (t: AgentTool): AgentTool => ({ ...t, inputSchema: { ...t.inputSchema, properties: { ...(t.inputSchema.properties as Record<string, unknown>), as: AS } } })
const read = { readOnlyHint: true, openWorldHint: false }

export function agentTools(): AgentTool[] {
  return ([
    {
      name: 'project',
      title: 'Project',
      description:
        'The open project: size, length, version v, draft, selection, file (or \'not saved\'); tracks with clips (linked picture+sound one row; runs of one file summed), subtitles, markers, unplaced media (ids). save:{dir?,name?}: gives an unsaved project a file (Documents unless dir). track: clips of that track.',
      inputSchema: {
        type: 'object',
        properties: {
          track: { type: 'string', description: 'Track id or name; "media", "markers", "titles": all of them' },
          state: VIEW,
          save: { type: 'object', properties: { dir: { type: 'string' }, name: { type: 'string' } }, additionalProperties: false }
        },
        additionalProperties: false
      },
      annotations: read
    },
    {
      name: 'new_project',
      title: 'New project',
      description:
        'Starts an empty project in this window: aspect 16:9 (default), 9:16 or 1:1; name. Only when the open one has no unsaved changes and no waiting draft (otherwise nothing is changed: the user saves or discards first). Unsaved unless save:true. Call project after.',
      inputSchema: {
        type: 'object',
        properties: { aspect: { type: 'string', enum: ['16:9', '9:16', '1:1'] }, name: { type: 'string' }, save: { type: 'boolean' } },
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    {
      name: 'transcript',
      title: 'Transcript',
      description:
        'What is said (the subtitles): "<line id> [start–end] text". words:true (only for a range you must cut finely): "<line id> @start" then "i:word@t" (t: seconds after the line start), "|end" the line\'s end. A word is "<line id>#i" in edit.',
      inputSchema: {
        type: 'object',
        properties: { start: { type: 'number' }, end: { type: 'number' }, words: { type: 'boolean' }, state: VIEW },
        additionalProperties: false
      },
      annotations: read
    },
    {
      name: 'frames',
      title: 'Frames',
      description: 'The picture at 1–12 moments, as an export draws it, in ONE image (a grid with the times; at most ≈1.2 MP). width: px per frame (default 512, fewer for a grid). context:true: what is said there (s from the first), safe area, output size.',
      inputSchema: {
        type: 'object',
        properties: {
          times: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 12 },
          width: { type: 'integer', minimum: 96, maximum: 1280 },
          captions: { type: 'boolean', description: 'false: no subtitles' },
          context: { type: 'boolean' },
          state: VIEW
        },
        required: ['times'],
        additionalProperties: false
      },
      annotations: read
    },
    {
      name: 'changes',
      title: 'Changes',
      description: 'What changed since version v (of a read): cuts in that version\'s times, clips/lines/markers added, removed, moved, changed, and draft news. Cheaper than reading again.',
      inputSchema: { type: 'object', properties: { since: { type: 'string' } }, required: ['since'], additionalProperties: false },
      annotations: read
    },
    {
      name: 'analyze',
      title: 'Analyze',
      description:
        'silences; fillers (ee/um sounds; a sound with no word is uncertain: only with include); repeats (a sentence said twice, the take to drop); audio (loudness; beats:true tempo); preflight (gaps, missing media, stills, peaks); image_plan (numbered images on subtitle spans); broll_plan (pictures whose name is said); keywords. Answer: a numbered list, a result id for edit "apply"; a long run gives a job id.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['silences', 'fillers', 'repeats', 'audio', 'preflight', 'image_plan', 'broll_plan', 'keywords'] },
          start: { type: 'number' },
          end: { type: 'number' },
          min: { type: 'number', description: 'silences: shortest pause (s)' },
          sensitivity: { type: 'string', enum: ['less', 'balanced', 'more'] },
          words: { type: 'string', description: 'fillers: more words, comma list' },
          beats: { type: 'boolean' },
          grouping: { type: 'string', enum: ['cue', 'sentence'], description: 'image_plan' },
          state: VIEW
        },
        required: ['kind'],
        additionalProperties: false
      },
      annotations: read
    },
    {
      name: 'edit',
      title: 'Edit',
      description:
        'One step: ops [{"op":name,…fields}], ALL in base\'s times. A time may be a word "<line id>#i" (start; "#i>" end); a range "<line id>#i-j" or "<line id>". {"op":"apply","result":id,"except"|"only"|"include":[n…]} applies an analyze result. ' +
        'Edits gather in ONE draft the user accepts or rejects; direct:true puts them straight on the timeline as one undo step (reads show the draft). base (required): the v your seconds and word numbers come from (a read, not an edit answer). Edits follow content; an op whose content is gone or changed is dropped and said. One op that moves or retimes what is there per call. A new thing\'s "id" is a name for later ops of this call (real ids: answer New). {"op":"region.claim","range":[a,b],"tracks"?:[s]}: only your as writes there; your ops there hold when others cut elsewhere; region.release ends it. Ops:\n' +
        editOperations(),
      inputSchema: {
        type: 'object',
        properties: {
          ops: { type: 'array', items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] }, minItems: 1, maxItems: 500 },
          base: { type: 'string' },
          direct: { type: 'boolean', description: 'true: straight onto the timeline, no draft' }
        },
        // (base is required by the page for every op but help: phase 5e.)
        required: ['ops'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    {
      name: 'notes',
      title: 'Notes',
      description:
        'The user\'s work notes. Default: those waiting (open, sent back), marked "with agent". image:n one picture of note n with the drawing. update:[{id,status,reply,touched}]: ready = done (reply: one sentence; touched: ranges you changed, as they are now), agent, open = hand back. The user then approves. A note on a code clip: edit its folder\'s code; the clip reloads.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'all', 'agent', 'ready', 'approved', 'still'] },
          take: { type: 'boolean', description: 'false: only read' },
          image: { type: 'integer' },
          update: {
            type: 'array',
            maxItems: 100,
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                status: { type: 'string', enum: ['ready', 'agent', 'open'] },
                reply: { type: 'string' },
                touched: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, maxItems: 50 }
              },
              required: ['id'],
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    {
      name: 'job',
      title: 'Jobs',
      description:
        'start:"transcribe": subtitles by the app\'s speech model (language auto = the project\'s spoken language, tr, en); it REPLACES all lines (if there are some, only with replace:true). Answers a job id (+ wait: waits for it). id + wait (s) waits for any job (also a long analyze), gives its result; results kept.',
      inputSchema: {
        type: 'object',
        properties: {
          start: { type: 'string', enum: ['transcribe'] },
          language: { type: 'string', enum: ['auto', 'tr', 'en'] },
          replace: { type: 'boolean' },
          id: { type: 'string' },
          wait: { type: 'integer', minimum: 0, maximum: 60 }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    {
      // Phase 5e, decision 5: the recipe's words (may be shortened, never lengthened).
      name: 'code_clip',
      title: 'Code clip',
      description:
        'A web page drawn live as a clip. create{name,start,end,track?,direct?}: makes folder anim/<name>/ with an empty index.html, placed over the picture (direct: straight onto the timeline); answers the folder. If unsaved, a project file is made in Documents and named. Write any self-contained page there; it plays as written, no network; where the page is transparent the film shows through. check:<clip id>: draws 3 moments twice; answers errors, blank or unstable frames, its length.',
      inputSchema: {
        type: 'object',
        properties: {
          create: {
            type: 'object',
            properties: { name: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, track: { type: 'string' }, direct: { type: 'boolean' } },
            required: ['name', 'start', 'end'],
            additionalProperties: false
          },
          check: { type: 'string' }
        },
        additionalProperties: false
      }
    },
    {
      // A media file brought in or replaced by the agent: until now only the
      // native dialogs and the drag-and-drop path could add one.
      name: 'media',
      title: 'Media',
      description:
        'The bin. import:[paths]: local video/audio/image files (absolute paths) come in and answer their ids, kinds and lengths; place one with edit clip.add. replace:{asset,path}: points an asset (id or name) at another file of the same kind (a rebuilt mix, a new take) and reads it again, without closing the app.',
      inputSchema: {
        type: 'object',
        properties: {
          import: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 },
          replace: {
            type: 'object',
            properties: { asset: { type: 'string' }, path: { type: 'string' } },
            required: ['asset', 'path'],
            additionalProperties: false
          }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    {
      // GONDER-PLAN.md: the user's sends from the app (notes, a task, an
      // answer on the draft card) reach the agent's chat through this call.
      name: 'wait',
      title: 'Wait',
      description: 'Returns when the user sends you something from the app: notes (now "with agent"), a task, or their answer on your draft; each once. If nothing comes within seconds it says so: call again. plan: your steps left, current first; returns at once.',
      inputSchema: { type: 'object', properties: { seconds: { type: 'integer', minimum: 5, maximum: 240 }, plan: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 24 } } }, additionalProperties: false },
      annotations: { destructiveHint: false, openWorldHint: false }
    }
  ] as AgentTool[]).map(withLabel)
}
