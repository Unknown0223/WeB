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
    
    // Avtomatik yuklanish - async funksiya sifatida
    (async () => {
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
                data: [] 
            },
            options: { 
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
            formats: [{
                name: "currency", 
                thousandsSeparator: " ", 
                decimalPlaces: 0, 
                currencySymbol: " сум", 
                currencySymbolAlign: "right",
                nullValue: "0"
            }]
        },
        reportcomplete: function() {
            hidePivotLoader();
            // DOM asosida ruscha tarjimani qo'llash
            initPivotDomLocalization();
            
            // Avtomatik yuklash o'chirildi - ma'lumotlar faqat "Qo'llash" tugmasi bosilganda yuklanadi
            
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

    // Valyuta tanlash selector'iga event listener o'chirildi
    // Ma'lumotlar faqat "Qo'llash" tugmasi bosilganda yuklanadi
    // Default ma'lumotlar reportcomplete callback'ida yuklanadi
    
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
    if (!state.pivotGrid) {
        return;
    }
    
    showPivotLoader();
    
    try {
        const params = new URLSearchParams({ startDate, endDate, currency });
        const url = `/api/pivot/data?${params.toString()}`;
        
        const res = await safeFetch(url);
        
        if (!res || !res.ok) {
            throw new Error('Не удалось загрузить данные для сводной таблицы');
        }
        
        const data = await res.json();
        
        // Ma'lumotlarni qayta ishlash - dublikatlarni olib tashlash va "День" ni oddiy raqam sifatida saqlash
        const processedData = data.map(item => {
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
            
            // "Дата полная" ni faqat filter uchun qo'shamiz, lekin Fields oynasida ko'rsatmaymiz
            // cleanItem["Дата полная"] = dateStr; // Bu maydonni olib tashlaymiz, chunki dublikat
            
            return cleanItem;
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
        const pivotReport = {
            dataSource: { 
                data: processedData 
            },
            slice: {
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
            },
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
        
        
        // Сворачиваем все данные по умолчанию (пользователь сам развернёт нужное)
        setTimeout(() => {
            if (data.length > 0) {
                state.pivotGrid.collapseAllData();
            }
            hidePivotLoader();
        }, 500);
        
    } catch (error) {
        showToast(error.message, true);
        hidePivotLoader();
        
        // Устанавливаем пустой отчет при ошибке
        state.pivotGrid.setReport({ 
            dataSource: { data: [] }, 
            options: { 
                grid: { 
                    title: "Ошибка загрузки данных" 
                } 
            } 
        });
    }
}

/**
 * Отобразить список сохраненных шаблонов в виде тегов
 */
export async function renderTemplatesAsTags() {
    if (!DOM.templatesTagList) {
        return;
    }
    
    try {
        const res = await safeFetch('/api/pivot/templates');
        
        if (!res || !res.ok) {
            throw new Error('Не удалось загрузить шаблоны');
        }
        
        state.pivotTemplates = await res.json();
        
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
        DOM.templatesTagList.innerHTML = state.pivotTemplates.map(template => {
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
                        <i data-feather="edit-2" style="width:16px; height:16px;"></i>
                    </button>
                    <button class="btn-icon delete-template-btn" 
                            data-id="${template.id}" 
                            title="Удалить шаблон">
                        <i data-feather="trash-2" style="width:16px; height:16px;"></i>
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
        
        // Обновляем иконки Feather
        feather.replace();
        
    } catch (error) {
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
    const report = state.pivotGrid.getReport();
    
    // Admin uchun public flag
    const isPublic = DOM.templateIsPublicCheckbox && DOM.templateIsPublicCheckbox.checked;
    
    try {
        const res = await safeFetch('/api/pivot/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, report, isPublic })
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
                    throw new Error(errorData.message || 'Ошибка удаления шаблона');
                }
                
                showToast("Шаблон успешно удален.");
                
                // Обновляем оба списка
                renderTemplatesList();
                renderTemplatesAsTags();
                
            } catch (error) {
                showToast(error.message, true);
            }
        }
    } else {
        // Загрузка шаблона (клик по элементу списка)
        try {
            const res = await safeFetch(`/api/pivot/templates/${templateId}`);
            
            if (!res || !res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Ошибка загрузки шаблона');
            }
            
            const report = await res.json();
            state.pivotGrid.setReport(report);
            
            // Tanlangan kalendar kuni bilan ma'lumotlarni yuklash
            const selectedDates = pivotDatePickerFP?.selectedDates || [];
            const selectedCurrency = DOM.pivotCurrencySelect?.value || 'UZS';
            
            if (selectedDates.length === 1) {
                // Bitta sana tanlansa
                const singleDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                await updatePivotData(singleDate, singleDate, selectedCurrency);
                await loadExchangeRates(singleDate, singleDate);
            } else if (selectedDates.length === 2) {
                // Ikkita sana tanlansa, oraliq
                const startDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                const endDate = flatpickr.formatDate(selectedDates[1], 'Y-m-d');
                await updatePivotData(startDate, endDate, selectedCurrency);
                await loadExchangeRates(startDate, endDate);
            } else {
                // Agar sana tanlanmagan bo'lsa, default oraliqni ishlatamiz
                const defaultStartDate = flatpickr.formatDate(new Date(new Date().setDate(new Date().getDate() - 29)), 'Y-m-d');
                const defaultEndDate = flatpickr.formatDate(new Date(), 'Y-m-d');
                await updatePivotData(defaultStartDate, defaultEndDate, selectedCurrency);
                await loadExchangeRates(defaultStartDate, defaultEndDate);
            }
            
            const templateName = listItem.querySelector('.template-list-name').textContent;
            showToast(`Шаблон "${templateName}" загружен.`);
            
            // Закрываем модальное окно
            DOM.loadTemplateModal.classList.add('hidden');
            
        } catch (error) {
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
                        throw new Error(errorData.message || 'Ошибка обновления шаблона');
                    }
                    
                    showToast("Название шаблона успешно изменено.");
                    renderTemplatesAsTags();
                    
                } catch (error) {
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
                        throw new Error(errorData.message || 'Ошибка удаления шаблона');
                    }
                    
                    showToast("Шаблон успешно удален.");
                    renderTemplatesAsTags();
                    
                } catch (error) {
                    showToast(error.message, true);
                }
            }
        }
    } else {
        // Загрузка шаблона (клик по самому тегу)
        try {
            const res = await safeFetch(`/api/pivot/templates/${templateId}`);
            
            if (!res || !res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Ошибка загрузки шаблона');
            }
            
            const report = await res.json();
            state.pivotGrid.setReport(report);
            
            // Tanlangan kalendar kuni bilan ma'lumotlarni yuklash
            const selectedDates = pivotDatePickerFP?.selectedDates || [];
            const selectedCurrency = DOM.pivotCurrencySelect?.value || 'UZS';
            
            if (selectedDates.length === 1) {
                // Bitta sana tanlansa
                const singleDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                await updatePivotData(singleDate, singleDate, selectedCurrency);
                await loadExchangeRates(singleDate, singleDate);
            } else if (selectedDates.length === 2) {
                // Ikkita sana tanlansa, oraliq
                const startDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                const endDate = flatpickr.formatDate(selectedDates[1], 'Y-m-d');
                await updatePivotData(startDate, endDate, selectedCurrency);
                await loadExchangeRates(startDate, endDate);
            } else {
                // Agar sana tanlanmagan bo'lsa, default oraliqni ishlatamiz
                const defaultStartDate = flatpickr.formatDate(new Date(new Date().setDate(new Date().getDate() - 29)), 'Y-m-d');
                const defaultEndDate = flatpickr.formatDate(new Date(), 'Y-m-d');
                await updatePivotData(defaultStartDate, defaultEndDate, selectedCurrency);
                await loadExchangeRates(defaultStartDate, defaultEndDate);
            }
            
            const templateName = tag.querySelector('.tag-name').textContent;
            showToast(`Шаблон "${templateName}" загружен.`);
            
            // Templates panel doimo ochiq turadi
            
        } catch (error) {
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
