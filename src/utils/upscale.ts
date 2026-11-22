/**
 * High-quality, ring-free image upscalers for game-art assets (Bungie icons,
 * perk symbols, emblems, screenshots).
 *
 * Replaces the previous Lanczos-3 resampler. Unclamped Lanczos3 has negative
 * sidelobes that amplify JPEG compression noise and create dark/light ringing
 * halos around high-contrast icon edges.
 *
 * Algorithms (all pure TypeScript on RGBA byte data, alpha-aware):
 *  - `easu`     — AMD FSR 1.0 EASU (edge-adaptive spatial upsampling). The
 *                 default crisp CPU upscaler: a 12-tap cross neighbourhood that
 *                 rotates and stretches a smooth elliptical kernel *along*
 *                 detected edges, then hard-clamps the result to the min/max
 *                 of the nearest 2x2 source texels — guaranteeing zero ringing.
 *                 Uses a 2x cascade when upscaling more than 2x (sharper, and
 *                 still fast).
 *  - `perk-sdf` — subpixel vector tracing from alpha or a flat two-color
 *                 palette, with corner-preserving cubic Bézier fitting and
 *                 anti-aliased even-odd fill. Textured opaque art uses Mitchell.
 *  - `mitchell` — Mitchell-Netravali (B=1/3, C=1/3) separable cubic. Balanced,
 *                 zero-ringing, far cleaner than browser bilinear.
 *  - `nearest`  — Nearest-neighbour (pixelated / integer).
 *
 * The WebGL2 Anime4K CNN upscaler lives in `./anime4k` (see `upscaleAnime4k`),
 * and `easu` is also its CPU fallback plus the alpha-channel upscaler for
 * transparent PNGs.
 *
 * Raster filters work in premultiplied space. The vector tracer extends
 * straight foreground RGB into the anti-aliased fringe.
 *
 * References:
 *  - FSR 1.0 EASU: AMD FidelityFX-FSR, `ffx_fsr1.h` (MIT), `FsrEasuF`.
 *  - Mitchell-Netravali: standard B=C=1/3 cubic reconstruction filter.
 */

import { upscalePerkVector } from './perkVector';

export type UpscaleMode = 'anime4k' | 'perk-sdf' | 'mitchell' | 'nearest';

/** A straight (non-premultiplied) RGBA image on 0..255 byte data. */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A premultiplied RGBA image on 0..1 float data (internal working format). */
interface FloatImage {
  data: Float32Array;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

function premultiply(source: RgbaImage): FloatImage {
  const { data: src, width, height } = source;
  const data = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = (src[i + 3] ?? 0) / 255;
    data[i] = ((src[i] ?? 0) / 255) * a;
    data[i + 1] = ((src[i + 1] ?? 0) / 255) * a;
    data[i + 2] = ((src[i + 2] ?? 0) / 255) * a;
    data[i + 3] = a;
  }
  return { data, width, height };
}

function unpremultiply(source: FloatImage): RgbaImage {
  const { data: src, width, height } = source;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const a = src[i + 3] ?? 0;
    data[i + 3] = clampByte(a * 255);
    if (a > 0) {
      data[i] = clampByte(((src[i] ?? 0) / a) * 255);
      data[i + 1] = clampByte(((src[i + 1] ?? 0) / a) * 255);
      data[i + 2] = clampByte(((src[i + 2] ?? 0) / a) * 255);
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
  return { data, width, height };
}

// ---------------------------------------------------------------------------
// Nearest-neighbour (pixelated / integer)
// ---------------------------------------------------------------------------

/** Nearest-neighbour resample. Works on straight RGBA (copies texels, no blend). */
export function upscaleNearest(
  source: RgbaImage,
  targetWidth: number,
  targetHeight: number,
): RgbaImage {
  const { data: src, width: srcW, height: srcH } = source;
  const data = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const scaleX = srcW / targetWidth;
  const scaleY = srcH / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor(y * scaleY));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor(x * scaleX));
      const si = (sy * srcW + sx) * 4;
      const di = (y * targetWidth + x) * 4;
      data[di] = src[si] ?? 0;
      data[di + 1] = src[si + 1] ?? 0;
      data[di + 2] = src[si + 2] ?? 0;
      data[di + 3] = src[si + 3] ?? 0;
    }
  }
  return { data, width: targetWidth, height: targetHeight };
}

