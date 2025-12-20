// Audit Module
// Audit log va tafsilotlar

import { state, setAuditDatePicker } from './state.js';
import { DOM } from './dom.js';
import { safeFetch } from './api.js';
import { ACTION_DEFINITIONS, debounce, parseUserAgent } from './utils.js';

export function setupAuditLogFilters() {
    if (!DOM.auditUserFilter || !DOM.auditDateFilter || !DOM.auditActionFilter) return;
    
    // Statistika yuklash
    updateAuditStats();
    
    // Filter toggle
    const filterToggleBtn = document.getElementById('audit-filter-toggle-btn');
    const filterContent = document.getElementById('audit-filter-content');
    const filterCard = document.querySelector('.audit-filter-card');
    
    if (filterToggleBtn && filterContent) {
        filterToggleBtn.addEventListener('click', () => {
            filterContent.classList.toggle('hidden');
            filterCard.classList.toggle('collapsed');
        });
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('audit-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            fetchAndRenderAuditLogs(state.auditLog.pagination?.currentPage || 1);
            updateAuditStats();
        });
    }
    
    // Search input
    const searchInput = document.getElementById('audit-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            state.auditLog.filters.search = e.target.value;
            fetchAndRenderAuditLogs(1);
        }, 500));
    }
    
    // Export button
    const exportBtn = document.getElementById('audit-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportAuditLogs);
    }
    
    DOM.auditUserFilter.innerHTML = '<option value="">Barcha foydalanuvchilar</option>';
    state.users.forEach(user => {
        DOM.auditUserFilter.innerHTML += `<option value="${user.id}">${user.username}</option>`;
    });
    
    DOM.auditActionFilter.innerHTML = '<option value="">Barcha amallar</option>';
    for (const key in ACTION_DEFINITIONS) {
        DOM.auditActionFilter.innerHTML += `<option value="${key}">${ACTION_DEFINITIONS[key].text}</option>`;
    }
    
    const fpInstance = flatpickr(DOM.auditDateFilter, {
        mode: "range",
        dateFormat: "Y-m-d",
        locale: 'uz',
        onChange: debounce((selectedDates) => {
            if (selectedDates.length === 2) {
                state.auditLog.filters.startDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                state.auditLog.filters.endDate = flatpickr.formatDate(selectedDates[1], 'Y-m-d');
            } else if (selectedDates.length === 0) {
                state.auditLog.filters.startDate = '';
                state.auditLog.filters.endDate = '';
            }
            fetchAndRenderAuditLogs(1);
        }, 500)
    });
    setAuditDatePicker(fpInstance);
    
    DOM.auditUserFilter.addEventListener('change', (e) => {
        state.auditLog.filters.userId = e.target.value;
        fetchAndRenderAuditLogs(1);
    });
    
    DOM.auditActionFilter.addEventListener('change', (e) => {
        state.auditLog.filters.actionType = e.target.value;
        fetchAndRenderAuditLogs(1);
    });
    
    DOM.auditFilterResetBtn.addEventListener('click', async () => {
        state.auditLog.filters = { userId: '', startDate: '', endDate: '', actionType: '' };
        DOM.auditUserFilter.value = '';
        DOM.auditActionFilter.value = '';
        const { auditDatePickerFP } = await import('./state.js');
        if (auditDatePickerFP) auditDatePickerFP.clear();
        state.auditLog.initialLoad = true;
        renderAuditLogTable();
        renderAuditLogPagination();
    });
}

// Realtime yangilanish uchun funksiya
export function loadAuditLogs() {
    console.log('🔄 [AUDIT] Audit log ma\'lumotlari yangilanmoqda...');
    fetchAndRenderAuditLogs(state.auditLog.pagination?.currentPage || 1);
    updateAuditStats();
}

