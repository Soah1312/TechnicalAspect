import { describe, it, expect, beforeEach } from 'vitest';
import { LapManager } from './laps';
import type { CheckpointGate } from './track';

describe('LapManager Checkpoint and Directional Lap System', () => {
  let gates: CheckpointGate[];
  let lapManager: LapManager;

  beforeEach(() => {
    // 6 mock gates situated around an oval loop
    // Gate 0 at x=100, y=0, tangent=(0, 1) (pointing south)
    gates = [
      {
        gateIndex: 0,
        center: { x: 100, y: 0 },
        tangent: { x: 0, y: 1 },
        normal: { x: -1, y: 0 },
        leftPoint: { x: 50, y: 0 },
        rightPoint: { x: 150, y: 0 },
        halfWidth: 50,
      },
      {
        gateIndex: 1,
        center: { x: 100, y: 100 },
        tangent: { x: 0, y: 1 },
        normal: { x: -1, y: 0 },
        leftPoint: { x: 50, y: 100 },
        rightPoint: { x: 150, y: 100 },
        halfWidth: 50,
      },
      {
        gateIndex: 2,
        center: { x: 100, y: 200 },
        tangent: { x: 0, y: 1 },
        normal: { x: -1, y: 0 },
        leftPoint: { x: 50, y: 200 },
        rightPoint: { x: 150, y: 200 },
        halfWidth: 50,
      },
      {
        gateIndex: 3,
        center: { x: 0, y: 200 },
        tangent: { x: 0, y: -1 },
        normal: { x: 1, y: 0 },
        leftPoint: { x: 50, y: 200 },
        rightPoint: { x: -50, y: 200 },
        halfWidth: 50,
      },
      {
        gateIndex: 4,
        center: { x: 0, y: 100 },
        tangent: { x: 0, y: -1 },
        normal: { x: 1, y: 0 },
        leftPoint: { x: 50, y: 100 },
        rightPoint: { x: -50, y: 100 },
        halfWidth: 50,
      },
      {
        gateIndex: 5,
        center: { x: 0, y: 0 },
        tangent: { x: 0, y: -1 },
        normal: { x: 1, y: 0 },
        leftPoint: { x: 50, y: 0 },
        rightPoint: { x: -50, y: 0 },
        halfWidth: 50,
      },
    ];

    lapManager = new LapManager(gates);
  });

  it('completes a valid lap when passing all 6 gates sequentially in the forward direction', () => {
    let completedLapNum = 0;
    lapManager.setListeners({
      onLapComplete: (ev) => {
        completedLapNum = ev.lapNumber;
      },
    });

    // Start on Gate 0 (expecting Gate 1)
    expect(lapManager.getNextExpectedGate()).toBe(1);

    // Cross Gate 1 (heading south, tangent=(0, 1))
    lapManager.update({ x: 100, y: 90 }, { x: 0, y: 50 }, 100);
    lapManager.update({ x: 100, y: 110 }, { x: 0, y: 50 }, 100);
    expect(lapManager.getNextExpectedGate()).toBe(2);

    // Cross Gate 2
    lapManager.update({ x: 100, y: 190 }, { x: 0, y: 50 }, 100);
    lapManager.update({ x: 100, y: 210 }, { x: 0, y: 50 }, 100);
    expect(lapManager.getNextExpectedGate()).toBe(3);

    // Cross Gate 3 (heading north, tangent=(0, -1))
    lapManager.update({ x: 0, y: 210 }, { x: 0, y: -50 }, 100);
    lapManager.update({ x: 0, y: 190 }, { x: 0, y: -50 }, 100);
    expect(lapManager.getNextExpectedGate()).toBe(4);

    // Cross Gate 4
    lapManager.update({ x: 0, y: 110 }, { x: 0, y: -50 }, 100);
    lapManager.update({ x: 0, y: 90 }, { x: 0, y: -50 }, 100);
    expect(lapManager.getNextExpectedGate()).toBe(5);

    // Cross Gate 5
    lapManager.update({ x: 0, y: 10 }, { x: 0, y: -50 }, 100);
    lapManager.update({ x: 0, y: -10 }, { x: 0, y: -50 }, 100);
    expect(lapManager.getNextExpectedGate()).toBe(0); // Now expecting finish line!

    // Finally cross Gate 0 (Finish Line) heading south
    lapManager.update({ x: 100, y: -10 }, { x: 0, y: 50 }, 100);
    lapManager.update({ x: 100, y: 10 }, { x: 0, y: 50 }, 100);

    expect(lapManager.getLapCount()).toBe(1);
    expect(completedLapNum).toBe(1);
    expect(lapManager.getNextExpectedGate()).toBe(1); // Ready for next lap
  });

  it('rejects finish line spamming (repeated crossings of Gate 0 without visiting others)', () => {
    // Cross Gate 0 again immediately without visiting Gates 1-5
    lapManager.update({ x: 100, y: -10 }, { x: 0, y: 50 }, 100);
    lapManager.update({ x: 100, y: 10 }, { x: 0, y: 50 }, 100);
    expect(lapManager.getLapCount()).toBe(0);

    // Back up and cross Gate 0 again forward
    lapManager.update({ x: 100, y: -10 }, { x: 0, y: 50 }, 100);
    lapManager.update({ x: 100, y: 10 }, { x: 0, y: 50 }, 100);
    expect(lapManager.getLapCount()).toBe(0);
  });

  it('rejects reverse crossings (driving backward through a gate)', () => {
    // Attempt to cross Gate 1 backwards (heading north against tangent=(0, 1))
    // velocity is (0, -50), dot product with (0, 1) is -50 <= 0
    lapManager.update({ x: 100, y: 110 }, { x: 0, y: -50 }, 100);
    lapManager.update({ x: 100, y: 90 }, { x: 0, y: -50 }, 100);

    // Expected gate should still be 1 (not advanced)
    expect(lapManager.getNextExpectedGate()).toBe(1);
    expect(lapManager.getLapCount()).toBe(0);
  });

  it('tracks driving time only when car is moving', () => {
    // Stationary car (speed = 0)
    lapManager.update({ x: 100, y: 0 }, { x: 0, y: 0 }, 500, true);
    expect(lapManager.getCurrentLapDrivingTimeMs()).toBe(0);

    // Moving car (speed = 50)
    lapManager.update({ x: 100, y: 20 }, { x: 0, y: 50 }, 500, true);
    expect(lapManager.getCurrentLapDrivingTimeMs()).toBe(500);
  });
});
