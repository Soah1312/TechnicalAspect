// ============================================================
// Crescendo Fuel Rush: Procedural Track Generator (Part 4)
// Deterministic, Seeded Catmull-Rom Generator
// ============================================================

import type { Point2D, TrackPoint } from '../track';
import { ROAD_HALF_WIDTH } from '../track';
import { validateTrackCenterline } from './trackValidator';
import {
  STAGE_1_CONTROL_POINTS,
  STAGE_2_CONTROL_POINTS,
  STAGE_3_CONTROL_POINTS,
  STAGE_4_CONTROL_POINTS,
  TRACK_SCALE,
} from './trackStages';

export interface GeneratedTrackMeta {
  lapNumber: number;
  level: number;
  seed: number;
  attempts: number;
  corners: number;
  hairpins: number;
  chicanes: number;
  minCornerRadius: number;
  totalLength: number;
  controlPoints: [number, number][];
  isFallback: boolean;
}

export interface GeneratedTrack {
  meta: GeneratedTrackMeta;
  controlPoints: [number, number][];
  points: TrackPoint[];
}

/**
 * Seeded 32-bit PRNG (Mulberry32)
 */
export function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample closed Catmull-Rom spline through control points
 */
export function sampleCatmullRom(
  controlPoints: Point2D[],
  samplesPerSegment = 25
): TrackPoint[] {
  const M = controlPoints.length;
  const sampledPositions: Point2D[] = [];

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
  const trackPoints: TrackPoint[] = [];
  let cumulativeDist = 0;

  for (let i = 0; i < N; i++) {
    const prev = sampledPositions[(i - 1 + N) % N];
    const curr = sampledPositions[i];
    const next = sampledPositions[(i + 1) % N];

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    const nx = -ty;
    const ny = tx;

    if (i > 0) {
      cumulativeDist += Math.hypot(curr.x - sampledPositions[i - 1].x, curr.y - sampledPositions[i - 1].y);
    }

    trackPoints.push({
      index: i,
      pos: curr,
      tangent: { x: tx, y: ty },
      normal: { x: nx, y: ny },
      distance: cumulativeDist,
      progress: 0,
    });
  }

  const lastSeg = Math.hypot(
    sampledPositions[0].x - sampledPositions[N - 1].x,
    sampledPositions[0].y - sampledPositions[N - 1].y
  );
  const totalDist = cumulativeDist + lastSeg;

  for (let i = 0; i < N; i++) {
    trackPoints[i].progress = trackPoints[i].distance / totalDist;
  }

  return trackPoints;
}

/**
 * Difficulty target profile based on level (1..12)
 */
interface LevelConstraints {
  minCorners: number;
  maxCorners: number;
  hairpins: number;
  chicanes: number;
  minRadiusMultiplier: number;
}

export function getConstraintsForLevel(level: number): LevelConstraints {
  const L = Math.max(1, Math.min(12, level));

  // Anchor points from spec:
  // Level 1: corners 6-7, hairpins 0, chicanes 0-1, minRadius 3.0
  // Level 3: corners 9-10, hairpins 1, chicanes 1, minRadius 2.6
  // Level 5: corners 12-13, hairpins 2, chicanes 2, minRadius 2.2
  // Level 8: corners 16-18, hairpins 3, chicanes 3, minRadius 1.8
  // Level 12: corners 22-24, hairpins 4, chicanes 4, minRadius 1.4

  let minCorners: number;
  let maxCorners: number;
  let hairpins: number;
  let chicanes: number;
  let minRadiusMult: number;

  if (L <= 3) {
    const f = (L - 1) / 2;
    minCorners = Math.round(6 + f * (9 - 6));
    maxCorners = Math.round(7 + f * (10 - 7));
    hairpins = Math.round(0 + f * 1);
    chicanes = Math.round(0 + f * 1);
    minRadiusMult = 3.0 - f * (3.0 - 2.6);
  } else if (L <= 5) {
    const f = (L - 3) / 2;
    minCorners = Math.round(9 + f * (12 - 9));
    maxCorners = Math.round(10 + f * (13 - 10));
    hairpins = Math.round(1 + f * 1);
    chicanes = Math.round(1 + f * 1);
    minRadiusMult = 2.6 - f * (2.6 - 2.2);
  } else if (L <= 8) {
    const f = (L - 5) / 3;
    minCorners = Math.round(12 + f * (16 - 12));
    maxCorners = Math.round(13 + f * (18 - 13));
    hairpins = Math.round(2 + f * 1);
    chicanes = Math.round(2 + f * 1);
    minRadiusMult = 2.2 - f * (2.2 - 1.8);
  } else {
    const f = (L - 8) / 4;
    minCorners = Math.round(16 + f * (22 - 16));
    maxCorners = Math.round(18 + f * (24 - 18));
    hairpins = Math.round(3 + f * 1);
    chicanes = Math.round(3 + f * 1);
    minRadiusMult = 1.8 - f * (1.8 - 1.4);
  }

  return {
    minCorners,
    maxCorners,
    hairpins,
    chicanes,
    minRadiusMultiplier: minRadiusMult,
  };
}

