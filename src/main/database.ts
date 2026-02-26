// src/main/database.ts
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';

export interface Floor {
    id: number;
    name: string;
    floor_number: number;
    image_url: string | null;
    image_width: number | null;
    image_height: number | null;
    local_image_path?: string | null;
}

export interface Waypoint {
    id: string;
    floor_id: number;
    x: number;
    y: number;
    type: string;
    label: string | null;
    connects_to_floor: number | null;
    connects_to_waypoint: string | null;
}

export interface Connection {
    id: string;
    from_waypoint_id: string;
    to_waypoint_id: string;
    distance: number;
}

export interface Room {
    id: number;
    name: string;
    waypoint_id: string | null;
    floor_id: number | null;
    keywords: string | null;
}

export interface Kiosk {
    id: number;
    name: string;
    floor_id: number;
    waypoint_id: string | null;
    description: string | null;
}

export interface PathStep {
    waypoint_id: string;
    floor_id: number;
    x: number;
    y: number;
    type: string;
    label: string | null;
    instruction: string | null;
}

export interface NavigationResult {
    path: PathStep[];
    total_distance: number;
    floor_changes: number;
    estimated_time_minutes: number;
}

export class Database {
    private db: SqlJsDatabase | null = null;
    private dbPath: string;
    private storageDir: string;
    private initialized: boolean = false;

    /** Debounce timer for save() — prevents excessive disk writes */
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly SAVE_DEBOUNCE_MS = 500;

    constructor(userDataPath: string) {
        this.storageDir = userDataPath;
        this.dbPath = path.join(userDataPath, 'kiosk-data.db');

        // Ensure directory exists
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
    }

    async init(): Promise<void> {
        if (this.initialized) return;

        logger.db.init();

        try {
            const SQL = await initSqlJs();

            // Load existing database if exists
            if (fs.existsSync(this.dbPath)) {
                const buffer = fs.readFileSync(this.dbPath);
                this.db = new SQL.Database(buffer);
            } else {
                this.db = new SQL.Database();
            }

            this.initSchema();
            this.initialized = true;
            logger.db.initSuccess();
        } catch (error) {
            logger.db.initError(error);
            throw error;
        }
    }

    private initSchema() {
        if (!this.db) return;

        this.db.run(`
            CREATE TABLE IF NOT EXISTS floors (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                floor_number INTEGER NOT NULL,
                image_url TEXT,
                image_width INTEGER,
                image_height INTEGER
            )
        `);

        // Lightweight migrations (keep older DBs working)
        this.ensureColumn('floors', 'local_image_path', 'TEXT');

        this.db.run(`
            CREATE TABLE IF NOT EXISTS waypoints (
                id TEXT PRIMARY KEY,
                floor_id INTEGER NOT NULL,
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                type TEXT NOT NULL,
                label TEXT,
                connects_to_floor INTEGER,
                connects_to_waypoint TEXT
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS connections (
                id TEXT PRIMARY KEY,
                from_waypoint_id TEXT NOT NULL,
                to_waypoint_id TEXT NOT NULL,
                distance REAL NOT NULL
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS rooms (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                waypoint_id TEXT,
                floor_id INTEGER
            )
        `);

        this.ensureColumn('rooms', 'keywords', 'TEXT');

        this.db.run(`
            CREATE TABLE IF NOT EXISTS kiosks (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                floor_id INTEGER NOT NULL,
                waypoint_id TEXT,
                description TEXT
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS sync_info (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT
            )
        `);

        this.saveNow();
    }

