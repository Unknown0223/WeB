# Total (ИТОГ) — har bir ustun logikasi (hozirgi holat) va fayl bilan solishtirish

Bu hujjat **har bir ustun qanday hisoblanadi** va **kelayotgan ma'lumotlar fayl bilan solishtirilganda farq nima uchun chiqadi**ni batafsil tushuntiradi.

---

## 1. Brend / Hudud

**Logika (hozirgi holat):**
- **РЕСПУБЛИКА** blokida: har qator = bitta **brend**. Brendlar ro'yxati **faqat SAVDO** listidan olinadi (`getUniqueBrendsAndFilials()` → brendlar stateSavdo dan).
- **Hudud** blokida: sarlavha = **filial nomi** (Yunusobod, Sergeli, …). Filiallar OYLIKLAR (B), RASXODLAR (hudud), SAVDO (C=sklad) dan olinadi; faqat **oylik yoki savdo ma'lumoti bor** filiallar ko‘rsatiladi. Har bir filial blokida qatorlar = shu filialda **SAVDO** da savdosi bor brendlar.

**Fayl bilan solishtirish:**
- Excel ИТОГ da ham B ustunida brend yoki hudud nomi. Agar faylda qatorlar boshqa tartibda yoki qo‘shimcha brend (masalan DOSTAVKA alohida qator) bo‘lsa, vebda u ko‘rinmaydi — chunki brendlar faqat SAVDO dan, DOSTAVKA esa SAVDO da brend emas.

---

## 2. Komanda oyligi

**Logika (hozirgi holat):**
- **Respublika:** `sumOylikByTuri(stateOyliklar, { brend }, sameKey)` — OYLIKLAR da **brend** (J yoki C) joriy qator brendiga mos va **oylik turi** "Komanda oyligi" (yoki alias) bo‘lgan barcha qatorlarning **F (summa)** yig‘indisi. Filial farqi yo‘q (barcha filiallar yig‘iladi).
- **Hudud:** `sumOylikByTuri(stateOyliklar, { filial, brend }, sameKey)` — OYLIKLAR da **B=filial**, **J yoki C=brend** va **oylik turi = "Komanda oyligi"** bo‘lgan qatorlarning F yig‘indisi.
- Oylik turi `matchOylikTuri(oylikTuri)` orqali aniqlanadi; "Komanda oyligi", "komanda", "команда оклади" va b. aliaslar qo‘llanadi.

**Fayl bilan solishtirish — farq sabablari:**
- Excelda brend **C** ustuniga qarab filtrlansa, vebda **J || C** ishlatiladi — ba’zi qatorlar qo‘shilishi yoki chiqarilishi mumkin.
- Filial/hudud nomi faylda boshqacha (masalan kirillcha) bo‘lsa, backend kirill→lotin qiladi; agar nom jadvalda bo‘lmasa, yig‘indi boshqa hududga yoki 0 ga ketishi mumkin.
- OYLIKLAR faylida **E** (yoki sarlavha orqali aniqlangan “oylik turi”) ustunida faqat "Komanda oyligi" va "DS va Qolgan bolimlar…" bo‘lsa, boshqa turlar 0 — Komanda oyligi o‘zi to‘g‘ri keladi, farq odatda **filial/brend** nomi yoki **C/J** talqinidan keladi.

---

## 3. DS va qolgan oyliklar

**Logika (hozirgi holat):**
- Xuddi Komanda oyligi kabi, lekin **oylik turi** = "DS va Qolgan bolimlar oyliklari" (yoki "ds va qolgan", "остальные отделы", "qolgan bo'limlar" va b. aliaslar). `sumOylikByTuri` da `sum(OYLIK_TURI_DS)`.
- Manba: OYLIKLAR **E** (oylik turi), **F** (summa); filtr: respublika uchun brend, hudud uchun filial + brend.

**Fayl bilan solishtirish — farq sabablari:**
- Faylda E ustunida matn boshqacha yozilsa (masalan "DS и остальные отделы") — alias orqali tan olinadi. Agar yangi yozuv bo‘lsa, `matchOylikTuri` da alias qo‘shish kerak.
- Faylda bu tur umuman yo‘q bo‘lsa, vebda 0 — bu holda farq **fayl tarkibi**, kod xatosi emas.

---

## 4. OFIS oylik

**Logika (hozirgi holat):**
- `sumOylikByTuri` da `sum(OYLIK_TURI_OFIS)` — oylik turi "OFIS oylik" (yoki "ofis", "офис оклади" va b.) bo‘lgan qatorlar F yig‘indisi. Filtr: brend (respublika) yoki filial+brend (hudud).

