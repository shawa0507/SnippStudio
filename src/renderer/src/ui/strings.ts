// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The interface's words, by key (SnippStudio phase 3a.3). Every text a new
// panel shows comes from here through t() or useT(): JSX text, title,
// aria-label, placeholder and toasts (src/test/ui-text.test.ts rejects plain
// text in every file of the interface). English is the default and always
// there; every key has its Turkish too (src/test/strings-all.test.ts).
//
// The chosen language lives in the store (uiLang, setUiLang; kept in
// localStorage), which tells this module with setLang(): this module does not
// import the store, so the building blocks and their tests stay light.
import { useSyncExternalStore } from 'react'
import { PRODUCT_NAME } from '../../../shared/product'
import { keysInText } from '../os-platform'
import { STRINGS_3C } from './strings-3c'
import { STRINGS_3C3 } from './strings-3c3'
import { STRINGS_3C4 } from './strings-3c4'
import { STRINGS_3C2 } from './strings-3c2'
import { STRINGS_CILA_O } from './strings-cila-o'
import { STRINGS_GUV } from './strings-guv'
import { STRINGS_CILA_S } from './strings-cila-s'
import { STRINGS_CILA_B } from './strings-cila-b'
import { STRINGS_CILA_D } from './strings-cila-d'
import { STRINGS_CILA_K } from './strings-cila-k'
import { STRINGS_CILA_A } from './strings-cila-a'
import { STRINGS_CILA_C } from './strings-cila-c'
import { STRINGS_HIS } from './strings-his'
import { STRINGS_CILA_T } from './strings-cila-t'
import { STRINGS_3C4B } from './strings-3c4b'
import { STRINGS_YAMA_B } from './strings-yama-b'
import { STRINGS_YAMA_A } from './strings-yama-a'
import { STRINGS_FAZ9_A } from './strings-faz9-a'
import { STRINGS_FAZ9_B } from './strings-faz9-b'
import { STRINGS_F9Y_D } from './strings-f9y-d'
import { STRINGS_FAZ10 } from './strings-faz10'
import { STRINGS_FAZ11B } from './strings-faz11b'
import { STRINGS_UI3 } from './strings-ui3'
import { STRINGS_UI4 } from './strings-ui4'
import { STRINGS_KLISTE } from './strings-kliste'
import { STRINGS_AYARLAR } from './strings-ayarlar'
import { STRINGS_GONDER } from './strings-gonder'
import { STRINGS_GONDER2 } from './strings-gonder2'
import { STRINGS_DEN1_C } from './strings-den1-c'
import { STRINGS_DEN2_T } from './strings-den2-t'
import { STRINGS_DEN1_P } from './strings-den1-p'
import { STRINGS_DEN2_U } from './strings-den2-u'
import { STRINGS_ONIZLEME } from './strings-onizleme'
import { STRINGS_DEN2_N } from './strings-den2-n'
import { STRINGS_DEN4_W } from './strings-den4-w'
import { STRINGS_REF_I } from './strings-ref-i'
import { STRINGS_YAZI } from './strings-yazi'
import { STRINGS_YAZI2 } from './strings-yazi2'
import { STRINGS_REF_P } from './strings-ref-p'
import { STRINGS_REF_S } from './strings-ref-s'
import { STRINGS_D22_B } from './strings-d22-b'
import { STRINGS_D22_A } from './strings-d22-a'
import { STRINGS_D22_D } from './strings-d22-d'
import { STRINGS_SESSIZ } from './strings-sessiz'
import { STRINGS_SIHIRBAZ } from './strings-sihirbaz'
import { STRINGS_D22_C } from './strings-d22-c'
import { STRINGS_IZLE } from './strings-izle'
import { STRINGS_KULLANIM } from './strings-kullanim'
import { STRINGS_KAPSAM } from './strings-kapsam'
import { STRINGS_TOKEN } from './strings-token'
import { STRINGS_KOLAY } from './strings-kolay'
import { STRINGS_CILA3 } from './strings-cila3'
import { STRINGS_EKIP } from './strings-ekip'
import { STRINGS_EKIP3 } from './strings-ekip3'
import { STRINGS_CHAT } from './strings-chat'

export type Lang = 'en' | 'tr'
export const LANGS: readonly Lang[] = ['en', 'tr']

/** One text: English always, Turkish when written. `{name}` is a parameter. */
export interface Entry {
  en: string
  tr?: string
}

