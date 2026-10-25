import { PALETTE } from '../config/constants';

export interface Point2D {
  x: number;
  y: number;
}

export interface TrackPoint {
  index: number;
  pos: Point2D;
  tangent: Point2D; // Normalized direction vector
  normal: Point2D; // Normalized perpendicular vector (pointing right)
  distance: number; // Cumulative distance from start (gate 0)
  progress: number; // 0 to 1 along circuit
}

export interface CheckpointGate {
  gateIndex: number; // 0 to 5 (0 is start/finish)
  center: Point2D;
  tangent: Point2D;
  normal: Point2D;
  leftPoint: Point2D;
  rightPoint: Point2D;
  halfWidth: number;
}

export const ROAD_HALF_WIDTH = 38; // Road half width in world pixels (total width = 76px)
export const WORLD_WIDTH = 3200;
export const WORLD_HEIGHT = 2900;
export const NUM_GATES = 6;

import { getControlPointsForStage, TRACK_SCALE } from './tracks/trackStages';

export class Track {
  public readonly points: TrackPoint[] = [];
  public readonly totalLength: number = 0;
  public readonly gates: CheckpointGate[] = [];
  public readonly startPosition: Point2D;
  public readonly startAngle: number; // In radians
  public readonly stage: number;
  public readonly lapNumber?: number;

  constructor(stage = 1, customPoints?: TrackPoint[], lapNumber?: number) {
    this.stage = stage;
    this.lapNumber = lapNumber;
    const rawPoints = customPoints || this.generateCenterline(stage);
    this.points = rawPoints;

    this.totalLength = this.points[this.points.length - 1].distance;

    // Gate 0 is at index 0 (Start/Finish line)
    this.gates = this.generateGates();

    // Position car right on the start/finish line pointing forward along the tangent
    const startPt = this.points[0];
    this.startPosition = { x: startPt.pos.x, y: startPt.pos.y };
    this.startAngle = Math.atan2(startPt.tangent.y, startPt.tangent.x);
  }


  private generateCenterline(stage = 1): TrackPoint[] {
    const rawControl = getControlPointsForStage(stage);
    const controlPoints = rawControl.map(([x, y]) => ({
      x: x * TRACK_SCALE,
      y: y * TRACK_SCALE,
    }));
    const M = controlPoints.length;
    const samplesPerSegment = 25;
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

      // Tangent: unit vector pointing forward along track
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const tx = dx / len;
      const ty = dy / len;

      // Normal: perpendicular vector pointing to the right of track
      const nx = -ty;
      const ny = tx;

      if (i > 0) {
        const segDist = Math.hypot(curr.x - sampledPositions[i - 1].x, curr.y - sampledPositions[i - 1].y);
        cumulativeDist += segDist;
      }

      trackPoints.push({
        index: i,
        pos: curr,
        tangent: { x: tx, y: ty },
        normal: { x: nx, y: ny },
        distance: cumulativeDist,
        progress: 0, // Will normalize below
      });
    }

    // Add final loop distance
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

  private generateGates(): CheckpointGate[] {
    const gates: CheckpointGate[] = [];
    const N = this.points.length;
    const gateHalfWidth = ROAD_HALF_WIDTH + 24; // Generous gate width

    for (let g = 0; g < NUM_GATES; g++) {
      const targetIndex = Math.round((g * N) / NUM_GATES) % N;
      const pt = this.points[targetIndex];

      const leftPoint: Point2D = {
        x: pt.pos.x - pt.normal.x * gateHalfWidth,
        y: pt.pos.y - pt.normal.y * gateHalfWidth,
      };
      const rightPoint: Point2D = {
        x: pt.pos.x + pt.normal.x * gateHalfWidth,
        y: pt.pos.y + pt.normal.y * gateHalfWidth,
      };

      gates.push({
        gateIndex: g,
        center: { ...pt.pos },
        tangent: { ...pt.tangent },
        normal: { ...pt.normal },
        leftPoint,
        rightPoint,
        halfWidth: gateHalfWidth,
      });
    }

    return gates;
  }

  // Pre-allocated object reused every frame to eliminate GC allocation pressure
  private readonly _nearestResult: { point: TrackPoint; distance: number; onRoad: boolean } = {
    point: null as unknown as TrackPoint,
    distance: 0,
    onRoad: false,
  };

