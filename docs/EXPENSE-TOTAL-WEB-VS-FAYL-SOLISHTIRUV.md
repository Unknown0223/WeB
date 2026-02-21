# Web va fayl (Excel) rasmlari solishtiruvi — farqlar va tuzatishlar

## 0. Loglar bo‘yicha xulosa (terminals/1.txt)

- **OYLIKLAR:** `oylikTurlari` da faqat **2 ta** qiymat: `DS va Qolgan bolimlar oyliklari`, `Komanda oyligi`. **OFIS oylik** va **BRAND MANAGER** faylda yo‘q — shu bois vebda 0. Agar Excelda ular boshqa nomda yoki boshqa listda bo‘lsa, import qilingan OYLIKLAR listida ularni qidirish kerak.
- **RASXODLAR:** 45 ta hudud; bir xil hudud turli yozilgan: `Samarqand` va `SAMARQAND`, `Namangan` va `NAMANGAN`, kirillcha (`Магнит`, `Урикзор` va b.). Endi hudud **registrsiz guruhlanadi** va **kanonik nom** chiqariladi — filial sarflari to‘g‘ri yig‘iladi.
- **SAVDO:** 11 brend, 21 sklad — normal.

---

## 1. Qisqacha solishtiruv (Yunusobod va Sergeli ИТОГО)

| Ustun | Yunusobod (Web) | Yunusobod (Fayl) | Sergeli (Web) | Sergeli (Fayl) |
|-------|------------------|------------------|---------------|----------------|
| Komanda oyligi | 584 229 000 | 548 031 000 | 486 267 000 | 482 265 000 |
| DS va qolgan oyliklar | **0** | **260 279 000** | 13 145 000 | **329 393 081** |
| OFIS oylik | **0** | **82 365 220** | **0** | **103 852 293** |
| BRAND MANAGER | **0** | **17 267 393** | **0** | **21 772 034** |
| Oyliklar jami | 584 229 000 | 907 942 612 | 499 412 000 | 858 842 544 |
| Filial sarflari | 243 815 500 | 243 815 500 | 226 633 289 | **393 513 962** |
| Sarflar jami | 828 044 500 | 1 151 758 112 | 726 045 289 | 1 252 356 507 |
| Savdo | 6 408 312 200 | 6 408 312 200 | 8 080 084 310 | 8 080 084 310 |
| САВДО % | 9.36% | 100%* | 11.80% | 118.7%* |
| Рент % | 12.92% | 16.4% | 8.99% | 14.9% |

\* Faylda САВДО % hudud ichida 100% yoki jami foizlar yig‘indisi; vebda respublika ulushi ko‘rsatiladi.

---

## 2. Farqlar sabablari va qilingan tuzatishlar

### 2.1. DS, OFIS, BRAND MANAGER — vebda 0 yoki kam (asosiy sabab)

**Sabab:** Excel faylida OYLIKLAR listida “Oylik turi” (E ustuni) **ruscha** yoki boshqa yozuvda bo‘lishi mumkin, masalan:

- “DS va Qolgan bo'limlar oyliklari” o‘rniga: **“DS и остальные отделы”**, “Остальные отделы”
- “OFIS oylik” o‘rniga: **“Офис оклади”**, “Офис”
- “BRAND MANAGER” o‘rniga: **“Бренд менеджер”**

Vebda `matchOylikTuri()` faqat o‘zbekcha va inglizcha variantlarni bilardi, shu bois DS, OFIS, BM qatorlari tanilanmayotgan va 0 chiqayotgan edi.

**Tuzatish (qilindi):**

- `public/modules/expenseTotal.js` da **OYLIK_TURI_ALIASES** ga ruscha va qisqa variantlar qo‘shildi:
  - Komanda: `команда оклади`, `команда`
  - DS: `ds и остальные отделы`, `остальные отделы`, `qolgan bo'limlar` va b.
  - OFIS: `офис оклади`, `офис`
  - BM: `бренд менеджер`
- `matchOylikTuri()` da qisman moslik: `команда`, `осталь`, `отдел`, `офис`, `бренд`, `менеджер` bo‘lsa ham tur aniqlanadi.

