// src/renderer/launcher.ts
/// <reference path="./types.d.ts" />

class LauncherApp {
    private kioskGrid: HTMLElement;
    private statusIndicator: HTMLElement;
    private statusText: HTMLElement;
    private syncBtn: HTMLButtonElement;
    private floors: Map<number, { name: string; floor_number: number }> = new Map();

    constructor() {
        this.kioskGrid = document.getElementById('kiosk-grid')!;
        this.statusIndicator = document.getElementById('status-indicator')!;
        this.statusText = document.getElementById('status-text')!;
        this.syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;

        this.init();
    }

    async init() {
        // Event listeners
        this.syncBtn.addEventListener('click', () => this.syncData());

        // Load data
        await this.checkOnlineStatus();
        await this.loadFloors();
        await this.loadKiosks();

        // Auto-sync on start
        this.syncData();
    }

    async checkOnlineStatus() {
        try {
            const online = await kioskAPI.checkOnline();
            this.updateStatus(online);
        } catch {
            this.updateStatus(false);
        }
    }

    updateStatus(online: boolean) {
        this.statusIndicator.className = `status-indicator ${online ? 'online' : 'offline'}`;
        this.statusText.textContent = online ? 'Online' : 'Offline';
    }

    async loadFloors() {
        try {
            const floors = await kioskAPI.getFloors();
            this.floors.clear();
            floors.forEach(f => this.floors.set(f.id, { name: f.name, floor_number: f.floor_number }));
        } catch (error) {
            console.error('Error loading floors:', error);
        }
    }

    async loadKiosks() {
        try {
            const kiosks = await kioskAPI.getKiosks();

            if (kiosks.length === 0) {
                this.showEmptyState();
                return;
            }

            this.renderKiosks(kiosks);
        } catch (error) {
            console.error('Error loading kiosks:', error);
            this.showEmptyState();
        }
    }

    renderKiosks(kiosks: Array<{ id: number; name: string; floor_id: number; description: string | null }>) {
        this.kioskGrid.innerHTML = kiosks.map(kiosk => {
            const floor = this.floors.get(kiosk.floor_id);
            const floorText = floor ? `${floor.floor_number}-qavat` : '';

            return `
                <div class="kiosk-card" data-id="${kiosk.id}">
                    <h3>📍 ${kiosk.name}</h3>
                    <p>${kiosk.description || 'Navigatsiya kioski'}</p>
                    <span class="floor-badge">${floorText}</span>
                </div>
            `;
        }).join('');

        // Add click handlers
        this.kioskGrid.querySelectorAll('.kiosk-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = parseInt(card.getAttribute('data-id')!);
                kioskAPI.openKiosk(id);
            });
        });
    }

    showEmptyState() {
        this.kioskGrid.innerHTML = `
            <div class="empty-state">
                <div class="icon">📍</div>
                <h3>Kiosklar topilmadi</h3>
                <p>Server bilan ulanib, ma'lumotlarni yangilang</p>
            </div>
        `;
    }

    async syncData() {
        this.syncBtn.disabled = true;
        this.statusText.textContent = 'Yangilanmoqda...';

        try {
            const result = await kioskAPI.syncData();

            if (result.success) {
                this.updateStatus(true);
                await this.loadFloors();
                await this.loadKiosks();
            } else {
                this.updateStatus(false);
            }
        } catch (error) {
            console.error('Sync error:', error);
            this.updateStatus(false);
        } finally {
            this.syncBtn.disabled = false;
        }
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    new LauncherApp();
});
