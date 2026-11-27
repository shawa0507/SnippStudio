// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The in-app chat (AGENT-CHAT-PLAN.md): the CLI's stream-json lines become
// page events, the MCP config keeps the key out of the file and argv, the
// child's environment drops the desktop host's session variables, and the
// page's store draws one card per tool call.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_SYSTEM_PROMPT, CHAT_TOKEN_ENV, chatArgs, chatEnv, chatEventsFrom, chatMcpConfig, chatModels, chatUserLine, ClaudeChat } from '../main/agent-chat'
import { useChat, type ChatItem } from '../renderer/src/agent/chat'

const SERVER = 'snipp-dev'

test('the MCP config names the key variable, never the key', () => {
  const text = chatMcpConfig(SERVER, 'http://127.0.0.1:47811/mcp')
  const json = JSON.parse(text) as { mcpServers: Record<string, { type: string; url: string; headers: { Authorization: string } }> }
  assert.equal(json.mcpServers[SERVER].type, 'http')
  assert.equal(json.mcpServers[SERVER].url, 'http://127.0.0.1:47811/mcp')
  assert.equal(json.mcpServers[SERVER].headers.Authorization, `Bearer \${${CHAT_TOKEN_ENV}}`)
  assert.ok(!/Bearer\s+[A-Za-z0-9_-]{32,}/.test(text), 'no literal key')
})

test('the arguments: streaming both ways, this server only, its wait disallowed', () => {
  const args = chatArgs('C:\\Temp\\mcp.json', SERVER)
  const at = (flag: string): number => args.indexOf(flag)
  assert.ok(at('-p') >= 0)
  assert.equal(args[at('--input-format') + 1], 'stream-json')
  assert.equal(args[at('--output-format') + 1], 'stream-json')
  assert.equal(args[at('--mcp-config') + 1], 'C:\\Temp\\mcp.json')
  assert.ok(at('--strict-mcp-config') >= 0)
  assert.equal(args[at('--permission-mode') + 1], 'acceptEdits')
  assert.equal(args[at('--allowedTools') + 1], `mcp__${SERVER}`)
  assert.equal(args[at('--disallowedTools') + 1], `mcp__${SERVER}__wait`)
  assert.equal(args[at('--append-system-prompt') + 1], CHAT_SYSTEM_PROMPT)
  assert.match(CHAT_SYSTEM_PROMPT, /Do not call the wait tool/)
})

test('one user message as the CLI reads it', () => {
  const line = chatUserLine('tighten the intro')
  const json = JSON.parse(line) as { type: string; message: { role: string; content: { type: string; text: string }[] }; parent_tool_use_id: null }
  assert.equal(json.type, 'user')
  assert.equal(json.message.role, 'user')
  assert.deepEqual(json.message.content, [{ type: 'text', text: 'tighten the intro' }])
  assert.equal(json.parent_tool_use_id, null)
})

test('a message with a picture: a text block, then the image block (base64)', () => {
  const image = { name: 'cover.png', mediaType: 'image/png', data: 'aGVsbG8=' }
  const withText = JSON.parse(chatUserLine('match this caption', [image])) as { message: { content: unknown[] } }
  assert.deepEqual(withText.message.content, [
    { type: 'text', text: 'match this caption' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }
  ])
  const alone = JSON.parse(chatUserLine('', [image])) as { message: { content: unknown[] } }
  assert.deepEqual(alone.message.content, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }])
})

test('a saved chat is continued with the CLI own --resume, only when there is one', () => {
  const plain = chatArgs('c.json', SERVER)
  assert.ok(!plain.includes('--resume'))
  const resumed = chatArgs('c.json', SERVER, undefined, false, 'acceptEdits', 'c035601c-80b4-486a-a677-6447753145dc')
  const at = resumed.indexOf('--resume')
  assert.ok(at >= 0)
  assert.equal(resumed[at + 1], 'c035601c-80b4-486a-a677-6447753145dc')
  assert.ok(at < resumed.indexOf('--allowedTools'))
})

