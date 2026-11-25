// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The small markdown the chat's agent writes, as blocks and inline runs
// (AGENT-CHAT-PLAN.md): headings, bold and italic, inline code, lists,
// quotes, fenced code and rules. Pure, so the shapes are tested without a
// page; the renderer (markdown.tsx) only maps them to elements. Nothing is
// put on the page as HTML: every literal is a text node of React's.

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: MdInline[] }
  | { kind: 'em'; children: MdInline[] }
  | { kind: 'code'; text: string }

export type MdBlock =
  | { kind: 'p'; lines: MdInline[][] }
  | { kind: 'h'; level: 1 | 2 | 3; inline: MdInline[] }
  | { kind: 'ul'; items: MdInline[][] }
  | { kind: 'ol'; start: number; items: MdInline[][] }
  | { kind: 'quote'; lines: MdInline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'hr' }

/** One line: `**bold**`, `*italic*` / `_italic_`, `` `code` ``. */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = []
  const at = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`)/g
  let last = 0
  for (const m of text.matchAll(at)) {
    const start = m.index ?? 0
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) })
    const token = m[0]
    if (token.startsWith('**')) out.push({ kind: 'strong', children: parseInline(token.slice(2, -2)) })
    else if (token.startsWith('`')) out.push({ kind: 'code', text: token.slice(1, -1) })
    else out.push({ kind: 'em', children: parseInline(token.slice(1, -1)) })
    last = start + token.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

const LIST = /^\s*([-*+]|\d+[.)])\s+(.*)$/
const ordered = (marker: string): boolean => /\d/.test(marker)

/** The agent's words, block by block (blank lines separate paragraphs). */
export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  const paragraph: string[] = []
  const flush = (): void => {
    if (!paragraph.length) return
    blocks.push({ kind: 'p', lines: paragraph.map(parseInline) })
    paragraph.length = 0
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line)) {
      flush()
      i++
      const code: string[] = []
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++])
      i++ // the closing fence (or the end)
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      i++
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'h', level: Math.min(3, heading[1].length) as 1 | 2 | 3, inline: parseInline(heading[2]) })
      i++
      continue
    }
    if (/^(\*\*\*|---|___)\s*$/.test(line)) {
      flush()
      blocks.push({ kind: 'hr' })
      i++
      continue
    }
    if (/^>\s?/.test(line)) {
      flush()
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push({ kind: 'quote', lines: quote.map(parseInline) })
      continue
    }
    const item = LIST.exec(line)
    if (item) {
      flush()
      const isOrdered = ordered(item[1])
      const start = isOrdered ? Number.parseInt(item[1], 10) : 1
      const items: MdInline[][] = []
      while (i < lines.length) {
        const next = LIST.exec(lines[i])
        if (next) {
          if (ordered(next[1]) !== isOrdered) break
          items.push(parseInline(next[2]))
          i++
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          // A wrapped list item: one more line of the same item.
          items[items.length - 1].push({ kind: 'text', text: ' ' + lines[i].trim() })
          i++
        } else break
      }
      blocks.push(isOrdered ? { kind: 'ol', start, items } : { kind: 'ul', items })
      continue
    }
    paragraph.push(line)
    i++
  }
  flush()
  return blocks
}