export async function fetchAndRenderAuditLogs(page = 1) {
    state.auditLog.initialLoad = false;
    if (DOM.auditLogTableBody) {
        DOM.auditLogTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">Yuklanmoqda...</td></tr>`;
    }
    
    try {
        const params = new URLSearchParams({ page, ...state.auditLog.filters });
        const res = await safeFetch(`/api/audit-logs?${params.toString()}`);
        if (!res || !res.ok) {
            const error = await res.json();
            throw new Error(error.message || "Jurnalni yuklab bo'lmadi");
        }
        
        const data = await res.json();
        state.auditLog.logs = data.logs;
        state.auditLog.pagination = data.pagination;
        renderAuditLogTable();
        renderAuditLogPagination();
    } catch (error) {
        if (DOM.auditLogTableBody) {
            DOM.auditLogTableBody.innerHTML = `<tr><td colspan="5" class="empty-state error">${error.message}</td></tr>`;
        }
    }
}

export function renderAuditLogTable() {
    if (!DOM.auditLogTableBody) return;
    
    if (state.auditLog.initialLoad) {
        DOM.auditLogTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">Filtrlardan foydalanib, jurnallarni qidiring.</td></tr>`;
        return;
    }
    
    if (state.auditLog.logs.length === 0) {
        DOM.auditLogTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">Filtrlarga mos yozuvlar topilmadi.</td></tr>`;
        return;
    }
    
    DOM.auditLogTableBody.innerHTML = state.auditLog.logs.map(log => {
        const { description, hasDetails } = generateLogDescription(log);
        const userAgentInfo = parseUserAgent(log.user_agent);
        
        return `
            <tr>
                <td>${new Date(log.timestamp).toLocaleString('sv-SE')}</td>
                <td>${log.username || 'Tizim'}</td>
                <td class="log-description">${description}</td>
                <td>
                    <div>${userAgentInfo.browser}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">${userAgentInfo.os}</div>
                </td>
                <td>
                    ${hasDetails ? `<button class="btn-icon open-audit-details-btn" data-log-id="${log.id}" title="Tafsilotlar"><i data-feather="more-horizontal"></i></button>` : ''}
                </td>
            </tr>
        `;
    }).join('');
    
    // Feather iconlarni yangilash
    if (window.feather) {
        setTimeout(() => {
        feather.replace();
        }, 0);
    }
}

export function renderAuditLogPagination() {
    if (!DOM.auditLogPagination) return;
    
    const { pages, currentPage } = state.auditLog.pagination;
    if (pages <= 1) {
        DOM.auditLogPagination.innerHTML = '';
        return;
    }
    
    DOM.auditLogPagination.innerHTML = `
        <button id="audit-prev-page-btn" class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''}>
            ‹
        </button>
        <span id="page-info">Sahifa ${currentPage} / ${pages}</span>
        <button id="audit-next-page-btn" class="pagination-btn" ${currentPage === pages ? 'disabled' : ''}>
            ›
        </button>
    `;
    if (window.feather) {
        feather.replace();
    }
}

function generateLogDescription(log) {
    const definition = ACTION_DEFINITIONS[log.action] || { 
        text: log.action, 
        icon: 'alert-circle', 
        color: '#6c757d' 
    };
    
    let targetLink = '';
    let hasDetails = false;
    
    if (log.target_type && log.target_id) {
        switch(log.target_type) {
            case 'user':
                targetLink = `<a href="#users" class="log-target-link" data-focus-id="${log.target_id}">${log.target_type} #${log.target_id}</a>`;
                break;
            case 'report':
                targetLink = `<a href="/?report=${log.target_id}" target="_blank" class="log-target-link">${log.target_type} #${log.target_id}</a>`;
                break;
            case 'role':
                targetLink = `<a href="#roles" class="log-target-link" data-focus-id="${log.target_id}">${log.target_type} '${log.target_id}'</a>`;
                break;
            default:
                targetLink = `${log.target_type} #${log.target_id}`;
        }
    }
    
    let details;
    try {
        details = log.details ? JSON.parse(log.details) : {};
    } catch {
        details = {};
    }
    
    if (Object.keys(details).length > 0) {
        hasDetails = true;
    }
    
    let descriptionHtml = `<i data-feather="${definition.icon}" style="color: ${definition.color};"></i> <span>`;
    
    if (['login_success', 'login_fail', 'logout', 'account_lock', '2fa_sent', '2fa_success', '2fa_fail'].includes(log.action)) {
        descriptionHtml += definition.text;
    } else {
        descriptionHtml += `<strong>${log.username || 'Tizim'}</strong> ${targetLink} ${definition.text}`;
    }
    
    descriptionHtml += `</span>`;
    
    return { description: descriptionHtml, hasDetails };
}

