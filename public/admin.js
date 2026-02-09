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
import { renderRoles, handleRoleSelection, saveRolePermissions, handleBackupDb, handleRestoreDb, handleClearSessions, initExportImport, setupAddNewRole, loadCategories } from './modules/roles.js';
import {
    renderTableSettings,
    renderGeneralSettings,
    renderTelegramSettings,
    renderFeedbackBotSettings,
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
    saveFeedbackBotSettings,
    saveGeneralSettings,
    saveKpiSettings,
    createRoleFromSettings,
    toggleAccordion
} from './modules/settings.js';
import { setupAuditLogFilters, setupAuditPagination } from './modules/audit.js';
import { applyBranding, setupBrandingControls, saveBrandingSettings } from './modules/appearance.js';
import { initializeUserPermissions } from './modules/userPermissions.js';
import { initRealTime } from './modules/realtime.js';
import { initEnhancedSecurity } from './modules/security.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Log levelni optimallashtirish (performance uchun)
    if (!localStorage.getItem('LOG_LEVEL')) {
        localStorage.setItem('LOG_LEVEL', 'warn'); // Faqat warn va error loglar
    }

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

        // AVVAL sessionStorage'dan branding cache'ni yuklash (tezroq)
        try {
            const cachedBranding = sessionStorage.getItem('branding_settings_cache');
            if (cachedBranding) {
                const branding = JSON.parse(cachedBranding);
                if (branding && branding.loader) {
                    // Loader sozlamalarini darhol qo'llash
                    const loaderType = branding.loader.type || 'spinner';
                    const loaderText = branding.loader.text || 'Tizim yuklanmoqda...';
                    const showProgress = branding.loader.showProgress || false;
                    const blurBackground = branding.loader.blurBackground !== undefined ? branding.loader.blurBackground : true;

                    updateLoaderType(loaderType);
                    const loaderTextEl = document.getElementById('loader-text');
                    if (loaderTextEl) loaderTextEl.textContent = loaderText;

                    const loaderProgress = document.getElementById('loader-progress');
                    if (loaderProgress) loaderProgress.style.display = showProgress ? 'block' : 'none';

                    const pageLoader = document.getElementById('page-loader');
                    if (pageLoader) {
                        if (blurBackground) {
                            pageLoader.classList.add('blur-background');
                        } else {
                            pageLoader.classList.remove('blur-background');
                        }
                    }
                }
            }
        } catch (e) {
            // Cache xatolikni e'tiborsiz qoldirish
        }

        // Joriy foydalanuvchini olish
        state.currentUser = await fetchCurrentUser();
        if (!state.currentUser) {
            hidePageLoader();
            return;
        }

        applyPermissions();

        // Tema yuklash
        await loadAdminTheme();

        // Admin user info yangilash
        updateAdminUserInfo();

        // Settings'ni AVVAL yuklash (branding uchun)
        const settingsPromise = hasPermission(state.currentUser, 'settings:view')
            ? fetchSettings()
            : Promise.resolve(null);

        // Parallel ma'lumotlarni yuklash (settings bilan birga)
        const dataSources = [
            { key: 'users', fetch: fetchUsers, permission: 'users:view' },
            { key: 'rolesData', fetch: fetchRoles, permission: 'roles:manage' },
            { key: 'pendingUsers', fetch: fetchPendingUsers, permission: 'users:edit' }
        ];

        const [settingsData, ...otherResults] = await Promise.all([
            settingsPromise,
            ...dataSources.map(async ds => {
                if (hasPermission(state.currentUser, ds.permission)) {
                    return await ds.fetch();
                }
                return null;
            })
        ]);

        // Settings'ni birinchi bo'lib qo'llash (branding uchun)
        if (settingsData) {
            state.settings = { ...state.settings, ...settingsData };

            // Branding sozlamalarini darhol qo'llash
            if (state.settings.branding_settings) {
                applyBranding(state.settings.branding_settings);
            }
        }

        // Qolgan ma'lumotlarni qayta ishlash
        otherResults.forEach((data, index) => {
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

        // Agar branding hali qo'llanmagan bo'lsa, default qo'llash
        if (!state.settings.branding_settings) {
            const loaderText = 'Tizim yuklanmoqda...';
            const loaderType = 'spinner';

            const loaderTextElement = document.getElementById('loader-text');
            if (loaderTextElement) {
                loaderTextElement.textContent = loaderText;
            }
            updateLoaderType(loaderType);
        }

        // Komponentlarni render qilish
        await renderAllComponents();

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

async function renderAllComponents() {
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
        renderFeedbackBotSettings();
        renderKpiSettings();
        loadBrands();
        setupBrandsEventListeners();
    }

    if (hasPermission(state.currentUser, 'reports:view_all')) {
        setupPivot();
    }

    if (hasPermission(state.currentUser, 'comparison:view')) {
        await setupComparison();
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

    // Debt-approval bo'limi - barcha tegishli permission'ga ega foydalanuvchilar uchun
    const hasDebtPermission = hasPermission(state.currentUser, 'roles:manage') ||
        hasPermission(state.currentUser, 'debt:create') ||
        hasPermission(state.currentUser, 'debt:view_own') ||
        hasPermission(state.currentUser, 'debt:view_statistics') ||
        hasPermission(state.currentUser, 'debt:approve_cashier') ||
        hasPermission(state.currentUser, 'debt:approve_operator') ||
        hasPermission(state.currentUser, 'debt:approve_leader');

    if (hasDebtPermission) {
        (async () => {
            try {
                const { setupDebtApproval } = await import('./modules/debtApproval.js');
                setupDebtApproval();
            } catch (error) {
                console.error('Debt-approval modulini yuklashda xatolik:', error);
            }
        })();
    }
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

    // Sidebar nav link bosilganda mobil menyuni yopish
    addSafeListener(DOM.sidebarNav, 'click', (e) => {
        const link = e.target.closest('.nav-link');
        if (link && window.innerWidth <= 992) {
            closeMobileMenu();
        }
    });

    // Window resize - katta ekranda sidebar ochiq bo'lishi kerak
    window.addEventListener('resize', () => {
        if (window.innerWidth > 992) {
            closeMobileMenu();
        }
    });

    // Navigatsiya
    window.addEventListener('hashchange', () => navigateTo(window.location.hash.substring(1)));
    addSafeListener(DOM.sidebarNav, 'click', handleNavigation);
    addSafeListener(DOM.logoutBtn, 'click', logout);

    // Admin tema toggle
    const adminThemeToggleBtn = document.getElementById('admin-theme-toggle-btn');
    if (adminThemeToggleBtn) {
        addSafeListener(adminThemeToggleBtn, 'click', async (e) => {
            e.stopPropagation();
            await toggleAdminTheme();
        });
    }

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
        addSafeListener(DOM.restoreDbBtn, 'click', handleRestoreDb);
        addSafeListener(DOM.clearSessionsBtn, 'click', handleClearSessions);
    }

    // Sozlamalar
    if (hasPermission(state.currentUser, 'settings:view')) {
        addSafeListener(DOM.saveTableSettingsBtn, 'click', saveTableSettings);
        addSafeListener(DOM.settingsPage, 'click', handleTableSettingsActions);
        addSafeListener(DOM.saveTelegramBtn, 'click', saveTelegramSettings);
        addSafeListener(DOM.saveFeedbackBotBtn, 'click', saveFeedbackBotSettings);
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
        addSafeListener(btn, 'click', () => {
            const targetModal = document.getElementById(btn.dataset.target);
            if (targetModal) {
                targetModal.classList.add('hidden');

                // Bulk approval navbatini bekor qilish (approval-modal uchun)
                if (btn.dataset.target === 'approval-modal' && window.bulkApprovalQueue) {
                    console.log('⚠️ [BULK APPROVE] Modal close button bosildi, navbat tozalanmoqda');
                    window.bulkApprovalQueue = null;
                    window.bulkApprovalCurrentIndex = null;
                    window.bulkApprovalTotal = null;
                    // selectedRequests tozalash (agar mavjud bo'lsa)
                    if (typeof selectedRequests !== 'undefined' && selectedRequests.clear) {
                        selectedRequests.clear();
                        // updateRequestsBulkActions funksiyasini chaqirish (agar mavjud bo'lsa)
                        if (typeof updateRequestsBulkActions === 'function') {
                            updateRequestsBulkActions();
                        }
                    }
                }
            }
        });
    });

    // Admin panel modal oynalarini tashqariga bosilganda yopish
    document.addEventListener('click', (e) => {
        // Faqat admin panel sahifasida ishlaydi
        if (!document.body.classList.contains('admin-layout')) return;

        // Barcha ochiq modal oynalarni tekshirish
        const openModals = document.querySelectorAll('.modal:not(.hidden)');

        if (openModals.length === 0) return;

        const clickedElement = e.target;

        // Agar bosilgan joy har qanday modal-content yoki modal-dialog ichida bo'lsa, yopilmaydi
        if (clickedElement.closest('.modal-content') || clickedElement.closest('.modal-dialog')) {
            return;
        }

        // Barcha ochiq modal oynalarni tekshirish
        openModals.forEach(modal => {
            // Agar bosilgan joy modal oynaning o'zi bo'lsa (background), yopiladi
            if (clickedElement === modal) {
                modal.classList.add('hidden');
            }
        });
    });

    // Parol ko'rish/yashirish tugmasi
    document.body.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.toggle-visibility-btn');
        if (!toggleBtn) return;

        console.log('[ADMIN] Toggle button clicked');
        const wrapper = toggleBtn.closest('.secure-input-wrapper');
        if (!wrapper) {
            console.warn('[ADMIN] secure-input-wrapper topilmadi');
            return;
        }
        const input = wrapper.querySelector('input');
        if (!input) {
            console.warn('[ADMIN] Input topilmadi');
            return;
        }

        const icon = toggleBtn.querySelector('i');
        console.log('[ADMIN] Input type:', input.type, 'Icon:', icon ? 'mavjud' : 'yo\'q', 'Emoji:', !icon);

        if (input.type === 'password') {
            input.type = 'text';
            console.log('[ADMIN] Parol ko\'rsatildi');
            // Feather ikonkasi bo'lsa
            if (icon) {
                icon.setAttribute('data-feather', 'eye-off');
            } else {
                // Emoji / matnli tugma bo'lsa
                toggleBtn.textContent = '🙈';
            }
        } else {
            input.type = 'password';
            console.log('[ADMIN] Parol yashirildi');
            if (icon) {
                icon.setAttribute('data-feather', 'eye');
            } else {
                toggleBtn.textContent = '👁';
            }
        }

        if (window.feather) {
            feather.replace();
            console.log('[ADMIN] Feather icons yangilandi');
        } else {
            console.warn('[ADMIN] Feather mavjud emas');
        }
    });
}

