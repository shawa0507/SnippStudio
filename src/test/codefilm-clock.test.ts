// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5c (FAZ5-PLAN.md "5c", tarifler\FAZ5.md 5c): the app's clock in a
// page that has no renderOut, the host page's choices about such a page, and
// the app's own copy of three.js for pages that ask a CDN for it. Each test
// fails without the part it is about.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FilmRegistry, filmStamp, injectGuard, LIB_PREFIX, mapLibraries, serveFilm } from '../main/codefilm'
import { guardMain, type SnippClock } from '../main/codefilm-guard'
import { HOST_HTML, pageContent, pageDuration, sameFrame } from '../main/codefilm-host'
import { clampRecord } from '../renderer/src/media/codefilm-limits'

// ---- a stand-in window ----------------------------------------------------

function win(query: string): any {
  const real = { raf: 0, timeout: 0, interval: 0, idle: 0, random: 0, crypto: 0, perf: 0, date: 0 }
  class FakeDate extends Date {}
  const w: any = {
    real,
    location: { search: query },
    performance: { now: () => (real.perf++, 5000) },
    Date: FakeDate,
    Math: Object.create(Math),
    crypto: {
      getRandomValues: (a: Uint8Array) => (real.crypto++, a.fill(7)),
      randomUUID: () => 'real-uuid'
    },
    requestAnimationFrame: () => (real.raf++, 1),
    cancelAnimationFrame: () => {},
    setTimeout: () => (real.timeout++, 1),
    setInterval: () => (real.interval++, 1),
    clearTimeout: () => {},
    clearInterval: () => {},
    requestIdleCallback: () => (real.idle++, 1),
    cancelIdleCallback: () => {},
    console: { error: () => {} },
    addEventListener: () => {},
    document: { addEventListener: () => {}, createElement: () => ({}) }
  }
  w.Math.random = () => (real.random++, 0.5)
  w.eval = (s: string) => {
    w.evaluated = s
  }
  return w
}

test('passing through (no ?vt=1): every source is the real one, only which were used is noted', () => {
  const w = win('?snipp=1')
  guardMain(w)
  w.real.perf = 0 // (the guard's own reading of the real clock)
  assert.equal(w.__snippClock, undefined, 'no clock in a page that is not on it')
  assert.equal(w.performance.now(), 5000)
  w.requestAnimationFrame(() => {})
  w.setTimeout(() => {}, 10)
  w.Math.random()
  w.crypto.getRandomValues(new Uint8Array(2))
  const d = w.Date.now()
  assert.ok(Math.abs(d - Date.now()) < 5000, 'Date.now is the real one')
  assert.deepEqual(w.real, { raf: 1, timeout: 1, interval: 0, idle: 0, random: 1, crypto: 1, perf: 1, date: 0 })
  assert.deepEqual([...w.__snippGuard.uses].sort(), ['crypto', 'date', 'perf', 'raf', 'random', 'timer'])
  assert.deepEqual(clampRecord(w.__snippGuard)!.uses.sort(), ['crypto', 'date', 'perf', 'raf', 'random', 'timer'])
})

