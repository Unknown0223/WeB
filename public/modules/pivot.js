// Модуль интерактивных отчетов (Pivot)
// Управление сводными таблицами и шаблонами

import { state, setPivotDatePicker, pivotDatePickerFP } from './state.js';
import { DOM } from './dom.js';
import { safeFetch } from './api.js';
import { showToast, debounce, hasPermission, showConfirmDialog } from './utils.js';

// Pivot cheklovini cache qilish
let pivotMaxSizeCache = null;
let pivotMaxSizeCacheTime = null;
const PIVOT_CONFIG_CACHE_TIME = 5 * 60 * 1000; // 5 daqiqa

/**
 * Backend'dan pivot cheklovini olish (cache bilan)
 */
async function getPivotMaxSize() {
    // Cache tekshirish
    if (pivotMaxSizeCache && pivotMaxSizeCacheTime && (Date.now() - pivotMaxSizeCacheTime) < PIVOT_CONFIG_CACHE_TIME) {
        return pivotMaxSizeCache;
    }
    
    try {
        const configRes = await safeFetch('/api/pivot/config');
        if (configRes && configRes.ok) {
            const config = await configRes.json();
            pivotMaxSizeCache = config.maxSize || (1024 * 1024); // Default: 1 MB
            pivotMaxSizeCacheTime = Date.now();
            return pivotMaxSizeCache;
        }
    } catch (error) {
        console.warn('[PIVOT] Cheklovni olishda xatolik, default 1 MB ishlatilmoqda:', error);
    }
    
    // Default qiymat
    return 1024 * 1024; // 1 MB
}

// ================== Pivot UI lokalizatsiya (RU) ==================

const PIVOT_RU_TRANSLATIONS = {
    // Asosiy Fields oynasi
    "Fields": "Поля",
    "Drag and drop fields to arrange": "Перетащите поля, чтобы изменить расположение",
    "Add calculated value": "Добавить вычисляемое значение",
    "APPLY": "ПРИМЕНИТЬ",
    "Apply": "Применить",
    "CANCEL": "ОТМЕНА",
    "Cancel": "Отмена",
    "All Fields": "Все поля",
    "Expand All": "Развернуть все",
    "Report Filters": "Фильтры отчета",
    "Columns": "Колонки",
    "Rows": "Строки",
    "Values": "Значения",
    "Drop field here": "Перетащите поле сюда",

    // Toolbar tugmalari
    "Open": "Открыть",
    "Save": "Сохранить",
    "Export": "Экспорт",
    "Format": "Формат",
    "Options": "Настройки",
    "Fullscreen": "На весь экран",

    // Layout options oynasi
    "Layout options": "Параметры макета",
    "GRAND TOTALS": "ИТОГИ",
    "SUBTOTALS": "ПРОМЕЖУТОЧНЫЕ ИТОГИ",
    "Do not show grand totals": "Не показывать общие итоги",
    "Show grand totals": "Показывать общие итоги",
    "Show for rows only": "Показывать только для строк",
    "Show for columns only": "Показывать только для колонок",
    "Do not show subtotals": "Не показывать промежуточные итоги",
    "Show subtotals": "Показывать промежуточные итоги",
    "Show subtotal rows only": "Показывать промежуточные итоги только для строк",
    "Show subtotal columns only": "Показывать промежуточные итоги только для колонок",
    "LAYOUT": "МАКЕТ",
    "Compact form": "Компактный вид",
    "Classic form": "Классический вид",
    "Flat form": "Плоский вид",

    // Format cells oynasi
    "Format cells": "Форматирование ячеек",
    "CHOOSE VALUE": "ВЫБРАТЬ ЗНАЧЕНИЕ",
    "Choose value": "Выбрать значение",
    "Text align": "Выравнивание текста",
    "Thousand separator": "Разделитель тысяч",
    "Decimal separator": "Десятичный разделитель",
    "Decimal places": "Десятичные знаки",
    "Currency symbol": "Символ валюты",
    "Currency align": "Выравнивание валюты",
    "Null value": "Пустое значение",
    "Format as percent": "Формат в процентах",

    // Conditional formatting oynasi
    "Conditional formatting": "Условное форматирование",
    "Add": "Добавить",

    // Format cells dropdown qiymatlari
    "right": "справа",
    "left": "слева",
    "center": "по центру",
    "(Space)": "(Пробел)",
    ".": ".",
    ",": ",",
    "None": "Нет",
    "false": "нет",
    "true": "да",

    // Aggregation funksiyalari
    "Sum": "Сумма",
    "Count": "Количество",
    "Distinct Count": "Уникальное количество",
    "Average": "Среднее",
    "Median": "Медиана",
    "Product": "Произведение",
    "Min": "Минимум",
    "Max": "Максимум",
    
    // Fields oynasidagi "Sum of" prefiksini olib tashlash
    "Sum of Сумма": "Сумма",
    "Sum of Сумма (число)": "Сумма (число)",
    "Sum of": "",

    // Calculation/Show values as funksiyalari
    "% of Grand Total": "% от общего итога",
    "% of Column": "% от колонки",
    "% of Row": "% от строки",
    "Index": "Индекс",
    "Difference": "Разница",
    "% Difference": "% разница",
    "Population StDev": "Стандартное отклонение",
    "% of Parent": "% от родителя",
    "% of Parent Column": "% от родительской колонки",
    "% of Parent Row": "% от родительской строки",
    "Running Total": "Накопительный итог",
    "% Running Total": "% накопительный итог",
    "Rank": "Ранг",
    "% Rank": "% ранг",
    "Sample StDev": "Стандартное отклонение выборки",
    "Population Var": "Дисперсия",
    "Sample Var": "Дисперсия выборки",

    // Boshqa umumiy matnlar
    "Show values as": "Показать значения как",
    "Calculation": "Вычисление",
    "Format": "Формат",
    "Number format": "Числовой формат",
    "Custom format": "Пользовательский формат",
    "Default": "По умолчанию",
    "General": "Общий",
    "Percentage": "Процент",
    "Scientific": "Экспоненциальный",
    "Fraction": "Дробь",
    "Currency": "Валюта",
    "Date": "Дата",
    "Time": "Время",
    "Text": "Текст",
    "Custom": "Пользовательский"
};

function applyPivotRuTranslations(root = document.body) {
    if (!root) return;
    try {
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            null
        );
        let node;
        while ((node = walker.nextNode())) {
            const original = node.nodeValue;
            if (!original) continue;
            const trimmed = original.trim();
            if (!trimmed) continue;
            
            // Avval to'liq matnni tekshiramiz
            let translated = PIVOT_RU_TRANSLATIONS[trimmed];
            if (translated && original.trim() === trimmed) {
                node.nodeValue = original.replace(trimmed, translated);
                continue;
            }
            
            // Barcha aggregation prefikslarini olib tashlash (Sum of, Count of, Average of, va hokazo)
            // Avval "Сумма" bilan maxsus holatlarni tekshiramiz
            // Har qanday aggregation funksiyasi bilan "Сумма" bo'lib qolishi kerak
            if (trimmed.match(/\b(Sum|Count|Distinct Count|Average|Median|Product|Min|Max|Сумма|Количество|Уникальное количество|Среднее|Медиана|Произведение|Минимум|Максимум)\s+of\s+Сумма/i)) {
                if (trimmed.includes('(число)') || trimmed.includes('(чис')) {
                    node.nodeValue = original.replace(/\b(Sum|Count|Distinct Count|Average|Median|Product|Min|Max|Сумма|Количество|Уникальное количество|Среднее|Медиана|Произведение|Минимум|Максимум)\s+of\s+Сумма\s*\([^)]*\)/gi, 'Сумма (число)');
                } else {
                    node.nodeValue = original.replace(/\b(Sum|Count|Distinct Count|Average|Median|Product|Min|Max|Сумма|Количество|Уникальное количество|Среднее|Медиана|Произведение|Минимум|Максимум)\s+of\s+Сумма/gi, 'Сумма');
                }
                continue;
            }
            
            // Ruscha aggregation funksiyalari bilan ham ishlash
            if (trimmed.match(/\b(Сумма|Количество|Уникальное количество|Среднее|Медиана|Произведение|Минимум|Максимум)\s+of\s+Сумма/i)) {
                if (trimmed.includes('(число)') || trimmed.includes('(чис')) {
                    node.nodeValue = original.replace(/\b(Сумма|Количество|Уникальное количество|Среднее|Медиана|Произведение|Минимум|Максимум)\s+of\s+Сумма\s*\([^)]*\)/gi, 'Сумма (число)');
                } else {
                    node.nodeValue = original.replace(/\b(Сумма|Количество|Уникальное количество|Среднее|Медиана|Произведение|Минимум|Максимум)\s+of\s+Сумма/gi, 'Сумма');
                }
                continue;
            }
            
            // Barcha aggregation prefikslarini umumiy holatda olib tashlash
            // Masalan: "Sum of Бренд" -> "Бренд", "Count of Филиал" -> "Филиал"
            // Ruscha va inglizcha aggregation funksiyalari bilan ham ishlash
            const aggregationPattern = /\b(Sum|Count|Distinct Count|Average|Median|Product|Min|Max|Сумма|Количество|Уникальное количество|Среднее|Медиана|Произведение|Минимум|Максимум)\s+of\s+/gi;
            if (aggregationPattern.test(trimmed)) {
                node.nodeValue = original.replace(aggregationPattern, '');
                continue;
            }
            
            // Boshqa tarjimalarni tekshiramiz
            translated = PIVOT_RU_TRANSLATIONS[trimmed];
            if (translated && original.trim() === trimmed) {
                node.nodeValue = original.replace(trimmed, translated);
            }
        }
    } catch (err) {
        // Silent error handling
    }
}

