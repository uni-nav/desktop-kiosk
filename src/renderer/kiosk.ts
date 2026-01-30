// src/renderer/kiosk.ts - Complete Kiosk Implementation
/// <reference path="./types.d.ts" />

interface Floor {
    id: number;
    name: string;
    floor_number: number;
    image_url: string | null;
    image_width: number | null;
    image_height: number | null;
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
const ANIMATION_SPEED = 70; // px per second
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ANIMATION_LOOPS = 3;

class KioskApp {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private container: HTMLElement;
    private kioskId: number;
    private kioskWaypointId: string | null = null;
    private kioskFloorId: number | null = null;

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

    constructor() {
        this.canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;
        this.container = this.canvas.parentElement!;

        // Parse kiosk_id from URL
        const params = new URLSearchParams(window.location.search);
        this.kioskId = parseInt(params.get('kiosk_id') || '0');

        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.resizeCanvas();
        this.resetIdleTimer();

        // Get API URL
        this.apiBaseUrl = await kioskAPI.getApiUrl();

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



        // Back button
        document.getElementById('back-btn')!.addEventListener('click', () => {
            kioskAPI.backToLauncher();
        });

        // Sync button
        document.getElementById('sync-btn')!.addEventListener('click', () => {
            this.syncData();
        });

        // Search
        const searchInput = document.getElementById('search-input') as HTMLInputElement;
        searchInput.addEventListener('input', (e) => {
            this.handleSearch((e.target as HTMLInputElement).value);
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
        }, IDLE_TIMEOUT_MS);
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
            const indicator = document.getElementById('status-indicator')!;
            indicator.className = `status-indicator ${online ? 'online' : 'offline'}`;
        } catch {
            document.getElementById('status-indicator')!.className = 'status-indicator offline';
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
        this.currentFloor = floor;
        this.renderFloorTabs();

        // Show loading
        document.getElementById('map-loading')!.classList.remove('hidden');

        // Load floor data
        this.waypoints = await kioskAPI.getWaypoints(floor.id);
        this.waypointsByFloor.set(floor.id, this.waypoints);

        // Load floor image
        await this.loadFloorImage(floor);

        // Hide loading
        document.getElementById('map-loading')!.classList.add('hidden');

        // Start animation loop
        this.startAnimationLoop();
    }

