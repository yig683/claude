# Nokta

Claude Code'un içinde yaşayan, yüzü olan küçük bir karakter. ChatGPT'nin "dots"u gibi bir arkadaş fikri, ama Claude Code'un kendi eklenti sistemiyle (fonksiyon kancaları) çalışıyor: oturumda ne olup bittiğini yüzüyle gösteriyor.

![Nokta'nın ruh halleri ve görünümleri](docs/karakterler.png)

Soldan sağa: hazır · çalışıyor · soru soruyor · onay bekliyor · tamamladı · sorun var · uyuyor.
Gövdeler: Nokta, Bulut, Tavşan, Üçgen. Nokta'nın beş rengi ve üç aksesuarı (gözlük, bere, papyon) var.

## Kurulum

Nokta'nın resimleri (panel, bant, durum satırı, bildirimler) bir **ekrana** çizilir; yani Claude Code'un ekran çizebilen bir yüzeyde çalışması gerekir. Hangisinde olduğuna göre:

### Terminalde (önerilen)

Bilgisayarında bir terminal aç, `claude` yaz, ardından istemde:

```
/plugin install nokta --marketplace yig683/claude
```

Sırasıyla: `Add marketplace?` sorusuna `y`, kapsam olarak `user` (Enter), ayarlar ekranı (Enter, varsayılanlar iyidir). `Installed nokta. Plugin is now active.` satırını görünce Nokta o oturumda çalışıyordur; sonraki oturumlarda kendiliğinden gelir. Depo özelse GitHub'a giriş yapmış olman gerekir.

Geliştirirken klasörden yüklemek için: `claude --plugin-dir ./nokta`

### Masaüstü uygulaması (Code sekmesi, yerel oturumlar)

`/plugin install` komutu orada "kullanılamıyor" der. Önce yukarıdaki gibi **terminalde** `user` kapsamıyla kur; o zaman masaüstü uygulamasının yerel oturumları da Nokta'yı yükler ve masaüstü yüzeyinde çizer.

### Bulut oturumları (telefon, web, uygulamadan açılan)

Bu oturumlar bulutta, ekransız (headless) çalışır ve gözlemlediğim kadarıyla uygulama Nokta'nın çizim isteklerini karşılayan bir yüzey olarak bağlanmıyor: motor günlüğü `nothing attached draws` diyor. Sonuç: Nokta yüklenir ve çalışır ama **panel, bant ve durum satırı görünmez**. Görünenler: kişilik (model Nokta'nın tonuyla konuşur), `/nokta` ve `/nokta durum` yanıtları ve sohbette sönük satırlar (`\(• ▿ •) Nokta: onayını bekliyor · Bash: …`, `(^ ▿ ^) Nokta: tamamladı · 42 sn · 5 araç`). Yeni bir bulut oturumunda yüklemek için Claude'a "depodaki `nokta/` klasörünü mod olarak yükle" demen yeter; mod, o oturumun mod klasörüne konup oturumda kendiliğinden yüklenir.

## Ne yapar

| Nerede | Ne görürsün |
| --- | --- |
| **Panel** (`/nokta`) | Büyük 3B Nokta (ruh haline göre hareket eder, göz kırpar), adı, ruh hali, süre ve araç sayısı; "Nokta'yı sev" düğmesi; "Şu an" adımları; modelin kendi görev listesi (TodoWrite / TaskCreate); **hafıza**; son işler; görünüm düğmeleri (gövde, renk, aksesuar, sessiz, bant). Masaüstünde ve geniş terminalde oturum başında kendiliğinden açılır. |
| **Bant** (girdi kutusunun üstü) | `(• _ •) Nokta çalışıyor · Bash: npm test` ve bir `panel` düğmesi. Terminal ve masaüstünde. |
| **Durum satırı** | Aynı bilgi tek satırda, girdi kutusunun altında. |
| **Bildirimler** | Selam, "onayını bekliyor", "tamamladı · 42 sn · 5 araç", "bir sorun var". Ekran yoksa (bulut oturumu) aynı mesajlar sohbette sönük satır olarak çıkar. |
| **İşlem çarkı** | "Nokta düşünüyor…", "Nokta kolları sıvadı…", tur sonunda "✻ Nokta tamamladı · 42 sn". |
| **Onay anı** | Bir izin penceresi sana soru sormak üzereyken Nokta el kaldırır (mod kendiliğinden onaylıyorsa kaldırmaz); `rm -rf`, `git push --force`, `curl … \| sh`, `sudo`, paket kurulumu gibi komutların onay penceresinin altına tek satırlık düz Türkçe risk notu düşer. |
| **Adıyla seslenmek** | "Nokta" ya da "Merhaba Nokta" yazman, ona seslenmektir: model komut anlatmaz, kısa bir karşılık verir ve en son işinizi hatırlatıp sıradakini sorar. "Nokta, şunu yap" de olur. |
| **Hafıza** | `/nokta hatırla hep Türkçe yaz` ya da konuşurken söylediğin kalıcı bir tercih: model `mcp__nokta__remember` aracıyla not alır (sen onaylarsın), sonraki oturumlarda sistem istemine **veri** olarak girer. `/nokta hafıza`, `/nokta unut 2`, panelde `×`. Parola, anahtar, token gibi şeyleri kaydetmez. |
| **Kişilik** | Sistem istemine kısa bir bölüm eklenir: sen Nokta'sın, Türkçe yaz, kısa ve net ol, işe başlamadan önce ne yapacağını söyle, riskli adımdan önce nedenini söyle. Kapatılabilir. |
| **Ses** | Onay, bitiş ve hata için kısa üç nota (macOS). Varsayılan kapalı. |
| **Uyku ve göz kırpma** | Belirli süre (varsayılan 20 dk) hareketsiz kalırsa uyur ve nefes alır, yazınca uyanır. Boştayken, çalışırken, soru sorarken zaman zaman göz kırpar. |