function initPivotDomLocalization() {
    if (window.__pivotDomLocalizationInitialized) return;
    window.__pivotDomLocalizationInitialized = true;

    // Dastlab hammasini tarjima qilib chiqamiz
    applyPivotRuTranslations();

    const observer = new MutationObserver(() => {
        // Har qanday yangi DOM o'zgarishida pivot oynasidagi matnlarni yangilab qo'yamiz
        applyPivotRuTranslations();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

/**
 * Показать индикатор загрузки над pivot таблицей
 */
function showPivotLoader() {
    const container = document.getElementById('pivot-container');
    if (container && !container.querySelector('.pivot-loader')) {
        const loader = document.createElement('div');
        loader.className = 'pivot-loader';
        loader.innerHTML = '<div class="spinner"></div><p>Загрузка данных...</p>';
        loader.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;z-index:999;';
        container.style.position = 'relative';
        container.style.opacity = '0.5';
        container.appendChild(loader);
    }
}

/**
 * Скрыть индикатор загрузки
 */
function hidePivotLoader() {
    const container = document.getElementById('pivot-container');
    if (container) {
        const loader = container.querySelector('.pivot-loader');
        if (loader) loader.remove();
        container.style.opacity = '1';
    }
}

/**
 * Настроить кастомизацию панели инструментов pivot таблицы
 * @param {Object} toolbar - объект панели инструментов WebDataRocks
 */
function customizePivotToolbar(toolbar) {
    let tabs = toolbar.getTabs();
    
    // Убираем кнопку "Connect" (подключение к источникам данных)
    tabs = tabs.filter(tab => tab.id !== 'wdr-tab-connect');
    
    // Настраиваем кнопку "Save" - открывать модальное окно для сохранения шаблона
    tabs = tabs.map(tab => {
        if (tab.id === 'wdr-tab-save') {
            tab.handler = () => {
                // Открываем модальное окно для сохранения шаблона
                if (DOM.saveTemplateModal) {
                    DOM.saveTemplateModal.classList.remove('hidden');
                    DOM.templateNameInput.focus();
                }
            };
            tab.title = 'Сохранить шаблон';
        }
        
        // Настраиваем кнопку "Open" - показать список сохранённых шаблонов
        if (tab.id === 'wdr-tab-open') {
            tab.handler = () => {
                // Открываем модальное окно со списком шаблонов
                if (DOM.loadTemplateModal) {
                    DOM.loadTemplateModal.classList.remove('hidden');
                    renderTemplatesList();
                }
            };
            tab.title = 'Загрузить шаблон';
            // Dropdown menyusini butunlay olib tashlaymiz
            tab.menu = [];
            delete tab.menu;
        }
        
        return tab;
    });

    // Создаём две отдельные кнопки для сворачивания и разворачивания
    // Показываем только одну в зависимости от состояния через CSS
    
    const expandAllTab = {
        id: 'custom-expand-all',
        title: 'Развернуть все данные',
        icon: `<svg width="20" height="20" viewBox="0 0 20 20">
                <path d="M13 3 L17 3 L17 7 M3 13 L3 17 L7 17" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M17 3 L11 9 M3 17 L9 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
               </svg>`,
        handler: () => {
            if (state.pivotGrid && typeof state.pivotGrid.expandAllData === 'function') {
                state.pivotGrid.expandAllData();
                
                setTimeout(() => {
                    const expandBtn = document.querySelector('[id="custom-expand-all"]');
                    const collapseBtn = document.querySelector('[id="custom-collapse-all"]');
                    
                    if (expandBtn && collapseBtn) {
                        expandBtn.style.setProperty('display', 'none', 'important');
                        collapseBtn.style.setProperty('display', 'inline-block', 'important');
                    }
                }, 50);
            }
        }
    };
    
    const collapseAllTab = {
        id: 'custom-collapse-all',
        title: 'Свернуть все данные',
        icon: `<svg width="20" height="20" viewBox="0 0 20 20">
                <path d="M9 5 L9 9 L5 9 M11 15 L11 11 L15 11" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M9 9 L3 3 M11 11 L17 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
               </svg>`,
        handler: () => {
            if (state.pivotGrid && typeof state.pivotGrid.collapseAllData === 'function') {
                state.pivotGrid.collapseAllData();
                
                setTimeout(() => {
                    const expandBtn = document.querySelector('[id="custom-expand-all"]');
                    const collapseBtn = document.querySelector('[id="custom-collapse-all"]');
                    
                    if (expandBtn && collapseBtn) {
                        collapseBtn.style.setProperty('display', 'none', 'important');
                        expandBtn.style.setProperty('display', 'inline-block', 'important');
                    }
                }, 50);
            }
        }
    };

    // Обе кнопки добавляем, но используем абсолютное позиционирование для наложения
    tabs.unshift(collapseAllTab);
    tabs.unshift(expandAllTab);
    
    // Начальное состояние: данные свёрнуты, показываем кнопку "Развернуть"
    setTimeout(() => {
        const expandBtn = document.querySelector('[id="custom-expand-all"]');
        const collapseBtn = document.querySelector('[id="custom-collapse-all"]');
        
        if (expandBtn && collapseBtn) {
            collapseBtn.style.cssText = 'display: none !important;';
            expandBtn.style.cssText = 'display: inline-block !important;';
        }
    }, 200);
    
    toolbar.getTabs = () => tabs;
}

/**
 * Tezkor sana tanlash plugin'i
 * Flatpickr'ga tezkor variantlar menyusini qo'shadi
 */
function createQuickSelectPlugin() {
    return function(fp) {
        return {
            onReady() {
                const wrapper = fp.calendarContainer;
                if (!wrapper) return;
                
                // Tezkor variantlar menyusini yaratish
                const quickSelectMenu = document.createElement('div');
                quickSelectMenu.className = 'flatpickr-quick-select';
                quickSelectMenu.innerHTML = `
                    <div class="quick-select-item" data-action="today">Bugun</div>
                    <div class="quick-select-item" data-action="yesterday">Kecha</div>
                    <div class="quick-select-item" data-action="tomorrow">Ertaga</div>
                    <div class="quick-select-item" data-action="last7days">Oxirgi 7 kun</div>
                    <div class="quick-select-item" data-action="last30days">Oxirgi 30 kun</div>
                    <div class="quick-select-item" data-action="thisMonth">Bu oy</div>
                    <div class="quick-select-item" data-action="lastMonth">O'tgan oy</div>
                `;
                
                // Kalendar container'ga qo'shish
                wrapper.insertBefore(quickSelectMenu, wrapper.firstChild);
                
                // Har bir variantga event listener qo'shish
                quickSelectMenu.querySelectorAll('.quick-select-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const action = item.dataset.action;
                        handleQuickSelect(action, fp);
                    });
                });
            }
        };
    };
}

/**
 * Tezkor variantlarni boshqarish funksiyasi
 * @param {string} action - variant turi
 * @param {Object} fp - flatpickr instance
 */
async function handleQuickSelect(action, fp) {
    const today = new Date();
    let startDate, endDate;
    
    switch(action) {
        case 'today':
            startDate = new Date(today);
            endDate = new Date(today);
            break;
        case 'yesterday':
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            startDate = yesterday;
            endDate = yesterday;
            break;
        case 'tomorrow':
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            startDate = tomorrow;
            endDate = tomorrow;
            break;
        case 'last7days':
            startDate = new Date(today);
            startDate.setDate(startDate.getDate() - 6);
            endDate = new Date(today);
            break;
        case 'last30days':
            startDate = new Date(today);
            startDate.setDate(startDate.getDate() - 29);
            endDate = new Date(today);
            break;
        case 'thisMonth':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            break;
        case 'lastMonth':
            startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            endDate = new Date(today.getFullYear(), today.getMonth(), 0);
            break;
    }
    
    // Sanalarni o'rnatish
    fp.setDate([startDate, endDate], false);
    
    // Ma'lumotlarni avtomatik yuklash
    const startDateStr = flatpickr.formatDate(startDate, 'Y-m-d');
    const endDateStr = flatpickr.formatDate(endDate, 'Y-m-d');
    const currency = DOM.pivotCurrencySelect?.value || 'UZS';
    
    await updatePivotData(startDateStr, endDateStr, currency);
    await loadExchangeRates(startDateStr, endDateStr);
}

/**
 * Инициализация модуля Pivot
 * Создает экземпляр WebDataRocks с русской локализацией
 */
