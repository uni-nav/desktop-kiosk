// src/renderer/types.d.ts
interface KioskAPIInterface {
    getKiosks: () => Promise<Array<{ id: number; name: string; floor_id: number; description: string | null }>>;
    getKiosk: (id: number) => Promise<{ id: number; name: string; floor_id: number; waypoint_id: string | null } | null>;
    getFloors: () => Promise<Array<{ id: number; name: string; floor_number: number; image_url: string | null; image_width: number | null; image_height: number | null }>>;
    getFloor: (id: number) => Promise<{ id: number; name: string; floor_number: number; image_url: string | null; image_width: number | null; image_height: number | null } | null>;
    getWaypoints: (floorId: number) => Promise<Array<{ id: string; floor_id: number; x: number; y: number; type: string; label: string | null }>>;
    getConnections: (floorId: number) => Promise<Array<{ id: string; from_waypoint_id: string; to_waypoint_id: string; distance: number }>>;
    getRooms: () => Promise<Array<{ id: number; name: string; waypoint_id: string | null; floor_id: number | null }>>;
    searchRooms: (query: string) => Promise<Array<{ id: number; name: string; waypoint_id: string | null; floor_id: number | null }>>;
    findPath: (startRoomId: number, endRoomId: number, kioskId?: number) => Promise<{ success: boolean; data?: any; error?: string; offline?: boolean }>;
    syncData: () => Promise<{ success: boolean; error?: string }>;
    checkOnline: () => Promise<boolean>;
    getApiUrl: () => Promise<string>;
    openKiosk: (id: number) => void;
    backToLauncher: () => void;
    toggleFullscreen: () => void;
    log: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
        error: (msg: string) => void;
    };
    setup: {
        checkConnection: (url: string) => Promise<boolean>;
        saveAndRestart: (apiUrl: string, kioskId: number) => Promise<void>;
    };
}

declare const kioskAPI: KioskAPIInterface;
