// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// macOS life cycle and system facts (SnippStudio phase 10a, steps 3 and 4;
// haritalar\cekirdek-platform.md W1, W2, W4, W5, P8, P9, P10), run on
// Windows by naming the platform. Windows' answers are the code they replaced.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { FORBIDDEN_ROLES, hideFromDock, menuTemplate, rolesOf, windowKey, type KeyInput } from '../main/app-menu'
import { argvForOpenFile, LaunchQueue } from '../main/launch-queue'
import { availableMemory, mayWriteInsideApp, modelWriteDirFor, parseVmStat, readVmStat, SECRET_FILE_MODE } from '../main/platform-system'
import { writeAgentSettings } from '../main/agent-server'

test('the menu: none on Windows and Linux (as before); on macOS the app, Edit and Window roles, no reload or zoom', () => {
  assert.equal(menuTemplate('win32', 'X'), null)
  assert.equal(menuTemplate('linux', 'X'), null)
  const mac = menuTemplate('darwin', 'SnippStudio')
  assert.ok(mac)
  const roles = rolesOf(mac)
  for (const r of ['copy', 'paste', 'cut', 'selectAll', 'undo', 'redo', 'quit', 'hide', 'minimize', 'close']) assert.ok(roles.includes(r), r)
  for (const r of FORBIDDEN_ROLES) assert.ok(!roles.includes(r), r)
  assert.equal(mac![0].label, 'SnippStudio')
})

const key = (k: Partial<KeyInput>): KeyInput => ({ type: 'keyDown', key: '', control: false, shift: false, alt: false, meta: false, isAutoRepeat: false, ...k })

test('the window\'s own keys: Windows as before; macOS also Cmd+Opt+I and Ctrl+Cmd+F', () => {
  for (const p of ['win32', 'darwin', 'linux'] as const) {
    assert.equal(windowKey(key({ key: 'F12' }), p), 'devtools')
    assert.equal(windowKey(key({ key: 'I', control: true, shift: true }), p), 'devtools')
    assert.equal(windowKey(key({ key: 'F11' }), p), 'fullscreen')
    assert.equal(windowKey(key({ key: 'F11', isAutoRepeat: true }), p), null)
    assert.equal(windowKey(key({ key: 'F11', control: true }), p), null)
    assert.equal(windowKey(key({ type: 'keyUp', key: 'F12' }), p), null)
  }
  assert.equal(windowKey(key({ key: 'i', meta: true, alt: true }), 'darwin'), 'devtools')
  assert.equal(windowKey(key({ key: 'i', meta: true, alt: true }), 'win32'), null)
  assert.equal(windowKey(key({ key: 'f', meta: true, control: true }), 'darwin'), 'fullscreen')
  assert.equal(windowKey(key({ key: 'f', meta: true, control: true }), 'win32'), null)
})

test('launches before ready wait in order; after ready they open at once (open-file included)', () => {
  const opened: string[][] = []
  const q = new LaunchQueue<string[]>((a) => opened.push(a))
  q.push(['app', '--x'])
  q.push(argvForOpenFile('/Users/a/one.snipp'))
  assert.equal(opened.length, 0)
  assert.equal(q.pending.length, 2)
  q.ready()
  assert.deepEqual(opened, [['app', '--x'], ['/Users/a/one.snipp']])
  q.push(argvForOpenFile('/Users/a/two.snipp'))
  assert.deepEqual(opened[2], ['/Users/a/two.snipp'])
  q.ready()
  assert.equal(opened.length, 3, 'ready twice opens nothing twice')
})

test('a render worker hides from the Dock on macOS only', () => {
  assert.equal(hideFromDock('darwin', true), true)
  assert.equal(hideFromDock('darwin', false), false)
  assert.equal(hideFromDock('win32', true), false)
  assert.equal(hideFromDock('linux', true), false)
})