// ---------------------------------------------------------------------------
// Mitchell-Netravali (separable cubic resampler)
// ---------------------------------------------------------------------------

/** Mitchell-Netravali cubic kernel with the classic B = C = 1/3. */
function mitchellKernel(x: number): number {
  const ax = Math.abs(x);
  if (ax < 1) {
    // (7x^3 - 12x^2 + 16/3) / 6
    return ((7 * ax - 12) * ax * ax + 16 / 3) / 6;
  }
  if (ax < 2) {
    // (-7/3 x^3 + 12x^2 - 20x + 32/3) / 6
    return (((-7 / 3) * ax + 12) * ax - 20) * ax / 6 + 16 / 9;
  }
  return 0;
}

interface Contribution {
  start: number;
  weights: Float32Array;
}

function buildContributions(
  srcLength: number,
  dstLength: number,
  kernel: (x: number) => number,
  support: number,
): Contribution[] {
  const ratio = srcLength / dstLength;
  const filterScale = Math.max(1, ratio);
  const scaledSupport = support * filterScale;
  const contributions: Contribution[] = [];

  for (let dst = 0; dst < dstLength; dst += 1) {
    const center = (dst + 0.5) * ratio;
    const start = Math.max(0, Math.floor(center - scaledSupport));
    const end = Math.min(srcLength, Math.ceil(center + scaledSupport));
    const weights = new Float32Array(Math.max(1, end - start));
    let total = 0;

    for (let src = start; src < end; src += 1) {
      const weight = kernel((src + 0.5 - center) / filterScale);
      weights[src - start] = weight;
      total += weight;
    }

    if (total !== 0) {
      for (let i = 0; i < weights.length; i += 1) {
        weights[i] = (weights[i] ?? 0) / total;
      }
    }

    contributions.push({ start, weights });
  }

  return contributions;
}

/** Separable resample in premultiplied space (horizontal then vertical). */
function separableResize(
  source: FloatImage,
  targetWidth: number,
  targetHeight: number,
  kernel: (x: number) => number,
  support: number,
): FloatImage {
  const { data: src, width: srcW, height: srcH } = source;
  const horizontal = new Float32Array(targetWidth * srcH * 4);
  const contributionsX = buildContributions(srcW, targetWidth, kernel, support);

  for (let y = 0; y < srcH; y += 1) {
    const rowOffset = y * srcW * 4;
    for (let x = 0; x < targetWidth; x += 1) {
      const contribution = contributionsX[x];
      if (!contribution) continue;
      const { start, weights } = contribution;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let i = 0; i < weights.length; i += 1) {
        const w = weights[i] ?? 0;
        const px = rowOffset + (start + i) * 4;
        r += (src[px] ?? 0) * w;
        g += (src[px + 1] ?? 0) * w;
        b += (src[px + 2] ?? 0) * w;
        a += (src[px + 3] ?? 0) * w;
      }
      const out = (y * targetWidth + x) * 4;
      horizontal[out] = r;
      horizontal[out + 1] = g;
      horizontal[out + 2] = b;
      horizontal[out + 3] = a;
    }
  }

  const out = new Float32Array(targetWidth * targetHeight * 4);
  const contributionsY = buildContributions(srcH, targetHeight, kernel, support);

  for (let y = 0; y < targetHeight; y += 1) {
    const contribution = contributionsY[y];
    if (!contribution) continue;
    const { start, weights } = contribution;
    for (let x = 0; x < targetWidth; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let i = 0; i < weights.length; i += 1) {
        const w = weights[i] ?? 0;
        const px = ((start + i) * targetWidth + x) * 4;
        r += (horizontal[px] ?? 0) * w;
        g += (horizontal[px + 1] ?? 0) * w;
        b += (horizontal[px + 2] ?? 0) * w;
        a += (horizontal[px + 3] ?? 0) * w;
      }
      const outOffset = (y * targetWidth + x) * 4;
      out[outOffset] = r;
      out[outOffset + 1] = g;
      out[outOffset + 2] = b;
      out[outOffset + 3] = a;
    }
  }

  return { data: out, width: targetWidth, height: targetHeight };
}

