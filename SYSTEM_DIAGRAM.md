# 🎯 SOLISHTIRISH VA BILDIRISHNOMA TIZIMI - CHIZMA

## 📊 UMUMIY TIZIM ARXITEKTURASI

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (Browser)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐      ┌──────────────────┐              │
│  │  Comparison Page │      │  Notifications   │              │
│  │  (comparison.js)  │      │  Modal           │              │
│  └────────┬─────────┘      └────────┬─────────┘              │
│           │                          │                         │
│           │                          │                         │
│  ┌────────▼─────────────────────────▼─────────┐              │
│  │      Real-time Module (realtime.js)         │              │
│  │  - WebSocket Connection                     │              │
│  │  - Notification Handler                     │              │
│  │  - Comparison Alert Modal                   │              │
│  └────────┬─────────────────────────────────────┘              │
│           │                                                    │
└───────────┼──────────────────────────────────────────────────┘
            │
            │ HTTP/WebSocket
            │
┌───────────▼──────────────────────────────────────────────────┐
│                    BACKEND (Express.js)                       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐      ┌──────────────────┐              │
│  │  Comparison API  │      │ Notifications API│              │
│  │  (comparison.js)  │      │ (notifications.js)│            │
│  └────────┬─────────┘      └────────┬─────────┘              │
│           │                          │                         │
│           │                          │                         │
│  ┌────────▼─────────────────────────▼─────────┐              │
│  │         WebSocket Server                    │              │
│  │  - Broadcast Messages                      │              │
│  │  - Real-time Updates                       │              │
│  └────────┬─────────────────────────────────────┘              │
│           │                                                    │
└───────────┼──────────────────────────────────────────────────┘
            │
            │ SQL Queries
            │
┌───────────▼──────────────────────────────────────────────────┐
│                    DATABASE (SQLite)                          │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ comparisons │  │notifications │  │ user_locations│       │
│  │   table     │  │   table     │  │    table     │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

## 🔄 SOLISHTIRISH JARAYONI OQIMI

```
┌─────────────────────────────────────────────────────────────┐
│  1. FOYDALANUVCHI SOLISHTIRISH BO'LIMIGA KIRADI             │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  2. SANA VA BREND TANLANADI                                 │
│     - Date picker                                           │
│     - Brand select                                          │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  3. "YUKLASH" TUGMASI BOSILADI                              │
│     - GET /api/comparison/data                              │
│     - Operator summalari olinadi                            │
│     - Saqlangan solishtirish summalari olinadi              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  4. JADVAL KO'RSATILADI                                     │
│     - Filiallar ro'yxati                                    │
│     - Operator summalari                                    │
│     - Input maydonlari (qo'lda kiritish)                   │
│     - Farqlar va foizlar                                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  5. FOYDALANUVCHI QIYMAT KIRITADI                           │
│     - Input maydoniga yozadi                                │
│     - Real-time hisoblash                                   │
│     - Farq va foiz avtomatik yangilanadi                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  6. "SAQLASH" TUGMASI BOSILADI                              │
│     - POST /api/comparison/save                             │
│     - Barcha input qiymatlari yuboriladi                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  7. BACKEND QAYTA HISOBLAYDI                                │
│     - Operator summalari qayta olinadi                      │
│     - Farqlar hisoblanadi                                   │
│     - Comparisons jadvaliga saqlanadi                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  8. FARQLAR TOPILSA?                                        │
│     ┌──────────┐              ┌──────────┐                 │
│     │   HA     │              │   YO'Q   │                 │
│     └────┬─────┘              └────┬─────┘                 │
│          │                         │                        │
│          ▼                         ▼                        │
│  ┌─────────────────┐      ┌─────────────────┐              │
│  │ Notification    │      │ Faqat saqlash   │              │
│  │ yaratish       │      │ muvaffaqiyatli  │              │
│  └─────┬──────────┘      └─────────────────┘              │
│        │                                                  │
└────────┼──────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  9. OPERATORLARGA TEGISHLI FARQLARNI TOPISH                 │
│     - Har bir operatorning filiallarini olish               │
│     - Faqat tegishli farqlarni ajratish                     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  10. NOTIFICATION YARATISH                                  │
│      - Notifications jadvaliga yozish                       │
│      - WebSocket orqali real-time yuborish                  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  11. FRONTEND'GA XABAR KELADI                               │
│      - WebSocket message: 'new_notification'                │
│      - Real-time module qabul qiladi                         │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  12. COMPARISON ALERT MODAL KO'RSATILADI                    │
│      - Sahifa qorong'ilashadi                                │
│      - Markazda modal oyna                                   │
│      - Farqlar batafsil ko'rsatiladi                         │
│      - "Tushundim" tugmasi                                   │
└─────────────────────────────────────────────────────────────┘
```

