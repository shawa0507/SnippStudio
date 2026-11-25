// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio, phase 0: the dev copy's own name and profile, and the agent
// server (its protocol, its door, the text its tools give). Phase 9a: the
// name comes from shared/product.ts (src/test/product-name.test.ts).
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { agentNameFor, agentPortFor, appNameFor, profileDirFor, windowTitleFor } from '../main/channel'
import { AGENT_TOOLS, cleanToolResult, handleRpc, MAX_RESULT_BYTES, PROTOCOL_VERSIONS, textResult, type RpcContext, type ToolResult } from '../main/agent-protocol'
import { AGENT_PATH, connectCommands, readAgentSettings, refusalFor, startAgentServer, writeAgentSettings } from '../main/agent-server'
import { windowTitle } from '../renderer/src/channel'
import { AGENT_ID, APP_ID, PRODUCT_NAME } from '../shared/product'

// --- the dev copy -----------------------------------------------------------

test('a dev copy has its own name, profile and port; the release copy keeps its own', () => {
  const N = PRODUCT_NAME
  assert.equal(appNameFor('release'), N)
  assert.equal(appNameFor('dev'), `${N} Dev`)
  const roaming = 'C:\\Users\\u\\AppData\\Roaming'
  // Phase 9a, decision 1: the profile folder is <appData>/<name> (and "<name> Dev").
  assert.equal(profileDirFor('dev', roaming, false), path.join(roaming, `${N} Dev`))
  assert.equal(profileDirFor('release', roaming, false), path.join(roaming, N))
  // A launch that names its own folder (the film tool, a render worker, a test) keeps it.
  assert.equal(profileDirFor('dev', roaming, true), null)
  assert.equal(profileDirFor('release', roaming, true), null)
  assert.notEqual(agentPortFor('dev'), agentPortFor('release'))
  assert.equal(agentPortFor('dev'), 47811)
  assert.equal(windowTitleFor('release', 'studio'), N)
  assert.equal(windowTitleFor('dev', 'studio'), `${N} Dev · studio`)
  assert.equal(windowTitleFor('dev', ''), `${N} Dev`)
  // The agents' name for the server is technical and stays (like .snipp).
  assert.equal(agentNameFor('release'), AGENT_ID)
  assert.equal(agentNameFor('dev'), `${AGENT_ID}-dev`)
  assert.match(APP_ID, /^[a-z]+(\.[a-z]+){2}$/)
})

// --- the window's title ------------------------------------------------------

test('a dev copy\'s window says its branch; a release keeps the plain name', () => {
  assert.equal(windowTitle('release', 'studio'), PRODUCT_NAME)
  assert.equal(windowTitle('dev', 'studio'), `${PRODUCT_NAME} Dev · branch studio`)
  assert.equal(windowTitle('dev', ''), `${PRODUCT_NAME} Dev`)
})

// --- the agent server: who gets in ------------------------------------------

