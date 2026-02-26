// src/renderer/kiosk.ts - Complete Kiosk Implementation
/// <reference path="./types.d.ts" />

interface Floor {
    id: number;
    name: string;
    floor_number: number;
    image_url: string | null;
    image_width: number | null;
    image_height: number | null;
    local_image_path?: string | null;
}

interface Waypoint {
    id: string;
    floor_id: number;
    x: number;
    y: number;
    type: string;
    label: string | null;
}

interface Room {
    id: number;
    name: string;
    waypoint_id: string | null;
    floor_id: number | null;
}

interface PathStep {
    waypoint_id: string;
    floor_id: number;
    x: number;
    y: number;
    type: string;
    label: string | null;
    instruction: string | null;
}

interface NavigationResult {
    path: PathStep[];
    total_distance: number;
    floor_changes: number;
    estimated_time_minutes: number;
}

interface FloorRun {
    floorId: number;
    steps: PathStep[];
}

// Constants
const ANIMATION_SPEED = 45; // reduced from 70px per second
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_ANIMATION_LOOPS = 3;
const MAX_CACHED_IMAGES = 10; // Max floor images to keep in memory

class KioskApp {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private container: HTMLElement;
    private kioskId: number;
    private kioskWaypointId: string | null = null;
    private kioskFloorId: number | null = null;

    // Modern Animation Colors
    private colors = {
        cyan: '#06b6d4',
        blue: '#3b82f6',
        red: '#ef4444',
        white: '#ffffff',
        glow: 'rgba(6, 182, 212, 0.4)'
    };

    private floors: Floor[] = [];
    private currentFloor: Floor | null = null;
    private waypoints: Waypoint[] = [];
    private waypointsByFloor: Map<number, Waypoint[]> = new Map();
    private rooms: Room[] = [];
    private floorImages: Map<number, HTMLImageElement> = new Map();

    private selectedRoom: Room | null = null;
    private navigationPath: PathStep[] | null = null;
    private pathInfo: NavigationResult | null = null;

    private apiBaseUrl: string = '';

    // Animation state
    private floorRuns: FloorRun[] = [];
    private activeRunIndex: number = 0;
    private animationProgress: number = 0;
    private dashOffset: number = 0;
    private animationStartTime: number = 0;
    private isAnimating: boolean = false;
    private animationFrame: number | null = null;
    private animationLoopCount: number = 0;

    // Idle timer
    private idleTimer: number | null = null;
    private idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS;
    private maxAnimationLoops: number = DEFAULT_ANIMATION_LOOPS;

    // Concurrency guard for floor loading
    private floorSelectRequestId: number = 0;

    constructor() {
        this.canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;
        this.container = this.canvas.parentElement!;

        // Parse kiosk_id from URL
        const params = new URLSearchParams(window.location.search);
        this.kioskId = parseInt(params.get('kiosk_id') || '0');

        this.init();

        // Cleanup on page unload — prevent memory leak
        window.addEventListener('beforeunload', () => {
            if (this.animationFrame) {
                cancelAnimationFrame(this.animationFrame);
                this.animationFrame = null;
            }
            if (this.idleTimer) {
                window.clearTimeout(this.idleTimer);
                this.idleTimer = null;
            }
        });
    }

    async init() {
        this.setupEventListeners();
        this.resizeCanvas();
        this.resetIdleTimer();

        // Get API URL
        this.apiBaseUrl = await kioskAPI.getApiUrl();

        // Load settings (idle timeout, animation loops)
        try {
            const settings = await kioskAPI.getSettings();
            if (Number.isFinite(settings.IDLE_TIMEOUT_MS) && settings.IDLE_TIMEOUT_MS > 0) {
                this.idleTimeoutMs = settings.IDLE_TIMEOUT_MS;
            }
            if (Number.isFinite(settings.ANIMATION_LOOPS) && settings.ANIMATION_LOOPS > 0) {
                this.maxAnimationLoops = settings.ANIMATION_LOOPS;
            }
        } catch {
            // ignore settings errors
        }

        // Load kiosk info
        const kiosk = await kioskAPI.getKiosk(this.kioskId);
        if (kiosk) {
            document.getElementById('kiosk-name')!.textContent = kiosk.name;
            this.kioskWaypointId = kiosk.waypoint_id;
            this.kioskFloorId = kiosk.floor_id;
        }

        // Check online status
        this.updateOnlineStatus();

        // Load data
        await this.loadFloors();
        await this.loadRooms();

        // Select kiosk's floor or first floor
        const startFloor = this.floors.find(f => f.id === this.kioskFloorId) || this.floors[0];
        if (startFloor) {
            await this.selectFloor(startFloor);
        }
    }

