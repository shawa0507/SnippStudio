// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Code films (CODE-FILM-CLIP-PLAN.md): a folder whose index.html follows
// VideoHub's live contract, served to the editor over snippfilm://<id>/.
//
// A folder gets an id only by the person's own consent (the folder dialog, a
// dropped folder, a project they opened that lists it), as media:// paths do.
// The handler serves files INSIDE that folder only, and Snipp's host page
// (codefilm-host.ts) at __snipp/host.html. No Electron here: the parts are
// tested in Node.

import { createReadStream, promises as fs, watch, type Dirent, type FSWatcher } from 'node:fs'
import { currentPlatform, foldKey, isInside as isInsidePath, pathApi, type Platform } from './platform-path'
import { createHash, randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { HOST_HTML } from './codefilm-host'
import { GUARD_JS } from './codefilm-guard'

export const FILM_SCHEME = 'snippfilm'
export const HOST_PATH = '__snipp/host.html'
/** The app's first script in every film page (codefilm-guard.ts). */
export const GUARD_PATH = '__snipp/guard.js'
const GUARD_TAG = `<script src="/${GUARD_PATH}"></script>`

/** A snippfilm host is 16 lowercase hex characters (minted per folder). */
export function isFilmHost(h: string): boolean {
  return /^[a-f0-9]{16}$/.test(h)
}

const FILM_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream'
}

export function filmMime(p: string): string {
  return FILM_MIME[pathApi().extname(p).toLowerCase()] ?? 'application/octet-stream'
}

const trimRoot = (root: string, platform: Platform = currentPlatform()): string => {
  const n = pathApi(platform).normalize(root)
  // (A POSIX root "/" stays "/".)
  return platform === 'win32' ? n.replace(/[\\/]+$/, '') : n.replace(/\/+$/, '') || '/'
}

/** The file a snippfilm URL path names inside `root`, or null when it would
 *  leave the folder (.., another drive, an alternate data stream, a device).
 *  (Phase 10a: the drive, stream and device rules are Windows' own; on macOS
 *  and Linux ".." and NUL are refused, and the folder test is the platform's.) */
