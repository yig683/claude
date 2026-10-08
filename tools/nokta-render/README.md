# Nokta'nın görsellerini üretmek

`nokta/assets` altındaki her şey buradaki betiklerle üretildi. Modun çalışması için bunları çalıştırman gerekmez; karakteri değiştirmek ya da yeni gövde eklemek istersen.

## Gerekenler

Python 3.11 ve:

```
pip install bpy==4.5.14 numpy scipy scikit-image pillow
```

`bpy`, Blender 4.5'in python modülü. Render CPU'da çalışır (Cycles, OIDN gürültü giderme).

## Betikler

| Dosya | Ne yapar |
| --- | --- |
| `nk_sdf.py` | Gövdeleri işaretli uzaklık alanı (SDF) olarak modeller: yumuşak birleşim, yuvarlak koniler, elipsoitler; marching cubes ile ağa çevirir. |
| `nk_scene.py` | Sahne: Cycles ayarları, stüdyo ışığı (alan lambaları), kil / göz / cam / kumaş / metal malzemeleri, siklorama arka planı. |
| `nk_shot.py` | Kamera ve yardımcılar: `studio(...)`, `fit_camera`, `fit_fixed`. |
| `nk_char.py` | Karakter: gövdeler (nokta, bulut, tavşan, üçgen), renkler, yüz (göz, kaş, ağız, yanak) ve yedi ruh hali, aksesuarlar. |
| `nk_props.py` | Ruh halinin eşyaları: pencere, kıvılcım, konfeti, ter damlası, gözlük, bere, papyon. |
| `batch_icons.py` | Modun ikon matrisi: gövde × renk × aksesuar × ruh hali, şeffaf 512 px. Kaldığı yerden devam eder (var olan dosyayı atlar). |
| `batch_final.py` | Tasarım panoları için büyük tanıtım görselleri. |
| `build_assets.py` | `batch_icons.py` çıktısından modun dosyalarını üretir: 128 px PNG'ler, terminal hücreleri için 24 × 24 RGBA resimler (`raster.json`), her silüetin içine sığan en büyük daire (vektör yedek yüz için). |
| `make_sounds.py` | Üç kısa notayı sentezler (`approve`, `done`, `error`); örnek ya da lisans yok. |

## Akış

```
python batch_icons.py                       # out/icons/*.png  (161 görsel, CPU'da birkaç yarım saat)
python build_assets.py out/icons ../../nokta --preview out/prev
python make_sounds.py ../../nokta
cd ../.. && claude plugin test nokta
```

Yeni bir ikon anahtarı `gövde-renk-aksesuar-ruhhali` biçimindedir (`nokta-clay-glasses-work`). Modun `iconKey()` işlevi aynı adı üretir; bir dosya eksikse mod, terminalde metin yüzüne, SVG yüzeylerde vektör yüze düşer.