test('the model flag: absent by default, before the system prompt when chosen', () => {
  assert.ok(!chatArgs('c.json', SERVER).includes('--model'))
  const args = chatArgs('c.json', SERVER, 'deepseek-flash[1m]')
  const at = args.indexOf('--model')
  assert.ok(at >= 0)
  assert.equal(args[at + 1], 'deepseek-flash[1m]')
  assert.ok(at < args.indexOf('--append-system-prompt'))
})

test('shell commands: Bash joins the allow list only when the chat switch is on', () => {
  const off = chatArgs('c.json', SERVER)
  assert.equal(off[off.indexOf('--allowedTools') + 1], `mcp__${SERVER}`)
  const on = chatArgs('c.json', SERVER, undefined, true)
  assert.equal(on[on.indexOf('--allowedTools') + 1], `mcp__${SERVER} Bash`)
})

test('the permission mode is the CLI flag: acceptEdits by default, auto and plan when chosen', () => {
  assert.equal(chatArgs('c.json', SERVER)[chatArgs('c.json', SERVER).indexOf('--permission-mode') + 1], 'acceptEdits')
  for (const mode of ['auto', 'plan'] as const) {
    const args = chatArgs('c.json', SERVER, undefined, false, mode)
    assert.equal(args[args.indexOf('--permission-mode') + 1], mode)
  }
})

test('the model ids the CLI environment holds, deduplicated; ANTHROPIC_MODEL is current', () => {
  assert.deepEqual(chatModels({ ANTHROPIC_MODEL: 'pro[1m]', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'flash[1m]', CLAUDE_CODE_SUBAGENT_MODEL: 'flash[1m]' }), { current: 'pro[1m]', suggestions: ['pro[1m]', 'flash[1m]'] })
  assert.deepEqual(chatModels({}), { current: null, suggestions: [] })
})

test('stream-json lines: init, words, tools, results; unknown and broken lines give nothing', () => {
  assert.deepEqual(chatEventsFrom('not json'), [])
  assert.deepEqual(chatEventsFrom('{"type":"something_new"}'), [])
  const init = chatEventsFrom(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abcd', mcp_servers: [{ name: SERVER, status: 'connected', source: 'dynamic' }] }))
  assert.deepEqual(init, [{ type: 'status', phase: 'ready', sessionId: 'abcd', mcp: [{ name: SERVER, status: 'connected' }] }])
  const withModel = chatEventsFrom(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abcd', model: 'deepseek-flash[1m]', slash_commands: ['compact', 'model', 3], mcp_servers: [] }))
  assert.deepEqual(withModel, [{ type: 'status', phase: 'ready', sessionId: 'abcd', mcp: [], model: 'deepseek-flash[1m]', commands: ['compact', 'model'] }])
  assert.deepEqual(chatEventsFrom(JSON.stringify({ type: 'system', subtype: 'status' })), [])
  const assistant = chatEventsFrom(JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: `mcp__${SERVER}__project`, input: {} }] }
  }))
  assert.deepEqual(assistant, [
    { type: 'thinking' },
    { type: 'text', text: 'Looking.' },
    { type: 'tool', id: 't1', name: `mcp__${SERVER}__project`, input: {}, state: 'running' }
  ])
  const done = chatEventsFrom(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '  three tracks\n20 s ' }] }] } }))
  assert.deepEqual(done, [{ type: 'tool', id: 't1', name: '', state: 'done', summary: 'three tracks 20 s' }])
  const failed = chatEventsFrom(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'no such clip' }] } }))
  assert.deepEqual(failed, [{ type: 'tool', id: 't2', name: '', state: 'error', summary: 'no such clip' }])
  const result = chatEventsFrom(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4200, total_cost_usd: 0.161, num_turns: 2, result: 'Done.' }))
  assert.deepEqual(result, [{ type: 'result', text: 'Done.', isError: false, seconds: 4.2, costUsd: 0.161, turns: 2 }])
  const error = chatEventsFrom(JSON.stringify({ type: 'error', error: { message: 'boom' } }))
  assert.deepEqual(error, [{ type: 'error', message: 'boom' }])
  // The context after a turn: the conversation's size and the model's own
  // window. The size is the last answer's own usage when the turn had one…
  const withContext = chatEventsFrom(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, duration_ms: 1000,
    usage: { input_tokens: 25000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500, output_tokens: 120 },
    modelUsage: { 'm[1m]': { contextWindow: 1048576 } }
  }), 0, 18420)
  assert.equal(withContext[0].type, 'result')
  assert.deepEqual(withContext[0].type === 'result' ? withContext[0].context : null, { used: 18420, window: 1048576 })
  // …and the result's own sum only when no answer was seen (a failed turn).
  const summed = chatEventsFrom(JSON.stringify({
    type: 'result', subtype: 'error_during_execution', is_error: true,
    usage: { input_tokens: 25000, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500, output_tokens: 120 },
    modelUsage: { 'm[1m]': { contextWindow: 1048576 } }
  }))
  assert.deepEqual(summed[0].type === 'result' ? summed[0].context : null, { used: 27620, window: 1048576 })
  // A result without the numbers says nothing about the context.
  const plain = chatEventsFrom(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }))
  assert.equal(plain[0].type === 'result' ? plain[0].context : 'x', undefined)
})

