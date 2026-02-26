import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as crypto from 'crypto';
import { Database } from './database';
import { logger } from './logger';
import * as path from 'path';
import * as fs from 'fs';

export class ApiSync {
    private client: AxiosInstance;
    private db: Database;
    private online: boolean = false;
    private baseUrl: string;

    /** In-memory hash cache to avoid re-syncing unchanged data */
    private dataHashes: Map<string, string> = new Map();

    constructor(baseUrl: string, db: Database) {
        this.db = db;
        this.baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/api$/i, '');
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            })
        });
    }

    async isOnline(): Promise<boolean> {
        try {
            await this.client.get('/api/health', { timeout: 5000 });
            this.online = true;
            return true;
        } catch {
            this.online = false;
            return false;
        }
    }

    /**
     * Compute a fast hash of JSON data to detect changes.
     */
    private hashData(data: any): string {
        const json = JSON.stringify(data);
        return crypto.createHash('md5').update(json).digest('hex');
    }

    /**
     * Check if data has changed since last sync.
     * Returns true if data is NEW or CHANGED, false if identical.
     */
    private hasChanged(key: string, data: any): boolean {
        const newHash = this.hashData(data);
        const oldHash = this.dataHashes.get(key);
        if (oldHash === newHash) {
            return false;
        }
        this.dataHashes.set(key, newHash);
        return true;
    }

    async syncFloors(): Promise<void> {
        const response = await this.client.get('/api/floors/');
        const newFloors = response.data;

        if (!this.hasChanged('floors', newFloors)) {
            logger.info('⏭️ [SYNC] Floors - o\'zgarmagan, skip');
            return;
        }

        this.db.clearFloors();
        this.db.upsertFloors(newFloors);
        logger.sync.floors(newFloors.length);
    }

    async syncRooms(): Promise<void> {
        const response = await this.client.get('/api/rooms/');

        if (!this.hasChanged('rooms', response.data)) {
            logger.info('⏭️ [SYNC] Rooms - o\'zgarmagan, skip');
            return;
        }

        this.db.clearRooms();
        this.db.upsertRooms(response.data);
        logger.sync.rooms(response.data.length);
    }

    async syncKiosks(): Promise<void> {
        const response = await this.client.get('/api/kiosks/');

        if (!this.hasChanged('kiosks', response.data)) {
            logger.info('⏭️ [SYNC] Kiosks - o\'zgarmagan, skip');
            return;
        }

        this.db.clearKiosks();
        this.db.upsertKiosks(response.data);
        logger.sync.kiosks(response.data.length);
    }

    async syncWaypointsForFloor(floorId: number): Promise<void> {
        const response = await this.client.get(`/api/waypoints/floor/${floorId}`);

        if (!this.hasChanged(`waypoints_${floorId}`, response.data)) {
            logger.debug(`⏭️ [SYNC] Floor ${floorId} waypoints - o'zgarmagan, skip`);
            return;
        }

        this.db.clearWaypointsByFloor(floorId);
        this.db.upsertWaypoints(response.data);
        logger.sync.waypoints(floorId, response.data.length);
    }

    async syncConnectionsForFloor(floorId: number): Promise<void> {
        const response = await this.client.get(`/api/waypoints/connections/floor/${floorId}`);

        if (!this.hasChanged(`connections_${floorId}`, response.data)) {
            logger.debug(`⏭️ [SYNC] Floor ${floorId} connections - o'zgarmagan, skip`);
            return;
        }

        this.db.clearConnectionsByFloor(floorId);
        this.db.upsertConnections(response.data);
        logger.sync.connections(floorId, response.data.length);
    }

    async syncAll(): Promise<void> {
        logger.sync.starting();

        // Check online status first
        if (!await this.isOnline()) {
            throw new Error('Server is not reachable');
        }

        // Sync core data — each wrapped in try/catch so one failure doesn't kill all
        try {
            await this.syncFloors();
        } catch (err) {
            logger.warn(`⚠️ [SYNC] Floors sync failed: ${err}`);
        }

        try {
            await this.syncFloorImages();
        } catch (err) {
            logger.warn(`⚠️ [SYNC] Floor images sync failed: ${err}`);
        }

        try {
            await this.syncRooms();
        } catch (err) {
            logger.warn(`⚠️ [SYNC] Rooms sync failed: ${err}`);
        }

        try {
            await this.syncKiosks();
        } catch (err) {
            logger.warn(`⚠️ [SYNC] Kiosks sync failed: ${err}`);
        }

        // Sync waypoints and connections for each floor
        const floors = this.db.getFloors();
        for (const floor of floors) {
            try {
                await this.syncWaypointsForFloor(floor.id);
            } catch (err) {
                logger.warn(`⚠️ [SYNC] Floor ${floor.id} waypoints failed: ${err}`);
            }
            try {
                await this.syncConnectionsForFloor(floor.id);
            } catch (err) {
                logger.warn(`⚠️ [SYNC] Floor ${floor.id} connections failed: ${err}`);
            }
        }

        // Update sync timestamp
        this.db.setSyncInfo('last_sync', new Date().toISOString());

        // Cleanup orphaned data
        this.db.cleanupOrphans();

        logger.sync.success();
    }

    private async syncFloorImages(): Promise<void> {
        const floors = this.db.getFloors();
        if (floors.length === 0) return;

        const imagesDir = path.join(this.db.getStorageDir(), 'images');
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        for (const floor of floors) {
            if (!floor.image_url) continue;

            const imgUrl = floor.image_url.startsWith('http')
                ? floor.image_url
                : `${this.baseUrl}${floor.image_url.startsWith('/') ? '' : '/'}${floor.image_url}`;

            const basename = path.basename(String(floor.image_url).split('?')[0]);
            const filename = `floor_${floor.id}_${basename || 'image'}`;
            const targetPath = path.join(imagesDir, filename);

            // Skip if image already exists locally
            if (fs.existsSync(targetPath)) {
                // Just ensure the DB path is set
                this.db.setFloorLocalImagePath(floor.id, targetPath);
                continue;
            }

            try {
                const resp = await this.client.get(imgUrl, { responseType: 'arraybuffer' });
                fs.writeFileSync(targetPath, Buffer.from(resp.data));
                this.db.setFloorLocalImagePath(floor.id, targetPath);
                logger.info(`📥 [SYNC] Floor ${floor.id} image downloaded`);
            } catch (err) {
                logger.warn(`Failed to download floor image (floor=${floor.id}): ${err}`);
            }
        }
    }

    async findPath(startRoomId: number, endRoomId: number, kioskId?: number): Promise<any> {
        const body: Record<string, number> = {
            end_room_id: endRoomId
        };

        if (startRoomId > 0) {
            body.start_room_id = startRoomId;
        }

        if (kioskId && kioskId > 0) {
            body.kiosk_id = kioskId;
        }

        const response = await this.client.post('/api/navigation/find-path', body);
        return response.data;
    }
}
