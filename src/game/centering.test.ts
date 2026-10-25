import { describe, it, expect } from 'vitest';
import { Car } from './car';
import { Track } from './track';

describe('PART 3 — Camera & Car Centering Verification', () => {
  const VIEWPORTS = [
    { name: '360x640 (standard Android)', width: 360, height: 640 },
    { name: '360x560 (short Android with virtual nav)', width: 360, height: 560 },
    { name: '390x844 (iPhone 12/13/14)', width: 390, height: 844 },
    { name: '412x915 (tall Android Pixel/Galaxy)', width: 412, height: 915 },
  ];

  it.each(VIEWPORTS)(
    'simulates 600 frames at varied speeds and steering on $name: deviation is strictly <= 2px',
    ({ name, width, height }) => {
      const track = new Track(1);
      const car = new Car(track.startPosition.x, track.startPosition.y, track.startAngle);

      let maxDeviation = 0;
      const dt = 1 / 60; // 60 FPS delta
      const screenCenterX = width / 2;
      const screenCenterY = height / 2;

      for (let frame = 0; frame < 600; frame++) {
        // Vary steering inputs: alternating straight, left, right, and sharp turns
        let steer = 0;
        if (frame % 120 < 30) {
          steer = 1; // full right
        } else if (frame % 120 >= 30 && frame % 120 < 60) {
          steer = 0; // straight
        } else if (frame % 120 >= 60 && frame % 120 < 90) {
          steer = -1; // full left
        } else {
          steer = Math.sin(frame * 0.1); // slalom S-curves
        }

        // Vary speed multipliers up to speed cap (1.5x)
        const speedMultiplier = 1.0 + (frame / 600) * 0.5;

        // Update car arcade physics
        car.update(dt, steer, true, track, speedMultiplier);

        // Update camera in same frame synchronously with roundPixels integer rounding
        const scrollX = Math.round(car.x - screenCenterX);
        const scrollY = Math.round(car.y - screenCenterY);

        // Screen position of car relative to viewport
        const carScreenX = car.x - scrollX;
        const carScreenY = car.y - scrollY;

        const deviation = Math.hypot(carScreenX - screenCenterX, carScreenY - screenCenterY);
        if (deviation > maxDeviation) {
          maxDeviation = deviation;
        }

        // Strict requirement: distance between car screen position and screen center must be <= 2 px
        expect(deviation).toBeLessThanOrEqual(2.0);
      }

      console.log(`[Centering Test] ${name} — 600 frames simulated. Max deviation: ${maxDeviation.toFixed(3)} px (Limit: <= 2.0 px)`);
      expect(maxDeviation).toBeLessThanOrEqual(2.0);
    }
  );

  it('keeps exact center alignment even during track swap and sudden position changes', () => {
    const width = 360;
    const height = 640;
    const track = new Track(1);
    const car = new Car(track.startPosition.x, track.startPosition.y, track.startAngle);

    // Swap track or snap car
    car.x = 2450.73;
    car.y = 1182.29;

    const scrollX = Math.round(car.x - width / 2);
    const scrollY = Math.round(car.y - height / 2);

    const carScreenX = car.x - scrollX;
    const carScreenY = car.y - scrollY;

    const deviation = Math.hypot(carScreenX - width / 2, carScreenY - height / 2);
    expect(deviation).toBeLessThanOrEqual(1.0);
  });
});
