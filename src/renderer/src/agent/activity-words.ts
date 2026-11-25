// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The sentence of what the agent is doing, made from its last tool call
// (D22, worker C; YOL-HARITASI.md 1.1): "Reading the transcript 0:12–0:45",
// "Looking at 3 frames", "Looking for silences", "Writing to the draft · 4
// operations". Never asked of the agent: a key of ui/strings and its
// parameters, one for every tool and every kind (a unit test holds the list
// to the tools the app serves: src/test/d22-c-activity.test.ts). Pure; the
// page says it with t(). An edit that is done says what it changed in the
// user's words (ToolEvent.said: agent/said.ts), not again here.
import type { Words } from './draft-words'
import { mmss } from './draft-words'
import type { ToolEvent } from './store'
import { form } from './count'

/** The kinds of analysis that have a sentence of their own. */
export const ANALYSIS_WORDS: Readonly<Record<string, string>> = {
  silences: 'd22c.act.analyze.silences',
  fillers: 'd22c.act.analyze.fillers',
  repeats: 'd22c.act.analyze.repeats',
  audio: 'd22c.act.analyze.audio',
  preflight: 'd22c.act.analyze.preflight',
  image_plan: 'd22c.act.analyze.imagePlan',
  broll_plan: 'd22c.act.analyze.brollPlan',
  keywords: 'd22c.act.analyze.keywords'
}

/** The tools that have a sentence (every tool the app serves). */
export const TOOL_WORDS: readonly string[] = ['project', 'new_project', 'transcript', 'frames', 'changes', 'analyze', 'edit', 'code_clip', 'media', 'notes', 'job', 'wait']

/**
 * What a call is doing (while it runs) or did (the bar keeps saying it in
 * the present until the next call). `draft`: its edits go into a draft
 * (not straight onto the timeline).
 */
export function activityWords(e: ToolEvent, draft: boolean): Words {
  if (e.error) return { key: 'd22c.act.failed', params: {} }
  switch (e.tool) {
    case 'project':
      return { key: 'd22c.act.project', params: {} }
    case 'new_project':
      return { key: 'd22c.act.newProject', params: {} }
    case 'transcript':
      return { key: e.kind === 'words' ? 'd22c.act.transcript.words' : 'd22c.act.transcript', params: {} }
    case 'frames': {
      const n = e.at?.length ?? 0
      return { key: `d22c.act.frames.${form(n)}`, params: { n } }
    }
    case 'changes':
      return { key: 'd22c.act.changes', params: {} }
    case 'analyze':
      if (e.done && e.found) return { key: `d22c.act.found.${form(e.found.length)}`, params: { n: e.found.length } }
      return { key: ANALYSIS_WORDS[e.kind ?? ''] ?? 'd22c.act.analyze', params: {} }
    case 'edit':
      if (e.done && e.nothing) return { key: 'd22a.step.nothing', params: {} }
      if (e.done && e.said) return { key: draft ? 'd22c.act.wrote.draft' : 'd22c.act.wrote.direct', params: { said: e.said } }
      return { key: draft ? `d22c.act.draft.${form(e.ops ?? 0)}` : `d22c.act.direct.${form(e.ops ?? 0)}`, params: { n: e.ops ?? 0 } }
    case 'code_clip':
      return { key: e.kind === 'check' ? 'd22c.act.codeCheck' : 'd22c.act.codeClip', params: {} }
    case 'media':
      return { key: e.kind === 'replace' ? 'd22c.act.mediaReplace' : 'd22c.act.mediaImport', params: {} }
    case 'notes':
      return { key: 'd22c.act.notes', params: {} }
    case 'job':
      return e.kind === 'wait' ? { key: 'd22c.act.jobWait', params: {} } : e.kind === 'transcribe' ? { key: 'd22c.act.transcribe', params: {} } : { key: 'd22c.act.job', params: { kind: e.kind ?? '' } }
    case 'wait':
      return { key: 'agent.tool.wait', params: {} }
    default:
      return { key: 'd22c.act.other', params: { tool: e.tool } }
  }
}

/** Where a call works, as the bar writes it after its sentence: "0:12–0:45"
 *  (a range read), "0:17" (the first frame looked at); '' when it has none. */
export function activityPlace(e: ToolEvent): string {
  if (e.error) return ''
  if (e.tool === 'frames' && e.at?.length) return mmss(Math.min(...e.at))
  if (e.range && (e.tool === 'transcript' || e.tool === 'analyze')) return `${mmss(e.range[0])}–${mmss(e.range[1])}`
  return ''
}
