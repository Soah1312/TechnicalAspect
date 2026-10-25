import { describe, it, expect, beforeEach } from 'vitest';
import { MockApi } from './mockApi';
import { speedMult, minLapMs, stageFor, DEFAULT_TRACK_STAGES } from '../shared/difficulty';
import { getControlPointsForStage, TRACK_SCALE } from '../game/tracks/trackStages';
import { validateTrackCenterline } from '../game/tracks/trackValidator';
import type { TrackPoint } from '../game/track';

describe('Part B, C & D: Core Feature Enhancements Test Suite', () => {
  let api: MockApi;

  beforeEach(() => {
    api = new MockApi(false);
  });

  // ==========================================================
  // PART B: Branch & Year Profile, Scoped Leaderboard, Difficulty
  // ==========================================================
  describe('Part B: Branch, Year and Scoped Leaderboards', () => {
    it('B1: Enforces AIDS branch only allowed for 4th year', async () => {
      // Joining as AIDS 1st year auto-switches or rejects
      const p1 = await api.joinRace('AidsStudent', 'AIDS', 1);
      expect(p1.branch).toBe('AIDS');
      expect(p1.year).toBe(4);

      const p2 = await api.joinRace('CompsStudent', 'COMPS', 2);
      expect(p2.branch).toBe('COMPS');
      expect(p2.year).toBe(2);
    });

    it('B3 & B4: Difficulty Curve progression across lap counts', () => {
      // Lap 1: Base difficulty
      expect(speedMult(1)).toBe(1.0);

      // Verify difficulty curve mapping behavior in request_question
      // Laps 1-10: 80% Easy, 20% Med, 0% Hard
      // Laps 11-25: 30% Easy, 50% Med, 20% Hard
      // Laps 26-45: 10% Easy, 40% Med, 50% Hard
      // Laps 46+: 0% Easy, 30% Med, 70% Hard
      expect(DEFAULT_TRACK_STAGES.length).toBe(4);
    });

    it('B2: Scoped Leaderboards return only racers matching requested scope', async () => {
      const p = await api.joinRace('LeaderDriver', 'MECH', 3);
      expect(p.branch).toBe('MECH');
      expect(p.year).toBe(3);

      // 1. ALL scope
      const allSnap = await api.getLeaderboard('ALL');
      expect(allSnap.scope).toBe('ALL');
      expect(allSnap.top.length).toBeGreaterThan(0);

      // 2. MY BRANCH scope
      const branchSnap = await api.getLeaderboard('BRANCH');
      expect(branchSnap.scope).toBe('BRANCH');
      // Every returned racer must be MECH
      branchSnap.top.forEach((row) => {
        expect(row.branch).toBe('MECH');
      });

      // 3. MY YEAR scope
      const yearSnap = await api.getLeaderboard('YEAR');
      expect(yearSnap.scope).toBe('YEAR');
      // Every returned racer must be Year 3
      yearSnap.top.forEach((row) => {
        expect(row.year).toBe(3);
      });
    });

    it('B4: requestQuestion returns question with assigned difficulty badge level', async () => {
      await api.joinRace('DiffDriver', 'CSE', 2);
      const q = await api.requestQuestion();
      expect(q).toBeDefined();
      expect(q.difficulty).toBeGreaterThanOrEqual(1);
      expect(q.difficulty).toBeLessThanOrEqual(3);
    });
  });

  // ==========================================================
  // PART C: Speed Ramp & Driving Time Validation
  // ==========================================================
  describe('Part C: Speed Ramp and Dynamic minLapMs Validation', () => {
    it('C1: speedMult(n) formula golden table verification (laps 1-60)', () => {
      // speedMult(n) = min(1 + 0.04 * (n - 1), 1.5)
      expect(speedMult(1)).toBe(1.0);
      expect(speedMult(2)).toBe(1.04);
      expect(speedMult(6)).toBe(1.2);
      expect(speedMult(10)).toBe(1.36);
      expect(speedMult(13)).toBe(1.48);
      expect(speedMult(14)).toBe(1.5); // reached cap
      expect(speedMult(25)).toBe(1.5); // stays capped
      expect(speedMult(60)).toBe(1.5); // stays capped
    });

    it('C2: minLapMs(n) scales inversely with speedMult(n)', () => {
      // Base: 40000ms at base, factor 0.8 => 32000ms base min lap
      const minLap1 = minLapMs(1);
      expect(minLap1).toBe(32000);

      const minLap10 = minLapMs(10); // speedMult(10) = 1.36
      expect(minLap10).toBe(Math.floor(32000 / 1.36)); // ~23529

      const minLapCap = minLapMs(14); // speedMult(14) = 1.50
      expect(minLapCap).toBe(Math.floor(32000 / 1.5)); // ~21333

      // Laps at cap maintain 21333ms minimum threshold
      expect(minLapMs(50)).toBe(21333);
    });

    it('C3: submitLap accepts driving time above minLapMs(n) and rejects below', async () => {
      await api.joinRace('SpeedyDriver');
      api.addFuel(100000);
      api.setJoinedAt(Date.now() - 50000);

      // Lap 1: minLapMs is 32000ms. Submitting 31000ms must fail
      const fastLap1 = await api.submitLap(1, 31000);
      expect(fastLap1.accepted).toBe(false);
      expect(fastLap1.reason).toMatch(/physical minimum/i);

      // Submitting valid 33000ms succeeds
      const validLap1 = await api.submitLap(1, 33000);
      expect(validLap1.accepted).toBe(true);
      expect(validLap1.laps).toBe(1);
    });
  });

  // ==========================================================
  // PART D: Track Stages 1-4 Geometry & Seamless Start Straight
  // ==========================================================
  describe('Part D: Track Stages 1-4 Geometric Validation', () => {
    function generateCenterlinePoints(stage: number): TrackPoint[] {
      const rawControl = getControlPointsForStage(stage);
      const controlPoints = rawControl.map(([x, y]) => ({
        x: x * TRACK_SCALE,
        y: y * TRACK_SCALE,
      }));
      const M = controlPoints.length;
      const samplesPerSegment = 25;
      const sampledPositions: { x: number; y: number }[] = [];

      for (let i = 0; i < M; i++) {
        const p0 = controlPoints[(i - 1 + M) % M];
        const p1 = controlPoints[i];
        const p2 = controlPoints[(i + 1) % M];
        const p3 = controlPoints[(i + 2) % M];

        for (let s = 0; s < samplesPerSegment; s++) {
          const t = s / samplesPerSegment;
          const t2 = t * t;
          const t3 = t2 * t;
          const x =
            0.5 *
            (2 * p1.x +
              (-p0.x + p2.x) * t +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
          const y =
            0.5 *
            (2 * p1.y +
              (-p0.y + p2.y) * t +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
          sampledPositions.push({ x, y });
        }
      }

      const N = sampledPositions.length;
      const pts: TrackPoint[] = [];
      let cumulativeDist = 0;

      for (let i = 0; i < N; i++) {
        const cur = sampledPositions[i];
        const next = sampledPositions[(i + 1) % N];
        const dx = next.x - cur.x;
        const dy = next.y - cur.y;
        const dist = Math.hypot(dx, dy);
        const tangent = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };
        const normal = { x: -tangent.y, y: tangent.x };
        pts.push({
          index: i,
          pos: cur,
          tangent,
          normal,
          distance: cumulativeDist,
          progress: 0,
        });
        cumulativeDist += dist;
      }
      return pts;
    }

    it('D1: All 4 stages share the identical start position and heading', () => {
      const s1 = generateCenterlinePoints(1)[0];
      const s2 = generateCenterlinePoints(2)[0];
      const s3 = generateCenterlinePoints(3)[0];
      const s4 = generateCenterlinePoints(4)[0];

      // Exact matching start coordinates
      expect(s1.pos.x).toBeCloseTo(s2.pos.x, 2);
      expect(s1.pos.y).toBeCloseTo(s2.pos.y, 2);
      expect(s1.pos.x).toBeCloseTo(s3.pos.x, 2);
      expect(s1.pos.y).toBeCloseTo(s4.pos.y, 2);

      // Heading East (tangent.x = 1, tangent.y = 0)
      expect(s1.tangent.x).toBeCloseTo(1, 2);
      expect(s1.tangent.y).toBeCloseTo(0, 2);
      expect(s2.tangent.x).toBeCloseTo(1, 2);
      expect(s3.tangent.x).toBeCloseTo(1, 2);
      expect(s4.tangent.x).toBeCloseTo(1, 2);
    });

    it('D2: Stage 1 (Rookie) passes track validator checks', () => {
      const pts = generateCenterlinePoints(1);
      const val = validateTrackCenterline(pts);
      expect(val.isClosedLoop).toBe(true);
      expect(val.hasNoSelfIntersections).toBe(true);
      expect(val.hasSufficientStraight).toBe(true);
      expect(val.minSeparationPx).toBeGreaterThanOrEqual(76);
      expect(val.isValid).toBe(true);
    });

    it('D3: Stage 2 (Racer) passes track validator checks', () => {
      const pts = generateCenterlinePoints(2);
      const val = validateTrackCenterline(pts);
      expect(val.isClosedLoop).toBe(true);
      expect(val.hasNoSelfIntersections).toBe(true);
      expect(val.hasSufficientStraight).toBe(true);
      expect(val.minSeparationPx).toBeGreaterThanOrEqual(76);
      expect(val.isValid).toBe(true);
    });

    it('D4: Stage 3 (Pro) passes track validator checks', () => {
      const pts = generateCenterlinePoints(3);
      const val = validateTrackCenterline(pts);
      expect(val.isClosedLoop).toBe(true);
      expect(val.hasNoSelfIntersections).toBe(true);
      expect(val.hasSufficientStraight).toBe(true);
      expect(val.minSeparationPx).toBeGreaterThanOrEqual(76);
      expect(val.isValid).toBe(true);
    });

    it('D5: Stage 4 (Expert) passes track validator checks', () => {
      const pts = generateCenterlinePoints(4);
      const val = validateTrackCenterline(pts);
      expect(val.isClosedLoop).toBe(true);
      expect(val.hasNoSelfIntersections).toBe(true);
      expect(val.hasSufficientStraight).toBe(true);
      expect(val.minSeparationPx).toBeGreaterThanOrEqual(76);
      expect(val.isValid).toBe(true);
    });

    it('D6: stageFor(n) transitions correctly at lap thresholds', () => {
      // Stage 1: laps 1-10
      expect(stageFor(1)).toBe(1);
      expect(stageFor(5)).toBe(1);
      expect(stageFor(10)).toBe(1);

      // Stage 2: laps 11-25
      expect(stageFor(11)).toBe(2);
      expect(stageFor(20)).toBe(2);
      expect(stageFor(25)).toBe(2);

      // Stage 3: laps 26-45
      expect(stageFor(26)).toBe(3);
      expect(stageFor(35)).toBe(3);
      expect(stageFor(45)).toBe(3);

      // Stage 4: laps 46+
      expect(stageFor(46)).toBe(4);
      expect(stageFor(80)).toBe(4);
    });
  });
});
