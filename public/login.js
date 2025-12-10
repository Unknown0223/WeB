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
            
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                signal: abortController.signal
            });

            clearTimeout(timeoutAbort);
            clearTimeout(timeoutId);
            
            const result = await response.json();

            if (!response.ok) {
                // Agar server xatolik javobini bersa (4xx, 5xx)
                // Xabarni ko'rsatish va login oynasida qolish
                throw result; // result obyektini xato sifatida otish
            }
            
            // Agar server "ok" javobini bersa (200)
            // Qisqa kechikish bilan redirect (UX uchun)
            submitButton.innerHTML = 'Muvaffaqiyatli! <span class="spinner"></span>';
            
            setTimeout(() => {
                window.location.href = result.redirectUrl || '/';
            }, 300);

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
