import { DOM } from './dom.js';
import { state } from './state.js';
import { showToast } from './utils.js';

const API_BASE = '/api';

async function getConfig() {
    const res = await fetch(`${API_BASE}/special-requests/config`, { credentials: 'include' });
    if (!res.ok) throw new Error('Sozlamalarni yuklashda xatolik');
    return res.json();
}

async function saveConfig(payload) {
    const res = await fetch(`${API_BASE}/special-requests/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Saqlashda xatolik');
    }
    return res.json();
}

function renderButtonsRows(buttons) {
    const container = DOM.specialRequestsButtonsContainer;
    if (!container) return;
    container.innerHTML = '';
    (buttons || []).forEach((row, index) => {
        const div = document.createElement('div');
        div.className = 'special-requests-row';
        div.innerHTML = `
            <input type="text" class="special-requests-label" placeholder="Bo'lim (masalan: LLK)" value="${escapeHtml(row.label || '')}">
            <input type="text" class="special-requests-username" placeholder="@username" value="${escapeHtml(row.username || '')}">
            <button type="button" class="btn btn-danger btn-sm special-requests-remove-row" data-index="${index}" title="O'chirish"><i data-feather="trash-2"></i></button>
        `;
        container.appendChild(div);
    });
    if (typeof feather !== 'undefined') feather.replace();
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
}

function collectButtons() {
    const container = DOM.specialRequestsButtonsContainer;
    if (!container) return [];
    const rows = container.querySelectorAll('.special-requests-row');
    const buttons = [];
    rows.forEach((row) => {
        const labelInp = row.querySelector('.special-requests-label');
        const usernameInp = row.querySelector('.special-requests-username');
        const label = labelInp ? labelInp.value.trim() : '';
        const username = usernameInp ? usernameInp.value.trim() : '';
        if (label || username) buttons.push({ label, username });
    });
    return buttons;
}

function addRow() {
    const buttons = collectButtons();
    buttons.push({ label: '', username: '' });
    renderButtonsRows(buttons);
}

function bindRemoveRows() {
    if (!DOM.specialRequestsButtonsContainer) return;
    DOM.specialRequestsButtonsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.special-requests-remove-row');
        if (!btn) return;
        const buttons = collectButtons();
        const index = parseInt(btn.getAttribute('data-index'), 10);
        if (!Number.isNaN(index) && index >= 0 && index < buttons.length) {
            buttons.splice(index, 1);
            renderButtonsRows(buttons);
        }
    });
}

export async function loadSpecialRequestsPage() {
    try {
        const config = await getConfig();
        if (DOM.specialRequestsBotEnabled) DOM.specialRequestsBotEnabled.checked = config.enabled === true;
        if (DOM.specialRequestsBotToken) {
            DOM.specialRequestsBotToken.value = '';
            DOM.specialRequestsBotToken.placeholder = config.tokenSet ? '••••••••' : 'Token';
        }
        if (DOM.specialRequestsGroupId) DOM.specialRequestsGroupId.value = config.groupId || '';
        renderButtonsRows(config.buttons || []);
    } catch (err) {
        showToast(err.message || 'Yuklashda xatolik', 'error');
    }
}

function bindSpecialRequestsSave() {
    if (!DOM.specialRequestsSaveBtn) return;
    DOM.specialRequestsSaveBtn.addEventListener('click', async () => {
        const enabled = DOM.specialRequestsBotEnabled ? DOM.specialRequestsBotEnabled.checked : false;
        let token = DOM.specialRequestsBotToken ? DOM.specialRequestsBotToken.value.trim() : '';
        const groupId = DOM.specialRequestsGroupId ? DOM.specialRequestsGroupId.value.trim() : '';
        const buttons = collectButtons();

        if (token.length > 0 && token.length < 20) {
            showToast('Token noto\'g\'ri', 'error');
            return;
        }
        if (token === '' || token === '••••••••' || token.includes('...')) token = undefined;

        try {
            await saveConfig({ enabled, token, groupId, buttons });
            showToast('Saqlandi', 'success');
            loadSpecialRequestsPage();
        } catch (err) {
            showToast(err.message || 'Saqlashda xatolik', 'error');
        }
    });
}

export function initSpecialRequestsPage() {
    if (state.specialRequestsInitialized) {
        loadSpecialRequestsPage();
        return;
    }
    state.specialRequestsInitialized = true;
    bindRemoveRows();
    if (DOM.specialRequestsAddRowBtn) {
        DOM.specialRequestsAddRowBtn.addEventListener('click', addRow);
    }
    bindSpecialRequestsSave();
    loadSpecialRequestsPage();
}
