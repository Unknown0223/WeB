# Excel "Расход отчет Noyabr 2025" — 100% to'liq ma'lumot va vebga o'tkazish uchun havola

Bu hujjat faylni to'liq o'rganish natijasida tuzilgan. Vebda aynan shu logika va ma'lumotlar asosida ishlash uchun ishlatiladi.

---

## 1. Fayl umumiy ma'lumoti

| Xususiyat | Qiymat |
|-----------|--------|
| Fayl nomi | Расход отчет Noyabr 2025.xlsx |
| Listlar soni | 4 |
| Listlar nomlari | ИТОГ, OYLIKLAR, RASXODLAR, SAVDO |

**Maqsad:** Oy (Noyabr 2025) uchun barcha brend va hududlar bo‘yicha oyliklar, filial sarflari va savdo ko‘rsatkichlarini bitta joyda ko‘rsatish va solishtirish (foizlar bilan).

---

## 2. LIST: ИТОГ (asosiy yig‘indi — vebda "Total")

- **Qatorlar:** 287  
- **Ustunlar:** 18 (A–R)

### 2.1. Ustunlar (sarlavhalar 2-qatorda)

| Ustun | Sarlavha | Izoh |
|-------|----------|------|
| A | (bo'sh) | — |
| B | РЕСПУБЛИКА / Hudud nomi | Brend yoki filial/hudud (LALAKU, GIGA, Yunusobod, Sergeli, …) |
| C | (bo'sh) | — |
| D | Komanda oyligi | Oylik turi: komanda oyligi (summa) |
| E | DS va Qolgan bolimlar oyliklari | Oylik turi (summa) |
| F | OFIS oylik | Oylik turi (summa) |
| G | BRAND MANAGER | Oylik turi (summa) |
| H | Итог ойлик расходлари | D+E+F+G yig‘indisi (oyliklar jami) |
| I | (bo'sh) | — |
| J | Филиаллар расходи | Filial sarflari (summa) |
| K | Подаркалар | Podarkalar (summa) |
| L | РАСХОДЛАР УМУМ | J+H+K (sarflar jami) |
| M | (bo'sh) | — |
| N | САВДО | Savdo (Noyabr) summasi |
| O | (bo'sh) | — |
| P | САВДО % | Savdo ulushi (foiz, 0–1) |
| Q | Рент % | L/N (sarflar/savdo), agar N=0 bo‘lsa 0 |
| R | Рент РЕСП % | Ba’zi bloklarda: L/N hudud bo‘yicha |

### 2.2. ИТОГ tuzilishi (qatorlar logikasi)

- **1-qator:** bo‘sh.  
- **2-qator:** birinchi blok sarlavhalari (РЕСПУБЛИКА va ustun nomlari).  
- **3–13 qatorlar:** **РЕСПУБЛИКА** bloki — har bir **brend** uchun bitta qator (LALAKU, GIGA, DIELUX, MAMA, SOF, REVEREM, ARZONI, ECONOM, APTEKA, MONNO, SET). B ustunida brend nomi, D–R da formulalar natijasi.  
- **14-qator:** **ИТОГО** — barcha brendlar bo‘yicha jami (SUM D3:D13 va b.).  
- **15–16:** bo‘sh.  
- **17-qator:** ikkinchi blok sarlavhalari (masalan, hudud nomi "Yunusobod" va ustun nomlari).  
- **18–28:** **Yunusobod** hududi uchun brendlar (LALAKU, GIGA, …) va **ИТОГО** (28).  
- Keyin **Sergeli, Olmaliq, Guliston, Andijon, NAMANGAN, Farg'ona, QOQON, JIZZAX, Qarshi, Shaxrisabz, Termiz, Denov, SAMARQAND, Kattaqo'rgon, Navoiy, Zarafshon, BUXORO, XORAZM** va b. hududlar uchun xuddi shunday bloklar: har birida sarlavha qatori, keyin brend qatorlari, oxirida **ИТОГО**.

### 2.3. ИТОГ formulalari (qisqa mantiq)

- **D (Komanda oyligi):**  
  `SUMIFS(OYLIKLAR!F:F, OYLIKLAR!E:E, ИТОГ!$D$2, OYLIKLAR!C:C, ИТОГ!B3)` — OYLIKLAR listida E ustuni ИТОГ 2-qator D ga, C ustuni (brend) joriy qator B ga mos qatorlarning F (summa) yig‘indisi.  
  Hudud bloklarida: `SUMIFS(OYLIKLAR!F:F, OYLIKLAR!B:B, ИТОГ!B17, OYLIKLAR!C:C, ИТОГ!B18, OYLIKLAR!E:E, ИТОГ!D17)` — filial + brend + oylik turi bo‘yicha.

- **E, F, G:** OYLIKLAR dan shartli yig‘indi yoki `*P3` (ulush) bilan taqsimlangan qiymatlar.

- **H:** `SUM(D:G)` — oyliklar jami.

- **J (Филиаллар расходи):**  
  Respublika blokida: `RASXODLAR!$AN$34*ИТОГ!P3` (umumiy sarf × savdo ulushi).  
  Hudud blokida: `SUMIF(RASXODLAR!F:F, B17, RASXODLAR!AN:AN)*P18` — RASXODLAR da F (filial) bo‘yicha AN ustuni yig‘indisi × P (ulush).

- **K (Подаркалар):** Ba’zi qatorlarda K72+K85+… kabi aniq kataklar yig‘indisi (ko‘pida 0).

- **L:** `J+H+K` — sarflar jami.

- **N (САВДО):**  
  `SUMIFS(SAVDO!D:D, SAVDO!A:A, ИТОГ!B3)` yoki hudud uchun `SUMIFS(SAVDO!D:D, SAVDO!C:C, B17, SAVDO!A:A, ИТОГ!B18)`. Ba’zi qatorlarda +N279 kabi tuzatish.

- **P (САВДО %):** `N3/$N$14` yoki hududda `N18/$N$28` — jami savdodan ulush.

- **Q (Рент %):** `IFERROR(L/N, 0)` — sarflar/savdo.

- **ИТОГО qatorlari:** Har bir ustun uchun `SUM(...)` mos qator oralig‘i ustida.

---

## 3. LIST: OYLIKLAR (xodimlar oyliklari)

- **Qatorlar:** 1249 (1 sarlavha + 1248 ma’lumot).  
- **Ustunlar:** 10 (A–J).

### 3.1. Ustunlar (1-qator sarlavha)

| Ustun | Ma’nosi | Misol |
|-------|---------|--------|
| A | F.I.O. (ism) | MANSUROVA SHAXNOZA |
| B | Filial / Sklad | Sergeli, Yunusobod, OFIS, Namangan, … |
| C | Bo‘lim / Brend | Meychendayzer, OFIS oylik, APTEKA, LALAKU, GIGA, … |
| D | Lavozim (qisqa) | KA MERCHANDISER, TP, BIZNES ANALITIK, … |
| E | Oylik turi | Komanda oyligi, DS va Qolgan bolimlar oyliklari, OFIS oylik, … |
| F | Summa (so‘m) | 4800000, 14000000, … |
| G | (bo‘sh) | — |
| H | Viloyat | FARGONA VILOYATI, NAMANGAN VILOYATI, … |
| I | Shahar | Farg'ona, Namangan, … |
| J | Brend | LALAKU, GIGA, MAMA, … |

**Vebda kerak:** A, B, C, D, E, F, J — filial, brend, oylik turi va summa bo‘yicha filtrlash va yig‘indilar uchun.

---

## 4. LIST: RASXODLAR (xarajatlar)

- **Qatorlar:** 66.  
- **Ustunlar:** 40 (A–AN).

### 4.1. Tuzilma

- **1-qator:** kunlar 1–31 va ИТОГО (ustunlar raqamlari).  
- **2-qator:** "Код", "Расходы", "Сумма" va boshqa sarlavhalar; keyin OФИС va kunlar.  
- **3-qatordan:** Har bir qator = bitta hudud (yoki xarajat turi) + kod + xarajat turi matni + summa + 1–31 kun uchun summalar + **ИТОГО** (AN ustuni).

**Muhim ustunlar:**  
- Hudud/filial nomi (birinchi ustunlar),  
- Xarajat turi (masalan ОЙЛИК, ПОДАРКИ, АРЕНДА, …),  
- Summa va kunlik ustunlar,  
- **AN** — qator bo‘yicha jami (ИТОГО).

**Vebda kerak:** Filial/hudud va xarajat turi bo‘yicha AN (jami) yig‘indisini olish — ИТОГ da J va K hisoblash uchun.

---

## 5. LIST: SAVDO (savdo)

- **Qatorlar:** 655 (1 sarlavha + 654 yozuv).  
- **Ustunlar:** 4 (A–D).

### 5.1. Ustunlar

| Ustun | Sarlavha | Ma’nosi |
|-------|----------|---------|
| A | Направление торговли | Savdo yo‘nalishi / Brend (APTEKA, ARZONI, …) |
| B | Агент | Agent/sklad yoki kontragent nomi |
| C | Склад | Sklad (filial) joyi — Andijon, Qoqon, Yunusobod, … |
| D | Ноябрь | Noyabr oyi savdo summasi (so‘m) |

**Vebda kerak:** A (brend), C (sklad/filial), D (summa) — ИТОГ da N (САВДО) va P (САВДО %) hisoblash uchun.

---

## 6. Ma’lumot oqimi (jarayon) — vebda takrorlash

1. **OYLIKLAR** — manba: har bir xodim uchun filial (B), brend (J), oylik turi (E), summa (F).  
2. **RASXODLAR** — manba: filial/hudud, xarajat turi, kunlik va jami (AN).  
3. **SAVDO** — manba: brend (A), sklad (C), Noyabr summasi (D).  
4. **ИТОГ** — barcha ko‘rsatkichlarning yig‘indisi:
   - Brend yoki hudud (B) bo‘yicha;
   - Oylik turlari (D–G), oyliklar jami (H);
   - Filial sarflari (J), podarkalar (K), sarflar jami (L);
   - Savdo (N), savdo % (P), rent % (Q, R).

**Hisoblash tartibi:**  
Avval OYLIKLAR, RASXODLAR, SAVDO dan kerakli yig‘indilar (SUMIFS/SUMIF mantiqi), keyin ulushlar: P = N / jami N, Q = L/N (IFERROR(L/N,0)).

---

## 7. Vebga o‘tkazishda qilishlar

1. **Jadval ko‘rinishi:** ИТОГ dagi kabi — birinchi blok (РЕСПУБЛИКА): brendlar 3–13, 14 ИТОГО; keyin har bir hudud uchun alohida blok, har blokda brend qatorlari va ИТОГО.  
2. **Ustunlar:** B (Brend/Hudud), D, E, F, G, H (oyliklar), J, K, L (sarflar), N (savdo), P (САВДО %), Q (Рент %).  
3. **Filtrlar:** Oy (Noyabr 2025), hudud, brend.  
4. **Ma’lumot manbai:**  
   - Hozircha: Excel import (barcha 4 list) → JSON → vebda hisoblash;  
   - Kelajakda: API yoki DB dan OYLIKLAR, RASXODLAR, SAVDO o‘qib, serverda yoki brauzerda shu formulalar mantiqini (SUMIFS, ulushlar, IFERROR) takrorlash.  
5. **Eksport:** To‘liq eksport `docs/excel-full-export.json`, batafsil hisobot `docs/excel-full-report.txt` — 100% ma’lumot va formulalar ro‘yxati uchun.

---

*Hujjat yaratilgan: excel-full-export.js va excel-full-report.txt asosida. Barcha 287 qator ИТОГ, 1249 qator OYLIKLAR, 66 qator RASXODLAR, 655 qator SAVDO eksport qilingan va tahlil qilingan.*
