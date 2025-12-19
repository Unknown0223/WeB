// DOM Elements Module
// Barcha DOM elementlarini bir joyda boshqarish

export const DOM = {
    // will be populated by initDOM()
    body: null,
    sidebarNav: null,
    pages: null,
    logoutBtn: null,
    brandLogos: null,
    logoBorderEffects: null,
    // Dashboard (admin)
    statsGrid: null,
    dailyStatusGrid: null,
    dashboardDatePicker: null,
    dashboardSelectedDate: null,
    weeklyChartCanvas: null,
    customizeStatsBtn: null,
    statsConfigModal: null,
    statsOptionsGrid: null,
    saveStatsConfigBtn: null,
    // Foydalanuvchilar
    usersPage: null,
    userListContainer: null,
    userTabs: null,
    openAddUserModalBtn: null,
    userFormModal: null,
    userForm: null,
    userModalTitle: null,
    editUserIdInput: null,
    usernameInput: null,
    fullnameInput: null,
    passwordInput: null,
    passwordGroup: null,
    userRoleSelect: null,
    deviceLimitInput: null,
    userLocationsGroup: null,
    locationsCheckboxList: null,
    userSettingsGroup: null,
    userRequiresLocations: null,
    userRequiresBrands: null,
    userBrandsGroup: null,
    // Xodimlar Statistikasi (KPI)
    employeeStatisticsPage: null,
    kpiMonthPicker: null,
    kpiTableBody: null,
    employeeDetailsView: null,
    detailsViewTitle: null,
    detailsCalendarGrid: null,
    backToKpiListBtn: null,
    // Parol / Maxfiy so'z
    credentialsModal: null,
    credentialsForm: null,
    credentialsModalTitle: null,
    credentialsUserIdInput: null,
    credentialsInput: null,
    credentialsInputLabel: null,
    // Telegram
    telegramConnectModal: null,
    telegramConnectLinkInput: null,
    copyTelegramLinkBtn: null,
    // Sessiyalar
    sessionsModal: null,
    sessionsModalTitle: null,
    sessionsListContainer: null,
    // Rollar
    rolesManagementContainer: null,
    rolesList: null,
    permissionsPanel: null,
    currentRoleTitle: null,
    permissionsGrid: null,
    saveRolePermissionsBtn: null,
    // Sozlamalar
    settingsPage: null,
    saveTableSettingsBtn: null,
    saveTelegramBtn: null,
    botTokenInput: null,
    botUsernameInput: null,
    groupIdInput: null,
    adminChatIdInput: null,
    paginationLimitInput: null,
    saveGeneralSettingsBtn: null,
    saveKpiSettingsBtn: null,
    latePenaltyInput: null,
    editPenaltyInput: null,
    // Brending
    logoTextInput: null,
    logoColorPalette: null,
    logoAnimationSelect: null,
    logoBorderEffectSelect: null,
    logoPreview: null,
    logoPreviewContainer: null,
    saveBrandingSettingsBtn: null,
    // Pivot
    pivotContainer: null,
    pivotDateFilter: null,
    pivotCurrencySelect: null,
    saveTemplateModal: null,
    loadTemplateModal: null,
    confirmSaveTemplateBtn: null,
    templateNameInput: null,
    templateIsPublicCheckbox: null,
    publicTemplateOption: null,
    templatesListContainer: null,
    templatesPanel: null,
    templatesTagList: null,
    closeTemplatesPanelBtn: null,
    // Admin Boshqaruvi
    backupDbBtn: null,
    clearSessionsBtn: null,
    // Audit Log
    auditLogPage: null,
    auditLogTableBody: null,
    auditLogPagination: null,
    auditUserFilter: null,
    auditActionFilter: null,
    auditDateFilter: null,
    auditFilterResetBtn: null,
    auditDetailsModal: null,
    auditDetailsBody: null,
    // Registratsiya so'rovlari
    pendingUsersList: null,
    requestsNavLink: null,
    requestsCountBadge: null,
    approvalModal: null,
    approvalForm: null,
    approvalUserIdInput: null,
    approvalUsernameSpan: null,
    approvalRoleSelect: null,
    approvalLocationsGroup: null,
    approvalLocationsCheckboxList: null,
    // Xavfsizlik sahifasi
    mySessionsList: null,
    securityPage: null,
    // Umumiy
    toast: null,
    adminPanelBtn: null,
    // Main page (index.html) report dashboard
    table: null,
    tableHead: null,
    tableBody: null,
    tableFoot: null,
    locationSelect: null,
    datePicker: null,
    datePickerEl: null,
    datePickerWrapper: null,
    filterDateRange: null,
    searchInput: null, // Qo'shildi
    reportFilterButtons: null, // Qo'shildi
    confirmBtn: null,
    editBtn: null,
    excelBtn: null,
    savedReportsList: null,
    paginationControls: null,
    reportIdBadge: null,
    newReportBtn: null,
    historyBtn: null,
    historyModal: null,
    historyModalBody: null,
    lateCommentModal: null,
    lateCommentForm: null,
    lateCommentInput: null,
};

