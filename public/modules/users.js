// Users Module (MODERNIZED)
// Foydalanuvchilarni boshqarish (CRUD, sessions, credentials, telegram)

import { state } from './state.js';
import { DOM } from './dom.js';
import { safeFetch, fetchUsers, fetchPendingUsers, fetchPasswordChangeRequests } from './api.js';
import { showToast, parseUserAgent, showConfirmDialog, showReasonInputModal, hasPermission, createLogger, getUserFriendlyErrorMessage } from './utils.js';
import { getModal, openModal, closeModal } from './modal.js';

// Logger yaratish
const log = createLogger('USERS');

// Development mode tekshiruvi
const IS_DEVELOPMENT = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Optimallashtirilgan logger funksiyalari
const debugLog = (...args) => {
    if (IS_DEVELOPMENT) {
        log.debug(...args);
    }
};

const infoLog = (...args) => {
    log.info(...args);
};

const errorLog = (...args) => {
    log.error(...args);
    // Xatoliklar har doim ko'rinadi
};

// Umumiy xatolik handler
function handleError(error, context = 'Amal', showToUser = true) {
    errorLog(`${context} xatoligi:`, error);
    
    if (showToUser) {
        const friendlyMessage = getUserFriendlyErrorMessage(error);
        showToast(friendlyMessage, true);
    }
}

// Selected users for bulk actions
let selectedUsers = new Set();

// Current filters
let currentFilters = {
    search: '',
    role: '',
    accountStatus: '',  // active, pending, inactive
    onlineStatus: '',   // online, offline
    telegramStatus: ''  // connected, not_connected
};

// View mode (grid or list)
let currentViewMode = localStorage.getItem('usersViewMode') || 'grid';

// Pagination settings
let currentPage = 1;
let usersPerPage = parseInt(localStorage.getItem('usersPerPage')) || 10;

// Performance optimization: Cache and debounce
let renderDebounceTimer = null;
let filteredUsersCache = null;
let lastFiltersHash = '';

// ==================== HELPER FUNCTIONS (DRY Principle) ====================

/**
 * Modal yopish/ochish helper funksiyalari
 */
const ModalHelper = {
    show: (element) => {
        if (element) {
            element.classList.remove('hidden');
            if (element.style) element.style.display = '';
        }
    },
    hide: (element) => {
        if (element) {
            element.classList.add('hidden');
            if (element.style) element.style.display = 'none';
        }
    },
    toggle: (element) => {
        if (element) {
            element.classList.toggle('hidden');
        }
    }
};

/**
 * Element visibility helper funksiyalari
 */
const VisibilityHelper = {
    show: (element) => {
        if (element && element.style) {
            element.style.display = 'block';
        }
    },
    hide: (element) => {
        if (element && element.style) {
            element.style.display = 'none';
        }
    },
    toggle: (element, show = true) => {
        if (element && element.style) {
            element.style.display = show ? 'block' : 'none';
        }
    }
};

/**
 * API so'rovlar uchun helper funksiya (error handling bilan)
 */
async function safeApiCall(url, options = {}) {
    try {
        const res = await safeFetch(url, options);
        if (!res || !res.ok) {
            const errorData = res ? await res.json().catch(() => ({})) : {};
            throw new Error(errorData.message || 'API so\'rovida xatolik');
        }
        return await res.json();
    } catch (error) {
        errorLog(`API ${url} xatolik:`, error);
        throw error;
    }
}

/**
 * Foydalanuvchilar ro'yxatini yangilash helper funksiyasi
 */
async function refreshUsersList() {
    try {
        const usersRes = await fetchUsers();
        if (usersRes) {
            state.users = usersRes;
            filteredUsersCache = null; // Clear cache on data update
            lastFiltersHash = ''; // Reset hash
            const activeTab = DOM.userTabs?.querySelector('.active')?.dataset.status || 'active';
            if (activeTab) {
                currentFilters.accountStatus = activeTab === 'active' ? 'active' : 
                                               activeTab === 'pending' ? 'pending' : 
                                               activeTab === 'inactive' ? 'inactive' : '';
            }
            renderModernUsers(true); // Immediate render after data fetch
        }
    } catch (error) {
        log.error('Ro\'yxatni yangilashda xatolik:', error);
        showToast('Ro\'yxatni yangilashda xatolik', 'error');
    }
}

// Brendlarni yuklash va render qilish
// Filiallarni 2 blokli (yonma-yon) ko'rinishga yuklash
async function loadLocationsForUser(userId = null) {
    const attachedList = document.getElementById('locations-attached-list');
    const unattachedList = document.getElementById('locations-unattached-list');
    if (!attachedList || !unattachedList) {
        debugLog('Filiallar container\'lari topilmadi');
        return;
    }
    
    try {
        // Hozirgi tanlangan filiallarni olish
        let selectedLocations = [];
        if (userId) {
            const user = state.users.find(u => u.id == userId);
            if (user && user.locations) {
                selectedLocations = Array.isArray(user.locations) ? user.locations : [];
            }
        } else {
            // Attached list'dan tanlanganlarni olish
            selectedLocations = Array.from(attachedList.querySelectorAll('.location-item'))
                .map(item => item.dataset.location);
        }
        
        // Filiallarni yuklash - settings'dan
        const res = await safeFetch('/api/settings');
        if (!res || !res.ok) {
            throw new Error('Filiallarni yuklashda xatolik');
        }
        
        const settings = await res.json();
        
        // Filiallarni olish - app_settings.locations dan
        let allLocations = [];
        if (settings.app_settings?.locations && Array.isArray(settings.app_settings.locations)) {
            allLocations = settings.app_settings.locations;
        } else if (settings.locations) {
            if (Array.isArray(settings.locations)) {
                allLocations = settings.locations;
            } else if (typeof settings.locations === 'string') {
                try {
                    allLocations = JSON.parse(settings.locations);
                } catch (e) {
                    allLocations = [];
                }
            }
        }
        
        if (allLocations.length === 0) {
            showToast('Filiallar topilmadi. Sozlamalarni tekshiring.', true);
            attachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5);">Filiallar topilmadi</div>';
            unattachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5);">Filiallar topilmadi</div>';
            return;
        }
        
        // Filiallarni 2 guruhga ajratish
        const attachedLocations = allLocations.filter(loc => selectedLocations.includes(loc));
        const unattachedLocations = allLocations.filter(loc => !selectedLocations.includes(loc));
        
        // Grid column sonini aniqlash (10 tadan oshsa 3, kam bo'lsa 2)
        const totalLocations = allLocations.length;
        const gridColumns = totalLocations > 10 ? 3 : 2;
        
        // Grid style'ni o'rnatish
        attachedList.style.gridTemplateColumns = `repeat(${gridColumns}, 1fr)`;
        unattachedList.style.gridTemplateColumns = `repeat(${gridColumns}, 1fr)`;
        
        // Birinchi blok: Biriktirilgan filiallar
        if (attachedLocations.length === 0) {
            attachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px; grid-column: 1 / -1;">Filiallar tanlanmagan</div>';
        } else {
            attachedList.innerHTML = attachedLocations.map(location => `
                <div class="location-item" data-location="${location}" style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px;
                    border-radius: 6px;
                    background: rgba(79, 172, 254, 0.15);
                    border: 1px solid rgba(79, 172, 254, 0.3);
                    cursor: pointer;
                    transition: all 0.2s;
                " onclick="moveLocationToUnattached('${location}')" onmouseenter="this.style.background='rgba(79, 172, 254, 0.25)'" onmouseleave="this.style.background='rgba(79, 172, 254, 0.15)'">
                    <span style="font-size: 14px;">📍</span>
                    <span style="flex: 1; font-size: 13px; color: rgba(255,255,255,0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${location}</span>
                    <span style="font-size: 11px; color: rgba(79, 172, 254, 0.7);">→</span>
                </div>
            `).join('');
        }
        
        // Ikkinchi blok: Biriktirilmagan filiallar
        if (unattachedLocations.length === 0) {
            unattachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px; grid-column: 1 / -1;">Barcha filiallar biriktirilgan</div>';
        } else {
            unattachedList.innerHTML = unattachedLocations.map(location => `
                <div class="location-item" data-location="${location}" style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px;
                    border-radius: 6px;
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.1);
                    cursor: pointer;
                    transition: all 0.2s;
                " onclick="moveLocationToAttached('${location}')" onmouseenter="this.style.background='rgba(255,255,255,0.1)'" onmouseleave="this.style.background='rgba(255,255,255,0.05)'">
                    <span style="font-size: 14px;">📍</span>
                    <span style="flex: 1; font-size: 13px; color: rgba(255,255,255,0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${location}</span>
                    <span style="font-size: 11px; color: rgba(255,255,255,0.5);">←</span>
                </div>
            `).join('');
        }
        
        // Tanlangan filiallarni ko'rsatish (yuqoridagi display uchun)
        updateSelectedLocationsDisplay(attachedLocations);
        
        // "Barchasini belgilash" checkbox event listener'larni qo'shish
        setupSelectAllLocationsCheckboxes();
    } catch (error) {
        errorLog('Filiallarni yuklashda xatolik:', error);
        showToast('Filiallarni yuklashda xatolik yuz berdi. Qayta urinib ko\'ring.', true);
        attachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--red-color);">Xatolik yuz berdi</div>';
        unattachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--red-color);">Xatolik yuz berdi</div>';
    }
}

// Filiallar uchun "Barchasini belgilash" funksiyasi
function setupSelectAllLocationsCheckboxes() {
    // Biriktirilgan filiallar uchun
    const selectAllAttached = document.getElementById('select-all-attached-locations');
    if (selectAllAttached) {
        // Eski event listener'ni olib tashlash
        const newSelectAllAttached = selectAllAttached.cloneNode(true);
        selectAllAttached.parentNode.replaceChild(newSelectAllAttached, selectAllAttached);
        const attachedCheckbox = document.getElementById('select-all-attached-locations');
        
        attachedCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const attachedList = document.getElementById('locations-attached-list');
            if (!attachedList) return;
            
            const items = Array.from(attachedList.querySelectorAll('.location-item'));
            if (!isChecked && items.length > 0) {
                // Barchasini biriktirilmagan blokka o'tkazish (teskari tartibda, chunki har bir o'tkazish DOM'ni o'zgartiradi)
                const locations = items.map(item => item.dataset.location).filter(loc => loc).reverse();
                locations.forEach(location => {
                    moveLocationToUnattached(location);
                });
            }
        });
    }
    
    // Biriktirilmagan filiallar uchun
    const selectAllUnattached = document.getElementById('select-all-unattached-locations');
    if (selectAllUnattached) {
        // Eski event listener'ni olib tashlash
        const newSelectAllUnattached = selectAllUnattached.cloneNode(true);
        selectAllUnattached.parentNode.replaceChild(newSelectAllUnattached, selectAllUnattached);
        const unattachedCheckbox = document.getElementById('select-all-unattached-locations');
        
        unattachedCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const unattachedList = document.getElementById('locations-unattached-list');
            if (!unattachedList) return;
            
            if (isChecked) {
                // Barchasini biriktirilgan blokka o'tkazish (teskari tartibda, chunki har bir o'tkazish DOM'ni o'zgartiradi)
                const items = Array.from(unattachedList.querySelectorAll('.location-item'));
                const locations = items.map(item => item.dataset.location).filter(loc => loc).reverse();
                locations.forEach(location => {
                    moveLocationToAttached(location);
                });
            }
        });
    }
}

// Filialni biriktirilgan blokdan biriktirilmagan blokka o'tkazish
window.moveLocationToUnattached = function(location) {
    const attachedList = document.getElementById('locations-attached-list');
    const unattachedList = document.getElementById('locations-unattached-list');
    if (!attachedList || !unattachedList) return;
    
    // Elementni olib tashlash
    const item = attachedList.querySelector(`[data-location="${location}"]`);
    if (!item) return;
    
    item.remove();
    
    // Ikkinchi blokka qo'shish
    const newItem = document.createElement('div');
    newItem.className = 'location-item';
    newItem.dataset.location = location;
    newItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px;
        border-radius: 6px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer;
        transition: all 0.2s;
    `;
    newItem.innerHTML = `
        <span style="font-size: 14px;">📍</span>
        <span style="flex: 1; font-size: 13px; color: rgba(255,255,255,0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${location}</span>
        <span style="font-size: 11px; color: rgba(255,255,255,0.5);">←</span>
    `;
    newItem.onclick = () => moveLocationToAttached(location);
    newItem.onmouseenter = function() { this.style.background = 'rgba(255,255,255,0.1)'; };
    newItem.onmouseleave = function() { this.style.background = 'rgba(255,255,255,0.05)'; };
    
    unattachedList.appendChild(newItem);
    
    // Agar birinchi blok bo'sh bo'lsa, xabar ko'rsatish
    if (attachedList.children.length === 0) {
        attachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px;">Filiallar tanlanmagan</div>';
    }
    
    // Tanlangan filiallarni yangilash
    const selected = Array.from(attachedList.querySelectorAll('.location-item'))
        .map(item => item.dataset.location);
    updateSelectedLocationsDisplay(selected);
};

// Filialni biriktirilmagan blokdan biriktirilgan blokka o'tkazish
window.moveLocationToAttached = function(location) {
    const attachedList = document.getElementById('locations-attached-list');
    const unattachedList = document.getElementById('locations-unattached-list');
    if (!attachedList || !unattachedList) return;
    
    // Elementni olib tashlash
    const item = unattachedList.querySelector(`[data-location="${location}"]`);
    if (!item) return;
    
    item.remove();
    
    // Birinchi blokka qo'shish
    // Agar "Filiallar tanlanmagan" xabari bo'lsa, uni olib tashlash
    if (attachedList.querySelector('.empty-selection') || attachedList.textContent.includes('tanlanmagan')) {
        attachedList.innerHTML = '';
    }
    
    const newItem = document.createElement('div');
    newItem.className = 'location-item';
    newItem.dataset.location = location;
    newItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px;
        border-radius: 6px;
        background: rgba(79, 172, 254, 0.15);
        border: 1px solid rgba(79, 172, 254, 0.3);
        cursor: pointer;
        transition: all 0.2s;
    `;
    newItem.innerHTML = `
        <span style="font-size: 14px;">📍</span>
        <span style="flex: 1; font-size: 13px; color: rgba(255,255,255,0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${location}</span>
        <span style="font-size: 11px; color: rgba(79, 172, 254, 0.7);">→</span>
    `;
    newItem.onclick = () => moveLocationToUnattached(location);
    newItem.onmouseenter = function() { this.style.background = 'rgba(79, 172, 254, 0.25)'; };
    newItem.onmouseleave = function() { this.style.background = 'rgba(79, 172, 254, 0.15)'; };
    
    attachedList.appendChild(newItem);
    
    // Agar ikkinchi blok bo'sh bo'lsa, xabar ko'rsatish
    if (unattachedList.children.length === 0) {
        unattachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px;">Barcha filiallar biriktirilgan</div>';
    }
    
    // Tanlangan filiallarni yangilash
    const selected = Array.from(attachedList.querySelectorAll('.location-item'))
        .map(item => item.dataset.location);
    updateSelectedLocationsDisplay(selected);
};

async function loadBrandsForUser(userId = null) {
    const attachedList = document.getElementById('brands-attached-list');
    const unattachedList = document.getElementById('brands-unattached-list');
        
        // Approval modal uchun (approval-brands-list)
    if (!attachedList || !unattachedList) {
        const approvalContainer = document.getElementById('approval-brands-list');
        if (approvalContainer) {
            try {
            // Approval uchun barcha brendlarni olish (admin uchun)
            const res = await safeFetch('/api/brands');
                if (!res || !res.ok) {
                    throw new Error('Brendlarni yuklashda xatolik');
                }
            const allBrands = await res.json();
            
            if (allBrands.length === 0) {
                approvalContainer.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center;">Avval brendlar yarating</p>';
                return;
            }
            
            approvalContainer.innerHTML = allBrands.map(brand => {
                const brandEmoji = brand.emoji || '🏢';
                const brandColor = brand.color || '#4facfe';
                
                return `
                    <label class="checkbox-item brand-checkbox-label" style="
                        display: flex;
                        align-items: center;
                        padding: 8px;
                        border-radius: 6px;
                        cursor: pointer;
                        transition: background 0.2s;
                    ">
                        <input type="checkbox" name="approval-brand" value="${brand.id}" 
                            class="brand-checkbox" style="margin-right: 10px; width: 16px; height: 16px; cursor: pointer;">
                        <span style="font-size: 20px; margin-right: 8px;">${brandEmoji}</span>
                        <span style="font-size: 14px; color: ${brandColor};">${brand.name}</span>
                    </label>
                `;
            }).join('');
            } catch (error) {
                errorLog('Approval uchun brendlarni yuklashda xatolik:', error);
                approvalContainer.innerHTML = '<p style="color: var(--red-color); text-align: center;">Brendlarni yuklashda xatolik</p>';
            }
        }
        return;
    }
    
    try {
        // Hozirgi tanlangan brendlarni olish
        let selectedBrandIds = [];
        if (userId) {
            const userBrandsRes = await safeFetch(`/api/brands/user/${userId}`);
            if (userBrandsRes && userBrandsRes.ok) {
                const data = await userBrandsRes.json();
                const userBrands = data.brands || [];
                selectedBrandIds = userBrands.map(b => b.id);
            }
        } else {
            // Attached list'dan tanlanganlarni olish
            selectedBrandIds = Array.from(attachedList.querySelectorAll('.brand-item'))
                .map(item => parseInt(item.dataset.brandId));
        }
        
        // Hozirgi tanlangan filiallarni olish (agar filial tanlangan bo'lsa, faqat shu filialdagi brendlarni ko'rsatish)
        const attachedLocationsList = document.getElementById('locations-attached-list');
        const selectedLocations = attachedLocationsList ?
            Array.from(attachedLocationsList.querySelectorAll('.location-item'))
                .map(item => item.dataset.location) : [];
        
        // Brendlarni yuklash
        let brands = [];
        if (selectedLocations.length > 0 && selectedBrandIds.length === 0) {
            // Filial tanlangan, brend tanlanmagan - faqat tanlangan filiallardagi brendlarni olish
            const allBrandsMap = new Map();
            for (const location of selectedLocations) {
                try {
                    const res = await safeFetch(`/api/brands/by-location/${encodeURIComponent(location)}`);
                    if (res && res.ok) {
                        const locationBrands = await res.json();
                        locationBrands.forEach(brand => {
                            if (!allBrandsMap.has(brand.id)) {
                                allBrandsMap.set(brand.id, brand);
                            }
                        });
                    }
                } catch (err) {
                    debugLog(`Filial "${location}" uchun brendlar yuklanmadi:`, err);
                }
            }
            brands = Array.from(allBrandsMap.values());
        } else {
            // Barcha brendlarni olish
            const res = await safeFetch('/api/brands');
            if (!res || !res.ok) {
                throw new Error('Brendlarni yuklashda xatolik');
            }
            brands = await res.json();
        }
        
        if (brands.length === 0) {
            attachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px;">Brendlar topilmadi</div>';
            unattachedList.innerHTML = '';
            return;
        }
        
        // Brendlarni 2 guruhga ajratish
        const attachedBrands = brands.filter(b => selectedBrandIds.includes(b.id));
        const unattachedBrands = brands.filter(b => !selectedBrandIds.includes(b.id));
        
        // Grid column sonini aniqlash (10 tadan oshsa 3, kam bo'lsa 2)
        const totalBrands = brands.length;
        const gridColumns = totalBrands > 10 ? 3 : 2;
        
        // Grid style'ni o'rnatish
        attachedList.style.gridTemplateColumns = `repeat(${gridColumns}, 1fr)`;
        unattachedList.style.gridTemplateColumns = `repeat(${gridColumns}, 1fr)`;
        
        // Birinchi blok: Biriktirilgan brendlar
        if (attachedBrands.length === 0) {
            attachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px; grid-column: 1 / -1;">Brendlar tanlanmagan</div>';
        } else {
            attachedList.innerHTML = attachedBrands.map(brand => {
                const brandEmoji = brand.emoji || '🏢';
                const brandColor = brand.color || '#4facfe';
                return `
                    <div class="brand-item" data-brand-id="${brand.id}" style="
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 10px;
                        border-radius: 6px;
                        background: rgba(79, 172, 254, 0.15);
                        border: 1px solid rgba(79, 172, 254, 0.3);
                        cursor: pointer;
                        transition: all 0.2s;
                    " onclick="moveBrandToUnattached(${brand.id})" onmouseenter="this.style.background='rgba(79, 172, 254, 0.25)'" onmouseleave="this.style.background='rgba(79, 172, 254, 0.15)'">
                        <span style="font-size: 16px;">${brandEmoji}</span>
                        <span style="flex: 1; font-size: 13px; color: ${brandColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${brand.name}</span>
                        <span style="font-size: 11px; color: rgba(79, 172, 254, 0.7);">→</span>
                    </div>
                `;
            }).join('');
        }
        
        // Ikkinchi blok: Biriktirilmagan brendlar
        if (unattachedBrands.length === 0) {
            unattachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px; grid-column: 1 / -1;">Barcha brendlar biriktirilgan</div>';
        } else {
            unattachedList.innerHTML = unattachedBrands.map(brand => {
                const brandEmoji = brand.emoji || '🏢';
                const brandColor = brand.color || '#4facfe';
                return `
                    <div class="brand-item" data-brand-id="${brand.id}" style="
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 10px;
                        border-radius: 6px;
                        background: rgba(255,255,255,0.05);
                        border: 1px solid rgba(255,255,255,0.1);
                        cursor: pointer;
                        transition: all 0.2s;
                    " onclick="moveBrandToAttached(${brand.id})" onmouseenter="this.style.background='rgba(255,255,255,0.1)'" onmouseleave="this.style.background='rgba(255,255,255,0.05)'">
                        <span style="font-size: 16px;">${brandEmoji}</span>
                        <span style="flex: 1; font-size: 13px; color: ${brandColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${brand.name}</span>
                        <span style="font-size: 11px; color: rgba(255,255,255,0.5);">←</span>
                    </div>
                `;
            }).join('');
        }
        
        // Tanlangan brendlarni ko'rsatish (yuqoridagi display uchun)
        const selectedBrands = attachedBrands.map(brand => ({
            id: brand.id,
            name: brand.name,
            emoji: brand.emoji || '🏢'
        }));
        updateSelectedBrandsDisplay(selectedBrands);
        
        // "Barchasini belgilash" checkbox event listener'larni qo'shish
        setupSelectAllBrandsCheckboxes();
    } catch (error) {
        errorLog('Brendlarni yuklashda xatolik:', error);
        showToast('Brendlarni yuklashda xatolik yuz berdi. Qayta urinib ko\'ring.', true);
        attachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--red-color);">Xatolik yuz berdi</div>';
        unattachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--red-color);">Xatolik yuz berdi</div>';
    }
}

// Brendlar uchun "Barchasini belgilash" funksiyasi
function setupSelectAllBrandsCheckboxes() {
    // Biriktirilgan brendlar uchun
    const selectAllAttached = document.getElementById('select-all-attached-brands');
    if (selectAllAttached) {
        // Eski event listener'ni olib tashlash
        const newSelectAllAttached = selectAllAttached.cloneNode(true);
        selectAllAttached.parentNode.replaceChild(newSelectAllAttached, selectAllAttached);
        const attachedCheckbox = document.getElementById('select-all-attached-brands');
        
        attachedCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const attachedList = document.getElementById('brands-attached-list');
            if (!attachedList) return;
            
            if (!isChecked) {
                // Barchasini biriktirilmagan blokka o'tkazish (teskari tartibda, chunki har bir o'tkazish DOM'ni o'zgartiradi)
                const items = Array.from(attachedList.querySelectorAll('.brand-item'));
                const brandIds = items.map(item => parseInt(item.dataset.brandId)).filter(id => !isNaN(id)).reverse();
                brandIds.forEach(brandId => {
                    moveBrandToUnattached(brandId);
                });
            }
        });
    }
    
    // Biriktirilmagan brendlar uchun
    const selectAllUnattached = document.getElementById('select-all-unattached-brands');
    if (selectAllUnattached) {
        // Eski event listener'ni olib tashlash
        const newSelectAllUnattached = selectAllUnattached.cloneNode(true);
        selectAllUnattached.parentNode.replaceChild(newSelectAllUnattached, selectAllUnattached);
        const unattachedCheckbox = document.getElementById('select-all-unattached-brands');
        
        unattachedCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const unattachedList = document.getElementById('brands-unattached-list');
            if (!unattachedList) return;
            
            if (isChecked) {
                // Barchasini biriktirilgan blokka o'tkazish (teskari tartibda, chunki har bir o'tkazish DOM'ni o'zgartiradi)
                const items = Array.from(unattachedList.querySelectorAll('.brand-item'));
                const brandIds = items.map(item => parseInt(item.dataset.brandId)).filter(id => !isNaN(id)).reverse();
                brandIds.forEach(brandId => {
                    moveBrandToAttached(brandId);
                });
            }
        });
    }
}

// Brendni biriktirilgan blokdan biriktirilmagan blokka o'tkazish
window.moveBrandToUnattached = function(brandId) {
    const attachedList = document.getElementById('brands-attached-list');
    const unattachedList = document.getElementById('brands-unattached-list');
    if (!attachedList || !unattachedList) return;
    
    // Elementni olib tashlash
    const item = attachedList.querySelector(`[data-brand-id="${brandId}"]`);
    if (!item) return;
    
    const brandData = {
        id: brandId,
        name: item.querySelector('span:nth-child(2)')?.textContent || '',
        emoji: item.querySelector('span:first-child')?.textContent || '🏢',
        color: item.querySelector('span:nth-child(2)')?.style.color || '#4facfe'
    };
    
    item.remove();
    
    // Ikkinchi blokka qo'shish
    const newItem = document.createElement('div');
    newItem.className = 'brand-item';
    newItem.dataset.brandId = brandId;
    newItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px;
        border-radius: 6px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer;
        transition: all 0.2s;
    `;
    newItem.innerHTML = `
        <span style="font-size: 16px;">${brandData.emoji}</span>
        <span style="flex: 1; font-size: 13px; color: ${brandData.color}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${brandData.name}</span>
        <span style="font-size: 11px; color: rgba(255,255,255,0.5);">←</span>
    `;
    newItem.onclick = () => moveBrandToAttached(brandId);
    newItem.onmouseenter = function() { this.style.background = 'rgba(255,255,255,0.1)'; };
    newItem.onmouseleave = function() { this.style.background = 'rgba(255,255,255,0.05)'; };
    
    unattachedList.appendChild(newItem);
    
    // Agar birinchi blok bo'sh bo'lsa, xabar ko'rsatish
    if (attachedList.children.length === 0) {
        attachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px;">Brendlar tanlanmagan</div>';
    }
    
    // Tanlangan brendlarni yangilash
    const selected = Array.from(attachedList.querySelectorAll('.brand-item'))
        .map(item => ({
            id: parseInt(item.dataset.brandId),
            name: item.querySelector('span:nth-child(2)')?.textContent || '',
            emoji: item.querySelector('span:first-child')?.textContent || '🏢'
        }));
    updateSelectedBrandsDisplay(selected);
};

// Brendni biriktirilmagan blokdan biriktirilgan blokka o'tkazish
window.moveBrandToAttached = function(brandId) {
    const attachedList = document.getElementById('brands-attached-list');
    const unattachedList = document.getElementById('brands-unattached-list');
    if (!attachedList || !unattachedList) return;
    
    // Elementni olib tashlash
    const item = unattachedList.querySelector(`[data-brand-id="${brandId}"]`);
    if (!item) return;
    
    const brandData = {
        id: brandId,
        name: item.querySelector('span:nth-child(2)')?.textContent || '',
        emoji: item.querySelector('span:first-child')?.textContent || '🏢',
        color: item.querySelector('span:nth-child(2)')?.style.color || '#4facfe'
    };
    
    item.remove();
    
    // Birinchi blokka qo'shish
    // Agar "Brendlar tanlanmagan" xabari bo'lsa, uni olib tashlash
    if (attachedList.textContent.includes('tanlanmagan')) {
        attachedList.innerHTML = '';
    }
    
    const newItem = document.createElement('div');
    newItem.className = 'brand-item';
    newItem.dataset.brandId = brandId;
    newItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px;
        border-radius: 6px;
        background: rgba(79, 172, 254, 0.15);
        border: 1px solid rgba(79, 172, 254, 0.3);
        cursor: pointer;
        transition: all 0.2s;
    `;
    newItem.innerHTML = `
        <span style="font-size: 16px;">${brandData.emoji}</span>
        <span style="flex: 1; font-size: 13px; color: ${brandData.color}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${brandData.name}</span>
        <span style="font-size: 11px; color: rgba(79, 172, 254, 0.7);">→</span>
    `;
    newItem.onclick = () => moveBrandToUnattached(brandId);
    newItem.onmouseenter = function() { this.style.background = 'rgba(79, 172, 254, 0.25)'; };
    newItem.onmouseleave = function() { this.style.background = 'rgba(79, 172, 254, 0.15)'; };
    
    attachedList.appendChild(newItem);
    
    // Agar ikkinchi blok bo'sh bo'lsa, xabar ko'rsatish
    if (unattachedList.children.length === 0) {
        unattachedList.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px;">Barcha brendlar biriktirilgan</div>';
    }
    
    // Tanlangan brendlarni yangilash
    const selected = Array.from(attachedList.querySelectorAll('.brand-item'))
        .map(item => ({
            id: parseInt(item.dataset.brandId),
            name: item.querySelector('span:nth-child(2)')?.textContent || '',
            emoji: item.querySelector('span:first-child')?.textContent || '🏢'
        }));
    updateSelectedBrandsDisplay(selected);
};

// Get filters hash for cache
function getFiltersHash() {
    return JSON.stringify(currentFilters);
}

// Modern render function with filters (optimized)
export function renderModernUsers(immediate = false) {
    if (!state.users || !DOM.userListContainer) return;

    // Debounce for better performance (except immediate calls)
    if (!immediate && renderDebounceTimer) {
        clearTimeout(renderDebounceTimer);
    }

    const doRender = () => {
        const filtersHash = getFiltersHash();
        
        // Use cache if filters haven't changed
        let filteredUsers;
        if (filteredUsersCache && lastFiltersHash === filtersHash) {
            filteredUsers = filteredUsersCache;
        } else {
            // Apply filters
            filteredUsers = state.users.filter(user => {
                // Superadmin'ni faqat superadmin o'zi ko'rsin
                if ((user.role === 'superadmin' || user.role === 'super_admin') && 
                    state.currentUser?.role !== 'superadmin' && state.currentUser?.role !== 'super_admin') {
                    return false;
                }
                
                // Search filter
                if (currentFilters.search && currentFilters.search.trim()) {
                    const searchTerm = currentFilters.search.toLowerCase().trim();
                    const fullname = (user.fullname || '').toLowerCase();
                    const username = (user.username || '').toLowerCase();
                    const email = (user.email || '').toLowerCase();
                    const phone = (user.phone || '').toLowerCase();
                    const role = (user.role || '').toLowerCase();
                    
                    const matchesSearch = fullname.includes(searchTerm) || 
                                         username.includes(searchTerm) || 
                                         email.includes(searchTerm) || 
                                         phone.includes(searchTerm) ||
                                         role.includes(searchTerm);
                    
                    if (!matchesSearch) return false;
                }
                
                // Role filter
                if (currentFilters.role && user.role !== currentFilters.role) return false;

                // Account Status filter
                if (currentFilters.accountStatus) {
                    if (currentFilters.accountStatus === 'active' && user.status !== 'active') return false;
                    if (currentFilters.accountStatus === 'pending' && !user.status.startsWith('pending')) return false;
                    if (currentFilters.accountStatus === 'inactive' && user.status !== 'blocked' && user.status !== 'archived') return false;
                }

                // Online Status filter
                if (currentFilters.onlineStatus) {
                    if (currentFilters.onlineStatus === 'online' && !user.is_online) return false;
                    if (currentFilters.onlineStatus === 'offline' && user.is_online) return false;
                }

                // Telegram Status filter
                if (currentFilters.telegramStatus) {
                    const isConnected = Boolean(user.telegram_chat_id) || user.is_telegram_connected === 1;
                    if (currentFilters.telegramStatus === 'connected' && !isConnected) return false;
                    if (currentFilters.telegramStatus === 'not_connected' && isConnected) return false;
                }

                return true;
            });
            
            // Cache results
            filteredUsersCache = filteredUsers;
            lastFiltersHash = filtersHash;
        }

        // Update statistics (only if needed)
        updateUsersStatistics();

        // Apply view mode
        applyViewMode();

        // Calculate pagination
        const totalUsers = filteredUsers.length;
        const totalPages = Math.ceil(totalUsers / usersPerPage);
        
        
        // Ensure current page is valid
        if (currentPage > totalPages && totalPages > 0) {
            currentPage = totalPages;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }
        
        // Get users for current page
        const startIndex = (currentPage - 1) * usersPerPage;
        const endIndex = startIndex + usersPerPage;
        const paginatedUsers = filteredUsers.slice(startIndex, endIndex);
        

        // Use requestAnimationFrame for smooth rendering
        requestAnimationFrame(() => {
            // Render using DocumentFragment for better performance
            if (filteredUsers.length === 0) {
                DOM.userListContainer.innerHTML = '<div class="empty-state"><i data-feather="users"></i><p>Foydalanuvchilar topilmadi</p></div>';
                feather.replace();
                renderPaginationControls(0, 0, 0);
                return;
            }

            // Use DocumentFragment for batch DOM operations
            const fragment = document.createDocumentFragment();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = paginatedUsers.map(user => renderModernUserCard(user)).join('');
            
            while (tempDiv.firstChild) {
                fragment.appendChild(tempDiv.firstChild);
            }
            
            DOM.userListContainer.innerHTML = '';
            DOM.userListContainer.appendChild(fragment);
            
            // Only replace icons for new elements (optimized)
            feather.replace({ root: DOM.userListContainer });
            
            // Event delegation - barcha user card action buttonlar uchun
            setupUserCardEventListeners();
            
            // Render pagination controls
            renderPaginationControls(totalUsers, totalPages, currentPage);
        });
    };

    if (immediate) {
        doRender();
    } else {
        renderDebounceTimer = setTimeout(doRender, 50); // 50ms debounce
    }
}

// Apply view mode (grid or list)
function applyViewMode() {
    if (!DOM.userListContainer) return;
    
    // Remove existing classes
    DOM.userListContainer.classList.remove('users-grid', 'users-list');
    
    // Add appropriate class
    if (currentViewMode === 'list') {
        DOM.userListContainer.classList.add('users-list');
    } else {
        DOM.userListContainer.classList.add('users-grid');
    }
    
    // Update toggle buttons
    const gridBtn = document.getElementById('view-toggle-grid');
    const listBtn = document.getElementById('view-toggle-list');
    
    if (gridBtn && listBtn) {
        if (currentViewMode === 'list') {
            gridBtn.classList.remove('active');
            listBtn.classList.add('active');
        } else {
            gridBtn.classList.add('active');
            listBtn.classList.remove('active');
        }
        
        // Replace icons after class change
        if (window.feather) {
            setTimeout(() => {
                const viewToggleContainer = document.querySelector('.view-toggle-buttons');
                if (viewToggleContainer) {
                    feather.replace({ root: viewToggleContainer });
                }
            }, 10);
        }
    }
}