  /**
   * Fast nearest centerline point lookup using local search window around lastKnownIndex
   */
  public findNearestPoint(
    x: number,
    y: number,
    lastKnownIndex = 0
  ): { point: TrackPoint; distance: number; onRoad: boolean } {
    const N = this.points.length;
    const searchRadius = 24; // Local search +/- 24 points around lastKnownIndex

    let bestIndex = lastKnownIndex;
    let bestDistSq = Infinity;

    // 1. Search locally
    for (let offset = -searchRadius; offset <= searchRadius; offset++) {
      const idx = (lastKnownIndex + offset + N) % N;
      const pt = this.points[idx];
      const dx = x - pt.pos.x;
      const dy = y - pt.pos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIndex = idx;
      }
    }

    // 2. Fallback to global search if local search is suspiciously far (e.g. initial spawn or huge detour)
    const thresholdSq = (ROAD_HALF_WIDTH * 3) * (ROAD_HALF_WIDTH * 3);
    if (bestDistSq > thresholdSq) {
      for (let i = 0; i < N; i++) {
        const pt = this.points[i];
        const dx = x - pt.pos.x;
        const dy = y - pt.pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestIndex = i;
        }
      }
    }

    const dist = Math.sqrt(bestDistSq);
    this._nearestResult.point = this.points[bestIndex];
    this._nearestResult.distance = dist;
    this._nearestResult.onRoad = dist <= ROAD_HALF_WIDTH;
    return this._nearestResult;
  }

  /**
   * Render the complete racetrack once onto an HTML Canvas for the Phaser texture
   */
  public renderToCanvas(existingCanvas?: HTMLCanvasElement): HTMLCanvasElement {
    const canvas = existingCanvas || document.createElement('canvas');
    canvas.width = WORLD_WIDTH;
    canvas.height = WORLD_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    // 1. Grass Base
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Low-contrast, irregular turf patches; no dotted grid or scanline pattern.
    let seed = 173;
    for (let i = 0; i < 8000; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const x = seed % WORLD_WIDTH;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const y = seed % WORLD_HEIGHT;
      ctx.fillStyle = i % 2 ? 'rgba(220,235,210,0.025)' : 'rgba(10,25,20,0.04)';
      ctx.fillRect(x, y, 12 + i % 20, 4 + i % 7);
    }

    const N = this.points.length;

    // 2. Asphalt Road Ribbon
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PALETTE.asphalt;
    ctx.lineWidth = ROAD_HALF_WIDTH * 2;

    ctx.beginPath();
    ctx.moveTo(this.points[0].pos.x, this.points[0].pos.y);
    for (let i = 1; i < N; i++) {
      ctx.lineTo(this.points[i].pos.x, this.points[i].pos.y);
    }
    ctx.closePath();
    ctx.stroke();

    // Continuous pale edge lines keep the road silhouette clean.
    for (const side of [-1, 1]) {
      ctx.strokeStyle = PALETTE.kerbWhite;
      ctx.lineWidth = 3;
      ctx.beginPath();
      this.points.forEach((point, index) => {
        const x = point.pos.x + point.normal.x * (ROAD_HALF_WIDTH - 3) * side;
        const y = point.pos.y + point.normal.y * (ROAD_HALF_WIDTH - 3) * side;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    // 4. Dashed Centerline
    ctx.strokeStyle = PALETTE.accentYellow;
    ctx.lineWidth = 3;
    ctx.setLineDash([24, 24]);
    ctx.beginPath();
    ctx.moveTo(this.points[0].pos.x, this.points[0].pos.y);
    for (let i = 1; i < N; i++) {
      ctx.lineTo(this.points[i].pos.x, this.points[i].pos.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash

    // 5. Checkered Start/Finish Line at Gate 0
    const gate0 = this.gates[0];
    const sqSize = 8;
    const numSquaresAcross = Math.floor((ROAD_HALF_WIDTH * 2) / sqSize);

    for (let row = -1; row <= 1; row++) {
      for (let col = -numSquaresAcross / 2; col <= numSquaresAcross / 2; col++) {
        const isWhite = (row + col) % 2 === 0;
        ctx.fillStyle = isWhite ? '#ffffff' : '#000000';

        const posX = gate0.center.x + gate0.normal.x * (col * sqSize) + gate0.tangent.x * (row * sqSize);
        const posY = gate0.center.y + gate0.normal.y * (col * sqSize) + gate0.tangent.y * (row * sqSize);

        ctx.fillRect(posX - sqSize / 2, posY - sqSize / 2, sqSize, sqSize);
      }
    }

    // 6. Decorative Pixel Scenery Outside Road
    this.drawDecorations(ctx);

    return canvas;
  }

  private drawDecorations(ctx: CanvasRenderingContext2D): void {
    // Deterministic procedural tree clusters around track
    const treeSeeds = [
      [400, 300], [800, 200], [1400, 150], [1900, 200], [2500, 300],
      [2950, 700], [2950, 1300], [2950, 1900], [2800, 2600], [2100, 2750],
      [1400, 2750], [700, 2750], [150, 2400], [100, 1700], [100, 1100],
      [1800, 1000], [1750, 1600], [850, 1200], [500, 900], [1000, 2100],
    ];

    treeSeeds.forEach(([tx, ty]) => {
      // Don't draw trees on the asphalt!
      const check = this.findNearestPoint(tx, ty);
      if (check.distance < ROAD_HALF_WIDTH + 45) return;

      // Draw pixel pine tree
      ctx.fillStyle = '#0f4820'; // Dark pine green
      ctx.fillRect(tx - 12, ty - 24, 24, 24);
      ctx.fillStyle = '#1c7838'; // Medium pine green
      ctx.fillRect(tx - 8, ty - 20, 16, 16);
      ctx.fillStyle = '#2eb052'; // Light pine green
      ctx.fillRect(tx - 4, ty - 16, 8, 8);
      // Trunk
      ctx.fillStyle = '#5c3317';
      ctx.fillRect(tx - 3, ty, 6, 8);
    });

    // Infield Water Basin / Lake
    const lakeX = 1700;
    const lakeY = 1700;
    if (this.findNearestPoint(lakeX, lakeY).distance > ROAD_HALF_WIDTH + 80) {
      ctx.fillStyle = '#0e4a78';
      ctx.fillRect(lakeX - 70, lakeY - 50, 140, 100);
      ctx.fillStyle = '#1774b5';
      ctx.fillRect(lakeX - 60, lakeY - 40, 120, 80);
    }
  }

  /**
   * Render an 80x80 minimap texture
   */
  public renderMinimap(): HTMLCanvasElement {
    const mini = document.createElement('canvas');
    mini.width = 80;
    mini.height = 80;
    const ctx = mini.getContext('2d');
    if (!ctx) return mini;

    ctx.clearRect(0, 0, 80, 80);

    // Scale from world coords to 80x80 (with 6px padding)
    const pad = 6;
    const scaleX = (80 - pad * 2) / WORLD_WIDTH;
    const scaleY = (80 - pad * 2) / WORLD_HEIGHT;

    ctx.strokeStyle = PALETTE.cyan;
    ctx.lineWidth = 3;
    ctx.beginPath();

    const N = this.points.length;
    for (let i = 0; i < N; i++) {
      const mx = pad + this.points[i].pos.x * scaleX;
      const my = pad + this.points[i].pos.y * scaleY;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.closePath();
    ctx.stroke();

    // Start/Finish indicator on minimap
    const f0 = this.points[0];
    ctx.fillStyle = PALETTE.accentYellow;
    ctx.fillRect(pad + f0.pos.x * scaleX - 2, pad + f0.pos.y * scaleY - 2, 5, 5);

    return mini;
  }

  // Pre-allocated minimap coordinate object
  private readonly _minimapCoord = { mx: 0, my: 0 };

  /**
   * Convert world coordinates to 80x80 minimap coordinates
   */
  public worldToMinimap(
    wx: number,
    wy: number,
    out: { mx: number; my: number } = this._minimapCoord
  ): { mx: number; my: number } {
    const pad = 6;
    const scaleX = (80 - pad * 2) / WORLD_WIDTH;
    const scaleY = (80 - pad * 2) / WORLD_HEIGHT;
    out.mx = pad + wx * scaleX;
    out.my = pad + wy * scaleY;
    return out;
  }
}
