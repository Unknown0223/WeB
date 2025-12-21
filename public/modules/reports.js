// Reports Module
// Hisobotlarni yuklash, ko'rsatish va saqlash funksiyalari

import { DOM } from './dom.js';
import { state } from './state.js';
import { showToast, formatNumber, formatReportId } from './utils.js';
import { updateTableValues, buildTable, updateCalculations } from './table.js';

let datePickerFP = null;
let dateFilterFP = null;

export function setDatePicker(instance) {
    datePickerFP = instance;
}

export function setDateFilter(instance) {
    dateFilterFP = instance;
}

export async function fetchAndRenderReports() {
    // Ko'rish ruxsatlari
    const viewPermissions = ['reports:view_own', 'reports:view_assigned', 'reports:view_all'];
    // Tahrirlash ruxsatlari (agar bo'lsa, ko'rish ruxsati ham beriladi)
    const editPermissions = ['reports:edit_own', 'reports:edit_assigned', 'reports:edit_all'];
    
    // Ko'rish yoki tahrirlash ruxsati borligini tekshirish
    const hasViewPermission = viewPermissions.some(p => state.currentUser.permissions.includes(p));
    const hasEditPermission = editPermissions.some(p => state.currentUser.permissions.includes(p));
    
    if (!hasViewPermission && !hasEditPermission) {
        if (DOM.savedReportsList) DOM.savedReportsList.innerHTML = '<div class="empty-state">Hisobotlarni ko\'rish uchun ruxsat yo\'q.</div>';
        return;
    }

    if (DOM.savedReportsList) DOM.savedReportsList.innerHTML = Array(5).fill('<div class="skeleton-item"></div>').join('');
    try {
        const params = new URLSearchParams(state.filters || {});
        const res = await fetch(`/api/reports?${params.toString()}`);
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || "Hisobotlarni yuklashda xatolik.");
        }
        
        const data = await res.json();
        console.log('[FRONTEND] API javob (modules/reports.js):', { 
            reportsType: typeof data.reports, 
            reportsIsArray: Array.isArray(data.reports),
            reportsKeys: data.reports ? Object.keys(data.reports) : [],
            reportsCount: data.reports ? (Array.isArray(data.reports) ? data.reports.length : Object.keys(data.reports).length) : 0,
            total: data.total,
            pages: data.pages
        });
        
        if (data.reports) {
            if (Array.isArray(data.reports)) {
                // Agar array bo'lsa, obyektga o'tkazish
                const reportsObj = {};
                data.reports.forEach(report => {
                    reportsObj[report.id] = report;
                });
                state.savedReports = reportsObj;
                state.reports = reportsObj;
            } else {
                state.savedReports = data.reports;
                state.reports = data.reports;
            }
        } else {
            state.savedReports = {};
            state.reports = {};
        }
        
        state.pagination = { total: data.total, pages: data.pages, currentPage: data.currentPage };
        
        state.existingDates = {};
        Object.values(state.savedReports).forEach(report => {
            if (!state.existingDates[report.location]) {
                state.existingDates[report.location] = new Set();
            }
            state.existingDates[report.location].add(report.date);
        });

        console.log('[FRONTEND] State.savedReports (modules/reports.js):', {
            type: typeof state.savedReports,
            isArray: Array.isArray(state.savedReports),
            keys: state.savedReports ? Object.keys(state.savedReports) : [],
            count: state.savedReports ? (Array.isArray(state.savedReports) ? state.savedReports.length : Object.keys(state.savedReports).length) : 0
        });

        renderSavedReports();
        renderPagination();
        
        // KPI statistikasini yangilash
        if (typeof loadKPIStats === 'function') {
            loadKPIStats();
        }
    } catch (error) {
        showToast(error.message, true);
        if (DOM.savedReportsList) DOM.savedReportsList.innerHTML = `<div class="empty-state error">${error.message}</div>`;
    }
}