export function setupPivot() {
    // Проверка прав доступа
    if (!hasPermission(state.currentUser, 'reports:view_all') || !DOM.pivotContainer) {
        return;
    }
    
    // Faqat admin uchun public shablon yaratish imkonini ko'rsatamiz
    if (state.currentUser && state.currentUser.role === 'admin' && DOM.publicTemplateOption) {
        DOM.publicTemplateOption.style.display = 'block';
    }
    
    // Oxirgi kirish vaqtini tekshirish va default sana o'rnatish
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Vaqtni 00:00:00 ga o'rnatish
    
    const lastVisitKey = 'pivot_last_visit';
    const lastVisitStr = localStorage.getItem(lastVisitKey);
    let defaultStartDate, defaultEndDate;
    
    if (lastVisitStr) {
        const lastVisit = new Date(lastVisitStr);
        lastVisit.setHours(0, 0, 0, 0);
        
        // Kecha va bugun orasidagi farqni hisoblash
        const diffTime = today - lastVisit;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            // Bugun kirgan - bugungi sana
            defaultStartDate = new Date(today);
            defaultEndDate = new Date(today);
            console.log('[PIVOT] 📅 Bugun kirilgan - bugungi sana default');
        } else if (diffDays === 1) {
            // Kecha kirgan - kechagi sana
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            defaultStartDate = new Date(yesterday);
            defaultEndDate = new Date(yesterday);
            console.log('[PIVOT] 📅 Kecha kirilgan - kechagi sana default');
        } else {
            // 2 kun yoki ko'proq o'tgan - bugungi sana
            defaultStartDate = new Date(today);
            defaultEndDate = new Date(today);
            console.log('[PIVOT] 📅 Uzoq vaqt o\'tgan - bugungi sana default');
        }
    } else {
        // Birinchi marta kirilgan - bugungi sana
        defaultStartDate = new Date(today);
        defaultEndDate = new Date(today);
        console.log('[PIVOT] 📅 Birinchi marta kirilgan - bugungi sana default');
    }
    
    // Oxirgi kirish vaqtini yangilash
    localStorage.setItem(lastVisitKey, today.toISOString());
    
    // Shablonlar ro'yxatini yuklash
    renderTemplatesAsTags();

    // Настройка выбора диапазона дат с помощью flatpickr
    // Tezkor sana tanlash plugin'i bilan
    const fpInstance = flatpickr(DOM.pivotDateFilter, {
        mode: "range",
        dateFormat: "Y-m-d",
        locale: 'ru',
        defaultDate: [defaultStartDate, defaultEndDate],
        plugins: [createQuickSelectPlugin()] // Tezkor variantlar plugin'i
    });
    
    setPivotDatePicker(fpInstance);
    
    // Default sana bilan avtomatik yuklanish
    fpInstance.setDate([defaultStartDate, defaultEndDate], false);
    
    // Avtomatik ma'lumotlar yuklash (sahifa yuklanganda yoki bo'limga o'tilganda)
    const startDateStr = flatpickr.formatDate(defaultStartDate, 'Y-m-d');
    const endDateStr = flatpickr.formatDate(defaultEndDate, 'Y-m-d');
    const defaultCurrency = DOM.pivotCurrencySelect?.value || 'UZS';
    
    // Dastlabki holatda barcha maydonlar bilan minimal ma'lumot yaratish
    // Bu Fields panelida barcha maydonlarni ko'rsatish uchun kerak
    const todayStr = flatpickr.formatDate(defaultEndDate, 'Y-m-d');
    const initialEmptyData = [{
        "ID": null,
        "Дата": todayStr,
        "День": defaultEndDate.getDate(),
        "Бренд": null,
        "Филиал": null,
        "Сотрудник": null,
        "Показатель": null,
        "Тип оплаты": null,
        "Сумма": 0,
        "Сумма_число": 0,
        "Комментарий": ""
    }];

    // Global flag - Fields panelini bir marta yopish uchun
    let fieldsPanelClosed = false;
    
    // Инициализация WebDataRocks с русской локализацией
    state.pivotGrid = new WebDataRocks({
        container: "#pivot-container",
        toolbar: true,
        beforetoolbarcreated: customizePivotToolbar,
        localization: "ru",
        globalization: {
            culture: "ru-RU",
            dateFormat: "dd.MM.yyyy"
        },
        report: {
            dataSource: { 
                data: initialEmptyData  // Bo'sh emas, minimal ma'lumotlar bilan
            },
            slice: {
                // Dastlabki holatda slice bo'sh bo'ladi, foydalanuvchi o'zi tanlaydi
                rows: [],
                columns: [],
                measures: [],
                reportFilters: []
            },
            options: { 
                grid: { 
                    title: "Сводная таблица отчетов", 
                    showHeaders: true, 
                    showTotals: "on", 
                    showGrandTotals: "on",
                    type: "compact"
                },
                configuratorActive: false,  // Dastlabki holatda yopiq
                datePattern: "dd.MM.yyyy"
            },
            formats: [{
                name: "currency", 
                thousandsSeparator: " ", 
                decimalPlaces: 0, 
                currencySymbol: " сум", 
                currencySymbolAlign: "right",
                nullValue: "0"
            }, {
                name: "number",
                thousandsSeparator: " ",
                decimalPlaces: 0,
                nullValue: "-"
            }, {
                name: "day",
                thousandsSeparator: "",
                decimalPlaces: 0,
                nullValue: "-"
            }]
        },
        reportcomplete: function() {
            hidePivotLoader();
            
            // DOM asosida ruscha tarjimani qo'llash
            initPivotDomLocalization();
            
            // Fields panelini yopish - faqat agar configuratorActive true bo'lsa
            // Lekin biz allaqachon configuratorActive: false qildik, shuning uchun bu yerda qo'shimcha kod kerak emas
            
            // "Total Sum of Сумма" ni "Сумма" ga o'zgartirish va "День" maydonini oddiy raqam sifatida ko'rsatish
            setTimeout(() => {
                const pivotContainer = document.getElementById('pivot-container');
                if (pivotContainer) {
                    // Barcha "Total Sum of" matnlarini "Сумма" ga o'zgartirish
                    const walker = document.createTreeWalker(
                        pivotContainer,
                        NodeFilter.SHOW_TEXT,
                        null
                    );
                    let node;
                    while ((node = walker.nextNode())) {
                        const text = node.nodeValue;
                        if (text) {
                            // "Total Sum of Сумма" ni "Сумма" ga o'zgartirish
                            if (text.includes('Total Sum of Сумма')) {
                                node.nodeValue = text.replace(/Total Sum of Сумма/g, 'Сумма');
                            } else if (text.includes('Total Sum of')) {
                                node.nodeValue = text.replace(/Total Sum of/g, '');
                            }
                            
                            // "Sum of Сумма" ni "Сумма" ga o'zgartirish (Fields oynasida)
                            if (text.includes('Sum of Сумма')) {
                                node.nodeValue = text.replace(/Sum of Сумма/g, 'Сумма');
                            } else if (text.includes('Sum of') && text.includes('Сумма')) {
                                node.nodeValue = text.replace(/Sum of/g, '');
                            }
                            
                            // "День" maydoni uchun - valyuta belgisi bo'lmagan oddiy raqam
                            const parent = node.parentElement;
                            const grandParent = parent?.parentElement;
                            const isDayColumn = grandParent?.textContent?.includes('День') || 
                                               parent?.textContent?.includes('День') ||
                                               parent?.getAttribute('data-field') === 'День';
                            
                            if (isDayColumn && text.trim() && /^\d+[\s,]*сум/.test(text.trim())) {
                                // Agar "День" ustunida valyuta belgisi bo'lsa, uni olib tashlash
                                const numValue = parseInt(text.trim().replace(/[\s,]*сум.*/g, '').replace(/\s/g, ''), 10);
                                if (!isNaN(numValue)) {
                                    node.nodeValue = numValue.toString(); // Oddiy raqam, formatlash yo'q
                                }
                            } else if (isDayColumn && text.trim() && /^\d+[\s,]*$/.test(text.trim())) {
                                // Agar "День" ustunida faqat raqam bo'lsa, oddiy ko'rinishda qoldiramiz
                                const numValue = parseInt(text.trim().replace(/\s/g, ''), 10);
                                if (!isNaN(numValue) && numValue > 0 && numValue <= 31) {
                                    node.nodeValue = numValue.toString(); // Oddiy raqam
                                }
                            }
                        }
                    }
                }
            }, 100);
        }
    });

    // Avtomatik yuklanish - async funksiya sifatida
    // Bu ma'lumotlarni yuklaydi, lekin agar ma'lumotlar bo'lmasa, minimal ma'lumotlar qoladi
    (async () => {
        // Default shablonni yuklash (agar mavjud bo'lsa)
        const defaultTemplateKey = 'pivot_default_template_id';
        const defaultTemplateId = localStorage.getItem(defaultTemplateKey);
        
        if (defaultTemplateId && state.pivotTemplates && state.pivotTemplates.length > 0) {
            // Shablonlar ro'yxatini kutish
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const defaultTemplate = state.pivotTemplates.find(t => t.id === parseInt(defaultTemplateId));
            
            if (defaultTemplate && state.pivotGrid) {
                try {
                    console.log('[PIVOT] 📋 Default shablon yuklanmoqda:', defaultTemplate.name);
                    
                    const res = await safeFetch(`/api/pivot/templates/${defaultTemplateId}`);
                    
                    if (res && res.ok) {
                        const report = await res.json();
                        
                        // Shablon yuklanganda Fields panelini yopib-qochirish
                        if (report.options) {
                            report.options.configuratorActive = false;
                        } else {
                            report.options = { configuratorActive: false };
                        }
                        
                        // Shablon ichida ma'lumotlar bo'lmasligi kerak
                        if (report.dataSource && report.dataSource.data) {
                            report.dataSource = { data: [] };
                        }
                        
                        // Shablon konfiguratsiyasini saqlash
                        const templateConfig = {
                            slice: report.slice,
                            options: report.options,
                            formats: report.formats
                        };
                        
                        state.pivotGrid.setReport(report);
                        
                        // Tanlangan sana bilan ma'lumotlarni yuklash
                        await updatePivotData(startDateStr, endDateStr, defaultCurrency, true, templateConfig);
                        await loadExchangeRates(startDateStr, endDateStr);
                        
                        console.log('[PIVOT] ✅ Default shablon yuklandi:', defaultTemplate.name);
                        return;
                    }
                } catch (error) {
                    console.error('[PIVOT] ❌ Default shablon yuklashda xatolik:', error);
                }
            }
        }
        
        // Agar default shablon bo'lmasa yoki yuklanmagan bo'lsa, oddiy yuklash
        await updatePivotData(startDateStr, endDateStr, defaultCurrency);
        await loadExchangeRates(startDateStr, endDateStr);
    })();

    // "Qo'llash" tugmasi bosilganda ma'lumotlarni yuklash
    const applyFiltersBtn = document.getElementById('apply-pivot-filters-btn');
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', async () => {
            const selectedDates = pivotDatePickerFP?.selectedDates || [];
            const selectedCurrency = DOM.pivotCurrencySelect?.value || 'UZS';
            
            if (selectedDates.length === 0) {
                showToast("Iltimos, sana oralig'ini tanlang!", true);
                return;
            }
            
            if (selectedDates.length === 1) {
                // Bitta sana tanlansa, boshlanish va tugash sanasi bir xil
                const singleDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                await updatePivotData(singleDate, singleDate, selectedCurrency);
                await loadExchangeRates(singleDate, singleDate);
            } else if (selectedDates.length === 2) {
                // Ikkita sana tanlansa, oraliq
                const startDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                const endDate = flatpickr.formatDate(selectedDates[1], 'Y-m-d');
                await updatePivotData(startDate, endDate, selectedCurrency);
                await loadExchangeRates(startDate, endDate);
            }
        });
    }

    // Kurslarni yangilash tugmasi
    const refreshRatesBtn = document.getElementById('refresh-rates-btn');
    if (refreshRatesBtn) {
        refreshRatesBtn.addEventListener('click', async () => {
            if (pivotDatePickerFP && pivotDatePickerFP.selectedDates.length >= 1) {
                const startDate = pivotDatePickerFP.selectedDates.length === 1 
                    ? flatpickr.formatDate(pivotDatePickerFP.selectedDates[0], 'Y-m-d')
                    : flatpickr.formatDate(pivotDatePickerFP.selectedDates[0], 'Y-m-d');
                const endDate = pivotDatePickerFP.selectedDates.length === 2
                    ? flatpickr.formatDate(pivotDatePickerFP.selectedDates[1], 'Y-m-d')
                    : startDate;
                await loadExchangeRates(startDate, endDate, true);
            }
        });
    }
}