// Render pagination controls
function renderPaginationControls(totalUsers, totalPages, currentPageNum) {
    const paginationContainer = document.getElementById('users-pagination');
    if (!paginationContainer) {
        return;
    }

    // Har doim ko'rsatish (hatto natijalar bo'lmasa ham qidiruv oynasi ko'rinib turishi uchun)
    paginationContainer.style.display = 'flex';
    
    // Input maydonini saqlash (agar mavjud bo'lsa)
    const existingSearchInput = document.getElementById('users-search-input');
    const wasFocused = existingSearchInput && document.activeElement === existingSearchInput;
    const cursorPosition = existingSearchInput ? existingSearchInput.selectionStart : null;
    const inputValue = existingSearchInput ? existingSearchInput.value : (currentFilters.search || '');
    
    // Calculate page numbers to show (har doim ko'rsatish)
    const maxVisiblePages = 7;
    let startPage = Math.max(1, currentPageNum - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    // Agar faqot 1 sahifa bo'lsa ham ko'rsatish
    if (totalPages === 1) {
        startPage = 1;
        endPage = 1;
    }
    
    // Calculate showing range
    const startRange = totalUsers === 0 ? 0 : (currentPageNum - 1) * usersPerPage + 1;
    const endRange = Math.min(currentPageNum * usersPerPage, totalUsers);
    
    let paginationHTML = `
        <div class="pagination-left-section">
            <!-- Search Input -->
            <div class="search-input-wrapper" style="position: relative; min-width: 300px; max-width: 400px;">
                <input 
                    type="text" 
                    id="users-search-input" 
                    class="form-control search-input" 
                    placeholder="Foydalanuvchi qidirish (ism, login, email, telefon...)"
                    value="${(currentFilters.search || '').replace(/"/g, '&quot;')}"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck="false"
                    style="padding-right: 40px;"
                >
                <i data-feather="search" class="search-input-icon" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: rgba(255,255,255,0.5); pointer-events: none;"></i>
                <button type="button" class="clear-search-btn" id="clear-search-btn" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; padding: 4px; display: ${currentFilters.search ? 'flex' : 'none'}; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; transition: all 0.2s ease;" title="Tozalash">
                    <i data-feather="x"></i>
                </button>
            </div>
            
            <!-- View Toggle Buttons -->
            <div class="flex-center gap-10" style="margin-left: 15px;">
                <span class="text-white-70 font-14">Ko'rinish:</span>
                <div class="view-toggle-buttons">
                    <button class="view-toggle-btn ${currentViewMode === 'grid' ? 'active' : ''}" data-view="grid" id="view-toggle-grid" title="Grid ko'rinish">
                        <i data-feather="grid"></i>
                    </button>
                    <button class="view-toggle-btn ${currentViewMode === 'list' ? 'active' : ''}" data-view="list" id="view-toggle-list" title="List ko'rinish">
                        <i data-feather="list"></i>
                    </button>
                </div>
            </div>
        </div>
        
        <div class="pagination-center-section">
            <div class="pagination-info">
                <span>Jami: <strong>${totalUsers}</strong> foydalanuvchi</span>
                <span style="margin: 0 15px;">|</span>
                <span>Ko'rsatilmoqda: <strong>${startRange}</strong> - <strong>${endRange}</strong></span>
                <span style="margin: 0 15px;">|</span>
                <span>Sahifa: <strong>${currentPageNum}</strong> / <strong>${totalPages}</strong></span>
            </div>
            
            <div class="pagination-controls">
                <button class="pagination-btn" data-page="first" ${currentPageNum === 1 ? 'disabled' : ''} title="Birinchi sahifa">
                    <i data-feather="chevrons-left"></i>
                </button>
                <button class="pagination-btn" data-page="prev" ${currentPageNum === 1 ? 'disabled' : ''} title="Oldingi sahifa">
                    <i data-feather="chevron-left"></i>
                </button>
                
                ${startPage > 1 ? `<button class="pagination-btn" data-page="1">1</button>${startPage > 2 ? '<span class="pagination-dots">...</span>' : ''}` : ''}
                
                ${Array.from({ length: endPage - startPage + 1 }, (_, i) => {
                    const page = startPage + i;
                    return `<button class="pagination-btn ${page === currentPageNum ? 'active' : ''}" data-page="${page}">${page}</button>`;
                }).join('')}
                
                ${endPage < totalPages ? `${endPage < totalPages - 1 ? '<span class="pagination-dots">...</span>' : ''}<button class="pagination-btn" data-page="${totalPages}">${totalPages}</button>` : ''}
                
                <button class="pagination-btn" data-page="next" ${currentPageNum === totalPages ? 'disabled' : ''} title="Keyingi sahifa">
                    <i data-feather="chevron-right"></i>
                </button>
                <button class="pagination-btn" data-page="last" ${currentPageNum === totalPages ? 'disabled' : ''} title="Oxirgi sahifa">
                    <i data-feather="chevrons-right"></i>
                </button>
            </div>
        </div>
        
        <div class="pagination-right-section">
            <div class="pagination-per-page">
                <label style="color: rgba(255,255,255,0.7); font-size: 14px; margin-right: 8px;">Ko'rsatish:</label>
                <select id="users-per-page-select" class="form-control pagination-select" style="width: auto; min-width: 90px; padding: 8px 35px 8px 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; appearance: none; background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23ffffff' d='M2 4l4 4 4-4z'/%3E%3C/svg%3E\"); background-repeat: no-repeat; background-position: right 12px center;">
                    <option value="5" ${usersPerPage === 5 ? 'selected' : ''} style="background: #1a1a2e; color: #fff; padding: 10px;">5</option>
                    <option value="10" ${usersPerPage === 10 ? 'selected' : ''} style="background: #1a1a2e; color: #fff; padding: 10px;">10</option>
                    <option value="20" ${usersPerPage === 20 ? 'selected' : ''} style="background: #1a1a2e; color: #fff; padding: 10px;">20</option>
                    <option value="50" ${usersPerPage === 50 ? 'selected' : ''} style="background: #1a1a2e; color: #fff; padding: 10px;">50</option>
                    <option value="100" ${usersPerPage === 100 ? 'selected' : ''} style="background: #1a1a2e; color: #fff; padding: 10px;">100</option>
                </select>
            </div>
            
            <!-- Excel eksport tugmasi -->
            <button id="export-users-excel-btn" class="btn btn-success" style="margin-left: 15px; padding: 8px 16px; display: flex; align-items: center; gap: 8px; font-size: 14px; white-space: nowrap;">
                <i data-feather="download"></i>
                <span>Excel</span>
            </button>
        </div>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
    
    // Replace icons
    if (window.feather) {
        feather.replace({ root: paginationContainer });
    }
    
    // Focus va cursor pozitsiyasini qaytarish (agar input focus bo'lgan bo'lsa)
    if (wasFocused) {
        const newSearchInput = document.getElementById('users-search-input');
        if (newSearchInput) {
            // Bir necha marta urinib ko'rish (DOM to'liq tayyor bo'lishi uchun)
            const restoreFocus = () => {
                if (newSearchInput && document.body.contains(newSearchInput)) {
                    newSearchInput.focus();
                    if (cursorPosition !== null && cursorPosition !== undefined && cursorPosition >= 0) {
                        try {
                            newSearchInput.setSelectionRange(cursorPosition, cursorPosition);
                        } catch (e) {
                            // Ignore selection errors
                        }
                    }
                } else {
                    requestAnimationFrame(restoreFocus);
                }
            };
            
            // Darhol va keyin bir necha marta urinib ko'rish
            requestAnimationFrame(() => {
                restoreFocus();
                setTimeout(restoreFocus, 0);
                setTimeout(restoreFocus, 10);
            });
        }
    }
    
    // Setup pagination button listeners
    const paginationButtons = paginationContainer.querySelectorAll('.pagination-btn[data-page]');
    paginationButtons.forEach((btn, index) => {
        // Remove old listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (newBtn.disabled) return;
            
            const pageAction = newBtn.dataset.page;
            
            if (pageAction === 'first') {
                currentPage = 1;
            } else if (pageAction === 'prev') {
                currentPage = Math.max(1, currentPage - 1);
            } else if (pageAction === 'next') {
                currentPage = Math.min(totalPages, currentPage + 1);
            } else if (pageAction === 'last') {
                currentPage = totalPages;
            } else {
                const pageNum = parseInt(pageAction);
                if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
                    currentPage = pageNum;
                }
            }
            
            // Scroll to top of users list
            if (DOM.userListContainer) {
                DOM.userListContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            
            renderModernUsers(true);
        });
    });
    
    // Setup per-page selector
    const perPageSelect = document.getElementById('users-per-page-select');
    if (perPageSelect) {
        // Remove old listener by cloning
        const newSelect = perPageSelect.cloneNode(true);
        perPageSelect.parentNode.replaceChild(newSelect, perPageSelect);
        
        newSelect.addEventListener('change', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const newValue = parseInt(e.target.value);
            if (!isNaN(newValue) && newValue > 0) {
                usersPerPage = newValue;
                localStorage.setItem('usersPerPage', usersPerPage);
                currentPage = 1; // Reset to first page
                renderModernUsers(true);
            }
        });
    } else {
    }
    
    // Setup search input (pagination ichida)
    setupPaginationSearchInput();
    
    // Setup view toggle buttons (pagination ichida)
    setupPaginationViewToggle();
    
    // Setup Excel export button
    const exportExcelBtn = document.getElementById('export-users-excel-btn');
    if (exportExcelBtn) {
        // Remove old listener by cloning
        const newExportBtn = exportExcelBtn.cloneNode(true);
        exportExcelBtn.parentNode.replaceChild(newExportBtn, exportExcelBtn);
        
        newExportBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            exportUsersToExcel();
        });
        
        // Replace icons
        if (window.feather) {
            feather.replace({ root: newExportBtn });
        }
    }
}

// Setup search input in pagination
function setupPaginationSearchInput() {
    const searchInput = document.getElementById('users-search-input');
    if (!searchInput) return;
    
    let searchDebounceTimer = null;
    
    // Agar input maydoni allaqachon event listener'ga ega bo'lsa, qayta qo'shmaslik
    if (searchInput.dataset.listenerAttached === 'true') {
        return; // Event listener allaqachon qo'shilgan
    }
    
    // Focus'ni saqlab qolish
    const wasFocused = document.activeElement === searchInput;
    const cursorPosition = searchInput.selectionStart;
    
    // Event listener qo'shilganini belgilash
    searchInput.dataset.listenerAttached = 'true';
    
    // Clear search button
    const clearBtn = document.getElementById('clear-search-btn');
    if (clearBtn) {
        // Eski listener'larni olib tashlash
        const newClearBtn = clearBtn.cloneNode(true);
        clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
        
        newClearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            searchInput.value = '';
            currentFilters.search = '';
            filteredUsersCache = null;
            lastFiltersHash = '';
            currentPage = 1;
            renderModernUsers(true);
        });
    }
    
    // Show/hide clear button based on input value
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value;
        const clearBtn = document.getElementById('clear-search-btn');
        if (clearBtn) {
            clearBtn.style.display = searchTerm ? 'flex' : 'none';
        }
        
        // Clear previous debounce timer
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        
        // Debounce search for better performance
        searchDebounceTimer = setTimeout(() => {
            // Focus holatini saqlash
            const isFocused = document.activeElement === searchInput;
            const cursorPos = searchInput.selectionStart;
            
            currentFilters.search = searchTerm;
            filteredUsersCache = null; // Clear cache on search change
            lastFiltersHash = ''; // Reset hash
            currentPage = 1; // Reset to first page on search
            
            // Render qilish va focus'ni qaytarish
            renderModernUsers();
            
            // Focus'ni qaytarish
            if (isFocused) {
                requestAnimationFrame(() => {
                    const newInput = document.getElementById('users-search-input');
                    if (newInput) {
                        newInput.focus();
                        if (cursorPos !== null && cursorPos !== undefined && cursorPos >= 0) {
                            try {
                                newInput.setSelectionRange(cursorPos, cursorPos);
                            } catch (e) {
                                // Ignore selection errors
                            }
                        }
                    }
                });
            }
        }, 300); // 300ms debounce
    });
    
    // Replace icons
    if (window.feather) {
        const searchContainer = searchInput.parentElement;
        feather.replace({ root: searchContainer });
    }
}

// Setup view toggle buttons in pagination
function setupPaginationViewToggle() {
    const gridBtn = document.getElementById('view-toggle-grid');
    const listBtn = document.getElementById('view-toggle-list');
    
    if (!gridBtn || !listBtn) {
        return;
    }
    
    // Remove old listeners by cloning
    const newGridBtn = gridBtn.cloneNode(true);
    const newListBtn = listBtn.cloneNode(true);
    
    gridBtn.parentNode.replaceChild(newGridBtn, gridBtn);
    listBtn.parentNode.replaceChild(newListBtn, listBtn);
    
    newGridBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleUsersViewMode('grid');
    });
    
    newListBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleUsersViewMode('list');
    });
    
    // Update active state
    if (currentViewMode === 'grid') {
        newGridBtn.classList.add('active');
        newListBtn.classList.remove('active');
    } else {
        newGridBtn.classList.remove('active');
        newListBtn.classList.add('active');
    }
    
    // Replace icons
    if (window.feather) {
        const viewToggleContainer = document.querySelector('.view-toggle-buttons');
        if (viewToggleContainer) {
            feather.replace({ root: viewToggleContainer });
        }
    }
}

// Toggle view mode
export function toggleUsersViewMode(mode) {
    if (mode && (mode === 'grid' || mode === 'list')) {
        currentViewMode = mode;
    } else {
        // Toggle between grid and list
        currentViewMode = currentViewMode === 'grid' ? 'list' : 'grid';
    }
    
    // Save to localStorage
    localStorage.setItem('usersViewMode', currentViewMode);
    
    // Apply view mode
    applyViewMode();
    
    // Re-render users (immediate, no debounce for view change)
    renderModernUsers(true);
}

// Setup event listeners for user card action buttons
let userCardEventListenersSetup = false;

function setupUserCardEventListeners() {
    if (!DOM.userListContainer) {
        return;
    }
    
    // Agar allaqachon sozlangan bo'lsa, qayta sozlamaslik
    if (userCardEventListenersSetup) {
        log.warn('Event listener allaqachon qo\'shilgan, qayta qo\'shilmaydi');
        return;
    }
    
    log.debug('Event listener qo\'shilmoqda...');
    
    // Event delegation - barcha user card action buttonlar uchun
    const clickHandler = async (e) => {
        // Faqat .user-card-action-btn class'iga ega button'lar uchun ishlash
        const button = e.target.closest('.user-card-action-btn');
        if (!button) {
            // Agar button topilmasa, bu boshqa element (filter badge, checkbox, va h.k.)
            return;
        }
        
        // Icon yoki span ichida bosilgan bo'lsa, button'ni topish
        const actualButton = button.closest('button') || button;
        if (!actualButton || !actualButton.classList.contains('user-card-action-btn')) {
            return;
        }
        
        // Permission tekshirish
        const permission = actualButton.dataset.permission;
        if (permission && !hasPermission(state.currentUser, permission)) {
            showToast('Sizda bu amalni bajarish uchun huquq yo\'q', 'error');
            return;
        }
        
        await handleUserActions({ target: actualButton });
    };
    
    DOM.userListContainer.addEventListener('click', clickHandler);
    
    // User items trigger (brands/locations modal) uchun event listener
    const itemsClickHandler = (e) => {
        const trigger = e.target.closest('.user-items-trigger');
        if (!trigger) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        const userId = trigger.dataset.userId;
        const title = trigger.dataset.title;
        const itemsJson = trigger.dataset.items;
        const type = trigger.dataset.type;
        
        if (!itemsJson) return;
        
        try {
            const items = JSON.parse(itemsJson.replace(/&#39;/g, "'"));
            if (window.showUserItemsModal) {
                window.showUserItemsModal(userId, title, items, type);
            }
        } catch (error) {
            errorLog('Error parsing items:', error);
        }
    };
    
    DOM.userListContainer.addEventListener('click', itemsClickHandler);
    userCardEventListenersSetup = true;
    
    // Sessiya tugatish buttonlari uchun (event delegation) - faqat bir marta
    if (DOM.sessionsListContainer && !DOM.sessionsListContainer._sessionTerminateHandler) {
        const sessionTerminateHandler = (e) => {
            if (e.target.closest('.terminate-session-btn')) {
                handleSessionTerminate(e);
            }
        };
        DOM.sessionsListContainer.addEventListener('click', sessionTerminateHandler);
        DOM.sessionsListContainer._sessionTerminateHandler = sessionTerminateHandler;
    }
}

// Sessiya tugatish handler (bitta funksiya)
let isTerminatingSession = false;

async function handleSessionTerminate(e) {
    // Event delegation tekshiruvi
    const button = e.target.closest('.terminate-session-btn');
    if (!button) return;
    
    // Agar allaqachon ishlanmoqda bo'lsa, qayta ishlamaslik
    if (isTerminatingSession) {
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const sessionId = button.dataset.sid;
    if (!sessionId) {
        errorLog('Sessiya ID topilmadi');
        return;
    }
    
    isTerminatingSession = true;
    
    // Button'ni disable qilish
    button.disabled = true;
    const originalText = button.innerHTML;
    button.innerHTML = '<div class="loading-spinner"></div> Tugatilmoqda...';
    
    try {
        const confirmed = await showConfirmDialog({
            title: '⚠️ Sessiyani Tugatish',
            message: 'Rostdan ham bu sessiyani tugatmoqchimisiz?',
            confirmText: 'Ha, tugatish',
            cancelText: 'Bekor qilish',
            type: 'danger',
            icon: 'alert-triangle'
        });
        
        if (!confirmed) {
            button.disabled = false;
            button.innerHTML = originalText;
            isTerminatingSession = false;
            return;
        }
        
        const res = await safeFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        });
        
        if (!res) {
            throw new Error('Server bilan bog\'lanishda xatolik');
        }
        
        // 404 holatida sessiya allaqachon o'chirilgan yoki topilmagan
        // Bu holat muvaffaqiyatli deb hisoblanadi, chunki maqsad sessiyani o'chirish edi
        if (res.status === 404) {
            showToast('Sessiya allaqachon tugatilgan', 'success');
            
            // Modal'ni yangilash - saqlangan userId va username dan foydalanish
            const userId = DOM.sessionsModal?.dataset.userId;
            const username = DOM.sessionsModal?.dataset.username;
            if (userId && username) {
                // Modal'ni darhol yangilash (flag'ni o'rnatish)
                isOpeningSessionsModal = true;
                
                // Button holatini darhol qaytarish (modal yangilanishidan oldin)
                button.disabled = false;
                button.innerHTML = originalText;
                
                // Kichik kechikish - toast ko'rsatilishi uchun
                setTimeout(async () => {
                    try {
                        await openSessionsModal(userId, username);
                    } catch (error) {
                        errorLog('Modal yangilashda xatolik:', error);
                        isOpeningSessionsModal = false;
                    }
                }, 300);
            } else {
                // Agar modal ochiq bo'lsa, sessiyani DOM'dan olib tashlash
                const sessionItem = button.closest('.session-item-modern');
                if (sessionItem) {
                    sessionItem.style.transition = 'opacity 0.3s, transform 0.3s';
                    sessionItem.style.opacity = '0';
                    sessionItem.style.transform = 'translateX(-20px)';
                    setTimeout(() => {
                        sessionItem.remove();
                        // Agar barcha sessiyalar tugatilgan bo'lsa, empty state ko'rsatish
                        const remainingSessions = DOM.sessionsListContainer?.querySelectorAll('.session-item-modern');
                        if (remainingSessions && remainingSessions.length === 0) {
                            DOM.sessionsListContainer.innerHTML = `
                                <div class="empty-state-modern">
                                    <div class="empty-state-icon">
                                        <i data-feather="monitor"></i>
                                    </div>
                                    <h4>Aktiv sessiyalar topilmadi</h4>
                                    <p>Bu foydalanuvchining hozirgi vaqtda aktiv sessiyalari yo'q.</p>
                                </div>
                            `;
                            if (window.feather) {
                                window.feather.replace();
                            }
                        }
                    }, 300);
                }
                // Button holatini qaytarish
                button.disabled = false;
                button.innerHTML = originalText;
            }
            return;
        }
        
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({ message: 'Sessiyani tugatishda xatolik' }));
            throw new Error(errorData.message || `Sessiyani tugatishda xatolik (${res.status})`);
        }
        
        const result = await res.json();
        
        showToast(result.message || 'Sessiya muvaffaqiyatli tugatildi', 'success');
        
        // Modal'ni yangilash - saqlangan userId va username dan foydalanish
        const userId = DOM.sessionsModal?.dataset.userId;
        const username = DOM.sessionsModal?.dataset.username;
        if (userId && username) {
            // Modal'ni darhol yangilash (flag'ni o'rnatish)
            isOpeningSessionsModal = true;
            
            // Button holatini darhol qaytarish (modal yangilanishidan oldin)
            button.disabled = false;
            button.innerHTML = originalText;
            
            // Kichik kechikish - toast ko'rsatilishi uchun
            setTimeout(async () => {
                try {
                    await openSessionsModal(userId, username);
                } catch (error) {
                    errorLog('Modal yangilashda xatolik:', error);
                    isOpeningSessionsModal = false;
                }
            }, 300);
        } else {
            // Agar modal ochiq bo'lsa, sessiyani DOM'dan olib tashlash
            const sessionItem = button.closest('.session-item-modern');
            if (sessionItem) {
                sessionItem.style.transition = 'opacity 0.3s, transform 0.3s';
                sessionItem.style.opacity = '0';
                sessionItem.style.transform = 'translateX(-20px)';
                setTimeout(() => {
                    sessionItem.remove();
                    // Agar barcha sessiyalar tugatilgan bo'lsa, empty state ko'rsatish
                    const remainingSessions = DOM.sessionsListContainer.querySelectorAll('.session-item-modern');
                    if (remainingSessions.length === 0) {
                        DOM.sessionsListContainer.innerHTML = `
                            <div class="empty-state-modern">
                                <div class="empty-state-icon">
                                    <i data-feather="monitor"></i>
                                </div>
                                <h4>Aktiv sessiyalar topilmadi</h4>
                                <p>Bu foydalanuvchining hozirgi vaqtda aktiv sessiyalari yo'q.</p>
                            </div>
                        `;
                        if (window.feather) {
                            window.feather.replace();
                        }
                    }
                }, 300);
            }
        }
    } catch (error) {
        errorLog('Sessiya o\'chirishda xatolik:', error);
        showToast(error.message || 'Sessiyani tugatishda xatolik', 'error');
        button.disabled = false;
        button.innerHTML = originalText;
    } finally {
        isTerminatingSession = false;
    }
}

// Render user brands and locations
function renderUserBrandsLocations(user, isMeta = false) {
    const locations = user.role_based_locations || [];
    const brands = user.role_based_brands || [];
    
    let html = '';
    const itemClass = isMeta ? 'user-card-meta-item' : 'user-card-detail-item';
    
    // Filiallar
    if (locations.length > 0) {
        const displayCount = locations.length > 2 ? 2 : locations.length;
        const remainingCount = locations.length - displayCount;
        const displayLocations = locations.slice(0, displayCount);
        const locationsJson = JSON.stringify(locations).replace(/'/g, "&#39;");
        
        html += `
            <div class="${itemClass}">
                <i data-feather="map-pin"></i>
                <span>Filiallar: 
                    ${displayLocations.map(loc => `<span class="user-tag">${escapeHtml(loc)}</span>`).join(' ')}
                    ${remainingCount > 0 ? `
                        <span class="user-tag user-tag-clickable user-items-trigger" 
                              style="cursor: pointer; background: #4facfe; color: white;"
                              data-user-id="${user.id}"
                              data-title="Filiallar"
                              data-items='${locationsJson}'
                              data-type="locations">
                            +${remainingCount}
                        </span>
                    ` : ''}
                </span>
            </div>
        `;
    }
    
    // Brendlar
    if (brands.length > 0) {
        const displayCount = brands.length > 2 ? 2 : brands.length;
        const remainingCount = brands.length - displayCount;
        const displayBrands = brands.slice(0, displayCount);
        const brandNames = brands.map(b => typeof b === 'string' ? b : (b.name || b));
        const brandsJson = JSON.stringify(brandNames).replace(/'/g, "&#39;");
        
        html += `
            <div class="${itemClass}">
                <i data-feather="tag"></i>
                <span>Brendlar: 
                    ${displayBrands.map(brand => {
                        const brandName = typeof brand === 'string' ? brand : (brand.name || brand);
                        return `<span class="user-tag">${escapeHtml(brandName)}</span>`;
                    }).join(' ')}
                    ${remainingCount > 0 ? `
                        <span class="user-tag user-tag-clickable user-items-trigger" 
                              style="cursor: pointer; background: #4facfe; color: white;"
                              data-user-id="${user.id}"
                              data-title="Brendlar"
                              data-items='${brandsJson}'
                              data-type="brands">
                            +${remainingCount}
                        </span>
                    ` : ''}
                </span>
            </div>
        `;
    }
    
    return html;
}

// Render single modern user card
function renderModernUserCard(user) {
    const isOnline = user.is_online;
    const statusIndicator = isOnline ? 'online' : 'offline';
    
    // Get initials
    const initials = (user.fullname || user.username || 'U')
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    // Status badge
    const userStatus = user.status === 'blocked' || user.status === 'archived' ? 'inactive' : 
                      user.status.startsWith('pending') ? 'pending' : 'active';
    
    // Agar foydalanuvchi hech narsa ko'ra olmasa (filial va brend ikkalasi ham tanlanmagan)
    // Superadmin uchun istisno - superadmin barcha ma'lumotlarni ko'ra oladi
    const isSuperadmin = user.role === 'superadmin' || user.role === 'super_admin';
    const hasNoAccess = !isSuperadmin && (user.has_no_access || false);

    return `
        <div class="user-card ${hasNoAccess ? 'user-card-no-access' : ''}" data-user-id="${user.id}">
            ${hasNoAccess ? `
            <div class="user-card-warning-banner" style="
                background: linear-gradient(135deg, #ef4444, #dc2626);
                color: white;
                padding: 12px 16px;
                border-radius: 8px 8px 0 0;
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 13px;
                font-weight: 600;
                animation: pulse-warning 2s infinite;
                box-shadow: 0 0 20px rgba(239, 68, 68, 0.4);
            ">
                <i data-feather="alert-triangle" style="width: 18px; height: 18px;"></i>
                <span>⚠️ Hech qanday ma'lumot ko'ra olmaydi (Filial va Brend tanlanmagan)</span>
            </div>
            ` : ''}
            <div class="user-card-header">
                <input type="checkbox" class="user-card-checkbox" 
                       data-user-id="${user.id}"
                       onchange="window.toggleUserSelection(${user.id}, this)">
                
                <div class="user-card-avatar ${hasNoAccess ? 'avatar-warning' : ''}">
                    ${initials}
                    <div class="user-card-status-indicator ${statusIndicator}"></div>
                    ${hasNoAccess ? `
                    <div class="user-card-warning-indicator" style="
                        position: absolute;
                        top: -5px;
                        right: -5px;
                        width: 20px;
                        height: 20px;
                        background: #ef4444;
                        border-radius: 50%;
                        border: 3px solid var(--card-bg);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        animation: pulse-warning 2s infinite;
                        box-shadow: 0 0 10px rgba(239, 68, 68, 0.6);
                    ">
                        <i data-feather="alert-circle" style="width: 12px; height: 12px; color: white;"></i>
                    </div>
                    ` : ''}
                </div>

                <div class="user-card-info">
                    <div class="user-card-name">
                        ${user.fullname || user.username}
                    </div>
                    <div class="user-card-username">@${user.username}</div>
                    <div class="user-card-badges">
                        <span class="user-badge user-badge-${user.role}">
                            <i data-feather="${user.role === 'admin' ? 'shield' : 'user'}"></i>
                            ${user.role}
                        </span>
                        <span class="user-badge user-badge-${userStatus}">
                            <i data-feather="${userStatus === 'active' ? 'check-circle' : userStatus === 'pending' ? 'clock' : 'x-circle'}"></i>
                            ${userStatus === 'active' ? 'Aktiv' : userStatus === 'pending' ? 'Kutmoqda' : 'Noaktiv'}
                        </span>
                    </div>
                </div>
            </div>

            <div class="user-card-details">
                ${user.email ? `
                <div class="user-card-detail-item">
                    <i data-feather="mail"></i>
                    <span>${user.email}</span>
                </div>
                ` : ''}
                ${user.phone ? `
                <div class="user-card-detail-item">
                    <i data-feather="phone"></i>
                    <span>${user.phone}</span>
                </div>
                ` : ''}
                <div class="user-card-detail-item">
                    <i data-feather="calendar"></i>
                    <span>Ro'yxatdan o'tgan: ${formatDate(user.created_at)}</span>
                </div>
                <div class="user-card-detail-item">
                    <i data-feather="activity"></i>
                    <span>Sessiyalar: <strong>${user.active_sessions_count || 0}</strong></span>
                </div>
                ${user.telegram_username ? `
                <div class="user-card-detail-item">
                    <i data-feather="send"></i>
                    <span>Telegram: <strong>@${user.telegram_username}</strong></span>
                </div>
                ` : ''}
                ${renderUserBrandsLocations(user)}
            </div>

            <div class="user-card-right-column">
            <div class="user-card-meta">
                ${user.email ? `
                <div class="user-card-meta-item">
                    <i data-feather="mail"></i>
                    <span>${user.email}</span>
                </div>
                ` : ''}
                ${user.phone ? `
                <div class="user-card-meta-item">
                    <i data-feather="phone"></i>
                    <span>${user.phone}</span>
                </div>
                ` : ''}
                <div class="user-card-meta-item">
                    <i data-feather="calendar"></i>
                    <span>${formatDate(user.created_at)}</span>
                </div>
                <div class="user-card-meta-item">
                    <i data-feather="activity"></i>
                    <span>Sessiyalar: ${user.active_sessions_count || 0}</span>
                </div>
                ${user.telegram_username ? `
                <div class="user-card-meta-item">
                    <i data-feather="send"></i>
                    <span>@${user.telegram_username}</span>
                </div>
                ` : ''}
                ${renderUserBrandsLocations(user, true)}
            </div>

            <div class="user-card-actions">
                    <button class="user-card-action-btn manage-user-btn" 
                        data-id="${user.id}" 
                        data-username="${user.username}"
                            title="Boshqarish"
                            data-permission="users:edit">
                        <i data-feather="settings"></i>
                        Boshqarish
                </button>
                </div>
            </div>
        </div>
    `;
}

// Update statistics cards
function updateUsersStatistics() {
    if (!state.users) return;

    const totalUsers = state.users.length;
    const activeUsers = state.users.filter(u => u.status === 'active').length;
    const pendingUsers = state.users.filter(u => u.status.startsWith('pending')).length;
    const inactiveUsers = state.users.filter(u => u.status === 'blocked' || u.status === 'archived').length;

    const activePercent = totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0;
    const inactivePercent = totalUsers > 0 ? Math.round((inactiveUsers / totalUsers) * 100) : 0;

    // Update DOM
    document.getElementById('total-users-count').textContent = totalUsers;
    document.getElementById('active-users-count').textContent = activeUsers;
    document.getElementById('pending-users-count').textContent = pendingUsers;
    document.getElementById('inactive-users-count').textContent = inactiveUsers;
    
    document.getElementById('active-users-percent').textContent = `${activePercent}%`;
    document.getElementById('inactive-users-percent').textContent = `${inactivePercent}%`;

    // Update role counts
    const roleCounts = {};
    state.users.forEach(user => {
        const role = user.role || 'user';
        roleCounts[role] = (roleCounts[role] || 0) + 1;
    });

    // Update role count badges
    const roleCountAll = document.getElementById('role-count-all');
    if (roleCountAll) roleCountAll.textContent = totalUsers;

    Object.keys(roleCounts).forEach(role => {
        const countEl = document.getElementById(`role-count-${role}`);
        if (countEl) countEl.textContent = roleCounts[role];
    });

    // Update account status count badges
    const accountStatusCountAll = document.getElementById('account-status-count-all');
    if (accountStatusCountAll) accountStatusCountAll.textContent = totalUsers;
    
    const accountStatusCountActive = document.getElementById('account-status-count-active');
    if (accountStatusCountActive) accountStatusCountActive.textContent = activeUsers;
    
    const accountStatusCountPending = document.getElementById('account-status-count-pending');
    if (accountStatusCountPending) accountStatusCountPending.textContent = pendingUsers;
    
    const accountStatusCountInactive = document.getElementById('account-status-count-inactive');
    if (accountStatusCountInactive) accountStatusCountInactive.textContent = inactiveUsers;

    // Update online status count badges
    const onlineUsers = state.users.filter(u => u.is_online).length;
    const offlineUsers = totalUsers - onlineUsers;
    
    const onlineStatusCountAll = document.getElementById('online-status-count-all');
    if (onlineStatusCountAll) onlineStatusCountAll.textContent = totalUsers;
    
    const onlineStatusCountOnline = document.getElementById('online-status-count-online');
    if (onlineStatusCountOnline) onlineStatusCountOnline.textContent = onlineUsers;
    
    const onlineStatusCountOffline = document.getElementById('online-status-count-offline');
    if (onlineStatusCountOffline) onlineStatusCountOffline.textContent = offlineUsers;

    // Update telegram status count badges
    const connectedUsers = state.users.filter(u => u.telegram_chat_id || u.is_telegram_connected === 1).length;
    const notConnectedUsers = totalUsers - connectedUsers;

    const telegramStatusCountAll = document.getElementById('telegram-status-count-all');
    if (telegramStatusCountAll) telegramStatusCountAll.textContent = totalUsers;

    const telegramStatusCountConnected = document.getElementById('telegram-status-count-connected');
    if (telegramStatusCountConnected) telegramStatusCountConnected.textContent = connectedUsers;

    const telegramStatusCountNotConnected = document.getElementById('telegram-status-count-not-connected');
    if (telegramStatusCountNotConnected) telegramStatusCountNotConnected.textContent = notConnectedUsers;
}

export function renderPendingUsers() {
    // Check if modern requests section exists
    const modernContainer = document.getElementById('pending-users-list');
    if (modernContainer && modernContainer.classList.contains('requests-grid')) {
        // Use modern rendering
        renderModernRequests();
        return;
    }
    
    // Legacy rendering (old style)
    if (!DOM.pendingUsersList || !state.pendingUsers) return;

    if (DOM.requestsCountBadge) {
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
                    <span>Sana: ${user.created_at ? formatDate(user.created_at) : 'Noma\'lum'}</span>
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

export function toggleLocationVisibilityForUserForm() {
    const role = DOM.userRoleSelect?.value;
    
    // Sozlamalar bo'limini ko'rsatish (faqat rol tanlanganda)
    if (DOM.userSettingsGroup) {
        DOM.userSettingsGroup.style.display = role ? 'block' : 'none';
    }
    
    // User-specific sozlamalarni olish
    const requiresLocations = DOM.userRequiresLocations?.value;
    const requiresBrands = DOM.userRequiresBrands?.value;
    
    // Agar user-specific sozlamalar belgilanmagan bo'lsa, rol sozlamalariga qarab
    let locationsDisplay = 'none';
    let brandsDisplay = 'none';
    
    if (requiresLocations === 'true') {
        locationsDisplay = 'block';
    } else if (requiresLocations === 'false') {
        locationsDisplay = 'none';
    } else if (requiresLocations === 'null') {
        locationsDisplay = 'block';
    } else {
        // Rol sozlamalariga qarab
        locationsDisplay = (role === 'operator' || role === 'manager') ? 'block' : 'none';
    }
    
    if (requiresBrands === 'true') {
        brandsDisplay = 'block';
    } else if (requiresBrands === 'false') {
        brandsDisplay = 'none';
    } else if (requiresBrands === 'null') {
        brandsDisplay = 'block';
    } else {
        // Rol sozlamalariga qarab
        brandsDisplay = (role === 'manager') ? 'block' : 'none';
    }
    
    if (DOM.userLocationsGroup) DOM.userLocationsGroup.style.display = locationsDisplay;
    if (DOM.userBrandsGroup) DOM.userBrandsGroup.style.display = brandsDisplay;
    
    // Dual container'larni ko'rsatish/yashirish
    const locationsDualContainer = document.getElementById('locations-dual-container');
    const brandsDualContainer = document.getElementById('brands-dual-container');
    
    // Hozirgi tahrirlanayotgan foydalanuvchi ID'sini olish
    const editingUserId = currentEditingUserId || (DOM.editUserIdInput?.value || null);
    
    if (locationsDualContainer) {
        locationsDualContainer.style.display = locationsDisplay === 'block' ? 'grid' : 'none';
        if (locationsDisplay === 'block') {
            loadLocationsForUser(editingUserId);
        }
    }
    
    if (brandsDualContainer) {
        brandsDualContainer.style.display = brandsDisplay === 'block' ? 'grid' : 'none';
    if (brandsDisplay === 'block') {
            loadBrandsForUser(editingUserId);
        }
    }
}

// Event listener qo'shilganligini tekshirish uchun flag
let approvalRoleSelectListenerAdded = false;

// localStorage'dan user form sozlamalarini yuklash
function loadUserSettingsFromLocalStorage() {
    try {
        const savedSettings = localStorage.getItem('userFormDefaultSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            // Har doim localStorage'dan yuklash (bo'sh bo'lsa ham)
            if (DOM.userRequiresLocations) {
                DOM.userRequiresLocations.value = settings.requires_locations || '';
                debugLog('User form sozlamalari localStorage\'dan yuklandi (Filiallar):', settings.requires_locations || 'bo\'sh');
            }
            if (DOM.userRequiresBrands) {
                DOM.userRequiresBrands.value = settings.requires_brands || '';
                debugLog('User form sozlamalari localStorage\'dan yuklandi (Brendlar):', settings.requires_brands || 'bo\'sh');
            }
        } else {
            // localStorage'da sozlamalar yo'q bo'lsa, default qiymatlar
            if (DOM.userRequiresLocations) DOM.userRequiresLocations.value = '';
            if (DOM.userRequiresBrands) DOM.userRequiresBrands.value = '';
        }
    } catch (error) {
        errorLog('localStorage\'dan yuklashda xatolik:', error);
        // Default qiymatlar
        if (DOM.userRequiresLocations) DOM.userRequiresLocations.value = '';
        if (DOM.userRequiresBrands) DOM.userRequiresBrands.value = '';
    }
}

export async function toggleLocationVisibilityForApprovalForm() {
    const role = DOM.approvalRoleSelect?.value;
    
    // Agar rol tanlanmagan bo'lsa, hech narsa qilmaymiz
    if (!role) {
        return;
    }
    
    // Rol talablarini state'dan olish
    const roleData = state.roles.find(r => r.role_name === role);
    
    // Rol shartlarini tekshirish
    // null = belgilanmagan, true = majburiy, false = kerak emas
    const requiresLocations = roleData ? (roleData.requires_locations !== undefined && roleData.requires_locations !== null ? roleData.requires_locations : null) : null;
    const requiresBrands = roleData ? (roleData.requires_brands !== undefined && roleData.requires_brands !== null ? roleData.requires_brands : null) : null;
    
    // Agar shartlar belgilanmagan bo'lsa (null), filiallar va brendlarni yashirish
    // Agar kamida bitta shart null yoki undefined bo'lsa, shartlar belgilanmagan deb hisoblanadi
    const isLocationsUndefined = (requiresLocations === null || requiresLocations === undefined);
    const isBrandsUndefined = (requiresBrands === null || requiresBrands === undefined);
    const isRequirementsUndefined = isLocationsUndefined || isBrandsUndefined;
    
    const approvalRoleRequirementsGroup = document.getElementById('approval-role-requirements-group');
    const approvalBrandsGroup = document.getElementById('approval-brands-group');
    const submitBtn = document.querySelector('#approval-modal .modal-footer button[form="approval-form"]') || 
                      document.querySelector('#approval-modal .modal-footer button[type="submit"]');
    
    if (isRequirementsUndefined) {
        // Shartlar belgilanmagan - filiallar va brendlarni yashirish
        VisibilityHelper.hide(DOM.approvalLocationsGroup);
        VisibilityHelper.hide(approvalBrandsGroup);
        VisibilityHelper.show(approvalRoleRequirementsGroup);
        
        // Shartlar belgilanmagan bo'limini ko'rsatish
        const requirementsNotSet = document.getElementById('requirements-not-set');
        const requirementsSet = document.getElementById('requirements-set');
        VisibilityHelper.show(requirementsNotSet);
        VisibilityHelper.hide(requirementsSet);
        
        VisibilityHelper.hide(submitBtn);
        
        // Tugma event listener - modal ochish
        const setRequirementsBtn = document.getElementById('set-role-requirements-btn');
        if (setRequirementsBtn) {
            setRequirementsBtn.onclick = () => {
                openRoleRequirementsModal(role, roleData);
            };
            feather.replace();
        }
    } else {
        // Shartlar belgilangan - filiallar va brendlarni ko'rsatish
        if (approvalRoleRequirementsGroup) {
            approvalRoleRequirementsGroup.style.display = 'block';
        }
        
        // Shartlar belgilangan bo'limini ko'rsatish va ma'lumotlarni to'ldirish
        const requirementsNotSet = document.getElementById('requirements-not-set');
        const requirementsSet = document.getElementById('requirements-set');
        const requirementsInfo = document.getElementById('requirements-info');
        
        if (requirementsNotSet) requirementsNotSet.style.display = 'none';
        if (requirementsSet) requirementsSet.style.display = 'block';
        
        // Shartlar ma'lumotlarini ko'rsatish
        if (requirementsInfo && roleData) {
            const requirements = [];
            if (requiresLocations === true) {
                requirements.push('<span style="color: #4facfe;"><i data-feather="check" style="width: 14px; height: 14px; vertical-align: middle;"></i> Filiallar majburiy</span>');
            } else if (requiresLocations === null) {
                requirements.push('<span style="color: rgba(255,255,255,0.6);"><i data-feather="info" style="width: 14px; height: 14px; vertical-align: middle;"></i> Filiallar ixtiyoriy</span>');
            } else {
                requirements.push('<span style="color: rgba(255,255,255,0.4);"><i data-feather="x" style="width: 14px; height: 14px; vertical-align: middle;"></i> Filiallar kerak emas</span>');
            }
            
            if (requiresBrands === true) {
                requirements.push('<span style="color: #4facfe;"><i data-feather="check" style="width: 14px; height: 14px; vertical-align: middle;"></i> Brendlar majburiy</span>');
            } else if (requiresBrands === null) {
                requirements.push('<span style="color: rgba(255,255,255,0.6);"><i data-feather="info" style="width: 14px; height: 14px; vertical-align: middle;"></i> Brendlar ixtiyoriy</span>');
            } else {
                requirements.push('<span style="color: rgba(255,255,255,0.4);"><i data-feather="x" style="width: 14px; height: 14px; vertical-align: middle;"></i> Brendlar kerak emas</span>');
            }
            
            requirementsInfo.innerHTML = requirements.join(' • ');
            feather.replace();
        }
        
        // O'zgartirish tugmasi event listener
        const editRequirementsBtn = document.getElementById('edit-role-requirements-btn');
        if (editRequirementsBtn) {
            editRequirementsBtn.onclick = () => {
                openRoleRequirementsModal(role, roleData);
            };
            feather.replace();
        }
        
        // Tasdiqlash tugmasini faqat shartlar to'g'ri belgilanganda ko'rsatish
        // Shartlar belgilangan bo'lsa, tasdiqlash tugmasini ko'rsatish
        if (submitBtn) {
            submitBtn.style.display = 'block';
        }
        
        // Qaysi shartlar belgilanganligiga qarab ko'rsatish
        // true = majburiy, null = ixtiyoriy (ko'rsatiladi), false = kerak emas (yashiriladi)
        if (requiresLocations === true || requiresLocations === null) {
            // Majburiy yoki ixtiyoriy - ko'rsatish
            if (DOM.approvalLocationsGroup) {
                DOM.approvalLocationsGroup.style.display = 'block';
            }
        } else {
            // false - kerak emas - yashirish
            if (DOM.approvalLocationsGroup) {
                DOM.approvalLocationsGroup.style.display = 'none';
            }
        }
        
        if (requiresBrands === true || requiresBrands === null) {
            // Majburiy yoki ixtiyoriy - ko'rsatish
            if (approvalBrandsGroup) {
                approvalBrandsGroup.style.display = 'block';
            }
        } else {
            // false - kerak emas - yashirish
            if (approvalBrandsGroup) {
                approvalBrandsGroup.style.display = 'none';
            }
        }
    }
    
    // "O'tkazib yuborish" tugmalarini yashirish (olib tashlandi)
    const skipLocationsBtn = document.getElementById('skip-locations-btn');
    const skipBrandsBtn = document.getElementById('skip-brands-btn');
    const skipAllBtn = document.getElementById('skip-all-btn');
    const backToRoleBtn = document.getElementById('back-to-role-btn');
    const backToLocationsBtn = document.getElementById('back-to-locations-btn');
    
    // Tugmalarni yashirish
    if (skipLocationsBtn) skipLocationsBtn.style.display = 'none';
    if (skipBrandsBtn) skipBrandsBtn.style.display = 'none';
    if (skipAllBtn) skipAllBtn.style.display = 'none';
    if (backToRoleBtn) backToRoleBtn.style.display = 'none';
    if (backToLocationsBtn) backToLocationsBtn.style.display = 'none';
    
    // Agar shartlar belgilangan bo'lsa, filiallar va brendlarni yuklash
    if (!isRequirementsUndefined) {
        await loadLocationsForApproval();
        await loadBrandsForApproval();
    }
    
    // State'ga saqlash (submitUserApproval uchun)
    window.approvalSkipLocations = false;
    window.approvalSkipBrands = false;
}

async function loadLocationsForApproval() {
    try {
        const settingsRes = await safeFetch('/api/settings');
        if (!settingsRes.ok) {
            errorLog('Settings API xatolik. Status:', settingsRes.status);
            throw new Error('Sozlamalarni yuklashda xatolik');
        }
        const settings = await settingsRes.json();
        const locations = settings.app_settings?.locations || [];
        
        if (DOM.approvalLocationsCheckboxList) {
            if (locations.length === 0) {
                DOM.approvalLocationsCheckboxList.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: rgba(255,255,255,0.5);">
                        <i data-feather="alert-circle" style="width: 48px; height: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
                        <p style="margin: 0; font-size: 14px;">⚠️ Tizimda filiallar mavjud emas. Avval filiallar yarating.</p>
                    </div>
                `;
                feather.replace();
            } else {
                // Zamonaviy card ko'rinishida render qilish
                DOM.approvalLocationsCheckboxList.innerHTML = locations.map((loc, index) => `
                    <label class="location-card-approval" data-location="${loc}" style="
                        display: flex;
                        align-items: center;
                        padding: 12px 16px;
                        background: rgba(255,255,255,0.05);
                        border: 2px solid rgba(255,255,255,0.1);
                        border-radius: 10px;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        margin-bottom: 10px;
                        position: relative;
                        overflow: hidden;
                    ">
                        <input type="checkbox" value="${loc}" name="approval-location" 
                            style="
                                width: 20px;
                                height: 20px;
                                margin-right: 12px;
                                cursor: pointer;
                                accent-color: #4facfe;
                            ">
                        <div style="flex: 1; display: flex; align-items: center; gap: 10px;">
                            <div style="
                                width: 40px;
                                height: 40px;
                                border-radius: 8px;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                font-weight: 700;
                                font-size: 16px;
                                color: #fff;
                                flex-shrink: 0;
                            ">${loc.charAt(0).toUpperCase()}</div>
                            <div style="flex: 1;">
                                <div style="font-weight: 600; font-size: 14px; color: rgba(255,255,255,0.9); margin-bottom: 2px;">${loc}</div>
                                <div style="font-size: 12px; color: rgba(255,255,255,0.5);">Filial</div>
                            </div>
                            <div class="location-check-icon" style="
                                width: 24px;
                                height: 24px;
                                border-radius: 50%;
                                background: #4facfe;
                                display: none;
                                align-items: center;
                                justify-content: center;
                                color: #fff;
                                font-size: 14px;
                            ">
                                <i data-feather="check" style="width: 16px; height: 16px;"></i>
                            </div>
                        </div>
                    </label>
                `).join('');
                
                feather.replace();
                // Event listenerlarni qo'shish
                setupApprovalLocationsInteractivity();
            }
        }
    } catch (error) {
        errorLog('Filiallarni yuklashda xatolik:', error);
        if (DOM.approvalLocationsCheckboxList) {
            DOM.approvalLocationsCheckboxList.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #ff6b6b;">
                    <i data-feather="alert-triangle" style="width: 48px; height: 48px; margin-bottom: 10px;"></i>
                    <p style="margin: 0; font-size: 14px;">⚠️ Xatolik: ${error.message}</p>
                </div>
            `;
            feather.replace();
        }
    }
}

// Filiallar interaktivligini sozlash
function setupApprovalLocationsInteractivity() {
    // Qidiruv funksiyasi
    const searchInput = document.getElementById('approval-locations-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            const locationCards = document.querySelectorAll('.location-card-approval');
            
            locationCards.forEach(card => {
                const locationName = card.dataset.location.toLowerCase();
                if (locationName.includes(searchTerm)) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    }
    
    // Checkbox o'zgarganda card ko'rinishini yangilash
    const checkboxes = document.querySelectorAll('#approval-locations-checkbox-list input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const card = e.target.closest('.location-card-approval');
            const checkIcon = card?.querySelector('.location-check-icon');
            
            if (e.target.checked) {
                card.style.background = 'rgba(79, 172, 254, 0.15)';
                card.style.borderColor = '#4facfe';
                if (checkIcon) checkIcon.style.display = 'flex';
            } else {
                card.style.background = 'rgba(255,255,255,0.05)';
                card.style.borderColor = 'rgba(255,255,255,0.1)';
                if (checkIcon) checkIcon.style.display = 'none';
            }
            
            updateApprovalLocationsCount();
            feather.replace();
        });
        
        // Hover effekti
        const card = checkbox.closest('.location-card-approval');
        if (card) {
            card.addEventListener('mouseenter', () => {
                if (!checkbox.checked) {
                    card.style.background = 'rgba(255,255,255,0.08)';
                    card.style.borderColor = 'rgba(255,255,255,0.2)';
                    card.style.transform = 'translateY(-2px)';
                }
            });
            
            card.addEventListener('mouseleave', () => {
                if (!checkbox.checked) {
                    card.style.background = 'rgba(255,255,255,0.05)';
                    card.style.borderColor = 'rgba(255,255,255,0.1)';
                    card.style.transform = 'translateY(0)';
                }
            });
        }
    });
    
    // Barchasini tanlash
    const selectAllBtn = document.getElementById('select-all-locations-approval');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            const visibleCheckboxes = Array.from(checkboxes).filter(cb => {
                const card = cb.closest('.location-card-approval');
                return card && card.style.display !== 'none';
            });
            
            const allChecked = visibleCheckboxes.every(cb => cb.checked);
            
            visibleCheckboxes.forEach(cb => {
                cb.checked = !allChecked;
                const card = cb.closest('.location-card-approval');
                const checkIcon = card?.querySelector('.location-check-icon');
                
                if (!allChecked) {
                    card.style.background = 'rgba(79, 172, 254, 0.15)';
                    card.style.borderColor = '#4facfe';
                    if (checkIcon) checkIcon.style.display = 'flex';
                } else {
                    card.style.background = 'rgba(255,255,255,0.05)';
                    card.style.borderColor = 'rgba(255,255,255,0.1)';
                    if (checkIcon) checkIcon.style.display = 'none';
                }
            });
            
            updateApprovalLocationsCount();
            feather.replace();
        });
    }
    
    // Barchasini tozalash
    const clearAllBtn = document.getElementById('clear-all-locations-approval');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            checkboxes.forEach(cb => {
                cb.checked = false;
                const card = cb.closest('.location-card-approval');
                const checkIcon = card?.querySelector('.location-check-icon');
                
                card.style.background = 'rgba(255,255,255,0.05)';
                card.style.borderColor = 'rgba(255,255,255,0.1)';
                if (checkIcon) checkIcon.style.display = 'none';
            });
            
            updateApprovalLocationsCount();
            feather.replace();
        });
    }
    
    // Tanlanganlar sonini yangilash
    updateApprovalLocationsCount();
}

// Tanlangan filiallar sonini yangilash
function updateApprovalLocationsCount() {
    const countElement = document.getElementById('selected-locations-count');
    if (countElement) {
        const checkedCount = document.querySelectorAll('#approval-locations-checkbox-list input[type="checkbox"]:checked').length;
        const totalCount = document.querySelectorAll('#approval-locations-checkbox-list input[type="checkbox"]').length;
        countElement.textContent = `Tanlangan: ${checkedCount} / ${totalCount}`;
        
        if (checkedCount > 0) {
            countElement.style.color = '#4facfe';
            countElement.style.fontWeight = '600';
        } else {
            countElement.style.color = 'rgba(255,255,255,0.6)';
            countElement.style.fontWeight = '400';
        }
    }
}

async function loadBrandsForApproval() {
    try {
        const res = await safeFetch('/api/brands');
        
        if (!res.ok) {
            const errorText = await res.text();
            errorLog('Brendlar API xatolik. Status:', res.status);
            throw new Error(`Brendlarni yuklashda xatolik: ${res.status}`);
        }
        
        const allBrands = await res.json();
        
        if (!Array.isArray(allBrands)) {
            errorLog('Brendlar array emas! Type:', typeof allBrands);
            throw new Error('Brendlar array formatida emas');
        }
        
        if (allBrands.length === 0) {
            debugLog('Brendlar ro\'yxati bo\'sh');
        }
        
        const approvalBrandsList = document.getElementById('approval-brands-list');
        if (approvalBrandsList) {
            if (allBrands.length === 0) {
                approvalBrandsList.innerHTML = '<p style="color: #ff6b6b; padding: 10px;">⚠️ Tizimda brendlar mavjud emas. Avval brendlar yarating.</p>';
            } else {
                // Grid ko'rinishda brendlar
                approvalBrandsList.className = 'checkbox-grid';
                approvalBrandsList.style.display = 'flex';
                approvalBrandsList.style.flexWrap = 'wrap';
                approvalBrandsList.style.gap = '10px';
                approvalBrandsList.style.padding = '10px';
                
                approvalBrandsList.innerHTML = allBrands.map(brand => `
                    <label class="checkbox-item" style="
                        display: flex;
                        align-items: center;
                        padding: 10px 15px;
                        border-radius: 8px;
                        cursor: pointer;
                        background: rgba(255, 255, 255, 0.05);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        transition: all 0.2s ease;
                        min-width: 120px;
                        flex: 0 1 auto;
                    " onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.borderColor='rgba(102,126,234,0.5)';" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)';">
                        <input type="checkbox" value="${brand.id}" name="approval-brand" 
                            style="margin-right: 8px; width: 18px; height: 18px; cursor: pointer;">
                        <span style="font-size: 18px; margin-right: 6px;">${brand.emoji || '🏷️'}</span>
                        <span style="font-size: 14px; color: #fff;">${brand.name}</span>
                    </label>
                `).join('');
            }
        }
    } catch (error) {
        errorLog('Brendlarni yuklashda xatolik:', error);
        const approvalBrandsList = document.getElementById('approval-brands-list');
        if (approvalBrandsList) {
            approvalBrandsList.innerHTML = `<p style="color: #ff6b6b; padding: 10px;">⚠️ Xatolik: ${error.message}</p>`;
        }
    }
}

export async function openUserModalForAdd() {
    // Modal instance olish yoki yaratish
    if (!userModalInstance) {
        userModalInstance = getModal('user-form-modal', {
            onOpen: async (data, instance) => {
                await executeOpenUserModalForAdd(instance);
            },
            onClose: (instance) => {
                currentEditingUserId = null;
                // Form'ni tozalash
                if (DOM.userForm) {
                    DOM.userForm.reset();
                }
            }
        });
    }
    
    // Modal ochish
    await openModal('user-form-modal', {});
}

async function executeOpenUserModalForAdd(modalInstance) {
    DOM.userForm?.reset();
    if (DOM.editUserIdInput) DOM.editUserIdInput.value = '';
    if (DOM.userModalTitle) DOM.userModalTitle.textContent = 'Yangi Foydalanuvchi Qo\'shish';
    if (DOM.passwordGroup) DOM.passwordGroup.style.display = 'block';
    if (DOM.passwordInput) DOM.passwordInput.required = true;
    if (DOM.userRoleSelect) {
        if (!state.roles || !Array.isArray(state.roles)) {
            DOM.userRoleSelect.innerHTML = '<option value="">Rollar yuklanmoqda...</option>';
        } else {
            DOM.userRoleSelect.innerHTML = state.roles
                .filter(r => r.role_name !== 'admin' && r.role_name !== 'superadmin' && r.role_name !== 'super_admin') // Admin va superadmin yaratish mumkin emas
                .map(r => 
                    `<option value="${r.role_name}">${r.role_name}</option>`
                ).join('');
        }
    }
    
    // Tanlangan filiallar va brendlarni tozalash
    updateSelectedLocationsDisplay([]);
    updateSelectedBrandsDisplay([]);
    
    // Event listener'larni qo'shish
    setupLocationBrandSelectors();
    
    // Tanlangan filiallar va brendlarni tozalash
    updateSelectedLocationsDisplay([]);
    updateSelectedBrandsDisplay([]);
    
    // Event listener'larni qo'shish
    setupLocationBrandSelectors();
    
    // Sozlamalarni localStorage'dan yuklash (yangi foydalanuvchi uchun)
    loadUserSettingsFromLocalStorage();
    
    // Rol tanlanganda sozlamalar bo'limini ko'rsatish
    if (DOM.userRoleSelect) {
        // Eski event listenerlarni olib tashlash
        const newSelect = DOM.userRoleSelect.cloneNode(true);
        DOM.userRoleSelect.parentNode.replaceChild(newSelect, DOM.userRoleSelect);
        DOM.userRoleSelect = newSelect;
        
        DOM.userRoleSelect.addEventListener('change', toggleLocationVisibilityForUserForm);
    }
    
    toggleLocationVisibilityForUserForm();
    
    // Feather icons
    if (window.feather) {
        window.feather.replace();
    }
}

// User modal instance - har bir foydalanuvchi uchun alohida
let userModalInstance = null;
let currentEditingUserId = null;
let isOpeningUserModal = false;
let userModalTimeout = null;

export async function openUserModalForEdit(userId) {
    // Agar bir xil foydalanuvchi tahrirlanmoqda bo'lsa, qayta ochmaslik
    if (currentEditingUserId === userId && userModalInstance && userModalInstance.isOpen) {
        log.debug('User modal allaqachon ochilgan:', userId);
        return;
    }
    
    // Agar modal ochilmoqda bo'lsa, qayta ochmaslik
    if (isOpeningUserModal) {
        log.debug('User modal ochilmoqda, qayta ochilmaydi');
        return;
    }
    
    // Debounce - qisqa vaqt ichida bir necha marta chaqirilganda, faqat oxirgisi ishlaydi
    if (userModalTimeout) {
        clearTimeout(userModalTimeout);
    }
    
    userModalTimeout = setTimeout(async () => {
        userModalTimeout = null;
        isOpeningUserModal = true;
        
        try {
            // Modal instance olish yoki yaratish
            if (!userModalInstance) {
                userModalInstance = getModal('user-form-modal', {
                    onOpen: async (data, instance) => {
                        await executeOpenUserModalForEdit(data.userId, instance);
                    },
                    onClose: async (instance) => {
                        currentEditingUserId = null;
                        isOpeningUserModal = false;
                        
                        // Form'ni tozalash
                        if (DOM.userForm) {
                            DOM.userForm.reset();
                        }
                        
                        // Checkbox container'larni yashirish
                        const locationsContainer = document.getElementById('locations-checkbox-container');
                        const brandsContainer = document.getElementById('brands-checkbox-container');
                        if (locationsContainer) locationsContainer.style.display = 'none';
                        if (brandsContainer) brandsContainer.style.display = 'none';
                        
                        // Tanlangan filial va brendlarni tozalash
                        updateSelectedLocationsDisplay([]);
                        updateSelectedBrandsDisplay([]);
                        
                        // "Barchasini belgilash" checkbox'larni tozalash
                        const selectAllLocations = document.getElementById('select-all-locations-checkbox');
                        const selectAllBrands = document.getElementById('select-all-brands-checkbox');
                        if (selectAllLocations) selectAllLocations.checked = false;
                        if (selectAllBrands) selectAllBrands.checked = false;
                        
                        // Superadmin Telegram bo'limini tozalash
                        const telegramSection = document.getElementById('superadmin-telegram-section');
                        if (telegramSection) {
                            telegramSection.remove();
                        }
                    }
                });
            }
            
            // Modal ochish
            await openModal('user-form-modal', { userId });
            isOpeningUserModal = false;
        } catch (error) {
            log.error('User modal ochishda xatolik:', error);
            isOpeningUserModal = false;
        }
    }, 150); // 150ms debounce
}

async function executeOpenUserModalForEdit(userId, modalInstance) {
    log.debug('openUserModalForEdit chaqirildi - User ID:', userId);
    const user = state.users.find(u => u.id == userId);
    if (!user || !DOM.userForm) {
        log.warn('Foydalanuvchi topilmadi yoki form mavjud emas');
        if (modalInstance) {
            await modalInstance.close();
        }
        return;
    }
    
    currentEditingUserId = userId;
    
    log.debug('Foydalanuvchi ma\'lumotlari:', {
        id: user.id,
        username: user.username,
        currentRole: user.role,
        currentUserRole: state.currentUser?.role
    });
    
    DOM.userForm.reset();
    DOM.editUserIdInput.value = user.id;
    DOM.userModalTitle.textContent = `"${user.username}"ni Tahrirlash`;
    DOM.usernameInput.value = user.username;
    DOM.fullnameInput.value = user.fullname || '';
    DOM.passwordGroup.style.display = 'none';
    DOM.passwordInput.required = false;
    
    // Superadmin rolini to'liq olib tashlash va superadmin tomonidan yaratilgan barcha rollarga o'zgartirish imkoniyati
    const isCurrentUserSuperadmin = state.currentUser?.role === 'superadmin' || state.currentUser?.role === 'super_admin';
    const isEditingSuperadmin = user.role === 'superadmin' || user.role === 'super_admin';
    const isEditingSelf = parseInt(userId) === parseInt(state.currentUser?.id);
    const isSuperadminEditingSelf = isCurrentUserSuperadmin && isEditingSuperadmin && isEditingSelf;
    
    debugLog('Rol tekshiruvi:', {
        isCurrentUserSuperadmin,
        isEditingSuperadmin,
        isEditingSelf,
        isSuperadminEditingSelf,
        currentUserRole: state.currentUser?.role,
        editingUserRole: user.role
    });
    
    if (!state.roles || !Array.isArray(state.roles)) {
        DOM.userRoleSelect.innerHTML = `<option value="${user.role || ''}" selected>${user.role || 'Rollar yuklanmoqda...'}</option>`;
    } else {
        // Superadmin rolini to'liq olib tashlash (ham superadmin, ham super_admin)
        // Agar joriy foydalanuvchi superadmin bo'lsa va superadminni tahrirlamayotgan bo'lsa,
        // barcha rollarni ko'rsatish (superadmin va super_admin dan tashqari)
        let filteredRoles = state.roles;
        
        if (isEditingSuperadmin) {
            // Superadminni tahrirlashda - faqat joriy rolini ko'rsatish, o'zgartirish mumkin emas
            debugLog('Superadminni tahrirlash - rol o\'zgartirish mumkin emas');
            filteredRoles = state.roles.filter(r => r.role_name === user.role);
        } else if (isCurrentUserSuperadmin) {
            // Superadmin tomonidan yaratilgan barcha rollarga o'zgartirish imkoniyati
            // Superadmin va super_admin dan tashqari barcha rollarni ko'rsatish
            debugLog('Superadmin tomonidan - barcha rollarga o\'zgartirish imkoniyati');
            filteredRoles = state.roles.filter(r => 
                r.role_name !== 'superadmin' && r.role_name !== 'super_admin'
            );
        } else {
            // Boshqa foydalanuvchilar uchun - admin va superadmin olib tashlash
            debugLog('Oddiy foydalanuvchi - admin va superadmin olib tashlangan');
            filteredRoles = state.roles.filter(r => 
                r.role_name !== 'admin' && r.role_name !== 'superadmin' && r.role_name !== 'super_admin'
            );
        }
        
        debugLog('Ko\'rsatiladigan rollar:', filteredRoles.map(r => r.role_name));
        
        DOM.userRoleSelect.innerHTML = filteredRoles
            .map(r => 
                `<option value="${r.role_name}" ${user.role === r.role_name ? 'selected' : ''}>${r.role_name}</option>`
            ).join('');
        
        // Agar superadminni tahrirlashda bo'lsa, rol select'ni disabled qilish
        if (isEditingSuperadmin) {
            DOM.userRoleSelect.disabled = true;
            debugLog('Rol select disabled qilindi (superadmin)');
        } else {
            DOM.userRoleSelect.disabled = false;
        }
    }
    
    // Superadmin o'zini tahrirlayotgan bo'lsa, login, to'liq ism, parol, Telegram bog'lanish va qurulma soni o'zgartirish imkoniyati
    if (isSuperadminEditingSelf) {
        console.log(`🔧 [USERS] Superadmin o'zini tahrirlayapti - login, to'liq ism, parol, Telegram bog'lanish va qurulma soni o'zgartirish mumkin`);
        
        // Rol select'ni yashirish
        if (DOM.userRoleSelect && DOM.userRoleSelect.parentElement) {
            DOM.userRoleSelect.parentElement.style.display = 'none';
        }
        
        // Device limit'ni ko'rsatish (superadmin o'zini tahrirlashda)
        if (DOM.deviceLimitInput && DOM.deviceLimitInput.closest('.form-group')) {
            DOM.deviceLimitInput.closest('.form-group').style.display = 'block';
            DOM.deviceLimitInput.value = user.device_limit || '';
        }
        
        // User-specific sozlamalarni yashirish (filial va brendlar)
        if (DOM.userSettingsGroup) {
            DOM.userSettingsGroup.style.display = 'none';
        }
        if (DOM.userLocationsGroup) {
            DOM.userLocationsGroup.style.display = 'none';
        }
        if (DOM.userBrandsGroup) {
            DOM.userBrandsGroup.style.display = 'none';
        }
        
        // Parol o'zgartirish imkoniyatini ko'rsatish
        DOM.passwordGroup.style.display = 'block';
        DOM.passwordInput.required = false; // Parol ixtiyoriy (o'zgartirish uchun)
        DOM.passwordInput.placeholder = 'Yangi parol (ixtiyoriy)';
        
        // Telegram bog'lanish bo'limini ko'rsatish (superadmin uchun ixtiyoriy)
        setTimeout(() => {
            const telegramSection = document.getElementById('superadmin-telegram-section');
            if (!telegramSection) {
                // Telegram bog'lanish bo'limini yaratish
                const passwordGroup = DOM.passwordGroup;
                if (passwordGroup && passwordGroup.parentElement) {
                    const telegramHtml = `
                        <div id="superadmin-telegram-section" class="form-group" style="margin-top: 20px; padding: 20px; background: rgba(79, 172, 254, 0.1); border-radius: 8px; border: 1px solid rgba(79, 172, 254, 0.3);">
                            <label style="display: block; margin-bottom: 15px; font-weight: 600; color: #4facfe;">
                                <i data-feather="send"></i> Telegram Bog'lanish (Ixtiyoriy)
                            </label>
                            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                                ${user.telegram_chat_id ? `
                                    <div style="flex: 1; min-width: 200px;">
                                        <div style="padding: 12px; background: rgba(16, 185, 129, 0.1); border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.3);">
                                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                                <i data-feather="check-circle" style="color: #10b981;"></i>
                                                <span style="font-weight: 600; color: #10b981;">Ulangan</span>
                                            </div>
                                            <div style="font-size: 12px; color: rgba(255,255,255,0.7);">
                                                Chat ID: ${user.telegram_chat_id}<br>
                                                ${user.telegram_username ? `Username: @${user.telegram_username}` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <button type="button" id="superadmin-disconnect-telegram-btn" class="btn btn-danger" style="padding: 12px 20px;">
                                        <i data-feather="unlink"></i> Obunani bekor qilish
                                    </button>
                                ` : `
                                    <button type="button" id="superadmin-connect-telegram-btn" class="btn btn-primary" style="padding: 12px 20px;">
                                        <i data-feather="link"></i> Telegram'ga ulanish
                                    </button>
                                `}
                            </div>
                            <div style="margin-top: 10px; font-size: 12px; color: rgba(255,255,255,0.6);">
                                <i data-feather="info"></i> Telegram'ga ulanish ixtiyoriy. Agar ulanmasangiz ham tizimdan foydalana olasiz.
                            </div>
                        </div>
                    `;
                    passwordGroup.insertAdjacentHTML('afterend', telegramHtml);
                    
                    // Feather icons
                    if (window.feather) {
                        window.feather.replace();
                    }
                    
                    // Event listener'lar
                    const connectBtn = document.getElementById('superadmin-connect-telegram-btn');
                    const disconnectBtn = document.getElementById('superadmin-disconnect-telegram-btn');
                    
                    if (connectBtn) {
                        connectBtn.addEventListener('click', async () => {
                            await handleGenerateTelegramLink(userId, user.username);
                        });
                    }
                    
                    if (disconnectBtn) {
                        disconnectBtn.addEventListener('click', async () => {
                            await handleClearTelegram(userId, user.username);
                            // Modal'ni yangilash
                            await executeOpenUserModalForEdit(userId, modalInstance);
                        });
                    }
                }
            } else {
                // Agar allaqachon mavjud bo'lsa, yangilash
                const connectBtn = document.getElementById('superadmin-connect-telegram-btn');
                const disconnectBtn = document.getElementById('superadmin-disconnect-telegram-btn');
                
                if (user.telegram_chat_id) {
                    if (connectBtn) connectBtn.style.display = 'none';
                    if (disconnectBtn) disconnectBtn.style.display = 'block';
                } else {
                    if (connectBtn) connectBtn.style.display = 'block';
                    if (disconnectBtn) disconnectBtn.style.display = 'none';
                }
            }
        }, 100);
    } else {
        DOM.deviceLimitInput.value = user.device_limit;
        
        // User-specific sozlamalarni yuklash
        let settingsLoaded = false;
        try {
            const settingsRes = await safeFetch(`/api/users/${userId}/settings`);
            if (settingsRes && settingsRes.ok) {
                const settings = await settingsRes.json();
                // Agar database'da sozlamalar mavjud bo'lsa, ularni ishlatish
                if (settings.requires_locations !== null && settings.requires_locations !== undefined) {
                    if (DOM.userRequiresLocations) {
                        DOM.userRequiresLocations.value = settings.requires_locations === null ? 'null' : 
                            settings.requires_locations === true ? 'true' : 
                            settings.requires_locations === false ? 'false' : '';
                    }
                    settingsLoaded = true;
                }
                if (settings.requires_brands !== null && settings.requires_brands !== undefined) {
                    if (DOM.userRequiresBrands) {
                        DOM.userRequiresBrands.value = settings.requires_brands === null ? 'null' : 
                            settings.requires_brands === true ? 'true' : 
                            settings.requires_brands === false ? 'false' : '';
                    }
                    settingsLoaded = true;
                }
            }
        } catch (error) {
            errorLog('User settings yuklanmadi:', error);
        }
        
        // Agar database'dan sozlamalar yuklanmagan bo'lsa, localStorage'dan yuklash
        if (!settingsLoaded) {
            loadUserSettingsFromLocalStorage();
        }
        
        // Rol tanlanganda sozlamalar bo'limini ko'rsatish
        if (DOM.userRoleSelect) {
            // Eski event listener'larni olib tashlash (cloneNode orqali)
            const oldSelect = DOM.userRoleSelect;
            const newSelect = oldSelect.cloneNode(true);
            oldSelect.parentNode.replaceChild(newSelect, oldSelect);
            DOM.userRoleSelect = newSelect;
            
            // Yangi event listener qo'shish
            DOM.userRoleSelect.addEventListener('change', toggleLocationVisibilityForUserForm);
        }
        
        toggleLocationVisibilityForUserForm();
        
        // Filial va brendlar toggleLocationVisibilityForUserForm orqali yuklanadi
        
        // User-specific sozlamalar dropdown'lariga change event listener qo'shish
        // setTimeout ichida qo'shish - DOM elementlari to'liq yuklangandan keyin
        setTimeout(() => {
            // DOM elementlarini qayta yuklash (modal ochilgandan keyin)
            DOM.userRequiresLocations = document.getElementById('user-requires-locations');
            DOM.userRequiresBrands = document.getElementById('user-requires-brands');
            
            if (DOM.userRequiresLocations) {
                // Eski event listener'larni olib tashlash (cloneNode orqali)
                const oldLocationsSelect = DOM.userRequiresLocations;
                const newLocationsSelect = oldLocationsSelect.cloneNode(true);
                oldLocationsSelect.parentNode.replaceChild(newLocationsSelect, oldLocationsSelect);
                DOM.userRequiresLocations = newLocationsSelect;
                
                // Yangi event listener qo'shish
                DOM.userRequiresLocations.addEventListener('change', toggleLocationVisibilityForUserForm);
                console.log('✅ [EDIT_MODAL] userRequiresLocations change event listener qo\'shildi');
            } else {
                console.warn('⚠️ [EDIT_MODAL] userRequiresLocations element topilmadi');
            }
            
            if (DOM.userRequiresBrands) {
                // Eski event listener'larni olib tashlash (cloneNode orqali)
                const oldBrandsSelect = DOM.userRequiresBrands;
                const newBrandsSelect = oldBrandsSelect.cloneNode(true);
                oldBrandsSelect.parentNode.replaceChild(newBrandsSelect, oldBrandsSelect);
                DOM.userRequiresBrands = newBrandsSelect;
                
                // Yangi event listener qo'shish
                DOM.userRequiresBrands.addEventListener('change', toggleLocationVisibilityForUserForm);
                console.log('✅ [EDIT_MODAL] userRequiresBrands change event listener qo\'shildi');
            } else {
                console.warn('⚠️ [EDIT_MODAL] userRequiresBrands element topilmadi');
            }
        }, 100);
    }
    
    // Event listener'larni qo'shish - modal ochilgandan keyin
    // Button'lar DOM'da mavjudligini ta'minlash uchun kichik kechikish
    setTimeout(() => {
        console.log('🔧 [EDIT_MODAL] setupLocationBrandSelectors chaqirilmoqda...');
        setupLocationBrandSelectors();
        console.log('✅ [EDIT_MODAL] setupLocationBrandSelectors chaqirildi');
        
        // Button'larni tekshirish
        const selectLocationsBtn = document.getElementById('select-locations-btn');
        const selectBrandsBtn = document.getElementById('select-brands-btn');
        console.log('🔍 [EDIT_MODAL] Button tekshiruvi (setTimeout dan keyin):', {
            selectLocationsBtn: !!selectLocationsBtn,
            selectBrandsBtn: !!selectBrandsBtn,
            selectLocationsBtnId: selectLocationsBtn?.id,
            selectBrandsBtnId: selectBrandsBtn?.id,
            selectLocationsBtnParent: selectLocationsBtn?.parentElement?.id,
            selectBrandsBtnParent: selectBrandsBtn?.parentElement?.id
        });
    }, 50);
    
    // Feather icons
    if (window.feather) {
        window.feather.replace();
    }
}

// Tanlangan filiallarni ko'rsatish
function updateSelectedLocationsDisplay(selectedLocations) {
    const display = document.getElementById('selected-locations-display');
    if (!display) return;
    
    if (!selectedLocations || selectedLocations.length === 0) {
        display.innerHTML = '<div class="empty-selection">Filiallar tanlanmagan</div>';
        return;
    }
    
    display.innerHTML = selectedLocations.map(loc => `
        <div class="selected-item-tag">
            <div class="tag-content">
                <span class="tag-icon">📍</span>
                <span class="tag-text">${loc}</span>
            </div>
            <button type="button" class="remove-btn" onclick="removeLocation('${loc}')" title="O'chirish">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"/>
                </svg>
            </button>
        </div>
    `).join('');
}

// Tanlangan brendlarni ko'rsatish
function updateSelectedBrandsDisplay(selectedBrands) {
    const display = document.getElementById('selected-brands-display');
    if (!display) return;
    
    if (!selectedBrands || selectedBrands.length === 0) {
        display.innerHTML = '<div class="empty-selection">Brendlar tanlanmagan</div>';
        return;
    }
    
    display.innerHTML = selectedBrands.map(brand => `
        <div class="selected-item-tag">
            <div class="tag-content">
                <span class="tag-icon">${brand.emoji || '🏢'}</span>
                <span class="tag-text">${brand.name}</span>
            </div>
            <button type="button" class="remove-btn" onclick="removeBrand(${brand.id})" title="O'chirish">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293 5.354 4.646z"/>
                </svg>
            </button>
        </div>
    `).join('');
}

// Filiallarni o'chirish
window.removeLocation = function(location) {
    const checkbox = document.querySelector(`#locations-checkbox-list input[value="${location}"]`);
    if (checkbox) checkbox.checked = false;
    
    const selectedLocations = Array.from(document.querySelectorAll('#locations-checkbox-list input:checked'))
        .map(cb => cb.value);
    updateSelectedLocationsDisplay(selectedLocations);
};

