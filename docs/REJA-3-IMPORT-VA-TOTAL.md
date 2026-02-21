# Reja: 3 ta alohida import + Total (filial/brend avtomatik)

## 1. Umumiy maqsad

- **3 ta list** (OYLIKLAR, RASXODLAR, SAVDO) **alohida-alohida** import qilinadi — har biri uchun **alohida** fayl tanlash / yuklash.
- **Total** jadvali import qilingan ma’lumotlar asosida **hisoblanadi** va ko‘rsatiladi.
- Import qilingan ma’lumotlarda **yangi filial** yoki **yangi brend** bo‘lsa, Total jadvalida **avtomatik** kerakli joyida (respublika blokida brend qatori, hudud blokida filial va brend qatorlari) paydo bo‘ladi.

---

## 2. 3 ta alohida import

| # | List nomi   | Vazifasi |
|---|-------------|----------|
| 1 | **OYLIKLAR**   | Xodimlar oyliklari — F.I.O., Filial, Brend, Oylik turi, Summa. Har bir oylik turi (Komanda oyligi, DS va qolgan..., OFIS oylik, BRAND MANAGER) va har bir brend/filial bo‘yicha yig‘indi Total da ishlatiladi. |
| 2 | **RASXODLAR**  | Filial xarajatlari — Hudud, xarajat turi, kunlik/jami. Filial sarflari (J) va podarkalar (K) Total da shu listdan hisoblanadi. |
| 3 | **SAVDO**      | Savdo — Brend, Sklad (filial), Noyabr summasi. Total da Savdo (N) va САВДО % (P) shu listdan. |

**Texnik talab:**
- Har bir list uchun **alohida** “Fayl tanlash” (file input) va “Import” tugmasi.
- Yuklangan fayl **bitta** Excel bo‘lsa ham, tizim **bitta listni** tanlaydi yoki faylda **bitta list** bo‘lishi kerak (OYLIKLAR / RASXODLAR / SAVDO).
- Import natijasi: “OYLIKLAR: 1248 qator”, “RASXODLAR: 66 qator”, “SAVDO: 654 qator” kabi status ko‘rsatish.
- Ma’lumotlar frontendda (keyin backendda) saqlanadi — Total hisoblash faqat shu 3 ta manbadan foydalanadi.

---

## 3. Total jadvali — filial va brend avtomatik

- Total **import qilingan** 3 ta listdan **hisoblanadi**. Alohida “Total list” import qilinmaydi.
- **Brendlar ro‘yxati:** OYLIKLAR va SAVDO listlaridan **unique** brend nomlari olinadi. Yangi brend qo‘shilsa — avtomatik Total da (respublika blokida) yangi qator sifatida chiqadi.
- **Filial/hudud ro‘yxati:** OYLIKLAR va RASXODLAR (va kerak bo‘lsa SAVDO sklad) dan **unique** filial/hudud nomlari olinadi. Yangi filial qo‘shilsa — Total da yangi **hudud bloki** (sarlavha + brend qatorlari + ИТОГО) avtomatik qo‘shiladi.
- **Qatorlar tartibi:**
  - Birinchi blok: **РЕСПУБЛИКА** — barcha brendlar (alfabet yoki belgilangan tartib) + **ИТОГО**.
  - Keyingi bloklar: har bir **filial/hudud** uchun — sarlavha (hudud nomi), shu hududdagi brendlar + **ИТОГО**.
- **Ustunlar (Excel ИТОГ ga mos):** Brend/Hudud | Komanda oyligi | DS va qolgan oyliklar | OFIS oylik | BRAND MANAGER | Oyliklar jami | Filial sarflari | Podarkalar | Sarflar jami | Savdo | САВДО % | Рент %.

---

## 4. Jarayon bosqichlari

1. **Import interfeysi (frontend)**  
   - 3 ta kartochka/blok: OYLIKLAR, RASXODLAR, SAVDO.  
   - Har birida: fayl tanlash, “Import” tugmasi, holat matni (yuklandi / qatorlar soni / xato).  
   - Hozircha fayl yuklansa frontendda parse (yoki mock) — backend API bo‘lgach ulash.

2. **Ma’lumotlarni saqlash**  
   - Frontend: 3 ta o‘zgaruvchi (oyliklar, rasxodlar, savdo) — massivlar.  
   - Kelajakda: backend API — 3 ta endpoint (import + get) yoki bitta endpoint 3 ta list uchun.

3. **Brend va filial ro‘yxatini olish**  
   - OYLIKLAR dan: unique Filial (B), unique Brend (J).  
   - RASXODLAR dan: unique hudud/filial (birinchi ustun).  
   - SAVDO dan: unique Brend (A), unique Sklad (C).  
   - Birlashtirib: **barcha brendlar**, **barcha filiallar** — Total jadvalida qatorlar va bloklar uchun.

4. **Total hisoblash**  
   - Har bir (hudud, brend) juftligi uchun:  
     - Oyliklar turlari (D,E,F,G) — OYLIKLAR dan SUMIFS mantiqi.  
     - H = D+E+F+G.  
     - J, K — RASXODLAR dan (filial bo‘yicha).  
     - L = J+H+K.  
     - N — SAVDO dan (brend, sklad).  
     - P = N / jami N; Q = L/N (IFERROR).  
   - Respublika blokida: brend bo‘yicha yig‘indi (filialsiz).  
   - Hudud blokida: filial + brend bo‘yicha.

5. **Total jadvalini ko‘rsatish**  
   - Dinamik thead (ustunlar nomi).  
   - Dinamik tbody: avval respublika bloki (barcha brendlar + ИТОГО), keyin har bir filial bloki (sarlavha + brendlar + ИТОГО).  
   - Filial/Brend filtrlari: dropdown lar ro‘yxati import qilingan ma’lumotdan to‘ldiriladi; filter qilinsa faqat tanlangan hudud yoki brend qatorlari qoladi (yoki bloklar qisqaradi).

---

## 5. Frontend (birinchi navbatda) — qilishlar

- [ ] **3 ta import bloki** — OYLIKLAR, RASXODLAR, SAVDO — alohida file input + Import tugmasi + status.
- [ ] **Filtrlar:** Oy, Hudud (filial), Brend — option lar import dan keyin to‘ldiriladi; yangi filial/brend bo‘lsa avtomatik option ga qo‘shiladi.
- [ ] **Total jadvali** — ustunlar: Brend/Hudud | Komanda oyligi | DS... | OFIS | BRAND MANAGER | Oyliklar jami | Filial sarflari | Podarkalar | Sarflar jami | Savdo | САВДО % | Рент %.
- [ ] **Qatorlar:** Respublika bloki (barcha brendlar + ИТОГО), keyin har bir filial bloki (hudud nomi, brendlar, ИТОГО). Yangi filial/brend import da bo‘lsa — jadvalda avtomatik chiqadi.
- [ ] **Bo‘sh holat:** Hech qaysi list import qilinmagan bo‘lsa — “3 ta listni import qiling” va import bloklarini ko‘rsatish.
- [ ] **Summary kartochkalar:** Jami oyliklar, Jami sarflar, Jami savdo (Total hisoblangan natijadan).

---

## 6. Kelajakda (backend)

- 3 ta import endpoint (yoki 1 ta multipart 3 fayl).
- OYLIKLAR, RASXODLAR, SAVDO ni bazada saqlash.
- Total sahifasi ochilganda API dan hisoblangan Total yoki 3 ta listni olib frontendda hisoblash.

---

*Hujjat: 3 ta alohida import va Total ning filial/brend bo‘yicha avtomatik yangilanishi rejasi.*
