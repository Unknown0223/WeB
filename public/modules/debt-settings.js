// public/modules/debt-settings.js
// Debt-approval sozlamalari moduli

import { safeFetch } from './api.js';
import { showToast } from './utils.js';

const API_URL = '/api/debt-approval/settings';
const GROUPS_API_URL = '/api/debt-approval/groups';
const BUTTONS_API_URL = '/api/debt-approval/buttons';

/**
 * Button descriptions - har bir knopka uchun izoh
 */
const BUTTON_DESCRIPTIONS = {
    // Debt-approval
    'new_request': "Yangi qarzdorlik so'rovini yaratish uchun",
    'set_request': "Excel fayl orqali muddat uzaytirish so'rovlarini yaratish uchun",
    'my_requests': "Foydalanuvchi tomonidan yaratilgan so'rovlarni ko'rish uchun",
    'in_process_requests': "Hozirgi vaqtda tasdiqlash jarayonida bo'lgan so'rovlarni ko'rish uchun",
    'approved_requests': "Muvaffaqiyatli tasdiqlangan so'rovlarni ko'rish uchun",
    'branch_stats': "Brend va filiallar bo'yicha statistikalarni ko'rish uchun",
    'block': "SVRlarni bloklash/ochib qo'yish uchun",
    
    // Cashier
    'new_requests_cashier': "Kassirga yuborilgan yangi so'rovlarni ko'rish va tasdiqlash uchun",
    'my_requests_cashier': "Kassir tomonidan tasdiqlangan so'rovlarni ko'rish uchun",
    'pending_requests_cashier': "Kassir kutayotgan so'rovlarni ko'rish uchun",
    
    // Operator
    'new_requests_operator': "Operatorga yuborilgan yangi so'rovlarni ko'rish va tasdiqlash uchun",
    'my_requests_operator': "Operator tomonidan tasdiqlangan so'rovlarni ko'rish uchun",
    'pending_requests_operator': "Operator kutayotgan so'rovlarni ko'rish uchun",
    
    // Leader
    'set_requests_leader': "Rahbar tomonidan tasdiqlash kerak bo'lgan SET so'rovlarini ko'rish uchun",
    'approved_requests_leader': "Rahbar tomonidan tasdiqlangan so'rovlarni ko'rish uchun",
    'block_leader': "Rahbar uchun SVRlarni bloklash/ochib qo'yish uchun",
    
    // Supervisor
    'supervisor_requests': "Nazoratchi tomonidan nazorat qilish kerak bo'lgan so'rovlarni ko'rish uchun",
    'supervisor_approved': "Nazoratchi tomonidan nazorat qilingan so'rovlarni ko'rish uchun",
    
    // System
    'settings': "Tizim sozlamalariga kirish uchun",
    
    // Reports
    'reports_list': "Barcha hisobotlarni ko'rish uchun",
    'new_report': "Yangi hisobot yaratish uchun",
    'reports_set': "SET hisobotlarini yaratish uchun",
    'reports_stats': "Hisobotlar statistikasini ko'rish uchun"
};

/**
 * Debt settings modalini ko'rsatish - Faqat Bot Knopkalari Sozlamalari
 */
export function showDebtSettingsModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'debt-settings-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 1000px; width: 90vw;">
            <div class="modal-header">
                <h2>⌨️ Bot Knopkalari Sozlamalari</h2>
                <button class="modal-close" onclick="closeDebtSettingsModal()">×</button>
            </div>
            <div class="modal-body" style="max-height: 85vh; overflow-y: auto; padding: 30px;">
                <div class="settings-section" style="margin-bottom: 0;">
                    <p style="color: rgba(255,255,255,0.7); margin-bottom: 20px; font-size: 14px;">
                        Har bir rol uchun qaysi Telegram bot knopkalari ko'rinishi kerakligini sozlang. 
                        Bu sozlamalar bot orqali foydalanuvchilarga ko'rsatiladigan menu knopkalarini boshqaradi.
                    </p>
                    
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="font-weight: 600; font-size: 15px; margin-bottom: 10px; display: block; color: rgba(255,255,255,0.9);">Rol tanlang:</label>
                        <select id="bot-buttons-role-select" class="form-control" onchange="loadBotButtonsForRole()" style="padding: 12px; font-size: 15px;">
                            <option value="">Rolni tanlang...</option>
                        </select>
                    </div>
                    
                    <div id="bot-buttons-list" style="margin-top: 30px;">
                        <p style="color: rgba(255,255,255,0.5); font-style: italic; text-align: center; padding: 40px;">Rolni tanlang</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Sozlamalarni yuklash
    loadBotButtonsRoles();
}

/**
 * Bot knopkalari rollarini yuklash
 */
