// public/modules/debt-settings.js
// Debt-approval sozlamalari moduli

import { safeFetch } from './api.js';
import { showToast } from './utils.js';

const API_URL = '/api/debt-approval/settings';
const GROUPS_API_URL = '/api/debt-approval/groups';

/**
 * Debt settings modalini ko'rsatish
 */
export function showDebtSettingsModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'debt-settings-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px;">
            <div class="modal-header">
                <h2>⚙️ Debt-Approval Sozlamalari</h2>
                <button class="modal-close" onclick="closeDebtSettingsModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="settings-section">
                    <h3>📁 Fayl Sozlamalari</h3>
                    <div class="form-group">
                        <label>Maksimal fayl hajmi (MB):</label>
                        <input type="number" id="max-file-size" class="form-control" min="1" max="50" placeholder="20">
                        <small class="text-muted">Telegram maksimali: 50 MB</small>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>⏰ Eslatma Sozlamalari</h3>
                    <div class="form-group">
                        <label>Eslatma intervali (daqiqa):</label>
                        <input type="number" id="reminder-interval" class="form-control" min="5" max="1440" placeholder="30">
                    </div>
                    <div class="form-group">
                        <label>Eslatma maksimal soni:</label>
                        <input type="number" id="reminder-max-count" class="form-control" min="1" max="10" placeholder="3">
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>📊 Excel Ustun Nomlari</h3>
                    <div class="form-group">
                        <label>Brend ustuni:</label>
                        <input type="text" id="excel-column-brand" class="form-control" placeholder="Brend">
                    </div>
                    <div class="form-group">
                        <label>Filial ustuni:</label>
                        <input type="text" id="excel-column-branch" class="form-control" placeholder="Filial">
                    </div>
                    <div class="form-group">
                        <label>SVR FISH ustuni:</label>
                        <input type="text" id="excel-column-svr" class="form-control" placeholder="SVR FISH">
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>👥 Telegram Guruhlari</h3>
                    <div class="form-group">
                        <label>Rahbarlar guruhi ID:</label>
                        <input type="number" id="leaders-group-id" class="form-control" placeholder="Guruh ID">
                        <input type="text" id="leaders-group-name" class="form-control" placeholder="Guruh nomi" style="margin-top: 5px;">
                    </div>
                    <div class="form-group">
                        <label>Operatorlar guruhi ID:</label>
                        <input type="number" id="operators-group-id" class="form-control" placeholder="Guruh ID">
                        <input type="text" id="operators-group-name" class="form-control" placeholder="Guruh nomi" style="margin-top: 5px;">
                    </div>
                    <div class="form-group">
                        <label>Final guruh ID:</label>
                        <input type="number" id="final-group-id" class="form-control" placeholder="Guruh ID">
                        <input type="text" id="final-group-name" class="form-control" placeholder="Guruh nomi" style="margin-top: 5px;">
                    </div>
                </div>
                
                <div class="settings-actions">
                    <button class="btn btn-primary" onclick="saveDebtSettings()">💾 Saqlash</button>
                    <button class="btn btn-secondary" onclick="closeDebtSettingsModal()">❌ Bekor qilish</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Sozlamalarni yuklash
    loadDebtSettings();
}

/**
 * Sozlamalarni yuklash
 */
async function loadDebtSettings() {
    try {
        const res = await safeFetch(API_URL);
        
        if (!res || !res.ok) {
            showToast('Sozlamalarni yuklashda xatolik', 'error');
            return;
        }
        
        const settings = await res.json();
        
        // Form'ni to'ldirish
        document.getElementById('max-file-size').value = settings.max_file_size_mb || 20;
        document.getElementById('reminder-interval').value = settings.debt_reminder_interval || 30;
        document.getElementById('reminder-max-count').value = settings.debt_reminder_max_count || 3;
        document.getElementById('excel-column-brand').value = settings.excel_column_brand || 'Brend';
        document.getElementById('excel-column-branch').value = settings.excel_column_branch || 'Filial';
        document.getElementById('excel-column-svr').value = settings.excel_column_svr || 'SVR FISH';
        document.getElementById('leaders-group-id').value = settings.leaders_group_id || '';
        document.getElementById('leaders-group-name').value = settings.leaders_group_name || '';
        document.getElementById('operators-group-id').value = settings.operators_group_id || '';
        document.getElementById('operators-group-name').value = settings.operators_group_name || '';
        document.getElementById('final-group-id').value = settings.final_group_id || '';
        document.getElementById('final-group-name').value = settings.final_group_name || '';
    } catch (error) {
        console.error('Error loading debt settings:', error);
        showToast('Sozlamalarni yuklashda xatolik', 'error');
    }
}

/**
 * Sozlamalarni saqlash
 */
window.saveDebtSettings = async function() {
    try {
        const settings = {
            max_file_size_mb: parseInt(document.getElementById('max-file-size').value) || 20,
            debt_reminder_interval: parseInt(document.getElementById('reminder-interval').value) || 30,
            debt_reminder_max_count: parseInt(document.getElementById('reminder-max-count').value) || 3,
            excel_column_brand: document.getElementById('excel-column-brand').value || 'Brend',
            excel_column_branch: document.getElementById('excel-column-branch').value || 'Filial',
            excel_column_svr: document.getElementById('excel-column-svr').value || 'SVR FISH',
            leaders_group_id: document.getElementById('leaders-group-id').value || '',
            leaders_group_name: document.getElementById('leaders-group-name').value || '',
            operators_group_id: document.getElementById('operators-group-id').value || '',
            operators_group_name: document.getElementById('operators-group-name').value || '',
            final_group_id: document.getElementById('final-group-id').value || '',
            final_group_name: document.getElementById('final-group-name').value || ''
        };
        
        // Validatsiya
        if (settings.max_file_size_mb > 50) {
            showToast('Maksimal fayl hajmi 50 MB dan oshmasligi kerak', 'error');
            return;
        }
        
        showToast('Saqlanmoqda...', 'info');
        
        const res = await safeFetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        if (!res || !res.ok) {
            const error = await res.json();
            showToast(error.message || 'Sozlamalarni saqlashda xatolik', 'error');
            return;
        }
        
        const result = await res.json();
        
        if (result.success) {
            showToast('Sozlamalar muvaffaqiyatli saqlandi', 'success');
            closeDebtSettingsModal();
        } else {
            showToast(result.message || 'Sozlamalarni saqlashda xatolik', 'error');
        }
    } catch (error) {
        console.error('Error saving debt settings:', error);
        showToast('Sozlamalarni saqlashda xatolik', 'error');
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

