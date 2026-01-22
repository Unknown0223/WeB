# Barcha serverlarni to'xtatish skripti
# PowerShell terminalida ishlatish uchun

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BARCHA SERVERLARNI TO'XTATISH" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. PM2 process'larni to'xtatish (agar mavjud bo'lsa)
Write-Host "[1/3] PM2 process'larni tekshirish..." -ForegroundColor Yellow
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    try {
        pm2 stop all 2>&1 | Out-Null
        pm2 delete all 2>&1 | Out-Null
        Write-Host "[OK] PM2 process'lar to'xtatildi" -ForegroundColor Green
    } catch {
        Write-Host "[INFO] PM2 process'lar topilmadi" -ForegroundColor Gray
    }
} else {
    Write-Host "[INFO] PM2 o'rnatilmagan" -ForegroundColor Gray
}

# 2. Node.js process'larni to'xtatish (port 3000)
Write-Host "[2/3] Node.js process'larni tekshirish (port 3000)..." -ForegroundColor Yellow
$processes = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique

if ($processes) {
    $stopped = 0
    foreach ($pid in $processes) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "node") {
            try {
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Host "[OK] Node.js process to'xtatildi: PID $pid" -ForegroundColor Green
                $stopped++
            } catch {
                Write-Host "[WARNING] Process to'xtatilmadi: PID $pid" -ForegroundColor Yellow
            }
        }
    }
    if ($stopped -eq 0) {
        Write-Host "[INFO] To'xtatiladigan Node.js process topilmadi" -ForegroundColor Gray
    }
} else {
    Write-Host "[INFO] Port 3000'da process topilmadi" -ForegroundColor Gray
}

# 3. Boshqa portlardagi Node.js process'larni tekshirish (ixtiyoriy)
Write-Host "[3/3] Boshqa Node.js process'larni tekshirish..." -ForegroundColor Yellow
$allNodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($allNodeProcesses) {
    Write-Host "[INFO] Topilgan Node.js process'lar:" -ForegroundColor Gray
    foreach ($proc in $allNodeProcesses) {
        Write-Host "  - PID $($proc.Id): $($proc.ProcessName)" -ForegroundColor Gray
    }
    Write-Host "[INFO] Agar kerak bo'lsa, ularni qo'lda to'xtatishingiz mumkin" -ForegroundColor Gray
} else {
    Write-Host "[INFO] Boshqa Node.js process'lar topilmadi" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[OK] Barcha serverlar to'xtatildi!" -ForegroundColor Green
Write-Host ""

