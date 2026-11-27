// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The chat's saved sessions and the CLI transcript cut (main/chat-sessions.ts):
// a chat is named by its first words, listed per project, deleted with its CLI
// transcript, and a rewind finds the message's own line by its words and time.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { chatsDir, cleanDraft, cliSessionFile, cutSessionFile, findRewindCut, isSessionKey, listSessions, readSession, removeSession, saveSession, userLineOf } from '../main/chat-sessions'

const KEY = 'c035601c-80b4-486a-a677-6447753145dc'
const OTHER = '41f65d80-55e9-4e97-a646-c55027874f8f'
const CLI = '35c6d2ab-5b59-4e4d-b2f4-df399cc859ec'
const PROJECT = 'C:\\Users\\thero\\Documents\\ATOMIC DEMAND.snipp'

const tempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'snipp-chat-'))
const line = (type: string, content: unknown, timestamp: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type, timestamp, message: { content }, ...extra })

test('a draft is kept to a session key, a short title and the CLI session', () => {
  const record = cleanDraft({ key: KEY, title: '  Tighten the   intro \n please ', sessionId: CLI, items: [{ kind: 'text' }] }, PROJECT)
  assert.deepEqual(record && { ...record, updatedAt: 0 }, { key: KEY, title: 'Tighten the intro please', project: PROJECT, sessionId: CLI, updatedAt: 0, items: [{ kind: 'text' }] })
  assert.equal(cleanDraft({ key: 'not-a-key', items: [] }, PROJECT), null)
  assert.equal(cleanDraft({ key: KEY, items: 'no' }, PROJECT), null)
  assert.equal(cleanDraft({ key: KEY, items: [1, 2], sessionId: 'nope' }, PROJECT)?.sessionId, '')
  assert.equal(isSessionKey(KEY), true)
  assert.equal(isSessionKey('../../etc/passwd'), false)
})

test('saved chats: one small file each, this project only, newest first', async () => {
  const dir = tempDir()
  try {
    await saveSession(dir, { key: KEY, title: 'First', project: PROJECT, sessionId: CLI, updatedAt: 1000, items: [{ kind: 'text', text: 'one' }] })
    await saveSession(dir, { key: OTHER, title: 'Elsewhere', project: 'C:\\other.snipp', sessionId: '', updatedAt: 3000, items: [] })
    const mine = listSessions(dir, PROJECT)
    assert.deepEqual(mine.map((s) => s.title), ['First'])
    assert.equal(mine[0].sessionId, CLI)
    assert.ok(fs.existsSync(path.join(chatsDir(dir), `${KEY}.json`)), 'the profile keeps one file per chat')
    // (Another project's chat is not this window's to read or delete.)
    assert.equal(readSession(dir, OTHER, PROJECT), null)
    assert.equal(await removeSession(dir, OTHER, PROJECT), null)
    assert.equal(readSession(dir, KEY, PROJECT)?.items.length, 1)
    assert.equal((await removeSession(dir, KEY, PROJECT))?.sessionId, CLI)
    assert.equal(readSession(dir, KEY, PROJECT), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a message line: the chat words, never a tool result or a subagent answer', () => {
  const at = '2026-11-25T20:00:01.000Z'
  assert.deepEqual(userLineOf(line('user', [{ type: 'text', text: 'hello' }], at)), { at: Date.parse(at), text: 'hello' })
  assert.deepEqual(userLineOf(line('user', 'plain words', at)), { at: Date.parse(at), text: 'plain words' })
  assert.equal(userLineOf(line('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }], at)), null)
  assert.equal(userLineOf(line('user', [{ type: 'text', text: 'sub' }], at, { isSidechain: true })), null)
  assert.equal(userLineOf(line('assistant', [{ type: 'text', text: 'answer' }], at)), null)
  assert.equal(userLineOf('not json'), null)
})

test('the cut: the message is found by its words and its time, repeats told apart', () => {
  const lines = [
    line('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }], '2026-11-25T20:00:00.500Z'),
    line('user', [{ type: 'text', text: 'hello' }], '2026-11-25T20:00:01.000Z'),
    line('assistant', [{ type: 'text', text: 'hi' }], '2026-11-25T20:00:02.000Z'),
    line('user', [{ type: 'text', text: 'again' }], '2026-11-25T20:00:03.000Z'),
    line('assistant', [{ type: 'text', text: 'twice' }], '2026-11-25T20:00:04.000Z'),
    line('user', [{ type: 'text', text: 'again' }], '2026-11-25T20:00:20.000Z'),
    ''
  ]
  assert.equal(findRewindCut(lines, { at: Date.parse('2026-11-25T20:00:03.400Z'), text: 'again' }), 3)
  assert.equal(findRewindCut(lines, { at: Date.parse('2026-11-25T20:00:21.000Z'), text: 'again' }), 5)
  assert.equal(findRewindCut(lines, { at: Date.parse('2026-11-25T20:00:01.200Z'), text: 'hello' }), 1)
  assert.equal(findRewindCut(lines, { at: Date.parse('2026-11-25T20:00:01.200Z'), text: 'somewhere else' }), -1)
  // (A picture-only message: its words are empty, its time is the mark.)
  assert.equal(findRewindCut([line('user', [{ type: 'image' }], '2026-11-25T20:00:09.000Z'), ''], { at: Date.parse('2026-11-25T20:00:09.500Z'), text: '' }), 0)
})

test('cutting the CLI transcript keeps the lines before, copies the file, and says when nothing is left', async () => {
  const dir = tempDir()
  const file = path.join(dir, `${CLI}.jsonl`)
  const original = [
    line('user', [{ type: 'text', text: 'keep me' }], '2026-11-25T20:00:01.000Z'),
    line('assistant', [{ type: 'text', text: 'kept answer' }], '2026-11-25T20:00:02.000Z'),
    line('user', [{ type: 'text', text: 'take me out' }], '2026-11-25T20:00:03.000Z'),
    line('assistant', [{ type: 'text', text: 'gone' }], '2026-11-25T20:00:04.000Z'),
    ''
  ].join('\n')
  try {
    fs.writeFileSync(file, original)
    const kept = await cutSessionFile(file, 2)
    assert.deepEqual(kept, { ok: true, empty: false })
    assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 2)
    assert.equal(fs.readFileSync(`${file}.snipp-bak`, 'utf8'), original)
    assert.match(fs.readFileSync(file, 'utf8'), /keep me/)
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /take me out/)
    // (Back to the very first message: nothing is left to continue.)
    fs.writeFileSync(file, original)
    assert.deepEqual(await cutSessionFile(file, 0), { ok: true, empty: true })
    assert.equal(fs.readFileSync(file, 'utf8'), '')
    assert.deepEqual(await cutSessionFile(file, 99), { ok: false, empty: false, error: 'out-of-range' })
    assert.deepEqual(await cutSessionFile(path.join(dir, 'missing.jsonl'), 0), { ok: false, empty: false, error: 'missing' })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the CLI keeps its transcripts per folder and per session id', () => {
  const file = cliSessionFile('C:\\Users\\thero\\Documents', CLI)
  assert.ok(file && file.endsWith(path.join('C--Users-thero-Documents', `${CLI}.jsonl`)))
  assert.equal(cliSessionFile('C:\\anywhere', '../../evil'), null)
})
