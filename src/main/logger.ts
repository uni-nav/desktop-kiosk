// src/main/logger.ts - Centralized Logging System
import log from 'electron-log';
import * as path from 'path';
import { app } from 'electron';

// Configure log file location
log.transports.file.resolvePath = () => {
    return path.join(app.getPath('userData'), 'logs', 'kiosk.log');
};

// Log format
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';

// Log levels: error, warn, info, verbose, debug, silly
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Max log file size (10MB)
log.transports.file.maxSize = 10 * 1024 * 1024;

// Export logger with categories
export const logger = {
    // App lifecycle
    app: {
        starting: () => log.info('🚀 [APP] Starting University Kiosk...'),
        ready: () => log.info('✅ [APP] Application ready'),
        quit: () => log.info('👋 [APP] Application quitting'),
        error: (msg: string, err?: any) => log.error(`❌ [APP] ${msg}`, err),
    },

    // Database operations
    db: {
        init: () => log.info('📦 [DB] Initializing database...'),
        initSuccess: () => log.info('✅ [DB] Database initialized successfully'),
        initError: (err: any) => log.error('❌ [DB] Database init failed:', err),
        save: () => log.debug('💾 [DB] Database saved to disk'),
        query: (table: string, count: number) => log.debug(`🔍 [DB] Query ${table}: ${count} rows`),
    },

    // API and Sync
    sync: {
        starting: () => log.info('🔄 [SYNC] Starting data synchronization...'),
        success: () => log.info('✅ [SYNC] Sync completed successfully'),
        failed: (err: any) => log.warn('⚠️ [SYNC] Sync failed (offline mode):', err?.message || err),
        floors: (count: number) => log.info(`📥 [SYNC] Synced ${count} floors`),
        rooms: (count: number) => log.info(`📥 [SYNC] Synced ${count} rooms`),
        kiosks: (count: number) => log.info(`📥 [SYNC] Synced ${count} kiosks`),
        waypoints: (floorId: number, count: number) => log.debug(`📥 [SYNC] Floor ${floorId}: ${count} waypoints`),
        connections: (floorId: number, count: number) => log.debug(`📥 [SYNC] Floor ${floorId}: ${count} connections`),
    },

    // Navigation/Pathfinding
    nav: {
        request: (startRoom: number, endRoom: number, kiosk?: number) =>
            log.info(`🧭 [NAV] Path request: start=${startRoom}, end=${endRoom}, kiosk=${kiosk}`),
        onlineSuccess: (steps: number) => log.info(`✅ [NAV] Online path found: ${steps} steps`),
        onlineFailed: (err: any) => log.warn(`⚠️ [NAV] Online pathfinding failed:`, err?.message || err),
        offlineStart: () => log.info('📴 [NAV] Trying offline pathfinding...'),
        offlineSuccess: (steps: number) => log.info(`✅ [NAV] Offline path found: ${steps} steps`),
        offlineFailed: () => log.warn('❌ [NAV] Offline pathfinding failed'),
        pathNotFound: () => log.warn('⚠️ [NAV] No path found'),
    },

    // IPC Communication
    ipc: {
        call: (channel: string) => log.debug(`📡 [IPC] Handler called: ${channel}`),
        error: (channel: string, err: any) => log.error(`❌ [IPC] Error in ${channel}:`, err),
    },

    // Window/UI
    window: {
        created: () => log.info('🖥️ [WINDOW] Main window created'),
        loadPage: (page: string) => log.info(`🔗 [WINDOW] Loading: ${page}`),
        fullscreen: (enabled: boolean) => log.info(`🖥️ [WINDOW] Fullscreen: ${enabled}`),
        closed: () => log.info('🖥️ [WINDOW] Window closed'),
    },

    // Renderer (for preload)
    renderer: {
        init: (kioskId: number) => log.info(`🎨 [RENDERER] Kiosk ${kioskId} initializing...`),
        ready: () => log.info('✅ [RENDERER] Kiosk ready'),
        error: (msg: string, err?: any) => log.error(`❌ [RENDERER] ${msg}`, err),
        floorSelected: (floorId: number) => log.debug(`🏢 [RENDERER] Floor selected: ${floorId}`),
        searchQuery: (query: string) => log.debug(`🔍 [RENDERER] Search: "${query}"`),
        pathAnimating: (loops: number) => log.debug(`🎬 [RENDERER] Animation loop ${loops}/3`),
        idle: () => log.info('😴 [RENDERER] Idle timeout - showing welcome modal'),
    },

    // Config
    config: {
        loaded: (env: string, apiUrl: string) => log.info(`⚙️ [CONFIG] Environment: ${env}, API: ${apiUrl}`),
        missing: (key: string) => log.warn(`⚠️ [CONFIG] Missing config: ${key}`),
    },

    // General
    info: (msg: string) => log.info(msg),
    warn: (msg: string) => log.warn(msg),
    error: (msg: string, err?: any) => log.error(msg, err),
    debug: (msg: string) => log.debug(msg),
};

export default logger;