test('each answer reports the size; a subagent is another conversation; the meter keeps its window', () => {
  const answer = chatEventsFrom(JSON.stringify({
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      content: [{ type: 'text', text: 'Hi.' }],
      usage: { input_tokens: 4, cache_read_input_tokens: 17000, cache_creation_input_tokens: 120, output_tokens: 200 }
    }
  }))
  assert.deepEqual(answer, [{ type: 'usage', used: 17324 }, { type: 'text', text: 'Hi.' }])
  const sub = chatEventsFrom(JSON.stringify({
    type: 'assistant',
    parent_tool_use_id: 't9',
    message: { content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 9000, output_tokens: 50 } }
  }))
  assert.deepEqual(sub, [{ type: 'text', text: 'x' }])
  const store = useChat
  store.setState({ context: { used: 17600, window: 1048576 } })
  store.getState().event({ type: 'usage', used: 18420 })
  assert.deepEqual(store.getState().context, { used: 18420, window: 1048576 })
  // Before a window is known there is nothing to measure against; the
  // result line that follows carries it.
  store.setState({ context: null })
  store.getState().event({ type: 'usage', used: 18420 })
  assert.equal(store.getState().context, null)
})

test('the child keeps the user configuration, not the desktop host session', () => {
  const env = chatEnv(
    {
      PATH: 'C:\\Windows',
      ANTHROPIC_AUTH_TOKEN: 'user-token',
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'claude-desktop-3p',
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      CLAUDE_CODE_MESSAGING_TOKEN: 'host-token',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--inspect'
    },
    { [CHAT_TOKEN_ENV]: 'chat-token' }
  )
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'user-token')
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic')
  assert.equal(env[CHAT_TOKEN_ENV], 'chat-token')
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', 'CLAUDE_CODE_MESSAGING_TOKEN', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) {
    assert.equal(env[key], undefined, key)
  }
  if (process.platform === 'win32') assert.equal(env.NoDefaultCurrentDirectoryInExePath, '1')
})

