# Deploy script - Production uchun
# PowerShell terminalida ishlatish uchun

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DEPLOY BOSHLANDI" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Barcha serverlarni to'xtatish
Write-Host "[1/5] Barcha serverlarni to'xtatish..." -ForegroundColor Yellow
& .\stop-all-servers.ps1

# 2. Git pull
Write-Host ""
Write-Host "[2/5] Git pull..." -ForegroundColor Yellow
try {
    git pull origin main
    Write-Host "[OK] Git pull muvaffaqiyatli" -ForegroundColor Green
} catch {
    Write-Host "[WARNING] Git pull xatolik, lekin davom etamiz..." -ForegroundColor Yellow
}

# 3. Dependencies o'rnatish
Write-Host ""
Write-Host "[3/5] Dependencies o'rnatish..." -ForegroundColor Yellow
try {
    npm install --production
    Write-Host "[OK] Dependencies o'rnatildi" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] npm install xatolik!" -ForegroundColor Red
    exit 1
}

# 4. Migration'lar
Write-Host ""
Write-Host "[4/5] Database migration'lar..." -ForegroundColor Yellow
try {
    $env:NODE_ENV = "production"
    npm run migrate:latest
    Write-Host "[OK] Migration'lar muvaffaqiyatli" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Migration xatolik!" -ForegroundColor Red
    exit 1
}

# 5. PM2 orqali ishga tushirish
Write-Host ""
Write-Host "[5/5] PM2 orqali ishga tushirish..." -ForegroundColor Yellow
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    try {
        $env:NODE_ENV = "production"
        $env:LOG_LEVEL = "error"
        pm2 start ecosystem.config.js --env production
        pm2 save
        Write-Host "[OK] PM2 ishga tushirildi" -ForegroundColor Green
        Write-Host ""
        Write-Host "Status tekshirish:" -ForegroundColor Cyan
        pm2 status
    } catch {
        Write-Host "[ERROR] PM2 start xatolik!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[WARNING] PM2 o'rnatilmagan, node server.js ishlatiladi" -ForegroundColor Yellow
    $env:NODE_ENV = "production"
    $env:LOG_LEVEL = "error"
    Start-Process -NoNewWindow node -ArgumentList "server.js"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DEPLOY YAKUNLANDI!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Loglarni ko'rish:" -ForegroundColor Cyan
Write-Host "  pm2 logs web-app" -ForegroundColor Gray
Write-Host ""
Write-Host "Status tekshirish:" -ForegroundColor Cyan
Write-Host "  pm2 status" -ForegroundColor Gray
Write-Host ""