test('the model store never writes inside the program outside Windows (P8)', () => {
  const o = { packaged: true, inAppWritable: true, inApp: '/Applications/X.app/Contents/Resources/models', userDir: '/Users/a/Library/Application Support/X/whisper-models' }
  assert.equal(modelWriteDirFor({ ...o, platform: 'darwin' }), o.userDir)
  assert.equal(modelWriteDirFor({ ...o, platform: 'linux' }), o.userDir)
  assert.equal(modelWriteDirFor({ ...o, platform: 'win32' }), o.inApp)
  assert.equal(modelWriteDirFor({ ...o, platform: 'win32', inAppWritable: false }), o.userDir)
  assert.equal(modelWriteDirFor({ ...o, platform: 'win32', packaged: false }), o.userDir)
  assert.equal(mayWriteInsideApp('win32', true), true)
  assert.equal(mayWriteInsideApp('darwin', true), false)
  assert.equal(mayWriteInsideApp('win32', false), false)
})

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               12000.
Pages active:                            400000.
Pages inactive:                          300000.
Pages speculative:                         5000.
Pages throttled:                              0.
Pages wired down:                        150000.
Pages purgeable:                           2000.
"Translation faults":                 123456789.
`

test('free memory on macOS from vm_stat; elsewhere os.freemem() as before (P9)', () => {
  assert.equal(parseVmStat(VM_STAT), (12000 + 300000 + 5000 + 2000) * 16384)
  assert.equal(parseVmStat('nonsense'), null)
  assert.equal(availableMemory('darwin', 1e9, VM_STAT), (12000 + 300000 + 5000 + 2000) * 16384)
  assert.equal(availableMemory('darwin', 1e9, null), 1e9)
  assert.equal(availableMemory('win32', 1e9, VM_STAT), 1e9)
  assert.equal(availableMemory('linux', 1e9, VM_STAT), 1e9)
  let ran = 0
  assert.equal(readVmStat('win32', () => (ran++, 'x')), null)
  assert.equal(ran, 0, 'nothing runs outside macOS')
  assert.equal(readVmStat('darwin', () => 'x'), 'x')
})

test('the agent settings file is written for the user alone (P10)', async () => {
  assert.equal(SECRET_FILE_MODE, 0o600)
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-mode-'))
  try {
    await writeAgentSettings(dir, { enabled: true, token: 'a'.repeat(43) })
    const file = path.join(dir, 'agent.json')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).token, 'a'.repeat(43))
    const mode = statSync(file).mode & 0o777
    // POSIX: exactly 0600. Windows keeps only "read-only or not": still writable.
    if (process.platform === 'win32') assert.ok(mode & 0o200)
    else assert.equal(mode, 0o600)
    // Written again (an existing file): still readable and writable.
    await writeAgentSettings(dir, { enabled: false, token: 'b'.repeat(43) })
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).enabled, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the settings writer passes the mode to the file system (spied)', async () => {
  // (D22, K13: written to a temp file beside it, made with the mode from
  // the start, then renamed over the old one.)
  const fsp = require('node:fs').promises as { open: (...a: unknown[]) => Promise<unknown>; chmod: (...a: unknown[]) => Promise<void> }
  const seen: unknown[] = []
  const open = fsp.open
  const chmod = fsp.chmod
  fsp.open = async (...a: unknown[]) => { seen.push(['open', a[1], a[2]]); return open.apply(fsp, a as never) }
  fsp.chmod = async (...a: unknown[]) => { seen.push(['chmod', a[1]]); return chmod.apply(fsp, a as never) }
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-mode-'))
  try {
    await writeAgentSettings(dir, { enabled: true, token: 'c'.repeat(43) })
  } finally {
    fsp.open = open
    fsp.chmod = chmod
    rmSync(dir, { recursive: true, force: true })
  }
  // (The file, then the backup a damaged file is recovered from: both made
  // with the secret's mode from the start.)
  assert.deepEqual(seen, [['open', 'w', 0o600], ['chmod', 0o600], ['open', 'w', 0o600], ['chmod', 0o600]])
})
