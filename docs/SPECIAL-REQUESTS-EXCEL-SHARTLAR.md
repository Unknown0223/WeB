# Maxsus so‘rovlar — Excel (Заявки) shartlari

Botga yuboriladigan Excel fayl (**Заявки.xlsx** va shunga o‘xshash) quyidagi shartlarga muvofiq qayta ishlanadi. Fayl rasmlarini tashlashda shu ustunlar va qiymatlar bo‘yicha tekshiring.

---

## 1. Sarlavha qatori (ustunlar)

Ustunlar **faqat nomi bo‘yicha** aniqlanadi (tartib muhim emas). Sarlavha 1-, 2- yoki 3-qatorda bo‘lishi mumkin.

**Majburiy ustunlar (barchasi bo‘lishi kerak):**

| № | Ustun nomi (Cyrillic)     | Qisqacha izoh        |
|---|---------------------------|------------------------|
| 1 | №                         | Raqam / ID buyurtma    |
| 2 | Тип                       | Turi (masalan: Заказ)  |
| 3 | Статус                    | Status                |
| 4 | Клиент                    | Mijoz nomi            |
| 5 | Ид клиента                | Mijoz ID              |
| 6 | Сумма                     | Summa (raqam)         |
| 7 | Склад                     | Ombor                 |
| 8 | Агент                     | Agent                 |
| 9 | Код агента                | Agent kodi             |
|10 | Экспедиторы               | Ekspeditorlar         |
|11 | Территория                | Hudud                 |
|12 | **Консигнация**           | Kon signatsiya (Да/Нет)|
|13 | Направление торговли      | Yo‘nalish / brend      |

Agar ustun boshqa nomda bo‘lsa (masalan, **№** o‘rnida **заказ** yoki **id заказа**), tizim ba’zi variantlarni avtomatik tanlaydi. Asosiy nomlar yuqoridagi jadvaldagi kabi bo‘lsa, eng yaxshi ishlaydi.

---

## 2. Qatorlarni filtrlash shartlari

Faqat **uchala shart** bajarilgan qatorlar guruhga yuboriladi (yoki bot javobida ko‘rsatiladi).

### 2.1. Консигнация (Consignment)

- **Kerak:** ustundagi qiymat **“Да”** (yoki quyidagi variantlardan biri) bo‘lishi kerak.
- **Qabul qilinadigan qiymatlar** (registrsiz, boshida/oxirida bo‘shliq olib tashlanadi):
  - `Да`, `да`, `ДА`
  - `Yes`, `yes`
  - `1`
  - `true`
  - `+`
  - `Д`, `ha`, `ja`

Agar faylda boshqa yozuv bo‘lsa (masalan “Нет”, “-”, “0”), qator **o‘tkazib yuboriladi**.

---

### 2.2. Тип (Type)

- **Kerak:** ustundagi qiymat **“Заказ”** (yoki quyidagi variantlardan biri) bo‘lishi kerak.
- **Qabul qilinadigan qiymatlar:**
  - `Заказ`, `заказ`, `ЗАКАЗ`
  - `Order`, `order`
  - `Zakaz`, `zakaz`

Boshqa qiymatlar (masalan “Возврат”, “Продажа”) **qabul qilinmaydi**.

---

### 2.3. Сумма (Summa) — ixtiyoriy sozlama

Admin panelda **“Сумма filtri”** sozlangan bo‘lsa, qator shu shartga ham javob berishi kerak:

- **Teng:** `Сумма` = sozlangan qiymat
- **Katta yoki teng:** `Сумma` ≥ sozlangan qiymat (masalan ≥ 10 000 000)
- **Kichik yoki teng:** `Сумма` ≤ sozlangan qiymat

Summa ustunidagi formatlar qo‘llab-quvvatlanadi:  
`10 000 000`, `10,5`, `10.5`, `10.000.000` (nuqta ming ajratgich).

Filtr sozlanmagan bo‘lsa, faqat **Консигнация** va **Тип** tekshiriladi.

---

## 3. Qisqacha tekshiruv ro‘yxati (rasm uchun)

Fayl rasmini tashlashda quyidagilarni ko‘rsating:

1. **Birinchi 1–3 qator** — sarlavha qatori: yuqoridagi 13 ta ustun nomi ko‘rinadimi?
2. **Консигнация** ustuni — qatorlarda qiymatlar “Да” / “Yes” / “1” va hokazo yozilganmi?
3. **Тип** ustuni — qatorlarda “Заказ” / “Order” yozilganmi?
4. **Сумма** ustuni — raqamlar to‘g‘ri (masalan ≥ 10 000 000 bo‘lsa, admin sozlangan bo‘yicha)?
5. Agar “0 qator topilmadi” chiqsa — server logida `[SPECIAL_REQUESTS_EXCEL] Shartga mos 0 qator. Fayldagi birinchi qatorlar...` qatorida fayldagi **birinchi 5 qator**ning Консигнация, Тип, Сумма qiymatlari chiqadi; ularni fayl rasmi bilan solishtiring.

---

## 4. Loglarda ko‘rinishi

- **Ustunlar topilganda:**  
  `Parse: jami ... ma'lumot qatorlari=..., filtrlangan=...`
- **Hech qator mos kelmasa:**  
  `Filtr natija: jami ... ma'lumot qatori, shartga mos 0 ta (Консигнация=Да, Тип=Заказ, Сумма >= ...)`  
  va  
  `Shartga mos 0 qator. Fayldagi birinchi qatorlar: [...]`

Rasmlarni shu shartlar va logdagi qiymatlar bo‘yicha tashlang.