export function filmPathFor(root: string, urlPath: string, platform: Platform = currentPlatform()): string | null {
  let rel: string
  try {
    rel = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (rel.includes('\0')) return null
  rel = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (rel === '') rel = 'index.html'
  const segs = rel.split('/').filter((s) => s !== '' && s !== '.')
  if (!segs.length) return null
  const win = platform === 'win32'
  for (const s of segs) {
    if (s === '..') return null
    if (win && (s.includes(':') || /[<>"|?*]/.test(s))) return null
    // Device names (CON, NUL, COM1…) are not files (on Windows).
    if (win && /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) return null
  }
  const api = pathApi(platform)
  const r = trimRoot(root, platform)
  const full = api.normalize(api.join(r, ...segs))
  if (!foldKey(full, platform).startsWith(foldKey(r, platform).replace(/[\\/]+$/, '') + api.sep)) return null
  return full
}

export function isInside(root: string, p: string, platform: Platform = currentPlatform()): boolean {
  return isInsidePath(trimRoot(root, platform), p, platform)
}

export interface FilmMeta {
  duration: number | null
  fps: number | null
}

/** What .videohub/project.json and the mix's length say, before the page runs. */
export function metaFrom(projectJson: unknown, wavSeconds: number | null): FilmMeta {
  const env = (projectJson as { render?: { env?: Record<string, unknown> } } | null)?.render?.env
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const dur = num(env?.DUR) ?? (wavSeconds && wavSeconds > 0 ? wavSeconds : null)
  return { duration: dur, fps: num(env?.FPS) }
}

/** A WAV's length from its header (RIFF chunks), or null. `fileSize` covers a
 *  data chunk whose size was left open (streamed writers). */
export function wavSeconds(head: Uint8Array, fileSize: number): number | null {
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const tag = (o: number): string => String.fromCharCode(head[o], head[o + 1], head[o + 2], head[o + 3])
  if (head.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let byteRate = 0
  let o = 12
  while (o + 8 <= head.length) {
    const id = tag(o)
    const size = dv.getUint32(o + 4, true)
    if (id === 'fmt ' && o + 16 <= head.length) byteRate = dv.getUint32(o + 16, true)
    if (id === 'data') {
      if (!byteRate) return null
      const bytes = size === 0xffffffff || o + 8 + size > fileSize ? fileSize - (o + 8) : size
      return bytes > 0 ? bytes / byteRate : null
    }
    o += 8 + size + (size & 1)
  }
  return null
}

/** The folders given ids this session. */
export class FilmRegistry {
  private byId = new Map<string, string>()
  private byRoot = new Map<string, string>()

  /** The id of a folder (the same one again for the same folder). */
  idFor(root: string): string {
    const r = trimRoot(root)
    const key = foldKey(r)
    let id = this.byRoot.get(key)
    if (!id) {
      do id = randomBytes(8).toString('hex')
      while (this.byId.has(id))
      this.byRoot.set(key, id)
      this.byId.set(id, r)
    }
    return id
  }

  root(id: string): string | undefined {
    return this.byId.get(id)
  }

  private refused = new Map<string, string[]>()
  /** An address the main process refused a film (film-fence.ts): kept for the
   *  film's "blocked" list (50 per film, 500 characters each). */
  noteBlocked(id: string, url: string): void {
    if (!isFilmHost(id)) return
    let l = this.refused.get(id)
    if (!l) this.refused.set(id, (l = []))
    const u = url.slice(0, 500)
    if (l.length < 50 && !l.includes(u)) l.push(u)
  }
  blocked(id: string): string[] {
    return [...(this.refused.get(id) ?? [])]
  }
}

export interface CodeFilmInfo {
  id: string
  root: string
  url: string
  name: string
  mix: { path: string; url: string; size: number } | null
  meta: FilmMeta
}

/** A folder that holds an index.html, registered: its id, its mix allowed as
 *  media (the editor plays it as an ordinary sound), its facts. */
export async function registerFilm(
  reg: FilmRegistry,
  folder: string,
  media: { allow: (p: string) => void; url: (p: string) => string }
): Promise<CodeFilmInfo | null> {
  const root = trimRoot(folder)
  const st = await fs.stat(root).catch(() => null)
  if (!st?.isDirectory()) return null
  const index = await fs.stat(pathApi().join(root, 'index.html')).catch(() => null)
  if (!index?.isFile()) return null
  const id = reg.idFor(root)
  const mixPath = pathApi().join(root, 'audio', 'mix.wav')
  const mixStat = await fs.stat(mixPath).catch(() => null)
  let mix: CodeFilmInfo['mix'] = null
  let seconds: number | null = null
  if (mixStat?.isFile()) {
    media.allow(mixPath)
    mix = { path: mixPath, url: media.url(mixPath), size: mixStat.size }
    seconds = await readWavSeconds(mixPath, mixStat.size)
  }
  let pj: unknown = null
  try {
    const text = await fs.readFile(pathApi().join(root, '.videohub', 'project.json'), 'utf8')
    pj = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    pj = null
  }
  return { id, root, url: `${FILM_SCHEME}://${id}/`, name: pathApi().basename(root), mix, meta: metaFrom(pj, seconds) }
}

async function readWavSeconds(p: string, size: number): Promise<number | null> {
  let fh: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    fh = await fs.open(p, 'r')
    const head = new Uint8Array(Math.min(size, 65536))
    await fh.read(head, 0, head.length, 0)
    return wavSeconds(head, size)
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => {})
  }
}

/** The content security policy of every film page and of its host page
 *  (phase 5a, decision 5): its own folder, data: and blob: only. So a film
 *  cannot read the user's media (media://), another film's folder, or the
 *  network; what it tried is written down by the guard (securitypolicyviolation).
 *  Not the fence itself (main/film-fence.ts is), a second wall. */
export const FILM_CSP = [
  "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'"
].join('; ')

/** Every film answer: never cached (a film's code changes while it is open:
 *  Claude edits it). No Access-Control-Allow-Origin: a film's files are read
 *  by its own pages (same origin), not by other origins (phase 5a, decision 5;
 *  until then any origin could read them). The policy on EVERY answer (5a/5b
 *  patch, C-1): a worker started from a .js of the folder, an .svg opened as a
 *  document, an error page each take the policy of their own answer. */
const FILM_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': FILM_CSP
}

/** Files of a film's folder never served to it (5a/5b patch, C-1): a Snipp
 *  project kept there (VideoHub's "open in Snipp" saves <film>\snipp\<film>.snipp;
 *  it names the user's media by their full paths) and the app's side files. */
export function notForFilm(rel: string): boolean {
  const r = rel.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
  return /^snipp(\/|$)/.test(r) || /\.(snipp|autocut|tmp)$/.test(r)
}

/** The page's encoding by its byte order mark (what the browser decodes it
 *  by, before any header), and the mark's length. No mark: latin1, byte for
 *  byte (the page's own bytes kept whatever they are). */
function pageEncoding(b: Buffer): { enc: 'utf8' | 'utf16le' | 'utf16be' | 'latin1'; bom: number } {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { enc: 'utf8', bom: 3 }
  if (b[0] === 0xff && b[1] === 0xfe) return { enc: 'utf16le', bom: 2 }
  if (b[0] === 0xfe && b[1] === 0xff) return { enc: 'utf16be', bom: 2 }
  return { enc: 'latin1', bom: 0 }
}

/** Where the guard goes in a page's text: before ANY markup of the page, past
 *  only what cannot run: blanks, comments, the doctype (a doctype must stay
 *  first, or the page falls into quirks mode). Nothing of the page's runs
 *  before it, and no "<head>" inside a comment or a script string misleads
 *  it (5a/5b patch, audit C-5 "pre" and C-8). */
export function guardOffset(text: string): number {
  let i = 0
  let doctype = false
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      if (end < 0) return i
      i = end + 3
      continue
    }
    if (!doctype && /^<!doctype/i.test(text.slice(i, i + 9))) {
      const end = text.indexOf('>', i)
      if (end < 0) return i
      i = end + 1
      doctype = true
      continue
    }
    return i
  }
}

