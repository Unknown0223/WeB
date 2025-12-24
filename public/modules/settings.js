// Settings Module
// Barcha sozlamalar (table, telegram, general, kpi, branding)

import { state } from './state.js';
import { DOM } from './dom.js';
import { safeFetch } from './api.js';
import { showToast, showConfirmDialog } from './utils.js';

export function renderTableSettings() {
    const { columns = [], locations = [] } = state.settings.app_settings || {};
    
    // Zamonaviy card-style render
    const renderModernList = (containerId, items, emptyText, icon = '📋') => {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        // Ustunlar, Brendlar, Filiallar uchun grid ko'rinish va scroll
        const gridContainers = ['columns-settings', 'brands-settings', 'locations-settings'];
        if (gridContainers.includes(containerId)) {
            container.classList.add('settings-grid');
        } else {
            container.classList.remove('settings-grid');
        }
        
        if (items.length === 0) {
            container.innerHTML = `<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">${emptyText}</p>`;
            return;
        }
        
        container.innerHTML = items.map((item, index) => `
            <div class="modern-setting-item" data-name="${item}" style="
                background: linear-gradient(135deg, rgba(79, 172, 254, 0.1), rgba(0, 242, 254, 0.05));
                border: 1px solid rgba(79, 172, 254, 0.2);
                border-radius: 8px;
                padding: 12px 15px;
                margin-bottom: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                transition: all 0.2s;
                animation: slideIn 0.3s ease ${index * 0.05}s both;
            ">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 18px;">${icon}</span>
                    <span class="setting-name" style="font-weight: 500; font-size: 14px;">${item}</span>
                </div>
                <div style="display: flex; gap: 5px;">
                    <button class="btn-icon edit-setting-btn" data-name="${item}" title="Tahrirlash" aria-label="Tahrirlash">
                        ✏️
                    </button>
                    <button class="delete-item-btn btn-icon" data-name="${item}" title="O'chirish" aria-label="O'chirish">
                        🗑️
                    </button>
                </div>
            </div>
        `).join('');
    };
    
    renderModernList('columns-settings', columns, 'Ustunlar yo\'q', '📊');
    renderModernList('locations-settings', locations, 'Filiallar yo\'q', '📍');
    
    // Foydalanuvchilar uchun filiallar ro'yxati
    if (DOM.locationsCheckboxList) {
        DOM.locationsCheckboxList.innerHTML = locations.map(loc => `
            <label class="checkbox-item">
                <input type="checkbox" name="user-locations" value="${loc}">
                <span>${loc}</span>
            </label>
        `).join('');
    }
    
    if (DOM.approvalLocationsCheckboxList) {
        DOM.approvalLocationsCheckboxList.innerHTML = locations.map(loc => `
            <label class="checkbox-item">
                <input type="checkbox" name="approval-locations" value="${loc}">
                <span>${loc}</span>
            </label>
        `).join('');
    }

    if (window.feather) {
        feather.replace();
    }
}

export function renderGeneralSettings() {
    if (DOM.paginationLimitInput) {
        DOM.paginationLimitInput.value = state.settings.pagination_limit || 20;
    }
}

export function renderTelegramSettings() {
    // Telegram aktiv/neaktiv holatini ko'rsatish
    const telegramEnabled = state.settings.telegram_enabled === 'true' || state.settings.telegram_enabled === true;
    if (DOM.telegramEnabledToggle) {
        DOM.telegramEnabledToggle.checked = telegramEnabled;
    }
    
    // Telegram sozlamalarini ko'rsatish
    if (DOM.botTokenInput) DOM.botTokenInput.value = state.settings.telegram_bot_token || '';
    if (DOM.botUsernameInput) DOM.botUsernameInput.value = state.settings.telegram_bot_username || '';
    if (DOM.groupIdInput) DOM.groupIdInput.value = state.settings.telegram_group_id || '';
    if (DOM.adminChatIdInput) DOM.adminChatIdInput.value = state.settings.telegram_admin_chat_id || '';
}

