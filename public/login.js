// public/login.js (YANGILANGAN VERSIYA - BRENDING BILAN)

// --- Brending sozlamalarini qo'llash uchun funksiyalar ---
const BRANDING_DEFAULTS_LOGIN = {
    text: 'MANUS',
    color: '#4CAF50',
    animation: 'anim-glow-pulse',
    border: 'border-none'
};

function applyBrandingToLoginLogo(settings) {
    const s = settings || BRANDING_DEFAULTS_LOGIN;
    const logo = document.querySelector('.brand-logo');
    
    if (logo) {
        logo.textContent = s.text;
        logo.style.setProperty('--glow-color', s.color);
        
        // Animatsiya klasslarini tozalab, yangisini qo'shish
        logo.className = 'brand-logo'; // Barcha eski animatsiya klasslarini tozalash
        if (s.animation && s.animation !== 'anim-none') {
            logo.classList.add(s.animation);
        } else if (s.color) {
            logo.style.textShadow = `0 0 8px ${s.color}`;
        }

        // Chegara effektini qo'llash
        const container = logo.closest('.login-container');
        if (container) {
            // Eski chegara klasslarini olib tashlash
            container.className = container.className.replace(/border-\w+/g, '').trim();
            if (s.border && s.border !== 'border-none') {
                container.classList.add(s.border);
            }
            container.style.setProperty('--glow-color', s.color);
        }
    }
}

// Sahifa yuklanganda sozlamalarni olish
async function fetchAndApplyBranding() {
    try {
        // === O'ZGARTIRILGAN QATOR ===
        // So'rov manzilini yangi, ochiq (public) endpoint'ga o'zgartiramiz
        const res = await fetch('/api/public/settings/branding');
        
        if (res.ok) {
            const brandingSettings = await res.json();
            applyBrandingToLoginLogo(brandingSettings);
        } else {
            applyBrandingToLoginLogo(); // Xatolik bo'lsa, standartni qo'llash
        }
    } catch (error) {
        console.error("Brending sozlamalarini yuklashda xatolik:", error);
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

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }), 
            });

            const result = await response.json();

            if (!response.ok) {
                // Agar server xatolik javobini bersa (4xx, 5xx)
                // Xabarni ko'rsatish va login oynasida qolish
                throw result; // result obyektini xato sifatida otish
            }
            
            // Agar server "ok" javobini bersa (200)
            window.location.href = result.redirectUrl || '/';

        } catch (error) {
            // Agar server bilan umuman bog'lanib bo'lmasa yoki serverdan xatolik kelsa
            errorMessage.textContent = error.message || 'Server bilan bog\'lanishda xatolik yuz berdi.';
            errorMessage.classList.add('active');
            
            // Agar serverdan secretWordRequired kelsa, xabar matnini o'zgartiramiz
            if (error.secretWordRequired) {
                errorMessage.textContent = error.message;
            }
            
            console.error('Login jarayonida xatolik:', error);
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
        }
    });
});
