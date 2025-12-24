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
    // O'chirish ruxsatlarini tekshirish
    // Superadmin uchun barcha ruxsatlar berilgan deb hisoblanadi
    const isSuperAdmin = state.currentUser?.role === 'superadmin' || state.currentUser?.role === 'super_admin';
    const deletePermissions = ['reports:delete_all', 'reports:delete_assigned', 'reports:delete_own', 'reports:delete'];
    const hasDeletePermission = isSuperAdmin || deletePermissions.some(p => state.currentUser?.permissions?.includes(p));
    
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
        
        // O'chirish ruxsatini tekshirish
        let canDelete = false;
        if (hasDeletePermission) {
            // Superadmin barcha hisobotlarni o'chira oladi
            if (isSuperAdmin) {
                canDelete = true;
            } else {
                const canDeleteAll = state.currentUser?.permissions?.includes('reports:delete_all');
                const canDeleteAssigned = state.currentUser?.permissions?.includes('reports:delete_assigned') && 
                    state.currentUser?.locations && Array.isArray(state.currentUser.locations) && 
                    state.currentUser.locations.includes(report.location);
                const canDeleteOwn = state.currentUser?.permissions?.includes('reports:delete_own') && 
                    report.created_by && String(report.created_by) === String(state.currentUser?.id);
                const hasOldDelete = state.currentUser?.permissions?.includes('reports:delete');
                
                canDelete = canDeleteAll || canDeleteAssigned || canDeleteOwn || hasOldDelete;
            }
        }
        
        const deleteBtn = canDelete ? `
            <button class="report-delete-btn" data-id="${id}" title="O'chirish" onclick="event.stopPropagation(); deleteReport('${id}')">
                <i data-feather="trash-2"></i>
            </button>` : '';
        
        return `
            <div class="report-item" data-id="${id}">
                <div class="report-line-1">
                    <span class="report-id">#${formatReportId(id)}</span>
                    <span class="report-date">${day}.${month}.${year}</span>
                    ${deleteBtn}
                </div>
                <div class="report-line-2">
                    <span class="report-location">${report.location || 'Noma\'lum filial'}</span>
                    ${editInfo}
                </div>
            </div>`;
    }).join('');
    
    // Feather iconlarni yangilash
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
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
    
    // Debug uchun
    console.log('[DEBUG] updateUIForReportState:', {
        isNew,
        currentReportId: state.currentReportId,
        report: report ? { id: report.id, location: report.location, created_by: report.created_by } : null,
        currentUser: {
            id: state.currentUser?.id,
            permissions: state.currentUser?.permissions,
            locations: state.currentUser?.locations
        }
    });
    
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
    
    // MUAMMO: Agar report mavjud bo'lsa va hasEditAll true bo'lsa, canEdit true bo'lishi kerak
    // Lekin hozir report && shart qo'yilgan, bu yangi hisobot uchun muammo yaratadi
    const canEdit = !isNew && report && (hasEditAll || hasEditAssigned || hasEditOwn);
    
    console.log('[DEBUG] Edit permissions check:', {
        hasEditAll,
        hasEditAssigned,
        hasEditOwn,
        canEdit,
        isNew,
        hasReport: !!report
    });
    
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

// Delete modal'ni ochish funksiyasi
function openDeleteReportModal(reportId, report) {
    const modal = document.getElementById('delete-report-modal');
    if (!modal) return;

    // Ma'lumotlarni to'ldirish
    document.getElementById('delete-report-id').textContent = `#${formatReportId(reportId)}`;
    
    const reportDate = report.date || report.report_date;
    if (reportDate) {
        const dateObj = new Date(reportDate);
        const day = dateObj.getDate().toString().padStart(2, '0');
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const year = dateObj.getFullYear();
        document.getElementById('delete-report-date').textContent = `${day}.${month}.${year}`;
    } else {
        document.getElementById('delete-report-date').textContent = 'Noma\'lum';
    }
    
    document.getElementById('delete-report-location').textContent = report.location || 'Noma\'lum filial';
    
    // Brend ma'lumotini ko'rsatish
    if (report.brand_name) {
        document.getElementById('delete-report-brand').textContent = report.brand_name;
        document.getElementById('delete-report-brand-row').style.display = 'flex';
    } else {
        document.getElementById('delete-report-brand-row').style.display = 'none';
    }

    // Modal'ni ko'rsatish
    modal.classList.remove('hidden');
    
    // Feather iconlarni yangilash
    if (typeof feather !== 'undefined') {
        feather.replace();
    }

    // Confirm tugmasiga event listener qo'shish
    const confirmBtn = document.getElementById('delete-report-confirm-btn');
    if (confirmBtn) {
        // Eski listenerlarni olib tashlash
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        
        newConfirmBtn.onclick = async () => {
            await performDeleteReport(reportId);
        };
    }
}

// Delete modal'ni yopish
function closeDeleteReportModal() {
    const modal = document.getElementById('delete-report-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Asosiy o'chirish funksiyasi
async function performDeleteReport(reportId) {
    try {
        // Modal'ni yopish
        closeDeleteReportModal();
        
        // Loading ko'rsatish
        showToast('Hisobot o\'chirilmoqda...', false);
        
        const res = await fetch(`/api/reports/${reportId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.message || 'Hisobotni o\'chirishda xatolik');
        }
        
        showToast(data.message || 'Hisobot muvaffaqiyatli o\'chirildi', false);
        
        // Agar o'chirilgan hisobot hozir ko'rsatilayotgan bo'lsa, yangi hisobot yaratish rejimiga o'tish
        if (state.currentReportId === reportId) {
            createNewReport();
        }
        
        // Hisobotlar ro'yxatini yangilash
        await fetchAndRenderReports();
        
    } catch (error) {
        console.error('❌ Hisobotni o\'chirish xatoligi:', error);
        showToast(error.message || 'Hisobotni o\'chirishda xatolik yuz berdi', true);
    }
}

// Hisobotni o'chirish funksiyasi
export async function deleteReport(reportId) {
    if (!reportId) {
        showToast('Hisobot ID topilmadi', true);
        return;
    }
    
    const report = state.savedReports?.[reportId];
    if (!report) {
        showToast('Hisobot topilmadi', true);
        return;
    }
    
    // Modal'ni ochish
    openDeleteReportModal(reportId, report);
}

// Global funksiyalar (HTML onclick uchun)
if (typeof window !== 'undefined') {
    window.deleteReport = deleteReport;
    window.closeDeleteReportModal = closeDeleteReportModal;
}

export { updateUIForReportState, setInputsReadOnly };

