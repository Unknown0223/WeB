// public/login.js (YANGILANGAN VERSIYA - BRENDING BILAN)

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
    try {
        // Cache'ni tozalash - har safar yangi sozlamalarni olish uchun
        try {
            sessionStorage.removeItem('branding_settings_cache');
        } catch (e) {
            // Xatolikni e'tiborsiz qoldirish
        }
        
        // Cache-busting: timestamp qo'shish
        const timestamp = Date.now();
        const res = await fetch(`/api/auth/public/settings/branding?t=${timestamp}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        
        if (res.ok) {
            const brandingSettings = await res.json();
            applyBrandingToLoginLogo(brandingSettings);
        } else {
            applyBrandingToLoginLogo(); // Xatolik bo'lsa, standartni qo'llash
        }
    } catch (error) {
        applyBrandingToLoginLogo(); // Xatolik bo'lsa, standartni qo'llash
    }
}


document.addEventListener('DOMContentLoaded', () => {
    // === YONALTIRILGAN O'ZGARISH: Brendingni yuklash ===
    fetchAndApplyBranding();

    const loginForm = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('error-message');
    const submitButton = loginForm.querySelector('button[type="submit"]');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        
        errorMessage.textContent = '';
        errorMessage.classList.remove('active');

        if (!username || !password) {
            errorMessage.textContent = 'Login va parolni to\'liq kiriting.';
            errorMessage.classList.add('active');
            return;
        }

        const originalButtonText = submitButton.innerHTML;
        submitButton.disabled = true;
        submitButton.innerHTML = 'Kirilmoqda... <span class="spinner"></span>';

        // Timeout controller
        const timeoutId = setTimeout(() => {
            submitButton.innerHTML = 'Kutilmoqda... <span class="spinner"></span>';
        }, 3000);

        // Abort controller for request cancellation
        const abortController = new AbortController();
        const timeoutAbort = setTimeout(() => {
            abortController.abort();
        }, 30000); // 30 soniya timeout

        try {
            const startTime = Date.now();
            
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                signal: abortController.signal
            });

            clearTimeout(timeoutAbort);
            clearTimeout(timeoutId);
            
            const result = await response.json();
            
            // Debug uchun console.log
            console.log('Login response:', result);

            if (!response.ok) {
                // Agar server xatolik javobini bersa (4xx, 5xx)
                // Xabarni ko'rsatish va login oynasida qolish
                throw result; // result obyektini xato sifatida otish
            }
            
            // Bot obunasi kerak bo'lsa, bot bog'lash sahifasiga o'tish
            // Shartni yanada moslashuvchan qilish
            const needsBotConnection = result.requiresBotConnection === true || 
                                      result.requires_bot_connection === true ||
                                      (result.redirectUrl && (result.redirectUrl.includes('bot-connect') || result.redirectUrl === '/bot-connect'));
            
            if (needsBotConnection) {
                console.log('Bot obunasi kerak, bot bog\'lash sahifasiga o\'tish...', result);
                submitButton.innerHTML = 'Bot obunasi kerak... <span class="spinner"></span>';
                // window.location.replace() ishlatish - history'ga qo'shilmaydi
                setTimeout(() => {
                    window.location.replace('/bot-connect.html');
                }, 100);
                return;
            }
            
            // Agar server "ok" javobini bersa (200)
            // Qisqa kechikish bilan redirect (UX uchun)
            submitButton.innerHTML = 'Muvaffaqiyatli! <span class="spinner"></span>';
            
            // Redirect kechikishini kamaytirish (100ms - tezroq)
            setTimeout(() => {
                window.location.href = result.redirectUrl || '/';
            }, 100);

        } catch (error) {
            clearTimeout(timeoutAbort);
            clearTimeout(timeoutId);
            
            // Agar server bilan umuman bog'lanib bo'lmasa yoki serverdan xatolik kelsa
            if (error.name === 'AbortError') {
                errorMessage.textContent = 'So\'rov vaqti tugadi. Iltimos, qayta urinib ko\'ring.';
            } else if (error.message) {
                errorMessage.textContent = error.message;
            } else {
                errorMessage.textContent = 'Server bilan bog\'lanishda xatolik yuz berdi.';
            }
            errorMessage.classList.add('active');
            
            // Agar serverdan secretWordRequired kelsa, xabar matnini o'zgartiramiz
            if (error.secretWordRequired) {
                errorMessage.textContent = error.message;
            }
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
        }
    });
});
