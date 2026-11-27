// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import './dom-stub'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { agentTools, SERVER_INSTRUCTIONS } from '../renderer/src/agent/tools'
import { ensureProjectFile } from '../renderer/src/agent/code-clip'
import { getLastProjectPath, setLastProjectPath } from '../renderer/src/media/projectio'
import { useStore } from '../renderer/src/state/store'

const MAIN = join(__dirname, '..', '..', 'src', 'main')

function handler(file: string, name: string): string {
  const src = readFileSync(join(MAIN, file), 'utf8')
  const at = src.indexOf(`ipcMain.handle('${name}'`)
  assert.ok(at >= 0, name)
  const next = src.indexOf('ipcMain.handle(', at + 10)
  return src.slice(at, next < 0 ? undefined : next)
}

test('project:create-file checks local paths, dedupes, registers knownProjectPaths and sets currentProjectPath synchronously', () => {
  const h = handler('ipc/file-ipc.ts', 'project:create-file')
  assert.match(h, /isLocalFilePath\(docs\)/)
  assert.match(h, /isLocalFilePath\(args\.dir\)/)
  assert.match(h, /knownProjectPaths\.add\(p\)/)
  assert.match(h, /editorState\(event\.sender\)\.currentProjectPath = p/)
  assert.match(h, /\$\{safe\} \$\{n\}\.snipp/)
})

test('codefilm:make-anim keeps its last-resort save-the-project-first guard', () => {
  const h = handler('ipc/media-ipc.ts', 'codefilm:make-anim')
  assert.match(h, /save the project first/)
})

test('MCP surface exposes project.save, new_project.save, and code_clip auto-create instructions', () => {
  const tools = agentTools()
  const project = tools.find((t) => t.name === 'project')!
  const newProject = tools.find((t) => t.name === 'new_project')!
  const codeClip = tools.find((t) => t.name === 'code_clip')!

  assert.ok((project.inputSchema.properties as Record<string, unknown>).save)
  assert.deepEqual((newProject.inputSchema.properties as Record<string, unknown>).save, { type: 'boolean' })
  assert.match(codeClip.description, /made in Documents/)
  assert.match(SERVER_INSTRUCTIONS, /A code clip needs a project file; when there is none, one is made and you are told where\./)
  const hostSrc = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'agent', 'host.ts'), 'utf8')
  assert.match(hostSrc, /if \(tool === 'project'\) return a\.save !== undefined/)
})

test('ensureProjectFile returns existing path without re-creating or overwriting', async () => {
  const prev = getLastProjectPath()
  try {
    setLastProjectPath('C:\\Projects\\existing.snipp')
    const res = await ensureProjectFile()
    assert.deepEqual(res, { path: 'C:\\Projects\\existing.snipp', created: false })
  } finally {
    setLastProjectPath(prev)
  }
})

test('ensureProjectFile without api throws a clear app error when unsaved', async () => {
  const prev = getLastProjectPath()
  try {
    setLastProjectPath(null)
    useStore.getState().newProject('16:9')
    await assert.rejects(() => ensureProjectFile(), /Giving a project a file needs the/)
  } finally {
    setLastProjectPath(prev)
  }
})
