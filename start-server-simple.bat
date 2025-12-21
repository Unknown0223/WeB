@echo off
echo ========================================
echo   SERVER ISHGA TUSHIRILMOQDA...
echo ========================================
echo.

cd /d %~dp0

REM Eski node jarayonlarini to'xtatish
echo [INFO] Eski server jarayonlarini to'xtatish...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

REM .env faylini tekshirish
if not exist .env (
    echo [WARNING] .env fayli topilmadi. env.example.txt dan yaratilmoqda...
    copy env.example.txt .env >nul 2>&1
)

REM node_modules ni tekshirish
if not exist node_modules (
    echo [WARNING] node_modules topilmadi. Dependencies o'rnatilmoqda...
    call npm install
)

echo.
echo [OK] Server ishga tushirilmoqda...
echo Port: 3000
echo URL: http://localhost:3000
echo.
echo To'xtatish uchun Ctrl+C bosing
echo.

REM Serverni ishga tushirish
node server.js

