/// <reference path="./types.d.ts" />

interface SetupAPI {
    checkConnection: (url: string) => Promise<boolean>;
    saveAndRestart: (apiUrl: string, kioskId: number) => Promise<void>;
}

declare global {
    interface Window {
        setupAPI: SetupAPI;
    }
}

const apiUrlInput = document.getElementById('api-url') as HTMLInputElement;
const kioskIdInput = document.getElementById('kiosk-id') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const btnText = document.getElementById('btn-text') as HTMLSpanElement;
const statusMsg = document.getElementById('status-msg') as HTMLDivElement;
const spinner = document.getElementById('spinner') as HTMLDivElement;

console.log('Setup script loaded');

// Check API availability
if (!window.setupAPI) {
    console.error('CRITICAL: window.setupAPI is undefined');
    showError('SetupAPI yuklanmadi. Dasturni qayta o\'rnating.');
}

saveBtn.addEventListener('click', async () => {
    console.log('Save button clicked');
    const apiUrl = apiUrlInput.value.trim();
    const kioskId = parseInt(kioskIdInput.value.trim());

    if (!apiUrl || isNaN(kioskId) || kioskId < 1) {
        showError('Iltimos, server manzili va Kiosk ID (raqam) ni to\'g\'ri kiriting');
        return;
    }

    setLoading(true);

    try {
        console.log(`Checking connection to: ${apiUrl}`);
        const isConnected = await window.setupAPI.checkConnection(apiUrl);

        if (!isConnected) {
            showError('Serverga ulanib bo\'lmadi. Manzilni tekshiring yoki server ishlayotganiga ishonch hosil qiling.');
            setLoading(false);
            return;
        }

        showSuccess('Ulanish muvaffaqiyatli! Saqlanmoqda...');

        // Wait a moment for UX
        await new Promise(resolve => setTimeout(resolve, 800));

        await window.setupAPI.saveAndRestart(apiUrl, kioskId);
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