export async function renderKpiSettings() {
    const kpiSettings = state.settings.kpi_settings || { latePenalty: 0.5, editPenalty: 0.3, roleFilter: [] };
    if (DOM.latePenaltyInput) DOM.latePenaltyInput.value = kpiSettings.latePenalty;
    if (DOM.editPenaltyInput) DOM.editPenaltyInput.value = kpiSettings.editPenalty;
    
    // Rol tanlash knopkasini yangilash
    updateKpiRoleButton(kpiSettings.roleFilter || []);
    
    // Rol tanlash knopkasi event listener
    const roleSelectBtn = document.getElementById('kpi-role-select-btn');
    if (roleSelectBtn) {
        roleSelectBtn.onclick = () => openKpiRoleSelectModal();
    }
    
    // Modal event listenerlar
    setupKpiRoleModalListeners();
    
    // Feather iconlarni yangilash
    setTimeout(() => {
        if (typeof feather !== 'undefined') feather.replace();
    }, 100);
}

// Rol tanlash knopkasini yangilash
function updateKpiRoleButton(selectedRoles) {
    const btn = document.getElementById('kpi-role-select-btn');
    const textSpan = document.getElementById('kpi-role-select-text');
    const countSpan = document.getElementById('kpi-role-select-count');
    const hiddenInput = document.getElementById('kpi-settings-role-filter');
    
    if (!btn || !textSpan || !countSpan || !hiddenInput) return;
    
    // Hidden inputni yangilash
    hiddenInput.value = JSON.stringify(selectedRoles);
    
    if (selectedRoles.length === 0) {
        textSpan.textContent = 'Rollarni tanlang';
        countSpan.style.display = 'none';
    } else if (selectedRoles.length === 1) {
        textSpan.textContent = selectedRoles[0];
        countSpan.style.display = 'none';
    } else {
        textSpan.textContent = `${selectedRoles.length} ta rol tanlangan`;
        countSpan.textContent = selectedRoles.length;
        countSpan.style.display = 'inline-block';
    }
}

// Rol tanlash modalini ochish
async function openKpiRoleSelectModal() {
    const modal = document.getElementById('kpi-role-select-modal');
    const roleList = document.getElementById('kpi-role-list');
    const kpiSettings = state.settings.kpi_settings || { roleFilter: [] };
    const selectedRoles = kpiSettings.roleFilter || [];
    
    if (!modal || !roleList) return;
    
    try {
        const res = await safeFetch('/api/roles');
        if (!res || !res.ok) throw new Error('Rollarni yuklab bo\'lmadi');
        
        const data = await res.json();
        const roles = data.roles || [];
        const uniqueRoles = [...new Set(roles.map(r => r.role_name))].sort();
        
        // Rol ro'yxatini yaratish
        roleList.innerHTML = '';
        uniqueRoles.forEach(role => {
            const isSelected = selectedRoles.includes(role);
            const roleItem = document.createElement('div');
            roleItem.className = 'kpi-role-item' + (isSelected ? ' selected' : '');
            roleItem.dataset.role = role;
            roleItem.innerHTML = `
                <div class="kpi-role-checkbox">
                    <i data-feather="${isSelected ? 'check-square' : 'square'}" style="width: 20px; height: 20px;"></i>
                </div>
                <span class="kpi-role-name">${role}</span>
            `;
            roleItem.onclick = () => toggleKpiRole(role, roleItem);
            roleList.appendChild(roleItem);
        });
        
        // Modalni ochish
        modal.classList.remove('hidden');
        
        // Feather iconlarni yangilash
        setTimeout(() => {
            if (typeof feather !== 'undefined') feather.replace();
        }, 100);
    } catch (error) {
        console.error('Rollarni yuklashda xatolik:', error);
        showToast('Rollarni yuklab bo\'lmadi', 'error');
    }
}

// Modalni yopish va tanlovlarni qayta tiklash
function closeKpiRoleModal() {
    const modal = document.getElementById('kpi-role-select-modal');
    if (modal) {
        modal.classList.add('hidden');
        // Tanlovlarni qayta yuklash (bekor qilingan o'zgarishlarni bekor qilish)
        const kpiSettings = state.settings.kpi_settings || { roleFilter: [] };
        const selectedRoles = kpiSettings.roleFilter || [];
        const roleList = document.getElementById('kpi-role-list');
        if (roleList) {
            roleList.querySelectorAll('.kpi-role-item').forEach(item => {
                const role = item.dataset.role;
                const isSelected = selectedRoles.includes(role);
                if (isSelected) {
                    item.classList.add('selected');
                } else {
                    item.classList.remove('selected');
                }
                const icon = item.querySelector('i[data-feather]');
                if (icon) {
                    icon.setAttribute('data-feather', isSelected ? 'check-square' : 'square');
                }
            });
            if (typeof feather !== 'undefined') feather.replace();
        }
    }
}

