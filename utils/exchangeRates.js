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
 * Axios so'rovini retry bilan bajarish
 */
async function axiosWithRetry(url, options = {}, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get(url, {
                ...options,
                timeout: options.timeout || 20000 // Default 20 soniya
            });
            return response;
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
            log.debug(`API so'rovi muvaffaqiyatsiz (${attempt}/${maxRetries}), ${delay}ms dan keyin qayta urinilmoqda...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Kurslarni API dan olish
 */
async function fetchExchangeRatesFromAPI() {
    try {
        // O'zbekiston Markaziy bank API (agar mavjud bo'lsa)
        // Keling, avval oddiy variant bilan boshlaymiz - ExchangeRate-API (bepul)
        
        const response = await axiosWithRetry('https://api.exchangerate-api.com/v4/latest/USD', {
            timeout: 20000 // 20 soniyaga oshirildi
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
    // Bir nechta alternativ API larni sinab ko'ramiz
    const alternativeAPIs = [
        {
            name: 'ExchangeRate-API (UZS base)',
            url: 'https://api.exchangerate-api.com/v4/latest/UZS',
            parser: (data) => {
                if (data && data.rates) {
                    return {
                        USD: data.rates.USD || null,
                        EUR: data.rates.EUR || null,
                        RUB: data.rates.RUB || null,
                        KZT: data.rates.KZT || null
                    };
                }
                return null;
            }
        },
        {
            name: 'ExchangeRate-API (EUR base)',
            url: 'https://api.exchangerate-api.com/v4/latest/EUR',
            parser: (data) => {
                if (data && data.rates && data.rates.UZS) {
                    const uzsPerEur = data.rates.UZS;
                    return {
                        USD: data.rates.USD ? uzsPerEur / data.rates.USD : null,
                        EUR: uzsPerEur,
                        RUB: data.rates.RUB ? uzsPerEur / data.rates.RUB : null,
                        KZT: data.rates.KZT ? uzsPerEur / data.rates.KZT : null
                    };
                }
                return null;
            }
        }
    ];
    
    // Har bir alternativ API ni sinab ko'ramiz
    for (const api of alternativeAPIs) {
        try {
            log.debug(`Alternativ API sinanmoqda: ${api.name}`);
            const response = await axiosWithRetry(api.url, {
                timeout: 20000 // 20 soniya
            }, 2); // 2 marta urinib ko'ramiz
            
            const rates = api.parser(response.data);
            if (rates && (rates.USD || rates.EUR || rates.RUB || rates.KZT)) {
                log.debug(`✅ ${api.name} muvaffaqiyatli ishladi`);
                return {
                    USD: rates.USD || 12500,
                    EUR: rates.EUR || 13500,
                    RUB: rates.RUB || 140,
                    KZT: rates.KZT || 28
                };
            }
        } catch (error) {
            log.debug(`❌ ${api.name} xatolik: ${error.message}`);
            continue; // Keyingi API ga o'tamiz
        }
    }
    
    // Barcha API lar muvaffaqiyatsiz bo'lsa, default kurslarni qaytaramiz
    log.warn('⚠️ Barcha API lar muvaffaqiyatsiz, default kurslar ishlatilmoqda');
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

