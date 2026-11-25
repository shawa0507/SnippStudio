// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A: the agent tools v2 — twelve tools, the edit tool's
// operations generated from the commands, and the size an agent pays for them
// on every turn (initialize + tools/list at most 14 000 characters).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_COMMANDS } from '../renderer/src/commands'
import { agentTools, editCommands, editOperations, isFullOp, opsHelp, RESERVED_TOOLS, SERVER_INSTRUCTIONS } from '../renderer/src/agent/tools'
import { helpCall } from '../renderer/src/agent/edit'
import { AGENT_ID, PRODUCT_NAME } from '../shared/product'

/** What initialize and tools/list put on the wire (main/agent-protocol.ts). */
export function definitionsSize(): number {
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } }, serverInfo: { name: AGENT_ID, title: PRODUCT_NAME, version: '0.0.0' }, instructions: SERVER_INSTRUCTIONS } })
  const list = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: agentTools() } })
  return init.length + list.length
}

test('twelve tools (phase 5e: code_clip; GONDER-PLAN.md: wait; media: import and replace; new_project), the old seven gone', () => {
  const names = agentTools().map((t) => t.name)
  assert.deepEqual(names, ['project', 'new_project', 'transcript', 'frames', 'changes', 'analyze', 'edit', 'notes', 'job', 'code_clip', 'media', 'wait'])
  assert.ok(names.length + RESERVED_TOOLS.length <= 12)
  for (const old of ['project_summary', 'frame', 'cut_ranges', 'note_image', 'note_update']) assert.ok(!names.includes(old), old)
  for (const t of agentTools()) assert.equal((t.inputSchema as { type: string }).type, 'object', t.name)
})

test('the edit tool lists every command an agent may call, and no internal one', () => {
  const ops = editOperations()
  const listed = new Set(ops.split('\n').map((l) => /^([\w.]+)/.exec(l)?.[1]))
  // (Phase 5e: the others by name in the last line, by family: clip.{slip,keepRange}.)
  const also = ops.split('\n').pop()!.replace(/^Also: /, '').split(';')[0]
  for (const m of also.matchAll(/(\w+)\.(?:\{([^}]*)\}|(\w+))/g)) for (const n of m[2] ? m[2].split(',') : [m[3]]) listed.add(`${m[1]}.${n}`)
  for (const c of editCommands()) assert.ok(listed.has(c.name), c.name)
  for (const c of Object.values(AGENT_COMMANDS)) if (c.name.startsWith('note.')) assert.ok(!listed.has(c.name), c.name)
  assert.ok(!listed.has('clip.place'), 'internal')
  assert.match(ops, /^timeline\.cutRanges\{ranges:\[\[a,b\]\]\} Cut time ranges out of the whole timeline/m)
})