// Brendlarni o'chirish
window.removeBrand = function(brandId) {
    // Modal ichidagi checkbox'ni yangilash
    const modalCheckbox = document.querySelector(`#brands-modal-list input[value="${brandId}"]`);
    if (modalCheckbox) {
        modalCheckbox.checked = false;
        const item = modalCheckbox.closest('.modal-list-item');
        if (item) item.classList.remove('selected');
    }
    
    // Tanlangan brendlarni yangilash
    const selectedBrandIds = Array.from(document.querySelectorAll('#brands-modal-list input:checked'))
        .map(cb => parseInt(cb.closest('.modal-list-item').dataset.brandId));
    
    // Brendlar ma'lumotlarini olish va ko'rsatish
    safeFetch('/api/brands').then(res => {
        if (res && res.ok) {
            return res.json();
        }
        return [];
    }).then(brands => {
        const selectedBrands = brands
            .filter(b => selectedBrandIds.includes(b.id))
            .map(brand => ({
                id: brand.id,
                name: brand.name,
                emoji: brand.emoji || '🏢'
            }));
        updateSelectedBrandsDisplay(selectedBrands);
    }).catch(error => {
        console.error('Brendlarni yuklashda xatolik:', error);
    });
};

// Filiallar va brendlar selector'larini sozlash (inline checkbox'lar uchun)
function setupLocationBrandSelectors() {
    log.debug('setupLocationBrandSelectors chaqirildi');
    // Endi qidiruv input'lari yo'q, faqat "Barchasini belgilash" checkbox'lari bor
    // Ular loadLocationsForUser va loadBrandsForUser funksiyalarida sozlanadi
}

