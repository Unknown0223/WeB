// public/login.js (YANGILANGAN VERSIYA - BRENDING BILAN)

// Logging utility - console va server'ga yuborish uchun
const LOG_PREFIX = '[LOGIN_CLIENT]';
const logClient = {
    info: (...args) => {
        const timestamp = new Date().toISOString();
        console.log(`%c${LOG_PREFIX} [${timestamp}]`, 'color: #4CAF50; font-weight: bold', ...args);
    },
    warn: (...args) => {
        const timestamp = new Date().toISOString();
        console.warn(`%c${LOG_PREFIX} [${timestamp}]`, 'color: #FF9800; font-weight: bold', ...args);
    },
    error: (...args) => {
        const timestamp = new Date().toISOString();
        console.error(`%c${LOG_PREFIX} [${timestamp}]`, 'color: #F44336; font-weight: bold', ...args);
    },
    debug: (...args) => {
        const timestamp = new Date().toISOString();
        console.debug(`%c${LOG_PREFIX} [${timestamp}]`, 'color: #2196F3; font-weight: bold', ...args);
    }
};

logClient.info('═══════════════════════════════════════════════════════════');
logClient.info('🚀 LOGIN PAGE SCRIPT YUKLANDI');
logClient.info(`📅 Vaqt: ${new Date().toISOString()}`);
logClient.info(`🌐 URL: ${window.location.href}`);
logClient.info(`👤 User Agent: ${navigator.userAgent}`);
logClient.info('═══════════════════════════════════════════════════════════');

// --- Brending sozlamalarini qo'llash uchun funksiyalar ---
const BRANDING_DEFAULTS_LOGIN = {
    text: 'MANUS',
    color: '#4CAF50',
    animation: 'anim-glow-pulse',
    border: 'border-none'
};

// Hex rangni RGB ga o'tkazish funksiyasi
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function applyBrandingToLoginLogo(settings) {
    // Eski va yangi formatlarni qo'llab-quvvatlash
    const logoData = settings?.logo || settings || BRANDING_DEFAULTS_LOGIN;
    const text = logoData.text || 'MANUS';
    const color = logoData.color || '#4CAF50';
    const animation = logoData.animation || 'anim-glow-pulse';
    const border = logoData.border || 'border-none';
    const size = logoData.size || 32;
    
    const logo = document.querySelector('.brand-logo');
    
    if (logo) {
        logo.textContent = text;
        
        // CSS variable va to'g'ridan-to'g'ri color o'rnatish
        logo.style.setProperty('--glow-color', color);
        logo.style.color = color; // Inline CSS'dan ustun kelish uchun
        
        if (size) {
            logo.style.fontSize = `${size}px`;
        }
        
        // Animatsiya klasslarini tozalab, yangisini qo'shish
        logo.className = 'brand-logo'; // Barcha eski animatsiya klasslarini tozalash
        if (animation && animation !== 'anim-none') {
            logo.classList.add(animation);
            // Animatsiya uchun text-shadow ham o'rnatish
            if (color) {
                const rgb = hexToRgb(color);
                if (rgb) {
                    logo.style.textShadow = `0 0 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8), 0 0 40px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`;
                }
            }
        } else if (color) {
            const rgb = hexToRgb(color);
            if (rgb) {
                logo.style.textShadow = `0 0 8px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`;
            } else {
                logo.style.textShadow = `0 0 8px ${color}`;
            }
        }

        // Chegara effektini qo'llash
        const container = logo.closest('.logo-border-effect') || logo.closest('.login-container');
        
        if (container) {
            // Eski chegara klasslarini olib tashlash
            const baseClasses = [];
            if (container.classList.contains('logo-border-effect')) {
                baseClasses.push('logo-border-effect');
            }
            if (container.classList.contains('login-container')) {
                baseClasses.push('login-container');
            }
            
            // Barcha border klasslarini olib tashlash (lekin logo-border-effect emas)
            let newClassName = container.className
                .split(' ')
                .filter(cls => {
                    // logo-border-effect va login-container klasslarini saqlash
                    if (cls === 'logo-border-effect' || cls === 'login-container') {
                        return true;
                    }
                    // Boshqa border- bilan boshlanadigan klasslarni olib tashlash
                    return !cls.startsWith('border-');
                })
                .join(' ')
                .trim();
            
            // Agar baseClasses bo'sh bo'lsa, newClassName'ni ishlatish
            if (baseClasses.length > 0 && !newClassName.includes(baseClasses[0])) {
                newClassName = baseClasses.join(' ') + (newClassName ? ' ' + newClassName : '');
            }
            
            container.className = newClassName;
            
            if (border && border !== 'border-none') {
                container.classList.add(border);
            }
            container.style.setProperty('--glow-color', color);
        }
    }
}