// Rol tanlash/yechish
function toggleKpiRole(role, element) {
    const isSelected = element.classList.contains('selected');
    
    if (isSelected) {
        element.classList.remove('selected');
    } else {
        element.classList.add('selected');
    }
    
    // Iconni yangilash
    const icon = element.querySelector('i[data-feather]');
    if (icon) {
        icon.setAttribute('data-feather', element.classList.contains('selected') ? 'check-square' : 'square');
        if (typeof feather !== 'undefined') feather.replace();
    }
}

// Modal event listenerlarini sozlash
function setupKpiRoleModalListeners() {
    const modal = document.getElementById('kpi-role-select-modal');
    const cancelBtn = document.getElementById('kpi-role-modal-cancel');
    const saveBtn = document.getElementById('kpi-role-modal-save');
    const closeBtn = modal?.querySelector('.close-modal-btn');
    
    // Bekor qilish
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            closeKpiRoleModal();
        };
    }
    
    // Yopish
    if (closeBtn) {
        closeBtn.onclick = () => {
            closeKpiRoleModal();
        };
    }
    
    // Saqlash
    if (saveBtn) {
        saveBtn.onclick = () => {
            const roleList = document.getElementById('kpi-role-list');
            if (!roleList) return;
            
            const selectedRoles = Array.from(roleList.querySelectorAll('.kpi-role-item.selected'))
                .map(item => item.dataset.role)
                .filter(Boolean);
            
            // State yangilash
            if (!state.settings.kpi_settings) {
                state.settings.kpi_settings = {};
            }
            state.settings.kpi_settings.roleFilter = selectedRoles;
            
            // Knopkani yangilash
            updateKpiRoleButton(selectedRoles);
            
            // Modalni yopish
            if (modal) modal.classList.add('hidden');
            
            showToast('Rollar tanlovi saqlandi. KPI sozlamalarini saqlashni unutmang!', 'success');
        };
    }
    
    // Modal tashqarisiga bosilganda yopish
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) {
                closeKpiRoleModal();
            }
        };
    }
}

export async function saveTableSettings() {
    const newSettings = { columns: [], locations: [] };
    document.querySelectorAll('#columns-settings .setting-name').forEach(span => 
        newSettings.columns.push(span.textContent)
    );
    document.querySelectorAll('#locations-settings .setting-name').forEach(span => 
        newSettings.locations.push(span.textContent)
    );
    
    try {
        const res = await safeFetch('/api/settings', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ key: 'app_settings', value: newSettings }) 
        });
        if (!res || !res.ok) throw new Error((await res.json()).message);
        
        showToast("Jadval sozlamalari saqlandi!");
        state.settings.app_settings = newSettings;
        renderTableSettings();
    } catch (error) { 
        showToast(error.message, true); 
    }
}

export async function handleTableSettingsActions(e) {
    const button = e.target.closest('button');
    if (!button) return;
    
    // O'chirish tugmasi
    if (button.classList.contains('delete-item-btn')) {
        const name = button.dataset.name;
        const container = button.closest('.settings-list');
        
        const confirmed = await showConfirmDialog({
            title: '🗑️ O\'chirish',
            message: `"${name}" ni o'chirmoqchimisiz?`,
            confirmText: 'O\'chirish',
            cancelText: 'Bekor qilish',
            type: 'warning',
            icon: 'trash-2'
        });
        
        if (!confirmed) return;
        
        if (container.id === 'columns-settings') {
            const { columns = [] } = state.settings.app_settings || {};
            const index = columns.indexOf(name);
            if (index !== -1) {
                columns.splice(index, 1);
                await saveAppSettings({ ...state.settings.app_settings, columns });
            }
        // rows-settings bo'limi olib tashlandi
        } else if (container.id === 'locations-settings') {
            const { locations = [] } = state.settings.app_settings || {};
            const index = locations.indexOf(name);
            if (index !== -1) {
                locations.splice(index, 1);
                await saveAppSettings({ ...state.settings.app_settings, locations });
            }
        }
        return;
    }
}

