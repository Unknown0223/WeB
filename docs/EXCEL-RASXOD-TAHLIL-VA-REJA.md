# Excel "Расход отчет" — to‘liq tahlil va webga moslashtirish rejasi (kodlarsiz)

Bu hujjat Excel faylini qanday tekshirish va "Sarflar hisoboti (Total)" bo‘limini qanday moslashtirish kerakligini bosqichma-bosqich tavsiflaydi. Hozircha kod yozilmaydi — faqat tekshirish va reja.

---

## 1. Fayl maqsadi (qisqacha)

- **Fayl nomi:** Расход отчет Noyabr 2025.xlsx  
- **Maqsad:** Berilgan oy (Noyabr 2025) uchun barcha sarflarni ko‘rsatish, kategoriya bo‘yicha guruhlash va jami (Total) hisoblash.
- **Total list:** Yig‘indilar ro‘yxati — barcha xarajatlar yoki kategoriyalar bo‘yicha jamilar.

---

## 2. Excel faylni tekshirish (qadam-baqadam)

### 2.1. Listlarni aniqlash

Excelni oching. Pastdagi **list yorliqlarini** ko‘ring va yozib oling:

| # | List nomi | Vazifasi (qisqacha) |
|---|-----------|----------------------|
| 1 | … | … |
| 2 | … | … |
| … | … | … |

**Aniqlash kerak:** Qaysi list kundalik/har bir xarajat yozuvi, qaysi list "Total" (yig‘indi).

---

### 2.2. "Total" listini ustunlarini yozib olish

Total listini oching. **Birinchi qator** — ustun sarlavhalari.

Quyidagi jadvalni to‘ldiring (Exceldagi tartibda):

| Ustun raqami (A, B, C…) | Sarlavha matni | Ma’lumot turi (sana / summa / matn / boshqa) |
|-------------------------|----------------|----------------------------------------------|
| A | | |
| B | | |
| C | | |
| … | | |

**Aniqlash kerak:** Qaysi ustun sana, qaysi summa (so‘m), qaysi kategoriya/maqsad, qaysi izoh.

---

### 2.3. Formulalarni topish va yozib olish

Total listida **qaysi kataklarda formula** bor — buni bilish kerak.

- Formula bo‘lgan katakni tanlang → yuqori qatorda **formula paneli**da ko‘rinadi (masalan `=SUM(B2:B15)`).
- Har bir bunday katak uchun quyidagini yozib oling:

| Qator | Ustun | Formula matni | Nima hisoblaydi (qisqacha) |
|-------|--------|----------------|-----------------------------|
| … | … | =SUM(...) | … ustunidagi yig‘indi |
| … | … | =... | … |

**Tekshirish kerak bo‘lgan formula turlari:**
- **SUM** — qator/ustun yig‘indisi
- **SUMIF / SUMIFS** — shart bo‘yicha yig‘indi
- Boshqa listga havola (masalan `=List1!B5`)
- Foiz (masalan jami dan ulush)

---

### 2.4. Ma’lumot qatorlari va "Jami" qatori

- **Ma’lumot qatorlari:** 2-qatordan oxirgi ma’lumot qatorigacha — har bir qator bitta xarajat (yoki bitta kategoriya yig‘indisi).
- **Jami qatori:** Oxirgi qatorda "Jami" yoki "Total" yozuvi va yig‘indi formulalari bo‘lishi mumkin.

Quyidagini aniqlang va yozing:

- Jami qatori qaysi **qator raqami**da (masalan 25)?
- Jami qatorida qaysi **ustunlarda** formula bor va ular nima hisoblaydi?

---

### 2.5. Boshqa listlar (agar bor bo‘lsa)

Agar "Total" dan tashqari boshqa listlar ham bor bo‘lsa (masalan har kuni yoki har filial bo‘yicha):

- List nomi
- Ustunlar (birinchi qator)
- Bu listdan Total listiga qanday ulanish bor (formulalar orqali yoki yo‘q)

---

## 3. Tahlil xulosasi (to‘ldirish)

Tekshirish tugagach, quyidagi bo‘sh joylarni to‘ldiring.

### 3.1. Listlar ro‘yxati

- Asosiy ma’lumot listi(lar): …
- Total list: …
- Boshqa listlar: …

### 3.2. Total list ustunlari (web jadvaliga mos)

| Excel ustuni | Sarlavha | Web jadvalida ko‘rinishi (masalan: №, Kategoriya, Summa, Sana, Izoh) |
|--------------|----------|-----------------------------------------------------------------------|
| | | |
| | | |

### 3.3. Formulalar xulosasi

- Jami qatori qanday hisoblanadi: …
- Boshqa muhim formulalar: …

### 3.4. Ma’lumot turi va format

- Sana formati (masalan DD.MM.YYYY yoki YYYY-MM-DD): …
- Summa — qaysi ustunda va birlik (so‘m): …
- Kategoriya / maqsad — qaysi ustun: …
- Izoh — qaysi ustun: …

---

## 4. Webga moslashtirish rejasi (keyingi qadamlar, kodlarsiz)

Tahlil tayyor bo‘lgach, quyidagilar aniq bo‘ladi:

1. **Admin panel — "Sarflar hisoboti (Total)"** bo‘limida jadval ustunlari Exceldagi Total list ustunlariga mos qilib belgilanadi.
2. **Filtrlar:** Oy, kategoriya, qidirish — Exceldagi ma’lumot turiga qarab tanlanadi.
3. **Jami qator:** Exceldagi jami qatori qanday hisoblansa (qaysi ustunlar yig‘indisi), webda ham shu logika qo‘llanadi (formula o‘rniga dasturda yig‘indi hisoblash).
4. **Ma’lumot manbai:** Kelajakda ma’lumot Excel import yoki API orqali kelsa, ustunlar va jami hisoblash ushbu hujjatdagi tahlilga qarab moslashtiriladi.

---

## 5. Tekshirish ro‘yxati (checklist)

Tekshirishni boshlashdan oldin va keyin quyidagilardan foydalanishingiz mumkin:

- [ ] Excel fayl ochildi (Расход отчет Noyabr 2025.xlsx)
- [ ] Barcha list nomlari yozib olindi
- [ ] Total list birinchi qatori (sarlavhalar) jadvalga kiritildi
- [ ] Har bir ustun uchun ma’lumot turi (sana/summa/matn) belgilandi
- [ ] Formula bor kataklar topildi va formula matnlari yozib olindi
- [ ] Jami qatori qator raqami va formulalari aniqlandi
- [ ] 3-bo‘limdagi "Tahlil xulosasi" to‘ldirildi
- [ ] Web jadval ustunlari Excel ustunlariga moslashtirish rejasi aniq

---

*Hujjat yaratilgan sana: 2025. Keyinchalik kod yozilganda ushbu tahlil va rejaga murojaat qilinadi.*
