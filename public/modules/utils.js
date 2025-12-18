// Utils Module
// Yordamchi funksiyalar va konstantalar

import { DOM } from './dom.js';

export const ACTION_DEFINITIONS = {
    'login_success': { text: "Tizimga kirdi", icon: 'log-in', color: 'var(--green-color)' },
    'login_fail': { text: "Kirishda xatolik", icon: 'alert-triangle', color: 'var(--yellow-color)' },
    'logout': { text: "Tizimdan chiqdi", icon: 'log-out', color: '#6c757d' },
    'account_lock': { text: "Akkaunt bloklandi", icon: 'lock', color: 'var(--red-color)' },
    'create_report': { text: "hisobot yaratdi", icon: 'file-plus', color: 'var(--blue-color)' },
    'edit_report': { text: "hisobotni tahrirladi", icon: 'edit', color: 'var(--cyan-color)' },
    'delete_report': { text: "hisobotni o'chirdi", icon: 'trash-2', color: 'var(--red-color)' },
    'create_user': { text: "foydalanuvchi yaratdi", icon: 'user-plus', color: 'var(--blue-color)' },
    'update_user': { text: "foydalanuvchini yangiladi", icon: 'user-check', color: 'var(--cyan-color)' },
    'update_user_locations': { text: "filiallarini o'zgartirdi", icon: 'map-pin', color: 'var(--cyan-color)' },
    'activate_user': { text: "foydalanuvchini aktivladi", icon: 'user-check', color: 'var(--green-color)' },
    'deactivate_user': { text: "foydalanuvchini blokladi", icon: 'user-x', color: 'var(--yellow-color)' },
    'change_password': { text: "parolni o'zgartirdi", icon: 'key', color: 'var(--purple-color)' },
    'set_secret_word': { text: "maxfiy so'z o'rnatdi", icon: 'shield', color: 'var(--purple-color)' },
    '2fa_sent': { text: "2FA so'rovi yubordi", icon: 'send', color: 'var(--orange-color)' },
    '2fa_success': { text: "2FA tasdiqlandi", icon: 'check-shield', color: 'var(--green-color)' },
    '2fa_fail': { text: "2FA xatosi", icon: 'alert-octagon', color: 'var(--red-color)' },
    'update_permissions': { text: "rol huquqlarini o'zgartirdi", icon: 'sliders', color: 'var(--purple-color)' },
    'update_settings': { text: "sozlamalarni yangiladi", icon: 'settings', color: 'var(--cyan-color)' },
    'approve_user': { text: "foydalanuvchi so'rovini tasdiqladi", icon: 'user-check', color: 'var(--green-color)' },
    'reject_user': { text: "so'rovni rad etdi", icon: 'user-x', color: 'var(--red-color)' },
};

export function showToast(message, isError = false) {
    if (!DOM.toast) return;
    DOM.toast.textContent = message;
    DOM.toast.className = `toast ${isError ? 'error' : ''}`;
    setTimeout(() => { 
        DOM.toast.className = `toast ${isError ? 'error' : ''} hidden`; 
    }, 3000);
}

export function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