// Takrorlanishni oldini olish uchun flag
let isSavingTelegramSettings = false;

export async function saveTelegramSettings() {
    // Agar allaqachon saqlanmoqda bo'lsa, qayta chaqirmaslik
    if (isSavingTelegramSettings) {
        return;
    }
    
    // Telegram aktiv/neaktiv holatini saqlash
    const telegramEnabled = DOM.telegramEnabledToggle ? DOM.telegramEnabledToggle.checked : false;
    
    // Input elementlarini xavfsiz o'qish
    const botToken = DOM.botTokenInput ? DOM.botTokenInput.value.trim() : '';
    const botUsername = DOM.botUsernameInput ? DOM.botUsernameInput.value.trim() : '';
    const groupId = DOM.groupIdInput ? DOM.groupIdInput.value.trim() : '';
    const adminChatId = DOM.adminChatIdInput ? DOM.adminChatIdInput.value.trim() : '';
    
    const settingsToSave = [
        { key: 'telegram_enabled', value: telegramEnabled ? 'true' : 'false' },
        { key: 'telegram_bot_token', value: botToken },
        { key: 'telegram_bot_username', value: botUsername },
        { key: 'telegram_group_id', value: groupId },
        { key: 'telegram_admin_chat_id', value: adminChatId }
    ];
    
    try {
        isSavingTelegramSettings = true;
        
        // Save button'ni disable qilish
        if (DOM.saveTelegramBtn) {
            DOM.saveTelegramBtn.disabled = true;
            const originalText = DOM.saveTelegramBtn.innerHTML;
            DOM.saveTelegramBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saqlanmoqda...';
            
            try {
                for (const setting of settingsToSave) {
                    // Bo'sh string'lar ham yuborilishi mumkin (tozalash uchun)
                    const res = await safeFetch('/api/settings', { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify(setting) 
                    });
                    if (!res || !res.ok) {
                        const errorData = await res.json().catch(() => ({ message: 'Noma\'lum xatolik' }));
                        throw new Error(errorData.message || 'Sozlamalarni saqlashda xatolik');
                    }
                }
                
                // State yangilash
                state.settings.telegram_enabled = telegramEnabled ? 'true' : 'false';
                state.settings.telegram_bot_token = botToken;
                state.settings.telegram_bot_username = botUsername;
                state.settings.telegram_group_id = groupId;
                state.settings.telegram_admin_chat_id = adminChatId;
                
                showToast("Telegram sozlamalari saqlandi!");
            } finally {
                // Button'ni qayta tiklash
                DOM.saveTelegramBtn.disabled = false;
                DOM.saveTelegramBtn.innerHTML = originalText;
            }
        } else {
            // Agar button topilmasa, oddiy saqlash
            for (const setting of settingsToSave) {
                const res = await safeFetch('/api/settings', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify(setting) 
                });
                if (!res || !res.ok) {
                    const errorData = await res.json().catch(() => ({ message: 'Noma\'lum xatolik' }));
                    throw new Error(errorData.message || 'Sozlamalarni saqlashda xatolik');
                }
            }
            
            // State yangilash
            state.settings.telegram_enabled = telegramEnabled ? 'true' : 'false';
            state.settings.telegram_bot_token = botToken;
            state.settings.telegram_bot_username = botUsername;
            state.settings.telegram_group_id = groupId;
            state.settings.telegram_admin_chat_id = adminChatId;
            
            showToast("Telegram sozlamalari saqlandi!");
        }
    } catch (error) { 
        console.error('Telegram sozlamalarini saqlashda xatolik:', error);
        showToast(`Sozlamalarni saqlashda xatolik: ${error.message}`, true); 
    } finally {
        isSavingTelegramSettings = false;
    }
}

export async function saveGeneralSettings() {
    const limit = DOM.paginationLimitInput.value;
    
    try {
        const res = await safeFetch('/api/settings', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ key: 'pagination_limit', value: limit }) 
        });
        if (!res || !res.ok) throw new Error((await res.json()).message);
        showToast("Umumiy sozlamalar saqlandi!");
    } catch (error) { 
        showToast(error.message, true); 
    }
}

