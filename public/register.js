document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elementlarini aniq olish ---
    const registerForm = document.getElementById('register-form');
    const fullnameInput = document.getElementById('fullname');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const secretWordInput = document.getElementById('secret-word');
    const messageArea = document.getElementById('message-area');
    const submitButton = registerForm.querySelector('button[type="submit"]');
    const formContainer = document.querySelector('.login-container');

    // --- Brendingni yuklash ---
    async function fetchAndApplyBranding() {
        try {
            const res = await fetch('/api/public/settings/branding');
            if (res.ok) {
                const brandingSettings = await res.json();
                applyBrandingToLogo(brandingSettings);
            }
        } catch (error) {
            console.error("Brending sozlamalarini yuklashda xatolik:", error);
        }
    }

    function applyBrandingToLogo(settings) {
        const logo = document.querySelector('.brand-logo');
        const container = logo.closest('.logo-border-effect');
        if (!logo || !container) return;

        logo.textContent = settings.text || 'MANUS';
        logo.style.setProperty('--glow-color', settings.color || '#4CAF50');
        
        logo.className = 'brand-logo';
        if (settings.animation && settings.animation !== 'anim-none') {
            logo.classList.add(settings.animation);
        }

        container.className = 'logo-border-effect';
        if (settings.border && settings.border !== 'border-none') {
            container.classList.add(settings.border);
        }
        container.style.setProperty('--glow-color', settings.color || '#4CAF50');
    }

    fetchAndApplyBranding();

    // --- Xabar ko'rsatish funksiyasi ---
    function showMessage(text, type = 'info') {
        messageArea.textContent = text;
        messageArea.className = `message-text ${type}`;
    }

    // --- Formani yuborish hodisasi ---
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        showMessage('', 'info');

        // --- QADAM-BA-QADAM VALIDATSIYA ---
        if (!fullnameInput || !fullnameInput.value.trim()) {
            showMessage("To'liq ismni kiriting.", 'error');
            fullnameInput.focus();
            return;
        }
        if (!usernameInput || !usernameInput.value.trim()) {
            showMessage("Loginni kiriting.", 'error');
            usernameInput.focus();
            return;
        }
        if (!passwordInput || !passwordInput.value) {
            showMessage("Parolni kiriting.", 'error');
            passwordInput.focus();
            return;
        }
        if (passwordInput.value.length < 8) {
            showMessage('Parol kamida 8 ta belgidan iborat bo\'lishi kerak.', 'error');
            passwordInput.focus();
            return;
        }
        if (!confirmPasswordInput || passwordInput.value !== confirmPasswordInput.value) {
            showMessage('Parollar bir-biriga mos kelmadi.', 'error');
            confirmPasswordInput.focus();
            return;
        }
        if (!secretWordInput || !secretWordInput.value.trim()) {
            showMessage("Maxfiy so'zni kiriting.", 'error');
            secretWordInput.focus();
            return;
        }
        if (secretWordInput.value.length < 6) {
            showMessage('Maxfiy so\'z kamida 6 ta belgidan iborat bo\'lishi kerak.', 'error');
            secretWordInput.focus();
            return;
        }

        if (typeof stringSimilarity !== 'undefined') {
            const similarity = stringSimilarity.compareTwoStrings(passwordInput.value, secretWordInput.value.trim());
            if (similarity > 0.4) {
                showMessage(`Maxfiy so'z parolga juda o'xshash (${(similarity * 100).toFixed(0)}%). Boshqa so'z kiriting.`, 'error');
                secretWordInput.focus();
                return;
            }
        }

        const fullname = fullnameInput.value.trim();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const secretWord = secretWordInput.value.trim();

        const originalButtonText = submitButton.innerHTML;
        submitButton.disabled = true;
        submitButton.innerHTML = 'Yuborilmoqda... <span class="spinner"></span>';

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fullname, username, password, secret_word: secretWord }),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Serverda noma\'lum xatolik yuz berdi.');
            }

            if (result.status === 'subscription_required') {
                registerForm.style.display = 'none';
                showMessage(result.message, 'success');

                const subscriptionButton = document.createElement('a');
                subscriptionButton.href = result.subscription_link;
                subscriptionButton.target = '_blank';
                subscriptionButton.className = 'btn btn-primary login-btn';
                subscriptionButton.style.marginTop = '20px';
                subscriptionButton.innerHTML = '<i data-feather="send"></i> Botga obuna bo\'lish';
                
                formContainer.insertBefore(subscriptionButton, document.querySelector('.register-link'));
                feather.replace();
            } else {
                registerForm.reset();
                registerForm.style.display = 'none';
                showMessage(result.message, 'success');
            }

        } catch (error) {
            showMessage(error.message, 'error');
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
        }
    });
});
