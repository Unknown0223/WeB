# Serverni to'xtatish skripti

Write-Host "Serverni to'xtatish..." -ForegroundColor Yellow

# Port 3000 da ishlayotgan process'larni topish va to'xtatish
$processes = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique

if ($processes) {
    foreach ($pid in $processes) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "node") {
            Write-Host "Process to'xtatilmoqda: PID $pid" -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "[OK] Server to'xtatildi" -ForegroundColor Green
} else {
    Write-Host "[INFO] Port 3000 da server topilmadi" -ForegroundColor Cyan
}