// Admin tema funksiyalari
async function loadAdminTheme() {
    try {
        const res = await fetch('/api/users/me/theme');
        if (res.ok) {
            const data = await res.json();
            const theme = data.theme || 'dark';
            applyAdminTheme(theme);
            updateAdminThemeUI(theme);
        }
    } catch (error) {
        console.error('Admin tema yuklashda xatolik:', error);
        applyAdminTheme('dark');
    }
}

function applyAdminTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

function updateAdminThemeUI(theme) {
    const themeIcon = document.getElementById('admin-theme-icon');
    if (themeIcon) {
        themeIcon.setAttribute('data-feather', theme === 'dark' ? 'sun' : 'moon');
        feather.replace();
    }
}

async function toggleAdminTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    try {
        const res = await fetch('/api/users/me/theme', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ theme: newTheme })
        });

        if (res.ok) {
            applyAdminTheme(newTheme);
            updateAdminThemeUI(newTheme);
        } else {
            console.error('Admin tema saqlashda xatolik');
        }
    } catch (error) {
        console.error('Admin tema o\'zgartirishda xatolik:', error);
    }
}

function updateAdminUserInfo() {
    const usernameEl = document.getElementById('admin-username');
    const roleEl = document.getElementById('admin-user-role');
    const avatarEl = document.getElementById('admin-user-avatar');

    if (usernameEl && state.currentUser) {
        usernameEl.textContent = state.currentUser.username || 'Foydalanuvchi';
    }

    if (roleEl && state.currentUser) {
        roleEl.textContent = state.currentUser.role || '';
    }

    // Avatar yuklash
    if (avatarEl) {
        loadAdminAvatar();
    }
}

async function loadAdminAvatar() {
    try {
        const res = await fetch('/api/users/me/avatar');
        const avatarEl = document.getElementById('admin-user-avatar');

        if (res.ok && avatarEl) {
            const data = await res.json();
            if (data.avatar_url) {
                avatarEl.innerHTML = `<img src="${data.avatar_url}" alt="Avatar">`;
            } else {
                avatarEl.innerHTML = '<i data-feather="user"></i>';
                feather.replace();
            }
        }
    } catch (error) {
        console.error('Admin avatar yuklashda xatolik:', error);
    }
}

// Global feather replace funksiyasi
window.replaceFeatherIcons = function (root = document) {
    if (typeof window.feather !== 'undefined') {
        try {
            feather.replace({ root: root });
        } catch (error) {
            console.warn('Feather replace error:', error);
        }
    }
};
