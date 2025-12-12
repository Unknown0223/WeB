const express = require('express');
const { db } = require('../db.js');
const { isAuthenticated, hasPermission, isManagerOrAdmin } = require('../middleware/auth.js');
const { createLogger } = require('../utils/logger.js');
const log = createLogger('PIVOT');


const router = express.Router();

/**
 * GET /api/pivot/data
 * Получить данные для сводной таблицы (pivot)
 * Требует права доступа: reports:view_all
 */
router.get('/data', isAuthenticated, hasPermission('reports:view_all'), async (req, res) => {
    const { startDate, endDate, currency } = req.query;
    
    // Valyuta konvertatsiyasi uchun
    const { convertCurrency, getTodayExchangeRates, BASE_CURRENCY } = require('../utils/exchangeRates.js');
    const targetCurrency = currency || BASE_CURRENCY;
    let exchangeRates = null;
    
    if (targetCurrency !== BASE_CURRENCY) {
        try {
            exchangeRates = await getTodayExchangeRates();
        } catch (error) {
            log.error('Kurslarni olishda xatolik:', error);
        }
    }

    try {
        // Запрос с объединением отчетов и брендов
        const query = db('reports')
            .leftJoin('brands', 'reports.brand_id', 'brands.id');

        // Фильтрация по дате
        if (startDate) query.where('report_date', '>=', startDate);
        if (endDate) query.where('report_date', '<=', endDate);

        const reports = await query.select(
            'reports.id',
            'reports.report_date',
            'reports.location',
            'reports.brand_id',
            'reports.data',
            'reports.currency',
            'reports.late_comment',
            'reports.created_by',
            'brands.name as brand_name'
        );

        // Получаем данные пользователей
        const userIds = [...new Set(reports.map(r => r.created_by))];
        const users = await db('users')
            .whereIn('id', userIds)
            .select('id', 'username');
        
        const userMap = users.reduce((acc, user) => {
            acc[user.id] = user.username;
            return acc;
        }, {});

        // Получаем все бренды для маппинга brandId -> brandName
        const allBrands = await db('brands').select('id', 'name');
        const brandMap = allBrands.reduce((acc, brand) => {
            acc[brand.id] = brand.name;
            return acc;
        }, {});

        // Преобразуем данные в плоский формат для pivot таблицы
        const flatData = [];
        
        // forEach o'rniga for...of ishlatamiz, chunki async/await kerak
        for (const report of reports) {
            try {
                const reportData = JSON.parse(report.data);
                const reportCurrency = report.currency || BASE_CURRENCY;
                
                // Обрабатываем каждую запись в отчете
                for (const key in reportData) {
                    let value = reportData[key];
                    
                    // Valyuta konvertatsiyasi - barcha hisobotlarni tanlangan valyutaga konvertatsiya qilish
                    if (targetCurrency !== reportCurrency && exchangeRates) {
                        try {
                            const originalValue = value;
                            // convertCurrency funksiyasidan foydalanish
                            value = await convertCurrency(value, reportCurrency, targetCurrency, exchangeRates);
                            if (originalValue !== value) {
                                log.debug(`💰 Konvertatsiya: ${originalValue} ${reportCurrency} → ${value.toFixed(2)} ${targetCurrency}`);
                            }
                        } catch (error) {
                            log.error(`Konvertatsiya xatolik (report #${report.id}, key: ${key}):`, error);
                            // Xatolik bo'lsa, qiymatni o'zgartirmaslik
                        }
                    }
                    
                    // Разбиваем ключ: format "brandId_paymentType"
                    const parts = key.split('_');
                    const brandId = parts[0];
                    const colName = parts.slice(1).join('_');
                    
                    // Получаем имя бренда из map
                    const brandNameFromKey = brandMap[brandId] || `Бренд #${brandId}`;
                    
                    flatData.push({
                        "ID": report.id,
                        "Дата": report.report_date,
                        "Бренд": brandNameFromKey,
                        "Филиал": report.location,
                        "Сотрудник": userMap[report.created_by] || 'Неизвестно',
                        "Показатель": colName,
                        "Тип оплаты": colName,
                        "Сумма": value,
                        "Комментарий": report.late_comment || ""
                    });
                }
            } catch (error) {
                log.error(`Ошибка парсинга данных отчета #${report.id}:`, error);
            }
        }

        res.json(flatData);

    } catch (error) {
        log.error("Ошибка в /api/pivot/data:", error);
        res.status(500).json({ 
            message: "Ошибка загрузки данных для сводной таблицы.",
            error: error.message 
        });
    }
});