test('on the app clock (?vt=1): time stands still until the host moves it', () => {
  const w = win('?snipp=1&vt=1')
  guardMain(w)
  w.real.perf = 0 // (the guard's own reading of the real clock)
  const C: SnippClock = w.__snippClock
  assert.ok(C, 'the clock is there')
  assert.equal(w.performance.now(), 0)
  assert.equal(w.Date.now(), 1767225600000, 'a fixed day: the same on every load')
  assert.equal(new w.Date().getTime(), 1767225600000)
  assert.equal(new w.Date(5).getTime(), 5, 'any other date as it was')
  assert.ok(new w.Date() instanceof Date)
  const seen: string[] = []
  w.setTimeout((a: string) => seen.push('t100 ' + a + ' @' + w.performance.now()), 100, 'x')
  const iv = w.setInterval(() => seen.push('iv @' + w.performance.now()), 40)
  w.requestAnimationFrame((ts: number) => seen.push('raf ' + ts))
  assert.deepEqual(w.real, { raf: 0, timeout: 0, interval: 0, idle: 0, random: 0, crypto: 0, perf: 0, date: 0 }, 'nothing reaches the real ones')
  assert.equal(C.due(39), false)
  assert.equal(C.due(40), true)
  // Stepping to 100 ms, one timer at a time, each at its own due time.
  while (C.timer(100)) {
    /* one per task in the host */
  }
  assert.deepEqual(seen, ['iv @40', 'iv @80', 't100 x @100'])
  assert.equal(C.frame(116, 0.116), 1)
  assert.equal(seen[3], 'raf 116')
  assert.equal(C.frame(132, 0.132), 0, 'a frame callback runs once')
  w.clearInterval(iv)
  assert.equal(C.due(10000), false)
  assert.deepEqual(C.pending(), { frames: 0, timers: 0 })
})

test('a jump fires a due interval once, at the moment jumped to', () => {
  const w = win('?vt=1')
  guardMain(w)
  const C: SnippClock = w.__snippClock
  const at: number[] = []
  w.setInterval(() => at.push(w.performance.now()), 100)
  let n = 0
  while (C.timer(1000, true)) n++
  assert.equal(n, 1)
  assert.deepEqual(at, [1000])
  assert.equal(C.due(1099), false)
  assert.equal(C.due(1100), true)
})

test('idle callbacks, string timers, cancelled frames, errors reported', () => {
  const w = win('?vt=1')
  const reported: unknown[] = []
  w.reportError = (e: unknown) => reported.push(e)
  guardMain(w)
  const C: SnippClock = w.__snippClock
  let left = -1
  w.requestIdleCallback((d: any) => (left = d.timeRemaining()))
  w.setTimeout('window.x = 1', 5)
  const id = w.requestAnimationFrame(() => assert.fail('cancelled'))
  w.cancelAnimationFrame(id)
  w.requestAnimationFrame(() => {
    throw new Error('boom')
  })
  while (C.timer(10)) {
    /* */
  }
  assert.equal(left, 50)
  assert.equal(w.evaluated, 'window.x = 1')
  C.frame(16, 0.016)
  assert.equal(reported.length, 1, 'an error in a frame goes to the page as an uncaught one')
})

