# Server Ishga Tushirish Qo'llanmasi

## Tez Boshlash

### 1-usul: PowerShell skripti (Tavsiya etiladi)
```powershell
.\start-server.ps1
```

### 2-usul: Batch fayl (CMD uchun)
```cmd
start-server.bat
```

### 3-usul: npm orqali
```bash
npm start
```

## Serverni To'xtatish

### PowerShell:
```powershell
.\stop-server.ps1
```

### Batch fayl:
```cmd
stop-server.bat
```

### Yoki terminalda Ctrl+C bosing

## Muammolarni Hal Qilish

### 1. Agar "node_modules topilmadi" xatosi bo'lsa:
```bash
npm install
```

### 2. Agar port 3000 band bo'lsa:
```powershell
# Port 3000 da ishlayotgan process'larni ko'rish
netstat -ano | findstr :3000

# Process'ni to'xtatish (PID ni o'zgartiring)
taskkill /PID <PID_RAQAMI> /F
```

### 3. Agar .env fayli yo'q bo'lsa:
```bash
# Avtomatik yaratiladi, yoki qo'lda:
copy env.example.txt .env
```

## Server Holatini Tekshirish

### Browser orqali:
```
http://localhost:3000/health
```

### Terminal orqali:
```powershell
curl http://localhost:3000/health
```

## Foydali Ma'lumotlar

- **Port**: 3000
- **Asosiy URL**: http://localhost:3000
- **Login sahifa**: http://localhost:3000/login
- **Admin panel**: http://localhost:3000/admin

## Loglarni Ko'rish

Server ishga tushganda barcha loglar terminalda ko'rinadi. Agar loglar ko'rinmasa, server background'da ishlayotgan bo'lishi mumkin. 

Background'da ishlayotgan serverni to'xtatish:
```powershell
.\stop-server.ps1
```

Keyin qayta ishga tushiring:
```powershell
.\start-server.ps1
```

