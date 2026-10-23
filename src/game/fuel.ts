export interface FuelEvents {
  onFuelUpdate?: (fuelMs: number, ratio: number) => void;
  onLowFuel?: (fuelMs: number) => void;
  onEmpty?: () => void;
  onPitAllowed?: (allowed: boolean) => void;
}

export class FuelSystem {
  private currentFuelMs: number;
  private readonly maxFuelMs: number;
  private readonly pitBelowFraction: number;
  private readonly lowFuelFraction = 0.25;

  private wasPitAllowed = false;
  private wasLowFuel = false;
  private wasEmpty = false;

  private listeners: FuelEvents = {};

  constructor(initialFuelMs = 30000, maxFuelMs = 30000, pitBelowFraction = 0.5) {
    this.currentFuelMs = initialFuelMs;
    this.maxFuelMs = maxFuelMs;
    this.pitBelowFraction = pitBelowFraction;

    const ratio = this.getRatio();
    this.wasPitAllowed = ratio <= this.pitBelowFraction;
    this.wasLowFuel = ratio <= this.lowFuelFraction;
    this.wasEmpty = this.currentFuelMs <= 0;
  }

  public setListeners(events: FuelEvents): void {
    this.listeners = { ...this.listeners, ...events };
  }

  public getFuelMs(): number {
    return this.currentFuelMs;
  }

  public getRatio(): number {
    return this.maxFuelMs > 0 ? Math.max(0, Math.min(1, this.currentFuelMs / this.maxFuelMs)) : 0;
  }

  public isEmpty(): boolean {
    return this.currentFuelMs <= 0;
  }

  public isPitAllowed(): boolean {
    return this.getRatio() <= this.pitBelowFraction;
  }

  public isLowFuel(): boolean {
    return this.getRatio() <= this.lowFuelFraction && !this.isEmpty();
  }

  public addFuel(ms: number): void {
    const prevRatio = this.getRatio();
    this.currentFuelMs = Math.min(this.maxFuelMs, this.currentFuelMs + ms);
    const newRatio = this.getRatio();

    this.wasEmpty = this.currentFuelMs <= 0;
    this.wasLowFuel = newRatio <= this.lowFuelFraction && !this.wasEmpty;

    if (prevRatio <= this.pitBelowFraction && newRatio > this.pitBelowFraction) {
      this.wasPitAllowed = false;
      this.listeners.onPitAllowed?.(false);
    }

    this.listeners.onFuelUpdate?.(this.currentFuelMs, newRatio);
  }

  public drainAll(): void {
    this.currentFuelMs = 0;
    this.update(0, 10);
  }

  public update(deltaMs: number, carSpeed: number): void {
    // Fuel drains only while moving above threshold (speed > 5 px/s)
    if (this.currentFuelMs > 0 && carSpeed > 5) {
      this.currentFuelMs = Math.max(0, this.currentFuelMs - deltaMs);
    }

    const ratio = this.getRatio();
    this.listeners.onFuelUpdate?.(this.currentFuelMs, ratio);

    // Pit Allowed Check (<= 50%)
    const canPit = ratio <= this.pitBelowFraction;
    if (canPit !== this.wasPitAllowed) {
      this.wasPitAllowed = canPit;
      this.listeners.onPitAllowed?.(canPit);
    }

    // Low Fuel Check (<= 25%)
    const isLow = ratio <= this.lowFuelFraction && this.currentFuelMs > 0;
    if (isLow && !this.wasLowFuel) {
      this.wasLowFuel = true;
      this.listeners.onLowFuel?.(this.currentFuelMs);
    } else if (!isLow && this.wasLowFuel) {
      this.wasLowFuel = false;
    }

    // Empty Check (0 ms)
    if (this.currentFuelMs <= 0 && !this.wasEmpty) {
      this.wasEmpty = true;
      console.log('[Fuel] Fuel tank empty - car stopped');
      this.listeners.onEmpty?.();
    }
  }
}
