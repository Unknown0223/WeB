document.addEventListener('DOMContentLoaded', () => {
    // --- Global Holat (State) ---
    const state = {
        settings: {
            app_settings: { columns: [], rows: [], locations: [] },
            pagination_limit: 20,
            branding_settings: { text: 'MANUS', color: '#4CAF50', animation: 'anim-glow-pulse', border: 'border-none' }
        },
        savedReports: {},
        existingDates: {}, 
        currentUser: null,
        currentReportId: null,
        isEditMode: false,
        filters: { page: 1, searchTerm: '', startDate: '', endDate: '', filter: 'all' },
        pagination: { total: 0, pages: 0, currentPage: 1 }
    };

    // --- DOM Elementlari ---
    const DOM = {
        body: document.body,
        tableHead: document.querySelector('#main-table thead'),
        tableBody: document.querySelector('#main-table tbody'),
        tableFoot: document.querySelector('#main-table tfoot'),
        locationSelect: document.getElementById('location-select'),
        reportIdBadge: document.getElementById('report-id-badge'),
        datePickerEl: document.getElementById('date-picker'),
        datePickerWrapper: document.querySelector('.header-center'),
        confirmBtn: document.getElementById('confirm-btn'),
        editBtn: document.getElementById('edit-btn'),
        excelBtn: document.getElementById('excel-btn'),
        newReportBtn: document.getElementById('new-report-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        adminPanelBtn: document.getElementById('admin-panel-btn'),
        savedReportsList: document.getElementById('saved-reports-list'),
        searchInput: document.getElementById('search-input'),
        summaryWrapper: document.getElementById('summary-wrapper'),
        summaryList: document.getElementById('summary-list'),
        summaryTotal: document.getElementById('summary-total'),
        historyBtn: document.getElementById('history-btn'),
        historyModal: document.getElementById('history-modal'),
        historyModalBody: document.getElementById('history-modal-body'),
        currentUsername: document.getElementById('current-username'),
        currentUserRole: document.getElementById('current-user-role'),
        filterDateRange: document.getElementById('filter-date-range'),
        reportFilterButtons: document.getElementById('report-filter-buttons'),
        paginationControls: document.getElementById('pagination-controls'),
        lateCommentModal: document.getElementById('late-comment-modal'),
        lateCommentForm: document.getElementById('late-comment-form'),
        lateCommentInput: document.getElementById('late-comment-input'),
        toast: document.getElementById('toast-notification')
    };

    let datePickerFP = null;
    let dateFilterFP = null;

    // --- Yordamchi Funksiyalar ---
    const showToast = (message, isError = false) => {
        if (!DOM.toast) return;
        DOM.toast.textContent = message;
        DOM.toast.className = `toast ${isError ? 'error' : ''}`;
        setTimeout(() => { DOM.toast.className = `toast ${isError ? 'error' : ''} hidden`; }, 3000);
    };
    const formatNumber = (num) => num ? num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "0";
    const parseNumber = (str) => parseFloat(String(str).replace(/\s/g, '')) || 0;
    const formatReportId = (id) => String(id).padStart(4, '0');
    const debounce = (func, delay) => {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    function applyBranding(settings) {
        const s = settings || state.settings.branding_settings;
        const logo = document.querySelector('.brand-logo');
        const logoContainer = document.querySelector('.logo-border-effect');

        if (logo) {
            logo.textContent = s.text;
            logo.className = 'brand-logo';
            if (s.animation && s.animation !== 'anim-none') {
                logo.classList.add(s.animation);
            }
            logo.style.setProperty('--glow-color', s.color);
        }
        if (logoContainer) {
            logoContainer.className = 'logo-border-effect';
            if (s.border && s.border !== 'border-none') {
                logoContainer.classList.add(s.border);
            }
            logoContainer.style.setProperty('--glow-color', s.color);
        }
    }

   // --- Asosiy Funksiyalar ---
    async function init() {
        try {
            const userRes = await fetch('/api/current-user');
            if (!userRes.ok) {
                window.location.href = '/login';
                return;
            }
            state.currentUser = await userRes.json();
            
            updateUserInfo();
            applyRolePermissions();

            const settingsRes = await fetch('/api/settings');
            if (settingsRes.ok) {
                const allSettings = await settingsRes.json();
                state.settings.app_settings = allSettings.app_settings || { columns: [], rows: [], locations: [] };
                state.settings.branding_settings = allSettings.branding_settings || state.settings.branding_settings;
                state.settings.pagination_limit = allSettings.pagination_limit || 20;
            }
            
            applyBranding(state.settings.branding_settings);

            buildTable(); 
            setupDatePickers();
            populateLocations();
            
            await fetchAndRenderReports();
            setupEventListeners();
            feather.replace();
            
            if (state.currentUser.permissions.includes('reports:create')) {
                createNewReport();
            } else {
                if(DOM.tableBody) DOM.tableBody.innerHTML = '<tr><td colspan="100%"><div class="empty-state">Yangi hisobot yaratish uchun ruxsat yo\'q.</div></td></tr>';
                if (DOM.confirmBtn) DOM.confirmBtn.classList.add('hidden');
            }

        } catch (error) {
            showToast("Sahifani yuklashda jiddiy xatolik yuz berdi!", true);
            console.error("Initialization error:", error);
        }
    }
    
    function applyRolePermissions() {
        const userPermissions = state.currentUser.permissions || [];
        if (userPermissions.includes('roles:manage') || userPermissions.includes('users:view')) {
            if (DOM.adminPanelBtn) DOM.adminPanelBtn.classList.remove('hidden');
        }
        document.querySelectorAll('[data-permission]').forEach(el => {
            const requiredPermissions = el.dataset.permission.split(',');
            const hasPermission = requiredPermissions.some(p => userPermissions.includes(p));
            if (!hasPermission) {
                el.style.display = 'none';
            }
        });
    }
    
    function updateUserInfo() {
        if (DOM.currentUsername) DOM.currentUsername.textContent = state.currentUser.username;
        if (DOM.currentUserRole) DOM.currentUserRole.textContent = state.currentUser.role;
    }

    async function fetchAndRenderReports() {
        const viewPermissions = ['reports:view_own', 'reports:view_assigned', 'reports:view_all'];
        if (!viewPermissions.some(p => state.currentUser.permissions.includes(p))) {
            if (DOM.savedReportsList) DOM.savedReportsList.innerHTML = '<div class="empty-state">Hisobotlarni ko\'rish uchun ruxsat yo\'q.</div>';
            return;
        }

        if (DOM.savedReportsList) DOM.savedReportsList.innerHTML = Array(5).fill('<div class="skeleton-item"></div>').join('');
        try {
            const params = new URLSearchParams(state.filters);
            const res = await fetch(`/api/reports?${params.toString()}`);
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || "Hisobotlarni yuklashda xatolik.");
            }
            
            const data = await res.json();
            state.savedReports = data.reports;
            state.pagination = { total: data.total, pages: data.pages, currentPage: data.currentPage };
            
            state.existingDates = {};
            // ... fetchAndRenderReports funksiyasining davomi
            Object.values(data.reports).forEach(report => {
                if (!state.existingDates[report.location]) {
                    state.existingDates[report.location] = new Set();
                }
                state.existingDates[report.location].add(report.date);
            });

            renderSavedReports();
            renderPagination();
        } catch (error) {
            showToast(error.message, true);
            if (DOM.savedReportsList) DOM.savedReportsList.innerHTML = `<div class="empty-state error">${error.message}</div>`;
        }
    }

    function setupDatePickers() {
        if (DOM.datePickerEl) {
            datePickerFP = flatpickr(DOM.datePickerEl, {
                locale: 'uz', 
                dateFormat: 'Y-m-d',
                altInput: true, 
                altFormat: 'd.m.Y', 
                static: true,
                allowInput: false,
                onChange: validateDate,
                onClose: validateDate,
            });
        }
        if (DOM.filterDateRange) {
            dateFilterFP = flatpickr(DOM.filterDateRange.parentElement, {
                mode: "range", dateFormat: "Y-m-d", locale: 'uz', wrap: true,
                onChange: (selectedDates) => {
                    if (selectedDates.length === 2) {
                        state.filters.startDate = flatpickr.formatDate(selectedDates[0], 'Y-m-d');
                        state.filters.endDate = flatpickr.formatDate(selectedDates[1], 'Y-m-d');
                    } else {
                        state.filters.startDate = '';
                        state.filters.endDate = '';
                    }
                    state.filters.page = 1;
                    fetchAndRenderReports();
                }
            });
        }
    }

    function validateDate() {
        if (!state.isEditMode) return;

        const selectedDateStr = datePickerFP.input.value;
        const location = DOM.locationSelect.value;
        DOM.datePickerWrapper.classList.remove('date-valid', 'date-invalid', 'date-attention');

        if (!selectedDateStr) {
            DOM.datePickerWrapper.classList.add('date-attention');
            DOM.confirmBtn.disabled = true;
            return;
        }

        const formattedDate = datePickerFP.selectedDates.length > 0
            ? flatpickr.formatDate(datePickerFP.selectedDates[0], 'Y-m-d')
            : null;

        if (state.existingDates[location] && state.existingDates[location].has(formattedDate)) {
            DOM.datePickerWrapper.classList.add('date-invalid');
            showToast(`"${location}" filiali uchun bu sanada hisobot mavjud!`, true);
            DOM.confirmBtn.disabled = true;
        } else {
            DOM.datePickerWrapper.classList.add('date-valid');
            DOM.confirmBtn.disabled = false;
        }
    }

    function buildTable() {
        const { columns = [], rows = [] } = state.settings.app_settings || {};
        if (!DOM.tableHead || !DOM.tableBody || !DOM.tableFoot) return;
        
        if (columns.length === 0 || rows.length === 0) {
            DOM.tableBody.innerHTML = '<tr><td colspan="100%"><div class="empty-state">Jadval sozlanmagan. Administrator panelidan ustun va qatorlarni qo\'shing.</div></td></tr>';
            DOM.tableHead.innerHTML = ''; DOM.tableFoot.innerHTML = ''; return;
        }

        DOM.tableHead.innerHTML = `<tr><th>Ko'rsatkich</th>${columns.map(c => `<th>${c}</th>`).join('')}<th>Jami</th></tr>`;
        DOM.tableBody.innerHTML = rows.map(rowName => `
            <tr>
                <td data-label="Ko'rsatkich">${rowName}</td>
                ${columns.map(colName => `<td data-label="${colName}"><input type="text" class="form-control numeric-input" data-key="${rowName}_${colName}" placeholder="0"></td>`).join('')}
                <td data-label="Jami" class="row-total">0</td>
            </tr>`).join('');
        DOM.tableFoot.innerHTML = `<tr><td>Jami</td>${columns.map(c => `<td class="col-total" data-col="${c}">0</td>`).join('')}<td id="grand-total">0</td></tr>`;
    }

    function renderSavedReports() {
        if (!DOM.savedReportsList) return;
        const reportIds = Object.keys(state.savedReports);
        if (reportIds.length === 0) {
            DOM.savedReportsList.innerHTML = '<div class="empty-state">Hisobotlar topilmadi.</div>';
            return;
        }
        DOM.savedReportsList.innerHTML = reportIds.map(id => {
            const report = state.savedReports[id];
            const editInfo = report.edit_count > 0 ? `<div class="report-edit-info">✍️ Tahrirlangan (${report.edit_count})</div>` : '';
            return `
                <div class="report-item" data-id="${id}">
                    <div class="report-item-content">#${formatReportId(id)} - ${report.location} - ${report.date}</div>
                    ${editInfo}
                </div>`;
        }).join('');
    }
    
    function updateTableValues(reportData = {}) {
        if (!DOM.tableBody) return;
        DOM.tableBody.querySelectorAll('.numeric-input').forEach(input => {
            const value = reportData[input.dataset.key] || '';
            input.value = value ? formatNumber(value) : '';
        });
        updateCalculations();
    }

    function updateCalculations() {
        let grandTotal = 0;
        const columns = state.settings.app_settings?.columns || [];
        const columnTotals = columns.reduce((acc, col) => ({ ...acc, [col]: 0 }), {});

        if (DOM.tableBody) DOM.tableBody.querySelectorAll('tr').forEach(row => {
            let rowTotal = 0;
            row.querySelectorAll('.numeric-input').forEach(input => {
                const value = parseNumber(input.value);
                rowTotal += value;
                const colName = input.parentElement.dataset.label;
                if (columnTotals.hasOwnProperty(colName)) {
                    columnTotals[colName] += value;
                }
            });
            const rowTotalCell = row.querySelector('.row-total');
            if (rowTotalCell) rowTotalCell.textContent = formatNumber(rowTotal);
            grandTotal += rowTotal;
        });

        if (DOM.tableFoot) {
            DOM.tableFoot.querySelectorAll('.col-total').forEach(cell => {
                cell.textContent = formatNumber(columnTotals[cell.dataset.col]);
            });
            const grandTotalCell = document.getElementById('grand-total');
            if (grandTotalCell) grandTotalCell.textContent = formatNumber(grandTotal);
        }
        renderSummary();
    }

    function renderSummary() {
        if (!DOM.summaryList || !DOM.summaryWrapper || !DOM.summaryTotal) return;
        DOM.summaryList.innerHTML = '';
        let hasData = false;
        if (DOM.tableBody) DOM.tableBody.querySelectorAll('tr').forEach(row => {
            const rowName = row.cells[0].textContent;
            const rowTotal = parseNumber(row.querySelector('.row-total')?.textContent);
            if (rowTotal > 0) {
                hasData = true;
                DOM.summaryList.innerHTML += `<div class="summary-item"><span>${rowName}</span><span>${formatNumber(rowTotal)} so'm</span></div>`;
            }
        });
        const grandTotalText = document.getElementById('grand-total')?.textContent;
        if (hasData) {
            DOM.summaryTotal.textContent = `Umumiy summa: ${grandTotalText} so'm`;
            DOM.summaryWrapper.classList.remove('hidden');
        } else {
            DOM.summaryWrapper.classList.add('hidden');
        }
    }

    // === MUAMMO TUZATILGAN JOY ===
    function populateLocations() {
        if (!DOM.locationSelect) return;
        
        const allSystemLocations = state.settings.app_settings?.locations || [];
        const userAssignedLocations = state.currentUser?.locations || [];
        const userPermissions = state.currentUser?.permissions || [];
    
        let locationsToShow = [];
    
        // Agar foydalanuvchi admin yoki barcha hisobotlarni ko'ra oladigan bo'lsa,
        // tizimdagi barcha filiallar ko'rsatiladi.
        if (userPermissions.includes('reports:view_all')) {
            locationsToShow = allSystemLocations;
        } 
        // Aks holda (oddiy operator yoki faqat biriktirilgan filialni ko'radigan menejer),
        // faqat o'ziga biriktirilgan filiallar ko'rsatiladi.
        else {
            locationsToShow = userAssignedLocations;
        }
    
        if (locationsToShow.length > 0) {
            DOM.locationSelect.innerHTML = locationsToShow.map(loc => `<option value="${loc}">${loc}</option>`).join('');
        } else {
            DOM.locationSelect.innerHTML = '<option value="">Filiallar topilmadi</option>';
        }
    }
    // ============================

    function setInputsReadOnly(isReadOnly) {
        if (DOM.tableBody) DOM.tableBody.querySelectorAll('.numeric-input').forEach(input => input.disabled = isReadOnly);
        if (datePickerFP) datePickerFP.set('clickOpens', !isReadOnly);
        if (DOM.locationSelect) DOM.locationSelect.disabled = isReadOnly;
    }

    function updateUIForReportState() {
        const isNew = state.currentReportId === null;
        const report = state.savedReports[state.currentReportId];
        const canEdit = report && (state.currentUser.permissions.includes('reports:edit_all') ||
                        (state.currentUser.permissions.includes('reports:edit_assigned') && state.currentUser.locations.includes(report.location)) ||
                        (state.currentUser.permissions.includes('reports:edit_own') && report.created_by === state.currentUser.id));
        
        DOM.confirmBtn.classList.toggle('hidden', !state.isEditMode);
        DOM.editBtn.classList.toggle('hidden', isNew || state.isEditMode || !canEdit);
        DOM.historyBtn.classList.toggle('hidden', isNew);
        
        DOM.datePickerWrapper.classList.remove('date-valid', 'date-invalid', 'date-attention');

        setInputsReadOnly(!state.isEditMode);

        if (state.isEditMode && isNew) {
            DOM.datePickerWrapper.classList.add('date-attention'); 
            DOM.confirmBtn.disabled = true; 
        } else {
            DOM.confirmBtn.disabled = false;
        }
    }

    function createNewReport() {
        if (!state.currentUser.permissions.includes('reports:create')) {
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
        feather.replace();
    }

    function loadReport(reportId) {
        const report = state.savedReports[reportId];
        if (!report) return;

        state.currentReportId = reportId;
        state.isEditMode = false;

        const originalSettings = state.settings.app_settings;
        state.settings.app_settings = report.settings;
        buildTable();
        state.settings.app_settings = originalSettings;
        
        updateTableValues(report.data);

        if (DOM.reportIdBadge) {
            DOM.reportIdBadge.textContent = `#${formatReportId(reportId)}`;
            DOM.reportIdBadge.className = 'badge saved';
        }
        if (datePickerFP) datePickerFP.setDate(report.date, true);
        if (DOM.locationSelect) DOM.locationSelect.value = report.location;

        document.querySelectorAll('.report-item.active').forEach(item => item.classList.remove('active'));
        document.querySelector(`.report-item[data-id='${reportId}']`)?.classList.add('active');
        updateUIForReportState();
    }

    function renderPagination() {
        if (!DOM.paginationControls) return;
        const { pages, currentPage } = state.pagination;
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
        feather.replace();
    }

    async function handleConfirm(lateComment) {
        const selectedDate = datePickerFP?.selectedDates[0];
        if (!selectedDate) {
            showToast("Iltimos, hisobot sanasini tanlang!", true);
            DOM.datePickerWrapper.classList.add('date-attention');
            return;
        }
        
        const grandTotal = parseNumber(document.getElementById('grand-total')?.textContent || '0');
        if (grandTotal === 0) {
            showToast("Hisobotga hech qanday ma'lumot kiritilmadi!", true);
            return;
        }

        const formattedDate = flatpickr.formatDate(selectedDate, 'Y-m-d');
        const location = DOM.locationSelect.value;
        const isUpdating = state.currentReportId && state.isEditMode;

        if (!isUpdating && state.existingDates[location] && state.existingDates[location].has(formattedDate)) {
            showToast(`"${location}" filiali uchun bu sanada hisobot mavjud!`, true);
            DOM.datePickerWrapper.classList.add('date-invalid');
            return;
        }

        if (!state.currentReportId && lateComment === null) {
            const now = new Date();
            const reportDate = new Date(selectedDate);
            reportDate.setDate(reportDate.getDate() + 1);
            reportDate.setHours(9, 0, 0, 0);
            if (now > reportDate) {
                if (DOM.lateCommentInput) DOM.lateCommentInput.value = '';
                if (DOM.lateCommentModal) DOM.lateCommentModal.classList.remove('hidden');
                return;
            }
        }

        const reportData = {
            date: formattedDate,
            location: location,
            settings: state.settings.app_settings,
            data: {},
            late_comment: lateComment
        };
        DOM.tableBody?.querySelectorAll('.numeric-input').forEach(input => {
            reportData.data[input.dataset.key] = parseNumber(input.value);
        });

        const url = isUpdating ? `/api/reports/${state.currentReportId}` : '/api/reports';
        const method = isUpdating ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reportData) });
            const result = await res.json();
            if (!res.ok) throw new Error(result.message);
            
            showToast(result.message);
            await fetchAndRenderReports();
            const newId = isUpdating ? state.currentReportId : result.reportId;
            setTimeout(() => {
                const reportElement = document.querySelector(`.report-item[data-id='${newId}']`);
                if (reportElement) {
                    reportElement.click();
                } else {
                    fetchAndRenderReports().then(() => {
                         document.querySelector(`.report-item[data-id='${newId}']`)?.click();
                    });
                }
            }, 200);
        } catch (error) {
            showToast(error.message, true);
        }
    }

    function handleEdit() {
        state.isEditMode = true;
        if (DOM.confirmBtn) DOM.confirmBtn.innerHTML = "<i data-feather='save'></i> O'ZGARISHLARNI SAQLASH";
        updateUIForReportState();
        feather.replace();
    }

    async function showHistory() {
        if (!state.currentReportId || !DOM.historyModal || !DOM.historyModalBody) return;
        
        DOM.historyModalBody.innerHTML = '<div class="skeleton-item" style="height: 200px;"></div>';
        DOM.historyModal.classList.remove('hidden');

        try {
            const res = await fetch(`/api/reports/${state.currentReportId}/history`);
            if (!res.ok) throw new Error('Tarixni yuklab bo\'lmadi');
            
            const fullHistory = await res.json();
            
            if (fullHistory.length <= 1) {
                DOM.historyModalBody.innerHTML = '<div class="empty-state">Bu hisobot uchun o\'zgarishlar tarixi topilmadi.</div>';
                return;
            }
            
            const reportSettings = state.savedReports[state.currentReportId]?.settings || state.settings.app_settings;
            const allColumns = reportSettings.columns || [];
            
            let historyHtml = `
                <div class="ultimate-history-table">
                    <div class="ultimate-history-header">
                        <div class="col-meta">O'zgarish sanasi</div>
                        <div class="col-row-name">Maydon</div>
                        ${allColumns.map(col => `<div class="col-value">${col}</div>`).join('')}
                    </div>
                    <div class="ultimate-history-body">`;

            for (let i = 0; i < fullHistory.length - 1; i++) {
                const newState = fullHistory[i];
                const oldState = fullHistory[i + 1];

                const newData = JSON.parse(newState.data);
                const oldData = JSON.parse(oldState.data);

                let changesHtml = '';

                if (newState.report_date !== oldState.report_date) {
                    const formattedNew = new Date(newState.report_date).toLocaleDateString('uz-UZ');
                    const formattedOld = oldState.report_date ? new Date(oldState.report_date).toLocaleDateString('uz-UZ') : 'N/A';
                    changesHtml += renderHistoryChange('Sana', formattedNew, formattedOld);
                }
                if (newState.location !== oldState.location) {
                    changesHtml += renderHistoryChange('Filial', newState.location, oldState.location || 'N/A');
                }

                const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
                const valueChangesByRow = {};

                allKeys.forEach(key => {
                    const oldValue = oldData[key] || 0;
                    const newValue = newData[key] || 0;
                    if (oldValue !== newValue) {
                        const [rowName, ...colParts] = key.split('_');
                        const colName = colParts.join('_');
                        if (!valueChangesByRow[rowName]) {
                            valueChangesByRow[rowName] = {};
                        }
                        valueChangesByRow[rowName][colName] = { oldValue, newValue };
                    }
                });

                changesHtml += Object.entries(valueChangesByRow).map(([rowName, cols]) => `
                    <div class="change-row">
                        <div class="col-row-name">${rowName}</div>
                        ${allColumns.map(col => {
                            const change = cols[col];
                            return change 
                                ? `<div class="col-value"><span class="old-value">${formatNumber(change.oldValue)}</span><span class="new-value">${formatNumber(change.newValue)}</span></div>`
                                : '<div class="col-value"></div>';
                        }).join('')}
                    </div>
                `).join('');

                if (changesHtml) {
                     historyHtml += `
                        <div class="history-group">
                            <div class="col-meta">
                                <div class="timestamp">${new Date(newState.changed_at).toLocaleString('uz-UZ')}</div>
                                <div class="user-info">${newState.changed_by_username}</div>
                            </div>
                            <div class="group-changes-grid">
                                ${changesHtml}
                            </div>
                        </div>`;
                }
            }

            historyHtml += '</div></div>';
            DOM.historyModalBody.innerHTML = historyHtml;

        } catch (error) {
            DOM.historyModalBody.innerHTML = `<div class="empty-state error">${error.message}</div>`;
        }
    }

    function renderHistoryChange(label, newValue, oldValue) {
        return `
            <div class="change-row">
                <div class="col-row-name" style="background-color: rgba(111, 66, 193, 0.2);">${label}</div>
                <div class="col-value" style="grid-column: 2 / -1; align-items: flex-start;">
                    <span class="old-value">${oldValue}</span>
                    <span class="new-value">${newValue}</span>
                </div>
            </div>
        `;
    }

    function exportToExcel() {
        const table = document.getElementById('main-table');
        if (!table) return;
    
        const wb = XLSX.utils.table_to_book(table, { sheet: "Hisobot" });
        
        const date = DOM.datePickerEl.value || 'hisobot';
        const location = DOM.locationSelect.value || 'noma\'lum';
        const fileName = `${location}_${date}.xlsx`;
    
        XLSX.writeFile(wb, fileName);
        showToast("Excel fayl muvaffaqiyatli yaratildi!");
    }

    function setupEventListeners() {
        const addSafeListener = (element, event, handler) => {
            if (element) element.addEventListener(event, handler);
        };

        addSafeListener(DOM.newReportBtn, 'click', createNewReport);
        addSafeListener(DOM.logoutBtn, 'click', async () => {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login';
        });
        addSafeListener(DOM.savedReportsList, 'click', e => {
            const item = e.target.closest('.report-item');
            if (item && item.dataset.id) loadReport(item.dataset.id);
        });
        addSafeListener(DOM.tableBody, 'input', e => {
            if (e.target.classList.contains('numeric-input')) {
                const input = e.target;
                const value = input.value.replace(/\s/g, '');
                const cursorPosition = input.selectionStart;
                const oldLength = input.value.length;
                input.value = formatNumber(value.replace(/[^0-9]/g, ''));
                const newLength = input.value.length;
                if (cursorPosition !== null) {
                    input.setSelectionRange(cursorPosition + (newLength - oldLength), cursorPosition + (newLength - oldLength));
                }
                updateCalculations();
            }
        });
        
        addSafeListener(DOM.confirmBtn, 'click', () => handleConfirm(null));
        addSafeListener(DOM.editBtn, 'click', handleEdit);
        addSafeListener(DOM.searchInput, 'input', debounce(e => {
            state.filters.searchTerm = e.target.value;
            state.filters.page = 1;
            fetchAndRenderReports();
        }, 300));
        addSafeListener(DOM.paginationControls, 'click', e => {
            const btn = e.target.closest('.pagination-btn');
            if (!btn) return;
            if (btn.id === 'prev-page-btn' && state.pagination.currentPage > 1) {
                state.filters.page--;
                fetchAndRenderReports();
            } else if (btn.id === 'next-page-btn' && state.pagination.currentPage < state.pagination.pages) {
                state.filters.page++;
                fetchAndRenderReports();
            }
        });
        addSafeListener(DOM.historyBtn, 'click', showHistory);
        document.querySelectorAll('.close-modal-btn').forEach(btn => {
            addSafeListener(btn, 'click', () => {
                const targetModal = document.getElementById(btn.dataset.target);
                if (targetModal) targetModal.classList.add('hidden');
            });
        });

        addSafeListener(DOM.lateCommentForm, 'submit', e => {
            e.preventDefault();
            const comment = DOM.lateCommentInput.value.trim();
            if (comment) {
                DOM.lateCommentModal?.classList.add('hidden');
                handleConfirm(comment);
            } else {
                showToast("Iltimos, kechikish sababini kiriting!", true);
            }
        });
        addSafeListener(DOM.reportFilterButtons, 'click', e => {
            const btn = e.target.closest('.filter-btn');
            if (!btn) return;
            DOM.reportFilterButtons.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.filters.filter = btn.dataset.filter;
            state.filters.page = 1;
            fetchAndRenderReports();
        });
        addSafeListener(DOM.excelBtn, 'click', exportToExcel);

        addSafeListener(DOM.locationSelect, 'change', validateDate);
    }

    // Dasturni ishga tushirish
    init();
});