// Filiallar tanlash modal'ini ochish
async function openLocationsSelectModal() {
    debugLog('openLocationsSelectModal chaqirildi');
    
    // Funksiyani global qilish (xatolikdan keyin qayta yuklash uchun)
    if (!window.openLocationsSelectModal) {
        window.openLocationsSelectModal = openLocationsSelectModal;
        debugLog('Funksiya global qilindi');
    }
    
    const modal = document.getElementById('locations-select-modal');
    const list = document.getElementById('locations-modal-list');
    const searchInput = document.getElementById('locations-search-input');
    
    debugLog('Modal elementlari tekshirilmoqda');
    
    if (!modal || !list) {
        errorLog('Modal yoki list elementlari topilmadi!');
        return;
    }
    
    // Hozirgi tanlangan filiallarni olish - selected-locations-display dan
    const selectedLocationsDisplay = document.getElementById('selected-locations-display');
    const selectedLocations = [];
    if (selectedLocationsDisplay) {
        selectedLocationsDisplay.querySelectorAll('.selected-item-tag').forEach(tag => {
            const locationName = tag.querySelector('.tag-text')?.textContent;
            if (locationName) {
                selectedLocations.push(locationName);
            }
        });
    }
    
    // Filiallarni yuklash - agar brend tanlangan bo'lsa, faqat shu brenddagi filiallarni ko'rsatish
    try {
        // Hozirgi tanlangan brendlarni olish - agar brend tanlangan bo'lsa, faqat shu brenddagi filiallarni ko'rsatish
        const selectedBrandsDisplay = document.getElementById('selected-brands-display');
        const selectedBrandIds = [];
        if (selectedBrandsDisplay) {
            selectedBrandsDisplay.querySelectorAll('.selected-item-tag').forEach(tag => {
                const removeBtn = tag.querySelector('.remove-btn');
                if (removeBtn) {
                    const onclickStr = removeBtn.getAttribute('onclick') || '';
                    const match = onclickStr.match(/removeBrand\((\d+)\)/);
                    if (match) {
                        selectedBrandIds.push(parseInt(match[1]));
                    }
                }
            });
        }
        
        let locations = [];
        if (selectedBrandIds.length > 0 && selectedLocations.length === 0) {
            // Brend tanlangan, filial tanlanmagan - faqat tanlangan brendlardagi filiallarni olish
            console.log(`🔍 [USERS] Brend tanlangan (${selectedBrandIds.length} ta), faqat shu brendlardagi filiallarni yuklayapman...`);
            const allLocationsSet = new Set();
            for (const brandId of selectedBrandIds) {
                const res = await safeFetch(`/api/brands/${brandId}/locations`);
                if (res && res.ok) {
                    const brandLocations = await res.json();
                    brandLocations.forEach(loc => allLocationsSet.add(loc));
                }
            }
            locations = Array.from(allLocationsSet);
            debugLog(`${locations.length} ta filial topildi (tanlangan brendlarda)`);
        } else {
            // Barcha filiallarni olish
            const settingsRes = await safeFetch('/api/settings');
            if (!settingsRes || !settingsRes.ok) throw new Error('Filiallarni yuklab bo\'lmadi');
            const settings = await settingsRes.json();
            locations = settings.app_settings?.locations || [];
        }
        
        // "Barchasini belgilash" tugmasi
        const selectAllHtml = `
            <div class="select-all-location-item" style="
                grid-column: 1 / -1;
                margin-bottom: 10px;
                padding: 12px;
                background: rgba(79, 172, 254, 0.15);
                border: 1px solid rgba(79, 172, 254, 0.3);
                border-radius: 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                transition: all 0.2s;
            " onclick="selectAllLocations()" onmouseenter="this.style.background='rgba(79, 172, 254, 0.25)'" onmouseleave="this.style.background='rgba(79, 172, 254, 0.15)'">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 18px;">📍</span>
                    <span style="font-size: 14px; font-weight: 600; color: #4facfe;">Barchasini belgilash</span>
                </div>
                <input type="checkbox" id="select-all-locations-checkbox" ${locations.length > 0 && locations.every(l => selectedLocations.includes(l)) ? 'checked' : ''} onclick="event.stopPropagation(); selectAllLocations()" style="width: 18px; height: 18px; cursor: pointer;">
            </div>
        `;
        
        // Modal'da ko'rsatish - tag ko'rinishida (rasmdagidek)
        const locationsHtml = locations.map(loc => {
            const isSelected = selectedLocations.includes(loc);
            const locEscaped = loc.replace(/'/g, "\\'");
            return `
                <div class="location-tag-item ${isSelected ? 'selected' : ''}" data-location="${locEscaped}" onclick="toggleLocationCard('${locEscaped}')" style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 14px;
                    background: ${isSelected ? 'rgba(79, 172, 254, 0.2)' : 'rgba(79, 172, 254, 0.1)'};
                    border: 1px solid ${isSelected ? 'rgba(79, 172, 254, 0.5)' : 'rgba(79, 172, 254, 0.3)'};
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: ${isSelected ? '0 0 10px rgba(79, 172, 254, 0.3)' : 'none'};
                " onmouseenter="if(!this.classList.contains('selected')) { this.style.background='rgba(79, 172, 254, 0.15)'; this.style.boxShadow='0 0 5px rgba(79, 172, 254, 0.2)'; }" onmouseleave="if(!this.classList.contains('selected')) { this.style.background='rgba(79, 172, 254, 0.1)'; this.style.boxShadow='none'; }">
                    <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
                        <span style="font-size: 16px; color: #ef4444;">📍</span>
                        <span class="tag-text" style="font-size: 14px; font-weight: 500; color: #ffffff;">${loc}</span>
                    </div>
                    <input type="checkbox" id="loc-checkbox-${locEscaped}" ${isSelected ? 'checked' : ''} onchange="toggleLocationSelection('${locEscaped}', this)" onclick="event.stopPropagation();" style="display: none;">
                    <button class="remove-btn" onclick="event.stopPropagation(); toggleLocationCard('${locEscaped}')" style="
                        width: 20px;
                        height: 20px;
                        border-radius: 50%;
                        background: #ef4444;
                        border: none;
                        color: white;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 12px;
                        padding: 0;
                        margin-left: 10px;
                        transition: all 0.2s;
                    " onmouseenter="this.style.background='#dc2626'; this.style.transform='scale(1.1)'" onmouseleave="this.style.background='#ef4444'; this.style.transform='scale(1)'">
                        ×
                    </button>
                </div>
            `;
        }).join('');
        
        list.innerHTML = selectAllHtml + locationsHtml;
        
        // Grid ko'rinishini o'zgartirish - 2 ustunli
        list.style.display = 'grid';
        list.style.gridTemplateColumns = 'repeat(2, 1fr)';
        list.style.gap = '10px';
        list.style.padding = '10px';
        
        // Qidiruv
        if (searchInput) {
            searchInput.value = '';
            searchInput.oninput = (e) => {
                const query = e.target.value.toLowerCase();
                const selectAllItem = document.querySelector('.select-all-location-item');
                list.querySelectorAll('.location-tag-item').forEach(item => {
                    const location = item.dataset.location.toLowerCase();
                    item.style.display = location.includes(query) ? 'flex' : 'none';
                });
                // Qidiruv bo'lsa "Barchasini belgilash" ni yashirish
                if (selectAllItem) {
                    selectAllItem.style.display = query ? 'none' : 'flex';
                }
            };
        }
        
        // "Barchasini belgilash" checkbox event listener
        const selectAllCheckbox = document.getElementById('select-all-locations-checkbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', selectAllLocations);
        }
        
        debugLog('Modal ochilmoqda...');
        
        modal.classList.remove('hidden');
        
        // Modal'ni ko'rsatish uchun display style'ni ham o'rnatish
        if (modal.style.display === 'none') {
            modal.style.display = 'flex';
        }
        
        debugLog('Modal ochildi');
    } catch (error) {
        errorLog('Modal ochishda xatolik:', error);
        showToast(error.message, 'error');
    }
}

// Brendlar tanlash modal'ini ochish
async function openBrandsSelectModal() {
    // Funksiyani global qilish (xatolikdan keyin qayta yuklash uchun)
    if (!window.openBrandsSelectModal) {
        window.openBrandsSelectModal = openBrandsSelectModal;
    }
    const modal = document.getElementById('brands-select-modal');
    const list = document.getElementById('brands-modal-list');
    const searchInput = document.getElementById('brands-search-input');
    
    if (!modal || !list) return;
    
    // Hozirgi tanlangan brendlarni olish - selected-brands-display dan
    const selectedBrandsDisplay = document.getElementById('selected-brands-display');
    const selectedBrandIds = [];
    if (selectedBrandsDisplay) {
        selectedBrandsDisplay.querySelectorAll('.selected-item-tag').forEach(tag => {
            const removeBtn = tag.querySelector('.remove-btn');
            if (removeBtn && removeBtn.onclick) {
                // onclick atributidan brandId ni olish
                const onclickStr = removeBtn.getAttribute('onclick') || '';
                const match = onclickStr.match(/removeBrand\((\d+)\)/);
                if (match) {
                    selectedBrandIds.push(parseInt(match[1]));
                }
            }
        });
    }
    
    // Hozirgi tanlangan filiallarni olish - agar filial tanlangan bo'lsa, faqat shu filialdagi brendlarni ko'rsatish
    const selectedLocationsDisplay = document.getElementById('selected-locations-display');
    const selectedLocations = [];
    if (selectedLocationsDisplay) {
        selectedLocationsDisplay.querySelectorAll('.selected-item-tag').forEach(tag => {
            const locationName = tag.querySelector('.tag-text')?.textContent;
            if (locationName) {
                selectedLocations.push(locationName);
            }
        });
    }
    
    // Loading state ko'rsatish
    list.innerHTML = '<div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">Brendlar yuklanmoqda...</div>';
    
    // Brendlarni yuklash - agar filial tanlangan bo'lsa, faqat shu filialdagi brendlarni olish
    try {
        let brands = [];
        if (selectedLocations.length > 0 && selectedBrandIds.length === 0) {
            // Filial tanlangan, brend tanlanmagan - faqat tanlangan filiallardagi brendlarni olish
            console.log(`🔍 [USERS] Filial tanlangan (${selectedLocations.length} ta), faqat shu filiallardagi brendlarni yuklayapman...`);
            // Har bir filial uchun brendlarni olish va birlashtirish
            const allBrandsMap = new Map();
            let hasError = false;
            for (const location of selectedLocations) {
                try {
                    const res = await safeFetch(`/api/brands/by-location/${encodeURIComponent(location)}`);
                    if (res && res.ok) {
                        const locationBrands = await res.json();
                        locationBrands.forEach(brand => {
                            if (!allBrandsMap.has(brand.id)) {
                                allBrandsMap.set(brand.id, brand);
                            }
                        });
                    } else {
                        hasError = true;
                    }
                } catch (err) {
                    debugLog(`Filial "${location}" uchun brendlar yuklanmadi:`, err);
                    hasError = true;
                }
            }
            brands = Array.from(allBrandsMap.values());
            console.log(`✅ [USERS] ${brands.length} ta brend topildi (tanlangan filiallarda)`);
            
            // Agar xatolik bo'lsa va brendlar bo'sh bo'lsa, fallback qilish
            if (hasError && brands.length === 0) {
                console.log('⚠️ [USERS] Filiallardan brendlar topilmadi, barcha brendlarni yuklayapman...');
                const fallbackRes = await safeFetch('/api/brands/for-user');
                if (fallbackRes && fallbackRes.ok) {
                    brands = await fallbackRes.json();
                } else {
                    const allBrandsRes = await safeFetch('/api/brands');
                    if (allBrandsRes && allBrandsRes.ok) {
                        brands = await allBrandsRes.json();
                    }
                }
            }
        } else {
            // Foydalanuvchi access control bo'yicha faqat ruxsat etilgan brendlarni olish
            // Server-side filtering - tezroq va xavfsiz
            const res = await safeFetch('/api/brands/for-user');
            if (!res || !res.ok) {
                // Agar for-user endpoint ishlamasa, fallback sifatida barcha brendlarni olish
                const fallbackRes = await safeFetch('/api/brands');
                if (!fallbackRes || !fallbackRes.ok) throw new Error('Brendlarni yuklab bo\'lmadi');
                brands = await fallbackRes.json();
            } else {
                brands = await res.json();
            }
        }
        
        // Agar brendlar bo'sh bo'lsa, xabar ko'rsatish
        if (brands.length === 0) {
            list.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">
                    <p style="margin-bottom: 10px;">Brendlar topilmadi</p>
                    <p style="font-size: 12px; color: rgba(255,255,255,0.3);">Filiallar tanlangan bo'lsa, shu filiallarda brendlar mavjud emas</p>
                </div>
            `;
            modal.classList.remove('hidden');
            return;
        }
        
        // "Barchasini belgilash" tugmasi
        const selectAllBrandsHtml = `
            <div class="select-all-brand-item" style="
                grid-column: 1 / -1;
                margin-bottom: 10px;
                padding: 12px;
                background: rgba(79, 172, 254, 0.15);
                border: 1px solid rgba(79, 172, 254, 0.3);
                border-radius: 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                transition: all 0.2s;
            " onclick="selectAllBrands()" onmouseenter="this.style.background='rgba(79, 172, 254, 0.25)'" onmouseleave="this.style.background='rgba(79, 172, 254, 0.15)'">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 18px;">${brands.length > 0 ? brands[0].emoji || '🏢' : '🏢'}</span>
                    <span style="font-size: 14px; font-weight: 600; color: #4facfe;">Barchasini belgilash</span>
                </div>
                <input type="checkbox" id="select-all-brands-checkbox" ${brands.length > 0 && brands.every(b => selectedBrandIds.includes(b.id)) ? 'checked' : ''} onclick="event.stopPropagation(); selectAllBrands()" style="width: 18px; height: 18px; cursor: pointer;">
            </div>
        `;
        
        // Modal'da ko'rsatish - tag ko'rinishida (rasmdagidek)
        const brandsHtml = brands.map(brand => {
            const isSelected = selectedBrandIds.includes(brand.id);
            return `
                <div class="brand-tag-item ${isSelected ? 'selected' : ''}" data-brand-id="${brand.id}" onclick="toggleBrandCard(${brand.id})" style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 14px;
                    background: ${isSelected ? 'rgba(79, 172, 254, 0.2)' : 'rgba(79, 172, 254, 0.1)'};
                    border: 1px solid ${isSelected ? 'rgba(79, 172, 254, 0.5)' : 'rgba(79, 172, 254, 0.3)'};
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.2s;
                    box-shadow: ${isSelected ? '0 0 10px rgba(79, 172, 254, 0.3)' : 'none'};
                " onmouseenter="if(!this.classList.contains('selected')) { this.style.background='rgba(79, 172, 254, 0.15)'; this.style.boxShadow='0 0 5px rgba(79, 172, 254, 0.2)'; }" onmouseleave="if(!this.classList.contains('selected')) { this.style.background='rgba(79, 172, 254, 0.1)'; this.style.boxShadow='none'; }">
                    <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
                        <span style="font-size: 16px;">${brand.emoji || '🏢'}</span>
                        <span class="tag-text" style="font-size: 14px; font-weight: 500; color: #ffffff;">${brand.name}</span>
                    </div>
                    <input type="checkbox" id="brand-checkbox-${brand.id}" ${isSelected ? 'checked' : ''} onchange="toggleBrandSelection(${brand.id}, this)" onclick="event.stopPropagation();" style="display: none;">
                    <button class="remove-btn" onclick="event.stopPropagation(); toggleBrandCard(${brand.id})" style="
                        width: 20px;
                        height: 20px;
                        border-radius: 50%;
                        background: #ef4444;
                        border: none;
                        color: white;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 12px;
                        padding: 0;
                        margin-left: 10px;
                        transition: all 0.2s;
                    " onmouseenter="this.style.background='#dc2626'; this.style.transform='scale(1.1)'" onmouseleave="this.style.background='#ef4444'; this.style.transform='scale(1)'">
                        ×
                    </button>
                </div>
            `;
        }).join('');
        
        list.innerHTML = selectAllBrandsHtml + brandsHtml;
        
        // Grid ko'rinishini o'zgartirish - 2 ustunli
        list.style.display = 'grid';
        list.style.gridTemplateColumns = 'repeat(2, 1fr)';
        list.style.gap = '10px';
        list.style.padding = '10px';
        
        // Qidiruv
        if (searchInput) {
            searchInput.value = '';
            searchInput.oninput = (e) => {
                const query = e.target.value.toLowerCase();
                const selectAllItem = document.querySelector('.select-all-brand-item');
                list.querySelectorAll('.brand-tag-item').forEach(item => {
                    const brandName = item.querySelector('.tag-text')?.textContent.toLowerCase() || '';
                    item.style.display = brandName.includes(query) ? 'flex' : 'none';
                });
                // Qidiruv bo'lsa "Barchasini belgilash" ni yashirish
                if (selectAllItem) {
                    selectAllItem.style.display = query ? 'none' : 'flex';
                }
            };
        }
        
        // "Barchasini belgilash" checkbox event listener
        const selectAllCheckbox = document.getElementById('select-all-brands-checkbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', selectAllBrands);
        }
        
        modal.classList.remove('hidden');
    } catch (error) {
        console.error('❌ [USERS] Brendlarni yuklashda xatolik:', error);
        
        // Xatolik holatida modal ichiga xatolik xabarini ko'rsatish
        list.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
                <div style="color: #ef4444; margin-bottom: 10px; font-size: 16px;">⚠️ Xatolik</div>
                <p style="color: rgba(255,255,255,0.7); margin-bottom: 20px;">${error.message || 'Brendlarni yuklab bo\'lmadi'}</p>
                <button onclick="window.openBrandsSelectModal && window.openBrandsSelectModal()" style="
                    padding: 8px 16px;
                    background: #4facfe;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                ">Qayta urinib ko'rish</button>
            </div>
        `;
        
        // Modal'ni ochish (xatolik xabari bilan)
        modal.classList.remove('hidden');
        
        // Toast ham ko'rsatish
        showToast(error.message || 'Brendlarni yuklab bo\'lmadi', 'error');
    }
}

// Filial kartochka bosilganda tanlash
window.toggleLocationCard = function(location) {
    const locEscaped = location.replace(/'/g, "\\'");
    const checkbox = document.getElementById(`loc-checkbox-${locEscaped}`);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        toggleLocationSelection(location, checkbox);
    }
};

// Filial tanlash
window.toggleLocationSelection = function(location, checkbox) {
    const item = checkbox.closest('.location-tag-item');
    if (item) {
        if (checkbox.checked) {
            item.classList.add('selected');
            item.style.background = 'rgba(79, 172, 254, 0.2)';
            item.style.borderColor = 'rgba(79, 172, 254, 0.5)';
            item.style.boxShadow = '0 0 10px rgba(79, 172, 254, 0.3)';
        } else {
            item.classList.remove('selected');
            item.style.background = 'rgba(79, 172, 254, 0.1)';
            item.style.borderColor = 'rgba(79, 172, 254, 0.3)';
            item.style.boxShadow = 'none';
        }
    }
    
    // "Barchasini belgilash" checkbox'ni yangilash
    updateSelectAllLocationsCheckbox();
};

// Barcha filiallarni belgilash/bekor qilish
window.selectAllLocations = function() {
    const checkbox = document.getElementById('select-all-locations-checkbox');
    const allCheckboxes = document.querySelectorAll('#locations-modal-list .location-tag-item input[type="checkbox"]');
    const isChecked = checkbox.checked;
    
    allCheckboxes.forEach(cb => {
        cb.checked = !isChecked;
        const location = cb.closest('.location-tag-item').dataset.location;
        toggleLocationSelection(location, cb);
    });
    
    checkbox.checked = !isChecked;
};

// "Barchasini belgilash" checkbox'ni yangilash
function updateSelectAllLocationsCheckbox() {
    const allCheckboxes = document.querySelectorAll('#locations-modal-list .location-tag-item input[type="checkbox"]');
    const selectAllCheckbox = document.getElementById('select-all-locations-checkbox');
    if (selectAllCheckbox && allCheckboxes.length > 0) {
        const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
        selectAllCheckbox.checked = allChecked;
    }
}

// Brend kartochka bosilganda tanlash
window.toggleBrandCard = function(brandId) {
    const checkbox = document.getElementById(`brand-checkbox-${brandId}`);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        toggleBrandSelection(brandId, checkbox);
    }
};

// Brend tanlash
window.toggleBrandSelection = function(brandId, checkbox) {
    const item = checkbox.closest('.brand-tag-item');
    if (item) {
        if (checkbox.checked) {
            item.classList.add('selected');
            item.style.background = 'rgba(79, 172, 254, 0.2)';
            item.style.borderColor = 'rgba(79, 172, 254, 0.5)';
            item.style.boxShadow = '0 0 10px rgba(79, 172, 254, 0.3)';
        } else {
            item.classList.remove('selected');
            item.style.background = 'rgba(79, 172, 254, 0.1)';
            item.style.borderColor = 'rgba(79, 172, 254, 0.3)';
            item.style.boxShadow = 'none';
        }
    }
    
    // "Barchasini belgilash" checkbox'ni yangilash
    updateSelectAllBrandsCheckbox();
};

// Barcha brendlarni belgilash/bekor qilish
window.selectAllBrands = function() {
    const checkbox = document.getElementById('select-all-brands-checkbox');
    const allCheckboxes = document.querySelectorAll('#brands-modal-list .brand-tag-item input[type="checkbox"]');
    const isChecked = checkbox.checked;
    
    allCheckboxes.forEach(cb => {
        cb.checked = !isChecked;
        const brandId = parseInt(cb.closest('.brand-tag-item').dataset.brandId);
        toggleBrandSelection(brandId, cb);
    });
    
    checkbox.checked = !isChecked;
};

// "Barchasini belgilash" checkbox'ni yangilash
function updateSelectAllBrandsCheckbox() {
    const allCheckboxes = document.querySelectorAll('#brands-modal-list .brand-tag-item input[type="checkbox"]');
    const selectAllCheckbox = document.getElementById('select-all-brands-checkbox');
    if (selectAllCheckbox && allCheckboxes.length > 0) {
        const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
        selectAllCheckbox.checked = allChecked;
    }
}

// Filiallarni saqlash
document.addEventListener('DOMContentLoaded', () => {
    const saveLocationsBtn = document.getElementById('save-locations-btn');
    if (saveLocationsBtn) {
        saveLocationsBtn.onclick = () => {
            const selectedLocations = Array.from(document.querySelectorAll('#locations-modal-list .location-tag-item input:checked'))
                .map(cb => cb.closest('.location-tag-item').dataset.location);
            
            // Ko'rinishni yangilash (checkbox'larni yangilash kerak emas, chunki ular yashirilgan)
            updateSelectedLocationsDisplay(selectedLocations);
            
            // Modal'ni yopish
            ModalHelper.hide(document.getElementById('locations-select-modal'));
        };
    }
    
    const saveBrandsBtn = document.getElementById('save-brands-btn');
    if (saveBrandsBtn) {
        saveBrandsBtn.onclick = async () => {
            const selectedBrandIds = Array.from(document.querySelectorAll('#brands-modal-list .brand-tag-item input:checked'))
                .map(cb => parseInt(cb.closest('.brand-tag-item').dataset.brandId));
            
            // Brendlar ma'lumotlarini olish va ko'rsatish
            try {
                const res = await safeFetch('/api/brands');
                if (res && res.ok) {
                    const brands = await res.json();
                    const selectedBrands = brands
                        .filter(b => selectedBrandIds.includes(b.id))
                        .map(brand => ({
                            id: brand.id,
                            name: brand.name,
                            emoji: brand.emoji || '🏢'
                        }));
                    
                    // Ko'rinishni yangilash
                    updateSelectedBrandsDisplay(selectedBrands);
                }
            } catch (error) {
                console.error('Brendlarni yuklashda xatolik:', error);
            }
            
            // Modal'ni yopish
            ModalHelper.hide(document.getElementById('brands-select-modal'));
        };
    }
});

