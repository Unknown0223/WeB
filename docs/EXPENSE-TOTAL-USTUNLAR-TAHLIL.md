# Total (ИТОГ) — har bir ustun qayerdan olinadi va fayl bilan mosligi

Bu hujjat rasmdagi jadval ustunlarini hozirgi kod va Excel fayli (OYLIKLAR, RASXODLAR, SAVDO) bilan solishtirib tahlil qiladi.

---

## 1. Umumiy manbalar

| List       | Fayldagi ustunlar (parse) | Maqsad |
|------------|---------------------------|--------|
| **OYLIKLAR** | B(1)=Filial, C(2)=Bo'lim, E(4)=Oylik turi, F(5)=Summa, J(9)=Brend | Oylik turlari bo'yicha yig'indi (filial + brend) |
| **RASXODLAR** | A(0) yoki F(5)=Hudud, AN(39)=Jami (yoki 2-ustun) | Hudud bo'yicha filial sarflari jami |
| **SAVDO**  | A(0)=Brend, C(2)=Sklad, D(3)=Summa | Savdo va brend ro'yxati |

---

## 2. Ustunma-ustun tekshiruv

### 2.1. Brend / Hudud

- **Qayerdan:** Jadvaldagi qatorlar **SAVDO** listidagi brendlar va hudud nomlaridan keladi.
- **Respublika bloki:** Har qator = bitta **brend** (LALAKU, GIGA, …) — brendlar ro'yxati faqat SAVDO dan.
- **Hudud bloki:** Sarlavha = **filial/hudud** (Yunusobod, Sergeli, …); qatorlar = shu hududda savdosi bor brendlar (SAVDO da C=Sklad bo'yicha).
- **Fayl bilan moslik:** ✅ Excel ИТОГ da ham B ustunida brend yoki hudud nomi; brendlar SAVDO yo'nalishlari.

---

### 2.2. Komanda oyligi

- **Qayerdan:** **OYLIKLAR** — E=«Komanda oyligi» (yoki alias: "komanda oyligi", "komanda"), F=Summa.
- **Respublika:** `sumOylikByTuri(stateOyliklar, { brend })` — faqat brend bo'yicha (barcha filiallar yig'indisi). Excel: SUMIFS(OYLIKLAR!F:F, OYLIKLAR!E:E, "Komanda oyligi", OYLIKLAR!C:C, brend).
- **Hudud:** `sumOylikByTuri(stateOyliklar, { filial, brend })` — filial + brend + oylik turi. Excel: SUMIFS(..., OYLIKLAR!B:B, filial, OYLIKLAR!C:C, brend, OYLIKLAR!E:E, ...).
- **Parse:** OYLIKLAR da B=row[1], E=row[4], F=row[5], brend=row[9]||row[2]. ✅ To'g'ri.
- **Eslatma:** Oylik turi Excel da har xil yozilishi mumkin; kodda `matchOylikTuri` va aliaslar ("komanda", "ds va qolgan bolimlar" va b.) ishlatiladi. Agar faylda boshqa matn bo'lsa (masalan "Команда оклади") — qo'shimcha alias kerak bo'lishi mumkin.

---

### 2.3. DS va qolgan oyliklar

- **Qayerdan:** **OYLIKLAR** — E=«DS va Qolgan bolimlar oyliklari» (yoki "ds va qolgan", "qolgan bolimlar" va b.), F=Summa.
- **Logika:** Xuddi Komanda oyligi kabi, faqat oylik turi boshqacha. Respublika: brend bo'yicha; Hudud: filial + brend.
- **Fayl bilan moslik:** ✅ Formulalar bir xil, faqat E ustuni turli qiymat.

---

### 2.4. OFIS oylik

