import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, PALETTE } from '../config/constants';
import { BootScene } from './scenes/BootScene';
import { RaceScene } from './scenes/RaceScene';

export function createGame(): Phaser.Game {
  // Cap device pixel ratio at 2.0 to prevent severe fillrate drops on 3x/4x mobile OLEDs
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  console.log(`[Engine] Initialized with DPR cap: ${dpr} (native: ${window.devicePixelRatio || 1})`);

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: 'game-container',
    backgroundColor: PALETTE.background,
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      autoRound: true,
    },
    render: {
      antialias: false,
      pixelArt: true,
      roundPixels: true,
      powerPreference: 'high-performance',
      batchSize: 2048,
      desynchronized: true,
    },
    fps: {
      target: 60,
      min: 30,
      forceSetTimeOut: false,
    },
    scene: [BootScene, RaceScene],
  };

  return new Phaser.Game(config);
}
