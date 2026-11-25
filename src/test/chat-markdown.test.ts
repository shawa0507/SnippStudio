// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The chat's small markdown (components/agent/markdown.ts): inline runs and
// the blocks the agent writes, without a page.
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInline, parseMarkdown } from '../renderer/src/components/agent/markdown'

test('inline: bold, italic, inline code; the rest is text', () => {
  assert.deepEqual(parseInline('a **b** c *d* `e`'), [
    { kind: 'text', text: 'a ' },
    { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
    { kind: 'text', text: ' c ' },
    { kind: 'em', children: [{ kind: 'text', text: 'd' }] },
    { kind: 'text', text: ' ' },
    { kind: 'code', text: 'e' }
  ])
  assert.deepEqual(parseInline('plain *stars* and _slants_'), [
    { kind: 'text', text: 'plain ' },
    { kind: 'em', children: [{ kind: 'text', text: 'stars' }] },
    { kind: 'text', text: ' and ' },
    { kind: 'em', children: [{ kind: 'text', text: 'slants' }] }
  ])
  assert.deepEqual(parseInline('2 * 3 = 6'), [{ kind: 'text', text: '2 * 3 = 6' }])
})

test('blocks: heading, paragraph, quote, unordered and ordered lists, code, rule', () => {
  const doc = [
    '## The plan',
    'Do **this** first.',
    '> quoted **line**',
    '- one',
    '- two',
    '3. three',
    '4. four',
    '```js',
    'const x = 1',
    '```',
    '---'
  ].join('\n')
  assert.deepEqual(parseMarkdown(doc), [
    { kind: 'h', level: 2, inline: [{ kind: 'text', text: 'The plan' }] },
    { kind: 'p', lines: [[{ kind: 'text', text: 'Do ' }, { kind: 'strong', children: [{ kind: 'text', text: 'this' }] }, { kind: 'text', text: ' first.' }]] },
    { kind: 'quote', lines: [[{ kind: 'text', text: 'quoted ' }, { kind: 'strong', children: [{ kind: 'text', text: 'line' }] }]] },
    { kind: 'ul', items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] },
    { kind: 'ol', start: 3, items: [[{ kind: 'text', text: 'three' }], [{ kind: 'text', text: 'four' }]] },
    { kind: 'code', text: 'const x = 1' },
    { kind: 'hr' }
  ])
})

test('a blank line starts a new paragraph; a wrapped list item stays one item', () => {
  const doc = ['first line', 'same paragraph', '', 'second paragraph', '- item', '  continues here'].join('\n')
  assert.deepEqual(parseMarkdown(doc), [
    { kind: 'p', lines: [[{ kind: 'text', text: 'first line' }], [{ kind: 'text', text: 'same paragraph' }]] },
    { kind: 'p', lines: [[{ kind: 'text', text: 'second paragraph' }]] },
    { kind: 'ul', items: [[{ kind: 'text', text: 'item' }, { kind: 'text', text: ' continues here' }]] }
  ])
})