- **Qayerdan:** **OYLIKLAR** — E=«OFIS oylik» (yoki "ofis oylik", "ofis"), F=Summa.
- **Logika:** Shunday oylik turi bo'lgan qatorlar yig'indisi (brend/filial+brend bo'yicha).
- **Fayl bilan moslik:** ✅ To'g'ri.

---

### 2.5. BRAND MANAGER

- **Qayerdan:** **OYLIKLAR** — E=«BRAND MANAGER» (yoki "brand manager", "brand manager oylik"), F=Summa.
- **Logika:** Shunday oylik turi bo'lgan qatorlar yig'indisi.
- **Fayl bilan moslik:** ✅ To'g'ri.

---

### 2.6. Oyliklar jami

- **Qayerdan:** **Hisoblangan** — Komanda oyligi + DS + OFIS + BRAND MANAGER.
- **Kod:** `o.jami` = `komanda + ds + ofis + brandManager` (sumOylikByTuri dan). Excel: H = SUM(D:G).
- **Fayl bilan moslik:** ✅ Formulaga mos.

---

### 2.7. Filial sarflari

- **Qayerdan:** **RASXODLAR** — hudud bo'yicha jami (AN yoki 2-ustun), keyin savdo ulushiga taqsimlanadi.
- **Respublika:** `jamiRasxodResp * savdoPct` — barcha RASXODLAR jami × (brend savdo / jami savdo). Excel: RASXODLAR!$AN$34*P.
- **Hudud:** `rasxodFilialJami * savdoPctFilial` — shu hudud RASXODLAR jami × (brendning hudud ichidagi savdo ulushi). Excel: SUMIF(RASXODLAR!F:F, hudud, RASXODLAR!AN:AN)*P.
- **Parse:** RASXODLAR da hudud = row[5]||row[0], jami = row[39] (AN) yoki row[2]. ✅ Hujjatda F va AN ishlatiladi.
- **Fayl bilan moslik:** ✅ Taqsimot logikasi Excel bilan bir xil.

---

### 2.8. Podarkalar

- **Qayerdan:** Hozir **0** (RASXODLAR dan alohida «Подаркалар» yoki aniq kataklar yig'indisi implement qilinmagan).
- **Excel:** Ba'zi qatorlarda K72+K85+… kabi aniq kataklar. Vebda hozircha doim 0.
- **Fayl bilan moslik:** ⚠️ Agar faylda podarkalar bo'lsa, ular jadvalda 0 ko'rinadi — kelajakda RASXODLAR dan yoki alohida ustun dan olish mumkin.

---

### 2.9. Sarflar jami

- **Qayerdan:** **Hisoblangan** — Oyliklar jami + Filial sarflari + Podarkalar.
- **Kod:** `sarflarJami = o.jami + filialSarflari + podarkalar`. Excel: L = J+H+K.
- **Fayl bilan moslik:** ✅ To'g'ri.

---

### 2.10. Savdo

- **Qayerdan:** **SAVDO** — A=Brend, C=Sklad, D=Summa.
- **Respublika:** Brend bo'yicha barcha skladlardagi savdo yig'indisi: `stateSavdo.filter(r => sameKey(r.brend, brend))`.
- **Hudud:** Shu filial (sklad) va brend: `stateSavdo.filter(r => sameKey(r.sklad, filial) && sameKey(r.brend, brend))`.
- **Parse:** SAVDO da A=row[0], C=row[2], D=row[3]. ✅ To'g'ri.
- **Fayl bilan moslik:** ✅ SUMIFS(SAVDO!D:D, SAVDO!A:A, brend) va hudud uchun sklad+brend mos.

---

### 2.11. САВДО %

- **Qayerdan:** **Hisoblangan** — brend savdo / mos jami savdo.
- **Respublika:** `savdo / jamiSavdo` (respublika bo'yicha ulush). Excel: N3/$N$14.
- **Hudud:** `savdo / filialSavdoJami` (hudud ichida ulush). Excel: N18/$N$28.
- **Fayl bilan moslik:** ✅ Formulaga mos.

---

### 2.12. Рент %

- **Qayerdan:** **Hisoblangan** — Sarflar jami / Savdo (Savdo > 0 bo'lsa).
- **Kod:** `rentPct = savdo ? sarflarJami / savdo : 0`. Excel: Q = IFERROR(L/N, 0).
- **Fayl bilan moslik:** ✅ To'g'ri.

---

### 2.13. Рент РЕСП %

- **Qayerdan:** Hudud bloklarida: hudud bo'yicha sarflar jami / hudud savdo (shu blok ИТОГО si).
- **Kod:** ИТОГО qatorida `rentPct` = `itogoSarflarJami / filialSavdoJami`. Respublika blokida bu ustunda odatda «—» yoki respublika renti.
- **Fayl bilan moslik:** ✅ Hudud blokida L/N (hudud jami) mantiqi.

---

## 3. ИТОГО qatori

- Barcha ustunlar uchun jami: har bir ustun o'yindisi (komanda, ds, ofis, bm, oyliklar jami, filial sarflari, podarkalar, sarflar jami, savdo) blok ichida yig'iladi.
- САВДО %: Respublika uchun 1 (100%); hudud uchun hudud savdo / jami savdo.
- Рент %: sumSarflarResp / jamiSavdo (respublika), itogoSarflarJami / filialSavdoJami (hudud).
- **Fayl bilan moslik:** ✅ SUM(...) oralig'i va foizlar Excel bilan mos.

---

## 4. Xulosa va tavsiyalar

| Ustun              | Manba        | Holat | Izoh |
|--------------------|-------------|-------|------|
| Brend / Hudud      | SAVDO + filial | ✅   | Brendlar faqat SAVDO dan; hududlar OYLIKLAR/RASXODLAR/SAVDO dan. |
| Komanda oyligi     | OYLIKLAR E,F | ✅   | Oylik turi matni alias orqali moslashtiriladi. |
| DS va qolgan oyliklar | OYLIKLAR E,F | ✅ | Shuningdek alias orqali. |
| OFIS oylik         | OYLIKLAR E,F | ✅   | — |
| BRAND MANAGER      | OYLIKLAR E,F | ✅   | — |
| Oyliklar jami      | Hisoblangan  | ✅   | D+E+F+G. |
| Filial sarflari    | RASXODLAR   | ✅   | Hudud + AN; savdo ulushiga taqsimlanadi. |
| Podarkalar         | Hozir 0     | ⚠️   | Faylda bo'lsa, keyinchalik RASXODLAR/aniq ustun qo'shish mumkin. |
| Sarflar jami       | Hisoblangan | ✅   | J+H+K. |
| Savdo              | SAVDO A,C,D | ✅   | Brend va (hududda) sklad bo'yicha. |
| САВДО %            | Hisoblangan | ✅   | N/jami N. |
| Рент %             | Hisoblangan | ✅   | L/N. |
| Рент РЕСП %       | Hisoblangan | ✅   | Hudud blokida L/N. |

**Umumiy:** Har bir ustun ma'lumoti hozirgi fayl tuzilishi (OYLIKLAR B,C,E,F,J; RASXODLAR A/F,AN; SAVDO A,C,D) va Excel ИТОГ formulalari bilan mos keladi. Yagona farq — **Podarkalar** hozir doim 0; agar faylda K ustuni yoki boshqa manba bo'lsa, uni qo'shish kerak bo'ladi. Shuningdek, fayldagi oylik turi matnlari boshqa tillarda yoki boshqa yozuvda bo'lsa, `matchOylikTuri` ga qo'shimcha alias qo'shish foydali bo'ladi.