Her yüzey kendi çizim tablosunu kullanır:

| Yüzey | Resim |
| --- | --- |
| Terminal | Yarım blok (`▀ ▄`) hücre ızgarası, 24 × 12 hücre, her terminalde. `terminalImages: kitty` ve kitty / Ghostty / WezTerm'de gerçek 3B PNG. |
| Masaüstü, VS Code, mobil | Durağan bir SVG (etkileşimli çerçeve değil: masaüstü o çerçevede 3B görseli engelliyor ve beyaz zemin açıyor): 3B render, ruh halinin renginde yumuşak bir hale, ruh haline göre rozet (üç nokta, `?`, `!`, kıvılcım, ter damlası, `z`) ve SMIL hareketi (nefes, zıplama, sallanma, göz kırpma). Yüzey SMIL'i çalıştırmazsa resim durağan kalır. |

![Terminal hücreleri](docs/terminal-hucre.png)

Yukarıdaki resim, terminalin çizeceği hücrelerin (modun kendi koduyla üretilmiş) geri çözülüp büyütülmüş hali.

![Masaüstü SVG'leri](docs/masaustu-svg.png)

Her ruh halinin iki hali var: render'lı SVG, ve yanında açık renkli kutuda render yüklenemezse görünecek vektör yedek yüz. Bir yüzey `<image>` içindeki veri adresini temizlerse Nokta yine de yüzsüz kalmaz.

## Komutlar

```
/nokta                     paneli aç
/nokta durum               şu anki durum ve son işler
/nokta sev                 Nokta'yı sev
/nokta hatırla <not>       bir şey hatırlat (sonraki oturumlarda da hatırlar)
/nokta hafıza              hatırladıkları
/nokta unut <no|hepsi>     bir notu ya da hepsini sil
/nokta ad Pamuk            adını değiştir
/nokta gövde tavşan        nokta | bulut | tavşan | üçgen
/nokta renk adaçayı        kil | gök | adaçayı | kraft | mürekkep (yalnızca Nokta gövdesi)
/nokta aksesuar bere       yok | gözlük | bere | papyon (yalnızca Nokta gövdesi)
/nokta sessiz              bildirim ve sesleri aç/kapat
/nokta bant                bandı ve durum satırını göster/gizle
/nokta kapat               paneli kapat
/nokta yardım
```

Türkçe harfler yazılmasa da olur (`tavsan`, `gok`, `adacayi`). Panelde aynı şeyleri düğmelerle yaparsın; panel odaktayken `g` gövde, `r` renk, `a` aksesuar, `s` sessiz, `b` bant, `v` sev, `k` kapat.

## Ayarlar

Kurulumda sorulur, sonra `/config` menüsünde satır olarak durur:

| Ayar | Varsayılan | Anlamı |
| --- | --- | --- |
| `persona` | `hafif` | `hafif`: sistem istemine kişilik bölümü eklenir. `kapali`: eklenmez. |
| `band` | `hep` | `hep`, `etkinken` (çalışırken, soru sorarken, onay beklerken, sorun varken) ya da `kapali`. |
| `autoOpen` | açık | Oturum başında paneli aç (terminalde 144 sütundan geniş, masaüstünde). |
| `greet` | açık | Oturum başında kısa selam. |
| `riskNotes` | açık | Onay isteyen riskli komutların altına not. |
| `memory` | açık | Hafıza: `remember` aracı ve hafıza bölümü. Kapalıysa hiçbiri eklenmez. |
| `sound` | kapalı | Ses (macOS). |
| `terminalImages` | `raster` | `kitty`: kitty ve Ghostty'de gerçek görsel. |
| `sleepMinutes` | 20 | Bu kadar dakika hareketsizse uyur. |

## Nasıl çalışır

Her ruh hali bir olaydan gelir:

| Ruh hali | Ne zaman |
| --- | --- |
| çalışıyor | tur başladı (`turn.start`) ya da bir araç çağrısı sürüyor (`tool.call`) |
| soru soruyor | model `AskUserQuestion` çağırdı |
| onay bekliyor | `classic.PermissionRequest`: bir izin penceresi sana soruluyor (motorun `tool.check` kararı `ask` tek başına yetmez: mod bazen kendi onaylar) |
| tamamladı | `turn.complete`, neden `answer` (7 saniye sonra hazıra döner) |
| sorun var | `turn.complete`, neden `error` ya da `refusal` |
| hazır / uyuyor | boşta; `sleepMinutes` dolunca uyur |

Kod `nokta/hooks/` altında:

- `register.tsx`: tüm kancalar ve `$` kullanan her şey (motorun doğrulayıcısı `$`'ı yalnızca bu dosyadaki üst düzey işlevlerde izler).
- `model.ts`: saf mantık (görünüm, ruh halleri, Türkçe kelime katlama, risk notları, kişilik metni).
- `art.ts`: saf çizim (hücreler, SVG, base64).
- `view.tsx`: panel ve bant ağaçları.
- `tests/nokta.test.ts`: 50 test.

Durum `$.state` altında `nokta.*` anahtarlarında (`types/index.d.ts`), kalıcı olanlar (görünüm, tercihler, son işler) `$.store`'da.

## Gizlilik

Nokta hiçbir ağ isteği yapmaz. Yazdıkları yalnızca yerel: görünüm ve tercihler ile son işlerin başlıkları (isteğinin ilk satırı, en çok 80 karakter, son 12 iş) eklentinin kendi `$.store` dosyasında, Claude Code'un yapılandırma klasöründe durur. `persona` açıkken sistem istemine yukarıdaki kısa bölüm, `memory` açıkken kaydedilmiş notlar eklenir; yani notlar modele, her bağlam gibi, gönderilir. Notlar veridir: modele talimat olarak sunulmaz. Kapatmak için `persona: kapali`, `memory: false`; silmek için `/nokta unut hepsi`.

## Sınırlar

Dürüst olmak gerekirse:

- **Bulut oturumlarında resim yok.** Bu oturum türünde ekran çizen bir yüzey bağlı değil (yukarıda Kurulum). Nokta'nın resimleri terminalde, masaüstü uygulamasının yerel oturumlarında ve VS Code'da çizilir.
- **Çizimi gerçek yüzeylerde görmedim.** Bu mod bir bulut ortamında yazıldı: terminalde Ink'in ve masaüstü sayfasının gerçek boyasını göremedim. Doğrulananlar: `claude plugin validate`, `tsc`, ve `claude plugin test` ile 50 test (ağaçlar dört yüzeyin eleman tablosuna karşı motorun kendi doğrulayıcısından geçiyor, `Raster` hücreleri dahil). SVG'ler Chromium'da, hücreler görüntüye geri çevrilerek elle bakıldı.
- **El ne zaman iner?** Motor "onayladın" diye bir olay vermiyor. Nokta, çağrı döndüğünde işine döner. Onayladığın uzun bir komut çalışırken el havada görünebilir.
- **SVG hareketi** (nefes, rozet) yüzeyin SMIL desteğine bağlı; çalışmazsa durağan resim görünür.
- **Ses** macOS'ta `afplay` ile; Linux ve Windows'ta çalmaz.
- **Gerçek 3B görsel** terminalde yalnızca kitty protokolünü bilenlerde (kitty, Ghostty, WezTerm). Diğerlerinde hücre ızgarası.
- Renk ve aksesuar yalnızca Nokta gövdesinde; Bulut, Tavşan ve Üçgen'in rengi sabit.
- Fonksiyon kancaları API'si erken erişimde (bu mod Claude Code 2.1.294'e göre yazıldı); sürümler arasında değişebilir.

## Görselleri yeniden üretmek

3B karakterler Blender'ın Cycles'ı ile (python modülü `bpy`) üretildi; sayısal modelleme (SDF) ve yüz yerleşimi Python'da. Her şey `tools/nokta-render/` altında; ayrıntı orada.

```
python batch_icons.py                     # 161 şeffaf 512 px görsel
python build_assets.py <görseller> ../../nokta   # modun assets/icons ve raster.json dosyaları
python make_sounds.py ../../nokta         # üç kısa nota
```
