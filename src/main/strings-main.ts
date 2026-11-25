// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The main process's own words (SnippStudio phase 9b, decision 2): the
// titles, buttons and filter names of the system dialogs and the crash and
// quit boxes, in English and Turkish. The page says which language it shows
// (app:set-lang, index.ts) whenever it starts or the person changes it; the
// main process has no t() of its own (ui/strings.ts is the page's).
// src/test/faz9b-main-strings.test.ts: every entry in both languages with the
// same parameters, and no system dialog in main written as plain English.
export type MainLang = 'en' | 'tr'

let lang: MainLang = 'en'

/** The language the page shows (anything but 'tr' is English). */
export function setMainLang(next: unknown): void {
  lang = next === 'tr' ? 'tr' : 'en'
}
export const mainLang = (): MainLang => lang

export const MAIN_STRINGS = {
  // the open and save dialogs
  'sfx.title': { en: 'Add sound effects to {app}', tr: '{app} kitaplığına ses efekti ekle' },
  'sfx.button': { en: 'Add to library', tr: 'Kitaplığa ekle' },
  'filter.audio': { en: 'Audio', tr: 'Ses' },
  'filter.media': { en: 'Media', tr: 'Medya' },
  'filter.images': { en: 'Images', tr: 'Resimler' },
  'filter.all': { en: 'All files', tr: 'Bütün dosyalar' },
  'filter.project': { en: '{app} project', tr: '{app} projesi' },
  'codeFilm.title': { en: 'Add a code film (a folder with index.html)', tr: 'Kod filmi ekle (index.html olan bir klasör)' },
  'media.title': { en: 'Import media', tr: 'Medya içe aktar' },
  'image.title': { en: 'Replace timeline image', tr: 'Çizelgedeki resmi değiştir' },
  'image.button': { en: 'Replace image', tr: 'Resmi değiştir' },
  'project.open': { en: 'Open project', tr: 'Proje aç' },
  'open.missing': { en: 'That project file is not there.', tr: 'O proje dosyası yerinde yok.' },
  ok: { en: 'OK', tr: 'Tamam' },
  'project.exportFolder': { en: 'Choose a folder for the exported files', tr: 'Dışa aktarılan dosyalar için bir klasör seç' },
  'project.findFolders': { en: 'Find projects in these folders', tr: 'Bu klasörlerde proje bul' },
  // the sample project's folder and file (phase 9b)
  'sample.name': { en: 'Sample project', tr: 'Örnek proje' },
  // the crash box (the editor page stopped)
  'crash.reload': { en: 'Reload', tr: 'Yeniden yükle' },
  'crash.close': { en: 'Close', tr: 'Kapat' },
  'crash.message': { en: 'The editor stopped ({reason}).', tr: 'Düzenleyici durdu ({reason}).' },
  'crash.kept': { en: 'The last crash-recovery snapshot of your work is kept. {app} offers it when the editor starts again.', tr: 'İşinin son kurtarma kopyası saklandı. {app} düzenleyici yeniden açılınca onu önerir.' },
  'crash.none': { en: 'No crash-recovery snapshot of this work was written yet (one is written ten seconds after the last change while there are unsaved changes).', tr: 'Bu işin henüz kurtarma kopyası yazılmadı (kaydedilmemiş değişiklik varken son değişiklikten on saniye sonra yazılır).' },
  // the quit box (the page did not answer the close)
  'quit.discard': { en: 'Quit without saving', tr: 'Kaydetmeden çık' },
  'quit.cancel': { en: 'Cancel', tr: 'Vazgeç' },
  'quit.message': { en: 'You have unsaved changes.', tr: 'Kaydedilmemiş değişikliklerin var.' },
  'quit.detail': { en: 'Quit anyway?', tr: 'Yine de çıkılsın mı?' },
  // a voice-over's folder (in the project's folder; in the profile for a
  // project never saved) and its file (REF-AB, worker S)
  'voiceover.folder': { en: 'Voiceover', tr: 'Seslendirme' },
  'voiceover.profileFolder': { en: 'Voiceovers', tr: 'Seslendirmeler' },
  'voiceover.file': { en: 'Voiceover {when}', tr: 'Seslendirme {when}' }
} satisfies Record<string, { en: string; tr: string }>

export type MainKey = keyof typeof MAIN_STRINGS

/** The save dialog's filter name the page sends ("MP4 video", "SubRip
 *  subtitles", "SnippStudio project"), in the page's language: the format's
 *  name stays, the kind of file is said in Turkish. */
const KINDS: Record<string, string> = { video: 'videosu', audio: 'sesi', image: 'resmi', subtitles: 'altyazısı', project: 'projesi' }
export function filterName(name: unknown): string {
  const s = typeof name === 'string' ? name : ''
  if (lang !== 'tr') return s
  const m = /^(.+) (video|audio|image|subtitles|project)$/.exec(s)
  return m ? `${m[1]} ${KINDS[m[2]]}` : s
}

/** A main-process text in the page's language; `{name}` takes its parameter. */
export function mt(key: MainKey, params?: Record<string, string | number>): string {
  const e = MAIN_STRINGS[key]
  const text = lang === 'tr' ? e.tr : e.en
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text
}