const TOKEN = 'a'.repeat(43)
const PORT = 47811
const good = { method: 'POST', url: AGENT_PATH, headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` } }

test('the agent door: this computer, the token, POST, and never a web page', () => {
  assert.equal(refusalFor(good, TOKEN, PORT), null)
  assert.equal(refusalFor({ ...good, headers: { ...good.headers, host: `localhost:${PORT}` } }, TOKEN, PORT), null)
  // A page in a browser (it always says where it comes from).
  assert.equal(refusalFor({ ...good, headers: { ...good.headers, origin: 'https://evil.example' } }, TOKEN, PORT)?.status, 403)
  assert.equal(refusalFor({ ...good, headers: { ...good.headers, origin: 'null' } }, TOKEN, PORT)?.status, 403)
  // A name that only resolves to this computer (DNS rebinding).
  assert.equal(refusalFor({ ...good, headers: { ...good.headers, host: `evil.example:${PORT}` } }, TOKEN, PORT)?.status, 403)
  assert.equal(refusalFor({ ...good, headers: { ...good.headers, host: '127.0.0.1:1' } }, TOKEN, PORT)?.status, 403)
  assert.equal(refusalFor({ ...good, url: '/other' }, TOKEN, PORT)?.status, 404)
  assert.equal(refusalFor({ ...good, url: AGENT_PATH + '?x=1' }, TOKEN, PORT), null)
  // No token, a wrong one, one of another length.
  assert.equal(refusalFor({ ...good, headers: { host: good.headers.host } }, TOKEN, PORT)?.status, 401)
  assert.equal(refusalFor({ ...good, headers: { ...good.headers, authorization: `Bearer ${'b'.repeat(43)}` } }, TOKEN, PORT)?.status, 401)
  assert.equal(refusalFor({ ...good, headers: { ...good.headers, authorization: 'Bearer short' } }, TOKEN, PORT)?.status, 401)
  assert.equal(refusalFor({ ...good, headers: { ...good.headers, authorization: TOKEN } }, TOKEN, PORT)?.status, 401)
  // The token is asked before the method is discussed.
  assert.equal(refusalFor({ ...good, method: 'GET', headers: { host: good.headers.host } }, TOKEN, PORT)?.status, 401)
  assert.equal(refusalFor({ ...good, method: 'GET' }, TOKEN, PORT)?.status, 405)
  assert.equal(refusalFor({ ...good, method: 'PUT' }, TOKEN, PORT)?.status, 405)
  // DELETE ends a session (MCP Streamable HTTP).
  assert.equal(refusalFor({ ...good, method: 'DELETE' }, TOKEN, PORT), null)
  // The key before a renew opens the door for its grace window, and not after it.
  const previous = 'b'.repeat(43)
  const last = { ...good, headers: { ...good.headers, authorization: `Bearer ${previous}` } }
  assert.equal(refusalFor(last, TOKEN, PORT, previous, Date.now() + 60_000), null)
  assert.equal(refusalFor(last, TOKEN, PORT, previous, Date.now() - 1)?.status, 401)
})

test('agent settings: off by default, a token that is kept', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-agent-'))
  try {
    const first = await readAgentSettings(dir)
    assert.equal(first.enabled, false)
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/)
    // The first read keeps its token (written, with a backup): every launch
    // after it gets the same one, or every registered agent would be refused.
    assert.equal((await readAgentSettings(dir)).token, first.token)
    await writeAgentSettings(dir, { enabled: true, token: first.token })
    assert.deepEqual(await readAgentSettings(dir), { enabled: true, token: first.token })
    // A damaged file is recovered from the backup as the same settings.
    writeFileSync(path.join(dir, 'agent.json'), '{ not json')
    assert.deepEqual(await readAgentSettings(dir), { enabled: true, token: first.token })
    // A damaged token in both is not trusted: off, with a new one.
    await writeAgentSettings(dir, { enabled: true, token: 'x' })
    const again = await readAgentSettings(dir)
    assert.equal(again.enabled, false)
    assert.notEqual(again.token, 'x')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const c = connectCommands(47810, TOKEN)
  assert.equal(c.url, 'http://127.0.0.1:47810/mcp')
  assert.equal(c.claude, `claude mcp add --transport http snipp http://127.0.0.1:47810/mcp --header "Authorization: Bearer ${TOKEN}"`)
  assert.match(connectCommands(47811, TOKEN, 'snipp-dev').claude, / snipp-dev http:\/\/127\.0\.0\.1:47811\/mcp /)
})

// --- the agent server: the protocol -----------------------------------------

function ctxWith(call: RpcContext['call']): RpcContext {
  return { call, serverInfo: { name: 'snipp', title: 'Snipp', version: '1.0.0' } }
}
const echo = ctxWith(async (name, args) => textResult(`${name}:${JSON.stringify(args)}`))
const resultOf = (r: unknown): any => (r as { result: unknown }).result
const errorOf = (r: unknown): any => (r as { error: unknown }).error