/**
 * GET /api/pivot/templates
 * Получить список сохраненных шаблонов
 * Требует прав: manager или admin
 * Возвращает: публичные шаблоны + свои шаблоны (для админа - все)
 */
router.get('/templates', isManagerOrAdmin, async (req, res) => {
    try {
        const user = req.session.user;
        
        const query = db('pivot_templates as pt')
            .leftJoin('users as u', 'pt.created_by', 'u.id')
            .select(
                'pt.id', 
                'pt.name', 
                'pt.created_by', 
                'pt.is_public',
                'u.username as created_by_username'
            );

        // Администраторы видят все шаблоны
        // Остальные видят: публичные шаблоны + свои шаблоны
        if (user.role !== 'admin') {
            query.where(function() {
                this.where('pt.is_public', true)
                    .orWhere('pt.created_by', user.id);
            });
        }

        const templates = await query.orderBy('pt.is_public', 'desc').orderBy('pt.created_at', 'desc');
        res.json(templates);
        
    } catch (error) {
        log.error("Ошибка загрузки шаблонов:", error);
        res.status(500).json({ 
            message: "Ошибка загрузки шаблонов", 
            error: error.message 
        });
    }
});

/**
 * POST /api/pivot/templates
 * Создать новый шаблон
 * Требует прав: manager или admin
 */
router.post('/templates', isManagerOrAdmin, async (req, res) => {
    const { name, report, isPublic } = req.body;
    
    if (!name || !report) {
        return res.status(400).json({ 
            message: "Необходимо указать название шаблона и конфигурацию отчета." 
        });
    }
    
    try {
        // Только админы могут создавать публичные шаблоны
        const canMakePublic = req.session.user.role === 'admin' && isPublic === true;
        
        const [templateId] = await db('pivot_templates').insert({
            name: name,
            report: JSON.stringify(report),
            created_by: req.session.user.id,
            is_public: canMakePublic
        });
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            log.debug(`📡 [PIVOT] Yangi template yaratildi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('pivot_template_created', {
                templateId: templateId,
                name: name,
                is_public: canMakePublic,
                created_by: req.session.user.id,
                created_by_username: req.session.user.username
            });
            log.debug(`✅ [PIVOT] WebSocket yuborildi: pivot_template_created`);
        }
        
        res.status(201).json({ 
            message: "Шаблон успешно сохранен.", 
            templateId: templateId 
        });
        
    } catch (error) {
        log.error("Ошибка сохранения шаблона:", error);
        res.status(500).json({ 
            message: "Ошибка сохранения шаблона", 
            error: error.message 
        });
    }
});

/**
 * GET /api/pivot/templates/:id
 * Получить конкретный шаблон по ID
 * Требует прав: manager или admin
 */
router.get('/templates/:id', isManagerOrAdmin, async (req, res) => {
    try {
        const template = await db('pivot_templates')
            .where({ id: req.params.id })
            .select('report')
            .first();
        
        if (!template) {
            return res.status(404).json({ message: "Шаблон не найден." });
        }
        
        res.json(JSON.parse(template.report));
        
    } catch (error) {
        log.error("Ошибка получения шаблона:", error);
        res.status(500).json({ 
            message: "Ошибка получения шаблона", 
            error: error.message 
        });
    }
});

/**
 * PUT /api/pivot/templates/:id
 * Обновить название шаблона и публичность
 * Требует прав: manager или admin
 * Пользователи могут редактировать только свои шаблоны
 */
router.put('/templates/:id', isManagerOrAdmin, async (req, res) => {
    const { name, isPublic } = req.body;
    
    if (!name) {
        return res.status(400).json({ 
            message: "Необходимо указать новое название шаблона." 
        });
    }
    
    try {
        const template = await db('pivot_templates')
            .where({ id: req.params.id })
            .select('created_by')
            .first();
        
        if (!template) {
            return res.status(404).json({ message: "Шаблон не найден." });
        }
        
        // Проверка прав доступа: только создатель или админ может редактировать
        if (req.session.user.role !== 'admin' && template.created_by !== req.session.user.id) {
            return res.status(403).json({ 
                message: "Вы можете редактировать только свои шаблоны." 
            });
        }
        
        const updateData = { name: name };
        
        // Только админы могут изменять публичность шаблона
        if (req.session.user.role === 'admin' && typeof isPublic === 'boolean') {
            updateData.is_public = isPublic;
        }
        
        await db('pivot_templates')
            .where({ id: req.params.id })
            .update(updateData);
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            log.debug(`📡 [PIVOT] Template yangilandi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('pivot_template_updated', {
                templateId: parseInt(req.params.id),
                name: name,
                is_public: isPublic,
                updated_by: req.session.user.id,
                updated_by_username: req.session.user.username
            });
            log.debug(`✅ [PIVOT] WebSocket yuborildi: pivot_template_updated`);
        }
        
        res.json({ message: "Шаблон успешно обновлён." });
        
    } catch (error) {
        log.error("Ошибка обновления шаблона:", error);
        res.status(500).json({ 
            message: "Ошибка обновления шаблона", 
            error: error.message 
        });
    }
});

