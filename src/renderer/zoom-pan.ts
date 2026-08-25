export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function resetTransform(): ViewTransform {
  return { scale: 1, x: 0, y: 0 };
}

/**
 * Zooms around an arbitrary CSS transform origin while keeping the viewport
 * point (px, py) fixed under the cursor.
 */
export function zoomAtOrigin(
  transform: ViewTransform,
  px: number,
  py: number,
  factor: number,
  originX: number,
  originY: number,
): ViewTransform {
  const scale = clampScale(transform.scale * factor);
  const applied = scale / transform.scale;
  return {
    scale,
    x: px - originX - (px - originX - transform.x) * applied,
    y: py - originY - (py - originY - transform.y) * applied,
  };
}

/**
 * Zooms by `factor` while keeping the viewport point (px, py) fixed under the
 * cursor. The document is translated by (x, y) and scaled from its top-left
 * corner, so a content point `p` lands at screen `p * scale + (x, y)`.
 */
export function zoomAt(
  transform: ViewTransform,
  px: number,
  py: number,
  factor: number,
): ViewTransform {
  return zoomAtOrigin(transform, px, py, factor, 0, 0);
}

export function panBy(
  transform: ViewTransform,
  dx: number,
  dy: number,
): ViewTransform {
  return { ...transform, x: transform.x + dx, y: transform.y + dy };
}

/** Converts a wheel delta to pixels, honoring the event's delta mode. */
export function wheelDeltaToPixels(
  delta: number,
  deltaMode: number,
  viewportSize: number,
): number {
  if (deltaMode === 1) return delta * 16; // lines
  if (deltaMode === 2) return delta * viewportSize; // pages
  return delta; // pixels
}

/**
 * Scale that fits content of the given size inside the viewport, leaving
 * `padding` pixels of margin. Never enlarges past 100%.
 */
export function fitScale(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 24,
): number {
  if (contentWidth <= 0 || contentHeight <= 0) return 1;
  const availableWidth = Math.max(viewportWidth - padding * 2, 1);
  const availableHeight = Math.max(viewportHeight - padding * 2, 1);
  return clampScale(
    Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight),
  );
}
