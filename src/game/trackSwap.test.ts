// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../api', () => ({ activeApi: {} }));
import { RaceScene } from './scenes/RaceScene';
import { Track } from './track';
import { LapManager } from './laps';
import { Car } from './car';

afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(window, '__updateHudMinimap'); });

it('switches texture, gates and minimap immediately while preserving car state', () => {
  vi.spyOn(Track.prototype, 'renderToCanvas').mockReturnValue(document.createElement('canvas'));
  const scene = new RaceScene();
  const oldTrack = new Track(1);
  const oldGates = [...oldTrack.gates];
  const textures = new Set(['racetrack_lap_1']);
  const setTexture = vi.fn();
  const minimap = vi.fn();
  Object.assign(window, { __updateHudMinimap: minimap });
  Object.assign(scene, {
    track: oldTrack,
    car: new Car(oldTrack.startPosition.x, oldTrack.startPosition.y, oldTrack.startAngle),
    lapManager: new LapManager(oldTrack.gates),
    cameras: { main: { flash: vi.fn() } },
    trackImage: { texture: { key: 'racetrack_lap_1' }, setTexture },
    textures: {
      exists: (key: string) => textures.has(key),
      addCanvas: (key: string) => textures.add(key),
      remove: (key: string) => textures.delete(key),
    },
  });
  const preload = vi.spyOn(scene, 'schedulePreloadNextTrack').mockImplementation(() => {});
  scene.lapManager.syncLapCount(1);
  const before = { x: scene.car.x, y: scene.car.y, heading: scene.car.heading };
  scene.swapToNextLapTrack(2);
  expect(scene.currentLap).toBe(2);
  expect(scene.track.lapNumber).toBe(2);
  expect(setTexture).toHaveBeenCalledWith('racetrack_lap_2');
  expect(minimap).toHaveBeenCalledWith(scene.track);
  expect(scene.lapManager.getNextExpectedGate()).toBe(1);
  expect(scene.lapManager.getLapCount()).toBe(1);
  expect(oldTrack.gates).toEqual(oldGates);
  expect({ x: scene.car.x, y: scene.car.y, heading: scene.car.heading }).toEqual(before);
  expect(textures.has('racetrack_lap_1')).toBe(false);
  expect(preload).toHaveBeenCalledWith(3);
});
