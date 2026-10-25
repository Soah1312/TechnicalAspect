// ============================================================
// Crescendo Fuel Rush: Track Stages 1-4
// All stages share:
//   - Identical ROAD_HALF_WIDTH (38px, road width 76px)
//   - Identical Start/Finish straight (Gate 0 at [600, 2500], running East past [1800, 2500])
//   - Identical straight segment >= 200px for seamless swapping
// ============================================================

export const TRACK_SCALE = 1.12;

export const STAGE_1_CONTROL_POINTS: [number, number][] = [
  // 0-2: Main Home Straight (Identical start/finish line and heading)
  [600, 2500],
  [1200, 2500],
  [1800, 2500],
  // Wide sweeping curves (Rookie Circuit)
  [2400, 2400],
  [2700, 2000],
  [2700, 1400],
  [2600, 900],
  [2300, 500],
  [1700, 350],
  [1100, 350],
  [550, 550],
  [400, 1000],
  [450, 1500],
  [350, 1900],
  [350, 2300],
  // Final entry straight
  [450, 2500],
];

export const STAGE_2_CONTROL_POINTS: [number, number][] = [
  // 0-2: Main Home Straight
  [600, 2500],
  [1200, 2500],
  [1800, 2500],
  // Turn 1 & 2 Sweeper
  [2300, 2450],
  [2650, 2200],
  [2750, 1750],
  // Back Straight into Chicane
  [2750, 1250],
  [2600, 850],
  [2350, 650],
  // North Straight heading West
  [2100, 400],
  [1500, 300],
  [1000, 300],
  // Tight Hairpin
  [600, 450],
  [800, 800],
  // S-Bend & Infield Flow
  [1250, 950],
  [1450, 1300],
  [1300, 1650],
  // Technical Carousel
  [950, 1800],
  [600, 1700],
  // West Sweeping Straight heading South
  [350, 1400],
  [250, 1750],
  [250, 2150],
  // Final Turn curving back to Main Straight
  [350, 2400],
  [450, 2500],
];

export const STAGE_3_CONTROL_POINTS: [number, number][] = [
  // 0-2: Main Home Straight
  [600, 2500],
  [1200, 2500],
  [1800, 2500],
  // Sharper technical chicane & hairpins (Pro Circuit)
  [2350, 2450],
  [2700, 2150],
  [2750, 1650],
  [2600, 1350],
  [2750, 1100],
  [2500, 750],
  [2050, 400],
  [1500, 320],
  [950, 320],
  [550, 500],
  [750, 850],
  [1300, 1000],
  [1500, 1350],
  [1350, 1700],
  [900, 1750],
  [550, 1600],
  [300, 1350],
  [220, 1750],
  [220, 2150],
  [350, 2400],
  [450, 2500],
];

export const STAGE_4_CONTROL_POINTS: [number, number][] = [
  // 0-2: Main Home Straight
  [600, 2500],
  [1200, 2500],
  [1800, 2500],
  // Demanding double chicanes & stadium section (Expert Circuit)
  [2350, 2450],
  [2700, 2100],
  [2650, 1700],
  [2800, 1450],
  [2550, 1200],
  [2750, 950],
  [2400, 650],
  [2000, 380],
  [1450, 300],
  [950, 300],
  [550, 500],
  [700, 850],
  [1350, 1000],
  [1550, 1300],
  [1250, 1600],
  [850, 1700],
  [550, 1550],
  [300, 1300],
  [200, 1700],
  [200, 2150],
  [350, 2400],
  [450, 2500],
];

export function getControlPointsForStage(stage: number): [number, number][] {
  switch (stage) {
    case 1:
      return STAGE_1_CONTROL_POINTS;
    case 2:
      return STAGE_2_CONTROL_POINTS;
    case 3:
      return STAGE_3_CONTROL_POINTS;
    case 4:
    default:
      return STAGE_4_CONTROL_POINTS;
  }
}