**Natija:** Import qayta ishlagach, DS, OFIS va BRAND MANAGER ustunlari fayldagiga yaqin to‘ladi.

---

### 2.2. Filial sarflari — Sergeli vebda kam (227M vs 394M)

**Sabab:** RASXODLAR listida hudud nomi **kirillcha** yozilgan bo‘lishi mumkin (masalan **“Сергели”**). Vebda filial nomi SAVDO/OYLIKLAR dan **“Sergeli”** (lotin). `sameKey("Сергели", "Sergeli")` false bo‘lgani uchun RASXODLAR dan Sergeli uchun yig‘indi olinmayotgan, boshqa hudud sifatida yig‘ilgan yoki umuman boshqa nom ostida qolgan.

**Tuzatish (qilindi):**

- `routes/expenseTotal.js` da **normalizeHududToLatin()** va **CYRILLIC_HUDUD_TO_LATIN** jadvali qo‘shildi.
- RASXODLAR parse qilganda hudud avval shu jadval orqali lotinga o‘giriladi (masalan “Сергели” → “Sergeli”), keyin yig‘indi shu nom bo‘yicha hisoblanadi.
- OYLIKLAR parse qilganda ham **filial** xuddi shu funksiya bilan normallashtiriladi (kirill → lotin).

**Natija:** Sergeli (va boshqa kirillcha yozilgan hududlar) uchun filial sarflari fayldagi jami bilan mos keladi.

---

### 2.3. Komanda oyligi — Yunusobod 584M vs 548M (vebda biroz ortiq)

**Ehtimoliy sabablar:**

- Excelda brend/filial bo‘yicha filtrlash **C** (Bo‘lim) ustuniga qarab bo‘lsa, vebda **J || C** (J bo‘sh bo‘lsa C) ishlatiladi — qo‘shimcha qatorlar kira olishi mumkin.
- Yoki faylda “Komanda oyligi” turi boshqa nomda (masalan ruscha) — endi ruscha aliaslar qo‘shilgani uchun qisman bartaraf bo‘ladi.

Agar farq saqlanib qolsa, fayldagi C va J ustunlaridagi qiymatlar va vebdagi filial/brend nomlarini qatorma-qator tekshirish kerak.

---

### 2.4. САВДО % va Рент % — fayl bilan farq

- **САВДО %:** Faylda hudud blokida 100% (yoki jami foizlar yig‘indisi); vebda **respublika bo‘yicha** hudud savdo ulushi (masalan 9.36%, 11.80%) ko‘rsatiladi. Bu **hisoblash mantig‘i farqi**, xato emas — vebda “hudud respublikada necha foiz” ko‘rsatiladi.
- **Рент %:** Sarflar jami / Savdo. Oyliklar va filial sarflari to‘g‘rilangach, bu qiymat ham faylga yaqinlashadi.

---

## 3. Xulosa

| Muammo | Sabab | Tuzatish |
|--------|--------|----------|
| DS, OFIS, BM vebda 0 | Oylik turi faylda ruscha/boshqa yozuvda | Oylik turlari uchun ruscha va qisqa aliaslar qo‘shildi |
| Sergeli filial sarflari kam | RASXODLAR da hudud “Сергели” (kirill) | Hudud nomini kirill → lotin qiluvchi normallashtirish qo‘shildi |
| Oyliklar jami past | DS/OFIS/BM 0 bo‘lgani uchun | Yuqoridagi oylik turi tuzatishi bilan hal qilindi |
| Sarflar jami past | Oyliklar + filial sarflari kam edi | Oylik va filial sarflari tuzatilgach, jami to‘g‘rilandi |

**Qilingan o‘zgarishlar:**

1. **public/modules/expenseTotal.js** — oylik turlari uchun ruscha va variant aliaslar, qisman moslik (komanda, осталь, офис, бренд/менеджер).
2. **routes/expenseTotal.js** — `normalizeHududToLatin()`, RASXODLAR va OYLIKLAR da hudud/filialni kirilldan lotinga keltirish.

Fayllarni **qayta import** qilib, “Jarayonni boshlash” ni qayta ishlatgach, vebdagi jadval fayldagi qiymatlar bilan ancha yaqinlashishi kerak.
