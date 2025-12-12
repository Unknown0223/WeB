const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission } = require('../middleware/auth.js');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('EXCHANGERATES');

const { 
    getTodayExchangeRates, 
    convertCurrency, 
    formatCurrency,
    fetchExchangeRatesFromAPI,
    BASE_CURRENCY,
    SUPPORTED_CURRENCIES
} = require('../utils/exchangeRates.js');

const router = express.Router();

// GET /api/exchange-rates - Bugungi kurslarni olish
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const rates = await getTodayExchangeRates();
        res.json({ success: true, rates, base_currency: BASE_CURRENCY });
    } catch (error) {
        log.error('Exchange rates GET xatolik:', error);
        res.status(500).json({ message: 'Kurslarni olishda xatolik' });
    }
});

// POST /api/exchange-rates/convert - Summani konvertatsiya qilish
router.post('/convert', isAuthenticated, async (req, res) => {
    try {
        const { amount, fromCurrency, toCurrency } = req.body;
        
        if (!amount || !fromCurrency || !toCurrency) {
            return res.status(400).json({ message: 'Barcha parametrlar kiritilishi shart' });
        }
        
        const converted = await convertCurrency(
            parseFloat(amount),
            fromCurrency,
            toCurrency
        );
        
        res.json({
            success: true,
            original: { amount: parseFloat(amount), currency: fromCurrency },
            converted: { amount: converted, currency: toCurrency },
            formatted: formatCurrency(converted, toCurrency)
        });
    } catch (error) {
        log.error('Currency convert xatolik:', error);
        res.status(500).json({ message: 'Konvertatsiya qilishda xatolik' });
    }
});

// POST /api/exchange-rates/refresh - Kurslarni API dan yangilash (admin)
router.post('/refresh', isAuthenticated, hasPermission('settings:edit_general'), async (req, res) => {
    try {
        log.debug('🔄 Kurslarni API dan yangilash...');
        const rates = await fetchExchangeRatesFromAPI();
        
        if (rates) {
            const today = new Date().toISOString().split('T')[0];
            
            for (const [currency, rate] of Object.entries(rates)) {
                if (rate && SUPPORTED_CURRENCIES.includes(currency)) {
                    await db('exchange_rates')
                        .insert({
                            base_currency: BASE_CURRENCY,
                            target_currency: currency,
                            rate: rate,
                            date: today
                        })
                        .onConflict(['base_currency', 'target_currency', 'date'])
                        .merge({ rate: rate, updated_at: db.fn.now() });
                }
            }
            
            // WebSocket orqali realtime yuborish
            if (global.broadcastWebSocket) {
                log.debug(`📡 [EXCHANGE_RATES] Kurslar yangilandi, WebSocket orqali yuborilmoqda...`);
                global.broadcastWebSocket('exchange_rates_updated', {
                    rates: rates,
                    date: today,
                    updated_by: req.session.user.id,
                    updated_by_username: req.session.user.username
                });
                log.debug(`✅ [EXCHANGE_RATES] WebSocket yuborildi: exchange_rates_updated`);
            }
            
            res.json({ 
                success: true, 
                message: 'Kurslar muvaffaqiyatli yangilandi',
                rates 
            });
        } else {
            res.status(500).json({ message: 'Kurslarni API dan olishda xatolik' });
        }
    } catch (error) {
        log.error('Exchange rates refresh xatolik:', error);
        res.status(500).json({ message: 'Kurslarni yangilashda xatolik' });
    }
});

// GET /api/exchange-rates/history - Kurslar tarixi (admin)
router.get('/history', isAuthenticated, hasPermission('settings:edit_general'), async (req, res) => {
    try {
        const { currency, days = 30 } = req.query;
        
        const query = db('exchange_rates')
            .where({ base_currency: BASE_CURRENCY })
            .where('date', '>=', db.raw("date('now', '-' || ? || ' days')", [days]))
            .orderBy('date', 'desc');
        
        if (currency && SUPPORTED_CURRENCIES.includes(currency)) {
            query.where({ target_currency: currency });
        }
        
        const rates = await query.select('*');
        
        res.json({ success: true, rates });
    } catch (error) {
        log.error('Exchange rates history xatolik:', error);
        res.status(500).json({ message: 'Kurslar tarixini olishda xatolik' });
    }
});

module.exports = router;