test('the page draws words, tool cards and the result in order', () => {
  const store = useChat
  store.setState({ items: [], busy: false, thinking: false, phase: 'off', installed: true, error: null, draft: '' })
  store.getState().event({ type: 'status', phase: 'ready', mcp: [{ name: SERVER, status: 'connected' }] })
  store.getState().event({ type: 'turn', state: 'start' })
  assert.equal(store.getState().busy, true)
  assert.equal(store.getState().responded, false)
  store.getState().event({ type: 'thinking' })
  assert.equal(store.getState().thinking, true)
  store.getState().event({ type: 'text', text: 'Reading the project.' })
  assert.equal(store.getState().responded, true)
  store.getState().event({ type: 'text', text: 'It has three tracks.' })
  store.getState().event({ type: 'tool', id: 't1', name: `mcp__${SERVER}__project`, input: {}, state: 'running' })
  store.getState().event({ type: 'tool', id: 't1', name: '', state: 'done', summary: 'three tracks' })
  store.getState().event({ type: 'result', isError: false, seconds: 4.2, costUsd: 0.16 })
  const items = store.getState().items
  assert.equal(items.length, 3)
  assert.equal(items[0].kind, 'text')
  assert.equal((items[0] as { text: string }).text, 'Reading the project.\n\nIt has three tracks.')
  assert.equal(items[1].kind, 'tool')
  assert.equal((items[1] as { state: string; summary: string }).state, 'done')
  assert.equal((items[1] as { summary: string }).summary, 'three tracks')
  assert.equal(items[2].kind, 'note')
  assert.equal((items[2] as { code: string }).code, 'result')
  assert.equal(store.getState().busy, false)
  assert.equal(store.getState().thinking, false)
})

test('a server that did not connect is said once, before the first message', () => {
  const store = useChat
  store.setState({ items: [], busy: false, thinking: false, phase: 'off', installed: true, error: null, draft: '' })
  store.getState().event({ type: 'status', phase: 'ready', mcp: [{ name: SERVER, status: 'failed' }] })
  const items = store.getState().items
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'note')
  assert.equal((items[0] as { code: string }).code, 'mcp-failed')
  assert.equal((items[0] as { text: string }).text, SERVER)
})

test('rewind takes a message and everything after it out; the first message clears the chat', async () => {
  const store = useChat
  const key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const first: ChatItem = { kind: 'text', id: 101, role: 'user', text: 'first', at: 1000 }
  const answer: ChatItem = { kind: 'text', id: 102, role: 'assistant', text: 'an answer', at: 2000 }
  const second: ChatItem = { kind: 'text', id: 103, role: 'user', text: 'second', images: ['data:image/png;base64,QUJD'], at: 3000 }
  const sessionId = 'c035601c-80b4-486a-a677-6447753145dc'
  store.setState({ items: [first, answer, second], attachments: [], busy: true, thinking: true, error: null, phase: 'ready', draft: 'in the box', chatKey: key, sessionId, resumeExpected: null })
  await store.getState().rewindTo(103)
  assert.deepEqual(store.getState().items.map((item) => (item.kind === 'text' ? item.text : '')), ['first', 'an answer'])
  assert.equal(store.getState().busy, false)
  assert.equal(store.getState().phase, 'off')
  // (The chat goes on: the same saved chat, its session resumed; the message
  // comes back to the box, its picture with it.)
  assert.equal(store.getState().chatKey, key)
  assert.equal(store.getState().sessionId, sessionId)
  assert.equal(store.getState().resumeExpected, sessionId)
  assert.equal(store.getState().draft, 'second')
  assert.deepEqual(store.getState().attachments.map((a) => [a.mediaType, a.data]), [['image/png', 'QUJD']])
  // (The first message itself: nothing is left, so a new chat starts.)
  store.setState({ items: [first, answer, second], busy: false, thinking: false, draft: 'x' })
  await store.getState().rewindTo(101)
  assert.equal(store.getState().items.length, 0)
  assert.notEqual(store.getState().chatKey, key)
  assert.equal(store.getState().sessionId, '')
  assert.equal(store.getState().draft, 'first')
})

test('ClaudeChat starts stopped and sending before a program answers changes nothing', async () => {
  const chat = new ClaudeChat({ program: { id: 'claude', path: 'claude' }, cwd: process.cwd(), url: 'http://127.0.0.1:1/mcp', token: 'x', serverName: SERVER, send: () => undefined })
  assert.equal(chat.phase, 'off')
  assert.equal(chat.alive(), false)
  chat.stop()
  assert.equal(chat.phase, 'stopped')
})
