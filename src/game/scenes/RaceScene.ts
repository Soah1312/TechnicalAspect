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

export class RaceScene extends Phaser.Scene {
  public track!: Track;
  public car!: Car;
  public fuelSystem!: FuelSystem;
  public lapManager!: LapManager;
  public inputManager!: InputManager;

  private carSprite: Phaser.GameObjects.Sprite | null = null;
  private trackImage: Phaser.GameObjects.Image | null = null;
  public isRaceActive = false;

  constructor() {
    super('RaceScene');
  }

  public create(): void {
    // 1. Initialize Racetrack
    this.track = new Track();

    // 2. Render Track to Texture once for maximum 60FPS performance
    if (!this.textures.exists('racetrack_surface')) {
      const trackCanvas = this.track.renderToCanvas();
      this.textures.addCanvas('racetrack_surface', trackCanvas);
    }
    this.trackImage = this.add.image(0, 0, 'racetrack_surface').setOrigin(0, 0);

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

  public override update(_time: number, delta: number): void {
    const dt = Math.min(0.1, delta / 1000); // delta in seconds
    const deltaMs = delta;

    const steerInput = this.inputManager.getSteerInput();
    const hasFuel = !this.fuelSystem.isEmpty();

    // In RACING state: update car arcade physics and fuel drain
    if (this.isRaceActive) {
      this.car.update(dt, steerInput, hasFuel, this.track);
      this.fuelSystem.update(deltaMs, this.car.speed);
      this.lapManager.update(
        { x: this.car.x, y: this.car.y },
        this.car.getTelemetry().velocity,
        deltaMs,
        true
      );

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

    // Camera follow with lookahead
    const lookAheadDist = 55;
    const targetX = this.car.x + Math.cos(this.car.heading) * lookAheadDist;
    const targetY = this.car.y + Math.sin(this.car.heading) * lookAheadDist;

    const destScrollX = targetX - this.cameras.main.width / 2;
    const destScrollY = targetY - this.cameras.main.height / 2;

    this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, destScrollX, 0.1);
    this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, destScrollY, 0.1);
  }

  public destroy(): void {
    this.inputManager?.destroy();
    sounds.stopEngine();
    if (this.trackImage) {
      this.trackImage.destroy();
    }
  }
}
