// --- Modern Confirm Dialog ---
window.showConfirm = function(message, title = 'Tasdiqlash') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');
        
        titleEl.textContent = title;
        messageEl.textContent = message;
        
        modal.classList.remove('hidden');
        
        const handleOk = () => {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            resolve(true);
        };
        
        const handleCancel = () => {
            modal.classList.add('hidden');
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            resolve(false);
        };
        
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        
        // ESC tugmasi bilan yopish
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
        
        // Feather icons'ni yangilash
        setTimeout(() => feather.replace(), 10);
    });
};

document.addEventListener('DOMContentLoaded', () => {
    // --- Global Holat (State) ---
    const state = {
        settings: {
            app_settings: { columns: [], locations: [] },
            pagination_limit: 20,
            branding_settings: { text: 'MANUS', color: '#4CAF50', animation: 'anim-glow-pulse', border: 'border-none' }
        },
        filters: {
            page: 1
        },
        pagination: {
            currentPage: 1,
            pages: 1
        },
        existingDates: {} // Boshlang'ich qiymat
    };
    
    // Global o'zgaruvchilar
    let datePickerFP = null;
    let dateFilterFP = null;
// --- KPI Cards Render ---
const renderKpiCards = (stats) => {
    let kpiCardsHtml = '';
    // Umumiy KPI - To'q ko'k rang (kechikkan va tahrirlanganlar umumiy KPI dan ayiriladi)
    const latePenaltyValue = stats.latePenalty || 0.5;
    const editPenaltyValue = stats.editPenalty || 0.3;
    const lateDeduction = Math.round((stats.latePercent || 0) * latePenaltyValue);
    const editDeduction = Math.round((stats.editedPercent || 0) * editPenaltyValue);
    const baseKpi = stats.ontimePercent || 0;
    
    kpiCardsHtml += `
        <div class="kpi-card kpi-main-card" style="background: linear-gradient(135deg, #2563eb, #1e40af); box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);">
            <div class="kpi-card-icon" style="background: rgba(255,255,255,0.2); color: #fff; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; border-radius: 12px; flex-shrink: 0;">
                <i data-feather="file-text" style="width: 26px; height: 26px;"></i>
            </div>
            <div class="kpi-card-info" style="flex: 1;">
                <div class="kpi-card-title">Umumiy KPI</div>
                <div class="kpi-card-value-wrapper">
                    <span class="kpi-number">${stats.total}</span>
                    <span class="kpi-percent">${stats.kpiPercent}%</span>
                </div>
                <div style="font-size: 11px; opacity: 0.85; margin-top: 4px; line-height: 1.4;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                        <span>O'z vaqtida:</span>
                        <span style="font-weight: 600;">${baseKpi}%</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 2px; color: rgba(255, 200, 200, 0.9);">
                        <span>Kechikkan (-${latePenaltyValue * 100}%):</span>
                        <span style="font-weight: 600;">-${lateDeduction}%</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; color: rgba(255, 230, 200, 0.9);">
                        <span>Tahrirlangan (-${editPenaltyValue * 100}%):</span>
                        <span style="font-weight: 600;">-${editDeduction}%</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    // O'z vaqtida - To'q yashil rang
    kpiCardsHtml += `
        <div class="kpi-card" style="background: linear-gradient(135deg, #16a34a, #15803d); box-shadow: 0 6px 16px rgba(22, 163, 74, 0.35);">
            <div class="kpi-card-icon" style="background: rgba(255,255,255,0.2); color: #fff; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; border-radius: 12px; flex-shrink: 0;">
                <i data-feather="check-circle" style="width: 26px; height: 26px;"></i>
            </div>
            <div class="kpi-card-info">
                <div class="kpi-card-title">O'z Vaqtida</div>
                <div class="kpi-card-value-wrapper">
                    <span class="kpi-number">${stats.ontime}</span>
                    <span class="kpi-percent">${stats.ontimePercent || 0}%</span>
                </div>
            </div>
        </div>
    `;
    // Kechikkan - To'q qizil rang
    kpiCardsHtml += `
        <div class="kpi-card" style="background: linear-gradient(135deg, #dc2626, #b91c1c); box-shadow: 0 6px 16px rgba(220, 38, 38, 0.35);">
            <div class="kpi-card-icon" style="background: rgba(255,255,255,0.2); color: #fff; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; border-radius: 12px; flex-shrink: 0;">
                <i data-feather="clock" style="width: 26px; height: 26px;"></i>
            </div>
            <div class="kpi-card-info">
                <div class="kpi-card-title">Kechikkan</div>
                <div class="kpi-card-value-wrapper">
                    <span class="kpi-number">${stats.late}</span>
                    <span class="kpi-percent">${stats.latePercent}%</span>
                </div>
            </div>
        </div>
    `;
    // Tahrirlangan - To'q sariq/oltin rang
    kpiCardsHtml += `
        <div class="kpi-card" style="background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 6px 16px rgba(245, 158, 11, 0.35);">
            <div class="kpi-card-icon" style="background: rgba(255,255,255,0.2); color: #fff; width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; border-radius: 12px; flex-shrink: 0;">
                <i data-feather="edit-2" style="width: 26px; height: 26px;"></i>
            </div>
            <div class="kpi-card-info">
                <div class="kpi-card-title">Tahrirlangan</div>
                <div class="kpi-card-value-wrapper">
                    <span class="kpi-number">${stats.edited}</span>
                    <span class="kpi-percent">${stats.editedPercent}%</span>
                </div>
            </div>
        </div>
    `;
    return kpiCardsHtml;
}
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
            const userRes = await fetch('/api/auth/current-user');
            if (!userRes.ok) {
                window.location.href = '/login';
                return;
            }
            state.currentUser = await userRes.json();
            
            // State modulidagi currentUser'ni ham yangilash
            try {
                const { state: globalState } = await import('./modules/state.js');
                globalState.currentUser = state.currentUser;
                console.log('✅ [INIT] Global state.currentUser o\'rnatildi:', state.currentUser.username);
            } catch (error) {
                console.warn('⚠️ [INIT] Global state modulini yuklashda xatolik:', error);
            }
            
            // Window obyektiga ham qo'shish (realtime modul uchun)
            window.currentUserId = state.currentUser.id;
            window.currentUsername = state.currentUser.username;
            
            updateUserInfo();
            applyRolePermissions();
            
            // Valyuta sozlamasini yuklash
            if (state.currentUser.preferred_currency && DOM.currencySelect) {
                DOM.currencySelect.value = state.currentUser.preferred_currency;
                DOM.currencySelect.classList.remove('currency-not-selected');
            } else if (DOM.currencySelect) {
                DOM.currencySelect.value = '';
                DOM.currencySelect.classList.add('currency-not-selected');
            }
            
            // Valyuta tanlanmagan bo'lsa, doimo qizil pulsatsiya ko'rsatish
            setInterval(() => {
                if (DOM.currencySelect && !DOM.currencySelect.value) {
                    DOM.currencySelect.classList.add('currency-not-selected');
                }
            }, 1000);

            try {
                const settingsRes = await fetch('/api/settings');
                if (settingsRes.ok) {
                    const allSettings = await settingsRes.json();
                    state.settings.app_settings = allSettings.app_settings || { columns: [], rows: [], locations: [] };
                    state.settings.branding_settings = allSettings.branding_settings || state.settings.branding_settings;
                    state.settings.pagination_limit = allSettings.pagination_limit || 20;
                }
            } catch (error) {
                console.warn('Settings yuklanmadi, default qiymatlar ishlatiladi');
            }
            
            applyBranding(state.settings.branding_settings);

            await buildTable(); 
            setupDatePickers();
            loadUserLocations();
            populateLocations();
            
            // Filial o'zgarganda jadval avtomatik yangilansin
            if (DOM.locationSelect) {
                DOM.locationSelect.addEventListener('change', async () => {
                    await buildTable();
                    updateCalculations();
                });
            }
            
            await fetchAndRenderReports();
            setupEventListeners();
            feather.replace();
            
            // Real-time modulini ishga tushirish (state.currentUser o'rnatilgandan keyin)
            try {
                const { initRealTime } = await import('./modules/realtime.js');
                initRealTime();
                console.log('✅ [INIT] Real-time modul ishga tushirildi');
            } catch (error) {
                console.error('❌ [INIT] Real-time modulni yuklashda xatolik:', error);
            }
            
            // KPI va sessiya statistikasini yuklash
            if (typeof loadKPIStats === 'function') {
                loadKPIStats();
            }
            if (typeof loadSessionStats === 'function') {
                loadSessionStats();
            }
            
            // Agar filiallar bo'lmasa, hisobot yaratishni to'xtatish
            if (state.userLocations.length === 0) {
                if(DOM.tableBody) DOM.tableBody.innerHTML = '<tr><td colspan="100%"><div class="empty-state">Sizga biriktirilgan filiallar mavjud emas. Iltimos, administrator bilan bog\'laning.</div></td></tr>';
                if (DOM.confirmBtn) DOM.confirmBtn.classList.add('hidden');
                if (DOM.editBtn) DOM.editBtn.classList.add('hidden');
            } else if (state.currentUser.permissions.includes('reports:create')) {
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
        
        // Ruxsatlar mapping (tahrirlash ruxsati bo'lsa, ko'rish ruxsati ham beriladi)
        const permissionMapping = {
            'reports:edit_all': 'reports:view_all',
            'reports:edit_assigned': 'reports:view_assigned',
            'reports:edit_own': 'reports:view_own'
        };
        
        // Virtual permissions qo'shish (tahrirlash ruxsati bo'lsa, ko'rish ruxsati ham qo'shiladi)
        const virtualPermissions = [...userPermissions];
        userPermissions.forEach(perm => {
            if (permissionMapping[perm] && !virtualPermissions.includes(permissionMapping[perm])) {
                virtualPermissions.push(permissionMapping[perm]);
            }
        });
        
        // Admin panel tugmasini ko'rsatish - agar quyidagi huquqlardan biri bo'lsa
        const adminPanelPermissions = ['dashboard:view', 'users:view', 'settings:view', 'roles:manage', 'audit:view'];
        const hasAdminAccess = adminPanelPermissions.some(p => virtualPermissions.includes(p));
        
        if (hasAdminAccess) {
            const adminPanelBtn = document.getElementById('admin-panel-btn');
            if (adminPanelBtn) {
                adminPanelBtn.classList.remove('hidden');
            }
        }
        
        document.querySelectorAll('[data-permission]').forEach(el => {
            const requiredPermissions = el.dataset.permission.split(',').map(p => p.trim());
            const hasPermission = requiredPermissions.some(p => virtualPermissions.includes(p));
            if (!hasPermission) {
                el.style.display = 'none';
            } else {
                el.style.display = '';
            }
        });
    }
    
    function updateUserInfo() {
        const usernameEl = document.getElementById('current-username');
        const roleEl = document.getElementById('current-user-role');
        
        if (usernameEl) usernameEl.textContent = state.currentUser.username || 'Foydalanuvchi';
        if (roleEl) roleEl.textContent = state.currentUser.role || '';
        
        // Avatar yuklash
        loadUserAvatar();
    }
    
    async function loadUserAvatar() {
        try {
            const res = await fetch('/api/users/me/avatar');
            const avatarDisplay = document.getElementById('user-avatar-display');
            const badge = '<span class="avatar-status-badge"></span>';
            
            if (res.ok) {
                const data = await res.json();
                
                if (data.avatar_url && avatarDisplay) {
                    avatarDisplay.innerHTML = `<img src="${data.avatar_url}" alt="Avatar">${badge}`;
                } else if (avatarDisplay) {
                    avatarDisplay.innerHTML = `<i data-feather="user"></i>${badge}`;
                    feather.replace();
                }
            } else {
                if (avatarDisplay) {
                    avatarDisplay.innerHTML = `<i data-feather="user"></i>${badge}`;
                    feather.replace();
                }
            }
        } catch (error) {
            console.error('Avatar yuklashda xatolik:', error);
            const avatarDisplay = document.getElementById('user-avatar-display');
            if (avatarDisplay) {
                avatarDisplay.innerHTML = `<i data-feather="user"></i><span class="avatar-status-badge"></span>`;
                feather.replace();
            }
        }
    }

    async function fetchAndRenderReports() {
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
                let errorData;
                try {
                    errorData = await res.json();
                } catch (e) {
                    errorData = { message: `Server xatolik: ${res.status} ${res.statusText}` };
                }
                throw new Error(errorData.message || "Hisobotlarni yuklashda xatolik.");
            }
            
            const data = await res.json();
            console.log('[FRONTEND] API javob:', { 
                reportsType: typeof data.reports, 
                reportsIsArray: Array.isArray(data.reports),
                reportsKeys: data.reports ? Object.keys(data.reports) : [],
                reportsCount: data.reports ? (Array.isArray(data.reports) ? data.reports.length : Object.keys(data.reports).length) : 0,
                total: data.total,
                pages: data.pages
            });
            
            // Reports formatini to'g'rilash
            state.existingDates = {};
            if (data.reports) {
                if (Array.isArray(data.reports)) {
                    // Agar array bo'lsa, obyektga o'tkazish
                    const reportsObj = {};
                    data.reports.forEach(report => {
                        reportsObj[report.id] = report;
                        if (!state.existingDates[report.location]) {
                            state.existingDates[report.location] = new Set();
                        }
                        state.existingDates[report.location].add(report.date);
                    });
                    state.savedReports = reportsObj;
                    state.reports = reportsObj;
                } else {
                    // Agar obyekt bo'lsa, to'g'ridan-to'g'ri ishlatish
                    state.savedReports = data.reports;
                    state.reports = data.reports;
                    Object.values(data.reports).forEach(report => {
                        if (!state.existingDates[report.location]) {
                            state.existingDates[report.location] = new Set();
                        }
                        state.existingDates[report.location].add(report.date);
                    });
                }
            } else {
                state.savedReports = {};
                state.reports = {};
            }
            
            state.pagination = { total: data.total, pages: data.pages, currentPage: data.currentPage };

            console.log('[FRONTEND] State.savedReports:', {
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

    function setupDatePickers() {
        if (DOM.datePickerEl) {
            datePickerFP = flatpickr(DOM.datePickerEl, {
                locale: 'uz', 
                dateFormat: 'Y-m-d',
                altInput: true, 
                altFormat: 'd.m.Y', 
                static: true,
                allowInput: false,
                onChange: (selectedDates) => {
                    validateDate();
                    // localStorage'ga saqlash
                    saveFormDataToLocalStorage();
                },
                onClose: () => {
                    validateDate();
                    // localStorage'ga saqlash
                    saveFormDataToLocalStorage();
                },
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
        if (!state.isEditMode || !DOM.locationSelect || !DOM.datePickerWrapper) return;

        const selectedDateStr = datePickerFP.input.value;
        const location = DOM.locationSelect.value;
        DOM.datePickerWrapper.classList.remove('date-valid', 'date-invalid', 'date-attention');

        if (!selectedDateStr) {
            DOM.datePickerWrapper.classList.add('date-attention');
            if (DOM.confirmBtn) DOM.confirmBtn.disabled = true;
            return;
        }

        const formattedDate = datePickerFP.selectedDates.length > 0
            ? flatpickr.formatDate(datePickerFP.selectedDates[0], 'Y-m-d')
            : null;

        // existingDates ni tekshirish va boshlang'ich qiymatni o'rnatish
        if (!state.existingDates) {
            state.existingDates = {};
        }

        if (state.existingDates[location] && state.existingDates[location].has(formattedDate)) {
            DOM.datePickerWrapper.classList.add('date-invalid');
            showToast(`"${location}" filiali uchun bu sanada hisobot mavjud!`, true);
            if (DOM.confirmBtn) DOM.confirmBtn.disabled = true;
        } else {
            DOM.datePickerWrapper.classList.add('date-valid');
            if (DOM.confirmBtn) DOM.confirmBtn.disabled = false;
        }
    }

    async function buildTable() {
        const { columns = [] } = state.settings.app_settings || {};
        
        if (!DOM.tableHead || !DOM.tableBody || !DOM.tableFoot) {
            console.error('❌ DOM elementlari topilmadi!');
            return;
        }
        
        // Tanlangan filialga qarab brendlarni yuklash
        let brands = [];
        try {
            const selectedLocation = DOM.locationSelect?.value;
            
            let url = '/api/brands';
            if (selectedLocation) {
                url += `?location=${encodeURIComponent(selectedLocation)}`;
            }
            
            const res = await fetch(url);
            if (res.ok) {
                brands = await res.json();
            } else {
                console.error('❌ Brendlar yuklanmadi, status:', res.status);
            }
        } catch (error) {
            console.error('❌ Brendlarni yuklash xatosi:', error);
        }
        
        if (columns.length === 0) {
            DOM.tableBody.innerHTML = '<tr><td colspan="100%"><div class="empty-state">Jadval sozlanmagan. Administrator panelidan ustunlarni qo\'shing.</div></td></tr>';
            DOM.tableHead.innerHTML = ''; DOM.tableFoot.innerHTML = ''; return;
        }
        
        if (brands.length === 0) {
            const selectedLocation = DOM.locationSelect?.value;
            const message = selectedLocation 
                ? `${selectedLocation} fililiga tegishli brendlar topilmadi. Administrator panelidan brendlarni qo'shing.`
                : 'Brendlar topilmadi. Administrator panelidan brendlarni qo\'shing.';
            DOM.tableBody.innerHTML = `<tr><td colspan="100%"><div class="empty-state">${message}</div></td></tr>`;
            DOM.tableHead.innerHTML = ''; DOM.tableFoot.innerHTML = ''; return;
        }

        // Ranglar ro'yxati (takrorlanmas, pastel va ko'zga yoqimli)
        const autoColors = [
            '#4facfe', '#43e97b', '#fa709a', '#f7971e', '#30cfd0', '#667eea', '#f857a6', '#76b852', '#e100ff', '#f7971e',
            '#11998e', '#ee0979', '#ff6a00', '#00c3ff', '#f953c6', '#43cea2', '#ffb347', '#ff5f6d', '#36d1c4', '#f7797d'
        ];
        let colorIdx = 0;
        const usedColors = new Set();

        DOM.tableHead.innerHTML = `<tr><th>Brend</th>${columns.map(c => `<th>${c}</th>`).join('')}<th>Jami</th></tr>`;
        
        DOM.tableBody.innerHTML = brands.map((brand, idx) => {
            // Rang tanlanmagan bo'lsa, avtomatik va takrorlanmas rang beriladi
            let color = brand.color && brand.color !== '#4facfe' ? brand.color : null;
            if (!color) {
                // Takrorlanmas rang tanlash
                while (usedColors.has(autoColors[colorIdx % autoColors.length])) colorIdx++;
                color = autoColors[colorIdx % autoColors.length];
                usedColors.add(color);
                colorIdx++;
            }
            
            return `
            <tr>
                <td data-label="Brend" style="color: ${color}; font-weight: 600;">${brand.name}</td>
                ${columns.map(colName => `<td data-label="${colName}"><input type="text" class="form-control numeric-input" data-key="${brand.id}_${colName}" placeholder="0"></td>`).join('')}
                <td data-label="Jami" class="row-total">0</td>
            </tr>`;
        }).join('');
        
        DOM.tableFoot.innerHTML = `<tr><td>Jami</td>${columns.map(c => `<td class="col-total" data-col="${c}">0</td>`).join('')}<td id="grand-total">0</td></tr>`;
    }

    function renderSavedReports() {
        if (!DOM.savedReportsList) {
            console.warn('[FRONTEND] DOM.savedReportsList topilmadi!');
            return;
        }
        
        console.log('[FRONTEND] renderSavedReports chaqirildi:', {
            savedReportsType: typeof state.savedReports,
            savedReportsIsArray: Array.isArray(state.savedReports),
            savedReportsKeys: state.savedReports ? Object.keys(state.savedReports) : [],
            savedReportsCount: state.savedReports ? (Array.isArray(state.savedReports) ? state.savedReports.length : Object.keys(state.savedReports).length) : 0
        });
        
        const reportIds = Object.keys(state.savedReports || {});
        console.log('[FRONTEND] Report IDs:', reportIds);
        
        if (reportIds.length === 0) {
            console.warn('[FRONTEND] Report IDs bo\'sh, "Hisobotlar topilmadi" ko\'rsatilmoqda');
            DOM.savedReportsList.innerHTML = '<div class="empty-state">Hisobotlar topilmadi.</div>';
            return;
        }
        const htmlContent = reportIds.map(id => {
            const report = state.savedReports[id];
            console.log(`[FRONTEND] Rendering report ${id} (script.js):`, report);
            
            if (!report) {
                console.warn(`[FRONTEND] Report ${id} topilmadi! (script.js)`);
                return '';
            }
            
            const editInfo = report.edit_count > 0 ? `<span class="edit-count">✏️ ${report.edit_count}</span>` : '';
            
            // Sanani formatlash
            const reportDate = report.date || report.report_date;
            if (!reportDate) {
                console.warn(`[FRONTEND] Report ${id} da sana yo'q! (script.js)`);
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
        
        console.log(`[FRONTEND] Generated HTML content length: ${htmlContent.length}, Content:`, htmlContent);
        console.log(`[FRONTEND] DOM.savedReportsList element:`, DOM.savedReportsList);
        
        DOM.savedReportsList.innerHTML = htmlContent;
        
        console.log(`[FRONTEND] After setting innerHTML, DOM.savedReportsList.innerHTML length: ${DOM.savedReportsList.innerHTML.length}`);
    }
    
    function updateTableValues(reportData = {}) {
        if (!DOM.tableBody) return;
        
        const allInputs = DOM.tableBody.querySelectorAll('.numeric-input');
        
        allInputs.forEach((input) => {
            const key = input.dataset.key;
            const value = reportData[key];
            
            // value 0 bo'lsa ham to'ldirish kerak
            if (value !== undefined && value !== null) {
                input.value = formatNumber(value);
            } else {
                input.value = '';
            }
        });
        
        updateCalculations();
    }

    // localStorage'ga saqlash funksiyasi
    function saveFormDataToLocalStorage() {
        try {
            // Faqat yangi hisobot yaratish rejimida saqlash (edit mode va currentReportId null bo'lsa)
            if (!state.isEditMode || state.currentReportId !== null) {
                return;
            }

            // Sanani olish
            let dateValue = '';
            if (datePickerFP) {
                if (datePickerFP.selectedDates && datePickerFP.selectedDates.length > 0) {
                    dateValue = flatpickr.formatDate(datePickerFP.selectedDates[0], 'Y-m-d');
                } else if (datePickerFP.input && datePickerFP.input.value) {
                    dateValue = datePickerFP.input.value;
                }
            }

            const formData = {
                date: dateValue,
                location: DOM.locationSelect ? DOM.locationSelect.value : '',
                currency: DOM.currencySelect ? DOM.currencySelect.value : '',
                data: {}
            };

            // Barcha input qiymatlarini yig'ish
            if (DOM.tableBody) {
                DOM.tableBody.querySelectorAll('.numeric-input').forEach(input => {
                    const key = input.dataset.key;
                    if (key) {
                        const value = parseNumber(input.value);
                        if (value > 0) {
                            formData.data[key] = value;
                        }
                    }
                });
            }

            localStorage.setItem('reportDraft', JSON.stringify(formData));
            console.log('[LOCALSTORAGE] Form ma\'lumotlari saqlandi');
        } catch (error) {
            console.error('[LOCALSTORAGE] Saqlashda xatolik:', error);
        }
    }

    // localStorage'dan yuklash funksiyasi
    function loadFormDataFromLocalStorage() {
        try {
            const savedData = localStorage.getItem('reportDraft');
            if (!savedData) {
                return false;
            }

            const formData = JSON.parse(savedData);
            
            // Sana
            if (formData.date && datePickerFP) {
                // Sana formatini tekshirish va to'g'rilash
                let dateToSet = formData.date;
                // Agar sana DD.MM.YYYY formatida bo'lsa, YYYY-MM-DD ga o'tkazish
                if (dateToSet.includes('.')) {
                    const parts = dateToSet.split('.');
                    if (parts.length === 3) {
                        dateToSet = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                    }
                }
                datePickerFP.setDate(dateToSet, false);
            }
            
            // Valyuta
            if (formData.currency && DOM.currencySelect) {
                DOM.currencySelect.value = formData.currency;
                DOM.currencySelect.classList.remove('currency-not-selected');
            }
            
            // Jadval qiymatlari (buildTable() dan keyin yuklash kerak)
            if (formData.data && Object.keys(formData.data).length > 0) {
                // Kichik kechikish bilan yuklash (DOM yangilanishi uchun)
                setTimeout(() => {
                    updateTableValues(formData.data);
                }, 100);
            }

            console.log('[LOCALSTORAGE] Form ma\'lumotlari yuklandi');
            return true;
        } catch (error) {
            console.error('[LOCALSTORAGE] Yuklashda xatolik:', error);
            return false;
        }
    }

    // localStorage'dan tozalash funksiyasi
    function clearFormDataFromLocalStorage() {
        try {
            localStorage.removeItem('reportDraft');
            console.log('[LOCALSTORAGE] Form ma\'lumotlari tozalandi');
        } catch (error) {
            console.error('[LOCALSTORAGE] Tozalashda xatolik:', error);
        }
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
    function loadUserLocations() {
        // Foydalanuvchiga biriktirilgan filiallar
        const allSystemLocations = state.settings.app_settings?.locations || [];
        const userAssignedLocations = state.currentUser?.locations || [];
        const userPermissions = state.currentUser?.permissions || [];

        let locationsToShow = [];
        
        if (userPermissions.includes('reports:view_all')) {
            locationsToShow = allSystemLocations;
        } else {
            locationsToShow = userAssignedLocations;
        }
        
        state.userLocations = locationsToShow;
        
        // Agar filiallar bo'lmasa, hisobot bo'limini yashirish
        if (locationsToShow.length === 0) {
            const tableWrapper = document.querySelector('.table-wrapper');
            const header = document.querySelector('.header');
            const controls = document.querySelector('.controls');
            const summaryWrapper = document.getElementById('summary-wrapper');
            
            if (tableWrapper) {
                tableWrapper.innerHTML = '<div class="empty-state" style="padding: 60px 20px; text-align: center; color: rgba(255,255,255,0.6);"><i data-feather="alert-circle" style="width: 48px; height: 48px; margin-bottom: 20px;"></i><h3 style="margin-bottom: 10px;">Filiallar topilmadi</h3><p>Sizga biriktirilgan filiallar mavjud emas. Iltimos, administrator bilan bog\'laning.</p></div>';
            }
            
            if (header) {
                header.style.display = 'none';
            }
            
            if (controls) {
                controls.style.display = 'none';
            }
            
            if (summaryWrapper) {
                summaryWrapper.style.display = 'none';
            }
            
            if (typeof feather !== 'undefined') feather.replace();
        }
    }

    function populateLocations() {
        if (!DOM.locationSelect) return;
        
        if (state.userLocations.length > 0) {
            DOM.locationSelect.innerHTML = state.userLocations.map(loc => 
                `<option value="${loc}">${loc}</option>`
            ).join('');
        } else {
            DOM.locationSelect.innerHTML = '<option value="">Filiallar topilmadi</option>';
        }

        // === LOG: Kengliklarni tekshirish ===
        setTimeout(() => {
        }, 500);
    }
    
    // ============================
    // Brendlar moduli olib tashlandi
    // ============================

    function setInputsReadOnly(isReadOnly) {
        if (DOM.tableBody) DOM.tableBody.querySelectorAll('.numeric-input').forEach(input => input.disabled = isReadOnly);
        if (datePickerFP) datePickerFP.set('clickOpens', !isReadOnly);
        if (DOM.locationSelect) DOM.locationSelect.disabled = isReadOnly;
        // Valyuta tanlash har doim faol bo'lishi kerak
        // if (DOM.currencySelect) DOM.currencySelect.disabled = isReadOnly;
    }

    function updateUIForReportState() {
        const isNew = state.currentReportId === null;
        const report = state.currentReportId !== null ? state.savedReports?.[state.currentReportId] : null;
        const hasEditAll = state.currentUser?.permissions?.includes('reports:edit_all');
        const hasEditAssigned = state.currentUser?.permissions?.includes('reports:edit_assigned') && report && report.location && state.currentUser?.locations?.includes(report.location);
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

    async function createNewReport() {
        if (!state.currentUser.permissions.includes('reports:create')) {
            return showToast("Sizda yangi hisobot yaratish uchun ruxsat yo'q.", true);
        }
        state.currentReportId = null;
        state.isEditMode = true;
        
        // localStorage'dan ma'lumotlarni olish (buildTable() dan oldin)
        const savedData = localStorage.getItem('reportDraft');
        let formData = null;
        if (savedData) {
            try {
                formData = JSON.parse(savedData);
            } catch (e) {
                console.error('[LOCALSTORAGE] Parse xatolik:', e);
            }
        }
        
        // Filialni avval o'rnatish (buildTable() filialga qarab brendlarni yuklaydi)
        if (formData && formData.location && DOM.locationSelect) {
            DOM.locationSelect.value = formData.location;
        } else if (DOM.locationSelect && DOM.locationSelect.options.length > 0) {
            DOM.locationSelect.selectedIndex = 0;
        }
        
        await buildTable();
        
        // localStorage'dan yuklash (buildTable() dan keyin)
        const loaded = loadFormDataFromLocalStorage();
        if (!loaded) {
            updateTableValues({});
            if (datePickerFP) datePickerFP.clear(); 
        }

        if (DOM.reportIdBadge) {
            DOM.reportIdBadge.textContent = 'YANGI';
            DOM.reportIdBadge.className = 'badge new';
        }
        if (DOM.confirmBtn) DOM.confirmBtn.innerHTML = '<i data-feather="check-circle"></i> TASDIQLASH VA SAQLASH';
        
        document.querySelectorAll('.report-item.active').forEach(item => item.classList.remove('active'));
        updateUIForReportState();
        feather.replace();
    }

    async function loadReport(reportId) {
        const report = state.savedReports?.[reportId];
        if (!report) {
            console.error('❌ Hisobot topilmadi:', reportId);
            return;
        }

        // Mavjud hisobot yuklanayotganda localStorage'ni tozalash
        clearFormDataFromLocalStorage();

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
        
        // MUHIM: buildTable() async, await qilish kerak!
        await buildTable();
        
        state.settings.app_settings = originalSettings;
        
        updateTableValues(reportData);

        if (DOM.reportIdBadge) {
            DOM.reportIdBadge.textContent = `#${formatReportId(reportId)}`;
            DOM.reportIdBadge.className = 'badge saved';
        }
        if (datePickerFP) datePickerFP.setDate(report.date, true);
        // Brand removed
        if (DOM.locationSelect) DOM.locationSelect.value = report.location;
        
        // Valyutani yuklash
        if (DOM.currencySelect && report.currency) {
            DOM.currencySelect.value = report.currency;
            DOM.currencySelect.classList.remove('currency-not-selected');
        } else if (DOM.currencySelect && state.currentUser.preferred_currency) {
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
        
        // Valyuta tanlashni tekshirish
        const selectedCurrency = DOM.currencySelect?.value;
        if (!selectedCurrency) {
            showToast("Iltimos, valyutani tanlang!", true);
            if (DOM.currencySelect) {
                DOM.currencySelect.classList.add('currency-not-selected');
                DOM.currencySelect.focus();
            }
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

        // existingDates ni tekshirish va boshlang'ich qiymatni o'rnatish
        if (!state.existingDates) {
            state.existingDates = {};
        }

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
            location: DOM.locationSelect.value,
            brand_id: null, // Brand selector removed
            settings: state.settings.app_settings,
            data: {},
            late_comment: lateComment,
            currency: selectedCurrency
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
            
            // Hisobot saqlanganda localStorage'ni tozalash
            clearFormDataFromLocalStorage();
            
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
            
            // Valyuta tanlash selector'ini olish
            const historyCurrencySelect = document.getElementById('history-currency-select');
            const reportCurrency = fullHistory[0]?.currency || 'UZS';
            
            // Default valyutani o'rnatish
            if (historyCurrencySelect) {
                historyCurrencySelect.value = reportCurrency;
            }
            
            // Valyutani formatlash va konvertatsiya qilish funksiyasi
            const renderHistoryWithCurrency = async (selectedCurrency) => {
                let exchangeRates = null;
                if (selectedCurrency !== 'UZS') {
                    try {
                        const ratesRes = await fetch('/api/exchange-rates');
                        if (ratesRes.ok) {
                            const ratesData = await ratesRes.json();
                            exchangeRates = ratesData.rates;
                        }
                    } catch (error) {
                        console.error('Kurslarni olishda xatolik:', error);
                    }
                }
                
                // Valyutani formatlash funksiyasi
                const formatCurrencyValue = (value, currency) => {
                    if (currency === 'UZS' || !exchangeRates) {
                        return formatNumber(value);
                    }
                    // Konvertatsiya qilish
                    const rate = exchangeRates[currency];
                    if (!rate) return formatNumber(value);
                    const converted = value / rate;
                    const symbols = { 'USD': '$', 'EUR': '€', 'RUB': '₽', 'KZT': '₸' };
                    const symbol = symbols[currency] || currency;
                    // Formatlash: 2 xona aniqlik bilan
                    const rounded = Math.round(converted * 100) / 100;
                    const parts = rounded.toString().split('.');
                    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
                    const decimalPart = parts[1] ? parts[1].padEnd(2, '0').substring(0, 2) : '00';
                    return `${symbol}${integerPart},${decimalPart}`;
                };
                
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
                                    ? `<div class="col-value"><span class="old-value">${formatCurrencyValue(change.oldValue, selectedCurrency)}</span><span class="new-value">${formatCurrencyValue(change.newValue, selectedCurrency)}</span></div>`
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
            };
            
            // Birinchi marta render qilish
            await renderHistoryWithCurrency(reportCurrency);
            
            // Valyuta tanlash selector'iga event listener qo'shish
            if (historyCurrencySelect) {
                historyCurrencySelect.addEventListener('change', async (e) => {
                    const selectedCurrency = e.target.value;
                    await renderHistoryWithCurrency(selectedCurrency);
                });
            }

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

    async function exportToExcel() {
        const table = document.getElementById('main-table');
        if (!table) {
            console.error('[EXCEL] Jadval topilmadi!');
            return;
        }
        
        // Jadval ma'lumotlarini to'plash
        const { columns = [] } = state.settings.app_settings || {};
        const tableData = [];
        
        // Brendlar qatorlarini olish
        const brandRows = DOM.tableBody?.querySelectorAll('tr') || [];
        brandRows.forEach(row => {
            const brandCell = row.querySelector('td[data-label="Brend"]');
            if (!brandCell) return;
            
            const brandName = brandCell.textContent.trim();
            const rowData = [brandName];
            
            // Ustunlar qiymatlarini olish
            columns.forEach(col => {
                const input = row.querySelector(`input[data-key$="_${col}"]`);
                const value = input ? (input.value || '0') : '0';
                rowData.push(value);
            });
            
            // Jami ustunini olish
            const totalCell = row.querySelector('td.row-total');
            const totalValue = totalCell ? (totalCell.textContent.trim() || '0') : '0';
            rowData.push(totalValue);
            
            tableData.push(rowData);
        });
        
        // Jami qatorini olish
        const footerRow = DOM.tableFoot?.querySelector('tr');
        if (footerRow) {
            const footerData = ['Jami'];
            columns.forEach(col => {
                const totalCell = footerRow.querySelector(`td.col-total[data-col="${col}"]`);
                const value = totalCell ? (totalCell.textContent.trim() || '0') : '0';
                footerData.push(value);
            });
            const grandTotalCell = footerRow.querySelector('#grand-total');
            const grandTotal = grandTotalCell ? (grandTotalCell.textContent.trim() || '0') : '0';
            footerData.push(grandTotal);
            tableData.push(footerData);
        }
        
        // Backend'ga so'rov yuborish
        try {
            const date = DOM.datePickerEl.value || new Date().toISOString().split('T')[0];
            const location = DOM.locationSelect.value || 'noma\'lum';
            const currency = DOM.currencySelect?.value || 'UZS';
            
            const response = await fetch('/api/reports/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    tableData,
                    columns,
                    date,
                    location,
                    currency
                })
            });
            
            if (!response.ok) {
                throw new Error(`Server xatolik: ${response.status}`);
            }
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${location}_${date}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            showToast("Excel fayl muvaffaqiyatli yaratildi!");
            return;
        } catch (error) {
            console.error('[EXCEL] Backend export xatolik:', error);
            // Agar backend ishlamasa, frontend export ishlatiladi
        }
    
        // Jadvalni nusxalash va input qiymatlarini matnda almashtirish
        const tableClone = table.cloneNode(true);
        
        // Barcha input'larni qiymatiga almashtirish va sonlarni to'g'ri formatlash
        let numericCellsCount = 0;
        tableClone.querySelectorAll('input').forEach((input, idx) => {
            const td = input.closest('td');
            if (td) {
                const value = input.value || '0';
                // Bo'shliqlarni olib tashlash va son sifatida tekshirish
                const cleanValue = value.toString().replace(/\s/g, '');
                const numValue = parseFloat(cleanValue);
                
                if (!isNaN(numValue) && cleanValue !== '') {
                    // Son sifatida saqlash
                    td.textContent = numValue;
                    td.setAttribute('data-type', 'number');
                    td.setAttribute('data-value', numValue);
                    numericCellsCount++;
                } else {
                    // Matn sifatida saqlash
                    td.textContent = value;
                    td.setAttribute('data-type', 'string');
                }
            }
        });
        
        // Sarlavha qatorini formatlash (ko'k rang)
        const headerRow = tableClone.querySelector('thead tr');
        if (headerRow) {
            headerRow.style.backgroundColor = '#1F4788';
            headerRow.style.color = '#FFFFFF';
            headerRow.style.fontWeight = 'bold';
            headerRow.querySelectorAll('th').forEach(th => {
                th.style.backgroundColor = '#1F4788';
                th.style.color = '#FFFFFF';
                th.style.textAlign = 'center';
                th.style.border = '1px solid #000000';
            });
        }
        
        // Jami qatorini formatlash (sariq rang) - frontend export uchun
        const footerRowClone = tableClone.querySelector('tfoot tr');
        if (footerRowClone) {
            footerRowClone.style.backgroundColor = '#FFEB3B';
            footerRowClone.style.fontWeight = 'bold';
            footerRowClone.querySelectorAll('td').forEach(td => {
                td.style.backgroundColor = '#FFEB3B';
                td.style.color = '#000000';
                td.style.border = '1px solid #000000';
                if (td.textContent.trim() !== 'Jami') {
                    td.style.textAlign = 'right';
                }
            });
        }
        
        // Barcha qatorlar uchun border qo'shish
        tableClone.querySelectorAll('td, th').forEach(cell => {
            if (!cell.style.border) {
                cell.style.border = '1px solid #000000';
            }
        });
        
        // Excel yaratish
        const wb = XLSX.utils.table_to_book(tableClone, { 
            sheet: "Hisobot",
            raw: true, // Sonlarni to'g'ri formatlash uchun raw: true
            cellStyles: true,
            cellHTML: false // HTML formatlarni o'chirish
        });
        
        // Workbook'ga style qo'shish (ranglar uchun)
        if (!wb.Styles) {
            wb.Styles = {
                fills: [],
                fonts: [],
                borders: [],
                cellXfs: []
            };
        }
        
        // Ko'k rang qo'shish
        wb.Styles.fills.push({
            patternType: 'solid',
            fgColor: { rgb: '1F4788' }
        });
        
        // Sariq rang qo'shish
        wb.Styles.fills.push({
            patternType: 'solid',
            fgColor: { rgb: 'FFEB3B' }
        });
        
        // Oq matn qo'shish
        wb.Styles.fonts.push({
            bold: true,
            color: { rgb: 'FFFFFF' },
            sz: 12
        });
        
        // Qora matn qo'shish
        wb.Styles.fonts.push({
            bold: true,
            color: { rgb: '000000' }
        });
        
        // Ustunlar kengligini sozlash
        const ws = wb.Sheets['Hisobot'];
        const range = XLSX.utils.decode_range(ws['!ref']);
        
        const colWidths = [];
        for (let C = range.s.c; C <= range.e.c; ++C) {
            let maxWidth = 10;
            for (let R = range.s.r; R <= range.e.r; ++R) {
                const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = ws[cellAddress];
                if (cell && cell.v) {
                    const cellLength = cell.v.toString().length;
                    maxWidth = Math.max(maxWidth, cellLength + 2);
                }
            }
            colWidths.push({ wch: maxWidth });
        }
        ws['!cols'] = colWidths;
        
        // Jami qatori indexini aniqlash
        const totalRowIndex = range.e.r;
        
        // Sonlarni to'g'ri formatlash va number format qo'shish
        let formattedNumbersCount = 0;
        // Number format: # ##0,00 (bo'shliq bilan ajratilgan, vergul bilan kasr)
        // Excel format: # ##0,00 (O'zbekiston formatida)
        const numberFormat = '# ##0,00';
        
        // Workbook'ga number format qo'shish
        if (!wb.SSF) wb.SSF = {};
        // XLSX kutubxonasida formatlar ro'yxatini yaratish
        const formatIndex = Object.keys(wb.SSF).length;
        wb.SSF[formatIndex] = numberFormat;
        
        for (let R = range.s.r + 1; R < totalRowIndex; ++R) { // Sarlavha va jami qatorini o'tkazib yuborish
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = ws[cellAddress];
                if (cell && cell.v !== undefined && cell.v !== null) {
                    // Agar son bo'lsa, son sifatida saqlash
                    const strValue = cell.v.toString().replace(/\s/g, '').replace(',', '.');
                    const numValue = parseFloat(strValue);
                    if (!isNaN(numValue) && strValue !== '' && C > 0) { // Birinchi ustun (Brend) emas
                        // Son sifatida saqlash
                        cell.v = numValue;
                        cell.t = 'n'; // number type
                        cell.z = numberFormat; // number format string
                        // Style uchun ham format qo'shish
                        if (!cell.s) cell.s = {};
                        cell.s.numFmt = numberFormat;
                        formattedNumbersCount++;
                    } else if (C === 0) {
                        // Birinchi ustun (Brend) - matn sifatida qoldirish
                        cell.t = 's'; // string type
                    }
                }
            }
        }
        
        // Jami qatoridagi sonlarni ham formatlash
        if (totalRowIndex > 0) {
            for (let C = range.s.c + 1; C <= range.e.c; ++C) { // Birinchi ustun (Jami) emas
                const cellAddress = XLSX.utils.encode_cell({ r: totalRowIndex, c: C });
                const cell = ws[cellAddress];
                if (cell && cell.v !== undefined && cell.v !== null) {
                    const strValue = cell.v.toString().replace(/\s/g, '').replace(',', '.');
                    const numValue = parseFloat(strValue);
                    if (!isNaN(numValue) && strValue !== '') {
                        cell.v = numValue;
                        cell.t = 'n';
                        cell.z = numberFormat;
                        if (!cell.s) cell.s = {};
                        cell.s.numFmt = numberFormat;
                    }
                }
            }
        }
        
        // XLSX kutubxonasida ranglar qo'shish uchun workbook'ga style qo'shish
        if (!wb.SSF) wb.SSF = {};
        
        // Sarlavha qatorini formatlash (ko'k rang - rasmdagidek)
        if (range.s.r === 0) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
                if (!ws[cellAddress]) continue;
                const cell = ws[cellAddress];
                if (!cell.s) cell.s = {};
                // Ko'k fon, oq matn
                cell.s = {
                    fill: { 
                        fgColor: { rgb: "1F4788" },
                        bgColor: { rgb: "1F4788" },
                        patternType: "solid"
                    },
                    font: { 
                        bold: true, 
                        color: { rgb: "FFFFFF" }, 
                        sz: 12 
                    },
                    alignment: { 
                        horizontal: "center", 
                        vertical: "center" 
                    },
                    border: {
                        top: { style: "thin", color: { rgb: "000000" } },
                        bottom: { style: "thin", color: { rgb: "000000" } },
                        left: { style: "thin", color: { rgb: "000000" } },
                        right: { style: "thin", color: { rgb: "000000" } }
                    }
                };
            }
        }
        
        // Jami qatorini formatlash (sariq rang - rasmdagidek)
        const totalRowLabel = ws[XLSX.utils.encode_cell({ r: totalRowIndex, c: 0 })];
        if (totalRowLabel && totalRowLabel.v && (totalRowLabel.v.toString().toLowerCase().includes('jami') || totalRowLabel.v.toString().toLowerCase().includes('total'))) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ r: totalRowIndex, c: C });
                if (!ws[cellAddress]) continue;
                const cell = ws[cellAddress];
                if (!cell.s) cell.s = {};
                // Sariq fon, qora matn
                cell.s = {
                    fill: { 
                        fgColor: { rgb: "FFEB3B" },
                        bgColor: { rgb: "FFEB3B" },
                        patternType: "solid"
                    },
                    font: { 
                        bold: true, 
                        color: { rgb: "000000" }
                    },
                    alignment: { 
                        horizontal: "right", 
                        vertical: "center" 
                    },
                    border: {
                        top: { style: "medium", color: { rgb: "000000" } },
                        bottom: { style: "thin", color: { rgb: "000000" } },
                        left: { style: "thin", color: { rgb: "000000" } },
                        right: { style: "thin", color: { rgb: "000000" } }
                    }
                };
            }
        }
        
        // Barcha qatorlar uchun border qo'shish
        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = ws[cellAddress];
                if (cell && !cell.s) {
                    cell.s = {
                        border: {
                            top: { style: "thin", color: { rgb: "000000" } },
                            bottom: { style: "thin", color: { rgb: "000000" } },
                            left: { style: "thin", color: { rgb: "000000" } },
                            right: { style: "thin", color: { rgb: "000000" } }
                        }
                    };
                } else if (cell && cell.s && !cell.s.border) {
                    cell.s.border = {
                        top: { style: "thin", color: { rgb: "000000" } },
                        bottom: { style: "thin", color: { rgb: "000000" } },
                        left: { style: "thin", color: { rgb: "000000" } },
                        right: { style: "thin", color: { rgb: "000000" } }
                    };
                }
            }
        }
        
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

        // Mobile menu toggle
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        const sidebar = document.querySelector('.sidebar');
        const sidebarOverlay = document.getElementById('sidebar-overlay');
        
        function toggleMobileMenu() {
            if (sidebar && sidebarOverlay) {
                sidebar.classList.toggle('open');
                sidebarOverlay.classList.toggle('active');
                // Body scroll ni to'xtatish/yochish
                if (sidebar.classList.contains('open')) {
                    document.body.style.overflow = 'hidden';
                } else {
                    document.body.style.overflow = '';
                }
            }
        }
        
        function closeMobileMenu() {
            if (sidebar && sidebarOverlay) {
                sidebar.classList.remove('open');
                sidebarOverlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        }
        
        addSafeListener(mobileMenuToggle, 'click', (e) => {
            e.stopPropagation();
            toggleMobileMenu();
        });
        
        addSafeListener(sidebarOverlay, 'click', closeMobileMenu);
        
        // Sidebar ichidagi report item bosilganda mobil menyuni yopish
        addSafeListener(DOM.savedReportsList, 'click', (e) => {
            const item = e.target.closest('.report-item');
            if (item && item.dataset.id) {
                if (window.innerWidth <= 768) {
                    closeMobileMenu();
                }
            }
        });
        
        // Window resize - katta ekranda sidebar ochiq bo'lishi kerak
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                closeMobileMenu();
            }
        });
        
        // Sidebar collapse/expand toggle
        const leftSidebar = document.getElementById('left-sidebar');
        const rightSidebar = document.getElementById('right-sidebar');
        const toggleLeftSidebar = document.getElementById('toggle-left-sidebar');
        const toggleRightSidebar = document.getElementById('toggle-right-sidebar');
        const mainWrapper = document.querySelector('.main-wrapper');
        
        function toggleLeftSidebarCollapse() {
            if (leftSidebar && mainWrapper) {
                leftSidebar.classList.toggle('collapsed');
                mainWrapper.classList.toggle('sidebar-left-collapsed');
                
                // LocalStorage'ga saqlash
                const isCollapsed = leftSidebar.classList.contains('collapsed');
                localStorage.setItem('leftSidebarCollapsed', isCollapsed);
            }
        }
        
        function toggleRightSidebarCollapse() {
            if (rightSidebar && mainWrapper) {
                rightSidebar.classList.toggle('collapsed');
                mainWrapper.classList.toggle('sidebar-right-collapsed');
                
                // LocalStorage'ga saqlash
                const isCollapsed = rightSidebar.classList.contains('collapsed');
                localStorage.setItem('rightSidebarCollapsed', isCollapsed);
            }
        }
        
        // LocalStorage'dan yuklash
        if (leftSidebar && mainWrapper) {
            const leftCollapsed = localStorage.getItem('leftSidebarCollapsed') === 'true';
            if (leftCollapsed) {
                leftSidebar.classList.add('collapsed');
                mainWrapper.classList.add('sidebar-left-collapsed');
            }
        }
        
        if (rightSidebar && mainWrapper) {
            const rightCollapsed = localStorage.getItem('rightSidebarCollapsed') === 'true';
            if (rightCollapsed) {
                rightSidebar.classList.add('collapsed');
                mainWrapper.classList.add('sidebar-right-collapsed');
            }
        }
        
        addSafeListener(toggleLeftSidebar, 'click', (e) => {
            e.stopPropagation();
            toggleLeftSidebarCollapse();
            if (window.feather) feather.replace();
        });
        
        addSafeListener(toggleRightSidebar, 'click', (e) => {
            e.stopPropagation();
            toggleRightSidebarCollapse();
            if (window.feather) feather.replace();
        });
        
        // Mobil uchun right column toggle button
        if (window.innerWidth <= 768) {
            const rightColumnToggleMobile = document.createElement('button');
            rightColumnToggleMobile.className = 'right-column-toggle-mobile';
            rightColumnToggleMobile.id = 'right-column-toggle-mobile';
            rightColumnToggleMobile.innerHTML = '<i data-feather="bar-chart-2"></i>';
            rightColumnToggleMobile.title = 'KPI va Statistika';
            document.body.appendChild(rightColumnToggleMobile);
            
            if (window.feather) feather.replace();
            
            addSafeListener(rightColumnToggleMobile, 'click', () => {
                if (rightSidebar) {
                    rightSidebar.classList.toggle('open');
                    if (rightSidebar.classList.contains('open')) {
                        document.body.style.overflow = 'hidden';
                    } else {
                        document.body.style.overflow = '';
                    }
                }
            });
            
            // Right sidebar overlay
            const rightSidebarOverlay = document.createElement('div');
            rightSidebarOverlay.className = 'sidebar-overlay right-sidebar-overlay';
            rightSidebarOverlay.id = 'right-sidebar-overlay';
            document.body.appendChild(rightSidebarOverlay);
            
            addSafeListener(rightSidebarOverlay, 'click', () => {
                if (rightSidebar) {
                    rightSidebar.classList.remove('open');
                    document.body.style.overflow = '';
                }
            });
        }

        addSafeListener(DOM.newReportBtn, 'click', createNewReport);
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
                // localStorage'ga saqlash
                saveFormDataToLocalStorage();
            }
        });
        
        addSafeListener(DOM.confirmBtn, 'click', () => handleConfirm(null));
        addSafeListener(DOM.editBtn, 'click', handleEdit);
        
        // Qidiruv input uchun event listener
        addSafeListener(DOM.searchInput, 'input', debounce(e => {
            state.filters.searchTerm = e.target.value;
            state.filters.page = 1;
            fetchAndRenderReports();
        }, 300));
        
        // Filter buttonlar uchun event listener
        if (DOM.reportFilterButtons) {
            DOM.reportFilterButtons.addEventListener('click', e => {
                const btn = e.target.closest('.filter-btn');
                if (!btn) return;
                
                // Barcha buttonlardan active class'ni olib tashlash
                DOM.reportFilterButtons.querySelectorAll('.filter-btn').forEach(b => {
                    b.classList.remove('active');
                });
                
                // Tanlangan buttonga active class qo'shish
                btn.classList.add('active');
                
                // Filter qiymatini o'rnatish
                const filterValue = btn.dataset.filter;
                state.filters.filter = filterValue;
                state.filters.page = 1;
                fetchAndRenderReports();
            });
        }
        
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
        addSafeListener(DOM.currencySelect, 'change', async (e) => {
            const currency = e.target.value;
            if (currency) {
                try {
                    const res = await fetch('/api/user/preferred-currency', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ currency })
                    });
                    if (res.ok) {
                        DOM.currencySelect.classList.remove('currency-not-selected');
                        state.currentUser.preferred_currency = currency;
                        showToast('Valyuta sozlamasi saqlandi');
                    } else {
                        const error = await res.json();
                        showToast(error.message || 'Valyuta sozlamasini saqlashda xatolik', true);
                    }
                } catch (error) {
                    showToast('Valyuta sozlamasini saqlashda xatolik', true);
                }
            }
            // localStorage'ga saqlash
            saveFormDataToLocalStorage();
        });
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
        addSafeListener(DOM.excelBtn, 'click', exportToExcel);

        addSafeListener(DOM.locationSelect, 'change', () => {
            validateDate();
            // localStorage'ga saqlash
            saveFormDataToLocalStorage();
        });
        
        // Avatar modal event listeners
        setupAvatarModal();
    }
    
    function setupAvatarModal() {
        // Yangi elementlar
        const userProfileCard = document.getElementById('user-profile-card');
        const dropdownBtn = document.getElementById('dropdown-btn');
        const userDropdownMenu = document.getElementById('user-dropdown-menu');
        const changeAvatarBtn = document.getElementById('change-avatar-btn');
        const viewProfileBtn = document.getElementById('view-profile-btn');
        const changePasswordBtn = document.getElementById('change-password-btn');
        const sessionsBtn = document.getElementById('sessions-btn');
        const notificationsBtn = document.getElementById('notifications-btn');
        const dropdownLogoutBtn = document.getElementById('dropdown-logout-btn');
        
        const avatarModal = document.getElementById('avatar-modal');
        const avatarUploadInput = document.getElementById('avatar-upload');
        const deleteAvatarBtn = document.getElementById('delete-avatar-btn');
        const avatarPreview = document.getElementById('avatar-preview');
        
        // Dropdown toggle funksiyasi
        function toggleDropdown() {
            const isActive = userDropdownMenu.classList.toggle('active');
            dropdownBtn.classList.toggle('rotated', isActive);
        }
        
        // Profile card bosilganda dropdown ochish
        if (userProfileCard) {
            userProfileCard.addEventListener('click', (e) => {
                // Agar dropdown ichidagi element bosilsa, toggle qilmaslik
                if (e.target.closest('.user-dropdown-menu')) {
                    return;
                }
                toggleDropdown();
            });
        }
        
        // Tashqariga bosilganda yopish
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.user-profile-section')) {
                userDropdownMenu.classList.remove('active');
                dropdownBtn.classList.remove('rotated');
            }
        });
        
        // Dropdown menu itemlar
        function closeDropdown() {
            userDropdownMenu.classList.remove('active');
            dropdownBtn.classList.remove('rotated');
        }
        
        if (changeAvatarBtn) {
            changeAvatarBtn.addEventListener('click', () => {
                closeDropdown();
                openAvatarModalFunc();
            });
        }
        
        if (viewProfileBtn) {
            viewProfileBtn.addEventListener('click', () => {
                closeDropdown();
                openProfileModal();
            });
        }
        
        if (changePasswordBtn) {
            changePasswordBtn.addEventListener('click', () => {
                closeDropdown();
                openPasswordModal();
            });
        }
        
        if (sessionsBtn) {
            sessionsBtn.addEventListener('click', () => {
                closeDropdown();
                openSessionsModal();
            });
        }
        
        if (notificationsBtn) {
            notificationsBtn.addEventListener('click', () => {
                closeDropdown();
                openNotificationsModal();
            });
        }
        
        if (dropdownLogoutBtn) {
            dropdownLogoutBtn.addEventListener('click', async () => {
                closeDropdown();
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login';
            });
        }
        
        // Modal ochish funksiyasi
        async function openAvatarModalFunc() {
            // Modal ochilganda joriy avatarni ko'rsatish
            try {
                const res = await fetch('/api/users/me/avatar');
                if (res.ok) {
                    const data = await res.json();
                    if (data.avatar_url) {
                        avatarPreview.innerHTML = `<img src="${data.avatar_url}" alt="Avatar">`;
                        deleteAvatarBtn.style.display = 'block';
                    } else {
                        avatarPreview.innerHTML = '<i data-feather="user"></i>';
                        deleteAvatarBtn.style.display = 'none';
                        feather.replace();
                    }
                } else {
                    // Xatolik bo'lsa default icon
                    avatarPreview.innerHTML = '<i data-feather="user"></i>';
                    deleteAvatarBtn.style.display = 'none';
                    feather.replace();
                }
            } catch (error) {
                console.error('Avatar yuklashda xatolik:', error);
                avatarPreview.innerHTML = '<i data-feather="user"></i>';
                deleteAvatarBtn.style.display = 'none';
                feather.replace();
            }
            
            avatarModal.classList.remove('hidden');
            feather.replace();
        }
        
        if (avatarUploadInput) {
            avatarUploadInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                // Fayl hajmini tekshirish (max 2MB)
                if (file.size > 2 * 1024 * 1024) {
                    showToast('Rasm hajmi 2MB dan oshmasligi kerak!', true);
                    return;
                }
                
                // Fayl turini tekshirish
                if (!file.type.startsWith('image/')) {
                    showToast('Faqat rasm fayllarini yuklash mumkin!', true);
                    return;
                }
                
                // Base64 ga o'girish
                const reader = new FileReader();
                reader.onload = async (event) => {
                    const base64 = event.target.result;
                    
                    // Preview ko'rsatish
                    avatarPreview.innerHTML = `<img src="${base64}" alt="Avatar">`;
                    deleteAvatarBtn.style.display = 'block';
                    
                    // Serverga yuborish
                    try {
                        const res = await fetch('/api/users/me/avatar', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ avatar: base64 })
                        });
                        
                        if (res.ok) {
                            const data = await res.json();
                            showToast('Avatar muvaffaqiyatli yangilandi!');
                            
                            // Sahifadagi avatarni yangilash
                            const avatarDisplay = document.getElementById('user-avatar-display');
                            if (avatarDisplay) {
                                avatarDisplay.innerHTML = `<img src="${base64}" alt="Avatar"><span class="avatar-status-badge"></span>`;
                            }
                        } else {
                            // Xatolik javobini tekshirish
                            let errorMessage = 'Avatar yangilashda xatolik!';
                            try {
                                const error = await res.json();
                                errorMessage = error.message || errorMessage;
                            } catch (e) {
                                // JSON parse error - HTML qaytgan bo'lishi mumkin
                                if (res.status === 413) {
                                    errorMessage = 'Rasm hajmi juda katta! Kichikroq rasm tanlang.';
                                }
                            }
                            showToast(errorMessage, true);
                        }
                    } catch (error) {
                        showToast('Avatar yangilashda xatolik!', true);
                        console.error('Avatar yangilash xatosi:', error);
                    }
                };
                reader.readAsDataURL(file);
            });
        }
        
        if (deleteAvatarBtn) {
            deleteAvatarBtn.addEventListener('click', async () => {
                if (!confirm('Avatarni o\'chirishni xohlaysizmi?')) return;
                
                try {
                    const res = await fetch('/api/users/me/avatar', { method: 'DELETE' });
                    
                    if (res.ok) {
                        showToast('Avatar o\'chirildi!');
                        
                        // Preview va sahifadagi avatarni yangilash
                        avatarPreview.innerHTML = '<i data-feather="user"></i>';
                        deleteAvatarBtn.style.display = 'none';
                        feather.replace();
                        
                        const avatarDisplay = document.getElementById('user-avatar-display');
                        if (avatarDisplay) {
                            avatarDisplay.innerHTML = '<i data-feather="user"></i><span class="avatar-status-badge"></span>';
                            feather.replace();
                        }
                    } else {
                        // Xatolik javobini tekshirish
                        let errorMessage = 'Avatar o\'chirishda xatolik!';
                        try {
                            const error = await res.json();
                            errorMessage = error.message || errorMessage;
                        } catch (e) {
                            // JSON parse error bo'lsa
                        }
                        showToast(errorMessage, true);
                    }
                } catch (error) {
                    showToast('Avatar o\'chirishda xatolik!', true);
                    console.error('Avatar o\'chirish xatosi:', error);
                }
            });
        }
    }
    
    // Profil modal
    function openProfileModal() {
        const modal = document.getElementById('profile-modal');
        const fullnameInput = document.getElementById('profile-fullname');
        const usernameInput = document.getElementById('profile-username');
        const roleInput = document.getElementById('profile-role');
        
        if (state.currentUser) {
            fullnameInput.value = state.currentUser.fullname || '';
            usernameInput.value = state.currentUser.username || '';
            roleInput.value = state.currentUser.role || '';
        }
        
        modal.classList.remove('hidden');
        feather.replace();
    }
    
    // Profil form submit
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fullname = document.getElementById('profile-fullname').value.trim();
            
            if (!fullname) {
                showToast('To\'liq ismni kiriting!', true);
                return;
            }
            
            try {
                const res = await fetch(`/api/users/${state.currentUser.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        fullname,
                        role: state.currentUser.role,
                        locations: state.userLocations
                    })
                });
                
                if (res.ok) {
                    showToast('Profil muvaffaqiyatli yangilandi!');
                    state.currentUser.fullname = fullname;
                    updateUserInfo();
                    document.getElementById('profile-modal').classList.add('hidden');
                } else {
                    const error = await res.json();
                    showToast(error.message || 'Xatolik yuz berdi!', true);
                }
            } catch (error) {
                showToast('Profilni yangilashda xatolik!', true);
                console.error(error);
            }
        });
    }
    
    // Parol o'zgartirish modal
    function openPasswordModal() {
        const modal = document.getElementById('password-modal');
        document.getElementById('password-form').reset();
        modal.classList.remove('hidden');
        feather.replace();
    }
    
    // Parol form submit
    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const currentPassword = document.getElementById('current-password').value;
            const secretWord = document.getElementById('secret-word').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            
            if (newPassword.length < 8) {
                showToast('Yangi parol kamida 8 belgidan iborat bo\'lishi kerak!', true);
                return;
            }
            
            if (newPassword !== confirmPassword) {
                showToast('Parollar bir xil emas!', true);
                return;
            }
            
            try {
                // Avval maxfiy so'zni tekshirish
                const checkRes = await fetch('/api/auth/verify-secret', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        username: state.currentUser.username,
                        secretWord: secretWord 
                    })
                });
                
                if (!checkRes.ok) {
                    showToast('Maxfiy so\'z noto\'g\'ri!', true);
                    return;
                }
                
                // Parol o'zgartirish so'rovini yuborish (admin tasdiqini kutadi)
                const res = await fetch('/api/auth/request-password-change', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        userId: state.currentUser.id,
                        newPassword: newPassword,
                        secretWord: secretWord
                    })
                });
                
                if (res.ok) {
                    showToast('Parol o\'zgartirish so\'rovi yuborildi! Admin tasdiqini kuting.');
                    document.getElementById('password-modal').classList.add('hidden');
                    passwordForm.reset();
                } else {
                    const error = await res.json();
                    showToast(error.message || 'So\'rov yuborishda xatolik!', true);
                }
            } catch (error) {
                showToast('So\'rov yuborishda xatolik!', true);
                console.error(error);
            }
        });
    }
    
    // Sessiyalar modal
    async function openSessionsModal() {
        const modal = document.getElementById('sessions-modal');
        const sessionsList = document.getElementById('sessions-list');
        
        sessionsList.innerHTML = '<div class="loading-state">Yuklanmoqda...</div>';
        modal.classList.remove('hidden');
        
        try {
            const res = await fetch('/api/users/me/sessions');
            if (res.ok) {
                const sessions = await res.json();
                
                if (sessions.length === 0) {
                    sessionsList.innerHTML = '<div class="empty-state">Aktiv sessiyalar topilmadi</div>';
                } else {
                    sessionsList.innerHTML = sessions.map(session => `
                        <div class="session-item ${session.is_current ? 'current' : ''}">
                            <div class="session-icon">
                                <i data-feather="smartphone"></i>
                            </div>
                            <div class="session-info">
                                <strong>${session.is_current ? '🟢 Joriy sessiya' : 'Sessiya'}</strong>
                                <small>${session.location?.city || 'Noma\'lum'}, ${session.location?.country || ''}</small>
                                <small>IP: ${session.ip_address || 'N/A'}</small>
                                <small>${new Date(session.last_activity).toLocaleString('uz-UZ')}</small>
                            </div>
                            ${!session.is_current ? `
                                <div class="session-actions">
                                    <button class="btn btn-danger btn-sm" onclick="terminateSession('${session.sid}')">
                                        Tugatish
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    `).join('');
                    feather.replace();
                }
            } else {
                sessionsList.innerHTML = '<div class="empty-state">Sessiyalarni yuklashda xatolik</div>';
            }
        } catch (error) {
            sessionsList.innerHTML = '<div class="empty-state">Sessiyalarni yuklashda xatolik</div>';
            console.error(error);
        }
    }
    
    // Sessiyani tugatish
    window.terminateSession = async function(sid) {
        if (!confirm('Ushbu sessiyani tugatmoqchimisiz?')) return;
        
        try {
            const res = await fetch(`/api/sessions/${sid}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('Sessiya tugatildi!');
                openSessionsModal();
            } else {
                showToast('Sessiyani tugatishda xatolik!', true);
            }
        } catch (error) {
            showToast('Sessiyani tugatishda xatolik!', true);
            console.error(error);
        }
    };
    
    // Bildirishnomalar modal
    async function openNotificationsModal() {
        const modal = document.getElementById('notifications-modal');
        modal.classList.remove('hidden');
        
        // Sahifani yoritishni olib tashlash (agar mavjud bo'lsa)
        document.body.classList.remove('notification-highlight');
        
        // Notification'larni yuklash
        await loadNotifications();
        
        // "Barchasini o'qilgan deb belgilash" tugmasi event listener
        const markAllReadBtn = document.getElementById('mark-all-read-btn');
        if (markAllReadBtn) {
            markAllReadBtn.onclick = async () => {
                try {
                    await fetch('/api/notifications/read-all', { method: 'PUT' });
                    await loadNotifications();
                    await checkUnreadNotifications();
                } catch (error) {
                    console.error('Mark all as read error:', error);
                }
            };
        }
        
        feather.replace();
    }
    
    // Global funksiya qilish
    window.openNotificationsModal = openNotificationsModal;
    window.loadNotifications = loadNotifications;

    // Notification'larni yuklash
    async function loadNotifications() {
        try {
            const res = await fetch('/api/notifications');
            const notificationsList = document.getElementById('notifications-list');
            
            if (!res || !res.ok) {
                if (notificationsList) {
                    notificationsList.innerHTML = '<div class="empty-state">Bildirishnomalarni yuklashda xatolik</div>';
                }
                return;
            }

            const data = await res.json();
            const notifications = data.notifications || [];
            const unreadCount = data.unread_count || 0;

            // Avatar'ga pulsatsiya effekti qo'shish/olib tashlash
            updateAvatarNotificationState(unreadCount);

            // Notification badge'ni yangilash
            const notificationBadge = document.querySelector('#notifications-btn .notification-badge');
            if (notificationBadge) {
                if (unreadCount > 0) {
                    notificationBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                    notificationBadge.style.display = 'inline-block';
                } else {
                    notificationBadge.style.display = 'none';
                }
            }

            if (notificationsList) {
                if (notifications.length === 0) {
                    notificationsList.innerHTML = '<div class="empty-state">Hozircha bildirishnomalar yo\'q</div>';
                    return;
                }

                notificationsList.innerHTML = notifications.map(notif => {
                    const isRead = notif.is_read;
                    const createdDate = new Date(notif.created_at);
                    const timeAgo = getTimeAgo(createdDate);
                    const details = notif.details || {};

                    let detailsHtml = '';
                    if (notif.type === 'comparison_difference' && details.differences) {
                        const diffCount = details.differences.length;
                        const hasMultiple = diffCount > 1;
                        
                        detailsHtml = `
                            <div class="notification-details">
                                <div class="notification-details-header">
                                    <i data-feather="info"></i>
                                    <span>Batafsil ma'lumot</span>
                                </div>
                                <div class="notification-details-body">
                                    <div class="notification-detail-row">
                                        <span class="detail-label">Sana:</span>
                                        <span class="detail-value">${details.date || 'Noma\'lum'}</span>
                                    </div>
                                    <div class="notification-detail-row">
                                        <span class="detail-label">Brend:</span>
                                        <span class="detail-value">${details.brand_name || 'Noma\'lum'}</span>
                                    </div>
                                    <div class="notification-detail-row">
                                        <span class="detail-label">Farqlar soni:</span>
                                        <span class="detail-value highlight">${diffCount} ta filial</span>
                                    </div>
                                    ${details.differences && details.differences.length > 0 ? `
                                        <div class="notification-differences-list">
                                            <div class="differences-header">
                                                <i data-feather="map-pin"></i>
                                                <span>Filiallar:</span>
                                            </div>
                                            <div class="differences-items">
                                                ${details.differences.map(diff => {
                                                    const diffValue = diff.difference || 0;
                                                    const diffColor = diffValue > 0 ? 'var(--green-color)' : 'var(--red-color)';
                                                    const diffSign = diffValue > 0 ? '+' : '';
                                                    const diffPercent = diff.percentage !== null 
                                                        ? ` (${diff.percentage > 100 ? '+' : ''}${(diff.percentage - 100).toFixed(2)}%)` 
                                                        : '';
                                                    
                                                    return `
                                                        <div class="difference-item">
                                                            <div class="difference-location">
                                                                <i data-feather="map-pin"></i>
                                                                <span>${diff.location}</span>
                                                            </div>
                                                            <div class="difference-amount" style="color: ${diffColor};">
                                                                ${diffSign}${formatNumber(Math.abs(diffValue))} so'm${diffPercent}
                                                            </div>
                                                        </div>
                                                    `;
                                                }).join('')}
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    }

                    return `
                        <div class="notification-card ${!isRead ? 'unread' : 'read'}" data-id="${notif.id}">
                            <div class="notification-card-indicator ${!isRead ? 'unread-indicator' : ''}"></div>
                            <div class="notification-card-icon" style="background: linear-gradient(135deg, ${notif.type === 'comparison_difference' ? '#dc3545' : '#007bff'} 0%, ${notif.type === 'comparison_difference' ? '#c82333' : '#0056b3'} 100%);">
                                <i data-feather="${notif.type === 'comparison_difference' ? 'alert-triangle' : 'bell'}"></i>
                            </div>
                            <div class="notification-card-content">
                                <div class="notification-card-header">
                                    <h3 class="notification-title">${notif.title}</h3>
                                    <span class="notification-time">${timeAgo}</span>
                                </div>
                                <p class="notification-message">${notif.message}</p>
                                ${detailsHtml}
                            </div>
                            ${!isRead ? '<div class="notification-unread-badge"></div>' : ''}
                        </div>
                    `;
                }).join('');

                // Click event listener qo'shish
                notificationsList.querySelectorAll('.notification-item').forEach(item => {
                    item.addEventListener('click', async () => {
                        const notificationId = item.dataset.id;
                        if (!item.classList.contains('read')) {
                            // O'qilgan deb belgilash
                            await markNotificationAsRead(notificationId);
                            item.classList.remove('unread');
                            item.classList.add('read');
                            
                            // Unread count'ni yangilash
                            await checkUnreadNotifications();
                        }
                    });
                });

                feather.replace();
            }
        } catch (error) {
            const notificationsList = document.getElementById('notifications-list');
            if (notificationsList) {
                notificationsList.innerHTML = '<div class="empty-state">Bildirishnomalarni yuklashda xatolik</div>';
            }
        }
    }

    // Notification'ni o'qilgan deb belgilash
    async function markNotificationAsRead(notificationId) {
        try {
            await fetch(`/api/notifications/${notificationId}/read`, {
                method: 'PUT'
            });
        } catch (error) {
            // Silent error handling
        }
    }

    // Unread notification'larni tekshirish va avatar'ni yangilash
    // Global qilish - realtime.js'da ishlatish uchun
    window.checkUnreadNotifications = async function checkUnreadNotifications() {
        try {
            const res = await fetch('/api/notifications?unread_only=true');
            if (!res || !res.ok) return;

            const data = await res.json();
            const unreadCount = data.unread_count || 0;

            updateAvatarNotificationState(unreadCount);

            // Notification badge'ni yangilash
            const notificationBadge = document.querySelector('#notifications-btn .notification-badge');
            if (notificationBadge) {
                if (unreadCount > 0) {
                    notificationBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                    notificationBadge.style.display = 'inline-block';
                } else {
                    notificationBadge.style.display = 'none';
                }
            }
        } catch (error) {
            // Silent error handling
        }
    }

    // Avatar'ga pulsatsiya effekti qo'shish/olib tashlash
    // Global qilish - realtime.js'da ishlatish uchun
    window.updateAvatarNotificationState = function updateAvatarNotificationState(unreadCount) {
        const avatarDisplay = document.getElementById('user-avatar-display');
        if (avatarDisplay) {
            if (unreadCount > 0) {
                avatarDisplay.classList.add('has-notification');
            } else {
                avatarDisplay.classList.remove('has-notification');
            }
        }
    }

    // Vaqtni formatlash (time ago)
    function getTimeAgo(date) {
        const now = new Date();
        const diff = Math.floor((now - date) / 1000); // seconds

        if (diff < 60) return `${diff} soniya oldin`;
        if (diff < 3600) return `${Math.floor(diff / 60)} daqiqa oldin`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} soat oldin`;
        if (diff < 604800) return `${Math.floor(diff / 86400)} kun oldin`;
        
        return date.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // formatNumber funksiyasi allaqachon mavjud (134-qatorda)

    // Sayt yuklanganda va har 30 soniyada notification'larni tekshirish
    checkUnreadNotifications();
    setInterval(checkUnreadNotifications, 30000); // 30 soniyada bir marta

    // =================================================================
    // KPI VA SESSIYA STATISTIKALARI
    // =================================================================

    // KPI ma'lumotlarini yuklash va ko'rsatish
    async function loadKPIStats() {
        try {
            // KPI sozlamalarini yuklash
            try {
                const settingsRes = await fetch('/api/settings');
                if (settingsRes && settingsRes.ok) {
                    const settingsData = await settingsRes.json();

                    // /api/settings hozir obyekt qaytaradi (settings.js da), lekin kelajakda array bo'lishi ham mumkin.
                    let rawKpiSettings = null;

                    if (Array.isArray(settingsData)) {
                        const kpiRow = settingsData.find(s => s.key === 'kpi_settings');
                        rawKpiSettings = kpiRow ? kpiRow.value : null;
                    } else if (settingsData && Object.prototype.hasOwnProperty.call(settingsData, 'kpi_settings')) {
                        rawKpiSettings = settingsData.kpi_settings;
                    }

                    if (rawKpiSettings) {
                        // Agar string bo'lsa JSON.parse qilamiz, aks holda obyektni to'g'ridan-to'g'ri ishlatamiz
                        window.kpiSettings = typeof rawKpiSettings === 'string'
                            ? JSON.parse(rawKpiSettings)
                            : rawKpiSettings;
                    } else {
                        window.kpiSettings = { latePenalty: 0.5, editPenalty: 0.3 };
                    }
                } else {
                    window.kpiSettings = { latePenalty: 0.5, editPenalty: 0.3 };
                }
            } catch (error) {
                console.warn('KPI sozlamalarini yuklashda xatolik, default qiymatlar ishlatiladi:', error);
                window.kpiSettings = { latePenalty: 0.5, editPenalty: 0.3 };
            }
            
            // State dan mavjud hisobotlarni olish
            let reports = [];
            
            // state.reports array yoki object bo'lishi mumkin
            if (state.reports) {
                if (Array.isArray(state.reports)) {
                    reports = state.reports;
                } else if (typeof state.reports === 'object') {
                    reports = Object.values(state.reports);
                }
            }
            
            // Agar savedReports bo'lsa
            if (reports.length === 0 && state.savedReports) {
                if (Array.isArray(state.savedReports)) {
                    reports = state.savedReports;
                } else if (typeof state.savedReports === 'object') {
                    reports = Object.values(state.savedReports);
                }
            }
            
            if (reports.length === 0) {
                // Default qiymatlar - faqat kpi-cards div mavjud bo'lsa
                const kpiCardsDiv = document.getElementById('kpi-cards');
                if (kpiCardsDiv) {
                    const stats = {
                        total: 0,
                        kpiPercent: 0,
                        ontime: 0,
                        late: 0,
                        latePercent: 0,
                        edited: 0,
                        editedPercent: 0
                    };
                    kpiCardsDiv.innerHTML = renderKpiCards(stats);
                    if (window.feather) feather.replace();
                }
                return;
            }
            
            // Tahrirlangan (is_edited = true yoki updated_at mavjud yoki edit_count > 0)
            const edited = reports.filter(r => r.is_edited || (r.updated_at && r.created_at !== r.updated_at) || (r.edit_count && r.edit_count > 0));
            
            // O\\'z vaqtida topshirilganlar (date/report_date va created_at orasidagi farq < 1 kun)
            const ontime = reports.filter(r => {
                const reportDate = r.report_date || r.date;
                const createdAt = r.created_at || r.createdAt;
                if (!reportDate || !createdAt) return false;
                const rDate = new Date(reportDate);
                const cDate = new Date(createdAt);
                rDate.setHours(0, 0, 0, 0);
                cDate.setHours(0, 0, 0, 0);
                const diffDays = (cDate - rDate) / (1000 * 60 * 60 * 24);
                // created_at < report_date => олдиндан топширилган, бу ҳам ўз вақтида
                return diffDays < 1;
            });
            
            // Kechikkanlar (date/report_date va created_at orasidagi farq >= 1 kun)
            const late = reports.filter(r => {
                const reportDate = r.report_date || r.date;
                const createdAt = r.created_at || r.createdAt;
                if (!reportDate || !createdAt) return false;
                const rDate = new Date(reportDate);
                const cDate = new Date(createdAt);
                rDate.setHours(0, 0, 0, 0);
                cDate.setHours(0, 0, 0, 0);
                const diffDays = (cDate - rDate) / (1000 * 60 * 60 * 24);
                return diffDays >= 1;
            });
            
            const total = reports.length || 1;
            
            // Foizlarni hisoblash
            const onTimePercentage = total > 0 ? (ontime.length / total) * 100 : 0;
            const latePercentage = total > 0 ? (late.length / total) * 100 : 0;
            const editedPercentage = total > 0 ? (edited.length / total) * 100 : 0;
            
            // KPI sozlamalarini olish (default: latePenalty = 0.5, editPenalty = 0.3)
            const kpiSettings = window.kpiSettings || { latePenalty: 0.5, editPenalty: 0.3 };
            const latePenalty = kpiSettings.latePenalty || 0.5;
            const editPenalty = kpiSettings.editPenalty || 0.3;
            
            // Umumiy KPI = o'z vaqtida foizi - (kechikkan foizi * penalty) - (tahrirlangan foizi * penalty)
            // Minimum 0% bo'lishi kerak
            const totalKpiPercent = Math.max(0, Math.round(
                onTimePercentage - (latePercentage * latePenalty) - (editedPercentage * editPenalty)
            ));
            
            // KPI kartochkalarini chiqarish
            const stats = {
                total,
                kpiPercent: totalKpiPercent,
                ontime: ontime.length,
                ontimePercent: Math.round(onTimePercentage),
                late: late.length,
                latePercent: Math.round(latePercentage),
                edited: edited.length,
                editedPercent: Math.round(editedPercentage),
                latePenalty: latePenalty,
                editPenalty: editPenalty
            };
            const kpiCardsDiv = document.getElementById('kpi-cards');
            if (kpiCardsDiv) {
                kpiCardsDiv.innerHTML = renderKpiCards(stats);
                if (window.feather) feather.replace();
            }
            // Ma'lumotlarni saqlash
            window.kpiData = { ontime, late, edited, reports, total };
        } catch (error) {
            console.error('KPI yuklashda xatolik:', error);
            // Default qiymatlar - faqat kpi-cards div mavjud bo'lsa
            const kpiCardsDiv = document.getElementById('kpi-cards');
            if (kpiCardsDiv) {
                const stats = {
                    total: 0,
                    kpiPercent: 0,
                    ontime: 0,
                    late: 0,
                    latePercent: 0,
                    edited: 0,
                    editedPercent: 0
                };
                kpiCardsDiv.innerHTML = renderKpiCards(stats);
                if (window.feather) feather.replace();
            }
        }
    }

    // Sessiya statistikasini yuklash
    async function loadSessionStats() {
        // Hozircha oddiy qiymatlar - joriy foydalanuvchi
        const activeUsersEl = document.getElementById('active-users-count');
        const totalSessionsEl = document.getElementById('total-sessions-count');
        
        if (activeUsersEl && totalSessionsEl) {
            // Joriy foydalanuvchi
            activeUsersEl.textContent = '1';
            totalSessionsEl.textContent = '1';
            
            // Mock data - kelajakda real API dan olinadi
            window.sessionsData = [{
                username: state.currentUser?.username || "Foydalanuvchi",
                user_id: state.currentUser?.id || 1,
                ip: 'localhost',
                location: 'Tashkent',
                last_activity: new Date().toISOString(),
                user_agent: navigator.userAgent
            }];
        }
    }

    // Date range picker larini saqlash
    const kpiDatePickers = {};
    
    // Date range picker yaratish
    function initKPIDateRangePicker(inputId, onChangeCallback) {
        const input = document.getElementById(inputId);
        if (!input || kpiDatePickers[inputId]) return;
        
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        
        kpiDatePickers[inputId] = flatpickr(input, {
            mode: 'range',
            dateFormat: 'd.m.Y',
            defaultDate: [startDate, endDate],
            maxDate: endDate,
            locale: {
                firstDayOfWeek: 1,
                weekdays: {
                    shorthand: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
                    longhand: ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba']
                },
                months: {
                    shorthand: ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'],
                    longhand: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
                },
                rangeSeparator: ' — '
            },
            onChange: function(selectedDates) {
                if (selectedDates.length === 2) {
                    const diffTime = Math.abs(selectedDates[1] - selectedDates[0]);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    
                    if (diffDays > 7) {
                        showToast('Maksimal 7 kunlik muddat tanlash mumkin!', true);
                        this.setDate([startDate, endDate]);
                    } else if (onChangeCallback) {
                        onChangeCallback(selectedDates);
                    }
                }
            },
            onReady: function() {
                if (onChangeCallback) {
                    onChangeCallback([startDate, endDate]);
                }
            }
        });
    }
    
    // Preset tugmalari uchun event listener
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('preset-btn')) {
            const days = parseInt(e.target.dataset.days);
            const target = e.target.dataset.target;
            const inputId = `${target}-kpi-daterange`;
            
            // Active klassni o'zgartirish
            e.target.closest('.date-presets').querySelectorAll('.preset-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            e.target.classList.add('active');
            
            // Sanalarni o'rnatish
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            
            if (kpiDatePickers[inputId]) {
                kpiDatePickers[inputId].setDate([startDate, endDate]);
            }
        }
    });
    
    // Sanalar orasidagi kunlarni tekshirish
    function validateDateRange(startDate, endDate) {
        const diffTime = Math.abs(endDate - startDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= 7;
    }
    
    // Hisobotlarni sana bo'yicha filtrlash
    function filterReportsByDate(reports, startDate, endDate) {
        return reports.filter(r => {
            const reportDate = new Date(r.created_at);
            return reportDate >= startDate && reportDate <= endDate;
        });
    }
    
    // Jami hisobotlar modal
    function openTotalKPIModal() {
        const modal = document.getElementById('total-kpi-modal');
        const list = document.getElementById('total-kpi-list');
        
        // Date range picker yaratish
        initKPIDateRangePicker('total-kpi-daterange', function(selectedDates) {
            if (selectedDates.length === 2) {
                renderTotalKPIList(selectedDates[0], selectedDates[1]);
            }
        });
        
        if (!window.kpiData || !window.kpiData.reports || !window.kpiData.reports.length) {
            list.innerHTML = '<div class="empty-state">Ma\'lumot yo\'q</div>';
        } else {
            // So'nggi 7 kunlik hisobotlarni ko'rsatish
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            
            const filteredReports = filterReportsByDate(window.kpiData.reports, startDate, endDate);
            
            if (filteredReports.length === 0) {
                list.innerHTML = '<div class="empty-state">Tanlangan muddat uchun ma\'lumot yo\'q</div>';
                modal.classList.remove('hidden');
                feather.replace();
                return;
            }
            
            list.innerHTML = filteredReports.map(report => {
                let statusBadge = '';
                let statusClass = 'info';
                
                if (report.is_edited) {
                    statusBadge = '<i data-feather="edit-3"></i> Tahrirlangan';
                    statusClass = 'info';
                } else if (report.updated_at) {
                    const created = new Date(report.created_at);
                    const updated = new Date(report.updated_at);
                    const diffHours = Math.abs(updated - created) / 36e5;
                    
                    if (diffHours >= 1) {
                        statusBadge = '<i data-feather="clock"></i> Kechikkan';
                        statusClass = 'warning';
                    } else {
                        statusBadge = '<i data-feather="check"></i> O\'z vaqtida';
                        statusClass = 'success';
                    }
                } else {
                    statusBadge = '<i data-feather="check"></i> O\'z vaqtida';
                    statusClass = 'success';
                }
                
                // Sanani formatlash
                const createdDate = report.created_at ? new Date(report.created_at).toLocaleString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : 'N/A';
                
                const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }) : 'N/A';
                
                const locationText = report.brand_name || report.location || report.old_location || 'Noma\'lum';
                const userName = report.user_name || report.username || "Foydalanuvchi";
                
                return `
                <div class="kpi-item">
                    <div class="kpi-item-header">
                        <span class="kpi-item-title">Hisobot #${report.id}</span>
                        <span class="kpi-item-date">
                            <i data-feather="calendar"></i>
                            ${reportDate}
                        </span>
                    </div>
                    <div class="kpi-item-details">
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="map-pin" style="width: 14px; height: 14px;"></i> Filial</span>
                            <span class="kpi-detail-value"><strong>${locationText}</strong></span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="clock" style="width: 14px; height: 14px;"></i> Yaratilgan</span>
                            <span class="kpi-detail-value">${createdDate}</span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="user" style="width: 14px; height: 14px;"></i> Yaratuvchi</span>
                            <span class="kpi-detail-value">${userName}</span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label">Status</span>
                            <span class="kpi-badge ${statusClass}">
                                ${statusBadge}
                            </span>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        }
        
        modal.classList.remove('hidden');
        feather.replace();
    }

    // O\\'z vaqtida modal
    function openOntimeKPIModal() {
        const modal = document.getElementById('ontime-kpi-modal');
        const list = document.getElementById('ontime-kpi-list');
        
        // Date range picker yaratish
        initKPIDateRangePicker('ontime-kpi-daterange', function(selectedDates) {
            if (selectedDates.length === 2) {
                renderOntimeKPIList(selectedDates[0], selectedDates[1]);
            }
        });
        
        if (!window.kpiData || !window.kpiData.ontime.length) {
            list.innerHTML = '<div class="empty-state">Ma\'lumot yo\'q</div>';
        } else {
            // So'nggi 7 kunlik hisobotlarni ko'rsatish
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            
            const filteredReports = filterReportsByDate(window.kpiData.ontime, startDate, endDate);
            
            if (filteredReports.length === 0) {
                list.innerHTML = '<div class="empty-state">Tanlangan muddat uchun ma\'lumot yo\'q</div>';
                modal.classList.remove('hidden');
                feather.replace();
                return;
            }
            list.innerHTML = filteredReports.map(report => {
                const createdDate = report.created_at ? new Date(report.created_at).toLocaleString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : 'N/A';
                
                const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }) : 'N/A';
                
                const locationText = report.brand_name || report.location || report.old_location || 'Noma\'lum';
                const userName = report.user_name || report.username || "Foydalanuvchi";
                
                return `
                <div class="kpi-item">
                    <div class="kpi-item-header">
                        <span class="kpi-item-title">Hisobot #${report.id}</span>
                        <span class="kpi-item-date">
                            <i data-feather="calendar"></i>
                            ${reportDate}
                        </span>
                    </div>
                    <div class="kpi-item-details">
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="map-pin" style="width: 14px; height: 14px;"></i> Filial</span>
                            <span class="kpi-detail-value"><strong>${locationText}</strong></span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="clock" style="width: 14px; height: 14px;"></i> Yaratilgan</span>
                            <span class="kpi-detail-value">${createdDate}</span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="user" style="width: 14px; height: 14px;"></i> Yaratuvchi</span>
                            <span class="kpi-detail-value">${userName}</span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label">Status</span>
                            <span class="kpi-badge success">
                                <i data-feather="check"></i>
                                O\\'z vaqtida
                            </span>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        }
        
        modal.classList.remove('hidden');
        feather.replace();
    }

    // Kechikkan modal
    function openLateKPIModal() {
        const modal = document.getElementById('late-kpi-modal');
        const list = document.getElementById('late-kpi-list');
        
        // Date range picker yaratish
        initKPIDateRangePicker('late-kpi-daterange', function(selectedDates) {
            if (selectedDates.length === 2) {
                renderLateKPIList(selectedDates[0], selectedDates[1]);
            }
        });
        
        if (!window.kpiData || !window.kpiData.late.length) {
            list.innerHTML = '<div class="empty-state">Ma\'lumot yo\'q</div>';
        } else {
            // So'nggi 7 kunlik hisobotlarni ko'rsatish
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            
            const filteredReports = filterReportsByDate(window.kpiData.late, startDate, endDate);
            
            if (filteredReports.length === 0) {
                list.innerHTML = '<div class="empty-state">Tanlangan muddat uchun ma\'lumot yo\'q</div>';
                modal.classList.remove('hidden');
                feather.replace();
                return;
            }
            list.innerHTML = filteredReports.map(report => {
                const created = new Date(report.created_at);
                const updated = new Date(report.updated_at);
                const diffHours = Math.abs(updated - created) / 36e5;
                
                const createdDate = created.toLocaleString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }) : 'N/A';
                
                const locationText = report.brand_name || report.location || report.old_location || 'Noma\'lum';
                const userName = report.user_name || report.username || "Foydalanuvchi";
                
                return `
                <div class="kpi-item">
                    <div class="kpi-item-header">
                        <span class="kpi-item-title">Hisobot #${report.id}</span>
                        <span class="kpi-item-date">
                            <i data-feather="calendar"></i>
                            ${reportDate}
                        </span>
                    </div>
                    <div class="kpi-item-details">
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="map-pin" style="width: 14px; height: 14px;"></i> Filial</span>
                            <span class="kpi-detail-value"><strong>${locationText}</strong></span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="clock" style="width: 14px; height: 14px;"></i> Yaratilgan</span>
                            <span class="kpi-detail-value">${createdDate}</span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="user" style="width: 14px; height: 14px;"></i> Yaratuvchi</span>
                            <span class="kpi-detail-value">${userName}</span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="alert-circle" style="width: 14px; height: 14px;"></i> Kechikish</span>
                            <span class="kpi-badge warning">
                                <i data-feather="clock"></i>
                                ${Math.round(diffHours)} soat
                            </span>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        }
        
        modal.classList.remove('hidden');
        feather.replace();
    }

    // Tahrirlangan modal
    function openEditedKPIModal() {
        const modal = document.getElementById('edited-kpi-modal');
        const list = document.getElementById('edited-kpi-list');
        
        // Date range picker yaratish
        initKPIDateRangePicker('edited-kpi-daterange', function(selectedDates) {
            if (selectedDates.length === 2) {
                renderEditedKPIList(selectedDates[0], selectedDates[1]);
            }
        });
        
        if (!window.kpiData || !window.kpiData.edited.length) {
            list.innerHTML = '<div class="empty-state">Ma\'lumot yo\'q</div>';
        } else {
            // So'nggi 7 kunlik hisobotlarni ko'rsatish
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            
            const filteredReports = filterReportsByDate(window.kpiData.edited, startDate, endDate);
            
            if (filteredReports.length === 0) {
                list.innerHTML = '<div class="empty-state">Tanlangan muddat uchun ma\'lumot yo\'q</div>';
                modal.classList.remove('hidden');
                feather.replace();
                return;
            }
            list.innerHTML = filteredReports.map(report => {
                const createdDate = report.created_at ? new Date(report.created_at).toLocaleString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : 'N/A';
                
                const updatedDate = report.updated_at ? new Date(report.updated_at).toLocaleString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : 'N/A';
                
                const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }) : 'N/A';
                
                const locationText = report.brand_name || report.location || report.old_location || 'Noma\'lum';
                const userName = report.user_name || report.username || "Foydalanuvchi";
                
                return `
                <div class="kpi-item">
                    <div class="kpi-item-header">
                        <span class="kpi-item-title">Hisobot #${report.id}</span>
                        <span class="kpi-item-date">
                            <i data-feather="calendar"></i>
                            ${reportDate}
                        </span>
                    </div>
                    <div class="kpi-item-details">
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="map-pin" style="width: 14px; height: 14px;"></i> Filial</span>
                            <span class="kpi-detail-value"><strong>${locationText}</strong></span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="clock" style="width: 14px; height: 14px;"></i> Yaratilgan</span>
                            <span class="kpi-detail-value">${createdDate}</span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="user" style="width: 14px; height: 14px;"></i> Yaratuvchi</span>
                            <span class="kpi-detail-value">${userName}</span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label"><i data-feather="edit-2" style="width: 14px; height: 14px;"></i> Tahrir vaqti</span>
                            <span class="kpi-detail-value"><strong style="color: #2196f3;">${updatedDate}</strong></span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label">Status</span>
                            <span class="kpi-badge info">
                                <i data-feather="edit-3"></i>
                                Tahrirlangan
                            </span>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        }
        
        modal.classList.remove('hidden');
        feather.replace();
    }
    
    // Render funksiyalari
    function renderTotalKPIList(startDate, endDate) {
        const list = document.getElementById('total-kpi-list');
        if (!window.kpiData || !window.kpiData.reports || !window.kpiData.reports.length) {
            list.innerHTML = "<div class='empty-state'>Ma'lumot yo'q</div>";
            return;
        }
        
        const filteredReports = filterReportsByDate(window.kpiData.reports, startDate, endDate);
        
        if (filteredReports.length === 0) {
            list.innerHTML = "<div class='empty-state'>Tanlangan muddat uchun ma'lumot yo'q</div>";
            return;
        }
        
        list.innerHTML = filteredReports.map(report => {
            let statusBadge = '';
            let statusClass = 'info';
            
            if (report.is_edited) {
                statusBadge = "<i data-feather='edit-3'></i> Tahrirlangan";
                statusClass = 'info';
            } else if (report.updated_at) {
                const created = new Date(report.created_at);
                const updated = new Date(report.updated_at);
                const diffHours = Math.abs(updated - created) / 36e5;
                
                if (diffHours >= 1) {
                    statusBadge = "<i data-feather='clock'></i> Kechikkan";
                    statusClass = 'warning';
                } else {
                    statusBadge = "<i data-feather='check'></i> O\\'z vaqtida";
                    statusClass = 'success';
                }
            } else {
                statusBadge = "<i data-feather='check'></i> O\\'z vaqtida";
                statusClass = 'success';
            }
            
            const createdDate = report.created_at ? new Date(report.created_at).toLocaleString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
            
            const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }) : 'N/A';
            
            const locationText = report.brand_name || report.location || report.old_location || "Noma'lum";
            const userName = report.user_name || report.username || "Foydalanuvchi";
            
            return `
            <div class=\"kpi-item\">
                <div class=\"kpi-item-header\">
                    <span class=\"kpi-item-title\">Hisobot #${report.id}</span>
                    <span class=\"kpi-item-date\">
                        <i data-feather=\"calendar\"></i>
                        ${reportDate}
                    </span>
                </div>
                <div class=\"kpi-item-details\">
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"map-pin\" style=\"width: 14px; height: 14px;\"></i> Filial</span>
                        <span class=\"kpi-detail-value\"><strong>${locationText}</strong></span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"clock\" style=\"width: 14px; height: 14px;\"></i> Yaratilgan</span>
                        <span class=\"kpi-detail-value\">${createdDate}</span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"user\" style=\"width: 14px; height: 14px;\"></i> Yaratuvchi</span>
                        <span class=\"kpi-detail-value\">${userName}</span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\">Status</span>
                        <span class=\"kpi-badge ${statusClass}">
                            ${statusBadge}
                        </span>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        
        feather.replace();
    }
    
    function renderOntimeKPIList(startDate, endDate) {
        const list = document.getElementById('ontime-kpi-list');
        if (!window.kpiData || !window.kpiData.ontime.length) {
            list.innerHTML = "<div class='empty-state'>Ma'lumot yo'q</div>";
            return;
        }
        
        const filteredReports = filterReportsByDate(window.kpiData.ontime, startDate, endDate);
        
        if (filteredReports.length === 0) {
            list.innerHTML = "<div class='empty-state'>Tanlangan muddat uchun ma'lumot yo'q</div>";
            return;
        }
        
        list.innerHTML = filteredReports.map(report => {
            const createdDate = report.created_at ? new Date(report.created_at).toLocaleString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
            
            const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }) : 'N/A';
            
            const locationText = report.brand_name || report.location || report.old_location || "Noma'lum";
            const userName = report.user_name || report.username || "Foydalanuvchi";
            
            return `
            <div class=\"kpi-item\">
                <div class=\"kpi-item-header\">
                    <span class=\"kpi-item-title\">Hisobot #${report.id}</span>
                    <span class=\"kpi-item-date\">
                        <i data-feather=\"calendar\"></i>
                        ${reportDate}
                    </span>
                </div>
                <div class=\"kpi-item-details\">
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"map-pin\" style=\"width: 14px; height: 14px;\"></i> Filial</span>
                        <span class=\"kpi-detail-value\"><strong>${locationText}</strong></span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"clock\" style=\"width: 14px; height: 14px;\"></i> Yaratilgan</span>
                        <span class=\"kpi-detail-value\">${createdDate}</span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"user\" style=\"width: 14px; height: 14px;\"></i> Yaratuvchi</span>
                        <span class=\"kpi-detail-value\">${userName}</span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\">Status</span>
                        <span class=\"kpi-badge success\">
                            <i data-feather=\"check\"></i>
                            O'z vaqtida
                        </span>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        
        feather.replace();
    }
    
    function renderLateKPIList(startDate, endDate) {
        const list = document.getElementById('late-kpi-list');
        if (!window.kpiData || !window.kpiData.late.length) {
            list.innerHTML = "<div class='empty-state'>Ma'lumot yo'q</div>";
            return;
        }
        
        const filteredReports = filterReportsByDate(window.kpiData.late, startDate, endDate);
        
        if (filteredReports.length === 0) {
            list.innerHTML = "<div class='empty-state'>Tanlangan muddat uchun ma'lumot yo'q</div>";
            return;
        }
        
        list.innerHTML = filteredReports.map(report => {
            const created = new Date(report.created_at);
            const updated = new Date(report.updated_at);
            const diffHours = Math.abs(updated - created) / 36e5;
            
            const createdDate = created.toLocaleString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }) : 'N/A';
            
            const locationText = report.brand_name || report.location || report.old_location || "Noma'lum";
            const userName = report.user_name || report.username || "Foydalanuvchi";
            
            return `
            <div class=\"kpi-item\">
                <div class=\"kpi-item-header\">
                    <span class=\"kpi-item-title\">Hisobot #${report.id}</span>
                    <span class=\"kpi-item-date\">
                        <i data-feather=\"calendar\"></i>
                        ${reportDate}
                    </span>
                </div>
                <div class=\"kpi-item-details\">
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"map-pin\" style=\"width: 14px; height: 14px;\"></i> Filial</span>
                        <span class=\"kpi-detail-value\"><strong>${locationText}</strong></span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"clock\" style=\"width: 14px; height: 14px;\"></i> Yaratilgan</span>
                        <span class=\"kpi-detail-value\">${createdDate}</span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"user\" style=\"width: 14px; height: 14px;\"></i> Yaratuvchi</span>
                        <span class=\"kpi-detail-value\">${userName}</span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"alert-circle\" style=\"width: 14px; height: 14px;\"></i> Kechikish</span>
                        <span class=\"kpi-badge warning\">
                            <i data-feather=\"clock\"></i>
                            ${Math.round(diffHours)} soat
                        </span>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        
        feather.replace();
    }
    
    function renderEditedKPIList(startDate, endDate) {
        const list = document.getElementById('edited-kpi-list');
        if (!window.kpiData || !window.kpiData.edited.length) {
            list.innerHTML = "<div class='empty-state'>Ma'lumot yo'q</div>";
            return;
        }
        
        const filteredReports = filterReportsByDate(window.kpiData.edited, startDate, endDate);
        
        if (filteredReports.length === 0) {
            list.innerHTML = "<div class='empty-state'>Tanlangan muddat uchun ma'lumot yo'q</div>";
            return;
        }
        
        list.innerHTML = filteredReports.map(report => {
            const createdDate = report.created_at ? new Date(report.created_at).toLocaleString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
            
            const updatedDate = report.updated_at ? new Date(report.updated_at).toLocaleString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
            
            const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }) : 'N/A';
            
            const locationText = report.brand_name || report.location || report.old_location || "Noma'lum";
            const userName = report.user_name || report.username || "Foydalanuvchi";
            
            return `
            <div class=\"kpi-item\">
                <div class=\"kpi-item-header\">
                    <span class=\"kpi-item-title\">Hisobot #${report.id}</span>
                    <span class=\"kpi-item-date\">
                        <i data-feather=\"calendar\"></i>
                        ${reportDate}
                    </span>
                </div>
                <div class=\"kpi-item-details\">
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"map-pin\" style=\"width: 14px; height: 14px;\"></i> Filial</span>
                        <span class=\"kpi-detail-value\"><strong>${locationText}</strong></span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"clock\" style=\"width: 14px; height: 14px;\"></i> Yaratilgan</span>
                        <span class=\"kpi-detail-value\">${createdDate}</span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"user\" style=\"width: 14px; height: 14px;\"></i> Yaratuvchi</span>
                        <span class=\"kpi-detail-value\">${userName}</span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\"><i data-feather=\"edit-2\" style=\"width: 14px; height: 14px;\"></i> Tahrir vaqti</span>
                        <span class=\"kpi-detail-value\"><strong style=\"color: #2196f3;\">${updatedDate}</strong></span>
                    </div>
                    <div class=\"kpi-detail-row\">
                        <span class=\"kpi-detail-label\">Status</span>
                        <span class=\"kpi-badge info\">
                            <i data-feather=\"edit-3\"></i>
                            Tahrirlangan
                        </span>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        
        feather.replace();
    }
    
    // Filtr funksiyalari
    window.applyTotalKPIFilter = function() {
        const startInput = document.getElementById('total-kpi-start-date');
        const endInput = document.getElementById('total-kpi-end-date');
        const list = document.getElementById('total-kpi-list');
        
        if (!startInput.value || !endInput.value) {
            alert('Iltimos, ikkala sanani ham tanlang');
            return;
        }
        
        const startDate = new Date(startInput.value);
        const endDate = new Date(endInput.value);
        endDate.setHours(23, 59, 59, 999);
        
        if (!validateDateRange(startDate, endDate)) {
            alert('Maksimal 7 kunlik muddat tanlash mumkin!');
            return;
        }
        
        const filteredReports = filterReportsByDate(window.kpiData.reports, startDate, endDate);
        
        if (filteredReports.length === 0) {
            list.innerHTML = '<div class="empty-state">Tanlangan muddat uchun ma\'lumot yo\'q</div>';
            return;
        }
        
        list.innerHTML = filteredReports.map(report => {
            let statusBadge = '';
            let statusClass = 'info';
            
            if (report.is_edited) {
                statusBadge = '<i data-feather="edit-3"></i> Tahrirlangan';
                statusClass = 'info';
            } else if (report.updated_at) {
                const created = new Date(report.created_at);
                const updated = new Date(report.updated_at);
                const diffHours = Math.abs(updated - created) / 36e5;
                
                if (diffHours >= 1) {
                    statusBadge = '<i data-feather="clock"></i> Kechikkan';
                    statusClass = 'warning';
                } else {
                    statusBadge = "<i data-feather='check'></i> O'z vaqtida";
                    statusClass = 'success';
                }
            } else {
                statusBadge = "<i data-feather='check'></i> O'z vaqtida";
                statusClass = 'success';
            }
            
            const createdDate = report.created_at ? new Date(report.created_at).toLocaleString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
            
            const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }) : 'N/A';
            
            const locationText = report.brand_name || report.location || report.old_location || "Noma'lum";
            const userName = report.user_name || report.username || "Foydalanuvchi";
            
            return `
            <div class="kpi-item">
                <div class="kpi-item-header">
                    <span class="kpi-item-title">Hisobot #${report.id}</span>
                    <span class="kpi-item-date">
                        <i data-feather="calendar"></i>
                        ${reportDate}
                    </span>
                </div>
                <div class="kpi-item-details">
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="map-pin" style="width: 14px; height: 14px;"></i> Filial</span>
                        <span class="kpi-detail-value"><strong>${locationText}</strong></span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="clock" style="width: 14px; height: 14px;"></i> Yaratilgan</span>
                        <span class="kpi-detail-value">${createdDate}</span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="user" style="width: 14px; height: 14px;"></i> Yaratuvchi</span>
                        <span class="kpi-detail-value">${userName}</span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label">Status</span>
                        <span class="kpi-badge ${statusClass}">
                            ${statusBadge}
                        </span>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        
        feather.replace();
    };
    
    window.applyOntimeKPIFilter = function() {
        const startInput = document.getElementById('ontime-kpi-start-date');
        const endInput = document.getElementById('ontime-kpi-end-date');
        const list = document.getElementById('ontime-kpi-list');
        
        if (!startInput.value || !endInput.value) {
            alert('Iltimos, ikkala sanani ham tanlang');
            return;
        }
        
        const startDate = new Date(startInput.value);
        const endDate = new Date(endInput.value);
        endDate.setHours(23, 59, 59, 999);
        
        if (!validateDateRange(startDate, endDate)) {
            alert('Maksimal 7 kunlik muddat tanlash mumkin!');
            return;
        }
        
        const filteredReports = filterReportsByDate(window.kpiData.ontime, startDate, endDate);
        
        if (filteredReports.length === 0) {
            list.innerHTML = "<div class='empty-state'>Tanlangan muddat uchun ma'lumot yo'q</div>";
            return;
        }
        
        list.innerHTML = filteredReports.map(report => {
            const createdDate = report.created_at ? new Date(report.created_at).toLocaleString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
            
            const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }) : 'N/A';
            
            const locationText = report.brand_name || report.location || report.old_location || "Noma'lum";
            const userName = report.user_name || report.username || "Foydalanuvchi";
            
            return `
            <div class="kpi-item">
                <div class="kpi-item-header">
                    <span class="kpi-item-title">Hisobot #${report.id}</span>
                    <span class="kpi-item-date">
                        <i data-feather="calendar"></i>
                        ${reportDate}
                    </span>
                </div>
                <div class="kpi-item-details">
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="map-pin" style="width: 14px; height: 14px;"></i> Filial</span>
                        <span class="kpi-detail-value"><strong>${locationText}</strong></span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="clock" style="width: 14px; height: 14px;"></i> Yaratilgan</span>
                        <span class="kpi-detail-value">${createdDate}</span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="user" style="width: 14px; height: 14px;"></i> Yaratuvchi</span>
                        <span class="kpi-detail-value">${userName}</span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label">Status</span>
                        <span class="kpi-badge success">
                            <i data-feather="check"></i>
                            O\\'z vaqtida
                        </span>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        
        feather.replace();
    };
    
    window.applyLateKPIFilter = function() {
        const startInput = document.getElementById('late-kpi-start-date');
        const endInput = document.getElementById('late-kpi-end-date');
        const list = document.getElementById('late-kpi-list');
        
        if (!startInput.value || !endInput.value) {
            alert('Iltimos, ikkala sanani ham tanlang');
            return;
        }
        
        const startDate = new Date(startInput.value);
        const endDate = new Date(endInput.value);
        endDate.setHours(23, 59, 59, 999);
        
        if (!validateDateRange(startDate, endDate)) {
            alert('Maksimal 7 kunlik muddat tanlash mumkin!');
            return;
        }
        
        const filteredReports = filterReportsByDate(window.kpiData.late, startDate, endDate);
        
        if (filteredReports.length === 0) {
            list.innerHTML = "<div class='empty-state'>Tanlangan muddat uchun ma'lumot yo'q</div>";
            return;
        }
        
        list.innerHTML = filteredReports.map(report => {
            const created = new Date(report.created_at);
            const updated = new Date(report.updated_at);
            const diffHours = Math.abs(updated - created) / 36e5;
            
            const createdDate = created.toLocaleString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }) : 'N/A';
            
            const locationText = report.brand_name || report.location || report.old_location || "Noma'lum";
            const userName = report.user_name || report.username || "Foydalanuvchi";
            
            return `
            <div class="kpi-item">
                <div class="kpi-item-header">
                    <span class="kpi-item-title">Hisobot #${report.id}</span>
                    <span class="kpi-item-date">
                        <i data-feather="calendar"></i>
                        ${reportDate}
                    </span>
                </div>
                <div class="kpi-item-details">
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="map-pin" style="width: 14px; height: 14px;"></i> Filial</span>
                        <span class="kpi-detail-value"><strong>${locationText}</strong></span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="clock" style="width: 14px; height: 14px;"></i> Yaratilgan</span>
                        <span class="kpi-detail-value">${createdDate}</span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="user" style="width: 14px; height: 14px;"></i> Yaratuvchi</span>
                        <span class="kpi-detail-value">${userName}</span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="alert-circle" style="width: 14px; height: 14px;"></i> Kechikish</span>
                        <span class="kpi-badge warning">
                            <i data-feather="clock"></i>
                            ${Math.round(diffHours)} soat
                        </span>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        
        feather.replace();
    };
    
    window.applyEditedKPIFilter = function() {
        const startInput = document.getElementById('edited-kpi-start-date');
        const endInput = document.getElementById('edited-kpi-end-date');
        const list = document.getElementById('edited-kpi-list');
        
        if (!startInput.value || !endInput.value) {
            alert('Iltimos, ikkala sanani ham tanlang');
            return;
        }
        
        const startDate = new Date(startInput.value);
        const endDate = new Date(endInput.value);
        endDate.setHours(23, 59, 59, 999);
        
        if (!validateDateRange(startDate, endDate)) {
            alert('Maksimal 7 kunlik muddat tanlash mumkin!');
            return;
        }
        
        const filteredReports = filterReportsByDate(window.kpiData.edited, startDate, endDate);
        
        if (filteredReports.length === 0) {
            list.innerHTML = "<div class='empty-state'>Tanlangan muddat uchun ma'lumot yo'q</div>";
            return;
        }
        
        list.innerHTML = filteredReports.map(report => {
            const createdDate = report.created_at ? new Date(report.created_at).toLocaleString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
            
            const updatedDate = report.updated_at ? new Date(report.updated_at).toLocaleString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : 'N/A';
            
            const reportDate = report.report_date ? new Date(report.report_date).toLocaleDateString('uz-UZ', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }) : 'N/A';
            
            const locationText = report.brand_name || report.location || report.old_location || "Noma'lum";
            const userName = report.user_name || report.username || "Foydalanuvchi";
            
            return `
            <div class="kpi-item">
                <div class="kpi-item-header">
                    <span class="kpi-item-title">Hisobot #${report.id}</span>
                    <span class="kpi-item-date">
                        <i data-feather="calendar"></i>
                        ${reportDate}
                    </span>
                </div>
                <div class="kpi-item-details">
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="map-pin" style="width: 14px; height: 14px;"></i> Filial</span>
                        <span class="kpi-detail-value"><strong>${locationText}</strong></span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="clock" style="width: 14px; height: 14px;"></i> Yaratilgan</span>
                        <span class="kpi-detail-value">${createdDate}</span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="user" style="width: 14px; height: 14px;"></i> Yaratuvchi</span>
                        <span class="kpi-detail-value">${userName}</span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label"><i data-feather="edit-2" style="width: 14px; height: 14px;"></i> Tahrir vaqti</span>
                        <span class="kpi-detail-value"><strong style="color: #2196f3;">${updatedDate}</strong></span>
                    </div>
                    <div class="kpi-detail-row">
                        <span class="kpi-detail-label">Status</span>
                        <span class="kpi-badge info">
                            <i data-feather="edit-3"></i>
                            Tahrirlangan
                        </span>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        
        feather.replace();
    };

    // Aktiv foydalanuvchilar modal
    function openActiveSessionsModal() {
        const modal = document.getElementById('active-sessions-modal');
        const list = document.getElementById('active-users-list');
        
        if (!window.sessionsData || !window.sessionsData.length) {
            list.innerHTML = '<div class="empty-state">Aktiv sessiya yo\'q</div>';
        } else {
            // Unique users bilan sessiyalar
            const userSessions = {};
            window.sessionsData.forEach(s => {
                const username = s.username || 'Noma\'lum';
                if (!userSessions[username]) {
                    userSessions[username] = [];
                }
                userSessions[username].push(s);
            });
            
            list.innerHTML = Object.entries(userSessions).map(([username, sessions]) => `
                <div class="kpi-item">
                    <div class="kpi-item-header">
                        <span class="kpi-item-title">${username}</span>
                        <span class="kpi-badge info">${sessions.length} sessiya</span>
                    </div>
                    <div class="kpi-item-details">
                        ${sessions.map(s => `
                            <div class="kpi-detail-row">
                                <span class="kpi-detail-label">IP: ${s.ip || 'localhost'}</span>
                                <span class="kpi-detail-value">${s.last_activity ? new Date(s.last_activity).toLocaleString('uz-UZ') : 'Hozir'}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        }
        
        modal.classList.remove('hidden');
        feather.replace();
    }

    // Jami sessiyalar modal
    function openTotalSessionsModal() {
        const modal = document.getElementById('total-sessions-modal');
        const list = document.getElementById('total-sessions-list');
        
        if (!window.sessionsData || !window.sessionsData.length) {
            list.innerHTML = '<div class="empty-state">Sessiya ma\'lumoti yo\'q</div>';
        } else {
            list.innerHTML = window.sessionsData.map(session => `
                <div class="kpi-item">
                    <div class="kpi-item-header">
                        <span class="kpi-item-title">${session.username || "Foydalanuvchi"}</span>
                        <span class="kpi-item-date">
                            <i data-feather="clock"></i>
                            ${session.last_activity ? new Date(session.last_activity).toLocaleString('uz-UZ') : 'Hozir'}
                        </span>
                    </div>
                    <div class="kpi-item-details">
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label">IP Manzil</span>
                            <span class="kpi-detail-value">${session.ip || 'localhost'}</span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label">Hudud</span>
                            <span class="kpi-detail-value">${session.location || 'Tashkent'}</span>
                        </div>
                        <div class="kpi-detail-row">
                            <span class="kpi-detail-label">Brauzer</span>
                            <span class="kpi-detail-value">${session.user_agent ? session.user_agent.substring(0, 50) + '...' : 'N/A'}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }
        
        modal.classList.remove('hidden');
        feather.replace();
    }

    // Event listeners qo'shish
    // KPI kartochkalar uchun modal kerak emas
    // document.getElementById('total-kpi-card')?.addEventListener('click', openTotalKPIModal);
    // document.getElementById('ontime-kpi-card')?.addEventListener('click', openOntimeKPIModal);
    // document.getElementById('late-kpi-card')?.addEventListener('click', openLateKPIModal);
    // document.getElementById('edited-kpi-card')?.addEventListener('click', openEditedKPIModal);
    document.getElementById('active-sessions-card')?.addEventListener('click', openActiveSessionsModal);
    document.getElementById('total-sessions-card')?.addEventListener('click', openTotalSessionsModal);

    // Har 60 sekundda yangilash
    setInterval(() => {
        if (typeof loadKPIStats === 'function') {
            loadKPIStats();
        }
        if (typeof loadSessionStats === 'function') {
            loadSessionStats();
        }
    }, 60000);

    // Dasturni ishga tushirish
    init();
});


