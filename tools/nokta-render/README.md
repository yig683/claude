# Nokta'nın görsellerini üretmek

`nokta/assets` altındaki her şey buradaki betiklerle üretildi. Modun çalışması için bunları çalıştırman gerekmez; karakteri değiştirmek, yeni bir gövde ya da yeni bir hareket kare eklemek istersen.

## Gerekenler

Python 3.11 ve:

```
pip install bpy==4.5.14 numpy scipy scikit-image pillow
```

`bpy`, Blender 4.5'in python modülü. Render CPU'da çalışır (Cycles, OIDN gürültü giderme). `NK_THREADS=2` ortam değişkeni Blender'ın iş parçacığı sayısını ayarlar; birkaç betiği yan yana çalıştırırken işe yarar.

## Betikler

| Dosya | Ne yapar |
| --- | --- |
| `nk_sdf.py` | Gövdeleri işaretli uzaklık alanı (SDF) olarak modeller: yumuşak birleşim, yuvarlak koniler, elipsoitler; marching cubes ile ağa çevirir. |
| `nk_scene.py` | Sahne: Cycles ayarları, stüdyo ışığı (alan lambaları), kil / göz / cam / kumaş / metal malzemeleri, siklorama arka planı. |
| `nk_shot.py` | Kamera ve yardımcılar: `studio(...)`, `fit_camera`, `fit_fixed`. |
| `nk_char.py` | Karakter: gövdeler (nokta, bulut, tavşan, üçgen), renkler, kollar, yüz (göz, kaş, ağız, yanak) ve sekiz ruh hali, aksesuarlar. `build_body` gövdeyi bir kez kurar, `build_face` yüzü, `clear_face` onu siler: aynı gövdede onlarca ifade render etmenin yolu. |
| `nk_props.py` | Ruh halinin eşyaları (pencere, kıvılcım, konfeti, ter damlası) ve aksesuarlar (gözlük, bere, papyon). |
| `batch_anim.py` | Modun hareket kareleri: her görünüm (gövde × renk × aksesuar, toplam 23) için 25 şeffaf resim, `out/frames/<görünüm>/<ruhhali>-<kare>.png`. Kaldığı yerden devam eder; `--only`, `--shard i/n`, `--reverse`, `--preview` var. |
| `batch_sprites.py` | Yüzen küçük şeyler (yazı balonu, noktalar, `!`, `?`, `z`, kıvılcım, kalpler, damla, konfeti) aynı ışıkta şeffaf resim olarak. |
| `build_looks.py` | `batch_anim.py` çıktısını modun dosyalarına çevirir: her görünüm için bir JSON (büyük ve küçük WebP, terminal için figüre kırpılmış 32 × 32 RGBA). Eksik karesi olan görünümü paketlemez. |
| `contact.py` | Bütün görünümlerin bir karesini tek resimde toplar; render'ı gözle denetlemek için: `python contact.py out/frames out/contact.png neutral-open`. |
| `build_props.py` | Küçük şeyleri `nokta/assets/props.json` olarak paketler (her biri çizileceği boyutta). |
| `batch_final.py` | Tasarım panoları için büyük tanıtım görselleri. |
| `make_sounds.py` | Üç kısa notayı sentezler (`approve`, `done`, `error`); örnek ya da lisans yok. |

## Hangi 25 kare

Modun yönetmeni (`nokta/hooks/motion.ts`, `FRAMES`) bir ruh hali ve bir an verilince bunlardan birini ister; `batch_anim.py` `plan()` işlevi aynı adları üretir. İkisi aynı kalmalı:

| Ruh hali | Kareler |
| --- | --- |
| `neutral` | `open`, `half`, `shut` (göz kırpma), `left`, `right` (bakış) |
| `work` | `mid`, `left`, `right` (satır okur gibi bakış), `half`, `shut` |
| `ask` | `open`, `half`, `shut` |
| `approve` | `w0`, `w1`, `w2` (el sallamanın üç konumu) |
| `happy` | `a`, `b` (kollar sallanır, ağız oynar) |
| `worry` | `a`, `b` (ağız titrer), `shut` |
| `sleep` | `a`, `b` (ağız nefesle açılıp kapanır) |
| `love` | `a`, `b` |

Gövde bir kez kurulur (`build_body`), yüz kare kare yeniden kurulur ve silinir (`build_face`, `clear_face`); el sallama ve kol sallama kolların ucunu omuz çevresinde döndürerek gövdeyi yeniden kurar (`wave`, `sway`). Nefes, süzülme, zıplama, eğilme resimlerin içinde değil, modda çalışma zamanında yapılır.

## Akış

```
python batch_anim.py                         # out/frames/*/  (23 görünüm × 25 kare, CPU'da birkaç saat; --shard ile bölünür)
python batch_sprites.py                      # out/sprites/*.png
python build_looks.py out/frames ../../nokta
python build_props.py out/sprites ../../nokta
python make_sounds.py ../../nokta
cd ../.. && claude plugin test nokta
```

Bir görünümün dosyası `gövde-renk-aksesuar` biçimindedir (`nokta-clay-glasses.json`). Modun `loadPack` işlevi önce o dosyayı, yoksa aynı görünümü aksesuarsız, o da yoksa gövdeyi kendi renginde arar; hiçbiri yoksa terminalde metin yüzü, uygulamalarda hiçbir şey çizilmez (adı ve durumu metin olarak yine görünür).
