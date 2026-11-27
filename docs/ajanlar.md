# Ajanla çalışmak

[English](agents.md) · [Kullanım kılavuzu](kullanim.md)

SnippStudio, zaten kullandığın bir yapay zekâ kodlama ajanının projeni okumasına ve düzenlemesine izin verebilir. Ajan senin programındır, kendi hesabınla giriş yapmıştır; SnippStudio ona yerel bir bağlantı üzerinden küçük bir araç takımı verir ve ne yaptığını sana gösterir. **Ajan erişimi** kapalıyken ajana ait hiçbir şey çalışmaz.

## Hangi ajanlar

| Ajan | Nasıl bağlanır | Durum |
|---|---|---|
| Claude Code | Bir kez Claude Code'a eklenir (`claude mcp add`); sonra her Claude Code sohbeti araçları görür | sınandı |
| Codex | Bir kez Codex'e eklenir (`codex mcp add`); anahtarı, Codex'i başlattığın terminaldeki bir ortam değişkeninden okur | deneysel · doğrulanmadı |
| OpenCode | SnippStudio kopyalaman için bağlantı ayarlarını verir; onu OpenCode'un ayarına sen eklersin | deneysel · doğrulanmadı |
| Antigravity (`agy`) | SnippStudio, Antigravity'nin MCP ayar dosyasına girecek satırı yazdıran bir komut kopyalar; satırı oraya sen eklersin | deneysel · doğrulanmadı (gerçek bir Antigravity ile hiç denenmedi) |

Ajan bu bilgisayarda kurulu ve giriş yapılmış olmalı (komut satırı kullanımını içeren bir planla). **Ayarlar → Ajan bağlantısı** hangilerini bulduğunu, sürümlerini ve eksik olan için kopyalanacak kurulum komutunu ve resmî bağlantıyı gösterir. SnippStudio ajanı kendi başına başlatmaz; **Sohbet** sekmesi, kurulu Claude Code'u yalnız bir ileti gönderdiğinde başlatır. Ajanının anahtarlarını ya da belirteçlerini okumaz, saklamaz, yazmaz: giriş, ajanın kendi akışıdır. Ajana iş, ajanın kendi sohbetinden ya da SnippStudio'dan gönderilerek verilir (aşağıda **Programdan ajana gönder**).

## Bağlanma

