// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The chat's assistant words, drawn as elements (markdown.ts parses them).
import { Fragment } from 'react'
import { parseMarkdown, type MdBlock, type MdInline } from './markdown'

function Inline({ parts }: { parts: MdInline[] }): JSX.Element {
  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'text') return <Fragment key={i}>{part.text}</Fragment>
        if (part.kind === 'code') return <code key={i} className="chat-md-code">{part.text}</code>
        if (part.kind === 'strong') return <strong key={i}><Inline parts={part.children} /></strong>
        return <em key={i}><Inline parts={part.children} /></em>
      })}
    </>
  )
}

function Lines({ lines }: { lines: MdInline[][] }): JSX.Element {
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <Inline parts={line} />
        </Fragment>
      ))}
    </>
  )
}

function Block({ block }: { block: MdBlock }): JSX.Element {
  switch (block.kind) {
    case 'p':
      return <p><Lines lines={block.lines} /></p>
    case 'h':
      return <div className={`chat-md-h chat-md-h${block.level}`}><Inline parts={block.inline} /></div>
    case 'ul':
      return <ul>{block.items.map((item, i) => <li key={i}><Inline parts={item} /></li>)}</ul>
    case 'ol':
      return <ol start={block.start}>{block.items.map((item, i) => <li key={i}><Inline parts={item} /></li>)}</ol>
    case 'quote':
      return <blockquote><Lines lines={block.lines} /></blockquote>
    case 'code':
      return <pre className="chat-code">{block.text}</pre>
    case 'hr':
      return <hr />
  }
}

/** The agent's reply, as markdown reads in a chat (no raw HTML). */
export function Markdown({ text }: { text: string }): JSX.Element {
  return (
    <div className="chat-md">
      {parseMarkdown(text).map((block, i) => <Block key={i} block={block} />)}
    </div>
  )
}
