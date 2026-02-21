# Sarflar hisoboti (Total) — ma'lumot oqimi, formulalar va "0" sabablari

Bu hujjat **qayerdan qanday ma'lumot keladi**, **har bir ustun qanday hisoblanadi** va **nimaga ba'zi ustunlar 0** ekanini tushuntiradi. Fayl (Excel) bilan moslik va xatolik aniqlash uchun.

---

## 1. Umumiy sxema: 3 ta list → Total jadval

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  OYLIKLAR   │   │  RASXODLAR   │   │    SAVDO     │
│  (B,C,E,F,J)│   │  (A/F, AN)   │   │   (A, C, D)  │
└──────┬──────┘   └──────┬───────┘   └──────┬───────┘
       │                 │                   │
       └─────────────────┼───────────────────┘
                         ▼
              ┌──────────────────────┐
              │  Total jadval        │
              │  (Komanda, DS, ...   │
              │   Savdo, %, Rent %)  │
              └──────────────────────┘
```

- **Brendlar ro'yxati** faqat **SAVDO** dan (A ustuni). Shuning uchun jadvalda LALAKU, GIGA, … va UMUMIY ko‘rinadi.
- **Filiallar** OYLIKLAR (B), RASXODLAR (hudud), SAVDO (C=sklad) dan; faqat ma'lumot bor filiallar.
- **Oylik ustunlari** (Komanda, DS, OFIS, BM) faqat **OYLIKLAR** dan.
- **Filial sarflari** **RASXODLAR** dan (hudud bo‘yicha jami, keyin savdo ulushiga taqsimlanadi).
- **Savdo** va **foizlar** **SAVDO** dan.

---

## 2. Fayldan qaysi ustunlar o‘qiladi (parse)

### 2.1. OYLIKLAR listi

| Excel ustuni | Indeks (0 dan) | Ma'nosi        | Qayerda ishlatiladi |
|--------------|----------------|----------------|----------------------|
| **B**        | 1              | Filial / Sklad | Har bir qator: filial (hudud blokida filial+brend bo‘yicha filtrlash). |
| **C**        | 2              | Bo‘lim / Brend | J bo‘sh bo‘lsa brend sifatida (J \|\| C). |
| **E**        | 4              | Oylik turi     | Komanda / DS / OFIS / BRAND MANAGER ajratish — **faqat shu ustun**. |
| **F**        | 5              | Summa          | Barcha oylik ustunlari uchun yig‘indi. |
| **J**        | 9              | Brend          | Asosiy brend (LALAKU, GIGA, …). J bo‘sh bo‘lsa C ishlatiladi. |

- **E (4)** ustunidagi matn **aniq** bo‘lishi kerak: "Komanda oyligi", "DS va Qolgan bolimlar oyliklari", "OFIS oylik", "BRAND MANAGER" (yoki ularning ruscha/alias variantlari). Boshqa yozuvlar yoki boshqa ustundagi ma'lumot **hisobga olinmaydi**.
- Logda ko‘rinadi: `oylikTurlari=%s` — faqat E ustunida **uchragan** unikal matnlar. Agar faqat 2 ta tur ko‘rinsa (masalan "Komanda oyligi" va "DS va Qolgan bolimlar oyliklari"), OFIS va BRAND MANAGER **faylda yo‘q** deb hisoblanadi va 0 qoladi.

### 2.2. RASXODLAR listi

| Excel ustuni | Indeks | Ma'nosi | Qayerda ishlatiladi |
|--------------|--------|---------|----------------------|
| **A** yoki **F** | 0, 5 | Hudud | Qatorni qaysi filialga bog‘lash. Avval F, keyin A. |
| **AN**        | 39     | Jami (ИТОГО) | Shu qatorning jami sarfi. 39 bo‘lmasa 2-ustun sinab ko‘riladi. |

- Hudud nomi **registrsiz** guruhlanadi (SAMARQAND va Samarqand bitta), kirillcha nomlar lotinga o‘giriladi (jadval orqali).

### 2.3. SAVDO listi

| Excel ustuni | Indeks | Ma'nosi | Qayerda ishlatiladi |
|--------------|--------|---------|----------------------|
| **A**        | 0      | Brend   | Savdo va brend ro‘yxati. |
| **C**        | 2      | Sklad   | Filial (hudud). |
| **D**        | 3      | Summa   | Savdo summasi. |

---

## 3. Total jadval ustunlari — formulalar (Excel bilan mos)

| Ustun | Formula (mantiq) | Manba |
|-------|-------------------|--------|
| **Komanda oyligi** | OYLIKLAR dan: filial+brend (yoki respublika: brend) va oylik turi = "Komanda oyligi" bo‘lgan F yig‘indisi. | OYLIKLAR E, F |
| **DS va qolgan oyliklar** | Xuddi shu, oylik turi = "DS va Qolgan bolimlar oyliklari" (yoki alias). | OYLIKLAR E, F |
| **OFIS oylik** | Oylik turi = "OFIS oylik". | OYLIKLAR E, F |
| **BRAND MANAGER** | Oylik turi = "BRAND MANAGER". | OYLIKLAR E, F |
| **Oyliklar jami** | Komanda + DS + OFIS + BM. | Hisoblangan (H = D+E+F+G) |
| **Filial sarflari** | Respublika: jami RASXODLAR × (brend savdo ulushi). Hudud: shu hudud RASXODLAR jami × (brendning hudud ichidagi savdo ulushi). | RASXODLAR + SAVDO |
| **Podarkalar** | Hozir **doim 0**. Excelda K ustuni yoki boshqa manba bo‘lishi mumkin. | Implement qilinmagan |
| **Sarflar jami** | Oyliklar jami + Filial sarflari + Podarkalar. | Hisoblangan (L = J+H+K) |
| **Savdo** | SAVDO dan: brend (respublika) yoki brend+sklad (hudud) bo‘yicha D yig‘indisi. | SAVDO A, C, D |
| **САВДО %** | Respublika: savdo / jami savdo. Hudud: savdo / hudud jami savdo. | Hisoblangan |
| **Рент %** | Sarflar jami / Savdo (Savdo > 0 bo‘lsa). | Hisoblangan (Q = L/N) |
| **Рент РЕСП %** | Hudud blokida: blok ИТОГО sarflar jami / blok ИТОГО savdo. | Hisoblangan |

---

## 4. Nima uchun ma'lumotlar (0) kelmaydi — sabablar

### 4.1. DS va qolgan oyliklar, OFIS oylik, BRAND MANAGER — ko‘p qatorda 0

**Asosiy sabab:** OYLIKLAR faylida **E ustunida** faqat quyidagilar yozilgan bo‘ladi:

- "Komanda oyligi"
- "DS va Qolgan bolimlar oyliklari" (yoki "DS va Qolgan bo'limlar oyliklari" — apostrof normalizatsiya qilinadi)

Agar E ustunida **"OFIS oylik"** yoki **"BRAND MANAGER"** (yoki ularning ruscha/o‘zbekcha variantlari) **umuman bo‘lmasa**, vebda bu ustunlar **0** bo‘ladi. Kod boshqa ustundan oylik turini o‘qimaydi.

**Tekshirish:**

1. Terminal logida qidiring: `[parseOyliklar] ... oylikTurlari=%s`.  
   Agar ro‘yxatda faqat 2 ta tur ko‘rinsa (masalan `['DS va Qolgan bolimlar oyliklari', 'Komanda oyligi']`), demak faylda OFIS va BRAND MANAGER **yo‘q**.
2. Excelda OYLIKLAR listini oching, **E ustuni** (Oylik turi) bo‘yicha filtrlash qiling — "OFIS oylik", "BRAND MANAGER" (yoki ruscha) qatorlar bormi tekshiring.
3. Agar ular boshqa ustunda yoki boshqa nomda bo‘lsa (masalan "Офис оклади"), kodda alias qo‘shilgan; yana boshqa yozuv bo‘lsa, `matchOylikTuri` ga yangi alias qo‘shish kerak.

### 4.2. Podarkalar — hamma joyda 0

**Sabab:** Dasturda **Podarkalar** ustuni hozircha **implement qilinmagan** — doim 0. Excelda K (Подаркалар) yoki boshqa listdan olish rejalashtirilishi mumkin.

### 4.3. Filial sarflari — ayrim hududlarda 0 yoki kam

**Mumkin sabablar:**

- RASXODLAR da shu hudud **boshqa nomda** (masalan kirillcha yoki "SAMARQAND" / "Samarqand") — kodda hudud birlashtirish va kirill→lotin bor; agar yangi variant bo‘lsa, jadvalga qo‘shish kerak.
- SAVDO da shu filialda savdo 0 bo‘lsa, savdo ulushi 0 bo‘ladi va filial sarflari ham 0 (taqsimot formulasi sabab).

### 4.4. Ayrim brendlar — oyliklar 0

- **Respublika:** Oyliklar faqat **brend** bo‘yicha yig‘iladi (filial farqi yo‘q). OYLIKLAR da **J yoki C** ustunida shu brend bo‘lgan qatorlar bo‘lishi kerak.
- **Hudud:** Oyliklar **filial + brend** bo‘yicha. OYLIKLAR da B = shu filial va J/C = shu brend bo‘lgan qatorlar bo‘lishi kerak. Filial nomi (masalan "Olmaliq") faylda boshqacha yozilsa (yoki boshqa listda bo‘lsa), vebda 0 chiqadi.

---

## 5. Excel ustun indekslari (tekshirish uchun)

- Excel **1-based** (A=1, B=2, …).  
- Kod **0-based** (A=0, B=1, …).  
- OYLIKLAR: B=1, C=2, E=4, F=5, J=9 — to‘g‘ri.  
- RASXODLAR: A=0, F=5, AN=40 → indeks 39 — to‘g‘ri.  
- SAVDO: A=0, C=2, D=3 — to‘g‘ri.

Agar fayl tuzilishi boshqacha bo‘lsa (qator 1 sarlavha emas, ustunlar siljigan bo‘lsa), parse natijasi noto‘g‘ri bo‘lishi mumkin. Bunday hollarda listning birinchi qatorini (sarlavha) va 2–3 qatorini tekshirib, kerak bo‘lsa ustun indekslarini yoki sarlavha orqali ustun aniqlashni qo‘shish kerak.

---

## 6. Xulosa: "Ma'lumot kelmayapti" tekshiruvi

| Belgi | Tekshirish |
|-------|------------|
| DS/OFIS/BM 0 | OYLIKLAR listida **E ustuni**ni oching — shu turlar bormi? Logdagi `oylikTurlari` ro‘yxatida 2 tadan ortiq tur bor-yo‘q? |
| Podarkalar 0 | Hozircha dasturda doim 0; kelajakda RASXODLAR K yoki boshqa manba qo‘shiladi. |
| Filial sarflari 0/kam | RASXODLAR da hudud nomi SAVDO/OYLIKLAR bilan bir xil (yoki alias jadvalida bormi)? Hudud birlashtirish logi (kirill/lotin) to‘g‘rimi? |
| Savdo 0 | SAVDO listida shu brend va (hudud blokida) shu sklad uchun D ustunida summa bormi? |
| Oyliklar 0 | OYLIKLAR da B=filial, J yoki C=brend, E=oylik turi, F=summa bo‘lgan qatorlar bormi? |

Barcha hisoblashlar **Excel ИТОГ** dagi formulalar (SUMIFS, ulush, L/N va h.k.) bilan moslashtirilgan. Farq asosan **fayl tarkibi** (E ustunidagi oylik turlari, hudud nomlari, Podarkalar manbai) va **implement qilinmagan Podarkalar** dan keladi.