/**
 * Загрузить и обновить данные в pivot таблице
 * @param {string} startDate - начальная дата в формате YYYY-MM-DD
 * @param {string} endDate - конечная дата в формате YYYY-MM-DD
 * @param {string} currency - tanlangan valyuta (UZS, USD, EUR, RUB, KZT)
 */
export async function updatePivotData(startDate, endDate, currency = 'UZS', preserveReportConfig = false, templateConfig = null) {
    if (!state.pivotGrid) {
        console.error('[PIVOT] ❌ state.pivotGrid topilmadi!');
        return;
    }
    
    showPivotLoader();
    
    try {
        const params = new URLSearchParams({ startDate, endDate, currency });
        const url = `/api/pivot/data?${params.toString()}`;
        
        const res = await safeFetch(url);
        
        if (!res || !res.ok) {
            console.error('[PIVOT] ❌ API so\'rovi muvaffaqiyatsiz:', {
                ok: res?.ok,
                status: res?.status,
                statusText: res?.statusText
            });
            
            // 413 Payload Too Large - ma'lumotlar hajmi juda katta
            if (res?.status === 413) {
                const errorData = await res.json().catch(() => ({}));
                const errorMessage = errorData.message || 'Ma\'lumotlar hajmi juda katta. Iltimos, sana oralig\'ini qisqartiring.';
                showToast(errorMessage, true);
                hidePivotLoader();
                throw new Error(errorMessage);
            }
            
            throw new Error('Не удалось загрузить данные для сводной таблицы');
        }
        
        const data = await res.json();
        
        // Backend'dan kelgan ma'lumotlarda "Показатель" maydoni mavjudligini tekshirish
        if (data && data.length > 0) {
            const firstItem = data[0];
            const hasPokazatel = firstItem.hasOwnProperty('Показатель') || firstItem.hasOwnProperty('Показатель');
            const pokazatelValue = firstItem['Показатель'] || firstItem['Показатель'] || null;
            console.log(`[PIVOT] 📥 Backend'dan kelgan ma'lumotlar: jami=${data.length}, "Показатель" maydoni=${hasPokazatel}, birinchi yozuvda="${pokazatelValue}"`);
            console.log(`[PIVOT] 📥 Birinchi yozuv maydonlari:`, Object.keys(firstItem));
        }
        
        // Agar ma'lumotlar bo'lmasa, barcha maydonlar bilan minimal namuna ma'lumot yaratish
        let dataToProcess = data;
        const isEmpty = !data || data.length === 0;
        
        if (isEmpty) {
            const today = new Date();
            const todayStr = flatpickr.formatDate(today, 'Y-m-d');
            dataToProcess = [{
                "ID": null,
                "Дата": todayStr,
                "День": today.getDate(),
                "Бренд": null,
                "Филиал": null,
                "Сотрудник": null,
                "Показатель": null,
                "Тип оплаты": null,
                "Сумма": 0,
                "Сумма_число": 0,
                "Комментарий": ""
            }];
        }
        
        // Ma'lumotlarni qayta ishlash va optimallashtirish
        const processedData = dataToProcess.map(item => {
            const dateStr = item["Дата"];
            let dayNumber = null;
            
            if (dateStr && typeof dateStr === 'string') {
                const dateParts = dateStr.split('-');
                if (dateParts.length === 3) {
                    dayNumber = parseInt(dateParts[2], 10);
                }
            }
            
            // Optimallashtirish: faqat kerakli maydonlarni qoldiramiz
            // Backend'da "Тип оплаты" olib tashlangan, faqat "Показатель" qoldi
            const processed = {
                "ID": item["ID"],
                "Дата": dateStr,
                "День": dayNumber,
                "Бренд": item["Бренд"],
                "Филиал": item["Филиал"],
                "Сотрудник": item["Сотрудник"],
                "Показатель": item["Показатель"] || item["Тип оплаты"] || null, // Backend'dan kelgan "Показатель" maydoni
                "Сумма": item["Сумма"],
                "Сумма_число": typeof item["Сумма"] === 'number' ? item["Сумма"] : parseFloat(item["Сумма"]) || 0
            };
            
            // Faqat bo'sh bo'lmagan comment'larni qo'shamiz
            if (item["Комментарий"] && item["Комментарий"].trim()) {
                processed["Комментарий"] = item["Комментарий"];
            }
            
            return processed;
        });
        
        // Ma'lumotlar hajmini tekshirish (WebDataRocks cheklovi)
        // Cheklovni backend'dan olish (cache qilingan)
        const maxSize = await getPivotMaxSize();
        let dataSize = new Blob([JSON.stringify(processedData)]).size;
        const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2);
        let dataSizeMB = (dataSize / (1024 * 1024)).toFixed(2);
        
        // "Показатель" maydoni mavjudligini tekshirish
        const pokazatelCount = processedData.filter(item => item["Показатель"] && String(item["Показатель"]).trim()).length;
        const uniquePokazatel = [...new Set(processedData.map(item => item["Показатель"]).filter(p => p && String(p).trim()))];
        console.log(`[PIVOT] 📊 Ma'lumotlar hajmi (optimallashtirilgandan keyin): ${dataSizeMB} MB (${processedData.length} ta yozuv)`);
        console.log(`[PIVOT] 📊 "Показатель" maydoni: mavjud=${pokazatelCount}/${processedData.length}, unique=${uniquePokazatel.length} (${uniquePokazatel.slice(0, 10).join(', ')})`);
        
        // Agar hali ham juda katta bo'lsa, sampling qilish
        let finalData = processedData;
        if (dataSize > maxSize) {
            // Ma'lumotlarni sampling qilish - maqsadli hajm 80% cheklov
            const targetSize = maxSize * 0.8;
            // Sampling rate: hozirgi hajm / maqsadli hajm
            // Masalan: 2.46 MB / 0.8 MB = 3.075, ya'ni har 3-tasini olish
            const samplingRate = Math.ceil(dataSize / targetSize);
            
            // "Показатель" maydonining unique qiymatlarini saqlab qolish uchun aqlli sampling
            // Har bir unique "Показатель" qiymatidan kamida bir nechta yozuvni saqlab qolamiz
            const uniquePokazatel = [...new Set(processedData.map(item => item["Показатель"]).filter(p => p && String(p).trim()))];
            const pokazatelGroups = {};
            
            // Har bir "Показатель" qiymatiga tegishli yozuvlarni guruhlash
            processedData.forEach((item, index) => {
                const pokazatel = item["Показатель"] || 'null';
                if (!pokazatelGroups[pokazatel]) {
                    pokazatelGroups[pokazatel] = [];
                }
                pokazatelGroups[pokazatel].push({ item, index });
            });
            
            // Har bir guruhdan sampling qilish - har bir "Показатель" qiymatidan kamida bir nechta yozuvni saqlab qolish
            const sampledData = [];
            const minRecordsPerPokazatel = Math.max(1, Math.floor(processedData.length / uniquePokazatel.length / samplingRate));
            
            Object.keys(pokazatelGroups).forEach(pokazatel => {
                const group = pokazatelGroups[pokazatel];
                // Har bir guruhdan sampling qilish
                // Har bir "Показатель" qiymatidan kamida minRecordsPerPokazatel ta yozuvni saqlab qolamiz
                const groupSamplingRate = Math.max(1, Math.ceil(group.length / Math.max(minRecordsPerPokazatel, Math.floor(group.length / samplingRate))));
                
                group.forEach((entry, groupIndex) => {
                    if (groupIndex % groupSamplingRate === 0 || group.length <= minRecordsPerPokazatel) {
                        // Agar guruh juda kichik bo'lsa, barcha yozuvlarni saqlab qolamiz
                        sampledData.push(entry);
                    }
                });
            });
            
            // Index bo'yicha tartiblash
            sampledData.sort((a, b) => a.index - b.index);
            finalData = sampledData.map(entry => entry.item);
            
            // Qayta hisoblash
            dataSize = new Blob([JSON.stringify(finalData)]).size;
            dataSizeMB = (dataSize / (1024 * 1024)).toFixed(2);
            
            // "Показатель" maydoni mavjudligini tekshirish (sampling qilingandan keyin)
            const pokazatelCountAfter = finalData.filter(item => item["Показатель"] && String(item["Показатель"]).trim()).length;
            const uniquePokazatelAfter = [...new Set(finalData.map(item => item["Показатель"]).filter(p => p && String(p).trim()))];
            
            console.warn(`[PIVOT] ⚠️ Ma'lumotlar sampling qilindi: ${processedData.length} -> ${finalData.length} ta yozuv (sampling rate: ${samplingRate}), hajm: ${dataSizeMB} MB`);
            console.log(`[PIVOT] 📊 Sampling qilingandan keyin "Показатель": mavjud=${pokazatelCountAfter}/${finalData.length}, unique=${uniquePokazatelAfter.length}/${uniquePokazatel.length} (${uniquePokazatelAfter.slice(0, 10).join(', ')})`);
            
            // Agar hali ham juda katta bo'lsa, xatolik qaytarish
            if (dataSize > maxSize) {
                const errorMessage = `Ma'lumotlar hajmi juda katta (${dataSizeMB} MB). WebDataRocks maksimal ${maxSizeMB} MB ma'lumotlarni qabul qiladi. Iltimos, sana oralig'ini qisqartiring yoki filial/brend bo'yicha filtrlash qo'llang.`;
                console.error('[PIVOT] ❌ Ma\'lumotlar hajmi cheklovdan oshib ketdi:', {
                    dataSize: dataSize,
                    maxSize: maxSize,
                    dataSizeMB: dataSizeMB,
                    recordCount: finalData.length,
                    originalRecordCount: processedData.length,
                    samplingApplied: true
                });
                showToast(errorMessage, true);
                hidePivotLoader();
                throw new Error(errorMessage);
            } else {
                // Sampling qilinganligi haqida xabar berish
                const percentage = ((finalData.length / processedData.length) * 100).toFixed(1);
                showToast(`Ma'lumotlar hajmi katta bo'lgani uchun ${processedData.length} ta yozuvdan ${finalData.length} tasi (${percentage}%) ko'rsatilmoqda. To'liq ma'lumotlar uchun sana oralig'ini qisqartiring.`, 'warning');
            }
        }
        
        // Final ma'lumotlarni WebDataRocks'ga yuklash
        let dataToLoad = finalData;
        
        // WebDataRocks'ga yuklashdan oldin ma'lumotlar hajmini yakuniy tekshirish
        // WebDataRocks'ning ichki cheklovi 1 MB, shuning uchun qo'shimcha tekshirish
        let finalDataSize = new Blob([JSON.stringify(dataToLoad)]).size;
        const webDataRocksMaxSize = 1024 * 1024; // 1 MB - WebDataRocks'ning ichki cheklovi
        let finalDataSizeMB = (finalDataSize / (1024 * 1024)).toFixed(2);
        
        // Agar hali ham 1 MB dan oshib ketgan bo'lsa, qo'shimcha sampling qilish
        if (finalDataSize > webDataRocksMaxSize) {
            console.warn(`[PIVOT] ⚠️ Ma'lumotlar hali ham juda katta (${finalDataSizeMB} MB), qo'shimcha sampling qilinmoqda...`);
            
            // Qo'shimcha sampling - maqsadli hajm 0.9 MB (90% WebDataRocks cheklovi)
            const additionalTargetSize = webDataRocksMaxSize * 0.9;
            const additionalSamplingRate = Math.ceil(finalDataSize / additionalTargetSize);
            
            // "Показатель" maydonini saqlab qolish uchun aqlli sampling
            const uniquePokazatelFinal = [...new Set(dataToLoad.map(item => item["Показатель"]).filter(p => p && String(p).trim()))];
            const pokazatelGroupsFinal = {};
            
            dataToLoad.forEach((item, index) => {
                const pokazatel = item["Показатель"] || 'null';
                if (!pokazatelGroupsFinal[pokazatel]) {
                    pokazatelGroupsFinal[pokazatel] = [];
                }
                pokazatelGroupsFinal[pokazatel].push({ item, index });
            });
            
            const additionalSampledData = [];
            const minRecordsPerPokazatelFinal = Math.max(1, Math.floor(dataToLoad.length / uniquePokazatelFinal.length / additionalSamplingRate));
            
            Object.keys(pokazatelGroupsFinal).forEach(pokazatel => {
                const group = pokazatelGroupsFinal[pokazatel];
                const groupSamplingRate = Math.max(1, Math.ceil(group.length / Math.max(minRecordsPerPokazatelFinal, Math.floor(group.length / additionalSamplingRate))));
                
                group.forEach((entry, groupIndex) => {
                    if (groupIndex % groupSamplingRate === 0 || group.length <= minRecordsPerPokazatelFinal) {
                        additionalSampledData.push(entry);
                    }
                });
            });
            
            additionalSampledData.sort((a, b) => a.index - b.index);
            dataToLoad = additionalSampledData.map(entry => entry.item);
            
            // Qayta hisoblash
            finalDataSize = new Blob([JSON.stringify(dataToLoad)]).size;
            finalDataSizeMB = (finalDataSize / (1024 * 1024)).toFixed(2);
            
            console.warn(`[PIVOT] ⚠️ Qo'shimcha sampling qilindi: ${finalData.length} -> ${dataToLoad.length} ta yozuv, hajm: ${finalDataSizeMB} MB`);
            
            // Agar hali ham juda katta bo'lsa, xatolik
            if (finalDataSize > webDataRocksMaxSize) {
                const errorMessage = `Ma'lumotlar hajmi juda katta (${finalDataSizeMB} MB). WebDataRocks maksimal 1 MB ma'lumotlarni qabul qiladi. Iltimos, sana oralig'ini qisqartiring yoki filial/brend bo'yicha filtrlash qo'llang.`;
                console.error('[PIVOT] ❌ Ma\'lumotlar hajmi WebDataRocks cheklovidan oshib ketdi:', {
                    dataSize: finalDataSize,
                    maxSize: webDataRocksMaxSize,
                    dataSizeMB: finalDataSizeMB,
                    recordCount: dataToLoad.length
                });
                showToast(errorMessage, true);
                hidePivotLoader();
                throw new Error(errorMessage);
            }
        }
        
        // "Показатель" maydoni mavjudligini yakuniy tekshirish
        const pokazatelInFinal = dataToLoad.filter(item => item["Показатель"] && String(item["Показатель"]).trim()).length;
        const uniquePokazatelFinal = [...new Set(dataToLoad.map(item => item["Показатель"]).filter(p => p && String(p).trim()))];
        console.log(`[PIVOT] ✅ WebDataRocks'ga yuklashdan oldin: jami=${dataToLoad.length}, hajm=${finalDataSizeMB} MB, "Показатель" mavjud=${pokazatelInFinal}, unique=${uniquePokazatelFinal.length} (${uniquePokazatelFinal.slice(0, 10).join(', ')})`);
        
        // Agar "Показатель" maydoni yo'q bo'lsa, xatolik
        if (pokazatelInFinal === 0 && dataToLoad.length > 0) {
            console.error('[PIVOT] ❌ "Показатель" maydoni topilmadi! Ma\'lumotlar:', dataToLoad.slice(0, 3));
        }
        
        // Agar preserveReportConfig true bo'lsa, hozirgi report konfiguratsiyasini saqlaymiz
        if (preserveReportConfig) {
            // Agar templateConfig uzatilgan bo'lsa, uni ishlatamiz
            // Aks holda getReport() dan olamiz
            let currentReport;
            if (templateConfig) {
                
                // Template konfiguratsiyasidan to'liq report yaratamiz
                currentReport = {
                    slice: templateConfig.slice ? JSON.parse(JSON.stringify(templateConfig.slice)) : null,
                    options: templateConfig.options ? JSON.parse(JSON.stringify(templateConfig.options)) : null,
                    formats: templateConfig.formats ? JSON.parse(JSON.stringify(templateConfig.formats)) : null,
                    dataSource: { data: [] } // Ma'lumotlar keyinroq qo'shiladi
                };
            } else {
                // Agar templateConfig yo'q bo'lsa, getReport() dan olamiz
                currentReport = state.pivotGrid.getReport();
            }
            
            if (!currentReport) {
                console.error('[PIVOT] ❌ Hozirgi report topilmadi!');
                throw new Error('Hozirgi report konfiguratsiyasi topilmadi');
            }
            
            // Agar slice yo'q bo'lsa va templateConfig mavjud bo'lsa, uni ishlatamiz
            if (!currentReport.slice && templateConfig?.slice) {
                currentReport.slice = JSON.parse(JSON.stringify(templateConfig.slice));
            }
            
            // Agar formats yo'q bo'lsa va templateConfig mavjud bo'lsa, uni ishlatamiz
            if (!currentReport.formats && templateConfig?.formats) {
                currentReport.formats = JSON.parse(JSON.stringify(templateConfig.formats));
            }
            
            // Agar options yo'q bo'lsa va templateConfig mavjud bo'lsa, uni ishlatamiz
            if (!currentReport.options && templateConfig?.options) {
                currentReport.options = JSON.parse(JSON.stringify(templateConfig.options));
            }
            
            // Faqat dataSource.data ni yangilaymiz
            currentReport.dataSource = {
                ...currentReport.dataSource,
                data: dataToLoad
            };
            
            // Valyuta formatini yangilash
            const currencySymbols = {
                'UZS': 'so\'m',
                'USD': '$',
                'EUR': '€',
                'RUB': '₽',
                'KZT': '₸'
            };
            const currencySymbol = currencySymbols[currency] || 'so\'m';
            const currencyFormat = currency === 'UZS' ? ' сум' : ` ${currencySymbol}`;
            
            // Formats ni yangilash (valyuta belgisi)
            if (currentReport.formats && Array.isArray(currentReport.formats)) {
                const currencyFormatObj = currentReport.formats.find(f => f.name === 'currency');
                if (currencyFormatObj) {
                    currencyFormatObj.currencySymbol = currencyFormat;
                    currencyFormatObj.currencySymbolAlign = currency === 'UZS' ? "right" : "left";
                }
            }
            
            // Options title ni yangilash
            if (currentReport.options) {
                if (!currentReport.options.grid) {
                    currentReport.options.grid = {};
                }
                currentReport.options.grid.title = `Сводная таблица (${currency})`;
            }
            
            // ConfiguratorActive ni yopiq qilish
            if (currentReport.options) {
                currentReport.options.configuratorActive = false;
            }
            
            console.log('[PIVOT] �� setReport() chaqirilmoqda (konfiguratsiya saqlanadi)...');
            console.log('[PIVOT] 📊 Final report konfiguratsiyasi:', {
                hasSlice: !!currentReport.slice,
                sliceRows: currentReport.slice?.rows?.length || 0,
                sliceColumns: currentReport.slice?.columns?.length || 0,
                sliceMeasures: currentReport.slice?.measures?.length || 0,
                hasOptions: !!currentReport.options,
                hasFormats: !!currentReport.formats,
                dataLength: currentReport.dataSource?.data?.length || 0
            });
            
            state.pivotGrid.setReport(currentReport);
            console.log('[PIVOT] ✅ setReport() muvaffaqiyatli chaqirildi (konfiguratsiya saqlanadi)');
            
            setTimeout(() => {
                hidePivotLoader();
                console.log('[PIVOT] ✅ updatePivotData() muvaffaqiyatli yakunlandi (konfiguratsiya saqlanadi)');
            }, 500);
            
            return;
        }
        
        // Eski logika (preserveReportConfig false yoki undefined bo'lganda)
        // Valyuta belgisi va formatini aniqlash
        const currencySymbols = {
            'UZS': 'so\'m',
            'USD': '$',
            'EUR': '€',
            'RUB': '₽',
            'KZT': '₸'
        };
        const currencySymbol = currencySymbols[currency] || 'so\'m';
        const currencyFormat = currency === 'UZS' ? ' сум' : ` ${currencySymbol}`;
        
        // Report konfiguratsiyasi
        const hasRealData = data && data.length > 0;
        
        // Hozirgi report konfiguratsiyasini saqlash (shablon yuklanganda yoki foydalanuvchi o'zgartirganda)
        const currentReport = state.pivotGrid.getReport();
        const currentSlice = currentReport?.slice;
        
        // Agar hozirgi slice mavjud bo'lsa va ma'lumotlar bo'lsa, uni ishlatamiz
        // Aks holda default slice yoki bo'sh slice ishlatamiz
        const defaultSlice = hasRealData ? {
            rows: [
                { uniqueName: "Бренд" },
                { uniqueName: "Филиал" }
            ],
            columns: [
                { uniqueName: "День" },
                { uniqueName: "Тип оплаты" }
            ],
            measures: [
                { 
                    uniqueName: "Сумма",
                    aggregation: "sum",
                    format: "currency",
                    caption: "Сумма"
                },
                {
                    uniqueName: "Сумма_число",
                    aggregation: "sum",
                    format: "number",
                    caption: "Сумма (число)"
                }
            ],
            reportFilters: [
                { uniqueName: "Показатель" },
                { uniqueName: "Сотрудник" },
                { uniqueName: "Дата" }
            ]
        } : {
            rows: [],
            columns: [],
            measures: [],
            reportFilters: []
        };
        
        // Hozirgi slice mavjud bo'lsa va to'g'ri strukturada bo'lsa, uni ishlatamiz
        const finalSlice = (currentSlice && 
                           (currentSlice.rows?.length > 0 || 
                            currentSlice.columns?.length > 0 || 
                            currentSlice.measures?.length > 0 || 
                            currentSlice.reportFilters?.length > 0)) 
                           ? currentSlice 
                           : defaultSlice;
        
        const pivotReport = {
            dataSource: { 
                data: dataToLoad 
            },
            slice: finalSlice,
            options: {
                grid: {
                    title: `Сводная таблица (${currency})`,
                    showHeaders: true,
                    showTotals: "on",
                    showGrandTotals: "on",
                    type: "compact"
                },
                configuratorActive: false,
                datePattern: "dd.MM.yyyy"
            },
            formats: [
                {
                    name: "currency",
                    thousandsSeparator: " ",
                    decimalPlaces: 0,
                    currencySymbol: currencyFormat,
                    currencySymbolAlign: currency === 'UZS' ? "right" : "left",
                    nullValue: "0"
                },
                {
                    name: "number",
                    thousandsSeparator: " ",
                    decimalPlaces: 0,
                    nullValue: "-"
                },
                {
                    name: "day",
                    thousandsSeparator: "",
                    decimalPlaces: 0,
                    nullValue: "-"
                }
            ]
        };
        
        // Обновляем отчет полностью
        state.pivotGrid.setReport(pivotReport);
        
        setTimeout(() => {
            hidePivotLoader();
        }, 500);
        
    } catch (error) {
        console.error('[PIVOT] ❌ updatePivotData() xatolik:', error);
        console.error('[PIVOT] ❌ Xatolik tafsilotlari:', {
            message: error.message,
            stack: error.stack,
            startDate,
            endDate,
            currency
        });
        showToast(error.message, true);
        hidePivotLoader();
        
        // ... existing error handling code ...
    }
}

