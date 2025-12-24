// Модуль интерактивных отчетов (Pivot)
// Управление сводными таблицами и шаблонами

import { state, setPivotDatePicker, pivotDatePickerFP } from './state.js';
import { DOM } from './dom.js';
import { safeFetch } from './api.js';
import { showToast, debounce, hasPermission, showConfirmDialog } from './utils.js';

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
    
    // Shablonlar ro'yxatini yuklash
    renderTemplatesAsTags();

    // Настройка выбора диапазона дат с помощью flatpickr
    // Tezkor sana tanlash plugin'i bilan
    const fpInstance = flatpickr(DOM.pivotDateFilter, {
        mode: "range",
        dateFormat: "Y-m-d",
        locale: 'ru',
        defaultDate: [ 
            new Date(new Date().setDate(new Date().getDate() - 29)), 
            new Date() 
        ],
        plugins: [createQuickSelectPlugin()] // Tezkor variantlar plugin'i
    });
    
    setPivotDatePicker(fpInstance);
    
    // Default sana bilan avtomatik yuklanish
    const defaultStartDate = new Date(new Date().setDate(new Date().getDate() - 29));
    const defaultEndDate = new Date();
    fpInstance.setDate([defaultStartDate, defaultEndDate], false);
    
    // Avtomatik ma'lumotlar yuklash (sahifa yuklanganda yoki bo'limga o'tilganda)
    const startDateStr = flatpickr.formatDate(defaultStartDate, 'Y-m-d');
    const endDateStr = flatpickr.formatDate(defaultEndDate, 'Y-m-d');
    const defaultCurrency = DOM.pivotCurrencySelect?.value || 'UZS';
    
    // Dastlabki holatda barcha maydonlar bilan minimal ma'lumot yaratish
    // Bu Fields panelida barcha maydonlarni ko'rsatish uchun kerak
    const today = new Date();
    const todayStr = flatpickr.formatDate(today, 'Y-m-d');
    const initialEmptyData = [{
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
    
    console.log('[PIVOT] 🚀 setupPivot() - Dastlabki holatda minimal ma\'lumotlar yaratilmoqda:', {
        fields: Object.keys(initialEmptyData[0]),
        sampleData: initialEmptyData[0]
    });

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
            console.log('[PIVOT] ✅ reportcomplete callback chaqirildi');
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
    
    console.log('[PIVOT] ✅ WebDataRocks dastlabki holatda yaratildi, minimal ma\'lumotlar bilan');

    // Avtomatik yuklanish - async funksiya sifatida
    // Bu ma'lumotlarni yuklaydi, lekin agar ma'lumotlar bo'lmasa, minimal ma'lumotlar qoladi
    (async () => {
        console.log('[PIVOT] 🔄 Avtomatik ma\'lumotlar yuklanmoqda...');
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
export async function updatePivotData(startDate, endDate, currency = 'UZS') {
    console.log('[PIVOT] 🔄 updatePivotData() chaqirildi:', { startDate, endDate, currency });
    
    if (!state.pivotGrid) {
        console.error('[PIVOT] ❌ state.pivotGrid topilmadi!');
        return;
    }
    
    console.log('[PIVOT] ✅ state.pivotGrid mavjud');
    showPivotLoader();
    
    try {
        const params = new URLSearchParams({ startDate, endDate, currency });
        const url = `/api/pivot/data?${params.toString()}`;
        console.log('[PIVOT] 📡 API so\'rovi yuborilmoqda:', url);
        
        const res = await safeFetch(url);
        
        if (!res || !res.ok) {
            console.error('[PIVOT] ❌ API so\'rovi muvaffaqiyatsiz:', {
                ok: res?.ok,
                status: res?.status,
                statusText: res?.statusText
            });
            throw new Error('Не удалось загрузить данные для сводной таблицы');
        }
        
        const data = await res.json();
        console.log('[PIVOT] 📥 API javob:', {
            dataType: typeof data,
            isArray: Array.isArray(data),
            dataLength: Array.isArray(data) ? data.length : 'N/A',
            firstItem: Array.isArray(data) && data.length > 0 ? Object.keys(data[0]) : [],
            dataPreview: Array.isArray(data) ? JSON.stringify(data.slice(0, 2)) : 'N/A'
        });
        
        // Agar ma'lumotlar bo'lmasa, barcha maydonlar bilan minimal namuna ma'lumot yaratish
        // Bu Fields panelida barcha maydonlarni ko'rsatish uchun kerak
        let dataToProcess = data;
        const isEmpty = !data || data.length === 0;
        console.log('[PIVOT] 📊 Ma\'lumotlar holati:', {
            isEmpty: isEmpty,
            dataLength: Array.isArray(data) ? data.length : 'N/A',
            dataIsNull: data === null,
            dataIsUndefined: data === undefined
        });
        
        if (isEmpty) {
            console.log('[PIVOT] ⚠️ Ma\'lumotlar bo\'sh, minimal namuna ma\'lumot yaratilmoqda...');
            // Barcha maydonlar bilan bo'sh namuna ma'lumot yaratish
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
            console.log('[PIVOT] ✅ Minimal namuna ma\'lumot yaratildi:', {
                fields: Object.keys(dataToProcess[0]),
                sampleData: dataToProcess[0]
            });
        }
        
        // Ma'lumotlarni qayta ishlash - dublikatlarni olib tashlash va "День" ni oddiy raqam sifatida saqlash
        console.log('[PIVOT] 🔄 Ma\'lumotlar qayta ishlanmoqda...');
        const processedData = dataToProcess.map(item => {
            // Дата: "2025-10-01" -> Kun: 1
            const dateStr = item["Дата"];
            let dayNumber = null;
            
            if (dateStr && typeof dateStr === 'string') {
                const dateParts = dateStr.split('-');
                if (dateParts.length === 3) {
                    dayNumber = parseInt(dateParts[2], 10); // Kunni olish
                }
            }
            
            // Faqat kerakli maydonlarni qoldiramiz, dublikatlarni olib tashlaymiz
            const cleanItem = {
                "ID": item["ID"],
                "Дата": dateStr, // Faqat bitta "Дата"
                "День": dayNumber, // Oddiy raqam sifatida (valyuta emas)
                "Бренд": item["Бренд"],
                "Филиал": item["Филиал"],
                "Сотрудник": item["Сотрудник"],
                "Показатель": item["Показатель"],
                "Тип оплаты": item["Тип оплаты"],
                "Сумма": item["Сумма"], // Valyuta bilan
                "Сумма_число": typeof item["Сумма"] === 'number' ? item["Сумма"] : parseFloat(item["Сумма"]) || 0, // Valyutasiz, faqat raqam
                "Комментарий": item["Комментарий"] || ""
            };
            
            return cleanItem;
        });
        
        console.log('[PIVOT] ✅ Qayta ishlangan ma\'lumotlar:', {
            processedDataLength: processedData.length,
            firstItemFields: processedData.length > 0 ? Object.keys(processedData[0]) : [],
            firstItemSample: processedData.length > 0 ? processedData[0] : null
        });
        
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
        // Agar ma'lumotlar bo'lmasa, slice bo'sh bo'ladi (foydalanuvchi o'zi tanlaydi)
        // Lekin dataSource'da minimal ma'lumot bo'lishi kerak, shunda barcha maydonlar Fields panelida ko'rinadi
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
                { uniqueName: "День" },  // Kun raqami ustunlarda
                { uniqueName: "Тип оплаты" }
            ],
            measures: [
                { 
                    uniqueName: "Сумма",
                    aggregation: "sum",
                    format: "currency",
                    caption: "Сумма"  // Valyuta bilan
                },
                {
                    uniqueName: "Сумма_число",
                    aggregation: "sum",
                    format: "number",
                    caption: "Сумма (число)"  // Valyutasiz, faqat raqam
                }
            ],
            reportFilters: [
                { uniqueName: "Показатель" },
                { uniqueName: "Сотрудник" },
                { uniqueName: "Дата" }  // Faqat bitta "Дата" filter
            ]
        } : {
            // Bo'sh ma'lumotlar bo'lganda, slice bo'sh bo'ladi
            rows: [],
            columns: [],
            measures: [],
            reportFilters: []
        };
        
        // Hozirgi slice mavjud bo'lsa va to'g'ri strukturada bo'lsa, uni ishlatamiz
        // Aks holda default slice ishlatamiz
        const finalSlice = (currentSlice && 
                           (currentSlice.rows?.length > 0 || 
                            currentSlice.columns?.length > 0 || 
                            currentSlice.measures?.length > 0 || 
                            currentSlice.reportFilters?.length > 0)) 
                           ? currentSlice 
                           : defaultSlice;
        
        console.log('[PIVOT] 📋 Report konfiguratsiyasi yaratilmoqda:', {
            hasRealData: hasRealData,
            processedDataLength: processedData.length,
            hasCurrentSlice: !!currentSlice,
            currentSliceRows: currentSlice?.rows?.length || 0,
            usingCurrentSlice: finalSlice === currentSlice,
            configuratorActive: false
        });
        
        const pivotReport = {
            dataSource: { 
                data: processedData 
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
                configuratorActive: false,  // Ma'lumotlar yuklanganda ham yopiq
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
        
        console.log('[PIVOT] 📊 Pivot report konfiguratsiyasi:', {
            hasDataSource: !!pivotReport.dataSource,
            dataSourceDataLength: pivotReport.dataSource?.data?.length || 0,
            hasSlice: !!pivotReport.slice,
            sliceRows: pivotReport.slice?.rows?.length || 0,
            sliceColumns: pivotReport.slice?.columns?.length || 0,
            sliceMeasures: pivotReport.slice?.measures?.length || 0,
            sliceFilters: pivotReport.slice?.reportFilters?.length || 0,
            configuratorActive: pivotReport.options?.configuratorActive,
            optionsKeys: Object.keys(pivotReport.options || {}),
            reportPreview: JSON.stringify(pivotReport).substring(0, 500)
        });
        
        // Обновляем отчет полностью
        console.log('[PIVOT] 🎯 setReport() chaqirilmoqda...');
        state.pivotGrid.setReport(pivotReport);
        console.log('[PIVOT] ✅ setReport() muvaffaqiyatli chaqirildi');
        
        // Сворачиваем все данные по умолчанию (пользователь сам развернёт нужное)
        setTimeout(() => {
            console.log('[PIVOT] 🔍 setReport() dan keyin tekshirish...');
            
            // Fields paneli allaqachon configuratorActive: false bilan yopiq
            // Qo'shimcha yopish kerak emas, chunki bu cheksiz loop yaratishi mumkin
            
            // ... existing collapse code ...
            
            hidePivotLoader();
            console.log('[PIVOT] ✅ updatePivotData() muvaffaqiyatli yakunlandi');
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
        
        // Устанавливаем пустой отчет при ошибке, lekin barcha maydonlar bilan
        // Bu Fields panelida barcha maydonlarni ko'rsatish uchun kerak
        console.log('[PIVOT] 🔄 Xatolik holatida minimal ma\'lumot yaratilmoqda...');
        const today = new Date();
        const todayStr = flatpickr.formatDate(today, 'Y-m-d');
        const emptyDataWithFields = [{
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
        
        const currencySymbols = {
            'UZS': 'so\'m',
            'USD': '$',
            'EUR': '€',
            'RUB': '₽',
            'KZT': '₸'
        };
        const currencySymbol = currencySymbols[currency] || 'so\'m';
        const currencyFormat = currency === 'UZS' ? ' сум' : ` ${currencySymbol}`;
        
        console.log('[PIVOT] 📊 Xatolik holatidagi report konfiguratsiyasi:', {
            emptyDataWithFieldsLength: emptyDataWithFields.length,
            fields: Object.keys(emptyDataWithFields[0]),
            configuratorActive: true
        });
        
        state.pivotGrid.setReport({ 
            dataSource: { data: emptyDataWithFields },
            slice: {
                rows: [],
                columns: [],
                measures: [],
                reportFilters: []
            },
            options: { 
                grid: { 
                    title: "Ошибка загрузки данных",
                    showHeaders: true,
                    showTotals: "on",
                    showGrandTotals: "on",
                    type: "compact"
                },
                configuratorActive: true,
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
        });
        console.log('[PIVOT] ✅ Xatolik holatidagi report o\'rnatildi');
    }
}

/**
 * Отобразить список сохраненных шаблонов в виде тегов
 */
export async function renderTemplatesAsTags() {
    console.log('[PIVOT] 🔍 renderTemplatesAsTags() chaqirildi');
    console.log('[PIVOT] DOM.templatesTagList mavjudligi:', !!DOM.templatesTagList);
    console.log('[PIVOT] DOM.templatesTagList element:', DOM.templatesTagList);
    
    if (!DOM.templatesTagList) {
        console.error('[PIVOT] ❌ DOM.templatesTagList topilmadi!');
        return;
    }
    
    try {
        console.log('[PIVOT] 📡 API so\'rovi yuborilmoqda: /api/pivot/templates');
        const res = await safeFetch('/api/pivot/templates');
        
        console.log('[PIVOT] 📥 API javob:', {
            ok: res?.ok,
            status: res?.status,
            statusText: res?.statusText
        });
        
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
        console.log('[PIVOT] ✅ Shablonlar yuklandi:', {
            count: templates?.length || 0,
            templates: templates
        });
        
        state.pivotTemplates = templates;
        
        if (state.pivotTemplates.length === 0) {
            console.log('[PIVOT] ⚠️ Shablonlar ro\'yxati bo\'sh');
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
        
        console.log('[PIVOT] 🎨 HTML generatsiya qilinmoqda...');
        console.log('[PIVOT] 📋 Current user:', {
            id: state.currentUser?.id,
            role: state.currentUser?.role,
            username: state.currentUser?.username
        });
        
        // Генерируем HTML для каждого шаблона
        const html = state.pivotTemplates.map(template => {
            const canModify = state.currentUser.role === 'admin' || state.currentUser.id === template.created_by;
            const isPublic = template.is_public;
            const publicClass = isPublic ? 'template-tag-public' : '';
            const publicBadge = isPublic ? `<span class="public-badge" title="Публичный шаблон"><i class="fas fa-globe"></i></span>` : '';
            
            console.log('[PIVOT] 📋 Template ma\'lumotlari:', {
                id: template.id,
                name: template.name,
                isPublic: isPublic,
                createdBy: template.created_by,
                canModify: canModify
            });
            
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
        
        console.log('[PIVOT] 📝 HTML uzunligi:', html.length, 'simvol');
        console.log('[PIVOT] 🎯 DOM.templatesTagList.innerHTML o\'rnatilmoqda...');
        console.log('[PIVOT] 🎯 DOM.templatesTagList mavjudligi (o\'rnatishdan oldin):', !!DOM.templatesTagList);
        
        DOM.templatesTagList.innerHTML = html;
        
        console.log('[PIVOT] ✅ HTML o\'rnatildi. Elementlar soni:', DOM.templatesTagList.querySelectorAll('.template-tag').length);
        console.log('[PIVOT] 🔍 Yaratilgan elementlar:', Array.from(DOM.templatesTagList.querySelectorAll('.template-tag')).map(el => ({
            id: el.dataset.id,
            name: el.querySelector('.tag-name')?.textContent,
            hasActions: !!el.querySelector('.tag-actions')
        })));
        
        // Обновляем иконки Feather - endi kerak emas, chunki to'g'ridan-to'g'ri SVG ishlatamiz
        // Lekin boshqa joylarda feather iconlar bo'lishi mumkin, shuning uchun qoldiramiz
        console.log('[PIVOT] 🎨 Feather iconlar yangilanmoqda...');
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        console.log('[PIVOT] ✅ renderTemplatesAsTags() muvaffaqiyatli yakunlandi');
        
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
    
    // dataSource saqlanmaydi - har safar kalendardagi sana bilan yuklanadi
    console.log('[PIVOT] 💾 Shablon saqlanmoqda:', {
        name: name,
        hasSlice: !!templateReport.slice,
        hasOptions: !!templateReport.options,
        hasFormats: !!templateReport.formats,
        dataSourceExcluded: true  // Ma'lumotlar saqlanmaydi
    });
    
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
        
        showToast("Шаблон успешно сохранен!");
        DOM.saveTemplateModal.classList.add('hidden');
        DOM.templateNameInput.value = '';
        if (DOM.templateIsPublicCheckbox) {
            DOM.templateIsPublicCheckbox.checked = false;
        }
        
        // Обновляем список шаблонов
        renderTemplatesAsTags();
        
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
    console.log('[PIVOT] 🔍 handleTemplateModalActions() chaqirildi');
    console.log('[PIVOT] 📍 Event target:', e.target);
    console.log('[PIVOT] 📍 Event currentTarget:', e.currentTarget);
    
    const listItem = e.target.closest('.template-list-item');
    console.log('[PIVOT] 🏷️ Template list item topildi:', !!listItem);
    
    if (!listItem) {
        console.log('[PIVOT] ⚠️ Template list item topilmadi, funksiya to\'xtatildi');
        return;
    }
    
    const deleteButton = e.target.closest('.delete-template-modal-btn');
    const templateId = listItem.dataset.id;
    
    console.log('[PIVOT] 📋 Template ma\'lumotlari:', {
        templateId: templateId,
        hasDeleteButton: !!deleteButton,
        listItemHTML: listItem.outerHTML.substring(0, 200)
    });

    if (deleteButton) {
        // Предотвращаем загрузку шаблона при клике на кнопку удаления
        e.stopPropagation();
        console.log('[PIVOT] 🗑️ Delete tugmasi bosildi (modal)');
        
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
                console.log('[PIVOT] 📡 Shablonni o\'chirish so\'rovi yuborilmoqda (modal)...');
                const res = await safeFetch(`/api/pivot/templates/${templateId}`, { 
                    method: 'DELETE' 
                });
                
                if (!res || !res.ok) {
                    const errorData = await res.json();
                    console.error('[PIVOT] ❌ Shablonni o\'chirishda xatolik (modal):', errorData);
                    throw new Error(errorData.message || 'Ошибка удаления шаблона');
                }
                
                console.log('[PIVOT] ✅ Shablon o\'chirildi (modal)');
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
        console.log('[PIVOT] 📥 Shablon yuklash boshlandi (modal)...');
        console.log('[PIVOT] 📋 Template ID:', templateId);
        console.log('[PIVOT] 🔍 state.pivotGrid mavjudligi:', !!state.pivotGrid);
        
        if (!state.pivotGrid) {
            console.error('[PIVOT] ❌ state.pivotGrid topilmadi!');
            showToast('Сводная таблица не инициализирована', true);
            return;
        }
        
        try {
            console.log('[PIVOT] 📡 API so\'rovi yuborilmoqda: /api/pivot/templates/' + templateId);
            const res = await safeFetch(`/api/pivot/templates/${templateId}`);
            
            console.log('[PIVOT] 📥 API javob:', {
                ok: res?.ok,
                status: res?.status,
                statusText: res?.statusText
            });
            
            if (!res || !res.ok) {
                const errorData = await res.json().catch(() => ({ message: 'Noma\'lum xatolik' }));
                console.error('[PIVOT] ❌ API so\'rovi muvaffaqiyatsiz (modal):', errorData);
                throw new Error(errorData.message || 'Ошибка загрузки шаблона');
            }
            
            const report = await res.json();
            console.log('[PIVOT] ✅ Shablon ma\'lumotlari yuklandi (modal):', {
                hasDataSource: !!report.dataSource,
                hasSlice: !!report.slice,
                hasOptions: !!report.options,
                reportKeys: Object.keys(report)
            });
            
            console.log('[PIVOT] 🎯 setReport() chaqirilmoqda (modal)...');
            
            // Shablon yuklanganda Fields panelini yopib-qochirish
            if (report.options) {
                report.options.configuratorActive = false;  // Yopiq
            } else {
                report.options = { configuratorActive: false };
            }
            
            // Shablon ichida ma'lumotlar bo'lmasligi kerak - har safar kalendardagi sana bilan yuklanadi
            // Agar shablon ichida ma'lumotlar bo'lsa, ularni olib tashlaymiz
            if (report.dataSource && report.dataSource.data) {
                console.log('[PIVOT] ⚠️ Shablon ichida eski ma\'lumotlar topildi, olib tashlanmoqda...');
                report.dataSource = { data: [] };  // Bo'sh ma'lumotlar
            }
            
            state.pivotGrid.setReport(report);
            console.log('[PIVOT] ✅ setReport() muvaffaqiyatli chaqirildi (modal)');
            
            // Tanlangan kalendar kuni bilan ma'lumotlarni yuklash
            // Bu shablon konfiguratsiyasi + hozirgi kalendardagi sana bilan ma'lumotlar
            const selectedDates = pivotDatePickerFP?.selectedDates || [];
            const selectedCurrency = DOM.pivotCurrencySelect?.value || 'UZS';
            
            console.log('[PIVOT] 📅 Sana ma\'lumotlari (modal):', {
                selectedDatesCount: selectedDates.length,
                selectedCurrency: selectedCurrency,
                dates: selectedDates.map(d => flatpickr.formatDate(d, 'Y-m-d'))
            });
            
            if (selectedDates.length === 1) {
                // Bitta sana tanlansa
                const singleDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                console.log('[PIVOT] 📊 Shablon konfiguratsiyasi + bitta sana bilan ma\'umotlar yuklanmoqda (modal):', singleDate);
                await updatePivotData(singleDate, singleDate, selectedCurrency);
                await loadExchangeRates(singleDate, singleDate);
            } else if (selectedDates.length === 2) {
                // Ikkita sana tanlansa, oraliq
                const startDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                const endDate = flatpickr.formatDate(selectedDates[1], 'Y-m-d');
                console.log('[PIVOT] 📊 Shablon konfiguratsiyasi + sana oralig\'i bilan ma\'umotlar yuklanmoqda (modal):', { startDate, endDate });
                await updatePivotData(startDate, endDate, selectedCurrency);
                await loadExchangeRates(startDate, endDate);
            } else {
                // Agar sana tanlanmagan bo'lsa, default oraliqni ishlatamiz
                const defaultStartDate = flatpickr.formatDate(new Date(new Date().setDate(new Date().getDate() - 29)), 'Y-m-d');
                const defaultEndDate = flatpickr.formatDate(new Date(), 'Y-m-d');
                console.log('[PIVOT] 📊 Shablon konfiguratsiyasi + default sana oralig\'i bilan ma\'umotlar yuklanmoqda (modal):', { defaultStartDate, defaultEndDate });
                await updatePivotData(defaultStartDate, defaultEndDate, selectedCurrency);
                await loadExchangeRates(defaultStartDate, defaultEndDate);
            }
            
            const templateName = listItem.querySelector('.template-list-name')?.textContent || 'Noma\'lum';
            console.log('[PIVOT] ✅ Shablon muvaffaqiyatli yuklandi (modal):', templateName);
            showToast(`Шаблон "${templateName}" загружен.`);
            
            // Templates panelini yig'ish
            const templatesPanel = document.getElementById('templates-panel');
            if (templatesPanel) {
                templatesPanel.classList.add('collapsed');
                console.log('[PIVOT] ✅ Templates panel yig\'ildi (modal)');
            }
            
            // Закрываем модальное окно
            console.log('[PIVOT] 🚪 Modal oyna yopilmoqda...');
            DOM.loadTemplateModal.classList.add('hidden');
            console.log('[PIVOT] ✅ Modal oyna yopildi');
            
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
    console.log('[PIVOT] 🔍 handleTemplateActions() chaqirildi');
    console.log('[PIVOT] 📍 Event target:', e.target);
    console.log('[PIVOT] 📍 Event currentTarget:', e.currentTarget);
    
    const tag = e.target.closest('.template-tag');
    console.log('[PIVOT] 🏷️ Template tag topildi:', !!tag);
    
    if (!tag) {
        console.log('[PIVOT] ⚠️ Template tag topilmadi, funksiya to\'xtatildi');
        return;
    }
    
    const button = e.target.closest('button');
    const templateId = tag.dataset.id;
    
    console.log('[PIVOT] 📋 Template ma\'lumotlari:', {
        templateId: templateId,
        hasButton: !!button,
        buttonClass: button ? button.className : null,
        tagHTML: tag.outerHTML.substring(0, 200)
    });
    
    if (button) {
        // Предотвращаем загрузку шаблона при клике на кнопки действий
        e.stopPropagation();
        console.log('[PIVOT] 🔘 Tugma bosildi, shablon yuklanmaydi');
        
        // Изменение названия шаблона
        if (button.classList.contains('edit-template-btn')) {
            console.log('[PIVOT] ✏️ Edit tugmasi bosildi');
            const currentName = button.dataset.name;
            const newName = prompt("Введите новое название для шаблона:", currentName);
            
            if (newName && newName.trim() && newName.trim() !== currentName) {
                try {
                    console.log('[PIVOT] 📡 Shablon nomini yangilash so\'rovi yuborilmoqda...');
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
                    
                    console.log('[PIVOT] ✅ Shablon nomi yangilandi');
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
            console.log('[PIVOT] 🗑️ Delete tugmasi bosildi');
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
                    console.log('[PIVOT] 📡 Shablonni o\'chirish so\'rovi yuborilmoqda...');
                    const res = await safeFetch(`/api/pivot/templates/${templateId}`, { 
                        method: 'DELETE' 
                    });
                    
                    if (!res || !res.ok) {
                        const errorData = await res.json();
                        console.error('[PIVOT] ❌ Shablonni o\'chirishda xatolik:', errorData);
                        throw new Error(errorData.message || 'Ошибка удаления шаблона');
                    }
                    
                    console.log('[PIVOT] ✅ Shablon o\'chirildi');
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
        console.log('[PIVOT] 📥 Shablon yuklash boshlandi...');
        console.log('[PIVOT] 📋 Template ID:', templateId);
        console.log('[PIVOT] 🔍 state.pivotGrid mavjudligi:', !!state.pivotGrid);
        console.log('[PIVOT] 🔍 state.pivotGrid type:', typeof state.pivotGrid);
        console.log('[PIVOT] 🔍 state.pivotGrid setReport mavjudligi:', typeof state.pivotGrid?.setReport);
        
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
            console.log('[PIVOT] 📡 API so\'rovi yuborilmoqda: /api/pivot/templates/' + templateId);
            const res = await safeFetch(`/api/pivot/templates/${templateId}`);
            
            console.log('[PIVOT] 📥 API javob:', {
                ok: res?.ok,
                status: res?.status,
                statusText: res?.statusText
            });
            
            if (!res || !res.ok) {
                const errorData = await res.json().catch(() => ({ message: 'Noma\'lum xatolik' }));
                console.error('[PIVOT] ❌ API so\'rovi muvaffaqiyatsiz:', errorData);
                throw new Error(errorData.message || 'Ошибка загрузки шаблона');
            }
            
            const report = await res.json();
            console.log('[PIVOT] ✅ Shablon ma\'lumotlari yuklandi:', {
                hasDataSource: !!report.dataSource,
                hasSlice: !!report.slice,
                hasOptions: !!report.options,
                hasFormats: !!report.formats,
                reportKeys: Object.keys(report),
                dataSourceType: typeof report.dataSource,
                dataSourceKeys: report.dataSource ? Object.keys(report.dataSource) : [],
                sliceKeys: report.slice ? Object.keys(report.slice) : [],
                sliceRows: report.slice?.rows?.length || 0,
                sliceColumns: report.slice?.columns?.length || 0,
                sliceMeasures: report.slice?.measures?.length || 0,
                reportString: JSON.stringify(report).substring(0, 500)
            });
            
            console.log('[PIVOT] 🎯 setReport() chaqirilmoqda...');
            console.log('[PIVOT] 🎯 setReport() argument:', {
                type: typeof report,
                keys: Object.keys(report),
                preview: JSON.stringify(report).substring(0, 200)
            });
            
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
                    console.log('[PIVOT] ⚠️ Shablon ichida eski ma\'lumotlar topildi, olib tashlanmoqda...');
                    report.dataSource = { data: [] };  // Bo'sh ma'lumotlar
                }
                
                state.pivotGrid.setReport(report);
                console.log('[PIVOT] ✅ setReport() muvaffaqiyatli chaqirildi');
                
                // Tanlangan kalendar kuni bilan ma'lumotlarni yuklash
                // Bu shablon konfiguratsiyasi + hozirgi kalendardagi sana bilan ma'lumotlar
                const selectedDates = pivotDatePickerFP?.selectedDates || [];
                const selectedCurrency = DOM.pivotCurrencySelect?.value || 'UZS';
                
                console.log('[PIVOT] 📅 Sana ma\'lumotlari:', {
                    selectedDatesCount: selectedDates.length,
                    selectedCurrency: selectedCurrency,
                    dates: selectedDates.map(d => flatpickr.formatDate(d, 'Y-m-d'))
                });
                
                if (selectedDates.length === 1) {
                    // Bitta sana tanlansa
                    const singleDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                    console.log('[PIVOT] 📊 Shablon konfiguratsiyasi + bitta sana bilan ma\'umotlar yuklanmoqda:', singleDate);
                    await updatePivotData(singleDate, singleDate, selectedCurrency);
                    await loadExchangeRates(singleDate, singleDate);
                } else if (selectedDates.length === 2) {
                    // Ikkita sana tanlansa, oraliq
                    const startDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                    const endDate = flatpickr.formatDate(selectedDates[1], 'Y-m-d');
                    console.log('[PIVOT] 📊 Shablon konfiguratsiyasi + sana oralig\'i bilan ma\'umotlar yuklanmoqda:', { startDate, endDate });
                    await updatePivotData(startDate, endDate, selectedCurrency);
                    await loadExchangeRates(startDate, endDate);
                } else {
                    // Agar sana tanlanmagan bo'lsa, default oraliqni ishlatamiz
                    const defaultStartDate = flatpickr.formatDate(new Date(new Date().setDate(new Date().getDate() - 29)), 'Y-m-d');
                    const defaultEndDate = flatpickr.formatDate(new Date(), 'Y-m-d');
                    console.log('[PIVOT] 📊 Shablon konfiguratsiyasi + default sana oralig\'i bilan ma\'umotlar yuklanmoqda:', { defaultStartDate, defaultEndDate });
                    await updatePivotData(defaultStartDate, defaultEndDate, selectedCurrency);
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
            console.log('[PIVOT] ✅ Shablon muvaffaqiyatli yuklandi:', templateName);
            showToast(`Шаблон "${templateName}" загружен.`);
            
            // Templates panelini yig'ish
            const templatesPanel = document.getElementById('templates-panel');
            if (templatesPanel) {
                templatesPanel.classList.add('collapsed');
                console.log('[PIVOT] ✅ Templates panel yig\'ildi');
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
