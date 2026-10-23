import type { Track, Point2D } from './track';
import { WORLD_WIDTH, WORLD_HEIGHT } from './track';

export interface CarTelemetry {
  x: number;
  y: number;
  heading: number; // In radians
  speed: number; // Absolute magnitude in px/s
  forwardSpeed: number; // Signed speed along heading
  velocity: Point2D;
  onRoad: boolean;
  progress: number; // 0 to 1 along track
  nearestTrackIndex: number;
}

export class Car {
  public static readonly MAX_SPEED = 220; // Target clean lap ~50s at 220 px/s
  public static readonly OFFROAD_MAX_SPEED = 220 * 0.45; // ~99 px/s on grass
  public static readonly ACCELERATION = 140; // px/s^2
  public static readonly COAST_DECELERATION = 80; // px/s^2 on asphalt when fuel empty
  public static readonly OFFROAD_DECEL = 200; // px/s^2 on grass
  public static readonly MAX_TURN_RATE = 2.8; // rad/s at full speed
  public static readonly LATERAL_GRIP_ASPHALT = 6.5;
  public static readonly LATERAL_GRIP_GRASS = 3.8;

  public x: number;
  public y: number;
  public heading: number; // Radians, 0 = East
  public vx = 0;
  public vy = 0;
  public forwardSpeed = 0;
  public onRoad = true;
  public progress = 0;
  public nearestTrackIndex = 0;

  public get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  constructor(startX: number, startY: number, startAngle = 0) {
    this.x = startX;
    this.y = startY;
    this.heading = startAngle;
  }

  public reset(startX: number, startY: number, startAngle = 0): void {
    this.x = startX;
    this.y = startY;
    this.heading = startAngle;
    this.vx = 0;
    this.vy = 0;
    this.forwardSpeed = 0;
    this.onRoad = true;
    this.progress = 0;
    this.nearestTrackIndex = 0;
  }

  public stop(): void {
    this.vx = 0;
    this.vy = 0;
    this.forwardSpeed = 0;
  }

  /**
   * Update arcade physics over deltaSeconds (dt)
   * @param dt Delta time in seconds
   * @param steerInput -1 (left), 0 (none), +1 (right)
   * @param hasFuel boolean indicating if fuel > 0
   * @param track Reference to racetrack for road query
   */
  public update(dt: number, steerInput: number, hasFuel: boolean, track: Track): void {
    // 1. Check road surface & progress using fast local search
    const nearest = track.findNearestPoint(this.x, this.y, this.nearestTrackIndex);
    this.nearestTrackIndex = nearest.point.index;
    this.onRoad = nearest.onRoad;
    this.progress = nearest.point.progress;

    // 2. Acceleration / Deceleration along forward vector
    if (hasFuel) {
      const targetSpeed = this.onRoad ? Car.MAX_SPEED : Car.OFFROAD_MAX_SPEED;
      if (this.forwardSpeed < targetSpeed) {
        this.forwardSpeed = Math.min(targetSpeed, this.forwardSpeed + Car.ACCELERATION * dt);
      } else {
        // Scrub speed down to offroad limit or overspeed limit with drag
        const scrubRate = this.onRoad ? 60 : Car.OFFROAD_DECEL;
        this.forwardSpeed = Math.max(targetSpeed, this.forwardSpeed - scrubRate * dt);
      }
    } else {
      // Fuel is 0: decelerate smoothly to a stop
      const decel = this.onRoad ? Car.COAST_DECELERATION : Car.OFFROAD_DECEL;
      this.forwardSpeed = Math.max(0, this.forwardSpeed - decel * dt);
    }

    // 3. Steering rate scales with speed
    // Low speed gives lower turn rate so car doesn't spin in place; crisp turning at speed
    const speedFactor = Math.min(1.0, Math.max(0.1, this.forwardSpeed / 70));
    const turnRate = steerInput * Car.MAX_TURN_RATE * speedFactor;
    this.heading += turnRate * dt;

    // 4. Direction vectors
    const fwdX = Math.cos(this.heading);
    const fwdY = Math.sin(this.heading);
    const latX = -fwdY;
    const latY = fwdX;

    // 5. Lateral drift & damping
    // Project existing velocity onto lateral vector
    let lateralSpeed = this.vx * latX + this.vy * latY;
    const grip = this.onRoad ? Car.LATERAL_GRIP_ASPHALT : Car.LATERAL_GRIP_GRASS;
    lateralSpeed *= Math.max(0, 1 - grip * dt);

    // Reconstruct velocity vector
    this.vx = fwdX * this.forwardSpeed + latX * lateralSpeed;
    this.vy = fwdY * this.forwardSpeed + latY * lateralSpeed;

    // 6. Update position
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Keep car within world bounds
    const margin = 30;
    this.x = Math.max(margin, Math.min(WORLD_WIDTH - margin, this.x));
    this.y = Math.max(margin, Math.min(WORLD_HEIGHT - margin, this.y));
  }

  public getTelemetry(): CarTelemetry {
    const speed = Math.hypot(this.vx, this.vy);
    return {
      x: this.x,
      y: this.y,
      heading: this.heading,
      speed,
      forwardSpeed: this.forwardSpeed,
      velocity: { x: this.vx, y: this.vy },
      onRoad: this.onRoad,
      progress: this.progress,
      nearestTrackIndex: this.nearestTrackIndex,
    };
  }
}