export async function handleUserFormSubmit(e) {
    e.preventDefault();
    console.log('🔍 [USERS] handleUserFormSubmit chaqirildi');
    
    const userId = DOM.editUserIdInput.value;
    const isEditing = !!userId;
    
    console.log(`📝 [USERS] Form ma'lumotlari:`, {
        isEditing,
        userId: userId || 'YANGI FOYDALANUVCHI',
        currentUserRole: state.currentUser?.role
    });
    
    // Tanlangan filiallarni olish - biriktirilgan blokdan
    const attachedLocationsList = document.getElementById('locations-attached-list');
    let selectedLocations = [];
    
    if (attachedLocationsList) {
        const locationItems = attachedLocationsList.querySelectorAll('.location-item');
        selectedLocations = Array.from(locationItems)
            .map(item => item.dataset.location)
            .filter(loc => loc && loc.trim() !== ''); // Bo'sh yoki null qiymatlarni olib tashlash
        
        console.log('🔍 [FORM] Tanlangan filiallar:', { 
            attachedListExists: !!attachedLocationsList,
            itemsCount: locationItems.length,
            selectedLocations,
            selectedLocationsCount: selectedLocations.length
        });
    } else {
        console.warn('🔍 [FORM] locations-attached-list topilmadi!');
    }
    
    // Tanlangan brendlarni olish - biriktirilgan blokdan
    const attachedBrandsList = document.getElementById('brands-attached-list');
    let selectedBrandIds = [];
    
    if (attachedBrandsList) {
        const brandItems = attachedBrandsList.querySelectorAll('.brand-item');
        selectedBrandIds = Array.from(brandItems)
            .map(item => parseInt(item.dataset.brandId))
            .filter(id => !isNaN(id)); // NaN qiymatlarni olib tashlash
        
        console.log('🔍 [FORM] Tanlangan brendlar:', { 
            attachedListExists: !!attachedBrandsList,
            itemsCount: brandItems.length,
            selectedBrandIds,
            selectedBrandIdsCount: selectedBrandIds.length
        });
    } else {
        console.warn('🔍 [FORM] brands-attached-list topilmadi!');
    }
    
    // Superadmin o'zini tahrirlayotgan bo'lsa, faqat login, to'liq ism, parol o'zgartirish
    const currentUser = state.users.find(u => u.id == userId);
    const isSuperadminEditingSelf = isEditing && 
        (state.currentUser?.role === 'superadmin' || state.currentUser?.role === 'super_admin') &&
        parseInt(userId) === parseInt(state.currentUser?.id) &&
        (currentUser?.role === 'superadmin' || currentUser?.role === 'super_admin');
    
    let data = {};
    
    if (isSuperadminEditingSelf) {
        // Superadmin o'zini tahrirlayotgan bo'lsa, login, to'liq ism, parol va device limit
        data = {
            username: DOM.usernameInput.value.trim(),
            fullname: DOM.fullnameInput.value.trim()
        };
        
        // Parol o'zgartirish (agar kiritilgan bo'lsa)
        if (DOM.passwordInput.value) {
            data.password = DOM.passwordInput.value;
        }
        
        // Device limit o'zgartirish (agar kiritilgan bo'lsa)
        if (DOM.deviceLimitInput && DOM.deviceLimitInput.value) {
            const deviceLimit = parseInt(DOM.deviceLimitInput.value);
            if (!isNaN(deviceLimit) && deviceLimit >= 0) {
                data.device_limit = deviceLimit;
            }
        }
        
        console.log(`📋 [USERS] Superadmin o'zini tahrirlayapti - login, to'liq ism, parol, device limit`);
    } else {
        // Oddiy foydalanuvchilar uchun to'liq ma'lumotlar
        data = {
            username: DOM.usernameInput.value.trim(),
            fullname: DOM.fullnameInput.value.trim(),
            role: DOM.userRoleSelect.value,
            device_limit: parseInt(DOM.deviceLimitInput.value) || 1,
            locations: selectedLocations,
            brands: selectedBrandIds
        };
        
        if (!isEditing && DOM.passwordInput.value) {
            data.password = DOM.passwordInput.value;
        }
    }
    
    console.log(`📋 [USERS] Yuboriladigan ma'lumotlar:`, {
        username: data.username,
        role: data.role || 'N/A',
        locations: data.locations?.length || 0,
        brands: data.brands?.length || 0,
        device_limit: data.device_limit || 'N/A',
        isSuperadminEditingSelf
    });
    
    // Superadmin rolini tekshirish
    if (data.role && (data.role === 'superadmin' || data.role === 'super_admin')) {
        errorLog('Superadmin rolini tanlashga urinish! Requested role:', data.role);
        console.warn(`   - Current user role: ${state.currentUser?.role}`);
    }
    
    // User-specific sozlamalarni qo'shish
    const requiresLocations = DOM.userRequiresLocations?.value || '';
    const requiresBrands = DOM.userRequiresBrands?.value || '';
    
    // localStorage'ga saqlash (har doim, keyingi safar uchun)
    try {
        const savedSettings = {
            requires_locations: requiresLocations,
            requires_brands: requiresBrands
        };
        localStorage.setItem('userFormDefaultSettings', JSON.stringify(savedSettings));
        debugLog('User form sozlamalari localStorage\'ga saqlandi:', savedSettings);
    } catch (error) {
        errorLog('localStorage\'ga saqlashda xatolik:', error);
    }
    
    // API'ga yuborish uchun user_settings
    if (requiresLocations || requiresBrands) {
        data.user_settings = {
            requires_locations: requiresLocations === 'true' ? true : 
                requiresLocations === 'false' ? false : 
                requiresLocations === 'null' ? null : undefined,
            requires_brands: requiresBrands === 'true' ? true : 
                requiresBrands === 'false' ? false : 
                requiresBrands === 'null' ? null : undefined
        };
    }
    
    const url = isEditing ? `/api/users/${userId}` : '/api/users';
    const method = isEditing ? 'PUT' : 'POST';
    
    debugLog('API\'ga so\'rov yuborilmoqda:', {
        url,
        method,
        role: data.role
    });
    
    try {
        const res = await safeFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (!res || !res.ok) {
            let errorMessage = 'Foydalanuvchi saqlashda xatolik yuz berdi';
            try {
                const errorData = await res.json();
                errorMessage = errorData.message || errorMessage;
                errorLog('API xatolik:', errorData);
            } catch (parseError) {
                errorLog('Xatolik ma\'lumotlarini parse qilishda xatolik:', parseError);
                // Agar JSON parse qilishda xatolik bo'lsa, status kodga qarab xabar berish
                if (res.status === 403) {
                    errorMessage = 'Bu amalni bajarish uchun ruxsatingiz yo\'q.';
                } else if (res.status === 400) {
                    errorMessage = 'Noto\'g\'ri ma\'lumotlar yuborildi.';
                } else if (res.status === 404) {
                    errorMessage = 'Foydalanuvchi topilmadi.';
                }
            }
            throw new Error(errorMessage);
        }
        
        infoLog('API muvaffaqiyatli javob qaytardi');
        
        const result = await res.json();
        
        // Muvaffaqiyat xabari
        const successMessage = result.message || (isEditing ? 'Foydalanuvchi muvaffaqiyatli yangilandi' : 'Foydalanuvchi muvaffaqiyatli yaratildi');
        showToast(successMessage, false);
        
        // Super admin yaratilganda avtomatik login qilish
        if (result.autoLogin && result.loginData) {
            // Login qilish
            const loginRes = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: result.loginData.username,
                    password: result.loginData.password
                })
            });
            
            if (loginRes.ok) {
                const loginResult = await loginRes.json();
                showToast("Super admin tizimga muvaffaqiyatli kirildi.", false);
                setTimeout(() => {
                    window.location.href = result.redirectUrl || '/admin';
                }, 1000);
                return;
            }
        }
        
        // Foydalanuvchilar ro'yxatini yangilash
        await refreshUsersList();
        
        // Modal'ni yopish (yangi modal tizimi)
        if (userModalInstance) {
            await userModalInstance.close();
        }
        currentEditingUserId = null;
    } catch (error) {
        errorLog('Foydalanuvchi saqlashda xatolik:', error);
        const errorMessage = error.message || 'Foydalanuvchi saqlashda xatolik yuz berdi';
        showToast(errorMessage, true);
    }
}

// Debounce flag - ikki marta chaqirilishni oldini olish
let isHandlingUserAction = false;

// User Management Modal
let userManagementModalInstance = null;
let currentManagedUserId = null;
let currentManagedUsername = null;
let isOpeningUserManagementModal = false;
let userManagementModalTimeout = null;

// Boshqarish modalini ochish (debounce bilan)
async function openUserManagementModal(userId, username) {
    // Agar modal allaqachon ochilgan bo'lsa va bir xil foydalanuvchi uchun bo'lsa, qayta ochmaslik
    if (userManagementModalInstance && userManagementModalInstance.isOpen && currentManagedUserId == userId) {
        log.debug('Modal allaqachon ochilgan:', userId);
        return;
    }
    
    // Agar modal ochilmoqda bo'lsa, qayta ochmaslik
    if (isOpeningUserManagementModal) {
        log.debug('Modal ochilmoqda, qayta ochilmaydi');
        return;
    }
    
    // Debounce - qisqa vaqt ichida bir necha marta chaqirilganda, faqat oxirgisi ishlaydi
    if (userManagementModalTimeout) {
        clearTimeout(userManagementModalTimeout);
    }
    
    userManagementModalTimeout = setTimeout(async () => {
        userManagementModalTimeout = null;
        isOpeningUserManagementModal = true;
        
        try {
            const user = state.users.find(u => u.id == userId);
            if (!user) {
                log.warn('Foydalanuvchi topilmadi:', userId);
                isOpeningUserManagementModal = false;
                return;
            }
            
            currentManagedUserId = userId;
            currentManagedUsername = username;
            
            // Modal instance yaratish
            if (!userManagementModalInstance) {
                userManagementModalInstance = getModal('user-management-modal', {
                    onOpen: async (data, instance) => {
                        await setupUserManagementMenu(data.userId, data.username, instance);
                    },
                    onClose: (instance) => {
                        currentManagedUserId = null;
                        currentManagedUsername = null;
                        isOpeningUserManagementModal = false;
                    }
                });
            }
            
            // Modal ochish
            await openModal('user-management-modal', { userId, username });
            isOpeningUserManagementModal = false;
        } catch (error) {
            log.error('Modal ochishda xatolik:', error);
            isOpeningUserManagementModal = false;
        }
    }, 150); // 150ms debounce
}

// Menu sozlash
async function setupUserManagementMenu(userId, username, modalInstance) {
    const user = state.users.find(u => u.id == userId);
    if (!user) {
        log.warn('Foydalanuvchi topilmadi:', userId);
        return;
    }
    
    // Modal title
    if (DOM.userManagementModalTitle) {
        DOM.userManagementModalTitle.textContent = `${username} - Boshqarish`;
    }
    
    // Menu button'larni sozlash
    const menuContainer = document.querySelector('#user-management-modal .user-management-menu');
    if (!menuContainer) {
        log.error('Menu container topilmadi');
        return;
    }
    
    // Eski listener'larni tozalash
    const newContainer = menuContainer.cloneNode(true);
    menuContainer.parentNode.replaceChild(newContainer, menuContainer);
    
    // Har bir menu item uchun listener qo'shish
    newContainer.querySelectorAll('.menu-item-btn').forEach(btn => {
        const action = btn.dataset.action;
        
        // Permission va visibility tekshirish
        if (action === 'edit' && !hasPermission(state.currentUser, 'users:edit')) {
            btn.style.display = 'none';
            return;
        }
        
        if (action === 'sessions' && !hasPermission(state.currentUser, 'users:manage_sessions')) {
            btn.style.display = 'none';
            return;
        }
        
        if (action === 'status' && state.currentUser.id == userId) {
            btn.style.display = 'none';
            return;
        }
        
        if (action === 'telegram-link' && (user.telegram_chat_id && user.is_telegram_connected)) {
            btn.style.display = 'none';
            return;
        }
        
        if (action === 'clear-telegram' && 
            (!(state.currentUser.role === 'superadmin' || state.currentUser.role === 'super_admin') || 
             state.currentUser.id == userId || !user.telegram_chat_id)) {
            btn.style.display = 'none';
            return;
        }
        
        if (action === 'delete' && 
            (!(state.currentUser.role === 'superadmin' || state.currentUser.role === 'super_admin') || 
             state.currentUser.id == userId || user.role === 'superadmin' || user.role === 'super_admin')) {
            btn.style.display = 'none';
            return;
        }
        
        // Status button text
        if (action === 'status') {
            const statusIcon = btn.querySelector('i');
            const statusText = btn.querySelector('span');
            if (statusIcon && statusText) {
                if (user.status === 'active') {
                    statusIcon.setAttribute('data-feather', 'eye-off');
                    statusText.textContent = 'Bloklash';
                } else {
                    statusIcon.setAttribute('data-feather', 'eye');
                    statusText.textContent = 'Aktivlashtirish';
                }
            }
        }
        
        // Click handler - bir marta qo'shish
        const clickHandler = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Button'ni disable qilish (ikki marta bosilishni oldini olish)
            btn.disabled = true;
            
            try {
                // Modal'ni yopish
                if (modalInstance && modalInstance.isOpen) {
                    await modalInstance.close();
                }
                
                // Kichik kechikish (modal yopilish animatsiyasi uchun)
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // Amalni bajarish
                await executeUserAction(action, userId, username);
            } catch (error) {
                log.error('Menu item click handler xatolik:', error);
            } finally {
                // Button'ni qayta enable qilish
                btn.disabled = false;
            }
        };
        
        btn.addEventListener('click', clickHandler);
    });
    
    // Feather icons
    if (window.feather) {
        window.feather.replace();
    }
}

// Amalni bajarish
async function executeUserAction(action, userId, username) {
    switch (action) {
        case 'edit':
            await openUserModalForEdit(userId);
            break;
        case 'sessions':
            await openSessionsModal(userId, username);
            break;
        case 'status':
            await handleUserStatusToggle(userId, username);
            break;
        case 'telegram-link':
            await handleGenerateTelegramLink(userId, username);
            break;
        case 'clear-telegram':
            await handleClearTelegram(userId, username);
            break;
        case 'delete':
            await handleDeleteUser(userId, username);
            break;
    }
}

// Status toggle funksiyasi
async function handleUserStatusToggle(userId, username) {
    const user = state.users.find(u => u.id == userId);
    if (!user) return;
    
    const status = user.status === 'active' ? 'blocked' : 'active';
    const confirmed = await showConfirmDialog({
        title: status === 'active' ? '✅ Faollashtirish' : '🚫 Bloklash',
        message: `Rostdan ham bu foydalanuvchini ${status === 'active' ? 'aktivlashtirmoqchimisiz' : 'bloklamoqchimisiz'}?`,
        confirmText: status === 'active' ? 'Faollashtirish' : 'Bloklash',
        cancelText: 'Bekor qilish',
        type: status === 'active' ? 'success' : 'danger',
        icon: status === 'active' ? 'user-check' : 'user-x'
    });
    
    if (confirmed) {
        try {
            const res = await safeFetch(`/api/users/${userId}/status`, { 
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            if (!res || !res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Status o\'zgartirishda xatolik');
            }
            
            const result = await res.json();
            showToast(result.message, false);
            
            // Ma'lumotlarni yangilash
            const usersRes = await fetchUsers();
            if (usersRes) {
                state.users = usersRes;
                renderModernUsers();
            }
        } catch (error) {
            showToast(error.message, true);
        }
    }
}

export async function handleUserActions(e) {
    // Agar allaqachon bajarilmoqda bo'lsa, qayta bajarilmaslik (DARHOL tekshirish)
    if (isHandlingUserAction) {
        return;
    }
    
    const button = e.target.closest('button');
    if (!button) {
        return;
    }
    
    // Faqat .user-card-action-btn class'iga ega button'lar uchun ishlash
    if (!button.classList.contains('user-card-action-btn')) {
        return;
    }
    
    // Flag'ni DARHOL o'rnatish (button to'g'ri ekanligini tekshirgandan keyin)
    isHandlingUserAction = true;
    
    const userId = button.dataset.id;
    if (!userId) {
        isHandlingUserAction = false;
        return;
    }
    
    // Yangi boshqarish knopkasi
    if (button.classList.contains('manage-user-btn')) {
        const username = button.dataset.username || '';
        await openUserManagementModal(userId, username);
        isHandlingUserAction = false;
    } else if (button.classList.contains('edit-user-btn')) {
        // Agar modal allaqachon ochilgan bo'lsa, qayta ochmaslik
        // Modal instance orqali tekshirish (yangi modal tizimi)
        if (userModalInstance && userModalInstance.isOpen && currentEditingUserId === userId) {
            console.log(`⚠️ [USERS] handleUserActions: Modal allaqachon ochilgan (User ID: ${userId}), qayta ochilmaydi`);
            isHandlingUserAction = false;
            return;
        }
        openUserModalForEdit(userId);
        isHandlingUserAction = false;
    } else if (button.classList.contains('deactivate-user-btn') || button.classList.contains('activate-user-btn')) {
        const status = button.classList.contains('activate-user-btn') ? 'active' : 'blocked';
        console.log('🔄 [HANDLE] Confirmation dialog ochilmoqda...');
        const confirmed = await showConfirmDialog({
            title: status === 'active' ? '✅ Faollashtirish' : '🚫 Bloklash',
            message: `Rostdan ham bu foydalanuvchini ${status === 'active' ? 'aktivlashtirmoqchimisiz' : 'bloklamoqchimisiz'}?`,
            confirmText: status === 'active' ? 'Faollashtirish' : 'Bloklash',
            cancelText: 'Bekor qilish',
            type: status === 'active' ? 'success' : 'danger',
            icon: status === 'active' ? 'user-check' : 'user-x'
        });
        
        console.log('🔄 [HANDLE] Confirmation natijasi:', confirmed);
        
        if (confirmed) {
            // Loading state - button'ni disable qilish
            button.disabled = true;
            const originalHTML = button.innerHTML;
            const originalClass = button.className;
            button.innerHTML = '<i data-feather="loader"></i> Kutilmoqda...';
            button.classList.add('loading');
            if (window.feather) window.feather.replace();
            
            try {
                const res = await safeFetch(`/api/users/${userId}/status`, { 
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status })
                });
                if (!res || !res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.message || 'Status o\'zgartirishda xatolik');
                }
                
                const result = await res.json();
                
                // Success animation
                button.innerHTML = '<i data-feather="check"></i> Muvaffaqiyatli!';
                button.style.background = status === 'active' ? 'var(--green-color)' : 'var(--red-color)';
                button.classList.remove('loading');
                if (window.feather) window.feather.replace();
                
                showToast(result.message, false);
                
                // Ma'lumotlarni yangilash
                setTimeout(async () => {
                    const usersRes = await fetchUsers();
                    if (usersRes) {
                        state.users = usersRes;
                        renderModernUsers();
                    }
                    // Button'ni qayta tiklash
                    button.disabled = false;
                    button.innerHTML = originalHTML;
                    button.className = originalClass;
                    button.style.background = '';
                    if (window.feather) window.feather.replace();
                }, 1500);
            } catch (error) { 
                showToast(error.message, true);
                // Button'ni qayta tiklash
                button.disabled = false;
                button.innerHTML = originalHTML;
                button.className = originalClass;
                button.style.background = '';
                button.classList.remove('loading');
                if (window.feather) window.feather.replace();
            }
            // Flag'ni qaytarish - muvaffaqiyatli yoki xatolikdan keyin
            isHandlingUserAction = false;
            console.log('✅ [HANDLE] Status o\'zgartirildi, flag qaytarildi');
        } else {
            // Bekor qilinganda flag'ni qaytarish
            isHandlingUserAction = false;
            console.log('❌ [HANDLE] Bekor qilindi, flag qaytarildi');
        }
    } else if (button.classList.contains('manage-sessions-btn')) {
        console.log('🔐 [HANDLE] manage-sessions-btn bosildi');
        console.log('🔐 [HANDLE] Modal holati:', DOM.sessionsModal ? (DOM.sessionsModal.classList.contains('hidden') ? 'yopiq' : 'ochiq') : 'topilmadi');
        console.log('🔐 [HANDLE] isOpeningSessionsModal:', isOpeningSessionsModal);
        
        // Agar modal allaqachon ochilgan bo'lsa, qayta ochmaslik
        if (DOM.sessionsModal && !DOM.sessionsModal.classList.contains('hidden')) {
            console.log('⚠️ [HANDLE] Modal allaqachon ochiq, qayta ochilmaydi');
            isHandlingUserAction = false;
            return;
        }
        
        if (isOpeningSessionsModal) {
            console.log('⚠️ [HANDLE] Modal ochilmoqda, qayta ochilmaydi');
            isHandlingUserAction = false;
            return;
        }
        
        console.log('🚀 [HANDLE] openSessionsModal chaqirilmoqda...');
        const username = button.dataset.username;
        await openSessionsModal(userId, username);
        // Flag'ni qaytarish
        isHandlingUserAction = false;
        console.log('✅ [HANDLE] isHandlingUserAction flag qaytarildi');
    } else if (button.classList.contains('change-password-btn')) {
        openCredentialsModal(userId, 'password');
        isHandlingUserAction = false;
    } else if (button.classList.contains('set-secret-word-btn')) {
        openCredentialsModal(userId, 'secret-word');
        isHandlingUserAction = false;
    } else if (button.classList.contains('connect-telegram-btn')) {
        openTelegramConnectModal(userId);
        isHandlingUserAction = false;
    } else if (button.classList.contains('telegram-link-btn')) {
        // Telegram obunasi linkini yaratish
        await handleGenerateTelegramLink(userId, button.dataset.username);
        isHandlingUserAction = false;
    } else if (button.classList.contains('clear-telegram-btn')) {
        // Telegram bog'lanishni tozalash (faqat superadmin)
        await handleClearTelegram(userId, button.dataset.username);
        isHandlingUserAction = false;
    } else if (button.classList.contains('delete-user-btn')) {
        // Foydalanuvchini o'chirish (faqat superadmin)
        await handleDeleteUser(userId, button.dataset.username);
        isHandlingUserAction = false;
    } else {
        // Boshqa button'lar uchun ham flag'ni qaytarish
        isHandlingUserAction = false;
    }
}

// ===================================================================
// === TELEGRAM OBUNASI LINKINI YARATISH ===
// ===================================================================
async function handleGenerateTelegramLink(userId, username) {
    try {
        const res = await safeFetch(`/api/users/${userId}/generate-telegram-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!res || !res.ok) {
            const errorData = res ? await res.json().catch(() => ({})) : {};
            throw new Error(errorData.message || 'Telegram linkini yaratishda xatolik');
        }
        
        const result = await res.json();
        
        // Modal ochish va linkni ko'rsatish
        const modal = document.getElementById('telegram-link-modal');
        const linkInput = document.getElementById('telegram-link-input');
        const linkDisplay = document.getElementById('telegram-link-display');
        const expiresInfo = document.getElementById('telegram-link-expires');
        const copyBtn = document.getElementById('copy-telegram-link-btn');
        
        if (modal && linkInput && expiresInfo) {
            linkInput.value = result.botLink;
            if (linkDisplay) {
                linkDisplay.textContent = result.botLink;
            }
            
            // Muddati formatlash
            const expiresAt = new Date(result.expiresAt);
            const now = new Date();
            const minutesLeft = Math.ceil((expiresAt - now) / 1000 / 60);
            expiresInfo.textContent = `⚠️ Havola ${minutesLeft} daqiqadan keyin tugaydi`;
            
            // Copy button event listener
            if (copyBtn) {
                const copyHandler = async () => {
                    try {
                        await navigator.clipboard.writeText(result.botLink);
                        showToast('Havola nusxalandi!', 'success');
                    } catch (err) {
                        linkInput.select();
                        document.execCommand('copy');
                        showToast('Havola nusxalandi!', 'success');
                    }
                };
                // Remove old listener
                const newCopyBtn = copyBtn.cloneNode(true);
                copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
                newCopyBtn.addEventListener('click', copyHandler);
            }
            
            ModalHelper.show(modal);
            
            // Feather icons
            if (window.feather) {
                window.feather.replace();
            }
        } else {
            // Modal topilmasa, oddiy ko'rsatish
            try {
                await navigator.clipboard.writeText(result.botLink);
                showToast(`Telegram link nusxalandi: ${result.botLink}`, 'success');
            } catch (err) {
                showToast(`Telegram link: ${result.botLink}`, 'success');
            }
        }
        
    } catch (error) {
        console.error('Telegram link yaratish xatoligi:', error);
        showToast(error.message || 'Telegram linkini yaratishda xatolik', true);
    }
}

// ===================================================================
// === TELEGRAM BOG'LANISHNI TOZALASH (FAQAT SUPERADMIN) ===
// ===================================================================
async function handleClearTelegram(userId, username) {
    const confirmed = await showConfirmDialog({
        title: '🔗 Telegram bog\'lanishni tozalash',
        message: `<b>${username}</b> foydalanuvchisining Telegram bog'lanishini tozalamoqchimisiz?\n\nBu amalni bajargandan so'ng foydalanuvchi qaytadan bot obunasini qilishi kerak bo'ladi.`,
        confirmText: 'Ha, tozalash',
        cancelText: 'Bekor qilish',
        type: 'warning',
        icon: 'link-2'
    });
    
    if (!confirmed) return;
    
    try {
        const res = await safeFetch(`/api/users/${userId}/clear-telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!res || !res.ok) {
            const errorData = res ? await res.json().catch(() => ({})) : {};
            throw new Error(errorData.message || 'Telegram tozalashda xatolik');
        }
        
        const result = await res.json();
        showToast(result.message || 'Telegram bog\'lanish tozalandi', 'success');
        
        // Foydalanuvchilar ro'yxatini yangilash
        await refreshUsersList();
        
    } catch (error) {
        console.error('❌ [USERS] Telegram tozalash xatoligi:', error);
        showToast(error.message || 'Telegram tozalashda xatolik', 'error');
    }
}

// ===================================================================
// === FOYDALANUVCHINI O'CHIRISH (FAQAT SUPERADMIN) ===
// ===================================================================
async function handleDeleteUser(userId, username) {
    try {
        // Avval foydalanuvchi ma'lumotlarini tekshirish
        const checkRes = await safeFetch(`/api/users/${userId}/check-data`, {
            method: 'GET'
        });
        
        if (!checkRes || !checkRes.ok) {
            let errorMessage = 'Ma\'lumotlarni tekshirishda xatolik';
            try {
                const contentType = checkRes?.headers?.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await checkRes.json();
                    errorMessage = errorData.message || errorMessage;
                } else {
                    // HTML javob qaytgan
                    if (checkRes.status === 404) {
                        errorMessage = 'Foydalanuvchi topilmadi';
                    } else if (checkRes.status === 403) {
                        errorMessage = 'Bu amalni bajarish uchun ruxsatingiz yo\'q';
                    } else if (checkRes.status === 500) {
                        errorMessage = 'Server xatoligi yuz berdi';
                    } else {
                        errorMessage = `Server xatolik: ${checkRes.status} ${checkRes.statusText}`;
                    }
                }
            } catch (parseError) {
                console.error('❌ [USERS] Check data xatolik ma\'lumotlarini parse qilishda xatolik:', parseError);
                if (checkRes?.status === 404) {
                    errorMessage = 'Foydalanuvchi topilmadi';
                } else if (checkRes?.status === 403) {
                    errorMessage = 'Bu amalni bajarish uchun ruxsatingiz yo\'q';
                } else if (checkRes?.status === 500) {
                    errorMessage = 'Server xatoligi yuz berdi';
                }
            }
            throw new Error(errorMessage);
        }
        
        // JSON javobni tekshirish (ok bo'lsa, demak JSON javob qaytgan)
        const checkData = await checkRes.json();
        
        let confirmMessage = '';
        let confirmType = 'danger';
        
        if (checkData.canDeleteSafely) {
            // Xavfsiz o'chirish mumkin
            confirmMessage = `<b>${username}</b> foydalanuvchisini o'chirmoqchimisiz?\n\n` +
                `✅ Bu foydalanuvchi hech qanday ma'lumot kiritmagan. Xavfsiz o'chirish mumkin.`;
        } else {
            // Ogohlantirish
            confirmMessage = `<b>⚠️ Diqqat!</b>\n\n` +
                `<b>${username}</b> foydalanuvchisi quyidagi ma'lumotlarni kiritgan:\n\n` +
                `📊 Hisobotlar: <b>${checkData.hasData.reports}</b> ta\n` +
                `📜 Tarix: <b>${checkData.hasData.history}</b> ta\n` +
                `📈 Taqqoslashlar: <b>${checkData.hasData.comparisons}</b> ta\n\n` +
                `<b>O'chirish kelajakdagi tarixlarga ta'sir qilishi mumkin!</b>\n\n` +
                `Davom etasizmi?`;
            confirmType = 'danger';
        }
        
        const confirmed = await showConfirmDialog({
            title: '🗑️ Foydalanuvchini o\'chirish',
            message: confirmMessage,
            confirmText: checkData.canDeleteSafely ? 'Ha, o\'chirish' : '⚠️ Ha, o\'chirish',
            cancelText: 'Bekor qilish',
            type: confirmType,
            icon: 'trash-2'
        });
        
        if (!confirmed) return;
        
        // Agar ma'lumot bor bo'lsa, yana bir marta tasdiqlash
        if (!checkData.canDeleteSafely) {
            const forceConfirmed = await showConfirmDialog({
                title: '⚠️ OXIRGI OGOHLANTIRISH',
                message: `<b>Bu amal qaytarib bo'lmaydi!</b>\n\n` +
                    `Foydalanuvchi o'chiriladi, lekin uning kiritgan hisobotlari saqlanib qoladi (user_id = null).\n\n` +
                    `Rostdan ham davom etasizmi?`,
                confirmText: 'Ha, o\'chirish',
                cancelText: 'Yo\'q, bekor qilish',
                type: 'danger',
                icon: 'alert-triangle'
            });
            
            if (!forceConfirmed) return;
        }
        
        // O'chirish so'rovi
        const deleteUrl = checkData.canDeleteSafely 
            ? `/api/users/${userId}` 
            : `/api/users/${userId}?forceDelete=true`;
            
        const deleteRes = await safeFetch(deleteUrl, {
            method: 'DELETE'
        });
        
        if (!deleteRes || !deleteRes.ok) {
            let errorMessage = 'Foydalanuvchini o\'chirishda xatolik';
            try {
                const contentType = deleteRes?.headers?.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await deleteRes.json();
                    errorMessage = errorData.message || errorMessage;
                } else {
                    // HTML javob qaytgan (404 yoki 500 xatolik sahifasi)
                    if (deleteRes.status === 404) {
                        errorMessage = 'Foydalanuvchi topilmadi';
                    } else if (deleteRes.status === 403) {
                        errorMessage = 'Bu amalni bajarish uchun ruxsatingiz yo\'q';
                    } else if (deleteRes.status === 500) {
                        errorMessage = 'Server xatoligi yuz berdi';
                    } else {
                        errorMessage = `Server xatolik: ${deleteRes.status} ${deleteRes.statusText}`;
                    }
                }
            } catch (parseError) {
                console.error('❌ [USERS] Xatolik ma\'lumotlarini parse qilishda xatolik:', parseError);
                if (deleteRes?.status === 404) {
                    errorMessage = 'Foydalanuvchi topilmadi';
                } else if (deleteRes?.status === 403) {
                    errorMessage = 'Bu amalni bajarish uchun ruxsatingiz yo\'q';
                } else if (deleteRes?.status === 500) {
                    errorMessage = 'Server xatoligi yuz berdi';
                }
            }
            throw new Error(errorMessage);
        }
        
        // JSON javobni tekshirish (ok bo'lsa, demak JSON javob qaytgan)
        const result = await deleteRes.json();
        showToast(result.message || 'Foydalanuvchi o\'chirildi', 'success');
        
        // Foydalanuvchilar ro'yxatini yangilash
        await refreshUsersList();
        
    } catch (error) {
        console.error('❌ [USERS] Foydalanuvchi o\'chirish xatoligi:', error);
        showToast(error.message || 'Foydalanuvchini o\'chirishda xatolik', 'error');
    }
}

// Sessions modal instance - har bir foydalanuvchi uchun alohida
let sessionsModalInstance = null;

async function openSessionsModal(userId, username) {
    log.debug('openSessionsModal chaqirildi - User ID:', userId, 'Username:', username);
    
    if (!DOM.sessionsModal || !DOM.sessionsModalTitle || !DOM.sessionsListContainer) {
        log.error('Sessions modal elementlari topilmadi');
        isHandlingUserAction = false;
        return;
    }
    
    // Modal instance olish yoki yaratish
    if (!sessionsModalInstance) {
        sessionsModalInstance = getModal('sessions-modal', {
            onOpen: async (data, instance) => {
                await loadSessionsData(data.userId, data.username, instance);
            },
            onClose: (instance) => {
                // Cleanup
                if (DOM.sessionsListContainer) {
                    DOM.sessionsListContainer.innerHTML = '';
                }
            }
        });
    }
    
    // Modal ochish
    await openModal('sessions-modal', { userId, username });
}

