// API Service Module
// Barcha API so'rovlari va safeFetch funksiyasi

import { showToast } from './utils.js';

export const safeFetch = async (url, options) => {
    try {
        const response = await fetch(url, options);
        if (response.status === 401 || response.status === 403) {
            const errorData = await response.json();
            if (errorData.action === 'logout') {
                showToast(errorData.message, true);
                setTimeout(() => window.location.href = '/login', 2000);
            } else if (errorData.action === 'force_telegram_subscription') {
                document.body.innerHTML = `
                    <div class="login-page" style="height: 100vh;">
                        <div class="login-container" style="max-width: 500px;">
                            <h2 style="color: var(--red-color);">Xatolik</h2>
                            <p class="login-description">${errorData.message}</p>
                            ${errorData.subscription_link ? `<a href="${errorData.subscription_link}" target="_blank" class="btn btn-primary" style="width: 100%;">Botga Obuna Bo'lish</a>` : ''}
                            <a href="/login" class="btn btn-secondary" style="width: 100%; margin-top: 10px;">Qaytadan Kirish</a>
                        </div>
                    </div>`;
            }
            return null; 
        }
        return response;
    } catch (error) {
        showToast("Server bilan bog'lanishda xatolik.", true);
        return null;
    }
};

// API funksiyalari
export async function fetchCurrentUser() {
    const res = await safeFetch('/api/auth/current-user');
    if (!res || !res.ok) return null;
    return await res.json();
}

export async function fetchSettings() {
    const res = await safeFetch('/api/settings');
    if (!res || !res.ok) return null;
    return await res.json();
}

export async function fetchUsers() {
    const res = await safeFetch('/api/users');
    if (!res || !res.ok) return null;
    return await res.json();
}

export async function fetchPendingUsers() {
    const res = await safeFetch('/api/users/pending');
    if (!res || !res.ok) return null;
    return await res.json();
}

export async function fetchRoles() {
    const res = await safeFetch('/api/roles');
    if (!res || !res.ok) return null;
    return await res.json();
}

export async function logout() {
    await safeFetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
}
