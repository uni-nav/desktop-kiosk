// src/main/main.ts
import { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker } from 'electron';

// Bypass SSL certificate errors for internal kiosk communication
app.commandLine.appendSwitch('ignore-certificate-errors', 'true');

import * as path from 'path';
import * as fs from 'fs';
import { Database } from './database';
import { ApiSync } from './api-sync';
import { logger } from './logger';
import { loadConfig, getConfig, saveConfig } from './config';
import axios from 'axios';

let mainWindow: BrowserWindow | null = null;
let database: Database;
let apiSync: ApiSync;
let syncInterval: NodeJS.Timeout | null = null;
let syncInProgress = false;

async function probeHealth(base: string): Promise<void> {
    await axios.get(`${base}/api/health`, { timeout: 5000 });
}

// Load config
const config = loadConfig();

function createWindow() {
    logger.window.created();

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        fullscreen: config.KIOSK_MODE || config.AUTO_FULLSCREEN,
        kiosk: config.KIOSK_MODE,
        alwaysOnTop: config.KIOSK_MODE,
        frame: !config.KIOSK_MODE, // Hide frame in kiosk mode
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, '../../assets/icon.png')
    });

    // Remove menu bar for kiosk-like experience
    Menu.setApplicationMenu(null);

    // Kiosk security: Block new windows and context menu
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    if (config.KIOSK_MODE) {
        // Block context menu in kiosk mode
        mainWindow.webContents.on('context-menu', (e) => e.preventDefault());

        // Block keyboard shortcuts (except F11/DevTools if debug enabled)
        mainWindow.webContents.on('before-input-event', (event, input) => {
            // Allow Factory Reset (Ctrl+Shift+Delete or Cmd+Shift+Delete) even in Kiosk mode
            if ((input.control || input.meta) && input.shift && input.key === 'Delete') {
                logger.info('⚠️ [RESET] Factory reset triggered by shortcuts');
                const userDataPath = app.getPath('userData');
                const configPath = path.join(userDataPath, 'config.json');

                try {
                    if (fs.existsSync(configPath)) {
                        fs.unlinkSync(configPath);
                        logger.info('🗑️ [RESET] Config file deleted');
                    }
                    app.relaunch();
                    app.exit(0);
                } catch (err) {
                    logger.error(`❌ [RESET] Failed to reset: ${err}`);
                }
                return;
            }

            if (config.DEBUG_MODE) return;

            // Block DevTools (Ctrl+Shift+I / F12)
            if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
                event.preventDefault();
            }
            // Block Reload (Ctrl+R / F5)
            if ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5') {
                event.preventDefault();
            }
        });
    } else {
        // Non-Kiosk Mode: Still allow Factory Reset
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if ((input.control || input.meta) && input.shift && input.key === 'Delete') {
                logger.info('⚠️ [RESET] Factory reset triggered by shortcuts');
                const userDataPath = app.getPath('userData');
                const configPath = path.join(userDataPath, 'config.json');

                try {
                    if (fs.existsSync(configPath)) {
                        fs.unlinkSync(configPath);
                    }
                    app.relaunch();
                    app.exit(0);
                } catch (err) {
                    logger.error(`❌ [RESET] Failed to reset: ${err}`);
                }
            }
        });
    }

    // Load Setup or Launcher
    if (!config.SETUP_COMPLETED) {
        logger.info('⚠️ [SETUP] Setup not completed, loading wizard...');
        const setupPage = path.join(__dirname, '../renderer/setup.html');
        mainWindow.loadFile(setupPage);
        if (config.DEBUG_MODE || process.env.NODE_ENV === 'development') {
            mainWindow.webContents.openDevTools();
        }

        // Setup window settings
        mainWindow.setFullScreen(false);
        mainWindow.setKiosk(false);
        mainWindow.setResizable(true);
        mainWindow.center();
    } else {
        const startPage = path.join(__dirname, '../renderer/launcher.html');
        logger.window.loadPage(startPage);
        mainWindow.loadFile(startPage);
    }

    mainWindow.on('closed', () => {
        logger.window.closed();
        mainWindow = null;
    });

    // Open DevTools if configured
    if (config.DEBUG_MODE || process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }
}

