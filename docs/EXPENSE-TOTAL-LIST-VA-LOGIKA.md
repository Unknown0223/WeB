# Sarflar hisoboti (Total) — qaysi listdan nima olinadi va logika

## 1. Listlar va ma'lumotlar

| List        | Maqsad | Olinadigan maydonlar | Total jadvalda ishlatilishi |
|-------------|--------|----------------------|-----------------------------|
| **OYLIKLAR** | Xodimlar oyliklari | B=Filial, E=Oylik turi, F=Summa, **J=Brend** (asosiy), C=Bo'lim (J bo'sh bo'lsa) | Komanda oyligi, DS, OFIS, BRAND MANAGER, Oyliklar jami. **Brend** ustuni faqat **J** dan — savdo yo'nalishi (LALAKU, GIGA, …). C dagi DOSTAVKA, KASSA, SKLAD "Boshqa (bo'limlar)" qatorida. |
| **RASXODLAR** | Filial xarajatlari | A yoki F=Hudud, AN(39)=Jami | Filial sarflari (J) — hudud bo'yicha yig'indi, savdo ulushiga taqsimlanadi. |
| **SAVDO**   | Savdo (Noyabr) | A=Brend, C=Sklad (filial), D=Summa | Savdo (N), САВДО %, shuningdek **jadvaldagi "brend" ro'yxati faqat shu listdan** (DOSTAVKA, KASSA va b. bo'limlar kirmaydi). |

## 2. Nima uchun DOSTAVKA/KASSA/SKLAD "Brend / Hudud"da ko'rinmasligi kerak

- **OYLIKLAR** da **C** ustuni "Bo'lim / Brend" — DOSTAVKA, KASSA, SKLAD, OFIS oylik va b. **bo'lim** nomlari.
- **J** ustuni **Brend** — LALAKU, GIGA, MAMA va b. **savdo yo'nalishlari**.
- Total jadvalda "Brend / Hudud" ustunida faqat **SAVDO** listidagi brendlar (savdo yo'nalishlari) ko'rsatiladi.
- OYLIKLAR da C=DOSTAVKA/KASSA/SKLAD bo'lgan oyliklar **"Boshqa (bo'limlar)"** qatorida bitta yig'indida chiqadi (savdo 0, faqat oyliklar).

## 3. Hisoblash logikasi (Excel formulalari bilan mos)

- **Komanda oyligi, DS, OFIS, BRAND MANAGER:** OYLIKLAR dan SUMIFS (filial + brend + oylik turi).
- **Oyliklar jami:** D+E+F+G yig'indisi.
- **Filial sarflari (Respublika):** RASXODLAR jami × (brend savdo ulushi P).
- **Filial sarflari (hudud):** RASXODLAR da shu hudud bo'yicha jami × (brendning hudud ichidagi savdo ulushi).
- **Sarflar jami:** Oyliklar jami + Filial sarflari + Podarkalar.
- **Savdo (N):** SAVDO dan SUMIFS (brend; hudud blokida + sklad).
- **САВДО %:** N / jami N (respublika yoki hudud bo'yicha).
- **Рент %:** Sarflar jami / Savdo (agar Savdo > 0).

## 4. O'zgarishlar (kamchiliklarni bartaraf etish)

1. **Brend ro'yxati** — faqat SAVDO listidan; DOSTAVKA, KASSA, SKLAD va b. bo'limlar alohida brend qatori sifatida ko'rsatilmaydi.
2. **"Boshqa (bo'limlar)"** — OYLIKLAR da brend (J yoki C) SAVDO da bo'lmagan barcha oyliklar yig'indisi (respublika va har bir filial uchun).
3. **Filial blokida brendlar** — faqat shu filialda savdosi bor brendlar (SAVDO da sklad = filial).