function initDOM() {
    // populate DOM map; safe to call multiple times
    DOM.body = document.body;
    DOM.sidebarNav = document.querySelector('.sidebar-nav');
    DOM.pages = document.querySelectorAll('.page');
    DOM.logoutBtn = document.getElementById('logout-btn');
    DOM.brandLogos = document.querySelectorAll('.brand-logo');
    DOM.logoBorderEffects = document.querySelectorAll('.logo-border-effect');

    // Dashboard
    DOM.statsGrid = document.getElementById('stats-grid');
    DOM.dailyStatusGrid = document.getElementById('daily-status-grid');
    DOM.dashboardDatePicker = document.getElementById('dashboard-date-picker');
    DOM.dashboardSelectedDate = document.getElementById('dashboard-selected-date');
    DOM.weeklyChartCanvas = document.getElementById('weekly-dynamics-chart');
    DOM.customizeStatsBtn = document.getElementById('customize-stats-btn');
    DOM.statsConfigModal = document.getElementById('stats-config-modal');
    DOM.statsOptionsGrid = document.getElementById('stats-options-grid');
    DOM.saveStatsConfigBtn = document.getElementById('save-stats-config-btn');

    // Users
    DOM.usersPage = document.getElementById('users');
    DOM.userListContainer = document.getElementById('user-list-container');
    DOM.userTabs = document.getElementById('user-tabs');
    DOM.openAddUserModalBtn = document.getElementById('open-add-user-modal-btn');
    DOM.userFormModal = document.getElementById('user-form-modal');
    DOM.userForm = document.getElementById('user-form');
    DOM.userModalTitle = document.getElementById('user-modal-title');
    DOM.editUserIdInput = document.getElementById('edit-user-id');
    DOM.usernameInput = document.getElementById('user-username');
    DOM.fullnameInput = document.getElementById('user-fullname');
    DOM.passwordInput = document.getElementById('user-password');
    DOM.passwordGroup = document.getElementById('password-group');
    DOM.userRoleSelect = document.getElementById('user-role');
    DOM.deviceLimitInput = document.getElementById('user-device-limit');
    DOM.userLocationsGroup = document.getElementById('user-locations-group');
    DOM.locationsCheckboxList = document.getElementById('locations-checkbox-list');
    DOM.userSettingsGroup = document.getElementById('user-settings-group');
    DOM.userRequiresLocations = document.getElementById('user-requires-locations');
    DOM.userRequiresBrands = document.getElementById('user-requires-brands');
    DOM.userBrandsGroup = document.getElementById('user-brands-group');

    // KPI
    DOM.employeeStatisticsPage = document.getElementById('employee-statistics');
    DOM.kpiMonthPicker = document.getElementById('kpi-month-picker');
    DOM.kpiTableBody = document.getElementById('kpi-table-body');
    DOM.employeeDetailsView = document.getElementById('employee-details-view');
    DOM.detailsViewTitle = document.getElementById('details-view-title');
    DOM.detailsCalendarGrid = document.getElementById('details-calendar-grid');
    DOM.backToKpiListBtn = document.getElementById('back-to-kpi-list-btn');

    // Credentials
    DOM.credentialsModal = document.getElementById('credentials-modal');
    DOM.credentialsForm = document.getElementById('credentials-form');
    DOM.credentialsModalTitle = document.getElementById('credentials-modal-title');
    DOM.credentialsUserIdInput = document.getElementById('credentials-user-id');
    DOM.credentialsInput = document.getElementById('credentials-input');
    DOM.credentialsInputLabel = document.getElementById('credentials-input-label');

    // Telegram
    DOM.telegramConnectModal = document.getElementById('telegram-connect-modal');
    DOM.telegramConnectLinkInput = document.getElementById('telegram-connect-link');
    DOM.copyTelegramLinkBtn = document.getElementById('copy-telegram-link-btn');

    // Sessions
    DOM.sessionsModal = document.getElementById('sessions-modal');
    DOM.sessionsModalTitle = document.getElementById('sessions-modal-title');
    DOM.sessionsListContainer = document.getElementById('sessions-list-container');

    // Roles
    DOM.rolesManagementContainer = document.getElementById('roles-management-container');
    DOM.rolesList = document.getElementById('roles-list');
    DOM.permissionsPanel = document.querySelector('.permissions-panel');
    DOM.currentRoleTitle = document.getElementById('current-role-title');
    DOM.permissionsGrid = document.getElementById('permissions-grid');
    DOM.saveRolePermissionsBtn = document.getElementById('save-role-permissions-btn');

    // Settings
    DOM.settingsPage = document.getElementById('settings');
    DOM.saveTableSettingsBtn = document.getElementById('save-table-settings-btn');
    DOM.saveTelegramBtn = document.getElementById('save-telegram-btn');
    DOM.botTokenInput = document.getElementById('bot-token');
    DOM.botUsernameInput = document.getElementById('bot-username');
    DOM.groupIdInput = document.getElementById('group-id');
    DOM.adminChatIdInput = document.getElementById('admin-chat-id');
    DOM.paginationLimitInput = document.getElementById('pagination-limit');
    DOM.saveGeneralSettingsBtn = document.getElementById('save-general-settings-btn');
    DOM.saveKpiSettingsBtn = document.getElementById('save-kpi-settings-btn');
    DOM.latePenaltyInput = document.getElementById('late-penalty-input');
    DOM.editPenaltyInput = document.getElementById('edit-penalty-input');
    DOM.createRoleSettingsBtn = document.getElementById('create-role-settings-btn');

    // Branding
    DOM.logoTextInput = document.getElementById('logo-text-input');
    DOM.logoColorPalette = document.getElementById('logo-color-palette');
    DOM.logoAnimationSelect = document.getElementById('logo-animation-select');
    DOM.logoBorderEffectSelect = document.getElementById('logo-border-effect-select');
    DOM.logoPreview = document.getElementById('logo-preview');
    DOM.logoPreviewContainer = document.getElementById('logo-preview-container');
    DOM.saveBrandingSettingsBtn = document.getElementById('save-branding-settings-btn');

    // Pivot
    DOM.pivotContainer = document.getElementById('pivot-container');
    DOM.pivotDateFilter = document.getElementById('pivot-date-filter');
    DOM.pivotCurrencySelect = document.getElementById('pivot-currency-select');
    DOM.saveTemplateModal = document.getElementById('save-template-modal');
    DOM.loadTemplateModal = document.getElementById('load-template-modal');
    DOM.confirmSaveTemplateBtn = document.getElementById('confirm-save-template-btn');
    DOM.templateNameInput = document.getElementById('template-name-input');
    DOM.templateIsPublicCheckbox = document.getElementById('template-is-public-checkbox');
    DOM.publicTemplateOption = document.getElementById('public-template-option');
    DOM.templatesListContainer = document.getElementById('templates-list-container');
    DOM.templatesPanel = document.getElementById('templates-panel');
    DOM.templatesTagList = document.getElementById('templates-tag-list');
    DOM.closeTemplatesPanelBtn = document.getElementById('close-templates-panel-btn');

    // Admin
    DOM.backupDbBtn = document.getElementById('backup-db-btn');
    DOM.restoreDbBtn = document.getElementById('restore-db-btn');
    DOM.clearSessionsBtn = document.getElementById('clear-sessions-btn');

    // Audit
    DOM.auditLogPage = document.getElementById('audit-log');
    DOM.auditLogTableBody = document.getElementById('audit-log-table-body');
    DOM.auditLogPagination = document.getElementById('audit-log-pagination');
    DOM.auditUserFilter = document.getElementById('audit-user-filter');
    DOM.auditActionFilter = document.getElementById('audit-action-filter');
    DOM.auditDateFilter = document.getElementById('audit-date-filter');
    DOM.auditFilterResetBtn = document.getElementById('audit-filter-reset-btn');
    DOM.auditDetailsModal = document.getElementById('audit-details-modal');
    DOM.auditDetailsBody = document.getElementById('audit-details-body');

    // Registrations
    DOM.pendingUsersList = document.getElementById('pending-users-list');
    DOM.requestsNavLink = document.querySelector('.nav-link[data-page="requests"]');
    DOM.requestsCountBadge = document.getElementById('requests-count-badge');
    DOM.approvalModal = document.getElementById('approval-modal');
    DOM.approvalForm = document.getElementById('approval-form');
    DOM.approvalUserIdInput = document.getElementById('approval-user-id');
    DOM.approvalUsernameSpan = document.getElementById('approval-username');
    DOM.approvalRoleSelect = document.getElementById('approval-role');
    DOM.approvalLocationsGroup = document.getElementById('approval-locations-group');
    DOM.approvalLocationsCheckboxList = document.getElementById('approval-locations-checkbox-list');

    // Security
    DOM.mySessionsList = document.getElementById('my-sessions-list');
    DOM.securityPage = document.getElementById('security');

    // Common
    DOM.toast = document.getElementById('toast-notification');
    DOM.adminPanelBtn = document.getElementById('admin-panel-btn');

    // Table / main dashboard elements used by legacy script
    DOM.table = document.getElementById('main-table');
    if (DOM.table) {
        DOM.tableHead = DOM.table.querySelector('thead');
        DOM.tableBody = DOM.table.querySelector('tbody');
        DOM.tableFoot = DOM.table.querySelector('tfoot');
    } else {
        DOM.tableHead = null;
        DOM.tableBody = null;
        DOM.tableFoot = null;
    }

    DOM.currencySelect = document.getElementById('currency-select');
    DOM.locationSelect = document.getElementById('location-select');
    DOM.datePicker = document.getElementById('date-picker');
    // legacy names expected by script.js
    DOM.datePickerEl = DOM.datePicker;
    // wrapper for validation classes; prefer closest flatpickr wrapper if present
    DOM.datePickerWrapper = DOM.datePickerEl ? (DOM.datePickerEl.closest('.flatpickr-wrapper') || DOM.datePickerEl.parentElement) : null;
    DOM.filterDateRange = document.getElementById('filter-date-range');
    DOM.searchInput = document.getElementById('search-input'); // Qo'shildi
    DOM.reportFilterButtons = document.getElementById('report-filter-buttons'); // Qo'shildi
    DOM.confirmBtn = document.getElementById('confirm-btn');
    DOM.editBtn = document.getElementById('edit-btn');
    DOM.excelBtn = document.getElementById('excel-btn');
    DOM.savedReportsList = document.getElementById('saved-reports-list');
    DOM.paginationControls = document.getElementById('pagination-controls');
    DOM.reportIdBadge = document.getElementById('report-id-badge');
    DOM.newReportBtn = document.getElementById('new-report-btn');
    DOM.historyBtn = document.getElementById('history-btn');
    DOM.historyModal = document.getElementById('history-modal');
    DOM.historyModalBody = document.getElementById('history-modal-body');
    DOM.lateCommentModal = document.getElementById('late-comment-modal');
    DOM.lateCommentForm = document.getElementById('late-comment-form');
    DOM.lateCommentInput = document.getElementById('late-comment-input');
}

// Auto-initialize when DOM is ready. Also expose early so legacy code can call init if needed.
if (typeof window !== 'undefined') {
    window.DOM = DOM;
    window.initDOM = initDOM;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initDOM());
    } else {
        // document already parsed
        initDOM();
    }
}
