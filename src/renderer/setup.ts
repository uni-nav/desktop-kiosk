/// <reference path="./types.d.ts" />

const apiUrlInput = document.getElementById('api-url') as HTMLInputElement;
const fetchKiosksBtn = document.getElementById('fetch-kiosks-btn') as HTMLButtonElement;
const kioskListSelect = document.getElementById('kiosk-list') as HTMLSelectElement;
const idleTimeoutInput = document.getElementById('idle-timeout') as HTMLInputElement;
const animationLoopsInput = document.getElementById('animation-loops') as HTMLInputElement;
const debugModeInput = document.getElementById('debug-mode') as HTMLInputElement;

const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const btnText = document.getElementById('btn-text') as HTMLSpanElement;
const statusMsg = document.getElementById('status-msg') as HTMLDivElement;
const spinner = document.getElementById('spinner') as HTMLDivElement;

console.log('Setup script loaded');

fetchKiosksBtn.addEventListener('click', async () => {
    const rawUrl = apiUrlInput.value.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
    if (!rawUrl) {
        showError('Iltimos, avval Server Manzilini kiriting');
        return;
    }

    fetchKiosksBtn.disabled = true;
    fetchKiosksBtn.textContent = 'Yuklanmoqda...';
    try {
        const kiosks = await setupAPI.fetchKiosks(rawUrl);

        kioskListSelect.innerHTML = '<option value="">Kioskni tanlang...</option>';
        kiosks.forEach((k: any) => {
            const opt = document.createElement('option');
            opt.value = k.id;
            opt.textContent = `[ID: ${k.id}] ${k.name || 'Nomsiz Kiosk'} (${k.status || 'Noma\'lum'})`;
            kioskListSelect.appendChild(opt);
        });
        showSuccess(`Muvaffaqiyatli ${kiosks.length} ta kiosk yuklandi!`);
    } catch (err: any) {
        showError('Kiosklarni yuklash xatosi: ' + err.message);
        kioskListSelect.innerHTML = '<option value="">Tur tarmoqqa yoki manzilga bog\'lanishda xato!</option>';
    } finally {
        fetchKiosksBtn.disabled = false;
        fetchKiosksBtn.textContent = 'Yuklash';
    }
});
// Check API availability
if (typeof setupAPI === 'undefined') {
    console.error('CRITICAL: setupAPI is undefined');
    showError('SetupAPI yuklanmadi. Dasturni qayta o\'rnating.');
}

saveBtn.addEventListener('click', async () => {
    console.log('Save button clicked');
    const apiUrl = apiUrlInput.value.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
    const kioskId = parseInt(kioskListSelect.value);
    const idleTimeout = parseInt(idleTimeoutInput.value.trim() || '300000');
    const animationLoops = parseInt(animationLoopsInput.value.trim() || '3');
    const autoFullscreen = true; // Always true for security
    const kioskMode = true; // Always true for security
    const debugMode = debugModeInput.checked;

    if (!apiUrl || isNaN(kioskId) || kioskId < 1) {
        showError('Iltimos, server manzili kiriting va ro\'yxatdan Kiosk tanlang');
        return;
    }
    if (!Number.isFinite(idleTimeout) || idleTimeout < 10000) {
        showError('Harakatsizlik vaqti (ms) kamida 10000 bo‘lishi kerak');
        return;
    }
    if (!Number.isFinite(animationLoops) || animationLoops < 1) {
        showError('Animatsiya aylanishlar soni kamida 1 bo‘lishi kerak');
        return;
    }

    setLoading(true);

    try {
        console.log(`Checking connection to: ${apiUrl}`);
        const isConnected = await setupAPI.checkConnection(apiUrl);

        if (!isConnected) {
            showError('Serverga ulanib bo\'lmadi. Manzilni tekshiring yoki server ishlayotganiga ishonch hosil qiling.');
            setLoading(false);
            return;
        }

        showSuccess('Ulanish muvaffaqiyatli! Saqlanmoqda...');

        // Wait a moment for UX
        await new Promise(resolve => setTimeout(resolve, 800));

        await setupAPI.saveAndRestart(
            apiUrl,
            kioskId,
            kioskMode,
            autoFullscreen,
            idleTimeout,
            animationLoops,
            debugMode
        );
    } catch (error) {
        console.error(error);
        showError('Xatolik: ' + String(error));
        setLoading(false);
    }
});

function setLoading(loading: boolean) {
    if (loading) {
        saveBtn.disabled = true;
        btnText.textContent = 'Tekshirilmoqda...';
        spinner.classList.remove('hidden');
        statusMsg.classList.add('hidden');
    } else {
        saveBtn.disabled = false;
        btnText.textContent = 'Saqlash va Boshlash';
        spinner.classList.add('hidden');
    }
}

function showError(msg: string) {
    statusMsg.textContent = msg;
    statusMsg.className = 'status error';
    statusMsg.classList.remove('hidden');
}

function showSuccess(msg: string) {
    statusMsg.textContent = msg;
    statusMsg.className = 'status success';
    statusMsg.classList.remove('hidden');
}

// Initial focus
apiUrlInput.focus();

export { };
