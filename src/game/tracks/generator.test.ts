import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTrack } from './generator';
import * as validator from './trackValidator';

afterEach(() => vi.restoreAllMocks());

describe('Per-lap circuits', () => {
  it('produces distinct successive tracks and preserves the finish position', () => {
    const tracks = [1, 2, 3, 4, 5, 12, 13, 14].map(generateTrack);
    for (let i = 1; i < tracks.length; i++) {
      expect(tracks[i].controlPoints).not.toEqual(tracks[i - 1].controlPoints);
      expect(tracks[i].points[0].pos).toEqual(tracks[0].points[0].pos);
    }
    expect(generateTrack(2).points).toEqual(tracks[1].points);
  });

  it('changes fallback circuits every lap, even beyond the difficulty cap', () => {
    vi.spyOn(validator, 'validateTrackCenterline').mockReturnValue({
      isValid: false, isClosedLoop: true, hasNoSelfIntersections: false,
      minSeparationPx: 0, hasSufficientStraight: true, errors: ['forced fallback'],
    });
    let previous = generateTrack(1);
    for (let lap = 2; lap <= 16; lap++) {
      const next = generateTrack(lap);
      expect(next.meta.isFallback).toBe(true);
      expect(next.controlPoints).not.toEqual(previous.controlPoints);
      expect(next.points[0].pos).toEqual(previous.points[0].pos);
      previous = next;
    }
  });
});
