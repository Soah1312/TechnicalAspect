export const GAME_WIDTH = 360;
export const GAME_HEIGHT = 640;

export const PALETTE = {
  background: '#0b0b1e',
  asphalt: '#3a3a4a',
  grass: '#1f7a3a',
  kerbRed: '#ff2e4d',
  kerbWhite: '#f5f5f5',
  accentYellow: '#ffd400',
  cyan: '#00e5ff',
  correctGreen: '#39ff14',
  wrongRed: '#ff2e4d',
  carColors: [
    '#00e5ff', // Cyan
    '#ffd400', // Neon Yellow
    '#ff2e4d', // Arcade Red
    '#39ff14', // Electric Green
    '#b347ff', // Retro Purple
    '#ff8c00', // Fire Orange
  ],
} as const;

export const DEFAULT_CONFIG = {
  tankMaxMs: 30000,
  initialFuelMs: 30000,
  fuelPerCorrectMs: 20000,
  pitBelowFraction: 0.5,
  questionTimeMs: 15000,
  wrongLockoutMs: 3000,
  minLapMs: 36000,
  isOpen: true,
} as const;

// Read query params for testing and debugging
const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

export const DEBUG_CONFIG = {
  isDebug: urlParams.get('debug') === '1',
  endInSeconds: urlParams.has('endIn') ? parseInt(urlParams.get('endIn') || '60', 10) : null,
  showCheckpoints: urlParams.get('lap') === '1',
  forceClosed: urlParams.get('closed') === '1',
  forceReset: urlParams.get('reset') === '1',
};
