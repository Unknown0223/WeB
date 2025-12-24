# ngrok Setup va Ishlatish Qo'llanmasi

## 1. ngrok'ni Yuklab Olish va O'rnatish

### Windows uchun:
1. https://ngrok.com/download saytiga kiring
2. Windows uchun ngrok'ni yuklab oling
3. Zip faylni ochib, `ngrok.exe` ni `C:\Windows\System32` yoki boshqa qulay joyga ko'chiring
4. Yoki zip faylni ochib, `ngrok.exe` ni loyiha papkasiga (`d:\web_main`) qo'ying

### Yoki Chocolatey orqali (agar o'rnatilgan bo'lsa):
```powershell
choco install ngrok
```

### Yoki Scoop orqali (agar o'rnatilgan bo'lsa):
```powershell
scoop install ngrok
```

## 2. ngrok Account Yaratish (Ixtiyoriy, lekin tavsiya etiladi)

1. https://dashboard.ngrok.com/signup saytiga kiring
2. Bepul account yarating
3. Authtoken oling: https://dashboard.ngrok.com/get-started/your-authtoken

## 3. ngrok'ni Sozlash

### Authtoken o'rnatish (agar account yaratgan bo'lsangiz):
```powershell
ngrok config add-authtoken YOUR_AUTHTOKEN
```

## 4. ngrok'ni Ishga Tushirish

### Terminal 1: Serverni ishga tushirish
```powershell
cd d:\web_main
npm run dev
```

### Terminal 2: ngrok'ni ishga tushirish
```powershell
ngrok http 3000
```

Bu quyidagicha chiqadi:
```
ngrok

Session Status                online
Account                       Your Account (Plan: Free)
Version                       3.x.x
Region                        United States (us)
Latency                       45ms
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://xxxx-xx-xx-xx-xx.ngrok-free.app -> http://localhost:3000

Connections                   ttl     opn     rt1     rt5     p50     p90
                              0       0       0.00    0.00    0.00    0.00
```

## 5. APP_BASE_URL'ni Sozlash

ngrok'dan olingan HTTPS URL'ni `.env` faylida `APP_BASE_URL` sifatida o'rnating:

```env
APP_BASE_URL=https://xxxx-xx-xx-xx-xx.ngrok-free.app
```

Yoki environment variable sifatida:
```powershell
$env:APP_BASE_URL="https://xxxx-xx-xx-xx-xx.ngrok-free.app"
npm run dev
```

## 6. ngrok Web Interface

ngrok ishga tushganda, web interface'ga kirish:
- URL: http://127.0.0.1:4040
- Bu yerda barcha so'rovlar va javoblar ko'rinadi

## 7. Telegram Bot Webhook'ni O'rnatish

ngrok URL'ni olgandan keyin, Telegram bot webhook avtomatik o'rnatiladi (agar `telegram_enabled = true` bo'lsa).

## 8. ngrok'ni Background'da Ishga Tushirish (Ixtiyoriy)

PowerShell'da:
```powershell
Start-Process ngrok -ArgumentList "http 3000" -WindowStyle Hidden
```

## 9. ngrok'ni To'xtatish

ngrok terminalida `Ctrl+C` bosing yoki:
```powershell
Get-Process ngrok | Stop-Process
```

## 10. Muammolarni Hal Qilish

### Agar ngrok topilmasa:
- `ngrok.exe` faylini PATH'ga qo'shing yoki to'liq yo'l bilan ishlating
- Masalan: `C:\path\to\ngrok.exe http 3000`

### Agar port band bo'lsa:
- Boshqa port ishlating: `ngrok http 3001`
- Server'ni ham shu portda ishga tushiring

### Agar HTTPS URL olinmasa:
- ngrok account yarating va authtoken o'rnating
- Bepul plan'da HTTPS URL beriladi