/**
 * DELETE /api/pivot/templates/:id
 * Удалить шаблон
 * Требует прав: manager или admin
 * Пользователи могут удалять только свои шаблоны
 */
router.delete('/templates/:id', isManagerOrAdmin, async (req, res) => {
    try {
        const template = await db('pivot_templates')
            .where({ id: req.params.id })
            .select('created_by')
            .first();
        
        if (!template) {
            return res.status(404).json({ message: "Шаблон не найден." });
        }
        
        // Проверка прав доступа: только создатель или админ может удалять
        if (req.session.user.role !== 'admin' && template.created_by !== req.session.user.id) {
            return res.status(403).json({ 
                message: "Вы можете удалять только свои шаблоны." 
            });
        }
        
        const templateName = template.name;
        await db('pivot_templates')
            .where({ id: req.params.id })
            .del();
        
        // WebSocket orqali realtime yuborish
        if (global.broadcastWebSocket) {
            log.debug(`📡 [PIVOT] Template o'chirildi, WebSocket orqali yuborilmoqda...`);
            global.broadcastWebSocket('pivot_template_deleted', {
                templateId: parseInt(req.params.id),
                name: templateName,
                deleted_by: req.session.user.id,
                deleted_by_username: req.session.user.username
            });
            log.debug(`✅ [PIVOT] WebSocket yuborildi: pivot_template_deleted`);
        }
        
        res.json({ message: "Шаблон успешно удален." });
        
    } catch (error) {
        log.error("Ошибка удаления шаблона:", error);
        res.status(500).json({ 
            message: "Ошибка удаления шаблона", 
            error: error.message 
        });
    }
});

/**
 * GET /api/pivot/used-currencies
 * Belgilangan davr uchun ishlatilgan valyutalarni va ularning kurslarini qaytarish
 */
router.get('/used-currencies', isAuthenticated, hasPermission('reports:view_all'), async (req, res) => {
    const { startDate, endDate } = req.query;
    
    try {
        const { getTodayExchangeRates, BASE_CURRENCY, SUPPORTED_CURRENCIES } = require('../utils/exchangeRates.js');
        
        // Hozirgi kurslarni olish
        const exchangeRates = await getTodayExchangeRates();
        
        // Barcha qo'llab-quvvatlanadigan valyutalarni ko'rsatish
        const ratesList = [];
        const symbols = {
            'UZS': 'so\'m',
            'USD': '$',
            'EUR': '€',
            'RUB': '₽',
            'KZT': '₸'
        };
        
        // UZS ni birinchi bo'lib qo'shamiz
        ratesList.push({
            currency: BASE_CURRENCY,
            symbol: symbols[BASE_CURRENCY],
            rate: 1,
            display: '1 so\'m = 1 so\'m'
        });
        
        // Qolgan barcha qo'llab-quvvatlanadigan valyutalarni qo'shamiz
        for (const currency of SUPPORTED_CURRENCIES) {
            const rate = exchangeRates[currency];
            if (rate) {
                ratesList.push({
                    currency: currency,
                    symbol: symbols[currency],
                    rate: rate,
                    display: `1 ${currency} = ${Math.round(rate).toLocaleString('ru-RU')} so'm`
                });
            }
        }
        
        res.json({
            currencies: ratesList,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        log.error('Ishlatilgan valyutalarni olishda xatolik:', error);
        res.status(500).json({ error: 'Xatolik yuz berdi' });
    }
});

module.exports = router;