/** Mitchell-Netravali (B=C=1/3) resample. */
export function upscaleMitchell(
  source: RgbaImage,
  targetWidth: number,
  targetHeight: number,
): RgbaImage {
  const premultiplied = premultiply(source);
  const resampled = separableResize(premultiplied, targetWidth, targetHeight, mitchellKernel, 2);
  return unpremultiply(resampled);
}

// ---------------------------------------------------------------------------
// AMD FSR 1.0 EASU (edge-adaptive spatial upsampling)
// ---------------------------------------------------------------------------

// 12-tap cross neighbourhood offsets relative to the floor of the source
// coordinate. Layout (matching FSR 1.0's naming):
//     b c
//   e f g h
//   i j k l
//     n o
const EASU_TAP_X = [0, 1, -1, 0, 1, 2, -1, 0, 1, 2, 0, 1];
const EASU_TAP_Y = [-1, -1, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2];

/**
 * Accumulate the local luma gradient direction and edge strength for one of
 * the four 2x2 sub-quads surrounding the destination sample. Returns the
 * incremental contributions to [dirX, dirY, len].
 */
function easuSetQuad(
  px: number,
  py: number,
  quad: 0 | 1 | 2 | 3,
  lA: number,
  lB: number,
  lC: number,
  lD: number,
  lE: number,
): [number, number, number] {
  // Bilinear corner weight: 0 = S (top-left), 1 = T (top-right),
  // 2 = U (bottom-left), 3 = V (bottom-right).
  let w: number;
  if (quad === 0) w = (1 - px) * (1 - py);
  else if (quad === 1) w = px * (1 - py);
  else if (quad === 2) w = (1 - px) * py;
  else w = px * py;

  // Horizontal axis: '+' difference across the centre, magnitude from the
  // larger of the two sides.
  const dc = lD - lC;
  const cb = lC - lB;
  const lenXDenom = Math.max(Math.abs(dc), Math.abs(cb));
  const lenX = lenXDenom > 1e-12 ? 1 / lenXDenom : 0;
  const dirX = lD - lB;
  let lenXT = Math.abs(dirX) * lenX;
  lenXT = lenXT > 1 ? 1 : lenXT < 0 ? 0 : lenXT;
  lenXT *= lenXT;

  // Vertical axis.
  const ec = lE - lC;
  const ca = lC - lA;
  const lenYDenom = Math.max(Math.abs(ec), Math.abs(ca));
  const lenY = lenYDenom > 1e-12 ? 1 / lenYDenom : 0;
  const dirY = lE - lA;
  let lenYT = Math.abs(dirY) * lenY;
  lenYT = lenYT > 1 ? 1 : lenYT < 0 ? 0 : lenYT;
  lenYT *= lenYT;

  return [dirX * w, dirY * w, (lenXT + lenYT) * w];
}

