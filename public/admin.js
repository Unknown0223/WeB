// Admin Panel - Modular Version
// Barcha modullarni import qilib, birlashtiramiz

import { state } from './modules/state.js';
import { DOM } from './modules/dom.js';
import { safeFetch, fetchCurrentUser, fetchSettings, fetchUsers, fetchPendingUsers, fetchRoles, logout } from './modules/api.js';
import { showToast, hasPermission, showPageLoader, hidePageLoader, updateLoaderType } from './modules/utils.js';
import { applyPermissions, navigateTo, handleNavigation } from './modules/navigation.js';
import { setupDashboard } from './modules/dashboard.js';
import { setupKpiPage, setupKpiEventListeners } from './modules/kpi.js';
import { loadBrands, setupBrandsEventListeners } from './modules/brands.js';
import { 
    renderUsersByStatus, 
    renderPendingUsers, 
    toggleLocationVisibilityForUserForm,
    toggleLocationVisibilityForApprovalForm,
    openUserModalForAdd,
    handleUserFormSubmit,
    handleUserActions,
    handlePendingUserActions,
    handleCredentialsFormSubmit,
    copyTelegramLink,
    submitUserApproval,
    handleSessionTermination,
    initModernUsersPage,
    initModernRequestsPage
} from './modules/users.js';
import { setupPivot, savePivotTemplate, handleTemplateActions, handleTemplateModalActions } from './modules/pivot.js';
import { setupComparison } from './modules/comparison.js';
import { renderRoles, handleRoleSelection, saveRolePermissions, handleBackupDb, handleClearSessions, initExportImport, setupAddNewRole } from './modules/roles.js';
import { 
    renderTableSettings,
    renderGeneralSettings,
    renderTelegramSettings,
    renderKpiSettings,
    openColumnModal,
    closeColumnModal,
    saveColumn,
    openRowModal,
    closeRowModal,
    saveRow,
    openLocationModal,
    closeLocationModal,
    saveLocation,
    saveTableSettings,
    handleTableSettingsActions,
    saveTelegramSettings,
    saveGeneralSettings,
    saveKpiSettings,
    createRoleFromSettings,
    toggleAccordion
} from './modules/settings.js';
import { setupAuditLogFilters, setupAuditPagination } from './modules/audit.js';
import { applyBranding, setupBrandingControls, saveBrandingSettings } from './modules/branding.js';
import { initializeUserPermissions } from './modules/userPermissions.js';
import { initRealTime } from './modules/realtime.js';
import { initEnhancedSecurity } from './modules/security.js';

document.addEventListener('DOMContentLoaded', async () => {
    await init();
});

async function init() {
    try {
        // Loader allaqachon ko'rsatilgan bo'lishi kerak (inline script orqali)
        // Lekin agar ko'rsatilmagan bo'lsa, darhol ko'rsatamiz
        const loader = document.getElementById('page-loader');
        if (loader && !loader.classList.contains('active')) {
            showPageLoader('Tizim yuklanmoqda...');
        }
        
        // Joriy foydalanuvchini olish
        state.currentUser = await fetchCurrentUser();
        if (!state.currentUser) {
            hidePageLoader();
            return;
        }
        
        applyPermissions();
        
        // Parallel ma'lumotlarni yuklash
        const dataSources = [
            { key: 'settings', fetch: fetchSettings, permission: 'settings:view' },
            { key: 'users', fetch: fetchUsers, permission: 'users:view' },
            { key: 'rolesData', fetch: fetchRoles, permission: 'roles:manage' },
            { key: 'pendingUsers', fetch: fetchPendingUsers, permission: 'users:edit' }
        ];
        
        const results = await Promise.all(dataSources.map(async ds => {
            if (hasPermission(state.currentUser, ds.permission)) {
                return await ds.fetch();
            }
            return null;
        }));

        results.forEach((data, index) => {
            const { key } = dataSources[index];
            if (data) {
                if (key === 'rolesData') {
                    state.roles = data.roles;
                    state.allPermissions = data.all_permissions;
                } else if (key === 'settings') {
                    state.settings = { ...state.settings, ...data };
                } else {
                    state[key] = data;
                }
            }
        });

        // AVVAL brending qo'llash (loader turi uchun)
        if (state.settings.branding_settings) {
            applyBranding(state.settings.branding_settings);
        } else {
            // Default loader sozlamalari
            const loaderText = 'Tizim yuklanmoqda...';
            const loaderType = 'spinner';
            
            const loaderTextElement = document.getElementById('loader-text');
            if (loaderTextElement) {
                loaderTextElement.textContent = loaderText;
            }
            updateLoaderType(loaderType);
        }
        
        // Komponentlarni render qilish
        renderAllComponents();
        
        // Event listener'larni o'rnatish
        setupEventListeners();
        
    // Feather ikonkalarini yangilash (agar kutubxona mavjud bo'lsa)
    if (window.feather) {
        feather.replace();
    }
        
        // Real-time funksiyalarni ishga tushirish
        initRealTime();
        
        // Dastlabki sahifaga o'tish (loader yashirilishini navigation ichida qilamiz)
        const initialPage = window.location.hash.substring(1) || 'dashboard';
        navigateTo(initialPage, true); // true = hideLoader after navigation
        
    } catch (error) {
        hidePageLoader();
        showToast("Sahifani yuklashda jiddiy xatolik yuz berdi.", true);
        console.error("Initialization Error:", error);
    }
}

