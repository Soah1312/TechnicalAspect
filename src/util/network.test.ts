import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { networkMonitor, type NetworkStatus } from './network';

describe('Stage 5 Network Resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports initial online status correctly', () => {
    expect(typeof networkMonitor.isOnline()).toBe('boolean');
    expect(networkMonitor.isSlow()).toBe(false);
  });

  it('tracks slow requests after threshold', () => {
    const statuses: NetworkStatus[] = [];
    const unsubscribe = networkMonitor.subscribe((s) => statuses.push(s));

    const endReq = networkMonitor.startRequest();
    expect(networkMonitor.isSlow()).toBe(false);

    // Advance 3100ms
    vi.advanceTimersByTime(3100);
    expect(networkMonitor.isSlow()).toBe(true);
    expect(statuses).toContain('slow');

    // Finish request
    endReq();
    expect(networkMonitor.isSlow()).toBe(false);

    unsubscribe();
  });

  it('mounts network banner safely without throwing', () => {
    const fakeContainer = {
      appendChild: vi.fn(),
      remove: vi.fn(),
    } as unknown as HTMLElement;

    expect(() => networkMonitor.mountBanner(fakeContainer)).not.toThrow();
  });
});

