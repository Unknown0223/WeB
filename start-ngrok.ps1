# ngrok'ni ishga tushirish skripti
Write-Host "ngrok ishga tushirilmoqda..." -ForegroundColor Yellow
Write-Host "Port 3000 uchun tunnel ochilmoqda..." -ForegroundColor Cyan
Write-Host ""
Write-Host "ngrok web interface: http://127.0.0.1:4040" -ForegroundColor Green
Write-Host ""

# ngrok'ni ishga tushirish
ngrok http 3000