    async loadFloorImage(floor: Floor): Promise<void> {
        if (!floor.image_url) {
            return;
        }

        // Check cache
        if (this.floorImages.has(floor.id)) {
            return;
        }

        const imageUrl = floor.image_url.startsWith('http')
            ? floor.image_url
            : `${this.apiBaseUrl}${floor.image_url}`;

        return new Promise<void>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                this.floorImages.set(floor.id, img);
                resolve();
            };
            img.onerror = () => {
                resolve();
            };
            img.src = imageUrl;
        });
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
                alert(result.error || "Yo'l topilmadi");
            }
        } catch (error) {
            console.error('Path finding error:', error);
            alert("Yo'l topishda xatolik yuz berdi");
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
        pathInfoEl.classList.remove('hidden');

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
        const syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;
        syncBtn.disabled = true;

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
            syncBtn.disabled = false;
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

    render(time: number) {
        // ... (existing render code, kept same just abbreviated here to start append)
        const ctx = this.ctx;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        // Clear canvas
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);

        const floorImage = this.currentFloor ? this.floorImages.get(this.currentFloor.id) : null;

        if (!floorImage || !this.currentFloor) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Rasm yuklanmagan', width / 2, height / 2);
            return;
        }

        // Calculate scale and offset to fit image
        const imgWidth = this.currentFloor.image_width || floorImage.width;
        const imgHeight = this.currentFloor.image_height || floorImage.height;
        const scale = Math.min(width / imgWidth, height / imgHeight) * 0.92;
        const imageWidth = imgWidth * scale;
        const imageHeight = imgHeight * scale;
        const offsetX = (width - imageWidth) / 2;
        const offsetY = (height - imageHeight) / 2;

        // Draw floor image
        ctx.drawImage(floorImage, offsetX, offsetY, imageWidth, imageHeight);

        // Coordinate converter
        const toCanvas = (point: { x: number; y: number }) => ({
            x: offsetX + point.x * scale,
            y: offsetY + point.y * scale,
        });

        // Get path for current floor
        const currentFloorPath = this.navigationPath?.filter(
            step => step.floor_id === this.currentFloor?.id
        ) || [];

        const points = currentFloorPath.map(step => toCanvas({ x: step.x, y: step.y }));
        const pulse = (Math.sin(time / 320) + 1) / 2;

        // Draw dotted path
        if (points.length >= 2) {
            const totalLength = this.computePathLength(points);

            // Handle animation and floor transitions
            if (this.isAnimating) {
                const elapsed = (time - this.animationStartTime) / 1000;
                this.animationProgress = elapsed * ANIMATION_SPEED;
                this.dashOffset -= 0.5;

                // Check if this floor's animation is complete
                if (this.animationProgress >= totalLength) {
                    // Check if there are more floors
                    if (this.activeRunIndex < this.floorRuns.length - 1) {
                        // Move to next floor
                        this.activeRunIndex++;
                        const nextRun = this.floorRuns[this.activeRunIndex];
                        const nextFloor = this.floors.find(f => f.id === nextRun.floorId);

                        if (nextFloor && nextFloor !== this.currentFloor) {
                            this.selectFloor(nextFloor);
                            this.animationProgress = 0;
                            this.animationStartTime = time;
                        }
                    } else {
                        // All floors done, increment loop count
                        this.animationLoopCount++;

                        if (this.animationLoopCount < MAX_ANIMATION_LOOPS) {
                            // Restart animation from beginning
                            this.activeRunIndex = 0;
                            this.animationProgress = 0;
                            this.animationStartTime = time;

                            // Go back to first floor
                            if (this.floorRuns.length > 0) {
                                const firstRun = this.floorRuns[0];
                                const firstFloor = this.floors.find(f => f.id === firstRun.floorId);
                                if (firstFloor && firstFloor !== this.currentFloor) {
                                    this.selectFloor(firstFloor);
                                }
                            }
                        } else {
                            // Animation completed, stop at kiosk floor
                            this.isAnimating = false;
                            this.animationProgress = totalLength;

                            // Go to kiosk floor
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

            // Path with dotted effect
            ctx.save();
            ctx.strokeStyle = '#22C55E';
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([2, 10]);
            ctx.lineDashOffset = this.dashOffset;
            ctx.beginPath();
            points.forEach((p, idx) => {
                if (idx === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
            ctx.restore();

            // Path dots
            const maxDots = 60;
            const step = Math.max(1, Math.ceil(points.length / maxDots));
            points.forEach((p, idx) => {
                if (idx === 0 || idx === points.length - 1) return;
                if (idx % step !== 0) return;
                ctx.beginPath();
                ctx.fillStyle = '#a7f3d0';
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fill();
            });

            // Draw mover (walking person)
            if (this.isAnimating && drawProgress < totalLength) {
                const mover = this.getPointAtLength(points, drawProgress);

                ctx.save();
                ctx.shadowColor = 'rgba(56,189,248,0.6)';
                ctx.shadowBlur = 12;

                // Body
                ctx.fillStyle = '#38bdf8';
                ctx.strokeStyle = '#f8fafc';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.roundRect(mover.x - 4.5, mover.y - 2, 9, 12, 4);
                ctx.fill();
                ctx.stroke();

                // Head
                ctx.beginPath();
                ctx.fillStyle = '#f8fafc';
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 1.5;
                ctx.arc(mover.x, mover.y - 6, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }

        if (this.kioskWaypointId && this.currentFloor?.id === this.kioskFloorId) {
            const kioskWp = this.waypoints.find(w => w.id === this.kioskWaypointId);
            if (kioskWp) {
                const pos = toCanvas({ x: kioskWp.x, y: kioskWp.y });

                // Pulse ring
                const ringRadius = 10 + pulse * 6;
                const ringOpacity = 0.35 + pulse * 0.35;

                ctx.save();
                ctx.beginPath();
                ctx.fillStyle = `rgba(14,165,233,${0.15 * ringOpacity})`;
                ctx.strokeStyle = `rgba(14,165,233,${0.8 * ringOpacity})`;
                ctx.lineWidth = 2;
                ctx.arc(pos.x, pos.y, ringRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Center dot
                ctx.beginPath();
                ctx.fillStyle = '#0ea5e9'; // Blue-500
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Label
                ctx.fillStyle = '#f8fafc';
                ctx.font = 'bold 14px system-ui';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.shadowColor = 'rgba(0,0,0,0.8)';
                ctx.shadowBlur = 4;
                ctx.fillText("Siz shu yerdasiz", pos.x, pos.y - 18);
                ctx.restore();
            }
        }

        // Draw destination marker
        const lastStep = this.navigationPath?.[this.navigationPath.length - 1];
        if (lastStep && lastStep.floor_id === this.currentFloor?.id) {
            const pos = toCanvas({ x: lastStep.x, y: lastStep.y });

            // Bounce effect
            const bounce = Math.abs(Math.sin(time / 200)) * 8;

            ctx.save();
            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath();
            ctx.ellipse(pos.x, pos.y, 8 - bounce / 3, 4 - bounce / 5, 0, 0, Math.PI * 2);
            ctx.fill();

            // Pin
            ctx.translate(pos.x, pos.y - bounce);
            ctx.beginPath();
            ctx.fillStyle = '#ef4444'; // Red-500
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            // Draw pin shape
            ctx.moveTo(0, 0);
            ctx.arc(0, -28, 14, Math.PI / 2, Math.PI * 2.5); // Circle part
            ctx.lineTo(0, 0); // Point
            ctx.fill();
            ctx.stroke();

            // Icon inside pin
            ctx.fillStyle = '#fff';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('★', 0, -28);
            ctx.restore();
        }
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
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫'],
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
                } else if (key === '⌫') {
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
