#!/bin/bash

# Deploy script - Production uchun
# Linux/Mac uchun

set -e  # Xatolik bo'lsa to'xtatish

echo "========================================"
echo "  DEPLOY BOSHLANDI"
echo "========================================"
echo ""

# 1. Barcha serverlarni to'xtatish
echo "[1/5] Barcha serverlarni to'xtatish..."
if command -v pm2 &> /dev/null; then
    pm2 stop all 2>&1 | grep -v "not found" || true
    pm2 delete all 2>&1 | grep -v "not found" || true
    echo "[OK] PM2 process'lar to'xtatildi"
else
    echo "[INFO] PM2 o'rnatilmagan"
fi

# Node.js process'larni to'xtatish (port 3000)
if lsof -ti:3000 &> /dev/null; then
    lsof -ti:3000 | xargs kill -9 2>&1 || true
    echo "[OK] Node.js process'lar to'xtatildi"
else
    echo "[INFO] Port 3000'da process topilmadi"
fi

# 2. Git pull
echo ""
echo "[2/5] Git pull..."
git pull origin main || {
    echo "[WARNING] Git pull xatolik, lekin davom etamiz..."
}

# 3. Dependencies o'rnatish
echo ""
echo "[3/5] Dependencies o'rnatish..."
npm install --production || {
    echo "[ERROR] npm install xatolik!"
    exit 1
}

# 4. Migration'lar
echo ""
echo "[4/5] Database migration'lar..."
NODE_ENV=production npm run migrate:latest || {
    echo "[ERROR] Migration xatolik!"
    exit 1
}

# 5. PM2 orqali ishga tushirish
echo ""
echo "[5/5] PM2 orqali ishga tushirish..."
if command -v pm2 &> /dev/null; then
    pm2 start ecosystem.config.js --env production || {
        echo "[ERROR] PM2 start xatolik!"
        exit 1
    }
    pm2 save || true
    echo "[OK] PM2 ishga tushirildi"
    echo ""
    echo "Status tekshirish:"
    pm2 status
else
    echo "[WARNING] PM2 o'rnatilmagan, node server.js ishlatiladi"
    NODE_ENV=production LOG_LEVEL=error node server.js &
fi

echo ""
echo "========================================"
echo "  DEPLOY YAKUNLANDI!"
echo "========================================"
echo ""
echo "Loglarni ko'rish:"
echo "  pm2 logs web-app"
echo ""
echo "Status tekshirish:"
echo "  pm2 status"
echo ""