test('MCP: initialize, the tool list, a call, and what is refused', async () => {
  const init = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, echo)
  assert.equal(resultOf(init).protocolVersion, '2025-06-18')
  assert.deepEqual(resultOf(init).capabilities, { tools: { listChanged: false } })
  assert.equal(resultOf(init).serverInfo.name, 'snipp')
  assert.match(resultOf(init).instructions, /timeline seconds/)
  // A revision we do not know: the newest we do.
  const future = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2999-01-01' } }, echo)
  assert.equal(resultOf(future).protocolVersion, PROTOCOL_VERSIONS[0])

  // Notifications (no id) and stray responses get no answer.
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, echo), null)
  assert.equal(await handleRpc({ jsonrpc: '2.0', id: 9, result: {} }, echo), null)
  assert.deepEqual(resultOf(await handleRpc({ jsonrpc: '2.0', id: 'p', method: 'ping' }, echo)), {})

  const list = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, echo)
  // Tools v2 (phase 4A): twelve (src/test/agent-tools.test.ts).
  assert.deepEqual(resultOf(list).tools.map((t: { name: string }) => t.name), ['project', 'new_project', 'transcript', 'frames', 'changes', 'analyze', 'edit', 'notes', 'job', 'code_clip', 'media', 'wait'])
  for (const t of AGENT_TOOLS) {
    assert.equal((t.inputSchema as { type: string }).type, 'object', t.name)
    assert.ok(t.description.length > 40, t.name)
  }
  // The timeline (edit), the notes, the jobs, and the bin's files (media)
  // change something; the rest only read.
  assert.deepEqual(AGENT_TOOLS.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name), ['new_project', 'edit', 'notes', 'job', 'media'])
  assert.deepEqual(AGENT_TOOLS.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name), ['new_project', 'edit', 'media'])

  const called = await handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'transcript', arguments: { words: true } } }, echo)
  assert.deepEqual(resultOf(called), { content: [{ type: 'text', text: 'transcript:{"words":true}' }] })
  // No arguments at all is an empty object.
  assert.equal(resultOf(await handleRpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'project' } }, echo)).content[0].text, 'project:{}')

  assert.equal(errorOf(await handleRpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'delete_everything' } }, echo)).code, -32602)
  assert.equal(errorOf(await handleRpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'frames', arguments: [1] } }, echo)).code, -32602)
  assert.equal(errorOf(await handleRpc({ jsonrpc: '2.0', id: 8, method: 'resources/list' }, echo)).code, -32601)
  assert.equal(errorOf(await handleRpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }], echo)).code, -32600)
  assert.equal(errorOf(await handleRpc('hello', echo)).code, -32600)
  assert.equal(errorOf(await handleRpc({ jsonrpc: '1.0', id: 1, method: 'ping' }, echo)).code, -32600)
  assert.equal(errorOf(await handleRpc({ jsonrpc: '2.0', id: {}, method: 'ping' }, echo)).code, -32600)
})

test('MCP: a tool that fails is an answer the agent can read, and answers are checked', async () => {
  const failing = ctxWith(async () => {
    throw new Error('The timeline is empty.')
  })
  const r = resultOf(await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'frames', arguments: { times: [1] } } }, failing))
  assert.deepEqual(r, { content: [{ type: 'text', text: 'The timeline is empty.' }], isError: true })

  assert.equal(cleanToolResult(null).isError, true)
  assert.equal(cleanToolResult({ content: 'x' }).isError, true)
  assert.equal(cleanToolResult({ content: [] }).isError, true)
  // Only text and pictures cross; anything else in the answer is dropped.
  const mixed = cleanToolResult({
    content: [
      { type: 'text', text: 'ok' },
      { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
      { type: 'image', data: 'AAAA', mimeType: 'text/html' },
      { type: 'resource', uri: 'file:///c:/secret' },
      { type: 'text', text: 5 }
    ],
    extra: 'dropped'
  })
  assert.deepEqual(mixed, { content: [{ type: 'text', text: 'ok' }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] })
  assert.deepEqual(cleanToolResult({ content: [{ type: 'text', text: 'no' }], isError: true }), { content: [{ type: 'text', text: 'no' }], isError: true })
  const huge = cleanToolResult({ content: [{ type: 'image', data: 'A'.repeat(MAX_RESULT_BYTES + 1), mimeType: 'image/png' }] })
  assert.equal(huge.isError, true)
})

