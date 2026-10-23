import type { GameApi } from '../api/types';

class ServerClock {
  private offsetMs = 0;
  private syncTimer: number | null = null;
  private isSynchronized = false;

  public async syncWithServer(api: GameApi): Promise<number> {
    const t0 = Date.now();
    try {
      const serverTime = await api.getServerTime();
      const t1 = Date.now();
      const clientMidpoint = (t0 + t1) / 2;
      this.offsetMs = Math.round(serverTime - clientMidpoint);
      this.isSynchronized = true;
    } catch (err) {
      console.warn('Clock sync failed, retaining previous offset:', err);
    }
    return this.offsetMs;
  }

  public startPeriodicSync(api: GameApi, intervalMs = 60000): void {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer);
    }
    this.syncTimer = window.setInterval(() => {
      this.syncWithServer(api).catch((err) => {
        console.error('Periodic clock sync error:', err);
      });
    }, intervalMs);
  }

  public stopPeriodicSync(): void {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  public serverNow(): number {
    return Date.now() + this.offsetMs;
  }

  public getOffset(): number {
    return this.offsetMs;
  }

  public isSynced(): boolean {
    return this.isSynchronized;
  }
}

export const clock = new ServerClock();
export const serverNow = (): number => clock.serverNow();
