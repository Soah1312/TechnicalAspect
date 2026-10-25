import Phaser from 'phaser';
import { Track, WORLD_WIDTH, WORLD_HEIGHT } from '../track';
import { generateTrack } from '../tracks/generator';
import { Car } from '../car';
import { FuelSystem } from '../fuel';
import { LapManager, type LapCompleteEvent } from '../laps';
import { InputManager } from '../input';
import { sounds } from '../../audio/soundManager';
import { Vibration } from '../../util/vibration';
import { stateMachine, type GameState } from '../stateMachine';
import { Storage } from '../../util/storage';
import { PALETTE, DEFAULT_CONFIG } from '../../config/constants';
import { activeApi } from '../../api';
import { speedMult, stageFor, DEFAULT_TRACK_STAGES } from '../../shared/difficulty';

export class RaceScene extends Phaser.Scene {
  public track!: Track;
  public car!: Car;
  public fuelSystem!: FuelSystem;
  public lapManager!: LapManager;
  public inputManager!: InputManager;
  public currentStage = 1;
  public currentLap = 1;
  public useLapTracks = true;

  private preloadedTrack: { lap: number; track: Track; textureKey: string } | null = null;
  private isPreloadingNextTrack = false;

  private carSprite: Phaser.GameObjects.Sprite | null = null;
  private trackImage: Phaser.GameObjects.Image | null = null;
  public isRaceActive = false;

  // Reusable vectors to eliminate GC pressure in RAF loop
  private readonly _carPos = { x: 0, y: 0 };
  private readonly _carVel = { x: 0, y: 0 };

  // Performance telemetry (target: 60 FPS, min: 30 FPS)
  private fpsHistory: number[] = [];
  private minRecordedFps = 60;
  private droppedFrameCount = 0;
  private lastPerfReportTime = 0;

  private isDebugLayout = false;
  private debugGraphics: Phaser.GameObjects.Graphics | null = null;
  private debugText: Phaser.GameObjects.Text | null = null;
  private maxDeviationOverLap = 0;

  constructor() {
    super('RaceScene');
  }

