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
            <input type="text" class="special-requests-label" placeholder="Bo'lim (masalan: SOF)" value="${escapeHtml(row.label || '')}">
            <input type="text" class="special-requests-username" placeholder="@username" value="${escapeHtml(row.username || '')}">
            <button type="button" class="btn btn-danger btn-sm special-requests-remove-row" data-index="${index}" title="O'chirish"><i data-feather="trash-2"></i></button>
        `;
        container.appendChild(div);
    });
    if (typeof feather !== 'undefined') feather.replace();
}

function renderFilialRows(filialButtons) {
    const container = DOM.specialRequestsFilialContainer;
    if (!container) return;
    container.innerHTML = '';
    (filialButtons || []).forEach((row, index) => {
        const div = document.createElement('div');
        div.className = 'special-requests-row';
        div.innerHTML = `
            <input type="text" class="special-requests-filial-label" placeholder="Filial (masalan: BOZ)" value="${escapeHtml(row.label || '')}">
            <input type="text" class="special-requests-filial-username" placeholder="@username" value="${escapeHtml(row.username || '')}">
            <button type="button" class="btn btn-danger btn-sm special-requests-filial-remove-row" data-index="${index}" title="O'chirish"><i data-feather="trash-2"></i></button>
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

/** Faqat raqamlardan iborat qatorni olish (bo'shliq, vergul olib tashlanadi) */
function parseSumRaw(str) {
    if (str == null) return '';
    return String(str).replace(/\s/g, '').replace(/,/g, '').replace(/\D/g, '');
}

/** Raqamni 3 xonali guruhda ko'rsatish (10 000 000) */
function formatSumDisplay(str) {
    const raw = parseSumRaw(str);
    if (!raw) return '';
    return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Summa inputini 3 xonali formatda yangilash (kiritilganda va blur da) */
function formatSumInputOnInput(el) {
    if (!el) return;
    const start = el.selectionStart;
    const oldVal = el.value;
    const raw = parseSumRaw(oldVal);
    const formatted = formatSumDisplay(raw);
    if (oldVal === formatted) return;
    const digitsBeforeCursor = (oldVal.slice(0, start).match(/\d/g) || []).length;
    el.value = formatted;
    let pos = 0;
    let digits = 0;
    for (; pos < formatted.length && digits < digitsBeforeCursor; pos++) {
        if (/\d/.test(formatted[pos])) digits++;
    }
    el.setSelectionRange(pos, pos);
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

function collectFilialButtons() {
    const container = DOM.specialRequestsFilialContainer;
    if (!container) return [];
    const rows = container.querySelectorAll('.special-requests-row');
    const buttons = [];
    rows.forEach((row) => {
        const labelInp = row.querySelector('.special-requests-filial-label');
        const usernameInp = row.querySelector('.special-requests-filial-username');
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

function addFilialRow() {
    const buttons = collectFilialButtons();
    buttons.push({ label: '', username: '' });
    renderFilialRows(buttons);
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

function bindFilialRemoveRows() {
    if (!DOM.specialRequestsFilialContainer) return;
    DOM.specialRequestsFilialContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.special-requests-filial-remove-row');
        if (!btn) return;
        const buttons = collectFilialButtons();
        const index = parseInt(btn.getAttribute('data-index'), 10);
        if (!Number.isNaN(index) && index >= 0 && index < buttons.length) {
            buttons.splice(index, 1);
            renderFilialRows(buttons);
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
        if (DOM.specialRequestsSumFilterType) DOM.specialRequestsSumFilterType.value = config.sumFilterType || '';
        if (DOM.specialRequestsSumFilterValue) DOM.specialRequestsSumFilterValue.value = formatSumDisplay(config.sumFilterValue || '');
        renderButtonsRows(config.buttons || []);
        renderFilialRows(config.filialButtons || []);
    } catch (err) {
        showToast(err.message || 'Yuklashda xatolik', 'error');
    }
}

function bindSpecialRequestsSave() {
    if (!DOM.specialRequestsSaveBtn) return;
    DOM.specialRequestsSaveBtn.addEventListener('click', async () => {
        const enabled = DOM.specialRequestsBotEnabled ? DOM.specialRequestsBotEnabled.checked : false;
        const tokenRaw = DOM.specialRequestsBotToken ? DOM.specialRequestsBotToken.value.trim() : '';
        const groupId = DOM.specialRequestsGroupId ? DOM.specialRequestsGroupId.value.trim() : '';
        const sumFilterType = DOM.specialRequestsSumFilterType ? DOM.specialRequestsSumFilterType.value.trim() : '';
        const sumFilterValueRaw = DOM.specialRequestsSumFilterValue ? DOM.specialRequestsSumFilterValue.value : '';
        const sumFilterValue = parseSumRaw(sumFilterValueRaw);
        const buttons = collectButtons();
        const filialButtons = collectFilialButtons();

        // Token faqat yangi kiritilganda yuboriladi (bo'sh yoki placeholder bo'lsa yuborilmaydi – bazadagi saqlanadi)
        const isPlaceholderOrEmpty = !tokenRaw || tokenRaw === '••••••••' || tokenRaw.includes('...');
        if (!isPlaceholderOrEmpty && tokenRaw.length < 20) {
            showToast('Token noto\'g\'ri', 'error');
            return;
        }
        const payload = { enabled, groupId, buttons, filialButtons, sumFilterType, sumFilterValue };
        if (!isPlaceholderOrEmpty) payload.token = tokenRaw;

        try {
            await saveConfig(payload);
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
    bindFilialRemoveRows();
    if (DOM.specialRequestsAddRowBtn) {
        DOM.specialRequestsAddRowBtn.addEventListener('click', addRow);
    }
    if (DOM.specialRequestsAddFilialRowBtn) {
        DOM.specialRequestsAddFilialRowBtn.addEventListener('click', addFilialRow);
    }
    bindSpecialRequestsSave();
    if (DOM.specialRequestsSumFilterValue) {
        DOM.specialRequestsSumFilterValue.addEventListener('input', () => formatSumInputOnInput(DOM.specialRequestsSumFilterValue));
        DOM.specialRequestsSumFilterValue.addEventListener('blur', () => formatSumInputOnInput(DOM.specialRequestsSumFilterValue));
    }
    loadSpecialRequestsPage();
}