function renderAllComponents() {
    if (hasPermission(state.currentUser, 'dashboard:view')) {
        setupDashboard();
        if (DOM.employeeStatisticsPage) {
            setupKpiPage();
        }
    }
    
    if (hasPermission(state.currentUser, 'users:view')) {
        initModernUsersPage(); // MODERN USERS
        if (hasPermission(state.currentUser, 'audit:view')) {
            setupAuditLogFilters();
        }
    }
    
    if (hasPermission(state.currentUser, 'users:edit')) {
        initModernRequestsPage(); // MODERN REQUESTS
    }
    
    if (hasPermission(state.currentUser, 'settings:view')) {
        renderTableSettings();
        renderGeneralSettings();
        renderTelegramSettings();
        renderKpiSettings();
        loadBrands();
        setupBrandsEventListeners();
    }
    
    if (hasPermission(state.currentUser, 'reports:view_all')) {
        setupPivot();
    }
    
    if (hasPermission(state.currentUser, 'comparison:view')) {
        setupComparison();
    }
    
    if (hasPermission(state.currentUser, 'roles:manage')) {
        renderRoles();
        initializeUserPermissions();
        setupAddNewRole();
    }
    
    if (hasPermission(state.currentUser, 'settings:edit_general')) {
        setupBrandingControls();
    }
    
    // Xavfsizlik va Sessiyalar bo'limi
    if (hasPermission(state.currentUser, 'roles:manage')) {
        initEnhancedSecurity();
    }
}