/**
 * Returns a hand-authored fallback track for the level
 */
export function getHandAuthoredFallback(level: number): [number, number][] {
  if (level <= 2) return STAGE_1_CONTROL_POINTS;
  if (level <= 4) return STAGE_2_CONTROL_POINTS;
  if (level <= 7) return STAGE_3_CONTROL_POINTS;
  return STAGE_4_CONTROL_POINTS;
}

/**
 * Measure corner radii along sampled centerline
 */
export function measureMinRadius(points: TrackPoint[]): number {
  let minR = Infinity;
  const N = points.length;
  const windowSize = 12; // ~260px arc length window

  for (let i = 0; i < N; i += 2) {
    const p1 = points[(i - windowSize + N) % N];
    const p2 = points[(i + windowSize) % N];
    const t1 = p1.tangent;
    const t2 = p2.tangent;

    const dTheta = Math.abs(Math.atan2(t1.x * t2.y - t1.y * t2.x, t1.x * t2.x + t1.y * t2.y));
    let ds: number;
    if (p2.distance >= p1.distance) {
      ds = p2.distance - p1.distance;
    } else {
      ds = points[N - 1].distance - p1.distance + p2.distance;
    }

    if (dTheta > 0.12) {
      const radius = ds / dTheta;
      if (radius < minR) {
        minR = radius;
      }
    }
  }

  return minR === Infinity ? 120 : minR;
}

/**
 * Count corners along sampled centerline by direction shifts
 */
export function countCorners(points: TrackPoint[]): number {
  let cornerCount = 0;
  const N = points.length;
  let inTurn = false;
  const step = 8;

  for (let i = 0; i < N; i += step) {
    const t1 = points[i].tangent;
    const t2 = points[(i + step) % N].tangent;
    const cross = t1.x * t2.y - t1.y * t2.x;
    const absTurn = Math.abs(cross);

    if (absTurn > 0.08) {
      if (!inTurn) {
        cornerCount++;
        inTurn = true;
      }
    } else {
      inTurn = false;
    }
  }

  return cornerCount;
}

/**
 * Generates a candidate track for a given level and seed attempt
 */
export function generateCandidateControlPoints(
  level: number,
  rng: () => number
): [number, number][] {
  // Fixed Start/Finish Straight: identical across all laps for seamless swap
  // Gate 0 at [600, 2500], line runs East past [1800, 2500]
  const baseStraight: [number, number][] = [
    [600, 2500],
    [1200, 2500],
    [1800, 2500],
  ];

  const constraints = getConstraintsForLevel(level);

  // Build sector control points:

  // Sector 1 (East Turn 1 & 2): [2300..2700, 2400..1800]
  const eastPoints: [number, number][] = [];
  const t1x = 2250 + Math.round(rng() * 150);
  const t1y = 2400 + Math.round(rng() * 100);
  eastPoints.push([t1x, t1y]);

  const t2x = 2600 + Math.round(rng() * 150);
  const t2y = 2000 + Math.round(rng() * 200);
  eastPoints.push([t2x, t2y]);

  // Sector 2 (Infield & North Corridor):
  // At higher difficulty, inject chicanes and hairpins
  const infieldPoints: [number, number][] = [];
  const hairpinsToAdd = constraints.hairpins;
  const chicanesToAdd = constraints.chicanes;

  if (level >= 3 && chicanesToAdd >= 1) {
    // East chicane
    infieldPoints.push([2750 + Math.round((rng() - 0.5) * 80), 1500]);
    infieldPoints.push([2600 + Math.round((rng() - 0.5) * 80), 1250]);
    infieldPoints.push([2750 + Math.round((rng() - 0.5) * 80), 1000]);
  } else {
    infieldPoints.push([2700 + Math.round((rng() - 0.5) * 80), 1400]);
    infieldPoints.push([2600 + Math.round((rng() - 0.5) * 80), 900]);
  }

  // North-East Turn into Top Straight
  infieldPoints.push([2300 + Math.round((rng() - 0.5) * 100), 550]);
  infieldPoints.push([1750 + Math.round((rng() - 0.5) * 100), 350]);

  if (level >= 3 && hairpinsToAdd >= 1) {
    // Top Infield Hairpin Loop
    infieldPoints.push([1100 + Math.round((rng() - 0.5) * 100), 320]);
    infieldPoints.push([650 + Math.round((rng() - 0.5) * 80), 450]);
    infieldPoints.push([850 + Math.round((rng() - 0.5) * 80), 850]);

    if (level >= 5 && chicanesToAdd >= 2) {
      // Infield technical S-curves
      infieldPoints.push([1300 + Math.round((rng() - 0.5) * 80), 1000]);
      infieldPoints.push([1500 + Math.round((rng() - 0.5) * 80), 1350]);
      infieldPoints.push([1300 + Math.round((rng() - 0.5) * 80), 1650]);
    } else {
      infieldPoints.push([1200 + Math.round((rng() - 0.5) * 80), 1100]);
      infieldPoints.push([1350 + Math.round((rng() - 0.5) * 80), 1500]);
    }

    if (level >= 8 && hairpinsToAdd >= 3) {
      // Secondary carousel
      infieldPoints.push([900 + Math.round((rng() - 0.5) * 80), 1750]);
      infieldPoints.push([550 + Math.round((rng() - 0.5) * 80), 1600]);
      infieldPoints.push([320 + Math.round((rng() - 0.5) * 80), 1350]);
    } else {
      infieldPoints.push([850 + Math.round((rng() - 0.5) * 80), 1750]);
      infieldPoints.push([550 + Math.round((rng() - 0.5) * 80), 1650]);
    }
  } else {
    // Simpler sweeping top curve
    infieldPoints.push([1100 + Math.round((rng() - 0.5) * 100), 380]);
    infieldPoints.push([550 + Math.round((rng() - 0.5) * 80), 550]);
    infieldPoints.push([400 + Math.round((rng() - 0.5) * 80), 1000]);
    infieldPoints.push([450 + Math.round((rng() - 0.5) * 80), 1500]);
  }

  // Sector 3 (West Entry into Home Straight):
  const westPoints: [number, number][] = [
    [280 + Math.round(rng() * 40), 1800],
    [280 + Math.round(rng() * 40), 2150],
    [330 + Math.round(rng() * 30), 2350],
    [420, 2470],
  ];

  return [...baseStraight, ...eastPoints, ...infieldPoints, ...westPoints];
}

