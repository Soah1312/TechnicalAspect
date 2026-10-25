import Phaser from 'phaser';
import { Track, WORLD_WIDTH, WORLD_HEIGHT } from '../track';
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

  constructor() {
    super('RaceScene');
  }

  public create(): void {
    this.isDebugLayout = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debugLayout') === '1';
    if (this.isDebugLayout) {
      this.debugGraphics = this.add.graphics().setDepth(9999).setScrollFactor(0);
    }

    // 1. Initialize Racetrack (Stage 1 Rookie)
    this.currentStage = 1;
    this.track = new Track(1);

    // 2. Render Track to Texture once for maximum 60FPS performance
    if (!this.textures.exists('racetrack_surface_1')) {
      const trackCanvas = this.track.renderToCanvas();
      this.textures.addCanvas('racetrack_surface_1', trackCanvas);
    }
    this.trackImage = this.add.image(0, 0, 'racetrack_surface_1').setOrigin(0, 0);

    // 3. Initialize Car at Start / Finish Line
    this.car = new Car(
      this.track.startPosition.x,
      this.track.startPosition.y,
      this.track.startAngle
    );

    // 4. Initialize Fuel & Lap Systems
    this.fuelSystem = new FuelSystem(
      DEFAULT_CONFIG.initialFuelMs,
      DEFAULT_CONFIG.tankMaxMs,
      DEFAULT_CONFIG.pitBelowFraction
    );
    this.lapManager = new LapManager(this.track.gates);
    this.inputManager = new InputManager();

    // 5. Setup Lap Events
    this.lapManager.setListeners({
      onLapComplete: async (ev: LapCompleteEvent) => {
        sounds.playLap();
        Vibration.lap();
        console.log(
          `[Lap] Lap ${ev.lapNumber} complete! Driving time: ${(ev.drivingTimeMs / 1000).toFixed(2)}s, Total time: ${(ev.totalTimeMs / 1000).toFixed(2)}s`
        );

        // Check if next lap enters a new track stage
        const nextLap = ev.lapNumber + 1;
        const targetStage = stageFor(nextLap, DEFAULT_TRACK_STAGES, true);
        if (targetStage !== this.currentStage) {
          this.swapTrackStage(targetStage);
        }

        try {
          const res = await activeApi.submitLap(ev.lapNumber, ev.drivingTimeMs);
          if (res.accepted) {
            console.log(`[Lap Server] Lap ${res.laps} verified by server!`);
            this.lapManager.syncLapCount(res.laps);
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

    // 8. Setup Camera: smooth follow with lookahead, 360 px width visible
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setZoom(1.0); // 360 world px wide visible
    this.cameras.main.roundPixels = true;
    this.cameras.main.scrollX = this.car.x - this.cameras.main.width / 2;
    this.cameras.main.scrollY = this.car.y - this.cameras.main.height / 2;

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

    // Camera follow with direction-aligned lookahead capped to ~5% height
    const lookAheadDist = Math.min(28, this.cameras.main.height * 0.05);
    const targetX = this.car.x + Math.cos(this.car.heading) * lookAheadDist;
    const targetY = this.car.y + Math.sin(this.car.heading) * lookAheadDist;

    const destScrollX = targetX - this.cameras.main.width / 2;
    const destScrollY = targetY - this.cameras.main.height / 2;

    this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, destScrollX, 0.1);
    this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, destScrollY, 0.1);

    if (this.isDebugLayout) {
      this.renderDebugLayout();
    }
  }

  public onLogicalResize(width: number, height: number): void {
    if (this.cameras && this.cameras.main) {
      this.cameras.main.setSize(width, height);
      this.cameras.main.setZoom(1.0);
    }
  }

  private renderDebugLayout(): void {
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

    // 2. 45% - 55% Safe Zone (Green)
    this.debugGraphics.lineStyle(1, 0x39ff14, 0.6);
    this.debugGraphics.strokeRect(0, h * 0.45, w, h * 0.10);
    this.debugGraphics.fillStyle(0x39ff14, 0.08);
    this.debugGraphics.fillRect(0, h * 0.45, w, h * 0.10);

    // 3. HUD top area & control bottom area (Yellow outlines)
    this.debugGraphics.lineStyle(1, 0xffd400, 0.5);
    this.debugGraphics.strokeRect(2, 2, w - 4, 60);
    this.debugGraphics.strokeRect(2, h - 100, w - 4, 98);

    // 4. Car screen position fraction
    const carScreenY = this.car.y - this.cameras.main.scrollY;
    const carFrac = (carScreenY / h) * 100;
    const inSafe = carFrac >= 45 && carFrac <= 55;

    if (!this.debugText) {
      this.debugText = this.add.text(8, 70, '', {
        fontSize: '8px',
        fontFamily: 'monospace',
        backgroundColor: '#000000dd',
        padding: { x: 4, y: 3 },
      }).setScrollFactor(0).setDepth(10000);
    }

    this.debugText.setText(
      `VIEWPORT: ${window.innerWidth}x${window.innerHeight}\n` +
      `DPR: ${(window.devicePixelRatio || 1).toFixed(1)} | CANVAS: ${w}x${h}\n` +
      `CAR Y: ${carFrac.toFixed(1)}% [${inSafe ? 'CENTERED 45-55%' : 'OFFSET'}]`
    );
    this.debugText.setColor(inSafe ? '#39ff14' : '#ff2e4d');
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