export function renderSavedReports() {
    if (!DOM.savedReportsList) {
        console.warn('[FRONTEND] DOM.savedReportsList topilmadi! (modules/reports.js)');
        return;
    }
    
    console.log('[FRONTEND] renderSavedReports chaqirildi (modules/reports.js):', {
        savedReportsType: typeof state.savedReports,
        savedReportsIsArray: Array.isArray(state.savedReports),
        savedReportsKeys: state.savedReports ? Object.keys(state.savedReports) : [],
        savedReportsCount: state.savedReports ? (Array.isArray(state.savedReports) ? state.savedReports.length : Object.keys(state.savedReports).length) : 0
    });
    
    const reportIds = Object.keys(state.savedReports || {});
    console.log('[FRONTEND] Report IDs (modules/reports.js):', reportIds);
    
    if (reportIds.length === 0) {
        console.warn('[FRONTEND] Report IDs bo\'sh, "Hisobotlar topilmadi" ko\'rsatilmoqda (modules/reports.js)');
        DOM.savedReportsList.innerHTML = '<div class="empty-state">Hisobotlar topilmadi.</div>';
        return;
    }
    DOM.savedReportsList.innerHTML = reportIds.map(id => {
        const report = state.savedReports[id];
        console.log(`[FRONTEND] Rendering report ${id}:`, report);
        
        if (!report) {
            console.warn(`[FRONTEND] Report ${id} topilmadi!`);
            return '';
        }
        
        const editInfo = report.edit_count > 0 ? `<span class="edit-count">✏️ ${report.edit_count}</span>` : '';
        
        // Sanani formatlash
        const reportDate = report.date || report.report_date;
        if (!reportDate) {
            console.warn(`[FRONTEND] Report ${id} da sana yo'q!`);
            return '';
        }
        
        const dateObj = new Date(reportDate);
        const day = dateObj.getDate().toString().padStart(2, '0');
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const year = dateObj.getFullYear();
        
        return `
            <div class="report-item" data-id="${id}">
                <div class="report-line-1">
                    <span class="report-id">#${formatReportId(id)}</span>
                    <span class="report-date">${day}.${month}.${year}</span>
                </div>
                <div class="report-line-2">
                    <span class="report-location">${report.location || 'Noma\'lum filial'}</span>
                    ${editInfo}
                </div>
            </div>`;
    }).join('');
}

export function renderPagination() {
    if (!DOM.paginationControls) return;
    const { pages, currentPage } = state.pagination || { pages: 1, currentPage: 1 };
    if (pages <= 1) {
        DOM.paginationControls.classList.add('hidden');
        return;
    }
    DOM.paginationControls.classList.remove('hidden');
    DOM.paginationControls.innerHTML = `
        <button id="prev-page-btn" class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''}><i data-feather="chevron-left"></i></button>
        <span id="page-info">${currentPage} / ${pages}</span>
        <button id="next-page-btn" class="pagination-btn" ${currentPage === pages ? 'disabled' : ''}><i data-feather="chevron-right"></i></button>
    `;
    if (typeof feather !== 'undefined') feather.replace();
}

export async function loadReport(reportId) {
    const report = state.savedReports?.[reportId];
    if (!report) {
        console.error('❌ Hisobot topilmadi:', reportId);
        return;
    }

    state.currentReportId = reportId;
    state.isEditMode = false;

    const originalSettings = state.settings.app_settings;
    state.settings.app_settings = report.settings;
    
    // Ma'lumotlarni parse qilish (agar JSON string bo'lsa)
    let reportData = report.data;
    if (typeof reportData === 'string') {
        try {
            reportData = JSON.parse(reportData);
        } catch (e) {
            console.error('❌ Parse xatolik:', e);
            reportData = {};
        }
    }
    
    await buildTable();
    state.settings.app_settings = originalSettings;
    
    updateTableValues(reportData);

    if (DOM.reportIdBadge) {
        DOM.reportIdBadge.textContent = `#${formatReportId(reportId)}`;
        DOM.reportIdBadge.className = 'badge saved';
    }
    if (datePickerFP) datePickerFP.setDate(report.date, true);
    if (DOM.locationSelect) DOM.locationSelect.value = report.location;
    
    // Valyutani yuklash
    if (DOM.currencySelect && report.currency) {
        DOM.currencySelect.value = report.currency;
        DOM.currencySelect.classList.remove('currency-not-selected');
    } else if (DOM.currencySelect && state.currentUser?.preferred_currency) {
        DOM.currencySelect.value = state.currentUser.preferred_currency;
        DOM.currencySelect.classList.remove('currency-not-selected');
    } else if (DOM.currencySelect) {
        DOM.currencySelect.value = '';
        DOM.currencySelect.classList.add('currency-not-selected');
    }

    document.querySelectorAll('.report-item.active').forEach(item => item.classList.remove('active'));
    document.querySelector(`.report-item[data-id='${reportId}']`)?.classList.add('active');
    updateUIForReportState();
}

