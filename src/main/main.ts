// src/main/main.ts
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import * as path from 'path';
import { Database } from './database';
import { ApiSync } from './api-sync';
import { logger } from './logger';
import { loadConfig, getConfig, saveConfig } from './config';
import axios from 'axios';

let mainWindow: BrowserWindow | null = null;
let database: Database;
let apiSync: ApiSync;

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
    }

    // Load Setup or Launcher
    if (!config.SETUP_COMPLETED) {
        logger.info('⚠️ [SETUP] Setup not completed, loading wizard...');
        const setupPage = path.join(__dirname, '../renderer/setup.html');
        mainWindow.loadFile(setupPage);
        mainWindow.webContents.openDevTools(); // DEBUG: Open DevTools for setup

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

        logger.app.ready();
    } catch (error) {
        logger.app.error('Initialization failed', error);
    }
}

app.whenReady().then(async () => {
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
        app.quit();
    }
});

// ==================== IPC HANDLERS ====================

// Setup Wizard Handlers
ipcMain.handle('setup-check-connection', async (_, url: string) => {
    try {
        await axios.get(`${url}/health`, { timeout: 5000 });
        return true;
    } catch (err) {
        logger.warn(`Setup connection failed: ${err}`);
        return false;
    }
});

ipcMain.handle('setup-save-config', async (_, apiUrl: string, kioskId: number, kioskMode: boolean, autoFullscreen: boolean, idleTimeout: number, animationLoops: number, debugMode: boolean) => {
    logger.info(`Saving setup config: URL=${apiUrl}, ID=${kioskId}, Kiosk=${kioskMode}, Full=${autoFullscreen}, Timeout=${idleTimeout}, Anim=${animationLoops}, Debug=${debugMode}`);
    saveConfig({
        API_URL: apiUrl,
        KIOSK_ID: kioskId,
        KIOSK_MODE: kioskMode,
        AUTO_FULLSCREEN: autoFullscreen,
        IDLE_TIMEOUT_MS: idleTimeout,
        ANIMATION_LOOPS: animationLoops,
        DEBUG_MODE: debugMode,
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
    return config.API_URL;
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
