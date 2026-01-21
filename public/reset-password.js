// public/reset-password.js

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
    // === Brendingni yuklash ===
    fetchAndApplyBranding();
    
    // Ikonkalarni ishga tushirish uchun
    if (typeof feather !== 'undefined') {
        feather.replace();
    }

    // Parolni ko'rsatish/yashirish logikasi
    document.body.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.toggle-visibility-btn');
        if (toggleBtn) {
            console.log('[RESET-PASSWORD] Toggle button clicked');
            const wrapper = toggleBtn.closest('.secure-input-wrapper');
            if (!wrapper) {
                console.warn('[RESET-PASSWORD] secure-input-wrapper topilmadi');
                return;
            }
            const input = wrapper.querySelector('input');
            if (!input) {
                console.warn('[RESET-PASSWORD] Input topilmadi');
                return;
            }
            const icon = toggleBtn.querySelector('i');
            console.log('[RESET-PASSWORD] Input type:', input.type, 'Icon:', icon ? 'mavjud' : 'yo\'q');
            
            if (input.type === 'password') {
                input.type = 'text';
                console.log('[RESET-PASSWORD] Parol ko\'rsatildi');
                if (icon) {
                    icon.setAttribute('data-feather', 'eye-off');
                }
            } else {
                input.type = 'password';
                console.log('[RESET-PASSWORD] Parol yashirildi');
                if (icon) {
                    icon.setAttribute('data-feather', 'eye');
                }
            }
            
            if (typeof feather !== 'undefined') {
                feather.replace();
                console.log('[RESET-PASSWORD] Feather icons yangilandi');
            } else {
                console.warn('[RESET-PASSWORD] Feather mavjud emas');
            }
        }
    });
    const form = document.getElementById('reset-password-form');
    const errorMessage = document.getElementById('error-message');
    const successMessage = document.getElementById('success-message');
    const submitBtn = document.getElementById('submit-btn');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Xabarlarni tozalash
        errorMessage.textContent = '';
        successMessage.style.display = 'none';
        successMessage.textContent = '';
        
        // Form ma'lumotlarini olish
        const username = document.getElementById('username').value.trim();
        const secretWord = document.getElementById('secret-word').value.trim();
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        
        // Validatsiya
        if (!username || !secretWord || !newPassword || !confirmPassword) {
            errorMessage.textContent = "Barcha maydonlarni to'ldiring.";
            return;
        }
        
        if (newPassword.length < 8) {
            errorMessage.textContent = "Yangi parol kamida 8 belgidan iborat bo'lishi kerak.";
            document.getElementById('new-password').focus();
            return;
        }
        
        if (newPassword !== confirmPassword) {
            errorMessage.textContent = "Parol va tasdiqlash mos kelmaydi.";
            document.getElementById('confirm-password').focus();
            return;
        }
        
        // Loading state
        submitBtn.disabled = true;
        submitBtn.textContent = 'Yuborilmoqda...';
        
        try {
            const response = await fetch('/api/auth/reset-password-request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username,
                    secretWord,
                    newPassword,
                    confirmPassword
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Muvaffaqiyatli javob
                successMessage.textContent = data.message || "So'rov muvaffaqiyatli yuborildi. Admin tasdiqini kuting.";
                successMessage.style.display = 'block';
                
                // Formani tozalash
                form.reset();
                
                // 5 soniyadan keyin login sahifasiga yo'naltirish
                setTimeout(() => {
                    window.location.href = '/login.html';
                }, 5000);
            } else {
                // Xatolik javobi
                errorMessage.textContent = data.message || "Xatolik yuz berdi. Iltimos, qayta urinib ko'ring.";
            }
        } catch (error) {
            console.error('Reset password error:', error);
            errorMessage.textContent = "Tarmoq xatoligi. Iltimos, internet aloqasini tekshiring va qayta urinib ko'ring.";
        } finally {
            // Loading state'ni tozalash
            submitBtn.disabled = false;
            submitBtn.textContent = "Parolni tiklash so'rovini yuborish";
        }
    });
});

