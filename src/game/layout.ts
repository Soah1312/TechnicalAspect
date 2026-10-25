export const BASE_LOGICAL_WIDTH = 360;
export const MIN_LOGICAL_HEIGHT = 560;
export const MAX_LOGICAL_HEIGHT = 860;

export function calculateLogicalHeight(
  viewportWidth?: number,
  viewportHeight?: number
): number {
  const w =
    viewportWidth ??
    (typeof window !== 'undefined'
      ? window.visualViewport?.width || window.innerWidth || BASE_LOGICAL_WIDTH
      : BASE_LOGICAL_WIDTH);

  const h =
    viewportHeight ??
    (typeof window !== 'undefined'
      ? window.visualViewport?.height || window.innerHeight || 640
      : 640);

  const calculated = Math.round((BASE_LOGICAL_WIDTH * h) / Math.max(1, w));
  return Math.min(MAX_LOGICAL_HEIGHT, Math.max(MIN_LOGICAL_HEIGHT, calculated));
}