/** The page with the guard as its first script (guardOffset), in the page's
 *  own encoding: a byte order mark stays first and the tag is written in the
 *  encoding it announces (a UTF-16 page stayed UTF-16 only in its own bytes
 *  before: audit C-8). */
export function injectGuard(page: Uint8Array): Buffer {
  const buf = Buffer.from(page.buffer, page.byteOffset, page.byteLength)
  const { enc, bom } = pageEncoding(buf)
  const body = buf.subarray(bom)
  const decode = (b: Buffer): string => (enc === 'utf16be' ? Buffer.from(b).swap16().toString('utf16le') : b.toString(enc === 'utf8' ? 'latin1' : enc))
  const encode = (s: string): Buffer => (enc === 'utf16be' ? Buffer.from(s, 'utf16le').swap16() : Buffer.from(s, enc === 'utf8' ? 'latin1' : enc))
  // (UTF-16: whole code units only; an odd trailing byte is kept as it is.)
  const even = enc === 'latin1' || enc === 'utf8' ? body : body.subarray(0, body.length - (body.length % 2))
  const text = decode(even)
  const at = guardOffset(text)
  const head = encode(text.slice(0, at))
  // The rest of the page with its library addresses mapped (phase 5c,
  // decision 5); a page that names none is its own bytes again (latin1 and
  // whole UTF-16 code units decode and encode back losslessly).
  const rest = text.slice(at)
  const mapped = mapLibraries(rest)
  const tail = mapped === rest ? body.subarray(head.length) : Buffer.concat([encode(mapped), body.subarray(even.length)])
  return Buffer.concat([buf.subarray(0, bom), head, encode(GUARD_TAG), tail])
}

/** Where the app's copy of three.js 0.170.0 is served in every film's own
 *  folder (phase 5c, decision 5; FAZ5-PLAN.md "5c"). */
export const LIB_PREFIX = '__snipp/lib/three/'

/** Known CDN addresses of three.js 0.170.x: jsDelivr's and unpkg's npm
 *  layout, jspm's, esm.sh's and Skypack's. Group 1: the path inside the
 *  package ('' for the package itself). */
const THREE_CDN = /(?:https?:)?\/\/(?:cdn\.jsdelivr\.net\/npm\/|unpkg\.com\/|ga\.jspm\.io\/npm:|esm\.sh\/|cdn\.skypack\.dev\/)three@0\.170\.\d+((?:\/[A-Za-z0-9._~!$&*+,;=:@%/-]*)?)/g

/** The package path a CDN address asks for, as the app's copy holds it. */
function threePath(p: string): string {
  let rel = p.replace(/^\/+/, '')
  if (rel === '' || rel === 'build/three.module.min.js' || rel === 'build/three.min.js') return 'build/three.module.js'
  if (rel.startsWith('addons/')) rel = 'examples/jsm/' + rel.slice('addons/'.length)
  if (rel === 'addons') rel = 'examples/jsm/Addons.js'
  return rel
}