    private ensureColumn(table: string, column: string, columnType: string): void {
        if (!this.db) return;
        try {
            const info = this.db.exec(`PRAGMA table_info(${table})`);
            const columns = info?.[0]?.values?.map((row) => String(row[1])) || [];
            if (columns.includes(column)) return;
            this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnType}`);
        } catch (err) {
            logger.warn(`DB migration failed for ${table}.${column}: ${err}`);
        }
    }

    /**
     * Debounced save — waits 500ms before writing to disk.
     * Multiple rapid calls result in only one disk write.
     */
    private save() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.saveNow();
            this.saveTimer = null;
        }, this.SAVE_DEBOUNCE_MS);
    }

    /**
     * Immediately write database to disk.
     */
    private saveNow() {
        if (!this.db) return;
        try {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(this.dbPath, buffer);
            logger.db.save();
        } catch (err) {
            logger.error(`❌ [DB] Failed to save: ${err}`);
        }
    }

    /**
     * Flush any pending debounced save immediately.
     * Call this before app exit.
     */
    flushSave() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            this.saveNow();
        }
    }

    getStorageDir(): string {
        return this.storageDir;
    }

    // ==================== FLOORS ====================

    getFloors(): Floor[] {
        if (!this.db) return [];
        const result = this.db.exec('SELECT * FROM floors ORDER BY floor_number');
        if (result.length === 0) return [];
        return this.mapResults<Floor>(result[0]);
    }

    getFloor(id: number): Floor | undefined {
        if (!this.db) return undefined;
        const result = this.db.exec('SELECT * FROM floors WHERE id = ?', [id]);
        if (result.length === 0 || result[0].values.length === 0) return undefined;
        return this.mapResults<Floor>(result[0])[0];
    }

    getFloorImagePaths(): Map<number, string> {
        if (!this.db) return new Map();
        try {
            const result = this.db.exec('SELECT id, local_image_path FROM floors WHERE local_image_path IS NOT NULL');
            if (result.length === 0) return new Map();

            const map = new Map<number, string>();
            result[0].values.forEach(row => {
                const id = row[0] as number;
                const path = row[1] as string;
                if (id && path) map.set(id, path);
            });
            return map;
        } catch (e) {
            return new Map();
        }
    }

    clearFloors() {
        if (!this.db) return;
        this.db.run('DELETE FROM floors');
        this.save();
    }

    upsertFloors(floors: Floor[]) {
        if (!this.db) return;
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO floors (id, name, floor_number, image_url, image_width, image_height, local_image_path)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const f of floors) {
            stmt.run([
                f.id,
                f.name,
                f.floor_number,
                f.image_url,
                f.image_width,
                f.image_height,
                f.local_image_path ?? null
            ]);
        }
        stmt.free();
        this.save();
    }

    setFloorLocalImagePath(floorId: number, localPath: string | null): void {
        if (!this.db) return;
        this.db.run('UPDATE floors SET local_image_path = ? WHERE id = ?', [localPath, floorId]);
        this.save();
    }

    // ==================== WAYPOINTS ====================

    getWaypointsByFloor(floorId: number): Waypoint[] {
        if (!this.db) return [];
        const result = this.db.exec('SELECT * FROM waypoints WHERE floor_id = ?', [floorId]);
        if (result.length === 0) return [];
        return this.mapResults<Waypoint>(result[0]);
    }

    getAllWaypoints(): Waypoint[] {
        if (!this.db) return [];
        const result = this.db.exec('SELECT * FROM waypoints');
        if (result.length === 0) return [];
        return this.mapResults<Waypoint>(result[0]);
    }

    clearWaypointsByFloor(floorId: number) {
        if (!this.db) return;
        this.db.run('DELETE FROM waypoints WHERE floor_id = ?', [floorId]);
        this.save();
    }

    upsertWaypoints(waypoints: Waypoint[]) {
        if (!this.db) return;
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO waypoints (id, floor_id, x, y, type, label, connects_to_floor, connects_to_waypoint)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const w of waypoints) {
            stmt.run([w.id, w.floor_id, w.x, w.y, w.type, w.label, w.connects_to_floor, w.connects_to_waypoint]);
        }
        stmt.free();
        this.save();
    }

    // ==================== CONNECTIONS ====================

    getConnectionsByFloor(floorId: number): Connection[] {
        if (!this.db) return [];
        const result = this.db.exec(`
            SELECT c.* FROM connections c
            WHERE c.from_waypoint_id IN (SELECT id FROM waypoints WHERE floor_id = ?)
            OR c.to_waypoint_id IN (SELECT id FROM waypoints WHERE floor_id = ?)
        `, [floorId, floorId]);
        if (result.length === 0) return [];
        return this.mapResults<Connection>(result[0]);
    }

    getAllConnections(): Connection[] {
        if (!this.db) return [];
        const result = this.db.exec('SELECT * FROM connections');
        if (result.length === 0) return [];
        return this.mapResults<Connection>(result[0]);
    }

    clearConnectionsByFloor(floorId: number) {
        if (!this.db) return;
        this.db.run(`
            DELETE FROM connections 
            WHERE from_waypoint_id IN (SELECT id FROM waypoints WHERE floor_id = ?)
        `, [floorId]);
        this.save();
    }

    upsertConnections(connections: Connection[]) {
        if (!this.db) return;
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO connections (id, from_waypoint_id, to_waypoint_id, distance)
            VALUES (?, ?, ?, ?)
        `);
        for (const c of connections) {
            stmt.run([c.id, c.from_waypoint_id, c.to_waypoint_id, c.distance]);
        }
        stmt.free();
        this.save();
    }

    // ==================== ROOMS ====================

    getRooms(): Room[] {
        if (!this.db) return [];
        const result = this.db.exec('SELECT * FROM rooms ORDER BY name');
        if (result.length === 0) return [];
        return this.mapResults<Room>(result[0]);
    }

    getRoom(id: number): Room | undefined {
        if (!this.db) return undefined;
        const result = this.db.exec('SELECT * FROM rooms WHERE id = ?', [id]);
        if (result.length === 0 || result[0].values.length === 0) return undefined;
        return this.mapResults<Room>(result[0])[0];
    }

    searchRooms(query: string): Room[] {
        if (!this.db) return [];
        const result = this.db.exec(
            "SELECT * FROM rooms WHERE name LIKE ? OR keywords LIKE ? ORDER BY name LIMIT 20",
            [`%${query}%`, `%${query}%`]
        );
        if (result.length === 0) return [];
        return this.mapResults<Room>(result[0]);
    }

    clearRooms() {
        if (!this.db) return;
        this.db.run('DELETE FROM rooms');
        this.save();
    }

    upsertRooms(rooms: Room[]) {
        if (!this.db) return;
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO rooms (id, name, waypoint_id, floor_id, keywords)
            VALUES (?, ?, ?, ?, ?)
        `);
        for (const r of rooms) {
            stmt.run([r.id, r.name, r.waypoint_id, r.floor_id, r.keywords ?? null]);
        }
        stmt.free();
        this.save();
    }

    cleanupOrphans() {
        if (!this.db) return;

        this.db.run('DELETE FROM waypoints WHERE floor_id NOT IN (SELECT id FROM floors)');
        this.db.run('DELETE FROM connections WHERE from_waypoint_id NOT IN (SELECT id FROM waypoints)');
        this.db.run('DELETE FROM connections WHERE to_waypoint_id NOT IN (SELECT id FROM waypoints)');
        this.db.run('DELETE FROM rooms WHERE floor_id IS NOT NULL AND floor_id NOT IN (SELECT id FROM floors)');
        this.db.run('DELETE FROM kiosks WHERE floor_id NOT IN (SELECT id FROM floors)');

        this.save();
        logger.info('🧹 [DB] Orphaned data cleaned up');
    }

    // ==================== KIOSKS ====================

    getKiosks(): Kiosk[] {
        if (!this.db) return [];
        const result = this.db.exec('SELECT * FROM kiosks ORDER BY name');
        if (result.length === 0) return [];
        return this.mapResults<Kiosk>(result[0]);
    }

    getKiosk(id: number): Kiosk | undefined {
        if (!this.db) return undefined;
        const result = this.db.exec('SELECT * FROM kiosks WHERE id = ?', [id]);
        if (result.length === 0 || result[0].values.length === 0) return undefined;
        return this.mapResults<Kiosk>(result[0])[0];
    }

    clearKiosks() {
        if (!this.db) return;
        this.db.run('DELETE FROM kiosks');
        this.save();
    }

    upsertKiosks(kiosks: Kiosk[]) {
        if (!this.db) return;
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO kiosks (id, name, floor_id, waypoint_id, description)
            VALUES (?, ?, ?, ?, ?)
        `);
        for (const k of kiosks) {
            stmt.run([k.id, k.name, k.floor_id, k.waypoint_id, k.description]);
        }
        stmt.free();
        this.save();
    }

    // ==================== SYNC INFO ====================

    setSyncInfo(key: string, value: string) {
        if (!this.db) return;
        this.db.run(`
            INSERT OR REPLACE INTO sync_info (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
        `, [key, value]);
        this.save();
    }

    getSyncInfo(key: string): string | undefined {
        if (!this.db) return undefined;
        const result = this.db.exec('SELECT value FROM sync_info WHERE key = ?', [key]);
        if (result.length === 0 || result[0].values.length === 0) return undefined;
        return result[0].values[0][0] as string;
    }

    // ==================== HELPER ====================

    private mapResults<T>(result: { columns: string[]; values: any[][] }): T[] {
        return result.values.map(row => {
            const obj: any = {};
            result.columns.forEach((col, i) => {
                obj[col] = row[i];
            });
            return obj as T;
        });
    }

    // ==================== PATHFINDING (A*) ====================

    /**
     * Find path between two rooms (offline).
     * Delegates to findPathBetweenWaypoints after resolving room → waypoint.
     */
    findPathOffline(startRoomId: number, endRoomId: number): NavigationResult | null {
        const startRoom = this.getRoom(startRoomId);
        const endRoom = this.getRoom(endRoomId);

        if (!startRoom?.waypoint_id || !endRoom?.waypoint_id) {
            logger.warn(`⚠️ [NAV] Missing waypoint for rooms: start=${startRoomId}, end=${endRoomId}`);
            return null;
        }

        return this.findPathBetweenWaypoints(startRoom.waypoint_id, endRoom.waypoint_id);
    }

    /**
     * Find path from a kiosk to a room (offline).
     */
    findPathFromKiosk(kioskId: number, endRoomId: number): NavigationResult | null {
        const kiosk = this.getKiosk(kioskId);
        const endRoom = this.getRoom(endRoomId);

        if (!kiosk?.waypoint_id || !endRoom?.waypoint_id) {
            logger.warn(`⚠️ [NAV] Missing waypoint: kiosk=${kiosk?.waypoint_id}, room=${endRoom?.waypoint_id}`);
            return null;
        }

        return this.findPathBetweenWaypoints(kiosk.waypoint_id, endRoom.waypoint_id);
    }

    /**
     * Core A* pathfinding between two waypoints.
     * Supports multi-floor navigation via stairs/elevator connections (bidirectional).
     */
    findPathBetweenWaypoints(startWaypointId: string, endWaypointId: string): NavigationResult | null {
        const waypoints = this.getAllWaypoints();
        const connections = this.getAllConnections();

        logger.debug(`🧭 [NAV] Pathfinding: ${startWaypointId} -> ${endWaypointId} (${waypoints.length} waypoints, ${connections.length} connections)`);

        const waypointMap = new Map(waypoints.map(w => [w.id, w]));

        const startWp = waypointMap.get(startWaypointId);
        const endWp = waypointMap.get(endWaypointId);

        if (!startWp || !endWp) {
            logger.warn('⚠️ [NAV] Start or end waypoint not found in map');
            return null;
        }

        // Build adjacency list
        const adj = new Map<string, Array<{ id: string; distance: number }>>();
        for (const conn of connections) {
            if (!adj.has(conn.from_waypoint_id)) adj.set(conn.from_waypoint_id, []);
            if (!adj.has(conn.to_waypoint_id)) adj.set(conn.to_waypoint_id, []);
            adj.get(conn.from_waypoint_id)!.push({ id: conn.to_waypoint_id, distance: conn.distance });
            adj.get(conn.to_waypoint_id)!.push({ id: conn.from_waypoint_id, distance: conn.distance });
        }

        // Add vertical connections (stairs/elevator) — bidirectional
        for (const wp of waypoints) {
            if ((wp.type === 'stairs' || wp.type === 'elevator') && wp.connects_to_waypoint) {
                if (!adj.has(wp.id)) adj.set(wp.id, []);
                adj.get(wp.id)!.push({ id: wp.connects_to_waypoint, distance: 50 });

                if (!adj.has(wp.connects_to_waypoint)) adj.set(wp.connects_to_waypoint, []);
                adj.get(wp.connects_to_waypoint)!.push({ id: wp.id, distance: 50 });
            }
        }

        // A* pathfinding
        const openSet = new Map<string, number>();
        const cameFrom = new Map<string, string>();
        const gScore = new Map<string, number>();

        gScore.set(startWaypointId, 0);
        openSet.set(startWaypointId, this.heuristic(startWp, endWp));

        while (openSet.size > 0) {
            let current = '';
            let lowestF = Infinity;
            for (const [id, f] of openSet) {
                if (f < lowestF) {
                    lowestF = f;
                    current = id;
                }
            }

            if (current === endWaypointId) {
                logger.debug('✅ [NAV] Path found!');
                return this.reconstructPath(cameFrom, current, gScore.get(current)!, waypointMap);
            }

            openSet.delete(current);
            const neighbors = adj.get(current) || [];

            for (const { id: neighborId, distance } of neighbors) {
                const tentativeG = (gScore.get(current) ?? Infinity) + distance;

                if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
                    cameFrom.set(neighborId, current);
                    gScore.set(neighborId, tentativeG);
                    const neighborWp = waypointMap.get(neighborId);
                    const f = tentativeG + (neighborWp ? this.heuristic(neighborWp, endWp) : 0);
                    openSet.set(neighborId, f);
                }
            }
        }

        logger.warn('⚠️ [NAV] No path found');
        return null;
    }

    private heuristic(from: Waypoint, to: Waypoint): number {
        const dx = from.x - to.x;
        const dy = from.y - to.y;
        const floorPenalty = from.floor_id !== to.floor_id ? 100 : 0;
        return Math.sqrt(dx * dx + dy * dy) + floorPenalty;
    }

    private reconstructPath(
        cameFrom: Map<string, string>,
        endId: string,
        totalDistance: number,
        waypointMap: Map<string, Waypoint>
    ): NavigationResult {
        const path: string[] = [];
        let current: string | undefined = endId;

        while (current) {
            path.unshift(current);
            current = cameFrom.get(current);
        }

        const pathSteps: PathStep[] = path.map(id => {
            const wp = waypointMap.get(id)!;
            return {
                waypoint_id: wp.id,
                floor_id: wp.floor_id,
                x: wp.x,
                y: wp.y,
                type: wp.type,
                label: wp.label,
                instruction: this.getInstruction(wp)
            };
        });

        let floorChanges = 0;
        for (let i = 1; i < pathSteps.length; i++) {
            if (pathSteps[i].floor_id !== pathSteps[i - 1].floor_id) {
                floorChanges++;
            }
        }

        return {
            path: pathSteps,
            total_distance: totalDistance,
            floor_changes: floorChanges,
            estimated_time_minutes: totalDistance / 50
        };
    }

    private getInstruction(wp: Waypoint): string | null {
        switch (wp.type) {
            case 'stairs': return "Zinadan o'ting";
            case 'elevator': return "Lift bilan ko'tariling";
            case 'room': return wp.label ? `"${wp.label}" ga boring` : null;
            default: return null;
        }
    }
}