export async function saveKpiSettings() {
    if (!DOM.latePenaltyInput || !DOM.editPenaltyInput) {
        return;
    }

    const latePenalty = parseFloat(DOM.latePenaltyInput.value);
    const editPenalty = parseFloat(DOM.editPenaltyInput.value);

    if (isNaN(latePenalty) || isNaN(editPenalty)) {
        showToast("Iltimos, barcha maydonlarni to'ldiring", 'error');
        return;
    }

    if (latePenalty < 0 || latePenalty > 1 || editPenalty < 0 || editPenalty > 1) {
        showToast("Qiymatlar 0 dan 1 gacha bo'lishi kerak", 'error');
        return;
    }

    // Rol filtri
    const roleFilterInput = document.getElementById('kpi-settings-role-filter');
    let roleFilter = [];
    if (roleFilterInput && roleFilterInput.value) {
        try {
            roleFilter = JSON.parse(roleFilterInput.value);
        } catch (e) {
            roleFilter = [];
        }
    }

    const settings = {
        latePenalty: latePenalty,
        editPenalty: editPenalty,
        roleFilter: roleFilter
    };

    try {
        const res = await safeFetch('/api/settings', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ key: 'kpi_settings', value: settings }) 
        });
        if (!res || !res.ok) {
            const errorData = await res.json().catch(() => ({ message: 'Xatolik yuz berdi' }));
            throw new Error(errorData.message);
        }
        showToast("KPI sozlamalari muvaffaqiyatli saqlandi!");
        state.settings.kpi_settings = settings;
    } catch (error) { 
        showToast(error.message, 'error'); 
    }
}

export async function createRoleFromSettings() {
    const roleNameInput = document.getElementById('new-role-name-settings');
    const requiresLocationsCheckbox = document.getElementById('new-role-requires-locations-settings');
    const requiresBrandsCheckbox = document.getElementById('new-role-requires-brands-settings');
    const createBtn = document.getElementById('create-role-settings-btn');
    
    if (!roleNameInput || !requiresLocationsCheckbox || !requiresBrandsCheckbox || !createBtn) {
        return;
    }
    
    const roleName = roleNameInput.value.trim().toLowerCase();
    const requiresLocations = requiresLocationsCheckbox.checked;
    const requiresBrands = requiresBrandsCheckbox.checked;
    
    // Validation
    if (!roleName) {
        showToast('Rol nomini kiriting!', 'error');
        roleNameInput.focus();
        return;
    }
    
    if (!/^[a-z_]+$/.test(roleName)) {
        showToast('Rol nomida faqat lotin harflari va pastki chiziq (_) bo\'lishi mumkin!', 'error');
        roleNameInput.focus();
        return;
    }
    
    createBtn.disabled = true;
    createBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Yaratilmoqda...';
    
    try {
        const response = await safeFetch('/api/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                role_name: roleName,
                requires_locations: requiresLocations,
                requires_brands: requiresBrands
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Xatolik yuz berdi' }));
            throw new Error(errorData.message);
        }
        
        showToast('Yangi rol muvaffaqiyatli yaratildi!', 'success');
        
        // Clear form
        roleNameInput.value = '';
        requiresLocationsCheckbox.checked = false;
        requiresBrandsCheckbox.checked = false;
        
        // Reload roles if roles module is loaded
        if (window.loadRoles) {
            await window.loadRoles();
        }
        
    } catch (error) {
        showToast(error.message || 'Rol yaratishda xatolik!', 'error');
    } finally {
        createBtn.disabled = false;
        createBtn.innerHTML = '<i data-feather="plus"></i> Rol Qo\'shish';
        if (window.feather) {
            feather.replace();
        }
    }
}

export function toggleAccordion(e) {
    const item = e.target.closest('.accordion-item');
    if (!item) return;
    item.classList.toggle('active');
}

// ========== USTUN MODAL ==========
let editingColumn = null;