// Initialize database and start sync
async function initialize() {
    logger.app.starting();

    try {
        const userDataPath = app.getPath('userData');
        database = new Database(userDataPath);
        await database.init(); // Initialize sql.js

        apiSync = new ApiSync(config.API_URL, database);

        // Start initial sync
        apiSync.syncAll().catch(err => {
            logger.sync.failed(err);
        });

        // Periodic auto-sync (best effort). Keeps offline DB fresh when internet exists.
        const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
        if (syncInterval) clearInterval(syncInterval);
        syncInterval = setInterval(async () => {
            if (syncInProgress) return;
            syncInProgress = true;
            try {
                const online = await apiSync.isOnline();
                if (!online) return;
                await apiSync.syncAll();
            } catch (err) {
                logger.sync.failed(err);
            } finally {
                syncInProgress = false;
            }
        }, SYNC_INTERVAL_MS);

        logger.app.ready();
    } catch (error) {
        logger.app.error('Initialization failed', error);
    }
}

app.whenReady().then(async () => {
    // 24/7 Kiosk features: Prevent Sleep and start on boot
    if (config.KIOSK_MODE) {
        powerSaveBlocker.start('prevent-display-sleep');
        try {
            app.setLoginItemSettings({
                openAtLogin: true,
                path: app.getPath('exe')
            });
            logger.info('🛡️ [SYSTEM] Auto-start on boot enabled.');
        } catch (e) {
            logger.warn('⚠️ [SYSTEM] Could not set auto-start. Run as admin if necessary.');
        }
    }

    await initialize();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        logger.app.quit();
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
        app.quit();
    }
});

// ==================== IPC HANDLERS ====================