test('the agent server answers on this computer, with the token, and closes', async () => {
  const port = 48000 + Math.floor(Math.random() * 900)
  const calls: string[] = []
  // A small session book (agent-host.ts keeps the real one).
  const book = new Map<string, string>()
  const sent = new Map<string, number>()
  const sessions = {
    open: (client: string) => { const id = 's' + (book.size + 1); book.set(id, client); return id },
    has: (id: string) => book.has(id),
    end: (id: string) => void book.delete(id),
    fallback: () => { book.set('default', 'agent'); return 'default' },
    sent: (id: string, n: number) => void sent.set(id, (sent.get(id) ?? 0) + n)
  }
  const server = await startAgentServer({
    port,
    token: TOKEN,
    version: '1.2.3',
    sessions,
    call: async (name, _args, session): Promise<ToolResult> => {
      calls.push(name + '@' + session)
      return textResult('done')
    }
  })
  const url = `http://127.0.0.1:${port}${AGENT_PATH}`
  const post = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }): Promise<Response> =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code', version: '9' } } })
    assert.equal(init.status, 200)
    assert.match(init.headers.get('content-type') ?? '', /application\/json/)
    // initialize opens a session, named in the answer's header (MCP Streamable HTTP).
    assert.equal(init.headers.get('mcp-session-id'), 's1')
    assert.equal(book.get('s1'), 'claude-code')
    assert.equal(((await init.json()) as any).result.serverInfo.version, '1.2.3')
    assert.ok((sent.get('s1') ?? 0) > 100, 'the definitions sent are counted')

    const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    assert.equal(note.status, 202)
    assert.equal(await note.text(), '')

    const call = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'project', arguments: {} } }, { Authorization: `Bearer ${TOKEN}`, 'Mcp-Session-Id': 's1' })
    assert.deepEqual(((await call.json()) as any).result, { content: [{ type: 'text', text: 'done' }] })
    // No session named: the shared fallback one. An unknown one: start over (404).
    await post({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'project', arguments: {} } })
    assert.equal((await post({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'project' } }, { Authorization: `Bearer ${TOKEN}`, 'Mcp-Session-Id': 'nope' })).status, 404)
    assert.deepEqual(calls, ['project@s1', 'project@default'])
    // DELETE ends a session.
    assert.equal((await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}`, 'Mcp-Session-Id': 's1' } })).status, 200)
    assert.equal(book.has('s1'), false)

    assert.equal((await post({ jsonrpc: '2.0', id: 3, method: 'ping' }, {})).status, 401)
    assert.equal((await post({ jsonrpc: '2.0', id: 3, method: 'ping' }, { Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example' })).status, 403)
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 405)
    const bad = await post('{not json')
    assert.equal(bad.status, 400)
    assert.equal(((await bad.json()) as any).error.code, -32700)
    // Nothing above reached a tool.
    assert.deepEqual(calls, ['project@s1', 'project@default'])

    // The port is taken while it runs: a second copy is told so, not crashed.
    await assert.rejects(startAgentServer({ port, token: TOKEN, version: '1', sessions, call: async () => textResult('x') }), /EADDRINUSE/)
  } finally {
    await server.close()
  }
  await assert.rejects(fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: '{}' }))
})