test('T4: the operation list keeps units, ranges and directions; the tool descriptions say what 4A.8 decided', () => {
  const ops = editOperations()
  // (D22: the one-field setters are listed by name; clip.set, written out
  // whole, keeps every one of their fields with its unit and range.)
  assert.match(ops, /^clip\.set\{clipId:s,transform\?:\{x\?:npx,y\?:npx,scale\?:n,rotation\?:nrad\},opacity\?:n0-1,volume\?:n0-4,muted\?:bool,speed\?:n\.1-100,fadeIn\?:n\(s\),fadeOut\?:n\(s\),transitionOut\?:[A-H]\|null,linkAV\?:bool\}/m)
  assert.match(opsHelp(['clip.setVolume', 'clip.setSpeed', 'clip.setOpacity']), /^clip\.setVolume\{clipId:s,volume:n0-4\}[^]*^clip\.setSpeed\{clipId:s,speed:n\.1-100[^]*^clip\.setOpacity\{clipId:s,opacity:n0-1\}/m)
  // (track.move is listed by name since phase 5e: its fields come with help.)
  assert.match(opsHelp(['track.move']), /^track\.move\{trackId:s,dir:-1\|1\} Move a track one place up \(-1\) or down \(1\)/m)
  assert.match(ops, /^clip\.trimEnd\{clipId:s,delta:n\(s\)\}/m)
  assert.match(ops, /^clip\.trimHead\{clipId:s,edge:t\}/m, 'T5: a time, carried and addressable')
  assert.match(ops, /^automation\.placeImages\{…\} \(made by applying a image_plan result\)$/m)
  const desc = (name: string): string => agentTools().find((t) => t.name === name)!.description
  // Phase 4A.9 (A6): base is required and is the v of a READ; edits follow content.
  assert.match(desc('edit'), /ALL in base's times/)
  assert.match(desc('edit'), /base \(required\): the v your seconds and word numbers come from \(a read, not an edit answer\)\. Edits follow content; an op whose content is gone or changed is dropped and said\./)
  // (Phase 5e, decision 4: the page requires base for every op but help.)
  assert.deepEqual((agentTools().find((t) => t.name === 'edit')!.inputSchema as { required: string[] }).required, ['ops'])
  assert.doesNotMatch(desc('edit'), /captions\.cutRange/)
  assert.match(desc('transcript'), /"\|end" the line's end/)
  assert.match(desc('job'), /REPLACES all lines \(if there are some, only with replace:true\)/)
  assert.match(desc('frames'), /1\.2 MP/)
})

test('phase 5e, decision 4: the full ops written out, the others by name, their fields from help (no base, alone)', () => {
  const ops = editOperations()
  const lines = ops.split('\n')
  for (const c of editCommands()) {
    const full = lines.some((l) => l.startsWith(c.name + '{') || l.startsWith(c.name + ' ') || l === c.name)
    assert.equal(full, isFullOp(c.name), c.name)
  }
  assert.match(lines[lines.length - 1], /clip\.\{moveToTrack,slip,keepRange,addMedia,duplicate,setTransform,setOpacity,setVolume,setMuted,setSpeed,setFades\}/)
  for (const n of ['timeline.cutRanges', 'clip.add', 'clip.move', 'clip.set', 'clip.setTransition', 'caption.setStyle', 'marker.update', 'track.delete', 'broll.place', 'text.add']) assert.ok(isFullOp(n), n)
  for (const n of ['clip.slip', 'motion.gentlePan', 'fx.stillImage', 'template.place', 'track.move', 'transitions.clear', 'clip.setMuted', 'clip.setVolume', 'caption.setShape', 'silence.apply']) assert.ok(!isFullOp(n), n)
  const also = lines[lines.length - 1]
  assert.match(also, /^Also: .*clip\.\{[^}]*slip[^}]*\}.*; fields: \{"op":"help","names":\[…\]\} alone, no base\.$/)
  // help: every name answers its whole signature; an unknown one says so.
  const h = opsHelp(['motion.gentlePan', 'fx.stillImage', 'nope.x'])
  assert.match(h, /^motion\.gentlePan\{direction:left-to-right\|/m)
  assert.match(h, /^fx\.stillImage\{/m)
  assert.match(h, /^nope\.x: no such operation\.$/m)
  assert.throws(() => opsHelp([]), /names/)
  assert.equal(helpCall([{ op: 'clip.split' }]), null)
  assert.match(helpCall([{ op: 'help', names: ['clip.slip'] }])!, /^clip\.slip\{clipId:s,delta:n\(s\)/)
  assert.throws(() => helpCall([{ op: 'help', names: ['clip.slip'] }, { op: 'clip.split' }]), /alone/)
})

// (Phase 5e held it at 11 400; media took it to 12 961. new_project adds
// the agent's way to start clean: the limit is 14 000.)
test('budget: initialize + tools/list (at most 14 000 characters)', () => {
  const size = definitionsSize()
  console.log(`  definitions: ${size} chars (edit tool ${JSON.stringify(agentTools().find((t) => t.name === 'edit')).length})`)
  assert.ok(size <= 14_000, `${size} characters`)
})