async function loadSessionsData(userId, username, modalInstance) {
    // Modal header yangilash
    if (DOM.sessionsModalTitle) {
    DOM.sessionsModalTitle.textContent = `${username}ning Sessiyalari`;
    }
    const subtitle = DOM.sessionsModal.querySelector('#sessions-modal-subtitle');
    if (subtitle) {
        subtitle.textContent = 'Aktiv sessiyalar ro\'yxati';
    }
    
    // Loading state
    if (DOM.sessionsListContainer) {
    DOM.sessionsListContainer.innerHTML = `
        <div class="sessions-loading">
            <div class="loading-spinner"></div>
            <p>Sessiyalar yuklanmoqda...</p>
        </div>
    `;
    }
    
    // Feather icons yangilash
    if (window.feather) {
        window.feather.replace();
    }
    
    try {
        const res = await safeFetch(`/api/users/${userId}/sessions`);
        if (!res || !res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'Sessiyalarni yuklab bo\'lmadi');
        }
        const sessions = await res.json();
        
        // Subtitle yangilash
        if (subtitle) {
            subtitle.textContent = `${sessions.length} ta aktiv sessiya topildi`;
        }
        
        // Sessiyalarni render qilish
        if (DOM.sessionsListContainer) {
        DOM.sessionsListContainer.innerHTML = sessions.length > 0 ? sessions.map((s, index) => {
            const deviceInfoObj = parseUserAgent(s.user_agent);
            const deviceInfo = deviceInfoObj && typeof deviceInfoObj === 'object' 
                ? `${deviceInfoObj.browser || 'Noma\'lum'} ${deviceInfoObj.browserVersion || ''} ${deviceInfoObj.os || ''}`.trim() || 'Noma\'lum qurilma'
                : (deviceInfoObj || 'Noma\'lum qurilma');
            const lastActivity = new Date(s.last_activity);
            const timeAgo = getTimeAgo(lastActivity);
            const isCurrent = s.is_current;
            
            return `
                <div class="session-item-modern ${isCurrent ? 'current' : ''}" style="animation-delay: ${index * 0.05}s">
                    <div class="session-item-icon">
                        <i data-feather="${isCurrent ? 'smartphone' : 'monitor'}"></i>
                    </div>
                    <div class="session-item-content">
                        <div class="session-item-header">
                            <div class="session-item-title">
                                ${isCurrent ? '<span class="session-badge-current">🟢 Joriy Sessiya</span>' : `<span class="session-badge">Sessiya #${index + 1}</span>`}
                            </div>
                            ${isCurrent ? '' : `
                                <button class="btn btn-danger btn-sm terminate-session-btn" data-sid="${s.sid}" title="Sessiyani tugatish">
                                    <i data-feather="x-circle"></i>
                                    Tugatish
                                </button>
                            `}
                        </div>
                        <div class="session-item-details">
                            <div class="session-detail-item">
                                <i data-feather="globe"></i>
                                <span class="detail-label">IP Manzil:</span>
                                <span class="detail-value">${s.ip_address || 'Noma\'lum'}</span>
                            </div>
                            <div class="session-detail-item">
                                <i data-feather="smartphone"></i>
                                <span class="detail-label">Qurilma:</span>
                                <span class="detail-value">${deviceInfo}</span>
                            </div>
                            <div class="session-detail-item">
                                <i data-feather="clock"></i>
                                <span class="detail-label">Oxirgi faollik:</span>
                                <span class="detail-value">${timeAgo}</span>
                                <span class="detail-time">${lastActivity.toLocaleString('uz-UZ')}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('') : `
            <div class="empty-state-modern">
                <div class="empty-state-icon">
                    <i data-feather="monitor"></i>
                </div>
                <h4>Aktiv sessiyalar topilmadi</h4>
                <p>Bu foydalanuvchining hozirgi vaqtda aktiv sessiyalari yo'q.</p>
            </div>
        `;
        }
        
        // Feather icons yangilash
        if (window.feather) {
            window.feather.replace();
        }
        
    } catch (error) {
        log.error('Sessions modal xatolik:', error);
        if (DOM.sessionsListContainer) {
        DOM.sessionsListContainer.innerHTML = `
            <div class="empty-state-modern error">
                <div class="empty-state-icon">
                    <i data-feather="alert-circle"></i>
                </div>
                <h4>Xatolik yuz berdi</h4>
                <p>${error.message}</p>
                <button class="btn btn-primary btn-sm" onclick="window.location.reload()">
                    <i data-feather="refresh-cw"></i>
                    Sahifani yangilash
                </button>
            </div>
        `;
        }
        if (window.feather) {
            window.feather.replace();
        }
    } finally {
    isHandlingUserAction = false;
    }
}

// Time ago helper funksiyasi
function getTimeAgo(date) {
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} kun oldin`;
    if (hours > 0) return `${hours} soat oldin`;
    if (minutes > 0) return `${minutes} daqiqa oldin`;
    return 'Hozirgina';
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
    
    ModalHelper.show(DOM.credentialsModal);
}

export async function handleCredentialsFormSubmit(e) {
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
        ModalHelper.hide(DOM.credentialsModal);
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
    ModalHelper.show(DOM.telegramConnectModal);
}

export function copyTelegramLink() {
    DOM.telegramConnectLinkInput.select();
    document.execCommand('copy');
    showToast("Havola nusxalandi!");
}

// Pending users uchun funksiyalar
export async function openApprovalModal(userId, username) {
    console.log('🚪 ========================================');
    console.log('🚪 [MODAL OCHISH] openApprovalModal boshlandi');
    console.log('🚪 ========================================');
    console.log(`🚪 [MODAL OCHISH] 1. Parametrlar: userId=${userId}, username=${username}`);
    
    DOM.approvalForm.reset();
    DOM.approvalUserIdInput.value = userId;
    DOM.approvalUsernameSpan.textContent = username;
    console.log(`🚪 [MODAL OCHISH] 2. Form tozalandi va ma'lumotlar kiritildi`);
    
    // Super admin'dan tashqari barcha rollarni ko'rsatish
    console.log(`🚪 [MODAL OCHISH] 3. Rollarni yuklash...`);
    console.log(`   - State.roles soni: ${state.roles?.length || 0}`);
    
    // state.roles mavjudligini tekshirish
    if (!state.roles || !Array.isArray(state.roles)) {
        console.warn('⚠️ [MODAL OCHISH] state.roles mavjud emas yoki array emas, rollarni yuklashga harakat qilinmoqda...');
        try {
            // Rollarni yuklash
            const { fetchRoles } = await import('./api.js');
            const rolesData = await fetchRoles();
            if (rolesData && rolesData.roles && Array.isArray(rolesData.roles)) {
                state.roles = rolesData.roles;
                console.log(`   ✅ Rollar yuklandi. Soni: ${state.roles.length}`);
            } else {
                console.error('❌ [MODAL OCHISH] Rollar yuklanmadi yoki noto\'g\'ri formatda');
                DOM.approvalRoleSelect.innerHTML = '<option value="">Rollar yuklanmadi</option>';
                showToast('Rollar yuklanmadi. Iltimos, sahifani yangilang.', true);
                return;
            }
        } catch (error) {
            console.error('❌ [MODAL OCHISH] Rollarni yuklashda xatolik:', error);
            DOM.approvalRoleSelect.innerHTML = '<option value="">Xatolik yuz berdi</option>';
            showToast('Rollar yuklanmadi. Iltimos, sahifani yangilang.', true);
            return;
        }
    }
    
    // Superadmin rolini to'liq olib tashlash (ham superadmin, ham super_admin)
    console.log(`🔍 [USERS] openApprovalModal - Rollarni filtrlash`);
    console.log(`   - Joriy foydalanuvchi roli: ${state.currentUser?.role}`);
    console.log(`   - Mavjud rollar soni: ${state.roles?.length || 0}`);
    
    DOM.approvalRoleSelect.innerHTML = '<option value="">Rolni tanlang...</option>' + state.roles
        .filter(r => {
            // Superadmin rolini to'liq olib tashlash
            const isSuperadmin = r.role_name === 'superadmin' || r.role_name === 'super_admin';
            if (isSuperadmin) {
                console.log(`   🚫 Superadmin roli olib tashlandi: ${r.role_name}`);
                return false;
            }
            return true;
        })
        .map(r => {
            // Rol nomlarini o'zbek tiliga tarjima qilish
            const roleNames = {
                'admin': 'Admin',
                'manager': 'Menejer',
                'operator': 'Operator'
            };
            const displayName = roleNames[r.role_name] || r.role_name.charAt(0).toUpperCase() + r.role_name.slice(1);
            return `<option value="${r.role_name}">${displayName}</option>`;
        }).join('');
    console.log(`   ✅ Rollar yuklandi`);
    
    // Birinchi bosqich: faqat rol tanlash, boshqa narsalar yashiriladi
    console.log(`🚪 [MODAL OCHISH] 4. UI elementlarini yashirish...`);
    if (DOM.approvalLocationsGroup) {
        DOM.approvalLocationsGroup.style.display = 'none';
        console.log(`   ✅ Filiallar yashirildi`);
    }
    const approvalBrandsGroup = document.getElementById('approval-brands-group');
    if (approvalBrandsGroup) {
        approvalBrandsGroup.style.display = 'none';
        console.log(`   ✅ Brendlar yashirildi`);
    }
    const approvalRoleRequirementsGroup = document.getElementById('approval-role-requirements-group');
    if (approvalRoleRequirementsGroup) {
        approvalRoleRequirementsGroup.style.display = 'none';
        console.log(`   ✅ "Rol Shartini Kiritish" yashirildi`);
    }
    
    // Tasdiqlash tugmasini yashirish (rol tanlanguncha)
    const submitBtn = document.querySelector('#approval-modal .modal-footer button[form="approval-form"]') || 
                      document.querySelector('#approval-modal .modal-footer button[type="submit"]');
    if (submitBtn) {
        submitBtn.style.display = 'none';
        console.log(`   ✅ Tasdiqlash tugmasi yashirildi`);
    } else {
        console.warn(`   ⚠️ Tasdiqlash tugmasi topilmadi!`);
        // Qo'shimcha tekshirish
        const modalFooter = document.querySelector('#approval-modal .modal-footer');
        console.warn(`   - Modal footer topildi: ${modalFooter ? 'HA' : 'YO\'Q'}`);
        if (modalFooter) {
            const allButtons = modalFooter.querySelectorAll('button');
            console.warn(`   - Modal footer'dagi tugmalar soni: ${allButtons.length}`);
            allButtons.forEach((btn, idx) => {
                console.warn(`     - Tugma ${idx}: type=${btn.type}, form=${btn.getAttribute('form')}`);
            });
        }
    }
    
    // Event listenerlarni qo'shish
    console.log(`🚪 [MODAL OCHISH] 5. Event listenerlarni qo'shish...`);
    setupApprovalSkipButtons();
    
    // Rol tanlash event listener - eski listenerlarni olib tashlash
    if (DOM.approvalRoleSelect) {
        console.log(`   - Rol tanlash select elementi topildi`);
        // Eski event listenerlarni olib tashlash (barcha 'change' event listenerlarni)
        const newSelect = DOM.approvalRoleSelect.cloneNode(true);
        DOM.approvalRoleSelect.parentNode.replaceChild(newSelect, DOM.approvalRoleSelect);
        // DOM elementini yangilash - id o'zgarmaydi, shuning uchun to'g'ri id bilan qidirish
        const updatedSelect = document.getElementById('approval-role');
        if (updatedSelect) {
            // DOM.approvalRoleSelect ni yangilash
            DOM.approvalRoleSelect = updatedSelect;
            updatedSelect.addEventListener('change', async () => {
                console.log(`🔄 [MODAL] Rol tanlash o'zgardi, toggleLocationVisibilityForApprovalForm chaqirilmoqda...`);
                await toggleLocationVisibilityForApprovalForm();
            }, { once: false });
            console.log(`   ✅ Rol tanlash event listener qo'shildi`);
        } else {
            console.warn(`   ⚠️ Yangilangan select elementi topilmadi!`);
            // Qo'shimcha tekshirish
            const allSelects = document.querySelectorAll('#approval-modal select');
            console.warn(`   - Modal ichidagi barcha select elementlar: ${allSelects.length}`);
            allSelects.forEach((sel, idx) => {
                console.warn(`     - Select ${idx}: id=${sel.id}, value=${sel.value}`);
            });
        }
    } else {
        console.warn(`   ⚠️ Rol tanlash select elementi topilmadi!`);
    }
    
    console.log(`🚪 [MODAL OCHISH] 6. Modal ochilmoqda...`);
    DOM.approvalModal.classList.remove('hidden');
    feather.replace();
    
    // Modal tashqarisiga bosilganda yopish (faqat bir marta)
    if (!DOM.approvalModal.dataset.closeListenerAdded) {
        DOM.approvalModal.addEventListener('click', (e) => {
            // Agar modal tashqarisiga (background'ga) bosilgan bo'lsa, modal yopiladi
            if (e.target === DOM.approvalModal) {
                DOM.approvalModal.classList.add('hidden');
                // Bulk approval navbatini bekor qilish
                if (window.bulkApprovalQueue) {
                    console.log('⚠️ [BULK APPROVE] Modal bekor qilindi, navbat tozalanmoqda');
                    window.bulkApprovalQueue = null;
                    window.bulkApprovalCurrentIndex = null;
                    window.bulkApprovalTotal = null;
                    selectedRequests.clear();
                    updateRequestsBulkActions();
                }
            }
        });
        DOM.approvalModal.dataset.closeListenerAdded = 'true';
    }
    
    // ESC tugmasi bilan yopish handler (har safar yangi)
    const currentEscHandler = (e) => {
        if (e.key === 'Escape' && !DOM.approvalModal.classList.contains('hidden')) {
            DOM.approvalModal.classList.add('hidden');
            // Bulk approval navbatini bekor qilish
            if (window.bulkApprovalQueue) {
                console.log('⚠️ [BULK APPROVE] Modal ESC bilan yopildi, navbat tozalanmoqda');
                window.bulkApprovalQueue = null;
                window.bulkApprovalCurrentIndex = null;
                window.bulkApprovalTotal = null;
                selectedRequests.clear();
                updateRequestsBulkActions();
            }
            document.removeEventListener('keydown', currentEscHandler);
        }
    };
    // Eski handler'ni olib tashlash (agar mavjud bo'lsa)
    if (DOM.approvalModal._escHandler) {
        document.removeEventListener('keydown', DOM.approvalModal._escHandler);
    }
    DOM.approvalModal._escHandler = currentEscHandler;
    document.addEventListener('keydown', currentEscHandler);
    
    // Qidiruv input uchun feather icon yangilash
    setTimeout(() => {
        const searchInput = document.getElementById('approval-locations-search');
        if (searchInput) {
            feather.replace();
        }
    }, 100);
    
    console.log('✅ ========================================');
    console.log('✅ [MODAL OCHISH] Modal ochildi');
    console.log('✅ ========================================');
}

function setupApprovalSkipButtons() {
    // Skip locations button
    const skipLocationsBtn = document.getElementById('skip-locations-btn');
    if (skipLocationsBtn) {
        skipLocationsBtn.onclick = () => {
            console.log(`⏭️ [WEB] "Filiallarni o'tkazib yuborish" tugmasi bosildi`);
            window.approvalSkipLocations = true;
            // Barcha checkboxlarni o'chirish
            const checkboxes = document.querySelectorAll('#approval-locations-checkbox-list input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
            console.log(`✅ [WEB] ${checkboxes.length} ta filial checkbox o'chirildi`);
            skipLocationsBtn.style.opacity = '0.5';
            skipLocationsBtn.innerHTML = '<i data-feather="check"></i> O\'tkazib yuborildi';
            if (window.feather) window.feather.replace();
        };
    }
    
    // Skip brands button
    const skipBrandsBtn = document.getElementById('skip-brands-btn');
    if (skipBrandsBtn) {
        skipBrandsBtn.onclick = () => {
            console.log(`⏭️ [WEB] "Brendlarni o'tkazib yuborish" tugmasi bosildi`);
            window.approvalSkipBrands = true;
            // Barcha checkboxlarni o'chirish
            const checkboxes = document.querySelectorAll('#approval-brands-list input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
            console.log(`✅ [WEB] ${checkboxes.length} ta brend checkbox o'chirildi`);
            skipBrandsBtn.style.opacity = '0.5';
            skipBrandsBtn.innerHTML = '<i data-feather="check"></i> O\'tkazib yuborildi';
            if (window.feather) window.feather.replace();
        };
    }
    
    // Skip all button
    const skipAllBtn = document.getElementById('skip-all-btn');
    if (skipAllBtn) {
        skipAllBtn.onclick = async () => {
            console.log(`⏭️ [WEB] "Filial va Brendlarni O'tkazib Yuborish" tugmasi bosildi`);
            window.approvalSkipLocations = true;
            window.approvalSkipBrands = true;
            // Barcha checkboxlarni o'chirish
            const locationCheckboxes = document.querySelectorAll('#approval-locations-checkbox-list input[type="checkbox"]');
            const brandCheckboxes = document.querySelectorAll('#approval-brands-list input[type="checkbox"]');
            locationCheckboxes.forEach(cb => {
                cb.checked = false;
            });
            brandCheckboxes.forEach(cb => {
                cb.checked = false;
            });
            console.log(`✅ [WEB] ${locationCheckboxes.length} ta filial va ${brandCheckboxes.length} ta brend checkbox o'chirildi`);
            
            // Submit qilish
            const form = document.getElementById('approval-form');
            if (form) {
                console.log(`📤 [WEB] Form avtomatik yuborilmoqda...`);
                const event = new Event('submit', { bubbles: true, cancelable: true });
                form.dispatchEvent(event);
            }
        };
    }
    
    // Orqaga qaytarish - Rol tanlashga
    const backToRoleBtn = document.getElementById('back-to-role-btn');
    if (backToRoleBtn) {
        backToRoleBtn.onclick = () => {
            console.log(`⬅️ [WEB] "Orqaga (Rol tanlash)" tugmasi bosildi`);
            // Filiallar va brendlarni yashirish
            const locationsGroup = document.getElementById('approval-locations-group');
            const brandsGroup = document.getElementById('approval-brands-group');
            if (locationsGroup) locationsGroup.style.display = 'none';
            if (brandsGroup) brandsGroup.style.display = 'none';
            
            // Rol select'ni reset qilish
            const roleSelect = document.getElementById('approval-role');
            if (roleSelect) {
                roleSelect.value = '';
                console.log(`✅ [WEB] Rol select reset qilindi`);
            }
            
            // State'ni tozalash
            window.approvalSkipLocations = false;
            window.approvalSkipBrands = false;
            
            // Checkboxlarni tozalash
            document.querySelectorAll('#approval-locations-checkbox-list input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            document.querySelectorAll('#approval-brands-list input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            
            console.log(`✅ [WEB] Orqaga qaytarildi: Rol tanlash bosqichiga`);
        };
    }
    
    // Orqaga qaytarish - Filiallar tanlashga
    const backToLocationsBtn = document.getElementById('back-to-locations-btn');
    if (backToLocationsBtn) {
        backToLocationsBtn.onclick = () => {
            console.log(`⬅️ [WEB] "Orqaga (Filiallar)" tugmasi bosildi`);
            // Brendlarni yashirish
            const brandsGroup = document.getElementById('approval-brands-group');
            if (brandsGroup) brandsGroup.style.display = 'none';
            
            // Filiallarni ko'rsatish
            const locationsGroup = document.getElementById('approval-locations-group');
            if (locationsGroup) locationsGroup.style.display = 'block';
            
            // State'ni tozalash
            window.approvalSkipBrands = false;
            
            // Brend checkboxlarni tozalash
            document.querySelectorAll('#approval-brands-list input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            
            console.log(`✅ [WEB] Orqaga qaytarildi: Filiallar tanlash bosqichiga`);
        };
    }
}

export async function submitUserApproval(e) {
    console.log('🚀 ========================================');
    console.log('🚀 [TASDIQLASH] Boshlanish - submitUserApproval');
    console.log('🚀 ========================================');
    
    e.preventDefault();
    
    const userId = DOM.approvalUserIdInput?.value;
    const role = DOM.approvalRoleSelect?.value;
    
    console.log(`📝 [TASDIQLASH] 1. Form ma\'lumotlari olingan:`);
    console.log(`   - User ID: ${userId}`);
    console.log(`   - Role: ${role}`);
    console.log(`   - DOM.approvalUserIdInput: ${DOM.approvalUserIdInput ? 'MAVJUD' : 'YO\'Q'}`);
    console.log(`   - DOM.approvalRoleSelect: ${DOM.approvalRoleSelect ? 'MAVJUD' : 'YO\'Q'}`);
    if (DOM.approvalRoleSelect) {
        console.log(`   - DOM.approvalRoleSelect.value: "${DOM.approvalRoleSelect.value}"`);
        console.log(`   - DOM.approvalRoleSelect.selectedIndex: ${DOM.approvalRoleSelect.selectedIndex}`);
        console.log(`   - DOM.approvalRoleSelect.options.length: ${DOM.approvalRoleSelect.options.length}`);
    }
    
    // Validatsiya: User ID va Role mavjudligini tekshirish
    if (!userId || userId.trim() === '') {
        console.error(`❌ [TASDIQLASH] User ID topilmadi yoki bo'sh!`);
        showToast('Foydalanuvchi ID topilmadi', true);
        return;
    }
    
    if (!role || role.trim() === '' || role === 'null' || role === 'undefined') {
        console.error(`❌ [TASDIQLASH] Rol tanlanmagan!`);
        console.error(`   - Role qiymati: "${role}"`);
        console.error(`   - Role type: ${typeof role}`);
        showToast('Iltimos, avval rolni tanlang', true);
        return;
    }
    
    // Rol talablarini state'dan olish
    console.log(`📋 [TASDIQLASH] 2. State'dan rol ma'lumotlarini olish...`);
    console.log(`   - State.roles soni: ${state.roles?.length || 0}`);
    const roleData = state.roles.find(r => r.role_name === role);
    console.log(`   - RoleData topildi: ${roleData ? 'HA' : 'YO\'Q'}`);
    if (roleData) {
        console.log(`   - RoleData to'liq ma'lumot:`, JSON.stringify(roleData, null, 2));
    }
    
    // Superadmin uchun hech qanday shartlar yo'q (to'liq dostup)
    if (role === 'superadmin' || role === 'super_admin') {
        console.log(`✅ [TASDIQLASH] Superadmin uchun shartlar tekshirilmaydi (to'liq dostup)`);
        // Superadmin uchun hech qanday validatsiya yo'q
        const data = {
            role: role,
            locations: [],
            brands: []
        };
        
        console.log(`📤 [TASDIQLASH] Superadmin uchun API'ga yuborilmoqda...`);
        console.log(`   - Data:`, JSON.stringify(data, null, 2));

        try {
            console.log(`🌐 [TASDIQLASH] API so'rovini yuborish...`);
            const res = await safeFetch(`/api/users/${userId}/approve`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!res || !res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message);
            }
            
            const result = await res.json();
            showToast(result.message);
            
            const [pendingRes, usersRes] = await Promise.all([
                fetchPendingUsers(),
                fetchUsers()
            ]);

            if (pendingRes) {
                state.pendingUsers = pendingRes;
                renderPendingUsers();
            }
            if (usersRes) {
                state.users = usersRes;
                const activeTab = DOM.userTabs.querySelector('.active')?.dataset.status || 'active';
                if (activeTab) {
                    currentFilters.accountStatus = activeTab === 'active' ? 'active' : 
                                                   activeTab === 'pending' ? 'pending' : 
                                                   activeTab === 'inactive' ? 'inactive' : '';
                }
                renderModernUsers();
            }
            
            DOM.approvalModal.classList.add('hidden');
        } catch (error) {
            console.error('❌ [TASDIQLASH] Xatolik:', error);
            showToast(error.message, true);
        }
        return;
    }
    
    // Belgilanmagan yoki belgilangan holatni aniqlash
    console.log(`🔍 [TASDIQLASH] 3. Rol shartlarini tekshirish...`);
    
    const isLocationsRequired = roleData 
        ? (roleData.requires_locations !== undefined && roleData.requires_locations !== null 
            ? roleData.requires_locations 
            : null)  // null = belgilanmagan
        : null;
    
    const isBrandsRequired = roleData 
        ? (roleData.requires_brands !== undefined && roleData.requires_brands !== null 
            ? roleData.requires_brands 
            : null)  // null = belgilanmagan
        : null;
    
    console.log(`   - requires_locations: ${isLocationsRequired} (type: ${typeof isLocationsRequired})`);
    console.log(`   - requires_brands: ${isBrandsRequired} (type: ${typeof isBrandsRequired})`);
    
    // Agar shartlar belgilanmagan bo'lsa, tasdiqlashni to'xtatish
    const isLocationsUndefined = (isLocationsRequired === null || isLocationsRequired === undefined);
    const isBrandsUndefined = (isBrandsRequired === null || isBrandsRequired === undefined);
    const isRequirementsUndefined = isLocationsUndefined || isBrandsUndefined;
    
    console.log(`🔍 [TASDIQLASH] 4. Shartlar belgilanmaganligini tekshirish:`);
    console.log(`   - isRequirementsUndefined: ${isRequirementsUndefined}`);
    
    // Agar shartlar belgilanmagan bo'lsa, tasdiqlashni to'xtatish
    if (isRequirementsUndefined) {
        console.log(`❌ [TASDIQLASH] 5. XATOLIK: Rol shartlari belgilanmagan!`);
        console.log(`   - Role: ${role}`);
        console.log(`   - requires_locations: ${roleData?.requires_locations}`);
        console.log(`   - requires_brands: ${roleData?.requires_brands}`);
        showToast(`"${role}" roli uchun shartlar belgilanmagan. Avval shart belgilanishi kerak.`, true);
        return;
    }
    
    console.log(`✅ [TASDIQLASH] 5. Rol shartlari belgilangan. Validatsiyaga o'tilmoqda...`);
    
    // Data obyektini yaratish
    console.log(`📦 [TASDIQLASH] 6. Data obyektini yaratish...`);
    const data = {
        role: role,
        locations: [],
        brands: []
    };
    
    // FILIALLAR VALIDATSIYASI
    console.log(`📍 [TASDIQLASH] 7. Filiallar validatsiyasi...`);
    console.log(`   - isLocationsRequired: ${isLocationsRequired} (type: ${typeof isLocationsRequired})`);
    
    if (isLocationsRequired === true) {
        // Majburiy - filiallar tanlash kerak
        const locationCheckboxes = document.querySelectorAll('#approval-locations-checkbox-list input:checked');
        const selectedLocations = Array.from(locationCheckboxes).map(cb => cb.value);
        data.locations = selectedLocations;
        
        console.log(`   - Tanlangan filiallar soni: ${selectedLocations.length}`);
        
        if (data.locations.length === 0) {
            console.log(`   ❌ XATOLIK: Filiallar majburiy, lekin tanlanmagan!`);
            showToast(`"${role}" roli uchun kamida bitta filial tanlanishi shart.`, true);
            return;
        }
        console.log(`   ✅ Filiallar validatsiyasi o'tdi`);
    } else {
        // false - filiallar kerak emas
        console.log(`   ✅ Filiallar kerak emas (false)`);
    }
    
    // BRENDLAR VALIDATSIYASI
    console.log(`🏷️ [TASDIQLASH] 8. Brendlar validatsiyasi...`);
    console.log(`   - isBrandsRequired: ${isBrandsRequired} (type: ${typeof isBrandsRequired})`);
    
    if (isBrandsRequired === true) {
        // Majburiy - brendlar tanlash kerak
        const brandCheckboxes = document.querySelectorAll('#approval-brands-list input:checked');
        const selectedBrands = Array.from(brandCheckboxes).map(cb => parseInt(cb.value));
        data.brands = selectedBrands;
        
        console.log(`   - Tanlangan brendlar soni: ${selectedBrands.length}`);
        
        if (data.brands.length === 0) {
            console.log(`   ❌ XATOLIK: Brendlar majburiy, lekin tanlanmagan!`);
            showToast(`"${role}" roli uchun kamida bitta brend tanlanishi shart.`, true);
            return;
        }
        console.log(`   ✅ Brendlar validatsiyasi o'tdi`);
    } else {
        // false - brendlar kerak emas
        console.log(`   ✅ Brendlar kerak emas (false)`);
    }
    
    console.log(`📤 [TASDIQLASH] 9. Barcha validatsiyalar o'tdi. API'ga yuborilmoqda...`);
    console.log(`   - Data:`, JSON.stringify(data, null, 2));

    try {
        console.log(`🌐 [TASDIQLASH] 10. API so'rovini yuborish...`);
        console.log(`   - URL: /api/users/${userId}/approve`);
        console.log(`   - Method: PUT`);
        
        const res = await safeFetch(`/api/users/${userId}/approve`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        console.log(`📥 [TASDIQLASH] 11. API javob olingan:`);
        console.log(`   - Status: ${res?.status}`);
        console.log(`   - OK: ${res?.ok}`);
        
        if (!res || !res.ok) {
            const errorData = await res.json();
            console.error(`   ❌ API xatolik:`, errorData);
            throw new Error(errorData.message);
        }
        
        const result = await res.json();
        console.log(`✅ [TASDIQLASH] 12. Muvaffaqiyatli tasdiqlandi!`);
        console.log(`   - Result:`, result);
        showToast(result.message);
        
        const [pendingRes, usersRes] = await Promise.all([
            fetchPendingUsers(),
            fetchUsers()
        ]);

        if (pendingRes) {
            state.pendingUsers = pendingRes;
            renderPendingUsers();
        }
        if (usersRes) {
            state.users = usersRes;
            // Faqat userTabs mavjud bo'lsa, render qilish
            if (DOM.userTabs) {
                const activeTab = DOM.userTabs.querySelector('.active')?.dataset.status;
                if (activeTab) {
                    currentFilters.accountStatus = activeTab === 'active' ? 'active' : 
                                                   activeTab === 'pending' ? 'pending' : 
                                                   activeTab === 'inactive' ? 'inactive' : '';
                    renderModernUsers();
                }
            }
        }
        
        // State'ni tozalash
        window.approvalSkipLocations = false;
        window.approvalSkipBrands = false;
        
        // Modal yopish
        if (DOM.approvalModal) {
            DOM.approvalModal.classList.add('hidden');
        }
        
        // Bulk approval navbatini tekshirish
        if (window.bulkApprovalQueue && window.bulkApprovalQueue.length > 0) {
            window.bulkApprovalCurrentIndex = (window.bulkApprovalCurrentIndex || 0) + 1;
            const nextUser = window.bulkApprovalQueue.shift();
            
            console.log(`📋 [BULK APPROVE] Navbatdagi foydalanuvchi: ${nextUser.username || nextUser.fullname} (ID: ${nextUser.id})`);
            console.log(`📋 [BULK APPROVE] Qolgan: ${window.bulkApprovalQueue.length} ta`);
            
            // Kichik kechikish - modal yopilishi uchun
            setTimeout(async () => {
                try {
                    const nextUsername = nextUser.username || nextUser.fullname || `User ${nextUser.id}`;
                    await openApprovalModal(nextUser.id, nextUsername);
                } catch (error) {
                    console.error('❌ [BULK APPROVE] Navbatdagi foydalanuvchi uchun modal ochishda xatolik:', error);
                    // Navbatni tozalash
                    window.bulkApprovalQueue = null;
                    window.bulkApprovalCurrentIndex = null;
                    window.bulkApprovalTotal = null;
                }
            }, 300);
        } else {
            // Bulk approval yakunlandi
            if (window.bulkApprovalTotal) {
                console.log(`✅ [BULK APPROVE] Barcha ${window.bulkApprovalTotal} ta foydalanuvchi tasdiqlandi`);
                showToast(`Barcha ${window.bulkApprovalTotal} ta foydalanuvchi muvaffaqiyatli tasdiqlandi`, 'success');
                window.bulkApprovalTotal = null;
            }
            window.bulkApprovalQueue = null;
            window.bulkApprovalCurrentIndex = null;
            
            // Tanlanganlarni tozalash
            selectedRequests.clear();
            updateRequestsBulkActions();
        }
        
        // So'rovlar bo'limini yangilash
        console.log(`🔄 [TASDIQLASH] 13. UI yangilanmoqda...`);
        renderModernRequests();
        updateRequestsStatistics();
        
        console.log('✅ ========================================');
        console.log('✅ [TASDIQLASH] Jarayon muvaffaqiyatli yakunlandi!');
        console.log('✅ ========================================');
    } catch (error) {
        console.error('❌ ========================================');
        console.error(`❌ [TASDIQLASH] XATOLIK YUZ BERDI!`);
        console.error(`❌ [TASDIQLASH] Xatolik:`, error);
        console.error(`❌ [TASDIQLASH] Xatolik stack:`, error.stack);
        console.error('❌ ========================================');
        showToast(error.message, true);
    }
}

export async function handleUserRejection(userId) {
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

export async function handlePendingUserActions(e) {
    const button = e.target.closest('button');
    if (!button) return;
    
    const userId = button.dataset.id;
    
    if (button.classList.contains('approve-user-btn')) {
        const username = button.dataset.username;
        openApprovalModal(userId, username);
    } else if (button.classList.contains('reject-user-btn')) {
        const confirmed = await showConfirmDialog({
            title: '❌ So\'rovni rad etish',
            message: "Rostdan ham bu foydalanuvchining so'rovini rad etmoqchimisiz?",
            confirmText: 'Rad etish',
            cancelText: 'Bekor qilish',
            type: 'danger',
            icon: 'user-x'
        });
        
        if (confirmed) {
            handleUserRejection(userId);
        }
    }
}

// Eski funksiya - handleSessionTerminate ga yo'naltirish
export async function handleSessionTermination(e) {
    // handleSessionTerminate funksiyasini chaqirish
    await handleSessionTerminate(e);
}

/* ===================================================== */
/* === 👥 YANGI ADMIN FUNKSIYALARI === */
/* ===================================================== */

/**
 * Avatar yaratish (ismdan birinchi harf)
 */
export function createAvatar(fullName) {
    if (!fullName) return '';
    
    const initials = fullName
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
    
    // Rang generatsiya (ismga qarab)
    const colors = [
        '#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8',
        '#6f42c1', '#fd7e14', '#e83e8c', '#20c997', '#6610f2'
    ];
    
    const charCode = fullName.charCodeAt(0) + fullName.charCodeAt(fullName.length - 1);
    const colorIndex = charCode % colors.length;
    const backgroundColor = colors[colorIndex];
    
    return `<div class="user-avatar" style="background: ${backgroundColor}">${initials}</div>`;
}

/**
 * Status badge yaratish
 */
export function createStatusBadge(status) {
    const statusMap = {
        'active': { class: 'active', text: 'Faol', icon: '🟢' },
        'pending': { class: 'pending', text: 'Kutilmoqda', icon: '🟡' },
        'inactive': { class: 'inactive', text: 'Nofaol', icon: '🔴' }
    };
    
    const statusInfo = statusMap[status] || statusMap['inactive'];
    
    return `
        <span class="status-badge ${statusInfo.class}">
            <span class="status-dot"></span>
            ${statusInfo.text}
        </span>
    `;
}

/**
 * Quick actions tugmalari
 */
export function createQuickActions(userId) {
    return `
        <div class="quick-actions">
            <button class="action-btn view" onclick="window.viewUserQuick(${userId})" title="Ko'rish">
                <i data-feather="eye"></i>
            </button>
            <button class="action-btn edit" onclick="window.editUserQuick(${userId})" title="Tahrirlash">
                <i data-feather="edit-2"></i>
            </button>
            <button class="action-btn delete" onclick="window.deleteUserQuick(${userId})" title="O'chirish">
                <i data-feather="trash-2"></i>
            </button>
        </div>
    `;
}

/**
 * Telegram status badge
 */
export function createTelegramStatus(telegramId, telegramUsername) {
    const isConnected = telegramId && telegramUsername;
    
    if (isConnected) {
        return `
            <span class="telegram-status connected" title="Telegram ulangan">
                <i data-feather="check-circle" style="width: 12px; height: 12px;"></i>
                @${telegramUsername}
            </span>
        `;
    } else {
        return `
            <span class="telegram-status disconnected" title="Telegram ulanmagan">
                <i data-feather="x-circle" style="width: 12px; height: 12px;"></i>
                Ulanmagan
            </span>
        `;
    }
}

/**
 * Bulk selection barini ko'rsatish
 */
export function toggleUserSelection(userId, checkbox) {
    if (checkbox.checked) {
        selectedUsers.add(userId);
    } else {
        selectedUsers.delete(userId);
    }
    
    updateBulkActionsBar();
}

// Global funktsiya qilish
window.toggleUserSelection = toggleUserSelection;

/**
 * Foydalanuvchi tezkor ko'rish
 */
window.viewUserQuick = async function(userId) {
    const user = state.users.find(u => u.id === userId);
    if (!user) return;
    
    // Modal yaratish
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="user-quick-view">
            <div class="user-quick-view-header">
                ${createAvatar(user.full_name)}
                <div class="user-quick-view-info">
                    <h3>${user.full_name}</h3>
                    ${createStatusBadge(user.status)}
                    ${createTelegramStatus(user.telegram_id, user.telegram_username)}
                </div>
            </div>
            <div class="user-quick-view-body">
                <div class="user-quick-view-stat">
                    <span class="label">👤 Foydalanuvchi nomi:</span>
                    <span class="value">${user.username}</span>
                </div>
                <div class="user-quick-view-stat">
                    <span class="label">🎭 Rol:</span>
                    <span class="value">${user.role_name || 'Yo\'q'}</span>
                </div>
                <div class="user-quick-view-stat">
                    <span class="label">📍 Joylashuv:</span>
                    <span class="value">${user.location_name || 'Yo\'q'}</span>
                </div>
                <div class="user-quick-view-stat">
                    <span class="label">📅 Ro'yxatdan o'tgan:</span>
                    <span class="value">${user.created_at ? formatDate(user.created_at) : 'Noma\'lum'}</span>
                </div>
                <div class="user-quick-view-stat">
                    <span class="label">⏰ Oxirgi faollik:</span>
                    <span class="value">${user.last_active ? formatDate(user.last_active) : 'Hech qachon'}</span>
                </div>
            </div>
            <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                    Yopish
                </button>
                <button class="btn btn-primary" onclick="window.editUserQuick(${userId}); this.closest('.modal-overlay').remove();">
                    Tahrirlash
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    feather.replace();
    
    // Click tashqarida yopish
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

/**
 * Global functions for bulk operations
 */
window.clearSelection = function() {
    selectedUsers.clear();
    document.querySelectorAll('.bulk-select-checkbox').forEach(cb => cb.checked = false);
    updateBulkActionsBar();
}

window.bulkChangeStatus = async function() {
    if (selectedUsers.size === 0) return;
    
    const newStatus = prompt('Yangi holat (active/inactive):');
    if (!newStatus || !['active', 'inactive'].includes(newStatus)) return;
    
    try {
        for (const userId of selectedUsers) {
            await safeFetch(`/api/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
        }
        
        showToast(`✅ ${selectedUsers.size} ta foydalanuvchi holati o'zgartirildi`);
        window.clearSelection();
        await fetchUsers();
        renderModernUsers();
    } catch (error) {
        showToast(`❌ Xatolik: ${error.message}`, true);
    }
}

window.bulkAssignRole = async function() {
    if (selectedUsers.size === 0) return;
    
    const roleId = prompt('Rol ID raqamini kiriting:');
    if (!roleId) return;
    
    try {
        for (const userId of selectedUsers) {
            await safeFetch(`/api/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role_id: parseInt(roleId) })
            });
        }
        
        showToast(`✅ ${selectedUsers.size} ta foydalanuvchiga rol berildi`);
        window.clearSelection();
        await fetchUsers();
        renderModernUsers();
    } catch (error) {
        showToast(`❌ Xatolik: ${error.message}`, true);
    }
}

window.bulkDeleteUsers = async function() {
    if (selectedUsers.size === 0) return;
    
    const confirmed = await showConfirmDialog({
        title: '🗑️ Ko\'plab foydalanuvchilarni o\'chirish',
        message: `${selectedUsers.size} ta foydalanuvchini o'chirmoqchimisiz? Bu amalni qaytarib bo'lmaydi!`,
        confirmText: `${selectedUsers.size} ta o'chirish`,
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'trash-2'
    });
    
    if (!confirmed) return;
    
    try {
        for (const userId of selectedUsers) {
            await safeFetch(`/api/users/${userId}`, { method: 'DELETE' });
        }
        
        showToast(`✅ ${selectedUsers.size} ta foydalanuvchi o'chirildi`);
        window.clearSelection();
        await fetchUsers();
        renderModernUsers();
    } catch (error) {
        showToast(`❌ Xatolik: ${error.message}`, true);
    }
}

window.editUserQuick = function(userId) {
    // Mavjud edit funksiyasini chaqirish
    const user = state.users.find(u => u.id === userId);
    if (user) {
        // User form modalni ochish va ma'lumotlarni to'ldirish
        const editBtn = document.querySelector(`button[onclick*="handleUserActions"][onclick*="'edit'"][onclick*="${userId}"]`);
        if (editBtn) editBtn.click();
    }
}

window.deleteUserQuick = async function(userId) {
    const confirmed = await showConfirmDialog({
        title: '🗑️ Foydalanuvchini o\'chirish',
        message: 'Foydalanuvchini o\'chirmoqchimisiz? Bu amalni qaytarib bo\'lmaydi!',
        confirmText: 'O\'chirish',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'trash-2'
    });
    
    if (!confirmed) return;
    
    try {
        const res = await safeFetch(`/api/users/${userId}`, { method: 'DELETE' });
        if (!res || !res.ok) throw new Error((await res.json()).message);
        
        showToast('✅ Foydalanuvchi o\'chirildi');
        await fetchUsers();
        renderUsersByStatus();
    } catch (error) {
        showToast(`❌ ${error.message}`, true);
    }
}

// ===== MODERN USERS MODULE - EVENT LISTENERS =====

// Initialize modern users page
export function initModernUsersPage() {
    log.debug('initModernUsersPage chaqirildi');
    
    // Setup filters (this also sets up view toggle buttons)
    setupUsersFilters();

    // Setup collapsible filters toggle
    const filtersCard = document.querySelector('.users-filters-card');
    const toggleFiltersBtn = document.getElementById('toggle-users-filters-btn');
    const filtersHeader = document.querySelector('.users-filters-header');
    log.debug('Filters card topildi:', !!filtersCard, 'Toggle btn topildi:', !!toggleFiltersBtn, 'Header topildi:', !!filtersHeader);

    // Global funksiya (header / ikonka bosilganda ishlashi uchun)
    window.toggleUsersFilters = function () {
        if (!filtersCard || !toggleFiltersBtn) {
            console.warn('⚠️ [USERS] Filters collapse elementlari topilmadi');
            return;
        }
        const isCollapsed = filtersCard.classList.toggle('collapsed');
        console.log('🎚️ [USERS] Filters collapse toggled. collapsed =', isCollapsed);
        toggleFiltersBtn.setAttribute('aria-expanded', (!isCollapsed).toString());
    };

    if (filtersHeader) {
        filtersHeader.addEventListener('click', () => {
            window.toggleUsersFilters();
        });
    }
    
    // Initialize view toggle icons and search icon
    if (window.feather) {
        setTimeout(() => {
            // View toggle icons
            const viewToggleContainer = document.querySelector('.view-toggle-buttons');
            if (viewToggleContainer) {
                feather.replace({ root: viewToggleContainer });
            }
            
            // Search icon
            const searchContainer = document.querySelector('#users-search-input')?.parentElement;
            if (searchContainer) {
                feather.replace({ root: searchContainer });
            }
        }, 200);
    }
    
    // Load users
    fetchUsers().then(() => {
        renderModernUsers();
    });
    
    // Setup refresh button
    const refreshBtn = document.getElementById('refresh-users-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.innerHTML = '<i data-feather="refresh-cw" class="spin"></i><span>Yangilanmoqda...</span>';
            await fetchUsers();
            renderModernUsers();
            refreshBtn.innerHTML = '<i data-feather="refresh-cw"></i><span>Yangilash</span>';
            feather.replace();
            showToast('✅ Ma\'lumotlar yangilandi');
        });
    }
}

// Load role filter badges dynamically
function loadRoleFilterBadges() {
    const roleBadgesContainer = document.getElementById('users-role-badges');
    if (!roleBadgesContainer || !state.roles) return;

    // Count users by role
    const roleCounts = {};
    let totalUsers = 0;
    
    if (state.users) {
        totalUsers = state.users.length;
        state.users.forEach(user => {
            const role = user.role || 'user';
            roleCounts[role] = (roleCounts[role] || 0) + 1;
        });
    }

    // Get ONLY existing roles (with count > 0)
    const existingRoles = Object.keys(roleCounts).filter(role => roleCounts[role] > 0);

    // Role icons and colors
    const roleConfig = {
        'admin': { icon: 'shield', color: 'danger', label: 'Admin' },
        'manager': { icon: 'briefcase', color: 'warning', label: 'Manager' },
        'operator': { icon: 'user-check', color: 'info', label: 'Operator' },
        'user': { icon: 'user', color: 'success', label: 'User' },
        'viewer': { icon: 'eye', color: 'info', label: 'Viewer' }
    };

    // Build badges HTML - start with "Barchasi"
    let badgesHTML = `
        <button class="filter-badge filter-badge-primary active" data-role="">
            <i data-feather="users"></i>
            <span>Barchasi</span>
            <span class="badge-count" id="role-count-all">${totalUsers}</span>
        </button>
    `;

    // Add only existing roles
    existingRoles.forEach(role => {
        const config = roleConfig[role] || { icon: 'user', color: 'info', label: role.charAt(0).toUpperCase() + role.slice(1) };
        const count = roleCounts[role];
        
        badgesHTML += `
            <button class="filter-badge filter-badge-${config.color}" data-role="${role}">
                <i data-feather="${config.icon}"></i>
                <span>${config.label}</span>
                <span class="badge-count" id="role-count-${role}">${count}</span>
            </button>
        `;
    });

    roleBadgesContainer.innerHTML = badgesHTML;
    feather.replace();

    // Setup click handlers
    const roleBadges = roleBadgesContainer.querySelectorAll('.filter-badge');
    roleBadges.forEach(badge => {
        badge.addEventListener('click', () => {
            // Remove active from all
            roleBadges.forEach(b => b.classList.remove('active'));
            
            // Add active to clicked
            badge.classList.add('active');
            
            // Update filter
            currentFilters.role = badge.dataset.role || '';
            
            // Re-render
            renderModernUsers();
        });
    });
}

// Setup all filters
function setupUsersFilters() {
    // Load and setup role filter badges dynamically
    loadRoleFilterBadges();
    
    // Account Status filter badges
    const accountStatusBadges = document.querySelectorAll('#users-account-status-badges .filter-badge');
    accountStatusBadges.forEach(badge => {
        badge.addEventListener('click', () => {
            accountStatusBadges.forEach(b => b.classList.remove('active'));
            badge.classList.add('active');
            currentFilters.accountStatus = badge.dataset.accountStatus || '';
            filteredUsersCache = null; // Clear cache on filter change
            renderModernUsers();
        });
    });

    // Online Status filter badges
    const onlineStatusBadges = document.querySelectorAll('#users-online-status-badges .filter-badge');
    onlineStatusBadges.forEach(badge => {
        badge.addEventListener('click', () => {
            onlineStatusBadges.forEach(b => b.classList.remove('active'));
            badge.classList.add('active');
            currentFilters.onlineStatus = badge.dataset.onlineStatus || '';
            filteredUsersCache = null; // Clear cache on filter change
            renderModernUsers();
        });
    });

    // Telegram Status filter badges
    const telegramStatusBadges = document.querySelectorAll('#users-telegram-status-badges .filter-badge');
    telegramStatusBadges.forEach(badge => {
        badge.addEventListener('click', () => {
            telegramStatusBadges.forEach(b => b.classList.remove('active'));
            badge.classList.add('active');
            currentFilters.telegramStatus = badge.dataset.telegramStatus || '';
            filteredUsersCache = null; // Clear cache on filter change
            renderModernUsers();
        });
    });
    
    // View toggle buttons
    const gridBtn = document.getElementById('view-toggle-grid');
    const listBtn = document.getElementById('view-toggle-list');
    
    if (gridBtn) {
        // Remove old listeners by cloning
        const newGridBtn = gridBtn.cloneNode(true);
        gridBtn.parentNode.replaceChild(newGridBtn, gridBtn);
        
        newGridBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleUsersViewMode('grid');
        });
    }
    
    if (listBtn) {
        // Remove old listeners by cloning
        const newListBtn = listBtn.cloneNode(true);
        listBtn.parentNode.replaceChild(newListBtn, listBtn);
        
        newListBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleUsersViewMode('list');
        });
    }
    
    // Replace feather icons for view toggle buttons
    if (window.feather) {
        setTimeout(() => {
            const viewToggleContainer = document.querySelector('.view-toggle-buttons');
            if (viewToggleContainer) {
                feather.replace({ root: viewToggleContainer });
            }
            // Replace search icon
            const searchContainer = document.querySelector('#users-search-input')?.parentElement;
            if (searchContainer) {
                feather.replace({ root: searchContainer });
            }
        }, 50);
    }
    
    // Search input endi pagination ichida, setupPaginationSearchInput() orqali sozlanadi
    // View toggle buttons endi pagination ichida, setupPaginationViewToggle() orqali sozlanadi
    
    // Apply initial view mode
    applyViewMode();
    
    // Bulk actions
    setupBulkActions();
}

// Setup bulk actions
function setupBulkActions() {
    const bulkActivateBtn = document.getElementById('bulk-activate-btn');
    const bulkDeactivateBtn = document.getElementById('bulk-deactivate-btn');
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    
    if (bulkActivateBtn) {
        bulkActivateBtn.addEventListener('click', () => bulkAction('activate'));
    }
    
    if (bulkDeactivateBtn) {
        bulkDeactivateBtn.addEventListener('click', () => bulkAction('deactivate'));
    }
    
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', () => bulkAction('delete'));
    }
}

// Bulk action handler
async function bulkAction(action) {
    if (selectedUsers.size === 0) {
        showToast('❌ Foydalanuvchi tanlanmagan', 'error');
        return;
    }
    
    const actionText = action === 'activate' ? 'faollashtirish' : 
                      action === 'deactivate' ? 'deaktiv qilish' : 
                      'o\'chirish';
    
    const confirmed = await showConfirmDialog({
        title: `${selectedUsers.size} ta foydalanuvchini ${actionText}`,
        message: `Tanlangan foydalanuvchilarni ${actionText}ni tasdiqlaysizmi?`,
        confirmText: 'Tasdiqlash',
        cancelText: 'Bekor qilish',
        type: action === 'delete' ? 'danger' : 'warning'
    });
    
    if (!confirmed) return;
    
    try {
        const userIds = Array.from(selectedUsers);
        
        for (const userId of userIds) {
            if (action === 'activate') {
                await safeFetch(`/api/users/${userId}/activate`, { method: 'POST' });
            } else if (action === 'deactivate') {
                await safeFetch(`/api/users/${userId}/deactivate`, { method: 'POST' });
            } else if (action === 'delete') {
                await safeFetch(`/api/users/${userId}`, { method: 'DELETE' });
            }
        }
        
        showToast(`✅ ${selectedUsers.size} ta foydalanuvchi ${actionText}ildi`);
        
        // Clear selection
        selectedUsers.clear();
        updateBulkActionsBar();
        
        // Reload
        await fetchUsers();
        renderModernUsers();
        
    } catch (error) {
        showToast(`❌ Xatolik: ${error.message}`, 'error');
    }
}

// Update bulk actions bar visibility
function updateBulkActionsBar() {
    const bulkContainer = document.getElementById('bulk-actions-container');
    const selectedCountEl = document.getElementById('selected-count');
    
    if (bulkContainer && selectedCountEl) {
        bulkContainer.style.display = selectedUsers.size > 0 ? 'flex' : 'none';
        selectedCountEl.textContent = selectedUsers.size;
    }
    
    // Update checkboxes state
    document.querySelectorAll('.user-card-checkbox').forEach(checkbox => {
        const userId = parseInt(checkbox.dataset.userId);
        checkbox.checked = selectedUsers.has(userId);
    });
}

// ============================================
// REQUESTS SECTION - MODERN DESIGN
// ============================================

// Helper function to update element text
function updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = value;
    }
}