**Fayl bilan solishtirish — farq sabablari:**
- Logda `oylikTurlari` da faqat 2 ta tur ko‘rinsa (Komanda va DS), **OFIS faylda yo‘q** — vebda 0. Excelda OFIS boshqa listda yoki boshqa ustunda bo‘lsa, veb faqat OYLIKLAR E ustunini o‘qiydi.
- Nom boshqacha bo‘lsa (masalan "Офис оклади") — alias bor; boshqa variant uchun alias qo‘shish kerak.

---

## 5. BRAND MANAGER

**Logika (hozirgi holat):**
- `sumOylikByTuri` da `sum(OYLIK_TURI_BM)` — oylik turi "BRAND MANAGER" (yoki "brand manager", "бренд менеджер" va b.) bo‘lgan qatorlar F yig‘indisi.

**Fayl bilan solishtirish — farq sabablari:**
- OFIS kabi: faylda E da bu tur yo‘q bo‘lsa vebda 0. Excelda bor bo‘lsa, E ustunida aniq shu (yoki alias) yozilganligini tekshiring.

---

## 6. Oyliklar jami

**Logika (hozirga holat):**
- **Hisoblangan:** Komanda oyligi + DS + OFIS + BRAND MANAGER.  
  `o.jami = komanda + ds + ofis + brandManager` (sumOylikByTuri dan).  
  Excel: H = SUM(D:G).

**Fayl bilan solishtirish — farq sabablari:**
- OFIS va BM 0 bo‘lsa, jami kam bo‘ladi — farq **oylik turlari** faylda to‘liq yo‘qligidan.
- Komanda yoki DS farq qilsa, yuqoridagi Komanda/DS bo‘limidagi sabablar (filial/brend nomi, C/J, oylik turi matni) qo‘llanadi.

---

## 7. Filial sarflari

**Logika (hozirgi holat):**
- **Respublika:** `jamiRasxodResp * savdoPct` — barcha RASXODLAR jami (barcha hududlar) × (shu brendning respublika savdodagi ulushi). Ulush: `savdo / jamiSavdo`.
- **Hudud:** `rasxodFilialJami * savdoPctFilial` — **shu filial** uchun RASXODLAR jami × (shu brendning **shu filial** savdodagi ulushi).  
  `rasxodFilialJami` = RASXODLAR da hudud nomi filialga mos qatorlarning jami (AN) yig‘indisi. Hudud nomi registrsiz va kirill→lotin normallashtirilgan.

**Fayl bilan solishtirish — farq sabablari:**
- **Hudud nomi:** Faylda "Сергели" / "SAMARQAND" kabi yozuvlar bo‘lsa, backend birlashtiradi va lotin nom chiqaradi. Agar yangi variant (masalan boshqa kirill yozuv) jadvalda bo‘lmasa, shu hudud rasxodi boshqa nom ostida yig‘iladi yoki yo‘qotiladi — filial sarflari kam bo‘ladi.
- **Taqsimot:** Excelda ham filial sarflari savdo ulushiga taqsimlanadi (RASXODLAR!$AN$34*P yoki SUMIF*P). Vebda jami rasxod yoki savdo boshqacha bo‘lsa, filial sarflari ham farq qiladi.
- **RASXODLAR jami:** AN(39) yoki 2-ustun ishlatiladi; faylda ustun tartibi boshqacha bo‘lsa, jami noto‘g‘ri o‘qilishi mumkin.

---

## 8. Podarkalar

**Logika (hozirgi holat):**
- **Doim 0.** Hech qanday listdan o‘qilmaydi va hisobga olinmaydi.

**Fayl bilan solishtirish — farq sabablari:**
- Excelda K (Подаркалар) yoki boshqa manba bo‘lsa, vebda 0 — **implement qilinmagan**. Farq shundan.

---

## 9. Sarflar jami

**Logika (hozirgi holat):**
- **Hisoblangan:** Oyliklar jami + Filial sarflari + Podarkalar.  
  `sarflarJami = o.jami + filialSarflari + podarkalar`.  
  Excel: L = J+H+K.

**Fayl bilan solishtirish — farq sabablari:**
- Oyliklar jami yoki filial sarflari fayldan farq qilsa, sarflar jami ham farq qiladi. Podarkalar 0 bo‘lgani uchun Excelda K > 0 bo‘lsa, vebda jami kam bo‘ladi.

---

## 10. Savdo

**Logika (hozirgi holat):**
- **Respublika:** `stateSavdo.filter(r => sameKey(r.brend, brend))` — SAVDO da **brend** joriy qator brendiga mos barcha qatorlarning **D (summa)** yig‘indisi (barcha skladlar).
- **Hudud:** `stateSavdo.filter(r => sameKey(r.sklad, filial) && sameKey(r.brend, brend))` — shu **filial (sklad)** va **brend** bo‘lgan qatorlarning D yig‘indisi.
- Manba: SAVDO **A** (brend), **C** (sklad), **D** (summa).

