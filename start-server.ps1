# Server ishga tushirish skripti
# PowerShell terminalida loglarni ko'rish uchun

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SERVER ISHGA TUSHIRILMOQDA..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Joriy papkaga o'tish
Set-Location $PSScriptRoot

# Avval eski server jarayonlarini to'xtatish
Write-Host "[INFO] Eski server jarayonlarini tekshirish..." -ForegroundColor Cyan
$processes = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique

if ($processes) {
    foreach ($pid in $processes) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "node") {
            Write-Host "[INFO] Eski server jarayoni to'xtatilmoqda: PID $pid" -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 1
    Write-Host "[OK] Eski jarayonlar to'xtatildi" -ForegroundColor Green
}

# .env faylini tekshirish
if (-not (Test-Path .env)) {
    Write-Host "[WARNING] .env fayli topilmadi. env.example.txt dan yaratilmoqda..." -ForegroundColor Yellow
    Copy-Item env.example.txt .env -ErrorAction SilentlyContinue
}

# node_modules ni tekshirish
if (-not (Test-Path node_modules)) {
    Write-Host "[WARNING] node_modules topilmadi. Dependencies o'rnatilmoqda..." -ForegroundColor Yellow
    npm install
}

Write-Host ""
Write-Host "[OK] Server ishga tushirilmoqda..." -ForegroundColor Green
Write-Host "Port: 3000" -ForegroundColor Green
Write-Host "URL: http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "To'xtatish uchun Ctrl+C bosing" -ForegroundColor Yellow
Write-Host ""

# Serverni ishga tushirish (foreground'da - loglarni ko'rish uchun)
node server.js