// Helper function to get initials from name
function getInitials(name) {
    if (!name) return '??';
    const words = name.trim().split(/\s+/);
    if (words.length === 1) {
        return words[0].substring(0, 2).toUpperCase();
    }
    return (words[0][0] + (words[1] ? words[1][0] : words[0][1])).toUpperCase();
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// State for requests section
let selectedRequests = new Set();
let currentRequestsFilter = {
    status: '',
    sort: 'newest'
};

// View mode for requests (grid or list)
let currentRequestsViewMode = localStorage.getItem('requestsViewMode') || 'grid';

// Render request card (grid view)
function renderRequestCard(request) {
    const initials = getInitials(request.full_name || request.fullname || request.username);
    const createdDate = request.created_at ? formatDate(request.created_at) : 'Noma\'lum';
    const fullName = request.full_name || request.fullname || 'Noma\'lum';
    const username = request.username || 'noname';
    const telegramId = request.telegram_id || request.telegram_chat_id;
    const telegramUsername = request.telegram_username;
    const isPasswordChange = request.type === 'password_change';
    const role = request.role || 'user';
    const requestTypeText = isPasswordChange ? 'Parol tiklash' : 'Ro\'yxatdan o\'tish';
    const requestTypeIcon = isPasswordChange ? 'key' : 'user-plus';
    
    return `
        <div class="user-card" data-request-id="${request.id}" data-request-type="${isPasswordChange ? 'password_change' : 'registration'}" style="position: relative;">
            <div class="user-card-header" style="position: relative;">
                <input type="checkbox" class="user-card-checkbox" 
                       data-request-id="${request.id}"
                       ${selectedRequests.has(request.id) ? 'checked' : ''}
                       style="position: absolute; top: 0; left: 0; z-index: 10; width: 18px; height: 18px; cursor: pointer; margin: 0;">
                
                <div class="user-card-avatar" style="position: relative; width: 56px; height: 56px; min-width: 56px; flex-shrink: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; color: white; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3); margin-left: 24px;">
                    ${initials}
                    <div class="user-card-status-indicator ${request.status === 'pending' ? 'pending' : 'active'}" style="position: absolute; bottom: 2px; right: 2px; width: 14px; height: 14px; border-radius: 50%; border: 3px solid var(--card-bg); background: ${request.status === 'pending' ? '#f59e0b' : '#10b981'}; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>
                </div>

                <div class="user-card-info" style="flex: 1; min-width: 0;">
                    <div class="user-card-name">
                        ${escapeHtml(fullName)}
                    </div>
                    <div class="user-card-username">@${escapeHtml(username)}</div>
                    <div class="user-card-badges">
                        <span class="user-badge user-badge-${role}" style="background: ${isPasswordChange ? 'rgba(6, 182, 212, 0.2)' : 'rgba(59, 130, 246, 0.2)'}; color: ${isPasswordChange ? '#06b6d4' : '#3b82f6'}; border: 1px solid ${isPasswordChange ? 'rgba(6, 182, 212, 0.3)' : 'rgba(59, 130, 246, 0.3)'};">
                            <i data-feather="${requestTypeIcon}"></i>
                            ${requestTypeText}
                        </span>
                        <span class="user-badge user-badge-pending">
                            <i data-feather="clock"></i>
                            Kutmoqda
                        </span>
                        ${role && role !== 'user' ? `
                        <span class="user-badge user-badge-${role}">
                            <i data-feather="${role === 'admin' ? 'shield' : 'user'}"></i>
                            ${role}
                        </span>
                        ` : ''}
                    </div>
                </div>
            </div>

            <div class="user-card-details">
                ${telegramUsername ? `
                <div class="user-card-detail-item">
                    <i data-feather="send"></i>
                    <span>@${escapeHtml(telegramUsername)}</span>
                </div>
                ` : ''}
                ${telegramId ? `
                <div class="user-card-detail-item">
                    <i data-feather="hash"></i>
                    <span>Telegram ID: ${telegramId}</span>
                </div>
                ` : ''}
                ${request.email ? `
                <div class="user-card-detail-item">
                    <i data-feather="mail"></i>
                    <span>${escapeHtml(request.email)}</span>
                </div>
                ` : ''}
                ${request.phone ? `
                <div class="user-card-detail-item">
                    <i data-feather="phone"></i>
                    <span>${escapeHtml(request.phone)}</span>
                </div>
                ` : ''}
            </div>

            <div class="user-card-meta">
                <div class="user-card-meta-item">
                    <i data-feather="calendar"></i>
                    <span>${createdDate}</span>
                </div>
                <div class="user-card-meta-item">
                    <i data-feather="clock"></i>
                    <span>So'rov yuborilgan</span>
                </div>
            </div>

            <div class="user-card-actions">
                ${isPasswordChange ? `
                    <button class="user-card-action-btn" 
                            style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none;"
                            onclick="window.approvePasswordChangeRequest(${request.password_change_request_id})"
                            title="Tasdiqlash">
                        <i data-feather="check"></i>
                        Tasdiqlash
                    </button>
                    <button class="user-card-action-btn" 
                            style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; border: none; margin-left: 8px;"
                            onclick="window.rejectPasswordChangeRequest(${request.password_change_request_id})"
                            title="Rad etish">
                        <i data-feather="x"></i>
                        Rad etish
                    </button>
                ` : `
                    <button class="user-card-action-btn" 
                            style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none;"
                            onclick="window.approveRequest(${request.user_id || request.id})"
                            title="Tasdiqlash">
                        <i data-feather="check"></i>
                        Tasdiqlash
                    </button>
                    <button class="user-card-action-btn" 
                            style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; border: none; margin-left: 8px;"
                            onclick="window.rejectRequest(${request.user_id || request.id})"
                            title="Rad etish">
                        <i data-feather="x"></i>
                        Rad etish
                    </button>
                `}
            </div>
        </div>
    `;
}

// Render request list item (list view)
function renderRequestListItem(request) {
    const initials = getInitials(request.full_name || request.fullname || request.username);
    const createdDate = request.created_at ? formatDateTime(request.created_at) : 'Noma\'lum';
    const fullName = request.full_name || request.fullname || 'Noma\'lum';
    const username = request.username || 'noname';
    const telegramId = request.telegram_id || request.telegram_chat_id;
    const telegramUsername = request.telegram_username;
    const isPasswordChange = request.type === 'password_change';
    
    return `
        <div class="request-list-item" data-request-id="${request.id}" data-request-type="${isPasswordChange ? 'password_change' : 'registration'}">
            <div class="request-list-checkbox">
                <input type="checkbox" 
                       class="request-checkbox" 
                       data-request-id="${request.id}"
                       ${selectedRequests.has(request.id) ? 'checked' : ''}>
            </div>
            <div class="request-list-avatar">${initials}</div>
            <div class="request-list-info">
                <div class="request-list-name-row">
                    <h3 class="request-list-name">${escapeHtml(fullName)}${isPasswordChange ? ' <span style="color: #06b6d4; font-size: 0.85em;">(Parol tiklash)</span>' : ''}</h3>
                    ${getRequestStatusBadge(request)}
                </div>
                <div class="request-list-meta">
                    <span class="request-list-username">@${escapeHtml(username)}</span>
                    ${telegramId ? `<span class="request-list-telegram-id">Telegram ID: ${telegramId}</span>` : ''}
                    ${telegramUsername ? `<span class="request-list-telegram-username">@${escapeHtml(telegramUsername)}</span>` : ''}
                    <span class="request-list-date">
                        <i data-feather="clock"></i>
                        ${createdDate}
                    </span>
                </div>
            </div>
            <div class="request-list-actions">
                ${isPasswordChange ? `
                    <button class="btn btn-success btn-sm" onclick="window.approvePasswordChangeRequest(${request.password_change_request_id})">
                        <i data-feather="check"></i>
                        <span>Tasdiqlash</span>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="window.rejectPasswordChangeRequest(${request.password_change_request_id})">
                        <i data-feather="x"></i>
                        <span>Rad etish</span>
                    </button>
                ` : `
                    <button class="btn btn-success btn-sm" onclick="window.approveRequest(${request.user_id || request.id})">
                        <i data-feather="check"></i>
                        <span>Tasdiqlash</span>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="window.rejectRequest(${request.user_id || request.id})">
                        <i data-feather="x"></i>
                        <span>Rad etish</span>
                    </button>
                `}
            </div>
        </div>
    `;
}

// Apply requests view mode (grid or list)
function applyRequestsViewMode() {
    const container = document.getElementById('pending-users-list');
    if (!container) return;
    
    // Remove existing classes
    container.classList.remove('requests-grid', 'requests-list');
    
    // Add appropriate class
    if (currentRequestsViewMode === 'list') {
        container.classList.add('requests-list');
    } else {
        container.classList.add('requests-grid');
    }
    
    // Update toggle buttons
    const gridBtn = document.getElementById('requests-view-toggle-grid');
    const listBtn = document.getElementById('requests-view-toggle-list');
    
    if (gridBtn && listBtn) {
        if (currentRequestsViewMode === 'list') {
            gridBtn.classList.remove('active');
            listBtn.classList.add('active');
        } else {
            gridBtn.classList.add('active');
            listBtn.classList.remove('active');
        }
        
        // Replace icons after class change
        if (window.feather) {
            setTimeout(() => {
                const viewToggleContainer = document.querySelector('.requests-view-toggle-buttons');
                if (viewToggleContainer) {
                    feather.replace({ root: viewToggleContainer });
                }
            }, 10);
        }
    }
}

// Toggle requests view mode
export function toggleRequestsViewMode(mode) {
    if (mode && (mode === 'grid' || mode === 'list')) {
        currentRequestsViewMode = mode;
    } else {
        // Toggle between grid and list
        currentRequestsViewMode = currentRequestsViewMode === 'grid' ? 'list' : 'grid';
    }
    
    // Save to localStorage
    localStorage.setItem('requestsViewMode', currentRequestsViewMode);
    
    // Apply view mode
    applyRequestsViewMode();
    
    // Re-render requests
    renderModernRequests();
}

// Render modern requests cards
function renderModernRequests() {
    const container = document.getElementById('pending-users-list');
    if (!container) return;

    // Get pending users (requests) - use state.pendingUsers if available, otherwise filter state.users
    let requests = [];
    
    if (state.pendingUsers && state.pendingUsers.length > 0) {
        // Use dedicated pending users array
        requests = [...state.pendingUsers];
    } else if (state.users && state.users.length > 0) {
        // Fallback: filter from all users
        requests = state.users.filter(u => u.status === 'pending' || u.status === 'pending_approval' || u.status === 'pending_telegram_subscription' || u.status === 'status_in_process');
    }
    
    // Add password change requests
    if (state.passwordChangeRequests && state.passwordChangeRequests.length > 0) {
        // Convert password change requests to request format
        const passwordRequests = state.passwordChangeRequests.map(pcr => ({
            id: `pcr_${pcr.id}`, // Prefix to avoid conflicts
            type: 'password_change',
            user_id: pcr.user_id,
            username: pcr.username,
            fullname: pcr.fullname || pcr.full_name,
            full_name: pcr.fullname || pcr.full_name,
            role: pcr.role,
            created_at: pcr.requested_at,
            status: 'pending',
            password_change_request_id: pcr.id
        }));
        
        // Remove duplicates: if a user has both registration and password change request, keep only password change
        const passwordUserIds = new Set(passwordRequests.map(pr => pr.user_id));
        requests = requests.filter(r => !passwordUserIds.has(r.user_id));
        
        // Group by user_id and keep only the latest (most recent) request per user
        const passwordRequestsByUser = {};
        passwordRequests.forEach(pr => {
            const userId = pr.user_id;
            if (!passwordRequestsByUser[userId]) {
                passwordRequestsByUser[userId] = pr;
            } else {
                // Compare dates - keep the one with the latest created_at
                const existingDate = new Date(passwordRequestsByUser[userId].created_at);
                const currentDate = new Date(pr.created_at);
                if (currentDate > existingDate) {
                    passwordRequestsByUser[userId] = pr;
                }
            }
        });
        
        // Convert back to array (only latest request per user)
        const uniquePasswordRequests = Object.values(passwordRequestsByUser);
        requests = [...requests, ...uniquePasswordRequests];
    }

    // Apply status filter
    if (currentRequestsFilter.status) {
        if (currentRequestsFilter.status === 'password_change') {
            // Parol tiklash so'rovlari
            requests = requests.filter(r => r.type === 'password_change');
        } else if (currentRequestsFilter.status === 'registration') {
            // Ro'yxatdan o'tish so'rovlari
            requests = requests.filter(r => r.type !== 'password_change');
        } else if (currentRequestsFilter.status === 'pending_telegram_subscription') {
            // Telegram kutmoqda - null, undefined yoki pending_subscription (faqat ro'yxatdan o'tish so'rovlari)
            requests = requests.filter(r => r.type !== 'password_change' && (!r.telegram_connection_status || r.telegram_connection_status === 'pending_subscription' || r.telegram_connection_status === 'not_connected'));
        } else if (currentRequestsFilter.status === 'pending_admin_approval') {
            // Admin tasdiq - telegram ulanish tugallangan, lekin admin tasdiqlashi kerak (faqat ro'yxatdan o'tish so'rovlari)
            requests = requests.filter(r => r.type !== 'password_change' && (r.telegram_connection_status === 'subscribed' || r.telegram_connection_status === 'connected' || r.telegram_connection_status === 'pending_admin_approval'));
        } else if (currentRequestsFilter.status === 'status_in_process') {
            // Jarayonda (faqat ro'yxatdan o'tish so'rovlari)
            requests = requests.filter(r => r.type !== 'password_change' && r.telegram_connection_status === 'in_process');
        }
    }

    // Apply sorting
    if (currentRequestsFilter.sort === 'newest') {
        requests.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } else if (currentRequestsFilter.sort === 'oldest') {
        requests.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    } else if (currentRequestsFilter.sort === 'name') {
        requests.sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || ''));
    }

    // Empty state
    if (requests.length === 0) {
        container.innerHTML = `
            <div class="requests-empty-state">
                <i data-feather="inbox"></i>
                <h3>So'rovlar yo'q</h3>
                <p>Hozircha tasdiqlash uchun kutayotgan so'rovlar mavjud emas</p>
            </div>
        `;
        feather.replace();
        return;
    }

    // Apply view mode
    applyRequestsViewMode();
    
    // Render based on view mode
    container.innerHTML = requests.map(request => {
        if (currentRequestsViewMode === 'list') {
            return renderRequestListItem(request);
        } else {
            return renderRequestCard(request);
        }
    }).join('');

    feather.replace();
    setupRequestCheckboxes();
    
    // Update sidebar badge count
    if (DOM.requestsCountBadge) {
        const count = requests.length;
        DOM.requestsCountBadge.textContent = count;
        DOM.requestsCountBadge.classList.toggle('hidden', count === 0);
    }
    
    // Update statistics
    updateRequestsStatistics();
}

// Get request status badge HTML
function getRequestStatusBadge(request) {
    // Parol tiklash so'rovlari uchun alohida badge
    if (request.type === 'password_change') {
        return `
            <div class="request-status-badge" style="background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%); color: white; padding: 6px 12px; border-radius: 20px; font-size: 0.75em; font-weight: 600;">
                <i data-feather="key"></i>
                <span>Parol</span>
            </div>
        `;
    }
    
    // console.log('📋 Request badge for:', request.username, 'telegram_connection_status:', request.telegram_connection_status);
    
    // If telegram_id exists but telegram_connection_status is null/undefined, user needs admin approval
    if (request.telegram_id && (!request.telegram_connection_status || request.telegram_connection_status === 'pending_admin_approval')) {
        return `
            <div class="request-status-badge status-admin">
                <i data-feather="user-check"></i>
                <span>Admin</span>
            </div>
        `;
    }
    
    if (!request.telegram_connection_status || request.telegram_connection_status === 'pending_subscription' || request.telegram_connection_status === 'not_connected') {
        return `
            <div class="request-status-badge status-telegram">
                <i data-feather="send"></i>
                <span>Telegram</span>
            </div>
        `;
    } else if (request.telegram_connection_status === 'subscribed' || request.telegram_connection_status === 'connected') {
        return `
            <div class="request-status-badge status-admin">
                <i data-feather="user-check"></i>
                <span>Admin</span>
            </div>
        `;
    } else if (request.telegram_connection_status === 'in_process') {
        return `
            <div class="request-status-badge status-process">
                <i data-feather="loader"></i>
                <span>Jarayonda</span>
            </div>
        `;
    }
    return '';
}

// Update requests statistics
async function updateRequestsStatistics() {
    try {
    // Use state.pendingUsers if available, otherwise filter state.users
    let pendingUsers = [];
    if (state.pendingUsers && state.pendingUsers.length > 0) {
        pendingUsers = state.pendingUsers;
    } else if (state.users && state.users.length > 0) {
        pendingUsers = state.users.filter(u => u.status === 'pending');
    }
    
    // Get password change requests
    const passwordChangeRequests = state.passwordChangeRequests || [];
    
    // Count by status
    // Telegram kutmoqda - null, undefined yoki pending_subscription
    const telegramPending = pendingUsers.filter(u => !u.telegram_connection_status || u.telegram_connection_status === 'pending_subscription' || u.telegram_connection_status === 'not_connected').length;
    
    // Admin tasdiq - telegram_id bor lekin connection_status null yoki pending_admin_approval
    const adminPending = pendingUsers.filter(u => 
        (u.telegram_id && (!u.telegram_connection_status || u.telegram_connection_status === 'pending_admin_approval')) ||
        u.telegram_connection_status === 'subscribed' || 
        u.telegram_connection_status === 'connected'
    ).length;
    
    const inProcess = pendingUsers.filter(u => u.telegram_connection_status === 'in_process').length;
    
    // Count today's requests
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayRequests = pendingUsers.filter(u => {
        const created = new Date(u.created_at);
        return created >= today;
    }).length;
    
    // Count password change requests
    const passwordChangeCount = passwordChangeRequests.length;
    const todayPasswordRequests = passwordChangeRequests.filter(pcr => {
        const requested = new Date(pcr.requested_at);
        return requested >= today;
    }).length;
    
    // Total requests (registration + password change)
    const totalRequests = pendingUsers.length + passwordChangeCount;
    
        // Real data from API - bugungi tasdiqlangan va rad etilgan foydalanuvchilar
        let approvedToday = 0;
        let rejectedToday = 0;
        
        try {
            const res = await safeFetch('/api/users/statistics/today');
            if (res && res.ok) {
                const stats = await res.json();
                approvedToday = stats.approved || 0;
                rejectedToday = stats.rejected || 0;
            }
        } catch (error) {
            errorLog('Statistikani yuklashda xatolik:', error);
            // Xatolik bo'lsa ham, 0 qiymatlar bilan davom etadi
        }
        
    const totalToday = todayRequests + todayPasswordRequests + approvedToday + rejectedToday;
    const approvalRate = totalToday > 0 ? Math.round((approvedToday / totalToday) * 100) : 0;
    const rejectionRate = totalToday > 0 ? Math.round((rejectedToday / totalToday) * 100) : 0;
    
    // Update DOM
    updateElement('pending-requests-count', totalRequests);
    updateElement('today-requests-count', todayRequests + todayPasswordRequests);
    updateElement('approved-today-count', approvedToday);
    updateElement('rejected-today-count', rejectedToday);
    updateElement('approval-rate', `${approvalRate}%`);
    updateElement('rejection-rate', `${rejectionRate}%`);
    
    // Update filter badges
    updateElement('request-status-count-all', totalRequests);
    updateElement('request-status-count-password', passwordChangeCount);
    updateElement('request-status-count-registration', pendingUsers.length);
    updateElement('request-status-count-telegram', telegramPending);
    // Admin tasdiq va Jarayonda sanogichlari olib tashlandi
    
    // Update pending text
    const pendingText = totalRequests === 0 ? 'Hammasi tasdiqlangan' : 
                       totalRequests === 1 ? '1 ta so\'rov' : 
                       `${totalRequests} ta so'rov`;
    updateElement('pending-requests-text', pendingText);
    
    // Update sidebar badge count
    if (DOM.requestsCountBadge) {
        const count = totalRequests;
        DOM.requestsCountBadge.textContent = count;
        DOM.requestsCountBadge.classList.toggle('hidden', count === 0);
    }
    
    // Show/hide bulk approve button
    const bulkApproveBtn = document.getElementById('bulk-approve-all-btn');
    if (bulkApproveBtn) {
        bulkApproveBtn.style.display = totalRequests > 0 ? 'flex' : 'none';
        }
    } catch (error) {
        errorLog('Statistikani yangilashda xatolik:', error);
        // Xatolik bo'lsa ham, foydalanuvchiga ko'rsatmaymiz (ichki xatolik)
    }
}

// Setup request checkboxes
function setupRequestCheckboxes() {
    document.querySelectorAll('.request-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const requestId = parseInt(e.target.dataset.requestId);
            if (e.target.checked) {
                selectedRequests.add(requestId);
            } else {
                selectedRequests.delete(requestId);
            }
            updateRequestsBulkActions();
        });
    });
}

// Update requests bulk actions visibility
function updateRequestsBulkActions() {
    const bulkContainer = document.getElementById('requests-bulk-actions');
    const selectedCountEl = document.getElementById('requests-selected-count');
    
    if (bulkContainer && selectedCountEl) {
        bulkContainer.style.display = selectedRequests.size > 0 ? 'flex' : 'none';
        selectedCountEl.textContent = selectedRequests.size;
    }
    
    // Update checkboxes state
    document.querySelectorAll('.request-checkbox').forEach(checkbox => {
        const requestId = parseInt(checkbox.dataset.requestId);
        checkbox.checked = selectedRequests.has(requestId);
    });
}