**Fayl bilan solishtirish — farq sabablari:**
- SAVDO parse odatda barqaror; A, C, D ustunlari aniq. Agar faylda ustunlar siljigan bo‘lsa (sarlavha boshqa qatorda yoki ustunlar boshqa tartibda), parse xato berishi mumkin — bunday hollarda farq chiqadi.
- Sklad/filial nomi faylda boshqacha (registr, probel) bo‘lsa, `sameKey` registrsiz solishtiradi — kichik farqlar bartaraf etiladi.

---

## 11. САВДО %

**Logika (hozirgi holat):**
- **Respublika:** `savdo / jamiSavdo` — shu brend savdosi / respublika jami savdo. 0–1 oralig‘i, ekranda foiz ko‘rsatiladi.
- **Hudud:** `savdo / filialSavdoJami` — shu brendning shu filialdagi savdosi / shu filial jami savdo. Hudud ichidagi ulush.
- **ИТОГО** qatorida: respublika uchun 1 (100%); hudud uchun `filialSavdoJami / jamiSavdo` — filialning respublikadagi ulushi.

**Fayl bilan solishtirish — farq sabablari:**
- Excelda ba’zan hudud ИТОГО da 100% yoki foizlar yig‘indisi boshqacha ko‘rsatiladi. Vebda **hudud ichida** brend ulushi va **respublika** ulushi aniq formulaga ega; ko‘rinish (masalan 100% vs 9.36%) **hisoblash bazasining** farqi (hudud jami vs respublika jami).

---

## 12. Рент %

**Logika (hozirgi holat):**
- **Har bir qator:** `sarflarJami / savdo` (savdo > 0 bo‘lsa).  
  `rentPct = savdo ? sarflarJami / savdo : 0`.  
  Excel: Q = L/N.

**Fayl bilan solishtirish — farq sabablari:**
- Sarflar jami yoki Savdo fayldan farq qilsa, Рент % ham farq qiladi. Asosan **oyliklar** va **filial sarflari** noto‘g‘ri bo‘lsa, Рент % ham noto‘g‘ri bo‘ladi.

---

## 13. Рент РЕСП %

**Logika (hozirgi holat):**
- **Respublika** blokida: odatda "—" yoki ko‘rsatilmaydi (chunki respublika o‘zi bazadir).
- **Hudud** blokida: **ИТОГО** qatorida `itogoSarflarJami / filialSavdoJami` — shu filialning jami sarflari / shu filialning jami savdosi. Har bir brend qatorida ham hudud blokida Рент РЕСП % = Рент % (shu blok uchun bir xil baza).

**Fayl bilan solishtirish — farq sabablari:**
- Filial sarflari yoki filial savdo fayldan farq qilsa, Рент РЕСП % ham farq qiladi.

---

## 14. Kelayotgan ma'lumotlarni fayl bilan solishtirish — qisqa yo‘riqnoma

| Qadam | Nima qilish |
|-------|-------------|
| 1 | **OYLIKLAR** — Logda `oylikTurlari` ni ko‘ring. Faqat 2 ta tur bo‘lsa, OFIS va BM faylda yo‘q; ular 0 — farq **fayl tarkibi**. |
| 2 | **OYLIKLAR** — Excelda E ustunini tekshiring: "Komanda oyligi", "DS va Qolgan…", "OFIS oylik", "BRAND MANAGER" (yoki ruscha) bormi? Boshqa nom → alias qo‘shish yoki E ni to‘g‘rilash. |
| 3 | **OYLIKLAR** — B (filial) va J/C (brend) nomlari SAVDO va RASXODLAR dagi nomlar bilan bir xil yoki normallashtirilganmi? (registr, kirill/lotin). |
| 4 | **RASXODLAR** — Hudud nomlari faylda kirillcha yoki boshqa yozuvda bo‘lsa, ular `CYRILLIC_HUDUD_TO_LATIN` / `LATIN_HUDUD_ALIASES` da bormi? Yo‘q bo‘lsa filial sarflari kam yig‘iladi. |
| 5 | **RASXODLAR** — Jami ustun AN(39) yoki 2 — faylda shu ustunda jami bormi? Ustun tartibi boshqacha bo‘lsa parse noto‘g‘ri. |
| 6 | **SAVDO** — A=brend, C=sklad, D=summa. Fayl struktura bilan mosmi? Savdo raqamlari odatda fayl bilan mos keladi. |
| 7 | **Podarkalar** — Vebda 0. Excelda K ustuni yoki boshqa manba bo‘lsa, farq **implement qilinmagan** dan. |

**Xulosa:** Ko‘p hollarda farq **fayl tarkibi** (oylik turlari faqat 2 ta, OFIS/BM yo‘q, podarkalar manbai yo‘q) va **hudud/filial nomlari** (kirill, registr, turli yozuvlar) dan keladi. Formulalar (yig‘indi, ulush, rent %) Excel ИТОГ bilan mos; ma'lumot kirishida kamchilik bo‘lsa, natija farq qiladi.
