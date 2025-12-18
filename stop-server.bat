@echo off
chcp 65001 >nul
echo Serverni to'xtatish...
echo.

REM Port 3000 da ishlayotgan Node.js process'larini topish va to'xtatish
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo Process to'xtatilmoqda: PID %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo [OK] Server to'xtatildi
pause