    setupEventListeners() {
        // Welcome modal buttons
        document.getElementById('start-btn')!.addEventListener('click', () => {
            this.hideWelcomeModal();
            this.resetIdleTimer();
        });



        // (Kiosk screen) Back/sync buttons removed intentionally to lock the kiosk session.

        // Search
        const searchInput = document.getElementById('search-input') as HTMLInputElement;
        searchInput.addEventListener('input', (e) => {
            this.handleSearch((e.target as HTMLInputElement).value);
            this.resetIdleTimer();
        });
        searchInput.addEventListener('virtual-enter', () => {
            this.handleSearchEnter();
            this.resetIdleTimer();
        });
        searchInput.addEventListener('focus', () => {
            if (searchInput.value.length >= 2) {
                document.getElementById('search-results')!.classList.remove('hidden');
            }
            this.resetIdleTimer();
        });

        // Hide search results when clicking outside
        document.addEventListener('click', (e) => {
            if (!(e.target as HTMLElement).closest('.search-field')) {
                document.getElementById('search-results')!.classList.add('hidden');
            }
            this.resetIdleTimer();
        });

        // Activity tracking for idle timer
        ['mousemove', 'keydown', 'touchstart', 'pointerdown'].forEach(event => {
            window.addEventListener(event, () => this.resetIdleTimer(), { passive: true });
        });

        // Clear destination
        document.getElementById('clear-destination')!.addEventListener('click', () => {
            this.clearSelection();
        });

        // Navigate button
        document.getElementById('navigate-btn')!.addEventListener('click', () => {
            this.findPath();
        });

        // Clear path
        document.getElementById('clear-path')!.addEventListener('click', () => {
            this.clearPath();
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.render(performance.now());
        });
    }

    resetIdleTimer() {
        if (this.idleTimer) {
            window.clearTimeout(this.idleTimer);
        }
        this.idleTimer = window.setTimeout(() => {
            this.handleIdleTimeout();
        }, this.idleTimeoutMs);
    }

    handleIdleTimeout() {
        // Reset everything and show welcome modal
        this.clearSelection();
        this.clearPath();
        this.showWelcomeModal();

        // Go back to kiosk floor
        const kioskFloor = this.floors.find(f => f.id === this.kioskFloorId);
        if (kioskFloor && kioskFloor !== this.currentFloor) {
            this.selectFloor(kioskFloor);
        }
    }

    showWelcomeModal() {
        const modal = document.getElementById('welcome-modal')!;
        modal.classList.remove('hidden');
    }

    hideWelcomeModal() {
        const modal = document.getElementById('welcome-modal')!;
        modal.classList.add('hidden');
    }