Hepsi tek yerde: **Ayarlar → Ajan bağlantısı** (üst çubuktaki dişli, **Dosya → Ayarlar…** ya da Ctrl+,; Mac'te ⌘,). Üstte programını seç (**Claude Code**, **Codex (terminal)**, **Codex (masaüstü)**, **OpenCode** ya da Antigravity ve öbürleri için **Başka**: deneysel), sonra numaralı beş adımı izle. Her adım tek iş ve tek düğme; sonucunu o anda gösterir; her birinin altında **Olmadıysa** en sık nedenleri verir.

1. **Ajan erişimini aç** (üst çubuktaki anahtarla aynı).
2. **Programa SnippStudio'yu tanıt**: **Komutu kopyala**, bir komut penceresi aç (Başlat'a "Terminal" yaz), yapıştır, Enter'a bas. Bir kez. Komut anahtarı göstermez: senin komut pencerende SnippStudio'nun ayar dosyasından okunur. Claude Code için `claude mcp add --transport http --scope user snippstudio …` çalışır; Codex için anahtar Windows kullanıcına kalıcı yazılır (`SNIPPSTUDIO_TOKEN`) ve `codex mcp add snippstudio --url … --bearer-token-env-var SNIPPSTUDIO_TOKEN` çalışır. OpenCode: ayarı `opencode.json`'a yapıştır. Başka: komut anahtarlı ayarı yazdırır, programının ajan ayarına yapıştırırsın (Antigravity, deneysel: `.agents/mcp_config.json`; orada anahtar düz metin durur). SnippStudio bir ajanın ayarına kendisi hiç yazmaz.
3. **Programı yeniden aç**. Sıra önemli: önce SnippStudio ve erişim, sonra ajan. Ondan önce açılmış pencere araçları görmez (Claude Code: `/mcp` → Reconnect; Codex uygulaması: tümüyle kapatıp yeniden aç).
4. **Denetle**: dört satır, her biri tikli ya da çarpılı ve ne yapılacağıyla: kayıt bulundu, anahtar güncel, SnippStudio dinliyor, ajan bağlandı (saatiyle). Yalnız okur (`claude mcp get`, `codex mcp get --json` ve Windows'ta Codex anahtarının eşleşip eşleşmediği, PowerShell içinde karşılaştırılarak).
5. **Dene**: ajana yazılacak cümleyi kopyala; bağlanınca adım bunu söyler.

Geliştirme kopyası (SnippStudio Dev) kendi adıyla (`snippstudio-dev`), kendi portuyla ve Codex için kendi değişkeniyle (`SNIPPSTUDIO_DEV_TOKEN`) eklenir; ikisi birbirinin üstüne yazmaz. **Anahtarı yenile** yeni bir anahtar yapar (iki adımlı onay): bağlı ajanların bağlantısı kesilir, eski anahtar 10 dakika sonra çalışmaz. **Yeniden bağla** (2. adımda ya da eski anahtarı bulan denetim satırında) bulduğu program için 2. adımı senin yerine çalıştırır: Claude Code, Codex ve OpenCode kendi kayıtlarını yazar; SnippStudio yalnız o programın kendi komutunu başlatır. **Bulunan ajanları kendiliğinden onar** açıkken (varsayılan, Ayrıntılar altında), anahtarı yüzünden reddedilen bir istek burada bulunan programların kaydını kendiliğinden onarır; reddedilen ajan yine de yeniden bağlanır ya da yeniden açılır. Ajan ayarlarının başka hiçbir yerine dokunmaz; proje klasörüne de bir şey yazmaz.

**Ajan erişimi**'ni kapatmak sunucuyu kapatır: hiçbir şey dinlemez.

### Bağlantının kendisi
- Yalnız bu bilgisayarda (`127.0.0.1`) HTTP üzerinden bir MCP sunucusu; ajan belirteci SnippStudio'nun ayar dosyasından alır. Web sayfalarından gelen istekler reddedilir.
- Her oturum bir pencereye ve onun projesine aittir.
- Anahtarı gizli tut: erişim açıkken onu bilen her şey projelerini düzenleyebilir.

## SnippStudio içinde sohbet

**Sohbet** sekmesi (ajan erişimi açıkken sağ panelde) bu bilgisayardaki Claude Code komut satırıyla editörden çıkmadan konuşur. İlk ileti onu açık projenin klasöründe başlatır; yazdıkları ve her araç çağrısı orada, turun süresi ve maliyetiyle görünür. Sonraki ileti aynı sohbetin bağlamını korur; **Yeni sohbet** bağlamsız baştan başlatır, **Durdur** turu ve programı bitirir.

- Zaten kurulu ve giriş yapılmış Claude Code'u kullanır (bağlantı sayfasının bulduğu gibi). Ayarlar'dan bağlanan dışarıdan bir ajan aynı şekilde çalışmaya devam eder.
- Yapabildikleri: uygulamanın kendi araçları (proje, transkript, kareler, çözümleme, düzenleme, notlar, iş, kod klipleri, medya; her çağrı her ajanınki gibi editöre gelir) ve proje klasöründe dosya düzenlemeleri. **Kabuk** ileti kutusunun altındaki anahtar açılana kadar kapalıdır; açıkken ajan bu bilgisayarda soru sormadan her komutu çalıştırabilir, bu yüzden yalnız ona ne yaptıracağına güveniyorsan aç.
- **Model**, CLI ortamının tuttuğu model kimliklerinden seçilir (Varsayılan, CLI'nin kendi seçimidir). Açık bir sohbette model değişikliği konuşmanın bağlamını korur. **Kip**, CLI'nin izin kipidir: Düzenlemeleri kabul et (varsayılan), Otomatik (CLI'nin sınıflandırıcısı karar verir) ya da Plan.
- **Sıkıştır**, CLI'nin kendi `/compact` komutunu gönderir; yazmak da aynıdır. Döküm, özetin ardından sürer. `/` yazınca CLI'nin sunduğu komutlar listelenir. İleti kutusunun altındaki **Bağlam**, son turun boyutunu modelin penceresine göre gösterir; %70’e yaklaşınca sararır, %90’a yaklaşınca kızarır ve tepeye yakın **Yakında sıkıştır** der.
- Görseller: **+** düğmesi ya da yapıştırma en çok dört görsel ekler (PNG, JPEG, WebP, GIF; her biri 8 MB), küçük resim olarak görünür ve × ile kaldırılır.
- Bir iletinin üzerine gelince altında **Kopyala** görünür; kendi iletilerinde ayrıca **Buraya geri sar** bulunur: o iletiyi ve sonrasındaki her şeyi sohbetten çıkarır, iletiyi (görselleriyle) kutuya geri koyar. CLI'nin kendi dökümü de birlikte kesilir; sonraki yanıt çıkardıklarını artık hatırlamaz. İlk iletide önce sorar: oraya geri sarmak tüm sohbeti bitirir.
- **Sohbetler** (sol panel) bu projenin sohbetlerini listeler. Her sohbet konuştukça kaydedilir ve ilk sözlerinle adlandırılır; satır onu açar — uygulamadan çıkıp yeniden açtığında CLI aynı konuşmayı sürdürür — çöp düğmesi onu CLI dökümüyle birlikte siler.
- Uygulamanın `wait` aracı sohbette sunulmaz: kendi sohbeti başka yerde olan ajan içindir. Tur bitince ajan yanıtlar.
- Sekme şeridindeki **paneli gizle** düğmesi Inspector'ı katlar (hatırlanır): önizleme ve zaman çizelgesi tüm genişliği alır; pencere kenarındaki ok geri getirir.
- İlk sürümde yalnız **Claude Code** komut satırı barındırılır. Codex ve OpenCode dış ajan olarak kalır; kendi adaptörleri aynı sekmenin arkasına gelebilir.
- Sohbet süreci uygulamanın çocuğudur: pencereyi kapatmak, ajan erişimini kapatmak ya da çıkmak onu ve başlattığı her şeyi bitirir. Anahtarı sürece ortamıyla gider; sayfaya ya da komut satırına asla.

## Ajan ne yapabilir: araçlar

| Araç | Ne yapar |
|---|---|
| `project` | Açık proje: boyut, uzunluk, sürüm, şeritler ve klipler, altyazılar, işaretleyiciler, henüz yerleşmemiş medya. İlk çağrılan. |
| `new_project` | Bu pencerede boş bir proje başlatır (16:9, 9:16 ya da 1:1; isteğe bağlı ad). Yalnız açık projenin kaydedilmemiş değişikliği ve bekleyen taslağı yoksa; `save:true` verilmedikçe henüz dosyası yoktur. |
| `transcript` | Söylenenler, satır satır zamanlarıyla; kelime zamanları yalnız ince kesilecek bir aralık için. |
| `frames` | 1–12 andaki görüntü, dışa aktarmanın çizdiği gibi, tek bir resimde (zamanlarıyla bir ızgara). |
| `changes` | Okuduğu bir sürümden beri ne değişti: her şeyi yeniden okumaktan ucuz. |
| `analyze` | SnippStudio'nun bu bilgisayarda yaptığı ölçümler: sessizlikler, dolgu sesleri, tekrarlanan cümleler, ses yüksekliği ve tempo, dışa aktarma öncesi denetim, numaralı resimler için yerleşim planı, anahtar kelimeler. SnippStudio bulur; ajan (ve sen) karar verir. |
| `edit` | Düzenlemeler: kesimler, taşımalar, başlıklar, geçişler, şablonlar ve daha fazlası, tek adımda. |
| `notes` | İş notların: bekleyenleri okur ve yanıtlar; sen onaylarsın. |
| `job` | Uzun işler: altyazıyı SnippStudio'nun kendi konuşma modeli yazar. Dil projenin konuşulan dilidir (Altyazı sekmesindeki seçim; yeni proje arayüzün dilini alır); ajan Türkçe ya da İngilizce derse o dil. Hangisi olduğunu `project` cevabı söyler. |
| `code_clip` | Kod klibi: boş bir `index.html` ile klasörünü açar (kaydedilmemiş projeye gerekirse önce Belgeler yanında dosya verir) ve yerleştirir; bir sayfayı denetler (hatalar, boş ya da kararsız kareler, uzunluğu). |
| `media` | Medya kutusu: yerel video, ses ve resim dosyalarını yoluyla içe aktarır (`import`); bir varlığı aynı türden yeni bir dosyaya yöneltir (`replace`: yeniden üretilmiş bir miks, yeni bir take), uygulamayı kapatmadan. |
| `wait` | Senin SnippStudio'dan gönderdiğini bekler: gönderdiğin anda döner (notlar, yazdığın iş, taslağa cevabın); bir şey gelmezse birkaç dakika sonra "henüz yok" der, ajan yeniden çağırır. |

Ajan bir kod klibinin sayfasını istediği gibi yazar: SnippStudio ona nasıl çizeceğini söylemez ve sayfayı yazıldığı gibi oynatır (ağsız).

## Programdan ajana gönder

Terminal açmadan, ajanın sohbetine doğrudan iş gönderebilirsin:
- **Notlar** sekmesinde **Ajana gönder (n)**: açık notlar gider.
- **Komut kutusu**na bir iş yaz ("girişi sıkılaştır") ve **Gönder**'e bas (Ctrl+Enter). Seçtiklerin (klipler, dosyalar, aralık, bölge) tek satır olarak işle birlikte gider. Hazır bir işin tam sözü ("sessizlikleri kes") ajana gitmez, burada yapılır.
- **Taslak kartında** **Kabul** ya da **Reddet**: cevabın ajana gider; kartın alanına yazdığın kısa söz de onunla gider ("şimdi değil").

Nasıl ulaşır: ajan işini bitirince `wait` aracını çağırır ve bekler. Gönderdiğin anda bu çağrı döner, gönderdiğin ajanın sohbetine gelir, ajan işe başlar. **Ajan** sekmesi durumu söyler: "Ajan bekliyor: gönderdiğin anda alacak" ya da "Ajan şu an çalışıyor ya da beklemiyor: gönderdiğin iş sırada" (sıradaki iş ajanın bir sonraki `wait` çağrısında gider). Altında **Son gönderilenler** listelenir. Her şey bir kez gider.

- Gönderilenler yalnız o pencerenin ajanına gider ve yalnız bellekte durur: başka bir proje açınca ya da programı kapatınca sıradaki iş silinir. Notlar silinmez: projede durur, ajan `notes` ile de okur.
- Ajan beklemiyorsa (üst çubuk **Cevabını bekliyor** der: sırasını sana bıraktı) düğmenin altındaki satır **Sırada · sohbete yapıştır** der, yanında **Kopyala**: gönderdiğini (notların numarası, zamanı, türü, sözü ya da iş) sade metin olarak panoya koyar ve sıradan çıkarır; ajanın sohbetine yapıştır. Her Gönder'in yanındaki kopyala düğmesi aynı metni göndermeden verir.
- İki ajan bağlıyken gönderdiğin şey, o an kim bekliyorsa ona değil, projede çalışan ajana gider (projeyi değiştiren ya da senin devrettiğin ajan). Taslağa verdiğin cevap taslağı yapan ajana gider. Öbür ajan projeyi okuyabilir; beklediğinde ya da notları istediğinde projenin kimde olduğu ona söylenir, not almaz.
- Gönderdiğin metin ajana veri olarak gider; SnippStudio hiçbir şeyi kendi çalıştırmaz. Ajan bu kutuya bir şey yazamaz.

## Taslaklar: karar senin

- Varsayılan olarak ajanın düzenlemeleri **tek bir taslakta** toplanır. **Ajan** sekmesindeki taslak kartı neyi değiştireceğini (kesimler, kaç saniye kısalacağı, eklenen, düşen) gösterir; **Önce** / **Sonra** / **Önizleme**, ve **Tümünü kabul et**, **Seçilenleri kabul et** ya da **Reddet**.
- **Ajan ayarları → Doğrudan uygula** düzenlemelerin taslak yerine doğrudan projeye gitmesini sağlar; her biri yine tek bir geri alma adımıdır.
- Bir taslak beklerken düzenleme yaparsan taslak senin son sürümüne göre yeniden kurulur. İçeriği gitmiş bir düzenleme düşürülür ve söylenir; hiçbir zaman yanlış yere konmaz.
- **Ajan öncesine dön** projeyi ajan değiştirmeden önceki hâline tek bir geri alma adımıyla döndürür (Ctrl+Z ajanın işini geri getirir). Adımlar listesi oturumun herhangi bir adımına dönmeni sağlar.

## Token: az harcamak

- Ölçümleri SnippStudio yerelde yapar (sessizlik, dolgu, tekrar, ses yüksekliği) ve kısa numaralı listelerle cevap verir; ajan bütün filmi okumak yerine bunlardan karar verir.
- Araç tanımları küçük tutulur; `changes` yeniden okumayı önler.
- Resimler yalnız ajan kare isteyince, seçtiğin **Varsayılan kare genişliği**yle (384, 512 ya da 768 px) gider.
- **Ajan** sekmesindeki sayaç, SnippStudio araçlarının ajana kaç token gönderdiğini ve nasıl bölündüğünü (metin, kareler, tanımlar) gösterir. Ajanın kendi düşünme ve yazma maliyeti dahil değildir.
- Komut kutusundaki **hazır işler** (sessizlikleri kes ve öbürleri) SnippStudio'nun kendisinde çalışır: ajana hiçbir şey gitmez, 0 token. Kutunun üstündeki etiketler (seçili klipler, dosyalar, aralık, karede çizilen bölge) ajanın bir sonraki `project` çağrısında görünür.

## Ajana ne gider, ne gitmez

Ajana (ve dolayısıyla onun sağlayıcısına) gider: projenin yapısı (şeritler, klipler, zamanlar, adlar), altyazıların metni, istediği kareler, iş notların ve çizimleri, analizlerin sonuçları ajanın sohbetine yazdığın ve SnippStudio'dan gönderdiğin işler.

Gitmez: medya dosyalarının kendisi (videolar, sesler), açık projenin dışındaki hiçbir şey, ajan anahtarların. SnippStudio internete kendisi hiçbir şey göndermez; sağlayıcısıyla ajanın kendi programı konuşur.

## Araç cevaplarının dili

Araçların cevapları arayüzün dili ne olursa olsun **İngilizcedir**: onları sen değil ajan okur. Notların ve yazdığın işler yazdığın gibi gider.
