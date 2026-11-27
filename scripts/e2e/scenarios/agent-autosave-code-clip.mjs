// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Agent auto-save for unsaved projects: project({save}), new_project({save}),
// and code_clip({create}) on an unsaved project create a real .snipp file
// beside anim/<name>/ without a native dialog, refuse UNC paths, and never
// overwrite existing files.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { connectAgent } from '../agent-client.mjs'
export const name = 'agent-autosave-code-clip'

export async function run({ c, app, lib, work }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const ag = await connectAgent({ c, app, assert, client: 'autosave-test' })

  const outDir = join(work, 'docs-projects')
  mkdirSync(outDir, { recursive: true })

  // 1. new_project({name:"X"}) -> project reports "File: not saved"
  const np1 = await ag.call('new_project', { name: 'X' })
  assert.match(np1.text, /It has no file yet/)
  const p1 = await ag.call('project')
  assert.match(p1.text, /File: not saved/)

  // 2. UNC path refused by project({save:{dir:"\\\\server\\share"}})
  const uncErr = await ag.callErr('project', { save: { dir: '\\\\server\\share' } })
  assert.match(uncErr, /local drive/i)
  const p1AfterUnc = await ag.call('project')
  assert.match(p1AfterUnc.text, /File: not saved/)

  // 3. project({save:{dir: outDir, name:"X"}}) creates X.snipp without a dialog
  const saved1 = await ag.call('project', { save: { dir: outDir, name: 'X' } })
  const xSnipp = join(outDir, 'X.snipp')
  assert.ok(existsSync(xSnipp), 'X.snipp was written to disk')
  assert.ok(saved1.text.includes(xSnipp), `project answer names ${xSnipp}`)

  // 4. code_clip on an already-saved project does NOT create a second .snipp
  const ccSaved = await ag.call('code_clip', { create: { name: 'already-saved', start: 0, end: 3, direct: true } })
  assert.ok(existsSync(join(outDir, 'anim', 'already-saved', 'index.html')), 'anim/already-saved/index.html exists')
  assert.ok(!existsSync(join(outDir, 'X 2.snipp')), 'no second .snipp made for saved project')
  assert.ok(!ccSaved.text.includes('Project file:'), 'did not claim to auto-create a file')

  // 5. Existing X.snipp + project({save:{dir:outDir, name:"X"}}) on a fresh project dedupes to X 2.snipp
  await c.run(() => window.__store.getState().setDirty(false))
  await ag.call('new_project', { name: 'X' })
  const saved2 = await ag.call('project', { save: { dir: outDir, name: 'X' } })
  const x2Snipp = join(outDir, 'X 2.snipp')
  assert.ok(existsSync(x2Snipp), 'X 2.snipp was written without overwriting X.snipp')
  assert.ok(saved2.text.includes(x2Snipp))
  assert.ok(statSync(xSnipp).size > 0, 'X.snipp untouched')

  // 6. new_project({name:"AutoClip"}) (unsaved) -> code_clip({create:{name:"a", start:0, end:5, direct:true}})
  //    auto-creates a .snipp in Documents/SnippStudio, places anim/a/index.html beside it, and saves the clip into it.
  await c.run(() => window.__store.getState().setDirty(false))
  const uniqueName = `AutoClip_${Date.now()}`
  await ag.call('new_project', { name: uniqueName })
  let autoSnipp = null
  try {
    const ccAuto = await ag.call('code_clip', { create: { name: 'a', start: 0, end: 5, direct: true } })
    const m = /Project file: (.+?\.snipp)\./.exec(ccAuto.text)
    assert.ok(m, `code_clip answer names the created .snipp: ${ccAuto.text}`)
    autoSnipp = m[1]
    assert.ok(existsSync(autoSnipp), `auto-created project file exists: ${autoSnipp}`)
    assert.ok(basename(autoSnipp).startsWith(uniqueName), `file named after project: ${autoSnipp}`)
    assert.ok(existsSync(join(dirname(autoSnipp), 'anim', 'a', 'index.html')), 'anim/a/index.html exists beside the .snipp')
    const jsonOnDisk = JSON.parse(readFileSync(autoSnipp, 'utf8'))
    assert.ok(jsonOnDisk.assets.some((a) => a.kind === 'code'), 'follow-up save wrote the code asset to disk')
    assert.ok(Object.keys(jsonOnDisk.clips).length >= 1, 'follow-up save wrote the placed clip to disk')
  } finally {
    if (autoSnipp) {
      rmSync(autoSnipp, { force: true })
      rmSync(join(dirname(autoSnipp), 'anim', 'a'), { recursive: true, force: true })
    }
  }
}