export function openAuditDetailsModal(logId) {
    const log = state.auditLog.logs.find(l => l.id === logId);
    if (!log || !DOM.auditDetailsBody) return;
    
    let details;
    try {
        details = log.details ? JSON.parse(log.details) : {};
    } catch {
        details = { raw: log.details };
    }
    
    let detailsHtml = '<div class="details-grid">';
    detailsHtml += `<div class="grid-label">IP Manzil</div><div>${log.ip_address || '-'}</div>`;
    
    for (const [key, value] of Object.entries(details)) {
        detailsHtml += `<div class="grid-label">${key}</div>`;
        if (typeof value === 'object' && value !== null) {
            detailsHtml += `<div><pre>${JSON.stringify(value, null, 2)}</pre></div>`;
        } else {
            detailsHtml += `<div>${value}</div>`;
        }
    }
    
    detailsHtml += '</div>';
    DOM.auditDetailsBody.innerHTML = detailsHtml;
    DOM.auditDetailsModal.classList.remove('hidden');
}

export function setupAuditPagination() {
    if (DOM.auditLogPagination) {
        DOM.auditLogPagination.addEventListener('click', e => {
            const btn = e.target.closest('.pagination-btn');
            if (!btn) return;
            
            let currentPage = state.auditLog.pagination.currentPage;
            if (btn.id === 'audit-prev-page-btn' && currentPage > 1) {
                fetchAndRenderAuditLogs(currentPage - 1);
            } else if (btn.id === 'audit-next-page-btn' && currentPage < state.auditLog.pagination.pages) {
                fetchAndRenderAuditLogs(currentPage + 1);
            }
        });
    }
    
    if (DOM.auditLogTableBody) {
        DOM.auditLogTableBody.addEventListener('click', e => {
            const detailsBtn = e.target.closest('.open-audit-details-btn');
            if (detailsBtn) {
                const logId = parseInt(detailsBtn.dataset.logId, 10);
                openAuditDetailsModal(logId);
            }
        });
    }
}

/**
 * Audit log statistikasini yangilash
 */
async function updateAuditStats() {
    try {
        const res = await safeFetch('/api/audit-logs/stats');
        if (!res || !res.ok) return;
        
        // Check if response is JSON
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            return; // Not JSON, skip silently
        }
        
        try {
        const data = await res.json();
        
        const totalCountEl = document.getElementById('total-logs-count');
        const todayCountEl = document.getElementById('today-logs-count');
        
        if (totalCountEl) {
            totalCountEl.textContent = data.total || 0;
        }
        
        if (todayCountEl) {
            todayCountEl.textContent = data.today || 0;
            }
        } catch (parseError) {
            console.error('Audit stats parse error:', parseError);
            // Silently ignore parse errors
        }
    } catch (error) {
        // Silently ignore if stats endpoint doesn't exist
        return;
    }
}

/**
 * Audit log eksport qilish
 */
async function exportAuditLogs() {
    try {
        const params = new URLSearchParams(state.auditLog.filters);
        const res = await safeFetch(`/api/audit-logs/export?${params.toString()}`);
        
        if (!res || !res.ok) {
            throw new Error('Eksport qilishda xatolik');
        }
        
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (error) {
        console.error('Eksport xatolik:', error);
        alert('Eksport qilishda xatolik yuz berdi');
    }
}