    toggleFullscreen() {
        const elem = document.documentElement;
        if (!document.fullscreenElement) {
            elem.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
    }

    resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    async updateOnlineStatus() {
        try {
            const online = await kioskAPI.checkOnline();
            const indicator = document.getElementById('status-indicator');
            if (!indicator) return;
            indicator.className = `status-indicator ${online ? 'online' : 'offline'}`;
        } catch {
            const indicator = document.getElementById('status-indicator');
            if (!indicator) return;
            indicator.className = 'status-indicator offline';
        }
    }

    async loadFloors() {
        this.floors = await kioskAPI.getFloors();
        this.renderFloorTabs();
    }

    async loadRooms() {
        this.rooms = await kioskAPI.getRooms();
    }

    renderFloorTabs() {
        const tabsContainer = document.getElementById('floor-tabs')!;
        tabsContainer.innerHTML = this.floors.map(floor => `
            <button class="floor-tab ${floor === this.currentFloor ? 'active' : ''}" 
                    data-floor-id="${floor.id}">
                ${floor.floor_number}-qavat
            </button>
        `).join('');

        tabsContainer.querySelectorAll('.floor-tab').forEach(tab => {
            tab.addEventListener('click', async () => {
                const floorId = parseInt(tab.getAttribute('data-floor-id')!);
                const floor = this.floors.find(f => f.id === floorId);
                if (floor) {
                    await this.selectFloor(floor);
                }
            });
        });
    }

    async selectFloor(floor: Floor) {
        const requestId = ++this.floorSelectRequestId;
        this.currentFloor = floor;
        this.renderFloorTabs();

        // Show loading
        document.getElementById('map-loading')!.classList.remove('hidden');

        // Load floor data
        const waypoints = await kioskAPI.getWaypoints(floor.id);
        if (requestId !== this.floorSelectRequestId) return;
        this.waypoints = waypoints;
        this.waypointsByFloor.set(floor.id, this.waypoints);

        // Load floor image
        await this.loadFloorImage(floor);
        if (requestId !== this.floorSelectRequestId) return;

        // Hide loading
        document.getElementById('map-loading')!.classList.add('hidden');

        // Start animation loop
        this.startAnimationLoop();
    }

    async loadFloorImage(floor: Floor): Promise<void> {
        const localPath = (floor.local_image_path || '').trim();
        if (localPath) {
            // Check cache
            if (this.floorImages.has(floor.id)) return;
            const fileUrl = this.toFileUrl(localPath);
            return new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.floorImages.set(floor.id, img);
                    resolve();
                };
                img.onerror = () => resolve();
                img.src = fileUrl;
            });
        }

        if (!floor.image_url) {
            return;
        }

        // Check cache
        if (this.floorImages.has(floor.id)) {
            return;
        }

        const imageUrl = floor.image_url.startsWith('http')
            ? floor.image_url
            : `${this.apiBaseUrl}${floor.image_url.startsWith('/') ? '' : '/'}${floor.image_url}`;

        return new Promise<void>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                this.floorImages.set(floor.id, img);
                this.cleanupImageCache(floor.id);
                resolve();
            };
            img.onerror = () => {
                resolve();
            };
            img.src = imageUrl;
        });
    }

    /**
     * Cleanup image cache — keep only MAX_CACHED_IMAGES most recent.
     * Always keeps the current floor image.
     */
    private cleanupImageCache(currentFloorId: number) {
        if (this.floorImages.size <= MAX_CACHED_IMAGES) return;

        const keys = Array.from(this.floorImages.keys());
        // Remove oldest entries first, but never the current floor
        for (const key of keys) {
            if (this.floorImages.size <= MAX_CACHED_IMAGES) break;
            if (key === currentFloorId) continue;
            if (key === this.kioskFloorId) continue; // Never remove kiosk's own floor
            this.floorImages.delete(key);
        }
    }

    private toFileUrl(filePath: string): string {
        const normalized = filePath.replace(/\\/g, '/');
        const prefix = /^[A-Za-z]:\//.test(normalized) ? 'file:///' : 'file://';
        return encodeURI(`${prefix}${normalized}`);
    }

    async handleSearch(query: string) {
        const resultsContainer = document.getElementById('search-results')!;

        if (query.length < 2) {
            resultsContainer.classList.add('hidden');
            return;
        }

        const results = await kioskAPI.searchRooms(query);

        if (results.length === 0) {
            resultsContainer.innerHTML = '<div class="search-result-item"><span class="name">Natija topilmadi</span></div>';
        } else {
            resultsContainer.innerHTML = results.map(room => {
                const floor = this.floors.find(f => f.id === room.floor_id);
                return `
                    <div class="search-result-item" data-room-id="${room.id}">
                        <span class="name">${room.name}</span>
                        <span class="floor">${floor ? floor.floor_number + '-qavat' : ''}</span>
                    </div>
                `;
            }).join('');

            resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const roomId = parseInt(item.getAttribute('data-room-id')!);
                    const room = results.find(r => r.id === roomId);
                    if (room) {
                        this.selectRoom(room);
                    }
                });
            });
        }

        resultsContainer.classList.remove('hidden');
    }

    private handleSearchEnter() {
        const resultsContainer = document.getElementById('search-results');
        const first = resultsContainer?.querySelector<HTMLElement>('.search-result-item[data-room-id]');
        if (first) {
            first.click();
            return;
        }

        const navigateBtn = document.getElementById('navigate-btn') as HTMLButtonElement | null;
        if (navigateBtn && !navigateBtn.disabled) {
            navigateBtn.click();
        }
    }

    selectRoom(room: Room) {
        this.selectedRoom = room;

        // Update UI
        document.getElementById('search-results')!.classList.add('hidden');
        (document.getElementById('search-input') as HTMLInputElement).value = '';

        document.getElementById('selected-destination')!.classList.remove('hidden');
        document.getElementById('destination-name')!.textContent = room.name;

        (document.getElementById('navigate-btn') as HTMLButtonElement).disabled = false;
    }

    clearSelection() {
        this.selectedRoom = null;
        document.getElementById('selected-destination')!.classList.add('hidden');
        (document.getElementById('navigate-btn') as HTMLButtonElement).disabled = true;
        this.clearPath();
    }

    buildFloorRuns(path: PathStep[]): FloorRun[] {
        const runs: FloorRun[] = [];
        path.forEach((step) => {
            const last = runs[runs.length - 1];
            if (!last || last.floorId !== step.floor_id) {
                runs.push({ floorId: step.floor_id, steps: [step] });
                return;
            }
            last.steps.push(step);
        });
        return runs;
    }

    async findPath() {
        if (!this.selectedRoom) return;

        const navigateBtn = document.getElementById('navigate-btn') as HTMLButtonElement;
        navigateBtn.disabled = true;
        navigateBtn.textContent = 'Qidirilmoqda...';

        try {
            kioskAPI.log.info(`Finding path: room=${this.selectedRoom.id}, kiosk=${this.kioskId}`);
            const result = await kioskAPI.findPath(
                0,
                this.selectedRoom.id,
                this.kioskId
            );
            kioskAPI.log.info(`Path result success: ${result.success}`);

            if (result.success && result.data) {
                kioskAPI.log.info(`Path found with ${result.data.path?.length} steps`);

                this.pathInfo = result.data;
                this.navigationPath = result.data.path;
                this.floorRuns = this.buildFloorRuns(result.data.path);
                this.activeRunIndex = 0;
                this.animationLoopCount = 0;

                // Preload all floor images for the path
                await this.preloadPathFloorImages();

                this.showPathInfo(result.data);
                this.showTextDirections(result.data);

                // Reset animation
                this.animationProgress = 0;
                this.animationStartTime = performance.now();
                this.isAnimating = true;

                // Go to first step's floor
                if (result.data.path.length > 0) {
                    const firstStep = result.data.path[0];
                    const floor = this.floors.find(f => f.id === firstStep.floor_id);
                    if (floor && floor !== this.currentFloor) {
                        await this.selectFloor(floor);
                    }
                }
            } else {
                this.showToast(result.error || "Yo'l topilmadi", 'error');
            }
        } catch (error) {
            console.error('Path finding error:', error);
            this.showToast("Yo'l topishda xatolik yuz berdi", 'error');
        } finally {
            navigateBtn.disabled = false;
            navigateBtn.textContent = '🧭 Yo\'l ko\'rsatish';
        }
    }

    async preloadPathFloorImages() {
        const floorIds = new Set(this.floorRuns.map(run => run.floorId));
        for (const floorId of floorIds) {
            const floor = this.floors.find(f => f.id === floorId);
            if (floor) {
                await this.loadFloorImage(floor);
                // Also load waypoints
                if (!this.waypointsByFloor.has(floorId)) {
                    const waypoints = await kioskAPI.getWaypoints(floorId);
                    this.waypointsByFloor.set(floorId, waypoints);
                }
            }
        }
    }

    showPathInfo(info: NavigationResult) {
        const pathInfoEl = document.getElementById('path-info')!;
        pathInfoEl.classList.add('hidden'); // HIDDEN AS PER USER REQUEST

        document.getElementById('distance')!.textContent = Math.round(info.total_distance).toString();
        document.getElementById('time')!.textContent = info.estimated_time_minutes.toFixed(1);

        if (info.floor_changes > 0) {
            document.getElementById('floor-changes-container')!.classList.remove('hidden');
            document.getElementById('floor-changes')!.textContent = info.floor_changes.toString();
        } else {
            document.getElementById('floor-changes-container')!.classList.add('hidden');
        }
    }

    showTextDirections(info: NavigationResult) {
        const directionsEl = document.getElementById('directions-list')!;

        if (info.path.length === 0) {
            directionsEl.innerHTML = '<div class="empty-directions">Xona tanlang va yo\'l qidiring</div>';
            return;
        }

        const directions: string[] = [];
        let currentFloorId = info.path[0].floor_id;
        let stepNum = 1;

        // Start point
        const startFloor = this.floors.find(f => f.id === currentFloorId);
        directions.push(`${stepNum}. Kioskdan boshlang (${startFloor?.name || 'Qavat'})`);
        stepNum++;

        for (let i = 0; i < info.path.length; i++) {
            const step = info.path[i];

            // Floor change
            if (step.floor_id !== currentFloorId) {
                const newFloor = this.floors.find(f => f.id === step.floor_id);
                const oldFloor = this.floors.find(f => f.id === currentFloorId);
                const direction = (newFloor?.floor_number || 0) > (oldFloor?.floor_number || 0) ? 'yuqoriga' : 'pastga';

                if (step.type === 'stairs') {
                    directions.push(`${stepNum}. Zinadan ${direction} chiqing → ${newFloor?.name || 'Qavat'}`);
                } else if (step.type === 'elevator') {
                    directions.push(`${stepNum}. Liftdan ${direction} tushing → ${newFloor?.name || 'Qavat'}`);
                } else {
                    directions.push(`${stepNum}. ${newFloor?.name || 'Qavat'}ga o'ting`);
                }
                currentFloorId = step.floor_id;
                stepNum++;
            }

            // Room destination
            if (i === info.path.length - 1 && this.selectedRoom) {
                directions.push(`${stepNum}. ${this.selectedRoom.name}ga yetib keldingiz! ✓`);
            }
        }

        directionsEl.innerHTML = directions.map(d => `<div class="direction-item">${d}</div>`).join('');
    }

    clearPath() {
        this.navigationPath = null;
        this.pathInfo = null;
        this.floorRuns = [];
        this.isAnimating = false;
        this.animationProgress = 0;
        this.animationLoopCount = 0;
        document.getElementById('path-info')!.classList.add('hidden');
        document.getElementById('directions-list')!.innerHTML = '<div class="empty-directions">Xona tanlang va yo\'l qidiring</div>';
    }

    async syncData() {
        const syncBtn = document.getElementById('sync-btn') as HTMLButtonElement | null;
        if (syncBtn) syncBtn.disabled = true;

        try {
            const result = await kioskAPI.syncData();
            await this.updateOnlineStatus();

            if (result.success) {
                await this.loadFloors();
                await this.loadRooms();
                if (this.currentFloor) {
                    await this.selectFloor(this.currentFloor);
                }
            }
        } catch (error) {
            console.error('Sync error:', error);
        } finally {
            if (syncBtn) syncBtn.disabled = false;
        }
    }

    startAnimationLoop() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        this.animate();
    }

    animate = () => {
        const time = performance.now();
        this.render(time);
        this.animationFrame = requestAnimationFrame(this.animate);
    }

    computePathLength(points: { x: number; y: number }[]): number {
        let len = 0;
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            len += Math.hypot(dx, dy);
        }
        return len;
    }

    getPointAtLength(points: { x: number; y: number }[], length: number): { x: number; y: number } {
        let remaining = length;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const segLen = Math.hypot(b.x - a.x, b.y - a.y);
            if (segLen === 0) continue;
            if (remaining <= segLen) {
                const t = remaining / segLen;
                return {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                };
            }
            remaining -= segLen;
        }
        return points[points.length - 1] || { x: 0, y: 0 };
    }



    // --- Modern Rendering Helpers ---

    drawGradientPath(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]) {
        if (points.length < 2) return;

        // Create gradient along the path bounding box for simplicity, 
        // or just a fixed gradient from start to end of the viewport
        // For a path, a strokeStyle gradient is tricky without a second canvas.
        // Let's use a "Glowing Line" effect with a fixed lush solid color + shadow first, 
        // effectively gradient-like via shadow.

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 6;
        ctx.strokeStyle = this.colors.cyan;
        ctx.shadowColor = this.colors.cyan;
        ctx.shadowBlur = 15;
        ctx.globalAlpha = 0.6; // Base path is semi-transparent

        ctx.beginPath();
        points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.restore();
    }

    drawFlowEffect(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], totalLen: number, time: number) {
        if (points.length < 2) return;

        // Create a moving dash effect (Flowing Energy)
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = this.colors.white;
        ctx.shadowColor = this.colors.white;
        ctx.shadowBlur = 10;

        // Flow speed
        const offset = -(time / 10) % 40; // 40px pattern

        ctx.setLineDash([10, 30]); // Short opaque dash, long gap
        ctx.lineDashOffset = offset;

        ctx.beginPath();
        points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.restore();
    }

    drawNavigator(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, nextPos: { x: number; y: number } | null) {
        ctx.save();
        ctx.translate(pos.x, pos.y);

        // Calculate rotation/orientation
        // DO NOT rotate the full canvas, or the person will be upside down going left.
        // Instead, just flip horizontally if moving left.
        let isMovingLeft = false;
        if (nextPos) {
            const dx = nextPos.x - pos.x;
            if (dx < 0) isMovingLeft = true;
        }

        if (isMovingLeft) {
            ctx.scale(-1, 1);
        }

        // WALKING MAN ANIMATION (Side View / Billboard style)
        // Since we rotate the canvas to align with the path, drawing a "Side View" man 
        // effectively looks like he is walking along the line on the floor.

        const time = performance.now();
        const cycle = (time / 400) % (Math.PI * 2); // Walking cycle speed

        // Colors
        ctx.fillStyle = this.colors.blue;
        ctx.strokeStyle = this.colors.white;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 5;

        // Bouncing body
        const bounce = Math.abs(Math.sin(cycle * 2)) * 2;

        // --- DRAWING THE MAN (Facing Right relative to path) ---
        // Scale him up a bit
        const s = 1.2;

        // 1. LEGS
        // Right Leg (Back)
        const rightLegAngle = Math.sin(cycle) * 0.8;
        ctx.beginPath();
        ctx.moveTo(0, 0 - bounce); // Hip
        ctx.lineTo(Math.sin(rightLegAngle) * 12 * s, (Math.cos(rightLegAngle) * 12 * s) - bounce); // Foot
        ctx.stroke();

        // Left Leg (Front)
        const leftLegAngle = Math.sin(cycle + Math.PI) * 0.8;
        ctx.beginPath();
        ctx.moveTo(0, 0 - bounce); // Hip
        ctx.lineTo(Math.sin(leftLegAngle) * 12 * s, (Math.cos(leftLegAngle) * 12 * s) - bounce); // Foot
        ctx.stroke();

        // 2. BODY
        ctx.beginPath();
        ctx.moveTo(0, 0 - bounce); // Hip
        ctx.lineTo(2 * s, -14 * s - bounce); // Neck (slightly forward lean)
        ctx.stroke();

        // 3. ARMS
        // Right Arm (Back) - swings opposite to right leg
        const rightArmAngle = Math.sin(cycle + Math.PI) * 0.6;
        ctx.beginPath();
        ctx.moveTo(2 * s, -12 * s - bounce); // Shoulder
        ctx.lineTo(Math.sin(rightArmAngle) * 10 * s + 2, (Math.cos(rightArmAngle) * 10 * s) - 12 - bounce); // Hand
        ctx.stroke();

        // 3. HEAD
        ctx.beginPath();
        ctx.fillStyle = this.colors.blue;
        ctx.arc(3 * s, -16 * s - bounce, 3.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 4. Left Arm (Front)
        const leftArmAngle = Math.sin(cycle) * 0.6;
        ctx.beginPath();
        ctx.moveTo(2 * s, -12 * s - bounce); // Shoulder
        ctx.lineTo(Math.sin(leftArmAngle) * 10 * s + 2, (Math.cos(leftArmAngle) * 10 * s) - 12 - bounce); // Hand
        ctx.stroke();

        ctx.restore();
    }

    drawStartMarker(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, time: number) {
        // Radar Pulse Effect
        const pulse1 = (Math.sin(time / 400) + 1) / 2;
        const pulse2 = (Math.sin((time + 1000) / 400) + 1) / 2; // Offset pulse

        ctx.save();
        ctx.translate(pos.x, pos.y);

        // Outer Ring 1
        ctx.beginPath();
        ctx.strokeStyle = `rgba(6, 182, 212, ${1 - pulse1})`;
        ctx.lineWidth = 2;
        ctx.arc(0, 0, 10 + pulse1 * 30, 0, Math.PI * 2);
        ctx.stroke();

        // Outer Ring 2
        ctx.beginPath();
        ctx.strokeStyle = `rgba(6, 182, 212, ${1 - pulse2})`;
        ctx.lineWidth = 2;
        ctx.arc(0, 0, 10 + pulse2 * 30, 0, Math.PI * 2);
        ctx.stroke();

        // Core
        ctx.beginPath();
        ctx.fillStyle = this.colors.cyan;
        ctx.strokeStyle = this.colors.white;
        ctx.lineWidth = 3;
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Label shadow
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 4;
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText("Siz shu yerdasiz", 0, 24);

        ctx.restore();
    }

    drawEndMarker(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, time: number, label: string) {
        const bounce = Math.abs(Math.sin(time / 300)) * 10;

        ctx.save();
        ctx.translate(pos.x, pos.y);

        // Shadow on "ground"
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        let shadowSize = 8 - bounce / 3;
        if (shadowSize < 0) shadowSize = 0;
        ctx.ellipse(0, 0, shadowSize, shadowSize / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Floating Pin
        ctx.translate(0, -bounce);

        // Pin Shape (Standard Teardrop)
        const pinSize = 20; // slightly taller
        const pinWidth = 10; // wider

        ctx.beginPath();
        // Top Circle arc
        ctx.arc(0, -pinSize, pinWidth, Math.PI, 0);
        // Bottom Point
        ctx.bezierCurveTo(pinWidth, -pinSize + 15, 0, 0, 0, 0);
        ctx.bezierCurveTo(0, 0, -pinWidth, -pinSize + 15, -pinWidth, -pinSize);
        ctx.closePath();

        // Gradient Fill (Glossy Red)
        const grad = ctx.createLinearGradient(-12, -pinSize - 10, 12, -20);
        grad.addColorStop(0, '#ff5252'); // Light Red
        grad.addColorStop(1, '#b91c1c'); // Dark Red

        ctx.fillStyle = grad;
        ctx.strokeStyle = '#4dd4e6ff'; // User's custom cyan
        ctx.lineWidth = 2.0;
        ctx.fill();
        ctx.stroke();

        // Inner White Circle
        ctx.beginPath();
        ctx.fillStyle = '#ffffff';
        ctx.arc(0, -pinSize, 5, 0, Math.PI * 2); // User's custom size
        ctx.fill();

        // Label
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 4;
        ctx.textAlign = 'center';
        ctx.fillText(label, 0, -pinSize - 22);

        ctx.restore();
    }

    drawRoomLabels(ctx: CanvasRenderingContext2D, toCanvas: (p: { x: number, y: number }) => { x: number, y: number }) {
        if (!this.waypoints || this.waypoints.length === 0) return;

        ctx.save();
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        this.waypoints.forEach(wp => {
            // Only draw if it's a room and has a label
            if (wp.type === 'room' && wp.label) {
                const pos = toCanvas({ x: wp.x, y: wp.y });
                const text = wp.label;
                const metrics = ctx.measureText(text);
                const paddingX = 10; // Extra horizontal padding
                const paddingY = 6;  // Extra vertical padding
                const w = metrics.width + paddingX * 2;
                const h = 16 + paddingY * 2; // Taller background

                // Glassmorphism Background
                ctx.save();
                ctx.translate(pos.x, pos.y);

                // Shadow
                ctx.shadowColor = 'rgba(0,0,0,0.4)';
                ctx.shadowBlur = 4;
                ctx.shadowOffsetY = 2;

                // Background (Bright White/Glass)
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // High contrast white
                ctx.strokeStyle = 'rgba(200, 200, 200, 0.5)'; // Subtle border
                ctx.lineWidth = 1;

                // Rounded Rect
                ctx.beginPath();
                ctx.roundRect(-w / 2, -h / 2, w, h, 6);
                ctx.fill();
                ctx.stroke();

                // Text (Sharp Black)
                ctx.shadowColor = 'transparent'; // Remove shadow for text clarity
                ctx.fillStyle = '#000000'; // Black text is easiest to read on white
                ctx.font = 'bold 12px Inter, sans-serif';
                ctx.fillText(text, 0, 0);

                ctx.restore();
            }
        });
        ctx.restore();
    }

    render(time: number) {
        if (!this.ctx || !this.canvas) return;
        const ctx = this.ctx;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        // Clear canvas with dark elegant background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);

        const floorImage = this.currentFloor ? this.floorImages.get(this.currentFloor.id) : null;

        if (!floorImage || !this.currentFloor) {
            ctx.fillStyle = '#64748b';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Rasm yuklanmagan', width / 2, height / 2);
            return;
        }

        // Calculate scale and offset to fit image
        const imgWidth = this.currentFloor.image_width || floorImage.width;
        const imgHeight = this.currentFloor.image_height || floorImage.height;
        const scale = Math.min(width / imgWidth, height / imgHeight) * 0.95; // Slightly smaller for padding
        const imageWidth = imgWidth * scale;
        const imageHeight = imgHeight * scale;
        const offsetX = (width - imageWidth) / 2;
        const offsetY = (height - imageHeight) / 2;

        // Draw floor image
        ctx.drawImage(floorImage, offsetX, offsetY, imageWidth, imageHeight);

        // Darken backdrop slightly to make path pop (Reduced for clarity)
        ctx.fillStyle = 'rgba(15, 23, 42, 0.1)'; // Was 0.4
        ctx.fillRect(0, 0, width, height);

        // Coordinate converter
        const toCanvas = (point: { x: number; y: number }) => ({
            x: offsetX + point.x * scale,
            y: offsetY + point.y * scale,
        });

        // Draw Room Labels (Glass Effect)
        this.drawRoomLabels(ctx, toCanvas);

        // Get path for current floor RUN (not all points on this floor to avoid cross-floor jumps)
        const activeRun = this.floorRuns[this.activeRunIndex];
        const currentRunPath = activeRun && activeRun.floorId === this.currentFloor?.id
            ? activeRun.steps
            : [];

        const points = currentRunPath.map(step => toCanvas({ x: step.x, y: step.y }));

        if (points.length >= 2) {
            const totalLength = this.computePathLength(points);

            // Handle animation logic (same as before but cleaner)
            if (this.isAnimating) {
                const elapsed = (time - this.animationStartTime) / 1000;
                this.animationProgress = elapsed * ANIMATION_SPEED;

                // Check finish logic
                if (this.animationProgress >= totalLength) {
                    // ... same multi-floor logic logic as before ...
                    // For brevity, using the core logic block:
                    if (this.activeRunIndex < this.floorRuns.length - 1) {
                        this.activeRunIndex++;
                        const nextRun = this.floorRuns[this.activeRunIndex];
                        const nextFloor = this.floors.find(f => f.id === nextRun.floorId);

                        if (nextFloor && nextFloor !== this.currentFloor) {
                            this.selectFloor(nextFloor);
                            this.animationProgress = 0;
                            this.animationStartTime = time;
                        }
                    } else {
                        this.animationLoopCount++;
                        if (this.animationLoopCount < this.maxAnimationLoops) {
                            this.activeRunIndex = 0;
                            this.animationProgress = 0;
                            this.animationStartTime = time;
                            if (this.floorRuns.length > 0) {
                                const firstRun = this.floorRuns[0];
                                const firstFloor = this.floors.find(f => f.id === firstRun.floorId);
                                if (firstFloor && firstFloor !== this.currentFloor) {
                                    this.selectFloor(firstFloor);
                                }
                            }
                        } else {
                            this.isAnimating = false;
                            this.animationProgress = totalLength;
                            const kioskFloor = this.floors.find(f => f.id === this.kioskFloorId);
                            if (kioskFloor && kioskFloor !== this.currentFloor) {
                                this.selectFloor(kioskFloor);
                            }
                        }
                    }
                }
            }

            const drawProgress = this.isAnimating
                ? Math.min(this.animationProgress, totalLength)
                : totalLength;

            // 1. Draw The "Energy" Path
            this.drawGradientPath(ctx, points);
            this.drawFlowEffect(ctx, points, totalLength, time);

            // 2. Draw The "Navigator" (Arrow)
            if (this.isAnimating && drawProgress < totalLength) {
                const currentPos = this.getPointAtLength(points, drawProgress);
                // Look ahead slightly for rotation
                const lookAheadDist = Math.min(drawProgress + 10, totalLength);
                const nextPos = this.getPointAtLength(points, lookAheadDist);

                this.drawNavigator(ctx, currentPos, nextPos);
            }
        }

        // Draw Start Marker (Radar)
        if (this.kioskWaypointId && this.currentFloor?.id === this.kioskFloorId) {
            const kioskWp = this.waypoints.find(w => w.id === this.kioskWaypointId);
            if (kioskWp) {
                const pos = toCanvas({ x: kioskWp.x, y: kioskWp.y });
                this.drawStartMarker(ctx, pos, time);
            }
        }

        // Draw End Marker (3D Pin)
        const lastStep = this.navigationPath?.[this.navigationPath.length - 1];
        if (lastStep && lastStep.floor_id === this.currentFloor?.id) {
            const pos = toCanvas({ x: lastStep.x, y: lastStep.y });
            const label = this.selectedRoom?.name || "Manzil";
            this.drawEndMarker(ctx, pos, time, label);
        }
    }

    /**
     * Show a toast notification instead of native alert().
     * Auto-dismisses after 3 seconds.
     */
    showToast(message: string, type: 'error' | 'success' | 'info' = 'info') {
        // Remove existing toast if any
        const existing = document.getElementById('kiosk-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'kiosk-toast';
        toast.className = `kiosk-toast kiosk-toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto-dismiss after 3s
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

}

// Virtual Keyboard Class
class VirtualKeyboard {
    private container: HTMLElement;
    private input: HTMLInputElement;
    private isVisible: boolean = false;

    private layout = [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫', '⏎'],
        ['SPACE']
    ];

    constructor(inputId: string, containerId: string) {
        this.input = document.getElementById(inputId) as HTMLInputElement;
        this.container = document.getElementById(containerId)!;
        this.init();
    }

    private init() {
        this.render();
        this.setupEvents();
    }

    private render() {
        this.container.innerHTML = '';

        this.layout.forEach(row => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'keyboard-row';

            row.forEach(key => {
                const btn = document.createElement('button');
                btn.className = 'key';
                btn.textContent = key;
                btn.dataset.key = key;

                if (key === 'SPACE') {
                    btn.classList.add('space');
                    btn.innerHTML = '&nbsp;'; // Non-breaking space for height
                } else if (key === '⌫' || key === '⏎') {
                    btn.classList.add('special');
                }

                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation(); // Prevent search field blur
                    this.handleKeyPress(key);
                });

                rowDiv.appendChild(btn);
            });

            this.container.appendChild(rowDiv);
        });
    }

    private setupEvents() {
        // Show keyboard on input focus
        this.input.addEventListener('focus', () => {
            this.show();
        });

        // Hide when clicking outside (except keyboard or input)
        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (!this.container.contains(target) && target !== this.input) {
                // Determine if we should hide logic here if needed
                // For kiosk, keeping it open slightly aggressively is usually better
            }
        });

        // Prevent default touch actions to stop zooming etc
        this.container.addEventListener('touchstart', (e) => {
            // e.preventDefault(); // Warning: this might block click
        }, { passive: true });
    }

    private handleKeyPress(key: string) {
        let currentVal = this.input.value;
        const cursorPos = this.input.selectionStart || currentVal.length;

        if (key === '⌫') {
            if (cursorPos > 0) {
                const newVal = currentVal.slice(0, cursorPos - 1) + currentVal.slice(cursorPos);
                this.input.value = newVal;
                this.setCursor(cursorPos - 1);
            }
        } else if (key === 'SPACE') {
            const newVal = currentVal.slice(0, cursorPos) + ' ' + currentVal.slice(cursorPos);
            this.input.value = newVal;
            this.setCursor(cursorPos + 1);
        } else if (key === '⏎') {
            // "Enter" triggers room selection / navigation
            this.input.dispatchEvent(new CustomEvent('virtual-enter', { bubbles: true }));
            return;
        } else {
            const char = key.toLowerCase(); // Type in lowercase usually but search handles case
            const newVal = currentVal.slice(0, cursorPos) + char + currentVal.slice(cursorPos);
            this.input.value = newVal;
            this.setCursor(cursorPos + 1);
        }

        // Trigger input event for search
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
        this.input.focus();
    }

    private setCursor(pos: number) {
        this.input.setSelectionRange(pos, pos);
    }

    public show() {
        this.isVisible = true;
        this.container.classList.remove('hidden');
    }

    public hide() {
        this.isVisible = false;
        this.container.classList.add('hidden');
    }
}

// Initialize App
const app = new KioskApp();
const keyboard = new VirtualKeyboard('search-input', 'virtual-keyboard');
