// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Arayüz v4 (tarifler/UI-V4.md, UI-V4-PLAN.md): the words of the Inspector's
// cards, the left panel's categories and the empty lanes. English and
// Turkish, the same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_UI4 = {
  // ---- the Inspector's cards
  'insp.card.transform': { en: 'Transform', tr: 'Dönüşüm' },
  'insp.card.position': { en: 'Position', tr: 'Konum' },
  'insp.axis.x': { en: 'X', tr: 'X' },
  'insp.axis.y': { en: 'Y', tr: 'Y' },
  'insp.kf.addPropNamed': { en: 'Keyframe {name} at the playhead', tr: '{name}: oynatma çizgisinde anahtar kare' },
  'insp.card.speed': { en: 'Speed', tr: 'Hız' },
  'insp.card.opacity': { en: 'Opacity and blend', tr: 'Opaklık ve karışım' },
  'insp.card.chroma': { en: 'Green screen', tr: 'Yeşil perde' },
  'insp.card.tracker': { en: 'Tracking', tr: 'Takip' },
  'insp.card.anim': { en: 'Animation', tr: 'Animasyon' },
  'insp.card.clipActions': { en: 'Place and flip', tr: 'Yerleştir ve çevir' },
  'insp.audio.parts': { en: 'Audio parts', tr: 'Ses bölümleri' },
  'insp.audio.part.level': { en: 'Level', tr: 'Seviye' },
  'insp.audio.part.clean': { en: 'Enhance', tr: 'İyileştir' },
  'insp.audio.part.fade': { en: 'Fade', tr: 'Geçiş' },
  'insp.audio.part.fx': { en: 'Audio FX', tr: 'Efekt' },
  'insp.empty.title': { en: 'Select a clip', tr: 'Bir klip seç' },
  'insp.empty.hint': { en: 'Click a clip to see its settings.', tr: 'Ayarları için bir klibe tıkla.' },
  // ---- the left panel's categories
  'dock.cats': { en: 'Categories', tr: 'Kategoriler' },
  'dock.cat.media': { en: 'Media', tr: 'Medya' },
  'dock.cat.media.hint': { en: 'Your videos, pictures and sounds', tr: 'Videoların, resimlerin ve seslerin' },
  'dock.cat.audio': { en: 'Audio', tr: 'Ses' },
  'dock.cat.audio.hint': { en: 'Sound effects and music from your library', tr: 'Kitaplığındaki ses efektleri ve müzik' },
  'dock.cat.text': { en: 'Text', tr: 'Yazı' },
  'dock.cat.text.hint': { en: 'Titles, shapes and highlights, and the templates on the G lane', tr: 'Başlıklar, şekiller ve vurgular, G şeridindeki şablonlar' },
  'dock.cat.captions': { en: 'Captions', tr: 'Altyazı' },
  'dock.cat.captions.hint': { en: 'Subtitles from the speech, their style', tr: 'Konuşmadan altyazı, biçimi' },
  'dock.cat.effects': { en: 'Effects', tr: 'Efektler' },
  'dock.cat.effects.hint': { en: 'Motion for many clips at once', tr: 'Birçok klibe birden hareket' },
  'dock.cat.transitions': { en: 'Transitions', tr: 'Geçişler' },
  'dock.cat.transitions.hint': { en: 'Drag one onto a cut, or put one on every cut', tr: 'Birini bir kesime sürükle ya da hepsine koy' },
  'dock.cat.filters': { en: 'Filters', tr: 'Filtreler' },
  'dock.cat.filters.hint': { en: 'Looks (LUTs) for the selected clip', tr: 'Seçili klibe görünümler (LUT)' },
  'dock.cat.code': { en: 'Code', tr: 'Kod' },
  'dock.cat.code.hint': { en: 'Code films and code templates', tr: 'Kod filmleri ve kod şablonları' },
  'dock.cat.chats': { en: 'Chats', tr: 'Sohbetler' },
  'dock.cat.chats.hint': { en: 'Your saved chats about this project', tr: 'Bu projeyle ilgili kayıtlı sohbetlerin' },
  'dock.filters.none': { en: 'Select a picture or video clip to give it a look.', tr: 'Görünüm vermek için bir resim ya da video klibi seç.' },
  'dock.filters.for': { en: 'Applies to {name}', tr: '{name} klibine uygulanır' },
  'dock.code.film': { en: 'Add a code film', tr: 'Kod filmi ekle' },
  // ---- the empty lanes and the empty media panel
  'timeline.lane.dropMedia': { en: 'Drop media here', tr: 'Medyayı buraya bırak' },
  'timeline.lane.dropAudio': { en: 'Drop audio here', tr: 'Sesi buraya bırak' },
  'timeline.empty.lane': { en: 'Drop media here, or import it.', tr: 'Medyayı buraya bırak ya da içe aktar.' },
  'bin.drop.title': { en: 'Import media', tr: 'Medya içe aktar' },
  'bin.drop.hint': { en: 'Click, or drop videos, pictures and sounds here.', tr: 'Tıkla ya da video, resim, ses bırak.' },
  // ---- the #ui-kit page
  'kit.section.card': { en: 'Inspector card', tr: 'Inspector kartı' },
  'kit.card.title': { en: 'Transform', tr: 'Dönüşüm' },
  'kit.card.key': { en: 'Keyframe all', tr: 'Hepsine anahtar kare' },
  'kit.card.partA': { en: 'Level', tr: 'Seviye' },
  'kit.card.partB': { en: 'Fade', tr: 'Geçiş' },
  'kit.grain': { en: 'Grain', tr: 'Gren' }
} as const
