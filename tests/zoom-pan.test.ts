import { describe, expect, it } from 'vitest';
import { clampScale, fitScale, panBy, resetTransform, wheelDeltaToPixels, zoomAt, zoomAtOrigin } from '../src/renderer/zoom-pan';

describe('zoom and pan', () => {
  it('clamps zoom to the allowed range', () => {
    expect(clampScale(0.001)).toBe(0.05);
    expect(clampScale(20)).toBe(8);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it('anchors zoom at a fixed viewport point', () => {
    const zoomed = zoomAt(resetTransform(), 100, 50, 2);
    expect(zoomed.scale).toBe(2);
    expect(zoomed.x).toBe(-100);
    expect(zoomed.y).toBe(-50);
    // The content point under the cursor stays at screen (100, 50).
    expect(100 * zoomed.scale + zoomed.x).toBe(100);
    expect(50 * zoomed.scale + zoomed.y).toBe(50);
  });

  it('zooms out with the cursor anchored too', () => {
    const before = { scale: 2, x: -100, y: -50 };
    const zoomed = zoomAt(before, 300, 200, 0.5);
    expect(zoomed).toEqual({ scale: 1, x: 100, y: 75 });
    // The content point under the cursor before the zoom stays under it after.
    const contentX = (300 - before.x) / before.scale;
    const contentY = (200 - before.y) / before.scale;
    expect(contentX * zoomed.scale + zoomed.x).toBe(300);
    expect(contentY * zoomed.scale + zoomed.y).toBe(200);
  });

  it('keeps the viewport center fixed when zooming a centered diagram', () => {
    const zoomed = zoomAtOrigin(resetTransform(), 400, 300, 2, 400, 300);
    expect(zoomed).toEqual({ scale: 2, x: 0, y: 0 });

    const moved = zoomAtOrigin({ scale: 2, x: 40, y: -20 }, 500, 250, 0.5, 400, 300);
    expect(moved.scale).toBe(1);
    expect((500 - 400 - moved.x) / moved.scale).toBe((500 - 400 - 40) / 2);
    expect((250 - 300 - moved.y) / moved.scale).toBe((250 - 300 + 20) / 2);
  });

  it('pans without changing scale', () => {
    expect(panBy(resetTransform(), 24, -8)).toEqual({ scale: 1, x: 24, y: -8 });
  });

  it('fits large content in the viewport and never enlarges small content', () => {
    // A 5062x4423 diagram in a 1400x852 viewport, 24px padding per side.
    expect(fitScale(5062, 4423, 1400, 852)).toBeCloseTo(804 / 4423, 5);
    expect(fitScale(200, 100, 1400, 852)).toBe(1);
    expect(fitScale(0, 0, 1400, 852)).toBe(1);
    expect(fitScale(100000, 100000, 1400, 852)).toBe(0.05);
  });

  it('normalizes wheel deltas from lines and pages to pixels', () => {
    expect(wheelDeltaToPixels(120, 0, 600)).toBe(120);
    expect(wheelDeltaToPixels(3, 1, 600)).toBe(48);
    expect(wheelDeltaToPixels(1, 2, 600)).toBe(600);
  });
});
