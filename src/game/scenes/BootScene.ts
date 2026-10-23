import Phaser from 'phaser';
import { PALETTE } from '../../config/constants';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  public preload(): void {
    // Generate procedural textures
    this.createCarTextures();
    this.createTrackTextures();
  }

  public create(): void {
    this.scene.start('RaceScene');
  }

  private createCarTextures(): void {
    PALETTE.carColors.forEach((colorHex, idx) => {
      const key = `car_${idx}`;
      if (this.textures.exists(key)) return;

      const canvas = this.textures.createCanvas(key, 20, 36);
      if (!canvas) return;
      const ctx = canvas.getContext();

      // Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(1, 3, 18, 32);

      // Wheels (black with gray hubs)
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 4, 3, 7); // front-left
      ctx.fillRect(17, 4, 3, 7); // front-right
      ctx.fillRect(0, 22, 3, 7); // rear-left
      ctx.fillRect(17, 22, 3, 7); // rear-right

      // Main Chassis (Car Color)
      ctx.fillStyle = colorHex;
      ctx.fillRect(3, 2, 14, 30);

      // Dark Outline / Detailing
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(3.5, 2.5, 13, 29);

      // Front bumper / Hood scoop
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(4, 2, 3, 2); // left headlight
      ctx.fillRect(13, 2, 3, 2); // right headlight

      // Windshield (cyan tinted retro glass)
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(5, 10, 10, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(6, 11, 2, 4); // glass reflection

      // Roof
      ctx.fillStyle = colorHex;
      ctx.fillRect(5, 16, 10, 6);

      // Rear window
      ctx.fillStyle = '#0b0b1e';
      ctx.fillRect(6, 22, 8, 3);

      // Rear Spoiler / Taillights
      ctx.fillStyle = '#ff2e4d';
      ctx.fillRect(4, 30, 3, 2); // left tail
      ctx.fillRect(13, 30, 3, 2); // right tail

      canvas.refresh();
    });
  }

  private createTrackTextures(): void {
    // Checkered finish line texture
    if (!this.textures.exists('finish_line')) {
      const finish = this.textures.createCanvas('finish_line', 64, 16);
      if (finish) {
        const ctx = finish.getContext();
        const sq = 8;
        for (let y = 0; y < 16; y += sq) {
          for (let x = 0; x < 64; x += sq) {
            ctx.fillStyle = ((x / sq + y / sq) % 2 === 0) ? '#ffffff' : '#000000';
            ctx.fillRect(x, y, sq, sq);
          }
        }
        finish.refresh();
      }
    }
  }
}
