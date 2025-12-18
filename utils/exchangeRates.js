const axios = require('axios');
const { db } = require('../db.js');
const { createLogger } = require('./logger.js');

const log = createLogger('EXCHANGE');
const BASE_CURRENCY = 'UZS';
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'RUB', 'KZT'];

// O'zbekiston Markaziy bank API (agar mavjud bo'lsa)
// Yoki alternativ API manbalar
const EXCHANGE_RATE_APIS = {
    // Variant 1: O'zbekiston Markaziy bank (rasmiy API bo'lsa)
    // cb_api: 'https://cbu.uz/ru/exchange-rates/json/',
    
    // Variant 2: Open Exchange Rates (free tier)
    openexchangerates: {
        url: 'https://openexchangerates.org/api/latest.json',
        app_id: process.env.OPENEXCHANGERATES_APP_ID || null
    },
    
    // Variant 3: ExchangeRate-API (free tier)
    exchangerate_api: {
        url: 'https://api.exchangerate-api.com/v4/latest/UZS'
    },
    
    // Variant 4: Fixer.io (free tier)
    fixer: {
        url: 'https://api.fixer.io/latest',
        access_key: process.env.FIXER_API_KEY || null
    }
};

/**
 * Kurslarni API dan olish
 */
async function fetchExchangeRatesFromAPI() {
    try {
        // O'zbekiston Markaziy bank API (agar mavjud bo'lsa)
        // Keling, avval oddiy variant bilan boshlaymiz - ExchangeRate-API (bepul)
        
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
            timeout: 10000
        });
        
        if (response.data && response.data.rates) {
            const rates = response.data.rates;
            const today = new Date().toISOString().split('T')[0];
            
            const exchangeRates = {
                USD: rates.UZS || null, // 1 USD = ? UZS
                EUR: null,
                RUB: null,
                KZT: null
            };
            
            // EUR uchun
            if (rates.EUR) {
                exchangeRates.EUR = rates.UZS / rates.EUR; // 1 EUR = ? UZS
            }
            
            // RUB uchun
            if (rates.RUB) {
                exchangeRates.RUB = rates.UZS / rates.RUB; // 1 RUB = ? UZS
            }
            
            // KZT uchun
            if (rates.KZT) {
                exchangeRates.KZT = rates.UZS / rates.KZT; // 1 KZT = ? UZS
            }
            
            // Agar UZS to'g'ridan-to'g'ri bo'lmasa, boshqa API dan olish
            if (!exchangeRates.USD) {
                // Alternativ: Open Exchange Rates yoki boshqa manba
                return await fetchFromAlternativeAPI();
            }
            
            return exchangeRates;
        }
    } catch (error) {
        log.error('Exchange rate API xatolik:', error.message);
        return await fetchFromAlternativeAPI();
    }
    
    return null;
}

/**
 * Alternativ API dan kurslarni olish
 */
async function fetchFromAlternativeAPI() {
    try {
        // O'zbekiston Markaziy bank veb-saytidan scraping (agar API bo'lmasa)
        // Yoki boshqa bepul API
        
        // Hozircha default kurslar (keyinchalik real API bilan almashtiriladi)
        // Bu faqat fallback
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/UZS', {
            timeout: 10000
        });
        
        if (response.data && response.data.rates) {
            const rates = response.data.rates;
            return {
                USD: rates.USD || 12500, // 1 USD = 12500 UZS (default)
                EUR: rates.EUR || 13500, // 1 EUR = 13500 UZS (default)
                RUB: rates.RUB || 140,   // 1 RUB = 140 UZS (default)
                KZT: rates.KZT || 28     // 1 KZT = 28 UZS (default)
            };
        }
    } catch (error) {
        log.error('Alternativ API xatolik:', error.message);
    }
    
    // Eng oxirgi fallback - default kurslar
    return {
        USD: 12500,
        EUR: 13500,
        RUB: 140,
        KZT: 28
    };
}

/**
 * Bugungi kurslarni bazadan olish yoki API dan yangilash
 */
