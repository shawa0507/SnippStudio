# SnippStudio kullanım kılavuzu

[English](guide.md) · [Ajanla çalışmak](ajanlar.md)

SnippStudio, Windows için bir video düzenleyicisidir; zaten kullandığın bir yapay zekâ ajanının projende çalışmasına da izin verir. Her şey bilgisayarında çalışır: medyan hiçbir yere yüklenmez, uygulamanın kendisi internete çıkmaz.

Arayüz varsayılan olarak İngilizcedir. **File → Language → Türkçe** (Türkçede **Dosya → Dil**) arayüzü Türkçeye çevirir; seçim saklanır.

## Beş dakikalık tur

Uygulama ilk açıldığında kısa bir tur pencerenin beş bölümünü gösterir. Hiçbir şeyi engellemez: açıkken çalışabilir, herhangi bir adımda **Atla**'ya ya da **Esc**'ye basabilirsin. **Dosya → Yardım → Turu göster** onu yeniden açar.

Kendi görüntün olmadan her şeyi denemek için **Dosya → Yardım → Örnek projeyi aç**'ı (ya da **Dosya → Projeler…** içindeki aynı adlı kartı) kullan. Uygulama her seferinde yeni bir kopya olarak kendi küçük projesini üretir: ton sesli üç renkli test klibi, bir başlık, G şeridinde bir şablon ve bir kod klibi. İstediğin gibi değiştir; sonraki örnek yine yeni bir kopyadır.

1. **Medyanı getir.** Medya panelinde (solda) **İçe aktar**'a bas ya da dosyaları ve bütün klasörleri pencereye bırak. Video, resim ve ses kabul edilir. Bırakılan bir klasör, açabileceğin tek bir öğe olarak durur.
2. **Çizelge.** Bir dosyadaki **+** onu çizelgenin sonuna ekler; ya da istediğin yere sürükle. **S** oynatma çizgisinde böler, klibin kenarını sürüklemek kırpar, klibi sürüklemek taşır. **Ctrl+Z** geri alır.
3. **Önizleme** çizelgeyi dışa aktarılacağı gibi oynatır. **Boşluk** oynatır ve durdurur.
4. **Ajan erişimi** (üst çubuktaki anahtar) zaten kullandığın bir yapay zekâ ajanının projede çalışmasını sağlar. Ajanı bir kez **Ayarlar → Ajan bağlantısı**'nda ekle (üst çubuktaki dişli): Claude Code için komutu bir kez kendi terminalinde çalıştır; sonra her Claude Code sohbeti, SnippStudio açık ve erişim açıkken araçları görür (bkz. [Ajanla çalışmak](ajanlar.md)). Ajana iş, onun kendi sohbetinden verilir ya da buradan gönderilir: Inspector'ın altındaki **komut kutusu**na yazıp **Gönder**, Notlar'da **Ajana gönder**; ajan `wait` ile beklerken gönderdiğin anda sohbetine gelir. Kutu programın kendi hazır işlerini (sessizlikleri kes, altyazı, ses eşitleme…) burada yapar.
5. **Dışa aktar** (sağ üstte) videoyu yazar.

## Çalışma akışı