/**
 * Deterministic generator function generateTrack(lapNumber)
 */
export function generateTrack(lapNumber: number): GeneratedTrack {
  const level = Math.max(1, Math.min(12, lapNumber));
  const constraints = getConstraintsForLevel(level);

  // Level 1 baseline length is 8,892 px.
  // Allowed length band: 90% to 125% of level 1 track length (8,002 px to 11,115 px)
  const baseLength = 8892;
  const minAllowedLength = baseLength * 0.90;
  const maxAllowedLength = baseLength * 1.25;

  const baseSeed = lapNumber * 10007 + 42;
  const maxAttempts = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const seed = baseSeed + attempt * 1337;
    const rng = mulberry32(seed);

    const rawCandidate = generateCandidateControlPoints(level, rng);
    const scaledCandidate: Point2D[] = rawCandidate.map(([x, y]) => ({
      x: x * TRACK_SCALE,
      y: y * TRACK_SCALE,
    }));

    const sampled = sampleCatmullRom(scaledCandidate);
    const validation = validateTrackCenterline(sampled);

    if (!validation.isValid) {
      continue;
    }

    const totalLen = sampled[sampled.length - 1].distance;
    if (totalLen < minAllowedLength || totalLen > maxAllowedLength) {
      continue;
    }

    const minR = measureMinRadius(sampled);
    const minRequiredR = constraints.minRadiusMultiplier * ROAD_HALF_WIDTH * 0.95; // 5% tolerance margin
    if (minR < minRequiredR) {
      continue;
    }

    // Candidate passed all validation checks!
    const cornerCount = countCorners(sampled);
    return {
      meta: {
        lapNumber,
        level,
        seed,
        attempts: attempt + 1,
        corners: cornerCount,
        hairpins: constraints.hairpins,
        chicanes: constraints.chicanes,
        minCornerRadius: minR,
        totalLength: totalLen,
        controlPoints: rawCandidate,
        isFallback: false,
      },
      controlPoints: rawCandidate,
      points: sampled,
    };
  }

  // Fallback to hand-authored track if procedural attempts fail
  const fallbackRaw = getHandAuthoredFallback(level);
  const fallbackScaled: Point2D[] = fallbackRaw.map(([x, y]) => ({
    x: x * TRACK_SCALE,
    y: y * TRACK_SCALE,
  }));
  const fallbackSampled = sampleCatmullRom(fallbackScaled);
  const totalLen = fallbackSampled[fallbackSampled.length - 1].distance;

  return {
    meta: {
      lapNumber,
      level,
      seed: baseSeed,
      attempts: maxAttempts,
      corners: countCorners(fallbackSampled),
      hairpins: constraints.hairpins,
      chicanes: constraints.chicanes,
      minCornerRadius: measureMinRadius(fallbackSampled),
      totalLength: totalLen,
      controlPoints: fallbackRaw,
      isFallback: true,
    },
    controlPoints: fallbackRaw,
    points: fallbackSampled,
  };
}