test('chance is the same on every load; crypto too', () => {
  const draw = (): unknown[] => {
    const w = win('?vt=1')
    guardMain(w)
    const b = new Uint8Array(8)
    w.crypto.getRandomValues(b)
    return [w.Math.random(), w.Math.random(), w.Math.random(), [...b], w.crypto.randomUUID(), w.real.random + w.real.crypto]
  }
  const a = draw()
  const b = draw()
  assert.deepEqual(a, b)
  assert.notEqual(a[0], a[1])
  assert.ok((a[0] as number) >= 0 && (a[0] as number) < 1)
  assert.match(String(a[4]), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(a[5], 0, 'the real sources were not used')
})

test('GSAP: lag smoothing off; the timelines in window.__timelines are sought to the frame', () => {
  const w = win('?vt=1')
  guardMain(w)
  const C: SnippClock = w.__snippClock
  const lag: number[] = []
  w.gsap = { ticker: { lagSmoothing: (v: number) => lag.push(v) } }
  const sought: number[] = []
  let paused = false
  w.__timelines = { main: { paused: () => paused, pause: () => (paused = true), seek: (s: number) => sought.push(s) } }
  C.frame(500, 0.5)
  C.frame(1500, 1.5)
  assert.deepEqual(lag, [0], 'once')
  assert.deepEqual(sought, [0.5, 1.5])
  assert.equal(paused, true)
})

// ---- the host page's choices ----------------------------------------------

function el(tag: string, style: Record<string, string>, kids: any[] = [], box = { width: 100, height: 50 }): any {
  return { tagName: tag.toUpperCase(), style, childNodes: kids, box, getBoundingClientRect: () => ({ left: 0, top: 0, right: box.width, bottom: box.height, ...box }) }
}
const txt = (s: string): any => ({ nodeType: 3, nodeValue: s })
function doc(body: any, all: any[]): any {
  const base: Record<string, string> = { display: 'block', visibility: 'visible', opacity: '1', color: 'rgb(255, 255, 255)', fontSize: '16px', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', boxShadow: 'none' }
  for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
    base['border' + s + 'Width'] = '0px'
    base['border' + s + 'Style'] = 'none'
    base['border' + s + 'Color'] = 'rgb(0, 0, 0)'
  }
  body.querySelectorAll = () => all
  return { body, defaultView: { innerWidth: 1280, innerHeight: 720, getComputedStyle: (e: any) => ({ ...base, ...e.style }) } }
}

test('tier choice: canvases only → nothing; text, an image, an svg, a painted box → named', () => {
  const canvasOnly = doc(el('body', { backgroundColor: 'rgb(0, 0, 0)' }), [el('canvas', { backgroundColor: 'rgb(255, 0, 0)' }), el('script', {}, [txt('x = 1')]), el('div', {})])
  assert.equal(pageContent(canvasOnly), '', 'the body ground and a canvas do not count; an unpainted div neither')
  assert.match(pageContent(doc(el('body', {}), [el('h1', {}, [txt('Hello')])])), /^text "Hello"$/)
  assert.equal(pageContent(doc(el('body', {}, [txt('  loose words ')]), [])), 'text "loose words"')
  assert.equal(pageContent(doc(el('body', {}), [el('img', {})])), '<img>')
  assert.equal(pageContent(doc(el('body', {}), [el('svg', {})])), '<svg>')
  assert.equal(pageContent(doc(el('body', {}), [el('div', { backgroundColor: 'rgb(10, 20, 30)' })])), 'a painted <div>')
  assert.equal(pageContent(doc(el('body', {}), [el('div', { borderTopWidth: '2px', borderTopStyle: 'solid', borderTopColor: 'red' })])), 'a painted <div>')
  // Not seen: hidden, transparent text, outside the view, no size.
  assert.equal(pageContent(doc(el('body', {}), [el('h1', { display: 'none' }, [txt('a')]), el('h1', { color: 'rgba(0, 0, 0, 0)' }, [txt('b')]), el('img', {}, [], { width: 0, height: 0 }), el('h1', { visibility: 'hidden' }, [txt('c')])])), '')
})

test('the length of a page that does not say it', () => {
  assert.equal(pageDuration({ __config: { duration: 7 } }), 7)
  assert.equal(pageDuration({ __timelines: { a: { duration: () => 3 }, b: { totalDuration: () => 8 } } }), 8)
  assert.equal(pageDuration({ gsap: { globalTimeline: { totalDuration: () => 1e12 } }, document: { getAnimations: () => [{ effect: { getComputedTiming: () => ({ endTime: 4500 }) } }, { effect: { getComputedTiming: () => ({ endTime: Infinity }) } }], querySelectorAll: () => [] } }), 4.5, 'an endless GSAP timeline is no length; animations end at 4.5 s')
  assert.equal(pageDuration({ document: { getAnimations: () => [], querySelectorAll: () => [{ duration: 12.5 }, { duration: NaN }] } }), 12.5)
  assert.equal(pageDuration({ document: { getAnimations: () => [], querySelectorAll: () => [] } }), null)
})

test('the same moment: ≤ 0.5 % of the pixels differ by more than 28 / 255', () => {
  const a = new Uint8ClampedArray(4 * 1000).fill(100)
  const b = new Uint8ClampedArray(a)
  assert.equal(sameFrame(a, b), true)
  for (let i = 0; i < 5; i++) b[i * 4] = 200
  assert.equal(sameFrame(a, b), true, '5 of 1000 pixels')
  b[5 * 4 + 2] = 0
  assert.equal(sameFrame(a, b), false, '6 of 1000 pixels')
  const c = new Uint8ClampedArray(a)
  for (let i = 0; i < 1000; i++) c[i * 4 + 1] = 128
  assert.equal(sameFrame(a, c), true, 'every pixel 28 apart is still the same')
  assert.equal(sameFrame(a, new Uint8ClampedArray(8)), false)
})

test('the host page carries its helpers', () => {
  for (const name of ['function pageContent', 'function pageDuration', 'function sameFrame', '__snippClock', "'vt=1'", 'own renderOut']) assert.ok(HOST_HTML.includes(name), name)
})

// ---- three.js from the app, for a page that asks a CDN ---------------------

test('known CDN addresses of three 0.170.x become the app copy; anything else stays', () => {
  const L = '/' + LIB_PREFIX
  assert.equal(mapLibraries('"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"'), `"${L}build/three.module.js"`)
  assert.equal(mapLibraries("'https://unpkg.com/three@0.170.0/examples/jsm/controls/OrbitControls.js'"), `'${L}examples/jsm/controls/OrbitControls.js'`)
  assert.equal(mapLibraries('"https://cdn.jsdelivr.net/npm/three@0.170.0/addons/"'), `"${L}examples/jsm/"`)
  assert.equal(mapLibraries('"https://esm.sh/three@0.170.0"'), `"${L}build/three.module.js"`)
  assert.equal(mapLibraries('"https://ga.jspm.io/npm:three@0.170.0/build/three.module.min.js"'), `"${L}build/three.module.js"`)
  assert.equal(mapLibraries('"//cdn.skypack.dev/three@0.170.2/build/three.module.js"'), `"${L}build/three.module.js"`)
  for (const s of ['"https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js"', '"https://cdn.jsdelivr.net/npm/three@0.1700.0/build/x.js"', '"https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"', '"https://evil.example/three@0.170.0/build/three.module.js"', 'no address']) assert.equal(mapLibraries(s), s, s)
})

test('a page: the guard first, its import map pointed at the app copy; a page without one keeps its bytes', () => {
  const page = '<!doctype html><html><head><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"}}</script></head></html>'
  const out = injectGuard(Buffer.from(page, 'utf8')).toString('utf8')
  assert.ok(out.startsWith('<!doctype html><script src="/__snipp/guard.js"></script><html>'))
  assert.ok(out.includes('"three":"/__snipp/lib/three/build/three.module.js"'))
  const utf = Buffer.from('<p>ğ "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"</p>', 'utf8')
  assert.equal(injectGuard(utf).toString('utf8'), '<script src="/__snipp/guard.js"></script><p>ğ "/__snipp/lib/three/build/three.module.js"</p>', 'utf-8 bytes kept around the address')
  const le = injectGuard(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<p>"https://unpkg.com/three@0.170.0"</p>', 'utf16le')]))
  assert.equal(le.subarray(2).toString('utf16le'), '<script src="/__snipp/guard.js"></script><p>"/__snipp/lib/three/build/three.module.js"</p>')
  const plain = Buffer.from([0x3c, 0x70, 0x3e, 0xc4, 0x9f, 0xfe])
  assert.deepEqual([...injectGuard(plain).subarray(-6)], [0x3c, 0x70, 0x3e, 0xc4, 0x9f, 0xfe])
})

test('the film server: the app copy under __snipp/lib/three/, its own folder only; a module from a CDN mapped', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-5c-'))
  try {
    const lib = path.join(dir, 'lib')
    mkdirSync(path.join(lib, 'build'), { recursive: true })
    writeFileSync(path.join(lib, 'build', 'three.module.js'), 'export const REVISION = "170"')
    writeFileSync(path.join(dir, 'secret.txt'), 'no')
    const film = path.join(dir, 'film')
    mkdirSync(film)
    writeFileSync(path.join(film, 'index.html'), '<p>x</p>')
    writeFileSync(path.join(film, 'a.js'), "import * as T from 'https://unpkg.com/three@0.170.0/build/three.module.js'")
    writeFileSync(path.join(film, 'b.js'), "import * as T from 'https://unpkg.com/three@0.160.0/build/three.module.js'")
    const reg = new FilmRegistry()
    const id = reg.idFor(film)
    const get = (p: string, l: string | null = lib) => serveFilm(reg, new Request(`snippfilm://${id}${p}`), true, l)
    const r = await get('/__snipp/lib/three/build/three.module.js')
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type') ?? '', /javascript/)
    assert.ok(r.headers.get('content-security-policy'), 'the policy on this answer too')
    assert.equal(await r.text(), 'export const REVISION = "170"')
    assert.equal((await get('/__snipp/lib/three/build/nothing.js')).status, 404)
    assert.equal((await get('/__snipp/lib/three/../secret.txt')).status, 404)
    assert.equal((await get('/__snipp/lib/three/%2e%2e/secret.txt')).status, 404)
    assert.equal((await get('/__snipp/lib/three/build/three.module.js', null)).status, 404, 'no copy given: nothing')
    assert.equal(await (await get('/a.js')).text(), "import * as T from '/__snipp/lib/three/build/three.module.js'")
    assert.equal(await (await get('/b.js')).text(), "import * as T from 'https://unpkg.com/three@0.160.0/build/three.module.js'", 'another version is left to be blocked')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- the folder watcher: a file only read is not a change ------------------

test('watchFilm: a file only read (Windows updating its last-access time) does not reload the film; a write does', async () => {
  const { watchFilm, reallyChanged } = await import('../main/codefilm')
  const { utimesSync, statSync, readFileSync } = await import('node:fs')
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-5c-watch-'))
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  try {
    const f = path.join(dir, 'a.js')
    writeFileSync(f, 'x'.repeat(50000))
    // Last read more than an hour ago: the next read updates it (and Windows
    // tells the watcher), as for a film's file served again after a while.
    utimesSync(f, new Date(Date.now() - 3 * 3600_000), new Date(Date.now() - 2 * 3600_000))
    await wait(300)
    const got: string[][] = []
    const stop = watchFilm(dir, (files) => got.push(files))
    try {
      await wait(300)
      readFileSync(f)
      await wait(1500)
      assert.deepEqual(got, [], 'reading is not a change')
      writeFileSync(f, 'y')
      await wait(1500)
      assert.deepEqual(got, [['a.js']], 'writing is')
    } finally {
      stop()
    }
    // The rule itself: same size and time → no; other → yes; gone → yes; a
    // file first seen counts only when written after the watch began.
    const seen = new Map<string, string>()
    const since = Date.now()
    utimesSync(f, new Date(since - 7200_000), new Date(since - 7200_000))
    assert.equal(await reallyChanged(dir, 'a.js', seen, since), false)
    assert.equal(await reallyChanged(dir, 'a.js', seen, since), false)
    utimesSync(f, new Date(), new Date())
    assert.equal(await reallyChanged(dir, 'a.js', seen, since), true)
    rmSync(f)
    assert.equal(await reallyChanged(dir, 'a.js', seen, since), true)
    void statSync
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('filmStamp: a served file changing changes it; an ignored file does not', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-stamp-'))
  try {
    writeFileSync(path.join(dir, 'index.html'), 'a')
    const one = await filmStamp(dir)
    assert.match(one ?? '', /^[a-f0-9]{40}$/)
    // (A note beside the page is not the film's code: no reload.)
    writeFileSync(path.join(dir, 'notes.md'), 'x'.repeat(100))
    assert.equal(await filmStamp(dir), one)
    // A page written again is a new stamp (the frame paths reload on it).
    writeFileSync(path.join(dir, 'index.html'), 'b')
    const two = await filmStamp(dir)
    assert.notEqual(two, one)
    // Nothing served at all: null.
    rmSync(path.join(dir, 'index.html'))
    assert.equal(await filmStamp(dir), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