// Setup requests filters
function setupRequestsFilters() {
    // Status filter badges
    document.querySelectorAll('#requests-status-badges .filter-badge').forEach(badge => {
        badge.addEventListener('click', (e) => {
            const status = e.currentTarget.dataset.requestStatus;
            
            // Update active state
            document.querySelectorAll('#requests-status-badges .filter-badge').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            // Update filter and render
            currentRequestsFilter.status = status;
            renderModernRequests();
        });
    });
    
    // Sort buttons
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const sort = e.currentTarget.dataset.sort;
            
            // Update active state
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            // Update filter and render
            currentRequestsFilter.sort = sort;
            renderModernRequests();
        });
    });
    
    // Refresh button
    const refreshBtn = document.getElementById('refresh-requests-btn');
    if (refreshBtn) {
        // Remove existing listeners by cloning
        const newRefreshBtn = refreshBtn.cloneNode(true);
        refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
        
        newRefreshBtn.addEventListener('click', async () => {
            newRefreshBtn.disabled = true;
            newRefreshBtn.innerHTML = '<i data-feather="loader"></i><span>Yuklanmoqda...</span>';
            feather.replace();
            
            try {
                const [pendingRes, passwordRes] = await Promise.all([
                    fetchPendingUsers(),
                    fetchPasswordChangeRequests()
                ]);
                
                if (pendingRes) {
                    state.pendingUsers = pendingRes;
                }
                if (passwordRes) {
                    state.passwordChangeRequests = passwordRes;
                }
                
                await fetchUsers();
                renderModernRequests();
                updateRequestsStatistics();
                
                showToast('So\'rovlar yangilandi', 'success');
            } catch (error) {
                console.error('Yangilashda xatolik:', error);
                showToast('Yangilashda xatolik', 'error');
            } finally {
                newRefreshBtn.disabled = false;
                newRefreshBtn.innerHTML = '<i data-feather="refresh-cw"></i><span>Yangilash</span>';
                feather.replace();
            }
        });
    }
    
    // Excel export button
    const exportExcelBtn = document.getElementById('export-requests-excel-btn');
    if (exportExcelBtn) {
        exportExcelBtn.addEventListener('click', async () => {
            try {
                exportExcelBtn.disabled = true;
                exportExcelBtn.innerHTML = '<i data-feather="loader"></i><span>Yuklanmoqda...</span>';
                feather.replace();
                
                const response = await fetch('/api/users/pending/export', {
                    method: 'GET',
                    credentials: 'include'
                });
                
                if (!response.ok) {
                    throw new Error('Excel faylni yuklab olishda xatolik');
                }
                
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `yangi_foydalanuvchi_so'rovlari_${new Date().toISOString().split('T')[0]}.xlsx`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                showToast('Excel fayl muvaffaqiyatli yuklab olindi', 'success');
            } catch (error) {
                console.error('Excel export error:', error);
                showToast(`Xatolik: ${error.message}`, 'error');
            } finally {
                exportExcelBtn.disabled = false;
                exportExcelBtn.innerHTML = '<i data-feather="download"></i><span>Excel Yuklab Olish</span>';
                feather.replace();
            }
        });
    }
    
    // Bulk approve all button
    const bulkApproveAllBtn = document.getElementById('bulk-approve-all-btn');
    if (bulkApproveAllBtn) {
        bulkApproveAllBtn.addEventListener('click', async () => {
            const pendingUsers = state.users.filter(u => u.status === 'pending');
            if (pendingUsers.length === 0) return;
            
            const confirmed = await showConfirmDialog({
                title: 'Barchani tasdiqlash',
                message: `Barcha ${pendingUsers.length} ta so'rovni tasdiqlashni xohlaysizmi?`,
                confirmText: 'Ha, tasdiqlash',
                cancelText: 'Bekor qilish',
                type: 'warning',
                icon: 'check-circle'
            });
            if (!confirmed) return;
            
            try {
                for (const user of pendingUsers) {
                    await api.post('/api/admin/users/approve', { userId: user.id });
                }
                
                showToast('Barcha so\'rovlar tasdiqlandi', 'success');
                await fetchUsers();
                renderModernRequests();
                updateRequestsStatistics();
            } catch (error) {
                showToast(`Xatolik: ${error.message}`, 'error');
            }
        });
    }
    
    // View toggle buttons
    const requestsGridBtn = document.getElementById('requests-view-toggle-grid');
    const requestsListBtn = document.getElementById('requests-view-toggle-list');
    
    if (requestsGridBtn) {
        const newGridBtn = requestsGridBtn.cloneNode(true);
        requestsGridBtn.parentNode.replaceChild(newGridBtn, requestsGridBtn);
        
        newGridBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleRequestsViewMode('grid');
        });
    }
    
    if (requestsListBtn) {
        const newListBtn = requestsListBtn.cloneNode(true);
        requestsListBtn.parentNode.replaceChild(newListBtn, requestsListBtn);
        
        newListBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleRequestsViewMode('list');
        });
    }
    
    // Apply initial view mode
    applyRequestsViewMode();
    
    // Bulk actions for selected requests
    const bulkApproveBtn = document.getElementById('requests-bulk-approve-btn');
    if (bulkApproveBtn) {
        bulkApproveBtn.addEventListener('click', async () => {
            if (selectedRequests.size === 0) {
                showToast('Iltimos, kamida bitta foydalanuvchini tanlang', 'info');
                return;
            }
            
            // Tanlangan foydalanuvchilar ro'yxati
            const selectedUserIds = Array.from(selectedRequests);
            const selectedUsersData = [];
            
            // Foydalanuvchi ma'lumotlarini olish
            for (const userId of selectedUserIds) {
                let user = null;
                if (state.pendingUsers && state.pendingUsers.length > 0) {
                    user = state.pendingUsers.find(u => u.id === userId);
                }
                if (!user && state.users && state.users.length > 0) {
                    user = state.users.find(u => u.id === userId);
                }
                if (user) {
                    selectedUsersData.push(user);
                }
            }
            
            if (selectedUsersData.length === 0) {
                showToast('Tanlangan foydalanuvchilar topilmadi', 'error');
                return;
            }
            
            // Tasdiqlash dialog
            const confirmed = await showConfirmDialog({
                title: 'Tanlanganlarni tasdiqlash',
                message: `Tanlangan ${selectedUsersData.length} ta foydalanuvchini tasdiqlashni xohlaysizmi?<br><br><strong>Eslatma:</strong> Har bir foydalanuvchi uchun rol va shartlarni tanlash kerak bo'ladi.`,
                confirmText: 'Davom etish',
                cancelText: 'Bekor qilish',
                type: 'warning',
                icon: 'check-circle'
            });
            
            if (!confirmed) return;
            
            // Birinchi foydalanuvchi uchun modal ochish
            // Qolgan foydalanuvchilar uchun navbatda modal ochiladi
            try {
                // Bulk approval state'ni saqlash
                window.bulkApprovalQueue = selectedUsersData.slice(1); // Birinchi foydalanuvchi tashqari
                window.bulkApprovalCurrentIndex = 0;
                window.bulkApprovalTotal = selectedUsersData.length;
                
                // Birinchi foydalanuvchi uchun modal ochish
                const firstUser = selectedUsersData[0];
                const firstUsername = firstUser.username || firstUser.fullname || `User ${firstUser.id}`;
                
                console.log(`📋 [BULK APPROVE] ${selectedUsersData.length} ta foydalanuvchi tasdiqlanmoqda`);
                console.log(`📋 [BULK APPROVE] Birinchi foydalanuvchi: ${firstUsername} (ID: ${firstUser.id})`);
                
                // Modal ochish
                await openApprovalModal(firstUser.id, firstUsername);
                
                // Agar modal yopilganda navbatdagi foydalanuvchi uchun modal ochilishi kerak
                // Bu openApprovalModal ichida yoki modal yopilganda boshqariladi
                
            } catch (error) {
                console.error('❌ [BULK APPROVE] Xatolik:', error);
                showToast(`Xatolik: ${error.message}`, 'error');
                // State'ni tozalash
                window.bulkApprovalQueue = null;
                window.bulkApprovalCurrentIndex = null;
                window.bulkApprovalTotal = null;
            }
        });
    }
    
    const bulkRejectBtn = document.getElementById('requests-bulk-reject-btn');
    if (bulkRejectBtn) {
        bulkRejectBtn.addEventListener('click', async () => {
            if (selectedRequests.size === 0) return;
            
            const confirmed = await showConfirmDialog({
                title: 'Tanlanganlarni rad etish',
                message: `Tanlangan ${selectedRequests.size} ta so'rovni rad etishni xohlaysizmi?`,
                confirmText: 'Ha, rad etish',
                cancelText: 'Bekor qilish',
                type: 'danger',
                icon: 'x-circle'
            });
            if (!confirmed) return;
            
            try {
                console.log('❌ [BULK REJECT] Tanlangan so\'rovlar rad etilmoqda. Count:', selectedRequests.size);
                
                for (const userId of selectedRequests) {
                    console.log('📤 [BULK REJECT] User ID rad etilmoqda:', userId);
                    const res = await safeFetch(`/api/users/${userId}/reject`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    if (!res || !res.ok) {
                        const errorData = await res.json();
                        console.error('❌ [BULK REJECT] Xatolik User ID:', userId, errorData);
                        throw new Error(errorData?.message || `User ID ${userId} rad etishda xatolik`);
                    }
                    
                    console.log('✅ [BULK REJECT] User ID rad etildi:', userId);
                }
                
                showToast('Tanlangan so\'rovlar rad etildi', 'success');
                selectedRequests.clear();
                
                const [pendingRes, usersRes] = await Promise.all([
                    fetchPendingUsers(),
                    fetchUsers()
                ]);
                
                if (pendingRes) {
                    state.pendingUsers = pendingRes;
                }
                if (usersRes) {
                    state.users = usersRes;
                }
                
                renderModernRequests();
                updateRequestsStatistics();
                updateRequestsBulkActions();
                
                console.log('✅ [BULK REJECT] Barcha ma\'lumotlar yangilandi');
            } catch (error) {
                console.error('❌ [BULK REJECT] Xatolik:', error);
                showToast(`Xatolik: ${error.message}`, 'error');
            }
        });
    }
}

// Global functions for buttons (onclick handlers)
window.approveRequest = async function(userId) {
    console.log('✅ [APPROVE] Tasdiqlash so\'rovi boshlandi. User ID:', userId);
    
    // Foydalanuvchi ma'lumotlarini topish
    let user = null;
    if (state.pendingUsers && state.pendingUsers.length > 0) {
        user = state.pendingUsers.find(u => u.id === userId);
    }
    if (!user && state.users && state.users.length > 0) {
        user = state.users.find(u => u.id === userId);
    }
    
    const username = user?.username || user?.fullname || `User ${userId}`;
    
    console.log('📋 [APPROVE] Foydalanuvchi ma\'lumotlari:', { userId, username, user });
    
    // Modal ochish - rol va rol shartlarini so'rash
    try {
        await openApprovalModal(userId, username);
        console.log('✅ [APPROVE] Modal ochildi. Foydalanuvchi rol va shartlarni tanlaydi.');
    } catch (error) {
        console.error('❌ [APPROVE] Modal ochishda xatolik:', error);
        showToast(`Xatolik: ${error.message}`, 'error');
    }
};

window.rejectRequest = async function(userId) {
    console.log('❌ [REJECT] Rad etish so\'rovi boshlandi. User ID:', userId);
    
    const confirmed = await showConfirmDialog({
        title: 'So\'rovni rad etish',
        message: 'Ushbu so\'rovni rad etishni xohlaysizmi?',
        confirmText: 'Ha, rad etish',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'x-circle'
    });
    
    if (!confirmed) {
        console.log('🚫 [REJECT] Foydalanuvchi bekor qildi');
        return;
    }
    
    try {
        const res = await safeFetch(`/api/users/${userId}/reject`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' }
        });
        
        console.log('📤 [REJECT] API javob:', res);
        
        if (!res || !res.ok) {
            const errorData = await res.json();
            console.error('❌ [REJECT] API xatolik:', errorData);
            throw new Error(errorData?.message || 'Rad etishda xatolik');
        }
        
        const result = await res.json();
        console.log('✅ [REJECT] Muvaffaqiyatli rad etildi. Result:', result);
        
        showToast(result.message || 'So\'rov rad etildi', 'success');
        
        // Ma'lumotlarni yangilash
        const [pendingRes, usersRes, passwordRes] = await Promise.all([
            fetchPendingUsers(),
            fetchUsers(),
            fetchPasswordChangeRequests()
        ]);
        
        if (pendingRes) {
            state.pendingUsers = pendingRes;
        }
        if (usersRes) {
            state.users = usersRes;
        }
        if (passwordRes) {
            state.passwordChangeRequests = passwordRes;
        }
        
        renderModernRequests();
        updateRequestsStatistics();
        
        console.log('✅ [REJECT] Barcha ma\'lumotlar yangilandi');
    } catch (error) {
        console.error('❌ [REJECT] Xatolik:', error);
        showToast(`Xatolik: ${error.message}`, 'error');
    }
};

// Parol tiklash so'rovini tasdiqlash
window.approvePasswordChangeRequest = async function(requestId) {
    console.log('✅ [APPROVE-PASSWORD] Parol tiklash so\'rovi tasdiqlanmoqda. Request ID:', requestId);
    
    const confirmed = await showConfirmDialog({
        title: 'Parol tiklash so\'rovini tasdiqlash',
        message: 'Ushbu parol tiklash so\'rovini tasdiqlashni xohlaysizmi?',
        confirmText: 'Ha, tasdiqlash',
        cancelText: 'Bekor qilish',
        type: 'success',
        icon: 'check-circle'
    });
    
    if (!confirmed) {
        console.log('🚫 [APPROVE-PASSWORD] Foydalanuvchi bekor qildi');
        return;
    }
    
    try {
        const res = await safeFetch(`/api/users/password-change-requests/${requestId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!res || !res.ok) {
            const errorData = await res.json();
            throw new Error(errorData?.message || 'Tasdiqlashda xatolik');
        }
        
        const result = await res.json();
        showToast(result.message || 'Parol tiklash so\'rovi tasdiqlandi', 'success');
        
        // Ma'lumotlarni yangilash
        const passwordRes = await fetchPasswordChangeRequests();
        if (passwordRes) {
            state.passwordChangeRequests = passwordRes;
        }
        
        renderModernRequests();
        updateRequestsStatistics();
        
        console.log('✅ [APPROVE-PASSWORD] Parol tiklash so\'rovi muvaffaqiyatli tasdiqlandi');
    } catch (error) {
        console.error('❌ [APPROVE-PASSWORD] Xatolik:', error);
        showToast(`Xatolik: ${error.message}`, 'error');
    }
};

// Parol tiklash so'rovini rad etish
window.rejectPasswordChangeRequest = async function(requestId) {
    console.log('❌ [REJECT-PASSWORD] Parol tiklash so\'rovi rad etilmoqda. Request ID:', requestId);
    
    const confirmed = await showConfirmDialog({
        title: 'Parol tiklash so\'rovini rad etish',
        message: 'Ushbu parol tiklash so\'rovini rad etishni xohlaysizmi?',
        confirmText: 'Ha, rad etish',
        cancelText: 'Bekor qilish',
        type: 'danger',
        icon: 'x-circle'
    });
    
    if (!confirmed) {
        console.log('🚫 [REJECT-PASSWORD] Foydalanuvchi bekor qildi');
        return;
    }
    
    // Sabab kiritish uchun chiroyli modal oyna
    const reason = await showReasonInputModal({
        title: 'Parol tiklash so\'rovini rad etish',
        message: 'manus.up.railway.app saytida ma\'lumotlarni kiritish',
        placeholder: 'Sababni kiriting (ixtiyoriy)',
        confirmText: 'Davom ettirish',
        cancelText: 'Bekor qilish'
    }) || 'Sabab ko\'rsatilmagan';
    
    try {
        const res = await safeFetch(`/api/users/password-change-requests/${requestId}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment: reason })
        });
        
        if (!res || !res.ok) {
            const errorData = await res.json();
            throw new Error(errorData?.message || 'Rad etishda xatolik');
        }
        
        const result = await res.json();
        showToast(result.message || 'Parol tiklash so\'rovi rad etildi', 'success');
        
        // Ma'lumotlarni yangilash
        const [pendingRes, passwordRes] = await Promise.all([
            fetchPendingUsers(),
            fetchPasswordChangeRequests()
        ]);
        
        if (pendingRes) {
            state.pendingUsers = pendingRes;
        }
        if (passwordRes) {
            state.passwordChangeRequests = passwordRes;
        }
        
        renderModernRequests();
        updateRequestsStatistics();
        
        console.log('✅ [REJECT-PASSWORD] Parol tiklash so\'rovi muvaffaqiyatli rad etildi');
    } catch (error) {
        console.error('❌ [REJECT-PASSWORD] Xatolik:', error);
        showToast(`Xatolik: ${error.message}`, 'error');
    }
};

// viewRequestDetails function removed - modal deleted

// Format relative time
function formatRelativeTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Hozirgina';
    if (diffMins < 60) return `${diffMins} daqiqa oldin`;
    if (diffHours < 24) return `${diffHours} soat oldin`;
    if (diffDays < 7) return `${diffDays} kun oldin`;
    
    return date.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Format date (sana) - xavfsiz formatlash
function formatDate(timestamp) {
    if (!timestamp) {
        return 'Noma\'lum';
    }
    
    try {
        let date;
        if (typeof timestamp === 'string') {
            // Agar allaqachon ISO formatida bo'lsa (T yoki Z bor), to'g'ridan-to'g'ri parse qilish
            if (timestamp.includes('T') || timestamp.endsWith('Z')) {
                date = new Date(timestamp);
            } else {
                // SQLite formatini ISO formatiga o'tkazish
                // "2025-12-10 14:54:43" -> "2025-12-10T14:54:43Z"
                const isoString = timestamp.replace(' ', 'T');
                date = new Date(isoString + 'Z');
            }
        } else {
            date = new Date(timestamp);
        }
        
        // Invalid Date tekshiruvi
        if (isNaN(date.getTime())) {
            return 'Noma\'lum';
        }
        
        // Toshkent vaqti (UTC+5)
        const formatter = new Intl.DateTimeFormat('uz-UZ', {
            timeZone: 'Asia/Tashkent',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        
        const formatted = formatter.format(date);
        return formatted;
    } catch (error) {
        return 'Noma\'lum';
    }
}

// Format date and time (aniq vaqt) - Toshkent vaqti (+5) bilan hisoblanadi
function formatDateTime(timestamp) {
    if (!timestamp) {
        return 'Noma\'lum';
    }
    
    try {
        // Timestamp'ni to'g'ri parse qilish
        // Agar timestamp string formatida bo'lsa (masalan: "2025-12-07 09:49:37")
        // uni ISO formatiga o'tkazish kerak
        let date;
        
        if (typeof timestamp === 'string') {
            // Agar bo'sh string bo'lsa
            if (timestamp.trim() === '') {
                return 'Noma\'lum';
            }
            
            // Agar allaqachon ISO formatida bo'lsa (T yoki Z bor), to'g'ridan-to'g'ri parse qilish
            if (timestamp.includes('T') || timestamp.endsWith('Z')) {
                date = new Date(timestamp);
            } else {
                // SQLite formatini ISO formatiga o'tkazish
                // "2025-12-07 09:49:37" -> "2025-12-07T09:49:37"
                const isoString = timestamp.replace(' ', 'T');
                // Agar timezone yo'q bo'lsa, UTC sifatida qabul qilamiz
                // Keyin Toshkent vaqtiga konvertatsiya qilamiz
                date = new Date(isoString + 'Z'); // Z qo'shish UTC ekanligini bildiradi
            }
        } else {
            date = new Date(timestamp);
        }
        
        // Invalid Date tekshiruvi
        if (isNaN(date.getTime())) {
            return 'Noma\'lum';
        }
        
        // Toshkent vaqti (UTC+5) - Intl.DateTimeFormat ishlatish
        // Vaqt Toshkent mintaqasida hisoblanadi, lekin "+5 Toshkent" yozuvi ko'rsatilmaydi
        const formatter = new Intl.DateTimeFormat('uz-UZ', {
            timeZone: 'Asia/Tashkent',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        // Format qilish va tozalash
        const parts = formatter.formatToParts(date);
        const day = parts.find(p => p.type === 'day')?.value;
        const month = parts.find(p => p.type === 'month')?.value;
        const year = parts.find(p => p.type === 'year')?.value;
        const hour = parts.find(p => p.type === 'hour')?.value;
        const minute = parts.find(p => p.type === 'minute')?.value;
        const second = parts.find(p => p.type === 'second')?.value;
        
        if (!day || !month || !year || hour === undefined || minute === undefined || second === undefined) {
            return 'Noma\'lum';
        }
        
        const formattedTime = `${day}/${month}/${year}, ${hour}:${minute}:${second}`;
        
        // "+5 Toshkent" yozuvini olib tashlash, faqat vaqt ko'rsatiladi
        return formattedTime;
    } catch (error) {
        console.warn('formatDateTime xatolik:', error, 'timestamp:', timestamp);
        return 'Noma\'lum';
    }
}

// Rol shartlarini belgilash modalini ochish
function openRoleRequirementsModal(roleName, roleData) {
    console.log(`🔧 [WEB] Rol shartlarini belgilash modal'i ochilmoqda. Role: ${roleName}`);
    
    // Superadmin uchun modal ochmaslik (to'liq dostup)
    if (roleName === 'superadmin' || roleName === 'super_admin') {
        console.log(`✅ [WEB] Superadmin uchun shartlar belgilanmaydi (to'liq dostup)`);
        return;
    }
    
    // Admin roli uchun modal ochiladi (ixtiyoriy shartlar)
    
    // Mavjud shartlarni olish
    const currentRequiresLocations = roleData?.requires_locations;
    const currentRequiresBrands = roleData?.requires_brands;
    const isEditing = currentRequiresLocations !== undefined && currentRequiresLocations !== null && 
                      currentRequiresBrands !== undefined && currentRequiresBrands !== null;
    
    // Modal yaratish
    const modal = document.createElement('div');
    modal.className = 'modal fade show';
    modal.style.display = 'block';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered" style="max-width: 600px;">
            <div class="modal-content" style="background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1);">
                <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <h5 class="modal-title" style="color: #fff; display: flex; align-items: center; gap: 10px;">
                        <i data-feather="settings" style="width: 24px; height: 24px;"></i>
                        <span>Rol Shartlarini ${isEditing ? 'O\'zgartirish' : 'Belgilash'}</span>
                    </h5>
                    <button type="button" class="btn-close" onclick="this.closest('.modal').remove()" style="filter: invert(1);"></button>
                </div>
                <div class="modal-body" style="padding: 25px;">
                    ${!isEditing ? `
                    <div style="background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 10px; padding: 15px; margin-bottom: 20px;">
                        <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 0;">
                            <strong style="color: #ffc107;">"${roleName}"</strong> roli uchun shartlar belgilanmagan. 
                            Shartlar belgilanmasa, foydalanuvchiga bu rolni berib bo'lmaydi.
                        </p>
                    </div>
                    ` : `
                    <div style="background: rgba(79, 172, 254, 0.1); border: 1px solid rgba(79, 172, 254, 0.3); border-radius: 10px; padding: 15px; margin-bottom: 20px;">
                        <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 0;">
                            <strong style="color: #4facfe;">"${roleName}"</strong> roli uchun shartlar mavjud. 
                            Quyida shartlarni o'zgartirishingiz mumkin.
                        </p>
                    </div>
                    `}
                    <form id="role-requirements-form">
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label style="display: flex; align-items: center; gap: 10px; color: #fff; font-size: 14px; margin-bottom: 10px; cursor: pointer;">
                                <input type="checkbox" id="modal-requires-locations" ${currentRequiresLocations === true ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Filiallar belgilanishi shart</span>
                            </label>
                            <small style="display: block; color: rgba(255,255,255,0.6); font-size: 12px; margin-left: 28px; margin-top: 5px;">
                                Bu rol uchun foydalanuvchi tasdiqlanganda filiallar tanlanishi majburiy bo'ladi
                            </small>
                        </div>
                        <div class="form-group" style="margin-bottom: 20px;">
                            <label style="display: flex; align-items: center; gap: 10px; color: #fff; font-size: 14px; margin-bottom: 10px; cursor: pointer;">
                                <input type="checkbox" id="modal-requires-brands" ${currentRequiresBrands === true ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Brendlar belgilanishi shart</span>
                            </label>
                            <small style="display: block; color: rgba(255,255,255,0.6); font-size: 12px; margin-left: 28px; margin-top: 5px;">
                                Bu rol uchun foydalanuvchi tasdiqlanganda brendlar tanlanishi majburiy bo'ladi
                            </small>
                        </div>
                        <div style="background: rgba(79, 172, 254, 0.1); border: 1px solid rgba(79, 172, 254, 0.3); border-radius: 8px; padding: 12px; margin-top: 15px;">
                            <p style="color: rgba(255,255,255,0.8); font-size: 13px; margin: 0;">
                                <i data-feather="info" style="width: 16px; height: 16px; vertical-align: middle; margin-right: 5px;"></i>
                                ${isEditing ? 'Shartlarni o\'zgartirishingiz mumkin. Kamida bitta shart tanlanishi kerak (filiallar yoki brendlar yoki ikkalasi ham).' : 'Kamida bitta shart tanlanishi kerak (filiallar yoki brendlar yoki ikkalasi ham)'}
                            </p>
                        </div>
                    </form>
                </div>
                <div class="modal-footer" style="border-top: 1px solid rgba(255,255,255,0.1); padding: 15px 25px;">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff;">
                        Bekor qilish
                    </button>
                    <button type="button" id="save-role-requirements-modal-btn" class="btn btn-primary" style="background: #4facfe; border: none; color: #fff;">
                        <i data-feather="save" style="width: 16px; height: 16px;"></i>
                        ${isEditing ? 'O\'zgarishlarni Saqlash' : 'Shartlarni Saqlash va Davom Etish'}
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    feather.replace();
    
    // Saqlash tugmasi event listener
    const saveBtn = document.getElementById('save-role-requirements-modal-btn');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const requiresLocations = document.getElementById('modal-requires-locations').checked;
            const requiresBrands = document.getElementById('modal-requires-brands').checked;
            
            // Validatsiya: kamida bitta shart tanlanishi kerak (true bo'lishi kerak)
            // Agar ikkalasi ham false/null bo'lsa, foydalanuvchi hech qanday ma'lumot ko'ra olmaydi
            if (!requiresLocations && !requiresBrands) {
                showToast('⚠️ Kamida bitta shart tanlanishi kerak (filiallar yoki brendlar). Agar ikkalasi ham tanlanmagan bo\'lsa, foydalanuvchi hech qanday ma\'lumot ko\'ra olmaydi.', true);
                return;
            }
            
            saveBtn.disabled = true;
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saqlanmoqda...';
            
            try {
                // true/false/null qiymatlarini yuborish
                // true = majburiy, false = kerak emas, null = ixtiyoriy
                // Hozircha faqat true/false qo'llab-quvvatlaymiz
                const res = await safeFetch(`/api/roles/${roleName}/requirements`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        requires_locations: requiresLocations ? true : false,
                        requires_brands: requiresBrands ? true : false
                    })
                });
                
                if (!res || !res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData?.message || 'Rol shartlarini saqlashda xatolik');
                }
                
                const result = await res.json();
                console.log('✅ [WEB] Rol shartlari saqlandi:', result);
                
                // State'ni yangilash
                const roleIndex = state.roles.findIndex(r => r.role_name === roleName);
                if (roleIndex > -1) {
                    state.roles[roleIndex].requires_locations = requiresLocations ? true : false;
                    state.roles[roleIndex].requires_brands = requiresBrands ? true : false;
                }
                
                // Modal yopish
                modal.remove();
                
                // Tasdiqlash modal'ini yangilash
                await toggleLocationVisibilityForApprovalForm();
                
                showToast('Rol shartlari saqlandi. Endi filiallar va brendlarni tanlashingiz mumkin.', 'success');
                
            } catch (error) {
                console.error('❌ [WEB] Rol shartlarini saqlashda xatolik:', error);
                showToast(error.message, true);
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
                feather.replace();
            }
        };
    }
}

// Get status text in Uzbek
function getStatusText(status) {
    const statusMap = {
        'pending_telegram_subscription': 'Botga obuna bo\'lishni kutmoqda',
        'pending_approval': 'Admin tasdiqlashini kutmoqda',
        'status_in_process': 'Jarayonda'
    };
    return statusMap[status] || status;
}

// Initialize requests section
export async function initModernRequestsPage() {
    setupRequestsFilters();
    
    // Parol tiklash so'rovlarini yuklash
    try {
        const passwordRes = await fetchPasswordChangeRequests();
        if (passwordRes) {
            state.passwordChangeRequests = passwordRes;
        }
    } catch (error) {
        console.error('Parol tiklash so\'rovlarini yuklashda xatolik:', error);
    }
    
    renderModernRequests();
    updateRequestsStatistics();
}

// Modal funksiyasi - brend/filiallarni ko'rsatish
window.showUserItemsModal = function(userId, title, items, type) {
    const modal = document.getElementById('user-items-modal');
    const modalTitle = document.getElementById('user-items-modal-title');
    const modalContent = document.getElementById('user-items-modal-content');
    const closeBtn = document.getElementById('close-user-items-modal');
    
    if (!modal || !modalTitle || !modalContent) return;
    
    // Modal ochish
    modal.classList.remove('hidden');
    modalTitle.textContent = title;
    
    // Items array bo'lishi kerak
    const itemsArray = Array.isArray(items) ? items : [];
    
    // Grid ko'rinishida ko'rsatish
    if (itemsArray.length === 0) {
        modalContent.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.6); padding: 40px;">Ma\'lumot yo\'q</p>';
    } else {
        modalContent.innerHTML = itemsArray.map((item, index) => {
            const itemName = typeof item === 'string' ? item : (item.name || item);
            return `
                <div class="user-item-card" style="
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 8px;
                    padding: 15px;
                    text-align: center;
                    transition: all 0.3s ease;
                    cursor: pointer;
                " onmouseenter="this.style.background='rgba(79, 172, 254, 0.15)'; this.style.borderColor='#4facfe';" 
                   onmouseleave="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)';">
                    <div style="font-size: 24px; margin-bottom: 8px;">
                        ${type === 'locations' ? '📍' : '🏷️'}
                    </div>
                    <div style="font-weight: 600; color: #fff; font-size: 14px;">
                        ${escapeHtml(itemName)}
                    </div>
                </div>
            `;
        }).join('');
    }
    
    // Yopish funksiyalari
    closeBtn.onclick = () => modal.classList.add('hidden');
    modal.onclick = (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    };
    
    // Feather iconlarni yangilash
    setTimeout(() => {
        if (typeof feather !== 'undefined') feather.replace();
    }, 100);
};

// Excel eksport funksiyasi
async function exportUsersToExcel() {
    try {
        console.log('📊 [EXCEL EXPORT] ===========================================');
        console.log('📊 [EXCEL EXPORT] Eksport boshlandi...');
        console.log('📊 [EXCEL EXPORT] ===========================================');
        
        // Filtrlangan foydalanuvchilarni olish
        const filtersHash = getFiltersHash();
        let filteredUsers;
        
        if (filteredUsersCache && lastFiltersHash === filtersHash) {
            filteredUsers = filteredUsersCache;
            console.log('✅ [EXCEL EXPORT] Cache\'dan foydalanildi');
        } else {
            console.log('🔄 [EXCEL EXPORT] Yangi filter qo\'llanmoqda...');
            // Apply filters (renderModernUsers ichidagi logikani takrorlash)
            filteredUsers = state.users.filter(user => {
                // Superadmin'ni faqat superadmin o'zi ko'rsin
                if ((user.role === 'superadmin' || user.role === 'super_admin') && 
                    state.currentUser?.role !== 'superadmin' && state.currentUser?.role !== 'super_admin') {
                    return false;
                }
                
                // Search filter
                if (currentFilters.search && currentFilters.search.trim()) {
                    const searchTerm = currentFilters.search.toLowerCase().trim();
                    const fullname = (user.fullname || '').toLowerCase();
                    const username = (user.username || '').toLowerCase();
                    const email = (user.email || '').toLowerCase();
                    const phone = (user.phone || '').toLowerCase();
                    const role = (user.role || '').toLowerCase();
                    
                    const matchesSearch = fullname.includes(searchTerm) || 
                                         username.includes(searchTerm) || 
                                         email.includes(searchTerm) || 
                                         phone.includes(searchTerm) ||
                                         role.includes(searchTerm);
                    
                    if (!matchesSearch) return false;
                }
                
                // Role filter
                if (currentFilters.role && user.role !== currentFilters.role) return false;

                // Account Status filter
                if (currentFilters.accountStatus) {
                    if (currentFilters.accountStatus === 'active' && user.status !== 'active') return false;
                    if (currentFilters.accountStatus === 'pending' && !user.status.startsWith('pending')) return false;
                    if (currentFilters.accountStatus === 'inactive' && user.status !== 'blocked' && user.status !== 'archived') return false;
                }

                // Online Status filter
                if (currentFilters.onlineStatus) {
                    if (currentFilters.onlineStatus === 'online' && !user.is_online) return false;
                    if (currentFilters.onlineStatus === 'offline' && user.is_online) return false;
                }

                // Telegram Status filter
                if (currentFilters.telegramStatus) {
                    const isConnected = Boolean(user.telegram_chat_id) || user.is_telegram_connected === 1;
                    if (currentFilters.telegramStatus === 'connected' && !isConnected) return false;
                    if (currentFilters.telegramStatus === 'not_connected' && isConnected) return false;
                }

                return true;
            });
        }
        
        console.log(`📋 [EXCEL EXPORT] Jami ${filteredUsers.length} ta foydalanuvchi topildi`);
        
        if (!filteredUsers || filteredUsers.length === 0) {
            console.warn('⚠️ [EXCEL EXPORT] Eksport qilish uchun ma\'lumot yo\'q');
            showToast('Eksport qilish uchun ma\'lumot yo\'q', true);
            return;
        }
        
        // Faqat kerakli ma'lumotlar uchun CSV formatida tayyorlash
        // 1. ID, 2. FISH, 3. Filiallar, 4. Rol, 5. Telegram Username
        const headers = [
            'ID',
            'FISH',
            'Filiallar',
            'Rol',
            'Telegram Username'
        ];
        
        console.log('📑 [EXCEL EXPORT] Ustunlar:', headers);
        console.log('📐 [EXCEL EXPORT] Ustunlar tartibi:');
        headers.forEach((header, index) => {
            console.log(`   ${index + 1}. ${header}`);
        });
        
        const rows = filteredUsers.map((user, userIndex) => {
            // Filiallarni olish (to'g'ri formatdan)
            let locations = '';
            
            // Bir nechta formatni tekshirish
            if (user.role_based_locations && Array.isArray(user.role_based_locations) && user.role_based_locations.length > 0) {
                // role_based_locations formatida
                locations = user.role_based_locations.join(', ');
            } else if (user.locations && Array.isArray(user.locations) && user.locations.length > 0) {
                // locations array formatida
                locations = user.locations.map(loc => {
                    if (typeof loc === 'string') return loc;
                    if (loc && loc.location_name) return loc.location_name;
                    return String(loc);
                }).join(', ');
            } else if (user.locations && typeof user.locations === 'string') {
                // locations string formatida
                locations = user.locations;
            }
            
            const row = [
                user.id || '', // 1-ustun: ID
                user.fullname || '', // 2-ustun: FISH (To'liq ism)
                locations, // 3-ustun: Filiallar (vergul bilan ajratilgan)
                user.role || '', // 4-ustun: Rol
                user.telegram_username || '' // 5-ustun: Telegram Username
            ];
            
            // Har bir foydalanuvchi uchun log
            if (userIndex < 5) { // Faqat birinchi 5 ta foydalanuvchi uchun log
                console.log(`👤 [EXCEL EXPORT] Foydalanuvchi #${userIndex + 1} (ID: ${user.id}, Username: ${user.username}):`);
                console.log(`   📍 Filiallar ma'lumotlari:`, {
                    'role_based_locations': user.role_based_locations,
                    'locations': user.locations,
                    'natija': locations
                });
                console.log(`   1-ustun (ID): "${row[0]}"`);
                console.log(`   2-ustun (FISH): "${row[1]}"`);
                console.log(`   3-ustun (Filiallar): "${row[2]}"`);
                console.log(`   4-ustun (Rol): "${row[3]}"`);
                console.log(`   5-ustun (Telegram Username): "${row[4]}"`);
            }
            
            return row;
        });
        
        console.log(`✅ [EXCEL EXPORT] ${rows.length} ta qator tayyorlandi`);
        
        // CSV formatida yaratish (Excel uchun mos format - semicolon separator)
        const escapeCSV = (value) => {
            if (value === null || value === undefined) return '';
            
            const str = String(value);
            
            // Agar ma'lumot ichida semicolon, qo'shtirnoq yoki newline bo'lsa, qo'shtirnoq ichiga olish
            if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                // Qo'shtirnoqlarni double quote qilish (CSV standarti)
                return `"${str.replace(/"/g, '""')}"`;
            }
            
            return str;
        };
        
        // Semicolon separator ishlatish (Excel'da ko'proq ishonchli)
        const separator = ';';
        
        // CSV content yaratish
        const csvRows = [
            headers.map(escapeCSV).join(separator),
            ...rows.map(row => row.map(escapeCSV).join(separator))
        ];
        
        const csvContent = csvRows.join('\r\n'); // Windows uchun \r\n ishlatish
        
        console.log(`📄 [EXCEL EXPORT] CSV content yaratildi (${csvContent.length} belgi)`);
        console.log(`📄 [EXCEL EXPORT] Separator: "${separator}"`);
        console.log('📋 [EXCEL EXPORT] Birinchi qator (header):', csvRows[0]);
        if (csvRows.length > 1) {
            console.log('📋 [EXCEL EXPORT] Ikkinchi qator (birinchi foydalanuvchi):', csvRows[1]);
            console.log('📋 [EXCEL EXPORT] Ikkinchi qator tahlili:');
            const firstRow = csvRows[1].split(separator);
            firstRow.forEach((cell, index) => {
                console.log(`   ${index + 1}-ustun (${headers[index]}): ${cell}`);
            });
        }
        
        // BOM qo'shish (UTF-8 uchun Excel'da to'g'ri ko'rinishi uchun)
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { 
            type: 'text/csv;charset=utf-8;' 
        });
        
        console.log(`💾 [EXCEL EXPORT] Blob yaratildi (${blob.size} bayt)`);
        
        // Download qilish
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().split('T')[0];
        link.href = url;
        link.download = `foydalanuvchilar_${timestamp}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        console.log('✅ [EXCEL EXPORT] Fayl muvaffaqiyatli yuklab olindi:', link.download);
        console.log('✅ [EXCEL EXPORT] Eksport yakunlandi!');
        console.log('📊 [EXCEL EXPORT] ===========================================');
        showToast('Excel fayl muvaffaqiyatli yuklab olindi!', false);
        
    } catch (error) {
        console.error('❌ [EXCEL EXPORT] ===========================================');
        console.error('❌ [EXCEL EXPORT] Xatolik:', error);
        console.error('❌ [EXCEL EXPORT] Xatolik tafsilotlari:', error.stack);
        console.error('❌ [EXCEL EXPORT] ===========================================');
        showToast(`Excel eksport qilishda xatolik: ${error.message}`, true);
    }
}
