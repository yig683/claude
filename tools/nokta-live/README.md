# Canlı modeli denemek ve ayarlamak

Masaüstü uygulamasında Nokta hazır resimlerle değil, ekran kartında, her karede yeniden çiziliyor (`nokta/hooks/hero.ts`, gölgelendirici `hero-shader.ts`). Model Blender'daki karakterin aynısı (aynı gövde alanları, aynı kamera, aynı stüdyo ışığı); ışığın ve malzemenin sayıları ise Blender render'larına bakılarak **uydurulmuş** (`nokta/hooks/hero-palette.ts`). Bu klasör o sayıları yeniden uydurmak ve modeli render'larla yan yana görmek için. Modun çalışması için bunlara gerek yok.

## Gerekenler

Node 24 (TypeScript türlerini kendisi soyar; bunun için ayrıca bir paket gerekmez) ve WebGL 2 çizen bir tarayıcı (Chrome, Edge ya da Claude masaüstü uygulamasının tarayıcı paneli). Python gerekmez.

## Dosyalar

| Dosya | Ne yapar |
| --- | --- |
| `serve.mjs` | Küçük bir sunucu: depodaki dosyaları verir, sayfaların ürettiği resimleri `out/` içine kaydeder (`POST /save`) ve `/mod/...` altında modun TypeScript'ini tarayıcıya verir (türler soyulmuş). |
| `loader.mjs`, `loader-hooks.mjs` | Node'un modun TypeScript'ini uzantısız `import`larıyla okumasını sağlar. |
| `build.mjs` | `out/hero_gl.js` dosyasını yazar: gölgelendirici, 23 görünümün 25'er karesi (gölgelendiricinin okuduğu sayılar olarak) ve paletlerin sayıları. |
| `compare.html` | Canlı modeli render'larla yan yana gösterir, farkı ölçer ve sayıları uydurur. |
| `apply-fits.mjs` | Uydurulan sayıları `hero-palette.ts` içine yazar. |
| `smoke.html` | Uygulamanın çalıştırdığı modülün (`hero.ts`) kendisini gerçek bir tarayıcıda çalıştırır ve çıktısını uygulamanın gösterdiği gibi (bir SVG'nin `<img>`'i olarak) eski resimle yan yana koyar. |

## Akış

```
cd tools/nokta-live
node --import ./loader.mjs build.mjs      # out/hero_gl.js (gölgelendirici ya da paletler değişince yeniden)
node serve.mjs                            # http://localhost:5679
```

Tarayıcıda `http://localhost:5679/tools/nokta-live/compare.html`. Sayfa konsoldan (ya da bir betikle) sürülür:

```js
NK.setMaskMode('body')                    // ışık gövdede ölçülür: 'body' yüz kutusunu dışarıda bırakır,
                                          // 'face' yalnız o kutuyu sayar, 'all' her şeyi
await NK.sheet('nokta-sky-none', 'sky.png')                                  // 25 kare, render ve canlı resim yan yana
await NK.grid(Object.keys(NK.K.looks), 'neutral-open', 'hepsi.png')          // bütün görünümler tek karede
await NK.snap('nokta-ink-none', 'neutral-open', 'ink.png', [60, 60, 200, 150]) // render, canlı resim, fark ve bir parçanın büyütülmüşü

const keys = ['neutral-open', 'neutral-left', 'approve-w1', 'happy-a', 'work-mid', 'sleep-a', 'worry-a']
await NK.fit({ looks: ['nokta-sky-none'], names: ['ambient', 'ambR', 'ambG', 'ambB', 'key', 'fill'], keys, iters: 25 })
window.job                                // ilerleme (iş arka planda sürer)
await NK.dump('fits.json')                // dokunulan her görünümün sayıları, out/ içine
```

`NK.fit` sayıları koordinat inişiyle uydurur: her sayı bir adım yukarı ve aşağı denenir, işe yarayan adım büyür, yaramayan küçülür. `looks` birden çoksa `names` ile verilen sayılar hepsi için **tek değerdir** (aynı renkteki iki gövde ya da her renkteki gözler); verilmeyenler her görünümün kendisinin kalır. Sınırlar `compare.html` içindeki `BOUNDS`'ta.

Sonra:

```
node --import ./loader.mjs apply-fits.mjs out/fits.json
cd ../.. && claude plugin test nokta
```

`apply-fits.mjs` `hero-palette.ts` içinde `begin fitted numbers` ve `end fitted numbers` satırlarının arasını yeniden yazar: kilin (`nokta-clay-none`) sayıları taban olur; her renk için ışığın sayıları ve tabandan ayrılan parlaklık sayıları yazılır. Hangi sayı neyi yapar: `nokta/hooks/hero-slots.ts` (`P`).

## Neyi nereden uydurdum

| Sayılar | Hangi görünümlerden, hangi maskeyle |
| --- | --- |
| Gövdeye düşen ışık (`ambient` … `gain`), parlak yüzeylerin yansıması (`env`, `envF`, `envBlur`) | Her rengin kendi görünümü (`nokta-sky-none` …; iki gövdeli renklerde birlikte: `nokta-ink-none` + `ucgen-ink-none`), `body` maskesi |
| Gözler (`glint`, `eyeEnv`, `eyeBlur`, `eyeLight`, `eyeSpec`), kaşlar (`browThick`), çizgilerin matlığı (`lineMatte`) | Bütün renklerin aksesuarsız görünümleri birlikte, `face` maskesi |
| Gözlüğün çerçevesi ve camı (`envMetal`, `lens`, `world`) | Gözlüklü görünümler, `face` maskesi |

## Gerçek tarayıcıda uçtan uca deneme

`http://localhost:5679/tools/nokta-live/smoke.html` sayfası modülü uygulamanın yaptığı gibi çağırır (önce bağlanır, sonra saat vurdukça kare çizer) ve çıktısını gösterir:

```js
await SMOKE.gallery([['nokta-clay-none', 'happy'], ['tavsan-peach-none', 'approve']], 'galeri.png', { cols: 1 })
await SMOKE.miniGallery([['nokta-clay-none', 'work'], ['ucgen-ink-none', 'worry']], 'bant.png')   // bandın küçük Nokta'sı
```

Sonuç `out/` içine kaydedilir; her kare için gölgelendiricinin hangi ekran kartında çalıştığı, kare boyutu ve süresi de döner.
