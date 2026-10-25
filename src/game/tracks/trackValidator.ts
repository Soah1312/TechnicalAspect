import type { Point2D, TrackPoint } from '../track';
import { ROAD_HALF_WIDTH } from '../track';

export interface TrackValidationResult {
  isValid: boolean;
  isClosedLoop: boolean;
  hasNoSelfIntersections: boolean;
  minSeparationPx: number;
  hasSufficientStraight: boolean;
  errors: string[];
}

function lineSegmentsIntersect(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  p4: Point2D
): boolean {
  const ccw = (a: Point2D, b: Point2D, c: Point2D) => {
    return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  };
  return (
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
    ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  );
}

function distToSegmentSquared(p: Point2D, v: Point2D, w: Point2D): number {
  const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
  if (l2 === 0) return (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = v.x + t * (w.x - v.x);
  const projY = v.y + t * (w.y - v.y);
  return (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
}

export function validateTrackCenterline(points: TrackPoint[]): TrackValidationResult {
  const errors: string[] = [];
  const N = points.length;

  if (N < 20) {
    return {
      isValid: false,
      isClosedLoop: false,
      hasNoSelfIntersections: false,
      minSeparationPx: 0,
      hasSufficientStraight: false,
      errors: ['Track contains too few centerline points.'],
    };
  }

  // 1. Closed loop check
  const first = points[0].pos;
  const last = points[N - 1].pos;
  const endGap = Math.hypot(first.x - last.x, first.y - last.y);
  const isClosedLoop = endGap < 50; // smooth loop closure
  if (!isClosedLoop) {
    errors.push(`End gap too wide: ${endGap.toFixed(1)}px`);
  }

  // 2. Self-intersection check
  let hasNoSelfIntersections = true;
  for (let i = 0; i < N - 1; i++) {
    for (let j = i + 2; j < N - 1; j++) {
      if (i === 0 && j === N - 2) continue; // adjacent wrapped
      if (
        lineSegmentsIntersect(
          points[i].pos,
          points[i + 1].pos,
          points[j].pos,
          points[j + 1].pos
        )
      ) {
        hasNoSelfIntersections = false;
        errors.push(`Centerline self-intersection detected between segments ${i} and ${j}`);
        break;
      }
    }
    if (!hasNoSelfIntersections) break;
  }

  // 3. Minimum separation between non-adjacent segments
  // Non-adjacent points must not come within road width (2 * ROAD_HALF_WIDTH)
  let minSeparationSq = Infinity;
  const minRequiredDistance = ROAD_HALF_WIDTH * 2; // 76 px
  const skipWindow = 28; // ignore 28 points along curve (~550 px along path)

  for (let i = 0; i < N; i += 4) {
    for (let j = i + skipWindow; j < N; j += 4) {
      const diff = Math.abs(i - j);
      const loopDist = Math.min(diff, N - diff);
      if (loopDist < skipWindow) continue;

      const dSq = distToSegmentSquared(
        points[i].pos,
        points[j].pos,
        points[(j + 4) % N].pos
      );
      if (dSq < minSeparationSq) {
        minSeparationSq = dSq;
      }
    }
  }

  const minSeparationPx = Math.sqrt(minSeparationSq);
  if (minSeparationPx < minRequiredDistance) {
    errors.push(
      `Centerline comes too close (${minSeparationPx.toFixed(1)}px < ${minRequiredDistance}px)`
    );
  }

  // 4. Start/Finish straight length check (must be >= 200px)
  // Check points along start segment (e.g. first 200px)
  let straightDist = 0;
  for (let i = 0; i < Math.min(25, N - 1); i++) {
    const curTangent = points[i].tangent;
    const nextTangent = points[i + 1].tangent;
    const dot = curTangent.x * nextTangent.x + curTangent.y * nextTangent.y;
    if (dot < 0.99) break; // bent off straight line
    straightDist += Math.hypot(
      points[i + 1].pos.x - points[i].pos.x,
      points[i + 1].pos.y - points[i].pos.y
    );
  }

  const hasSufficientStraight = straightDist >= 200;
  if (!hasSufficientStraight) {
    errors.push(`Start straight too short: ${straightDist.toFixed(1)}px < 200px`);
  }

  const isValid =
    isClosedLoop &&
    hasNoSelfIntersections &&
    minSeparationPx >= minRequiredDistance &&
    hasSufficientStraight;

  return {
    isValid,
    isClosedLoop,
    hasNoSelfIntersections,
    minSeparationPx,
    hasSufficientStraight,
    errors,
  };
}
