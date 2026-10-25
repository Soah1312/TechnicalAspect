import { generateTrack } from '../src/game/tracks/generator';
import { Car } from '../src/game/car';

interface LapCalibration {
  lap: number;
  level: number;
  length: number;
  corners: number;
  hairpins: number;
  chicanes: number;
  minRadius: number;
  theoreticalMinMs: number;
  simulatedBestMs: number;
  attempts: number;
  isFallback: boolean;
}

function simulateIdealLap(trackPoints: any[]): number {
  const dt = 1 / 60;
  const car = new Car(trackPoints[0].pos.x, trackPoints[0].pos.y, Math.atan2(trackPoints[0].tangent.y, trackPoints[0].tangent.x));
  
  const N = trackPoints.length;
  let elapsedMs = 0;
  let hasPassedMidpoint = false;
  
  const mockTrack = {
    points: trackPoints,
    findNearestPoint: (x: number, y: number, lastKnown = 0) => {
      let bestIdx = lastKnown;
      let bestDist = Infinity;
      for (let offset = -15; offset <= 15; offset++) {
        const idx = (lastKnown + offset + N) % N;
        const pt = trackPoints[idx];
        const d = (x - pt.pos.x) ** 2 + (y - pt.pos.y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      }
      return { point: trackPoints[bestIdx], distance: Math.sqrt(bestDist), onRoad: true };
    },
  };

  let lastKnown = 0;
  const maxSteps = 60 * 60; // 60s max
  
  for (let step = 0; step < maxSteps; step++) {
    const nearest = mockTrack.findNearestPoint(car.x, car.y, lastKnown);
    lastKnown = nearest.point.index;
    
    if (lastKnown > N / 2) hasPassedMidpoint = true;
    if (hasPassedMidpoint && lastKnown < 10) {
      // Completed circuit!
      return Math.round(elapsedMs);
    }
    
    // Look ahead 8 points (~170px)
    const targetIdx = (lastKnown + 8) % N;
    const target = trackPoints[targetIdx];
    
    const dx = target.pos.x - car.x;
    const dy = target.pos.y - car.y;
    const targetAngle = Math.atan2(dy, dx);
    let angleDiff = targetAngle - car.heading;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    
    const steer = Math.max(-1, Math.min(1, angleDiff * 4.0));
    car.update(dt, steer, true, mockTrack as any, 1.0);
    elapsedMs += dt * 1000;
  }
  
  // Fallback to theoretical if sim didn't complete
  const totalLen = trackPoints[N - 1].distance;
  return Math.round((totalLen / Car.MAX_SPEED) * 1000);
}


export function runCalibration(): void {
  console.log('===============================================================');
  console.log('   PART 4: TRACK GENERATOR CALIBRATION (LAPS 1 TO 20)          ');
  console.log('===============================================================');
  
  const results: LapCalibration[] = [];
  let minBestLapMs = Infinity;
  
  for (let lap = 1; lap <= 20; lap++) {
    const track = generateTrack(lap);
    const len = Math.round(track.meta.totalLength);
    const theoreticalMs = Math.round((len / Car.MAX_SPEED) * 1000);
    const simMs = simulateIdealLap(track.points);
    
    // Best achievable driving time
    const bestMs = Math.min(theoreticalMs, simMs > 0 ? simMs : theoreticalMs);
    if (bestMs < minBestLapMs) {
      minBestLapMs = bestMs;
    }
    
    results.push({
      lap,
      level: track.meta.level,
      length: len,
      corners: track.meta.corners,
      hairpins: track.meta.hairpins,
      chicanes: track.meta.chicanes,
      minRadius: Math.round(track.meta.minCornerRadius),
      theoreticalMinMs: theoreticalMs,
      simulatedBestMs: simMs,
      attempts: track.meta.attempts,
      isFallback: track.meta.isFallback,
    });
    
    console.log(
      `Lap ${lap.toString().padStart(2)} (Lvl ${track.meta.level.toString().padStart(2)}): ` +
      `Length: ${len}px | Corners: ${track.meta.corners} (H:${track.meta.hairpins}, C:${track.meta.chicanes}) | ` +
      `MinR: ${Math.round(track.meta.minCornerRadius)}px | Theoretical: ${(theoreticalMs / 1000).toFixed(2)}s | ` +
      `Sim: ${(simMs / 1000).toFixed(2)}s | Tries: ${track.meta.attempts} ${track.meta.isFallback ? '[FALLBACK]' : '[PROCEDURAL]'}`
    );
  }
  
  console.log('---------------------------------------------------------------');
  console.log(`MINIMUM BEST LAP TIME ACROSS LAPS 1-20: ${minBestLapMs} ms (${(minBestLapMs / 1000).toFixed(2)}s)`);
  console.log('---------------------------------------------------------------');
  console.log('READY-TO-PASTE SQL UPDATE:');
  console.log(`UPDATE public.game_config SET track_stages = '[{"fromLap":1,"bestLapMsAtBase":${minBestLapMs}}]'::jsonb;`);
  console.log('===============================================================');
}

runCalibration();