  public create(): void {
    this.isDebugLayout = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debugLayout') === '1';
    if (this.isDebugLayout) {
      this.debugGraphics = this.add.graphics().setDepth(9999).setScrollFactor(0);
    }

    // Config gate: feature_lap_tracks (default true)
    this.useLapTracks = (DEFAULT_CONFIG.featureFlags?.feature_lap_tracks as boolean) !== false;
    activeApi.getConfig().then(cfg => {
      if (cfg?.featureFlags && typeof cfg.featureFlags.feature_lap_tracks === 'boolean') {
        this.useLapTracks = cfg.featureFlags.feature_lap_tracks;
      }
    }).catch(() => {});

    // Resume lap progression from stored count on page refresh (Edge case: refresh on lap 7)
    const storedLaps = Storage.getLapCount();
    this.currentLap = storedLaps + 1;

    // 1. Initialize Racetrack
    if (this.useLapTracks) {
      console.log(`[Track] Initializing Part 4 procedural track for Lap ${this.currentLap}`);
      const genTrack = generateTrack(this.currentLap);
      this.track = new Track(genTrack.meta.level, genTrack.points, this.currentLap);
      const textureKey = `racetrack_lap_${this.currentLap}`;
      if (!this.textures.exists(textureKey)) {
        const trackCanvas = this.track.renderToCanvas();
        this.textures.addCanvas(textureKey, trackCanvas);
      }
      this.trackImage = this.add.image(0, 0, textureKey).setOrigin(0, 0);

      // Start background pre-generation of Lap N+1 after initial stable frames
      this.time.delayedCall(500, () => {
        this.schedulePreloadNextTrack(this.currentLap + 1);
      });
    } else {
      this.currentStage = stageFor(this.currentLap, DEFAULT_TRACK_STAGES, true);
      this.track = new Track(this.currentStage);
      const textureKey = `racetrack_surface_${this.currentStage}`;
      if (!this.textures.exists(textureKey)) {
        const trackCanvas = this.track.renderToCanvas();
        this.textures.addCanvas(textureKey, trackCanvas);
      }
      this.trackImage = this.add.image(0, 0, textureKey).setOrigin(0, 0);
    }

    // 3. Initialize Car at Start / Finish Line
    this.car = new Car(
      this.track.startPosition.x,
      this.track.startPosition.y,
      this.track.startAngle
    );

    // 4. Initialize Fuel & Lap Systems
    this.fuelSystem = new FuelSystem(
      DEFAULT_CONFIG.initialFuelMs,
      DEFAULT_CONFIG.tankMaxMs
    );
    this.lapManager = new LapManager(this.track.gates);
    this.lapManager.syncLapCount(storedLaps);
    this.inputManager = new InputManager();

    // 5. Setup Lap Events
    this.lapManager.setListeners({
      onLapComplete: async (ev: LapCompleteEvent) => {
        sounds.playLap();
        Vibration.lap();
        console.log(
          `[Lap] Lap ${ev.lapNumber} complete! Driving time: ${(ev.drivingTimeMs / 1000).toFixed(2)}s, Total time: ${(ev.totalTimeMs / 1000).toFixed(2)}s | Max center deviation: ${this.maxDeviationOverLap.toFixed(2)}px`
        );
        this.maxDeviationOverLap = 0;
        Storage.setLapCount(ev.lapNumber);

        const nextLap = ev.lapNumber + 1;

        if (this.useLapTracks) {
          // Part 4: Per-lap procedural track swap
          this.swapToNextLapTrack(nextLap);
        } else {
          // Fallback track stage behavior
          const targetStage = stageFor(nextLap, DEFAULT_TRACK_STAGES, true);
          if (targetStage !== this.currentStage) {
            this.swapTrackStage(targetStage);
          }
        }

        try {
          const res = await activeApi.submitLap(ev.lapNumber, ev.drivingTimeMs);
          if (res.accepted) {
            console.log(`[Lap Server] Lap ${res.laps} verified by server!`);
            this.lapManager.syncLapCount(res.laps);
            Storage.setLapCount(res.laps);
          } else {
            console.warn(`[Lap Server] Lap rejected by server: ${res.reason}`);
            this.lapManager.syncLapCount(res.laps);
          }
        } catch (err) {
          console.error('[Lap Server] submitLap error:', err);
        }
      },
    });

    // 6. Setup Fuel Events
    this.fuelSystem.setListeners({
      onLowFuel: () => {
        sounds.playLowFuelBeep();
      },
      onEmpty: () => {
        console.log('[Fuel] Fuel tank empty - car stopped');
      },
    });

    // 7. Setup Car Sprite
    const stored = Storage.getPlayer();
    const colorIndex = this.getCarColorIndex(stored?.playerId || 'player');
    this.carSprite = this.add.sprite(this.car.x, this.car.y, `car_${colorIndex}`);
    this.carSprite.setOrigin(0.5, 0.5);
    this.carSprite.setDepth(10);

    // 8. Setup Camera: exact center follow with roundPixels, 360 px width visible (Part 3)
    this.cameras.main.setZoom(1.0);
    this.cameras.main.roundPixels = true;
    this.cameras.main.scrollX = Math.round(this.car.x - this.cameras.main.width / 2);
    this.cameras.main.scrollY = Math.round(this.car.y - this.cameras.main.height / 2);

    // Listen to state changes to enable/disable active race driving
    stateMachine.subscribe((newState: GameState) => {
      this.isRaceActive = newState === 'RACING';
      if (this.isRaceActive) {
        sounds.startEngine();
      } else {
        sounds.stopEngine();
      }
    });

    this.isRaceActive = stateMachine.getState() === 'RACING';
  }