### Medya ve çizelge
- Sol panel bir kategori sütunudur, seçilenin sayfası yanında açılır: **Medya** (dosyaların), **Ses** (ses efekti kitaplığın), **Yazı** (şablonlar), **Altyazı** (konuşmadan altyazı; Altyazı sekmesini açar), **Efektler** (birçok klibe hareket, şekiller), **Geçişler** (birini bir kesime sürükle ya da hepsine koy), **Filtreler** (seçili klibe görünümler) ve **Kod** (kod filmleri ve kod şablonları). Kaydırıcı adımıyla gider; **Shift** basılıyken on adım, **Alt** basılıyken adımın onda biri.
- Şeritler: **V** şeritleri görüntü, **A** şeritleri ses; **Notlar** şeridi iş notlarını, **G** şeridi şablonları taşır. Bağlı görüntü ve ses birlikte hareket eder.
- Çizelgenin araç çubuğundaki araçlar: seçim, bölme, kaydırma, kesici (kesilecek aralıkları işaretler), yapışma. Tuşları aşağıdaki tabloda.
- **Boşlukları kendiliğinden kapat** (her şeridin başındaki düğme) açıkken bir klip silinince ya da kırpılınca o şeridin klipleri bitişik kalır; kapalıyken öbürleri yerinde durur.
- Geçişler: bir kesimin üstüne gel ve **+**'ya tıkla ya da en yakın kesime varsayılan geçiş için **Ctrl+T**. Inspector'ın **Klip** sekmesi geçişin türünü ve uzunluğunu gösterir.
- İşaretleyiciler, giriş ve çıkış noktaları (**I**, **O**) ve işaretli aralığın döngüsü (**Ctrl+L**).