export function parseUserAgent(uaString) {
    if (!uaString) return { 
        browser: 'Noma\'lum', 
        browserVersion: '',
        browserFull: 'Noma\'lum',
        os: 'Noma\'lum',
        osVersion: '',
        osFull: 'Noma\'lum',
        device: 'desktop',
        deviceIcon: '💻'
    };
    
    let browser = 'Noma\'lum';
    let browserVersion = '';
    let os = 'Noma\'lum';
    let osVersion = '';
    let device = 'desktop';
    let deviceIcon = '💻';
    
    // OS aniqlash - batafsilroq
    if (uaString.includes('Windows NT 10.0')) {
        os = 'Windows';
        osVersion = '10/11';
        deviceIcon = '🖥️';
    } else if (uaString.includes('Windows NT 6.3')) {
        os = 'Windows';
        osVersion = '8.1';
        deviceIcon = '🖥️';
    } else if (uaString.includes('Windows NT 6.2')) {
        os = 'Windows';
        osVersion = '8';
        deviceIcon = '🖥️';
    } else if (uaString.includes('Windows NT 6.1')) {
        os = 'Windows';
        osVersion = '7';
        deviceIcon = '🖥️';
    } else if (uaString.includes('Mac OS X')) {
        os = 'macOS';
        const macVersionMatch = uaString.match(/Mac OS X ([0-9_]+)/);
        if (macVersionMatch) {
            osVersion = macVersionMatch[1].replace(/_/g, '.');
        }
        deviceIcon = '🍎';
        device = 'desktop';
    } else if (uaString.includes('Android')) {
        os = 'Android';
        const androidVersionMatch = uaString.match(/Android ([0-9.]+)/);
        if (androidVersionMatch) {
            osVersion = androidVersionMatch[1];
        }
        deviceIcon = '📱';
        device = 'mobile';
    } else if (uaString.includes('iPhone')) {
        os = 'iOS';
        const iOSVersionMatch = uaString.match(/OS ([0-9_]+)/);
        if (iOSVersionMatch) {
            osVersion = iOSVersionMatch[1].replace(/_/g, '.');
        }
        deviceIcon = '📱';
        device = 'mobile';
    } else if (uaString.includes('iPad')) {
        os = 'iPadOS';
        const iPadVersionMatch = uaString.match(/OS ([0-9_]+)/);
        if (iPadVersionMatch) {
            osVersion = iPadVersionMatch[1].replace(/_/g, '.');
        }
        deviceIcon = '📱';
        device = 'tablet';
    } else if (uaString.includes('Linux')) {
        os = 'Linux';
        deviceIcon = '🐧';
    }
    
    // Brauzer aniqlash - batafsilroq versiyalar bilan
    if (uaString.includes('Edg/')) {
        browser = 'Edge';
        const edgeVersionMatch = uaString.match(/Edg\/([0-9.]+)/);
        if (edgeVersionMatch) {
            browserVersion = edgeVersionMatch[1];
        }
    } else if (uaString.includes('Chrome/') && !uaString.includes('Edg/')) {
        browser = 'Chrome';
        const chromeVersionMatch = uaString.match(/Chrome\/([0-9.]+)/);
        if (chromeVersionMatch) {
            browserVersion = chromeVersionMatch[1];
        }
    } else if (uaString.includes('Firefox/')) {
        browser = 'Firefox';
        const firefoxVersionMatch = uaString.match(/Firefox\/([0-9.]+)/);
        if (firefoxVersionMatch) {
            browserVersion = firefoxVersionMatch[1];
        }
    } else if (uaString.includes('Safari/') && !uaString.includes('Chrome/')) {
        browser = 'Safari';
        const safariVersionMatch = uaString.match(/Version\/([0-9.]+)/);
        if (safariVersionMatch) {
            browserVersion = safariVersionMatch[1];
        }
    } else if (uaString.includes('Opera') || uaString.includes('OPR/')) {
        browser = 'Opera';
        const operaVersionMatch = uaString.match(/(?:Opera|OPR)\/([0-9.]+)/);
        if (operaVersionMatch) {
            browserVersion = operaVersionMatch[1];
        }
    }
    
    const browserFull = browserVersion ? `${browser} ${browserVersion}` : browser;
    const osFull = osVersion ? `${os} ${osVersion}` : os;
    
    return { 
        browser, 
        browserVersion,
        browserFull,
        os,
        osVersion,
        osFull,
        device,
        deviceIcon,
        raw: uaString
    };
}

export function hasPermission(currentUser, permissionKey) {
    return currentUser?.permissions?.includes(permissionKey);
}

/**
 * Global page loader funksiyalari
 */
export function showPageLoader(text = 'Yuklanmoqda...') {
    const loader = document.getElementById('page-loader');
    const loaderText = document.getElementById('loader-text');
    
    if (loader) {
        if (loaderText) loaderText.textContent = text;
        loader.classList.add('active');
    }
}

export function hidePageLoader() {
    const loader = document.getElementById('page-loader');
    if (loader) {
        loader.classList.remove('active');
    }
}