export function openColumnModal(columnName = null) {
    editingColumn = columnName;
    const modal = document.getElementById('column-modal');
    const title = document.getElementById('column-modal-title');
    const input = document.getElementById('column-name-input');
    
    if (columnName) {
        title.textContent = 'Ustunni Tahrirlash';
        input.value = columnName;
    } else {
        title.textContent = 'Yangi Ustun';
        input.value = '';
    }
    
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
    feather.replace();
}

export function closeColumnModal() {
    document.getElementById('column-modal').classList.add('hidden');
    editingColumn = null;
}

export async function saveColumn() {
    const input = document.getElementById('column-name-input');
    const newName = input.value.trim();
    
    if (!newName) {
        showToast('Ustun nomini kiriting', 'error');
        return;
    }
    
    const { columns = [] } = state.settings.app_settings || {};
    
    if (editingColumn) {
        // Tahrirlash
        const index = columns.indexOf(editingColumn);
        if (index !== -1) {
            columns[index] = newName;
        }
    } else {
        // Yangi qo'shish
        if (columns.includes(newName)) {
            showToast('Bunday ustun allaqachon mavjud', 'error');
            return;
        }
        columns.push(newName);
    }
    
    await saveAppSettings({ ...state.settings.app_settings, columns });
    closeColumnModal();
}

// ========== QATOR MODAL ==========
let editingRow = null;

export function openRowModal(rowName = null) {
    editingRow = rowName;
    const modal = document.getElementById('row-modal');
    const title = document.getElementById('row-modal-title');
    const input = document.getElementById('row-name-input');
    
    if (rowName) {
        title.textContent = 'Qatorni Tahrirlash';
        input.value = rowName;
    } else {
        title.textContent = 'Yangi Qator';
        input.value = '';
    }
    
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
    feather.replace();
}

export function closeRowModal() {
    document.getElementById('row-modal').classList.add('hidden');
    editingRow = null;
}

export async function saveRow() {
    const input = document.getElementById('row-name-input');
    const newName = input.value.trim();
    
    if (!newName) {
        showToast('Qator nomini kiriting', 'error');
        return;
    }
    
    const { rows = [] } = state.settings.app_settings || {};
    
    if (editingRow) {
        // Tahrirlash
        const index = rows.indexOf(editingRow);
        if (index !== -1) {
            rows[index] = newName;
        }
    } else {
        // Yangi qo'shish
        if (rows.includes(newName)) {
            showToast('Bunday qator allaqachon mavjud', 'error');
            return;
        }
        rows.push(newName);
    }
    
    await saveAppSettings({ ...state.settings.app_settings, rows });
    closeRowModal();
}

// ========== FILIAL MODAL ==========
let editingLocation = null;

export function openLocationModal(locationName = null) {
    editingLocation = locationName;
    const modal = document.getElementById('location-modal');
    const title = document.getElementById('location-modal-title');
    const input = document.getElementById('location-name-input');
    
    if (locationName) {
        title.textContent = 'Filialni Tahrirlash';
        input.value = locationName;
    } else {
        title.textContent = 'Yangi Filial';
        input.value = '';
    }
    
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
    feather.replace();
}

export function closeLocationModal() {
    document.getElementById('location-modal').classList.add('hidden');
    editingLocation = null;
}

export async function saveLocation() {
    const input = document.getElementById('location-name-input');
    const newName = input.value.trim();
    
    if (!newName) {
        showToast('Filial nomini kiriting', 'error');
        return;
    }
    
    const { locations = [] } = state.settings.app_settings || {};
    
    if (editingLocation) {
        // Tahrirlash
        const index = locations.indexOf(editingLocation);
        if (index !== -1) {
            locations[index] = newName;
        }
    } else {
        // Yangi qo'shish
        if (locations.includes(newName)) {
            showToast('Bunday filial allaqachon mavjud', 'error');
            return;
        }
        locations.push(newName);
    }
    
    await saveAppSettings({ ...state.settings.app_settings, locations });
    closeLocationModal();
}

// Helper function
async function saveAppSettings(newSettings) {
    try {
        const res = await safeFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'app_settings', value: newSettings })
        });
        
        if (!res || !res.ok) {
            const error = await res.json();
            throw new Error(error.message);
        }
        
        state.settings.app_settings = newSettings;
        renderTableSettings();
        showToast('Saqlandi', 'success');
    } catch (error) {
        showToast(error.message || 'Xatolik', 'error');
    }
}