/** Single FSR 1.0 EASU pass in premultiplied space. */
function easuScale(source: FloatImage, targetWidth: number, targetHeight: number): FloatImage {
  const { data: src, width: srcW, height: srcH } = source;
  const out = new Float32Array(targetWidth * targetHeight * 4);
  const scaleX = srcW / targetWidth;
  const scaleY = srcH / targetHeight;

  const colors = new Float32Array(48); // 12 taps * RGBA
  const luma = new Float32Array(12);

  for (let dy = 0; dy < targetHeight; dy += 1) {
    const srcY = (dy + 0.5) * scaleY - 0.5;
    const fy0 = Math.floor(srcY);
    const py = srcY - fy0;

    for (let dx = 0; dx < targetWidth; dx += 1) {
      const srcX = (dx + 0.5) * scaleX - 0.5;
      const fx0 = Math.floor(srcX);
      const px = srcX - fx0;

      // Load the 12 taps (clamped to the source bounds).
      for (let t = 0; t < 12; t += 1) {
        const sx = fx0 + (EASU_TAP_X[t] ?? 0);
        const sy = fy0 + (EASU_TAP_Y[t] ?? 0);
        const cx = sx < 0 ? 0 : sx >= srcW ? srcW - 1 : sx;
        const cy = sy < 0 ? 0 : sy >= srcH ? srcH - 1 : sy;
        const o = (cy * srcW + cx) * 4;
        const ci = t * 4;
        const r = src[o] ?? 0;
        const g = src[o + 1] ?? 0;
        const b = src[o + 2] ?? 0;
        colors[ci] = r;
        colors[ci + 1] = g;
        colors[ci + 2] = b;
        colors[ci + 3] = src[o + 3] ?? 0;
        // Approximate luma (FSR "luma times 2"): 0.5*B + 0.5*R + G.
        luma[t] = 0.5 * (r + b) + g;
      }

      // Named taps: b=0 c=1 e=2 f=3 g=4 h=5 i=6 j=7 k=8 l=9 n=10 o=11.
      const lB = luma[0] ?? 0;
      const lC = luma[1] ?? 0;
      const lE = luma[2] ?? 0;
      const lF = luma[3] ?? 0;
      const lG = luma[4] ?? 0;
      const lH = luma[5] ?? 0;
      const lI = luma[6] ?? 0;
      const lJ = luma[7] ?? 0;
      const lK = luma[8] ?? 0;
      const lL = luma[9] ?? 0;
      const lN = luma[10] ?? 0;
      const lO = luma[11] ?? 0;

      // Accumulate gradient direction and edge length from the four sub-quads.
      let dirX = 0;
      let dirY = 0;
      let len = 0;

      const q1 = easuSetQuad(px, py, 0, lB, lE, lF, lG, lJ);
      dirX += q1[0];
      dirY += q1[1];
      len += q1[2];
      const q2 = easuSetQuad(px, py, 1, lC, lF, lG, lH, lK);
      dirX += q2[0];
      dirY += q2[1];
      len += q2[2];
      const q3 = easuSetQuad(px, py, 2, lF, lI, lJ, lK, lN);
      dirX += q3[0];
      dirY += q3[1];
      len += q3[2];
      const q4 = easuSetQuad(px, py, 3, lG, lJ, lK, lL, lO);
      dirX += q4[0];
      dirY += q4[1];
      len += q4[2];

      // Normalize the direction vector, guarding the (near-)zero case.
      const dirLenSq = dirX * dirX + dirY * dirY;
      const zro = dirLenSq < 1 / 32768;
      const invLen = zro ? 1 : 1 / Math.sqrt(dirLenSq);
      const ndirX = (zro ? 1 : dirX) * invLen;
      const ndirY = dirY * invLen;

      // Shape the edge-strength term and derive the anisotropic kernel.
      let lenS = len * 0.5;
      lenS *= lenS;
      const stretch =
        (ndirX * ndirX + ndirY * ndirY) / Math.max(Math.abs(ndirX), Math.abs(ndirY));
      const len2x = 1 + (stretch - 1) * lenS;
      const len2y = 1 - 0.5 * lenS;
      const lob = 0.5 + (0.21 - 0.5) * lenS;
      const clp = 1 / lob;

      // Hard min/max over the four nearest source texels (f, g, j, k) — this
      // is what guarantees zero ringing and zero noise amplification.
      const minR = Math.min(colors[12] ?? 0, colors[16] ?? 0, colors[28] ?? 0, colors[32] ?? 0);
      const minG = Math.min(colors[13] ?? 0, colors[17] ?? 0, colors[29] ?? 0, colors[33] ?? 0);
      const minB = Math.min(colors[14] ?? 0, colors[18] ?? 0, colors[30] ?? 0, colors[34] ?? 0);
      const maxR = Math.max(colors[12] ?? 0, colors[16] ?? 0, colors[28] ?? 0, colors[32] ?? 0);
      const maxG = Math.max(colors[13] ?? 0, colors[17] ?? 0, colors[29] ?? 0, colors[33] ?? 0);
      const maxB = Math.max(colors[14] ?? 0, colors[18] ?? 0, colors[30] ?? 0, colors[34] ?? 0);

      // Accumulate the 12 taps with the rotated, stretched elliptical kernel.
      let aR = 0;
      let aG = 0;
      let aB = 0;
      let aA = 0;
      let aW = 0;

      for (let t = 0; t < 12; t += 1) {
        const offX = (EASU_TAP_X[t] ?? 0) - px;
        const offY = (EASU_TAP_Y[t] ?? 0) - py;
        const vx = offX * ndirX + offY * ndirY;
        const vy = offX * -ndirY + offY * ndirX;
        const vxl = vx * len2x;
        const vyl = vy * len2y;
        let d2 = vxl * vxl + vyl * vyl;
        if (d2 > clp) d2 = clp;

        let wB = 0.4 * d2 - 1;
        let wA = lob * d2 - 1;
        wB *= wB;
        wA *= wA;
        wB = 1.5625 * wB - 0.5625;
        const w = wB * wA;

        const ci = t * 4;
        aR += (colors[ci] ?? 0) * w;
        aG += (colors[ci + 1] ?? 0) * w;
        aB += (colors[ci + 2] ?? 0) * w;
        aA += (colors[ci + 3] ?? 0) * w;
        aW += w;
      }

      // Normalize and dering-clamp RGB (alpha is smooth-clamped only).
      let r: number;
      let g: number;
      let b: number;
      let a: number;
      if (aW <= 1e-6) {
        // Degenerate neighbourhood: fall back to the nearest tap.
        r = colors[12] ?? 0;
        g = colors[13] ?? 0;
        b = colors[14] ?? 0;
        a = colors[15] ?? 0;
      } else {
        const invW = 1 / aW;
        r = Math.min(maxR, Math.max(minR, aR * invW));
        g = Math.min(maxG, Math.max(minG, aG * invW));
        b = Math.min(maxB, Math.max(minB, aB * invW));
        a = aA * invW;
        a = a > 1 ? 1 : a < 0 ? 0 : a;
      }

      const o = (dy * targetWidth + dx) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }

  return { data: out, width: targetWidth, height: targetHeight };
}

/**
 * AMD FSR 1.0 EASU upscaler (edge-adaptive, zero-ringing).
 *
 * When upscaling more than 2x it uses a 2x cascade: an exact 2x pass followed
 * by a second pass to the target. This is visibly sharper than a single long
 * pass and keeps thin icon features crisp.
 */
export function upscaleEasu(
  source: RgbaImage,
  targetWidth: number,
  targetHeight: number,
): RgbaImage {
  const scale = Math.max(targetWidth / source.width, targetHeight / source.height);
  if (scale > 2) {
    const midW = source.width * 2;
    const midH = source.height * 2;
    const mid = easuScale(premultiply(source), midW, midH);
    return unpremultiply(easuScale(mid, targetWidth, targetHeight));
  }
  return unpremultiply(easuScale(premultiply(source), targetWidth, targetHeight));
}

// ---------------------------------------------------------------------------
// Perk vector tracing
// ---------------------------------------------------------------------------

/** Trace flat perk glyphs and use Mitchell for continuous-tone artwork. */
export function upscalePerkSdf(source: RgbaImage, targetWidth: number, targetHeight: number): RgbaImage {
  return upscalePerkVector(source, targetWidth, targetHeight)
    ?? upscaleMitchell(source, targetWidth, targetHeight);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** Resample `source` to `targetWidth` x `targetHeight` with the given CPU mode. */
export function upscale(
  source: RgbaImage,
  targetWidth: number,
  targetHeight: number,
  algorithm: UpscaleMode,
): RgbaImage {
  if (source.width === targetWidth && source.height === targetHeight) {
    return { data: new Uint8ClampedArray(source.data), width: targetWidth, height: targetHeight };
  }
  switch (algorithm) {
    case 'nearest':
      return upscaleNearest(source, targetWidth, targetHeight);
    case 'mitchell':
      return upscaleMitchell(source, targetWidth, targetHeight);
    case 'perk-sdf':
      return upscalePerkSdf(source, targetWidth, targetHeight);
    case 'anime4k':
      throw new Error(
        'anime4k runs on WebGL2 only — call upscaleAnime4k() from ./anime4k and fall back to upscaleEasu()',
      );
  }
}