function setupEventListeners() {
    const addSafeListener = (element, event, handler) => {
        if (element) element.addEventListener(event, handler);
    };

    // Navigatsiya
    window.addEventListener('hashchange', () => navigateTo(window.location.hash.substring(1)));
    addSafeListener(DOM.sidebarNav, 'click', handleNavigation);
    addSafeListener(DOM.logoutBtn, 'click', logout);
    
    // Users bo'limi
    if (hasPermission(state.currentUser, 'users:view')) {
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
    
    // Pending users
    if (hasPermission(state.currentUser, 'users:edit')) {
        addSafeListener(DOM.pendingUsersList, 'click', handlePendingUserActions);
        addSafeListener(DOM.approvalForm, 'submit', submitUserApproval);
        addSafeListener(DOM.approvalRoleSelect, 'change', toggleLocationVisibilityForApprovalForm);
    }
    
    // Rollar
    if (hasPermission(state.currentUser, 'roles:manage')) {
        addSafeListener(DOM.rolesList, 'click', handleRoleSelection);
        addSafeListener(DOM.saveRolePermissionsBtn, 'click', saveRolePermissions);
        addSafeListener(DOM.backupDbBtn, 'click', handleBackupDb);
        addSafeListener(DOM.clearSessionsBtn, 'click', handleClearSessions);
    }
    
    // Sozlamalar
    if (hasPermission(state.currentUser, 'settings:view')) {
        addSafeListener(DOM.saveTableSettingsBtn, 'click', saveTableSettings);
        addSafeListener(DOM.settingsPage, 'click', handleTableSettingsActions);
        addSafeListener(DOM.saveTelegramBtn, 'click', saveTelegramSettings);
        addSafeListener(DOM.saveGeneralSettingsBtn, 'click', saveGeneralSettings);
        addSafeListener(DOM.saveKpiSettingsBtn, 'click', saveKpiSettings);
        addSafeListener(DOM.createRoleSettingsBtn, 'click', createRoleFromSettings);
        document.querySelectorAll('.accordion-header').forEach(header => 
            addSafeListener(header, 'click', toggleAccordion)
        );
        
        // Ustun modal
        addSafeListener(document.getElementById('add-column-btn'), 'click', () => openColumnModal());
        addSafeListener(document.getElementById('save-column-btn'), 'click', saveColumn);
        addSafeListener(document.getElementById('cancel-column-btn'), 'click', closeColumnModal);
        addSafeListener(document.getElementById('close-column-modal'), 'click', closeColumnModal);
        
        // Qator modal
        addSafeListener(document.getElementById('add-row-btn'), 'click', () => openRowModal());
        addSafeListener(document.getElementById('save-row-btn'), 'click', saveRow);
        addSafeListener(document.getElementById('cancel-row-btn'), 'click', closeRowModal);
        addSafeListener(document.getElementById('close-row-modal'), 'click', closeRowModal);
        
        // Filial modal
        addSafeListener(document.getElementById('add-location-btn'), 'click', () => openLocationModal());
        addSafeListener(document.getElementById('save-location-btn'), 'click', saveLocation);
        addSafeListener(document.getElementById('cancel-location-btn'), 'click', closeLocationModal);
        addSafeListener(document.getElementById('close-location-modal'), 'click', closeLocationModal);
        
        // Edit tugmalari (event delegation)
        addSafeListener(DOM.settingsPage, 'click', (e) => {
            const editBtn = e.target.closest('.edit-setting-btn');
            if (editBtn) {
                const name = editBtn.dataset.name;
                const container = editBtn.closest('.settings-list');
                if (container.id === 'columns-settings') {
                    openColumnModal(name);
                } else if (container.id === 'rows-settings') {
                    openRowModal(name);
                } else if (container.id === 'locations-settings') {
                    openLocationModal(name);
                }
            }
        });
    }
    
    // Brending
    if (hasPermission(state.currentUser, 'settings:edit_general')) {
        addSafeListener(DOM.saveBrandingSettingsBtn, 'click', saveBrandingSettings);
    }
    
    // Pivot
    if (hasPermission(state.currentUser, 'reports:view_all')) {
        addSafeListener(DOM.confirmSaveTemplateBtn, 'click', savePivotTemplate);
        addSafeListener(DOM.templatesTagList, 'click', handleTemplateActions);
        addSafeListener(DOM.templatesListContainer, 'click', handleTemplateModalActions);
        // Templates panel doimo ochiq turadi
    }
    
    // Export/Import to'liq database
    if (hasPermission(state.currentUser, 'roles:manage')) {
        initExportImport();
    }

    // KPI
    if (hasPermission(state.currentUser, 'dashboard:view')) {
        setupKpiEventListeners();
    }

    // Sessiyalar
    addSafeListener(DOM.sessionsModal, 'click', handleSessionTermination);
    addSafeListener(DOM.mySessionsList, 'click', handleSessionTermination);

    // Audit
    setupAuditPagination();

    // Modal yopish tugmalari
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        addSafeListener(btn, 'click', () => 
            document.getElementById(btn.dataset.target)?.classList.add('hidden')
        );
    });

    // Admin panel modal oynalarini tashqariga bosilganda yopish
    document.addEventListener('click', (e) => {
        // Faqat admin panel sahifasida ishlaydi
        if (!document.body.classList.contains('admin-layout')) return;
        
        // Barcha ochiq modal oynalarni tekshirish
        const openModals = document.querySelectorAll('.modal:not(.hidden)');
        
        if (openModals.length === 0) return;
        
        const clickedElement = e.target;
        
        // Agar bosilgan joy har qanday modal-content ichida bo'lsa, yopilmaydi
        if (clickedElement.closest('.modal-content')) {
            return;
        }
        
        // Barcha ochiq modal oynalarni tekshirish
        openModals.forEach(modal => {
            const modalContent = modal.querySelector('.modal-content');
            
            // Agar bosilgan joy modal oynaning o'zi bo'lsa (background) yoki tashqarisida bo'lsa, yopiladi
            if (clickedElement === modal || 
                (modal.contains(clickedElement) && modalContent && !modalContent.contains(clickedElement)) ||
                !modal.contains(clickedElement)) {
                modal.classList.add('hidden');
            }
        });
    });

    // Parol ko'rish/yashirish tugmasi
    document.body.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.toggle-visibility-btn');
        if (!toggleBtn) return;

        const wrapper = toggleBtn.closest('.secure-input-wrapper');
        const input = wrapper?.querySelector('input');
        if (!input) return;

        const icon = toggleBtn.querySelector('i');

        if (input.type === 'password') {
            input.type = 'text';
            // Feather ikonkasi bo'lsa
            if (icon) {
                icon.setAttribute('data-feather', 'eye-off');
            } else {
                // Emoji / matnli tugma bo'lsa
                toggleBtn.textContent = '🙈';
            }
        } else {
            input.type = 'password';
            if (icon) {
                icon.setAttribute('data-feather', 'eye');
            } else {
                toggleBtn.textContent = '👁';
            }
        }

        if (window.feather) {
            feather.replace();
        }
    });
}
