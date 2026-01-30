// src/main/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('kioskAPI', {
    // Kiosks
    getKiosks: () => ipcRenderer.invoke('get-kiosks'),
    getKiosk: (id: number) => ipcRenderer.invoke('get-kiosk', id),

    // Floors
    getFloors: () => ipcRenderer.invoke('get-floors'),
    getFloor: (id: number) => ipcRenderer.invoke('get-floor', id),

    // Waypoints & Connections
    getWaypoints: (floorId: number) => ipcRenderer.invoke('get-waypoints', floorId),
    getConnections: (floorId: number) => ipcRenderer.invoke('get-connections', floorId),

    // Rooms
    getRooms: () => ipcRenderer.invoke('get-rooms'),
    searchRooms: (query: string) => ipcRenderer.invoke('search-rooms', query),

    // Navigation
    findPath: (startRoomId: number, endRoomId: number, kioskId?: number) =>
        ipcRenderer.invoke('find-path', startRoomId, endRoomId, kioskId),

    // Sync & Status
    syncData: () => ipcRenderer.invoke('sync-data'),
    checkOnline: () => ipcRenderer.invoke('check-online'),
    getApiUrl: () => ipcRenderer.invoke('get-api-url'),

    // Navigation
    openKiosk: (kioskId: number) => ipcRenderer.send('open-kiosk', kioskId),
    backToLauncher: () => ipcRenderer.send('back-to-launcher'),
    toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),

    // Logging
    log: {
        info: (msg: string) => ipcRenderer.send('log-info', msg),
        warn: (msg: string) => ipcRenderer.send('log-warn', msg),
        error: (msg: string) => ipcRenderer.send('log-error', msg)
    },

});

// Expose Setup API separately
contextBridge.exposeInMainWorld('setupAPI', {
    checkConnection: (url: string) => ipcRenderer.invoke('setup-check-connection', url),
    saveAndRestart: (
        apiUrl: string, kioskId: number, kioskMode: boolean, autoFullscreen: boolean,
        idleTimeout: number, animationLoops: number, debugMode: boolean
    ) => ipcRenderer.invoke('setup-save-config', apiUrl, kioskId, kioskMode, autoFullscreen, idleTimeout, animationLoops, debugMode),
    log: {
        info: (msg: string) => ipcRenderer.send('log-info', msg),
        warn: (msg: string) => ipcRenderer.send('log-warn', msg),
        error: (msg: string) => ipcRenderer.send('log-error', msg)
    }
});
