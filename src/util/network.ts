export type NetworkStatus = 'online' | 'offline' | 'slow' | 'reconnected';
import { ICONS } from '../ui/icons';

type NetworkListener = (status: NetworkStatus) => void;

class NetworkMonitor {
  private online =
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true;
  private slow = false;
  private listeners: Set<NetworkListener> = new Set();
  private bannerEl: HTMLElement | null = null;
  private reconnectedTimer: number | null = null;
  private activeRequestCount = 0;
  private slowTimer: number | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
    }
  }

  public isOnline(): boolean {
    return this.online;
  }

  public isSlow(): boolean {
    return this.slow;
  }

  public subscribe(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(status: NetworkStatus): void {
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('[NetworkMonitor] listener error:', err);
      }
    }
    this.updateBanner(status);
  }

  private handleOnline(): void {
    this.online = true;
    this.slow = false;
    this.notify('reconnected');

    if (this.reconnectedTimer !== null) {
      window.clearTimeout(this.reconnectedTimer);
    }
    this.reconnectedTimer = setTimeout(() => {
      this.reconnectedTimer = null;
      if (this.online && !this.slow) {
        this.updateBanner('online');
      }
    }, 2500) as unknown as number;
  }

  private handleOffline(): void {
    this.online = false;
    this.notify('offline');
  }

  /**
   * Track request duration; if a request takes > 3000ms, flag as slow
   */
  public startRequest(): () => void {
    this.activeRequestCount++;
    if (!this.slow && this.slowTimer === null && this.online) {
      this.slowTimer = setTimeout(() => {
        if (this.activeRequestCount > 0 && this.online) {
          this.slow = true;
          this.notify('slow');
        }
      }, 3000) as unknown as number;
    }

    return () => {
      this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
      if (this.activeRequestCount === 0) {
        if (this.slowTimer !== null) {
          clearTimeout(this.slowTimer);
          this.slowTimer = null;
        }
        if (this.slow && this.online) {
          this.slow = false;
          this.notify('online');
        }
      }
    };
  }

  /**
   * Initializes the persistent retro status banner in the top viewport
   */
  public mountBanner(parent: HTMLElement): void {
    if (typeof document === 'undefined') return;

    if (this.bannerEl) {
      this.bannerEl.remove();
    }

    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'network-status-banner';
    this.bannerEl.style.display = 'none';
    parent.appendChild(this.bannerEl);

    if (!this.online) {
      this.updateBanner('offline');
    }
  }

  private updateBanner(status: NetworkStatus): void {
    if (!this.bannerEl) return;

    if (status === 'offline') {
      this.bannerEl.style.display = 'flex';
      this.bannerEl.className = 'network-status-banner banner-offline';
      this.bannerEl.innerHTML = `
        <span class="banner-pulse" style="display:inline-flex; align-items:center;">${ICONS.warning(14, '#ffffff')}</span>
        <span>OFFLINE — RECONNECTING... (LAPS SAVED)</span>
      `;
    } else if (status === 'slow') {
      this.bannerEl.style.display = 'flex';
      this.bannerEl.className = 'network-status-banner banner-slow';
      this.bannerEl.innerHTML = `
        <span class="banner-pulse" style="display:inline-flex; align-items:center;">${ICONS.warning(14, '#000000')}</span>
        <span>NETWORK SLOW — KEEP DRIVING!</span>
      `;
    } else if (status === 'reconnected') {
      this.bannerEl.style.display = 'flex';
      this.bannerEl.className = 'network-status-banner banner-online';
      this.bannerEl.innerHTML = `
        <span style="display:inline-flex; align-items:center;">${ICONS.bolt(14, '#000000')}</span>
        <span>RECONNECTED — TELEMETRY SYNCED!</span>
      `;
    } else {
      this.bannerEl.style.display = 'none';
    }
  }
}

export const networkMonitor = new NetworkMonitor();
