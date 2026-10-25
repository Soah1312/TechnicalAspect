export interface TrackStageInfo {
  fromLap: number;
  bestLapMsAtBase: number;
}

export const DEFAULT_TRACK_STAGES: TrackStageInfo[] = [
  { fromLap: 1, bestLapMsAtBase: 40000 },
  { fromLap: 11, bestLapMsAtBase: 40000 },
  { fromLap: 26, bestLapMsAtBase: 40000 },
  { fromLap: 46, bestLapMsAtBase: 40000 },
];

export function speedMult(
  lapNumber: number,
  speedStep = 0.04,
  speedCap = 1.5,
  isSpeedRampEnabled = true
): number {
  if (!isSpeedRampEnabled || lapNumber <= 1) return 1.0;
  const raw = 1 + speedStep * (lapNumber - 1);
  return Number(Math.min(raw, speedCap).toFixed(4));
}

export function stageFor(
  lapNumber: number,
  stages: TrackStageInfo[] = DEFAULT_TRACK_STAGES,
  isTrackStagesEnabled = true
): number {
  if (!isTrackStagesEnabled || !stages || stages.length === 0) return 1;
  let currentStageIndex = 0;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].fromLap <= lapNumber) {
      currentStageIndex = i;
    }
  }
  return currentStageIndex + 1; // 1-based stage index
}

export function minLapMs(
  lapNumber: number,
  lapMinFactor = 0.8,
  speedStep = 0.04,
  speedCap = 1.5,
  stages: TrackStageInfo[] = DEFAULT_TRACK_STAGES,
  isSpeedRampEnabled = true,
  isTrackStagesEnabled = true
): number {
  const stageNum = stageFor(lapNumber, stages, isTrackStagesEnabled);
  const stageConfig = stages[stageNum - 1] || stages[0];
  const mult = speedMult(lapNumber, speedStep, speedCap, isSpeedRampEnabled);
  return Math.floor((lapMinFactor * stageConfig.bestLapMsAtBase) / mult);
}