async function loadBotButtonsRoles() {
    try {
        const res = await safeFetch(`${BUTTONS_API_URL}/roles/list`);
        if (!res || !res.ok) {
            return;
        }
        
        const data = await res.json();
        const roleSelect = document.getElementById('bot-buttons-role-select');
        if (!roleSelect) return;
        
        roleSelect.innerHTML = '<option value="">Rolni tanlang...</option>';
        (data.roles || data).forEach(role => {
            const option = document.createElement('option');
            option.value = role;
            option.textContent = role;
            roleSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading bot buttons roles:', error);
    }
}

/**
 * Rol uchun bot knopkalarini yuklash
 */
window.loadBotButtonsForRole = async function() {
    const roleSelect = document.getElementById('bot-buttons-role-select');
    const buttonsList = document.getElementById('bot-buttons-list');
    
    if (!roleSelect || !buttonsList) return;
    
    const role = roleSelect.value;
    if (!role) {
        buttonsList.innerHTML = '<p style="color: rgba(255,255,255,0.5); font-style: italic; text-align: center; padding: 40px;">Rolni tanlang</p>';
        return;
    }
    
    try {
        buttonsList.innerHTML = '<p style="color: rgba(255,255,255,0.7); text-align: center; padding: 40px;">Yuklanmoqda...</p>';
        
        const res = await safeFetch(`${BUTTONS_API_URL}/${role}`);
        if (!res || !res.ok) {
            buttonsList.innerHTML = '<p style="color: #f00; text-align: center; padding: 40px;">Xatolik yuz berdi</p>';
            return;
        }
        
        const data = await res.json();
        renderBotButtonsList(data.buttons, role);
    } catch (error) {
        console.error('Error loading bot buttons:', error);
        buttonsList.innerHTML = '<p style="color: #f00; text-align: center; padding: 40px;">Xatolik yuz berdi</p>';
    }
};

/**
 * Bot knopkalar ro'yxatini ko'rsatish
 */
function renderBotButtonsList(buttons, role) {
    const buttonsList = document.getElementById('bot-buttons-list');
    if (!buttonsList) return;
    
    if (!buttons || buttons.length === 0) {
        buttonsList.innerHTML = '<p style="color: rgba(255,255,255,0.5); text-align: center; padding: 40px;">Knopkalar topilmadi</p>';
        return;
    }
    
    // Knopkalarni avval kategoriya, keyin permission bo'yicha guruhlash
    const groupedByCategory = {};
    buttons.forEach(btn => {
        const category = btn.category || 'other';
        if (!groupedByCategory[category]) {
            groupedByCategory[category] = {};
        }
        const permission = btn.permission_required || 'none';
        if (!groupedByCategory[category][permission]) {
            groupedByCategory[category][permission] = [];
        }
        groupedByCategory[category][permission].push(btn);
    });
    
    let html = '<div>';
    
    // Barchasini belgilash/olib tashlash va boshqa roldan qo'shish tugmalari
    html += `
        <div style="margin-bottom: 20px; display: flex; gap: 10px; justify-content: space-between; align-items: center;">
            <button onclick="showCopyButtonsModal('${role}')" class="btn" style="padding: 8px 16px; font-size: 14px; background: rgba(79, 172, 254, 0.2); border: 1px solid rgba(79, 172, 254, 0.5); color: #4facfe;">
                📋 Boshqa roldan qo'shish
            </button>
            <div style="display: flex; gap: 10px;">
                <button onclick="selectAllButtons('${role}')" class="btn btn-primary" style="padding: 8px 16px; font-size: 14px;">
                    ✓ Barchasini belgilash
                </button>
                <button onclick="deselectAllButtons('${role}')" class="btn btn-secondary" style="padding: 8px 16px; font-size: 14px;">
                    ☐ Barchasini olib tashlash
                </button>
            </div>
        </div>
    `;
    
    Object.keys(groupedByCategory).sort().forEach(category => {
        const categoryPermissions = groupedByCategory[category];
        html += `
            <div style="margin-bottom: 35px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px;">
                <h3 style="margin: 0 0 20px 0; color: rgba(255,255,255,0.95); font-size: 18px; font-weight: 600; padding-bottom: 12px; border-bottom: 2px solid rgba(79, 172, 254, 0.3);">
                    ${getCategoryName(category)}
                </h3>
        `;
        
        // Permission bo'yicha guruhlash
        Object.keys(categoryPermissions).sort().forEach(permission => {
            const permissionButtons = categoryPermissions[permission];
            if (permission !== 'none') {
                html += `
                    <div style="margin-bottom: 25px; padding-left: 15px; border-left: 3px solid rgba(79, 172, 254, 0.5);">
                        <h4 style="margin: 0 0 15px 0; color: rgba(255,255,255,0.8); font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                            ${getPermissionGroupName(permission)}
                        </h4>
                        <div style="display: grid; gap: 12px;">
                `;
            } else {
                html += `
                    <div style="margin-bottom: 25px;">
                        <div style="display: grid; gap: 12px;">
                `;
            }
            
            permissionButtons.forEach(btn => {
                const isVisible = btn.is_visible !== false; // Default true
                const description = BUTTON_DESCRIPTIONS[btn.button_key] || '';
                html += `
                    <div style="padding: 16px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); transition: all 0.2s;"
                         onmouseover="this.style.background='rgba(79,172,254,0.1)'; this.style.borderColor='rgba(79,172,254,0.3)';"
                         onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)';">
                        <div style="display: flex; align-items: flex-start; gap: 16px;">
                            <input type="checkbox" 
                                   id="btn-${btn.id}" 
                                   ${isVisible ? 'checked' : ''} 
                                   onchange="updateButtonVisibility(${btn.id}, '${role}', this.checked)"
                                   style="margin-top: 2px; cursor: pointer; width: 20px; height: 20px; accent-color: #4facfe; flex-shrink: 0;">
                            <label for="btn-${btn.id}" style="flex: 1; cursor: pointer; margin: 0;">
                                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: ${description ? '6px' : '0'};">
                                    <span style="font-size: 16px; font-weight: 500; color: rgba(255,255,255,0.95);">${btn.button_text}</span>
                                    ${btn.permission_required ? `<span style="color: rgba(255,255,255,0.5); font-size: 13px; font-family: monospace; background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px;">${btn.permission_required}</span>` : ''}
                                </div>
                                ${description ? `<div style="font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 4px; line-height: 1.4;">${description}</div>` : ''}
                            </label>
                        </div>
                    </div>
                `;
            });
            
            html += `
                        </div>
                    </div>
            `;
        });
        
        html += `
            </div>
        `;
    });
    
    html += '</div>';
    buttonsList.innerHTML = html;
}

/**
 * Kategoriya nomini olish
 */
function getCategoryName(category) {
    const names = {
        'debt_approval': '📋 Qarzdorlik Tasdiqlash',
        'reports': '📊 Hisobotlar',
        'system': '⚙️ Tizim'
    };
    return names[category] || category;
}

/**
 * Permission guruh nomini olish
 */
function getPermissionGroupName(permission) {
    const names = {
        'debt:create': 'Menejer knopkalari',
        'debt:approve_cashier': 'Kassir knopkalari',
        'debt:approve_operator': 'Operator knopkalari',
        'debt:approve_leader': 'Rahbar knopkalari',
        'debt:approve_supervisor': 'Nazoratchi knopkalari',
        'debt:block': 'Bloklash knopkalari',
        'debt:admin': 'Admin knopkalari',
        'reports:view_own': 'Hisobot ko\'rish knopkalari',
        'reports:create': 'Hisobot yaratish knopkalari'
    };
    return names[permission] || permission;
}

/**
 * Barcha knopkalarni belgilash
 */
window.selectAllButtons = async function(role) {
    try {
        const res = await safeFetch(`${BUTTONS_API_URL}/${role}`);
        if (!res || !res.ok) {
            showToast('Ma\'lumotlarni yuklashda xatolik', 'error');
            return;
        }
        
        const data = await res.json();
        const buttons = data.buttons || [];
        
        // Barcha checkbox'larni belgilash
        buttons.forEach(btn => {
            const checkbox = document.getElementById(`btn-${btn.id}`);
            if (checkbox && !checkbox.checked) {
                checkbox.checked = true;
                updateButtonVisibility(btn.id, role, true);
            }
        });
        
        showToast('Barcha knopkalar belgilandi', 'success');
    } catch (error) {
        console.error('Error selecting all buttons:', error);
        showToast('Xatolik yuz berdi', 'error');
    }
};

/**
 * Barcha knopkalarni olib tashlash
 */
window.deselectAllButtons = async function(role) {
    try {
        const res = await safeFetch(`${BUTTONS_API_URL}/${role}`);
        if (!res || !res.ok) {
            showToast('Ma\'lumotlarni yuklashda xatolik', 'error');
            return;
        }
        
        const data = await res.json();
        const buttons = data.buttons || [];
        
        // Barcha checkbox'larni olib tashlash
        buttons.forEach(btn => {
            const checkbox = document.getElementById(`btn-${btn.id}`);
            if (checkbox && checkbox.checked) {
                checkbox.checked = false;
                updateButtonVisibility(btn.id, role, false);
            }
        });
        
        showToast('Barcha knopkalar olib tashlandi', 'success');
    } catch (error) {
        console.error('Error deselecting all buttons:', error);
        showToast('Xatolik yuz berdi', 'error');
    }
};

/**
 * Boshqa roldan knopkalarni qo'shish modalini ko'rsatish
 */
window.showCopyButtonsModal = async function(targetRole) {
    try {
        // Barcha rollarni olish
        const res = await safeFetch(`${BUTTONS_API_URL}/roles/list`);
        if (!res || !res.ok) {
            showToast('Rollarni yuklashda xatolik', 'error');
            return;
        }
        
        const data = await res.json();
        const roles = (data.roles || data).filter(r => r !== targetRole);
        
        if (roles.length === 0) {
            showToast('Boshqa rollar topilmadi', 'warning');
            return;
        }
        
        // Modal yaratish
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'copy-buttons-modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h2>📋 Boshqa roldan knopkalarni qo'shish</h2>
                    <button class="modal-close" onclick="closeCopyButtonsModal()">×</button>
                </div>
                <div class="modal-body" style="padding: 30px;">
                    <p style="color: rgba(255,255,255,0.7); margin-bottom: 20px; font-size: 14px;">
                        Qaysi roldan knopkalarni "${targetRole}" rolga qo'shmoqchisiz?
                    </p>
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="font-weight: 600; font-size: 15px; margin-bottom: 10px; display: block; color: rgba(255,255,255,0.9);">Rol tanlang:</label>
                        <select id="copy-from-role-select" class="form-control" style="padding: 12px; font-size: 15px;">
                            <option value="">Rolni tanlang...</option>
                            ${roles.map(r => `<option value="${r}">${r}</option>`).join('')}
                        </select>
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button onclick="closeCopyButtonsModal()" class="btn btn-secondary" style="padding: 10px 20px;">
                            Bekor qilish
                        </button>
                        <button onclick="copyButtonsFromRole('${targetRole}')" class="btn btn-primary" style="padding: 10px 20px;">
                            Qo'shish
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Modal tashqarisiga bosilganda yopish
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeCopyButtonsModal();
            }
        });
    } catch (error) {
        console.error('Error showing copy buttons modal:', error);
        showToast('Xatolik yuz berdi', 'error');
    }
};