/** A page's or a module's text with every known CDN address of three.js
 *  0.170.x turned into the app's own copy (`/__snipp/lib/three/…`, served
 *  from the film's own origin: no network). Any other version or library
 *  keeps its address, which the page's policy refuses and the guard writes
 *  down as "blocked". The same string again when nothing matched. */
export function mapLibraries(text: string): string {
  if (!/three@0\.170\./.test(text)) return text
  return text.replace(THREE_CDN, (_m, p: string) => '/' + LIB_PREFIX + threePath(p || ''))
}

/** The Content-Type of a page: its charset as its byte order mark says
 *  (the mark wins over a header anyway; this keeps them the same). */
function pageType(page: Uint8Array, mime: string): string {
  const { enc } = pageEncoding(Buffer.from(page.buffer, page.byteOffset, Math.min(3, page.byteLength)))
  return enc === 'utf16le' ? 'text/html; charset=utf-16le' : enc === 'utf16be' ? 'text/html; charset=utf-16be' : mime
}

/** The film id of a snippfilm:// address, or '' (another scheme, a bad address). */
function filmIdOfUrl(u: string | null | undefined): string {
  const m = u ? /^snippfilm:\/\/([^/?#]*)/i.exec(u) : null
  return m ? m[1].toLowerCase() : ''
}

/** May a frame inside a page go to `target`? (main/index.ts, will-frame-navigate;
 *  phase 5a, decision 5.) Only to about:blank or to a registered film's
 *  folder, and a film only ever to its OWN folder: when the frame sits inside
 *  a film page (`parent`) or a film page asks for the navigation
 *  (`initiator`), the target is that film. The editor (the top page) opens
 *  any registered film's host page. */
export function filmFrameMayGo(target: string, parent: string | null, initiator: string | null, known: (id: string) => boolean): boolean {
  if (target === 'about:blank') return true
  const id = filmIdOfUrl(target)
  if (!id || !isFilmHost(id) || !known(id)) return false
  for (const from of [parent, initiator]) {
    const f = filmIdOfUrl(from)
    if (f && f !== id) return false
  }
  return true
}

/** The user's hand-set values of a film's page (cila K; codefilm-values.ts
 *  implements it): the bytes to serve for a text file instead of its own. */
export interface ServedValues {
  patch(id: string, root: string, rel: string, real: string, page: URLSearchParams | undefined): Promise<Buffer | null | 'missing'>
}

/** The snippfilm:// protocol handler. `values`: the user's hand-set values
 *  (cila K), written into a text file as it is served: before the guard
 *  goes in, behind every check of this handler, the file itself untouched.
 *  Without it, or for a film with no values set, nothing differs. */
export async function serveFilm(reg: FilmRegistry, request: Request, policy = true, libDir: string | null = null, values: ServedValues | null = null): Promise<Response> {
  // (Only a test run turns the policy off: e2e-hooks.ts 'film-policy'.)
  const HEADERS: Record<string, string> = policy ? FILM_HEADERS : { 'Cache-Control': FILM_HEADERS['Cache-Control'] }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: HEADERS })
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response('Bad request', { status: 400, headers: HEADERS })
  }
  const root = isFilmHost(url.hostname) ? reg.root(url.hostname) : undefined
  if (!root) return new Response('Forbidden', { status: 403, headers: HEADERS })
  // One film never reads another's folder: the main process's request filter
  // refuses it before it gets here (film-fence.ts; the request itself does not
  // say who asked: FAZ5-PLAN.md U12). The policy is a second wall.
  const sub = url.pathname.replace(/^\/+/, '')
  if (sub === HOST_PATH) {
    return new Response(request.method === 'HEAD' ? null : HOST_HTML, { status: 200, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (sub === GUARD_PATH) {
    return new Response(request.method === 'HEAD' ? null : GUARD_JS, { status: 200, headers: { ...HEADERS, 'Content-Type': 'text/javascript; charset=utf-8' } })
  }
  if (sub.startsWith(LIB_PREFIX)) {
    // The app's three.js (phase 5c, decision 5): read only from its own folder.
    const lib = libDir ? filmPathFor(libDir, sub.slice(LIB_PREFIX.length)) : null
    const st = lib ? await fs.stat(lib).catch(() => null) : null
    if (!lib || !st?.isFile()) return new Response('Not found', { status: 404, headers: HEADERS })
    const body = request.method === 'HEAD' ? null : new Uint8Array(await fs.readFile(lib))
    return new Response(body, { status: 200, headers: { ...HEADERS, 'Content-Type': filmMime(lib), 'Content-Length': String(st.size) } })
  }
  if (/^\/+__snipp\//.test(url.pathname)) return new Response('Not found', { status: 404, headers: HEADERS })
  const file = filmPathFor(root, url.pathname)
  if (!file || notForFilm(pathApi().relative(trimRoot(root), file))) return new Response('Forbidden', { status: 403, headers: HEADERS })
  let real: string
  let realRoot: string
  try {
    ;[real, realRoot] = await Promise.all([fs.realpath(file), fs.realpath(root)])
  } catch {
    return new Response('Not found', { status: 404, headers: HEADERS })
  }
  // A link inside the folder that points out of it is not followed.
  if (!isInside(realRoot, real)) return new Response('Forbidden', { status: 403, headers: HEADERS })
  if (notForFilm(pathApi().relative(realRoot, real))) return new Response('Forbidden', { status: 403, headers: HEADERS })
  const stat = await fs.stat(real).catch(() => null)
  if (!stat?.isFile()) return new Response('Not found', { status: 404, headers: HEADERS })
  const mime = filmMime(real)
  // Cila K: this file with the user's values written in (null: as it is).
  let valued: Buffer | null = null
  if (values && (mime.startsWith('text/html') || mime.startsWith('text/css') || mime.startsWith('text/javascript'))) {
    const rel = pathApi().relative(trimRoot(root), file).split(pathApi().sep).join('/')
    const v = await values.patch(url.hostname, root, rel, real, mime.startsWith('text/html') ? url.searchParams : undefined).catch(() => null)
    // (The values this load of the page names never came: the page is not
    // shown without them, as if they were not set.)
    if (v === 'missing') return new Response('The values of this page did not arrive', { status: 503, headers: HEADERS })
    valued = v
  }
  if (mime.startsWith('text/html')) {
    // A page: whole (no ranges), the guard first, its policy with it.
    let page: Buffer
    let type = mime
    try {
      const raw = valued ?? (await fs.readFile(real))
      type = pageType(raw, mime)
      page = injectGuard(raw)
    } catch {
      return new Response('Not found', { status: 404, headers: HEADERS })
    }
    const headers = { ...HEADERS, 'Content-Type': type, 'Content-Length': String(page.length) }
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(page), { status: 200, headers })
  }
  if (mime.startsWith('text/javascript') && stat.size <= 64 * 1024 * 1024) {
    // A module that imports three.js from a known CDN address: that address
    // mapped to the app's copy (phase 5c, decision 5). Any other script is
    // served as it is, below.
    const raw = valued ?? (await fs.readFile(real).catch(() => null))
    const text = raw ? raw.toString('latin1') : ''
    const mapped = raw ? mapLibraries(text) : text
    if (raw && mapped !== text) {
      const out = Buffer.from(mapped, 'latin1')
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(out), { status: 200, headers: { ...HEADERS, 'Content-Type': mime, 'Content-Length': String(out.length) } })
    }
  }
  if (valued) {
    // A style sheet or a script with values written in: whole (no ranges).
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(valued), { status: 200, headers: { ...HEADERS, 'Content-Type': mime, 'Content-Length': String(valued.length) } })
  }
  const total = stat.size
  let start = 0
  let end = total - 1
  let status = 200
  const range = request.headers.get('range')
  if (range && total > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') start = total - Math.min(parseInt(m[2], 10), total)
      else {
        start = parseInt(m[1], 10)
        if (m[2] !== '') end = Math.min(parseInt(m[2], 10), total - 1)
      }
      if (start > end || start >= total) return new Response('Range not satisfiable', { status: 416, headers: { ...HEADERS, 'Content-Range': `bytes */${total}` } })
      status = 206
    }
  }
  const headers: Record<string, string> = {
    ...HEADERS,
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(total === 0 ? 0 : end - start + 1)
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${total}`
  if (request.method === 'HEAD' || total === 0) return new Response(null, { status, headers })
  return new Response(Readable.toWeb(createReadStream(real, { start, end })) as ReadableStream, { status, headers })
}

/** Parts of a film folder whose changes are not the film's code or sound. */
export function ignoredChange(rel: string): boolean {
  const r = rel.replace(/\\/g, '/').toLowerCase()
  return /(^|\/)(\.videohub|\.surumler|\.git|node_modules|work|tools|src_audio|__pycache__|snipp)(\/|$)/.test(r) || /\.(tmp|swp|log|py|md|snipp)$/.test(r) || r.endsWith('~')
}

/** The Snipp project kept beside a film (VideoHub's "Snipp'te aç"): <film>\snipp\<film>.snipp. The watcher
 *  ignores that folder, so saving the project never reloads the film. */
export function filmProjectPath(root: string): string {
  return pathApi().join(root, 'snipp', pathApi().basename(root) + '.snipp')
}

/** A film folder handed over on the command line: `--code-film=<folder>` (or `--code-film <folder>`). */
export function filmFolderArg(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    const v = /^--code-film=/i.test(a) ? a.slice('--code-film='.length) : a.toLowerCase() === '--code-film' ? argv[i + 1] : undefined
    const p = v?.replace(/^"(.*)"$/, '$1').trim()
    if (p) return p
  }
  return null
}

/** Did the file at `rel` really change? Windows reports a file that was only
 *  READ as changed when its last-access time is updated (at most once an hour
 *  per file, "System Managed" last-access updates; measured in phase 5c): the
 *  film's own server reading its files then reloaded the film, cutting the
 *  frames asked of it ("The code film … was closed"). A file counts as changed
 *  when it is gone, or its size or write time differs from the last one seen,
 *  or (first seen) it was written after the watch began. Directories never. */
export async function reallyChanged(root: string, rel: string, seen: Map<string, string>, since: number): Promise<boolean> {
  const st = await fs.stat(pathApi().join(root, rel)).catch(() => null)
  if (!st) {
    // Gone (deleted, renamed away): a change.
    seen.delete(rel)
    return true
  }
  if (st.isDirectory()) return false
  const key = `${st.size}:${st.mtimeMs}`
  const before = seen.get(rel)
  seen.set(rel, key)
  if (before !== undefined) return before !== key
  return st.mtimeMs >= since - 1000
}

/** A fingerprint of the files a film serves (relative name + size + write
 *  time), the ignored parts left out; null when the folder holds none.
 *  Unlike fs.watch this cannot miss an atomic rename or a save an editor made
 *  through a temp file: the frame paths compare it before drawing. */
export async function filmStamp(root: string): Promise<string | null> {
  const parts: string[] = []
  const MAX = 8000
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > 12 || parts.length >= MAX) return
    let list: Dirent[]
    try {
      list = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of list) {
      if (parts.length >= MAX) return
      const r = rel ? `${rel}/${e.name}` : e.name
      if (ignoredChange(r)) continue
      const full = pathApi().join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full, r, depth + 1)
        continue
      }
      if (!e.isFile()) continue
      const st = await fs.stat(full).catch(() => null)
      if (st) parts.push(`${r.toLowerCase()}:${st.size}:${Math.round(st.mtimeMs)}`)
    }
  }
  await walk(root, '', 0)
  if (!parts.length) return null
  parts.sort()
  return createHash('sha1').update(parts.join('\n')).digest('hex')
}

/** Watches a film folder; `changed` gets the files (relative) after 300 ms of
 *  quiet, only those whose content really changed (reallyChanged). */
export function watchFilm(root: string, changed: (files: string[]) => void): () => void {
  let w: FSWatcher | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const pending = new Set<string>()
  const seen = new Map<string, string>()
  const since = Date.now()
  let closed = false
  try {
    w = watch(root, { recursive: true }, (_e, name) => {
      const rel = typeof name === 'string' ? name : ''
      if (!rel || ignoredChange(rel)) return
      pending.add(rel.replace(/\\/g, '/'))
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const files = [...pending]
        pending.clear()
        void Promise.all(files.map(async (f) => ((await reallyChanged(root, f, seen, since).catch(() => true)) ? f : ''))).then((list) => {
          const real = list.filter(Boolean)
          if (real.length && !closed) changed(real)
        })
      }, 300)
    })
    w.on('error', () => {})
  } catch {
    w = null
  }
  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    w?.close()
  }
}
