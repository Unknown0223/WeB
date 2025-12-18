@echo off
REM Server ishga tushirish skripti (Windows CMD uchun)
chcp 65001 >nul
echo ========================================
echo   SERVER ISHGA TUSHIRILMOQDA...
echo ========================================
echo.

cd /d "%~dp0"

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

pause