/**
 * Copy buttons modalini yopish
 */
window.closeCopyButtonsModal = function() {
    const modal = document.getElementById('copy-buttons-modal');
    if (modal) {
        modal.remove();
    }
};

/**
 * Boshqa roldan knopkalarni qo'shish
 */
window.copyButtonsFromRole = async function(targetRole) {
    const roleSelect = document.getElementById('copy-from-role-select');
    if (!roleSelect || !roleSelect.value) {
        showToast('Rolni tanlang', 'warning');
        return;
    }
    
    const fromRole = roleSelect.value;
    
    try {
        const res = await safeFetch(`${BUTTONS_API_URL}/${targetRole}/copy-from/${fromRole}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!res || !res.ok) {
            const error = await res.json();
            showToast(error.error || 'Xatolik yuz berdi', 'error');
            return;
        }
        
        const data = await res.json();
        showToast(data.message || `${data.copied} ta knopka qo'shildi`, 'success');
        
        // Modalni yopish
        closeCopyButtonsModal();
        
        // Knopkalarni qayta yuklash
        await loadBotButtonsForRole();
    } catch (error) {
        console.error('Error copying buttons:', error);
        showToast('Xatolik yuz berdi', 'error');
    }
};

/**
 * Knopka ko'rinishini yangilash
 */
window.updateButtonVisibility = async function(buttonId, role, isVisible) {
    try {
        const saveRes = await safeFetch(`${BUTTONS_API_URL}/${role}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ button_id: buttonId, is_visible: isVisible })
        });
        
        if (!saveRes || !saveRes.ok) {
            showToast('Saqlashda xatolik', 'error');
            const checkbox = document.getElementById(`btn-${buttonId}`);
            if (checkbox) checkbox.checked = !isVisible;
            return;
        }
        // Faqat individual o'zgarishlar uchun toast ko'rsatish (selectAll/deselectAll da alohida ko'rsatiladi)
        // showToast('Sozlama saqlandi', 'success');
    } catch (error) {
        console.error('Error updating button visibility:', error);
        showToast('Xatolik yuz berdi', 'error');
        const checkbox = document.getElementById(`btn-${buttonId}`);
        if (checkbox) checkbox.checked = !isVisible;
    }
};

/**
 * Modalni yopish
 */
window.closeDebtSettingsModal = function() {
    const modal = document.getElementById('debt-settings-modal');
    if (modal) {
        modal.remove();
    }
};

// Global function
window.showDebtSettingsModal = showDebtSettingsModal;