  public async swapToNextLapTrack(nextLap: number): Promise<void> {
    const showToast = (window as any).__showHudToast;

    // If next track is not ready yet, wait up to 500ms with LOADING TRACK...
    if (!this.preloadedTrack || this.preloadedTrack.lap !== nextLap) {
      console.warn(`[Track] Preloaded track for Lap ${nextLap} not ready yet, waiting...`);
      if (showToast) showToast('⏳ LOADING TRACK...');

      const startWait = Date.now();
      while ((!this.preloadedTrack || this.preloadedTrack.lap !== nextLap) && Date.now() - startWait < 500) {
        await new Promise(r => setTimeout(r, 20));
      }

      if (!this.preloadedTrack || this.preloadedTrack.lap !== nextLap) {
        console.warn(`[Track] Preload timeout for Lap ${nextLap}, generating synchronously`);
        const gen = generateTrack(nextLap);
        const nextTrack = new Track(gen.meta.level, gen.points, nextLap);
        const textureKey = `racetrack_lap_${nextLap}`;
        if (this.textures.exists(textureKey)) {
          this.textures.remove(textureKey);
        }
        const canvas = nextTrack.renderToCanvas();
        this.textures.addCanvas(textureKey, canvas);
        this.preloadedTrack = { lap: nextLap, track: nextTrack, textureKey };
      }
    }

    const { track: nextTrack, textureKey: nextTextureKey } = this.preloadedTrack!;
    const oldKey = this.trackImage?.texture.key;

    // 150ms camera flash effect
    this.cameras.main.flash(150, 255, 255, 255);

    // Toast in Part 2 toast slot
    if (showToast) {
      showToast(`🏁 LAP ${nextLap} · NEW TRACK!`);
    }

    // Seamless swap: keep car position, heading, speed, fuel
    this.currentLap = nextLap;
    this.track = nextTrack;
    if (this.trackImage) {
      this.trackImage.setTexture(nextTextureKey);
    }
    this.lapManager.updateGates(this.track.gates);
    this.car.nearestTrackIndex = 0;

    const updateMinimap = (window as any).__updateHudMinimap;
    if (updateMinimap) {
      updateMinimap(this.track);
    }

    // Destroy old texture to strictly maintain at most 2 textures in memory (current + next)
    if (oldKey && oldKey !== nextTextureKey && this.textures.exists(oldKey)) {
      this.textures.remove(oldKey);
      console.log(`[Track] Swapped to Lap ${nextLap}, destroyed texture ${oldKey} (at most 2 textures in memory)`);
    }

    this.preloadedTrack = null;

    // Schedule background pre-generation of lap N+1
    this.schedulePreloadNextTrack(nextLap + 1);
  }

  public schedulePreloadNextTrack(nextLap: number): void {
    if (this.isPreloadingNextTrack || (this.preloadedTrack && this.preloadedTrack.lap === nextLap)) {
      return;
    }
    this.isPreloadingNextTrack = true;

    // Time-sliced background generation via requestIdleCallback or setTimeout
    const runner = typeof window !== 'undefined' && (window as any).requestIdleCallback
      ? (window as any).requestIdleCallback
      : (fn: Function) => setTimeout(fn, 20);

    runner(() => {
      try {
        console.log(`[Track] Background pre-generating Lap ${nextLap} track...`);
        const gen = generateTrack(nextLap);
        const nextTrack = new Track(gen.meta.level, gen.points, nextLap);
        const textureKey = `racetrack_lap_${nextLap}`;

        if (this.textures.exists(textureKey)) {
          this.textures.remove(textureKey);
        }

        const nextCanvas = nextTrack.renderToCanvas();
        this.textures.addCanvas(textureKey, nextCanvas);

        const memMb = ((WORLD_WIDTH * WORLD_HEIGHT * 4) / (1024 * 1024)).toFixed(1);
        console.log(`[Track] Lap ${nextLap} track ready in background (${memMb} MB texture memory)`);

        this.preloadedTrack = {
          lap: nextLap,
          track: nextTrack,
          textureKey,
        };
      } catch (err) {
        console.error(`[Track] Error preloading Lap ${nextLap}:`, err);
      } finally {
        this.isPreloadingNextTrack = false;
      }
    });
  }

