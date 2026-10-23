import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, PALETTE } from '../../config/constants';
import { stateMachine } from '../stateMachine';
import { Storage } from '../../util/storage';

export class RaceScene extends Phaser.Scene {
  private playerCar: Phaser.GameObjects.Sprite | null = null;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private keyA: Phaser.Input.Keyboard.Key | null = null;
  private keyD: Phaser.Input.Keyboard.Key | null = null;

  constructor() {
    super('RaceScene');
  }

  public create(): void {
    // 1. Draw Closed-Circuit Retro Track
    this.drawRetroTrack();

    // 2. Determine Player Car Color
    const stored = Storage.getPlayer();
    const colorIndex = this.getCarColorIndex(stored?.playerId || 'player');

    // 3. Create Player Car Sprite
    this.playerCar = this.add.sprite(180, 520, `car_${colorIndex}`);
    this.playerCar.setOrigin(0.5, 0.5);
    this.playerCar.setScale(1.2);

    // 4. Setup Input Controls for keyboard testing
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    }
  }

  public updateCarTexture(playerId: string): void {
    const idx = this.getCarColorIndex(playerId);
    if (this.playerCar && this.textures.exists(`car_${idx}`)) {
      this.playerCar.setTexture(`car_${idx}`);
    }
  }

  private getCarColorIndex(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % PALETTE.carColors.length;
  }

  private drawRetroTrack(): void {
    const g = this.add.graphics();

    // Grass background
    g.fillStyle(Phaser.Display.Color.HexStringToColor(PALETTE.grass).color, 1);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Outer Asphalt Oval
    g.fillStyle(Phaser.Display.Color.HexStringToColor(PALETTE.asphalt).color, 1);
    g.fillRoundedRect(24, 40, GAME_WIDTH - 48, GAME_HEIGHT - 80, 70);

    // Track outer border (kerb)
    g.lineStyle(4, Phaser.Display.Color.HexStringToColor(PALETTE.kerbRed).color, 1);
    g.strokeRoundedRect(24, 40, GAME_WIDTH - 48, GAME_HEIGHT - 80, 70);

    // Infield grass
    g.fillStyle(Phaser.Display.Color.HexStringToColor(PALETTE.grass).color, 1);
    g.fillRoundedRect(90, 130, GAME_WIDTH - 180, GAME_HEIGHT - 260, 45);

    // Track inner border (kerb)
    g.lineStyle(4, Phaser.Display.Color.HexStringToColor(PALETTE.kerbWhite).color, 1);
    g.strokeRoundedRect(90, 130, GAME_WIDTH - 180, GAME_HEIGHT - 260, 45);

    // Finish line at the bottom straight
    this.add.image(180, 560, 'finish_line').setDisplaySize(64, 16);

    // Center infield logo / tech fest watermark
    const textCouncil = this.add.text(180, 290, 'CRESCENDO', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '11px',
      color: PALETTE.accentYellow,
    });
    textCouncil.setOrigin(0.5, 0.5);

    const textYear = this.add.text(180, 314, '2026', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '16px',
      color: PALETTE.cyan,
    });
    textYear.setOrigin(0.5, 0.5);

    const textCouncilSub = this.add.text(180, 338, 'FRCRCE', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '8px',
      color: '#ffffff',
    });
    textCouncilSub.setOrigin(0.5, 0.5);
  }

  public override update(_time: number, _delta: number): void {
    if (stateMachine.getState() === 'RACING' && this.playerCar) {
      // In Stage 1: show steering preview responsiveness
      const isLeft = (this.cursors && this.cursors.left.isDown) || (this.keyA && this.keyA.isDown);
      const isRight = (this.cursors && this.cursors.right.isDown) || (this.keyD && this.keyD.isDown);

      if (isLeft) {
        this.playerCar.angle = Math.max(this.playerCar.angle - 3, -30);
      } else if (isRight) {
        this.playerCar.angle = Math.min(this.playerCar.angle + 3, 30);
      } else {
        this.playerCar.angle = this.playerCar.angle * 0.85;
      }
    }
  }
}