async function getTodayExchangeRates() {
    const today = new Date().toISOString().split('T')[0];
    
    // Avval bazadan tekshiramiz
    const existingRates = await db('exchange_rates')
        .where({ base_currency: BASE_CURRENCY, date: today })
        .select('target_currency', 'rate');
    
    if (existingRates.length === SUPPORTED_CURRENCIES.length) {
        // Barcha kurslar mavjud
        const rates = {};
        existingRates.forEach(row => {
            rates[row.target_currency] = parseFloat(row.rate);
        });
        return rates;
    }
    
    // Agar bazada yo'q bo'lsa, API dan olamiz
    log.debug('📊 Kurslarni API dan olish...');
    const apiRates = await fetchExchangeRatesFromAPI();
    
    if (apiRates) {
        // Bazaga saqlash
        for (const [currency, rate] of Object.entries(apiRates)) {
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
        
        return apiRates;
    }
    
    // Agar API ishlamasa, oxirgi mavjud kurslarni qaytaramiz
    const lastRates = await db('exchange_rates')
        .where({ base_currency: BASE_CURRENCY })
        .whereIn('target_currency', SUPPORTED_CURRENCIES)
        .orderBy('date', 'desc')
        .limit(3);
    
    if (lastRates.length > 0) {
        const rates = {};
        lastRates.forEach(row => {
            if (!rates[row.target_currency]) {
                rates[row.target_currency] = parseFloat(row.rate);
            }
        });
        return rates;
    }
    
    // Eng oxirgi fallback
    return {
        USD: 12500,
        EUR: 13500,
        RUB: 140
    };
}

/**
 * Summani bir valyutadan ikkinchisiga konvertatsiya qilish
 * @param {number} amount - Summa
 * @param {string} fromCurrency - Qaysi valyutadan (UZS, USD, EUR, RUB)
 * @param {string} toCurrency - Qaysi valyutaga
 * @param {object} rates - Kurslar obyekti (agar berilmasa, bugungi kurslar olinadi)
 */
async function convertCurrency(amount, fromCurrency, toCurrency, rates = null) {
    if (!amount || amount === 0) return 0;
    if (fromCurrency === toCurrency) return amount;
    
    if (!rates) {
        rates = await getTodayExchangeRates();
    }
    
    // Avval UZS ga konvertatsiya qilamiz
    let amountInUZS = amount;
    
    if (fromCurrency !== BASE_CURRENCY) {
        // Agar fromCurrency UZS bo'lmasa, UZS ga konvertatsiya qilamiz
        const fromRate = rates[fromCurrency];
        if (!fromRate) {
            log.warn(`Kurs topilmadi: ${fromCurrency}`);
            return amount; // Kurs topilmasa, o'zgartirmaymiz
        }
        // 1 fromCurrency = fromRate UZS
        // amount fromCurrency = amount * fromRate UZS
        amountInUZS = amount * fromRate;
    }
    
    // Endi UZS dan toCurrency ga konvertatsiya qilamiz
    if (toCurrency === BASE_CURRENCY) {
        return amountInUZS;
    }
    
    const toRate = rates[toCurrency];
    if (!toRate) {
        log.warn(`Kurs topilmadi: ${toCurrency}`);
        return amountInUZS; // Kurs topilmasa, UZS da qaytaramiz
    }
    
    // 1 toCurrency = toRate UZS
    // amountInUZS UZS = amountInUZS / toRate toCurrency
    return amountInUZS / toRate;
}

/**
 * Summani formatlash (valyuta belgisi bilan)
 */
function formatCurrency(amount, currency) {
    if (!amount || isNaN(amount)) return '0';
    
    const symbols = {
        'UZS': 'so\'m',
        'USD': '$',
        'EUR': '€',
        'RUB': '₽',
        'KZT': '₸'
    };
    
    const symbol = symbols[currency] || currency;
    
    // Barcha valyutalar uchun yaxlit son (kasr qismi yo'q)
    const rounded = Math.round(amount);
    const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    
    if (currency === 'UZS') {
        return `${formatted} ${symbol}`;
    }
    
    return `${symbol}${formatted}`;
}

module.exports = {
    getTodayExchangeRates,
    convertCurrency,
    formatCurrency,
    fetchExchangeRatesFromAPI,
    BASE_CURRENCY,
    SUPPORTED_CURRENCIES
};