export function updateLoaderType(type) {
    const loaderAnimation = document.getElementById('loader-animation');
    if (!loaderAnimation) return;
    
    // Barcha loader klaslarini olib tashlash
    const loaderClasses = ['loader-spinner', 'loader-dots', 'loader-pulse', 'loader-gradient', 
                          'loader-bars', 'loader-circle-progress', 'loader-bounce', 
                          'loader-cube', 'loader-dna', 'loader-hexagon'];
    
    loaderClasses.forEach(cls => loaderAnimation.classList.remove(cls));
    
    // Yangi loader turini qo'llash
    switch(type) {
        case 'spinner':
            loaderAnimation.className = 'loader-spinner';
            loaderAnimation.innerHTML = '';
            break;
        case 'dots':
            loaderAnimation.className = 'loader-dots';
            loaderAnimation.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
            break;
        case 'pulse':
            loaderAnimation.className = 'loader-pulse';
            loaderAnimation.innerHTML = '';
            break;
        case 'gradient':
            loaderAnimation.className = 'loader-gradient';
            loaderAnimation.innerHTML = '';
            break;
        case 'bars':
            loaderAnimation.className = 'loader-bars';
            loaderAnimation.innerHTML = '<div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div>';
            break;
        case 'progress':
            loaderAnimation.className = 'loader-circle-progress';
            loaderAnimation.innerHTML = '<svg width="60" height="60"><circle cx="30" cy="30" r="28"></circle></svg>';
            break;
        case 'bounce':
            loaderAnimation.className = 'loader-bounce';
            loaderAnimation.innerHTML = '<div class="ball"></div><div class="ball"></div><div class="ball"></div>';
            break;
        case 'cube':
            loaderAnimation.className = 'loader-cube';
            loaderAnimation.innerHTML = '<div class="face"></div>';
            break;
        case 'dna':
            loaderAnimation.className = 'loader-dna';
            loaderAnimation.innerHTML = '<div class="strand"></div><div class="strand"></div>';
            break;
        case 'hexagon':
            loaderAnimation.className = 'loader-hexagon';
            loaderAnimation.innerHTML = '';
            break;
        default:
            loaderAnimation.className = 'loader-spinner';
            loaderAnimation.innerHTML = '';
    }
}

/* ===================================================== */
/* === 💬 ZAMONAVIY CONFIRMATION DIALOG === */
/* ===================================================== */

/**
 * Zamonaviy tasdiqlanish oynasi
 * @param {Object} options - Konfiguratsiya
 * @returns {Promise<boolean>} - true (tasdiqlandi) yoki false (bekor qilindi)
 */
export function showConfirmDialog(options = {}) {
    return new Promise((resolve) => {
        const {
            title = 'Tasdiqlash',
            message = 'Rostdan ham davom etmoqchimisiz?',
            confirmText = 'Ha',
            cancelText = 'Yo\'q',
            type = 'warning', // warning, danger, info, success
            icon = null
        } = options;
        
        // Icon tanlash
        let iconHTML = '';
        if (icon) {
            iconHTML = `<i data-feather="${icon}"></i>`;
        } else {
            switch(type) {
                case 'danger':
                    iconHTML = '<i data-feather="alert-triangle"></i>';
                    break;
                case 'warning':
                    iconHTML = '<i data-feather="alert-circle"></i>';
                    break;
                case 'success':
                    iconHTML = '<i data-feather="check-circle"></i>';
                    break;
                case 'info':
                    iconHTML = '<i data-feather="info"></i>';
                    break;
                default:
                    iconHTML = '<i data-feather="help-circle"></i>';
            }
        }
        
        // Modal yaratish
        const modal = document.createElement('div');
        modal.className = 'confirm-dialog-overlay';
        modal.innerHTML = `
            <div class="confirm-dialog ${type}">
                <div class="confirm-dialog-icon">
                    ${iconHTML}
                </div>
                <div class="confirm-dialog-content">
                    <h3 class="confirm-dialog-title">${title}</h3>
                    <p class="confirm-dialog-message">${message}</p>
                </div>
                <div class="confirm-dialog-actions">
                    <button class="confirm-dialog-btn confirm-dialog-cancel">
                        <i data-feather="x"></i>
                        ${cancelText}
                    </button>
                    <button class="confirm-dialog-btn confirm-dialog-confirm ${type}">
                        <i data-feather="check"></i>
                        ${confirmText}
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Feather icons yangilash
        if (typeof feather !== 'undefined') {
            feather.replace();
        }
        
        // Animation
        setTimeout(() => modal.classList.add('show'), 10);
        
        const confirmBtn = modal.querySelector('.confirm-dialog-confirm');
        const cancelBtn = modal.querySelector('.confirm-dialog-cancel');
        
        const closeDialog = (result) => {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 300);
        };
        
        confirmBtn.addEventListener('click', () => closeDialog(true));
        cancelBtn.addEventListener('click', () => closeDialog(false));
        
        // Overlay bosilganda yopish
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeDialog(false);
        });
        
        // ESC tugmasi bilan yopish
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeDialog(false);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    });
}

/**
 * Format number with thousand separators
 * @param {number} num - Number to format
 * @returns {string} - Formatted number string
 */
export function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    return Number(num).toLocaleString('uz-UZ');
}

/**
 * Format report ID with leading zeros
 * @param {number|string} id - Report ID
 * @returns {string} - Formatted ID (e.g., "0001")
 */
export function formatReportId(id) {
    return String(id).padStart(4, '0');
}