/**
 * Отобразить список сохраненных шаблонов в виде тегов
 */
export async function renderTemplatesAsTags() {
    if (!DOM.templatesTagList) {
        console.error('[PIVOT] ❌ DOM.templatesTagList topilmadi!');
        return;
    }
    
    try {
        const res = await safeFetch('/api/pivot/templates');
        
        if (!res || !res.ok) {
            const errorText = await res.text().catch(() => 'Noma\'lum xatolik');
            console.error('[PIVOT] ❌ API so\'rovi muvaffaqiyatsiz:', {
                status: res?.status,
                statusText: res?.statusText,
                errorText
            });
            throw new Error('Не удалось загрузить шаблоны');
        }
        
        const templates = await res.json();
        state.pivotTemplates = templates;
        
        if (state.pivotTemplates.length === 0) {
            DOM.templatesTagList.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px; text-align: center; color: var(--text-secondary);">
                    <i data-feather="bookmark" style="width: 48px; height: 48px; margin-bottom: 15px; opacity: 0.5;"></i>
                    <p style="margin: 0; font-size: 14px;">Сохранённых шаблонов пока нет</p>
                    <small style="margin-top: 5px; opacity: 0.7;">Создайте первый шаблон, настроив таблицу и нажав кнопку "Сохранить"</small>
                </div>
            `;
            if (typeof feather !== 'undefined') feather.replace();
            return;
        }
        
        // Генерируем HTML для каждого шаблона
        const html = state.pivotTemplates.map(template => {
            const canModify = state.currentUser.role === 'admin' || state.currentUser.id === template.created_by;
            const isPublic = template.is_public;
            const publicClass = isPublic ? 'template-tag-public' : '';
            const publicBadge = isPublic ? `<span class="public-badge" title="Публичный шаблон"><i class="fas fa-globe"></i></span>` : '';
            
            const actionsHtml = canModify ? `
                <div class="tag-actions">
                    <button class="btn-icon edit-template-btn" 
                            data-id="${template.id}" 
                            data-name="${template.name}" 
                            data-is-public="${isPublic}"
                            title="Изменить название шаблона">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit-2">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                        </svg>
                    </button>
                    <button class="btn-icon delete-template-btn" 
                            data-id="${template.id}" 
                            title="Удалить шаблон">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-trash-2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </div>
            ` : '';
            
            return `
                <div class="template-tag ${publicClass}" data-id="${template.id}" title="Загрузить этот шаблон">
                    ${publicBadge}
                    <span class="tag-name">${template.name}</span>
                    ${actionsHtml}
                </div>`;
        }).join('');
        
        DOM.templatesTagList.innerHTML = html;
        
        // Обновляем иконки Feather - endi kerak emas, chunki to'g'ridan-to'g'ri SVG ishlatamiz
        // Lekin boshqa joylarda feather iconlar bo'lishi mumkin, shuning uchun qoldiramiz
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        
    } catch (error) {
        console.error('[PIVOT] ❌ renderTemplatesAsTags() xatolik:', error);
        console.error('[PIVOT] ❌ Xatolik tafsilotlari:', {
            message: error.message,
            stack: error.stack
        });
        showToast(error.message, true);
    }
}

/**
 * Сохранить текущую конфигурацию pivot таблицы как шаблон
 */
export async function savePivotTemplate() {
    const name = DOM.templateNameInput.value.trim();
    
    if (!name) {
        showToast("Пожалуйста, введите название шаблона!", true);
        return;
    }
    
    if (!state.pivotGrid) {
        showToast("Сводная таблица не найдена!", true);
        return;
    }
    
    // Получаем текущий отчет (конфигурацию)
    const fullReport = state.pivotGrid.getReport();
    
    // Faqat konfiguratsiyani saqlash - ma'lumotlar va sana saqlanmaydi
    // Shablon faqat Fields panelidagi tartibni saqlaydi
    const templateReport = {
        slice: fullReport.slice || {
            rows: [],
            columns: [],
            measures: [],
            reportFilters: []
        },
        options: fullReport.options || {
            grid: {
                title: "Сводная таблица отчетов",
                showHeaders: true,
                showTotals: "on",
                showGrandTotals: "on",
                type: "compact"
            },
            configuratorActive: false,
            datePattern: "dd.MM.yyyy"
        },
        formats: fullReport.formats || []
    };
    
    // Admin uchun public flag
    const isPublic = DOM.templateIsPublicCheckbox && DOM.templateIsPublicCheckbox.checked;
    
    try {
        const res = await safeFetch('/api/pivot/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, report: templateReport, isPublic })
        });
        
        if (!res || !res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || 'Ошибка сохранения шаблона');
        }
        
        const savedTemplate = await res.json();
        
        showToast("Шаблон успешно сохранен!");
        DOM.saveTemplateModal.classList.add('hidden');
        DOM.templateNameInput.value = '';
        if (DOM.templateIsPublicCheckbox) {
            DOM.templateIsPublicCheckbox.checked = false;
        }
        
        // Обновляем список шаблонов
        await renderTemplatesAsTags();
        
        // Agar bu birinchi shablon bo'lsa yoki default shablon bo'lmasa, uni default shablon sifatida saqlash
        const defaultTemplateKey = 'pivot_default_template_id';
        const currentDefaultTemplateId = localStorage.getItem(defaultTemplateKey);
        
        if (!currentDefaultTemplateId || state.pivotTemplates.length === 1) {
            localStorage.setItem(defaultTemplateKey, savedTemplate.templateId.toString());
            console.log('[PIVOT] ✅ Default shablon o\'rnatildi:', savedTemplate.templateId);
        }
        
    } catch (error) {
        showToast(error.message, true);
    }
}

/**
 * Отрисовка списка шаблонов в модальном окне "Открыть"
 */
export async function renderTemplatesList() {
    if (!DOM.templatesListContainer) {
        return;
    }
    
    try {
        const res = await safeFetch('/api/pivot/templates');
        
        if (!res || !res.ok) {
            throw new Error('Не удалось загрузить шаблоны');
        }
        
        state.pivotTemplates = await res.json();
        
        if (state.pivotTemplates.length === 0) {
            DOM.templatesListContainer.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 30px; text-align: center; color: var(--text-secondary);">
                    <div style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%); display: flex; align-items: center; justify-content: center; margin-bottom: 20px; border: 2px solid rgba(102, 126, 234, 0.2);">
                        <i class="fas fa-bookmark" style="font-size: 36px; color: #667eea; opacity: 0.6;"></i>
                    </div>
                    <p style="margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary);">Сохранённых шаблонов пока нет</p>
                    <small style="margin-top: 10px; opacity: 0.7; font-size: 13px; line-height: 1.5;">Создайте первый шаблон, настроив таблицу<br>и нажав кнопку "Сохранить" в панели инструментов</small>
                </div>
            `;
            return;
        }
        
        // Генерируем HTML для каждого шаблона в виде списка
        DOM.templatesListContainer.innerHTML = state.pivotTemplates.map(template => {
            const canDelete = state.currentUser.role === 'admin' || state.currentUser.id === template.created_by;
            const isPublic = template.is_public;
            const publicClass = isPublic ? 'template-list-item-public' : '';
            const publicBadge = isPublic ? `<span class="public-badge-small" title="Публичный шаблон"><i class="fas fa-globe"></i> Публичный</span>` : '';
            
            const deleteButtonHtml = canDelete ? `
                <button class="btn-icon delete-template-modal-btn" 
                        data-id="${template.id}" 
                        title="Удалить шаблон">
                    <i class="fas fa-trash-alt"></i>
                </button>
            ` : '';
            
            return `
                <div class="template-list-item ${publicClass}" data-id="${template.id}">
                    <div class="template-info">
                        <i class="fas ${isPublic ? 'fa-globe' : 'fa-file-alt'}"></i>
                        <div style="display: flex; flex-direction: column; gap: 4px; flex: 1;">
                            <span class="template-list-name">${template.name}</span>
                            ${publicBadge}
                        </div>
                    </div>
                    ${deleteButtonHtml}
                </div>`;
        }).join('');
        
    } catch (error) {
        showToast(error.message, true);
    }
}