export function createNewReport() {
    if (!state.currentUser?.permissions?.includes('reports:create')) {
        return showToast("Sizda yangi hisobot yaratish uchun ruxsat yo'q.", true);
    }
    state.currentReportId = null;
    state.isEditMode = true;
    
    buildTable();
    updateTableValues({});

    if (DOM.reportIdBadge) {
        DOM.reportIdBadge.textContent = 'YANGI';
        DOM.reportIdBadge.className = 'badge new';
    }
    if (DOM.confirmBtn) DOM.confirmBtn.innerHTML = '<i data-feather="check-circle"></i> TASDIQLASH VA SAQLASH';
    
    if (datePickerFP) datePickerFP.clear(); 
    
    if (DOM.locationSelect && DOM.locationSelect.options.length > 0) {
        DOM.locationSelect.selectedIndex = 0;
    }
    
    document.querySelectorAll('.report-item.active').forEach(item => item.classList.remove('active'));
    updateUIForReportState();
    if (typeof feather !== 'undefined') feather.replace();
}

function updateUIForReportState() {
    const isNew = state.currentReportId === null;
    const report = state.savedReports?.[state.currentReportId];
    const hasEditAll = state.currentUser?.permissions?.includes('reports:edit_all');
    
    // Tahrirlash huquqlarini to'g'ri tekshirish
    let hasEditAssigned = false;
    if (state.currentUser?.permissions?.includes('reports:edit_assigned') && report && report.location) {
        const userLocations = Array.isArray(state.currentUser?.locations) 
            ? state.currentUser.locations 
            : (state.currentUser?.locations ? [state.currentUser.locations] : []);
        hasEditAssigned = userLocations.includes(report.location);
    }
    
    const hasEditOwn = state.currentUser?.permissions?.includes('reports:edit_own') && report && report.created_by && String(report.created_by) === String(state.currentUser?.id);
    
    const canEdit = report && (hasEditAll || hasEditAssigned || hasEditOwn);
    
    if (DOM.confirmBtn) DOM.confirmBtn.classList.toggle('hidden', !state.isEditMode);
    if (DOM.editBtn) DOM.editBtn.classList.toggle('hidden', isNew || state.isEditMode || !canEdit);
    if (DOM.historyBtn) DOM.historyBtn.classList.toggle('hidden', isNew);

    if (DOM.datePickerWrapper) {
        DOM.datePickerWrapper.classList.remove('date-valid', 'date-invalid', 'date-attention');
    }

    setInputsReadOnly(!state.isEditMode);

    if (state.isEditMode && isNew) {
        if (DOM.datePickerWrapper) DOM.datePickerWrapper.classList.add('date-attention');
        if (DOM.confirmBtn) DOM.confirmBtn.disabled = true;
    } else {
        if (DOM.confirmBtn) DOM.confirmBtn.disabled = false;
    }
}

function setInputsReadOnly(isReadOnly) {
    if (DOM.tableBody) DOM.tableBody.querySelectorAll('.numeric-input').forEach(input => input.disabled = isReadOnly);
    if (datePickerFP) datePickerFP.set('clickOpens', !isReadOnly);
    if (DOM.locationSelect) DOM.locationSelect.disabled = isReadOnly;
}

export { updateUIForReportState, setInputsReadOnly };