// Setup Wizard Handlers
ipcMain.handle('setup-check-connection', async (_, url: string) => {
    try {
        const base = String(url || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
        await probeHealth(base);
        return true;
    } catch (err) {
        logger.warn(`Setup connection failed: ${err}`);
        return false;
    }
});

import * as https from 'https';
ipcMain.handle('setup-fetch-kiosks', async (_, url: string) => {
    try {
        const base = String(url || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
        const client = axios.create({
            baseURL: base,
            timeout: 10000,
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });
        const res = await client.get('/api/kiosks/');
        return res.data;
    } catch (err: any) {
        logger.error(`Setup fetch kiosks failed: ${err.message}`);
        throw new Error(err.message);
    }
});

ipcMain.handle('setup-save-config', async (_, apiUrl: string, kioskId: number, kioskMode: boolean, autoFullscreen: boolean, idleTimeout: number, animationLoops: number, debugMode: boolean) => {
    const normalizedUrl = String(apiUrl || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
    const safeIdleTimeout = Number.isFinite(idleTimeout) && idleTimeout > 0 ? idleTimeout : getConfig().IDLE_TIMEOUT_MS;
    const safeAnimationLoops = Number.isFinite(animationLoops) && animationLoops > 0 ? animationLoops : getConfig().ANIMATION_LOOPS;
    const safeKioskId = Number.isFinite(kioskId) && kioskId > 0 ? kioskId : getConfig().KIOSK_ID;

    logger.info(
        `Saving setup config: URL=${normalizedUrl}, ID=${safeKioskId}, Kiosk=${!!kioskMode}, Full=${!!autoFullscreen}, Timeout=${safeIdleTimeout}, Anim=${safeAnimationLoops}, Debug=${!!debugMode}`
    );
    saveConfig({
        API_URL: normalizedUrl,
        KIOSK_ID: safeKioskId,
        KIOSK_MODE: !!kioskMode,
        AUTO_FULLSCREEN: !!autoFullscreen,
        IDLE_TIMEOUT_MS: safeIdleTimeout,
        ANIMATION_LOOPS: safeAnimationLoops,
        DEBUG_MODE: !!debugMode,
        SETUP_COMPLETED: true
    });
    app.relaunch();
    app.quit();
});

// Get all kiosks
ipcMain.handle('get-kiosks', async () => {
    logger.ipc.call('get-kiosks');
    return database.getKiosks();
});

// Get kiosk by ID
ipcMain.handle('get-kiosk', async (_event, id: number) => {
    return database.getKiosk(id);
});

// Get all floors
ipcMain.handle('get-floors', async () => {
    return database.getFloors();
});

// Get floor by ID
ipcMain.handle('get-floor', async (_event, id: number) => {
    return database.getFloor(id);
});

// Get waypoints by floor
ipcMain.handle('get-waypoints', async (_event, floorId: number) => {
    return database.getWaypointsByFloor(floorId);
});

// Get connections by floor
ipcMain.handle('get-connections', async (_event, floorId: number) => {
    return database.getConnectionsByFloor(floorId);
});

// Get all rooms
ipcMain.handle('get-rooms', async () => {
    return database.getRooms();
});

// Search rooms
ipcMain.handle('search-rooms', async (_event, query: string) => {
    return database.searchRooms(query);
});

// Find path (online or offline)
ipcMain.handle('find-path', async (_event, startRoomId: number, endRoomId: number, kioskId?: number) => {
    logger.nav.request(startRoomId, endRoomId, kioskId);

    try {
        // Try online first
        const result = await apiSync.findPath(startRoomId, endRoomId, kioskId);
        logger.nav.onlineSuccess(result.path?.length || 0);
        return { success: true, data: result };
    } catch (error) {
        logger.nav.onlineFailed(error);

        // Fallback to offline pathfinding
        logger.nav.offlineStart();
        let result = null;

        if (kioskId && kioskId > 0) {
            // Use kiosk-based pathfinding
            result = database.findPathFromKiosk(kioskId, endRoomId);
        } else if (startRoomId > 0) {
            // Use room-to-room pathfinding
            result = database.findPathOffline(startRoomId, endRoomId);
        }

        if (result) {
            logger.nav.offlineSuccess(result.path.length);
            return { success: true, data: result, offline: true };
        }

        logger.nav.pathNotFound();
        return { success: false, error: 'Yo\'l topilmadi' };
    }
});

// Sync data
ipcMain.handle('sync-data', async () => {
    try {
        await apiSync.syncAll();
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

// Check online status
ipcMain.handle('check-online', async () => {
    return apiSync.isOnline();
});

// Get API base URL
ipcMain.handle('get-api-url', () => {
    return getConfig().API_URL;
});

ipcMain.handle('get-settings', () => {
    const current = getConfig();
    return {
        API_URL: current.API_URL,
        KIOSK_ID: current.KIOSK_ID,
        KIOSK_MODE: current.KIOSK_MODE,
        AUTO_FULLSCREEN: current.AUTO_FULLSCREEN,
        IDLE_TIMEOUT_MS: current.IDLE_TIMEOUT_MS,
        ANIMATION_LOOPS: current.ANIMATION_LOOPS,
        DEBUG_MODE: current.DEBUG_MODE,
        SETUP_COMPLETED: current.SETUP_COMPLETED,
    };
});

// Navigate to kiosk page
ipcMain.on('open-kiosk', (_event, kioskId: number) => {
    if (mainWindow) {
        logger.window.loadPage(`kiosk.html?kiosk_id=${kioskId}`);
        mainWindow.loadFile(
            path.join(__dirname, '../renderer/kiosk.html'),
            { query: { kiosk_id: kioskId.toString() } }
        );
    }
});

// Navigate back to launcher
ipcMain.on('back-to-launcher', () => {
    if (mainWindow) {
        logger.window.loadPage('launcher.html');
        mainWindow.loadFile(path.join(__dirname, '../renderer/launcher.html'));
    }
});

// Toggle fullscreen
ipcMain.on('toggle-fullscreen', () => {
    if (mainWindow) {
        const isFullScreen = !mainWindow.isFullScreen();
        logger.window.fullscreen(isFullScreen);
        mainWindow.setFullScreen(isFullScreen);
    }
});

// Logger handlers
ipcMain.on('log-info', (_event, message: string) => logger.info(`[RENDERER] ${message}`));
ipcMain.on('log-warn', (_event, message: string) => logger.warn(`[RENDERER] ${message}`));
ipcMain.on('log-error', (_event, message: string) => logger.error(`[RENDERER] ${message}`));