## 📨 BILDIRISHNOMA TIZIMI OQIMI

```
┌─────────────────────────────────────────────────────────────┐
│  NOTIFICATION YARATILISHI                                   │
│  (Comparison save jarayonida)                              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Database'ga yozish                                         │
│  - notifications table                                      │
│  - type: 'comparison_difference'                           │
│  - details: JSON (date, brand, differences)                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  WebSocket Broadcast                                        │
│  - global.broadcastWebSocket()                              │
│  - Type: 'new_notification'                                 │
│  - Payload: { user_id, notification }                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend Real-time Module                                  │
│  - WebSocket message qabul qiladi                           │
│  - handleNewNotification() chaqiriladi                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Notification Type Tekshiruvi                               │
│  ┌──────────────┐              ┌──────────────┐            │
│  │ comparison_ │              │   Boshqa     │            │
│  │ difference  │              │   turlar     │            │
│  └──────┬───────┘              └──────┬───────┘            │
│         │                             │                    │
│         ▼                             ▼                    │
│  ┌──────────────┐              ┌──────────────┐            │
│  │ Comparison   │              │ Notifications│            │
│  │ Alert Modal  │              │ Modal        │            │
│  └──────┬───────┘              └──────┬───────┘            │
│         │                             │                    │
└─────────┼─────────────────────────────┼────────────────────┘
          │                             │
          ▼                             ▼
┌──────────────────┐          ┌──────────────────┐
│ Sahifa           │          │ Avatar pulsatsiya│
│ qorong'ilashadi  │          │ (yo'q)           │
│                  │          │                  │
│ Modal markazda   │          │ Modal ochiladi   │
│ ko'rsatiladi     │          │                  │
│                  │          │                  │
│ "Tushundim"      │          │                  │
│ tugmasi          │          │                  │
└──────────────────┘          └──────────────────┘
```

## 🗄️ DATABASE JADVALLARI

```
┌─────────────────────────────────────────────────────────────┐
│  COMPARISONS TABLE                                          │
├─────────────────────────────────────────────────────────────┤
│  id              INTEGER PRIMARY KEY                        │
│  comparison_date DATE                                        │
│  brand_id        INTEGER                                    │
│  location        STRING                                     │
│  operator_amount DECIMAL                                    │
│  comparison_amount DECIMAL                                  │
│  difference      DECIMAL                                    │
│  percentage      DECIMAL                                    │
│  created_by      INTEGER                                    │
│  created_at      TIMESTAMP                                  │
│  updated_at      TIMESTAMP                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  NOTIFICATIONS TABLE                                        │
├─────────────────────────────────────────────────────────────┤
│  id              INTEGER PRIMARY KEY                        │
│  user_id         INTEGER (FK -> users.id)                  │
│  type            STRING (comparison_difference, ...)       │
│  title           STRING                                     │
│  message         TEXT                                       │
│  details         TEXT (JSON)                               │
│  is_read         BOOLEAN (default: false)                  │
│  created_at      TIMESTAMP                                  │
│  read_at         TIMESTAMP                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  USER_LOCATIONS TABLE                                       │
├─────────────────────────────────────────────────────────────┤
│  user_id         INTEGER (FK -> users.id)                   │
│  location_name   STRING                                     │
│  PRIMARY KEY (user_id, location_name)                      │
└─────────────────────────────────────────────────────────────┘
```

