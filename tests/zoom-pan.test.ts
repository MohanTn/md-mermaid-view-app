import { describe, expect, it } from 'vitest';
import { clampScale, panBy, resetTransform, wheelDeltaToPixels, zoomAt } from '../src/renderer/zoom-pan';

describe('zoom and pan', () => {
  it('clamps zoom to the allowed range', () => {
    expect(clampScale(0.05)).toBe(0.25);
    expect(clampScale(20)).toBe(5);
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

  it('pans without changing scale', () => {
    expect(panBy(resetTransform(), 24, -8)).toEqual({ scale: 1, x: 24, y: -8 });
  });

  it('normalizes wheel deltas from lines and pages to pixels', () => {
    expect(wheelDeltaToPixels(120, 0, 600)).toBe(120);
    expect(wheelDeltaToPixels(3, 1, 600)).toBe(48);
    expect(wheelDeltaToPixels(1, 2, 600)).toBe(600);
  });
});
