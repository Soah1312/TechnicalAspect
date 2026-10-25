import Phaser from 'phaser';
import { GAME_WIDTH, PALETTE } from '../config/constants';
import { BootScene } from './scenes/BootScene';
import { RaceScene } from './scenes/RaceScene';

import { calculateLogicalHeight } from './layout';

export function createGame(): Phaser.Game {
  // Cap device pixel ratio at 2.0 to prevent severe fillrate drops on 3x/4x mobile OLEDs
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const logicalHeight = calculateLogicalHeight();
  console.log(`[Engine] Initialized with DPR cap: ${dpr}, logical canvas: ${GAME_WIDTH}x${logicalHeight}`);

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: logicalHeight,
    parent: 'game-container',
    backgroundColor: PALETTE.background,
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: logicalHeight,
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

  const game = new Phaser.Game(config);

  const handleResize = () => {
    const newHeight = calculateLogicalHeight();
    if (game.scale.height !== newHeight) {
      game.scale.resize(GAME_WIDTH, newHeight);
      game.scale.refresh();
      const raceScene = game.scene.getScene('RaceScene') as RaceScene;
      if (raceScene && raceScene.onLogicalResize) {
        raceScene.onLogicalResize(GAME_WIDTH, newHeight);
      }
    }
  };

  window.addEventListener('resize', handleResize, { passive: true });
  window.addEventListener('orientationchange', handleResize, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleResize, { passive: true });
  }

  return game;
}