  public swapTrackStage(nextStage: number): void {
    if (nextStage === this.currentStage) return;
    console.log(`[Track] Swapping track from Stage ${this.currentStage} to Stage ${nextStage}`);

    const textureKey = `racetrack_surface_${nextStage}`;
    if (!this.textures.exists(textureKey)) {
      const nextTrack = new Track(nextStage);
      const trackCanvas = nextTrack.renderToCanvas();
      this.textures.addCanvas(textureKey, trackCanvas);
    }

    this.currentStage = nextStage;
    this.track = new Track(nextStage);
    if (this.trackImage) {
      this.trackImage.setTexture(textureKey);
    }

    // 150ms camera flash effect
    this.cameras.main.flash(150, 255, 255, 255);

    // Toast banner
    const showToast = (window as any).__showHudToast;
    if (showToast) {
      showToast(`🏁 STAGE ${nextStage} · NEW TRACK!`);
    }
  }


  public updateCarTexture(playerId: string): void {
    const idx = this.getCarColorIndex(playerId);
    if (this.carSprite && this.textures.exists(`car_${idx}`)) {
      this.carSprite.setTexture(`car_${idx}`);
    }
  }

  private getCarColorIndex(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % PALETTE.carColors.length;
  }

  public override update(time: number, delta: number): void {
    // Hard clamp delta to 50ms (20fps equivalent) to prevent tunnelling and extreme jumps in low-power mode
    const dt = Math.min(0.05, delta / 1000);
    const deltaMs = Math.min(50, delta);

    // Frame rate telemetry
    const currentFps = delta > 0 ? 1000 / delta : 60;
    this.fpsHistory.push(currentFps);
    if (this.fpsHistory.length > 120) this.fpsHistory.shift();
    if (currentFps < this.minRecordedFps && currentFps > 0) {
      this.minRecordedFps = Math.round(currentFps);
    }
    if (currentFps < 30) {
      this.droppedFrameCount++;
    }

    if (time - this.lastPerfReportTime > 10000) {
      this.lastPerfReportTime = time;
      const avg = Math.round(this.fpsHistory.reduce((a, b) => a + b, 0) / (this.fpsHistory.length || 1));
      console.log(`[Perf] FPS: ${Math.round(currentFps)} | Avg: ${avg} | Min: ${this.minRecordedFps} | Drops (<30): ${this.droppedFrameCount}`);
    }

    const steerInput = this.inputManager.getSteerInput();
    const hasFuel = !this.fuelSystem.isEmpty();

    // In RACING state: update car arcade physics with speed ramp and fuel drain
    if (this.isRaceActive) {
      const curLap = this.lapManager.getLapCount();
      const speedMultiplier = speedMult(curLap + 1, 0.04, 1.5, true);
      this.car.update(dt, steerInput, hasFuel, this.track, speedMultiplier);
      this.fuelSystem.update(deltaMs, this.car.speed);

      // Reused coordinate vectors (0 heap allocations)
      this._carPos.x = this.car.x;
      this._carPos.y = this.car.y;
      this._carVel.x = this.car.vx;
      this._carVel.y = this.car.vy;
      this.lapManager.update(this._carPos, this._carVel, deltaMs, true);

      // Sound modulation
      const speedRatio = this.car.forwardSpeed / Car.MAX_SPEED;
      sounds.updateEnginePitch(speedRatio);
      sounds.updateGrassRumble(!this.car.onRoad && this.car.speed > 8);

      if (this.fuelSystem.isLowFuel()) {
        sounds.playLowFuelBeep();
      }
    } else {
      sounds.stopGrassRumble();
    }

    // Update Car Sprite Transform
    if (this.carSprite) {
      this.carSprite.setPosition(this.car.x, this.car.y);
      // Sprite points North; heading 0 is East -> offset by +90 deg
      this.carSprite.setRotation(this.car.heading + Math.PI / 2);
    }

    // Exact Zero-Lag Center Camera Follow (Part 3)
    // The car is always at the exact center of the visible screen (50% horizontal and vertical).
    // Updated in the same frame, immediately after the car physics update, with 0 lag, 0 deadzone, 0 lookahead.
    this.cameras.main.scrollX = Math.round(this.car.x - this.cameras.main.width / 2);
    this.cameras.main.scrollY = Math.round(this.car.y - this.cameras.main.height / 2);

    // Deviation tracking for Part 3 debug and validation
    const carScreenX = this.car.x - this.cameras.main.scrollX;
    const carScreenY = this.car.y - this.cameras.main.scrollY;
    const screenCenterX = this.cameras.main.width / 2;
    const screenCenterY = this.cameras.main.height / 2;
    const curDev = Math.hypot(carScreenX - screenCenterX, carScreenY - screenCenterY);
    if (curDev > this.maxDeviationOverLap) {
      this.maxDeviationOverLap = curDev;
    }

    if (this.isDebugLayout) {
      this.renderDebugLayout(curDev);
    }
  }

