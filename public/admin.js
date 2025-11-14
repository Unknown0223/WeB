document.addEventListener('DOMContentLoaded', () => {
    // --- Global Holat (State) va DOM Elementlari ---
    const state = {
        settings: { 
            app_settings: { columns: [], rows: [], locations: [] }, 
            pagination_limit: 20,
            branding_settings: { text: 'MANUS', color: '#4CAF50', animation: 'anim-glow-pulse', border: 'border-none' },
            telegram_bot_username: ''
        },
        users: [],
        pendingUsers: [],
        roles: [],
        allPermissions: {},
        currentUser: null,
        pivotGrid: null, // YANGI: Pivot jadval obyektini saqlash uchun
        pivotTemplates: [], // Saqlangan shablonlar ro'yxati
        currentEditingRole: null,
        auditLog: {
            logs: [],
            pagination: { total: 0, pages: 1, currentPage: 1 },
            filters: { userId: '', startDate: '', endDate: '', actionType: '' },
            initialLoad: true
        },
        mySessions: [],
        // --- YANGI QO'SHILGAN STATE'LAR ---
        kpi: {
            data: [],
            currentSort: {
                key: 'kpiScore',
                direction: 'desc' // Standart saralash - reyting bo'yicha kamayish
            },
            selectedMonth: ''
        }
    };

    const DOM = {
        body: document.body,
        sidebarNav: document.querySelector('.sidebar-nav'),
        pages: document.querySelectorAll('.page'),
        logoutBtn: document.getElementById('logout-btn'),
        brandLogos: document.querySelectorAll('.brand-logo'),
        logoBorderEffects: document.querySelectorAll('.logo-border-effect'),
        
        // Dashboard
        statsGrid: document.getElementById('stats-grid'),
        dailyStatusGrid: document.getElementById('daily-status-grid'),
        dashboardDatePicker: document.getElementById('dashboard-date-picker'),
        dashboardSelectedDate: document.getElementById('dashboard-selected-date'),
        weeklyChartCanvas: document.getElementById('weekly-dynamics-chart'),
        
        // Foydalanuvchilar
        usersPage: document.getElementById('users'),
        userListContainer: document.getElementById('user-list-container'),
        userTabs: document.getElementById('user-tabs'),

        openAddUserModalBtn: document.getElementById('open-add-user-modal-btn'),
        userFormModal: document.getElementById('user-form-modal'),
        userForm: document.getElementById('user-form'),
        userModalTitle: document.getElementById('user-modal-title'),
        editUserIdInput: document.getElementById('edit-user-id'),
        usernameInput: document.getElementById('user-username'),
        fullnameInput: document.getElementById('user-fullname'),
        passwordInput: document.getElementById('user-password'),
        passwordGroup: document.getElementById('password-group'),
        userRoleSelect: document.getElementById('user-role'),
        deviceLimitInput: document.getElementById('user-device-limit'),
        userLocationsGroup: document.getElementById('user-locations-group'),
        locationsCheckboxList: document.getElementById('locations-checkbox-list'),

        // --- YANGI QO'SHILGAN DOM ELEMENTLARI ---
        employeeStatisticsPage: document.getElementById('employee-statistics'),
        kpiMonthPicker: document.getElementById('kpi-month-picker'),
        kpiTableBody: document.getElementById('kpi-table-body'),
        employeeDetailsView: document.getElementById('employee-details-view'),
        detailsViewTitle: document.getElementById('details-view-title'),
        detailsCalendarGrid: document.getElementById('details-calendar-grid'),
        backToKpiListBtn: document.getElementById('back-to-kpi-list-btn'),
        
        // Interaktiv hisobot uchun
        interactiveReportPage: document.getElementById('interactive-report'),
        pivotContainer: document.getElementById('pivot-container'),
    // Pivot template elements
    saveTemplateModal: document.getElementById('save-template-modal'),
    saveTemplateForm: document.getElementById('save-template-form'),
    templateNameInput: document.getElementById('template-name-input'),
    openTemplateModal: document.getElementById('open-template-modal'),
    templatesTagList: document.getElementById('templates-tag-list'),
        pivotDatePicker: document.getElementById('pivot-date-picker'),
        // --- YANGLARI TUGADI ---

        // Parol / Maxfiy so'z
        credentialsModal: document.getElementById('credentials-modal'),
        credentialsForm: document.getElementById('credentials-form'),
        credentialsModalTitle: document.getElementById('credentials-modal-title'),
        credentialsUserIdInput: document.getElementById('credentials-user-id'),
        credentialsInput: document.getElementById('credentials-input'),
        credentialsInputLabel: document.getElementById('credentials-input-label'),

        // Telegram
        telegramConnectModal: document.getElementById('telegram-connect-modal'),
        telegramConnectLinkInput: document.getElementById('telegram-connect-link'),
        copyTelegramLinkBtn: document.getElementById('copy-telegram-link-btn'),

        // Sessiyalar
        sessionsModal: document.getElementById('sessions-modal'),
        sessionsModalTitle: document.getElementById('sessions-modal-title'),
        sessionsListContainer: document.getElementById('sessions-list-container'),
        
        // Rollar
        rolesManagementContainer: document.getElementById('roles-management-container'),
        rolesList: document.getElementById('roles-list'),
        permissionsPanel: document.querySelector('.permissions-panel'),
        currentRoleTitle: document.getElementById('current-role-title'),
        permissionsGrid: document.getElementById('permissions-grid'),
        saveRolePermissionsBtn: document.getElementById('save-role-permissions-btn'),

        // Sozlamalar
        settingsPage: document.getElementById('settings'),
        saveTableSettingsBtn: document.getElementById('save-table-settings-btn'),
        saveTelegramBtn: document.getElementById('save-telegram-btn'),
        botTokenInput: document.getElementById('bot-token'),
        botUsernameInput: document.getElementById('bot-username'),
        groupIdInput: document.getElementById('group-id'),
        adminChatIdInput: document.getElementById('admin-chat-id'),
        paginationLimitInput: document.getElementById('pagination-limit'),
        saveGeneralSettingsBtn: document.getElementById('save-general-settings-btn'),

        // Brending
        logoTextInput: document.getElementById('logo-text-input'),
        logoColorPalette: document.getElementById('logo-color-palette'),
        logoAnimationSelect: document.getElementById('logo-animation-select'),
        logoBorderEffectSelect: document.getElementById('logo-border-effect-select'),
        logoPreview: document.getElementById('logo-preview'),
        logoPreviewContainer: document.getElementById('logo-preview-container'),
        saveBrandingSettingsBtn: document.getElementById('save-branding-settings-btn'),

        // Admin Boshqaruvi
        backupDbBtn: document.getElementById('backup-db-btn'),
        clearSessionsBtn: document.getElementById('clear-sessions-btn'),
        
        // Audit Log
        auditLogPage: document.getElementById('audit-log'),
        auditLogTableBody: document.getElementById('audit-log-table-body'),
        auditLogPagination: document.getElementById('audit-log-pagination'),
        auditUserFilter: document.getElementById('audit-user-filter'),
        auditActionFilter: document.getElementById('audit-action-filter'),
        auditDateFilter: document.getElementById('audit-date-filter'),
        auditFilterResetBtn: document.getElementById('audit-filter-reset-btn'),
        auditDetailsModal: document.getElementById('audit-details-modal'),
        auditDetailsBody: document.getElementById('audit-details-body'),

        // Registratsiya so'rovlari
        pendingUsersList: document.getElementById('pending-users-list'),
        requestsNavLink: document.querySelector('.nav-link[data-page="requests"]'),
        requestsCountBadge: document.getElementById('requests-count-badge'),
        approvalModal: document.getElementById('approval-modal'),
        approvalForm: document.getElementById('approval-form'),
        approvalUserIdInput: document.getElementById('approval-user-id'),
        approvalUsernameSpan: document.getElementById('approval-username'),
        approvalRoleSelect: document.getElementById('approval-role'),
        approvalLocationsGroup: document.getElementById('approval-locations-group'),
        approvalLocationsCheckboxList: document.getElementById('approval-locations-checkbox-list'),

        // Xavfsizlik sahifasi
        mySessionsList: document.getElementById('my-sessions-list'),
        securityPage: document.getElementById('security'),

        // Umumiy
        toast: document.getElementById('toast-notification'),
    };

    let dashboardDatePickerFP = null;
    let auditDatePickerFP = null;
    let pivotDatePickerFP = null; // YANGI
    let weeklyChartInstance = null;

    const safeFetch = async (url, options) => {
        try {
            const response = await fetch(url, options);
            if (response.status === 401 || response.status === 403) {
                const errorData = await response.json();
                if (errorData.action === 'logout') {
                    showToast(errorData.message, true);
                    setTimeout(() => window.location.href = '/login', 2000);
                } else if (errorData.action === 'force_telegram_subscription') {
                    document.body.innerHTML = `
                        <div class="login-page" style="height: 100vh;">
                            <div class="login-container" style="max-width: 500px;">
                                <h2 style="color: var(--red-color);">Xatolik</h2>
                                <p class="login-description">${errorData.message}</p>
                                ${errorData.subscription_link ? `<a href="${errorData.subscription_link}" target="_blank" class="btn btn-primary" style="width: 100%;">Botga Obuna Bo'lish</a>` : ''}
                                <a href="/login" class="btn btn-secondary" style="width: 100%; margin-top: 10px;">Qaytadan Kirish</a>
                            </div>
                        </div>`;
                }
                return null; 
            }
            return response;
        } catch (error) {
            showToast("Server bilan bog'lanishda xatolik.", true);
            return null;
        }
    };

    const showToast = (message, isError = false) => {
        if (!DOM.toast) return;
        DOM.toast.textContent = message;
        DOM.toast.className = `toast ${isError ? 'error' : ''}`;
        setTimeout(() => { DOM.toast.className = `toast ${isError ? 'error' : ''} hidden`; }, 3000);
    };

    const debounce = (func, delay) => {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    const ACTION_DEFINITIONS = {
        'login_success': { text: "Tizimga kirdi", icon: 'log-in', color: 'var(--green-color)' },
        'login_fail': { text: "Kirishda xatolik", icon: 'alert-triangle', color: 'var(--yellow-color)' },
        'logout': { text: "Tizimdan chiqdi", icon: 'log-out', color: '#6c757d' },
        'account_lock': { text: "Akkaunt bloklandi", icon: 'lock', color: 'var(--red-color)' },
        'create_report': { text: "hisobot yaratdi", icon: 'file-plus', color: 'var(--blue-color)' },
        'edit_report': { text: "hisobotni tahrirladi", icon: 'edit', color: 'var(--cyan-color)' },
        'delete_report': { text: "hisobotni o'chirdi", icon: 'trash-2', color: 'var(--red-color)' },
        'create_user': { text: "foydalanuvchi yaratdi", icon: 'user-plus', color: 'var(--blue-color)' },
        'update_user': { text: "foydalanuvchini yangiladi", icon: 'user-check', color: 'var(--cyan-color)' },
        'update_user_locations': { text: "filiallarini o'zgartirdi", icon: 'map-pin', color: 'var(--cyan-color)' },
        'activate_user': { text: "foydalanuvchini aktivladi", icon: 'user-check', color: 'var(--green-color)' },
        'deactivate_user': { text: "foydalanuvchini blokladi", icon: 'user-x', color: 'var(--yellow-color)' },
        'change_password': { text: "parolni o'zgartirdi", icon: 'key', color: 'var(--purple-color)' },
        'set_secret_word': { text: "maxfiy so'z o'rnatdi", icon: 'shield', color: 'var(--purple-color)' },
        '2fa_sent': { text: "2FA so'rovi yubordi", icon: 'send', color: 'var(--orange-color)' },
        '2fa_success': { text: "2FA tasdiqlandi", icon: 'check-shield', color: 'var(--green-color)' },
        '2fa_fail': { text: "2FA xatosi", icon: 'alert-octagon', color: 'var(--red-color)' },
        'update_permissions': { text: "rol huquqlarini o'zgartirdi", icon: 'sliders', color: 'var(--purple-color)' },
        'update_settings': { text: "sozlamalarni yangiladi", icon: 'settings', color: 'var(--cyan-color)' },
        'approve_user': { text: "foydalanuvchi so'rovini tasdiqladi", icon: 'user-check', color: 'var(--green-color)' },
        'reject_user': { text: "so'rovni rad etdi", icon: 'user-x', color: 'var(--red-color)' },
    };

    const permissionExclusionGroups = {
        view: ['reports:view_all', 'reports:view_assigned', 'reports:view_own'],
        edit: ['reports:edit_all', 'reports:edit_assigned', 'reports:edit_own']
    };

    async function init() {
        try {
            const userRes = await safeFetch('/api/current-user');
            if (!userRes || !userRes.ok) return;
            state.currentUser = await userRes.json();
            
            applyPermissions();
            
            const dataSources = [
                { key: 'settings', url: '/api/settings', permission: 'settings:view' },
                { key: 'users', url: '/api/users', permission: 'users:view' },
                { key: 'rolesData', url: '/api/roles', permission: 'roles:manage' },
                { key: 'pendingUsers', url: '/api/users/pending', permission: 'users:edit' } 
            ];

            const results = await Promise.all(dataSources.map(async ds => {
                if (hasPermission(ds.permission)) {
                    const res = await safeFetch(ds.url);
                    return res && res.ok ? await res.json() : null;
                }
                return null;
            }));

            results.forEach((data, index) => {
                const { key } = dataSources[index];
                if (data) {
                    if (key === 'rolesData') {
                        state.roles = data.roles;
                        state.allPermissions = data.all_permissions;
                    } else {
                        state[key] = data;
                    }
                }
            });

            applyBranding(state.settings.branding_settings);
            renderAllComponents();
            setupEventListeners();
            feather.replace();
            const initialPage = window.location.hash.substring(1) || 'dashboard';
            navigateTo(initialPage);
        } catch (error) {
            showToast("Sahifani yuklashda jiddiy xatolik yuz berdi.", true);
            console.error("Initialization Error:", error);
        }
    }

    function applyPermissions() {
        const userPermissions = state.currentUser.permissions || [];
        document.querySelectorAll('[data-permission]').forEach(el => {
            const requiredPermissions = el.dataset.permission.split(',').map(p => p.trim());
            const hasPermission = requiredPermissions.some(p => userPermissions.includes(p));
            if (!hasPermission) {
                el.style.display = 'none';
            }
        });
        const securityLink = document.querySelector('.nav-link[data-page="security"]');
        if (securityLink) {
             securityLink.style.display = 'flex';
        }
    }

    function renderAllComponents() {
        if (hasPermission('dashboard:view')) {
            if (DOM.dashboardDatePicker) {
                dashboardDatePickerFP = flatpickr(DOM.dashboardDatePicker, {
                    defaultDate: "today", dateFormat: "Y-m-d", locale: "uz",
                    onChange: (selectedDates) => updateDashboard(selectedDates[0] ? flatpickr.formatDate(selectedDates[0], 'Y-m-d') : '')
                });
                updateDashboard(flatpickr.formatDate(new Date(), 'Y-m-d'));
            }
            if (DOM.employeeStatisticsPage) {
                setupKpiPage();
            }
        }
        if (hasPermission('users:view')) {
            renderUsersByStatus('active');
            if (hasPermission('audit:view')) {
                setupAuditLogFilters();
            }
        }
        if (hasPermission('users:edit')) {
            renderPendingUsers();
        }
        if (hasPermission('settings:view')) {
            renderTableSettings();
            renderGeneralSettings();
            renderTelegramSettings();
        }
        if (hasPermission('reports:view_pivot')) {
            initializePivotGrid();
            if (DOM.pivotDatePicker) {
                pivotDatePickerFP = flatpickr(DOM.pivotDatePicker, {
                    mode: "range",
                    dateFormat: "Y-m-d",
                    locale: 'uz',
                    onChange: function(selectedDates) {
                        if (selectedDates.length === 2) {
                            const start = flatpickr.formatDate(selectedDates[0], "Y-m-d");
                            const end = flatpickr.formatDate(selectedDates[1], "Y-m-d");
                            loadDataForPivot(start, end);
                        }
                    }
                });
            }
        }
        if (hasPermission('roles:manage')) renderRoles();
        if (hasPermission('settings:edit_general')) setupBrandingControls();
    }

    async function updateDashboard(date) {
        if (!hasPermission('dashboard:view') || !date) return;
        DOM.statsGrid.innerHTML = Array(3).fill('<div class="skeleton-item" style="height: 80px;"></div>').join('');
        DOM.dailyStatusGrid.innerHTML = '<div class="skeleton-item" style="grid-column: 1 / -1; height: 100px;"></div>';
        if (DOM.dashboardSelectedDate) {
            DOM.dashboardSelectedDate.textContent = new Date(date).toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' });
        }
        try {
            const res = await safeFetch(`/api/dashboard/stats?date=${date}`);
            if (!res || !res.ok) throw new Error('Statusni yuklab bo\'lmadi');
            const data = await res.json();
            const { totalUsers, totalLocations } = data.generalStats;
            const { submittedCount } = data.dailyStatus;
            const submittedPercent = totalLocations > 0 ? (submittedCount / totalLocations * 100).toFixed(1) : 0;
            DOM.statsGrid.innerHTML = `
                <div class="stat-card">
                    <div class="stat-icon" style="background-color: rgba(0, 123, 255, 0.1);"><i data-feather="users" style="color: #007bff;"></i></div>
                    <div class="stat-info"><span class="stat-label">Jami Foydalanuvchilar</span><span class="stat-value">${totalUsers}</span></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon" style="background-color: rgba(23, 162, 184, 0.1);"><i data-feather="briefcase" style="color: #17a2b8;"></i></div>
                    <div class="stat-info"><span class="stat-label">Jami Filiallar</span><span class="stat-value">${totalLocations}</span></div>
                </div>
                <div class="stat-card submitted">
                    <div class="stat-icon"><i data-feather="check-circle"></i></div>
                    <div class="stat-info"><span class="stat-label">Bugun Topshirildi</span><span class="stat-value">${submittedCount} (${submittedPercent}%)</span></div>
                </div>
            `;
            DOM.dailyStatusGrid.innerHTML = data.dailyStatus.statusData.map(item => {
                let cardClass = item.submitted ? 'submitted' : 'not-submitted';
                let tooltipHtml = '';
                if (item.is_edited && item.edit_info) {
                    cardClass = 'edited';
                    tooltipHtml = `
                        <div class="tooltip">
                            <div class="tooltip-row"><span>Tahrirlangan:</span> <span>${item.edit_info.count} marta</span></div>
                            <div class="tooltip-row"><span>Oxirgi tahrir:</span> <span>${item.edit_info.last_by || 'N/A'}</span></div>
                            <div class="tooltip-row"><span>Vaqti:</span> <span>${new Date(item.edit_info.last_at).toLocaleString('uz-UZ')}</span></div>
                        </div>`;
                } else if (item.submitted) {
                     tooltipHtml = `<div class="tooltip"><span>Topshirdi:</span> ${item.creator || 'N/A'}</div>`;
                }
                if (item.late_comment) {
                    if(tooltipHtml) {
                       tooltipHtml = tooltipHtml.replace('</div>', `<div class="tooltip-row"><span>Kechikish sababi:</span> <span>${item.late_comment}</span></div></div>`);
                    } else {
                       tooltipHtml = `<div class="tooltip"><div class="tooltip-row"><span>Kechikish sababi:</span> <span>${item.late_comment}</span></div></div>`;
                    }
                }
                return `<div class="status-card ${cardClass}">${item.name}${tooltipHtml}</div>`;
            }).join('');
            
            if (DOM.weeklyChartCanvas) {
                const labels = data.weeklyDynamics.map(d => new Date(d.date).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' }));
                const chartData = data.weeklyDynamics.map(d => d.count);
                if (weeklyChartInstance) {
                    weeklyChartInstance.destroy();
                }
                weeklyChartInstance = new Chart(DOM.weeklyChartCanvas, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Hisobotlar Soni',
                            data: chartData,
                            fill: true,
                            backgroundColor: 'rgba(0, 123, 255, 0.2)',
                            borderColor: 'rgba(0, 123, 255, 1)',
                            tension: 0.3,
                            pointBackgroundColor: 'rgba(0, 123, 255, 1)',
                            pointBorderColor: '#fff',
                            pointHoverRadius: 7,
                            pointHoverBorderWidth: 2,
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: { 
                                beginAtZero: true, 
                                ticks: { color: '#a0a0a0', stepSize: 1 }, 
                                grid: { color: '#3a3d4a' } 
                            },
                            x: { 
                                ticks: { color: '#a0a0a0' }, 
                                grid: { display: false } 
                            }
                        },
                        plugins: { 
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: '#1a1c23',
                                titleFont: { size: 14, weight: 'bold' },
                                bodyFont: { size: 12 },
                                padding: 10,
                                cornerRadius: 8
                            }
                        }
                    }
                });
            }
            feather.replace();
        } catch (error) {
            const errorMessage = `<div class="empty-state error" style="grid-column: 1 / -1;">${error.message || 'Dashboard ma\'lumotlarini yuklashda xatolik.'}</div>`;
            DOM.statsGrid.innerHTML = errorMessage;
            DOM.dailyStatusGrid.innerHTML = errorMessage;
        }
    }

    // --- KPI SAHIFASI UCHUN FUNKSIYALAR ---

    function setupKpiPage() {
        // Set default to current month if not already set
        if (!state.kpi.selectedMonth) {
            const now = new Date();
            const year = now.getFullYear();
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            state.kpi.selectedMonth = `${year}-${month}`;
        }
        
        // Initialize month picker
        if (DOM.kpiMonthPicker) {
            DOM.kpiMonthPicker.value = state.kpi.selectedMonth;
            
            // Add change event for month picker
            DOM.kpiMonthPicker.addEventListener('change', () => {
                state.kpi.selectedMonth = DOM.kpiMonthPicker.value;
                fetchAndRenderKpiData();
            });
        }

        // Add click handler for table sorting
        const kpiTableHead = document.querySelector('.kpi-table thead');
        if (kpiTableHead) {
            kpiTableHead.addEventListener('click', handleKpiSort);
        }

        // Add back button handler
        if (DOM.backToKpiListBtn) {
            DOM.backToKpiListBtn.addEventListener('click', () => {
                if (DOM.employeeDetailsView) DOM.employeeDetailsView.style.display = 'none';
                const kpiCard = document.querySelector('#employee-statistics .card');
                if (kpiCard) kpiCard.style.display = 'block';
            });
        }

        // Initial data load
        fetchAndRenderKpiData();
    }

    async function fetchAndRenderKpiData() {
        if (!state.kpi.selectedMonth) return;
        DOM.kpiTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">Yuklanmoqda...</td></tr>`;
        try {
            const res = await safeFetch(`/api/statistics/employees?month=${state.kpi.selectedMonth}`);
            if (!res || !res.ok) throw new Error('Statistika yuklanmadi');
            state.kpi.data = await res.json();
            renderKpiTable();
        } catch (error) {
            DOM.kpiTableBody.innerHTML = `<tr><td colspan="6" class="empty-state error">${error.message}</td></tr>`;
        }
    }

    function renderKpiTable() {
        console.log("[KPI RENDER] KPI jadvalini chizish boshlandi.");
        const { key, direction } = state.kpi.currentSort;

        const sortedData = [...state.kpi.data].sort((a, b) => {
            let valA = a[key];
            let valB = b[key];
            if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }
            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
        });

        if (sortedData.length === 0) {
            DOM.kpiTableBody.innerHTML = `<tr><td colspan="7" class="empty-state">Bu oy uchun ma'lumotlar topilmadi.</td></tr>`;
            return;
        }

        DOM.kpiTableBody.innerHTML = sortedData.map(emp => {
            const locationsText = (emp.locations && emp.locations.length > 0) 
                ? emp.locations.join(', ') 
                : 'Biriktirilmagan';
            
            const scoreColor = emp.kpiScore > 80 ? 'var(--green-color)' : 
                             emp.kpiScore > 50 ? 'var(--yellow-color)' : 'var(--red-color)';

            return `
            <tr class="kpi-main-row" data-user-id="${emp.userId}">
                <td>
                    <div class="employee-cell">
                        <span>${emp.fullname || emp.username}</span>
                        <button class="btn-icon toggle-kpi-details-btn" title="Batafsil">
                            <i data-feather="chevron-down"></i>
                        </button>
                    </div>
                </td>
                <td>${locationsText}</td>
                <td class="kpi-score-cell">
                    <div class="kpi-score-bar" style="--score-color: ${scoreColor}; --score-width: ${emp.kpiScore}%;">
                        <span>${emp.kpiScore.toFixed(1)}</span>
                    </div>
                </td>
                <td>${emp.totalSubmitted}</td>
                <td>${emp.onTimeCount}</td>
                <td>${emp.lateCount}</td>
                <td>${emp.totalEdited}</td>
            </tr>
            <tr class="kpi-details-row hidden" data-details-for="${emp.userId}">
                <td colspan="7">
                    <div class="kpi-details-layout">
                        <div class="kpi-details-bars">
                            <div class="kpi-bar-wrapper" title="O'z vaqtida: ${emp.onTimePercentage.toFixed(1)}%">
                                <div class="kpi-bar on-time" style="width: ${emp.onTimePercentage}%;">
                                    <span>${emp.onTimeCount} dona O'z vaqtida</span>
                                </div>
                            </div>
                            <div class="kpi-bar-wrapper" title="Kechikkan: ${emp.latePercentage.toFixed(1)}%">
                                <div class="kpi-bar late" style="width: ${emp.latePercentage}%;">">
                                    <span>${emp.lateCount} dona Kechikkan</span>
                                </div>
                            </div>
                            <div class="kpi-bar-wrapper" title="Tahrirlangan hisobotlar soni: ${emp.totalEdited}">
                                <div class="kpi-bar edited" style="width: ${emp.editedPercentage > 100 ? 100 : emp.editedPercentage}%;">
                                    <span>${emp.totalEdited} dona Tahrirlangan</span>
                                </div>
                            </div>
                        </div>
                        <div class="kpi-details-calendar-container">
                            <div class="calendar-placeholder">Yuklanmoqda...</div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
        }).join('');
        
        const headers = document.querySelectorAll('.kpi-table th');
        headers.forEach(th => {
            th.classList.remove('sorted', 'asc', 'desc');
            const sortIcon = th.querySelector('.sort-icon');
            if (sortIcon) sortIcon.remove();

            if (th.dataset.sort === key) {
                th.classList.add('sorted', direction);
                th.innerHTML += `<span class="sort-icon">${direction === 'asc' ? '▲' : '▼'}</span>`;
            }
        });
        
        feather.replace();
        console.log("[KPI RENDER] Jadval muvaffaqiyatli chizildi.");
    }

    function handleKpiSort(e) {
        const header = e.target.closest('th');
        if (!header || !header.dataset.sort) return;

        const sortKey = header.dataset.sort;
        const { key, direction } = state.kpi.currentSort;

        if (key === sortKey) {
            state.kpi.currentSort.direction = direction === 'asc' ? 'desc' : 'asc';
        } else {
            state.kpi.currentSort.key = sortKey;
            state.kpi.currentSort.direction = 'desc';
        }
        renderKpiTable();
    }

    async function showEmployeeDetails(userId, fullname) {
        DOM.detailsViewTitle.textContent = `"${fullname}" uchun ${state.kpi.selectedMonth} oyi statistikasi`;
        DOM.detailsCalendarGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;">Yuklanmoqda...</div>';
        
        document.querySelector('#employee-statistics .card').style.display = 'none';
        DOM.employeeDetailsView.style.display = 'block';

        try {
            const res = await safeFetch(`/api/statistics/employee/${userId}?month=${state.kpi.selectedMonth}`);
            if (!res || !res.ok) throw new Error('Batafsil statistika yuklanmadi');
            const dailyData = await res.json();
            
            const firstDayOfMonth = new Date(dailyData[0].date).getDay();
            const offset = (firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1); // Dushanbadan boshlash uchun

            let calendarHtml = '';
            for (let i = 0; i < offset; i++) {
                calendarHtml += '<div class="calendar-day disabled"></div>';
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            calendarHtml += dailyData.map(day => {
                const dayDate = new Date(day.date);
                let statusClass = day.status;
                let tooltipHtml = '';

                if (dayDate > today) {
                    statusClass = 'future';
                }

                const editIcon = day.isEdited ? `<i class="edit-indicator" data-feather="edit-2"></i>` : '';

                if (day.isEdited && day.editInfo) {
                    tooltipHtml = `
                        <div class="kpi-tooltip">
                            <div class="kpi-tooltip-row">
                                <span>Tahrirladi:</span>
                                <span>${day.editInfo.editor || 'N/A'}</span>
                            </div>
                            <div class="kpi-tooltip-row">
                                <span>Vaqti:</span>
                                <span>${new Date(day.editInfo.editedAt).toLocaleString('uz-UZ')}</span>
                            </div>
                        </div>
                    `;
                }

                return `
                    <div class="calendar-day ${statusClass}" 
                         data-report-id="${day.reportId || ''}" 
                         title="${day.date}">
                        <div class="day-number">${day.day}</div>
                        ${editIcon}
                        ${tooltipHtml}
                    </div>
                `;
            }).join('');

            DOM.detailsCalendarGrid.innerHTML = calendarHtml;
            feather.replace();

        } catch (error) {
            DOM.detailsCalendarGrid.innerHTML = `<div class="empty-state error" style="grid-column: 1 / -1;">${error.message}</div>`;
        }
    }

// public/admin.js faylining ichidagi initializePivotGrid funksiyasini almashtiring

function initializePivotGrid() {
    if (!DOM.pivotContainer) {
        console.warn('[PIVOT LOG] Pivot container topilmadi');
        return;
    }
    
    console.log('[PIVOT LOG] WebDataRocks komponenti ishga tushirilmoqda...');
    
    try {
        const expandIconSVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 3H21M21 3V9M21 3L14 10M9 21H3M3 21V15M3 21L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const collapseIconSVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 3H3M3 3V9M3 3L10 10M15 21H21M21 21V15M21 21L14 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

        const customLocalization = {
            "toolbar": {
                "open": "Открыть", "save": "Сохранить", "fullscreen": "Полный экран"
            }
        };

        state.pivotGrid = new WebDataRocks({
            container: "#pivot-container",
            beforetoolbarcreated: function(toolbar) {
                let tabs = toolbar.getTabs();

                // "Connect" (Подключить) menyusini olib tashlaymiz
                const connectTabIndex = tabs.findIndex(tab => tab.id === 'wdr-tab-connect');
                if (connectTabIndex > -1) {
                    tabs.splice(connectTabIndex, 1);
                }

                // "Open" (Открыть) menyusining nomini "Отчёты" ga o'zgartiramiz
                const openTab = tabs.find(tab => tab.id === 'wdr-tab-open');
                if (openTab) {
                    openTab.title = "Отчёты"; 
                    openTab.handler = () => openLoadTemplateDialog();
                    openTab.menu = []; 
                }

                // "Save" (Сохранить) menyusining nomini "Сох. как" ga o'zgartiramiz
                const saveTab = tabs.find(tab => tab.id === 'wdr-tab-save');
                if (saveTab) {
                    saveTab.title = "Сох. как"; 
                    saveTab.handler = () => openSaveTemplateDialog();
                    saveTab.menu = [];
                }
                
                // === YAKUNIY TO'G'RILANGAN KOD ===
                // Boshida ikkita tugma qo'shamiz, bittasi yashirin bo'ladi
                tabs.unshift({
                    id: "wdr-tab-collapse-all",
                    title: "Свернуть",
                    icon: collapseIconSVG,
                    handler: () => state.pivotGrid.collapseAllData(),
                    hidden: true // Boshida yashirin
                });
                tabs.unshift({
                    id: "wdr-tab-expand-all",
                    title: "Развернуть",
                    icon: expandIconSVG,
                    handler: () => state.pivotGrid.expandAllData(),
                });

                toolbar.getTabs = function() {
                    return tabs;
                };
            },
            // === YANGI HODISA: Jadval yangilanganda tugmalarni almashtirish ===
            reportchange: function() {
                // Bu hodisa har safar hisobot o'zgarganda (kengayganda/torayganda) ishlaydi
                if (!state.pivotGrid || !state.pivotGrid.toolbar) return;

                const report = state.pivotGrid.getReport();
                const isExpanded = report?.slice?.expands?.rows?.length > 0;

                // Menyudagi tugmalarni topamiz
                const expandTab = state.pivotGrid.toolbar.getTabs().find(tab => tab.id === 'wdr-tab-expand-all');
                const collapseTab = state.pivotGrid.toolbar.getTabs().find(tab => tab.id === 'wdr-tab-collapse-all');

                if (expandTab && collapseTab) {
                    // Holatga qarab tugmalarni ko'rsatamiz/yashiramiz
                    expandTab.hidden = isExpanded;
                    collapseTab.hidden = !isExpanded;
                    // Menyuni qayta chizamiz (bu yerda xavfsiz)
                    state.pivotGrid.toolbar.create();
                }
            },
            toolbar: true,
            width: "100%",
            height: "100%",
            report: {
                dataSource: { data: [] },
                formats: [{
                    name: "sumFormat",
                    thousandsSeparator: " ",
                    decimalPlaces: 0,
                    currencySymbol: " so'm",
                    currencySymbolAlign: "right"
                }],
                localization: customLocalization
            },
            reportcomplete: function() {
                console.log("[PIVOT LOG] 'reportcomplete' hodisasi ishga tushdi. Jadval chizildi.");
            },
            error: function(event) {
                console.error("[PIVOT XATOLIK]", event);
                showToast("Interaktiv hisobotda xatolik yuz berdi. Konsolni tekshiring.", true);
            }
        });
    } catch (e) {
        console.error("WebDataRocks ishga tushirishda kritik xatolik:", e);
        showToast("Interaktiv hisobot komponentini yuklab bo'lmadi.", true);
    }
}



// Standart hisobotni sozlaydigan funksiya
function createDefaultPivotReport() {
    if (!state.pivotGrid || !state.pivotGrid.getReport()) {
        console.warn('[PIVOT LOG] Pivot grid tayyor emas.');
        return;
    }

    // Himoya tekshiruvi: Kerakli maydonlar mavjudligini tekshiramiz
    const allFields = state.pivotGrid.getFields().map(f => f.uniqueName);
    const requiredFields = ["Filial", "Qator", "Turi", "Summa"];
    const hasAllRequiredFields = requiredFields.every(fieldName => allFields.includes(fieldName));

    if (!hasAllRequiredFields) {
        console.warn('[PIVOT LOG] Standart hisobot uchun kerakli maydonlar topilmadi. Mavjud maydonlar:', allFields);
        return;
    }

    console.log("[PIVOT LOG] Standart hisobotni sozlash boshlandi...");

    const report = {
        slice: {
            rows: [{ uniqueName: "Filial" }, { uniqueName: "Qator" }],
            columns: [{ uniqueName: "Turi" }],
            measures: [{ uniqueName: "Summa", aggregation: "sum", format: "sumFormat" }],
            expands: { rows: [] }
        },
        options: {
            grid: { type: "classic", showTotals: "on", showGrandTotals: "on" }
        }
    };

    state.pivotGrid.setReport(report);
    console.log("[PIVOT LOG] Standart hisobot muvaffaqiyatli o'rnatildi.");
}

async function loadDataForPivot(startDate = '', endDate = '') {
    if (!state.pivotGrid) {
        console.warn('[PIVOT LOG] Pivot grid ishga tushirilmagan.');
        return;
    }
    
    showToast("Interaktiv hisobot uchun ma'lumotlar yuklanmoqda...");
    console.log(`[PIVOT LOG] Ma'lumotlar so'rovi yuborilmoqda: ${startDate} - ${endDate}`);
    
    try {
        const params = new URLSearchParams({ startDate, endDate });
        const res = await safeFetch(`/api/reports/pivot-data?${params.toString()}`);
        
        if (!res || !res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || "Ma'lumotlarni yuklab bo'lmadi.");
        }
        
        const data = await res.json();
        console.log(`[PIVOT LOG] Serverdan ${data.length} ta yozuv qabul qilindi.`, data);
        
        if (data.length === 0) {
            showToast("Tanlangan oraliqda hisobotlar topilmadi.", true);
        } else {
            showToast("Ma'lumotlar muvaffaqiyatli yangilandi!");
        }

        // =================================================================
        // === ENG TO'LIQ LOKALIZATSIYA OBYEKTI (YAKUNIY VERSIYA) ===
        // =================================================================
        const russianLocalization = {
            "toolbar": {
                "connect": "Подключить", "open": "Открыть", "save": "Сохранить",
                "export": "Экспорт", "grid": "Сетка", "charts": "Диаграммы",
                "format": "Формат", "options": "Параметры", "fields": "Поля",
                "fullscreen": "Полный экран"
            },
            "fieldsList": {
                "allFields": "Все поля", "rows": "Строки", "columns": "Столбцы",
                "values": "Значения", "reportFilters": "Фильтры отчета",
                "dragAndDrop": "Перетащите поля для упорядочивания",
                "expandAll": "Развернуть все", "collapseAll": "Свернуть все"
            },
            "buttons": {
                "apply": "Применить", "cancel": "Отмена", "add": "Добавить",
                "ok": "OK", "clear": "Очистить"
            },
            "form": {
                "addCalculatedValue": "Добавить вычисляемое значение",
                "formula": "Формула", "name": "Имя"
            },
            "grid": {
                "total": "Итог", "grandTotal": "Общий итог"
            },
            "contextMenu": {
                "formatCells": "Форматировать ячейки",
                "conditionalFormatting": "Условное форматирование"
            },
            "formatCells": {
                "title": "Форматировать ячейки",
                "chooseValue": "Выберите значение",
                "textAlign": "Выравнивание текста",
                "thousandSeparator": "Разделитель тысяч",
                "decimalSeparator": "Десятичный разделитель",
                "decimalPlaces": "Количество знаков после запятой",
                "currencySymbol": "Символ валюты",
                "currencyAlign": "Положение символа валюты",
                "nullValue": "Нулевое значение",
                "formatAsPercent": "Форматировать как процент",
                "align": { "left": "Слева", "center": "По центру", "right": "Справа" },
                "separators": { "none": "Нет", "space": "Пробел", "comma": "Запятая", "dot": "Точка" }
            },
            "conditionalFormatting": {
                "title": "Условное форматирование",
                "lessThan": "Меньше чем",
                "greaterThan": "Больше чем",
                "between": "Между",
                "isNotBlank": "Не пусто",
                "highlight": "Выделить",
                "color": "Цвет"
            },
            "layoutOptions": {
                "title": "Настройки макета",
                "grandTotals": "ОБЩИЕ ИТОГИ",
                "subtotals": "ПРОМЕЖУТОЧНЫЕ ИТОГИ",
                "showGrandTotals": "Показать общие итоги",
                "doNotShowGrandTotals": "Не показывать общие итоги",
                "showForRowsOnly": "Показать только для строк",
                "showForColumnsOnly": "Показать только для столбцов",
                "showSubtotals": "Показать промежуточные итоги",
                "doNotShowSubtotals": "Не показывать промежуточные итоги",
                "showSubtotalRowsOnly": "Показать только для строк",
                "showSubtotalColumnsOnly": "Показать только для столбцов",
                "layout": "МАКЕТ",
                "compactForm": "Компактная форма",
                "classicForm": "Классическая форма",
                "flatForm": "Плоская форма"
            }
        };
        console.log("[PIVOT LOG] YAKUNIY lokalizatsiya obyekti yaratildi:", russianLocalization);

        const report = {
            dataSource: { data: data },
            slice: {
                rows: [{ uniqueName: "Filial" }, { uniqueName: "Qator" }],
                columns: [{ uniqueName: "Turi" }],
                measures: [{ uniqueName: "Summa", aggregation: "sum", format: "sumFormat" }]
            },
            options: {
                grid: { type: "classic", showTotals: "on", showGrandTotals: "on" }
            },
            localization: russianLocalization
        };
        
        console.log("[PIVOT LOG] Yangi hisobot obyekti o'rnatilmoqda...", report);
        
        state.pivotGrid.setReport(report);
        
        console.log("%c[PIVOT LOG] setReport chaqirildi. Barcha interfeys elementlari yangilangan bo'lishi kerak!", "color: green; font-weight: bold;");

    } catch (error) {
        console.error("[PIVOT LOG] Ma'lumotlarni yuklashda xatolik:", error);
        showToast(error.message, true);
        // WebDataRocks'ga ma'lumotlarni yangilash
        state.pivotGrid.updateData({
            data: data
        });
        
        console.log("[PIVOT LOG] updateData chaqirildi. Jadval yangilanishi kerak.");
    }
}
    
    function renderUsersByStatus(status) {
        if (!state.users || !DOM.userListContainer) return;

        let filteredUsers = [];
        if (status === 'active') {
            filteredUsers = state.users.filter(u => u.status === 'active');
        } else if (status === 'pending') {
            filteredUsers = state.users.filter(u => u.status.startsWith('pending'));
        } else if (status === 'inactive') {
            filteredUsers = state.users.filter(u => u.status === 'blocked' || u.status === 'archived');
        }

        if (filteredUsers.length === 0) {
            DOM.userListContainer.innerHTML = '<div class="empty-state">Bu statusdagi foydalanuvchilar yo\'q.</div>';
            return;
        }

        DOM.userListContainer.innerHTML = filteredUsers.map(user => {
            const locationsText = user.locations.join(', ') || 'Filial biriktirilmagan';
            const statusClass = user.is_online ? 'online' : 'offline';
            const telegramStatus = user.telegram_chat_id
                ? `<span class="telegram-status connected"><i data-feather="send"></i> Ulangan</span>`
                : `<span class="telegram-status not-connected"><i data-feather="alert-circle"></i> Ulanmagan</span>`;
            
            let statusBadge = '';
            if (user.status === 'blocked') {
                statusBadge = `<span class="status-badge blocked">Bloklangan</span>`;
            } else if (user.status === 'archived') {
                statusBadge = `<span class="status-badge archived">Arxivlangan</span>`;
            } else if (user.status.startsWith('pending')) {
                statusBadge = `<span class="status-badge pending">Kutmoqda</span>`;
            }
    
            return `
            <div class="user-item">
                <div class="user-avatar">
                    <i data-feather="user"></i>
                    ${user.status === 'active' ? `<div class="status-indicator ${statusClass}"></div>` : ''}
                </div>
                <div class="user-details">
                    <div class="username">${user.fullname || user.username} ${statusBadge}</div>
                    <div class="user-meta">
                        <span class="role">${user.role}</span> | <span>${locationsText}</span>
                    </div>
                    <div class="user-status">${telegramStatus}</div>
                </div>
                <div class="item-actions">
                    <button class="btn-icon connect-telegram-btn" data-id="${user.id}" title="Telegramga ulash" data-permission="users:connect_telegram"><i data-feather="link"></i></button>
                    <button class="btn-icon set-secret-word-btn" data-id="${user.id}" title="Maxfiy so'zni o'rnatish" data-permission="users:set_secret_word"><i data-feather="key"></i></button>
                    <button class="btn-icon change-password-btn" data-id="${user.id}" title="Parolni o'zgartirish" data-permission="users:change_password"><i data-feather="lock"></i></button>
                    <button class="btn-icon manage-sessions-btn" data-id="${user.id}" data-username="${user.username}" title="Aktiv sessiyalar (${user.active_sessions_count})" data-permission="users:manage_sessions"><i data-feather="monitor"></i></button>
                    <button class="btn-icon edit-user-btn" data-id="${user.id}" title="Tahrirlash" data-permission="users:edit"><i data-feather="edit-2"></i></button>
                    ${state.currentUser.id !== user.id ? (user.status === 'active'
                        ? `<button class="btn-icon deactivate-user-btn" data-id="${user.id}" title="Bloklash" data-permission="users:change_status"><i data-feather="eye-off"></i></button>`
                        : `<button class="btn-icon activate-user-btn" data-id="${user.id}" title="Aktivlashtirish" data-permission="users:change_status"><i data-feather="eye"></i></button>`
                    ) : ''}
                </div>
            </div>`;
        }).join('');
    
        feather.replace();
        applyPermissions();
    }

    function renderPendingUsers() {
        if (!DOM.pendingUsersList || !state.pendingUsers) return;

        if(DOM.requestsCountBadge) {
            const count = state.pendingUsers.length;
            DOM.requestsCountBadge.textContent = count;
            DOM.requestsCountBadge.classList.toggle('hidden', count === 0);
        }

        if (state.pendingUsers.length === 0) {
            DOM.pendingUsersList.innerHTML = '<div class="empty-state">Tasdiqlanishini kutayotgan so\'rovlar yo\'q.</div>';
            return;
        }

        DOM.pendingUsersList.innerHTML = state.pendingUsers.map(user => {
            const isInProcess = user.status === 'status_in_process';
            const statusText = user.status === 'pending_telegram_subscription'
                ? '<span style="color: var(--yellow-color);">Botga obuna bo\'lishini kutmoqda</span>'
                : isInProcess
                    ? '<span style="color: var(--orange-color);">Bot orqali tasdiqlanmoqda...</span>'
                    : '<span style="color: var(--cyan-color);">Admin tasdig\'ini kutmoqda</span>';

            return `
            <div class="user-item">
                <div class="user-avatar"><i data-feather="user-plus"></i></div>
                <div class="user-details">
                    <div class="username">${user.fullname || 'Nomsiz'} (@${user.username})</div>
                    <div class="user-meta">
                        <span>${statusText}</span> |
                        <span>Sana: ${new Date(user.created_at).toLocaleDateString('uz-UZ')}</span>
                    </div>
                </div>
                <div class="item-actions">
                    ${!isInProcess ? `
                        <button class="btn btn-success btn-sm approve-user-btn" data-id="${user.id}" data-username="${user.username}" title="Tasdiqlash"><i data-feather="check"></i> Tasdiqlash</button>
                        <button class="btn btn-danger btn-sm reject-user-btn" data-id="${user.id}" title="Rad etish"><i data-feather="x"></i> Rad etish</button>
                    ` : ''}
                </div>
            </div>
        `;
        }).join('');
        feather.replace();
    }

    function renderRoles() {
        if (!state.roles || !state.allPermissions) return;
        DOM.rolesList.innerHTML = state.roles.map(role => `<li data-role="${role.role_name}">${role.role_name}</li>`).join('');
        
        DOM.permissionsGrid.innerHTML = Object.entries(state.allPermissions).map(([category, perms]) => `
            <div class="permission-category">
                <h4 class="permission-category-title">${category}</h4>
                <div class="permission-list">
                    ${perms.map(perm => `
                        <label class="permission-item">
                            <input type="checkbox" value="${perm.key}">
                            <span>${perm.description}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `).join('');

        DOM.permissionsGrid.addEventListener('change', handlePermissionChange);
    }

    function renderTableSettings() {
        const { columns = [], rows = [], locations = [] } = state.settings.app_settings || {};
        const renderList = (containerId, items) => {
            const container = document.getElementById(containerId);
            if (container) container.innerHTML = items.map(item => `<div class="setting-item" data-name="${item}"><span class="setting-name">${item}</span><button class="delete-item-btn btn-icon"><i data-feather="x"></i></button></div>`).join('');
        };
        renderList('columns-settings', columns);
        renderList('rows-settings', rows);
        renderList('locations-settings', locations);
        
        if (DOM.locationsCheckboxList) DOM.locationsCheckboxList.innerHTML = locations.map(loc => `<label class="checkbox-item"><input type="checkbox" name="user-locations" value="${loc}"><span>${loc}</span></label>`).join('');
        if (DOM.approvalLocationsCheckboxList) DOM.approvalLocationsCheckboxList.innerHTML = locations.map(loc => `<label class="checkbox-item"><input type="checkbox" name="approval-locations" value="${loc}"><span>${loc}</span></label>`).join('');

        feather.replace();
    }

    function renderGeneralSettings() {
        if (DOM.paginationLimitInput) DOM.paginationLimitInput.value = state.settings.pagination_limit || 20;
    }

    function renderTelegramSettings() {
        if (DOM.botTokenInput) DOM.botTokenInput.value = state.settings.telegram_bot_token || '';
        if (DOM.botUsernameInput) DOM.botUsernameInput.value = state.settings.telegram_bot_username || '';
        if (DOM.groupIdInput) DOM.groupIdInput.value = state.settings.telegram_group_id || '';
        if (DOM.adminChatIdInput) DOM.adminChatIdInput.value = state.settings.telegram_admin_chat_id || '';
    }

    function setupAuditLogFilters() {
        if (!DOM.auditUserFilter || !DOM.auditDateFilter || !DOM.auditActionFilter) return;
        DOM.auditUserFilter.innerHTML = '<option value="">Barcha foydalanuvchilar</option>';
        state.users.forEach(user => {
            DOM.auditUserFilter.innerHTML += `<option value="${user.id}">${user.username}</option>`;
        });
        DOM.auditActionFilter.innerHTML = '<option value="">Barcha amallar</option>';
        for (const key in ACTION_DEFINITIONS) {
            DOM.auditActionFilter.innerHTML += `<option value="${key}">${ACTION_DEFINITIONS[key].text}</option>`;
        }
        auditDatePickerFP = flatpickr(DOM.auditDateFilter, {
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
        DOM.auditUserFilter.addEventListener('change', (e) => {
            state.auditLog.filters.userId = e.target.value;
            fetchAndRenderAuditLogs(1);
        });
        DOM.auditActionFilter.addEventListener('change', (e) => {
            state.auditLog.filters.actionType = e.target.value;
            fetchAndRenderAuditLogs(1);
        });
        DOM.auditFilterResetBtn.addEventListener('click', () => {
            state.auditLog.filters = { userId: '', startDate: '', endDate: '', actionType: '' };
            DOM.auditUserFilter.value = '';
            DOM.auditActionFilter.value = '';
            auditDatePickerFP.clear();
            state.auditLog.initialLoad = true;
            renderAuditLogTable();
            renderAuditLogPagination();
        });
    }

    async function fetchAndRenderAuditLogs(page = 1) {
        if (!hasPermission('audit:view')) return;
        state.auditLog.initialLoad = false;
        if (DOM.auditLogTableBody) DOM.auditLogTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">Yuklanmoqda...</td></tr>`;
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

    function renderAuditLogTable() {
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
        feather.replace();
    }

    function renderAuditLogPagination() {
        if (!DOM.auditLogPagination) return;
        const { pages, currentPage } = state.auditLog.pagination;
        if (pages <= 1) {
            DOM.auditLogPagination.innerHTML = '';
            return;
        }
        DOM.auditLogPagination.innerHTML = `
            <button id="audit-prev-page-btn" class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''}><i data-feather="chevron-left"></i></button>
            <span id="page-info">Sahifa ${currentPage} / ${pages}</span>
            <button id="audit-next-page-btn" class="pagination-btn" ${currentPage === pages ? 'disabled' : ''}><i data-feather="chevron-right"></i></button>
        `;
        feather.replace();
    }

    function generateLogDescription(log) {
        const definition = ACTION_DEFINITIONS[log.action] || { text: log.action, icon: 'alert-circle', color: '#6c757d' };
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

    function openAuditDetailsModal(logId) {
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

    function parseUserAgent(uaString) {
        if (!uaString) return { browser: 'Noma\'lum', os: 'Noma\'lum' };
        let browser = 'Noma\'lum';
        let os = 'Noma\'lum';
        if (uaString.includes('Windows NT 10.0')) os = 'Windows 10/11';
        else if (uaString.includes('Windows NT 6.3')) os = 'Windows 8.1';
        else if (uaString.includes('Windows NT 6.2')) os = 'Windows 8';
        else if (uaString.includes('Windows NT 6.1')) os = 'Windows 7';
        else if (uaString.includes('Macintosh')) os = 'macOS';
        else if (uaString.includes('Android')) os = 'Android';
        else if (uaString.includes('iPhone') || uaString.includes('iPad')) os = 'iOS';
        else if (uaString.includes('Linux')) os = 'Linux';
        if (uaString.includes('Edg/')) browser = 'Edge';
        else if (uaString.includes('Chrome/') && !uaString.includes('Edg/')) browser = 'Chrome';
        else if (uaString.includes('Firefox/')) browser = 'Firefox';
        else if (uaString.includes('Safari/') && !uaString.includes('Chrome/')) browser = 'Safari';
        const versionMatch = uaString.match(/(Chrome|Firefox|Edge|Version)\/([0-9.]+)/);
        if (versionMatch && versionMatch[2]) {
            browser += ` ${versionMatch[2].split('.')[0]}`;
        }
        return { browser, os };
    }

    async function fetchAndRenderMySessions() {
        if (!DOM.mySessionsList) return;
        DOM.mySessionsList.innerHTML = '<div class="skeleton-item" style="height: 100px;"></div>';
        try {
            const res = await safeFetch('/api/users/me/sessions');
            if (!res || !res.ok) throw new Error('Sessiyalarni yuklab bo\'lmadi');
            state.mySessions = await res.json();
            renderMySessions();
        } catch (error) {
            DOM.mySessionsList.innerHTML = `<div class="empty-state error">${error.message}</div>`;
        }
    }

    function renderMySessions() {
        if (!DOM.mySessionsList) return;
        if (state.mySessions.length === 0) {
            DOM.mySessionsList.innerHTML = '<div class="empty-state">Aktiv sessiyalar topilmadi.</div>';
            return;
        }
        DOM.mySessionsList.innerHTML = state.mySessions.map(session => {
            const ua = parseUserAgent(session.user_agent);
            const icon = ua.os.toLowerCase().includes('windows') ? 'monitor' : (ua.os.toLowerCase().includes('android') || ua.os.toLowerCase().includes('ios') ? 'smartphone' : 'hard-drive');
            return `
                <div class="session-item ${session.is_current ? 'current' : ''}">
                    <div class="session-icon"><i data-feather="${icon}"></i></div>
                    <div class="session-details">
                        <div class="device-info">${ua.browser} (${ua.os})</div>
                        <div><strong>IP Manzil:</strong> ${session.ip_address}</div>
                        <div><strong>Oxirgi faollik:</strong> ${new Date(session.last_activity).toLocaleString('uz-UZ')}</div>
                    </div>
                    ${session.is_current 
                        ? '<span class="badge" style="background-color: var(--green-color);">Joriy</span>'
                        : `<button class="btn btn-danger btn-sm terminate-session-btn" data-sid="${session.sid}">Tugatish</button>`
                    }
                </div>
            `;
        }).join('');
        feather.replace();
    }

    function setupEventListeners() {
        const addSafeListener = (element, event, handler) => {
            if (element) element.addEventListener(event, handler);
        };
        window.addEventListener('hashchange', () => navigateTo(window.location.hash.substring(1)));
        addSafeListener(DOM.sidebarNav, 'click', handleNavigation);
        addSafeListener(DOM.logoutBtn, 'click', handleLogout);
        
        if (hasPermission('users:view')) {
            addSafeListener(DOM.openAddUserModalBtn, 'click', openUserModalForAdd);
            addSafeListener(DOM.userForm, 'submit', handleUserFormSubmit);
            
            addSafeListener(DOM.usersPage, 'click', handleUserActions);

            addSafeListener(DOM.userRoleSelect, 'change', toggleLocationVisibilityForUserForm);
            addSafeListener(DOM.credentialsForm, 'submit', handleCredentialsFormSubmit);
            addSafeListener(DOM.copyTelegramLinkBtn, 'click', copyTelegramLink);
            
            addSafeListener(DOM.userTabs, 'click', (e) => {
                const button = e.target.closest('button');
                if (button && !button.classList.contains('active')) {
                    const status = button.dataset.status;
                    DOM.userTabs.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
                    button.classList.add('active');
                    renderUsersByStatus(status);
                }
            });
        }
        
        if (hasPermission('users:edit')) {
            addSafeListener(DOM.pendingUsersList, 'click', handlePendingUserActions);
            addSafeListener(DOM.approvalForm, 'submit', submitUserApproval);
            addSafeListener(DOM.approvalRoleSelect, 'change', toggleLocationVisibilityForApprovalForm);
        }
        
        if (hasPermission('roles:manage')) {
            addSafeListener(DOM.rolesList, 'click', handleRoleSelection);
            addSafeListener(DOM.saveRolePermissionsBtn, 'click', saveRolePermissions);
            addSafeListener(DOM.backupDbBtn, 'click', handleBackupDb);
            addSafeListener(DOM.clearSessionsBtn, 'click', handleClearSessions);
        }
        
        if (hasPermission('settings:view')) {
            addSafeListener(DOM.saveTableSettingsBtn, 'click', saveTableSettings);
            addSafeListener(DOM.settingsPage, 'click', handleTableSettingsActions);
            addSafeListener(DOM.saveTelegramBtn, 'click', saveTelegramSettings);
            addSafeListener(DOM.saveGeneralSettingsBtn, 'click', saveGeneralSettings);
            document.querySelectorAll('.accordion-header').forEach(header => addSafeListener(header, 'click', toggleAccordion));
        }
        
        if (hasPermission('settings:edit_general')) {
            addSafeListener(DOM.saveBrandingSettingsBtn, 'click', saveBrandingSettings);
        }
        
        if (hasPermission('dashboard:view')) {
            addSafeListener(DOM.kpiTableBody, 'click', async (e) => {
                const toggleBtn = e.target.closest('.toggle-kpi-details-btn');
                
                if (toggleBtn) {
                    e.stopPropagation();
                    const mainRow = toggleBtn.closest('.kpi-main-row');
                    const userId = mainRow.dataset.userId;
                    const detailsRow = DOM.kpiTableBody.querySelector(`.kpi-details-row[data-details-for="${userId}"]`);
                    
                    if (detailsRow) {
                        const isOpen = mainRow.classList.toggle('details-open');
                        detailsRow.classList.toggle('hidden');
                        
                        const icon = toggleBtn.querySelector('i');
                        icon.setAttribute('data-feather', isOpen ? 'chevron-up' : 'chevron-down');
                        feather.replace();

                        // Load calendar when row is opened for the first time
                        if (isOpen && !detailsRow.dataset.calendarLoaded) {
                            const container = detailsRow.querySelector('.kpi-details-calendar-container');
                            if (container) {
                                await renderMiniCalendar(userId, container);
                                detailsRow.dataset.calendarLoaded = 'true';
                            }
                        }
                    }
                    return;
                }

                const row = e.target.closest('.kpi-main-row');
                if (row) {
                    const userId = row.dataset.userId;
                    const user = state.kpi.data.find(u => u.userId == userId);
                    if (user) {
                        showEmployeeDetails(userId, user.fullname || user.username);
                    }
                }
            });

            addSafeListener(DOM.detailsCalendarGrid, 'click', (e) => {
                const day = e.target.closest('.calendar-day');
                if (day && day.dataset.reportId) {
                    window.open(`/?report=${day.dataset.reportId}`, '_blank');
                }
            });
        }

        addSafeListener(DOM.sessionsModal, 'click', handleSessionTermination);
        addSafeListener(DOM.mySessionsList, 'click', handleSessionTermination);

        document.querySelectorAll('.close-modal-btn').forEach(btn => {
            addSafeListener(btn, 'click', () => document.getElementById(btn.dataset.target)?.classList.add('hidden'));
        });

        document.body.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('.toggle-visibility-btn');
            if (toggleBtn) {
                const input = toggleBtn.closest('.secure-input-wrapper').querySelector('input');
                const icon = toggleBtn.querySelector('i');
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.setAttribute('data-feather', 'eye-off');
                } else {
                    input.type = 'password';
                    icon.setAttribute('data-feather', 'eye');
                }
                feather.replace();
            }
        });

        addSafeListener(DOM.auditLogPagination, 'click', e => {
            const btn = e.target.closest('.pagination-btn');
            if (!btn) return;
            let currentPage = state.auditLog.pagination.currentPage;
            if (btn.id === 'audit-prev-page-btn' && currentPage > 1) {
                fetchAndRenderAuditLogs(currentPage - 1);
            } else if (btn.id === 'audit-next-page-btn' && currentPage < state.auditLog.pagination.pages) {
                fetchAndRenderAuditLogs(currentPage + 1);
            }
        });
        addSafeListener(DOM.auditLogTableBody, 'click', e => {
            const detailsBtn = e.target.closest('.open-audit-details-btn');
            if (detailsBtn) {
                const logId = parseInt(detailsBtn.dataset.logId, 10);
                openAuditDetailsModal(logId);
            }
        });
    }

    function hasPermission(permissionKey) {
        return state.currentUser?.permissions?.includes(permissionKey);
    }

    function navigateTo(pageId) {
        if (!pageId) pageId = 'dashboard';
        const targetPage = document.getElementById(pageId);
        const targetLink = document.querySelector(`.nav-link[data-page="${pageId}"]`);
        
        if (targetPage && targetLink && (targetLink.style.display !== 'none')) {
            document.querySelectorAll('.nav-link.active').forEach(l => l.classList.remove('active'));
            targetLink.classList.add('active');
            DOM.pages.forEach(p => p.classList.remove('active'));
            targetPage.classList.add('active');
            window.location.hash = pageId;

            if (pageId === 'employee-statistics' && hasPermission('dashboard:view')) {
                setupKpiPage();
            } else if (pageId === 'audit-log' && hasPermission('audit:view')) {
                if (state.auditLog.initialLoad) {
                    fetchAndRenderAuditLogs();
                }
            }
            
            if (pageId === 'interactive-report' && hasPermission('reports:view_pivot')) {
                // 1. Sana tanlagichni ishga tushiramiz
                if (typeof setupPivotDatePicker === 'function') {
                    setupPivotDatePicker();
                }
                
                // 2. Pivot jadval komponentini ishga tushiramiz
                if (typeof initializePivotGrid === 'function' && !state.pivotGrid) {
                    initializePivotGrid();
                }

                // 3. Joriy oyning boshlanish va tugash sanalarini aniqlaymiz
                const now = new Date();
                const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);

                // 4. Bu sanalarni flatpickr komponentiga o'rnatamiz
                if (pivotDatePickerFP) {
                    pivotDatePickerFP.setDate([startDate, endDate], false); // `false` - `onChange` hodisasini ishga tushirmaslik uchun
                }

                // 5. Shu sanalar bo'yicha ma'lumotlarni darhol yuklaymiz
                const startStr = flatpickr.formatDate(startDate, "Y-m-d");
                const endStr = flatpickr.formatDate(endDate, "Y-m-d");
                loadDataForPivot(startStr, endStr);
            }
        }
    }

    function handleNavigation(e) {
        const link = e.target.closest('.nav-link');
        if (!link) return;
        e.preventDefault();
        navigateTo(link.dataset.page);
    }

    async function handleLogout() {
        await safeFetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    }

    function toggleLocationVisibilityForUserForm() {
        const role = DOM.userRoleSelect?.value;
        const display = (role === 'operator' || role === 'manager') ? 'block' : 'none';
        if (DOM.userLocationsGroup) DOM.userLocationsGroup.style.display = display;
    }
    
    function toggleLocationVisibilityForApprovalForm() {
        const role = DOM.approvalRoleSelect?.value;
        const display = (role === 'operator' || role === 'manager') ? 'block' : 'none';
        if (DOM.approvalLocationsGroup) DOM.approvalLocationsGroup.style.display = display;
    }

    function openUserModalForAdd() {
        DOM.userForm?.reset();
        if (DOM.editUserIdInput) DOM.editUserIdInput.value = '';
        if (DOM.userModalTitle) DOM.userModalTitle.textContent = 'Yangi Foydalanuvchi Qo\'shish';
        if (DOM.passwordGroup) DOM.passwordGroup.style.display = 'block';
        if (DOM.passwordInput) DOM.passwordInput.required = true;
        if (DOM.userRoleSelect) DOM.userRoleSelect.innerHTML = state.roles.map(r => `<option value="${r.role_name}">${r.role_name}</option>`).join('');
        toggleLocationVisibilityForUserForm();
        DOM.userFormModal?.classList.remove('hidden');
    }

    function openUserModalForEdit(userId) {
        const user = state.users.find(u => u.id == userId);
        if (!user || !DOM.userForm) return;
        DOM.userForm.reset();
        DOM.editUserIdInput.value = user.id;
        DOM.userModalTitle.textContent = `"${user.username}"ni Tahrirlash`;
        DOM.usernameInput.value = user.username;
        DOM.fullnameInput.value = user.fullname || '';
        DOM.passwordGroup.style.display = 'none';
        DOM.passwordInput.required = false;
        DOM.userRoleSelect.innerHTML = state.roles.map(r => `<option value="${r.role_name}" ${user.role === r.role_name ? 'selected' : ''}>${r.role_name}</option>`).join('');
        DOM.deviceLimitInput.value = user.device_limit;
        document.querySelectorAll('#locations-checkbox-list input').forEach(cb => {
            cb.checked = user.locations.includes(cb.value);
        });
        toggleLocationVisibilityForUserForm();
        DOM.userFormModal.classList.remove('hidden');
    }

    async function handleUserFormSubmit(e) {
        e.preventDefault();
        const userId = DOM.editUserIdInput.value;
        const isEditing = !!userId;
        const data = {
            username: DOM.usernameInput.value.trim(),
            fullname: DOM.fullnameInput.value.trim(),
            role: DOM.userRoleSelect.value,
            device_limit: parseInt(DOM.deviceLimitInput.value) || 1,
            locations: Array.from(document.querySelectorAll('#locations-checkbox-list input:checked')).map(cb => cb.value)
        };
        if (!isEditing && DOM.passwordInput.value) {
            data.password = DOM.passwordInput.value;
        }
        const url = isEditing ? `/api/users/${userId}` : '/api/users';
        const method = isEditing ? 'PUT' : 'POST';
        try {
            const res = await safeFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            const result = await res.json();
            showToast(result.message);
            const usersRes = await safeFetch('/api/users');
            if (usersRes && usersRes.ok) {
                state.users = await usersRes.json();
                const activeTab = DOM.userTabs.querySelector('.active').dataset.status;
                renderUsersByStatus(activeTab);
            }
            DOM.userFormModal.classList.add('hidden');
        } catch (error) {
            showToast(error.message, true);
        }
    }

    async function handleUserActions(e) {
        const button = e.target.closest('button');
        if (!button) return;
        const userId = button.dataset.id;
        if (button.classList.contains('edit-user-btn')) {
            openUserModalForEdit(userId);
        } else if (button.classList.contains('deactivate-user-btn') || button.classList.contains('activate-user-btn')) {
            const status = button.classList.contains('activate-user-btn') ? 'active' : 'blocked';
            if (confirm(`Rostdan ham bu foydalanuvchini ${status === 'active' ? 'aktivlashtirmoqchimisiz' : 'bloklamoqchimisiz'}?`)) {
                try {
                    const res = await safeFetch(`/api/users/${userId}/status`, { 
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status })
                    });
                    if (!res || !res.ok) throw new Error((await res.json()).message);
                    const result = await res.json();
                    showToast(result.message);
                    const usersRes = await safeFetch('/api/users');
                    if (usersRes && usersRes.ok) {
                        state.users = await usersRes.json();
                        const activeTab = DOM.userTabs.querySelector('.active').dataset.status;
                        renderUsersByStatus(activeTab);
                    }
                } catch (error) { showToast(error.message, true); }
            }
        } else if (button.classList.contains('manage-sessions-btn')) {
            const username = button.dataset.username;
            DOM.sessionsModalTitle.textContent = `"${username}"ning Aktiv Sessiyalari`;
            DOM.sessionsListContainer.innerHTML = '<div class="skeleton-item"></div>';
            DOM.sessionsModal.classList.remove('hidden');
            try {
                const res = await safeFetch(`/api/users/${userId}/sessions`);
                if (!res || !res.ok) throw new Error('Sessiyalarni yuklab bo\'lmadi');
                const sessions = await res.json();
                                DOM.sessionsListContainer.innerHTML = sessions.length > 0 ? sessions.map(s => `
                    <div class="session-item ${s.is_current ? 'current' : ''}">
                        <div class="session-details">
                            <div><strong>IP Manzil:</strong> ${s.ip_address || 'Noma\'lum'}</div>
                            <div><strong>Qurilma:</strong> ${s.user_agent || 'Noma\'lum'}</div>
                            <div><strong>Oxirgi faollik:</strong> ${new Date(s.last_activity).toLocaleString()}</div>
                        </div>
                        ${!s.is_current ? `<button class="btn btn-danger btn-sm terminate-session-btn" data-sid="${s.sid}">Tugatish</button>` : '<span class="badge" style="background-color: var(--green-color);">Joriy</span>'}
                    </div>
                `).join('') : '<div class="empty-state">Aktiv sessiyalar topilmadi.</div>';
            } catch (error) {
                DOM.sessionsListContainer.innerHTML = `<div class="empty-state error">${error.message}</div>`;
            }
        } else if (button.classList.contains('change-password-btn')) {
            openCredentialsModal(userId, 'password');
        } else if (button.classList.contains('set-secret-word-btn')) {
            openCredentialsModal(userId, 'secret-word');
        } else if (button.classList.contains('connect-telegram-btn')) {
            openTelegramConnectModal(userId);
        }
    }

    function handlePendingUserActions(e) {
        const button = e.target.closest('button');
        if (!button) return;
        const userId = button.dataset.id;
        if (button.classList.contains('approve-user-btn')) {
            const username = button.dataset.username;
            openApprovalModal(userId, username);
        } else if (button.classList.contains('reject-user-btn')) {
            if (confirm("Rostdan ham bu foydalanuvchining so'rovini rad etmoqchimisiz?")) {
                handleUserRejection(userId);
            }
        }
    }

    function openApprovalModal(userId, username) {
        DOM.approvalForm.reset();
        DOM.approvalUserIdInput.value = userId;
        DOM.approvalUsernameSpan.textContent = username;
        DOM.approvalRoleSelect.innerHTML = state.roles
            .filter(r => r.role_name !== 'admin')
            .map(r => `<option value="${r.role_name}">${r.role_name}</option>`).join('');
        toggleLocationVisibilityForApprovalForm();
        DOM.approvalModal.classList.remove('hidden');
    }

    async function submitUserApproval(e) {
        e.preventDefault();
        const userId = DOM.approvalUserIdInput.value;
        const data = {
            role: DOM.approvalRoleSelect.value,
            locations: Array.from(document.querySelectorAll('#approval-locations-checkbox-list input:checked')).map(cb => cb.value)
        };

        try {
            const res = await safeFetch(`/api/users/${userId}/approve`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            const result = await res.json();
            
            showToast(result.message);
            
            const [pendingRes, usersRes] = await Promise.all([
                safeFetch('/api/users/pending'),
                safeFetch('/api/users')
            ]);

            if (pendingRes && pendingRes.ok) {
                state.pendingUsers = await pendingRes.json();
                renderPendingUsers();
            }
            if (usersRes && usersRes.ok) {
                state.users = await usersRes.json();
                const activeTab = DOM.userTabs.querySelector('.active').dataset.status;
                renderUsersByStatus(activeTab);
            }
            
            DOM.approvalModal.classList.add('hidden');
        } catch (error) {
            showToast(error.message, true);
        }
    }

    async function handleUserRejection(userId) {
        try {
            const res = await safeFetch(`/api/users/${userId}/reject`, { method: 'PUT' });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            const result = await res.json();

            showToast(result.message);
            state.pendingUsers = state.pendingUsers.filter(u => u.id != userId);
            renderPendingUsers();
        } catch (error) {
            showToast(error.message, true);
        }
    }

    function openCredentialsModal(userId, type) {
        DOM.credentialsForm.reset();
        DOM.credentialsUserIdInput.value = userId;
        DOM.credentialsForm.dataset.type = type;
        if (type === 'password') {
            DOM.credentialsModalTitle.textContent = "Parolni O'zgartirish";
            DOM.credentialsInputLabel.textContent = "Yangi Parol";
            DOM.credentialsInput.type = 'password';
            DOM.credentialsInput.minLength = 8;
        } else {
            DOM.credentialsModalTitle.textContent = "Maxfiy So'zni O'rnatish";
            DOM.credentialsInputLabel.textContent = "Yangi Maxfiy So'z";
            DOM.credentialsInput.type = 'text';
            DOM.credentialsInput.minLength = 6;
        }
        DOM.credentialsModal.classList.remove('hidden');
    }

    async function handleCredentialsFormSubmit(e) {
        e.preventDefault();
        const userId = DOM.credentialsUserIdInput.value;
        const type = DOM.credentialsForm.dataset.type;
        const value = DOM.credentialsInput.value;
        const url = `/api/users/${userId}/${type}`;
        const body = type === 'password' ? { newPassword: value } : { secretWord: value };
        try {
            const res = await safeFetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            const result = await res.json();
            showToast(result.message);
            DOM.credentialsModal.classList.add('hidden');
        } catch (error) {
            showToast(error.message, true);
        }
    }

    function openTelegramConnectModal(userId) {
        const randomToken = Math.random().toString(36).substring(2, 10);
        const connectCode = `connect_${userId}_${randomToken}`;
        const botUsername = state.settings.telegram_bot_username;
        if (!botUsername) {
            return showToast("Iltimos, avval Sozlamalar bo'limida Bot Username'ni kiriting!", true);
        }
        const connectLink = `https://t.me/${botUsername}?start=${connectCode}`;
        DOM.telegramConnectLinkInput.value = connectLink;
        DOM.telegramConnectModal.classList.remove('hidden'    );
    }

    function copyTelegramLink() {
        DOM.telegramConnectLinkInput.select();
        document.execCommand('copy');
        showToast("Havola nusxalandi!");
    }

    async function handleSessionTermination(e) {
        const button = e.target.closest('.terminate-session-btn');
        if (!button) return;
        const sid = button.dataset.sid;
        if (confirm("Rostdan ham bu sessiyani tugatmoqchimisiz?")) {
            try {
                const res = await safeFetch(`/api/sessions/${sid}`, { method: 'DELETE' });
                if (!res || !res.ok) throw new Error((await res.json()).message);
                const result = await res.json();
                showToast(result.message);
                
                if (DOM.securityPage.classList.contains('active')) {
                    fetchAndRenderMySessions();
                } else if (DOM.sessionsModal.classList.contains('hidden') === false) {
                    button.closest('.session-item').remove();
                }

            } catch (error) {
                showToast(error.message, true);
            }
        }
    }

    function handleRoleSelection(e) {
        const li = e.target.closest('li');
        if (!li) return;
        const roleName = li.dataset.role;
        state.currentEditingRole = roleName;
        DOM.rolesList.querySelectorAll('li').forEach(item => item.classList.remove('active'));
        li.classList.add('active');
        DOM.currentRoleTitle.textContent = `"${roleName}" roli uchun huquqlar`;
        DOM.saveRolePermissionsBtn.classList.remove('hidden');
        const roleData = state.roles.find(r => r.role_name === roleName);
        const rolePermissions = roleData ? roleData.permissions : [];
        DOM.permissionsGrid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = rolePermissions.includes(cb.value);
        });
        applyAllPermissionExclusions();
        if (roleName === 'admin') {
            DOM.permissionsPanel.classList.add('disabled');
        } else {
            DOM.permissionsPanel.classList.remove('disabled');
        }
    }

    async function saveRolePermissions() {
        if (!state.currentEditingRole || state.currentEditingRole === 'admin') return;
        const checkedPermissions = Array.from(DOM.permissionsGrid.querySelectorAll('input:checked')).map(cb => cb.value);
        try {
            const res = await safeFetch(`/api/roles/${state.currentEditingRole}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ permissions: checkedPermissions })
            });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            const result = await res.json();
            showToast(result.message);
            const roleIndex = state.roles.findIndex(r => r.role_name === state.currentEditingRole);
            if (roleIndex > -1) {
                state.roles[roleIndex].permissions = checkedPermissions;
            }
        } catch (error) {
            showToast(error.message, true);
        }
    }

    async function saveTableSettings() {
        const newSettings = { columns: [], rows: [], locations: [] };
        document.querySelectorAll('#columns-settings .setting-name').forEach(span => newSettings.columns.push(span.textContent));
        document.querySelectorAll('#rows-settings .setting-name').forEach(span => newSettings.rows.push(span.textContent));
        document.querySelectorAll('#locations-settings .setting-name').forEach(span => newSettings.locations.push(span.textContent));
        try {
            const res = await safeFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'app_settings', value: newSettings }) });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            showToast("Jadval sozlamalari saqlandi!");
            state.settings.app_settings = newSettings;
            renderTableSettings();
        } catch (error) { showToast(error.message, true); }
    }

    function handleTableSettingsActions(e) {
        const button = e.target.closest('button');
        if (!button) return;
        if (button.classList.contains('delete-item-btn')) {
            button.closest('.setting-item').remove();
            return;
        }
        if (button.id && button.id.startsWith('add-')) {
            const type = button.id.replace('add-', '').replace('-btn', '');
            const input = document.getElementById(`new-${type}-name`);
            const list = document.getElementById(`${type}s-settings`);
            if (input && list) {
                const name = input.value.trim();
                if (name) {
                    list.insertAdjacentHTML('beforeend', `
                        <div class="setting-item" data-name="${name}">
                            <span class="setting-name">${name}</span>
                            <button class="delete-item-btn btn-icon"><i data-feather="x"></i></button>
                        </div>`);
                    input.value = '';
                    feather.replace();
                }
            }
        }
    }

    async function saveTelegramSettings() {
        const settingsToSave = [
            { key: 'telegram_bot_token', value: DOM.botTokenInput.value.trim() },
            { key: 'telegram_bot_username', value: DOM.botUsernameInput.value.trim() },
            { key: 'telegram_group_id', value: DOM.groupIdInput.value.trim() },
            { key: 'telegram_admin_chat_id', value: DOM.adminChatIdInput.value.trim() }
        ];
        try {
            for (const setting of settingsToSave) {
                const res = await safeFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(setting) });
                if (!res || !res.ok) throw new Error((await res.json()).message);
            }
            showToast("Telegram sozlamalari saqlandi!");
        } catch (error) { showToast(`Sozlamalarni saqlashda xatolik: ${error.message}`, true); }
    }

    async function saveGeneralSettings() {
        const limit = DOM.paginationLimitInput.value;
        try {
            const res = await safeFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'pagination_limit', value: limit }) });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            showToast("Umumiy sozlamalar saqlandi!");
        } catch (error) { showToast(error.message, true); }
    }

    function toggleAccordion(e) {
        const item = e.target.closest('.accordion-item');
        if (!item) return;
        item.classList.toggle('active');
    }

    function setupBrandingControls() {
        const colors = ['#4CAF50', '#007bff', '#dc3545', '#ffc107', '#6f42c1', '#fd7e14', '#20c997', '#e83e8c', '#17a2b8', '#ffffff'];
        const animations = { 'anim-none': 'Yo\'q', 'anim-glow-pulse': 'Pulsatsiya', 'anim-flicker': 'Miltillash', 'anim-scanner': 'Skaner' };
        const borders = { 'border-none': 'Yo\'q', 'border-glow': 'Yorqin Chegara', 'border-dashed': 'Punktir Chegara', 'border-line-grow': 'Chiziqli Animatsiya' };

        DOM.logoColorPalette.innerHTML = colors.map(c => `<div class="color-box" style="background-color: ${c}" data-color="${c}"></div>`).join('');
        DOM.logoAnimationSelect.innerHTML = Object.entries(animations).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
        DOM.logoBorderEffectSelect.innerHTML = Object.entries(borders).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

        const currentBranding = state.settings.branding_settings;
        DOM.logoTextInput.value = currentBranding.text;
        DOM.logoAnimationSelect.value = currentBranding.animation;
        DOM.logoBorderEffectSelect.value = currentBranding.border;
        updateLogoPreview(currentBranding);

        DOM.logoTextInput.addEventListener('input', (e) => updateLogoPreview({ text: e.target.value }));
        DOM.logoColorPalette.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-box')) {
                updateLogoPreview({ color: e.target.dataset.color });
            }
        });
        DOM.logoAnimationSelect.addEventListener('change', (e) => updateLogoPreview({ animation: e.target.value }));
        DOM.logoBorderEffectSelect.addEventListener('change', (e) => updateLogoPreview({ border: e.target.value }));
    }

    function updateLogoPreview(newSettings = {}) {
        const currentSettings = {
            text: DOM.logoPreview.textContent,
            color: DOM.logoPreview.style.getPropertyValue('--glow-color') || '#4CAF50',
            animation: DOM.logoPreview.className.match(/anim-\w+/g)?.[0] || 'anim-none',
            border: DOM.logoPreviewContainer.className.match(/border-\w+/g)?.[0] || 'border-none'
        };
        const settings = { ...currentSettings, ...newSettings };

        DOM.logoPreview.textContent = settings.text;
        DOM.logoPreview.style.setProperty('--glow-color', settings.color);
        DOM.logoPreview.className = 'brand-logo';
        if (settings.animation !== 'anim-none') DOM.logoPreview.classList.add(settings.animation);
        
        DOM.logoPreviewContainer.className = 'logo-border-effect';
        if (settings.border !== 'border-none') DOM.logoPreviewContainer.classList.add(settings.border);
        DOM.logoPreviewContainer.style.setProperty('--glow-color', settings.color);

        DOM.logoColorPalette.querySelectorAll('.color-box').forEach(box => {
            box.classList.toggle('active', box.dataset.color === settings.color);
        });
    }

    async function saveBrandingSettings() {
        const settings = {
            text: DOM.logoTextInput.value,
            color: DOM.logoPreview.style.getPropertyValue('--glow-color'),
            animation: DOM.logoAnimationSelect.value,
            border: DOM.logoBorderEffectSelect.value
        };
        try {
            const res = await safeFetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'branding_settings', value: settings }) });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            showToast("Brending sozlamalari saqlandi!");
            applyBranding(settings);
        } catch (error) {
            showToast(error.message, true);
        }
    }

    function applyBranding(settings) {
        const s = settings || state.settings.branding_settings;
        DOM.brandLogos.forEach(logo => {
            logo.textContent = s.text;
            logo.className = 'brand-logo';
            if (s.animation !== 'anim-none') logo.classList.add(s.animation);
            logo.style.setProperty('--glow-color', s.color);
        });
        DOM.logoBorderEffects.forEach(container => {
            container.className = 'logo-border-effect';
            if (s.border !== 'border-none') {
                container.classList.add(s.border);
            }
            container.style.setProperty('--glow-color', s.color);
        });
    }
    
    async function handleBackupDb() {
        if (!confirm("Rostdan ham ma'lumotlar bazasining to'liq nusxasini yuklab olmoqchimisiz?")) return;
        try {
            const response = await safeFetch('/api/admin/backup-db');
            if (!response || !response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Baza nusxasini olib bo\'lmadi');
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            const disposition = response.headers.get('content-disposition');
            let fileName = `database_backup_${new Date().toISOString().split('T')}.db`;
            if (disposition && disposition.indexOf('attachment') !== -1) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) { 
                    fileName = matches[1].replace(/['"]/g, '');
                }
            }
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            showToast("Baza nusxasi muvaffaqiyatli yuklab olindi.");
        } catch (error) {
            showToast(error.message, true);
        }
    }

    async function handleClearSessions() {
        if (!confirm("DIQQAT! Bu amal o'zingizdan tashqari barcha foydalanuvchilarni tizimdan chiqarib yuboradi. Davom etasizmi?")) return;
        try {
            const res = await safeFetch('/api/admin/clear-sessions', { method: 'POST' });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            const result = await res.json();
            showToast(result.message);
        } catch (error) {
            showToast(error.message, true);
        }
    }

    function handlePermissionChange(event) {
        const changedCheckbox = event.target;
        if (changedCheckbox.tagName !== 'INPUT' || changedCheckbox.type !== 'checkbox') return;
        const changedPermission = changedCheckbox.value;
        for (const groupName in permissionExclusionGroups) {
            const group = permissionExclusionGroups[groupName];
            if (group.includes(changedPermission)) {
                if (changedCheckbox.checked) {
                    group.forEach(permKey => {
                        if (permKey !== changedPermission) {
                            const checkbox = DOM.permissionsGrid.querySelector(`input[value="${permKey}"]`);
                            if (checkbox) checkbox.checked = false;
                        }
                    });
                }
                applyPermissionExclusionsForGroup(group);
                break;
            }
        }
    }

    function applyPermissionExclusionsForGroup(group) {
        let checkedPermission = null;
        for (const permKey of group) {
            const checkbox = DOM.permissionsGrid.querySelector(`input[value="${permKey}"]`);
            if (checkbox && checkbox.checked) {
                checkedPermission = permKey;
                break;
            }
        }
        group.forEach(permKey => {
            const checkbox = DOM.permissionsGrid.querySelector(`input[value="${permKey}"]`);
            if (checkbox) {
                const item = checkbox.closest('.permission-item');
                const shouldBeDisabled = checkedPermission && permKey !== checkedPermission;
                checkbox.disabled = shouldBeDisabled;
                if(item) item.classList.toggle('disabled', shouldBeDisabled);
            }
        });
    }

    function applyAllPermissionExclusions() {
        for (const groupName in permissionExclusionGroups) {
            applyPermissionExclusionsForGroup(permissionExclusionGroups[groupName]);
        }
    }

    // Mini-kalendarni chizish uchun yordamchi funksiya
    async function renderMiniCalendar(userId, container) {
        if (!container) return;
        container.innerHTML = '<div class="calendar-placeholder">Kalendar yuklanmoqda...</div>';

        try {
            const res = await safeFetch(`/api/statistics/employee/${userId}?month=${state.kpi.selectedMonth}`);            
            if (!res || !res.ok) {
                throw new Error('Kalendar ma\'lumotlari yuklanmadi');
            }
            
            const dailyData = await res.json();
            
            // Get the first day of the month to calculate the offset
            const firstDayOfMonth = new Date(dailyData[0]?.date || new Date().toISOString().split('T')[0]);
            const offset = firstDayOfMonth.getDay() === 0 ? 6 : firstDayOfMonth.getDay() - 1; // Monday is 1, Sunday is 0

            let calendarHtml = `
                <div class="mini-calendar-header">
                    <div>Du</div><div>Se</div><div>Cho</div><div>Pa</div><div>Ju</div><div>Sh</div><div>Ya</div>
                </div>
                <div class="mini-calendar-grid">
            `;
            
            // Add empty cells for days before the first day of the month
            calendarHtml += Array(offset).fill('<div class="mini-calendar-day disabled"></div>').join('');

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Add days of the month
            calendarHtml += dailyData.map(day => {
                const dayDate = new Date(day.date);
                dayDate.setHours(0, 0, 0, 0);
                
                let statusClass = 'not_submitted';
                if (day.status === 'on_time') statusClass = 'on_time';
                else if (day.status === 'late') statusClass = 'late';
                
                if (dayDate > today) {
                    statusClass = 'future';
                }
                
                const title = `${day.date}\nStatus: ${statusClass.replace('_', ' ')}`;
                return `<div class="mini-calendar-day ${statusClass}" title="${title}"><span>${dayDate.getDate()}</span></div>`;
            }).join('');

            calendarHtml += '</div>';
            container.innerHTML = calendarHtml;

        } catch (error) {
            console.error('Kalendarni yuklashda xatolik:', error);
            container.innerHTML = `<div class="calendar-placeholder error">Xatolik: ${error.message}</div>`;
        }
    }

    // To'liq ma'lumotlarni eksport qilish
    async function handleFullExport(e) {
        const button = e.target;
        const originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<span class="spinner" style="margin: 0 auto;"></span> Eksport qilinmoqda...';

        try {
            const response = await fetch('/api/admin/export-full-data', { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
                },
                credentials: 'include'
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Eksport qilishda xatolik yuz berdi.');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;

            // Fayl nomini olish
            const disposition = response.headers.get('content-disposition');
            let fileName = `full_backup_${new Date().toISOString()}.json`;
            
            if (disposition && disposition.indexOf('attachment') !== -1) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) {
                    fileName = matches[1].replace(/['"]/g, '');
                }
            }
            
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            showToast("Ma'lumotlar muvaffaqiyatli eksport qilindi.");

        } catch (error) {
            console.error('Eksport qilishda xatolik:', error);
            showToast(error.message || "Eksport qilishda xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.", true);
        } finally {
            button.disabled = false;
            button.innerHTML = originalText;
        }
    }

    // To'liq ma'lumotlarni import qilish
    async function handleFullImport(e) {
        e.preventDefault();
        
        const form = e.target;
        const fileInput = document.getElementById('import-file-input');
        const button = form.querySelector('button[type="submit"]');

        if (!fileInput.files || fileInput.files.length === 0) {
            showToast("Iltimos, import uchun fayl tanlang.", true);
            return;
        }

        // Tasdiqlash so'rovi
        if (!confirm("DIQQAT! Bu amal BARCHA joriy ma'lumotlarni o'chirib yuboradi. Bu amalni qaytarib bo'lmaydi. Rostdan ham davom etmoqchimisiz?")) {
            return;
        }

        const formData = new FormData();
        formData.append('backupFile', fileInput.files[0]);

        const originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<span class="spinner" style="margin: 0 auto;"></span> Import qilinmoqda...';

        try {
            const response = await fetch('/api/admin/import-full-data', {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Import qilishda noma\'lum xatolik.');
            }

            showToast(result.message + " Iltimos, 5 soniyadan so'ng tizimga qayta kiring.");
            
            // 5 soniyadan so'ng login sahifasiga yo'naltirish
            setTimeout(() => {
                window.location.href = '/login';
            }, 5000);

        } catch (error) {
            console.error('Import qilishda xatolik:', error);
            showToast(error.message || "Import qilishda xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.", true);
            button.disabled = false;
            button.innerHTML = originalText;
        }
    }

    // Dasturni ishga tushirish
    init();

    // ============================================================
    // PIVOT SHABLONLARI UCHUN FUNKSIYALAR
    // ============================================================

    // Shablon saqlash oynasini ochish
    function openSaveTemplateDialog() {
        if (!state.pivotGrid) return;
        DOM.templateNameInput.value = '';
        DOM.saveTemplateModal.classList.remove('hidden');
        DOM.templateNameInput.focus();
    }

    // Shablon yuklash oynasini ochish
    async function openLoadTemplateDialog() {
        if (!state.pivotGrid) return;
        DOM.templatesTagList.innerHTML = '<div class="empty-state">Shablonlar yuklanmoqda...</div>';
        DOM.openTemplateModal.classList.remove('hidden');
        
        try {
            const res = await safeFetch('/api/pivot-templates');
            if (!res || !res.ok) throw new Error("Shablonlarni yuklab bo'lmadi");
            state.pivotTemplates = await res.json();
            
            if (state.pivotTemplates.length === 0) {
                DOM.templatesTagList.innerHTML = '<div class="empty-state">Saqlangan shablonlar topilmadi.</div>';
                return;
            }

            DOM.templatesTagList.innerHTML = state.pivotTemplates.map(template => `
                <div class="template-tag" data-id="${template.id}">
                    <span class="tag-name">${template.name}</span>
                    <div class="tag-actions">
                        <button class="btn-icon delete-template-btn" title="O'chirish"><i data-feather="trash-2"></i></button>
                    </div>
                </div>
            `).join('');
            feather.replace();

        } catch (error) {
            showToast(error.message, true);
            DOM.templatesTagList.innerHTML = `<div class="empty-state error">${error.message}</div>`;
        }
    }

    // Shablon saqlash
    async function handleSaveTemplate(e) {
        e.preventDefault();
        const name = DOM.templateNameInput.value.trim();
        if (!name) {
            showToast("Shablon nomini kiriting!", true);
            return;
        }

        const reportConfig = state.pivotGrid.getReport();
        delete reportConfig.dataSource; // Ma'lumotlarni saqlamaymiz

        try {
            const res = await safeFetch('/api/pivot-templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, report: reportConfig })
            });
            if (!res || !res.ok) throw new Error((await res.json()).message);
            
            showToast("Shablon muvaffaqiyatli saqlandi!");
            DOM.saveTemplateModal.classList.add('hidden');
        } catch (error) {
            showToast(error.message, true);
        }
    }

    // Shablonlar ro'yxatidagi harakatlarni boshqarish
    async function handleTemplateListClick(e) {
        const deleteBtn = e.target.closest('.delete-template-btn');
        const tag = e.target.closest('.template-tag');

        if (deleteBtn) {
            e.stopPropagation();
            const templateId = tag.dataset.id;
            if (confirm("Rostdan ham bu shablonni o'chirmoqchimisiz?")) {
                try {
                    const res = await safeFetch(`/api/pivot-templates/${templateId}`, { method: 'DELETE' });
                    if (!res || !res.ok) throw new Error((await res.json()).message);
                    showToast("Shablon o'chirildi.");
                    tag.remove();
                } catch (error) {
                    showToast(error.message, true);
                }
            }
        } else if (tag) {
            const templateId = tag.dataset.id;
            try {
                const res = await safeFetch(`/api/pivot-templates/${templateId}`);
                if (!res || !res.ok) throw new Error("Shablonni yuklab bo'lmadi");
                const template = await res.json();
                
                const currentDataSource = state.pivotGrid.getReport().dataSource;
                const newReport = JSON.parse(template.report);
                newReport.dataSource = currentDataSource;
                
                state.pivotGrid.setReport(newReport);
                showToast(`"${template.name}" shabloni yuklandi.`);
                DOM.openTemplateModal.classList.add('hidden');
            } catch (error) {
                showToast(error.message, true);
            }
        }
    }

    // Event listenerlarni qo'shamiz
    if (DOM.saveTemplateForm) {
        DOM.saveTemplateForm.addEventListener('submit', handleSaveTemplate);
    }
    
    // Eksport/Import uchun event listenerlar
    if (document.getElementById('export-full-data-btn')) {
        document.getElementById('export-full-data-btn').addEventListener('click', handleFullExport);
    }
    
    if (document.getElementById('import-form')) {
        document.getElementById('import-form').addEventListener('submit', handleFullImport);
    }
    if (DOM.templatesTagList) {
        DOM.templatesTagList.addEventListener('click', handleTemplateListClick);
    }
});