export const STRINGS = {
  // ---- the building blocks' own words --------------------------------------
  'ui.dialog.close': { en: 'Close', tr: 'Kapat' },
  'ui.toast.dismiss': { en: 'Dismiss', tr: 'Kapat' },
  'ui.toast.region': { en: 'Notifications', tr: 'Bildirimler' },
  'ui.slider.value': { en: '{label} value', tr: '{label} değeri' },
  'ui.chip.remove': { en: 'Remove {label}', tr: '{label} kaldır' },

  // ---- the building blocks page (#ui-kit; development and test runs only) --
  'kit.title': { en: 'Building blocks', tr: 'Yapı taşları' },
  'kit.lead': { en: 'Every part a new panel is made of, in every state. Values: TASARIM.md.', tr: 'Yeni bir panelin yapıldığı her parça, her durumuyla. Değerler: TASARIM.md.' },
  'kit.lang': { en: 'Language', tr: 'Dil' },
  'kit.lang.en': { en: 'English', tr: 'İngilizce' },
  'kit.lang.tr': { en: 'Turkish', tr: 'Türkçe' },
  'kit.section.buttons': { en: 'Buttons · one height (28), small (24)', tr: 'Düğmeler · tek yükseklik (28), küçük (24)' },
  'kit.section.iconButtons': { en: 'Icon buttons · square, named', tr: 'Simge düğmeleri · kare, adlı' },
  'kit.section.fields': { en: 'Fields', tr: 'Alanlar' },
  'kit.section.sliders': { en: 'Sliders · label, track, number in one row', tr: 'Kaydırıcılar · etiket, iz, sayı tek satırda' },
  'kit.section.choices': { en: 'Switches and checkboxes', tr: 'Anahtarlar ve onay kutuları' },
  'kit.section.segmented': { en: 'Segmented · one design', tr: 'Parçalı seçim · tek tasarım' },
  'kit.section.tabs': { en: 'Tabs · words, a line under the chosen one', tr: 'Sekmeler · yazı, seçilinin altında çizgi' },
  'kit.section.menu': { en: 'Menu · one surface, shortcuts on the right', tr: 'Menü · tek yüzey, kısayol sağda' },
  'kit.section.dialog': { en: 'Dialog', tr: 'İletişim kutusu' },
  'kit.section.tooltip': { en: 'Tooltip · 400 ms, with its shortcut', tr: 'İpucu · 400 ms, kısayoluyla' },
  'kit.section.toasts': { en: 'Toasts · stacked, with an action', tr: 'Bildirimler · üst üste, eylemli' },
  'kit.section.chips': { en: 'Chips', tr: 'Çipler' },
  'kit.section.icons': { en: 'Icons · {count} from Lucide', tr: 'Simgeler · Lucide’dan {count}' },
  'kit.export': { en: 'Export', tr: 'Dışa aktar' },
  'kit.secondary': { en: 'Secondary', tr: 'İkincil' },
  'kit.plain': { en: 'Plain', tr: 'Sade' },
  'kit.delete': { en: 'Delete', tr: 'Sil' },
  'kit.import': { en: 'Import', tr: 'İçe aktar' },
  'kit.disabled': { en: 'Disabled', tr: 'Devre dışı' },
  'kit.split': { en: 'Split', tr: 'Böl' },
  'kit.lock': { en: 'Lock', tr: 'Kilitle' },
  'kit.more': { en: 'More', tr: 'Daha fazla' },
  'kit.snap': { en: 'Snapping', tr: 'Yapışma' },
  'kit.projectName': { en: 'Project name', tr: 'Proje adı' },
  'kit.projectName.value': { en: 'Interview rough cut', tr: 'Röportaj kaba kurgu' },
  'kit.search': { en: 'Search', tr: 'Ara' },
  'kit.search.placeholder': { en: 'Search the subtitles', tr: 'Altyazıda ara' },
  'kit.frameRate': { en: 'Frame rate', tr: 'Kare hızı' },
  'kit.fps': { en: '{n} fps', tr: '{n} fps' },
  'kit.duration': { en: 'Duration', tr: 'Süre' },
  'kit.locked': { en: 'Locked', tr: 'Kilitli' },
  'kit.scale': { en: 'Scale', tr: 'Ölçek' },
  'kit.opacity': { en: 'Opacity', tr: 'Opaklık' },
  'kit.volume': { en: 'Volume', tr: 'Ses' },
  'kit.blur': { en: 'Blur', tr: 'Bulanıklık' },
  'kit.agentAccess': { en: 'Agent access', tr: 'Ajan erişimi' },
  'kit.snapping': { en: 'Snapping', tr: 'Yapışma' },
  'kit.proxies': { en: 'Proxy files', tr: 'Vekil dosyalar' },
  'kit.snapEdges': { en: 'Snap to edges', tr: 'Kenarlara yapış' },
  'kit.allClips': { en: 'All clips', tr: 'Bütün klipler' },
  'kit.someClips': { en: 'Some clips', tr: 'Bazı klipler' },
  'kit.fit': { en: 'Fit', tr: 'Sığdır' },
  'kit.fill': { en: 'Fill', tr: 'Doldur' },
  'kit.stretch': { en: 'Stretch', tr: 'Uzat' },
  'kit.picture': { en: 'Picture size', tr: 'Görüntü boyutu' },
  'kit.tab.clip': { en: 'Clip', tr: 'Klip' },
  'kit.tab.look': { en: 'Look', tr: 'Görünüm' },
  'kit.tab.subs': { en: 'Subtitles', tr: 'Altyazı' },
  'kit.tab.notes': { en: 'Notes', tr: 'Notlar' },
  'kit.tab.agent': { en: 'Agent', tr: 'Ajan' },
  'kit.tabs': { en: 'Properties', tr: 'Özellikler' },
  'kit.menu.split': { en: 'Split', tr: 'Böl' },
  'kit.menu.duplicate': { en: 'Duplicate', tr: 'Çoğalt' },
  'kit.menu.link': { en: 'Link audio and video', tr: 'Sesi ve görüntüyü bağla' },
  'kit.menu.disabled': { en: 'Paste keyframe', tr: 'Anahtar kare yapıştır' },
  'kit.menu.delete': { en: 'Delete', tr: 'Sil' },
  'kit.menu.open': { en: 'Clip menu', tr: 'Klip menüsü' },
  'kit.menu.chose': { en: 'Chose: {item}', tr: 'Seçilen: {item}' },
  'kit.dialog.title': { en: 'Export the video', tr: 'Videoyu dışa aktar' },
  'kit.dialog.body': { en: 'A shell: a title, its content, the actions at the bottom right. Escape closes it; Tab stays inside.', tr: 'Bir kabuk: başlık, içerik, sağ altta eylemler. Escape kapatır; Tab içeride kalır.' },
  'kit.dialog.open': { en: 'Open the dialog', tr: 'İletişim kutusunu aç' },
  'kit.cancel': { en: 'Cancel', tr: 'Vazgeç' },
  'kit.tooltip.split': { en: 'Split the clip at the playhead', tr: 'Klibi oynatma çizgisinde böl' },
  'kit.toast.cuts': { en: '{n} cuts applied', tr: '{n} kesim uygulandı' },
  'kit.toast.saved': { en: 'Project saved', tr: 'Proje kaydedildi' },
  'kit.toast.failed': { en: 'The export stopped: the disk is full', tr: 'Dışa aktarma durdu: disk dolu' },
  'kit.toast.show': { en: 'Show a toast', tr: 'Bildirim göster' },
  'kit.undo': { en: 'Undo', tr: 'Geri al' },
  'kit.undone': { en: 'Undone', tr: 'Geri alındı' },
  'kit.chip.live': { en: 'Live', tr: 'Canlı' },
  'kit.chip.agent': { en: 'Agent writing', tr: 'Ajan yazıyor' },
  'kit.chip.note': { en: 'Note 3', tr: 'Not 3' },
  'kit.chip.error': { en: 'Failed', tr: 'Başarısız' },
  'kit.chip.plain': { en: '1 clip', tr: '1 klip' },
  'kit.chip.filter': { en: 'Video', tr: 'Video' },

  // ---- the panels moved onto the building blocks in phase 3c (ui/strings-3c.ts)
  ...STRINGS_3C,
  ...STRINGS_3C3,
  ...STRINGS_3C4,
  ...STRINGS_3C2,
  // ---- cila O and E: Fit to voice, the encoder choice (ui/strings-cila-o.ts)
  ...STRINGS_CILA_O,
  ...STRINGS_GUV,
  ...STRINGS_CILA_S,
  ...STRINGS_CILA_B,
  ...STRINGS_CILA_D,
  // ---- cila K: code values (ui/strings-cila-k.ts)
  ...STRINGS_CILA_K,
  // ---- cila A: editing in the preview (ui/strings-cila-a.ts)
  ...STRINGS_CILA_A,
  ...STRINGS_CILA_C,
  ...STRINGS_HIS,
  // ---- cila T: transitions and the timeline's tools (ui/strings-cila-t.ts)
  ...STRINGS_CILA_T,
  // ---- phase 3c.4b: the close of the interface's move (ui/strings-3c4b.ts)
  ...STRINGS_3C4B,
  // ---- the interface audit patch, worker B (ui/strings-yama-b.ts)
  ...STRINGS_YAMA_B,
  // ---- the interface audit's patch, worker A (ui/strings-yama-a.ts)
  ...STRINGS_YAMA_A,
  ...STRINGS_FAZ9_A,
  // ---- phase 9b, worker II: engine messages, tour, sample project (ui/strings-faz9-b.ts)
  ...STRINGS_FAZ9_B,
  // ---- the phase 9 audit patch, worker D (ui/strings-f9y-d.ts)
  ...STRINGS_F9Y_D,
  // ---- phase 10: macOS and Linux (ui/strings-faz10.ts)
  ...STRINGS_FAZ10,
  // ---- phase 11b, the fix round (ui/strings-faz11b.ts)
  ...STRINGS_FAZ11B,
  // ---- the new interface, v3 (ui/strings-ui3.ts)
  ...STRINGS_UI3,
  // ---- arayüz v4 (ui/strings-ui4.ts)
  ...STRINGS_UI4,
  // ---- the user's list (ui/strings-kliste.ts)
  ...STRINGS_KLISTE,
  ...STRINGS_AYARLAR,
  ...STRINGS_GONDER,
  ...STRINGS_GONDER2,
  ...STRINGS_DEN1_C,
  ...STRINGS_DEN2_T,
  // ---- the user's first try, worker P (ui/strings-den1-p.ts)
  ...STRINGS_DEN1_P,
  // ---- the user's second and third tries, worker U (ui/strings-den2-u.ts)
  ...STRINGS_DEN2_U,
  ...STRINGS_ONIZLEME,
  // ---- the user's second try, worker N (ui/strings-den2-n.ts)
  ...STRINGS_DEN2_N,
  // ---- the user's fourth try, worker W (ui/strings-den4-w.ts)
  ...STRINGS_DEN4_W,
  // ---- REF-AB, worker I: the Inspector's reset, key arrows, speed shapes, animations (ui/strings-ref-i.ts)
  ...STRINGS_REF_I,
  // ---- the Text page made clearer (ui/strings-yazi.ts)
  ...STRINGS_YAZI,
  // ---- a title in the preview: the quick bar, typing in place, a card dragged (ui/strings-yazi2.ts)
  ...STRINGS_YAZI2,
  // ---- REF-AB, worker P2 (ui/strings-ref-p.ts)
  ...STRINGS_REF_P,
  // ---- REF-AB, worker S: voiceover, the subtitles' source and style grid (ui/strings-ref-s.ts)
  ...STRINGS_REF_S,
  ...STRINGS_D22_B,
  // ---- D22, worker A: an agent's edit in the user's words (ui/strings-d22-a.ts)
  ...STRINGS_D22_A,
  // ---- 22 November, worker D: interface details (ui/strings-d22-d.ts)
  ...STRINGS_D22_D,
  // ---- Dalga 2, S: where "Remove silence" cuts (ui/strings-sessiz.ts)
  ...STRINGS_SESSIZ,
  // ---- Dalga 2, worker W: the connection wizard (ui/strings-sihirbaz.ts)
  ...STRINGS_SIHIRBAZ,
  ...STRINGS_D22_C,
  // ---- Dalga 3, İ: the watch-and-note mode (ui/strings-izle.ts)
  ...STRINGS_IZLE,
  ...STRINGS_KULLANIM,
  ...STRINGS_KAPSAM,
  // ---- Dalga 3, worker T: tokens and progress (ui/strings-token.ts)
  ...STRINGS_TOKEN,
  // ---- worker kolay: GIF, timeline search, labels, the job's summary (ui/strings-kolay.ts)
  ...STRINGS_KOLAY,
  // ---- small polish, worker cila3 (ui/strings-cila3.ts)
  ...STRINGS_CILA3,
  ...STRINGS_EKIP,
  ...STRINGS_EKIP3,
  ...STRINGS_CHAT,

  // ---- the agent (phase 4A: toasts and the words 4B's Agent tab shows) -----
  'agent.edited': { en: 'Agent: {what}. Ctrl+Z undoes it.', tr: 'Ajan: {what}. Ctrl+Z geri alır.' },
  'agent.noteAnswered': { en: 'Agent answered note #{num}: {reply}', tr: 'Ajan #{num} notunu yanıtladı: {reply}' },
  'agent.look': { en: 'Look', tr: 'Bak' },
  'agent.restored': { en: 'The project is back as it was before the agent.', tr: 'Proje ajandan önceki hâline döndü.' },
  'agent.transcribed': { en: 'Agent made {count} subtitle lines.', tr: 'Ajan {count} altyazı satırı üretti.' },
  'agent.retranscribed': { en: 'The agent made the subtitles again ({count} lines).', tr: 'Ajan altyazıları yeniden üretti ({count} satır).' },
  'agent.undo': { en: 'Undo', tr: 'Geri al' },
  'agent.undoNotNewest': { en: 'Other changes were made after it, so nothing was undone. Use Ctrl+Z step by step, or go back to before the agent.', tr: 'Ardından başka değişiklikler yapıldı; hiçbir şey geri alınmadı. Ctrl+Z ile adım adım geri al ya da ajan öncesine dön.' },
  'agent.restoreFull': { en: '{count} more agent restore points are kept than the usual 40: the points before the agent of your projects are never deleted to make room.', tr: 'Ajan geri dönüş noktaları olağan 40 dosyayı {count} aştı: projelerinizin ajan öncesi noktaları yer açmak için silinmez.' },
  'agent.restoreFailed': { en: 'The point before the agent could not be written to disk; it is kept until {app} closes.', tr: 'Ajan öncesi nokta diske yazılamadı; {app} kapanana kadar bellekte duruyor.' },
  'agent.tokensNote': { en: "The agent's own thinking and writing are not included: only what {app}'s tools sent it.", tr: 'Ajanın kendi düşünme ve yazma maliyeti dahil değil: yalnızca {app} araçlarının ona gönderdikleri.' },

  // ---- the agent session, command box and Agent tab (phase 4B) -------------
  'agent.tab': { en: 'Agent', tr: 'Ajan' },
  'agent.tabTitle': { en: 'Your agent: connect it, follow what it does, decide on its draft', tr: 'Ajanın: bağla, ne yaptığını izle, taslağına karar ver' },
  'agent.state.off': { en: 'Not connected. Nothing listens and nothing of the agent runs.', tr: 'Bağlı değil. Hiçbir şey dinlemiyor, ajanla ilgili hiçbir şey çalışmıyor.' },
  'agent.state.external': { en: 'Connected · from outside ({client})', tr: 'Bağlı · dışarıdan ({client})' },
  'agent.name.opencode': { en: 'OpenCode', tr: 'OpenCode' },
  'agent.picker.plan': { en: '19 November 2026 · Use a plan that includes CLI access. If you subscribe on the web, install the provider’s CLI and sign in there with the same account. Sign-in options differ by tool; not every subscription works in every tool.', tr: '19 Kasım 2026 · Komut satırı erişimi olan bir plan gerekir. Web’de abone olduysan sağlayıcının komut satırı aracını kur ve aynı hesapla orada oturum aç. Giriş seçenekleri araca göre değişir; her abonelik her araçta geçmez.' },
  'agent.state.error': { en: 'Not running: {error}', tr: 'Çalışmıyor: {error}' },
  'agent.name.claude': { en: 'Claude Code', tr: 'Claude Code' },
  'agent.name.codex': { en: 'Codex', tr: 'Codex' },
  'agent.name.local': { en: 'Ready command', tr: 'Hazır komut' },
  'agent.mode.label': { en: "The agent's changes", tr: 'Ajanın değişiklikleri' },
  'agent.settings.title': { en: 'Agent settings', tr: 'Ajan ayarları' },
  'agent.settings.frameWidth': { en: 'Default frame width', tr: 'Varsayılan kare genişliği' },
  'agent.settings.pixels': { en: '{value} px', tr: '{value} piksel' },
  'agent.mode.draft': { en: 'As a draft', tr: 'Taslak olarak' },
  'agent.mode.direct': { en: 'Apply directly', tr: 'Doğrudan uygula' },
  'agent.box.label': { en: 'Write a job, or pick a ready one', tr: 'Bir iş yaz ya da hazır birini seç' },
  'agent.box.selected': { en: 'About:', tr: 'Seçili:' },
  'agent.box.whole': { en: 'Nothing selected: the request is about the whole project.', tr: 'Seçim yok: istek bütün projeyle ilgili.' },
  'agent.box.clips': { en: 'Clips: {count}', tr: '{count} klip' },
  'agent.box.media': { en: 'Files: {count}', tr: '{count} dosya' },
  'agent.box.range': { en: '{from}–{to}', tr: '{from}–{to}' },
  'agent.box.region': { en: 'Region {w}×{h} %', tr: 'Bölge {w}×{h} %' },
  'agent.box.drawRegion': { en: 'Mark a region on the frame', tr: 'Karede bölge işaretle' },
  'agent.box.drawing': { en: 'Drag a rectangle on the frame', tr: 'Karede bir dikdörtgen sürükle' },
  'agent.box.status.local': { en: 'Done here: it did not go to the agent (0 tokens)', tr: 'Burada yapıldı: ajana gitmedi (0 token)' },
  'agent.ready.title': { en: 'Done here, without the agent: 0 tokens', tr: 'Burada yapılır, ajana gitmez: 0 token' },
  'agent.ready.silences': { en: 'Cut silences', tr: 'Sessizlikleri kes' },
  'agent.ready.repeats': { en: 'Find retakes', tr: 'Tekrarları bul' },
  'agent.ready.fillers': { en: 'Find fillers', tr: 'Dolguları bul' },
  'agent.ready.subtitles': { en: 'Make subtitles', tr: 'Altyazı üret' },
  'agent.ready.loudness': { en: 'Even out loudness', tr: 'Ses seviyesini eşitle' },
  'agent.ready.images': { en: 'Place pictures on the narration', tr: 'Görselleri seslendirmeye diz' },
  'agent.ready.none': { en: '{what}: nothing found.', tr: '{what}: bir şey bulunamadı.' },
  'agent.ready.busy': { en: "The agent's draft is waiting: accept or reject it first.", tr: 'Ajanın taslağı bekliyor: önce kabul et ya da reddet.' },
  'agent.ready.failed': { en: 'Could not do it: {error}', tr: 'Yapılamadı: {error}' },
  'agent.ready.drafted': { en: '{what}: a draft waits in the Agent tab.', tr: '{what}: taslak Ajan sekmesinde bekliyor.' },
  'agent.cancel': { en: 'Cancel', tr: 'Vazgeç' },
  'agent.draft.before': { en: 'Before', tr: 'Önce' },
  'agent.draft.after': { en: 'After', tr: 'Sonra' },
  'agent.draft.updating': { en: 'You changed the film: the draft is being worked out again.', tr: 'Filmi değiştirdin: taslak yeniden hesaplanıyor.' },
  'agent.draft.refresh': { en: 'Update the draft', tr: 'Taslağı güncelle' },
  'agent.draft.revive': { en: 'Bring back', tr: 'Geri getir' },
  'agent.draft.changed': { en: 'The project changed since the card was drawn: nothing was accepted. Look again.', tr: 'Kart çizildikten sonra proje değişti: hiçbir şey kabul edilmedi. Yeniden bak.' },
  'agent.draft.accepted': { en: 'Accepted as one step: Ctrl+Z takes it back.', tr: 'Tek adımda kabul edildi: Ctrl+Z geri alır.' },
  'agent.draft.partial': { en: 'Accepted in part: {dropped} left out.', tr: 'Kısmen kabul edildi: {dropped} dışarıda kaldı.' },
  'agent.draft.nothing': { en: 'Nothing to accept: all of it was dropped.', tr: 'Kabul edilecek bir şey yok: hepsi düştü.' },
  'agent.draft.rejected': { en: 'Draft rejected.', tr: 'Taslak reddedildi.' },
  'agent.draft.disconnected': { en: 'The agent connection closed; the draft waits for you.', tr: 'Ajan bağlantısı kapandı; taslak seni bekliyor.' },
  'agent.draft.broken': { en: 'The draft could not be worked out ({why}): it can be rejected.', tr: 'Taslak hesaplanamadı ({why}): reddedilebilir.' },
  'agent.draft.failed': { en: 'Not accepted: {error}', tr: 'Kabul edilmedi: {error}' },
  'agent.steps.title': { en: 'Steps', tr: 'Adımlar' },
  'agent.steps.none': { en: 'No tool calls yet.', tr: 'Henüz araç çağrısı yok.' },
  'agent.steps.back': { en: 'Back to here', tr: 'Buraya kadar geri dön' },
  'agent.steps.backTitle': { en: 'Back to after this step?', tr: 'Bu adımın sonrasına dönülsün mü?' },
  // (Phase 11b, C21: it says that the user's own edits after the step go back too.)
  'agent.steps.backAsk': { en: 'The project goes back to how it was right after this step: everything changed after it goes too, your own edits as well as the agent’s. It is one undo step: Ctrl+Z brings it all back.', tr: 'Proje bu adımın hemen sonraki hâline döner: ondan sonra değişen her şey gider, ajanınkiler kadar senin kendi düzenlemelerin de. Tek geri alma adımıdır: Ctrl+Z hepsini geri getirir.' },
  'agent.steps.backDone': { en: 'Back to after step {n}.', tr: '{n}. adımın sonrasına dönüldü.' },
  'agent.steps.time': { en: '{ms} ms', tr: '{ms} ms' },
  'agent.steps.tokens': { en: '≈ {n}', tr: '≈ {n}' },
  'agent.tool.project': { en: 'Read the project', tr: 'Projeyi okudu' },
  'agent.tool.transcript': { en: 'Read the transcript', tr: 'Konuşma metnini okudu' },
  'agent.tool.frames': { en: 'Frames looked at: {count}', tr: '{count} kareye baktı' },
  'agent.tool.changes': { en: 'Read the changes', tr: 'Değişiklikleri okudu' },
  'agent.tool.analyze': { en: 'Analysed: {kind}', tr: 'İnceledi: {kind}' },
  'agent.tool.found': { en: 'Found {count}: {kind}', tr: '{count} buldu: {kind}' },
  'agent.tool.edit': { en: 'Edited: {kind}', tr: 'Düzenledi: {kind}' },
  'agent.tool.notes': { en: 'Notes', tr: 'Notlar' },
  'agent.tool.job': { en: 'Job: {kind}', tr: 'İş: {kind}' },
  'agent.tool.other': { en: '{tool}', tr: '{tool}' },
  'agent.tool.failed': { en: '{what} (failed)', tr: '{what} (başarısız)' },
  'agent.restore.button': { en: 'Back to before the agent', tr: 'Ajan öncesine dön' },
  'agent.restore.title': { en: 'Back to before the agent?', tr: 'Ajan öncesine dönülsün mü?' },
  'agent.restore.ask': { en: "The project goes back to how it was before the agent changed it, as one undo step: Ctrl+Z brings the agent's work back.", tr: 'Proje, ajan değiştirmeden önceki hâline döner, tek geri alma adımıyla: Ctrl+Z ajanın işini geri getirir.' },
  'agent.restore.failed': { en: 'Could not go back: {error}', tr: 'Dönülemedi: {error}' },
  'agent.confirm': { en: 'Go back', tr: 'Geri dön' },
  'agent.meter.title': { en: 'What the agent read this session', tr: 'Bu oturumda ajanın okuduğu' },
  'agent.meter.value': { en: '≈ {n} tokens', tr: '≈ {n} token' },
  'agent.meter.split': { en: 'Text {text} % · frames {frames} % · tool list {defs} %', tr: 'Metin %{text} · kareler %{frames} · araç listesi %{defs}' },
  'agent.looked': { en: 'The agent looked at this frame', tr: 'Ajan bu kareye baktı' },
  'agent.reading': { en: 'agent reading', tr: 'ajan okuyor' },
  'agent.showingAfter': { en: 'Showing the draft (after)', tr: 'Taslak gösteriliyor (sonra)' },

  // ---- opening a project file (phase Ç2a.1: model/repair.ts, model/format.ts)
  'project.file.damaged': { en: 'This project file is damaged or cut short and cannot be read.', tr: 'Bu proje dosyası bozuk ya da yarım kalmış; okunamıyor.' },
  'project.file.notProject': { en: 'This file is not a {app} project.', tr: 'Bu dosya bir {app} projesi değil.' },
  'project.file.newerType': { en: 'This project was made by a much newer {app} and cannot be opened by this version.', tr: 'Bu proje çok daha yeni bir {app} ile yapılmış; bu sürüm açamıyor.' },
  'project.repaired': { en: 'The file had problems and was repaired: {list}. Save to keep the repair.', tr: 'Dosyada sorunlar vardı, onarıldı: {list}. Onarımı korumak için kaydet.' },
  'project.repair.shape': { en: '{n} unreadable part(s) of the file filled in', tr: 'dosyanın okunamayan {n} bölümü dolduruldu' },
  'project.repair.settings': { en: 'canvas size or frame rate set to the default', tr: 'tuval boyutu ya da kare hızı varsayılana döndü' },
  'project.repair.clipTime': { en: '{n} clip time(s) corrected', tr: '{n} klip zamanı düzeltildi' },
  'project.repair.clipDroppedTime': { en: '{n} clip(s) with no readable time removed', tr: 'okunur zamanı olmayan {n} klip çıkarıldı' },
  'project.repair.clipDroppedAsset': { en: '{n} clip(s) whose media entry is missing removed', tr: 'medya kaydı olmayan {n} klip çıkarıldı' },
  'project.repair.trackMade': { en: '{n} missing track(s) made again', tr: 'eksik {n} şerit yeniden yapıldı' },
  'project.repair.trackList': { en: 'track lists rebuilt from their clips', tr: 'şerit listeleri kliplerinden yeniden kuruldu' },
  'project.repair.duplicateId': { en: '{n} repeated id(s) made unique', tr: 'yinelenen {n} kimlik tekilleştirildi' },
  'project.repair.overlap': { en: '{n} clip(s) moved later so {n|it no longer overlaps|they no longer overlap}', tr: '{n} klip üst üste binmesin diye ileri alındı' },
  'project.repair.mediaEnd': { en: '{n} clip(s) shortened to the end of their media', tr: '{n} klip medyasının sonuna kadar kısaltıldı' },
  'project.repair.link': { en: '{n} link(s) to a missing clip removed', tr: 'olmayan bir klibe giden {n} bağ kaldırıldı' },
  'project.repair.reference': { en: '{n} reference(s) to missing parts removed', tr: 'olmayan parçalara giden {n} gönderme kaldırıldı' },
  'project.repair.keys': { en: 'keyframes put in order, unreadable or doubled ones removed ({n} list(s))', tr: 'anahtar kareler sıraya kondu, okunamayan ya da aynı andaki fazlalar çıkarıldı ({n} liste)' },
  'project.repair.captionDropped': { en: '{n} text(s) with no readable time removed', tr: 'okunur zamanı olmayan {n} yazı çıkarıldı' },
  'project.repair.noteDropped': { en: '{n} unreadable work note(s) or drawing stroke(s) removed', tr: 'okunamayan {n} iş notu ya da çizim çıkarıldı' },
  'project.repair.templateUnknown': { en: '{n} graphic(s) of a kind this version does not know kept in the file, not shown', tr: 'bu sürümün bilmediği türden {n} grafik dosyada tutuldu, gösterilmiyor' },
  'project.repair.templateDropped': { en: '{n} unreadable graphic(s) removed', tr: 'okunamayan {n} grafik çıkarıldı' },
  'project.repair.uid': { en: 'the project got a new identity (the old one could not name its backup folder)', tr: 'projeye yeni bir kimlik verildi (eskisiyle yedek klasörü adlandırılamıyordu)' },
  'project.newer.title': { en: 'Saved by a newer {app}', tr: 'Daha yeni bir {app} ile kaydedilmiş' },
  'project.newer.message': { en: 'This file was saved by a newer version of {app} (file format {file}; this version writes {mine}). Saving over it can lose what this version does not know.', tr: 'Bu dosya daha yeni bir {app} sürümüyle kaydedilmiş (dosya biçimi {file}; bu sürüm {mine} yazar). Üstüne kaydetmek, bu sürümün bilmediklerini kaybettirebilir.' },
  'project.newer.saveOver': { en: 'Save over it', tr: 'Üstüne kaydet' },
  'project.newer.saveAs': { en: 'Save as a copy', tr: 'Kopya olarak kaydet' },
  'project.newer.cancel': { en: 'Cancel', tr: 'Vazgeç' },
  'media.inCompound': { en: '"{name}" is used inside a compound clip: take the compound apart or delete it first.', tr: '"{name}" bir bileşik klibin içinde kullanılıyor: önce bileşiği aç ya da sil.' },
  // ---- ripple, links, locks (phase Ç2b.1)
  'timeline.lockedBehind': { en: 'Locked track {names} did not move with the cut: it is out of step with the rest from {time} s on.', tr: 'Kilitli şerit {names} kesimle birlikte kaymadı: {time} sn sonrasında diğerleriyle eşzamanlı değil.' },
  'keyframe.easing.hold': { en: 'hold', tr: 'basamak' },
  'keyframe.pasteScaled': { en: 'Paste all keyframes, stretched to this clip', tr: 'Tüm anahtar kareleri bu klibe yayarak yapıştır' },
  'keyframe.pasteScaled.title': { en: 'The copied move spread over the whole length of this clip (its key times scaled)', tr: 'Kopyalanan hareket bu klibin tüm süresine yayılır (anahtar zamanları ölçeklenir)' },
  'keyframe.prev': { en: 'Previous keyframe', tr: 'Önceki anahtar kare' },
  'keyframe.next': { en: 'Next keyframe', tr: 'Sonraki anahtar kare' },
  'keyframe.toggle': { en: 'Add or remove a keyframe at the playhead', tr: 'Oynatma çizgisinde anahtar kare ekle ya da sil' },
  'compound.ownAnimationGone': { en: 'The animation of the compound clip itself (its keys, mask, motion) is not carried onto the clips inside it.', tr: 'Bileşik klibin kendi animasyonu (anahtarları, maskesi, hareketi) içindeki kliplere taşınmadı.' },
  'keyframe.offClip': { en: 'Nothing written: this value is keyframed and the playhead is not on the clip. Move the playhead onto it to set a key there.', tr: 'Hiçbir şey yazılmadı: bu değer anahtar kareli ve oynatma çizgisi klibin üzerinde değil. Orada anahtar yazmak için oynatma çizgisini klibe getir.' },
  'keyframe.outside': { en: '{n} keyframe(s) outside the visible part of the clip ({n|it comes|they come} back when it is trimmed out again)', tr: 'Klibin görünen kısmının dışında {n} anahtar kare var (klip yeniden açılınca geri gelir)' },
  'timeline.rippleGapLeft': { en: 'Other tracks have material there, so the gap was left; Alt closes this track only.', tr: 'Başka şeritlerde malzeme olduğu için boşluk bırakıldı; yalnız bu şeridi kapatmak için Alt.' },
  'link.lockedPartner': { en: 'Not done: "{name}" is linked to a clip on locked track {track}. Unlock that track, or unlink the pair.', tr: 'Yapılmadı: "{name}", kilitli {track} şeridindeki bir klibe bağlı. O şeridin kilidini aç ya da bağı kaldır.' },
  'timeline.cutDelete.title': { en: 'Cut the time between the two marks out of every unlocked track and close the gap (Alt: out of the marked lane only)', tr: 'İki işaret arasındaki süreyi kilitsiz bütün şeritlerden kes ve boşluğu kapat (Alt: yalnız işaretli şeritten)' },
  'timeline.rippleDelete.title': { en: 'Ripple delete: remove the selected clips and cut the time they took out of every unlocked track (Alt: their own tracks only)', tr: 'Kaydırarak sil: seçili klipleri kaldır, kapladıkları süreyi kilitsiz bütün şeritlerden kes (Alt: yalnız kendi şeritlerinden)' },
  'track.rename': { en: 'Track name', tr: 'Şerit adı' },
  'track.rename.hint': { en: '{name} (double-click to rename)', tr: '{name} (yeniden adlandırmak için çift tıkla)' },
  'track.lockedNoDelete': { en: 'Track {track} is locked: not deleted. Unlock it first.', tr: '{track} şeridi kilitli: silinmedi. Önce kilidini aç.' },
  'clip.unlink': { en: 'Unlink picture and sound', tr: 'Görüntü ile sesin bağını kaldır' },
  'link.moveRefused': { en: 'Not moved: its linked partner has no room there on its track.', tr: 'Taşınmadı: bağlı eşine kendi şeridinde orada yer yok.' },
  'project.newer.autosave': { en: 'Not auto-saved: a newer {app} saved this file. Press Ctrl+S to choose.', tr: 'Otomatik kaydedilmedi: bu dosyayı daha yeni bir {app} kaydetmiş. Seçmek için Ctrl+S\'ye bas.' },

  // ---- earlier versions of the file (phase Ç2a.2, decision 4: main/backups.ts)
  'project.backup.failed': { en: 'Not saved: the file as it was could not be copied to its earlier versions first. Use Save as… to keep your work.', tr: 'Kaydedilmedi: dosyanın önceki hâli önce önceki sürümlerine kopyalanamadı. Çalışmanı korumak için Farklı kaydet… kullan.' },
  'backups.menu': { en: 'Earlier versions…', tr: 'Önceki sürümler…' },
  'backups.menuTitle': { en: 'The file as it was before autosave wrote over it (the last 5)', tr: 'Dosyanın, otomatik kayıt üstüne yazmadan önceki hâli (son 5)' },
  'backups.title': { en: 'Earlier versions of this project', tr: 'Bu projenin önceki sürümleri' },
  'backups.note': { en: 'Before the first autosave after you open or save, {app} copies the file as it is. A version opens as a copy: the project file is not touched.', tr: 'Açtıktan ya da kaydettikten sonraki ilk otomatik kayıttan önce {app} dosyanın o hâlini kopyalar. Bir sürüm kopya olarak açılır: proje dosyasına dokunulmaz.' },
  'backups.empty': { en: 'No earlier versions of this project yet.', tr: 'Bu projenin henüz önceki sürümü yok.' },
  'backups.size': { en: '{kb} KB', tr: '{kb} KB' },
  'backups.open': { en: 'Open as a copy', tr: 'Kopya olarak aç' },
  'backups.close': { en: 'Close', tr: 'Kapat' },
  'backups.opened': { en: 'Opened the version of {when} as a copy. Save it under a name to keep it.', tr: '{when} tarihli sürüm kopya olarak açıldı. Korumak için bir adla kaydet.' },
  'backups.unreadable': { en: 'This version could not be read.', tr: 'Bu sürüm okunamadı.' },

  // ---- the crash snapshot (phase Ç2a.2, decision 5)
  'recovery.file': { en: 'File', tr: 'Dosya' },

  // ---- relinking and media changed on disk (phase Ç2a.2, decision 2: media/relink.ts)
  'media.kind.video': { en: 'a video', tr: 'bir video' },
  'media.kind.audio': { en: 'a sound file', tr: 'bir ses dosyası' },
  'media.kind.image': { en: 'a picture', tr: 'bir görsel' },
  'media.kind.code': { en: 'a code film', tr: 'bir kod filmi' },
  'media.relink.kind': { en: 'Not relinked: "{file}" is {got}, and "{name}" needs {want}.', tr: 'Yeniden bağlanmadı: "{file}" {got}; "{name}" için {want} gerekiyor.' },
  'media.relink.more': { en: 'Found {n} more missing file(s) in the same folder and relinked them.', tr: 'Aynı klasörde {n} eksik dosya daha bulundu ve yeniden bağlandı.' },
  'media.relink.unreadable': { en: 'Not relinked: "{file}" could not be read as media.', tr: 'Yeniden bağlanmadı: "{file}" medya olarak okunamadı.' },
  'media.relink.pastEnd': { en: '{n} clip(s) now {n|runs|run} past the end of "{file}": shorten {n|it|them}, or pick a longer file.', tr: '{n} klip artık "{file}" dosyasının sonunu aşıyor: kısalt ya da daha uzun bir dosya seç.' },
  'media.changed': { en: '{n} media file(s) changed on disk since this project was saved and {n|was|were} read again.', tr: '{n} medya dosyası proje kaydedildikten sonra diskte değişmiş; yeniden okundu.' },
  'media.changed.unreadable': { en: '{n} changed media file(s) could not be read again, or {n|is|are} another kind now: {n|it is|they are} marked missing, relink {n|it|them}.', tr: 'Değişen {n} medya dosyası yeniden okunamadı ya da artık başka türde: eksik olarak işaretlendi, yeniden bağlayın.' },
  'media.changed.pastEnd': { en: '{n} clip(s) now {n|runs|run} past the end of {n|its|their} changed file.', tr: '{n} klip artık değişen dosyasının sonunu aşıyor.' },
  'media.foundUnchecked': { en: '{n} media file(s) {n|was|were} found by {n|its|their} place beside the project; the project stored no size to confirm {n|it|them}: {names}.', tr: '{n} medya dosyası projenin yanındaki yerinden bulundu; projede onları doğrulayacak boyut kayıtlı değildi: {names}.' },

  // ---- the export: the encoder asked first, frame rates, decodable sources, code films (phase Ç3a)
  'export.encoder.checking': { en: 'Encoder: asking this computer…', tr: 'Kodlayıcı: bu bilgisayara soruluyor…' },
  'export.encoder.hardware': { en: 'Encoder: hardware', tr: 'Kodlayıcı: donanım' },
  'export.encoder.software': { en: 'Encoder: software, slower (the hardware encoder does not take this)', tr: 'Kodlayıcı: yazılım, daha yavaş (donanım kodlayıcısı bunu kabul etmiyor)' },
  'export.encoder.refused': { en: "This computer's video encoder does not take {codec} at {size}, {fps} fps, {mbps} Mbps (neither its hardware nor its software encoder). Choose another size, frame rate or quality.", tr: 'Bu bilgisayarın video kodlayıcısı {codec} biçimini {size}, {fps} kare/sn, {mbps} Mb/sn ile kabul etmiyor (ne donanım ne yazılım kodlayıcısı). Başka bir boyut, kare hızı ya da kalite seçin.' },
  'export.encoder.slow': { en: 'slow, software', tr: 'yavaş, yazılım' },
  'export.encoder.closed': { en: 'not available here', tr: 'burada yok' },
  'export.fps.option': { en: '{fps} fps', tr: '{fps} kare/sn' },
  'export.fps.project': { en: '{fps} fps (project)', tr: '{fps} kare/sn (proje)' },
  'export.undecodable': { en: 'The video was not exported. {n} file(s) cannot be decoded on this computer: {names}. Convert them to H.264 (or install the system decoder for their format), then export again.', tr: 'Video dışa aktarılmadı. {n} dosya bu bilgisayarda çözülemiyor: {names}. Onları H.264 biçimine çevirin (ya da biçimlerinin sistem çözücüsünü kurun), sonra yeniden dışa aktarın.' },
  'export.mix.start': { en: 'Mixing the sound', tr: 'Ses karıştırılıyor' },
  'export.mix.voice': { en: 'Mixing the sound: reading the voice, {i} of {n}', tr: 'Ses karıştırılıyor: konuşma okunuyor, {i} / {n}' },
  'export.mix.loudness': { en: 'Mixing the sound: measuring the loudness, {i} of {n}', tr: 'Ses karıştırılıyor: ses yüksekliği ölçülüyor, {i} / {n}' },
  'export.mix.window': { en: 'Mixing the sound: {i} of {n}', tr: 'Ses karıştırılıyor: {i} / {n}' },
  'export.limiter.note': { en: 'The sound reached {ceil} dBTP in places: the limiter held its peaks down, by up to {db} dB (the most at {at}; {dur} in all).', tr: 'Ses yer yer {ceil} dBTP’ye ulaştı: sınırlayıcı tepeleri en çok {db} dB kıstı (en çok {at} anında; toplam {dur}).' },
  'export.disk.full': { en: 'The disk is full: the video could not be written. Free some space (or choose another drive), then export again.', tr: 'Disk dolu: video yazılamadı. Biraz yer açın (ya da başka bir sürücü seçin), sonra yeniden dışa aktarın.' },
  'export.disk.denied': { en: 'Windows did not allow the video to be written there (the file or its folder is protected or read-only). Choose another place, then export again.', tr: 'Windows videonun oraya yazılmasına izin vermedi (dosya ya da klasörü korumalı veya salt okunur). Başka bir yer seçin, sonra yeniden dışa aktarın.' },
  'export.disk.short': { en: 'The video was not exported: it needs about {need} and the disk has {free} free. Free some space (or choose another drive), then export again.', tr: 'Video dışa aktarılmadı: yaklaşık {need} gerekiyor, diskte {free} boş. Biraz yer açın (ya da başka bir sürücü seçin), sonra yeniden dışa aktarın.' },
  'export.disk.full.file': { en: 'The disk is full: the file could not be written. Free some space (or choose another drive), then export again.', tr: 'Disk dolu: dosya yazılamadı. Biraz yer açın (ya da başka bir sürücü seçin), sonra yeniden dışa aktarın.' },
  'export.disk.denied.file': { en: 'Windows did not allow the file to be written there (the file or its folder is protected or read-only). Choose another place, then export again.', tr: 'Windows dosyanın oraya yazılmasına izin vermedi (dosya ya da klasörü korumalı veya salt okunur). Başka bir yer seçin, sonra yeniden dışa aktarın.' },
  'export.disk.short.file': { en: 'The file was not exported: it needs about {need} and the disk has {free} free. Free some space (or choose another drive), then export again.', tr: 'Dosya dışa aktarılmadı: yaklaşık {need} gerekiyor, diskte {free} boş. Biraz yer açın (ya da başka bir sürücü seçin), sonra yeniden dışa aktarın.' },
  'export.normalize.applied': { en: 'Sound normalized to {lufs} LUFS: {db}', tr: 'Ses {lufs} LUFS’ye getirildi: {db}' },
  'export.preset.yt.closed':{ en: 'This project is {w} × {h}: it does not export as {out}. Choose the size below (Custom).', tr: 'Bu proje {w} × {h}: {out} olarak dışa aktarılmıyor. Boyutu aşağıdan seçin (Özel).' },
  'export.encoder.hwFailed':{ en: 'The video was not exported: the graphics card\'s video encoder failed. The next export of this size and rate will use the software encoder (slower, the same picture); export again.', tr: 'Video dışa aktarılmadı: ekran kartının video kodlayıcısı hata verdi. Bu boyut ve hızdaki bir sonraki dışa aktarma yazılım kodlayıcısını kullanacak (daha yavaş, aynı görüntü); yeniden dışa aktarın.' },
  'export.encoder.afterFail': { en: 'the graphics card\'s encoder failed on this size and rate earlier in this session; the software encoder made it (slower, the same picture)', tr: 'ekran kartının kodlayıcısı bu oturumda bu boyut ve hızda daha önce hata verdi; videoyu yazılım kodlayıcısı yaptı (daha yavaş, aynı görüntü)' },
  'export.batch.failed':{ en: 'Short {i} of {n} ("{name}") was not exported: {why}', tr: '{n} Short’tan {i}. (“{name}”) dışa aktarılamadı: {why}' },
  'export.batch.cancelled': { en: 'Cancelled at Short {i} of {n} ("{name}").', tr: '{n} Short’tan {i}. (“{name}”) sırasında iptal edildi.' },
  'export.batch.saved': { en: 'Saved before it: {k} of {n} ({where}).', tr: 'Ondan önce kaydedilenler: {k} / {n} ({where}).' },
  'export.batch.none': { en: 'No Short was saved.', tr: 'Hiçbir Short kaydedilmedi.' },
  'export.save.writing':{ en: 'Saving the file', tr: 'Dosya kaydediliyor' },
  'export.contextLost': { en: 'The export stopped: the graphics card was reset while it drew (a driver crash or update). Nothing was saved; export again.', tr: 'Dışa aktarma durdu: çizim sırasında ekran kartı sıfırlandı (sürücü çökmesi ya da güncellemesi). Hiçbir şey kaydedilmedi; yeniden dışa aktarın.' },
  'export.verify.checking': { en: 'Checking the written file', tr: 'Yazılan dosya denetleniyor' },
  'export.verify.frames': { en: 'The video was not saved: the encoder handed back {got} of its {want} frames. Export again.', tr: 'Video kaydedilmedi: kodlayıcı {want} karenin {got} tanesini verdi. Yeniden dışa aktarın.' },
  'export.verify.failed': { en: 'The video was not saved: the written file did not hold what was asked ({what}). Export again.', tr: 'Video kaydedilmedi: yazılan dosya isteneni tutmuyordu ({what}). Yeniden dışa aktarın.' },
  'export.decode.held': { en: 'A frame of "{name}" could not be read at {at} s: its picture is held on the last good frame from there to the clip\'s end.', tr: '"{name}" dosyasının {at} sn anındaki karesi okunamadı: oradan klibin sonuna kadar son sağlam kare tutuldu.' },
  'media.hdr.badge': { en: 'HDR ({kind})', tr: 'HDR ({kind})' },
  'media.hdr': { en: 'An HDR video ({kind}): {app} draws and exports it in standard range (SDR), converted by the browser, so its colors and brightness may differ from the original.', tr: 'HDR video ({kind}): {app} onu standart aralıkta (SDR) çizer ve dışa aktarır, dönüşümü tarayıcı yapar; renkleri ve parlaklığı özgün dosyadan farklı olabilir.' },
  'export.hdr': { en: 'HDR footage ({names}) is exported in standard range (SDR), converted by the browser: its colors and brightness may differ from the original.', tr: 'HDR görüntü ({names}) standart aralıkta (SDR) dışa aktarılır, dönüşümü tarayıcı yapar: renkleri ve parlaklığı özgününden farklı olabilir.' },
  'export.title': { en: 'Export', tr: 'Dışa aktar' },
  'export.title.segments': { en: 'Export {n} Shorts segment(s)', tr: '{n} Shorts parçasını dışa aktar' },
  'export.segments.hint': { en: 'Each segment is made into its own 9:16 video with the settings below.', tr: 'Her parça aşağıdaki ayarlarla kendi 9:16 videosu olarak yapılır.' },
  'export.kind': { en: 'What to export', tr: 'Ne dışa aktarılsın' },
  'export.kind.video': { en: 'Video', tr: 'Video' },
  'export.kind.sound': { en: 'Sound only', tr: 'Yalnız ses' },
  'export.kind.frame': { en: 'This frame', tr: 'Bu kare' },
  'export.preset': { en: 'Preset', tr: 'Hazır ayar' },
  'export.preset.yt1080': { en: 'YouTube 1080p', tr: 'YouTube 1080p' },
  'export.preset.yt4k': { en: 'YouTube 4K', tr: 'YouTube 4K' },
  'export.preset.shorts': { en: 'Shorts / Reels', tr: 'Shorts / Reels' },
  'export.preset.custom': { en: 'Custom', tr: 'Özel' },
  'export.preset.yt1080.hint': { en: 'MP4 (H.264) at 1080 lines, the project\'s frame rate, high quality, loudness to −14 LUFS.', tr: 'MP4 (H.264), 1080 satır, projenin kare hızı, yüksek kalite, ses yüksekliği −14 LUFS.' },
  'export.preset.yt4k.hint': { en: 'MP4 (H.264) at 2160 lines (4K), the project\'s frame rate, high quality, loudness to −14 LUFS.', tr: 'MP4 (H.264), 2160 satır (4K), projenin kare hızı, yüksek kalite, ses yüksekliği −14 LUFS.' },
  'export.preset.shorts.hint': { en: 'A vertical 1080 × 1920 MP4 (H.264), the project\'s frame rate, high quality, loudness to −14 LUFS.', tr: 'Dikey 1080 × 1920 MP4 (H.264), projenin kare hızı, yüksek kalite, ses yüksekliği −14 LUFS.' },
  'export.preset.shorts.closed': { en: 'Not for this project: it is a landscape frame. Switch the project to Shorts mode for a vertical video.', tr: 'Bu proje için değil: yatay bir kare. Dikey video için projeyi Shorts kipine alın.' },
  'export.preset.custom.hint': { en: 'Every setting as you choose it.', tr: 'Her ayar sizin seçtiğiniz gibi.' },
  'export.format': { en: 'Format', tr: 'Biçim' },
  'export.target': { en: 'Export as', tr: 'Şöyle dışa aktar' },
  'export.target.shorts': { en: '9:16 Short (the moving crop)', tr: '9:16 Short (hareketli kırpma)' },
  'export.target.landscape': { en: '16:9 full frame', tr: '16:9 tam kare' },
  'export.resolution': { en: 'Size', tr: 'Boyut' },
  'export.size.project': { en: 'project', tr: 'proje' },
  'export.size.fast': { en: 'fast', tr: 'hızlı' },
  'export.size.qhd': { en: '1440p', tr: '1440p' },
  'export.size.qhdDown': { en: '1440p, smaller', tr: '1440p, daha küçük' },
  'export.size.uhd': { en: '4K', tr: '4K' },
  'export.size.uhdUp': { en: '4K, enlarged', tr: '4K, büyütülmüş' },
  'export.size.qhdHint': { en: 'YouTube gives 1440p uploads a better codec, even for viewers at 1080p; it takes longer to make.', tr: 'YouTube 1440p yüklemelere, 1080p izleyenler için bile daha iyi bir kodek verir; yapması daha uzun sürer.' },
  'export.fps': { en: 'Frame rate', tr: 'Kare hızı' },
  'export.quality': { en: 'Quality', tr: 'Kalite' },
  'export.quality.standard': { en: 'Standard (smaller file)', tr: 'Standart (daha küçük dosya)' },
  'export.quality.high': { en: 'High (recommended)', tr: 'Yüksek (önerilen)' },
  'export.quality.max': { en: 'Maximum', tr: 'En yüksek' },
  'export.quality.custom': { en: 'Custom bitrate', tr: 'Özel bit hızı' },
  'export.mbps': { en: 'Bitrate', tr: 'Bit hızı' },
  'export.normalize': { en: 'Loudness to −14 LUFS (YouTube)', tr: 'Ses yüksekliği −14 LUFS (YouTube)' },
  'export.youtube': { en: 'YouTube text beside it (chapters, a description draft)', tr: 'Yanında YouTube metni (bölümler, açıklama taslağı)' },
  'export.range': { en: 'Range', tr: 'Aralık' },
  'export.range.all': { en: 'Whole film', tr: 'Bütün film' },
  'export.range.inout': { en: 'In to out', tr: 'Girişten çıkışa' },
  'export.range.in': { en: 'In', tr: 'Giriş' },
  'export.range.out': { en: 'Out', tr: 'Çıkış' },
  'export.range.playhead': { en: 'At the playhead', tr: 'Oynatma çizgisinde' },
  'export.range.hint': { en: 'I and O on the timeline set the in and out points at the playhead.', tr: 'Çizelgede I ve O, giriş ve çıkış noktalarını oynatma çizgisine koyar.' },
  'export.solo': { en: 'A track is soloed: only the soloed sound is heard in the export.', tr: 'Bir iz tek başına açık: dışa aktarmada yalnız onun sesi duyulur.' },
  'export.summary.video': { en: 'Video: {codec} · {w} × {h} · {fps} fps · about {mbps} Mb/s', tr: 'Video: {codec} · {w} × {h} · {fps} kare/sn · yaklaşık {mbps} Mb/sn' },
  'export.summary.audio': { en: 'Sound: {codec} · 48 kHz · {rate}', tr: 'Ses: {codec} · 48 kHz · {rate}' },
  'export.summary.stereo': { en: 'stereo', tr: 'stereo' },
  'export.summary.size': { en: 'Length {len} · about {size}', tr: 'Süre {len} · yaklaşık {size}' },
  'export.encoder.level51': { en: 'Some hardware encoders write H.264 level 5.1 here although 5.2 is asked; players accept it.', tr: 'Bazı donanım kodlayıcıları burada 5.2 istendiği hâlde H.264 düzey 5.1 yazar; oynatıcılar kabul eder.' },
  'export.start.video': { en: 'Export', tr: 'Dışa aktar' },
  'export.start.sound': { en: 'Export the sound', tr: 'Sesi dışa aktar' },
  'export.start.frame': { en: 'Save the frame', tr: 'Kareyi kaydet' },
  'export.start.segments': { en: 'Export {n} segment(s)', tr: '{n} parçayı dışa aktar' },
  'export.cancel': { en: 'Cancel', tr: 'Vazgeç' },
  'export.mark.in': { en: 'Export in point, {time} s', tr: 'Dışa aktarma girişi, {time} sn' },
  'export.mark.out': { en: 'Export out point, {time} s', tr: 'Dışa aktarma çıkışı, {time} sn' },
  'still.size': { en: 'Size', tr: 'Boyut' },
  'still.size.project': { en: 'Project · {w} × {h}', tr: 'Proje · {w} × {h}' },
  'still.size.uhd': { en: '4K · {w} × {h}', tr: '4K · {w} × {h}' },
  'still.format': { en: 'Format', tr: 'Biçim' },
  'still.format.png': { en: 'PNG', tr: 'PNG' },
  'still.format.jpeg': { en: 'JPEG', tr: 'JPEG' },
  'still.captions': { en: 'Subtitles and texts', tr: 'Altyazı ve metinler' },
  'still.shorts': { en: 'A Shorts project: the 9:16 window, as the Short shows it.', tr: "Shorts projesi: Short'un gösterdiği 9:16 pencere." },
  'still.detail': { en: '{w} × {h} {format} · at {time} s', tr: '{w} × {h} {format} · {time} sn' },
  'still.detail.clean': { en: '{w} × {h} {format} · at {time} s · no text', tr: '{w} × {h} {format} · {time} sn · metinsiz' },
  'still.job.loading': { en: 'Loading the pictures and fonts', tr: 'Görseller ve yazı tipleri yükleniyor' },
  'still.job.drawing': { en: 'Drawing the frame', tr: 'Kare çiziliyor' },
  'still.job.saving': { en: 'Saving the file', tr: 'Dosya kaydediliyor' },
  'media.prores4444': { en: 'ProRes 4444 is not supported (neither its picture nor its transparency), so it was not imported. Convert it to a WebM (VP9) with alpha, or to H.264 if it needs no transparency, then import it again.', tr: 'ProRes 4444 desteklenmiyor (ne resmi ne saydamlığı), bu yüzden içe aktarılmadı. Alfalı bir WebM (VP9) dosyasına, saydamlık gerekmiyorsa H.264 biçimine çevirip yeniden içe aktarın.' },
  'media.undecodable.badge': { en: 'cannot be decoded here', tr: 'burada çözülemiyor' },
  'media.undecodable': { en: 'Cannot be decoded on this computer: the export will refuse it. Convert it to H.264.', tr: 'Bu bilgisayarda çözülemiyor: dışa aktarma bunu reddeder. H.264 biçimine çevirin.' },
  'codeFilm.tooMany': { en: 'Too many code films at once (limit {n}). This one is not shown until another is out of the way.', tr: 'Aynı anda çok fazla kod filmi var (sınır {n}). Bu film, ötekilerden biri aradan çıkana kadar gösterilmiyor.' },
  'codeFilm.glLost': { en: 'The code clip "{name}" lost its graphics context: the graphics memory ran out for this film (too many 3D films at once?). It draws again when the context comes back, or reload it.', tr: '"{name}" kod klibinin grafik bağlamı kayboldu: bu film için grafik belleği yetmedi (aynı anda çok fazla 3B film mi var?). Bağlam geri gelince yeniden çizer; ya da yeniden yükleyin.' },
  'still.codeFilmLeftOut': { en: 'The code clip "{name}" is not in this frame: it could not draw this moment ({why}).', tr: '"{name}" kod klibi bu karede yok: bu anı çizemedi ({why}).' },
  'codeFilm.pageBlocked': { en: 'The code clip "{name}" cannot be played: this kind of page (drawn with HTML, CSS or SVG) cannot be played on this computer; only pages that draw on canvases play.', tr: '"{name}" kod klibi oynatılamıyor: bu sayfa türü (HTML, CSS ya da SVG ile çizilen) bu bilgisayarda oynatılamıyor; yalnız tuvale çizen sayfalar oynar.' },
  'codeFilm.pageMemory': { en: 'The code clip "{name}" used too much memory ({mb} MB) and was stopped. Fix its code, then reload it.', tr: '"{name}" kod klibi çok fazla bellek kullandı ({mb} MB) ve durduruldu. Kodunu düzeltip yeniden yükleyin.' },
  'codeFilm.pageStopped': { en: 'The page of the code clip "{name}" stopped ({why}). Reload it.', tr: '"{name}" kod klibinin sayfası durdu ({why}). Yeniden yükleyin.' },
  'codeFilm.tooManyShort': { en: 'waiting: too many at once', tr: 'bekliyor: aynı anda çok fazla' },
  'codeFilm.unresponsive': { en: 'The code clip "{name}" did not answer for {s} s and was stopped. Fix its code, then reload it.', tr: '"{name}" kod klibi {s} sn yanıt vermedi ve durduruldu. Kodunu düzeltip yeniden yükleyin.' },
  'export.codeFilm.upscaled': { en: 'The code clip "{name}" is {w} × {h}. The {ow} × {oh} export asks its page to draw larger (up to 2×); a page that does not is enlarged (softer).', tr: '"{name}" kod klibi {w} × {h}. {ow} × {oh} dışa aktarma sayfadan daha büyük çizmesini ister (en çok 2×); büyük çizmeyen sayfa büyütülür (daha yumuşak).' },
  'codeFilm.slow': { en: 'slow', tr: 'yavaş' },
  'codeFilm.slowHint': { en: 'While playing, this clip brings {fps} pictures a second (fewer than {need}). The export waits for every frame and is not affected.', tr: 'Oynarken bu klip saniyede {fps} kare getiriyor ({need} altı). Dışa aktarma her kareyi bekler, etkilenmez.' },
  'codeFilm.unstable': { en: 'unstable', tr: 'kararsız' },
  'codeFilm.unstableHint': { en: 'Some of its CSS animations start from a load or an event, not from its own timers: a moment may look different when played to and when sought to.', tr: 'Bazı CSS animasyonları kendi zamanlayıcılarından değil bir yüklemeden ya da olaydan başlıyor: aynı an oynatarak ve sararak varıldığında farklı görünebilir.' },
  // Phase 5e: the checker, the error return, versions, the code_clip tool.
  'export.codeFilm.unstable': { en: 'The code clip "{name}" is unstable: the check drew a moment twice differently, so the export may not match the preview there.', tr: '"{name}" kod klibi kararsız: denetim aynı anı iki kez farklı çizdi; dışa aktarma orada önizlemeyle aynı olmayabilir.' },
  'export.codeFilm.error': { en: 'The code clip "{name}" has an error (see its note); its frames may be half drawn.', tr: '"{name}" kod klibinde hata var (notuna bak); kareleri yarım çizilmiş olabilir.' },
  'codeFilm.verdict.ok': { en: 'checked', tr: 'denetlendi' },
  'codeFilm.verdict.blank': { en: 'blank', tr: 'boş' },
  'codeFilm.verdict.unstable': { en: 'unstable', tr: 'kararsız' },
  'codeFilm.verdict.error': { en: 'error', tr: 'hata' },
  'codeFilm.checkedUnstableHint': { en: 'The same moment, drawn twice or on a fresh load, came out differently: {line}', tr: 'Aynı an, iki kez ya da taze yüklemede çizilince farklı çıktı: {line}' },
  'codeFilm.blankHint': { en: 'Every moment the check drew is one color or wholly clear.', tr: 'Denetimin çizdiği her an tek renk ya da tümüyle saydam.' },
  'codeFilm.errorHint': { en: 'The page wrote down an error: {line}', tr: 'Sayfa bir hata yazdı: {line}' },
  'codeFilm.checkNote': { en: 'Code clip check: {verdict}. {line}', tr: 'Kod klibi denetimi: {verdict}. {line}' },
  'codeFilm.checkPasses': { en: 'The check passes now.', tr: 'Denetim artık geçiyor.' },
  'codeFilm.versionBack': { en: 'Back to the previous version', tr: 'Önceki sürüme dön' },
  'codeFilm.versionBackHint': { en: 'Puts the files of version {n} back; the files as they are now are kept as a version too.', tr: '{n}. sürümün dosyalarını geri koyar; dosyaların şimdiki hâli de sürüm olarak saklanır.' },
  'codeFilm.versionCount': { en: '{n} versions kept', tr: '{n} sürüm saklı' },
  'codeFilm.noVersion': { en: 'No earlier version yet', tr: 'Henüz önceki sürüm yok' },
  'codeFilm.versionDone': { en: 'Version {n} is back.', tr: '{n}. sürüm geri geldi.' },
  'codeFilm.versionFailed': { en: 'The version could not be put back: {why}', tr: 'Sürüm geri konamadı: {why}' },
  'codeFilm.versionOverLimit': { en: 'Nothing was put back: the files as they are now are over the 2 MB a version keeps, so they could not be kept first.', tr: 'Hiçbir şey geri konmadı: dosyaların şimdiki hâli bir sürümün tuttuğu 2 MB\'ı aşıyor, önce saklanamadı.' },
  'codeFilm.versionsOff': { en: 'No versions kept: the text files of this folder are over 2 MB.', tr: 'Sürüm tutulmuyor: bu klasörün metin dosyaları 2 MB\'ı aşıyor.' },
  'codeFilm.writing': { en: 'being written', tr: 'yazılıyor' },
  'codeFilm.saveFirst': { en: 'The agent could not give this project a file: save the project first.', tr: 'Ajan bu projeye dosya veremedi: önce projeyi kaydet.' },
  'codeFilm.saveProject': { en: 'Save project', tr: 'Projeyi kaydet' },
  'project.autoSaved': { en: 'The agent gave this project a file: {file}', tr: 'Ajan bu projeye bir dosya verdi: {file}' },
  'project.showInFolder': { en: 'Show in folder', tr: 'Klasörde göster' },
  // Phase 5f: a code page's parameters, the code templates, the project look.
  'codeFilm.params': { en: 'Parameters ({n})', tr: 'Parametreler ({n})' },
  'codeFilm.paramsReset': { en: "Back to the page's own values", tr: 'Sayfanın kendi değerlerine dön' },
  'codeFilm.paramsCut': { en: 'Too long to give the page whole, shown as the page gets them: {names}', tr: 'Sayfaya bütün verilemeyecek kadar uzun, sayfanın aldığı gibi gösteriliyor: {names}' },
  'codeFilm.paramColor': { en: '#rrggbb (empty: project look)', tr: '#rrggbb (boş: proje görünümü)' },
  'codeTpl.title': { en: 'Code templates', tr: 'Kod şablonları' },
  'codeTpl.note': { en: "Working pages drawn live over the video. Each one added is copied into the project's anim folder; set its words, colors and numbers in the Inspector.", tr: 'Videonun üstünde canlı çizilen hazır sayfalar. Eklenen her biri projenin anim klasörüne kopyalanır; yazısını, rengini ve sayılarını Inspector’dan ayarla.' },
  'codeTpl.add': { en: 'Add at playhead', tr: 'Oynatma çizgisine ekle' },
  'codeTpl.addHint': { en: 'Adds {name} on a new track over the picture', tr: '{name} şablonunu görüntünün üstünde yeni bir şeride ekler' },
  'codeTpl.saveFirst': { en: 'A code template is copied beside the project file: save the project first.', tr: 'Kod şablonu proje dosyasının yanına kopyalanır: önce projeyi kaydet.' },
  'codeTpl.failed': { en: 'The template could not be added: {why}', tr: 'Şablon eklenemedi: {why}' },
  'codeTpl.blank': { en: 'Blank', tr: 'Boş' },
  'codeTpl.lowerThird': { en: 'Lower third', tr: 'Alt bant' },
  'codeTpl.barChart': { en: 'Bar chart', tr: 'Çubuk grafik' },
  'codeTpl.counter': { en: 'Counter', tr: 'Sayaç' },
  'codeTpl.arrow': { en: 'Arrow and ring', tr: 'Ok ve halka' },
  'codeTpl.titleCard': { en: 'Title card', tr: 'Başlık kartı' },
  'look.title': { en: 'Project look', tr: 'Proje görünümü' },
  'look.accent': { en: 'Accent color', tr: 'Vurgu rengi' },
  'look.font': { en: 'Font', tr: 'Yazı tipi' },
  'look.none': { en: 'empty: none', tr: 'boş: yok' },
  // ---- lane B (phases 9a, 9c, 10a without the interface): added as one block --
  'profile.inherited': { en: 'Your projects list, shortcuts and interface settings were copied from {from}. That folder was not changed.', tr: 'Proje listen, kısayolların ve arayüz ayarların {from} klasöründen kopyalandı. O klasör değiştirilmedi.' },
  'look.hint': { en: 'Empty by default. The code templates use it; a code page may read it.', tr: 'Varsayılanı boş. Kod şablonları bunu kullanır; bir kod sayfası okuyabilir.' }
} satisfies Record<string, Entry>

