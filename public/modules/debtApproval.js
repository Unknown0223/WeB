// modules/debtApproval.js

import { state } from './state.js';
import { DOM } from './dom.js';
import { hasPermission, showToast, showConfirmDialog, createLogger } from './utils.js';
import { safeFetch } from './api.js';
import { removeDuplicatesById } from './arrayUtils.js';

const logger = createLogger('DEBT_APPROVAL');

const API_URL = '/api/debt-approval';

// ========================
// CHART RANG SOZLAMALARI
// ========================

// Default ranglar
const DEFAULT_CHART_COLORS = {
    status: {
        waiting: '#f59e0b',      // Kutilmoqda - Sariq
        setWaiting: '#06b6d4',   // SET kutilmoqda - Cyan
        debt: '#ef4444',         // Qarzdorlik - Qizil
        cancelled: '#64748b',    // Bekor qilingan - Kulrang
        approved: '#22c55e'      // Tasdiqlangan - Yashil
    },
    type: {
        normal: '#f97316',       // NORMAL - Sariq
        set: '#06b6d4'           // SET - Cyan
    },
    manager: {
        completed: '#22c55e',    // Tugallangan - Yashil
        inProgress: '#f59e0b',   // Jarayonda - Sariq
        notSubmitted: '#ef4444'  // Yuborilmagan - Qizil
    }
};

// LocalStorage'dan ranglarni yuklash
function loadChartColors() {
    try {
        const saved = localStorage.getItem('debtChartColors');
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        logger.warn('Chart ranglarni yuklashda xatolik:', e);
    }
    return { ...DEFAULT_CHART_COLORS };
}

// Ranglarni saqlash
function saveChartColors(colors) {
    try {
        localStorage.setItem('debtChartColors', JSON.stringify(colors));
        return true;
    } catch (e) {
        logger.error('Chart ranglarni saqlashda xatolik:', e);
        return false;
    }
}

// Joriy chart ranglari
let chartColors = loadChartColors();

// Rang sozlamalari modalini yaratish
function createColorSettingsModal() {
    const existingModal = document.getElementById('chart-color-settings-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'chart-color-settings-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
            <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.1); padding: 20px;">
                <h2 style="margin: 0; color: #fff; display: flex; align-items: center; gap: 10px;">
                    <i data-feather="sliders" style="width: 24px; height: 24px;"></i>
                    Diagramma Ranglari Sozlamalari
                </h2>
                <button class="modal-close-btn" onclick="closeColorSettingsModal()" style="background: transparent; border: none; color: #fff; cursor: pointer;">
                    <i data-feather="x" style="width: 24px; height: 24px;"></i>
                </button>
            </div>
            <div class="modal-body" style="padding: 20px; max-height: 500px; overflow-y: auto;">
                <!-- Status ranglari -->
                <div style="margin-bottom: 25px;">
                    <h4 style="color: #fff; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                        <i data-feather="pie-chart" style="width: 18px; height: 18px; color: #06b6d4;"></i>
                        Status bo'yicha taqsimot ranglari
                    </h4>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
                        <div class="color-input-group">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 5px; display: block;">Kutilmoqda</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="color" id="color-status-waiting" value="${chartColors.status.waiting}" 
                                    style="width: 50px; height: 35px; border: none; border-radius: 6px; cursor: pointer;">
                                <input type="text" id="color-status-waiting-text" value="${chartColors.status.waiting}" 
                                    style="flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace;">
                            </div>
                        </div>
                        <div class="color-input-group">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 5px; display: block;">SET kutilmoqda</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="color" id="color-status-setWaiting" value="${chartColors.status.setWaiting}">
                                <input type="text" id="color-status-setWaiting-text" value="${chartColors.status.setWaiting}"
                                    style="flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace;">
                            </div>
                        </div>
                        <div class="color-input-group">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 5px; display: block;">Qarzdorlik</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="color" id="color-status-debt" value="${chartColors.status.debt}">
                                <input type="text" id="color-status-debt-text" value="${chartColors.status.debt}"
                                    style="flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace;">
                            </div>
                        </div>
                        <div class="color-input-group">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 5px; display: block;">Bekor qilingan</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="color" id="color-status-cancelled" value="${chartColors.status.cancelled}">
                                <input type="text" id="color-status-cancelled-text" value="${chartColors.status.cancelled}"
                                    style="flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace;">
                            </div>
                        </div>
                        <div class="color-input-group">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 5px; display: block;">Tasdiqlangan</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="color" id="color-status-approved" value="${chartColors.status.approved}">
                                <input type="text" id="color-status-approved-text" value="${chartColors.status.approved}"
                                    style="flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace;">
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Tur ranglari -->
                <div style="margin-bottom: 25px;">
                    <h4 style="color: #fff; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                        <i data-feather="layers" style="width: 18px; height: 18px; color: #f97316;"></i>
                        Tur bo'yicha taqsimot ranglari
                    </h4>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
                        <div class="color-input-group">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 5px; display: block;">NORMAL</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="color" id="color-type-normal" value="${chartColors.type.normal}">
                                <input type="text" id="color-type-normal-text" value="${chartColors.type.normal}"
                                    style="flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace;">
                            </div>
                        </div>
                        <div class="color-input-group">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 5px; display: block;">SET</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="color" id="color-type-set" value="${chartColors.type.set}">
                                <input type="text" id="color-type-set-text" value="${chartColors.type.set}"
                                    style="flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace;">
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Menejer ranglari -->
                <div style="margin-bottom: 25px;">
                    <h4 style="color: #fff; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                        <i data-feather="users" style="width: 18px; height: 18px; color: #22c55e;"></i>
                        Menejer statistikasi ranglari
                    </h4>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px;">
                        <div class="color-input-group">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 5px; display: block;">Tugallangan</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="color" id="color-manager-completed" value="${chartColors.manager.completed}">
                                <input type="text" id="color-manager-completed-text" value="${chartColors.manager.completed}"
                                    style="flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace; font-size: 11px;">
                            </div>
                        </div>
                        <div class="color-input-group">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 5px; display: block;">Jarayonda</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="color" id="color-manager-inProgress" value="${chartColors.manager.inProgress}">
                                <input type="text" id="color-manager-inProgress-text" value="${chartColors.manager.inProgress}"
                                    style="flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace; font-size: 11px;">
                            </div>
                        </div>
                        <div class="color-input-group">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; margin-bottom: 5px; display: block;">Yuborilmagan</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="color" id="color-manager-notSubmitted" value="${chartColors.manager.notSubmitted}">
                                <input type="text" id="color-manager-notSubmitted-text" value="${chartColors.manager.notSubmitted}"
                                    style="flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-family: monospace; font-size: 11px;">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="border-top: 1px solid rgba(255,255,255,0.1); padding: 20px; display: flex; justify-content: space-between;">
                <button onclick="resetChartColors()" class="btn btn-outline" style="padding: 10px 20px; display: flex; align-items: center; gap: 8px;">
                    <i data-feather="refresh-cw" style="width: 16px; height: 16px;"></i>
                    Standartga qaytarish
                </button>
                <div style="display: flex; gap: 10px;">
                    <button onclick="closeColorSettingsModal()" class="btn btn-secondary" style="padding: 10px 20px;">
                        Bekor qilish
                    </button>
                    <button onclick="applyChartColors()" class="btn btn-primary" style="padding: 10px 20px; display: flex; align-items: center; gap: 8px;">
                        <i data-feather="check" style="width: 16px; height: 16px;"></i>
                        Saqlash va Qo'llash
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Color input va text input'larni sinxronlash
    modal.querySelectorAll('input[type="color"]').forEach(colorInput => {
        const textInput = document.getElementById(colorInput.id + '-text');
        if (textInput) {
            colorInput.addEventListener('input', (e) => {
                textInput.value = e.target.value;
            });
            textInput.addEventListener('input', (e) => {
                if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                    colorInput.value = e.target.value;
                }
            });
        }
    });
    
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
}

// Modalni ochish
function openColorSettingsModal() {
    createColorSettingsModal();
    const modal = document.getElementById('chart-color-settings-modal');
    if (modal) {
        modal.classList.add('show');
    }
}

// Modalni yopish
function closeColorSettingsModal() {
    const modal = document.getElementById('chart-color-settings-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// Ranglarni standartga qaytarish
function resetChartColors() {
    chartColors = { ...DEFAULT_CHART_COLORS };
    createColorSettingsModal(); // Modalni yangilash
    const modal = document.getElementById('chart-color-settings-modal');
    if (modal) modal.classList.add('show');
    showToast('Ranglar standartga qaytarildi', 'info');
}

// Ranglarni qo'llash
function applyChartColors() {
    // Modal'dan ranglarni olish
    chartColors = {
        status: {
            waiting: document.getElementById('color-status-waiting')?.value || DEFAULT_CHART_COLORS.status.waiting,
            setWaiting: document.getElementById('color-status-setWaiting')?.value || DEFAULT_CHART_COLORS.status.setWaiting,
            debt: document.getElementById('color-status-debt')?.value || DEFAULT_CHART_COLORS.status.debt,
            cancelled: document.getElementById('color-status-cancelled')?.value || DEFAULT_CHART_COLORS.status.cancelled,
            approved: document.getElementById('color-status-approved')?.value || DEFAULT_CHART_COLORS.status.approved
        },
        type: {
            normal: document.getElementById('color-type-normal')?.value || DEFAULT_CHART_COLORS.type.normal,
            set: document.getElementById('color-type-set')?.value || DEFAULT_CHART_COLORS.type.set
        },
        manager: {
            completed: document.getElementById('color-manager-completed')?.value || DEFAULT_CHART_COLORS.manager.completed,
            inProgress: document.getElementById('color-manager-inProgress')?.value || DEFAULT_CHART_COLORS.manager.inProgress,
            notSubmitted: document.getElementById('color-manager-notSubmitted')?.value || DEFAULT_CHART_COLORS.manager.notSubmitted
        }
    };
    
    // Saqlash
    if (saveChartColors(chartColors)) {
        showToast('Ranglar saqlandi va qo\'llandi!', 'success');
        closeColorSettingsModal();
        
        // Chartlarni qayta render qilish
        loadDebtApprovalPage();
    } else {
        showToast('Ranglarni saqlashda xatolik', 'error');
    }
}

// Global funksiyalar
window.openColorSettingsModal = openColorSettingsModal;
window.closeColorSettingsModal = closeColorSettingsModal;
window.resetChartColors = resetChartColors;
window.applyChartColors = applyChartColors;

// No-op log function (optimallashtirish: log() chaqiruvlarini olib tashlash rejalashtirilgan)
function log() {
    // Bu funksiya DEBUG_MODE o'chirilganidan keyin qoldirilgan, lekin hali kodda ishlatilmoqda
    // Keyingi optimallashtirish bosqichida barcha log() chaqiruvlari olib tashlanadi
}

// Dublikat ma'lumotlar uchun maxsus logger - faqat dublikatlar bo'lsa log qiladi
function logDuplicates(type, before, after, source) {
    const hasDuplicates = before.length !== after.length;
    
    // Dublikatlar bo'lsa, faqat warn level'da ko'rsatish (production'da ko'rinmaydi)
    if (hasDuplicates) {
        logger.warn(`[DUPLICATE DETECTED] ${type} - ${source}: API=${before.length}, Unique=${after.length}, Dublikatlar=${before.length - after.length}`);
        
        // Dublikat ID'larni topish
        const idCounts = {};
        before.forEach(item => {
            idCounts[item.id] = (idCounts[item.id] || 0) + 1;
        });
        const duplicateIds = Object.keys(idCounts).filter(id => idCounts[id] > 1);
        
        if (duplicateIds.length > 0) {
            logger.warn(`Dublikat IDlar (${type}):`, duplicateIds);
        }
    }
    // Dublikatlar yo'q bo'lsa, log qilmaymiz
}

// Setup debt-approval page
export function setupDebtApproval() {
    const importBtn = document.getElementById('debt-import-btn');
    if (importBtn) {
        importBtn.addEventListener('click', () => {
            showImportModal();
        });
    }
    
    // Export va yangilash tugmalari
    setupExportButtons();
}

/**
 * Export va yangilash tugmalarini sozlash
 */
function setupExportButtons() {
    // Export tugmasi
    const exportBtn = document.getElementById('debt-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            try {
                exportBtn.disabled = true;
                exportBtn.innerHTML = '<i data-feather="loader"></i> Export qilinmoqda...';
                if (window.feather) feather.replace();
                
                const response = await safeFetch(`${API_URL}/export`, {
                    method: 'GET',
                    credentials: 'include'
                });
                
                if (!response || !response.ok) {
                    let errorData = {};
                    if (response) {
                        const contentType = response.headers.get('content-type');
                        if (contentType && contentType.includes('application/json')) {
                            try {
                                errorData = await response.json();
                            } catch (e) {
                                // JSON parse xatolik - e'tiborsiz qoldirish
                            }
                        }
                    }
                    logger.error('Export API xatolik:', { status: response?.status, errorData });
                    throw new Error(errorData.message || `Export qilishda xatolik (status: ${response?.status || 'unknown'})`);
                }
                
                const blob = await response.blob();
                
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `debt_data_export_${new Date().toISOString().split('T')[0]}.xlsx`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                showToast('Ma\'lumotlar muvaffaqiyatli export qilindi! ✅', false);
            } catch (error) {
                logger.error('Export error:', error);
                showToast(`Export qilishda xatolik: ${error.message}`, true);
            } finally {
                exportBtn.disabled = false;
                exportBtn.innerHTML = '<i data-feather="download"></i> Ma\'lumotlarni Export qilish';
                if (window.feather) feather.replace();
            }
        });
    }
    
    // Yangilash import tugmasi
    const updateImportBtn = document.getElementById('debt-update-import-btn');
    if (updateImportBtn) {
        updateImportBtn.addEventListener('click', () => {
            showUpdateImportModal();
        });
    }
}

/**
 * Yangilash import modalini ko'rsatish
 */
function showUpdateImportModal() {
    let modal = document.getElementById('debt-update-import-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'debt-update-import-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 700px;">
                <button class="close-modal-btn" onclick="document.getElementById('debt-update-import-modal').classList.add('hidden')">
                    <i data-feather="x"></i>
                </button>
                
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px;">
                    <div style="width: 50px; height: 50px; background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                        <i data-feather="refresh-cw" style="width: 28px; height: 28px; color: white;"></i>
                    </div>
                    <div>
                        <h3 style="margin: 0; font-size: 24px; font-weight: 700; color: white;">Yangilash Import</h3>
                        <p style="margin: 5px 0 0 0; font-size: 14px; color: rgba(255,255,255,0.6);">O'zgartirilgan shablonni yuklab, tizim ma'lumotlarini yangilang</p>
                    </div>
                </div>
                
                <!-- Qo'llanma -->
                <div style="background: rgba(17, 153, 142, 0.1); padding: 20px; border-radius: 12px; margin-bottom: 25px; border: 1px solid rgba(17, 153, 142, 0.3);">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                        <i data-feather="info" style="width: 20px; height: 20px; color: #11998e;"></i>
                        <h4 style="margin: 0; color: #11998e; font-size: 16px; font-weight: 600;">📋 Yangilash Import qo'llanmasi</h4>
                    </div>
                    <div style="font-size: 13px; line-height: 1.8; color: rgba(255,255,255,0.9);">
                        <p style="margin: 0 0 15px 0;">
                            <strong>1. Shablon yuklab oling:</strong> "Shablon (Ma'lumotlar bilan)" tugmasini bosing
                            <br><strong>2. Ma'lumotlarni o'zgartiring:</strong> Excel faylda kerakli o'zgarishlarni kiring
                            <br><strong>3. Yangilash Import:</strong> O'zgartirilgan faylni yuklang
                            <br><strong>4. Natija:</strong> Mavjud ma'lumotlar yangilanadi, yangilari qo'shiladi
                        </p>
                        <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border-left: 3px solid #11998e; margin-top: 15px;">
                            <p style="margin: 0 0 10px 0; font-weight: 600; color: #11998e;">✅ Excel faylda quyidagi ustunlar bo'lishi kerak:</p>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                                <div>
                                    <strong style="color: #38ef7d;">Brend</strong>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 5px;">Brend</code>
                                </div>
                                <div>
                                    <strong style="color: #38ef7d;">Filial</strong>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 5px;">Filial</code>
                                </div>
                                <div>
                                    <strong style="color: #38ef7d;">SVR (FISH)</strong>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 5px;">SVR (FISH)</code>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <form id="debt-update-import-form">
                    <!-- File upload area -->
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 10px; font-weight: 600; color: rgba(255,255,255,0.9);">
                            <i data-feather="upload" style="width: 16px; height: 16px; margin-right: 6px;"></i>
                            Excel fayl tanlang
                        </label>
                        <div style="border: 2px dashed rgba(17, 153, 142, 0.4); border-radius: 12px; padding: 30px; text-align: center; background: rgba(17, 153, 142, 0.05); transition: all 0.3s; cursor: pointer;" 
                             id="debt-update-file-dropzone"
                             onmouseover="this.style.borderColor='rgba(17, 153, 142, 0.6)'; this.style.background='rgba(17, 153, 142, 0.1)';"
                             onmouseout="this.style.borderColor='rgba(17, 153, 142, 0.4)'; this.style.background='rgba(17, 153, 142, 0.05)';">
                            <input type="file" id="debt-update-file-input" accept=".xlsx,.xls" style="display: none;">
                            <div id="debt-update-file-info" style="color: rgba(255,255,255,0.7);">
                                <i data-feather="file" style="width: 48px; height: 48px; margin-bottom: 10px; color: #11998e;"></i>
                                <p style="margin: 0; font-size: 14px;">Faylni bu yerga tashlang yoki <span style="color: #11998e; text-decoration: underline; cursor: pointer;" onclick="document.getElementById('debt-update-file-input').click()">tanlang</span></p>
                                <p style="margin: 5px 0 0 0; font-size: 12px; color: rgba(255,255,255,0.5);">Qo'llab-quvvatlanadigan formatlar: .xlsx, .xls</p>
                            </div>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('debt-update-import-modal').classList.add('hidden')">
                            Bekor qilish
                        </button>
                        <button type="submit" class="btn btn-success" id="debt-update-import-submit-btn">
                            <i data-feather="upload"></i>
                            Yangilash Import
                        </button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Event listener'lar
        const fileInput = document.getElementById('debt-update-file-input');
        const dropzone = document.getElementById('debt-update-file-dropzone');
        const fileInfo = document.getElementById('debt-update-file-info');
        const form = document.getElementById('debt-update-import-form');
        
        // File input change
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    fileInfo.innerHTML = `
                        <i data-feather="check-circle" style="width: 48px; height: 48px; margin-bottom: 10px; color: #38ef7d;"></i>
                        <p style="margin: 0; font-size: 14px; color: #38ef7d;"><strong>${file.name}</strong></p>
                        <p style="margin: 5px 0 0 0; font-size: 12px; color: rgba(255,255,255,0.5);">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    `;
                    if (window.feather) feather.replace();
                }
            });
        }
        
        // Dropzone click
        if (dropzone) {
            dropzone.addEventListener('click', () => {
                if (fileInput) fileInput.click();
            });
            
            // Drag and drop
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.style.borderColor = 'rgba(17, 153, 142, 0.8)';
                dropzone.style.background = 'rgba(17, 153, 142, 0.15)';
            });
            
            dropzone.addEventListener('dragleave', () => {
                dropzone.style.borderColor = 'rgba(17, 153, 142, 0.4)';
                dropzone.style.background = 'rgba(17, 153, 142, 0.05)';
            });
            
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.style.borderColor = 'rgba(17, 153, 142, 0.4)';
                dropzone.style.background = 'rgba(17, 153, 142, 0.05)';
                
                const file = e.dataTransfer.files[0];
                if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
                    if (fileInput) {
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        fileInput.files = dataTransfer.files;
                        fileInput.dispatchEvent(new Event('change'));
                    }
                } else {
                    showToast('Faqat Excel fayllar (.xlsx, .xls) qabul qilinadi', true);
                }
            });
        }
        
        // Form submit
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const file = fileInput?.files[0];
                if (!file) {
                    showToast('Iltimos, Excel faylni tanlang', true);
                    return;
                }
                
                const formData = new FormData();
                formData.append('file', file);
                
                const submitBtn = document.getElementById('debt-update-import-submit-btn');
                try {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<i data-feather="loader"></i> Yangilanmoqda...';
                    if (window.feather) feather.replace();
                    
                    const response = await safeFetch(`${API_URL}/export/update`, {
                        method: 'POST',
                        body: formData,
                        credentials: 'include'
                    });
                    
                    if (!response || !response.ok) {
                        const errorData = response ? await response.json().catch(() => ({})) : {};
                        throw new Error(errorData.message || 'Yangilashda xatolik');
                    }
                    
                    const result = await response.json();
                    
                    if (result.needsConfirmation && result.changes) {
                        // O'zgartirilgan ma'lumotlar modal oynasini ko'rsatish
                        showChangesConfirmationModal(result.changes, result.filePath, result.errors);
                        modal.classList.add('hidden');
                    } else if (result.success) {
                        showToast(`Ma'lumotlar yangilandi: ${result.updated} yangilandi, ${result.created} yaratildi ✅`, false);
                        modal.classList.add('hidden');
                        // Sahifani yangilash
                        await loadDebtApprovalPage();
                    } else {
                        throw new Error(result.message || 'Yangilashda xatolik');
                    }
                } catch (error) {
                    logger.error('Update import error:', error);
                    showToast(`Yangilashda xatolik: ${error.message}`, true);
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i data-feather="upload"></i> Yangilash Import';
                    if (window.feather) feather.replace();
                }
            });
        }
        
        if (window.feather) feather.replace();
    }
    
    modal.classList.remove('hidden');
}

// Load debt-approval page content
export async function loadDebtApprovalPage() {
    const content = document.getElementById('debt-approval-content');
    if (!content) {
        logger.error('debt-approval-content element topilmadi!');
        return;
    }
    
    try {
        // Load dashboard stats
        const [requestsRes, brandsRes] = await Promise.all([
            safeFetch(`${API_URL}/requests?limit=1000`, { credentials: 'include' }),
            safeFetch(`${API_URL}/brands`, { credentials: 'include' })
        ]);
        
        if (!requestsRes || !requestsRes.ok) {
            const errorText = requestsRes ? await requestsRes.text().catch(() => '') : '';
            logger.error('[DEBT_APPROVAL] Requests API xatolik:', { status: requestsRes?.status, errorText });
            throw new Error(`Requests API xatolik: ${requestsRes?.status || 'No response'}`);
        }
        
        if (!brandsRes || !brandsRes.ok) {
            const errorText = brandsRes ? await brandsRes.text().catch(() => '') : '';
            logger.error('[DEBT_APPROVAL] Brands API xatolik:', { status: brandsRes?.status, errorText });
            throw new Error(`Brands API xatolik: ${brandsRes?.status || 'No response'}`);
        }
        
        const requestsData = await requestsRes.json();
        const brands = await brandsRes.json();
        
        const stats = {
            total: requestsData.total || 0,
            pending: requestsData.requests?.filter(r => r.status.includes('PENDING')).length || 0,
            approved: requestsData.requests?.filter(r => r.status.includes('APPROVED')).length || 0,
            debt: requestsData.requests?.filter(r => r.status.includes('DEBT')).length || 0
        };
        
        // Filiallar va SVRlarni yuklash
        const [branchesRes, svrsRes] = await Promise.all([
            safeFetch(`${API_URL}/brands/branches`, { credentials: 'include' }),
            safeFetch(`${API_URL}/brands/svrs`, { credentials: 'include' })
        ]);
        
        const branches = branchesRes && branchesRes.ok ? await branchesRes.json() : [];
        const svrs = svrsRes && svrsRes.ok ? await svrsRes.json() : [];
        
        // Oy tanlash uchun state
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
        const selectedYear = currentYear;
        const selectedMonth = currentMonth;
        
        // Load detailed statistics with month filter
        async function loadDebtStats(year, month) {
            let detailedStats = null;
            try {
                const startDate = `${year}-${month}-01`;
                const endDate = new Date(year, parseInt(month), 0).toISOString().split('T')[0];
                const url = `${API_URL}/requests/stats/summary?startDate=${startDate}&endDate=${endDate}`;
                const statsRes = await safeFetch(url);
                if (statsRes && statsRes.ok) {
                    detailedStats = await statsRes.json();
                }
            } catch (error) {
                logger.error('Statistika yuklashda xatolik:', error);
            }
            return detailedStats;
        }
        
        // Load initial statistics
        let detailedStats = await loadDebtStats(selectedYear, selectedMonth);
        
        content.innerHTML = `
            <!-- Oy tanlash -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                <div></div>
                <div class="modern-month-selector" style="position: relative;">
                    <button class="month-nav-btn" id="debt-prev-month-btn" title="O'tish orqaga">
                        <i data-feather="chevron-left"></i>
                    </button>
                    <div class="month-display" id="debt-month-display-btn">
                        <span id="debt-current-month-text">${getMonthName(selectedMonth)} ${selectedYear}</span>
                        <i data-feather="calendar" style="width: 18px; height: 18px; margin-left: 8px;"></i>
                </div>
                    <button class="month-nav-btn" id="debt-next-month-btn" title="O'tish oldinga">
                        <i data-feather="chevron-right"></i>
                    </button>
                    <div class="month-dropdown hidden" id="debt-month-dropdown">
                        <div class="month-dropdown-header">
                            <button class="year-nav-btn" id="debt-prev-year-btn" title="Yilni orqaga">
                                <i data-feather="chevron-left"></i>
                            </button>
                            <span class="current-year" id="debt-dropdown-year">${selectedYear}</span>
                            <button class="year-nav-btn" id="debt-next-year-btn" title="Yilni oldinga">
                                <i data-feather="chevron-right"></i>
                            </button>
                </div>
                        <div class="months-grid" id="debt-months-grid"></div>
                </div>
                </div>
            </div>
            
            <!-- Statistika kartalari -->
            <div class="debt-stats-grid" style="margin-bottom: 30px;">
                <div class="debt-stat-card" data-stat="total">
                    <div class="debt-stat-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                        <i data-feather="file-text"></i>
                    </div>
                    <div class="debt-stat-content">
                        <h4>Jami so'rovlar</h4>
                        <div class="debt-stat-value" id="stat-total">${detailedStats?.summary?.total || stats.total || 0}</div>
                    </div>
                </div>
                <div class="debt-stat-card" data-stat="pending">
                    <div class="debt-stat-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
                        <i data-feather="clock"></i>
                    </div>
                    <div class="debt-stat-content">
                        <h4>Kutilayotgan</h4>
                        <div class="debt-stat-value" id="stat-pending">${detailedStats?.summary?.pending || stats.pending || 0}</div>
                    </div>
                </div>
                <div class="debt-stat-card" data-stat="approved">
                    <div class="debt-stat-icon" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
                        <i data-feather="check-circle"></i>
                    </div>
                    <div class="debt-stat-content">
                        <h4>Tasdiqlangan</h4>
                        <div class="debt-stat-value" id="stat-approved">${detailedStats?.summary?.approved || stats.approved || 0}</div>
                    </div>
                </div>
                <div class="debt-stat-card" data-stat="debt">
                    <div class="debt-stat-icon" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
                        <i data-feather="alert-circle"></i>
                    </div>
                    <div class="debt-stat-content">
                        <h4>Qarzdorlik topilgan</h4>
                        <div class="debt-stat-value" id="stat-debt">${detailedStats?.summary?.debtFound || stats.debt || 0}</div>
                    </div>
                </div>
                <div class="debt-stat-card" data-stat="cancelled">
                    <div class="debt-stat-icon" style="background: linear-gradient(135deg, #30cfd0 0%, #330867 100%);">
                        <i data-feather="x-circle"></i>
                    </div>
                    <div class="debt-stat-content">
                        <h4>Bekor qilindi</h4>
                        <div class="debt-stat-value" id="stat-cancelled">${detailedStats?.summary?.cancelled || 0}</div>
                    </div>
                </div>
            </div>
            
            <!-- Diagrammalar bo'limi -->
            <div class="debt-charts-section" style="margin-bottom: 30px;">
                <div style="display: flex; justify-content: flex-end; margin-bottom: 15px;">
                    <button onclick="openColorSettingsModal()" class="btn btn-outline" style="padding: 8px 16px; display: flex; align-items: center; gap: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: #fff; border-radius: 8px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">
                        <i data-feather="sliders" style="width: 16px; height: 16px;"></i>
                        Ranglarni sozlash
                    </button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px;">
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">
                                <i data-feather="pie-chart" style="width: 20px; height: 20px; margin-right: 8px;"></i>
                                Status bo'yicha taqsimot
                            </h3>
                        </div>
                        <div class="card-body">
                            <canvas id="debt-status-chart" style="max-height: 300px;"></canvas>
                        </div>
                    </div>
                    
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">
                                <i data-feather="pie-chart" style="width: 20px; height: 20px; margin-right: 8px;"></i>
                                Tur bo'yicha taqsimot
                            </h3>
                        </div>
                        <div class="card-body">
                            <canvas id="debt-type-chart" style="max-height: 300px;"></canvas>
                        </div>
                    </div>
                </div>
                
                ${detailedStats && detailedStats.managerStats && detailedStats.managerStats.length > 0 ? `
                <div class="card" style="margin-top: 20px;">
                    <div class="card-header">
                        <h3 class="card-title">
                            <i data-feather="users" style="width: 20px; height: 20px; margin-right: 8px;"></i>
                            Menejerlar bo'yicha statistika
                        </h3>
                    </div>
                    <div class="card-body">
                        <canvas id="debt-manager-chart" style="max-height: 300px;"></canvas>
                    </div>
                </div>
                ` : ''}
                
                <!-- Filiallar bo'yicha holat (Kartalar ko'rinishida) -->
                <div class="card" style="margin-top: 20px;" id="branch-status-section">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleBranchStatusSection()">
                        <h3 class="card-title" style="display: flex; align-items: center; gap: 10px;">
                            <i data-feather="map-pin" style="width: 20px; height: 20px;"></i>
                            Filiallar Bo'yicha Holat
                            <i data-feather="chevron-down" id="branch-status-toggle-icon" style="width: 20px; height: 20px; transition: transform 0.3s;"></i>
                        </h3>
                        <div style="display: flex; gap: 15px; align-items: center;" onclick="event.stopPropagation();">
                            <!-- Statistikalar (header'da) -->
                            <div style="display: flex; gap: 15px; align-items: center; padding: 6px 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                                <span style="color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 600;">
                                    <i data-feather="grid" style="width: 14px; height: 14px; display: inline; vertical-align: middle;"></i>
                                    Jami: <strong id="branch-status-total" style="color: #3b82f6;">0</strong>
                                </span>
                                <span style="color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 600;">
                                    <i data-feather="check-circle" style="width: 14px; height: 14px; display: inline; vertical-align: middle; color: #22c55e;"></i>
                                    <strong id="branch-status-completed" style="color: #22c55e;">0</strong>
                                </span>
                                <span style="color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 600;">
                                    <i data-feather="x-circle" style="width: 14px; height: 14px; display: inline; vertical-align: middle; color: #ef4444;"></i>
                                    <strong id="branch-status-not-submitted" style="color: #ef4444;">0</strong>
                                </span>
                                <span style="color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 600;">
                                    <i data-feather="clock" style="width: 14px; height: 14px; display: inline; vertical-align: middle; color: #f59e0b;"></i>
                                    <strong id="branch-status-in-progress" style="color: #f59e0b;">0</strong>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="card-body" id="branch-status-body" style="transition: all 0.3s ease;">
                        <!-- Filterlar -->
                        <div style="display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; padding: 15px; background: rgba(255,255,255,0.03); border-radius: 10px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <label style="color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 500;">Brend:</label>
                                <select id="branch-status-brand-filter" class="form-control" style="min-width: 180px; padding: 8px 12px; font-size: 13px;">
                                    <option value="" selected>Barcha brendlar</option>
                                    ${brands.map(brand => `<option value="${brand.id}">${brand.name}</option>`).join('')}
                                </select>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <label style="color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 500;">Holat:</label>
                                <select id="branch-status-status-filter" class="form-control" style="min-width: 160px; padding: 8px 12px; font-size: 13px;">
                                    <option value="" selected>Barchasi</option>
                                    <option value="completed">✅ Topshirilgan</option>
                                    <option value="in_progress">🔄 Jarayonda</option>
                                    <option value="no_request">❌ Topshirilmagan</option>
                                </select>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <label style="color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 500;">Qidirish:</label>
                                <input type="text" id="branch-status-search" class="form-control" placeholder="Filial nomi..." style="min-width: 150px; padding: 8px 12px; font-size: 13px;">
                            </div>
                            <button onclick="loadBranchStatusCards()" class="btn btn-primary" style="padding: 8px 16px; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                                <i data-feather="refresh-cw" style="width: 14px; height: 14px;"></i>
                                Yangilash
                            </button>
                        </div>
                        
                        <!-- Filiallar kartalari -->
                        <div id="branch-status-cards" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
                            <div style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5); grid-column: 1 / -1;">
                                <i data-feather="loader" style="width: 32px; height: 32px; animation: spin 1s linear infinite;"></i>
                                <p style="margin-top: 10px;">Ma'lumotlar yuklanmoqda...</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Yangi So'rov Yaratish bo'limi -->
                <div class="card" style="margin-top: 20px; margin-bottom: 30px;" id="create-request-section">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                            <h3 class="card-title" style="display: flex; align-items: center; gap: 10px;">
                            <i data-feather="plus-circle" style="width: 20px; height: 20px; color: #22c55e;"></i>
                            Yangi So\'rov Yaratish
                        </h3>
                    </div>
                    <div class="card-body">
                        <form id="create-debt-request-form" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px;">
                            <!-- So'rov turi -->
                            <div class="form-group">
                                <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.9); font-weight: 500;">
                                    So\'rov turi <span style="color: #ef4444;">*</span>
                                </label>
                                <select id="create-request-type" class="form-control" required style="width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #ffffff; font-size: 14px; cursor: pointer;">
                                    <option value="" style="background: rgba(30,30,30,0.95); color: rgba(255,255,255,0.7);">Tanlang...</option>
                                    <option value="NORMAL" style="background: rgba(30,30,30,0.95); color: #ffffff;">🟢 Oddiy so\'rov</option>
                                    <option value="SET" style="background: rgba(30,30,30,0.95); color: #ffffff;">🔴 SET so\'rov</option>
                                </select>
                            </div>
                            
                            <!-- Umumiy ma'lumotlar (Brend, Filial, SVR) - Tepada, Collapsible -->
                            <div class="form-group" style="grid-column: 1 / -1;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; cursor: pointer;" onclick="toggleGeneralInfo()" id="general-info-header">
                                    <h4 style="color: rgba(255,255,255,0.9); font-size: 16px; font-weight: 600; margin: 0;">
                                        <i data-feather="info" style="width: 18px; height: 18px; margin-right: 8px;"></i>
                                        Umumiy ma'lumotlar
                                    </h4>
                                    <i data-feather="chevron-down" id="general-info-chevron" style="width: 20px; height: 20px; color: rgba(255,255,255,0.7); transition: transform 0.3s;"></i>
                                </div>
                                <div id="general-info-content" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px;">
                                    <!-- Brend -->
                                    <div class="form-group">
                                        <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.9); font-weight: 500;">
                                            Brend <span style="color: #ef4444;">*</span>
                                        </label>
                                        <select id="create-request-brand" class="form-control" required style="width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #ffffff; font-size: 14px; cursor: pointer;">
                                            <option value="" style="background: rgba(30,30,30,0.95); color: rgba(255,255,255,0.7);">Tanlang...</option>
                                            ${brands.map(brand => `<option value="${brand.id}" style="background: rgba(30,30,30,0.95); color: #ffffff;">${brand.name}</option>`).join('')}
                                        </select>
                                    </div>
                                    
                                    <!-- Filial -->
                                    <div class="form-group">
                                        <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.9); font-weight: 500;">
                                            Filial
                                        </label>
                                        <select id="create-request-branch" class="form-control" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #ffffff; font-size: 14px; cursor: pointer;">
                                            <option value="" style="background: rgba(30,30,30,0.95); color: rgba(255,255,255,0.7);">Tanlang...</option>
                                        </select>
                                    </div>
                                    
                                    <!-- SVR -->
                                    <div class="form-group">
                                        <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.9); font-weight: 500;">
                                            SVR (FISH)
                                        </label>
                                        <select id="create-request-svr" class="form-control" style="width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #ffffff; font-size: 14px; cursor: pointer;">
                                            <option value="" style="background: rgba(30,30,30,0.95); color: rgba(255,255,255,0.7);">Tanlang...</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Qo'shimcha ma'lumot -->
                            <div class="form-group" style="grid-column: 1 / -1;">
                                <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.9); font-weight: 500;">
                                    Qo\'shimcha ma\'lumot
                                </label>
                                <textarea id="create-request-extra-info" class="form-control" rows="3" placeholder="Qo'shimcha izoh yoki ma'lumot..." style="width: 100%; padding: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; resize: vertical;"></textarea>
                            </div>
                            
                            <!-- Excel fayl yuklash (SET so'rovlar uchun) - Pastda -->
                            <div class="form-group" id="excel-upload-group" style="grid-column: 1 / -1; display: none;">
                                <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.9); font-weight: 500;">
                                    <i data-feather="file" style="width: 16px; height: 16px; margin-right: 6px;"></i>
                                    Excel fayl (SET so'rovlar uchun)
                                    <span style="color: rgba(255,255,255,0.6); font-size: 12px; font-weight: normal; margin-left: 8px;">
                                        (Avval Brend, Filial va SVR tanlang)
                                    </span>
                                </label>
                                <input type="file" id="create-request-excel" accept=".xlsx,.xls" disabled style="
                                    width: 100%;
                                    padding: 10px;
                                    background: rgba(255,255,255,0.05);
                                    border: 1px solid rgba(255,255,255,0.1);
                                    border-radius: 8px;
                                    color: #fff;
                                    font-size: 14px;
                                    cursor: not-allowed;
                                    opacity: 0.5;
                                ">
                                <div id="excel-preview" style="margin-top: 15px; display: none;"></div>
                                <!-- Xabar ko'rsatish (Excel yuklash xabarlari uchun) -->
                                <div id="create-request-message" style="margin-top: 15px; display: none;"></div>
                            </div>
                            
                            <!-- Tugmalar -->
                            <div class="form-group" style="grid-column: 1 / -1; display: flex; gap: 10px; justify-content: flex-end;">
                                <button type="button" onclick="resetCreateRequestForm()" class="btn btn-outline" style="padding: 10px 20px;">
                                    <i data-feather="x" style="width: 16px; height: 16px;"></i>
                                    Tozalash
                                </button>
                                <button type="submit" class="btn btn-success" style="padding: 10px 20px; display: flex; align-items: center; gap: 8px;">
                                    <i data-feather="send" style="width: 16px; height: 16px;"></i>
                                    So\'rov Yaratish
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
                
                <!-- Filiallar va tasdiqlovchilar jadvali -->
                <div class="card" style="margin-top: 20px;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h3 class="card-title">
                            <i data-feather="table" style="width: 20px; height: 20px; margin-right: 8px;"></i>
                            Filiallar va Tasdiqlovchilar Statistikasi
                        </h3>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <label style="color: rgba(255,255,255,0.8); font-size: 14px; margin-right: 8px;">Brend:</label>
                            <select id="branch-stats-brand-filter" class="form-control" style="min-width: 200px;">
                                <option value="" selected>Brend tanlang</option>
                                ${brands.map(brand => `<option value="${brand.id}">${brand.name}</option>`).join('')}
                            </select>
                            <button onclick="loadBranchApproversTable()" class="btn btn-sm btn-outline" style="padding: 6px 12px; display: flex; align-items: center; gap: 6px; margin-left: 10px;">
                                <i data-feather="refresh-cw" style="width: 14px; height: 14px;"></i>
                                Yangilash
                            </button>
                        </div>
                    </div>
                    <div class="card-body">
                        <div style="overflow-x: auto;">
                            <table id="branch-approvers-table" class="table" style="width: 100%; border-collapse: collapse; background: rgba(255,255,255,0.02);">
                                <thead>
                                    <tr style="background: rgba(79, 172, 254, 0.1); border-bottom: 2px solid rgba(79, 172, 254, 0.3);">
                                        <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600; border-right: 1px solid rgba(255,255,255,0.1); position: sticky; left: 0; background: rgba(79, 172, 254, 0.15); z-index: 10;">Filial</th>
                                        <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600; border-right: 1px solid rgba(255,255,255,0.1);">SVR</th>
                                        <th style="padding: 12px; text-align: center; color: rgba(255,255,255,0.9); font-weight: 600; border-right: 1px solid rgba(255,255,255,0.1);">Menejer</th>
                                        <th style="padding: 12px; text-align: center; color: rgba(255,255,255,0.9); font-weight: 600; border-right: 1px solid rgba(255,255,255,0.1);">Rahbar</th>
                                        <th style="padding: 12px; text-align: center; color: rgba(255,255,255,0.9); font-weight: 600; border-right: 1px solid rgba(255,255,255,0.1);">Kassir</th>
                                        <th style="padding: 12px; text-align: center; color: rgba(255,255,255,0.9); font-weight: 600; border-right: 1px solid rgba(255,255,255,0.1);">Operator</th>
                                        <th style="padding: 12px; text-align: center; color: rgba(255,255,255,0.9); font-weight: 600;">Nazoratchi</th>
                                    </tr>
                                </thead>
                                <tbody id="branch-approvers-table-body">
                                    <tr>
                                        <td colspan="7" style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                                            <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                                                <div class="spinner-border spinner-border-sm" role="status" style="color: #4facfe;">
                                                    <span class="sr-only">Yuklanmoqda...</span>
                                                </div>
                                                <span>Ma'lumotlar yuklanmoqda...</span>
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <style>
                            #branch-approvers-table {
                                font-size: 13px;
                            }
                            #branch-approvers-table tbody tr {
                                border-bottom: 1px solid rgba(255,255,255,0.05);
                                transition: background 0.2s;
                            }
                            #branch-approvers-table tbody tr:hover {
                                background: rgba(79, 172, 254, 0.05);
                            }
                            #branch-approvers-table tbody td {
                                padding: 10px 12px;
                                color: rgba(255,255,255,0.8);
                                border-right: 1px solid rgba(255,255,255,0.05);
                            }
                            #branch-approvers-table tbody td:first-child {
                                font-weight: 500;
                                position: sticky;
                                left: 0;
                                background: rgba(30, 30, 30, 0.8);
                                z-index: 5;
                            }
                            .status-badge {
                                display: inline-block;
                                padding: 4px 8px;
                                border-radius: 4px;
                                font-size: 11px;
                                font-weight: 500;
                                margin: 2px;
                            }
                            .status-approved {
                                background: rgba(16, 185, 129, 0.2);
                                color: #10b981;
                                border: 1px solid rgba(16, 185, 129, 0.3);
                            }
                            .status-pending {
                                background: rgba(245, 158, 11, 0.2);
                                color: #f59e0b;
                                border: 1px solid rgba(245, 158, 11, 0.3);
                            }
                            .status-rejected {
                                background: rgba(239, 68, 68, 0.2);
                                color: #ef4444;
                                border: 1px solid rgba(239, 68, 68, 0.3);
                            }
                            .status-none {
                                color: rgba(255,255,255,0.3);
                                font-size: 11px;
                            }
                        </style>
                    </div>
                </div>
            </div>
            
            <!-- Bot Faoliyati bo'limi -->
            <div class="card" style="margin-bottom: 20px;" id="bot-activity-section">
                <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleBotActivitySection()">
                    <h3 class="card-title" style="display: flex; align-items: center; gap: 10px;">
                        <i data-feather="send" style="width: 20px; height: 20px; color: #06b6d4;"></i>
                        Telegram Bot Faoliyati
                        <i data-feather="chevron-down" id="bot-activity-toggle-icon" style="width: 20px; height: 20px; transition: transform 0.3s;"></i>
                    </h3>
                    <div style="display: flex; gap: 10px; align-items: center;" onclick="event.stopPropagation();">
                        <span id="bot-activity-today-count" style="padding: 6px 12px; background: rgba(6, 182, 212, 0.2); border-radius: 6px; color: #06b6d4; font-size: 13px; font-weight: 600;">
                            Bugun: 0 ta
                        </span>
                        <button onclick="loadBotActivity()" class="btn btn-sm btn-outline" style="padding: 6px 12px; display: flex; align-items: center; gap: 6px;">
                            <i data-feather="refresh-cw" style="width: 14px; height: 14px;"></i>
                            Yangilash
                        </button>
                    </div>
                </div>
                <div class="card-body" id="bot-activity-body" style="transition: all 0.3s ease;">
                    <!-- Filterlar -->
                    <div style="display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; padding: 15px; background: rgba(255,255,255,0.03); border-radius: 10px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 500;">Turi:</label>
                            <select id="bot-activity-type-filter" class="form-control" style="min-width: 150px; padding: 8px 12px; font-size: 13px;">
                                <option value="" selected>Barchasi</option>
                                <option value="leader">Rahbar</option>
                                <option value="cashier">Kassir</option>
                                <option value="operator">Operator</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 500;">Status:</label>
                            <select id="bot-activity-status-filter" class="form-control" style="min-width: 150px; padding: 8px 12px; font-size: 13px;">
                                <option value="" selected>Barchasi</option>
                                <option value="approved">Tasdiqlangan</option>
                                <option value="rejected">Rad etilgan</option>
                                <option value="debt_marked">Qarzdorlik</option>
                            </select>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 500;">Sana:</label>
                            <input type="date" id="bot-activity-start-date" class="form-control" style="padding: 8px 12px; font-size: 13px;">
                            <span style="color: rgba(255,255,255,0.5);">-</span>
                            <input type="date" id="bot-activity-end-date" class="form-control" style="padding: 8px 12px; font-size: 13px;">
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <label style="color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 500;">Qidirish:</label>
                            <input type="text" id="bot-activity-search" class="form-control" placeholder="So'rov ID, foydalanuvchi..." style="min-width: 180px; padding: 8px 12px; font-size: 13px;">
                        </div>
                    </div>
                    
                    <!-- Tasdiqlashlar jadvali -->
                    <div style="overflow-x: auto; max-height: 500px; overflow-y: auto;">
                        <table class="table" id="bot-activity-table" style="width: 100%; border-collapse: collapse;">
                            <thead style="position: sticky; top: 0; z-index: 10;">
                                <tr style="background: rgba(6, 182, 212, 0.1); border-bottom: 2px solid rgba(6, 182, 212, 0.3);">
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">So'rov</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">Yaratuvchi</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">Tasdiqlovchi</th>
                                    <th style="padding: 12px; text-align: center; color: rgba(255,255,255,0.9); font-weight: 600;">Turi</th>
                                    <th style="padding: 12px; text-align: center; color: rgba(255,255,255,0.9); font-weight: 600;">Status</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">Izoh</th>
                                    <th style="padding: 12px; text-align: right; color: rgba(255,255,255,0.9); font-weight: 600;">Sana</th>
                                </tr>
                            </thead>
                            <tbody id="bot-activity-table-body">
                                <tr>
                                    <td colspan="7" style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                                        Ma'lumotlar yuklanmoqda...
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    
                    <!-- Pagination -->
                    <div id="bot-activity-pagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                        <span id="bot-activity-info" style="color: rgba(255,255,255,0.6); font-size: 13px;">0 ta yozuv</span>
                        <div id="bot-activity-pages" style="display: flex; gap: 5px;"></div>
                    </div>
                </div>
            </div>
            
            <!-- Kutilayotgan Tasdiqlashlar (Web'dan tasdiqlash) -->
            <div class="card" style="margin-bottom: 20px;" id="pending-approvals-section">
                <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <h3 class="card-title" style="display: flex; align-items: center; gap: 10px;">
                        <i data-feather="check-square" style="width: 20px; height: 20px; color: #22c55e;"></i>
                        Kutilayotgan Tasdiqlashlar
                    </h3>
                    <button onclick="loadPendingApprovals()" class="btn btn-sm btn-outline" style="padding: 6px 12px; display: flex; align-items: center; gap: 6px;">
                        <i data-feather="refresh-cw" style="width: 14px; height: 14px;"></i>
                        Yangilash
                    </button>
                </div>
                <div class="card-body">
                    <div id="pending-approvals-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;">
                        <div style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5); grid-column: 1 / -1;">
                            Ma'lumotlar yuklanmoqda...
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Export va Yangilash bo'limi -->
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h3 class="card-title">📥 Export va Yangilash</h3>
                </div>
                <div style="padding: 20px;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">
                        <button id="debt-export-btn" class="btn btn-primary" style="width: 100%;">
                            <i data-feather="download"></i>
                            Ma'lumotlarni Export qilish
                        </button>
                        <button id="debt-update-import-btn" class="btn btn-success" style="width: 100%;">
                            <i data-feather="upload"></i>
                            Yangilash Import
                        </button>
                    </div>
                    <div style="margin-top: 15px; padding: 12px; background: rgba(79, 172, 254, 0.1); border-left: 3px solid #4facfe; border-radius: 6px;">
                        <p style="margin: 0; color: rgba(255,255,255,0.9); font-size: 13px;">
                            <strong>ℹ️ Qo'llanma:</strong> 
                            <br>• <strong>Export</strong> - Barcha ma'lumotlarni Excel fayl sifatida yuklab olish (Brend, Filial, SVR)
                            <br>• <strong>Yangilash Import</strong> - O'zgartirilgan Excel faylni yuklab, tizim ma'lumotlarini yangilash
                        </p>
                    </div>
                </div>
            </div>
            
            <!-- Import qilingan ma'lumotlar ro'yxati -->
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h3 class="card-title">📋 Import qilingan ma'lumotlar</h3>
                </div>
                <div style="padding: 20px;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                        <div style="background: rgba(79, 172, 254, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(79, 172, 254, 0.3);">
                            <div style="font-size: 24px; font-weight: 700; color: #4facfe;">${brands.length}</div>
                            <div style="font-size: 14px; color: rgba(255,255,255,0.7); margin-top: 5px;">Brendlar</div>
                        </div>
                        <div style="background: rgba(79, 172, 254, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(79, 172, 254, 0.3);">
                            <div style="font-size: 24px; font-weight: 700; color: #4facfe;">${branches.length}</div>
                            <div style="font-size: 14px; color: rgba(255,255,255,0.7); margin-top: 5px;">Filiallar</div>
                        </div>
                        <div style="background: rgba(79, 172, 254, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(79, 172, 254, 0.3);">
                            <div style="font-size: 24px; font-weight: 700; color: #4facfe;">${svrs.length}</div>
                            <div style="font-size: 14px; color: rgba(255,255,255,0.7); margin-top: 5px;">SVR (FISH)</div>
                        </div>
                    </div>
                    
                    <!-- Tabs -->
                    <div style="border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                        <button class="debt-tab-btn active" data-tab="brands" style="padding: 10px 20px; background: transparent; border: none; color: #4facfe; cursor: pointer; border-bottom: 2px solid #4facfe;">
                            Brendlar (${brands.length})
                        </button>
                        <button class="debt-tab-btn" data-tab="branches" style="padding: 10px 20px; background: transparent; border: none; color: rgba(255,255,255,0.7); cursor: pointer;">
                            Filiallar (${branches.length})
                        </button>
                        <button class="debt-tab-btn" data-tab="svrs" style="padding: 10px 20px; background: transparent; border: none; color: rgba(255,255,255,0.7); cursor: pointer;">
                            SVR (FISH) (${svrs.length})
                        </button>
                    </div>
                    
                    <!-- Tab content -->
                    <div id="debt-tab-content">
                        <!-- Brands tab -->
                        <div class="debt-tab-panel active" data-panel="brands">
                            ${brands.length > 0 ? `
                                <div style="overflow-x: auto;">
                                    <table class="table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                                    <thead>
                                        <tr>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">ID</th>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Brend nomi</th>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Yaratilgan</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${brands.map(b => `
                                            <tr>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none; white-space: nowrap;">${b.id}</td>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;"><strong>${b.name}</strong></td>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-top: none; white-space: nowrap;">${new Date(b.created_at).toLocaleDateString('uz-UZ')}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                                </div>
                            ` : '<p style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Brendlar yo\'q</p>'}
                        </div>
                        
                        <!-- Branches tab -->
                        <div class="debt-tab-panel" data-panel="branches" style="display: none;">
                            ${branches.length > 0 ? `
                                <div style="overflow-x: auto;">
                                    <table class="table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                                    <thead>
                                        <tr>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">ID</th>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Brend</th>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Filial nomi</th>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Yaratilgan</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${branches.map(b => `
                                            <tr>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none; white-space: nowrap;">${b.id}</td>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;">${b.brand_name || 'N/A'}</td>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;"><strong>${b.name}</strong></td>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-top: none; white-space: nowrap;">${new Date(b.created_at).toLocaleDateString('uz-UZ')}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                                </div>
                            ` : '<p style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Filiallar yo\'q</p>'}
                        </div>
                        
                        <!-- SVRs tab -->
                        <div class="debt-tab-panel" data-panel="svrs" style="display: none;">
                            ${svrs.length > 0 ? `
                                <div style="overflow-x: auto;">
                                    <table class="table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                                    <thead>
                                        <tr>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">ID</th>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Brend</th>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Filial</th>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">SVR (FISH)</th>
                                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Yaratilgan</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${svrs.map(s => `
                                            <tr>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none; white-space: nowrap;">${s.id}</td>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;">${s.brand_name || 'N/A'}</td>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;">${s.branch_name || 'N/A'}</td>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;"><strong>${s.name}</strong></td>
                                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-top: none; white-space: nowrap;">${new Date(s.created_at).toLocaleDateString('uz-UZ')}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                                </div>
                            ` : '<p style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">SVR (FISH) yo\'q</p>'}
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card debt-requests-card" style="margin-top: 20px;">
                <div class="card-header">
                    <div class="card-header-left">
                        <h3 class="card-title">
                            <i data-feather="list" style="width: 20px; height: 20px; margin-right: 8px;"></i>
                            So'rovlar
                        </h3>
                        <p class="card-subtitle">Tasdiqlash jarayonidagi so'rovlarni ko'rish va boshqarish</p>
                    </div>
                    <div class="filters" style="display: flex; gap: 10px; align-items: center;">
                        <div class="filter-wrapper">
                            <i data-feather="filter" style="width: 16px; height: 16px; margin-right: 8px; color: rgba(255,255,255,0.6);"></i>
                            <select id="debt-status-filter" class="modern-select">
                            <option value="">Barcha statuslar</option>
                            <option value="PENDING_APPROVAL">Kutilmoqda</option>
                            <option value="SET_PENDING">SET kutilmoqda</option>
                            <option value="APPROVED_BY_LEADER">Leader tasdiqladi</option>
                            <option value="APPROVED_BY_CASHIER">Cashier tasdiqladi</option>
                            <option value="APPROVED_BY_OPERATOR">Operator tasdiqladi</option>
                            <option value="DEBT_FOUND">Qarzdorlik topildi</option>
                        </select>
                    </div>
                        <div class="filter-wrapper">
                            <i data-feather="list" style="width: 16px; height: 16px; margin-right: 8px; color: rgba(255,255,255,0.6);"></i>
                            <select id="debt-requests-per-page" class="modern-select" style="width: 120px;">
                                <option value="5">5 ta</option>
                                <option value="10" selected>10 ta</option>
                                <option value="20">20 ta</option>
                                <option value="50">50 ta</option>
                                <option value="0">Hammasi</option>
                        </select>
                    </div>
                </div>
                </div>
                <div id="debt-requests-list" class="debt-requests-container">
                    <!-- Requests will be loaded here -->
                </div>
                <div id="debt-requests-pagination" style="padding: 20px; display: flex; justify-content: center; align-items: center; gap: 10px;">
                    <!-- Pagination will be loaded here -->
                </div>
            </div>
            
            <!-- Qabul qilingan ma'lumotlar bo'limi -->
            <div class="card" style="margin-top: 20px;" id="debt-accepted-data-section">
                <div class="card-header">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div>
                            <h3 class="card-title">✅ Qabul qilingan ma'lumotlar</h3>
                            <p style="margin: 0; color: rgba(255,255,255,0.6); font-size: 14px;">Tasdiqlangan so'rovlardan qabul qilingan qarzdorlik ma'lumotlari</p>
                        </div>
                    </div>
                </div>
                <div style="padding: 20px;">
                    <!-- Filterlar -->
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                        <div>
                            <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8);">Boshlang'ich sana</label>
                            <input type="date" id="accepted-data-start-date" class="form-control" style="width: 100%;">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8);">Tugash sanasi</label>
                            <input type="date" id="accepted-data-end-date" class="form-control" style="width: 100%;">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8);">Brend</label>
                            <select id="accepted-data-brand-filter" class="form-control modern-select" style="width: 100%;">
                                <option value="">Barcha brendlar</option>
                            </select>
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8);">Filial</label>
                            <select id="accepted-data-branch-filter" class="form-control modern-select" style="width: 100%;">
                                <option value="">Barcha filiallar</option>
                            </select>
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8);">SVR</label>
                            <select id="accepted-data-svr-filter" class="form-control modern-select" style="width: 100%;">
                                <option value="">Barcha SVR'lar</option>
                            </select>
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8);">Qidiruv</label>
                            <input type="text" id="accepted-data-search" class="form-control" placeholder="Client ID yoki nom..." style="width: 100%;">
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                        <button id="accepted-data-search-btn" class="btn btn-primary">
                            <i data-feather="search"></i>
                            Qidirish
                        </button>
                        <button id="accepted-data-export-btn" class="btn btn-success">
                            <i data-feather="download"></i>
                            Excel'ga yuklab olish
                        </button>
                    </div>
                    <!-- Jadval -->
                    <div style="overflow-x: auto;">
                        <table class="table" id="accepted-data-table" style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: rgba(34, 197, 94, 0.1); border-bottom: 2px solid rgba(34, 197, 94, 0.3);">
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">ID</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">Client ID</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">Client Name</th>
                                    <th style="padding: 12px; text-align: right; color: rgba(255,255,255,0.9); font-weight: 600;">Debt Amount</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">Brend</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">Filial</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">SVR</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">Request UID</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">Tasdiqlangan</th>
                                    <th style="padding: 12px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600;">Tasdiqlovchi</th>
                                </tr>
                            </thead>
                            <tbody id="accepted-data-table-body">
                                <tr>
                                    <td colspan="10" style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                                        Qidiruv tugmasini bosing
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <!-- Pagination -->
                    <div id="accepted-data-pagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                        <span id="accepted-data-info" style="color: rgba(255,255,255,0.6); font-size: 13px;">0 ta yozuv</span>
                        <div id="accepted-data-pages" style="display: flex; gap: 5px;"></div>
                    </div>
                </div>
            </div>
            
            <!-- Bog'lanishlar bo'limi -->
            <div class="card" style="margin-top: 20px;" id="debt-bindings-section">
                <div class="card-header">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div>
                            <h3 class="card-title">🔗 Bog'lanishlar</h3>
                            <p style="margin: 0; color: rgba(255,255,255,0.6); font-size: 14px;">Rollar va foydalanuvchilarga brendlar/filiallar/SVR'lar biriktirish</p>
                        </div>
                    </div>
                </div>
                <div style="padding: 20px;">
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 600;">
                            <i data-feather="user-check" style="width: 16px; height: 16px; margin-right: 6px;"></i>
                            Rol tanlash
                        </label>
                        <select id="debt-bindings-role-select" class="form-control modern-select" style="max-width: 300px;">
                            <option value="">Rolni tanlang...</option>
                        </select>
                    </div>
                    
                    <div id="debt-bindings-content" style="display: none;">
                        <div class="debt-bindings-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 20px;">
                            <!-- Brendlar -->
                            <div class="debt-binding-group">
                                <h4 style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                    <i data-feather="briefcase" style="width: 18px; height: 18px;"></i>
                                    Brendlar
                                </h4>
                                <div id="debt-bindings-brands" class="debt-binding-checkboxes" style="max-height: 300px; overflow-y: auto; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                                    <p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Yuklanmoqda...</p>
                                </div>
                            </div>
                            
                            <!-- Filiallar -->
                            <div class="debt-binding-group">
                                <h4 style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                    <i data-feather="map-pin" style="width: 18px; height: 18px;"></i>
                                    Filiallar
                                </h4>
                                <div id="debt-bindings-branches" class="debt-binding-checkboxes" style="max-height: 300px; overflow-y: auto; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                                    <p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Brendni tanlang</p>
                                </div>
                            </div>
                            
                            <!-- SVR'lar -->
                            <div class="debt-binding-group">
                                <h4 style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                    <i data-feather="user" style="width: 18px; height: 18px;"></i>
                                    SVR (FISH)
                                </h4>
                                <div id="debt-bindings-svrs" class="debt-binding-checkboxes" style="max-height: 300px; overflow-y: auto; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                                    <p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Filialni tanlang</p>
                                </div>
                            </div>
                        </div>
                        
                        <button type="button" id="debt-bindings-save-btn" class="btn btn-primary">
                            <i data-feather="save"></i>
                            <span>💾 Bog'lanishlarni Saqlash</span>
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- Bloklash bo'limi -->
            <div class="card" style="margin-top: 20px;" id="debt-blocked-section">
                <div class="card-header">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div>
                            <h3 class="card-title">🚫 Bloklash</h3>
                            <p style="margin: 0; color: rgba(255,255,255,0.6); font-size: 14px;">Brendlar, filiallar va SVR'larni bloklash va ochirish</p>
                        </div>
                    </div>
                </div>
                <div style="padding: 20px;">
                    <!-- Bloklash formasi -->
                    <div style="margin-bottom: 30px;">
                        <h4 style="margin-bottom: 15px; color: rgba(255,255,255,0.9);">
                            <i data-feather="lock" style="width: 18px; height: 18px; margin-right: 8px;"></i>
                            Elementni bloklash
                        </h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                            <!-- Brend filter -->
                            <div>
                                <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8); font-weight: 500;">
                                    <i data-feather="briefcase" style="width: 14px; height: 14px; margin-right: 6px; vertical-align: middle;"></i>
                                    Brend
                                </label>
                                <select id="block-filter-brand" class="form-control modern-select">
                                    <option value="">Barcha brendlar</option>
                                </select>
                            </div>
                            <!-- Filial filter -->
                            <div>
                                <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8); font-weight: 500;">
                                    <i data-feather="map-pin" style="width: 14px; height: 14px; margin-right: 6px; vertical-align: middle;"></i>
                                    Filial
                                </label>
                                <select id="block-filter-branch" class="form-control modern-select">
                                    <option value="">Barcha filiallar</option>
                                </select>
                            </div>
                            <!-- SVR filter -->
                            <div>
                                <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8); font-weight: 500;">
                                    <i data-feather="user" style="width: 14px; height: 14px; margin-right: 6px; vertical-align: middle;"></i>
                                    SVR (FISH)
                                </label>
                                <input type="text" id="block-svr-search" class="form-control" placeholder="SVR nomi bo'yicha qidirish..." style="width: 100%; margin-bottom: 10px; display: none;">
                                <div id="block-svrs-list" style="max-height: 400px; overflow-y: auto; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
                                    <div style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">
                                        Filialni tanlang
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8); font-weight: 500;">Bloklash sababi <span style="color: #ef4444;">*</span></label>
                            <input type="text" id="block-reason" class="form-control" placeholder="Masalan: Texnik ishlar, Rekonstruksiya..." style="width: 100%;">
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8); font-weight: 500;">Qo'shimcha izoh</label>
                            <textarea id="block-comment" class="form-control" rows="3" placeholder="Qo'shimcha ma'lumotlar..." style="width: 100%; resize: vertical;"></textarea>
                        </div>
                        <button type="button" id="block-item-btn" class="btn btn-danger" style="width: 100%;">
                            <i data-feather="lock"></i>
                            Bloklash
                        </button>
                    </div>
                    
                    <!-- Bloklangan elementlar ro'yxati -->
                    <div>
                        <h4 style="margin-bottom: 15px; color: rgba(255,255,255,0.9);">
                            <i data-feather="list" style="width: 18px; height: 18px; margin-right: 8px;"></i>
                            Bloklangan elementlar
                        </h4>
                        <div style="margin-bottom: 15px;">
                            <select id="blocked-filter-type" class="form-control modern-select" style="max-width: 200px; display: inline-block;">
                                <option value="">Barcha turlar</option>
                                <option value="brand">Brendlar</option>
                                <option value="branch">Filiallar</option>
                                <option value="svr">SVR'lar</option>
                            </select>
                            <select id="blocked-filter-status" class="form-control modern-select" style="max-width: 200px; display: inline-block; margin-left: 10px;">
                                <option value="true">Faol bloklashlar</option>
                                <option value="false">Ochilgan bloklashlar</option>
                                <option value="">Barchasi</option>
                            </select>
                        </div>
                        <div id="blocked-items-list" style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 15px; min-height: 100px;">
                            <div style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">
                                <i data-feather="loader" style="width: 24px; height: 24px; animation: spin 1s linear infinite;"></i>
                                <p style="margin-top: 10px;">Yuklanmoqda...</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- So'rovlarni Arxivlash bo'limi -->
            <div class="card" style="margin-top: 20px;" id="debt-archive-section">
                <div class="card-header">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div>
                            <h3 class="card-title">📦 So'rovlarni Arxivlash</h3>
                            <p style="margin: 0; color: rgba(255,255,255,0.6); font-size: 14px;">Eski so'rovlarni arxivlash va boshqarish</p>
                        </div>
                    </div>
                </div>
                <div style="padding: 20px;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                        <div>
                            <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8);">Yil</label>
                            <select id="archive-year-select" class="form-control" style="width: 100%;">
                                ${Array.from({ length: 5 }, (_, i) => {
                                    const year = new Date().getFullYear() - i;
                                    return `<option value="${year}" ${i === 0 ? 'selected' : ''}>${year}</option>`;
                                }).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8);">Oy</label>
                            <select id="archive-month-select" class="form-control" style="width: 100%;">
                                ${Array.from({ length: 12 }, (_, i) => {
                                    const month = (i + 1).toString().padStart(2, '0');
                                    const monthName = getMonthName(month);
                                    const now = new Date();
                                    return `<option value="${month}" ${i === now.getMonth() ? 'selected' : ''}>${monthName}</option>`;
                                }).join('')}
                            </select>
                        </div>
                    </div>
                    <button id="archive-requests-btn" class="btn btn-primary" style="width: 100%;">
                        <i data-feather="archive"></i>
                        Tanlangan oy uchun so'rovlarni arxivlash
                    </button>
                </div>
            </div>
            
            <!-- So'rovlarni Qaytadan Faollashtirish bo'limi -->
            <div class="card" style="margin-top: 20px;" id="debt-restore-requests-section">
                <div class="card-header">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div>
                            <h3 class="card-title">🔄 So'rovlarni Qaytadan Faollashtirish</h3>
                            <p style="margin: 0; color: rgba(255,255,255,0.6); font-size: 14px;">Arxivlangan so'rovlarni tanlash bo'yicha qaytadan yangi holatga keltirish</p>
                        </div>
                    </div>
                </div>
                <div style="padding: 20px;">
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 600;">
                            <i data-feather="calendar" style="width: 16px; height: 16px; margin-right: 6px;"></i>
                            Oy va Yil tanlash
                        </label>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <select id="debt-restore-year" class="form-control modern-select" style="max-width: 150px;">
                                <option value="">Yil...</option>
                            </select>
                            <select id="debt-restore-month" class="form-control modern-select" style="max-width: 150px;">
                                <option value="">Oy...</option>
                            </select>
                        </div>
                    </div>
                    
                    <div id="debt-restore-content" style="display: none;">
                        <div class="debt-bindings-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 20px;">
                            <!-- Brendlar -->
                            <div class="debt-binding-group">
                                <h4 style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                    <i data-feather="briefcase" style="width: 18px; height: 18px;"></i>
                                    Brendlar (Tanlash)
                                </h4>
                                <div style="margin-bottom: 10px;">
                                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; border-radius: 6px; transition: background 0.2s;" 
                                           onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                                           onmouseout="this.style.background='transparent'">
                                        <input type="checkbox" id="debt-restore-select-all-brands" style="width: 18px; height: 18px; cursor: pointer;">
                                        <span style="font-weight: 600; color: #4facfe;">Barcha brendlar</span>
                                    </label>
                                </div>
                                <div id="debt-restore-brands" class="debt-binding-checkboxes" style="max-height: 300px; overflow-y: auto; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                                    <p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Oy va yilni tanlang</p>
                                </div>
                            </div>
                            
                            <!-- Filiallar -->
                            <div class="debt-binding-group">
                                <h4 style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                    <i data-feather="map-pin" style="width: 18px; height: 18px;"></i>
                                    Filiallar (Tanlash)
                                </h4>
                                <div style="margin-bottom: 10px;">
                                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; border-radius: 6px; transition: background 0.2s;" 
                                           onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                                           onmouseout="this.style.background='transparent'">
                                        <input type="checkbox" id="debt-restore-select-all-branches" style="width: 18px; height: 18px; cursor: pointer;">
                                        <span style="font-weight: 600; color: #4facfe;">Barcha filiallar</span>
                                    </label>
                                </div>
                                <div id="debt-restore-branches" class="debt-binding-checkboxes" style="max-height: 300px; overflow-y: auto; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                                    <p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Brendni tanlang</p>
                                </div>
                            </div>
                            
                            <!-- SVR'lar -->
                            <div class="debt-binding-group">
                                <h4 style="margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                    <i data-feather="user" style="width: 18px; height: 18px;"></i>
                                    SVR (FISH) (Tanlash)
                                </h4>
                                <div style="margin-bottom: 10px;">
                                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; border-radius: 6px; transition: background 0.2s;" 
                                           onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                                           onmouseout="this.style.background='transparent'">
                                        <input type="checkbox" id="debt-restore-select-all-svrs" style="width: 18px; height: 18px; cursor: pointer;">
                                        <span style="font-weight: 600; color: #4facfe;">Barcha SVR'lar</span>
                                    </label>
                                </div>
                                <div id="debt-restore-svrs" class="debt-binding-checkboxes" style="max-height: 300px; overflow-y: auto; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                                    <p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Filialni tanlang</p>
                                </div>
                            </div>
                        </div>
                        
                        <div style="background: rgba(79, 172, 254, 0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 3px solid #4facfe;">
                            <p style="margin: 0; color: rgba(255,255,255,0.9); font-size: 13px;">
                                <strong>ℹ️ Eslatma:</strong> Tanlangan so'rovlar to'liq yangi holatga keltiriladi va qaytadan so'rov yuborish jarayoniga o'tkaziladi. 
                                <br>Hech narsa tanlanmasa, barcha so'rovlar qaytadan faollashtiriladi.
                            </p>
                        </div>
                        
                        <button type="button" id="debt-restore-requests-btn" class="btn btn-success">
                            <i data-feather="refresh-cw"></i>
                            <span>🔄 So'rovlarni Qaytadan Faollashtirish</span>
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- Foydalanuvchilar bo'limi -->
            <div class="card" style="margin-top: 20px;" id="debt-users-section">
                <div class="card-header">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div>
                            <h3 class="card-title">👥 Foydalanuvchilar</h3>
                            <p style="margin: 0; color: rgba(255,255,255,0.6); font-size: 14px;">Foydalanuvchilarni ko'rish, bog'lanishlar va vazifalarni boshqarish</p>
                        </div>
                        <button type="button" id="debt-users-toggle-btn" class="btn-icon" style="background: rgba(79, 172, 254, 0.1); border: 1px solid rgba(79, 172, 254, 0.3); color: #4facfe; padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 600;" aria-expanded="true">
                            <i data-feather="chevron-up"></i>
                            <span style="margin-left: 6px;">Yig'ish</span>
                        </button>
                    </div>
                </div>
                <div id="debt-users-content" style="padding: 20px;">
                    <!-- Interaktiv Filterlar -->
                    <div class="debt-users-filters" style="margin-bottom: 20px; padding: 15px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i data-feather="filter" style="width: 16px; height: 16px; color: rgba(255,255,255,0.6);"></i>
                                <span style="font-size: 13px; color: rgba(255,255,255,0.7); font-weight: 500;">Rol bo'yicha:</span>
                            </div>
                            <div id="debt-users-role-badges" style="display: flex; gap: 8px; flex-wrap: wrap;">
                                <button class="debt-filter-badge active" data-role="" style="padding: 6px 14px; border-radius: 20px; border: 1px solid rgba(79, 172, 254, 0.3); background: rgba(79, 172, 254, 0.15); color: #4facfe; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s;">
                                    <span>Barchasi</span>
                                    <span class="debt-badge-count" id="debt-role-count-all" style="margin-left: 6px; padding: 2px 6px; background: rgba(79, 172, 254, 0.3); border-radius: 10px; font-size: 11px;">0</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Foydalanuvchilar ro'yxati -->
                    <div id="debt-users-list">
                        <p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Yuklanmoqda...</p>
                    </div>
                    
                    <!-- Pagination -->
                    <div id="debt-users-pagination" style="display: none; margin-top: 20px; text-align: center;">
                        <button id="debt-users-load-more" class="btn btn-secondary" style="padding: 10px 24px;">
                            <i data-feather="chevron-down"></i>
                            <span style="margin-left: 6px;">Ko'proq yuklash</span>
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- Sozlamalar bo'limi - Zamonaviy Grid Layout -->
            <div class="card" style="margin-top: 20px;">
                <div class="card-header">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div>
                            <h3 class="card-title">⚙️ Sozlamalar</h3>
                            <p style="margin: 0; color: rgba(255,255,255,0.6); font-size: 14px;">Tizim parametrlarini boshqarish</p>
                        </div>
                        <button type="button" id="debt-settings-toggle-all" class="btn-icon" style="background: rgba(79, 172, 254, 0.1); border: 1px solid rgba(79, 172, 254, 0.3); color: #4facfe; padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 600;">
                            <i data-feather="chevrons-down"></i>
                            <span style="margin-left: 6px;">Barchasini ochish</span>
                        </button>
                    </div>
                </div>
                <div style="padding: 20px;">
                    <form id="debt-settings-form">
                        <!-- Grid Layout -->
                        <div class="debt-settings-grid">
                            <!-- Telegram Guruhlar Sozlamalari -->
                            <div class="debt-settings-card" data-group="telegram-groups">
                                <div class="debt-settings-card-header" data-group="telegram-groups">
                                    <div class="debt-settings-card-icon" style="background: linear-gradient(135deg, rgba(79, 172, 254, 0.2), rgba(102, 126, 234, 0.2));">
                                        <i data-feather="users"></i>
                                    </div>
                                    <div class="debt-settings-card-title">
                                        <h4>Telegram Guruhlar</h4>
                                        <p>Guruh ID'larni sozlash</p>
                                    </div>
                                    <button type="button" class="debt-settings-toggle-btn">
                                        <i data-feather="chevron-down" class="debt-group-chevron"></i>
                                    </button>
                                </div>
                                <div class="debt-settings-card-content" data-content="telegram-groups">
                                    <div class="debt-settings-form-grid">
                                        <div class="form-group">
                                            <label>
                                                <i data-feather="user-check" style="width: 14px; height: 14px; margin-right: 6px;"></i>
                                                Rahbarlar Guruhi ID
                                            </label>
                                            <input type="text" id="debt-leaders-group" placeholder="-100123456789" class="form-control">
                                            <small>Telegram guruh ID (masalan: -100123456789)</small>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>
                                                <i data-feather="users" style="width: 14px; height: 14px; margin-right: 6px;"></i>
                                                Operatorlar Guruhi ID
                                            </label>
                                            <input type="text" id="debt-operators-group" placeholder="-100987654321" class="form-control">
                                            <small>Telegram guruh ID</small>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>
                                                <i data-feather="message-circle" style="width: 14px; height: 14px; margin-right: 6px;"></i>
                                                Umumiy Guruh ID
                                            </label>
                                            <input type="text" id="debt-final-group" placeholder="-100555555555" class="form-control">
                                            <small>Tasdiqlangan so'rovlar yuboriladigan guruh</small>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Eslatma Sozlamalari -->
                            <div class="debt-settings-card" data-group="reminder-settings">
                                <div class="debt-settings-card-header" data-group="reminder-settings">
                                    <div class="debt-settings-card-icon" style="background: linear-gradient(135deg, rgba(255, 193, 7, 0.2), rgba(255, 152, 0, 0.2));">
                                        <i data-feather="bell"></i>
                                    </div>
                                    <div class="debt-settings-card-title">
                                        <h4>Eslatma Sozlamalari</h4>
                                        <p>Eslatma vaqtlari</p>
                                    </div>
                                    <button type="button" class="debt-settings-toggle-btn">
                                        <i data-feather="chevron-down" class="debt-group-chevron"></i>
                                    </button>
                                </div>
                                <div class="debt-settings-card-content" data-content="reminder-settings">
                                    <div class="debt-settings-form-grid">
                                        <div class="form-group">
                                            <label>
                                                <i data-feather="clock" style="width: 14px; height: 14px; margin-right: 6px;"></i>
                                                Eslatma Oraligi (daqiqa)
                                            </label>
                                            <input type="number" id="debt-reminder-interval" min="5" max="1440" value="15" class="form-control">
                                            <small>Qancha vaqtda bir marta eslatma yuborish</small>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>
                                                <i data-feather="repeat" style="width: 14px; height: 14px; margin-right: 6px;"></i>
                                                Maksimal Eslatma Soni
                                            </label>
                                            <input type="number" id="debt-reminder-max" min="1" max="10" value="3" class="form-control">
                                            <small>Jami necha marta eslatma yuborish</small>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Excel Import Sozlamalari -->
                            <div class="debt-settings-card" data-group="excel-settings">
                                <div class="debt-settings-card-header" data-group="excel-settings">
                                    <div class="debt-settings-card-icon" style="background: linear-gradient(135deg, rgba(40, 167, 69, 0.2), rgba(25, 135, 84, 0.2));">
                                        <i data-feather="file-text"></i>
                                    </div>
                                    <div class="debt-settings-card-title">
                                        <h4>Excel Import Sozlamalari</h4>
                                        <p>Import parametrlari</p>
                                    </div>
                                    <button type="button" class="debt-settings-toggle-btn">
                                        <i data-feather="chevron-down" class="debt-group-chevron"></i>
                                    </button>
                                </div>
                                <div class="debt-settings-card-content" data-content="excel-settings">
                                    <div class="debt-settings-form-grid">
                                        <div class="form-group">
                                            <label>
                                                <i data-feather="hash" style="width: 14px; height: 14px; margin-right: 6px;"></i>
                                                Client ID Ustun Nomlari
                                            </label>
                                            <input type="text" id="debt-excel-client-id" value="client_id,id,code" placeholder="client_id,id,code" class="form-control">
                                            <small>Vergul bilan ajratilgan (masalan: client_id,id,code)</small>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>
                                                <i data-feather="user" style="width: 14px; height: 14px; margin-right: 6px;"></i>
                                                Client Name Ustun Nomlari
                                            </label>
                                            <input type="text" id="debt-excel-client-name" value="client_name,name,fio" placeholder="client_name,name,fio" class="form-control">
                                            <small>Vergul bilan ajratilgan</small>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>
                                                <i data-feather="dollar-sign" style="width: 14px; height: 14px; margin-right: 6px;"></i>
                                                Debt Amount Ustun Nomlari
                                            </label>
                                            <input type="text" id="debt-excel-debt-amount" value="debt_amount,debt,qarz" placeholder="debt_amount,debt,qarz" class="form-control">
                                            <small>Vergul bilan ajratilgan</small>
                                        </div>
                                        
                                        <div class="form-group">
                                            <label>
                                                <i data-feather="hard-drive" style="width: 14px; height: 14px; margin-right: 6px;"></i>
                                                Fayl Hajmi Limit (MB)
                                            </label>
                                            <input type="number" id="debt-file-size-limit" min="1" max="50" value="10" class="form-control">
                                            <small>Maksimal fayl hajmi</small>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Bot Knopkalari Sozlamalari -->
                            <div class="debt-settings-card" data-group="bot-buttons-settings">
                                <div class="debt-settings-card-header" data-group="bot-buttons-settings">
                                    <div class="debt-settings-card-icon" style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(167, 139, 250, 0.2));">
                                        <i data-feather="grid"></i>
                                    </div>
                                    <div class="debt-settings-card-title">
                                        <h4>Bot Knopkalari Sozlamalari</h4>
                                        <p>Har bir rol uchun ko'rinadigan knopkalarni sozlash</p>
                                    </div>
                                    <button type="button" class="debt-settings-toggle-btn">
                                        <i data-feather="chevron-down" class="debt-group-chevron"></i>
                                    </button>
                                </div>
                                <div class="debt-settings-card-content" data-content="bot-buttons-settings">
                                    <div style="padding: 20px;">
                                        <div style="margin-bottom: 20px; padding: 12px; background: rgba(139, 92, 246, 0.1); border-left: 3px solid rgba(139, 92, 246, 0.5); border-radius: 6px;">
                                            <p style="margin: 0; color: rgba(255,255,255,0.9); font-size: 13px;">
                                                <strong>ℹ️ Bot Knopkalari:</strong> Har bir rol uchun qaysi Telegram bot knopkalari ko'rinishi kerakligini sozlang. 
                                                Bu sozlamalar bot orqali foydalanuvchilarga ko'rsatiladigan menu knopkalarini boshqaradi.
                                            </p>
                                        </div>
                                        <button type="button" id="bot-buttons-settings-btn" class="btn btn-primary" style="width: 100%; padding: 12px; display: flex; align-items: center; justify-content: center; gap: 10px;">
                                            <i data-feather="grid" style="width: 18px; height: 18px;"></i>
                                            <span>Bot Knopkalarini Sozlash</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <button type="submit" class="btn btn-primary debt-settings-save-btn">
                            <i data-feather="save"></i>
                            <span>💾 Sozlamalarni Saqlash</span>
                        </button>
                    </form>
                </div>
            </div>
        `;
        
        // Tab switcher
        const tabButtons = document.querySelectorAll('.debt-tab-btn');
        const tabPanels = document.querySelectorAll('.debt-tab-panel');
        
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                
                // Remove active class from all
                tabButtons.forEach(b => {
                    b.classList.remove('active');
                    b.style.color = 'rgba(255,255,255,0.7)';
                    b.style.borderBottom = 'none';
                });
                tabPanels.forEach(p => p.style.display = 'none');
                
                // Add active class to clicked
                btn.classList.add('active');
                btn.style.color = '#4facfe';
                btn.style.borderBottom = '2px solid #4facfe';
                
                const panel = document.querySelector(`.debt-tab-panel[data-panel="${tabName}"]`);
                if (panel) {
                    panel.style.display = 'block';
                }
            });
        });
        // Feather icons
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        
        // Settings groups collapsible functionality - Zamonaviy versiya
        setTimeout(() => {
            const settingsCards = document.querySelectorAll('.debt-settings-card');
            let allExpanded = false;
            
            // Toggle all button
            const toggleAllBtn = document.getElementById('debt-settings-toggle-all');
            if (toggleAllBtn) {
                toggleAllBtn.addEventListener('click', () => {
                    allExpanded = !allExpanded;
                    settingsCards.forEach(card => {
                        const header = card.querySelector('.debt-settings-card-header');
                        const content = card.querySelector('.debt-settings-card-content');
                        const chevron = card.querySelector('.debt-group-chevron');
                        
                        if (allExpanded) {
                            expandCard(content, header, chevron);
                        } else {
                            collapseCard(content, header, chevron);
                        }
                    });
                    
                    toggleAllBtn.innerHTML = allExpanded 
                        ? '<i data-feather="chevrons-up"></i><span style="margin-left: 6px;">Barchasini yopish</span>'
                        : '<i data-feather="chevrons-down"></i><span style="margin-left: 6px;">Barchasini ochish</span>';
                    
                    if (typeof feather !== 'undefined') {
                        feather.replace();
                    }
                });
            }
            
            // Individual card toggle
            settingsCards.forEach(card => {
                const header = card.querySelector('.debt-settings-card-header');
                const toggleBtn = card.querySelector('.debt-settings-toggle-btn');
                const content = card.querySelector('.debt-settings-card-content');
                const chevron = card.querySelector('.debt-group-chevron');
                
                // Default holatda yopilgan
                collapseCard(content, header, chevron);
                
                const toggleHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const isExpanded = content.classList.contains('expanded');
                    
                    if (isExpanded) {
                        collapseCard(content, header, chevron);
                    } else {
                        expandCard(content, header, chevron);
                    }
                    
                    if (typeof feather !== 'undefined') {
                        feather.replace();
                    }
                };
                
                if (header) {
                    header.addEventListener('click', toggleHandler);
                }
                if (toggleBtn) {
                    toggleBtn.addEventListener('click', toggleHandler);
                }
            });
            
            function expandCard(content, header, chevron) {
                if (content) {
                    content.classList.add('expanded');
                    content.style.maxHeight = '0';
                    content.offsetHeight; // Force reflow
                    content.style.maxHeight = content.scrollHeight + 'px';
                }
                if (header) {
                    header.classList.add('expanded');
                }
                if (chevron) {
                    chevron.style.transform = 'rotate(180deg)';
                }
            }
            
            function collapseCard(content, header, chevron) {
                if (content) {
                    content.style.maxHeight = content.scrollHeight + 'px';
                    content.offsetHeight; // Force reflow
                    content.classList.remove('expanded');
                    content.style.maxHeight = '0';
                }
                if (header) {
                    header.classList.remove('expanded');
                }
                if (chevron) {
                    chevron.style.transform = 'rotate(0deg)';
                }
            }
        }, 200);
        
        // Load requests
        log('loadDebtRequests() chaqirilmoqda...');
        loadDebtRequests(1);
        
        // Settings form submit handler
        const settingsForm = document.getElementById('debt-settings-form');
        if (settingsForm) {
            settingsForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await saveDebtSettings();
            });
            // Load settings on page load
            await loadDebtSettings();
        } else {
        }
        
        // Setup bot buttons settings button
        setTimeout(() => {
            const botButtonsBtn = document.getElementById('bot-buttons-settings-btn');
            if (botButtonsBtn) {
                botButtonsBtn.addEventListener('click', async () => {
                    // Dynamic import for debt-settings module
                    try {
                        const { showDebtSettingsModal } = await import('./debt-settings.js');
                        showDebtSettingsModal();
                        // Feather icons ni yangilash
                        if (typeof feather !== 'undefined') {
                            feather.replace();
                        }
                    } catch (error) {
                        logger.error('Error loading bot settings modal:', error);
                        showToast('Bot sozlamalarini yuklashda xatolik yuz berdi', true);
                    }
                });
            }
        }, 100);
        
        // Setup filters
        const statusFilter = document.getElementById('debt-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => {
                loadDebtRequests(1); // Birinchi sahifaga qaytish
            });
        } else {
        }
        
        // Setup per page selector
        const perPageSelect = document.getElementById('debt-requests-per-page');
        if (perPageSelect) {
            perPageSelect.addEventListener('change', () => {
                loadDebtRequests(1); // Birinchi sahifaga qaytish
            });
        }
        
        // Setup month selector
        setupDebtMonthSelector(selectedYear, selectedMonth, loadDebtStats);
        
        
        // Avtomatik yangilanish o'chirilgan - endi faqat "Yangilash" knopkasi orqali yangilanadi
        if (statsUpdateInterval) {
            clearInterval(statsUpdateInterval);
            statsUpdateInterval = null;
            }
        if (branchDataUpdateInterval) {
            clearInterval(branchDataUpdateInterval);
            branchDataUpdateInterval = null;
            }
        
        // Render charts
        if (detailedStats) {
            setTimeout(() => {
                renderDebtCharts(detailedStats);
            }, 500);
        }
        
        // Render branches map
        setTimeout(() => {
            // Filiallar bo'yicha holat kartalarini yuklash
            loadBranchStatusCards();
            
            // Filter event listenerlar (Filiallar holati uchun)
            const branchStatusBrandFilter = document.getElementById('branch-status-brand-filter');
            const branchStatusStatusFilter = document.getElementById('branch-status-status-filter');
            const branchStatusSearch = document.getElementById('branch-status-search');
            
            if (branchStatusBrandFilter) {
                branchStatusBrandFilter.addEventListener('change', () => {
                    loadBranchStatusCards();
                });
            }
            
            if (branchStatusStatusFilter) {
                branchStatusStatusFilter.addEventListener('change', () => {
                    loadBranchStatusCards();
                });
            }
            
            if (branchStatusSearch) {
                // Debounce search input
                let searchTimeout;
                branchStatusSearch.addEventListener('input', () => {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        loadBranchStatusCards();
                    }, 300);
                });
            }
            
            // Filiallar va tasdiqlovchilar jadvalini yuklash
            loadBranchApproversTable();
            
            // Brend filter event listener (Jadval uchun)
            const branchStatsBrandFilter = document.getElementById('branch-stats-brand-filter');
            if (branchStatsBrandFilter) {
                branchStatsBrandFilter.addEventListener('change', () => {
                    loadBranchApproversTable();
                });
            }
            
            // So'rov yaratish formasi event listener'lari
            setupCreateRequestForm();
            
            // Bot faoliyatini yuklash
            loadBotActivity();
            loadPendingApprovals();
            
            // Bot faoliyati filter event listener'lari
            const botActivityTypeFilter = document.getElementById('bot-activity-type-filter');
            const botActivityStatusFilter = document.getElementById('bot-activity-status-filter');
            const botActivityStartDate = document.getElementById('bot-activity-start-date');
            const botActivityEndDate = document.getElementById('bot-activity-end-date');
            const botActivitySearch = document.getElementById('bot-activity-search');
            
            [botActivityTypeFilter, botActivityStatusFilter, botActivityStartDate, botActivityEndDate].forEach(el => {
                if (el) {
                    el.addEventListener('change', () => loadBotActivity());
                }
            });
            
            if (botActivitySearch) {
                let searchTimeout;
                botActivitySearch.addEventListener('input', () => {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => loadBotActivity(), 300);
                });
            }
        }, 600);
        
        // Setup bindings section
        await setupDebtBindings();
        
        // Setup blocked section
        await setupDebtBlocked();
        
        // Setup archive section - DOM elementlar tayyor bo'lgandan keyin
        setTimeout(() => {
            setupArchiveEventListeners();
        }, 100);
        
        // Setup restore requests section
        await setupDebtRestoreRequests();
        
        // Setup accepted data section
        await setupAcceptedDataSection();
        
        // Setup users section
        await setupDebtUsers();
        
        // Setup export/import buttons - DOM elementlar allaqachon yuklangan
        // Feather icons ni yangilash
        if (window.feather) {
            feather.replace();
        }
        
        // Export va yangilash tugmalarini sozlash
        // DOM elementlar allaqachon yuklangan, shuning uchun to'g'ridan-to'g'ri chaqiramiz
        setupExportButtons();
        
    } catch (error) {
        logger.error('Debt-approval sahifasini yuklashda xatolik:', error);
        content.innerHTML = `
            <div style="padding: 20px; background: rgba(255, 0, 0, 0.1); border: 1px solid red; border-radius: 8px; color: #ff6b6b;">
                <h3>❌ Xatolik yuz berdi</h3>
                <p><strong>Xatolik:</strong> ${error.message}</p>
                <p style="font-size: 12px; margin-top: 10px; opacity: 0.8;">
                    Browser console'da batafsil ma'lumotni ko'rishingiz mumkin (F12)
                </p>
            </div>
        `;
    }
}

// Load debt requests
// Pagination state
let debtRequestsPage = 1;
let debtRequestsPerPage = 10;
let debtRequestsTotal = 0;

async function loadDebtRequests(page = 1) {
    const list = document.getElementById('debt-requests-list');
    const paginationContainer = document.getElementById('debt-requests-pagination');
    if (!list) {
        return;
    }
    
    try {
        const status = document.getElementById('debt-status-filter')?.value || '';
        const perPageSelect = document.getElementById('debt-requests-per-page');
        const perPage = perPageSelect ? parseInt(perPageSelect.value) : 10;
        debtRequestsPerPage = perPage;
        
        let url = `${API_URL}/requests?page=${page}`;
        if (perPage > 0) {
            url += `&limit=${perPage}`;
        } else {
            url += `&limit=1000`; // Hammasi uchun
        }
        if (status) url += `&status=${status}`;
        
        const response = await safeFetch(url);
        
        if (!response || !response.ok) {
            throw new Error(`API xatolik: ${response?.status || 'No response'}`);
        }
        
        const data = await response.json();
        debtRequestsTotal = data.total || 0;
        debtRequestsPage = page;
        if (data.requests && data.requests.length > 0) {
            list.innerHTML = `
                <div style="overflow-x: auto;">
                    <table class="table debt-requests-table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                    <thead>
                        <tr>
                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">ID</th>
                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Brend</th>
                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Filial</th>
                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">SVR</th>
                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Turi</th>
                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Status</th>
                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); border-right: none; background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Sana</th>
                                <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); background: rgba(79, 172, 254, 0.1); white-space: nowrap;">Amallar</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.requests.map(req => `
                                <tr class="debt-request-row" data-request-id="${req.id}">
                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none; white-space: nowrap;"><code class="request-id">${req.request_uid}</code></td>
                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;"><strong>${req.brand_name || 'N/A'}</strong></td>
                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;">${req.branch_name || 'N/A'}</td>
                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;">${req.svr_name || 'N/A'}</td>
                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;"><span class="type-badge ${req.type === 'SET' ? 'type-set' : 'type-normal'}">${req.type || 'ODDIY'}</span></td>
                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none;"><span class="badge ${getStatusClass(req.status)}">${formatStatus(req.status)}</span></td>
                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-right: none; border-top: none; white-space: nowrap;">${formatDate(req.created_at)}</td>
                                    <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-top: none;">
                                        <button class="btn-icon" onclick="viewRequestDetails(${req.id})" title="Batafsil">
                                            <i data-feather="eye"></i>
                                        </button>
                                    </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                </div>
            `;
            
            // Pagination render qilish
            if (perPage > 0 && debtRequestsTotal > perPage) {
                renderDebtRequestsPagination(data.total || 0, page, perPage);
            } else {
                if (paginationContainer) {
                    paginationContainer.innerHTML = '';
                }
            }
            
            // Feather icons qayta render qilish
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
            
        } else {
            list.innerHTML = `
                <div class="debt-empty-state">
                    <i data-feather="inbox" style="width: 64px; height: 64px; color: rgba(255,255,255,0.3); margin-bottom: 16px;"></i>
                    <h3 style="color: rgba(255,255,255,0.7); margin: 0 0 8px 0;">So'rovlar topilmadi</h3>
                    <p style="color: rgba(255,255,255,0.5); margin: 0;">Hozircha hech qanday so'rov mavjud emas</p>
                </div>
            `;
            
            if (paginationContainer) {
                paginationContainer.innerHTML = '';
            }
            
            // Feather icons qayta render qilish
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
        }
    } catch (error) {
        logger.error('So\'rovlarni yuklashda xatolik:', error);
        list.innerHTML = `
            <div style="padding: 15px; background: rgba(255, 0, 0, 0.1); border: 1px solid red; border-radius: 8px; color: #ff6b6b;">
                <p><strong>Xatolik:</strong> ${error.message}</p>
            </div>
        `;
    }
}

/**
 * Pagination render qilish
 */
function renderDebtRequestsPagination(total, currentPage, perPage) {
    const paginationContainer = document.getElementById('debt-requests-pagination');
    if (!paginationContainer) return;
    
    const totalPages = Math.ceil(total / perPage);
    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    const pages = [];
    
    // Oldingi sahifa
    if (currentPage > 1) {
        pages.push(`<button class="btn btn-sm btn-secondary" onclick="loadDebtRequestsPage(${currentPage - 1})">Oldingi</button>`);
    }
    
    // Sahifa raqamlari
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    
    if (startPage > 1) {
        pages.push(`<button class="btn btn-sm btn-secondary" onclick="loadDebtRequestsPage(1)">1</button>`);
        if (startPage > 2) {
            pages.push(`<span style="color: rgba(255,255,255,0.5); padding: 0 10px;">...</span>`);
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        pages.push(`<button class="btn btn-sm ${i === currentPage ? 'btn-primary' : 'btn-secondary'}" onclick="loadDebtRequestsPage(${i})">${i}</button>`);
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pages.push(`<span style="color: rgba(255,255,255,0.5); padding: 0 10px;">...</span>`);
        }
        pages.push(`<button class="btn btn-sm btn-secondary" onclick="loadDebtRequestsPage(${totalPages})">${totalPages}</button>`);
    }
    
    // Keyingi sahifa
    if (currentPage < totalPages) {
        pages.push(`<button class="btn btn-sm btn-secondary" onclick="loadDebtRequestsPage(${currentPage + 1})">Keyingi</button>`);
    }
    
    paginationContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            ${pages.join('')}
            <span style="color: rgba(255,255,255,0.7); margin-left: 10px;">
                Sahifa ${currentPage} / ${totalPages} (Jami: ${total})
            </span>
        </div>
    `;
}

// Global function for pagination
window.loadDebtRequestsPage = function(page) {
    loadDebtRequests(page);
};

function getStatusClass(status) {
    if (status.includes('PENDING')) return 'badge-pending';
    if (status.includes('APPROVED')) return 'badge-approved';
    if (status.includes('CANCELLED')) return 'badge-cancelled';
    if (status.includes('DEBT')) return 'badge-debt';
    return 'badge-pending';
}

function formatStatus(status) {
    const statusMap = {
        'PENDING_APPROVAL': 'Kutilmoqda',
        'SET_PENDING': 'SET kutilmoqda',
        'APPROVED_BY_LEADER': 'Leader tasdiqladi',
        'APPROVED_BY_CASHIER': 'Cashier tasdiqladi',
        'APPROVED_BY_OPERATOR': 'Operator tasdiqladi',
        'APPROVED_BY_SUPERVISOR': 'Supervisor tasdiqladi',
        'FINAL_APPROVED': 'Yakuniy tasdiqlandi',
        'DEBT_FOUND': 'Qarzdorlik topildi',
        'CANCELLED': 'Bekor qilindi',
        'REJECTED': 'Rad etildi'
    };
    return statusMap[status] || status;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('uz-UZ', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// So'rov batafsil ma'lumotlarini ko'rsatish
async function viewRequestDetails(requestId) {
    try {
        // Loading modal ko'rsatish
        showRequestDetailsModal(requestId, null, true);
        
        // API dan ma'lumotlarni olish
        const response = await safeFetch(`${API_URL}/requests/${requestId}`, { credentials: 'include' });
        
        if (!response || !response.ok) {
            throw new Error(`API xatolik: ${response?.status || 'No response'}`);
        }
        
        const requestData = await response.json();
        
        // Modalni to'liq ma'lumotlar bilan ko'rsatish
        showRequestDetailsModal(requestId, requestData, false);
        
    } catch (error) {
        logger.error('So\'rov ma\'lumotlarini yuklashda xatolik:', error);
        showRequestDetailsModal(requestId, null, false, error.message);
    }
}

// So'rov batafsil ma'lumotlari modalini ko'rsatish
function showRequestDetailsModal(requestId, requestData, isLoading, errorMessage = null) {
    // Modal mavjudligini tekshirish va o'chirish
    const existingModal = document.getElementById('request-details-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Modal HTML yaratish
    const modalHTML = `
        <div id="request-details-modal" class="modal-overlay" style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            padding: 20px;
        ">
            <div class="modal-content" style="
                background: #1e293b;
                border-radius: 12px;
                max-width: 900px;
                width: 100%;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(255, 255, 255, 0.1);
            ">
                <div class="modal-header" style="
                    padding: 20px 24px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                ">
                    <h2 style="margin: 0; color: #fff; font-size: 20px; font-weight: 600;">
                        <i data-feather="file-text" style="width: 20px; height: 20px; margin-right: 8px; vertical-align: middle;"></i>
                        So'rov Batafsil Ma'lumotlari
                    </h2>
                    <button id="close-request-modal" style="
                        background: transparent;
                        border: none;
                        color: rgba(255, 255, 255, 0.7);
                        font-size: 24px;
                        cursor: pointer;
                        padding: 0;
                        width: 32px;
                        height: 32px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 6px;
                        transition: all 0.2s;
                    " onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='#fff';" onmouseout="this.style.background='transparent'; this.style.color='rgba(255,255,255,0.7)';">
                        <i data-feather="x"></i>
                    </button>
                </div>
                <div class="modal-body" style="padding: 24px;">
                    ${isLoading ? `
                        <div style="text-align: center; padding: 40px;">
                            <div class="spinner" style="
                                border: 3px solid rgba(79, 172, 254, 0.2);
                                border-top: 3px solid #4facfe;
                                border-radius: 50%;
                                width: 40px;
                                height: 40px;
                                animation: spin 1s linear infinite;
                                margin: 0 auto 16px;
                            "></div>
                            <p style="color: rgba(255, 255, 255, 0.7); margin: 0;">Ma'lumotlar yuklanmoqda...</p>
                        </div>
                    ` : errorMessage ? `
                        <div style="
                            padding: 20px;
                            background: rgba(239, 68, 68, 0.1);
                            border: 1px solid rgba(239, 68, 68, 0.3);
                            border-radius: 8px;
                            color: #ef4444;
                        ">
                            <strong>Xatolik:</strong> ${errorMessage}
                        </div>
                    ` : requestData ? renderRequestDetails(requestData) : ''}
                </div>
            </div>
        </div>
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;
    
    // Modalni DOM ga qo'shish
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Feather icons yangilash
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
    
    // Modal yopish funksiyasi
    const closeModal = () => {
        const modal = document.getElementById('request-details-modal');
        if (modal) {
            modal.style.opacity = '0';
            setTimeout(() => modal.remove(), 200);
        }
    };
    
    // Yopish tugmasi
    const closeBtn = document.getElementById('close-request-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
    
    // Tashqariga bosilganda yopish
    const modalOverlay = document.getElementById('request-details-modal');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeModal();
            }
        });
    }
    
    // ESC tugmasi bilan yopish
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// So'rov batafsil ma'lumotlarini render qilish
function renderRequestDetails(data) {
    // excel_headers va excel_data ni parse qilish (agar string bo'lsa)
    if (data.excel_headers && typeof data.excel_headers === 'string') {
        try {
            data.excel_headers = JSON.parse(data.excel_headers);
        } catch (e) {
            logger.warn('excel_headers parse qilishda xatolik:', e);
            data.excel_headers = [];
        }
    }
    if (data.excel_data && typeof data.excel_data === 'string') {
        try {
            data.excel_data = JSON.parse(data.excel_data);
        } catch (e) {
            logger.warn('excel_data parse qilishda xatolik:', e);
            data.excel_data = [];
        }
    }
    
    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString('uz-UZ', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };
    
    const getStatusColor = (status) => {
        const colors = {
            'PENDING_APPROVAL': '#f59e0b',
            'SET_PENDING': '#f59e0b',
            'APPROVED_BY_CASHIER': '#10b981',
            'APPROVED_BY_OPERATOR': '#10b981',
            'APPROVED_BY_LEADER': '#10b981',
            'APPROVED_BY_SUPERVISOR': '#10b981',
            'FINAL_APPROVED': '#10b981',
            'DEBT_FOUND': '#ef4444',
            'CANCELLED': '#6b7280',
            'REJECTED': '#ef4444'
        };
        return colors[status] || '#6b7280';
    };
    
    return `
        <!-- Asosiy ma'lumotlar -->
        <div style="margin-bottom: 24px;">
            <h3 style="color: #fff; font-size: 16px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <i data-feather="info" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i>
                Asosiy Ma'lumotlar
            </h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px;">
                <div>
                    <label style="color: rgba(255, 255, 255, 0.6); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">So'rov ID</label>
                    <div style="color: #fff; font-weight: 500; margin-top: 4px;"><code style="background: rgba(79, 172, 254, 0.1); padding: 4px 8px; border-radius: 4px; color: #4facfe;">${data.request_uid || 'N/A'}</code></div>
                </div>
                <div>
                    <label style="color: rgba(255, 255, 255, 0.6); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Brend</label>
                    <div style="color: #fff; font-weight: 500; margin-top: 4px;">${data.brand_name || 'N/A'}</div>
                </div>
                <div>
                    <label style="color: rgba(255, 255, 255, 0.6); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Filial</label>
                    <div style="color: #fff; font-weight: 500; margin-top: 4px;">${data.branch_name || 'N/A'}</div>
                </div>
                <div>
                    <label style="color: rgba(255, 255, 255, 0.6); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">SVR</label>
                    <div style="color: #fff; font-weight: 500; margin-top: 4px;">${data.svr_name || 'N/A'}</div>
                </div>
                <div>
                    <label style="color: rgba(255, 255, 255, 0.6); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Tur</label>
                    <div style="color: #fff; font-weight: 500; margin-top: 4px;">
                        <span style="background: ${data.type === 'SET' ? 'rgba(249, 115, 22, 0.2)' : 'rgba(79, 172, 254, 0.2)'}; color: ${data.type === 'SET' ? '#f97316' : '#4facfe'}; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                            ${data.type || 'ODDIY'}
                        </span>
                    </div>
                </div>
                <div>
                    <label style="color: rgba(255, 255, 255, 0.6); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Status</label>
                    <div style="color: #fff; font-weight: 500; margin-top: 4px;">
                        <span style="background: ${getStatusColor(data.status)}20; color: ${getStatusColor(data.status)}; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                            ${formatStatus(data.status)}
                        </span>
                    </div>
                </div>
                <div>
                    <label style="color: rgba(255, 255, 255, 0.6); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Yaratilgan</label>
                    <div style="color: #fff; font-weight: 500; margin-top: 4px;">${formatDateTime(data.created_at)}</div>
                </div>
                <div>
                    <label style="color: rgba(255, 255, 255, 0.6); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Yaratuvchi</label>
                    <div style="color: #fff; font-weight: 500; margin-top: 4px;">${data.created_by_username || 'N/A'}</div>
                </div>
            </div>
            ${data.extra_info ? `
                <div style="margin-top: 16px;">
                    <label style="color: rgba(255, 255, 255, 0.6); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Qo'shimcha Ma'lumot</label>
                    <div style="color: #fff; margin-top: 4px; padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 6px; white-space: pre-wrap;">${data.extra_info}</div>
                </div>
            ` : ''}
        </div>
        
        <!-- Tarix (Loglar) -->
        ${data.logs && data.logs.length > 0 ? `
            <div style="margin-bottom: 24px;">
                <h3 style="color: #fff; font-size: 16px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                    <i data-feather="clock" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i>
                    Tarix (${data.logs.length} ta)
                </h3>
                <div style="background: rgba(255, 255, 255, 0.03); border-radius: 8px; overflow: hidden;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: rgba(255, 255, 255, 0.05);">
                                <th style="padding: 12px; text-align: left; color: rgba(255, 255, 255, 0.7); font-size: 12px; font-weight: 600; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">Sana</th>
                                <th style="padding: 12px; text-align: left; color: rgba(255, 255, 255, 0.7); font-size: 12px; font-weight: 600; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">Foydalanuvchi</th>
                                <th style="padding: 12px; text-align: left; color: rgba(255, 255, 255, 0.7); font-size: 12px; font-weight: 600; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">Harakat</th>
                                <th style="padding: 12px; text-align: left; color: rgba(255, 255, 255, 0.7); font-size: 12px; font-weight: 600; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">Izoh</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.logs.map((log, index) => `
                                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); ${index % 2 === 0 ? 'background: rgba(255, 255, 255, 0.02);' : ''}">
                                    <td style="padding: 12px; color: rgba(255, 255, 255, 0.8); font-size: 13px;">${formatDateTime(log.created_at)}</td>
                                    <td style="padding: 12px; color: rgba(255, 255, 255, 0.8); font-size: 13px;">${log.username || 'N/A'}</td>
                                    <td style="padding: 12px; color: rgba(255, 255, 255, 0.8); font-size: 13px;">
                                        <span style="background: rgba(79, 172, 254, 0.2); color: #4facfe; padding: 2px 6px; border-radius: 4px; font-size: 11px;">
                                            ${log.action || 'N/A'}
                                        </span>
                                    </td>
                                    <td style="padding: 12px; color: rgba(255, 255, 255, 0.6); font-size: 13px;">${log.note || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        ` : ''}
        
        <!-- Fayllar -->
        ${data.attachments && data.attachments.length > 0 ? `
            <div style="margin-bottom: 24px;">
                <h3 style="color: #fff; font-size: 16px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                    <i data-feather="paperclip" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i>
                    Fayllar (${data.attachments.length} ta)
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">
                    ${data.attachments.map(att => `
                        <div style="
                            padding: 12px;
                            background: rgba(255, 255, 255, 0.05);
                            border-radius: 8px;
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            transition: all 0.2s;
                        " onmouseover="this.style.background='rgba(255,255,255,0.08)'; this.style.borderColor='rgba(79,172,254,0.5)';" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)';">
                            <div style="color: #fff; font-weight: 500; margin-bottom: 4px; font-size: 13px; word-break: break-all;">
                                ${att.file_name || 'Fayl'}
                            </div>
                            <div style="color: rgba(255, 255, 255, 0.5); font-size: 11px;">
                                ${att.file_size ? (att.file_size / 1024).toFixed(2) + ' KB' : 'N/A'}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}
        
        <!-- Tasdiqlovchilar -->
        ${data.approvers ? `
            <div style="margin-bottom: 24px;">
                <h3 style="color: #fff; font-size: 16px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                    <i data-feather="users" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i>
                    Tasdiqlovchilar
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                    ${data.approvers.manager ? `
                        <div style="padding: 12px; background: rgba(79, 172, 254, 0.1); border: 1px solid rgba(79, 172, 254, 0.3); border-radius: 8px;">
                            <div style="color: rgba(255, 255, 255, 0.6); font-size: 11px; text-transform: uppercase; margin-bottom: 4px;">Menejer</div>
                            <div style="color: #fff; font-weight: 500; font-size: 13px;">${data.approvers.manager.fullname || data.approvers.manager.username || 'N/A'}</div>
                            <div style="color: rgba(255, 255, 255, 0.5); font-size: 11px; margin-top: 4px;">${formatDateTime(data.approvers.manager.created_at)}</div>
                        </div>
                    ` : ''}
                    ${data.approvers.leader ? `
                        <div style="padding: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px;">
                            <div style="color: rgba(255, 255, 255, 0.6); font-size: 11px; text-transform: uppercase; margin-bottom: 4px;">Rahbar</div>
                            <div style="color: #fff; font-weight: 500; font-size: 13px;">${data.approvers.leader.fullname || data.approvers.leader.username || 'N/A'}</div>
                            <div style="color: rgba(255, 255, 255, 0.5); font-size: 11px; margin-top: 4px;">${formatDateTime(data.approvers.leader.approved_at)}</div>
                        </div>
                    ` : ''}
                    ${data.approvers.cashier ? `
                        <div style="padding: 12px; background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.3); border-radius: 8px;">
                            <div style="color: rgba(255, 255, 255, 0.6); font-size: 11px; text-transform: uppercase; margin-bottom: 4px;">Kassir</div>
                            <div style="color: #fff; font-weight: 500; font-size: 13px;">${data.approvers.cashier.fullname || data.approvers.cashier.username || 'N/A'}</div>
                            <div style="color: rgba(255, 255, 255, 0.5); font-size: 11px; margin-top: 4px;">${formatDateTime(data.approvers.cashier.approved_at)}</div>
                        </div>
                    ` : ''}
                    ${data.approvers.operator ? `
                        <div style="padding: 12px; background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 8px;">
                            <div style="color: rgba(255, 255, 255, 0.6); font-size: 11px; text-transform: uppercase; margin-bottom: 4px;">Operator</div>
                            <div style="color: #fff; font-weight: 500; font-size: 13px;">${data.approvers.operator.fullname || data.approvers.operator.username || 'N/A'}</div>
                            <div style="color: rgba(255, 255, 255, 0.5); font-size: 11px; margin-top: 4px;">${formatDateTime(data.approvers.operator.approved_at)}</div>
                        </div>
                    ` : ''}
                    ${data.approvers.supervisor ? `
                        <div style="padding: 12px; background: rgba(236, 72, 153, 0.1); border: 1px solid rgba(236, 72, 153, 0.3); border-radius: 8px;">
                            <div style="color: rgba(255, 255, 255, 0.6); font-size: 11px; text-transform: uppercase; margin-bottom: 4px;">Nazoratchi</div>
                            <div style="color: #fff; font-weight: 500; font-size: 13px;">${data.approvers.supervisor.fullname || data.approvers.supervisor.username || 'N/A'}</div>
                            <div style="color: rgba(255, 255, 255, 0.5); font-size: 11px; margin-top: 4px;">${formatDateTime(data.approvers.supervisor.approved_at)}</div>
                        </div>
                    ` : ''}
                </div>
            </div>
        ` : ''}
        
        <!-- SET Qarzdorlik Ma'lumotlari -->
        ${data.type === 'SET' && data.excel_data ? `
            <div style="margin-bottom: 24px;">
                <h3 style="color: #fff; font-size: 16px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                    <i data-feather="file-spreadsheet" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i>
                    SET Qarzdorlik Ma'lumotlari
                </h3>
                <div style="background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.3); border-radius: 8px; padding: 16px;">
                    ${data.excel_total ? `
                        <div style="margin-bottom: 12px;">
                            <div style="color: rgba(255, 255, 255, 0.6); font-size: 12px; margin-bottom: 4px;">Jami qarzdorlik</div>
                            <div style="color: #f97316; font-size: 20px; font-weight: 600;">${parseFloat(data.excel_total).toLocaleString('uz-UZ')} so'm</div>
                        </div>
                    ` : ''}
                    ${data.excel_headers && Array.isArray(data.excel_headers) && data.excel_headers.length > 0 ? `
                        <div style="margin-top: 16px; overflow-x: auto;">
                            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                                <thead>
                                    <tr style="background: rgba(255, 255, 255, 0.05);">
                                        ${data.excel_headers.map(header => `
                                            <th style="padding: 8px; text-align: left; color: rgba(255, 255, 255, 0.7); border-bottom: 1px solid rgba(255, 255, 255, 0.1); white-space: nowrap;">
                                                ${header}
                                            </th>
                                        `).join('')}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${(data.excel_data || []).slice(0, 10).map((row, index) => `
                                        <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); ${index % 2 === 0 ? 'background: rgba(255, 255, 255, 0.02);' : ''}">
                                            ${data.excel_headers.map(header => `
                                                <td style="padding: 8px; color: rgba(255, 255, 255, 0.8); white-space: nowrap;">
                                                    ${row[header] || '-'}
                                                </td>
                                            `).join('')}
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                            ${(data.excel_data || []).length > 10 ? `
                                <div style="margin-top: 12px; color: rgba(255, 255, 255, 0.5); font-size: 11px; text-align: center;">
                                    ... va yana ${(data.excel_data || []).length - 10} ta qator
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        ` : ''}
        
        <!-- Qarzdorlik hisobotlari -->
        ${data.debtReports && data.debtReports.length > 0 ? `
            <div style="margin-bottom: 24px;">
                <h3 style="color: #fff; font-size: 16px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                    <i data-feather="alert-circle" style="width: 16px; height: 16px; margin-right: 8px; vertical-align: middle;"></i>
                    Qarzdorlik Hisobotlari (${data.debtReports.length} ta)
                </h3>
                <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 16px;">
                    ${data.debtReports.map((report, index) => `
                        <div style="margin-bottom: ${index < data.debtReports.length - 1 ? '16px' : '0'}; padding-bottom: ${index < data.debtReports.length - 1 ? '16px' : '0'}; border-bottom: ${index < data.debtReports.length - 1 ? '1px solid rgba(239, 68, 68, 0.2)' : 'none'};">
                            <div style="color: #ef4444; font-weight: 500; margin-bottom: 8px;">Hisobot #${index + 1}</div>
                            <div style="color: rgba(255, 255, 255, 0.8); font-size: 13px; white-space: pre-wrap;">${report.report_data || 'Ma\'lumot yo\'q'}</div>
                            <div style="color: rgba(255, 255, 255, 0.5); font-size: 11px; margin-top: 8px;">${formatDateTime(report.created_at)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}
    `;
}

// Global function for onclick
window.viewRequestDetails = viewRequestDetails;

// Oy nomini olish
function getMonthName(month) {
    const months = [
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    return months[parseInt(month) - 1] || month;
}

function getMonthNumber(monthName) {
    const months = [
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    const index = months.findIndex(m => m.toLowerCase() === monthName.toLowerCase());
    return index >= 0 ? (index + 1).toString().padStart(2, '0') : '01';
}

// Update statistics display with animation
function updateStatsDisplay(stats) {
    if (!stats || !stats.summary) return;
    
    const statCards = {
        'stat-total': stats.summary.total || 0,
        'stat-pending': stats.summary.pending || 0,
        'stat-approved': stats.summary.approved || 0,
        'stat-debt': stats.summary.debtFound || 0,
        'stat-cancelled': stats.summary.cancelled || 0
    };
    
    Object.entries(statCards).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            const oldValue = parseInt(element.textContent) || 0;
            if (oldValue !== value) {
                animateValue(element, oldValue, value, 500);
            }
        }
    });
}

// Animate number change
function animateValue(element, start, end, duration) {
    const startTime = performance.now();
    const difference = end - start;
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        const current = Math.round(start + difference * easeOutQuart);
        
        element.textContent = current;
        
        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.textContent = end;
        }
    }
    
    requestAnimationFrame(update);
}

// Render debt approval charts
// Chart instances storage
const chartInstances = {};

// Real-time statistics update interval
let statsUpdateInterval = null;
let branchDataUpdateInterval = null;
let isStatsUpdating = false;

// Chart configuration with modern interactive features
const chartDefaults = {
    responsive: true,
    maintainAspectRatio: true,
    interaction: {
        intersect: false,
        mode: 'index'
    },
    plugins: {
        tooltip: {
            enabled: true,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            borderColor: 'rgba(255, 255, 255, 0.2)',
            borderWidth: 1,
            padding: 14,
            displayColors: true,
            titleFont: {
                size: 14,
                weight: 'bold'
            },
            bodyFont: {
                size: 13
            },
            callbacks: {
                label: function(context) {
                    let label = context.dataset.label || '';
                    if (label) {
                        label += ': ';
                    }
                    label += context.parsed.y || context.parsed;
                    return label;
                }
            }
        },
        legend: {
            labels: {
                color: '#ffffff', // Yorqin oq rang
                usePointStyle: true,
                padding: 20,
                font: {
                    size: 15,
                    weight: 'bold'
                }
            }
        }
    },
    animation: {
        duration: 1000,
        easing: 'easeInOutQuart'
    },
    onHover: (event, activeElements) => {
        event.native.target.style.cursor = activeElements.length > 0 ? 'pointer' : 'default';
    }
};

function renderDebtCharts(stats) {
    // Feather icons
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
    
    // Check if Chart.js is available
    if (typeof Chart === 'undefined') {
        return;
    }
    
    // Destroy existing charts before creating new ones
    Object.values(chartInstances).forEach(chart => {
        if (chart && typeof chart.destroy === 'function') {
            chart.destroy();
        }
    });
    Object.keys(chartInstances).forEach(key => delete chartInstances[key]);
    
    
    // Status distribution chart
    const statusCtx = document.getElementById('debt-status-chart');
    if (statusCtx && stats.statusDistribution && stats.statusDistribution.length > 0) {
        const statusLabels = stats.statusDistribution.map(s => formatStatus(s.status));
        const statusData = stats.statusDistribution.map(s => s.count);
        const total = statusData.reduce((a, b) => a + b, 0);
        
        // Status bo'yicha ranglar - sozlanuvchi ranglar
        const statusColors = [
            chartColors.status.waiting,     // Kutilmoqda
            chartColors.status.setWaiting,  // SET kutilmoqda
            chartColors.status.debt,        // Debt
            chartColors.status.cancelled,   // Cancelled
            chartColors.status.approved     // Approved
        ];
        
        chartInstances.statusChart = new Chart(statusCtx, {
            type: 'doughnut',
            data: {
                labels: statusLabels,
                datasets: [{
                    data: statusData,
                    backgroundColor: statusColors.slice(0, statusData.length).map(color => {
                        // Zamonaviy ranglar - to'q va aniq
                        return color;
                    }),
                    borderWidth: 4,
                    borderColor: statusColors.slice(0, statusData.length).map(color => color),
                    hoverBorderWidth: 5,
                    hoverOffset: 10
                }]
            },
            options: {
                ...chartDefaults,
                plugins: {
                    ...chartDefaults.plugins,
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            color: '#ffffff', // Text rangini oq qilish
                            font: {
                                size: 15,
                                weight: 'bold',
                                family: 'system-ui, -apple-system, sans-serif'
                            },
                            generateLabels: function(chart) {
                                const data = chart.data;
                                if (data.labels.length && data.datasets.length) {
                                    return data.labels.map((label, i) => {
                                        const value = data.datasets[0].data[i];
                                        const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                                        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                        // Zamonaviy rangni aniqlash
                                        const chartColor = statusColors[i] || data.datasets[0].backgroundColor[i];
                                        return {
                                            text: `${label}: ${value} (${percentage}%)`,
                                            fillStyle: chartColor,
                                            strokeStyle: chartColor,
                                            lineWidth: 3,
                                            hidden: false,
                                            index: i
                                        };
                                    });
                                }
                                return [];
                            },
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 18,
                            boxHeight: 18
                        }
                    }
                },
                onClick: (event, activeElements) => {
                    if (activeElements.length > 0) {
                        const index = activeElements[0].index;
                        const status = stats.statusDistribution[index].status;
                        logger.debug('Status bosildi:', status);
                        // Bu yerga filter yoki boshqa interaktiv funksiya qo'shish mumkin
                    }
                }
            }
        });
    }
    
    // Type distribution chart
    const typeCtx = document.getElementById('debt-type-chart');
    if (typeCtx && stats.typeDistribution && stats.typeDistribution.length > 0) {
        const typeLabels = stats.typeDistribution.map(t => t.type || 'ODDIY');
        const typeData = stats.typeDistribution.map(t => t.count);
        // Tur bo'yicha ranglar - sozlanuvchi ranglar
        const typeColors = [
            chartColors.type.normal,   // NORMAL
            chartColors.type.set       // SET
        ];
        
        chartInstances.typeChart = new Chart(typeCtx, {
            type: 'pie',
            data: {
                labels: typeLabels,
                datasets: [{
                    data: typeData,
                    backgroundColor: typeColors.slice(0, typeData.length).map(color => {
                        // Zamonaviy ranglar - to'q va aniq
                        return color;
                    }),
                    borderWidth: 4,
                    borderColor: typeColors.slice(0, typeData.length).map(color => color),
                    hoverBorderWidth: 5,
                    hoverOffset: 15
                }]
            },
            options: {
                ...chartDefaults,
                plugins: {
                    ...chartDefaults.plugins,
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            color: '#ffffff', // Text rangini oq qilish
                            font: {
                                size: 15,
                                weight: 'bold',
                                family: 'system-ui, -apple-system, sans-serif'
                            },
                            generateLabels: function(chart) {
                                const data = chart.data;
                                if (data.labels.length && data.datasets.length) {
                                    return data.labels.map((label, i) => {
                                        const value = data.datasets[0].data[i];
                                        const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                                        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                        // Zamonaviy rangni aniqlash
                                        const chartColor = typeColors[i] || data.datasets[0].backgroundColor[i];
                                        return {
                                            text: `${label}: ${value} (${percentage}%)`,
                                            fillStyle: chartColor,
                                            strokeStyle: chartColor,
                                            lineWidth: 3,
                                            hidden: false,
                                            index: i
                                        };
                                    });
                                }
                                return [];
                            },
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 18,
                            boxHeight: 18
                        }
                    }
                },
                onClick: (event, activeElements) => {
                    if (activeElements.length > 0) {
                        const index = activeElements[0].index;
                        const type = stats.typeDistribution[index].type;
                        logger.debug('Tur bosildi:', type);
                        // Bu yerga filter yoki boshqa interaktiv funksiya qo'shish mumkin
                    }
                }
            }
        });
    }
    
    // Manager stats chart - SVR holati bo'yicha stacked bar
    const managerCtx = document.getElementById('debt-manager-chart');
    if (managerCtx && stats.managerStats && stats.managerStats.length > 0) {
        const managerLabels = stats.managerStats.map(m => m.name);
        
        // Har bir menejer uchun status bo'yicha ma'lumotlar
        // Agar managerStats ichida status breakdown bo'lmasa, oddiy so'rovlar sonini ko'rsatamiz
        const hasStatusBreakdown = stats.managerStats[0] && (stats.managerStats[0].completed !== undefined || stats.managerStats[0].inProgress !== undefined);
        
        let datasets;
        if (hasStatusBreakdown) {
            // Status bo'yicha stacked bar - sozlanuvchi ranglar
            datasets = [
                {
                    label: 'Tugallangan',
                    data: stats.managerStats.map(m => m.completed || 0),
                    backgroundColor: chartColors.manager.completed,
                    borderColor: chartColors.manager.completed,
                    borderWidth: 2,
                    borderRadius: 4,
                    borderSkipped: false
                },
                {
                    label: 'Jarayonda',
                    data: stats.managerStats.map(m => m.inProgress || 0),
                    backgroundColor: chartColors.manager.inProgress,
                    borderColor: chartColors.manager.inProgress,
                    borderWidth: 2,
                    borderRadius: 4,
                    borderSkipped: false
                },
                {
                    label: 'Yuborilmagan',
                    data: stats.managerStats.map(m => m.notSubmitted || 0),
                    backgroundColor: chartColors.manager.notSubmitted,
                    borderColor: chartColors.manager.notSubmitted,
                    borderWidth: 2,
                    borderRadius: 4,
                    borderSkipped: false
                }
            ];
        } else {
            // Oddiy so'rovlar soni
            const managerData = stats.managerStats.map(m => m.count);
            datasets = [{
                label: 'So\'rovlar soni',
                data: managerData,
                backgroundColor: managerData.map((_, i) => {
                    // Zamonaviy gradient ranglar
                    const colors = [
                        '#3b82f6',   // Ko'k
                        '#8b5cf6',   // Binafsha
                        '#06b6d4',   // Cyan
                        '#10b981',   // Yashil
                        '#f59e0b'    // Sariq
                    ];
                    return colors[i % colors.length];
                }),
                borderColor: managerData.map((_, i) => {
                    const colors = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706'];
                    return colors[i % colors.length];
                }),
                borderWidth: 2,
                borderRadius: 8,
                borderSkipped: false
            }];
        }
        
        chartInstances.managerChart = new Chart(managerCtx, {
            type: 'bar',
            data: {
                labels: managerLabels,
                datasets: datasets
            },
            options: {
                ...chartDefaults,
                indexAxis: 'y',
                plugins: {
                    ...chartDefaults.plugins,
                    legend: {
                        display: hasStatusBreakdown,
                        position: 'top',
                        labels: {
                            color: '#ffffff',
                            padding: 15,
                            font: {
                                size: 13,
                                weight: 'bold'
                            },
                            usePointStyle: true,
                            pointStyle: 'rectRounded'
                        }
                    },
                    tooltip: {
                        ...chartDefaults.plugins.tooltip,
                        callbacks: {
                            label: function(context) {
                                const value = context.parsed.x;
                                const label = context.dataset.label;
                                const total = context.chart.data.datasets.reduce((sum, ds) => {
                                    return sum + (ds.data[context.dataIndex] || 0);
                                }, 0);
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: hasStatusBreakdown,
                        beginAtZero: true,
                        ticks: {
                            color: '#ffffff',
                            font: {
                                size: 12,
                                weight: 'bold'
                            },
                            stepSize: 1
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            drawBorder: false
                        }
                    },
                    y: {
                        stacked: hasStatusBreakdown,
                        ticks: {
                            color: '#ffffff',
                            font: {
                                size: 14,
                                weight: 'bold'
                            }
                        },
                        grid: {
                            display: false
                        }
                    }
                },
                onClick: (event, activeElements) => {
                    if (activeElements.length > 0) {
                        const index = activeElements[0].index;
                        const managerName = managerLabels[index];
                        logger.debug('Menejer bosildi:', managerName);
                    }
                }
            }
        });
    }
    
}

/**
 * Filiallar bo'yicha holat bo'limini yopish/ochish
 */
function toggleBranchStatusSection() {
    const body = document.getElementById('branch-status-body');
    const icon = document.getElementById('branch-status-toggle-icon');
    
    if (body && icon) {
        if (body.style.display === 'none') {
            body.style.display = 'block';
            icon.style.transform = 'rotate(0deg)';
        } else {
            body.style.display = 'none';
            icon.style.transform = 'rotate(-90deg)';
        }
    }
}

// Global funksiyalar sifatida export qilish
window.toggleBranchStatusSection = toggleBranchStatusSection;
window.loadBranchStatusCards = loadBranchStatusCards;

// =============================================
// TELEGRAM BOT FAOLIYATI FUNKSIYALARI
// =============================================

// Bot faoliyati bo'limini ochish/yopish
function toggleBotActivitySection() {
    const body = document.getElementById('bot-activity-body');
    const icon = document.getElementById('bot-activity-toggle-icon');
    
    if (body && icon) {
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        icon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
    }
}

// Bot faoliyatini yuklash
let botActivityPage = 1;
async function loadBotActivity(page = 1) {
    logger.debug('[BOT_ACTIVITY] loadBotActivity() chaqirildi, page:', page);
    botActivityPage = page;
    
    const tableBody = document.getElementById('bot-activity-table-body');
    if (!tableBody) {
        logger.error('[BOT_ACTIVITY] Jadval body topilmadi!');
        return;
    }
    
    // Loading ko'rsatish
    tableBody.innerHTML = `
        <tr>
            <td colspan="7" style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                    <div class="spinner-border spinner-border-sm" role="status" style="color: #06b6d4;">
                        <span class="sr-only">Yuklanmoqda...</span>
                    </div>
                    <span>Ma'lumotlar yuklanmoqda...</span>
                </div>
            </td>
        </tr>
    `;
    
    try {
        // Filterlarni olish
        const typeFilter = document.getElementById('bot-activity-type-filter')?.value || '';
        const statusFilter = document.getElementById('bot-activity-status-filter')?.value || '';
        const startDate = document.getElementById('bot-activity-start-date')?.value || '';
        const endDate = document.getElementById('bot-activity-end-date')?.value || '';
        const searchTerm = document.getElementById('bot-activity-search')?.value || '';
        
        const params = new URLSearchParams();
        params.append('page', page);
        params.append('limit', 20);
        if (typeFilter) params.append('approvalType', typeFilter);
        if (statusFilter) params.append('status', statusFilter);
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        if (searchTerm) params.append('searchTerm', searchTerm);
        
        const response = await safeFetch(`${API_URL}/requests/bot-activity?${params.toString()}`, {
            credentials: 'include'
        });
        
        if (!response || !response.ok) {
            throw new Error(`So'rov topilmadi: ${response?.status || 'No response'}`);
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data) {
            throw new Error(result.error || "Ma'lumotlar olinmadi");
        }
        
        const { approvals, pagination, stats } = result.data;
        
        // Bugungi tasdiqlashlar sonini yangilash
        const todayCountEl = document.getElementById('bot-activity-today-count');
        if (todayCountEl) {
            todayCountEl.textContent = `Bugun: ${stats.todayCount} ta`;
        }
        
        if (approvals.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                        Ma'lumotlar topilmadi
                    </td>
                </tr>
            `;
            return;
        }
        
        // Jadvalni to'ldirish
        tableBody.innerHTML = approvals.map(a => {
            // Status rangi
            let statusColor = '#6b7280';
            let statusText = "Noma'lum";
            if (a.approvalStatus === 'approved') {
                statusColor = '#22c55e';
                statusText = 'Tasdiqlangan';
            } else if (a.approvalStatus === 'rejected') {
                statusColor = '#ef4444';
                statusText = 'Rad etilgan';
            } else if (a.approvalStatus === 'debt_marked') {
                statusColor = '#f59e0b';
                statusText = 'Qarzdorlik';
            }
            
            // Turi rangi
            let typeColor = '#6b7280';
            let typeText = a.approvalType || "Noma'lum";
            if (a.approvalType === 'leader') {
                typeColor = '#8b5cf6';
                typeText = 'Rahbar';
            } else if (a.approvalType === 'cashier') {
                typeColor = '#06b6d4';
                typeText = 'Kassir';
            } else if (a.approvalType === 'operator') {
                typeColor = '#3b82f6';
                typeText = 'Operator';
            } else if (a.approvalType === 'admin') {
                typeColor = '#ec4899';
                typeText = 'Admin';
            }
            
            const date = new Date(a.approvalDate);
            const formattedDate = date.toLocaleString('uz-UZ', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(6,182,212,0.05)'" onmouseout="this.style.background=''">
                    <td style="padding: 12px;">
                        <div style="font-weight: 600; color: #06b6d4;">${a.requestUid || '-'}</div>
                        <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 2px;">
                            ${a.brand || ''} / ${a.branch || ''} / ${a.svr || ''}
                        </div>
                    </td>
                    <td style="padding: 12px; color: rgba(255,255,255,0.8);">
                        ${a.creator?.fullname || a.creator?.username || '-'}
                    </td>
                    <td style="padding: 12px; color: rgba(255,255,255,0.8);">
                        ${a.approver?.fullname || a.approver?.username || '-'}
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <span style="padding: 4px 10px; background: ${typeColor}20; color: ${typeColor}; border-radius: 4px; font-size: 12px; font-weight: 500;">
                            ${typeText}
                        </span>
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <span style="padding: 4px 10px; background: ${statusColor}20; color: ${statusColor}; border-radius: 4px; font-size: 12px; font-weight: 500;">
                            ${statusText}
                        </span>
                    </td>
                    <td style="padding: 12px; color: rgba(255,255,255,0.6); font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${a.note || '-'}
                        ${a.debtAmount ? `<br><strong style="color: #f59e0b;">${Number(a.debtAmount).toLocaleString()} so'm</strong>` : ''}
                    </td>
                    <td style="padding: 12px; text-align: right; color: rgba(255,255,255,0.6); font-size: 12px; white-space: nowrap;">
                        ${formattedDate}
                    </td>
                </tr>
            `;
        }).join('');
        
        // Pagination
        renderBotActivityPagination(pagination);
        
        // Info
        const infoEl = document.getElementById('bot-activity-info');
        if (infoEl) {
            infoEl.textContent = `${pagination.total} ta yozuv, ${pagination.page}/${pagination.totalPages} sahifa`;
        }
        
        logger.debug('[BOT_ACTIVITY] ✅ Jadval muvaffaqiyatli yuklandi');
        
    } catch (error) {
        logger.error('[BOT_ACTIVITY] ❌ Xatolik:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="padding: 40px; text-align: center; color: #ef4444;">
                    Xatolik: ${error.message || "Ma'lumotlar yuklanmadi"}
                </td>
            </tr>
        `;
    }
}

// Pagination render
function renderBotActivityPagination(pagination) {
    const pagesContainer = document.getElementById('bot-activity-pages');
    if (!pagesContainer) return;
    
    const { page, totalPages } = pagination;
    let html = '';
    
    // Oldingi
    if (page > 1) {
        html += `<button onclick="loadBotActivity(${page - 1})" class="btn btn-sm btn-outline" style="padding: 6px 12px;">←</button>`;
    }
    
    // Sahifalar
    const startPage = Math.max(1, page - 2);
    const endPage = Math.min(totalPages, page + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === page;
        html += `<button onclick="loadBotActivity(${i})" class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline'}" style="padding: 6px 12px;">${i}</button>`;
    }
    
    // Keyingi
    if (page < totalPages) {
        html += `<button onclick="loadBotActivity(${page + 1})" class="btn btn-sm btn-outline" style="padding: 6px 12px;">→</button>`;
    }
    
    pagesContainer.innerHTML = html;
}

// Kutilayotgan tasdiqlashlarni yuklash
async function loadPendingApprovals() {
    logger.debug('[PENDING_APPROVALS] loadPendingApprovals() chaqirildi');
    
    const container = document.getElementById('pending-approvals-container');
    if (!container) {
        logger.error('[PENDING_APPROVALS] Konteyner topilmadi!');
        return;
    }
    
    // Loading ko'rsatish
    container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5); grid-column: 1 / -1;">
            <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                <div class="spinner-border spinner-border-sm" role="status" style="color: #22c55e;">
                    <span class="sr-only">Yuklanmoqda...</span>
                </div>
                <span>Ma'lumotlar yuklanmoqda...</span>
            </div>
        </div>
    `;
    
    try {
        const response = await safeFetch(`${API_URL}/requests/pending-approvals`, {
            credentials: 'include'
        });
        
        if (!response || !response.ok) {
            throw new Error(`So'rov topilmadi: ${response?.status || 'No response'}`);
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data) {
            throw new Error(result.error || "Ma'lumotlar olinmadi");
        }
        
        const { requests, userPermissions } = result.data;
        
        if (requests.length === 0) {
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5); grid-column: 1 / -1;">
                    <i data-feather="check-circle" style="width: 48px; height: 48px; color: #22c55e; margin-bottom: 10px;"></i>
                    <div>Kutilayotgan tasdiqlashlar yo'q</div>
                </div>
            `;
            if (typeof feather !== 'undefined') feather.replace();
            return;
        }
        
        // Kartalarni render qilish - tartibli va to'g'ri formatda
        container.innerHTML = requests.map(r => {
            // Status va rangni aniqlash
            let statusColor = '#f59e0b';
            let statusText = 'Jarayondagi';
            
            if (r.status === 'SET_PENDING') {
                statusColor = '#8b5cf6';
                statusText = 'Rahbar kutilmoqda';
            } else if (r.status === 'APPROVED_BY_LEADER') {
                statusColor = '#06b6d4';
                statusText = 'Kassir kutilmoqda';
            } else if (r.status === 'APPROVED_BY_CASHIER') {
                statusColor = '#3b82f6';
                statusText = 'Operator kutilmoqda';
            } else if (r.status === 'APPROVED_BY_OPERATOR') {
                statusColor = '#8b5cf6';
                statusText = 'Nazoratchi kutilmoqda';
            } else if (r.status === 'PENDING_APPROVAL') {
                statusColor = '#f59e0b';
                statusText = 'Tasdiqlash kutilmoqda';
            }
            
            // Sana va vaqtni to'g'ri formatlash
            let formattedDate = '-';
            const dateValue = r.createdAt || r.created_at || r.updatedAt || r.updated_at;
            if (dateValue) {
                try {
                    const date = new Date(dateValue);
                    if (!isNaN(date.getTime())) {
                        formattedDate = date.toLocaleString('uz-UZ', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    }
                } catch (e) {
                    logger.warn('[PENDING_APPROVALS] Sana formatlash xatolik:', e);
                }
            }
            
            // Ma'lumotlarni to'g'ri olish - backend'dan qaytayotgan formatga moslashtirish
            const requestUid = r.uid || r.request_uid || r.id || 'Noma\'lum';
            const requestType = r.type || r.request_type || 'NORMAL';
            const brandName = r.brandName || r.brand_name || r.brand || '-';
            const branchName = r.branchName || r.branch_name || r.branch || '-';
            const svrName = r.svrName || r.svr_name || r.svr || '-';
            const creatorName = r.createdBy?.fullname || r.createdBy?.username || r.creator_fullname || r.creator?.fullname || r.creator_username || r.creator?.username || '-';
            
            // Qisqa so'rov ID (faqat oxirgi qismi)
            const shortUid = requestUid.length > 20 ? '...' + requestUid.slice(-17) : requestUid;
            
            return `
                <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 12px; padding: 16px; transition: transform 0.2s; min-height: 160px; display: flex; flex-direction: column; cursor: pointer; position: relative;" 
                     onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 4px 12px rgba(34, 197, 94, 0.2)'" 
                     onmouseout="this.style.transform=''; this.style.boxShadow='none'"
                     onclick="showPendingRequestDetails(${r.id})">
                    <!-- Header: So'rov ID va Status -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; gap: 8px;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-weight: 700; color: #22c55e; font-size: 14px; margin-bottom: 4px; line-height: 1.2;" title="${requestUid}">${shortUid}</div>
                            <div style="font-size: 11px; color: rgba(255,255,255,0.5);">
                                ${requestType === 'SET' ? '<span style="color: #8b5cf6; font-weight: 500;">🔴 SET</span>' : '<span style="color: #22c55e; font-weight: 500;">🟢 ODDIY</span>'}
                            </div>
                        </div>
                        <span style="padding: 5px 12px; background: ${statusColor}25; color: ${statusColor}; border-radius: 6px; font-size: 11px; font-weight: 600; white-space: nowrap; flex-shrink: 0; border: 1px solid ${statusColor}40;">
                            ${statusText}
                        </span>
                    </div>
                    
                    <!-- Asosiy ma'lumotlar: Filial va SVR -->
                    <div style="font-size: 13px; color: rgba(255,255,255,0.9); margin-bottom: 12px; flex: 1;">
                        <div style="margin-bottom: 6px;">
                            <strong style="color: rgba(255,255,255,0.7); font-size: 11px;">Filial:</strong>
                            <div style="color: rgba(255,255,255,0.95); font-weight: 500; margin-top: 2px;">${branchName}</div>
                        </div>
                        <div>
                            <strong style="color: rgba(255,255,255,0.7); font-size: 11px;">SVR:</strong>
                            <div style="color: rgba(255,255,255,0.95); font-weight: 500; margin-top: 2px; word-break: break-word;">${svrName}</div>
                        </div>
                    </div>
                    
                    <!-- Harakatlar: Tasdiqlash va Rad etish -->
                    <div style="display: flex; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);" onclick="event.stopPropagation();">
                        <button onclick="webApprove(${r.id}, 'approve'); event.stopPropagation();" class="btn btn-sm btn-success" style="flex: 1; padding: 10px 12px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 500; border-radius: 6px;">
                            <i data-feather="check" style="width: 14px; height: 14px;"></i> Tasdiqlash
                        </button>
                        <button onclick="webApprove(${r.id}, 'reject'); event.stopPropagation();" class="btn btn-sm btn-danger" style="flex: 1; padding: 10px 12px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 500; border-radius: 6px;">
                            <i data-feather="x" style="width: 14px; height: 14px;"></i> Rad etish
                        </button>
                    </div>
                    
                    <!-- Info icon - batafsil ma'lumotlar -->
                    <div style="position: absolute; top: 12px; right: 12px; cursor: pointer; opacity: 0.6; transition: opacity 0.2s;" 
                         onmouseover="this.style.opacity='1'" 
                         onmouseout="this.style.opacity='0.6'"
                         onclick="showPendingRequestDetails(${r.id}); event.stopPropagation();"
                         title="Batafsil ma'lumotlar">
                        <i data-feather="info" style="width: 16px; height: 16px; color: rgba(255,255,255,0.7);"></i>
                    </div>
                </div>
            `;
        }).join('');
        
        if (typeof feather !== 'undefined') feather.replace();
        logger.debug('[PENDING_APPROVALS] ✅ Kartalar muvaffaqiyatli yuklandi');
        
    } catch (error) {
        logger.error('[PENDING_APPROVALS] ❌ Xatolik:', error);
        container.innerHTML = `
            <div style="padding: 40px; text-align: center; color: #ef4444; grid-column: 1 / -1;">
                Xatolik: ${error.message || "Ma'lumotlar yuklanmadi"}
            </div>
        `;
    }
}

// Web'dan tasdiqlash
async function webApprove(requestId, action) {
    const actionText = action === 'approve' ? 'tasdiqlash' : 'rad etish';
    
    if (!confirm(`Bu so'rovni ${actionText}ni xohlaysizmi?`)) {
        return;
    }
    
    try {
        const response = await safeFetch(`${API_URL}/requests/web-approve/${requestId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action })
        });
        
        if (!response || !response.ok) {
            const errorData = await response?.json();
            throw new Error(errorData?.error || "So'rov bajarilmadi");
        }
        
        const result = await response.json();
        
        if (result.success) {
            showToast(result.message, 'success');
            // Qayta yuklash
            loadPendingApprovals();
            loadBotActivity();
        } else {
            throw new Error(result.error || 'Xatolik yuz berdi');
        }
    } catch (error) {
        logger.error('[WEB_APPROVE] ❌ Xatolik:', error);
        showToast(error.message || 'Xatolik yuz berdi', 'error');
    }
}

// Kutilayotgan so'rov batafsil ma'lumotlarini ko'rsatish
async function showPendingRequestDetails(requestId) {
    try {
        // API dan ma'lumotlarni olish
        const response = await safeFetch(`${API_URL}/requests/${requestId}`, { credentials: 'include' });
        
        if (!response || !response.ok) {
            throw new Error(`API xatolik: ${response?.status || 'No response'}`);
        }
        
        const requestData = await response.json();
        
        // Modal HTML yaratish
        const modalHTML = `
            <div id="pending-request-modal" class="modal-overlay" style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.85);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                padding: 20px;
                animation: fadeIn 0.2s;
            ">
                <div class="modal-content" style="
                    background: #1e293b;
                    border-radius: 12px;
                    max-width: 700px;
                    width: 100%;
                    max-height: 90vh;
                    overflow-y: auto;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                    border: 1px solid rgba(34, 197, 94, 0.3);
                    animation: slideUp 0.3s;
                ">
                    <div class="modal-header" style="
                        padding: 20px 24px;
                        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        background: rgba(34, 197, 94, 0.1);
                    ">
                        <h2 style="margin: 0; color: #22c55e; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                            <i data-feather="info" style="width: 20px; height: 20px;"></i>
                            So'rov Batafsil Ma'lumotlari
                        </h2>
                        <button id="close-pending-modal" style="
                            background: transparent;
                            border: none;
                            color: rgba(255, 255, 255, 0.7);
                            font-size: 24px;
                            cursor: pointer;
                            padding: 0;
                            width: 32px;
                            height: 32px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            border-radius: 6px;
                            transition: all 0.2s;
                        " onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='#fff';" onmouseout="this.style.background='transparent'; this.style.color='rgba(255,255,255,0.7)';">
                            <i data-feather="x"></i>
                        </button>
                    </div>
                    <div class="modal-body" style="padding: 24px;">
                        ${renderPendingRequestDetails(requestData)}
                    </div>
                </div>
            </div>
            <style>
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            </style>
        `;
        
        // Eski modalni o'chirish
        const existingModal = document.getElementById('pending-request-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Modalni DOM ga qo'shish
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Feather icons yangilash
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        
        // Modal yopish funksiyasi
        const closeModal = () => {
            const modal = document.getElementById('pending-request-modal');
            if (modal) {
                modal.style.opacity = '0';
                setTimeout(() => modal.remove(), 200);
            }
        };
        
        // Yopish tugmasi
        const closeBtn = document.getElementById('close-pending-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        
        // Tashqariga bosilganda yopish
        const modalOverlay = document.getElementById('pending-request-modal');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    closeModal();
                }
            });
        }
        
        // ESC tugmasi bilan yopish
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
    } catch (error) {
        logger.error('[PENDING_APPROVALS] Modal yuklash xatolik:', error);
        showToast('Ma\'lumotlarni yuklashda xatolik yuz berdi', 'error');
    }
}

// Kutilayotgan so'rov batafsil ma'lumotlarini render qilish
function renderPendingRequestDetails(data) {
    const request = data.request || data;
    
    // Ma'lumotlarni olish
    const requestUid = request.request_uid || request.uid || request.id || 'Noma\'lum';
    const requestType = request.type || 'NORMAL';
    const status = request.status || 'Noma\'lum';
    const brandName = request.brand_name || '-';
    const branchName = request.branch_name || '-';
    const svrName = request.svr_name || '-';
    const creatorUsername = request.created_by_username || request.creator_username || '-';
    const creatorFullname = request.created_by_fullname || request.creator_fullname || '-';
    const createdAt = request.created_at || '-';
    const updatedAt = request.updated_at || '-';
    
    // Sana formatlash
    const formatDate = (dateString) => {
        if (!dateString || dateString === '-') return '-';
        try {
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                return date.toLocaleString('uz-UZ', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        } catch (e) {
            return dateString;
        }
        return dateString;
    };
    
    // Status matni
    let statusText = status;
    let statusColor = '#f59e0b';
    if (status === 'SET_PENDING') {
        statusText = 'Rahbar kutilmoqda';
        statusColor = '#8b5cf6';
    } else if (status === 'APPROVED_BY_LEADER') {
        statusText = 'Kassir kutilmoqda';
        statusColor = '#06b6d4';
    } else if (status === 'APPROVED_BY_CASHIER') {
        statusText = 'Operator kutilmoqda';
        statusColor = '#3b82f6';
    } else if (status === 'APPROVED_BY_OPERATOR') {
        statusText = 'Nazoratchi kutilmoqda';
        statusColor = '#8b5cf6';
    } else if (status === 'PENDING_APPROVAL') {
        statusText = 'Tasdiqlash kutilmoqda';
        statusColor = '#f59e0b';
    }
    
    return `
        <div style="display: grid; gap: 16px;">
            <!-- So'rov ID va Status -->
            <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; padding: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div>
                        <div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">So'rov ID</div>
                        <div style="font-weight: 700; color: #22c55e; font-size: 16px; word-break: break-all;">${requestUid}</div>
                    </div>
                    <span style="padding: 6px 14px; background: ${statusColor}25; color: ${statusColor}; border-radius: 6px; font-size: 12px; font-weight: 600; border: 1px solid ${statusColor}40;">
                        ${statusText}
                    </span>
                </div>
                <div style="font-size: 12px; color: rgba(255,255,255,0.7);">
                    <strong>Turi:</strong> ${requestType === 'SET' ? '<span style="color: #8b5cf6;">🔴 SET</span>' : '<span style="color: #22c55e;">🟢 ODDIY</span>'}
                </div>
            </div>
            
            <!-- Asosiy ma'lumotlar -->
            <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px;">
                <h3 style="color: rgba(255,255,255,0.9); font-size: 14px; font-weight: 600; margin: 0 0 12px 0;">Asosiy Ma'lumotlar</h3>
                <div style="display: grid; gap: 12px;">
                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                        <strong style="color: rgba(255,255,255,0.7); min-width: 80px; font-size: 13px;">Brend:</strong>
                        <span style="color: rgba(255,255,255,0.9); font-size: 13px;">${brandName}</span>
                    </div>
                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                        <strong style="color: rgba(255,255,255,0.7); min-width: 80px; font-size: 13px;">Filial:</strong>
                        <span style="color: rgba(255,255,255,0.9); font-size: 13px;">${branchName}</span>
                    </div>
                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                        <strong style="color: rgba(255,255,255,0.7); min-width: 80px; font-size: 13px;">SVR:</strong>
                        <span style="color: rgba(255,255,255,0.9); font-size: 13px; word-break: break-word;">${svrName}</span>
                    </div>
                </div>
            </div>
            
            <!-- Yaratuvchi ma'lumotlari -->
            <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px;">
                <h3 style="color: rgba(255,255,255,0.9); font-size: 14px; font-weight: 600; margin: 0 0 12px 0;">Yaratuvchi</h3>
                <div style="display: grid; gap: 12px;">
                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                        <strong style="color: rgba(255,255,255,0.7); min-width: 100px; font-size: 13px;">To'liq ism:</strong>
                        <span style="color: rgba(255,255,255,0.9); font-size: 13px;">${creatorFullname}</span>
                    </div>
                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                        <strong style="color: rgba(255,255,255,0.7); min-width: 100px; font-size: 13px;">Username:</strong>
                        <span style="color: rgba(255,255,255,0.9); font-size: 13px;">${creatorUsername}</span>
                    </div>
                </div>
            </div>
            
            <!-- Sana va vaqt -->
            <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px;">
                <h3 style="color: rgba(255,255,255,0.9); font-size: 14px; font-weight: 600; margin: 0 0 12px 0;">Sana va Vaqt</h3>
                <div style="display: grid; gap: 12px;">
                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                        <strong style="color: rgba(255,255,255,0.7); min-width: 100px; font-size: 13px;">Yaratilgan:</strong>
                        <span style="color: rgba(255,255,255,0.9); font-size: 13px;">${formatDate(createdAt)}</span>
                    </div>
                    <div style="display: flex; align-items: flex-start; gap: 12px;">
                        <strong style="color: rgba(255,255,255,0.7); min-width: 100px; font-size: 13px;">Yangilangan:</strong>
                        <span style="color: rgba(255,255,255,0.9); font-size: 13px;">${formatDate(updatedAt)}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Global funksiyalar
window.toggleBotActivitySection = toggleBotActivitySection;
window.loadBotActivity = loadBotActivity;
window.loadPendingApprovals = loadPendingApprovals;
window.webApprove = webApprove;
window.showPendingRequestDetails = showPendingRequestDetails;

/**
 * Filiallar bo'yicha holat kartalarini yuklash
 */
async function loadBranchStatusCards() {
    logger.debug('[BRANCH_STATUS] loadBranchStatusCards() chaqirildi');
    
    const cardsContainer = document.getElementById('branch-status-cards');
    if (!cardsContainer) {
        logger.error('[BRANCH_STATUS] Kartalar konteyneri topilmadi!');
        return;
    }
    
    // Loading ko'rsatish
    cardsContainer.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
            <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                <div class="spinner-border spinner-border-sm" role="status" style="color: #3b82f6;">
                    <span class="sr-only">Yuklanmoqda...</span>
                </div>
                <span>Ma'lumotlar yuklanmoqda...</span>
            </div>
        </div>
    `;
    
    try {
        // Filterlarni olish
        const brandFilter = document.getElementById('branch-status-brand-filter');
        const statusFilter = document.getElementById('branch-status-status-filter');
        const searchInput = document.getElementById('branch-status-search');
        
        // Filter qiymatlarini olish va tozalash
        const brandId = brandFilter && brandFilter.value && brandFilter.value.trim() !== '' ? brandFilter.value.trim() : null;
        const statusValue = statusFilter && statusFilter.value && statusFilter.value.trim() !== '' ? statusFilter.value.trim() : null;
        const searchValue = searchInput && searchInput.value ? searchInput.value.trim() : null;
        
        // Agar hech qanday filter tanlanmagan bo'lsa, ma'lumotlar ko'rsatilmaydi
        if (!brandId && !statusValue && (!searchValue || searchValue.length === 0)) {
            cardsContainer.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                    <i data-feather="filter" style="width: 48px; height: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
                    <p>Ma'lumotlarni ko'rish uchun filter tanlang</p>
                    <p style="font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 8px;">Brend, Holat yoki Qidiruv maydonidan birini tanlang</p>
                </div>
            `;
            if (typeof feather !== 'undefined') feather.replace();
            return;
        }
        
        logger.debug('[BRANCH_STATUS] Filter qiymatlari:', { brandId, statusValue, searchValue });
        
        const params = new URLSearchParams();
        if (brandId) params.append('brandId', brandId);
        if (statusValue) params.append('status', statusValue);
        if (searchValue && searchValue.length > 0) params.append('searchTerm', searchValue);
        
        const response = await safeFetch(`${API_URL}/requests/branch-status?${params.toString()}`, {
            credentials: 'include'
        });
        
        if (!response || !response.ok) {
            throw new Error(`So'rov topilmadi: ${response?.status || 'No response'}`);
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data) {
            throw new Error(result.error || 'Ma\'lumotlar olinmadi');
        }
        
        let branchData = result.data;
        
        // Client-side filtering endi kerak emas, server tomonida bajariladi
        // Lekin fallback sifatida qoldiramiz
        // Status filter (server tomonida bajarildi, bu faqat fallback)
        // Search filter (server tomonida bajarildi, bu faqat fallback)
        
        if (branchData.length === 0) {
            cardsContainer.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                    <i data-feather="inbox" style="width: 48px; height: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
                    <p>Ma'lumotlar topilmadi</p>
                </div>
            `;
            if (typeof feather !== 'undefined') feather.replace();
            return;
        }
        
        // Statistikani hisoblash (filtrlangan ma'lumotlardan)
        let total = branchData.length;
        let completed = 0;
        let notSubmitted = 0;
        let inProgress = 0;
        
        branchData.forEach(branch => {
            if (branch.status === 'completed') {
                completed++;
            } else if (branch.status === 'no_request' || branch.status === 'no_svrs') {
                notSubmitted++;
            } else if (branch.status === 'in_progress') {
                inProgress++;
            }
        });
        
        // Statistikani yangilash
        const totalEl = document.getElementById('branch-status-total');
        const completedEl = document.getElementById('branch-status-completed');
        const notSubmittedEl = document.getElementById('branch-status-not-submitted');
        const inProgressEl = document.getElementById('branch-status-in-progress');
        
        if (totalEl) totalEl.textContent = total;
        if (completedEl) completedEl.textContent = completed;
        if (notSubmittedEl) notSubmittedEl.textContent = notSubmitted;
        if (inProgressEl) inProgressEl.textContent = inProgress;
        
        // Kartalarni yaratish
        cardsContainer.innerHTML = branchData.map(branch => {
            // Barcha filial kartalari uchun standart och ko'k rang
            const standardColor = '#3b82f6'; // Och ko'k
            const standardBgColor = 'rgba(59, 130, 246, 0.15)'; // Och ko'k background
            
            // Status matni va ikonini aniqlash (faqat ko'rsatish uchun, rang emas)
            let statusText = 'Topshirilmagan';
            let statusIcon = 'x-circle';
            
            if (branch.status === 'completed') {
                statusText = 'Topshirilgan';
                statusIcon = 'check-circle';
            } else if (branch.status === 'in_progress') {
                statusText = 'Jarayondagi';
                statusIcon = 'edit';
            } else if (branch.status === 'no_svrs') {
                statusText = 'SVR yo\'q';
                statusIcon = 'alert-circle';
            }
            
            // Brendlar ro'yxatini yaratish (agar bir nechta bo'lsa)
            const brandsText = branch.brands && branch.brands.length > 0 
                ? branch.brands.map(b => b.name).join(', ') 
                : '';
            
            // SVR'lar ro'yxatini yaratish
            const svrsList = branch.svrs.length > 0 ? branch.svrs.map(svr => {
                // SVR statusi bo'yicha ranglash
                let svrStatusColor = '#dc2626'; // no_request - qizil
                let svrStatusText = 'Topshirilmagan';
                let svrStatusIcon = 'x-circle';
                
                if (svr.status === 'approved') {
                    svrStatusColor = '#059669'; // approved - yashil
                    svrStatusText = 'Tasdiqlangan';
                    svrStatusIcon = 'check-circle';
                } else if (svr.status === 'pending') {
                    svrStatusColor = '#d97706'; // pending - sariq
                    svrStatusText = 'Kutilmoqda';
                    svrStatusIcon = 'clock';
                }
                
                // Foiz ko'rsatish
                const percentage = svr.approvalPercentage !== undefined ? svr.approvalPercentage : 0;
                const percentageColor = percentage > 0 ? svrStatusColor : 'rgba(255,255,255,0.4)'; // 0% bo'lsa kulrang
                const percentageText = `${percentage}%`;
                
                // Brend nomini ko'rsatish (agar bir nechta brend bo'lsa)
                const brandTag = svr.brandName && branch.brands && branch.brands.length > 1 
                    ? `<span style="font-size: 10px; color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px; margin-left: 6px;">${svr.brandName}</span>` 
                    : '';
                
                // SVR nomini qisqartirish (agar juda uzun bo'lsa)
                const maxNameLength = 25;
                const displayName = svr.name.length > maxNameLength 
                    ? svr.name.substring(0, maxNameLength) + '...' 
                    : svr.name;
                
                return `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 4px; border-left: 3px solid ${svrStatusColor};">
                        <span style="color: rgba(255,255,255,0.95); font-size: 12px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px;" title="${svr.name}">${displayName}${brandTag}</span>
                        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                            <span style="color: ${percentageColor}; font-size: 11px; font-weight: 700; min-width: 32px; text-align: right;">${percentageText}</span>
                            <i data-feather="${svrStatusIcon}" style="width: 12px; height: 12px; color: ${svrStatusColor};"></i>
                            <span style="color: ${svrStatusColor}; font-size: 11px; font-weight: 600; white-space: nowrap;">${svrStatusText}</span>
                        </div>
                    </div>
                `;
            }).join('') : '<div style="padding: 10px; text-align: center; color: rgba(255,255,255,0.5); font-size: 12px;">SVR\'lar topilmadi</div>';
            
            // Brendlar ko'rsatish (agar bir nechta bo'lsa)
            const brandsInfo = branch.brands && branch.brands.length > 1 
                ? `<div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px;">${brandsText}</div>` 
                : '';
            
            return `
                <div style="background: ${standardBgColor}; border: 2px solid ${standardColor}; border-radius: 12px; padding: 14px; transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;" 
                     onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 8px 24px ${standardColor}40'; this.style.borderColor='${standardColor}';" 
                     onmouseout="this.style.transform=''; this.style.boxShadow=''; this.style.borderColor='${standardColor}';">
                    <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px;">
                        <div style="flex: 1; min-width: 0;">
                            <h4 style="margin: 0; color: #ffffff; font-size: 15px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${branch.branch.name}</h4>
                            ${brandsInfo}
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; padding: 4px 10px; background: ${standardColor}20; border-radius: 6px; border: 1px solid ${standardColor}40; flex-shrink: 0; margin-left: 8px;">
                            <i data-feather="${statusIcon}" style="width: 16px; height: 16px; color: ${standardColor};"></i>
                            <span style="color: ${standardColor}; font-size: 12px; font-weight: 700; white-space: nowrap;">${statusText}</span>
                        </div>
                    </div>
                    
                    <!-- To'liq yakunlanish foiz darajasi -->
                    <div style="margin-bottom: 10px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;">
                            <span style="color: rgba(255,255,255,0.8); font-size: 11px; font-weight: 500;">To'liq yakunlanish:</span>
                            <span style="color: ${standardColor}; font-size: 13px; font-weight: 700; text-shadow: 0 0 8px ${standardColor}80;">${branch.completionPercentage}%</span>
                        </div>
                        <div style="width: 100%; height: 7px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
                            <div style="width: ${branch.completionPercentage}%; height: 100%; background: linear-gradient(90deg, ${standardColor}, ${standardColor}cc); box-shadow: 0 0 10px ${standardColor}60; transition: width 0.5s;"></div>
                        </div>
                    </div>
                    
                    <!-- SVR'lar ro'yxati -->
                    <div style="max-height: 180px; overflow-y: auto; overflow-x: hidden;">
                        ${svrsList}
                    </div>
                </div>
            `;
        }).join('');
        
        // Feather iconsni qayta render qilish
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        
        logger.debug('[BRANCH_STATUS] ✅ Kartalar muvaffaqiyatli yuklandi');
        
    } catch (error) {
        logger.error('[BRANCH_STATUS] ❌ Xatolik:', error);
        cardsContainer.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: #ef4444;">
                Xatolik: ${error.message || 'Ma\'lumotlar yuklanmadi'}
            </div>
        `;
    }
}

/**
 * Filiallar va tasdiqlovchilar jadvalini yuklash
 */
window.loadBranchApproversTable = async function loadBranchApproversTable() {
    logger.debug('[BRANCH_APPROVERS] loadBranchApproversTable() chaqirildi');
    
    const tableBody = document.getElementById('branch-approvers-table-body');
    if (!tableBody) {
        logger.error('[BRANCH_APPROVERS] Jadval body topilmadi!');
        return;
    }
    
    // Loading ko'rsatish
    tableBody.innerHTML = `
        <tr>
            <td colspan="7" style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                    <div class="spinner-border spinner-border-sm" role="status" style="color: #4facfe;">
                        <span class="sr-only">Yuklanmoqda...</span>
                    </div>
                    <span>Ma'lumotlar yuklanmoqda...</span>
                </div>
            </td>
        </tr>
    `;
    
    try {
        const brandFilter = document.getElementById('branch-stats-brand-filter');
        const brandId = brandFilter && brandFilter.value ? brandFilter.value : null;
        
        // Agar brand tanlanmagan bo'lsa, hech narsa ko'rsatmaymiz
        if (!brandId) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                        Brend tanlang
                    </td>
                </tr>
            `;
            return;
        }
        
        const params = new URLSearchParams();
        if (brandId) params.append('brandId', brandId);
        
        const response = await safeFetch(`${API_URL}/requests/branch-approvers-stats?${params.toString()}`, {
            credentials: 'include'
        });
        
        if (!response || !response.ok) {
            throw new Error(`So'rov topilmadi: ${response?.status || 'No response'}`);
        }
        
        const result = await response.json();
        
        logger.debug('[BRANCH_APPROVERS] API javob:', result);
        
        if (!result.success || !result.data) {
            throw new Error(result.error || 'Ma\'lumotlar olinmadi');
        }
        
        const branchStats = result.data;
        logger.debug('[BRANCH_APPROVERS] Branch stats ma\'lumotlari:', branchStats.length, 'ta qator');
        
        if (branchStats.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                        Ma'lumotlar topilmadi
                    </td>
                </tr>
            `;
            return;
        }
        
        // Jadvalni to'ldirish
        tableBody.innerHTML = branchStats.map((branch, index) => {
            const getRoleStatusText = (status) => {
                if (status === 'approved') {
                    return '<span style="color: #10b981; font-weight: 500;">Tasdiqlangan</span>';
                } else if (status === 'pending') {
                    return '<span style="color: #f59e0b; font-weight: 500;">Jarayondagi</span>';
                } else {
                    return '<span style="color: rgba(255,255,255,0.3);">So\'rov yuborilmagan</span>';
                }
            };
            
            return `
                <tr>
                    <td style="font-weight: 500;">${branch.branch_name || 'Noma\'lum'}</td>
                    <td style="font-size: 12px; color: rgba(255,255,255,0.7);">${branch.svr_name || 'SVR topilmadi'}</td>
                    <td style="text-align: center;">
                        ${getRoleStatusText(branch.roleStatuses?.manager || 'none')}
                    </td>
                    <td style="text-align: center;">
                        ${getRoleStatusText(branch.roleStatuses?.leader || 'none')}
                    </td>
                    <td style="text-align: center;">
                        ${getRoleStatusText(branch.roleStatuses?.cashier || 'none')}
                    </td>
                    <td style="text-align: center;">
                        ${getRoleStatusText(branch.roleStatuses?.operator || 'none')}
                    </td>
                    <td style="text-align: center;">
                        ${getRoleStatusText(branch.roleStatuses?.supervisor || 'none')}
                    </td>
                </tr>
            `;
        }).join('');
        
        // Feather iconsni qayta render qilish
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        
        logger.debug('[BRANCH_APPROVERS] ✅ Jadval muvaffaqiyatli to\'ldirildi');
        
    } catch (error) {
        logger.error('[BRANCH_APPROVERS] ❌ Xatolik:', error);
        logger.error('[BRANCH_APPROVERS] Xatolik tafsilotlari:', {
            message: error.message,
            stack: error.stack
        });
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="padding: 40px; text-align: center; color: #ef4444;">
                    Xatolik: ${error.message || 'Ma\'lumotlar yuklanmadi'}
                </td>
            </tr>
        `;
    }
}

/**
 * So'rov yaratish formasi sozlamalari
 */
function setupCreateRequestForm() {
    const form = document.getElementById('create-debt-request-form');
    const brandSelect = document.getElementById('create-request-brand');
    const branchSelect = document.getElementById('create-request-branch');
    const svrSelect = document.getElementById('create-request-svr');
    
    if (!form || !brandSelect) return;
    
    // So'rov turi tanlanganda Excel yuklash maydonini ko'rsatish/yashirish
    const typeSelect = document.getElementById('create-request-type');
    const excelUploadGroup = document.getElementById('excel-upload-group');
    const excelInput = document.getElementById('create-request-excel');
    const excelPreview = document.getElementById('excel-preview');
    
    // Excel input'ni enable/disable qilish funksiyasi
    const updateExcelInputState = () => {
        if (!excelInput || !excelUploadGroup) return;
        
        const type = typeSelect?.value;
        const brandId = brandSelect?.value;
        const branchId = branchSelect?.value;
        const svrId = svrSelect?.value;
        
        const isSetType = type === 'SET';
        const allFieldsFilled = brandId && branchId && svrId;
        
        // Xabar div'ni topish yoki yaratish
        let helpText = excelUploadGroup.querySelector('.excel-help-text');
        if (!helpText) {
            helpText = document.createElement('div');
            helpText.className = 'excel-help-text';
            helpText.style.cssText = 'margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.6);';
            excelInput.parentNode.insertBefore(helpText, excelInput.nextSibling);
        }
        
        if (isSetType && allFieldsFilled) {
            excelInput.disabled = false;
            excelInput.style.cursor = 'pointer';
            excelInput.style.opacity = '1';
            helpText.innerHTML = '✅ Barcha maydonlar to\'ldirildi. Excel fayl yuklashingiz mumkin.';
            helpText.style.color = 'rgba(34, 197, 94, 0.8)';
        } else if (isSetType) {
            excelInput.disabled = true;
            excelInput.style.cursor = 'not-allowed';
            excelInput.style.opacity = '0.5';
            const missingFields = [];
            if (!brandId) missingFields.push('Brend');
            if (!branchId) missingFields.push('Filial');
            if (!svrId) missingFields.push('SVR');
            helpText.innerHTML = `⚠️ Iltimos, avval quyidagi maydonlarni to'ldiring: ${missingFields.join(', ')}`;
            helpText.style.color = 'rgba(245, 158, 11, 0.8)';
        } else {
            excelInput.disabled = true;
            excelInput.style.cursor = 'not-allowed';
            excelInput.style.opacity = '0.5';
            if (helpText) helpText.innerHTML = '';
        }
    };
    
    if (typeSelect && excelUploadGroup) {
        typeSelect.addEventListener('change', () => {
            if (typeSelect.value === 'SET') {
                excelUploadGroup.style.display = 'block';
            } else {
                excelUploadGroup.style.display = 'none';
                excelInput.value = '';
                excelPreview.style.display = 'none';
                excelPreview.innerHTML = '';
                window.excelPreviewData = null;
            }
            updateExcelInputState();
            if (typeof feather !== 'undefined') feather.replace();
        });
    }
    
    // Excel fayl yuklanganda preview ko'rsatish
    if (excelInput) {
        excelInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const typeSelect = document.getElementById('create-request-type');
            const brandSelect = document.getElementById('create-request-brand');
            const branchSelect = document.getElementById('create-request-branch');
            const svrSelect = document.getElementById('create-request-svr');
            
            // Validatsiya
            if (typeSelect.value !== 'SET') {
                showCreateRequestMessage('Excel fayl faqat SET so\'rovlar uchun!', 'error');
                excelInput.value = '';
                return;
            }
            
            if (!brandSelect.value || !branchSelect.value || !svrSelect.value) {
                showCreateRequestMessage('Iltimos, avval Brend, Filial va SVR tanlang!', 'error');
                excelInput.value = '';
                return;
            }
            
            // Loading ko'rsatish
            excelPreview.style.display = 'block';
            excelPreview.innerHTML = '<div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.7);"><div class="spinner-border spinner-border-sm" style="color: #4facfe;"></div> Excel fayl yuklanmoqda va tekshirilmoqda...</div>';
            
            try {
                const formData = new FormData();
                formData.append('excel', file);
                formData.append('brand_id', brandSelect.value);
                formData.append('branch_id', branchSelect.value);
                formData.append('svr_id', svrSelect.value);
                
                const response = await safeFetch(`${API_URL}/requests/upload-excel`, {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                });
                
                if (response && response.ok) {
                    const data = await response.json();
                    logger.debug('[EXCEL_UPLOAD] Backend javob:', data);
                    
                    // Ma'lumotlarni saqlash
                    window.excelPreviewData = data;
                    
                    // Preview'ni ko'rsatish
                    showExcelPreview(data);
                    
                    // Preview ko'rsatilganini tekshirish
                    setTimeout(() => {
                        const checkPreview = document.getElementById('excel-preview');
                        if (checkPreview && checkPreview.style.display !== 'none' && checkPreview.innerHTML.trim() !== '') {
                            logger.debug('[EXCEL_UPLOAD] ✅ Preview muvaffaqiyatli ko\'rsatildi');
                        } else {
                            logger.warn('[EXCEL_UPLOAD] ⚠️ Preview ko\'rsatilmadi, qayta tiklanmoqda...');
                            if (window.excelPreviewData) {
                                showExcelPreview(window.excelPreviewData);
                            }
                        }
                    }, 200);
                    
                    // Ma'lumotlar sonini ko'rsatish
                    const matchedCount = data.totalRows || 0;
                    const totalCount = data.data ? data.data.length : 0;
                    if (matchedCount > 0) {
                        showCreateRequestMessage(
                            `✅ Excel fayl muvaffaqiyatli yuklandi!<br>` +
                            `📊 Mos kelgan qatorlar: <strong>${matchedCount}</strong> ta<br>` +
                            `💰 Jami summa: <strong>${(data.total || 0).toLocaleString('ru-RU')}</strong> so'm`,
                            'success'
                        );
                    } else {
                        showCreateRequestMessage(
                            `⚠️ Excel faylda mos ma'lumotlar topilmadi!<br>` +
                            `Iltimos, faylda ID, Name va Summa ustunlarini tekshiring.`,
                            'error'
                        );
                    }
                } else {
                    const errorData = await response.json().catch(() => ({ error: 'Noma\'lum xatolik' }));
                    excelPreview.innerHTML = `<div style="padding: 15px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; color: #ef4444;">❌ ${errorData.error || 'Excel faylni yuklashda xatolik'}</div>`;
                    showCreateRequestMessage(`❌ ${errorData.error || 'Excel faylni yuklashda xatolik'}`, 'error');
                }
            } catch (error) {
                logger.error('[EXCEL_UPLOAD] Xatolik:', error);
                excelPreview.innerHTML = `<div style="padding: 15px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; color: #ef4444;">❌ ${error.message || 'Excel faylni yuklashda xatolik'}</div>`;
                showCreateRequestMessage(`❌ ${error.message || 'Excel faylni yuklashda xatolik'}`, 'error');
            }
        });
    }
    
    // Brend tanlanganda filiallarni yuklash
    brandSelect.addEventListener('change', async () => {
        const brandId = brandSelect.value;
        logger.debug('[CREATE_REQUEST] Brend tanlandi:', brandId);
        
        branchSelect.innerHTML = '<option value="">Tanlang...</option>';
        svrSelect.innerHTML = '<option value="">Tanlang...</option>';
        
        // Excel input holatini yangilash
        updateExcelInputState();
        
        if (!brandId) {
            logger.debug('[CREATE_REQUEST] Brend tanlanmagan, filiallar yuklanmaydi');
            return;
        }
        
        try {
            const url = `${API_URL}/brands/branches?brand_id=${brandId}`;
            logger.debug('[CREATE_REQUEST] Filiallarni yuklash uchun so\'rov yuborilmoqda:', url);
            
            const response = await safeFetch(url, { credentials: 'include' });
            
            if (!response) {
                logger.error('[CREATE_REQUEST] ❌ Filiallar API javob null qaytdi (ehtimol redirect qilindi)');
                return;
            }
            
            if (response.ok) {
                const branches = await response.json();
                logger.debug('[CREATE_REQUEST] ✅ Filiallar yuklandi:', branches.length, 'ta');
                branchSelect.innerHTML = '<option value="" style="background: rgba(30,30,30,0.95); color: rgba(255,255,255,0.7);">Tanlang...</option>' + 
                    branches.map(branch => `<option value="${branch.id}" style="background: rgba(30,30,30,0.95); color: #ffffff;">${branch.name}</option>`).join('');
            } else {
                logger.error('[CREATE_REQUEST] ❌ Filiallar API xatolik:', response.status, response.statusText);
            }
        } catch (error) {
            logger.error('[CREATE_REQUEST] ❌ Filiallarni yuklashda xatolik:', error);
        }
    });
    
    // Filial tanlanganda SVR'larni yuklash
    branchSelect.addEventListener('change', async () => {
        const brandId = brandSelect.value;
        const branchId = branchSelect.value;
        logger.debug('[CREATE_REQUEST] Filial tanlandi:', { brandId, branchId });
        
        svrSelect.innerHTML = '<option value="">Tanlang...</option>';
        
        // Excel input holatini yangilash
        updateExcelInputState();
        
        if (!brandId || !branchId) {
            logger.debug('[CREATE_REQUEST] Brend yoki filial tanlanmagan, SVR\'lar yuklanmaydi');
            return;
        }
        
        try {
            const url = `${API_URL}/brands/svrs?brand_id=${brandId}&branch_id=${branchId}`;
            logger.debug('[CREATE_REQUEST] SVR\'larni yuklash uchun so\'rov yuborilmoqda:', url);
            
            const response = await safeFetch(url, { credentials: 'include' });
            
            if (!response) {
                logger.error('[CREATE_REQUEST] ❌ SVR\'lar API javob null qaytdi (ehtimol redirect qilindi)');
                return;
            }
            
            if (response.ok) {
                const svrs = await response.json();
                logger.debug('[CREATE_REQUEST] ✅ SVR\'lar yuklandi:', svrs.length, 'ta');
                svrSelect.innerHTML = '<option value="" style="background: rgba(30,30,30,0.95); color: rgba(255,255,255,0.7);">Tanlang...</option>' + 
                    svrs.map(svr => `<option value="${svr.id}" style="background: rgba(30,30,30,0.95); color: #ffffff;">${svr.name}</option>`).join('');
            } else {
                logger.error('[CREATE_REQUEST] ❌ SVR\'lar API xatolik:', response.status, response.statusText);
            }
        } catch (error) {
            logger.error('[CREATE_REQUEST] ❌ SVR\'larni yuklashda xatolik:', error);
        }
        
        // Excel input holatini yangilash
        updateExcelInputState();
    });
    
    // SVR tanlanganda Excel input holatini yangilash
    svrSelect.addEventListener('change', () => {
        updateExcelInputState();
    });
    
    // Umumiy ma'lumotlar bo'limining holatini localStorage'dan yuklash
    const generalInfoContent = document.getElementById('general-info-content');
    const generalInfoChevron = document.getElementById('general-info-chevron');
    if (generalInfoContent && generalInfoChevron) {
        const savedState = localStorage.getItem('generalInfoExpanded');
        // Agar saqlangan holat bo'lmasa, default holat: ochiq (true)
        const isExpanded = savedState === null ? true : savedState === 'true';
        generalInfoContent.style.display = isExpanded ? 'grid' : 'none';
        generalInfoChevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        if (typeof feather !== 'undefined') feather.replace();
    }
    
    // Formani yuborish
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await createDebtRequest();
    });
}

/**
 * Excel preview ko'rsatish
 */
function showExcelPreview(data) {
    const excelPreview = document.getElementById('excel-preview');
    if (!excelPreview) {
        logger.warn('[EXCEL_PREVIEW] excel-preview element topilmadi');
        return;
    }
    
    logger.debug('[EXCEL_PREVIEW] showExcelPreview chaqirildi');
    
    // Preview session ID yaratish - eski tekshirishlarni bekor qilish uchun
    const previewSessionId = Date.now();
    window.currentPreviewSessionId = previewSessionId;
    
    // Ma'lumotlarni tekshirish
    if (!data || !data.headers || !Array.isArray(data.headers)) {
        logger.error('[EXCEL_PREVIEW] Ma\'lumotlar noto\'g\'ri formatda');
        excelPreview.innerHTML = '<div style="padding: 15px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; color: #ef4444;">❌ Excel ma\'lumotlari noto\'g\'ri formatda</div>';
        return;
    }
    
    // Faqat 3 ta ustun: ID, Name, Summa
    // Backend'dan `detectedColumns` yoki `columns` nomi bilan keladi
    const columns = data.detectedColumns || data.columns || {};
    const idIndex = columns.id !== null && columns.id !== undefined ? columns.id : null;
    const nameIndex = columns.name !== null && columns.name !== undefined ? columns.name : null;
    const summaIndex = columns.summa !== null && columns.summa !== undefined ? columns.summa : null;
    
    const idColumn = idIndex !== null && data.headers[idIndex] ? data.headers[idIndex] : null;
    const nameColumn = nameIndex !== null && data.headers[nameIndex] ? data.headers[nameIndex] : null;
    const summaColumn = summaIndex !== null && data.headers[summaIndex] ? data.headers[summaIndex] : null;
    
    if (!idColumn || !nameColumn || !summaColumn) {
        excelPreview.innerHTML = '<div style="padding: 15px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; color: #ef4444;">❌ Excel faylda ID, Name yoki Summa ustunlari topilmadi</div>';
        return;
    }
    
    // Qatorlar sonini localStorage'dan olish yoki default 10
    const savedRows = localStorage.getItem('excelPreviewRows') || '10';
    let maxRows = parseInt(savedRows);
    if (isNaN(maxRows) || maxRows < 1) maxRows = 10;
    if (maxRows === -1) maxRows = data.data.length; // -1 = Barchasi
    
    const previewRows = maxRows === -1 ? data.data : data.data.slice(0, maxRows);
    const totalRows = data.totalRows || 0;
    const total = data.total || 0;
    
    logger.debug('[EXCEL_PREVIEW] Preview ma\'lumotlari:', { totalRows, total, maxRows, previewRowsCount: previewRows.length });
    
    let previewHTML = `
        <div style="padding: 15px; background: rgba(79,172,254,0.1); border: 1px solid rgba(79,172,254,0.3); border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
                <h4 style="margin: 0; color: #4facfe; font-size: 16px;">
                    <i data-feather="file-text" style="width: 18px; height: 18px; margin-right: 6px;"></i>
                    Excel Preview
                </h4>
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <span style="color: rgba(255,255,255,0.7); font-size: 13px;">
                        ${totalRows} qator, Jami: ${total.toLocaleString('ru-RU')} so'm
                    </span>
                    <select id="excel-preview-rows-select" style="padding: 6px 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #ffffff; font-size: 12px; cursor: pointer;" onchange="changeExcelPreviewRows(this.value)">
                        <option value="5" ${savedRows === '5' ? 'selected' : ''} style="background: rgba(30,30,30,0.95); color: #ffffff;">5 qator</option>
                        <option value="10" ${savedRows === '10' ? 'selected' : ''} style="background: rgba(30,30,30,0.95); color: #ffffff;">10 qator</option>
                        <option value="20" ${savedRows === '20' ? 'selected' : ''} style="background: rgba(30,30,30,0.95); color: #ffffff;">20 qator</option>
                        <option value="50" ${savedRows === '50' ? 'selected' : ''} style="background: rgba(30,30,30,0.95); color: #ffffff;">50 qator</option>
                        <option value="100" ${savedRows === '100' ? 'selected' : ''} style="background: rgba(30,30,30,0.95); color: #ffffff;">100 qator</option>
                        <option value="-1" ${savedRows === '-1' ? 'selected' : ''} style="background: rgba(30,30,30,0.95); color: #ffffff;">Barchasi</option>
                    </select>
                </div>
            </div>
            <div style="overflow-x: auto; max-height: 400px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="background: rgba(79,172,254,0.2); border-bottom: 2px solid rgba(79,172,254,0.4);">
                            <th style="padding: 8px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600; border-right: 1px solid rgba(255,255,255,0.1);">${idColumn}</th>
                            <th style="padding: 8px; text-align: left; color: rgba(255,255,255,0.9); font-weight: 600; border-right: 1px solid rgba(255,255,255,0.1);">${nameColumn}</th>
                            <th style="padding: 8px; text-align: right; color: rgba(255,255,255,0.9); font-weight: 600;">${summaColumn}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${previewRows.map(row => {
                            const idValue = row[idColumn] || '';
                            const nameValue = row[nameColumn] || '';
                            const summaValue = row[summaColumn] || '';
                            const summaNum = parseFloat(summaValue) || 0;
                            return `
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <td style="padding: 6px 8px; color: rgba(255,255,255,0.8); border-right: 1px solid rgba(255,255,255,0.05);">${idValue}</td>
                                <td style="padding: 6px 8px; color: rgba(255,255,255,0.8); border-right: 1px solid rgba(255,255,255,0.05);">${nameValue}</td>
                                <td style="padding: 6px 8px; color: rgba(255,255,255,0.8); text-align: right;">${summaNum.toLocaleString('ru-RU')}</td>
                            </tr>
                        `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            ${totalRows > maxRows && maxRows !== -1 ? `<div style="margin-top: 10px; text-align: center; color: rgba(255,255,255,0.6); font-size: 12px;">... va yana ${totalRows - maxRows} qator</div>` : ''}
        </div>
    `;
    
    // Preview'ni ko'rsatishdan oldin tekshirish
    logger.debug('[EXCEL_PREVIEW] Preview HTML yaratilmoqda');
    
    // Preview'ni tozalashdan himoya qilish - MutationObserver qo'shish
    if (!window.excelPreviewObserver) {
        window.excelPreviewObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.target.id === 'excel-preview') {
                    const currentContent = mutation.target.innerHTML.trim();
                    // Agar preview tozalanayotgan bo'lsa va ma'lumotlar saqlangan bo'lsa, qayta tiklash
                    // Lekin infinite loop oldini olish uchun vaqt tekshiruvi
                    const now = Date.now();
                    if (!window.excelPreviewLastMutationRestore) {
                        window.excelPreviewLastMutationRestore = 0;
                    }
                    const timeSinceLastRestore = now - window.excelPreviewLastMutationRestore;
                    
                    if (currentContent === '' && window.excelPreviewData && mutation.removedNodes.length > 0) {
                        // Faqat 1 soniyadan keyin qayta tiklashga ruxsat berish (infinite loop oldini olish)
                        if (timeSinceLastRestore > 1000) {
                            window.excelPreviewLastMutationRestore = now;
                        logger.warn('[EXCEL_PREVIEW] ⚠️ Preview tozalanayotgani aniqlandi! Qayta tiklanmoqda...');
                        setTimeout(() => {
                                if (window.excelPreviewData && document.getElementById('excel-preview')?.innerHTML.trim() === '') {
                                showExcelPreview(window.excelPreviewData);
                            }
                            }, 100);
                        }
                    }
                }
            });
        });
        
        // Observer'ni ishga tushirish
        if (excelPreview) {
            window.excelPreviewObserver.observe(excelPreview, {
                childList: true,
                subtree: true
            });
            logger.debug('[EXCEL_PREVIEW] MutationObserver qo\'shildi, preview himoya qilindi');
        }
    }
    
    excelPreview.style.display = 'block';
    excelPreview.innerHTML = previewHTML;
    logger.debug('[EXCEL_PREVIEW] Preview HTML yaratildi va ko\'rsatildi, total:', total, 'so\'m');
    
    if (typeof feather !== 'undefined') feather.replace();
    
    // Preview ko'rsatilganini tekshirish - faqat tasdiqlash uchun, qayta tiklash yo'q
    // Infinite loop oldini olish uchun session-based check va retry flag
    if (!window.excelPreviewLastRender) {
        window.excelPreviewLastRender = 0;
    }
    
    const now = Date.now();
    const timeSinceLastRender = now - window.excelPreviewLastRender;
    window.excelPreviewLastRender = now;
    
    // Agar 500ms ichida qayta render qilinsa, bu infinite loop bo'lishi mumkin
    if (timeSinceLastRender < 500) {
        logger.warn('[EXCEL_PREVIEW] ⚠️ Tez qayta render qilinmoqda, infinite loop oldini olish...');
        return; // Infinite loop oldini olish
    }
    
    // Faqat bir marta tekshirish - preview mavjudligini tasdiqlash (faqat debug uchun)
    setTimeout(() => {
        // Eski session tekshirishlarini bekor qilish
        if (window.currentPreviewSessionId !== previewSessionId) {
            return; // Bu eski session, bekor qilish
        }
        
        const checkElement = document.getElementById('excel-preview');
        if (checkElement && checkElement.style.display !== 'none' && checkElement.innerHTML.trim() !== '') {
            // Total qiymatni qidirish - faqat tasdiqlash uchun
            const formattedTotal = total.toLocaleString('ru-RU');
            const totalWithoutSpaces = formattedTotal.replace(/\s/g, '');
            const htmlContent = checkElement.innerHTML;
            
            // Turli formatlarda qidirish
            // 1. To'liq format: "Jami: -89 944 100 so'm"
            // 2. Bo'shliqsiz: "Jami: -89944100 so'm"
            // 3. Faqat raqam qismi
            const jamiPatterns = [
                new RegExp(`Jami:\\s*${formattedTotal.replace(/[-\d\s]/g, (m) => m === '-' ? '-' : '\\d').replace(/\s/g, '\\s*')}\\s*so['']m`, 'i'),
                new RegExp(`Jami:\\s*${totalWithoutSpaces.replace(/[-\d]/g, (m) => m === '-' ? '-' : '\\d')}\\s*so['']m`, 'i'),
                new RegExp(`Jami:[^<]*${totalWithoutSpaces}`, 'i')
            ];
            
            let hasTotal = htmlContent.includes(formattedTotal) || 
                          htmlContent.includes(totalWithoutSpaces) ||
                          jamiPatterns.some(pattern => pattern.test(htmlContent));
            
            // Agar hali topilmasa, "Jami:" so'zidan keyin keladigan raqamni qidirish
            if (!hasTotal) {
                const jamiMatch = htmlContent.match(/Jami:\s*([-\d\s,]+)/i);
                if (jamiMatch) {
                    const matchedValue = jamiMatch[1].replace(/[\s,]/g, '');
                    hasTotal = matchedValue === totalWithoutSpaces || 
                              matchedValue === String(total).replace(/\s/g, '');
            }
        }
            
            // Faqat muvaffaqiyatli holatda log qilish (warning'lar keraksiz, chunki umumiy qiymat HTML'da mavjud)
            if (hasTotal) {
                // Log faqat development uchun, production'da o'chirish mumkin
                // console.log('[EXCEL_PREVIEW] ✅ Preview mavjud va umumiy qiymat tasdiqlandi:', formattedTotal, 'so\'m');
            }
            // Warning'ni o'chirish - umumiy qiymat HTML'da mavjud va ko'rsatilmoqda
        }
    }, 200);
}

/**
 * Excel preview qatorlar sonini o'zgartirish
 */
window.changeExcelPreviewRows = function changeExcelPreviewRows(value) {
    localStorage.setItem('excelPreviewRows', value);
    if (window.excelPreviewData) {
        showExcelPreview(window.excelPreviewData);
    }
};

/**
 * Umumiy ma'lumotlar bo'limini yig'ish/yoyish
 */
window.toggleGeneralInfo = function toggleGeneralInfo() {
    const content = document.getElementById('general-info-content');
    const chevron = document.getElementById('general-info-chevron');
    if (!content || !chevron) return;
    
    const isVisible = content.style.display !== 'none';
    content.style.display = isVisible ? 'none' : 'grid';
    chevron.style.transform = isVisible ? 'rotate(-90deg)' : 'rotate(0deg)';
    
    // Holatni localStorage'da saqlash
    localStorage.setItem('generalInfoExpanded', !isVisible);
    
    if (typeof feather !== 'undefined') feather.replace();
};

/**
 * So'rov yaratish
 */
window.createDebtRequest = async function createDebtRequest() {
    const typeSelect = document.getElementById('create-request-type');
    const brandSelect = document.getElementById('create-request-brand');
    const branchSelect = document.getElementById('create-request-branch');
    const svrSelect = document.getElementById('create-request-svr');
    const extraInfoTextarea = document.getElementById('create-request-extra-info');
    const messageDiv = document.getElementById('create-request-message');
    
    if (!typeSelect || !brandSelect) return;
    
    const type = typeSelect.value;
    const brandId = brandSelect.value;
    const branchId = branchSelect.value || null;
    const svrId = svrSelect.value || null;
    const extraInfo = extraInfoTextarea.value.trim() || null;
    
    // Validatsiya
    if (!type || !brandId) {
        showCreateRequestMessage('Iltimos, barcha majburiy maydonlarni to\'ldiring!', 'error');
        return;
    }
    
    // Loading ko'rsatish
    const submitBtn = document.querySelector('#create-debt-request-form button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-feather="loader" style="width: 16px; height: 16px; animation: spin 1s linear infinite;"></i> Yaratilmoqda...';
    if (typeof feather !== 'undefined') feather.replace();
    
    try {
        // FormData yaratish (fayl yuklash uchun)
        const formData = new FormData();
        formData.append('type', type);
        formData.append('brand_id', brandId);
        if (branchId) formData.append('branch_id', branchId);
        if (svrId) formData.append('svr_id', svrId);
        if (extraInfo) formData.append('extra_info', extraInfo);
        
        // Excel faylni qo'shish (agar mavjud bo'lsa)
        // Eslatma: Excel ma'lumotlarini FormData'ga qo'shmaslik kerak, chunki juda katta bo'lishi mumkin
        // Backend'da fayl qayta parse qilinadi
        if (type === 'SET') {
            const excelFileInput = document.getElementById('create-request-excel');
            if (excelFileInput && excelFileInput.files[0]) {
                formData.append('excel', excelFileInput.files[0]);
            }
        }
        
        logger.debug('[CREATE_REQUEST] So\'rov yuborilmoqda:', { type, brandId, branchId, svrId, hasExcel: !!window.excelPreviewData });
        
        const response = await safeFetch(`${API_URL}/requests/`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        
        if (response && response.ok) {
            const data = await response.json();
            logger.debug('[CREATE_REQUEST] ✅ So\'rov yaratildi:', data);
            showCreateRequestMessage(
                `✅ So\'rov muvaffaqiyatli yaratildi!<br><strong>So\'rov ID:</strong> ${data.request_uid}`,
                'success'
            );
            
            // Formani tozalash
            resetCreateRequestForm();
            window.excelPreviewData = null;
            
            // Jadvalni yangilash
            if (typeof loadDebtRequests === 'function') {
                loadDebtRequests(1);
            }
        } else {
            logger.error('[CREATE_REQUEST] ❌ API javob noto\'g\'ri:', response);
            const errorData = response ? await response.json().catch(() => ({ error: 'Noma\'lum xatolik' })) : { error: 'API javob null' };
            logger.error('[CREATE_REQUEST] Xatolik ma\'lumotlari:', errorData);
            
            // Dublikat so'rov xatolik xabari
            if (errorData.error && errorData.error.includes('jarayondagi so\'rov mavjud')) {
                showCreateRequestMessage(
                    `⚠️ <strong>Bu SVR uchun jarayondagi so'rov mavjud!</strong><br>` +
                    `So'rov ID: <code>${errorData.existing_request?.request_uid || 'N/A'}</code><br>` +
                    `Status: <strong>${errorData.existing_request?.status || 'N/A'}</strong><br><br>` +
                    `Jarayon tugaguncha yangi so'rov yaratib bo'lmaydi.`,
                    'error'
                );
            } else {
                showCreateRequestMessage(`❌ Xatolik: ${errorData.error || 'So\'rov yaratilmadi'}`, 'error');
            }
        }
    } catch (error) {
        logger.error('[CREATE_REQUEST] ❌ Xatolik:', error);
        showCreateRequestMessage(`❌ Xatolik: ${error.message || 'So\'rov yaratilmadi'}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        if (typeof feather !== 'undefined') feather.replace();
    }
};

/**
 * So'rov yaratish formasi xabarlarini ko'rsatish
 */
function showCreateRequestMessage(message, type = 'info') {
    const messageDiv = document.getElementById('create-request-message');
    if (!messageDiv) {
        logger.warn('[CREATE_REQUEST_MESSAGE] create-request-message element topilmadi');
        return;
    }
    
    // Excel preview'ni tekshirish va saqlab qolish
    const excelPreview = document.getElementById('excel-preview');
    const previewExists = excelPreview && excelPreview.style.display !== 'none' && excelPreview.innerHTML.trim() !== '';
    logger.debug('[CREATE_REQUEST_MESSAGE] Xabar ko\'rsatilmoqda, Excel preview mavjud:', previewExists);
    
    const bgColor = type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 
                   type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 
                   'rgba(79, 172, 254, 0.1)';
    const borderColor = type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 
                       type === 'error' ? 'rgba(239, 68, 68, 0.3)' : 
                       'rgba(79, 172, 254, 0.3)';
    const textColor = type === 'success' ? '#22c55e' : 
                     type === 'error' ? '#ef4444' : 
                     '#4facfe';
    
    messageDiv.style.display = 'block';
    messageDiv.innerHTML = `
        <div style="padding: 12px 16px; background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 8px; color: ${textColor};">
            ${message}
        </div>
    `;
    
    // Excel preview'ni tekshirish va qayta tiklash (agar yo'qolgan bo'lsa)
    // Faqat bir marta tekshirish va infinite loop oldini olish
    if (previewExists && window.excelPreviewData) {
        if (!window.previewCheckCount) {
            window.previewCheckCount = 0;
        }
        window.previewCheckCount++;
        
        // Faqat birinchi 2 marta tekshirish
        if (window.previewCheckCount <= 2) {
        setTimeout(() => {
            const checkPreview = document.getElementById('excel-preview');
            if (!checkPreview || checkPreview.innerHTML.trim() === '' || checkPreview.style.display === 'none') {
                    // Faqat bir marta qayta tiklash
                    if (window.previewCheckCount === 1 && window.excelPreviewData) {
                logger.warn('[CREATE_REQUEST_MESSAGE] ⚠️ Excel preview yo\'qolib qoldi, qayta tiklanmoqda...');
                    showExcelPreview(window.excelPreviewData);
                }
                } else {
                    // Preview mavjud, counter'ni reset qilish
                    window.previewCheckCount = 0;
            }
            }, 200);
        }
    }
    
    // 5 soniyadan keyin yashirish (success holatida)
    if (type === 'success') {
        setTimeout(() => {
            messageDiv.style.display = 'none';
            // Xabar yashirilganda ham Excel preview'ni tekshirish
            if (window.excelPreviewData) {
                const checkPreview = document.getElementById('excel-preview');
                if (!checkPreview || checkPreview.innerHTML.trim() === '' || checkPreview.style.display === 'none') {
                    logger.warn('[CREATE_REQUEST_MESSAGE] ⚠️ Xabar yashirilgandan keyin Excel preview yo\'qolib qoldi, qayta tiklanmoqda...');
                    showExcelPreview(window.excelPreviewData);
                }
            }
        }, 5000);
    }
}

/**
 * So'rov yaratish formasi tozalash
 */
window.resetCreateRequestForm = function resetCreateRequestForm() {
    // Excel preview'ni tozalash
    const excelPreview = document.getElementById('excel-preview');
    if (excelPreview) {
        excelPreview.style.display = 'none';
        excelPreview.innerHTML = '';
    }
    const excelInput = document.getElementById('create-request-excel');
    if (excelInput) {
        excelInput.value = '';
    }
    window.excelPreviewData = null;
    const form = document.getElementById('create-debt-request-form');
    if (form) {
        form.reset();
        document.getElementById('create-request-branch').innerHTML = '<option value="">Tanlang...</option>';
        document.getElementById('create-request-svr').innerHTML = '<option value="">Tanlang...</option>';
        document.getElementById('create-request-message').style.display = 'none';
    }
};

// Debt approval oy tanlash funksiyasi
function setupDebtMonthSelector(initialYear, initialMonth, loadStatsCallback) {
    const monthDisplayBtn = document.getElementById('debt-month-display-btn');
    const monthDropdown = document.getElementById('debt-month-dropdown');
    const prevMonthBtn = document.getElementById('debt-prev-month-btn');
    const nextMonthBtn = document.getElementById('debt-next-month-btn');
    const prevYearBtn = document.getElementById('debt-prev-year-btn');
    const nextYearBtn = document.getElementById('debt-next-year-btn');
    const monthsGrid = document.getElementById('debt-months-grid');
    const currentMonthText = document.getElementById('debt-current-month-text');
    const dropdownYear = document.getElementById('debt-dropdown-year');
    
    if (!monthDisplayBtn || !monthDropdown) {
        return;
    }
    
    const months = [
        'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    
    let currentYear = parseInt(initialYear);
    let currentMonth = parseInt(initialMonth) - 1;
    
    // Dropdown ni ko'rsatish/yashirish
    monthDisplayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const isHidden = monthDropdown.classList.contains('hidden');
        if (isHidden) {
            monthDropdown.classList.remove('hidden');
            monthDropdown.style.display = 'block';
            renderMonthsGrid();
            if (typeof feather !== 'undefined') {
                feather.replace();
            }
        } else {
            monthDropdown.classList.add('hidden');
            monthDropdown.style.display = 'none';
        }
    });
    
    // Tashqariga bosilganda yopish
    let clickOutsideHandler = (e) => {
        if (!monthDropdown.contains(e.target) && !monthDisplayBtn.contains(e.target)) {
            monthDropdown.classList.add('hidden');
            monthDropdown.style.display = 'none';
        }
    };
    document.addEventListener('click', clickOutsideHandler);
    
    // Oldingi oy
    prevMonthBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentMonth--;
        if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
        }
        // Navigatsiya orqali o'zgarganda dropdown yopilmaydi, faqat oy ko'rsatkichlari yangilanadi
        const monthStr = (currentMonth + 1).toString().padStart(2, '0');
        currentMonthText.textContent = `${months[currentMonth]} ${currentYear}`;
        dropdownYear.textContent = currentYear;
        renderMonthsGrid();
        // Statistika yangilash
        if (loadStatsCallback) {
            loadStatsCallback(currentYear, monthStr).then(newStats => {
                if (newStats) {
                    updateStatsDisplay(newStats);
                    renderDebtCharts(newStats);
                }
            });
        }
    });
    
    // Keyingi oy
    nextMonthBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentMonth++;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
        }
        // Navigatsiya orqali o'zgarganda dropdown yopilmaydi, faqat oy ko'rsatkichlari yangilanadi
        const monthStr = (currentMonth + 1).toString().padStart(2, '0');
        currentMonthText.textContent = `${months[currentMonth]} ${currentYear}`;
        dropdownYear.textContent = currentYear;
        renderMonthsGrid();
        // Statistika yangilash
        if (loadStatsCallback) {
            loadStatsCallback(currentYear, monthStr).then(newStats => {
                if (newStats) {
                    updateStatsDisplay(newStats);
                    renderDebtCharts(newStats);
                }
            });
        }
    });
    
    // Oldingi yil
    prevYearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentYear--;
        dropdownYear.textContent = currentYear;
        renderMonthsGrid();
    });
    
    // Keyingi yil
    nextYearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentYear++;
        dropdownYear.textContent = currentYear;
        renderMonthsGrid();
    });
    
    // Oylar gridini render qilish
    function renderMonthsGrid() {
        const monthStr = (currentMonth + 1).toString().padStart(2, '0');
        monthsGrid.innerHTML = months.map((monthName, index) => {
            const isSelected = currentYear === parseInt(initialYear) && index === currentMonth;
            return `
                <div class="month-item ${isSelected ? 'selected' : ''}" data-month="${index}">
                    ${monthName}
                </div>
            `;
        }).join('');
        
        // Oy tanlash
        monthsGrid.querySelectorAll('.month-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                currentMonth = parseInt(item.dataset.month);
                // Dropdown yopish - ikkala usul bilan
                monthDropdown.classList.add('hidden');
                monthDropdown.style.display = 'none';
                // Oy yangilash
                updateSelectedMonth();
            });
        });
    }
    
    // Tanlangan oyni yangilash (faqat oy tanlanganda)
    async function updateSelectedMonth() {
        const monthStr = (currentMonth + 1).toString().padStart(2, '0');
        currentMonthText.textContent = `${months[currentMonth]} ${currentYear}`;
        dropdownYear.textContent = currentYear;
        
        // Statistika yangilash
        if (loadStatsCallback) {
            const newStats = await loadStatsCallback(currentYear, monthStr);
            if (newStats) {
                updateStatsDisplay(newStats);
                renderDebtCharts(newStats);
            }
        }
        
        renderMonthsGrid();
    }
    
    // Dastlabki render - dropdown yopilgan holatda
    monthDropdown.classList.add('hidden');
    monthDropdown.style.display = 'none';
    renderMonthsGrid();
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
}

// Show import modal
function showImportModal() {
    log('showImportModal() chaqirildi');
    // Create modal if not exists
    let modal = document.getElementById('debt-import-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'debt-import-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 700px; max-height: 90vh; overflow-y: auto;">
                <button class="close-modal-btn" id="close-debt-import-modal">
                    <i data-feather="x"></i>
                </button>
                
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px;">
                    <div style="width: 50px; height: 50px; background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                        <i data-feather="upload-cloud" style="width: 28px; height: 28px; color: white;"></i>
                    </div>
                    <div>
                        <h3 style="margin: 0; font-size: 24px; font-weight: 700; color: white;">Excel Import</h3>
                        <p style="margin: 5px 0 0 0; font-size: 14px; color: rgba(255,255,255,0.6);">Ma'lumotlarni Excel fayldan import qiling</p>
                    </div>
                </div>
                
                <!-- Shablon yuklab olish -->
                <div style="background: linear-gradient(135deg, rgba(79, 172, 254, 0.15) 0%, rgba(0, 242, 254, 0.15) 100%); padding: 20px; border-radius: 12px; margin-bottom: 25px; border: 1px solid rgba(79, 172, 254, 0.3);">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                        <div>
                            <h4 style="margin: 0 0 5px 0; color: #4facfe; font-size: 16px; font-weight: 600;">📥 Excel Shablon</h4>
                            <p style="margin: 0; font-size: 13px; color: rgba(255,255,255,0.7);">Namuna faylni yuklab oling va ma'lumotlarni kiriting</p>
                        </div>
                        <button type="button" id="download-template-btn" class="btn" style="background: rgba(79, 172, 254, 0.2); border: 1px solid rgba(79, 172, 254, 0.4); color: #4facfe; padding: 10px 20px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.3s;">
                            <i data-feather="download"></i>
                            <span>Shablon yuklab olish</span>
                        </button>
                    </div>
                </div>
                
                <!-- Qo'llanma -->
                <div id="debt-import-help" style="background: rgba(79, 172, 254, 0.1); padding: 20px; border-radius: 12px; margin-bottom: 25px; border: 1px solid rgba(79, 172, 254, 0.3);">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                        <i data-feather="info" style="width: 20px; height: 20px; color: #4facfe;"></i>
                        <h4 style="margin: 0; color: #4facfe; font-size: 16px; font-weight: 600;">📋 Import qo'llanmasi</h4>
                    </div>
                    <div id="debt-import-instructions" style="font-size: 13px; line-height: 1.8; color: rgba(255,255,255,0.9);">
                        <p style="margin: 0 0 15px 0; font-weight: 600; color: white;">Excel faylda 3 ta ustun bo'lishi kerak:</p>
                        <div style="overflow-x: auto; margin-bottom: 15px;">
                            <table style="width: 100%; border-collapse: collapse; background: rgba(0,0,0,0.2); border-radius: 8px; overflow: hidden;">
                                <thead>
                                    <tr style="background: linear-gradient(135deg, rgba(79, 172, 254, 0.3) 0%, rgba(0, 242, 254, 0.3) 100%);">
                                        <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: #4facfe; font-weight: 600;">Brend</th>
                                        <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: #4facfe; font-weight: 600;">Filial</th>
                                        <th style="padding: 12px; text-align: left; border: 1px solid rgba(255,255,255,0.2); color: #4facfe; font-weight: 600;">SVR (FISH)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                                        <td style="padding: 12px; border-right: 1px solid rgba(255,255,255,0.1);">Coca-Cola</td>
                                        <td style="padding: 12px; border-right: 1px solid rgba(255,255,255,0.1);">Toshkent</td>
                                        <td style="padding: 12px;">Aliyev Ali</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px; border-right: 1px solid rgba(255,255,255,0.1);">Coca-Cola</td>
                                        <td style="padding: 12px; border-right: 1px solid rgba(255,255,255,0.1);">Samarqand</td>
                                        <td style="padding: 12px;">Karimov Karim</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border-left: 3px solid #4facfe;">
                            <p style="margin: 0 0 10px 0; font-weight: 600; color: #4facfe;">✅ Qabul qilinadigan ustun nomlari:</p>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                                <div>
                                    <strong style="color: #00f2fe;">Brend:</strong>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 5px;">brand_name</code>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 3px;">Brend</code>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 3px;">brand</code>
                                </div>
                                <div>
                                    <strong style="color: #00f2fe;">Filial:</strong>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 5px;">branch_name</code>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 3px;">Filial</code>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 3px;">branch</code>
                                </div>
                                <div>
                                    <strong style="color: #00f2fe;">SVR:</strong>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 5px;">svr_name</code>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 3px;">SVR</code>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 3px;">FISH</code>
                                    <code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 3px;">svr</code>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <form id="debt-import-form">
                    <!-- File upload area -->
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 10px; font-weight: 600; color: white;">Excel fayl *</label>
                        <div id="file-upload-area" style="
                            border: 2px dashed rgba(79, 172, 254, 0.4);
                            border-radius: 12px;
                            padding: 30px;
                            text-align: center;
                            background: rgba(79, 172, 254, 0.05);
                            cursor: pointer;
                            transition: all 0.3s;
                            position: relative;
                        ">
                            <input type="file" id="debt-import-file" accept=".xlsx,.xls" required style="position: absolute; opacity: 0; width: 100%; height: 100%; top: 0; left: 0; cursor: pointer;">
                            <div id="file-upload-content">
                                <i data-feather="file" style="width: 48px; height: 48px; color: #4facfe; margin-bottom: 15px;"></i>
                                <p style="margin: 0 0 5px 0; font-size: 16px; font-weight: 600; color: white;">Faylni tanlang yoki bu yerga tashlang</p>
                                <p style="margin: 0; font-size: 13px; color: rgba(255,255,255,0.6);">Faqat .xlsx yoki .xls formatidagi fayllar</p>
                            </div>
                            <div id="file-selected-info" style="display: none;">
                                <i data-feather="check-circle" style="width: 48px; height: 48px; color: #52c41a; margin-bottom: 15px;"></i>
                                <p style="margin: 0 0 5px 0; font-size: 16px; font-weight: 600; color: #52c41a;" id="file-name"></p>
                                <p style="margin: 0; font-size: 13px; color: rgba(255,255,255,0.6);" id="file-size"></p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Clear existing option -->
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; padding: 15px; background: rgba(250, 173, 20, 0.1); border-radius: 8px; border: 1px solid rgba(250, 173, 20, 0.3);">
                            <input type="checkbox" id="debt-clear-existing" style="margin-top: 2px; width: 18px; height: 18px; cursor: pointer;">
                            <div>
                                <div style="font-weight: 600; color: #faad14; margin-bottom: 5px;">⚠️ Eski ma'lumotlarni tozalash</div>
                                <div style="font-size: 13px; color: rgba(255,255,255,0.7);">Bu tanlov barcha mavjud ma'lumotlarni o'chirib, yangilarini qo'shadi</div>
                            </div>
                        </label>
                    </div>
                    
                    <!-- Action buttons -->
                    <div style="display: flex; gap: 12px;">
                        <button type="submit" class="btn btn-primary" style="flex: 1; padding: 14px 24px; font-size: 16px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 10px;">
                            <i data-feather="upload"></i>
                            <span>Import qilish</span>
                        </button>
                        <button type="button" id="cancel-import-btn" class="btn" style="padding: 14px 24px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: rgba(255,255,255,0.8);">
                            Bekor qilish
                        </button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);
        // File upload area interaktivligi
        const fileInput = document.getElementById('debt-import-file');
        const fileUploadArea = document.getElementById('file-upload-area');
        const fileUploadContent = document.getElementById('file-upload-content');
        const fileSelectedInfo = document.getElementById('file-selected-info');
        const fileName = document.getElementById('file-name');
        const fileSize = document.getElementById('file-size');
        
        // File input change handler
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                fileUploadContent.style.display = 'none';
                fileSelectedInfo.style.display = 'block';
                fileName.textContent = file.name;
                fileSize.textContent = `Hajm: ${(file.size / 1024).toFixed(2)} KB`;
                fileUploadArea.style.borderColor = '#52c41a';
                fileUploadArea.style.background = 'rgba(82, 196, 26, 0.1)';
            } else {
                fileUploadContent.style.display = 'block';
                fileSelectedInfo.style.display = 'none';
                fileUploadArea.style.borderColor = 'rgba(79, 172, 254, 0.4)';
                fileUploadArea.style.background = 'rgba(79, 172, 254, 0.05)';
            }
            if (window.feather) feather.replace();
        });
        
        // Drag and drop
        fileUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileUploadArea.style.borderColor = '#4facfe';
            fileUploadArea.style.background = 'rgba(79, 172, 254, 0.15)';
        });
        
        fileUploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            fileUploadArea.style.borderColor = 'rgba(79, 172, 254, 0.4)';
            fileUploadArea.style.background = 'rgba(79, 172, 254, 0.05)';
        });
        
        fileUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                    fileInput.files = files;
                    fileInput.dispatchEvent(new Event('change'));
                } else {
                    showToast('Faqat .xlsx yoki .xls formatidagi fayllar qabul qilinadi', true);
                }
            }
            fileUploadArea.style.borderColor = 'rgba(79, 172, 254, 0.4)';
            fileUploadArea.style.background = 'rgba(79, 172, 254, 0.05)';
        });
        
        // Shablon yuklab olish
        document.getElementById('download-template-btn').addEventListener('click', () => {
            downloadTemplate();
        });
        
        // Cancel button
        document.getElementById('cancel-import-btn').addEventListener('click', () => {
            modal.classList.add('hidden');
            document.getElementById('debt-import-form').reset();
            fileUploadContent.style.display = 'block';
            fileSelectedInfo.style.display = 'none';
            fileUploadArea.style.borderColor = 'rgba(79, 172, 254, 0.4)';
            fileUploadArea.style.background = 'rgba(79, 172, 254, 0.05)';
        });
        
        // Setup form handler
        document.getElementById('debt-import-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData();
            const file = document.getElementById('debt-import-file').files[0];
            const clearExisting = document.getElementById('debt-clear-existing').checked;
            formData.append('file', file);
            formData.append('clearExisting', clearExisting);
            
            try {
                const response = await safeFetch(`${API_URL}/brands/import`, {
                    method: 'POST',
                    body: formData
                });
                if (!response || !response.ok) {
                    throw new Error(`Import xatolik: ${response?.status || 'No response'}`);
                }
                
                const data = await response.json();
                if (data.success) {
                    const imported = data.imported;
                    let message = `✅ Muvaffaqiyatli import qilindi:\n`;
                    message += `• Brendlar: ${imported.brands || 0}\n`;
                    message += `• Filiallar: ${imported.branches || 0}\n`;
                    message += `• SVR (FISH): ${imported.svrs || 0}\n`;
                    message += `• Jami: ${imported.total || 0} ta yozuv`;
                    
                    if (data.errors && data.errors.length > 0) {
                        message += `\n\n⚠️ Xatoliklar: ${data.errors.length} ta`;
                    }
                    
                    showToast(message, false);
                    modal.classList.add('hidden');
                    document.getElementById('debt-import-form').reset();
                    loadDebtApprovalPage();
                } else {
                    showToast('Import xatolik: ' + (data.error || 'Noma\'lum xatolik'), true);
                }
            } catch (error) {
                logger.error('Import xatolik:', error);
                showToast('Import xatolik yuz berdi: ' + error.message, true);
            }
        });
        
        // Close button
        document.getElementById('close-debt-import-modal').addEventListener('click', () => {
            modal.classList.add('hidden');
            document.getElementById('debt-import-form').reset();
            fileUploadContent.style.display = 'block';
            fileSelectedInfo.style.display = 'none';
            fileUploadArea.style.borderColor = 'rgba(79, 172, 254, 0.4)';
            fileUploadArea.style.background = 'rgba(79, 172, 254, 0.05)';
        });
    }
    modal.classList.remove('hidden');
    if (window.feather) {
        feather.replace();
    }
}

// Sozlamalarni yuklash
async function loadDebtSettings() {
    try {
        const response = await safeFetch(`${API_URL}/settings`);
        if (!response || !response.ok) {
            // Xatolik bo'lsa ham, default qiymatlar bilan ishlash
            return;
        }
        
        const settings = await response.json();
        // Sozlamalar form'ini to'ldirish
        const leadersGroupInput = document.getElementById('debt-leaders-group');
        const operatorsGroupInput = document.getElementById('debt-operators-group');
        const finalGroupInput = document.getElementById('debt-final-group');
        const reminderIntervalInput = document.getElementById('debt-reminder-interval');
        const reminderMaxInput = document.getElementById('debt-reminder-max');
        const excelClientIdInput = document.getElementById('debt-excel-client-id');
        const excelClientNameInput = document.getElementById('debt-excel-client-name');
        const excelDebtAmountInput = document.getElementById('debt-excel-debt-amount');
        const fileSizeLimitInput = document.getElementById('debt-file-size-limit');
        
        if (leadersGroupInput) leadersGroupInput.value = settings.leaders_group_id || '';
        if (operatorsGroupInput) operatorsGroupInput.value = settings.operators_group_id || '';
        if (finalGroupInput) finalGroupInput.value = settings.final_group_id || '';
        if (reminderIntervalInput) reminderIntervalInput.value = settings.debt_reminder_interval || 30;
        if (reminderMaxInput) reminderMaxInput.value = settings.debt_reminder_max_count || 3;
        if (excelClientIdInput) excelClientIdInput.value = settings.debt_excel_client_id_column || 'client_id,id,code';
        if (excelClientNameInput) excelClientNameInput.value = settings.debt_excel_client_name_column || 'client_name,name,fio';
        if (excelDebtAmountInput) excelDebtAmountInput.value = settings.debt_excel_debt_amount_column || 'debt_amount,debt,qarz';
        if (fileSizeLimitInput) fileSizeLimitInput.value = settings.max_file_size_mb || 20;
    } catch (error) {
        showToast('Sozlamalarni yuklashda xatolik', true);
    }
}

// Sozlamalarni saqlash
async function saveDebtSettings() {
    try {
        const leadersGroupInput = document.getElementById('debt-leaders-group');
        const operatorsGroupInput = document.getElementById('debt-operators-group');
        const finalGroupInput = document.getElementById('debt-final-group');
        const reminderIntervalInput = document.getElementById('debt-reminder-interval');
        const reminderMaxInput = document.getElementById('debt-reminder-max');
        const excelClientIdInput = document.getElementById('debt-excel-client-id');
        const excelClientNameInput = document.getElementById('debt-excel-client-name');
        const excelDebtAmountInput = document.getElementById('debt-excel-debt-amount');
        const fileSizeLimitInput = document.getElementById('debt-file-size-limit');
        const settings = {
            leaders_group_id: leadersGroupInput?.value.trim() || '',
            leaders_group_name: 'Rahbarlar guruhi',
            operators_group_id: operatorsGroupInput?.value.trim() || '',
            operators_group_name: 'Operatorlar guruhi',
            final_group_id: finalGroupInput?.value.trim() || '',
            final_group_name: 'Final guruh',
            debt_reminder_interval: reminderIntervalInput?.value ? parseInt(reminderIntervalInput.value) : 30,
            debt_reminder_max_count: reminderMaxInput?.value ? parseInt(reminderMaxInput.value) : 3,
            excel_column_brand: 'Brend',
            excel_column_branch: 'Filial',
            excel_column_svr: 'SVR FISH',
            max_file_size_mb: fileSizeLimitInput?.value ? parseInt(fileSizeLimitInput.value) : 20
        };
        const response = await safeFetch(`${API_URL}/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });
        if (!response || !response.ok) {
            let errorText = 'Server xatolik';
            try {
                if (response) {
                    errorText = await response.text().catch(() => 'Server xatolik');
                }
            } catch (e) {
                errorText = 'Server xatolik';
            }
            log('❌ Sozlamalarni saqlashda xatolik (response):', {
                status: response?.status,
                statusText: response?.statusText,
                errorText: errorText
            });
            showToast('Sozlamalarni saqlashda xatolik: ' + errorText, true);
            return;
        }
        
        const result = await response.json();
        showToast('Sozlamalar muvaffaqiyatli saqlandi! ✅', false);
        
        // Sozlamalarni qayta yuklash
        await loadDebtSettings();
        
    } catch (error) {
        log('❌ Sozlamalarni saqlashda xatolik (catch):', error);
        logger.error('Sozlamalarni saqlashda xatolik:', error);
        showToast('Sozlamalarni saqlashda xatolik: ' + (error.message || 'Noma\'lum xatolik'), true);
    }
}

// Setup debt bindings section
async function setupDebtBindings() {
    log('setupDebtBindings() boshlanmoqda...');
    
    // Permission tekshirish
    if (!hasPermission('debt:view_bindings')) {
        const section = document.getElementById('debt-bindings-section');
        if (section) {
            section.style.display = 'none';
        }
        return;
    }
    
    const roleSelect = document.getElementById('debt-bindings-role-select');
    const bindingsContent = document.getElementById('debt-bindings-content');
    const saveBtn = document.getElementById('debt-bindings-save-btn');
    
    if (!roleSelect || !bindingsContent || !saveBtn) {
        return;
    }
    
    // Rollarni yuklash
    try {
        const rolesRes = await safeFetch('/api/roles');
        if (!rolesRes || !rolesRes.ok) {
            throw new Error('Rollarni yuklashda xatolik');
        }
        
        const rolesData = await rolesRes.json();
        const roles = rolesData.roles || [];
        
        // Superadmin'ni olib tashlash
        const filteredRoles = roles.filter(r => 
            r.role_name !== 'superadmin' && r.role_name !== 'super_admin'
        );
        
        roleSelect.innerHTML = '<option value="">Rolni tanlang...</option>' +
            filteredRoles.map(r => 
                `<option value="${r.role_name}">${r.role_name}</option>`
            ).join('');
    } catch (error) {
        showToast('Rollarni yuklashda xatolik', true);
        return;
    }
    
    // Rol tanlash handler
    roleSelect.addEventListener('change', async (e) => {
        const roleName = e.target.value;
        if (!roleName) {
            bindingsContent.style.display = 'none';
            return;
        }
        
        await loadRoleBindings(roleName);
        bindingsContent.style.display = 'block';
    });
    
    // Saqlash handler
    saveBtn.addEventListener('click', async () => {
        const roleName = roleSelect.value;
        if (!roleName) {
            showToast('Iltimos, avval rolni tanlang', true);
            return;
        }
        
        await saveRoleBindings(roleName);
    });
}

// Load role bindings
async function loadRoleBindings(roleName) {
    log('loadRoleBindings() boshlanmoqda:', { roleName });
    
    const brandsContainer = document.getElementById('debt-bindings-brands');
    const branchesContainer = document.getElementById('debt-bindings-branches');
    const svrsContainer = document.getElementById('debt-bindings-svrs');
    
    try {
        // Mavjud ma'lumotlarni olish
        const [availableRes, bindingsRes] = await Promise.all([
            safeFetch('/api/debt-approval/bindings/available'),
            safeFetch(`/api/debt-approval/bindings/roles/${roleName}`)
        ]);
        
        if (!availableRes || !availableRes.ok) {
            throw new Error('Mavjud ma\'lumotlarni yuklashda xatolik');
        }
        
        const available = await availableRes.json();
        const bindings = bindingsRes && bindingsRes.ok ? await bindingsRes.json() : { brands: [], branches: [], svrs: [] };
        
        const selectedBrandIds = new Set(bindings.brands.map(b => b.id));
        const selectedBranchIds = new Set(bindings.branches.map(b => b.id));
        const selectedSVRIds = new Set(bindings.svrs.map(s => s.id));
        
        // Brendlar checkbox list
        brandsContainer.innerHTML = available.brands.length > 0
            ? available.brands.map(brand => `
                <label style="display: flex; align-items: center; gap: 10px; padding: 10px; cursor: pointer; border-radius: 6px; transition: background 0.2s; margin-bottom: 5px;" 
                       onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                       onmouseout="this.style.background='transparent'">
                    <input type="checkbox" value="${brand.id}" ${selectedBrandIds.has(brand.id) ? 'checked' : ''} 
                           style="width: 18px; height: 18px; cursor: pointer;" 
                           onchange="updateBranchesFilter()">
                    <span style="flex: 1;">${brand.name}</span>
                </label>
            `).join('')
            : '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Brendlar topilmadi</p>';
        
        // Filiallar checkbox list (barcha filiallar, lekin brend bo'yicha filtrlash mumkin)
        branchesContainer.innerHTML = available.branches.length > 0
            ? available.branches.map(branch => `
                <label style="display: flex; align-items: center; gap: 10px; padding: 10px; cursor: pointer; border-radius: 6px; transition: background 0.2s; margin-bottom: 5px;" 
                       data-brand-id="${branch.brand_id}"
                       onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                       onmouseout="this.style.background='transparent'">
                    <input type="checkbox" value="${branch.id}" ${selectedBranchIds.has(branch.id) ? 'checked' : ''} 
                           style="width: 18px; height: 18px; cursor: pointer;"
                           onchange="updateSVRsFilter()">
                    <span style="flex: 1;">${branch.name}</span>
                </label>
            `).join('')
            : '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Filiallar topilmadi</p>';
        
        // SVR'lar checkbox list
        svrsContainer.innerHTML = available.svrs.length > 0
            ? available.svrs.map(svr => `
                <label style="display: flex; align-items: center; gap: 10px; padding: 10px; cursor: pointer; border-radius: 6px; transition: background 0.2s; margin-bottom: 5px;" 
                       data-brand-id="${svr.brand_id}" data-branch-id="${svr.branch_id}"
                       onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                       onmouseout="this.style.background='transparent'">
                    <input type="checkbox" value="${svr.id}" ${selectedSVRIds.has(svr.id) ? 'checked' : ''} 
                           style="width: 18px; height: 18px; cursor: pointer;">
                    <span style="flex: 1;">${svr.name}</span>
                </label>
            `).join('')
            : '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">SVR\'lar topilmadi</p>';
        
        // Global funksiyalar (filtrlash uchun)
        window.updateBranchesFilter = function() {
            const selectedBrands = Array.from(brandsContainer.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
            const branchLabels = branchesContainer.querySelectorAll('label[data-brand-id]');
            
            branchLabels.forEach(label => {
                const brandId = parseInt(label.getAttribute('data-brand-id'));
                if (selectedBrands.length === 0 || selectedBrands.includes(brandId)) {
                    label.style.display = 'flex';
                } else {
                    label.style.display = 'none';
                }
            });
        };
        
        window.updateSVRsFilter = function() {
            const selectedBranches = Array.from(branchesContainer.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
            const svrLabels = svrsContainer.querySelectorAll('label[data-branch-id]');
            
            svrLabels.forEach(label => {
                const branchId = parseInt(label.getAttribute('data-branch-id'));
                if (selectedBranches.length === 0 || selectedBranches.includes(branchId)) {
                    label.style.display = 'flex';
                } else {
                    label.style.display = 'none';
                }
            });
        };
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
    } catch (error) {
        log('❌ loadRoleBindings() xatolik:', error);
        showToast('Bog\'lanishlarni yuklashda xatolik', true);
    }
}

// Setup debt restore requests section
async function setupDebtRestoreRequests() {
    logger.debug('[DEBT_RESTORE] setupDebtRestoreRequests() boshlanmoqda...');
    
    const yearSelect = document.getElementById('debt-restore-year');
    const monthSelect = document.getElementById('debt-restore-month');
    const restoreContent = document.getElementById('debt-restore-content');
    const restoreBtn = document.getElementById('debt-restore-requests-btn');
    
    if (!yearSelect || !monthSelect || !restoreContent || !restoreBtn) {
        logger.error('[DEBT_RESTORE] ❌ Elementlar topilmadi, funksiya to\'xtatildi');
        return;
    }
    
    logger.debug('[DEBT_RESTORE] ✅ Barcha elementlar topildi, sozlamalar boshlanmoqda...');
    
    // Yillar ro'yxatini to'ldirish (2020 - hozirgi yil)
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let year = 2020; year <= currentYear; year++) {
        years.push(year);
    }
    yearSelect.innerHTML = '<option value="">Yil...</option>' + 
        years.map(y => `<option value="${y}">${y}</option>`).join('');
    logger.debug('[DEBT_RESTORE] ✅ Yillar ro\'yxati to\'ldirildi:', years.length, 'ta');
    
    // Oylar ro'yxatini to'ldirish
    const months = [
        { value: '01', name: 'Yanvar' },
        { value: '02', name: 'Fevral' },
        { value: '03', name: 'Mart' },
        { value: '04', name: 'Aprel' },
        { value: '05', name: 'May' },
        { value: '06', name: 'Iyun' },
        { value: '07', name: 'Iyul' },
        { value: '08', name: 'Avgust' },
        { value: '09', name: 'Sentabr' },
        { value: '10', name: 'Oktabr' },
        { value: '11', name: 'Noyabr' },
        { value: '12', name: 'Dekabr' }
    ];
    monthSelect.innerHTML = '<option value="">Oy...</option>' + 
        months.map(m => `<option value="${m.value}">${m.name}</option>`).join('');
    logger.debug('[DEBT_RESTORE] ✅ Oylar ro\'yxati to\'ldirildi:', months.length, 'ta');
    
    // Oy va yil tanlash handler
    const updateRestoreContent = async () => {
        const year = yearSelect.value;
        const month = monthSelect.value;
        
        logger.debug('[DEBT_RESTORE] updateRestoreContent() chaqirildi:', { year, month });
        
        if (!year || !month) {
            logger.debug('[DEBT_RESTORE] Yil yoki oy tanlanmagan, content yashirilmoqda');
            restoreContent.style.display = 'none';
            return;
        }
        
        logger.debug('[DEBT_RESTORE] Content ko\'rsatilmoqda...');
        restoreContent.style.display = 'block';
        
        // Arxivlangan so'rovlarni olish va filtrlash
        try {
            const archiveUrl = `${API_URL}/archive?year=${year}&month=${month}&limit=1000`;
            logger.debug('[DEBT_RESTORE] API so\'rovi yuborilmoqda:', archiveUrl);
            
            const response = await safeFetch(archiveUrl, {
                credentials: 'include'
            });
            
            if (!response || !response.ok) {
                const errorText = response ? await response.text().catch(() => '') : '';
                logger.error('[DEBT_RESTORE] API xatolik:', { status: response?.status, errorText });
                throw new Error('Arxivlangan so\'rovlarni yuklashda xatolik');
            }
            
            const data = await response.json();
            const requests = data.data || [];
            
            logger.debug('[DEBT_RESTORE] Arxivlangan so\'rovlar soni:', requests.length);
            
            // Unique brendlar, filiallar va SVR'larni olish
            const brandsMap = new Map();
            const branchesMap = new Map();
            const svrsMap = new Map();
            
            requests.forEach(req => {
                if (req.brand_id && req.brand_name) {
                    brandsMap.set(req.brand_id, { id: req.brand_id, name: req.brand_name });
                }
                if (req.branch_id && req.branch_name) {
                    branchesMap.set(req.branch_id, { id: req.branch_id, name: req.branch_name, brand_id: req.brand_id });
                }
                if (req.svr_id && req.svr_name) {
                    svrsMap.set(req.svr_id, { id: req.svr_id, name: req.svr_name, branch_id: req.branch_id, brand_id: req.brand_id });
                }
            });
            
            const brands = Array.from(brandsMap.values());
            const branches = Array.from(branchesMap.values());
            const svrs = Array.from(svrsMap.values());
            
            logger.debug('[DEBT_RESTORE] Unique ma\'lumotlar:', { brands: brands.length, branches: branches.length, svrs: svrs.length });
            
            // Brendlar ro'yxatini ko'rsatish
            const brandsContainer = document.getElementById('debt-restore-brands');
            if (brandsContainer) {
                brandsContainer.innerHTML = brands.length > 0
                    ? brands.map(brand => `
                        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; cursor: pointer; border-radius: 6px; transition: background 0.2s; margin-bottom: 5px;" 
                               data-brand-id="${brand.id}"
                               onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                               onmouseout="this.style.background='transparent'">
                            <input type="checkbox" value="${brand.id}" class="debt-restore-brand-checkbox"
                                   style="width: 18px; height: 18px; cursor: pointer;">
                            <span style="flex: 1;">${brand.name}</span>
                        </label>
                    `).join('')
                    : '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Brendlar topilmadi</p>';
            }
            
            // Filiallar ro'yxatini ko'rsatish
            const branchesContainer = document.getElementById('debt-restore-branches');
            if (branchesContainer) {
                branchesContainer.innerHTML = branches.length > 0
                    ? branches.map(branch => `
                        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; cursor: pointer; border-radius: 6px; transition: background 0.2s; margin-bottom: 5px;" 
                               data-brand-id="${branch.brand_id}" data-branch-id="${branch.id}"
                               onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                               onmouseout="this.style.background='transparent'">
                            <input type="checkbox" value="${branch.id}" class="debt-restore-branch-checkbox"
                                   style="width: 18px; height: 18px; cursor: pointer;">
                            <span style="flex: 1;">${branch.name}</span>
                        </label>
                    `).join('')
                    : '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Filiallar topilmadi</p>';
            }
            
            // SVR'lar ro'yxatini ko'rsatish
            const svrsContainer = document.getElementById('debt-restore-svrs');
            if (svrsContainer) {
                svrsContainer.innerHTML = svrs.length > 0
                    ? svrs.map(svr => `
                        <label style="display: flex; align-items: center; gap: 10px; padding: 10px; cursor: pointer; border-radius: 6px; transition: background 0.2s; margin-bottom: 5px;" 
                               data-brand-id="${svr.brand_id}" data-branch-id="${svr.branch_id}" data-svr-id="${svr.id}"
                               onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                               onmouseout="this.style.background='transparent'">
                            <input type="checkbox" value="${svr.id}" class="debt-restore-svr-checkbox"
                                   style="width: 18px; height: 18px; cursor: pointer;">
                            <span style="flex: 1;">${svr.name}</span>
                        </label>
                    `).join('')
                    : '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">SVR\'lar topilmadi</p>';
            }
            
            // "Barcha" checkbox'lar uchun event listener'lar
            setupRestoreSelectAll('debt-restore-select-all-brands', 'debt-restore-brand-checkbox');
            setupRestoreSelectAll('debt-restore-select-all-branches', 'debt-restore-branch-checkbox');
            setupRestoreSelectAll('debt-restore-select-all-svrs', 'debt-restore-svr-checkbox');
            
            logger.debug('[DEBT_RESTORE] ✅ Ma\'lumotlar yuklandi va ko\'rsatildi');
            
            if (window.feather) feather.replace();
        } catch (error) {
            logger.error('[DEBT_RESTORE] ❌ Error loading restore requests:', error);
            showToast('Arxivlangan so\'rovlarni yuklashda xatolik', true);
        }
    };
    
    logger.debug('[DEBT_RESTORE] Event listener\'lar qo\'shilmoqda...');
    yearSelect.addEventListener('change', (e) => {
        logger.debug('[DEBT_RESTORE] Yil o\'zgardi:', e.target.value);
        updateRestoreContent();
    });
    monthSelect.addEventListener('change', (e) => {
        logger.debug('[DEBT_RESTORE] Oy o\'zgardi:', e.target.value);
        updateRestoreContent();
    });
    logger.debug('[DEBT_RESTORE] ✅ Event listener\'lar qo\'shildi');
    
    // Qaytadan faollashtirish tugmasi
    restoreBtn.addEventListener('click', async () => {
        logger.debug('[DEBT_RESTORE] Qaytadan faollashtirish tugmasi bosildi');
        
        const year = yearSelect.value;
        const month = monthSelect.value;
        
        logger.debug('[DEBT_RESTORE] Tanlangan qiymatlar:', { year, month });
        
        if (!year || !month) {
            logger.warn('[DEBT_RESTORE] ⚠️ Yil yoki oy tanlanmagan');
            showToast('Iltimos, oy va yilni tanlang', true);
            return;
        }
        
        const selectedBrands = Array.from(document.querySelectorAll('.debt-restore-brand-checkbox:checked')).map(cb => parseInt(cb.value));
        const selectedBranches = Array.from(document.querySelectorAll('.debt-restore-branch-checkbox:checked')).map(cb => parseInt(cb.value));
        const selectedSvrs = Array.from(document.querySelectorAll('.debt-restore-svr-checkbox:checked')).map(cb => parseInt(cb.value));
        
        // "Barcha" checkbox'lar holatini tekshirish
        const selectAllBrands = document.getElementById('debt-restore-select-all-brands')?.checked || false;
        const selectAllBranches = document.getElementById('debt-restore-select-all-branches')?.checked || false;
        const selectAllSvrs = document.getElementById('debt-restore-select-all-svrs')?.checked || false;
        
        // Agar "Barcha" checkbox tanlangan bo'lsa, undefined yuborish (barchasi)
        const finalBrands = selectAllBrands ? undefined : (selectedBrands.length > 0 ? selectedBrands : undefined);
        const finalBranches = selectAllBranches ? undefined : (selectedBranches.length > 0 ? selectedBranches : undefined);
        const finalSvrs = selectAllSvrs ? undefined : (selectedSvrs.length > 0 ? selectedSvrs : undefined);
        
        logger.debug('[DEBT_RESTORE] Tanlash natijasi:', {
            brands: finalBrands,
            branches: finalBranches,
            svrs: finalSvrs,
            selectAllBrands,
            selectAllBranches,
            selectAllSvrs
        });
        
        // Tanlangan ma'lumotlarni olish (nomlar bilan)
        const selectedBrandNames = selectAllBrands ? ['Barcha'] : Array.from(document.querySelectorAll('.debt-restore-brand-checkbox:checked'))
            .map(cb => {
                const label = cb.closest('label');
                if (label) {
                    const span = label.querySelector('span');
                    return span ? span.textContent || '' : '';
                }
                return '';
            })
            .filter(name => name);
        
        const selectedBranchNames = selectAllBranches ? ['Barcha'] : Array.from(document.querySelectorAll('.debt-restore-branch-checkbox:checked'))
            .map(cb => {
                const label = cb.closest('label');
                if (label) {
                    const span = label.querySelector('span');
                    return span ? span.textContent || '' : '';
                }
                return '';
            })
            .filter(name => name);
        
        const selectedSvrNames = selectAllSvrs ? ['Barcha'] : Array.from(document.querySelectorAll('.debt-restore-svr-checkbox:checked'))
            .map(cb => {
                const label = cb.closest('label');
                if (label) {
                    const span = label.querySelector('span');
                    return span ? span.textContent || '' : '';
                }
                return '';
            })
            .filter(name => name);
        
        // Tasdiqlash modalini yaratish
        const monthName = getMonthName(month);
        let messageHTML = `<div style="text-align: left; line-height: 1.8;">`;
        messageHTML += `<p style="margin-bottom: 15px; color: rgba(255,255,255,0.9);"><strong>📅 Yil va Oy:</strong> ${year}, ${monthName}</p>`;
        messageHTML += `<div style="margin-bottom: 15px; padding: 12px; background: rgba(79, 172, 254, 0.1); border-radius: 6px; border-left: 3px solid #4facfe;">`;
        messageHTML += `<p style="margin: 0 0 10px 0; color: rgba(255,255,255,0.9); font-weight: 600;">Tanlangan filtrlash:</p>`;
        
        // Brendlar
        messageHTML += `<p style="margin: 5px 0; color: rgba(255,255,255,0.8);"><strong>🏢 Brendlar:</strong> `;
        if (selectAllBrands) {
            messageHTML += `<span style="color: #4facfe;">Barcha brendlar</span>`;
        } else if (selectedBrandNames.length > 0) {
            messageHTML += `<span style="color: #4facfe;">${selectedBrandNames.length} ta</span> (${selectedBrandNames.slice(0, 3).join(', ')}${selectedBrandNames.length > 3 ? '...' : ''})`;
        } else {
            messageHTML += `<span style="color: rgba(255,255,255,0.5);">Tanlanmagan</span>`;
        }
        messageHTML += `</p>`;
        
        // Filiallar
        messageHTML += `<p style="margin: 5px 0; color: rgba(255,255,255,0.8);"><strong>📍 Filiallar:</strong> `;
        if (selectAllBranches) {
            messageHTML += `<span style="color: #4facfe;">Barcha filiallar</span>`;
        } else if (selectedBranchNames.length > 0) {
            messageHTML += `<span style="color: #4facfe;">${selectedBranchNames.length} ta</span> (${selectedBranchNames.slice(0, 3).join(', ')}${selectedBranchNames.length > 3 ? '...' : ''})`;
        } else {
            messageHTML += `<span style="color: rgba(255,255,255,0.5);">Tanlanmagan</span>`;
        }
        messageHTML += `</p>`;
        
        // SVR'lar
        messageHTML += `<p style="margin: 5px 0; color: rgba(255,255,255,0.8);"><strong>👤 SVR'lar:</strong> `;
        if (selectAllSvrs) {
            messageHTML += `<span style="color: #4facfe;">Barcha SVR'lar</span>`;
        } else if (selectedSvrNames.length > 0) {
            messageHTML += `<span style="color: #4facfe;">${selectedSvrNames.length} ta</span> (${selectedSvrNames.slice(0, 3).join(', ')}${selectedSvrNames.length > 3 ? '...' : ''})`;
        } else {
            messageHTML += `<span style="color: rgba(255,255,255,0.5);">Tanlanmagan</span>`;
        }
        messageHTML += `</p>`;
        messageHTML += `</div>`;
        
        messageHTML += `<p style="margin-top: 15px; padding: 10px; background: rgba(255, 193, 7, 0.1); border-radius: 6px; border-left: 3px solid #ffc107; color: rgba(255,255,255,0.9); font-size: 13px;">`;
        messageHTML += `⚠️ <strong>Eslatma:</strong> Hech narsa tanlanmasa, barcha so'rovlar qaytadan faollashtiriladi.`;
        messageHTML += `</p>`;
        messageHTML += `</div>`;
        
        const confirmed = await showConfirmDialog({
            title: 'So\'rovlarni Qaytadan Faollashtirish',
            message: messageHTML,
            confirmText: 'Ha, faollashtirish',
            cancelText: 'Bekor qilish',
            type: 'warning',
            icon: 'refresh-cw'
        });
        
        if (!confirmed) return;
        
        try {
            restoreBtn.disabled = true;
            restoreBtn.innerHTML = '<i data-feather="loader"></i> Faollashtirilmoqda...';
            if (window.feather) feather.replace();
            
            const response = await safeFetch(`${API_URL}/archive/bulk-resend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: parseInt(year),
                    month: parseInt(month),
                    filter: {
                        brand_ids: finalBrands,
                        branch_ids: finalBranches,
                        svr_ids: finalSvrs
                    }
                }),
                credentials: 'include'
            });
            
            if (!response || !response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || 'Qaytadan faollashtirishda xatolik');
            }
            
            const result = await response.json();
            
            if (result.success) {
                showToast(`✅ ${result.restored} ta so'rov muvaffaqiyatli qaytadan faollashtirildi!`, false);
                // Sahifani yangilash
                await loadDebtApprovalPage();
            } else {
                throw new Error(result.message || 'Qaytadan faollashtirishda xatolik');
            }
        } catch (error) {
            logger.error('Restore requests error:', error);
            showToast(`Qaytadan faollashtirishda xatolik: ${error.message}`, true);
        } finally {
            restoreBtn.disabled = false;
            restoreBtn.innerHTML = '<i data-feather="refresh-cw"></i><span>🔄 So\'rovlarni Qaytadan Faollashtirish</span>';
            if (window.feather) feather.replace();
        }
    });
}

// Restore "Barcha" checkbox'lar uchun helper
function setupRestoreSelectAll(selectAllId, checkboxClass) {
    const selectAll = document.getElementById(selectAllId);
    if (!selectAll) return;
    
    selectAll.addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll(`.${checkboxClass}`);
        checkboxes.forEach(cb => {
            cb.checked = e.target.checked;
        });
    });
}

// Save role bindings
async function saveRoleBindings(roleName) {
    log('saveRoleBindings() boshlanmoqda:', { roleName });
    
    const brandsContainer = document.getElementById('debt-bindings-brands');
    const branchesContainer = document.getElementById('debt-bindings-branches');
    const svrsContainer = document.getElementById('debt-bindings-svrs');
    const saveBtn = document.getElementById('debt-bindings-save-btn');
    
    if (!hasPermission('debt:manage_bindings')) {
        showToast('Sizda bog\'lanishlarni boshqarish huquqi yo\'q', true);
        return;
    }
    
    const brands = Array.from(brandsContainer.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
    const branches = Array.from(branchesContainer.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
    const svrs = Array.from(svrsContainer.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
    
    try {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i data-feather="loader"></i><span>Saqlanmoqda...</span>';
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        
        const response = await safeFetch(`/api/debt-approval/bindings/roles/${roleName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ brands, branches, svrs })
        });
        
        if (!response || !response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Saqlashda xatolik');
        }
        
        const result = await response.json();
        showToast('Bog\'lanishlar muvaffaqiyatli saqlandi! ✅', false);
        
    } catch (error) {
        log('❌ saveRoleBindings() xatolik:', error);
        showToast('Bog\'lanishlarni saqlashda xatolik: ' + (error.message || 'Noma\'lum xatolik'), true);
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i data-feather="save"></i><span>💾 Bog\'lanishlarni Saqlash</span>';
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
    }
}

// Excel shablon yuklab olish
function downloadTemplate() {
    // Sample data
    const sampleData = [
        { 'Brend': 'Coca-Cola', 'Filial': 'Toshkent', 'SVR (FISH)': 'Aliyev Ali' },
        { 'Brend': 'Coca-Cola', 'Filial': 'Toshkent', 'SVR (FISH)': 'Karimov Karim' },
        { 'Brend': 'Coca-Cola', 'Filial': 'Samarqand', 'SVR (FISH)': 'Valiyev Vali' },
        { 'Brend': 'Pepsi', 'Filial': 'Toshkent', 'SVR (FISH)': 'Nurmatov Nurmat' },
        { 'Brend': 'Pepsi', 'Filial': 'Andijon', 'SVR (FISH)': 'Toshmatov Toshmat' }
    ];
    
    try {
        // XLSX library ishlatish (agar mavjud bo'lsa)
        if (typeof XLSX !== 'undefined') {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(sampleData);
            
            // Ustun kengliklarini sozlash
            ws['!cols'] = [
                { wch: 15 }, // Brend
                { wch: 15 }, // Filial
                { wch: 20 }  // SVR
            ];
            
            XLSX.utils.book_append_sheet(wb, ws, 'Ma\'lumotlar');
            XLSX.writeFile(wb, 'debt-approval-shablon.xlsx');
            showToast('Shablon muvaffaqiyatli yuklab olindi!', false);
        } else {
            // Agar XLSX library yo'q bo'lsa, CSV formatida yuklab olish
            const csvContent = [
                'Brend,Filial,SVR (FISH)',
                ...sampleData.map(row => `${row['Brend']},${row['Filial']},${row['SVR (FISH)']}`)
            ].join('\n');
            
            const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'debt-approval-shablon.csv';
            link.click();
            showToast('Shablon CSV formatida yuklab olindi!', false);
        }
    } catch (error) {
        logger.error('Shablon yuklab olishda xatolik:', error);
        showToast('Shablon yuklab olishda xatolik yuz berdi', true);
    }
}

// Setup accepted data section
/**
 * Qabul qilingan ma'lumotlar bo'limini sozlash
 */
async function setupAcceptedDataSection() {
    
    // Brands, branches, svrs yuklash
    try {
        const [brandsRes, branchesRes, svrsRes] = await Promise.all([
            safeFetch(`${API_URL}/brands`, { credentials: 'include' }),
            safeFetch(`${API_URL}/brands/branches`, { credentials: 'include' }),
            safeFetch(`${API_URL}/brands/svrs`, { credentials: 'include' })
        ]);
        
        const brands = brandsRes && brandsRes.ok ? await brandsRes.json() : [];
        const branches = branchesRes && branchesRes.ok ? await branchesRes.json() : [];
        const svrs = svrsRes && svrsRes.ok ? await svrsRes.json() : [];
        
        // Brand filter
        const brandFilter = document.getElementById('accepted-data-brand-filter');
        if (brandFilter) {
            brandFilter.innerHTML = '<option value="">Barcha brendlar</option>' + 
                brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
        }
        
        // Branch filter (brand bo'yicha filtrlash)
        const branchFilter = document.getElementById('accepted-data-branch-filter');
        const svrFilter = document.getElementById('accepted-data-svr-filter');
        
        if (branchFilter) {
            branchFilter.innerHTML = '<option value="">Barcha filiallar</option>' +
                branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
        }
        
        if (svrFilter) {
            svrFilter.innerHTML = '<option value="">Barcha SVR\'lar</option>' +
                svrs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }
        
        // Brand filter change handler
        if (brandFilter && branchFilter && svrFilter) {
            brandFilter.addEventListener('change', () => {
                const selectedBrandId = brandFilter.value;
                const filteredBranches = selectedBrandId 
                    ? branches.filter(b => b.brand_id == selectedBrandId)
                    : branches;
                branchFilter.innerHTML = '<option value="">Barcha filiallar</option>' +
                    filteredBranches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
                // SVR filter'ni ham yangilash
                const filteredSvrs = selectedBrandId
                    ? svrs.filter(s => filteredBranches.some(b => b.id == s.branch_id))
                    : svrs;
                svrFilter.innerHTML = '<option value="">Barcha SVR\'lar</option>' +
                    filteredSvrs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
            });
        }
        
        // Branch filter change handler
        if (branchFilter && svrFilter) {
            branchFilter.addEventListener('change', () => {
                const selectedBranchId = branchFilter.value;
                const filteredSvrs = selectedBranchId
                    ? svrs.filter(s => s.branch_id == selectedBranchId)
                    : svrs;
                svrFilter.innerHTML = '<option value="">Barcha SVR\'lar</option>' +
                    filteredSvrs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
            });
        }
    } catch (error) {
        logger.error('[ACCEPTED_DATA] Filter yuklashda xatolik:', error);
    }
    
    // Search button
    const searchBtn = document.getElementById('accepted-data-search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => loadAcceptedData(1));
    }
    
    // Export button
    const exportBtn = document.getElementById('accepted-data-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            try {
                exportBtn.disabled = true;
                exportBtn.innerHTML = '<i data-feather="loader"></i> Export qilinmoqda...';
                if (window.feather) feather.replace();
                
                const params = new URLSearchParams();
                const startDate = document.getElementById('accepted-data-start-date')?.value;
                const endDate = document.getElementById('accepted-data-end-date')?.value;
                const brandId = document.getElementById('accepted-data-brand-filter')?.value;
                const branchId = document.getElementById('accepted-data-branch-filter')?.value;
                const svrId = document.getElementById('accepted-data-svr-filter')?.value;
                const search = document.getElementById('accepted-data-search')?.value;
                
                if (startDate) params.append('startDate', startDate);
                if (endDate) params.append('endDate', endDate);
                if (brandId) params.append('brand_id', brandId);
                if (branchId) params.append('branch_id', branchId);
                if (svrId) params.append('svr_id', svrId);
                if (search) params.append('search', search);
                
                const response = await safeFetch(`${API_URL}/archive/accepted-data/export?${params.toString()}`, {
                    credentials: 'include'
                });
                
                if (!response || !response.ok) {
                    throw new Error('Export qilishda xatolik');
                }
                
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `debt_accepted_data_${new Date().toISOString().split('T')[0]}.xlsx`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                showToast('Ma\'lumotlar muvaffaqiyatli export qilindi! ✅', false);
            } catch (error) {
                logger.error('[ACCEPTED_DATA] Export error:', error);
                showToast(`Export qilishda xatolik: ${error.message}`, true);
            } finally {
                exportBtn.disabled = false;
                exportBtn.innerHTML = '<i data-feather="download"></i> Excel\'ga yuklab olish';
                if (window.feather) feather.replace();
            }
        });
    }
    
    // Search input (Enter key)
    const searchInput = document.getElementById('accepted-data-search');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                loadAcceptedData(1);
            }
        });
    }
    
    logger.debug('[ACCEPTED_DATA] setupAcceptedDataSection() yakunlandi');
}

// Accepted data pagination state
let acceptedDataPage = 1;
let acceptedDataLimit = 50;

/**
 * Qabul qilingan ma'lumotlarni yuklash
 */
async function loadAcceptedData(page = 1) {
    const tableBody = document.getElementById('accepted-data-table-body');
    const paginationContainer = document.getElementById('accepted-data-pagination');
    const infoSpan = document.getElementById('accepted-data-info');
    const pagesDiv = document.getElementById('accepted-data-pages');
    
    if (!tableBody) return;
    
    try {
        const params = new URLSearchParams();
        params.append('page', page);
        params.append('limit', acceptedDataLimit);
        
        const startDate = document.getElementById('accepted-data-start-date')?.value;
        const endDate = document.getElementById('accepted-data-end-date')?.value;
        const brandId = document.getElementById('accepted-data-brand-filter')?.value;
        const branchId = document.getElementById('accepted-data-branch-filter')?.value;
        const svrId = document.getElementById('accepted-data-svr-filter')?.value;
        const search = document.getElementById('accepted-data-search')?.value;
        
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        if (brandId) params.append('brand_id', brandId);
        if (branchId) params.append('branch_id', branchId);
        if (svrId) params.append('svr_id', svrId);
        if (search) params.append('search', search);
        
        const response = await safeFetch(`${API_URL}/archive/accepted-data?${params.toString()}`, {
            credentials: 'include'
        });
        
        if (!response || !response.ok) {
            throw new Error('Ma\'lumotlarni yuklashda xatolik');
        }
        
        const data = await response.json();
        acceptedDataPage = page;
        
        // Table body render
        if (data.data && data.data.length > 0) {
            tableBody.innerHTML = data.data.map(row => `
                <tr>
                    <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">${row.id}</td>
                    <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">${row.client_id || ''}</td>
                    <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">${row.client_name || ''}</td>
                    <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: right; color: rgba(255,255,255,0.8);">${row.debt_amount ? parseFloat(row.debt_amount).toLocaleString('uz-UZ') : '0'}</td>
                    <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">${row.brand_name || ''}</td>
                    <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">${row.branch_name || ''}</td>
                    <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">${row.svr_name || ''}</td>
                    <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);"><code style="background: rgba(79, 172, 254, 0.1); padding: 4px 8px; border-radius: 4px; color: #4facfe;">${row.request_uid || ''}</code></td>
                    <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">${row.approved_at ? new Date(row.approved_at).toLocaleString('uz-UZ') : ''}</td>
                    <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);">${row.approved_by_fullname || row.approved_by_username || ''}</td>
                </tr>
            `).join('');
            
            // Pagination render
            if (infoSpan) {
                infoSpan.textContent = `${data.pagination.total} ta yozuv`;
            }
            if (pagesDiv && data.pagination.totalPages > 1) {
                let pagesHTML = '';
                const totalPages = data.pagination.totalPages;
                const currentPage = data.pagination.page;
                
                // Previous button
                if (currentPage > 1) {
                    pagesHTML += `<button class="btn btn-sm btn-outline" onclick="loadAcceptedData(${currentPage - 1})" style="padding: 6px 12px;">←</button>`;
                }
                
                // Page numbers
                const maxPages = 5;
                let startPage = Math.max(1, currentPage - Math.floor(maxPages / 2));
                let endPage = Math.min(totalPages, startPage + maxPages - 1);
                if (endPage - startPage < maxPages - 1) {
                    startPage = Math.max(1, endPage - maxPages + 1);
                }
                
                if (startPage > 1) {
                    pagesHTML += `<button class="btn btn-sm btn-outline" onclick="loadAcceptedData(1)" style="padding: 6px 12px;">1</button>`;
                    if (startPage > 2) pagesHTML += `<span style="padding: 6px;">...</span>`;
                }
                
                for (let i = startPage; i <= endPage; i++) {
                    pagesHTML += `<button class="btn btn-sm ${i === currentPage ? 'btn-primary' : 'btn-outline'}" onclick="loadAcceptedData(${i})" style="padding: 6px 12px;">${i}</button>`;
                }
                
                if (endPage < totalPages) {
                    if (endPage < totalPages - 1) pagesHTML += `<span style="padding: 6px;">...</span>`;
                    pagesHTML += `<button class="btn btn-sm btn-outline" onclick="loadAcceptedData(${totalPages})" style="padding: 6px 12px;">${totalPages}</button>`;
                }
                
                // Next button
                if (currentPage < totalPages) {
                    pagesHTML += `<button class="btn btn-sm btn-outline" onclick="loadAcceptedData(${currentPage + 1})" style="padding: 6px 12px;">→</button>`;
                }
                
                pagesDiv.innerHTML = pagesHTML;
            } else if (pagesDiv) {
                pagesDiv.innerHTML = '';
            }
        } else {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="10" style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
                        Ma'lumotlar topilmadi
                    </td>
                </tr>
            `;
            if (infoSpan) infoSpan.textContent = '0 ta yozuv';
            if (pagesDiv) pagesDiv.innerHTML = '';
        }
    } catch (error) {
        logger.error('Ma\'lumotlarni yuklashda xatolik:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" style="padding: 40px; text-align: center; color: #ef4444;">
                    Xatolik: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Global function
window.loadAcceptedData = loadAcceptedData;

// Setup debt users section
/**
 * Bloklash bo'limini sozlash
 */
async function setupDebtBlocked() {
    logger.debug('[DEBT_BLOCKED] setupDebtBlocked() boshlanmoqda...');
    
    const filterBrand = document.getElementById('block-filter-brand');
    const filterBranch = document.getElementById('block-filter-branch');
    const blockSVRsList = document.getElementById('block-svrs-list');
    const blockSVRSearch = document.getElementById('block-svr-search');
    const reasonInput = document.getElementById('block-reason');
    const commentTextarea = document.getElementById('block-comment');
    const blockBtn = document.getElementById('block-item-btn');
    const blockedList = document.getElementById('blocked-items-list');
    const filterType = document.getElementById('blocked-filter-type');
    const filterStatus = document.getElementById('blocked-filter-status');
    
    if (!filterBrand || !filterBranch || !blockSVRsList || !blockBtn || !blockedList) {
        logger.warn('[DEBT_BLOCKED] DOM elementlar topilmadi');
        return;
    }
    
    // Barcha elementlar (cache)
    let allBrands = [];
    let allBranches = [];
    let allSVRs = [];
    let filteredSVRs = [];
    
    // Brendlar ro'yxatini yuklash
    async function loadBrands() {
        try {
            const res = await safeFetch(`${API_URL}/brands`, { credentials: 'include' });
            if (res && res.ok) {
                allBrands = await res.json();
                if (filterBrand) {
                    filterBrand.innerHTML = '<option value="">Barcha brendlar</option>';
                    allBrands.forEach(brand => {
                        filterBrand.innerHTML += `<option value="${brand.id}">${brand.name}</option>`;
                    });
                }
            }
        } catch (error) {
            logger.error('[DEBT_BLOCKED] Brendlarni yuklashda xatolik:', error);
        }
    }
    
    // Filiallar ro'yxatini yuklash (barcha brendlar uchun)
    async function loadBranches() {
        try {
            // Barcha filiallarni yuklash (brenddan qat'iy nazar)
            const url = `${API_URL}/brands/branches`;
            
            const res = await safeFetch(url, { credentials: 'include' });
            if (res && res.ok) {
                const branchesRaw = await res.json();
                
                // Dublikatlarni olib tashlash (nom bo'yicha unikal)
                const uniqueBranchesMap = new Map();
                branchesRaw.forEach(branch => {
                    // Nom bo'yicha unikal - birinchi topilgan filialni saqlaymiz
                    if (!uniqueBranchesMap.has(branch.name)) {
                        uniqueBranchesMap.set(branch.name, branch);
                    }
                });
                allBranches = Array.from(uniqueBranchesMap.values());
                
                // Nom bo'yicha sort qilish
                allBranches.sort((a, b) => a.name.localeCompare(b.name));
                
                if (filterBranch) {
                    filterBranch.innerHTML = '<option value="">Barcha filiallar</option>';
                    allBranches.forEach(branch => {
                        // Faqat filial nomini ko'rsatish, brend nomini qo'shmaslik
                        filterBranch.innerHTML += `<option value="${branch.name}">${branch.name}</option>`;
                    });
                }
            }
        } catch (error) {
            logger.error('[DEBT_BLOCKED] Filiallarni yuklashda xatolik:', error);
            allBranches = [];
        }
    }
    
    // SVR'lar ro'yxatini yuklash va checkbox list sifatida ko'rsatish
    async function loadAndDisplaySVRs(brandId = null, branchName = null) {
        // Filial tanlanishi kerak
        if (!branchName) {
            displaySVRsAsCheckboxes(false);
            return;
        }
        
        try {
            let url = `${API_URL}/brands/svrs`;
            const params = new URLSearchParams();
            // Filial nomi bo'yicha filter (branch_name)
            // Agar brend tanlangan bo'lsa, brand_id qo'shamiz, aks holda barcha brendlar uchun
            if (brandId) {
                params.append('brand_id', brandId);
            }
            // API'da branch_id ishlatiladi, lekin biz branch_name'ni filterBranch.value sifatida saqlaymiz
            // Shuning uchun avval branch_name bo'yicha filialni topib, keyin branch_id ni olishimiz kerak
            // Yoki API'ni branch_name bo'yicha filter qilishga moslashtirish kerak
            // Hozircha barcha SVR'larni yuklab, keyin client-side filter qilamiz
            
            const res = await safeFetch(url, { credentials: 'include' });
            if (res && res.ok) {
                let svrs = await res.json();
                
                // Filial nomi bo'yicha filter
                svrs = svrs.filter(svr => svr.branch_name === branchName);
                
                // Agar brend tanlangan bo'lsa, brend bo'yicha ham filter
                if (brandId) {
                    svrs = svrs.filter(svr => svr.brand_id === brandId);
                }
                
                allSVRs = svrs;
                displaySVRsAsCheckboxes(true);
            } else {
                allSVRs = [];
                displaySVRsAsCheckboxes(true);
            }
        } catch (error) {
            logger.error('[DEBT_BLOCKED] SVR\'larni yuklashda xatolik:', error);
            allSVRs = [];
            displaySVRsAsCheckboxes(true);
        }
    }
    
    // SVR'larni checkbox list sifatida ko'rsatish
    function displaySVRsAsCheckboxes(loaded = false) {
        if (!blockSVRsList) return;
        
        // Filial tanlanishi kerak
        const branchName = filterBranch.value || null;
        
        if (!branchName) {
            blockSVRsList.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Filialni tanlang</div>';
            if (blockSVRSearch) blockSVRSearch.style.display = 'none';
            return;
        }
        
        if (!loaded) {
            blockSVRsList.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Yuklanmoqda...</div>';
            if (blockSVRSearch) blockSVRSearch.style.display = 'none';
            return;
        }
        
        // Qidiruv bo'yicha filter
        const searchText = blockSVRSearch && blockSVRSearch.value ? blockSVRSearch.value.toLowerCase().trim() : '';
        filteredSVRs = allSVRs.filter(svr => {
            if (!searchText) return true;
            const svrName = svr.name ? svr.name.toLowerCase() : '';
            const brandName = svr.brand_name ? svr.brand_name.toLowerCase() : '';
            return svrName.includes(searchText) || brandName.includes(searchText);
        });
        
        if (filteredSVRs.length === 0) {
            blockSVRsList.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">SVR\'lar topilmadi</div>';
            if (blockSVRSearch) blockSVRSearch.style.display = 'block';
            return;
        }
        
        // Qidiruv maydonini ko'rsatish
        if (blockSVRSearch) blockSVRSearch.style.display = 'block';
        
        blockSVRsList.innerHTML = filteredSVRs.map(svr => `
            <label style="display: flex; align-items: center; gap: 10px; padding: 8px; cursor: pointer; border-radius: 6px; transition: background 0.2s; margin-bottom: 5px;" 
                   onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                   onmouseout="this.style.background='transparent'">
                <input type="checkbox" value="${svr.id}" class="block-svr-checkbox" 
                       style="width: 18px; height: 18px; cursor: pointer;">
                <span style="flex: 1; font-size: 14px; color: rgba(255,255,255,0.9);">
                    ${svr.name}${svr.brand_name ? ' - ' + svr.brand_name : ''}
                </span>
            </label>
        `).join('');
        
        if (window.feather) feather.replace();
    }
    
    // Tanlangan SVR'larni olish
    function getSelectedSVRs() {
        const checkboxes = blockSVRsList.querySelectorAll('.block-svr-checkbox:checked');
        return Array.from(checkboxes).map(cb => {
            const svrId = parseInt(cb.value);
            return allSVRs.find(svr => svr.id === svrId);
        }).filter(svr => svr !== undefined);
    }
    
    // Brend filter o'zgarganda
    filterBrand.addEventListener('change', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Tanlangan filialni saqlash
        const selectedBranchName = filterBranch.value || null;
        
        // Filiallar ro'yxatini yangilash (barcha filiallar, brenddan qat'iy nazar)
        await loadBranches();
        
        // Tanlangan filialni qayta tiklash
        if (selectedBranchName && filterBranch) {
            // Option mavjudligini tekshirish
            const optionExists = Array.from(filterBranch.options).some(opt => opt.value === selectedBranchName);
            if (optionExists) {
                filterBranch.value = selectedBranchName;
            }
        }
        
        // Filial tanlangan bo'lsa, SVR'lar ro'yxatini yangilash
        const branchName = filterBranch.value || null;
        const brandId = filterBrand.value ? parseInt(filterBrand.value) : null;
        await loadAndDisplaySVRs(brandId, branchName);
    });
    
    // Filial filter o'zgarganda
    filterBranch.addEventListener('change', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const brandId = filterBrand.value ? parseInt(filterBrand.value) : null;
        const branchName = filterBranch.value || null;
        
        // Qidiruv maydonini tozalash
        if (blockSVRSearch) blockSVRSearch.value = '';
        
        // SVR'lar ro'yxatini yangilash
        await loadAndDisplaySVRs(brandId, branchName);
    });
    
    // Qidiruv input o'zgarganda
    if (blockSVRSearch) {
        blockSVRSearch.addEventListener('input', () => {
            displaySVRsAsCheckboxes(true);
        });
    }
    
    // Bloklash tugmasi
    blockBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const reason = reasonInput.value.trim();
        const selectedSVRs = getSelectedSVRs();
        
        if (selectedSVRs.length === 0) {
            showToast('Iltimos, kamida bitta SVR tanlang', true);
            return;
        }
        
        if (!reason) {
            showToast('Iltimos, bloklash sababini kiriting', true);
            return;
        }
        
        // Tasdiqlash dialog'i
        const svrNames = selectedSVRs.map(svr => svr.name).join(', ');
        const confirmed = await showConfirmDialog({
            title: 'SVR\'larni bloklash',
            message: `Quyidagi ${selectedSVRs.length} ta SVR'ni bloklashni tasdiqlaysizmi?\n\n<b>${svrNames}</b>\n\n📝 Sabab: ${reason}\n\n⚠️ Bu SVR'lar bloklangandan keyin so'rov yaratish uchun mavjud bo'lmaydi.`,
            confirmText: 'Ha, bloklash',
            cancelText: 'Bekor qilish',
            type: 'warning',
            icon: 'lock'
        });
        
        if (!confirmed) {
            return;
        }
        
        try {
            blockBtn.disabled = true;
            blockBtn.innerHTML = '<i data-feather="loader"></i> Bloklanmoqda...';
            if (window.feather) feather.replace();
            
            const comment = commentTextarea.value.trim() || null;
            let successCount = 0;
            let errorCount = 0;
            const errors = [];
            
            // Har bir tanlangan SVR'ni alohida bloklash
            for (const svr of selectedSVRs) {
                try {
                    const body = {
                        item_type: 'svr',
                        svr_id: svr.id,
                        reason: reason,
                        comment: comment
                    };
                    
                    const res = await safeFetch(`${API_URL}/blocked`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(body)
                    });
                    
                    if (res && res.ok) {
                        successCount++;
                    } else {
                        const errorData = await res.json().catch(() => ({}));
                        errorCount++;
                        errors.push(`${svr.name}: ${errorData.error || 'Bloklashda xatolik'}`);
                    }
                } catch (error) {
                    errorCount++;
                    errors.push(`${svr.name}: ${error.message}`);
                }
            }
            
            // Natijalarni ko'rsatish
            if (errorCount === 0) {
                showToast(`${successCount} ta SVR muvaffaqiyatli bloklandi! ✅`, false);
            } else if (successCount > 0) {
                showToast(`${successCount} ta SVR bloklandi, ${errorCount} tasida xatolik yuz berdi`, true);
                logger.error('[DEBT_BLOCKED] Bloklash xatoliklari:', errors);
            } else {
                throw new Error('Barcha SVR\'lar bloklanmadi. ' + errors.join('; '));
            }
            
            // Formani tozalash
            reasonInput.value = '';
            commentTextarea.value = '';
            
            // Checkbox'larni tozalash
            blockSVRsList.querySelectorAll('.block-svr-checkbox').forEach(cb => cb.checked = false);
            
            // Ro'yxatni yangilash
            await loadBlockedItems();
            
            // SVR'lar ro'yxatini yangilash (bloklanganlar olib tashlanishi mumkin)
            const brandId = filterBrand.value ? parseInt(filterBrand.value) : null;
            const branchName = filterBranch.value || null;
            await loadAndDisplaySVRs(brandId, branchName);
        } catch (error) {
            logger.error('[DEBT_BLOCKED] Bloklashda xatolik:', error);
            showToast(`Bloklashda xatolik: ${error.message}`, true);
        } finally {
            blockBtn.disabled = false;
            blockBtn.innerHTML = '<i data-feather="lock"></i> Bloklash';
            if (window.feather) feather.replace();
        }
    });
    
    // Filter o'zgarishlari
    const loadBlockedItems = async () => {
        try {
            blockedList.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;"><i data-feather="loader" style="width: 24px; height: 24px; animation: spin 1s linear infinite;"></i><p style="margin-top: 10px;">Yuklanmoqda...</p></div>';
            if (window.feather) feather.replace();
            
            const params = new URLSearchParams();
            if (filterType.value) params.append('item_type', filterType.value);
            if (filterStatus.value) params.append('is_active', filterStatus.value);
            
            const res = await safeFetch(`${API_URL}/blocked?${params.toString()}`, { credentials: 'include' });
            if (res && res.ok) {
                const blocked = await res.json();
                renderBlockedItems(blocked);
            } else {
                throw new Error('Bloklangan elementlarni yuklashda xatolik');
            }
        } catch (error) {
            logger.error('[DEBT_BLOCKED] Bloklangan elementlarni yuklashda xatolik:', error);
            blockedList.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">Xatolik: ${error.message}</div>`;
        }
    };
    
    const renderBlockedItems = (blocked) => {
        if (blocked.length === 0) {
            blockedList.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Bloklangan elementlar yo\'q</div>';
            return;
        }
        
        blockedList.innerHTML = blocked.map(item => {
            const itemName = item.brand_name || item.branch_name || item.svr_name || 'Noma\'lum';
            const itemTypeText = item.item_type === 'brand' ? 'Brend' : item.item_type === 'branch' ? 'Filial' : 'SVR';
            const statusBadge = item.is_active 
                ? '<span style="background: #ef4444; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">Bloklangan</span>'
                : '<span style="background: #10b981; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">Ochilgan</span>';
            
            return `
                <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 3px solid ${item.is_active ? '#ef4444' : '#10b981'};">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                        <div>
                            <div style="font-weight: 600; color: rgba(255,255,255,0.9); margin-bottom: 5px;">${itemName}</div>
                            <div style="font-size: 12px; color: rgba(255,255,255,0.6);">${itemTypeText}</div>
                        </div>
                        ${statusBadge}
                    </div>
                    <div style="font-size: 13px; color: rgba(255,255,255,0.8); margin-bottom: 8px;">
                        <strong>Sabab:</strong> ${item.reason || 'Noma\'lum'}
                    </div>
                    ${item.comment ? `<div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 8px;"><strong>Izoh:</strong> ${item.comment}</div>` : ''}
                    <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 10px;">
                        Bloklangan: ${new Date(item.blocked_at).toLocaleString('uz-UZ')} | 
                        ${item.blocked_by_fullname || item.blocked_by_username || 'Noma\'lum'}
                    </div>
                    ${item.is_active ? `
                        <button type="button" class="btn btn-sm btn-success" onclick="unblockItem(${item.id}); return false;" style="width: 100%;">
                            <i data-feather="unlock"></i> Bloklashni bekor qilish
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        if (window.feather) feather.replace();
    };
    
    // Global unblock funksiyasi
    window.unblockItem = async (id) => {
        // Bloklangan element ma'lumotlarini olish (xabar uchun)
        let itemInfo = '';
        try {
            const itemsRes = await safeFetch(`${API_URL}/blocked`, {
                method: 'GET',
                credentials: 'include'
            });
            if (itemsRes && itemsRes.ok) {
                const itemsData = await itemsRes.json();
                const item = itemsData.find(i => i.id === id);
                if (item) {
                    const itemName = item.brand_name || item.branch_name || item.svr_name || 'Element';
                    const itemType = item.item_type === 'brand' ? 'Brend' : 
                                   item.item_type === 'branch' ? 'Filial' : 'SVR';
                    itemInfo = `<b>${itemName}</b> (${itemType})`;
                }
            }
        } catch (e) {
            logger.warn('Bloklangan element ma\'lumotlarini olishda xatolik:', e);
        }
        
        const confirmed = await showConfirmDialog({
            title: 'Bloklashni bekor qilish',
            message: itemInfo 
                ? `Quyidagi elementning bloklashini bekor qilmoqchimisiz?\n\n${itemInfo}\n\nBu element yana so'rov yaratish uchun mavjud bo'ladi.`
                : 'Bloklashni bekor qilishni tasdiqlaysizmi?\n\nBu element yana so\'rov yaratish uchun mavjud bo\'ladi.',
            confirmText: 'Ha, bekor qilish',
            cancelText: 'Bekor qilish',
            type: 'warning',
            icon: 'unlock'
        });
        
        if (!confirmed) {
            return false;
        }
        
        try {
            const res = await safeFetch(`${API_URL}/blocked/${id}/unblock`, {
                method: 'POST',
                credentials: 'include'
            });
            
            if (res && res.ok) {
                showToast('Bloklash muvaffaqiyatli bekor qilindi! ✅', false);
                await loadBlockedItems();
            } else {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || 'Bloklashni bekor qilishda xatolik');
            }
        } catch (error) {
            logger.error('[DEBT_BLOCKED] Bloklashni bekor qilishda xatolik:', error);
            showToast(`Xatolik: ${error.message}`, true);
        }
    };
    
    // Filter event listener'lar
    filterType.addEventListener('change', loadBlockedItems);
    filterStatus.addEventListener('change', loadBlockedItems);
    
    // Dastlabki yuklash
    await loadBrands();
    await loadBranches();
    // SVR'lar dastlabki yuklashda ko'rsatilmaydi - faqat Brend va Filial tanlanganda
    displaySVRsAsCheckboxes(false);
    await loadBlockedItems();
    
    logger.debug('[DEBT_BLOCKED] setupDebtBlocked() yakunlandi');
}

async function setupDebtUsers() {
    log('setupDebtUsers() boshlanmoqda...');
    
    // Setup toggle button
    const toggleBtn = document.getElementById('debt-users-toggle-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleDebtUsersSection);
    }
    
    // Setup role filter badges
    await setupDebtUsersRoleFilters();
    
    // Setup "Barchasi" badge click
    const allBadge = document.querySelector('.debt-filter-badge[data-role=""]');
    if (allBadge) {
        allBadge.addEventListener('click', () => {
            document.querySelectorAll('.debt-filter-badge').forEach(b => {
                b.classList.remove('active');
                b.style.borderColor = 'rgba(255,255,255,0.1)';
                b.style.background = 'rgba(255,255,255,0.03)';
                b.style.color = 'rgba(255,255,255,0.7)';
            });
            allBadge.classList.add('active');
            allBadge.style.borderColor = 'rgba(79, 172, 254, 0.3)';
            allBadge.style.background = 'rgba(79, 172, 254, 0.15)';
            allBadge.style.color = '#4facfe';
            
            debtUsersState.currentPage = 1;
            loadDebtUsers('');
        });
    }
    
    // Load users
    await loadDebtUsers();
}

// Debt users state
let debtUsersState = {
    allUsers: [],
    filteredUsers: [],
    currentRoleFilter: '',
    currentPage: 1,
    usersPerPage: 30,
    isLoading: false,
    allUsersCache: [] // Barcha foydalanuvchilar cache (sonlarni hisoblash uchun)
};

// Load debt users list (optimized with lazy loading)
async function loadDebtUsers(roleFilter = '', append = false) {
    const usersList = document.getElementById('debt-users-list');
    if (!usersList) return;
    
    if (debtUsersState.isLoading) return;
    debtUsersState.isLoading = true;
    
    try {
        // Agar barcha foydalanuvchilar cache'da yo'q bo'lsa, yuklash (sonlarni hisoblash uchun)
        if (debtUsersState.allUsersCache.length === 0) {
            const allUsersRes = await safeFetch('/api/debt-approval/users');
            if (allUsersRes && allUsersRes.ok) {
                debtUsersState.allUsersCache = await allUsersRes.json();
            }
        }
        
        // Agar barcha foydalanuvchilar yuklanmagan bo'lsa yoki filter o'zgarganda, yuklash
        if (debtUsersState.allUsers.length === 0 || roleFilter !== debtUsersState.currentRoleFilter) {
            const url = roleFilter ? `/api/debt-approval/users?role=${roleFilter}` : '/api/debt-approval/users';
            const res = await safeFetch(url);
            
            if (!res || !res.ok) {
                throw new Error('Foydalanuvchilarni yuklashda xatolik');
            }
            
            const users = await res.json();
            debtUsersState.allUsers = users;
            debtUsersState.currentRoleFilter = roleFilter;
            debtUsersState.currentPage = 1;
        }
        
        // Filter qo'llash va superadmin filtrlash
        const currentUser = state?.currentUser;
        const isCurrentUserSuperadmin = currentUser && (currentUser.role === 'superadmin' || currentUser.role === 'super_admin');
        
        debtUsersState.filteredUsers = debtUsersState.allUsers.filter(user => {
            // Superadmin'ni faqat superadmin o'zi ko'rsin
            if (user.role === 'superadmin' || user.role === 'super_admin') {
                // Agar hozirgi foydalanuvchi superadmin bo'lsa, ko'rsatish
                if (isCurrentUserSuperadmin) {
                    return true;
                }
                // Aks holda, superadmin'ni yashirish
                return false;
            }
            return true;
        });
        
        // Pagination
        const endIndex = debtUsersState.currentPage * debtUsersState.usersPerPage;
        const usersToShow = debtUsersState.filteredUsers.slice(0, endIndex);
        const hasMore = endIndex < debtUsersState.filteredUsers.length;
        
        if (usersToShow.length === 0) {
            usersList.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">Foydalanuvchilar topilmadi</p>';
            document.getElementById('debt-users-pagination').style.display = 'none';
            return;
        }
        
        // Render users
        if (append) {
            const existingGrid = usersList.querySelector('.debt-users-grid');
            if (existingGrid) {
                const previousCount = (debtUsersState.currentPage - 1) * debtUsersState.usersPerPage;
                const newUsers = usersToShow.slice(previousCount);
                const newCards = newUsers.map(user => createUserCard(user)).join('');
                existingGrid.insertAdjacentHTML('beforeend', newCards);
            }
        } else {
            usersList.innerHTML = `
                <div class="debt-users-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
                    ${usersToShow.map(user => createUserCard(user)).join('')}
                </div>
            `;
        }
        
        // Pagination button
        const paginationEl = document.getElementById('debt-users-pagination');
        const loadMoreBtn = document.getElementById('debt-users-load-more');
        if (hasMore) {
            paginationEl.style.display = 'block';
            loadMoreBtn.onclick = () => {
                debtUsersState.currentPage++;
                loadDebtUsers(roleFilter, true);
            };
        } else {
            paginationEl.style.display = 'none';
        }
        
        // Update role badges counts
        updateRoleBadgesCounts();
        
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        
    } catch (error) {
        usersList.innerHTML = `<div class="alert alert-danger">Xatolik: ${error.message}</div>`;
    } finally {
        debtUsersState.isLoading = false;
    }
}

// Create user card (collapsible)
function createUserCard(user) {
    const cardId = `debt-user-card-${user.id}`;
    return `
        <div class="debt-user-card" id="${cardId}" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; transition: all 0.3s ease; cursor: pointer;" 
             onmouseover="this.style.borderColor='rgba(79, 172, 254, 0.4)'; this.style.background='rgba(79, 172, 254, 0.05)'" 
             onmouseout="this.style.borderColor='rgba(255,255,255,0.1)'; this.style.background='rgba(255,255,255,0.03)'">
            <!-- Card Header (always visible) -->
            <div class="debt-user-card-header" onclick="toggleDebtUserCard(${user.id})" style="padding: 16px; display: flex; align-items: center; justify-content: space-between;">
                <div style="flex: 1; min-width: 0;">
                    <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${user.fullname || user.username}</h4>
                    <p style="margin: 6px 0 0 0; font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">@${user.username} • ${user.role}</p>
                    <div style="margin-top: 8px; font-size: 11px; color: rgba(255,255,255,0.5);">
                        Status: <span style="color: ${user.status === 'active' ? '#4facfe' : '#ff6b6b'}">${user.status === 'active' ? 'Faol' : 'Nofaol'}</span>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; margin-left: 12px;">
                    <button type="button" class="btn btn-sm btn-primary" onclick="event.stopPropagation(); openUserBindingsModal(${user.id})" style="padding: 6px 12px; z-index: 10;">
                        <i data-feather="settings"></i>
                    </button>
                    <i data-feather="chevron-down" class="debt-user-card-chevron" style="width: 16px; height: 16px; color: rgba(255,255,255,0.5); transition: transform 0.3s;"></i>
                </div>
            </div>
            
            <!-- Card Content (collapsible) -->
            <div class="debt-user-card-content" id="debt-user-card-content-${user.id}" style="max-height: 0; overflow: hidden; transition: max-height 0.3s ease, padding 0.3s ease; padding: 0 16px;">
                <div style="padding: 16px 0; border-top: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: rgba(255,255,255,0.7);">
                            <i data-feather="user" style="width: 14px; height: 14px;"></i>
                            <span>Username: <strong>@${user.username}</strong></span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: rgba(255,255,255,0.7);">
                            <i data-feather="shield" style="width: 14px; height: 14px;"></i>
                            <span>Rol: <strong>${user.role}</strong></span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: rgba(255,255,255,0.7);">
                            <i data-feather="${user.status === 'active' ? 'check-circle' : 'x-circle'}" style="width: 14px; height: 14px; color: ${user.status === 'active' ? '#4facfe' : '#ff6b6b'};"></i>
                            <span>Holat: <strong style="color: ${user.status === 'active' ? '#4facfe' : '#ff6b6b'}">${user.status === 'active' ? 'Faol' : 'Nofaol'}</strong></span>
                        </div>
                        <button type="button" class="btn btn-sm btn-primary" onclick="openUserBindingsModal(${user.id})" style="width: 100%; margin-top: 8px; padding: 8px;">
                            <i data-feather="link"></i>
                            <span style="margin-left: 6px;">Bog'lanishlar va Vazifalar</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Toggle user card
window.toggleDebtUserCard = function(userId) {
    const card = document.getElementById(`debt-user-card-${userId}`);
    const content = document.getElementById(`debt-user-card-content-${userId}`);
    const chevron = card?.querySelector('.debt-user-card-chevron');
    
    if (!card || !content) return;
    
    const isExpanded = content.style.maxHeight && content.style.maxHeight !== '0px';
    
    if (isExpanded) {
        content.style.maxHeight = '0px';
        content.style.padding = '0 16px';
        if (chevron) chevron.style.transform = 'rotate(0deg)';
    } else {
        content.style.maxHeight = '500px';
        content.style.padding = '0 16px';
        if (chevron) chevron.style.transform = 'rotate(180deg)';
    }
    
    // Feather icons yangilash
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
};

// Update role badges counts (barcha foydalanuvchilar asosida)
function updateRoleBadgesCounts() {
    // Barcha foydalanuvchilar cache'dan foydalanish (to'g'ri sonlar uchun)
    // Cache allaqachon superadmin'ni filtrlangan (agar kerak bo'lsa)
    const usersForCount = debtUsersState.allUsersCache.length > 0 
        ? debtUsersState.allUsersCache 
        : debtUsersState.allUsers;
    
    const roleCounts = {};
    usersForCount.forEach(user => {
        if (user && user.role) {
            roleCounts[user.role] = (roleCounts[user.role] || 0) + 1;
        }
    });
    
    const allCount = usersForCount.length;
    const allBadge = document.getElementById('debt-role-count-all');
    if (allBadge) {
        allBadge.textContent = allCount;
    }
    
    // Update other role badges
    document.querySelectorAll('.debt-filter-badge[data-role]').forEach(badge => {
        const role = badge.dataset.role;
        if (role && role !== '') {
            const count = roleCounts[role] || 0;
            const countEl = badge.querySelector('.debt-badge-count');
            if (countEl) {
                countEl.textContent = count;
            }
        }
    });
}

// Setup role filter badges
async function setupDebtUsersRoleFilters() {
    const badgesContainer = document.getElementById('debt-users-role-badges');
    if (!badgesContainer) return;
    
    try {
        // Barcha foydalanuvchilarni yuklash (sonlarni hisoblash uchun)
        const res = await safeFetch('/api/debt-approval/users');
        if (!res || !res.ok) return;
        
        const users = await res.json();
        
        // Superadmin'ni filtrlash (cache'da ham)
        const currentUser = state?.currentUser;
        const isSuperadmin = currentUser && (currentUser.role === 'superadmin' || currentUser.role === 'super_admin');
        
        let filteredUsersForCache = users;
        if (!isSuperadmin) {
            filteredUsersForCache = users.filter(user => 
                user.role !== 'superadmin' && user.role !== 'super_admin'
            );
        }
        
        debtUsersState.allUsersCache = filteredUsersForCache; // Cache'ga saqlash
        
        // Rol badge'larini yaratish (superadmin rolini olib tashlash, agar hozirgi foydalanuvchi superadmin bo'lmasa)
        let rolesForBadges = [...new Set(filteredUsersForCache.map(u => u.role).filter(r => r))].sort();
        
        // Superadmin rolini badge'lardan olib tashlash (agar hozirgi foydalanuvchi superadmin bo'lmasa)
        if (!isSuperadmin) {
            rolesForBadges = rolesForBadges.filter(r => r !== 'superadmin' && r !== 'super_admin');
        }
        
        const roles = rolesForBadges;
        
        roles.forEach(role => {
            const badge = document.createElement('button');
            badge.className = 'debt-filter-badge';
            badge.dataset.role = role;
            badge.style.cssText = 'padding: 6px 14px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.7); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s;';
            badge.innerHTML = `
                <span>${role}</span>
                <span class="debt-badge-count" style="margin-left: 6px; padding: 2px 6px; background: rgba(255,255,255,0.1); border-radius: 10px; font-size: 11px;">0</span>
            `;
            
            badge.addEventListener('click', () => {
                document.querySelectorAll('.debt-filter-badge').forEach(b => {
                    b.classList.remove('active');
                    b.style.borderColor = 'rgba(255,255,255,0.1)';
                    b.style.background = 'rgba(255,255,255,0.03)';
                    b.style.color = 'rgba(255,255,255,0.7)';
                });
                badge.classList.add('active');
                badge.style.borderColor = 'rgba(79, 172, 254, 0.3)';
                badge.style.background = 'rgba(79, 172, 254, 0.15)';
                badge.style.color = '#4facfe';
                
                debtUsersState.currentPage = 1;
                loadDebtUsers(role);
            });
            
            badge.addEventListener('mouseenter', () => {
                if (!badge.classList.contains('active')) {
                    badge.style.borderColor = 'rgba(255,255,255,0.2)';
                    badge.style.background = 'rgba(255,255,255,0.05)';
                }
            });
            
            badge.addEventListener('mouseleave', () => {
                if (!badge.classList.contains('active')) {
                    badge.style.borderColor = 'rgba(255,255,255,0.1)';
                    badge.style.background = 'rgba(255,255,255,0.03)';
                }
            });
            
            badgesContainer.appendChild(badge);
        });
        
        // Sonlarni yangilash
        updateRoleBadgesCounts();
        
    } catch (error) {
        logger.error('Role filters setup xatolik:', error);
    }
}

// Toggle users section
window.toggleDebtUsersSection = function() {
    const content = document.getElementById('debt-users-content');
    const toggleBtn = document.getElementById('debt-users-toggle-btn');
    const chevron = toggleBtn?.querySelector('i[data-feather="chevron-up"]');
    
    if (!content || !toggleBtn) return;
    
    const isExpanded = content.style.display !== 'none';
    
    if (isExpanded) {
        content.style.display = 'none';
        toggleBtn.querySelector('span').textContent = 'Kengaytirish';
        if (chevron) {
            chevron.setAttribute('data-feather', 'chevron-down');
            if (typeof feather !== 'undefined') feather.replace();
        }
        toggleBtn.setAttribute('aria-expanded', 'false');
    } else {
        content.style.display = 'block';
        toggleBtn.querySelector('span').textContent = 'Yig\'ish';
        if (chevron) {
            chevron.setAttribute('data-feather', 'chevron-up');
            if (typeof feather !== 'undefined') feather.replace();
        }
        toggleBtn.setAttribute('aria-expanded', 'true');
    }
};

// Open user bindings modal
window.openUserBindingsModal = async function(userId) {
    try {
        // Foydalanuvchi ma'lumotlarini olish
        const [userRes, bindingsRes, tasksRes, availableRes] = await Promise.all([
            safeFetch(`/api/debt-approval/users/${userId}`),
            safeFetch(`/api/debt-approval/users/${userId}/bindings`),
            safeFetch(`/api/debt-approval/users/${userId}/tasks`),
            safeFetch('/api/debt-approval/bindings/available')
        ]);
        
        if (!userRes || !userRes.ok) {
            throw new Error('Foydalanuvchi ma\'lumotlarini olishda xatolik');
        }
        
        const user = await userRes.json();
        const bindings = bindingsRes && bindingsRes.ok ? await bindingsRes.json() : { brands: [], branches: [], svrs: [] };
        const tasks = tasksRes && tasksRes.ok ? await tasksRes.json() : [];
        const available = availableRes && availableRes.ok ? await availableRes.json() : { brands: [], branches: [], svrs: [] };
        
        // Dublikat tekshiruvi - Utility funksiyalar ishlatiladi
        const originalBrands = [...available.brands];
        available.brands = removeDuplicatesById(available.brands, 'id', {
            warnOnDuplicate: true,
            context: 'openUserBindingsModal',
            sortFn: (a, b) => a.name.localeCompare(b.name)
        });
        logDuplicates('Brendlar', originalBrands, available.brands, 'available.brands');
        
        const originalBranches = [...available.branches];
        available.branches = removeDuplicatesById(available.branches, 'id', {
            warnOnDuplicate: true,
            context: 'openUserBindingsModal',
            sortFn: (a, b) => a.name.localeCompare(b.name)
        });
        logDuplicates('Filiallar', originalBranches, available.branches, 'available.branches');
        
        const originalBindingsBrands = [...bindings.brands];
        bindings.brands = removeDuplicatesById(bindings.brands, 'id', {
            warnOnDuplicate: true,
            context: 'openUserBindingsModal'
        });
        logDuplicates('Bindings Brendlar', originalBindingsBrands, bindings.brands, 'bindings.brands');
        
        const originalBindingsBranches = [...bindings.branches];
        bindings.branches = removeDuplicatesById(bindings.branches, 'id', {
            warnOnDuplicate: true,
            context: 'openUserBindingsModal'
        });
        logDuplicates('Bindings Filiallar', originalBindingsBranches, bindings.branches, 'bindings.branches');
        
        // Modal yaratish
        const modal = document.createElement('div');
        modal.className = 'modal fade show';
        modal.id = 'user-bindings-modal';
        modal.dataset.userRole = user.role || '';
        modal.style.display = 'block';
        modal.style.zIndex = '9999';
        modal.innerHTML = `
            <div class="modal-dialog modal-lg modal-dialog-centered" style="max-width: 900px;">
                <div class="modal-content" style="background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1);">
                    <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <h5 class="modal-title" style="color: #fff;">
                            <i data-feather="user" style="width: 20px; height: 20px; margin-right: 8px;"></i>
                            ${user.fullname || user.username} - Bog'lanishlar va Vazifalar
                        </h5>
                        <button type="button" class="btn-close btn-close-white" onclick="this.closest('.modal').remove()"></button>
                    </div>
                    <div class="modal-body" style="max-height: 70vh; overflow-y: auto; padding: 20px;">
                        <!-- User Info -->
                        <div style="margin-bottom: 25px; padding: 15px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                            <p style="margin: 0; color: rgba(255,255,255,0.7);"><strong>Username:</strong> @${user.username}</p>
                            <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.7);"><strong>Rol:</strong> ${user.role}</p>
                            <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.7);"><strong>Status:</strong> <span style="color: ${user.status === 'active' ? '#4facfe' : '#ff6b6b'}">${user.status === 'active' ? 'Faol' : 'Nofaol'}</span></p>
                        </div>
                        
                        <!-- Tabs -->
                        <ul class="nav nav-tabs" style="border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                            <li class="nav-item">
                                <a class="nav-link active" data-tab="bindings" style="color: #4facfe; cursor: pointer;">🔗 Bog'lanishlar</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link" data-tab="tasks" style="color: rgba(255,255,255,0.7); cursor: pointer;">📋 Vazifalar</a>
                            </li>
                        </ul>
                        
                        <!-- Bindings Tab -->
                        <div id="user-bindings-tab" class="user-tab-content">
                            <div style="margin-bottom: 15px; padding: 12px; background: rgba(79, 172, 254, 0.1); border-left: 3px solid #4facfe; border-radius: 6px;">
                                <p style="margin: 0; color: rgba(255,255,255,0.9); font-size: 13px;">
                                    <strong>ℹ️ Bog'lanishlar:</strong> Foydalanuvchiga qaysi brendlar va filiallar ko'rsatilishi kerakligini belgilaydi. 
                                    Bu brend va filial bo'yicha SVR ma'lumotlari avtomatik chiqadi.
                                </p>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 20px;">
                                <!-- Brendlar -->
                                <div>
                                    <h6 style="margin-bottom: 12px; color: #fff; display: flex; align-items: center; gap: 8px;">
                                        <i data-feather="briefcase" style="width: 16px; height: 16px;"></i>
                                        Brendlar
                                    </h6>
                                    <div id="user-bindings-brands" style="max-height: 300px; overflow-y: auto; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                                        ${available.brands.length > 0 ? available.brands.map(brand => `
                                            <label style="display: flex; align-items: center; gap: 10px; padding: 8px; cursor: pointer; border-radius: 6px; transition: background 0.2s; margin-bottom: 5px;" 
                                                   onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                                                   onmouseout="this.style.background='transparent'">
                                                <input type="checkbox" value="${brand.id}" ${bindings.brands.some(b => b.id === brand.id) ? 'checked' : ''} 
                                                       style="width: 18px; height: 18px; cursor: pointer;" 
                                                       onchange="updateUserBranchesFilter()">
                                                <span style="flex: 1; font-size: 14px;">${brand.name}</span>
                                            </label>
                                        `).join('') : '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 10px; font-size: 13px;">Brendlar topilmadi</p>'}
                                    </div>
                                </div>
                                
                                <!-- Filiallar -->
                                <div>
                                    <h6 style="margin-bottom: 12px; color: #fff; display: flex; align-items: center; gap: 8px;">
                                        <i data-feather="map-pin" style="width: 16px; height: 16px;"></i>
                                        Filiallar
                                    </h6>
                                    <div id="user-bindings-branches" style="max-height: 300px; overflow-y: auto; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                                        ${getUniqueBranchesHTML(available.branches, bindings.branches, 'updateUserBrandsFromBranch', 'bindings', available.brands)}
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Tasks Tab -->
                        <div id="user-tasks-tab" class="user-tab-content" style="display: none;">
                            <div style="margin-bottom: 15px; padding: 12px; background: rgba(255, 193, 7, 0.1); border-left: 3px solid #ffc107; border-radius: 6px;">
                                <p style="margin: 0; color: rgba(255,255,255,0.9); font-size: 13px;">
                                    <strong>ℹ️ Vazifalar:</strong> Foydalanuvchi qaysi vazifalarni bajarishi mumkinligini belgilaydi. 
                                    Filial va brendlar "Bog'lanishlar" tab'ida tanlanadi. Kassir va Operator uchun "Bog'lanishlar" tab'idagi filiallar/brendlar avtomatik ishlatiladi.
                                </p>
                            </div>
                            <div style="margin-bottom: 20px;">
                                <!-- Vazifalar -->
                                <div>
                                    <h6 style="margin-bottom: 12px; color: #fff; display: flex; align-items: center; gap: 8px;">
                                        <i data-feather="check-circle" style="width: 16px; height: 16px;"></i>
                                        Vazifalar
                                    </h6>
                                    <div id="user-tasks-list" style="max-height: 500px; overflow-y: auto; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                                        ${renderTasksList(tasks)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer" style="border-top: 1px solid rgba(255,255,255,0.1);">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Bekor qilish</button>
                        <button type="button" class="btn btn-primary" onclick="saveUserBindings(${userId})">
                            <i data-feather="save"></i>
                            Saqlash
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Feather icons
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        
        // Tab switcher
        const tabLinks = modal.querySelectorAll('.nav-link');
        const tabContents = modal.querySelectorAll('.user-tab-content');
        
        tabLinks.forEach(link => {
            link.addEventListener('click', () => {
                const tabName = link.dataset.tab;
                
                // Remove active class
                tabLinks.forEach(l => {
                    l.classList.remove('active');
                    l.style.color = 'rgba(255,255,255,0.7)';
                });
                tabContents.forEach(c => c.style.display = 'none');
                
                // Add active class
                link.classList.add('active');
                link.style.color = '#4facfe';
                
                const content = modal.querySelector(`#user-${tabName}-tab`);
                if (content) {
                    content.style.display = 'block';
                }
            });
        });
        
        // Filter functions - Brend tanlanganda, shu brendga tegishli BARCHA filiallar ko'rsatiladi va avtomatik tanlanadi
        window.updateUserBranchesFilter = function() {
            const brandsContainer = modal.querySelector('#user-bindings-brands');
            const branchesContainer = modal.querySelector('#user-bindings-branches');
            const selectedBrands = Array.from(brandsContainer.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
            const branchLabels = branchesContainer.querySelectorAll('label[data-branch-map]');
            
            // Endi filiallar ro'yxati nom bo'yicha allaqachon unique.
            // Brend tanlanmasa - hammasini ko'rsatamiz.
            if (selectedBrands.length === 0) {
                branchLabels.forEach(label => {
                    label.style.display = 'flex';
                });
            } else {
                // Tanlangan brendlarga tegishli filial nomlari ko'rsatiladi (unique ko'rinishda)
                branchLabels.forEach(label => {
                    const brandIdsStr = label.getAttribute('data-brand-ids') || '';
                    const brandIds = brandIdsStr
                        .split(',')
                        .map(x => parseInt(x, 10))
                        .filter(n => !Number.isNaN(n));
                    const shouldShow = brandIds.some(id => selectedBrands.includes(id));
                    label.style.display = shouldShow ? 'flex' : 'none';
                });
            }
        };
        
        // Filial tanlanganda, shu filialga tegishli brendlarni avtomatik tanlash
        window.updateUserBrandsFromBranch = function() {
            const brandsContainer = modal.querySelector('#user-bindings-brands');
            const branchesContainer = modal.querySelector('#user-bindings-branches');
            const selectedBranchLabels = Array.from(branchesContainer.querySelectorAll('input:checked'))
                .map(cb => cb.closest('label'))
                .filter(Boolean);
            
            // Tanlangan filiallarga tegishli brendlarni olish va ko'rsatish
            const relatedBrandIds = new Set();
            selectedBranchLabels.forEach(label => {
                const brandIdsStr = label.getAttribute('data-brand-ids') || '';
                brandIdsStr.split(',').forEach(x => {
                    const id = parseInt(x, 10);
                    if (!Number.isNaN(id)) relatedBrandIds.add(id);
                });
            });
            
            // Avtomatik tanlash OLIB TASHLANDI - foydalanuvchi o'zi tanlaydi
            // Faqat tegishli brendlarni ko'rsatish (agar kerak bo'lsa)
            if (relatedBrandIds.size > 0) {
                const brandLabels = brandsContainer.querySelectorAll('label');
                brandLabels.forEach(label => {
                    const checkbox = label.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                    const brandId = parseInt(checkbox.value);
                        if (relatedBrandIds.has(brandId)) {
                            label.style.display = 'flex'; // Faqat ko'rsatish
                            // checkbox.checked = true; // OLIB TASHLANDI
                        }
                    }
                });
            }
        };
        
        // Tasks filter function - endi kerak emas, chunki "Vazifalar" tab'ida filiallar yo'q
        
        // Initial filter
        updateUserBranchesFilter();
        
        // Filial tanlanganda tegishli brendlarni ko'rsatish (avtomatik tanlash yo'q)
        const branchCheckboxes = modal.querySelectorAll('#user-bindings-branches input[type="checkbox"]');
        branchCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                updateUserBrandsFromBranch(); // Faqat filtrlash, avtomatik tanlash yo'q
            });
        });
        
        // Brend tanlanganda tegishli filiallarni ko'rsatish (avtomatik tanlash yo'q)
        const brandCheckboxes = modal.querySelectorAll('#user-bindings-brands input[type="checkbox"]');
        brandCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                updateUserBranchesFilter(); // Faqat filtrlash, avtomatik tanlash yo'q
            });
        });
        
    } catch (error) {
        logger.error('openUserBindingsModal() xatolik:', error);
        showToast(`Modal yaratishda xatolik: ${error.message}`, true);
    }
};

// Render tasks list HTML
function renderTasksList(tasks) {
    // Rolga mos vazifalar guruhlari
    const taskGroups = [
        {
            role: 'admin',
            label: '👑 Admin',
            description: 'Admin vazifalari - tizimni to\'liq boshqarish',
            tasks: [
                { 
                    key: 'debt:admin', 
                    label: 'Admin boshqaruvi',
                    description: 'Barcha tizim funksiyalarini boshqarish, sozlamalarni o\'zgartirish, foydalanuvchilarni boshqarish'
                }
            ]
        },
        {
            role: 'nazoratchi',
            label: '👮 Nazoratchi',
            description: 'Nazoratchi vazifalari - kasirlar yoki operatorlar tasdiqlaganidan keyin so\'rovlarni nazorat qilish',
            tasks: [
                { 
                    key: 'approve_supervisor_cashier', 
                    label: 'Kasirlarga nazoratchi',
                    description: 'Barcha kasirlar tasdiqlagandan keyin so\'rovlarni tasdiqlash (kasir → nazoratchi → operator)'
                },
                { 
                    key: 'approve_supervisor_operator', 
                    label: 'Operatorlarga nazoratchi',
                    description: 'Barcha operatorlar tasdiqlagandan keyin so\'rovlarni tasdiqlash (operator → nazoratchi → final)'
                }
            ]
        },
        {
            role: 'rahbarlar',
            label: '👔 Rahbarlar',
            description: 'Rahbarlar vazifalari - SET so\'rovlarni tasdiqlash',
            tasks: [
                { 
                    key: 'approve_leader', 
                    label: 'Leader sifatida SET so\'rovlarni tasdiqlash',
                    description: 'SET turidagi so\'rovlarni Leader sifatida tasdiqlash huquqi'
                }
            ]
        },
        {
            role: 'menejerlar',
            label: '📋 Menejerlar',
            description: 'Menejerlar vazifalari - yangi so\'rovlar yaratish',
            tasks: [
                { 
                    key: 'create', 
                    label: 'Yangi qarzdorlik so\'rovi yaratish',
                    description: 'Bot orqali yangi qarzdorlik so\'rovi yaratish imkoniyati'
                }
            ]
        },
        {
            role: 'kassirlar',
            label: '💰 Kassirlar',
            description: 'Kassirlar vazifalari - so\'rovlarni tasdiqlash va qarzdorlik ma\'lumotlarini kiritish',
            tasks: [
                { 
                    key: 'approve_cashier', 
                    label: 'Cashier sifatida so\'rovlarni tasdiqlash',
                    description: 'So\'rovlarni Cashier sifatida tasdiqlash huquqi'
                },
                { 
                    key: 'mark_debt', 
                    label: 'Qarzdorlik ma\'lumotlarini kiritish',
                    description: 'Qarzdorlik topilganda Excel, rasm yoki summa kiritish huquqi'
                }
            ]
        },
        {
            role: 'operatorlar',
            label: '⚙️ Operatorlar',
            description: 'Operatorlar vazifalari - so\'rovlarni yakuniy tasdiqlash',
            tasks: [
                { 
                    key: 'approve_operator', 
                    label: 'Operator sifatida so\'rovlarni tasdiqlash',
                    description: 'So\'rovlarni Operator sifatida yakuniy tasdiqlash huquqi'
                }
            ]
        },
        {
            role: 'bloklash',
            label: '🚫 Bloklash va Boshqaruv',
            description: 'Bloklash vazifalari - elementlarni bloklash va ochish',
            tasks: [
                { 
                    key: 'debt:block', 
                    label: 'Elementlarni bloklash',
                    description: 'Brendlar, filiallar va SVR\'larni bloklash huquqi. Bloklangan elementlar bo\'yicha so\'rov yaratib bo\'lmaydi'
                },
                { 
                    key: 'debt:unblock', 
                    label: 'Bloklashni bekor qilish',
                    description: 'Bloklangan elementlarni qayta faollashtirish huquqi. Bloklashni bekor qilgandan keyin element yana so\'rov yaratish uchun mavjud bo\'ladi'
                }
            ]
        }
    ];
    
    // Barcha vazifalarni bitta ro'yxatga yig'ish
    const taskTypes = taskGroups.flatMap(group => 
        group.tasks.map(task => ({ ...task, group: group.role, groupLabel: group.label }))
    );
    
    // Mavjud vazifalarni guruhlash
    const tasksByType = {};
    tasks.forEach(task => {
        if (!tasksByType[task.task_type]) {
            tasksByType[task.task_type] = [];
        }
        tasksByType[task.task_type].push(task);
    });
    
    // Har bir rol guruhini ko'rsatish
    return taskGroups.map(group => {
        const groupTasks = group.tasks.map(task => {
            const existingTasks = tasksByType[task.key] || [];
            const hasTask = existingTasks.length > 0;
            
            return {
                ...task,
                hasTask,
                existingTasks
            };
        });
        
        const hasAnyTask = groupTasks.some(t => t.hasTask);
        
        return `
            <div style="margin-bottom: 20px; padding: 16px; background: ${hasAnyTask ? 'rgba(79, 172, 254, 0.08)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${hasAnyTask ? 'rgba(79, 172, 254, 0.2)' : 'rgba(255,255,255,0.1)'}; border-radius: 12px;">
                <div style="margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 15px; color: ${hasAnyTask ? '#4facfe' : 'rgba(255,255,255,0.9)'}; font-weight: 600; margin-bottom: 4px;">
                        ${group.label}
                    </div>
                    <div style="font-size: 12px; color: rgba(255,255,255,0.6);">
                        ${group.description}
                    </div>
                </div>
                ${groupTasks.map(task => {
                    return `
                        <div style="margin-bottom: 10px; padding: 12px; background: ${task.hasTask ? 'rgba(79, 172, 254, 0.1)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${task.hasTask ? 'rgba(79, 172, 254, 0.3)' : 'rgba(255,255,255,0.1)'}; border-radius: 8px; margin-left: 8px;">
                            <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer;">
                                <input type="checkbox" value="${task.key}" class="user-task-type-checkbox" ${task.hasTask ? 'checked' : ''}
                                       style="width: 18px; height: 18px; cursor: pointer; margin-top: 2px; flex-shrink: 0;"
                                       onchange="toggleTaskType('${task.key}', this.checked)">
                                <div style="flex: 1;">
                                    <div style="font-size: 14px; color: ${task.hasTask ? '#4facfe' : 'rgba(255,255,255,0.9)'}; font-weight: ${task.hasTask ? '600' : '500'}; margin-bottom: 4px;">
                                        ${task.label}
                                    </div>
                                    <div style="font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.4;">
                                        ${task.description}
                                    </div>
                                    ${task.hasTask ? `<div style="margin-top: 6px; font-size: 11px; color: rgba(79, 172, 254, 0.8);">
                                        ✓ ${task.existingTasks.length} ta bog'lanish mavjud
                                    </div>` : ''}
                                </div>
                            </label>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }).join('');
}

// Toggle task type
window.toggleTaskType = function(taskType, checked) {
    const modal = document.getElementById('user-bindings-modal');
    if (!modal) return;
    
    const taskDiv = modal.querySelector(`input[value="${taskType}"].user-task-type-checkbox`).closest('div');
    if (checked) {
        taskDiv.style.background = 'rgba(79, 172, 254, 0.1)';
        taskDiv.style.borderColor = 'rgba(79, 172, 254, 0.3)';
        const span = taskDiv.querySelector('span');
        if (span) {
            span.style.color = '#4facfe';
            span.style.fontWeight = '600';
        }
    } else {
        taskDiv.style.background = 'rgba(255,255,255,0.02)';
        taskDiv.style.borderColor = 'rgba(255,255,255,0.1)';
        const span = taskDiv.querySelector('span');
        if (span) {
            span.style.color = 'rgba(255,255,255,0.7)';
            span.style.fontWeight = '400';
        }
        // Remove count div if exists
        const countDiv = taskDiv.querySelector('div[style*="margin-top: 8px"]');
        if (countDiv) countDiv.remove();
    }
};

/**
 * Filiallar ro'yxatini HTML'ga aylantirish (dublikatlarni olib tashlash bilan)
 * @param {Array} availableBranches - Filiallar ro'yxati
 * @param {Array} bindingsBranches - Tanlangan filiallar (Bindings uchun)
 * @param {Function|null} onChangeHandler - onChange handler (Bindings uchun)
 * @param {string} mode - 'bindings' yoki 'tasks'
 * @returns {string} HTML string
 */
function getUniqueBranchesHTML(availableBranches, bindingsBranches = [], onChangeHandler = null, mode = 'bindings', availableBrands = []) {
    if (availableBranches.length === 0) {
        return '<p style="text-align: center; color: rgba(255,255,255,0.5); padding: 10px; font-size: 13px;">Filiallar topilmadi</p>';
    }
    
    // Original ma'lumotlarni saqlash (log uchun)
    const originalBranches = [...availableBranches];
    
    // Dublikat tekshiruvi - ID bo'yicha (asosiy)
    const uniqueBranchesByIdMap = new Map();
    availableBranches.forEach(branch => {
        if (!uniqueBranchesByIdMap.has(branch.id)) {
            uniqueBranchesByIdMap.set(branch.id, branch);
        } else {
            logger.warn(`[getUniqueBranchesHTML] Filial ID dublikat: ID=${branch.id}, Name=${branch.name}, BrandID=${branch.brand_id}`);
        }
    });
    
    const uniqueBranches = Array.from(uniqueBranchesByIdMap.values());
    
    // Dublikat tekshiruvi va log
    logDuplicates(`Filiallar (${mode === 'bindings' ? 'Bindings' : 'Tasks'})`, originalBranches, uniqueBranches, 'getUniqueBranchesHTML');
    
    // Nom bo'yicha sort qilish
    uniqueBranches.sort((a, b) => {
        const nameCompare = a.name.localeCompare(b.name);
        if (nameCompare !== 0) return nameCompare;
        return (a.brand_id || 0) - (b.brand_id || 0);
    });

    // Filiallar ro'yxatida dublikat bo'lmasligi kerak.
    // Shu sabab filiallarni NOM bo'yicha guruhlaymiz (masalan, "Andijon" bitta chiqadi),
    // lekin keyin saqlashda tanlangan brend(lar)ga mos filial ID'lar expand qilinadi.
    const normalized = (s) => (s || '').toString().trim().toLowerCase();
    const groupsByName = new Map(); // nameKey -> { displayName, branches: [{id, brand_id}] }
    uniqueBranches.forEach(br => {
        const key = normalized(br.name);
        if (!key) return;
        if (!groupsByName.has(key)) {
            groupsByName.set(key, { displayName: br.name, branches: [] });
        }
        groupsByName.get(key).branches.push({ id: br.id, brand_id: br.brand_id });
    });

    const groupedBranches = Array.from(groupsByName.entries())
        .map(([nameKey, group]) => ({ nameKey, ...group }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    
    const renderGrouped = (mode) => {
        const onChangeAttr = (mode === 'bindings' && onChangeHandler)
            ? `onchange="${onChangeHandler}(); updateUserBranchesFilter();"`
            : '';
        
        const cssClass = mode === 'tasks' ? 'user-task-branch-checkbox' : '';
        
        return groupedBranches.map(group => {
            // data-branch-map: "branchId:brandId,branchId:brandId" (expand uchun)
            const branchMap = group.branches.map(x => `${x.id}:${x.brand_id || ''}`).join(',');
            const brandIds = Array.from(new Set(group.branches.map(x => x.brand_id).filter(Boolean))).join(',');
            const checked = group.branches.some(x => bindingsBranches.some(b => b.id === x.id));
            
            return `
                <label style="display: flex; align-items: center; gap: 10px; padding: 8px; cursor: pointer; border-radius: 6px; transition: background 0.2s; margin-bottom: 5px;" 
                       data-brand-ids="${brandIds}"
                       data-branch-map="${branchMap}"
                       data-branch-name="${group.nameKey}"
                       onmouseover="this.style.background='rgba(79, 172, 254, 0.1)'" 
                       onmouseout="this.style.background='transparent'">
                        <input type="checkbox" value="${group.nameKey}" ${checked ? 'checked' : ''} 
                               style="width: 18px; height: 18px; cursor: pointer;" class="${cssClass}" ${onChangeAttr}>
                    <span style="flex: 1; font-size: 14px;">${group.displayName}</span>
                </label>
            `;
        }).join('');
    };
    
    return mode === 'tasks' ? renderGrouped('tasks') : renderGrouped('bindings');
}

function getSelectedBranchIdsFromGroupedBindings(modal) {
    const branchesContainer = modal?.querySelector('#user-bindings-branches');
    const brandsContainer = modal?.querySelector('#user-bindings-brands');
    if (!branchesContainer || !brandsContainer) return [];

    const selectedBrandIds = new Set(
        Array.from(brandsContainer.querySelectorAll('input:checked'))
            .map(cb => parseInt(cb.value, 10))
            .filter(n => !Number.isNaN(n))
    );

    const selected = new Set();
    const selectedInputs = branchesContainer.querySelectorAll('input[type="checkbox"]:checked');
    selectedInputs.forEach(input => {
        const label = input.closest('label');
        const mapStr = label?.getAttribute('data-branch-map') || '';
        if (!mapStr) return;

        mapStr.split(',').forEach(pair => {
            const [idStr, brandStr] = pair.split(':');
            const branchId = parseInt(idStr, 10);
            const brandId = parseInt(brandStr, 10);
            if (Number.isNaN(branchId)) return;

            // Brend(lar) tanlangan bo'lsa, faqat o'sha brendlarga mos filiallarni olamiz
            if (selectedBrandIds.size > 0) {
                if (!Number.isNaN(brandId) && selectedBrandIds.has(brandId)) {
                    selected.add(branchId);
                }
            } else {
                selected.add(branchId);
            }
        });
    });

    return Array.from(selected.values());
}

// Save user bindings
window.saveUserBindings = async function(userId) {
    
    const modal = document.getElementById('user-bindings-modal');
    if (!modal) return;
    
    // Get active tab
    const activeTab = modal.querySelector('.nav-link.active');
    const isTasksTab = activeTab && activeTab.dataset.tab === 'tasks';
    
    if (isTasksTab) {
        // Save tasks - faqat vazifalar, filial va brendlar "Bog'lanishlar" tab'idan olinadi
        const selectedTaskTypes = Array.from(modal.querySelectorAll('#user-tasks-list input.user-task-type-checkbox:checked')).map(cb => cb.value);
        
        // "Bog'lanishlar" tab'idagi filial va brendlarni olish
        const bindingsBrands = Array.from(modal.querySelectorAll('#user-bindings-brands input:checked')).map(cb => parseInt(cb.value));
        const bindingsBranches = getSelectedBranchIdsFromGroupedBindings(modal);
        
        // Kassir va Operator uchun "Bog'lanishlar" tab'idagi filiallarni olish
        const userRole = modal.dataset.userRole || '';
        const isCashier = userRole === 'kassir' || userRole === 'cashier';
        const isOperator = userRole === 'operator';
        
        // Kassir uchun "approve_cashier" yoki Operator uchun "approve_operator" tanlansa, filiallar/brendlar majburiy
        const cashierTasks = ['approve_cashier', 'debt:approve_cashier'];
        const operatorTasks = ['approve_operator', 'debt:approve_operator'];
        // Supervisor task'lari
        const supervisorCashierTasks = ['approve_supervisor_cashier'];
        const supervisorOperatorTasks = ['approve_supervisor_operator'];
        // Bloklash permission'lari uchun brand_id, branch_id, svr_id kerak emas (umumiy permission)
        const blockTasks = ['debt:block', 'debt:unblock', 'debt:admin'];
        const needsBranchSelection = (isCashier && selectedTaskTypes.some(t => cashierTasks.includes(t)));
        const needsBrandSelection = (isOperator && selectedTaskTypes.some(t => operatorTasks.includes(t)));
        const isBlockTask = (taskType) => blockTasks.includes(taskType);
        
        // Create tasks array
        const tasks = [];
        selectedTaskTypes.forEach(taskType => {
            // Bloklash permission'lari uchun - umumiy task (brand_id, branch_id, svr_id yo'q)
            if (isBlockTask(taskType)) {
                tasks.push({
                    task_type: taskType,
                    brand_id: null,
                    branch_id: null,
                    svr_id: null
                });
                return; // Keyingi task'ga o'tish
            }
            
            // Supervisor kasirlarga biriktirilgan
            if (supervisorCashierTasks.includes(taskType)) {
                if (bindingsBranches.length > 0) {
                    // Har bir filial uchun vazifa (kasirlar filial bo'yicha)
                    bindingsBranches.forEach(branchId => {
                        tasks.push({
                            task_type: taskType,
                            brand_id: null,
                            branch_id: branchId,
                            svr_id: null
                        });
                    });
                } else {
                    // Umumiy vazifa (barcha filiallar)
                    tasks.push({
                        task_type: taskType,
                        brand_id: null,
                        branch_id: null,
                        svr_id: null
                    });
                }
                return;
            }
            
            // Supervisor operatorlarga biriktirilgan
            if (supervisorOperatorTasks.includes(taskType)) {
                if (bindingsBrands.length > 0) {
                    // Har bir brend uchun vazifa (operatorlar brend bo'yicha)
                    bindingsBrands.forEach(brandId => {
                        tasks.push({
                            task_type: taskType,
                            brand_id: brandId,
                            branch_id: null,
                            svr_id: null
                        });
                    });
                } else {
                    // Umumiy vazifa (barcha brendlar)
                    tasks.push({
                        task_type: taskType,
                        brand_id: null,
                        branch_id: null,
                        svr_id: null
                    });
                }
                return;
            }
            
            // Kassir uchun filiallar kerak, Operator uchun brendlar kerak
            if (needsBranchSelection && bindingsBranches.length > 0) {
                // Kassir uchun - har bir filial uchun vazifa
                bindingsBranches.forEach(branchId => {
                    tasks.push({
                        task_type: taskType,
                        brand_id: null,
                        branch_id: branchId,
                        svr_id: null
                    });
                });
            } else if (needsBrandSelection && bindingsBrands.length > 0) {
                // Operator uchun - har bir brend uchun vazifa
                bindingsBrands.forEach(brandId => {
                    tasks.push({
                        task_type: taskType,
                        brand_id: brandId,
                        branch_id: null,
                        svr_id: null
                    });
                });
            } else if (bindingsBrands.length > 0 && bindingsBranches.length > 0) {
                // Har bir brend va filial kombinatsiyasi uchun vazifa yaratish
                bindingsBrands.forEach(brandId => {
                    bindingsBranches.forEach(branchId => {
                        tasks.push({
                            task_type: taskType,
                            brand_id: brandId,
                            branch_id: branchId,
                            svr_id: null
                        });
                    });
                });
            } else if (bindingsBrands.length > 0) {
                // Faqat brendlar
                bindingsBrands.forEach(brandId => {
                    tasks.push({
                        task_type: taskType,
                        brand_id: brandId,
                        branch_id: null,
                        svr_id: null
                    });
                });
            } else if (bindingsBranches.length > 0) {
                // Faqat filiallar
                bindingsBranches.forEach(branchId => {
                    tasks.push({
                        task_type: taskType,
                        brand_id: null,
                        branch_id: branchId,
                        svr_id: null
                    });
                });
            } else {
                // Umumiy vazifa (hech qanday cheklov yo'q)
                tasks.push({
                    task_type: taskType,
                    brand_id: null,
                    branch_id: null,
                    svr_id: null
                });
            }
        });
        
        try {
            const res = await safeFetch(`/api/debt-approval/users/${userId}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tasks })
            });
            
            if (!res || !res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Vazifalarni saqlashda xatolik');
            }
            
            showToast('Vazifalar muvaffaqiyatli saqlandi! ✅', false);
            modal.remove();
            
            // Reload users list
            const roleFilter = document.getElementById('debt-users-role-filter');
            await loadDebtUsers(roleFilter ? roleFilter.value : '');
            
        } catch (error) {
            log('❌ saveUserTasks() xatolik:', error);
            showToast(`Vazifalarni saqlashda xatolik: ${error.message}`, true);
        }
    } else {
        // Save bindings (faqat brendlar va filiallar, SVR'lar yo'q)
        // MUHIM: Avtomatik qo'shish OLIB TASHLANDI
        // Faqat foydalanuvchi tanlagan brendlar va filiallar saqlanadi
        const brandsContainer = modal.querySelector('#user-bindings-brands');
        const branchesContainer = modal.querySelector('#user-bindings-branches');
        
        // Faqat tanlangan brendlar va filiallar (avtomatik qo'shish yo'q)
        const selectedBrands = Array.from(brandsContainer.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
        const selectedBranches = getSelectedBranchIdsFromGroupedBindings(modal);
        
        log(`[SAVE_USER_BINDINGS] Saqlash boshlanmoqda: userId=${userId}, brands=${JSON.stringify(selectedBrands)}, branches=${JSON.stringify(selectedBranches)}`);
        
        try {
            const res = await safeFetch(`/api/debt-approval/users/${userId}/bindings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brands: selectedBrands,
                    branches: selectedBranches,
                    svrs: [] // SVR'lar avtomatik chiqadi, shuning uchun bo'sh array
                })
            });
            
            if (!res || !res.ok) {
                const errorData = await res.json();
                log(`[SAVE_USER_BINDINGS] ❌ Xatolik: status=${res.status}, error=${JSON.stringify(errorData)}`);
                throw new Error(errorData.message || 'Bog\'lanishlarni saqlashda xatolik');
            }
            
            const result = await res.json();
            log(`[SAVE_USER_BINDINGS] ✅ Muvaffaqiyatli saqlandi: ${JSON.stringify(result)}`);
            showToast('Bog\'lanishlar muvaffaqiyatli saqlandi! ✅', false);
            modal.remove();
            
            // Reload users list
            const roleFilter = document.getElementById('debt-users-role-filter');
            await loadDebtUsers(roleFilter ? roleFilter.value : '');
            
        } catch (error) {
            log(`[SAVE_USER_BINDINGS] ❌ saveUserBindings() xatolik:`, error);
            showToast(`Bog'lanishlarni saqlashda xatolik: ${error.message}`, true);
        }
    }
};

// ===== ARXIVLASH BO'LIMI =====

/**
 * Arxivlangan so'rovlarni yuklash va ko'rsatish
 */
export async function loadArchivePage() {
    const content = document.getElementById('debt-archive-content');
    if (!content) {
        logger.error('debt-archive-content element topilmadi!');
        return;
    }
    
    try {
        logger.debug('[ARCHIVE_PAGE] Arxiv sahifasi yuklanmoqda...');
        
        // Arxiv statistikasini olish
        const statsRes = await safeFetch(`${API_URL}/archive/stats`, { credentials: 'include' });
        const stats = statsRes && statsRes.ok ? await statsRes.json() : { stats: [] };
        logger.debug('[ARCHIVE_PAGE] Arxiv statistikasi:', stats.stats?.length || 0, 'ta oy');
        
        // Arxivlangan so'rovlarni olish (birinchi sahifa)
        const archiveRes = await safeFetch(`${API_URL}/archive?page=1&limit=10`, { credentials: 'include' });
        const archiveData = archiveRes && archiveRes.ok ? await archiveRes.json() : { data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } };
        logger.debug('[ARCHIVE_PAGE] Arxivlangan so\'rovlar:', archiveData.data?.length || 0, 'ta (jami:', archiveData.pagination?.total || 0, ')');
        
        // Oy va yil tanlash
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
        
        content.innerHTML = `
            <div style="margin-bottom: 30px;">
                <h2 style="margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
                    <i data-feather="archive" style="width: 28px; height: 28px;"></i>
                    So'rovlarni Arxivlash va Boshqarish
                </h2>
                
                <!-- Arxivlash bo'limi -->
                <div class="card" style="margin-bottom: 30px;">
                    <div class="card-header">
                        <h3 class="card-title">
                            <i data-feather="folder-plus" style="width: 20px; height: 20px; margin-right: 8px;"></i>
                            So'rovlarni Arxivlash
                        </h3>
                    </div>
                    <div class="card-body">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                            <div>
                                <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8);">Yil</label>
                                <select id="archive-year-select" class="form-control" style="width: 100%;">
                                    ${Array.from({ length: 5 }, (_, i) => {
                                        const year = currentYear - i;
                                        return `<option value="${year}" ${i === 0 ? 'selected' : ''}>${year}</option>`;
                                    }).join('')}
                                </select>
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.8);">Oy</label>
                                <select id="archive-month-select" class="form-control" style="width: 100%;">
                                    ${Array.from({ length: 12 }, (_, i) => {
                                        const month = (i + 1).toString().padStart(2, '0');
                                        const monthName = getMonthName(month);
                                        return `<option value="${month}" ${i === now.getMonth() ? 'selected' : ''}>${monthName}</option>`;
                                    }).join('')}
                                </select>
                            </div>
                        </div>
                        <button id="archive-requests-btn" class="btn btn-primary" style="width: 100%;">
                            <i data-feather="archive"></i>
                            Tanlangan oy uchun so'rovlarni arxivlash
                        </button>
                    </div>
                </div>
                
                <!-- Arxiv statistikasi -->
                <div class="card" style="margin-bottom: 30px;">
                    <div class="card-header">
                        <h3 class="card-title">
                            <i data-feather="bar-chart-2" style="width: 20px; height: 20px; margin-right: 8px;"></i>
                            Arxiv Statistikasi
                        </h3>
                    </div>
                    <div class="card-body">
                        ${stats.stats && stats.stats.length > 0 ? `
                            <table class="table" style="width: 100%;">
                                <thead>
                                    <tr>
                                        <th>Yil</th>
                                        <th>Oy</th>
                                        <th>So'rovlar soni</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${stats.stats.map(s => `
                                        <tr>
                                            <td>${s.year}</td>
                                            <td>${getMonthName(s.month.toString().padStart(2, '0'))}</td>
                                            <td><strong>${s.count}</strong></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        ` : '<p style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Arxiv statistikasi yo\'q</p>'}
                    </div>
                </div>
                
                <!-- Arxivlangan so'rovlar ro'yxati -->
                <div class="card">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <h3 class="card-title">
                            <i data-feather="list" style="width: 20px; height: 20px; margin-right: 8px;"></i>
                            Arxivlangan So'rovlar
                        </h3>
                        <div style="display: flex; gap: 10px;">
                            <input type="text" id="archive-search-input" placeholder="Qidirish..." class="form-control" style="width: 200px;">
                            <select id="archive-status-filter" class="form-control" style="width: 150px;">
                                <option value="">Barcha statuslar</option>
                                <option value="FINAL_APPROVED">Tasdiqlangan</option>
                                <option value="CANCELLED">Bekor qilingan</option>
                                <option value="REJECTED">Rad etilgan</option>
                            </select>
                        </div>
                    </div>
                    <div class="card-body">
                        <div id="archive-requests-list">
                            ${renderArchiveRequestsList(archiveData.data, archiveData.pagination)}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Event listener'lar
        setupArchiveEventListeners();
        
        // Feather icons
        if (window.feather) {
            feather.replace();
        }
    } catch (error) {
        logger.error('Error loading archive page:', error);
        showToast('Arxiv sahifasini yuklashda xatolik', true);
    }
}

/**
 * Arxivlangan so'rovlar ro'yxatini render qilish
 */
function renderArchiveRequestsList(requests, pagination) {
    if (!requests || requests.length === 0) {
        return '<p style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Arxivlangan so\'rovlar yo\'q</p>';
    }
    
    return `
        <table class="table" style="width: 100%;">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>So'rov UID</th>
                    <th>Brend</th>
                    <th>Filial</th>
                    <th>SVR</th>
                    <th>Status</th>
                    <th>Arxivlangan</th>
                    <th>Amallar</th>
                </tr>
            </thead>
            <tbody>
                ${requests.map(req => `
                    <tr>
                        <td>${req.id}</td>
                        <td><code>${req.request_uid}</code></td>
                        <td>${req.brand_name || 'N/A'}</td>
                        <td>${req.branch_name || 'N/A'}</td>
                        <td>${req.svr_name || 'N/A'}</td>
                        <td>
                            <span class="badge badge-${getStatusBadgeClass(req.status)}">
                                ${req.status}
                            </span>
                        </td>
                        <td>${new Date(req.archived_at).toLocaleDateString('uz-UZ')}</td>
                        <td>
                            <button class="btn btn-sm btn-primary archive-resend-btn" data-id="${req.id}" title="Qayta yuborish">
                                <i data-feather="send"></i>
                            </button>
                            <button class="btn btn-sm btn-danger archive-delete-btn" data-id="${req.id}" title="O'chirish">
                                <i data-feather="trash-2"></i>
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        ${renderArchivePagination(pagination)}
    `;
}

/**
 * Arxiv pagination render qilish
 */
function renderArchivePagination(pagination) {
    if (!pagination || pagination.totalPages <= 1) {
        return '';
    }
    
    const { page, totalPages } = pagination;
    const pages = [];
    
    // Oldingi sahifa
    if (page > 1) {
        pages.push(`<button class="btn btn-sm btn-secondary archive-page-btn" data-page="${page - 1}">Oldingi</button>`);
    }
    
    // Sahifa raqamlari
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
        pages.push(`<button class="btn btn-sm ${i === page ? 'btn-primary' : 'btn-secondary'} archive-page-btn" data-page="${i}">${i}</button>`);
    }
    
    // Keyingi sahifa
    if (page < totalPages) {
        pages.push(`<button class="btn btn-sm btn-secondary archive-page-btn" data-page="${page + 1}">Keyingi</button>`);
    }
    
    return `
        <div style="display: flex; justify-content: center; align-items: center; gap: 10px; margin-top: 20px;">
            ${pages.join('')}
            <span style="color: rgba(255,255,255,0.7); margin-left: 10px;">
                Sahifa ${page} / ${totalPages} (Jami: ${pagination.total})
            </span>
        </div>
    `;
}

/**
 * Status badge class olish
 */
function getStatusBadgeClass(status) {
    if (status.includes('APPROVED')) return 'success';
    if (status.includes('PENDING')) return 'warning';
    if (status.includes('CANCELLED') || status.includes('REJECTED')) return 'danger';
    return 'secondary';
}

/**
 * Arxiv event listener'larini sozlash
 */
function setupArchiveEventListeners() {
    // Arxivlash tugmasi
    const archiveBtn = document.getElementById('archive-requests-btn');
    if (archiveBtn) {
        archiveBtn.addEventListener('click', async () => {
            const year = document.getElementById('archive-year-select')?.value;
            const month = document.getElementById('archive-month-select')?.value;
            
            if (!year || !month) {
                showToast('Yil va oy tanlanishi kerak', true);
                return;
            }
            
            const confirmed = await showConfirmDialog({
                title: '📦 So\'rovlarni Arxivlash',
                message: `<strong>${getMonthName(month)} ${year}</strong> oyi uchun barcha so'rovlarni arxivlashni tasdiqlaysizmi?<br><br><span style="color: rgba(255,255,255,0.6); font-size: 13px;">Bu amal so'rovlarni arxivga ko'chiradi va asl jadvaldan o'chiradi.</span>`,
                confirmText: 'Ha, arxivlash',
                cancelText: 'Bekor qilish',
                type: 'warning',
                icon: 'archive'
            });
            
            if (!confirmed) {
                return;
            }
            
            try {
                logger.debug('[ARCHIVE] Arxivlash boshlanmoqda:', { year, month });
                
                archiveBtn.disabled = true;
                archiveBtn.innerHTML = '<i data-feather="loader"></i> Arxivlanmoqda...';
                if (window.feather) feather.replace();
                
                const res = await safeFetch(`${API_URL}/archive`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ year: parseInt(year), month: parseInt(month), reason: 'manual' }),
                    credentials: 'include'
                });
                
                logger.debug('[ARCHIVE] API javob:', res ? { ok: res.ok, status: res.status } : 'null');
                
                if (res && res.ok) {
                    const data = await res.json();
                    logger.debug('[ARCHIVE] Arxivlash natijasi:', data);
                    
                    if (data.archived > 0) {
                        const monthName = getMonthName(month);
                        const message = `✅ ${data.archived} ta so'rov muvaffaqiyatli arxivlandi!\n\n📅 ${monthName} ${year} oyi\n📊 Jami: ${data.total || data.archived} ta so'rov`;
                        showToast(message, false);
                        
                        // Bildirishnoma ko'rsatish (modal oyna)
                        showArchiveNotification(data);
                    } else {
                        const monthName = getMonthName(month);
                        showToast(`ℹ️ ${monthName} ${year} oyi uchun arxivlash uchun so'rovlar topilmadi (Jami: ${data.total || 0} ta)`, false);
                    }
                    
                    await loadDebtApprovalPage(); // Sahifani yangilash
                } else {
                    const errorData = res ? await res.json().catch(() => ({})) : {};
                    logger.error('[ARCHIVE] API xatolik:', errorData);
                    throw new Error(errorData.message || 'Arxivlashda xatolik');
                }
            } catch (error) {
                logger.error('[ARCHIVE] ❌ Arxivlash xatolik:', error);
                showToast(`Arxivlashda xatolik: ${error.message}`, true);
            } finally {
                archiveBtn.disabled = false;
                archiveBtn.innerHTML = '<i data-feather="archive"></i> Tanlangan oy uchun so\'rovlarni arxivlash';
                if (window.feather) feather.replace();
            }
        });
    }
    
    // Qayta yuborish tugmalari
    document.querySelectorAll('.archive-resend-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            const confirmed = await showConfirmDialog({
                title: '🔄 So\'rovni Qayta Yuborish',
                message: 'Bu so\'rovni qayta yubormoqchimisiz?<br><br><span style="color: rgba(255,255,255,0.6); font-size: 13px;">So\'rov yangi holatda yaratiladi va tasdiqlash jarayoniga qo\'shiladi.</span>',
                confirmText: 'Ha, qayta yuborish',
                cancelText: 'Bekor qilish',
                type: 'info',
                icon: 'refresh-cw'
            });
            
            if (!confirmed) return;
            
            try {
                const res = await safeFetch(`${API_URL}/archive/${id}/resend`, {
                    method: 'POST'
                });
                
                if (res && res.ok) {
                    const data = await res.json();
                    showToast(`So'rov qayta yuborildi: ${data.request_uid} ✅`, false);
                    await loadArchivePage();
                } else {
                    throw new Error('Qayta yuborishda xatolik');
                }
            } catch (error) {
                logger.error('Resend error:', error);
                showToast('Qayta yuborishda xatolik', true);
            }
        });
    });
    
    // O'chirish tugmalari
    document.querySelectorAll('.archive-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            const confirmed = await showConfirmDialog({
                title: '🗑️ So\'rovni O\'chirish',
                message: 'Bu so\'rovni to\'liq o\'chirmoqchimisiz?<br><br><span style="color: rgba(239, 68, 68, 0.9); font-size: 13px; font-weight: 500;">⚠️ Bu amalni qaytarib bo\'lmaydi!</span>',
                confirmText: 'Ha, o\'chirish',
                cancelText: 'Bekor qilish',
                type: 'danger',
                icon: 'trash-2'
            });
            
            if (!confirmed) return;
            
            try {
                const res = await safeFetch(`${API_URL}/archive/${id}`, {
                    method: 'DELETE'
                });
                
                if (res && res.ok) {
                    showToast('So\'rov to\'liq o\'chirildi ✅', false);
                    await loadArchivePage();
                } else {
                    throw new Error('O\'chirishda xatolik');
                }
            } catch (error) {
                logger.error('Delete error:', error);
                showToast('O\'chirishda xatolik', true);
            }
        });
    });
    
    // Pagination tugmalari
    document.querySelectorAll('.archive-page-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const page = btn.getAttribute('data-page');
            await loadArchivePageWithPagination(page);
        });
    });
    
    // Qidirish va filtrlash
    const searchInput = document.getElementById('archive-search-input');
    const statusFilter = document.getElementById('archive-status-filter');
    
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                loadArchivePageWithFilters();
            }, 500);
        });
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            loadArchivePageWithFilters();
        });
    }
}

/**
 * Arxiv sahifasini pagination bilan yuklash
 */
async function loadArchivePageWithPagination(page) {
    const statusFilter = document.getElementById('archive-status-filter')?.value || '';
    const searchQuery = document.getElementById('archive-search-input')?.value || '';
    
    try {
        let url = `${API_URL}/archive?page=${page}&limit=10`;
        if (statusFilter) url += `&status=${statusFilter}`;
        
        const res = await safeFetch(url);
        if (res && res.ok) {
            const data = await res.json();
            const listContainer = document.getElementById('archive-requests-list');
            if (listContainer) {
                listContainer.innerHTML = renderArchiveRequestsList(data.data, data.pagination);
                setupArchiveEventListeners(); // Event listener'larni qayta sozlash
                if (window.feather) feather.replace();
            }
        }
    } catch (error) {
        logger.error('Error loading archive page:', error);
        showToast('Sahifani yuklashda xatolik', true);
    }
}

/**
 * Arxiv sahifasini filtrlash bilan yuklash
 */
async function loadArchivePageWithFilters() {
    await loadArchivePageWithPagination(1);
}

/**
 * Arxivlash bildirishnomasi (modal oyna)
 */
function showArchiveNotification(data) {
    let modal = document.getElementById('debt-archive-notification-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'debt-archive-notification-modal';
        modal.className = 'modal hidden';
        document.body.appendChild(modal);
    }
    
    const monthName = getMonthName(data.month?.toString().padStart(2, '0') || '');
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <button class="close-modal-btn" onclick="document.getElementById('debt-archive-notification-modal').classList.add('hidden')">
                <i data-feather="x"></i>
            </button>
            
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px;">
                <div style="width: 50px; height: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                    <i data-feather="archive" style="width: 28px; height: 28px; color: white;"></i>
                </div>
                <div>
                    <h3 style="margin: 0; font-size: 24px; font-weight: 700; color: white;">Arxivlash Muvaffaqiyatli</h3>
                    <p style="margin: 5px 0 0 0; font-size: 14px; color: rgba(255,255,255,0.6);">So'rovlar arxivga ko'chirildi</p>
                </div>
            </div>
            
            <div style="background: rgba(0,0,0,0.2); padding: 20px; border-radius: 12px; margin-bottom: 25px; border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
                    <div>
                        <p style="margin: 0; font-size: 12px; color: rgba(255,255,255,0.6);">Arxivlangan so'rovlar</p>
                        <p style="margin: 5px 0 0 0; font-size: 24px; font-weight: 700; color: #4facfe;">${data.archived || 0}</p>
                    </div>
                    <div>
                        <p style="margin: 0; font-size: 12px; color: rgba(255,255,255,0.6);">Oy va Yil</p>
                        <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: 600; color: rgba(255,255,255,0.9);">${monthName} ${data.year || ''}</p>
                    </div>
                </div>
            </div>
            
            <div style="background: rgba(79, 172, 254, 0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 3px solid #4facfe;">
                <p style="margin: 0; color: rgba(255,255,255,0.9); font-size: 13px;">
                    <strong>ℹ️ Eslatma:</strong> Arxivlangan so'rovlar "So'rovlarni Qaytadan Faollashtirish" bo'limida ko'rinadi va kerak bo'lganda qaytadan faollashtirilishi mumkin.
                </p>
            </div>
            
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button type="button" class="btn btn-primary" onclick="document.getElementById('debt-archive-notification-modal').classList.add('hidden')">
                    <i data-feather="check"></i> Tushundim
                </button>
            </div>
        </div>
    `;
    
    if (window.feather) feather.replace();
    modal.classList.remove('hidden');
}

/**
 * O'zgartirilgan ma'lumotlarni tasdiqlash modal oynasi
 */
function showChangesConfirmationModal(changes, filePath, errors) {
    let modal = document.getElementById('debt-changes-confirmation-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'debt-changes-confirmation-modal';
        modal.className = 'modal hidden';
        document.body.appendChild(modal);
    }
    
    // O'zgartirilgan ma'lumotlar ro'yxati
    const changesList = changes.map((change, index) => `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
            <td style="padding: 12px; text-align: center;">${index + 1}</td>
            <td style="padding: 12px;">${change.brand}</td>
            <td style="padding: 12px;">${change.branch}</td>
            <td style="padding: 12px;">${change.svr}</td>
        </tr>
    `).join('');
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
            <button class="close-modal-btn" onclick="document.getElementById('debt-changes-confirmation-modal').classList.add('hidden')">
                <i data-feather="x"></i>
            </button>
            
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px;">
                <div style="width: 50px; height: 50px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                    <i data-feather="alert-triangle" style="width: 28px; height: 28px; color: white;"></i>
                </div>
                <div>
                    <h3 style="margin: 0; font-size: 24px; font-weight: 700; color: white;">O'zgartirilgan Ma'lumotlar</h3>
                    <p style="margin: 5px 0 0 0; font-size: 14px; color: rgba(255,255,255,0.6);">${changes.length} ta mavjud ma'lumot topildi. Tasdiqlash kerak.</p>
                </div>
            </div>
            
            <!-- O'zgartirilgan ma'lumotlar ro'yxati -->
            <div style="background: rgba(0,0,0,0.2); padding: 20px; border-radius: 12px; margin-bottom: 25px; border: 1px solid rgba(255,255,255,0.1);">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: rgba(255,255,255,0.05); border-bottom: 2px solid rgba(255,255,255,0.2);">
                            <th style="padding: 12px; text-align: center; font-weight: 600; color: rgba(255,255,255,0.9);">#</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; color: rgba(255,255,255,0.9);">Brend</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; color: rgba(255,255,255,0.9);">Filial</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; color: rgba(255,255,255,0.9);">SVR (FISH)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${changesList}
                    </tbody>
                </table>
            </div>
            
            ${errors && errors.length > 0 ? `
                <div style="background: rgba(255, 0, 0, 0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 3px solid #ff6b6b;">
                    <p style="margin: 0; color: #ff6b6b; font-weight: 600;">Xatoliklar:</p>
                    <ul style="margin: 10px 0 0 0; padding-left: 20px; color: rgba(255,255,255,0.8);">
                        ${errors.map(err => `<li>${err}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            
            <!-- Tugmalar -->
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('debt-changes-confirmation-modal').classList.add('hidden')">
                    <i data-feather="x"></i> Bekor qilish
                </button>
                <button type="button" class="btn btn-success" id="debt-confirm-changes-btn">
                    <i data-feather="check"></i> Tasdiqlash va Yangilash
                </button>
            </div>
        </div>
    `;
    
    // Event listener
    const confirmBtn = document.getElementById('debt-confirm-changes-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            try {
                confirmBtn.disabled = true;
                confirmBtn.innerHTML = '<i data-feather="loader"></i> Yangilanmoqda...';
                if (window.feather) feather.replace();
                
                const response = await safeFetch(`${API_URL}/export/update/confirm`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ filePath }),
                    credentials: 'include'
                });
                
                if (!response || !response.ok) {
                    const errorData = response ? await response.json().catch(() => ({})) : {};
                    throw new Error(errorData.message || 'Yangilashda xatolik');
                }
                
                const result = await response.json();
                
                if (result.success) {
                    showToast(`Ma'lumotlar yangilandi: ${result.updated} yangilandi, ${result.created} yaratildi ✅`, false);
                    modal.classList.add('hidden');
                    // Sahifani yangilash
                    await loadDebtApprovalPage();
                } else {
                    throw new Error(result.message || 'Yangilashda xatolik');
                }
            } catch (error) {
                logger.error('Confirm changes error:', error);
                showToast(`Yangilashda xatolik: ${error.message}`, true);
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i data-feather="check"></i> Tasdiqlash va Yangilash';
                if (window.feather) feather.replace();
            }
        });
    }
    
    if (window.feather) feather.replace();
    modal.classList.remove('hidden');
}

