// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Settings window and the agent connection without the embedded terminal
// (TERMINAL-YOK-PLAN.md, 21 Nov 2026): the words it added, English and
// Turkish, the same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_AYARLAR = {
  // ---- the window -------------------------------------------------------------
  'settings.title': { en: 'Settings', tr: 'Ayarlar' },
  'settings.nav': { en: 'Settings pages', tr: 'Ayar sayfaları' },
  'settings.page.general': { en: 'General', tr: 'Genel' },
  'settings.page.agent': { en: 'Agent connection', tr: 'Ajan bağlantısı' },
  'settings.page.keys': { en: 'Keyboard shortcuts', tr: 'Klavye kısayolları' },
  'settings.page.help': { en: 'Help', tr: 'Yardım' },
  'settings.page.about': { en: 'About', tr: 'Hakkında' },
  'settings.copied': { en: 'Copied', tr: 'Kopyalandı' },
  'settings.copyFailed': { en: 'Could not copy.', tr: 'Kopyalanamadı.' },
  'top.file.settings': { en: 'Settings…', tr: 'Ayarlar…' },
  'top.file.settings.hint': { en: 'The interface language, the agent connection, keyboard shortcuts, help and the version.', tr: 'Arayüz dili, ajan bağlantısı, klavye kısayolları, yardım ve sürüm.' },
  'keys.act.settings': { en: 'Open the settings', tr: 'Ayarları aç' },
  // ---- General ----------------------------------------------------------------
  'settings.general.uiLang': { en: 'Interface language', tr: 'Arayüz dili' },
  'settings.general.uiLang.hint': { en: 'The same as File → Language.', tr: 'Dosya → Dil ile aynı.' },
  'settings.general.spoken': { en: 'Spoken language of new projects', tr: 'Yeni projelerin konuşulan dili' },
  'settings.general.spoken.hint': { en: 'Subtitles are made in this language. It applies to projects you make from now on; the Subtitles tab changes it for one project.', tr: 'Altyazılar bu dilde çıkarılır. Bundan sonra açtığın projelere uygulanır; tek bir projede Altyazı sekmesinden değişir.' },
  'settings.general.spoken.follow': { en: 'As the interface (Turkish → Turkish, otherwise English)', tr: 'Arayüz diline göre (Türkçe → Türkçe, değilse İngilizce)' },
  'settings.general.autosave': { en: 'Autosave', tr: 'Otomatik kayıt' },
  'settings.general.autosave.text': { en: 'A project that has a file is written back to it every 5 minutes, and a recovery copy of unsaved work is kept 10 seconds after each change. There is no setting for this.', tr: 'Dosyası olan bir proje 5 dakikada bir kendi dosyasına yazılır; kaydedilmemiş işin kurtarma kopyası her değişiklikten 10 saniye sonra tutulur. Bunun bir ayarı yok.' },
  'settings.general.restart': { en: 'Save and restart', tr: 'Kaydet ve yeniden başlat' },
  'settings.general.restart.hint': { en: 'Saves the open project and starts {app} again, with the same project. Use it after a code change or a new build; there is no quit question and no recovery box.', tr: 'Açık projeyi kaydeder ve {app} uygulamasını aynı projeyle yeniden başlatır. Bir kod değişikliğinden ya da yeni bir kurulumdan sonra kullan; çıkış sorusu ve kurtarma kutusu çıkmaz.' },
  'settings.general.restart.failed': { en: 'The project could not be saved, so the app was not restarted.', tr: 'Proje kaydedilemedi; uygulama yeniden başlatılmadı.' },
  'settings.general.restart.busy': { en: 'Another window has unsaved changes; save it first, then restart.', tr: 'Başka bir pencerede kaydedilmemiş değişiklik var; önce onu kaydet, sonra yeniden başlat.' },
  // ---- Agent connection --------------------------------------------------------
  'settings.agent.accessFailed': { en: 'Could not turn agent access on.', tr: 'Ajan erişimi açılamadı.' },
  'settings.agent.address': { en: 'Address', tr: 'Adres' },
  'settings.agent.port': { en: 'Port {port} on this computer only (127.0.0.1).', tr: 'Port {port}, yalnız bu bilgisayarda (127.0.0.1).' },
  'settings.agent.copyAddress': { en: 'Copy address', tr: 'Adresi kopyala' },
  'settings.agent.key': { en: 'Access key', tr: 'Erişim anahtarı' },
  'settings.agent.keyHelp': { en: 'Kept in this computer’s {app} profile and never shown here. The copied commands read it there, in your own command window.', tr: 'Bu bilgisayardaki {app} profilinde durur, burada hiç gösterilmez. Kopyaladığın komutlar onu orada, senin komut pencerende okur.' },
  'settings.agent.renew': { en: 'Renew key', tr: 'Anahtarı yenile' },
  'settings.agent.renewAsk': { en: 'A new key: every connected agent is cut off, and the old key stops working after 10 minutes. Do step 2 again for each agent.', tr: 'Yeni anahtar: bağlı bütün ajanların bağlantısı kesilir, eski anahtar 10 dakika sonra çalışmaz. Her ajan için 2. adımı yeniden yap.' },
  'settings.agent.renewConfirm': { en: 'Renew', tr: 'Yenile' },
  'settings.agent.renewed': { en: 'Key renewed. Do step 2 again for each agent (the old one works for 10 more minutes).', tr: 'Anahtar yenilendi. Her ajan için 2. adımı yeniden yap (eskisi 10 dakika daha çalışır).' },
  'settings.agent.renewFailed': { en: 'The key could not be renewed.', tr: 'Anahtar yenilenemedi.' },
  'settings.agent.autoRepair': { en: 'Repair detected agents automatically', tr: 'Bulunan ajanları kendiliğinden onar' },
  'settings.agent.autoRepair.hint': { en: 'A refused request for its key updates the registration of the programs found here: Claude Code, Codex and OpenCode. The agent that was refused still reconnects or restarts.', tr: 'Anahtarı yüzünden reddedilen bir istek, burada bulunan programların kaydını günceller: Claude Code, Codex ve OpenCode. Reddedilen ajan yine de yeniden bağlanır ya da yeniden açılır.' },
  'settings.agent.autoRepair.more': { en: 'Only a registration that points at this copy with another key or address is changed; a program that was never connected here is left alone. The app starts that program\'s own command; it writes nothing else.', tr: 'Yalnız bu kopyaya başka bir anahtar ya da adresle bakan kayıt değişir; buraya hiç bağlanmamış bir programa dokunulmaz. Uygulama o programın kendi komutunu başlatır; başka bir şey yazmaz.' },
  'settings.agent.privacy': { en: 'Text and frames you share with the agent go to its provider.', tr: 'Ajanla paylaştığın metin ve kareler ajanın sağlayıcısına gider.' },
  'settings.agent.security': { en: 'Keep the key private: while agent access is on, anything that knows it can edit your projects. {app} never shows it and never puts it on the clipboard; the copied commands read it from the profile in your own command window. Renew key cuts off every agent that has the old one.', tr: 'Anahtarı gizli tut: ajan erişimi açıkken onu bilen her şey projelerini düzenleyebilir. {app} anahtarı hiç göstermez ve panoya koymaz; kopyalanan komutlar onu senin komut pencerende profilden okur. Anahtarı yenile, eskisini bilen her ajanın bağlantısını keser.' },
  // ---- Help and About ------------------------------------------------------------
  'settings.help.guides': { en: 'Guides', tr: 'Kılavuzlar' },
  'settings.help.guide': { en: 'User guide', tr: 'Kullanım kılavuzu' },
  'settings.help.agents': { en: 'Working with an agent', tr: 'Ajanla çalışmak' },
  'settings.help.guidesNote': { en: 'They open in your computer’s program for Markdown files (.md); they sit in the docs folder beside the program.', tr: 'Bilgisayarındaki Markdown (.md) programıyla açılırlar; programın yanındaki docs klasöründe dururlar.' },
  'settings.help.openFailed': { en: 'Could not open {path}', tr: '{path} açılamadı' },
  'settings.about.version': { en: 'Version {version}', tr: 'Sürüm {version}' },
  'settings.about.versionDev': { en: 'Version {version} (development build)', tr: 'Sürüm {version} (geliştirme kopyası)' },
  'settings.about.license': { en: 'Free software under the GNU General Public License, version 3 or later. It comes with no warranty.', tr: 'GNU Genel Kamu Lisansı, sürüm 3 ya da sonrası altında özgür yazılım. Hiçbir garanti vermez.' },
  'settings.about.licenseFile': { en: 'Licence', tr: 'Lisans' },
  'settings.about.notices': { en: 'Third-party notices', tr: 'Üçüncü taraf bildirimleri' },
  'settings.about.licenses': { en: 'Licence texts', tr: 'Lisans metinleri' },
  // ---- the Agent tab and the command box without a session ------------------------
  'agent.state.notConnected': { en: 'No agent yet: Settings → Agent connection.', tr: 'Henüz ajan yok: Ayarlar → Ajan bağlantısı.' },
  'agent.openSettings': { en: 'Open settings', tr: 'Ayarları aç' },
  'agent.box.about': { en: 'What you write goes to the agent: its wait call brings it into its chat, with what you selected. A ready job, or exactly its words, is done here (0 tokens).', tr: 'Yazdığın ajana gider: wait çağrısı onu seçtiklerinle birlikte sohbetine getirir. Hazır bir iş ya da tam onun sözü burada yapılır (0 token).' },
  'agent.box.hint': { en: 'Ready jobs are done here (0 tokens); anything else you write goes to the agent.', tr: 'Hazır işler burada yapılır (0 token); yazdığın başka her şey ajana gider.' }
} as const