## 🔔 NOTIFICATION TOZALASH JARAYONI

```
┌─────────────────────────────────────────────────────────────┐
│  Server ishga tushganda                                     │
│  cleanupOldNotifications() bir marta chaqiriladi           │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Har 1 soatda interval                                      │
│  setInterval(cleanupOldNotifications, 3600000)             │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Bir kun oldingi notification'larni topish                  │
│  WHERE created_at < (NOW() - 1 day)                         │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Database'dan o'chirish                                     │
│  DELETE FROM notifications WHERE ...                       │
└─────────────────────────────────────────────────────────────┘
```

## 🎨 FRONTEND KOMPONENTLARI

```
┌─────────────────────────────────────────────────────────────┐
│  Comparison Module (comparison.js)                          │
├─────────────────────────────────────────────────────────────┤
│  • setupComparison()          - Bo'limni sozlash            │
│  • loadComparisonData()       - Ma'lumotlarni yuklash      │
│  • renderTable()              - Jadvalni ko'rsatish        │
│  • saveComparisonData()       - Saqlash                     │
│  • updateComparisonCalculations() - Real-time hisoblash    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Real-time Module (realtime.js)                             │
├─────────────────────────────────────────────────────────────┤
│  • initRealTime()            - WebSocket ulanish            │
│  • handleNewNotification()   - Notification qabul qilish    │
│  • showComparisonAlertModal() - Alert modal ko'rsatish      │
│  • updateNotificationBadge()  - Badge yangilash             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Notification Modal (index.html + script.js)                │
├─────────────────────────────────────────────────────────────┤
│  • openNotificationsModal()  - Modal ochish                 │
│  • loadNotifications()       - Notification'larni yuklash  │
│  • markNotificationAsRead()  - O'qilgan deb belgilash      │
└─────────────────────────────────────────────────────────────┘
```

## 🔐 PERMISSIONS VA ROLES

```
┌─────────────────────────────────────────────────────────────┐
│  Comparison Permissions                                     │
├─────────────────────────────────────────────────────────────┤
│  • comparison:view    - Ko'rish                             │
│  • comparison:edit    - Tahrirlash/Saqlash                  │
│  • comparison:export  - Excel export                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Roles                                                       │
├─────────────────────────────────────────────────────────────┤
│  • admin         - Barcha huquqlar                          │
│  • manager       - Barcha huquqlar                           │
│  • operator      - Faqat ko'rish (notification oladi)       │
└─────────────────────────────────────────────────────────────┘
```

## 📱 REAL-TIME FEATURES

```
┌─────────────────────────────────────────────────────────────┐
│  WebSocket Events                                           │
├─────────────────────────────────────────────────────────────┤
│  • new_notification    - Yangi bildirishnoma                │
│  • dashboard_update    - Dashboard yangilanishi             │
│  • user_status_changed - Foydalanuvchi statusi              │
│  • new_report          - Yangi hisobot                      │
│  • report_edited       - Hisobot tahrirlanishi              │
│  • user_registered     - Yangi registratsiya                │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 ASOSIY FUNKSIYALAR

### 1. **Solishtirish**
   - Operator summalarini olish
   - Qo'lda kiritilgan summalarni saqlash
   - Farqlarni hisoblash
   - Real-time yangilanish

### 2. **Bildirishnomalar**
   - Avtomatik yaratish (farq topilganda)
   - Real-time yetkazish
   - Modal ko'rsatish
   - Bir kun saqlash

### 3. **Tozalash**
   - Eski notification'larni o'chirish
   - Avtomatik interval
   - Server ishga tushganda

---

**Yaratilgan:** 2025-12-08
**Versiya:** 1.0

