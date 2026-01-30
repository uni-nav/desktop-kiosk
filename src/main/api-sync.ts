// src/main/api-sync.ts
import axios, { AxiosInstance } from 'axios';
import { Database } from './database';
import { logger } from './logger';

export class ApiSync {
    private client: AxiosInstance;
    private db: Database;
    private online: boolean = false;

    constructor(baseUrl: string, db: Database) {
        this.db = db;
        this.client = axios.create({
            baseURL: baseUrl,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    async isOnline(): Promise<boolean> {
        try {
            await this.client.get('/health');
            this.online = true;
            return true;
        } catch {
            this.online = false;
            return false;
        }
    }

    async syncFloors(): Promise<void> {
        const response = await this.client.get('/api/floors/');
        this.db.upsertFloors(response.data);
        logger.sync.floors(response.data.length);
    }

    async syncRooms(): Promise<void> {
        const response = await this.client.get('/api/rooms/');
        this.db.upsertRooms(response.data);
        logger.sync.rooms(response.data.length);
    }

    async syncKiosks(): Promise<void> {
        const response = await this.client.get('/api/kiosks/');
        this.db.upsertKiosks(response.data);
        logger.sync.kiosks(response.data.length);
    }

    async syncWaypointsForFloor(floorId: number): Promise<void> {
        const response = await this.client.get(`/api/waypoints/floor/${floorId}`);
        this.db.upsertWaypoints(response.data);
        logger.sync.waypoints(floorId, response.data.length);
    }

    async syncConnectionsForFloor(floorId: number): Promise<void> {
        const response = await this.client.get(`/api/waypoints/connections/floor/${floorId}`);
        this.db.upsertConnections(response.data);
        logger.sync.connections(floorId, response.data.length);
    }

    async syncAll(): Promise<void> {
        logger.sync.starting();

        // Check online status first
        if (!await this.isOnline()) {
            throw new Error('Server is not reachable');
        }

        // Sync core data
        await this.syncFloors();
        await this.syncRooms();
        await this.syncKiosks();

        // Sync waypoints and connections for each floor
        const floors = this.db.getFloors();
        for (const floor of floors) {
            await this.syncWaypointsForFloor(floor.id);
            await this.syncConnectionsForFloor(floor.id);
        }

        // Update sync timestamp
        this.db.setSyncInfo('last_sync', new Date().toISOString());
        logger.sync.success();
    }

    async findPath(startRoomId: number, endRoomId: number, kioskId?: number): Promise<any> {
        // Build request body - only include positive IDs
        const body: Record<string, number> = {
            end_room_id: endRoomId
        };

        // Only add start_room_id if it's positive (not 0)
        if (startRoomId > 0) {
            body.start_room_id = startRoomId;
        }

        // Add kiosk_id if provided
        if (kioskId && kioskId > 0) {
            body.kiosk_id = kioskId;
        }

        const response = await this.client.post('/api/navigation/find-path', body);
        return response.data;
    }
}