// Sahifa yuklanganda sozlamalarni olish
async function fetchAndApplyBranding() {
    const brandingStartTime = Date.now();
    logClient.info('[BRANDING] Branding sozlamalarini yuklash boshlandi...');
    
    try {
        // Cache'ni tozalash - har safar yangi sozlamalarni olish uchun
        try {
            sessionStorage.removeItem('branding_settings_cache');
            logClient.debug('[BRANDING] Cache tozalandi');
        } catch (e) {
            logClient.warn('[BRANDING] Cache tozalashda xatolik:', e.message);
        }
        
        // Cache-busting: timestamp qo'shish
        const timestamp = Date.now();
        const brandingUrl = `/api/auth/public/settings/branding?t=${timestamp}`;
        logClient.debug(`[BRANDING] Fetch URL: ${brandingUrl}`);
        
        const fetchStartTime = Date.now();
        const res = await fetch(brandingUrl, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        const fetchDuration = Date.now() - fetchStartTime;
        logClient.info(`[BRANDING] Fetch muvaffaqiyatli (${fetchDuration}ms), Status: ${res.status}`);
        
        if (res.ok) {
            const parseStartTime = Date.now();
            const brandingSettings = await res.json();
            const parseDuration = Date.now() - parseStartTime;
            logClient.debug(`[BRANDING] JSON parse muvaffaqiyatli (${parseDuration}ms)`);
            
            applyBrandingToLoginLogo(brandingSettings);
            const totalDuration = Date.now() - brandingStartTime;
            logClient.info(`[BRANDING] ✅ Branding sozlamalari qo'llandi (${totalDuration}ms)`);
        } else {
            logClient.warn(`[BRANDING] ⚠️ Fetch xatolik, Status: ${res.status}`);
            applyBrandingToLoginLogo(); // Xatolik bo'lsa, standartni qo'llash
        }
    } catch (error) {
        const totalDuration = Date.now() - brandingStartTime;
        logClient.error(`[BRANDING] ❌ Xatolik (${totalDuration}ms):`, error.message);
        logClient.error('[BRANDING] Stack:', error.stack);
        applyBrandingToLoginLogo(); // Xatolik bo'lsa, standartni qo'llash
    }
}


document.addEventListener('DOMContentLoaded', () => {
    const domLoadTime = Date.now();
    logClient.info('═══════════════════════════════════════════════════════════');
    logClient.info('📄 DOM YUKLANDI');
    logClient.info(`⏱️  DOM Load vaqt: ${domLoadTime}ms`);
    logClient.info('═══════════════════════════════════════════════════════════');
    
    // === YONALTIRILGAN O'ZGARISH: Brendingni yuklash ===
    logClient.info('[INIT] Brending sozlamalarini yuklash boshlandi...');
    fetchAndApplyBranding();

    const loginForm = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('error-message');
    const submitButton = loginForm.querySelector('button[type="submit"]');
    
    logClient.info('[INIT] Form elementlari topildi:', {
        form: !!loginForm,
        usernameInput: !!usernameInput,
        passwordInput: !!passwordInput,
        errorMessage: !!errorMessage,
        submitButton: !!submitButton
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitStartTime = Date.now();
        
        logClient.info('═══════════════════════════════════════════════════════════');
        logClient.info('🔐 LOGIN FORM SUBMIT BOSHLANDI');
        logClient.info(`📅 Vaqt: ${new Date().toISOString()}`);
        logClient.info('═══════════════════════════════════════════════════════════');
        
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        
        logClient.info('[SUBMIT] Form ma\'lumotlari:', {
            username: username ? `${username.substring(0, 3)}***` : 'BO\'SH',
            passwordLength: password ? password.length : 0,
            usernameLength: username ? username.length : 0
        });
        
        errorMessage.textContent = '';
        errorMessage.classList.remove('active');

        if (!username || !password) {
            logClient.warn('[SUBMIT] ⚠️ Validatsiya xatolik: Username yoki parol bo\'sh');
            errorMessage.textContent = 'Login va parolni to\'liq kiriting.';
            errorMessage.classList.add('active');
            return;
        }

        const originalButtonText = submitButton.innerHTML;
        submitButton.disabled = true;
        submitButton.innerHTML = 'Kirilmoqda... <span class="spinner"></span>';
        logClient.info('[SUBMIT] Submit button disabled va loading holatiga o\'tdi');

        // Timeout controller
        const timeoutId = setTimeout(() => {
            logClient.debug('[SUBMIT] 3 soniya o\'tdi, button matni o\'zgartirildi');
            submitButton.innerHTML = 'Kutilmoqda... <span class="spinner"></span>';
        }, 3000);

        // Abort controller for request cancellation
        const abortController = new AbortController();
        const timeoutAbort = setTimeout(() => {
            logClient.warn('[SUBMIT] ⚠️ 30 soniya timeout - request abort qilindi');
            abortController.abort();
        }, 30000); // 30 soniya timeout

        try {
            const startTime = Date.now();
            logClient.info('[SUBMIT] Fetch so\'rovi boshlandi...');
            logClient.debug('[SUBMIT] Request URL: /api/auth/login');
            logClient.debug('[SUBMIT] Request method: POST');
            
            const fetchStartTime = Date.now();
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                signal: abortController.signal
            });
            const fetchDuration = Date.now() - fetchStartTime;
            
            logClient.info(`[SUBMIT] ✅ Fetch muvaffaqiyatli (${fetchDuration}ms)`);
            logClient.info(`[SUBMIT] Response status: ${response.status} ${response.statusText}`);
            logClient.debug(`[SUBMIT] Response headers:`, Object.fromEntries(response.headers.entries()));

            clearTimeout(timeoutAbort);
            clearTimeout(timeoutId);
            
            const parseStartTime = Date.now();
            const result = await response.json();
            const parseDuration = Date.now() - parseStartTime;
            logClient.info(`[SUBMIT] JSON parse muvaffaqiyatli (${parseDuration}ms)`);
            
            // Debug uchun console.log
            logClient.info('[SUBMIT] Login response:', {
                ok: response.ok,
                status: response.status,
                hasUser: !!result.user,
                hasRedirectUrl: !!result.redirectUrl,
                requiresBotConnection: result.requiresBotConnection || result.requires_bot_connection,
                message: result.message
            });

            if (!response.ok) {
                logClient.warn(`[SUBMIT] ⚠️ Response not OK: ${response.status}`);
                logClient.warn('[SUBMIT] Error details:', result);
                // Agar server xatolik javobini bersa (4xx, 5xx)
                // Xabarni ko'rsatish va login oynasida qolish
                throw result; // result obyektini xato sifatida otish
            }
            
            // Bot obunasi kerak bo'lsa, bot bog'lash sahifasiga o'tish
            // Shartni yanada moslashuvchan qilish
            const needsBotConnection = result.requiresBotConnection === true || 
                                      result.requires_bot_connection === true ||
                                      (result.redirectUrl && (result.redirectUrl.includes('bot-connect') || result.redirectUrl === '/bot-connect'));
            
            logClient.info('[SUBMIT] Bot obunasi tekshiruvi:', {
                needsBotConnection,
                requiresBotConnection: result.requiresBotConnection,
                requires_bot_connection: result.requires_bot_connection,
                redirectUrl: result.redirectUrl
            });
            
            if (needsBotConnection) {
                logClient.info('[SUBMIT] Bot obunasi kerak, bot bog\'lash sahifasiga o\'tish...');
                logClient.info('[SUBMIT] Redirect URL: /bot-connect.html');
                submitButton.innerHTML = 'Bot obunasi kerak... <span class="spinner"></span>';
                // window.location.replace() ishlatish - history'ga qo'shilmaydi
                setTimeout(() => {
                    logClient.info('[SUBMIT] Redirect boshlandi: /bot-connect.html');
                    window.location.replace('/bot-connect.html');
                }, 100);
                return;
            }
            
            // Agar server "ok" javobini bersa (200)
            // Qisqa kechikish bilan redirect (UX uchun)
            const redirectUrl = result.redirectUrl || '/';
            logClient.info(`[SUBMIT] ✅ Login muvaffaqiyatli, redirect: ${redirectUrl}`);
            submitButton.innerHTML = 'Muvaffaqiyatli! <span class="spinner"></span>';
            
            const totalDuration = Date.now() - submitStartTime;
            logClient.info(`[SUBMIT] ⏱️  Jami vaqt: ${totalDuration}ms`);
            logClient.info('═══════════════════════════════════════════════════════════');
            logClient.info('✅ LOGIN MUVAFFAQIYATLI TUGADI');
            logClient.info('═══════════════════════════════════════════════════════════');
            
            // Redirect kechikishini kamaytirish (100ms - tezroq)
            setTimeout(() => {
                logClient.info(`[SUBMIT] Redirect boshlandi: ${redirectUrl}`);
                window.location.href = redirectUrl;
            }, 100);

        } catch (error) {
            clearTimeout(timeoutAbort);
            clearTimeout(timeoutId);
            
            const totalDuration = Date.now() - submitStartTime;
            logClient.error('═══════════════════════════════════════════════════════════');
            logClient.error('❌ LOGIN XATOLIK');
            logClient.error(`⏱️  Vaqt: ${totalDuration}ms`);
            logClient.error(`📝 Xatolik turi: ${error.name || 'Unknown'}`);
            logClient.error(`📝 Xatolik xabari: ${error.message || 'No message'}`);
            logClient.error('[SUBMIT] Error details:', error);
            if (error.stack) {
                logClient.error('[SUBMIT] Stack trace:', error.stack);
            }
            logClient.error('═══════════════════════════════════════════════════════════');
            
            // Agar server bilan umuman bog'lanib bo'lmasa yoki serverdan xatolik kelsa
            if (error.name === 'AbortError') {
                logClient.error('[SUBMIT] ❌ Request abort qilindi (timeout)');
                errorMessage.textContent = 'So\'rov vaqti tugadi. Iltimos, qayta urinib ko\'ring.';
            } else if (error.message) {
                logClient.error(`[SUBMIT] ❌ Server xatolik: ${error.message}`);
                errorMessage.textContent = error.message;
            } else {
                logClient.error('[SUBMIT] ❌ Noma\'lum xatolik');
                errorMessage.textContent = 'Server bilan bog\'lanishda xatolik yuz berdi.';
            }
            errorMessage.classList.add('active');
            
            // Agar serverdan secretWordRequired kelsa, xabar matnini o'zgartiramiz
            if (error.secretWordRequired) {
                logClient.info('[SUBMIT] Secret word kerak');
                errorMessage.textContent = error.message;
            }
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
            logClient.debug('[SUBMIT] Submit button qayta enabled qilindi');
        }
    });
    
    logClient.info('[INIT] ✅ Form event listener qo\'shildi');
    logClient.info('[INIT] ✅ Login page initialization tugadi');
});