  public onLogicalResize(width: number, height: number): void {
    if (this.cameras && this.cameras.main) {
      this.cameras.main.setSize(width, height);
      this.cameras.main.setZoom(1.0);
      if (this.car) {
        this.cameras.main.scrollX = Math.round(this.car.x - width / 2);
        this.cameras.main.scrollY = Math.round(this.car.y - height / 2);
      }
    }
  }

  private renderDebugLayout(curDev = 0): void {
    if (!this.debugGraphics) return;
    this.debugGraphics.clear();

    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    // 1. Center Crosshairs (Cyan)
    this.debugGraphics.lineStyle(1, 0x00e5ff, 0.7);
    this.debugGraphics.beginPath();
    this.debugGraphics.moveTo(0, h / 2);
    this.debugGraphics.lineTo(w, h / 2);
    this.debugGraphics.moveTo(w / 2, 0);
    this.debugGraphics.lineTo(w / 2, h);
    this.debugGraphics.strokePath();

    // 2. Center dot (Red marker at exact center)
    this.debugGraphics.fillStyle(0xff2e4d, 0.9);
    this.debugGraphics.fillCircle(w / 2, h / 2, 2);

    // 3. Top Strip bounds and screen height percentage (Part 2)
    const topStripEl = document.querySelector('.hud-topbar');
    const stripRect = topStripEl?.getBoundingClientRect();
    const stripHeightPx = stripRect ? Math.round(stripRect.height) : 40;
    const stripPct = ((stripHeightPx / (window.innerHeight || h)) * 100).toFixed(1);

    this.debugGraphics.lineStyle(2, 0xff00ff, 0.8);
    this.debugGraphics.strokeRect(0, 0, w, stripHeightPx);

    if (!this.debugText) {
      this.debugText = this.add.text(8, stripHeightPx + 6, '', {
        fontSize: '8px',
        fontFamily: 'monospace',
        backgroundColor: '#000000ee',
        padding: { x: 4, y: 3 },
      }).setScrollFactor(0).setDepth(10000);
    }

    this.debugText.setText(
      `VIEWPORT: ${window.innerWidth}x${window.innerHeight} | CANVAS: ${w}x${h}\n` +
      `TOP STRIP: ${stripHeightPx}px (${stripPct}% of screen, <= 8%)\n` +
      `CAR DEV: ${curDev.toFixed(2)}px | MAX LAP DEV: ${this.maxDeviationOverLap.toFixed(2)}px [<= 2px]`
    );
    this.debugText.setColor(curDev <= 2.0 ? '#39ff14' : '#ff2e4d');
  }

  public getPerformanceStats(): {
    currentFps: number;
    avgFps: number;
    minFps: number;
    droppedFrames: number;
  } {
    const avg = this.fpsHistory.length
      ? Math.round(this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length)
      : 60;
    return {
      currentFps: Math.round(this.fpsHistory[this.fpsHistory.length - 1] || 60),
      avgFps: avg,
      minFps: this.minRecordedFps,
      droppedFrames: this.droppedFrameCount,
    };
  }

  public destroy(): void {
    this.inputManager?.destroy();
    sounds.stopEngine();
    if (this.trackImage) {
      this.trackImage.destroy();
    }
  }
}