### Inspector (sağda)
- **Klip**: seçili klibe dair her şey, katlanan kartlarda (her biri açık mı kapalı mı olduğunu hatırlar): **Dönüşüm** (ölçek, tek satırda konum X ve Y — X ya da Y'yi sürükleyerek değiştir — döndürme, **Ortala**, **Doldur**, **Sığdır**, çevirme, 90° döndürme; elması hepsine oynatma çizgisinde anahtar kare yazar); **Ses** (küçük sekmeleri: seviye ve ses yüksekliği, sesi temizleme, belirme ve sönme, EQ ve kompresör; sağındaki anahtar klibi susturur); **Hız** (tek hız ya da eğri, dondurma, tersine oynatma); **Opaklık ve karışım**; **Renk ve LUT** (LUT dosyalarıyla, .cube); **Efektler** (Eski televizyon ya da VHS kaset gibi bir görünüm, durağan resimde hareketli ışık, ortam çerçevesi, keskinlik, gren, vinyet); **Maske**; **Kırp**; **Yeşil perde**; **Takip** (bir hareket izleyiciyi takip etme); **Animasyon** (giriş, çıkış ve görünürken hareket); sinematik hareket; resim hareketleri; **Anahtar kareler** (oynatma çizgisinde **Alt+K**); klipten sonraki geçiş.
- **Görünüm**: birçok klibe birden giden şeyler. **Kamera görünümü** (Film, Super 8, gren, vinyet, sinema bantları…) çizelgede bir katmandır: birini seç, oynatma çizgisine yerleşir; sonra bir klip gibi kırp ve taşı. **Canlı çerçeve**, durağan resim ışıkları, ortam çerçeveleri ve hız rampalı girişler seçili kliplere ya da her klibe uygulanır. **Ölçüm ekranları** resmin düzeylerini gösterir.
- **Altyazı**: **Altyazı üret** konuşmadan altyazıyı bu bilgisayarda çalışan bir modelle üretir; güvenilir kelime zamanları için konuşulan dili seç (yeni proje arayüzün diliyle başlar). SRT içe ve dışa aktarılır; kelimeler canlandırılabilir.
- **Şablon**: G şeridinde seçili şablon (türü, maddeleri, görünüşü).
- **Notlar**: iş notların (aşağıda).
- **Proje**: **Ses** (otomatik müzik kısma, geçiş sesleri), **Metin** (konuşma metni: kelimeleri seçip kes, aralık işaretle), **Ayarlar** (ad, çözünürlük, kare hızı, arka plan, proje görünümü, önizlemede yapışma, işleme kuyruğu, bölümler, arşiv).

### Metinle kurgu, sessizlikler ve dolgular
- **Proje → Metin** söylenenleri gösterir. Kelimeleri seçip kesmek çizelgeyi aynı anlarda keser.
- Önizlemenin araç çubuğundaki **Sessizliği kes** duraksamaları bulur; hangilerinin gideceğini sen seçersin.

### Şablonlar ve kod klipleri
- **Yazı**'da G şeridi için 31 hazır grafik var (listeler, grafikler, haritalar, satranç tahtası, video oynatıcı…). Hareketini görmek için kartın üstüne gel; **Oynatma çizgisine ekle** onu oraya koyar.
- **Kod klipleri** videonun üstünde canlı çizilen web sayfalarıdır: içinde `index.html` olan bir klasör (varsa sesi `audio/mix.wav`'da). Sol panelin **Kod** sayfasındaki **Kod filmi ekle** ile ya da oradaki altı kod şablonundan biriyle eklenir. Kod klibinin parametreleri Inspector'da ayarlanır; **Değerleri düzenle** sayılarını ve renklerini açar. Ajan kaydedilmemiş bir projede kod klibi oluşturduğunda önce Belgeler içinde projeye bir `.snipp` dosyası verir.

### İş notları
- **N** oynatma çizgisine not koyar; Notlar şeridinde **Shift + sürükle** bir aralık işaretler; orada çift tıklamak o ana bir nottur. Not, önizlemede bir çizim taşıyabilir.
- Bir ajan bağlıyken **Ajana gönder** açık notları ona verir; cevapları onaylaman için notlara geri gelir.

### Kaydetme
- **Ctrl+S** kaydeder; yeni bir proje bir kez ad sorar. Projeler `.snipp` dosyalarıdır; medya dosyaları yerinde kalır ve yollarıyla bulunur.
- Kaydedilmemiş değişiklik varken uygulama bir kurtarma kopyası tutar ve bir çökmeden sonra onu önerir.
- **Dosya → Önceki sürümler…** dosyanın, bir kaydetme üstüne yazmadan önceki son beş hâlini saklar.
- **Dosya → Projeyi arşivle…** projeyi bütün medyasıyla tek bir klasöre kopyalar.
- **Dosya → Projeler…** projelerini listeler (arama, sıralama, klasörlerde proje bulma).

## Dışa aktarma

**Dışa aktar** (ya da **Dosya → Video ya da ses…**) dışa aktarma penceresini açar.

- **Hazır ayarlar**: YouTube 1080p, YouTube 4K, Shorts / Reels (dikey bir proje), Özel.
- **Biçim**: MP4 (H.264), WebM (VP9) ya da yalnız ses: MP3, M4A (AAC), WAV.
- **Boyut**: projenin boyutu, hız için daha küçük ya da 4K'ya kadar daha büyük. **Kare hızı** ve **Kalite**.
- **Aralık**: bütün çizelge ya da giriş / çıkış noktaları.
- **Ses yüksekliği**: bir hedefe eşitle (YouTube hazır ayarlarında varsayılan −14 LUFS).
- **Kodlayıcı**: otomatik (seçimi alıyorsa ekran kartının kodlayıcısı, yoksa yazılım) ya da yazılım.
- Dışa aktarma penceresi ilerlemeyi ve kalan süreyi gösterir; üst çubuktaki **İşlemeler** dışa aktarmaları listeler.
- Dosya menüsündeki öbür dışa aktarmalar: altyazılar (.srt), bir seslendirme takımı için SRT + kelime SRT + MP3, o anki kare (PNG). Shorts bölümleri Shorts panelinden dışa aktarılır.

## Kısayollar

Her eylemin tuşu, uygulama kurulduğundaki hâliyle. **Ayarlar → Klavye kısayolları** (ya da **Dosya → Yardım → Klavye kısayolları**) onları uygulamada gösterir; her biri orada değiştirilebilir ya da hazır bir takım (Premiere Pro tarzı, CapCut tarzı) bir kerede seçilebilir.

<!-- shortcuts:start -->
| Eylem | Tuş |
|---|---|
| Oynat / Duraklat | `Boşluk` |
| Seçimi ya da kesim aralığını sil | `Backspace` |
| Oynatma çizgisinde böl | `S` |
| Bölme aracı (bir klibe tıkla, orada böler) | `B` |
| Kaydırma aracı (klibi sürükle, görüntüsü içinde kayar) | `Y` |
| Kesici aracını aç / kapat | `C` |
| Seçim aracı | `A` |
| Çizelgedeki her şeyi seç | `Ctrl + A` |
| Geri al | `Ctrl + Z` |
| Yinele | `Ctrl + Shift + Z` |
| Projeyi kaydet | `Ctrl + S` |
| Başa git | `Home` |
| Bir kare geri | `Sol ok` |
| Bir kare ileri | `Sağ ok` |
| 1 saniye geri atla | `Shift + Sol ok` |
| 1 saniye ileri atla | `Shift + Sağ ok` |
| Seçili klipleri 1 kare sola it | `Alt + Sol ok` |
| Seçili klipleri 1 kare sağa it | `Alt + Sağ ok` |
| Giriş noktası: dışa aktarma aralığı (Shorts kipinde Shorts bölümü) | `I` |
| Çıkış noktası: dışa aktarma aralığı (Shorts kipinde Shorts bölümü) | `O` |
| Bütün projeyi sığdır | `Shift + Z` |
| Seçili kliplere yakınlaş | `Z` |
| Önceki kesim noktasına atla | `Yukarı ok` |
| Sonraki kesim noktasına atla | `Aşağı ok` |
| İşaretli aralığı döngüye al | `Ctrl + L` |
| Sonraki işaretleyiciye atla | `Shift + M` |
| Önceki işaretleyiciye atla | `Ctrl + Shift + M` |
| Seçili klipleri kapat / aç | `D` |
| Oynatma çizgisinde iş notu | `N` |
| Önceki anahtar kare | `Alt + ,` |
| Sonraki anahtar kare | `Alt + .` |
| Oynatma çizgisinde anahtar kare ekle ya da sil | `Alt + K` |
| En yakın kesime varsayılan geçişi ekle | `Ctrl + T` |
| Hedef klibi oynatma çizgisinde böl | `Ctrl + B` |
| Klibin oynatma çizgisinin solundaki kısmını sil (yalnız kendi izi kayar; Alt: bütün izler) | `Q` |
| Klibin oynatma çizgisinin sağındaki kısmını sil (yalnız kendi izi kayar; Alt: bütün izler) | `W` |
| Oynatma çizgisindeki boşluğu kapat | `E` |
| Geri sar (J) | `J` |
| Sarmayı durdur (K) | `K` |
| İleri sar (L) | `L` |
| Ayarları aç | `Ctrl + ,` |
| Bir zamana ya da kareye git | `G` |
| Daha yavaş oynat | `[` |
| Daha hızlı oynat | `]` |
| Önizleme %100 (bir piksele bir piksel) | `1` |
| Önizlemeyi sığdır | `0` |
| Önceki iş notu | `,` |
| Sonraki iş notu | `.` |
| Önizlemenin altında anlatım satırı | `Shift + C` |
| Önizlemenin üstünde kısayol listesi | `?` |
| Turda: önce / sonra | `B` |
| Turda: onayla | `Y` |
| Önizlemeye not: tıkla, iğnele, yaz | `Shift + N` |
| İzle ve not ver kipi | `Shift + R` |
<!-- shortcuts:end -->

## Bilinen sınırlar

- Bu sürüm **yalnız Windows** için; macOS ve Linux paketleri henüz yapılmadı.
- Kurulum dosyası **imzalı değil**: Windows SmartScreen çalıştırmadan önce uyarır.
- **Kendiliğinden güncelleme yok**: uygulama yeni sürüm denetlemez (internete çıkmaz).
- Altyazılar bu bilgisayarda çalışan tek bir konuşma modelinden gelir (birçok dil; sınanan dil Türkçe ve İngilizce). İşlemcide çalışır: on dakikalık bir konuşma altı çekirdekli bir masaüstü işlemcisinde yaklaşık sekiz dakika sürdü.
- HDR görüntü standart aralıkta (SDR) dışa aktarılır.
- Bir kod klibinin sayfası ağ erişimi olmadan çalışır.
- Türkçe arayüzü henüz bir çevirmen gözden geçirmedi.