/**
 * Обработка действий с шаблонами в модальном окне (загрузка, удаление)
 * @param {Event} e - событие клика
 */
export async function handleTemplateModalActions(e) {
    const listItem = e.target.closest('.template-list-item');
    
    if (!listItem) {
        return;
    }
    
    const deleteButton = e.target.closest('.delete-template-modal-btn');
    const templateId = listItem.dataset.id;

    if (deleteButton) {
        // Предотвращаем загрузку шаблона при клике на кнопку удаления
        e.stopPropagation();
        
        const confirmed = await showConfirmDialog({
            title: 'Удаление шаблона',
            message: 'Вы действительно хотите удалить этот шаблон?',
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            type: 'danger',
            icon: 'trash-2'
        });
        
        if (confirmed) {
            try {
                const res = await safeFetch(`/api/pivot/templates/${templateId}`, { 
                    method: 'DELETE' 
                });
                
                if (!res || !res.ok) {
                    const errorData = await res.json();
                    console.error('[PIVOT] ❌ Shablonni o\'chirishda xatolik (modal):', errorData);
                    throw new Error(errorData.message || 'Ошибка удаления шаблона');
                }
                
                showToast("Шаблон успешно удален.");
                
                // Обновляем оба списка
                renderTemplatesList();
                renderTemplatesAsTags();
                
            } catch (error) {
                console.error('[PIVOT] ❌ Delete xatolik (modal):', error);
                showToast(error.message, true);
            }
        }
    } else {
        // Загрузка шаблона (клик по элементу списка)
        if (!state.pivotGrid) {
            console.error('[PIVOT] ❌ state.pivotGrid topilmadi!');
            showToast('Сводная таблица не инициализирована', true);
            return;
        }
        
        try {
            const res = await safeFetch(`/api/pivot/templates/${templateId}`);
            
            if (!res || !res.ok) {
                const errorData = await res.json().catch(() => ({ message: 'Noma\'lum xatolik' }));
                console.error('[PIVOT] ❌ API so\'rovi muvaffaqiyatsiz (modal):', errorData);
                throw new Error(errorData.message || 'Ошибка загрузки шаблона');
            }
            
            const report = await res.json();
            
            // Shablon yuklanganda Fields panelini yopib-qochirish
            if (report.options) {
                report.options.configuratorActive = false;  // Yopiq
            } else {
                report.options = { configuratorActive: false };
            }
            
            // Shablon ichida ma'lumotlar bo'lmasligi kerak - har safar kalendardagi sana bilan yuklanadi
            // Agar shablon ichida ma'lumotlar bo'lsa, ularni olib tashlaymiz
            if (report.dataSource && report.dataSource.data) {
                report.dataSource = { data: [] };  // Bo'sh ma'lumotlar
            }
            
            // Shablon konfiguratsiyasini saqlash
            const templateConfig = {
                slice: report.slice,
                options: report.options,
                formats: report.formats
            };
            
            state.pivotGrid.setReport(report);
            
            // Tanlangan kalendar kuni bilan ma'lumotlarni yuklash
            const selectedDates = pivotDatePickerFP?.selectedDates || [];
            const selectedCurrency = DOM.pivotCurrencySelect?.value || 'UZS';
            
            if (selectedDates.length === 1) {
                const singleDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                await updatePivotData(singleDate, singleDate, selectedCurrency, true, templateConfig);
                await loadExchangeRates(singleDate, singleDate);
            } else if (selectedDates.length === 2) {
                const startDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                const endDate = flatpickr.formatDate(selectedDates[1], 'Y-m-d');
                await updatePivotData(startDate, endDate, selectedCurrency, true, templateConfig);
                await loadExchangeRates(startDate, endDate);
            } else {
                const defaultStartDate = flatpickr.formatDate(new Date(new Date().setDate(new Date().getDate() - 29)), 'Y-m-d');
                const defaultEndDate = flatpickr.formatDate(new Date(), 'Y-m-d');
                await updatePivotData(defaultStartDate, defaultEndDate, selectedCurrency, true, templateConfig);
                await loadExchangeRates(defaultStartDate, defaultEndDate);
            }
            
            const templateName = listItem.querySelector('.template-list-name')?.textContent || 'Noma\'lum';
            showToast(`Шаблон "${templateName}" загружен.`);
            
            // Templates panelini yig'ish
            const templatesPanel = document.getElementById('templates-panel');
            if (templatesPanel) {
                templatesPanel.classList.add('collapsed');
            }
            
            // Закрываем модальное окно
            DOM.loadTemplateModal.classList.add('hidden');
            
        } catch (error) {
            console.error('[PIVOT] ❌ Shablon yuklashda xatolik (modal):', error);
            console.error('[PIVOT] ❌ Xatolik tafsilotlari (modal):', {
                message: error.message,
                stack: error.stack,
                templateId: templateId
            });
            showToast(error.message, true);
        }
    }
}

