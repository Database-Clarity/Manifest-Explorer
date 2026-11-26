import { describe, expect, it } from 'vitest';
import { computeUpscaleTarget, isReadyResult } from '../ImageLightbox';

describe('ImageLightbox output sizing', () => {
  it('resolves a small icon to mobile DPR 3 pixels without the old 4× clamp', () => {
    const target = computeUpscaleTarget(96, 96, 342, 342, 3, true);

    expect(target).toEqual({ width: 1026, height: 1026 });
    expect(target.width).toBeGreaterThan(96 * 4);
  });

  it('keeps mobile output inside its dimension and pixel budgets', () => {
    const target = computeUpscaleTarget(96, 64, 1400, 900, 3, true);

    expect(Math.max(target.width, target.height)).toBeLessThanOrEqual(2048);
    expect(target.width * target.height).toBeLessThanOrEqual(4_194_304);
    expect(target.width / 96).toBeLessThanOrEqual(12);
  });

  it('uses the larger desktop budget without exceeding its safe bounds', () => {
    const target = computeUpscaleTarget(128, 96, 2800, 1800, 2, false);

    expect(Math.max(target.width, target.height)).toBeLessThanOrEqual(3072);
    expect(target.width * target.height).toBeLessThanOrEqual(6_291_456);
    expect(target.width / 128).toBeLessThanOrEqual(12);
  });

  it('keeps rendered canvas visible for CPU EASU and Smooth Perk Vector fallbacks', () => {
    expect(isReadyResult('ready-anime4k')).toBe(true);
    expect(isReadyResult('anime4k-cpu')).toBe(true);
    expect(isReadyResult('ready-perk-vector')).toBe(true);
    expect(isReadyResult('perk-fallback')).toBe(true);
    expect(isReadyResult('ready-smooth')).toBe(true);
    expect(isReadyResult('native')).toBe(false);
    expect(isReadyResult('cors')).toBe(false);
    expect(isReadyResult('engine-load')).toBe(false);
    expect(isReadyResult('loading')).toBe(false);
  });
});
