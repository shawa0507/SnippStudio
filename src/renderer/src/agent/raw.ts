// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Compared with raw" (TOKEN-PLAN.md, YOL-HARITASI.md 1.3): how big an
// answer would have been had the app sent the thing itself instead of its
// short form — the project as JSON instead of its summary, the subtitle
// lines as JSON instead of one line each, every frame at the project's full
// size instead of a small contact sheet. Measured on the page after the
// answer has gone, from what the answer was made of: NOTHING of it goes to
// the agent (the answer is the same bytes). Pure.
//
// An answer with no larger form behind it (an edit's report, a wait, a job,
// the changes list, an error…) counts as its own raw size ('same'): that
// never makes the saving look bigger than it is. A kind that cannot be
// measured is null, and then no ratio is shown at all.
import type { Caption, Project } from '../types'
import { isSubtitle } from '../types'
import { tokensOf, type AnswerSize } from './tokens'

/** What an answer would have weighed raw: a size, its own size, or unknown. */
export type RawAnswer = AnswerSize | 'same' | null

/** The tools whose answers are not a short form of anything bigger. */
export const SAME_AS_RAW: ReadonlySet<string> = new Set(['edit', 'code_clip', 'media', 'new_project', 'job', 'wait', 'changes', 'notes'])

/** Raw tokens of an answer, or null when unknown. */
export function rawTokens(raw: RawAnswer, sent: AnswerSize): number | null {
  if (raw === null) return null
  return raw === 'same' ? tokensOf(sent) : tokensOf(raw)
}

/** The project tool: the project as JSON (its whole file, without the
 *  file's own wrapper). One part of it (a track, the media…) counts as its
 *  own size. */
export function rawProject(project: Project, part: string | undefined): RawAnswer {
  if (part !== undefined) return 'same'
  return { chars: JSON.stringify(project).length, images: [] }
}

/** The transcript tool: the subtitle lines the answer holds, as JSON (with
 *  their word times when the words were asked for). `answer`: the text sent
 *  (a line is in it when its id is). */
export function rawTranscript(project: Project, answer: string, words: boolean): RawAnswer {
  const shown: Caption[] = []
  for (const c of project.captions) {
    if (!isSubtitle(c) || !answer.includes(c.id)) continue
    if (words) shown.push(c)
    else {
      const { words: _w, ...line } = c
      void _w
      shown.push(line)
    }
  }
  if (!shown.length) return 'same'
  return { chars: Math.max(answer.length, JSON.stringify(shown).length), images: [] }
}

/** Frames (and a note's picture): its words as sent, and each frame it
 *  shows as a picture of its own at the project's full size. */
export function rawFrames(sent: AnswerSize, count: number, project: Project): RawAnswer {
  const { width, height } = project.settings ?? { width: 0, height: 0 }
  if (!(width > 0 && height > 0) || count < 1) return null
  return { chars: sent.chars, images: Array.from({ length: count }, () => ({ width, height })) }
}

/** An analysis: its findings as JSON (no less than what was sent). */
export function rawAnalysis(head: string, items: readonly unknown[], answer: string): RawAnswer {
  let json: string
  try {
    json = JSON.stringify(items, (_k, v: unknown) => (typeof v === 'function' ? undefined : v))
  } catch {
    return null
  }
  return { chars: Math.max(answer.length, head.length + json.length), images: [] }
}