/**
 * Обработка действий с шаблонами (загрузка, редактирование, удаление)
 * @param {Event} e - событие клика
 */
export async function handleTemplateActions(e) {
    const tag = e.target.closest('.template-tag');
    
    if (!tag) {
        return;
    }
    
    const button = e.target.closest('button');
    const templateId = tag.dataset.id;
    
    if (button) {
        // Предотвращаем загрузку шаблона при клике на кнопки действий
        e.stopPropagation();
        
        // Изменение названия шаблона
        if (button.classList.contains('edit-template-btn')) {
            const currentName = button.dataset.name;
            const newName = prompt("Введите новое название для шаблона:", currentName);
            
            if (newName && newName.trim() && newName.trim() !== currentName) {
                try {
                    const res = await safeFetch(`/api/pivot/templates/${templateId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newName.trim() })
                    });
                    
                    if (!res || !res.ok) {
                        const errorData = await res.json();
                        console.error('[PIVOT] ❌ Shablon nomini yangilashda xatolik:', errorData);
                        throw new Error(errorData.message || 'Ошибка обновления шаблона');
                    }
                    
                    showToast("Название шаблона успешно изменено.");
                    renderTemplatesAsTags();
                    
                } catch (error) {
                    console.error('[PIVOT] ❌ Edit xatolik:', error);
                    showToast(error.message, true);
                }
            }
        } 
        // Удаление шаблона
        else if (button.classList.contains('delete-template-btn')) {
            const confirmed = await showConfirmDialog({
                title: 'Удаление шаблона',
                message: 'Вы действительно хотите удалить этот шаблон?',
                confirmText: 'Удалить',
                cancelText: 'Отмена',
                type: 'danger',
                icon: 'trash-2'
            });
            
            if (confirmed) {
                try {
                    const res = await safeFetch(`/api/pivot/templates/${templateId}`, { 
                        method: 'DELETE' 
                    });
                    
                    if (!res || !res.ok) {
                        const errorData = await res.json();
                        console.error('[PIVOT] ❌ Shablonni o\'chirishda xatolik:', errorData);
                        throw new Error(errorData.message || 'Ошибка удаления шаблона');
                    }
                    
                    showToast("Шаблон успешно удален.");
                    renderTemplatesAsTags();
                    
                } catch (error) {
                    console.error('[PIVOT] ❌ Delete xatolik:', error);
                    showToast(error.message, true);
                }
            }
        }
    } else {
        // Загрузка шаблона (клик по самому тегу)
        if (!state.pivotGrid) {
            console.error('[PIVOT] ❌ state.pivotGrid topilmadi!');
            showToast('Сводная таблица не инициализирована', true);
            return;
        }
        
        if (typeof state.pivotGrid.setReport !== 'function') {
            console.error('[PIVOT] ❌ state.pivotGrid.setReport funksiya emas!');
            console.error('[PIVOT] ❌ state.pivotGrid:', state.pivotGrid);
            showToast('Сводная таблица не инициализирована правильно', true);
            return;
        }
        
        try {
            const res = await safeFetch(`/api/pivot/templates/${templateId}`);
            
            if (!res || !res.ok) {
                const errorData = await res.json().catch(() => ({ message: 'Noma\'lum xatolik' }));
                console.error('[PIVOT] ❌ API so\'rovi muvaffaqiyatsiz:', errorData);
                throw new Error(errorData.message || 'Ошибка загрузки шаблона');
            }
            
            const report = await res.json();
            
            try {
                // Shablon yuklanganda Fields panelini yopib-qochirish
                if (report.options) {
                    report.options.configuratorActive = false;  // Yopiq
                } else {
                    report.options = { configuratorActive: false };
                }
                
                // Shablon ichida ma'lumotlar bo'lmasligi kerak - har safar kalendardagi sana bilan yuklanadi
                // Agar shablon ichida ma'lumotlar bo'lsa, ularni olib tashlaymiz
                if (report.dataSource && report.dataSource.data) {
                    report.dataSource = { data: [] };  // Bo'sh ma'lumotlar
                }
                
                // Shablon konfiguratsiyasini saqlash
                const templateConfig = {
                    slice: report.slice,
                    options: report.options,
                    formats: report.formats
                };
                
                state.pivotGrid.setReport(report);
                
                // Tanlangan kalendar kuni bilan ma'lumotlarni yuklash
                const selectedDates = pivotDatePickerFP?.selectedDates || [];
                const selectedCurrency = DOM.pivotCurrencySelect?.value || 'UZS';
                
                if (selectedDates.length === 1) {
                    const singleDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                    await updatePivotData(singleDate, singleDate, selectedCurrency, true, templateConfig);
                    await loadExchangeRates(singleDate, singleDate);
                } else if (selectedDates.length === 2) {
                    const startDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                    const endDate = flatpickr.formatDate(selectedDates[1], 'Y-m-d');
                    await updatePivotData(startDate, endDate, selectedCurrency, true, templateConfig);
                    await loadExchangeRates(startDate, endDate);
                } else {
                    const defaultStartDate = flatpickr.formatDate(new Date(new Date().setDate(new Date().getDate() - 29)), 'Y-m-d');
                    const defaultEndDate = flatpickr.formatDate(new Date(), 'Y-m-d');
                    await updatePivotData(defaultStartDate, defaultEndDate, selectedCurrency, true, templateConfig);
                    await loadExchangeRates(defaultStartDate, defaultEndDate);
                }
            } catch (setReportError) {
                console.error('[PIVOT] ❌ setReport() chaqirishda xatolik:', setReportError);
                console.error('[PIVOT] ❌ setReport() xatolik tafsilotlari:', {
                    message: setReportError.message,
                    stack: setReportError.stack,
                    report: report
                });
                throw setReportError;
            }
            
            const templateName = tag.querySelector('.tag-name')?.textContent || 'Noma\'lum';
            showToast(`Шаблон "${templateName}" загружен.`);
            
            // Templates panelini yig'ish
            const templatesPanel = document.getElementById('templates-panel');
            if (templatesPanel) {
                templatesPanel.classList.add('collapsed');
            }
            
        } catch (error) {
            console.error('[PIVOT] ❌ Shablon yuklashda xatolik:', error);
            console.error('[PIVOT] ❌ Xatolik tafsilotlari:', {
                message: error.message,
                stack: error.stack,
                templateId: templateId
            });
            showToast(error.message, true);
        }
    }
}

/**
 * Kurslarni yuklash va ko'rsatish
 * @param {string} startDate - boshlanish sanasi
 * @param {string} endDate - tugash sanasi
 * @param {boolean} forceRefresh - majburiy yangilash
 */
export async function loadExchangeRates(startDate, endDate, forceRefresh = false) {
    const ratesContainer = document.getElementById('pivot-exchange-rates');
    const ratesList = document.getElementById('exchange-rates-list');
    const lastUpdated = document.getElementById('rates-last-updated');
    const refreshBtn = document.getElementById('refresh-rates-btn');
    
    if (!ratesContainer || !ratesList) return;
    
    try {
        // Loading holatini ko'rsatish
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="fas fa-spinner"></i>';
            refreshBtn.classList.add('refreshing');
        }
        
        // Status dot animatsiyasi
        const statusDot = document.querySelector('.status-dot');
        if (statusDot) {
            statusDot.style.animation = 'none';
            setTimeout(() => {
                statusDot.style.animation = 'blink 2s ease-in-out infinite';
            }, 10);
        }
        
        const params = new URLSearchParams({ startDate, endDate });
        if (forceRefresh) {
            params.append('refresh', 'true');
        }
        
        const res = await safeFetch(`/api/pivot/used-currencies?${params.toString()}`);
        
        if (!res || !res.ok) {
            throw new Error('Kurslarni olishda xatolik');
        }
        
        const data = await res.json();
        
        if (!data.currencies || data.currencies.length === 0) {
            ratesContainer.style.display = 'none';
            return;
        }
        
        // Kurslar ro'yxatini ko'rsatish
        ratesList.innerHTML = '';
        
        // Container'ga loading class qo'shish
        if (ratesContainer) {
            ratesContainer.classList.add('loading');
        }
        
        // Animatsiya delay uchun
        data.currencies.forEach((rate, index) => {
            setTimeout(() => {
                const rateCard = document.createElement('div');
                rateCard.className = 'exchange-rate-card';
                rateCard.setAttribute('data-currency', rate.currency);
                
                // Formatlash - raqamlarni chiroyli ko'rsatish
                const formattedRate = Math.round(rate.rate).toLocaleString('ru-RU');
                
                rateCard.innerHTML = `
                    <div class="rate-card-header">
                        <span class="rate-card-symbol">${rate.symbol}</span>
                        <span class="rate-card-currency">${rate.currency}</span>
                    </div>
                    <div class="rate-card-value">
                        <strong>1 ${rate.currency}</strong> = ${formattedRate} so'm
                    </div>
                `;
                
                // Click event - kursni tanlash va ripple effekti
                rateCard.addEventListener('click', (e) => {
                    // Ripple effekti
                    const ripple = document.createElement('span');
                    ripple.className = 'ripple';
                    const rect = rateCard.getBoundingClientRect();
                    const size = Math.max(rect.width, rect.height);
                    const x = e.clientX - rect.left - size / 2;
                    const y = e.clientY - rect.top - size / 2;
                    ripple.style.width = ripple.style.height = size + 'px';
                    ripple.style.left = x + 'px';
                    ripple.style.top = y + 'px';
                    rateCard.appendChild(ripple);
                    
                    setTimeout(() => {
                        ripple.remove();
                    }, 600);
                    
                    // Animatsiya effekti
                    rateCard.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        rateCard.style.transform = '';
                    }, 150);
                    
                    // Kursni clipboard'ga nusxalash
                    const textToCopy = `1 ${rate.currency} = ${formattedRate} so'm`;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(textToCopy).then(() => {
                            showToast(`✅ Kurs nusxalandi: ${textToCopy}`, false);
                        }).catch(() => {
                            // Clipboard xatolik bo'lsa, hech narsa qilmaymiz
                        });
                    }
                });
                
                // Hover effektlari CSS orqali boshqariladi
                ratesList.appendChild(rateCard);
                
                // Animatsiya
                rateCard.style.opacity = '0';
                rateCard.style.transform = 'translateY(20px)';
                setTimeout(() => {
                    rateCard.style.transition = 'all 0.4s ease-out';
                    rateCard.style.opacity = '1';
                    rateCard.style.transform = 'translateY(0)';
                }, 10);
            }, index * 100); // Har bir karta 100ms delay bilan
        });
        
        // Loading class'ni olib tashlash
        setTimeout(() => {
            if (ratesContainer) {
                ratesContainer.classList.remove('loading');
            }
        }, data.currencies.length * 100 + 200);
        
        // Yangilanish vaqtini ko'rsatish
        if (lastUpdated && data.lastUpdated) {
            const updateTime = new Date(data.lastUpdated);
            const now = new Date();
            const diffMinutes = Math.floor((now - updateTime) / 60000);
            const diffSeconds = Math.floor((now - updateTime) / 1000);
            
            let timeText = '';
            if (diffSeconds < 10) {
                timeText = 'Hozir yangilandi';
            } else if (diffSeconds < 60) {
                timeText = `${diffSeconds} soniya oldin`;
            } else if (diffMinutes < 60) {
                timeText = `${diffMinutes} daqiqa oldin`;
            } else {
                const hours = Math.floor(diffMinutes / 60);
                timeText = `${hours} soat oldin`;
            }
            
            lastUpdated.textContent = timeText;
            
            // Real-time yangilanish - har 30 soniyada yangilash
            if (window.ratesUpdateInterval) {
                clearInterval(window.ratesUpdateInterval);
            }
            
            window.ratesUpdateInterval = setInterval(() => {
                const newNow = new Date();
                const newDiffSeconds = Math.floor((newNow - updateTime) / 1000);
                const newDiffMinutes = Math.floor(newDiffSeconds / 60);
                
                if (newDiffSeconds < 10) {
                    lastUpdated.textContent = 'Hozir yangilandi';
                } else if (newDiffSeconds < 60) {
                    lastUpdated.textContent = `${newDiffSeconds} soniya oldin`;
                } else if (newDiffMinutes < 60) {
                    lastUpdated.textContent = `${newDiffMinutes} daqiqa oldin`;
                } else {
                    const hours = Math.floor(newDiffMinutes / 60);
                    lastUpdated.textContent = `${hours} soat oldin`;
                }
            }, 10000); // Har 10 soniyada yangilash
        }
        
        // Ko'rsatish
        ratesContainer.style.display = 'block';
        
    } catch (error) {
        ratesContainer.style.display = 'none';
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
            refreshBtn.classList.remove('refreshing');
        }
    }
}
