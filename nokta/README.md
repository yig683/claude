# Nokta

Claude Code'un içinde yaşayan, yüzü olan, hareket eden 3B karakter. Masaüstü uygulamasında ekran kartında gerçek zamanlı çizilir. Oturumda ne olduğunu yüzüyle ve hareketiyle gösterir: çalışırken kaş çatar, onay beklerken el sallar, iş bitince zıplar, sorun olunca endişelenir, boştayken nefes alır ve göz kırpar, boşta kalınca uyur.

## Kurulum

Terminalde `claude` aç ve istemde:

```
/plugin install nokta --marketplace yig683/claude
```

`Add marketplace?` sorusuna `y`, kapsam olarak `user`, sonra ayarlar. Kurulduğu oturumda hemen çalışır. Masaüstü uygulamasının yerel oturumları da (terminalde `user` kapsamıyla kurulmuşsa) yükler.

Bulut oturumlarında (telefon, web) ekran çizen bir yüzey bağlı olmadığı için panel, bant ve durum satırı görünmez; yalnızca kişilik, `/nokta` yanıtları ve sohbet satırları çalışır. Ayrıntı: [README](../README.md).

## Kullanım

`/nokta` paneli açar. Komutlar:

```
/nokta                     paneli aç
/nokta durum               durum ve son işler
/nokta sev                 Nokta'yı sev
/nokta hatırla <not>       bir şey hatırlat (sonraki oturumlarda da hatırlar)
/nokta hafıza              hatırladıkları
/nokta unut <no|hepsi>     bir notu ya da hepsini sil
/nokta ad Pamuk            adını değiştir
/nokta gövde tavşan        nokta | bulut | tavşan | üçgen
/nokta renk adaçayı        kil | gök | adaçayı | kraft | mürekkep (yalnızca Nokta gövdesi)
/nokta aksesuar bere       yok | gözlük | bere | papyon (yalnızca Nokta gövdesi)
/nokta hareket             hareketi aç/kapat
/nokta sessiz              bildirim ve sesleri aç/kapat
/nokta bant                bandı ve durum satırını göster/gizle
/nokta tani                canlı 3B'nin durumu; çizemiyorsa nedeni
/nokta canli               canlı 3B'yi yeniden dene
/nokta kapat               paneli kapat
/nokta yardım
```

Adıyla da seslenebilirsin: "Nokta", "Merhaba Nokta", "Nokta, şunu yap".

Ayarlar (`/config` menüsünde): `persona`, `band`, `autoOpen`, `greet`, `riskNotes`, `messages`, `motion`, `live`, `memory`, `sound`, `sleepMinutes`.

Tüm ayrıntılar, sınırlar ve resimler depo kökündeki [README](../README.md) dosyasında.

## Dosyalar

```
.claude-plugin/plugin.json   bildirim ve userConfig
hooks/hooks.json             tek modül: register.tsx
hooks/register.tsx           kancalar ve animasyon saati; `$` kullanan her şey burada
hooks/motion.ts              yönetmen: hangi resim, nasıl hareket; yüzen şeyler
hooks/art.ts                 resimleri SVG'ye ve terminal hücrelerine çevirir
hooks/hero.ts                masaüstünün canlı Nokta'sı: uygulamada çalışan yüzey modülü
hooks/hero-*.ts              canlı modelin saf parçaları: model, gölgelendirici, kare, hareket, ruh halleri, palet, ışık
hooks/gfx.ts                 SVG üreten küçük sahne ağacı
hooks/model.ts               saf mantık
hooks/view.tsx               panel ve bant ağaçları
types/index.d.ts             $.state sözleşmesi (nokta.*)
assets/looks/                her görünümün 25 resmi (gövde-renk-aksesuar.json)
assets/props.json            yüzen küçük 3B şeyler
assets/sounds/               onay, bitiş, hata
tests/                       claude plugin test (nokta.test.ts, hero.test.ts)
```
