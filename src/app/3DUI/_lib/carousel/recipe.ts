export const CAROUSEL_MIN = 3;
export const CAROUSEL_MAX = 8;

export const carouselRecipe = {
  source: "2d-css",
  component: "carousel",
  unit: "css-px",
  faceCount: 6,
  minFaces: CAROUSEL_MIN,
  maxFaces: CAROUSEL_MAX,
  idleSpinMs: 100_000,
  face: {
    width: 148,
    height: 48,
    depth: 24,
    gap: 24,
  },
  ring: {
    radius: 148.952,
  },
} as const;

export type CarouselRecipe = typeof carouselRecipe;

export function clampCarouselCount(count: number) {
  return Math.min(CAROUSEL_MAX, Math.max(CAROUSEL_MIN, Math.round(count)));
}

export function carouselRadius(
  count: number,
  face: { width: number; gap: number } = carouselRecipe.face,
) {
  const n = clampCarouselCount(count);
  return (face.width + face.gap) / (2 * Math.sin(Math.PI / n));
}

export function carouselFitScale(
  radius: number,
  faceWidth: number,
  targetSpan = 420,
) {
  const span = 2 * radius + faceWidth;
  return targetSpan / span;
}