export type StringKey = keyof typeof STRINGS
export type Params = Record<string, string | number>

let lang: Lang = 'en'
const listeners = new Set<() => void>()

/** The language the words are shown in (the store calls this). */
export function setLang(next: Lang): void {
  const l: Lang = LANGS.includes(next) ? next : 'en'
  if (l === lang) return
  lang = l
  for (const fn of [...listeners]) fn()
}
export const getLang = (): Lang => lang
export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Puts the parameters into a text: `{n} cuts` with { n: 14 } → `14 cuts`.
 *  A parameter that is not given stays as it is written. A word that
 *  depends on a count is written with both forms, `{n|was|were}`: the first
 *  when the parameter is 1, the second otherwise (22 November, L12; either
 *  language may use it). */
export function fill(text: string, params?: Params): string {
  if (!params) return text
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(params, k)
  return text
    .replace(/\{(\w+)\|([^|{}]*)\|([^|{}]*)\}/g, (m, k: string, one: string, many: string) => (has(k) ? (Number(params[k]) === 1 ? one : many) : m))
    .replace(/\{(\w+)\}/g, (m, k: string) => (has(k) ? String(params[k]) : m))
}

/** English plurals written as "(s)" after a count: "1 note", "3 notes", not
 *  "1 note(s)" (22 November, L12: "3 change(s)" on the draft, "1 note(s)"
 *  in a toast). Each "(s)" follows the nearest number before it in its
 *  clause; one with no number before it is left as written ("Start (s)" is
 *  seconds). Turkish has no such ending after a number. */
