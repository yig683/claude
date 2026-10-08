# Nokta

Claude Code'un içinde yaşayan, yüzü olan karakter. Oturumda ne olduğunu yüzüyle gösterir: çalışırken kaş çatar, onay beklerken el kaldırır, iş bitince sevinir, sorun olunca endişelenir, boşta kalınca uyur.

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
/nokta ad Pamuk            adını değiştir
/nokta gövde tavşan        nokta | bulut | tavşan | üçgen
/nokta renk adaçayı        kil | gök | adaçayı | kraft | mürekkep (yalnızca Nokta gövdesi)
/nokta aksesuar bere       yok | gözlük | bere | papyon (yalnızca Nokta gövdesi)
/nokta sessiz              bildirim ve sesleri aç/kapat
/nokta bant                bandı ve durum satırını göster/gizle
/nokta kapat               paneli kapat
/nokta yardım
```

Ayarlar (`/config` menüsünde): `persona`, `band`, `autoOpen`, `greet`, `riskNotes`, `sound`, `terminalImages`, `sleepMinutes`.

Tüm ayrıntılar, sınırlar ve resimler depo kökündeki [README](../README.md) dosyasında.

## Dosyalar

```
.claude-plugin/plugin.json   bildirim ve userConfig
hooks/hooks.json             tek modül: register.tsx
hooks/register.tsx           kancalar; `$` kullanan her şey burada
hooks/model.ts               saf mantık
hooks/art.ts                 saf çizim: hücreler, SVG
hooks/view.tsx               panel ve bant ağaçları
types/index.d.ts             $.state sözleşmesi (nokta.*)
assets/icons/                128 px şeffaf 3B görseller (gövde-renk-aksesuar-ruhhali.png)
assets/raster.json           terminal hücreleri için küçük RGBA resimler, vektör yedek daireleri
assets/sounds/               onay, bitiş, hata
tests/nokta.test.ts          claude plugin test
```