export function plural(text: string): string {
  if (!text.includes('(s)')) return text
  let out = text
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/(\d+(?:[.,]\d+)?)([^\d.;:!?(]*[A-Za-z])\(s\)/, (_m, n: string, between: string) => `${n}${between}${Number(n.replace(',', '.')) === 1 ? '' : 's'}`)
    if (next === out) break
    out = next
  }
  return out
}

/** The text of a key in the chosen language (English when it has no translation).
 *  `{app}` is always the product's name (shared/product.json, phase 9a
 *  decision 1): no text writes the name out. A Turkish text puts no suffix on
 *  it ("{app} araçları", not "{app}'in"): the suffix would depend on the name. */
export function t(key: StringKey, params?: Params): string {
  const e: Entry = STRINGS[key]
  // The key names as this platform writes them ("Ctrl+Z" is Cmd+Z on a Mac,
  // os-platform.ts keysInText; phase 10a.5). Windows and Linux: as written.
  if (lang === 'tr' && e.tr) return keysInText(fill(e.tr, { app: PRODUCT_NAME, ...localParams(params) }))
  return keysInText(plural(fill(e.en, { app: PRODUCT_NAME, ...params })))
}

/** A parameter that is a number written with a point ("2.50", "-0.5") or a
 *  time ("0:12.4", "1:02:03.5") takes the Turkish decimal comma (phase 9
 *  audit patch D11: some fifty call sites pass toFixed() numbers). Anything
 *  else (a name, "v1.0.81", "1920x1080") is left as it is. */
const POINT_NUMBER = /^[-+−]?\d+\.\d+$/
const POINT_TIME = /^-?\d+(?::\d{2}){1,2}\.\d+$/
function localParams(params?: Params): Params | undefined {
  if (!params) return params
  const out: Params = {}
  for (const [k, v] of Object.entries(params)) {
    const s = typeof v === 'number' ? (Number.isInteger(v) ? null : String(v)) : v
    out[k] = s !== null && (POINT_NUMBER.test(s) || POINT_TIME.test(s)) ? s.replace('.', ',') : v
  }
  return out
}

/** t() for a component: it draws again when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(subscribeLang, getLang, getLang)
  return t
}

/** The language a stored value names (anything else is English). */
export const langOf = (v: unknown): Lang => (v === 'tr' ? 'tr' : 'en')
