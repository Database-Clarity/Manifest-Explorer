import { afterEach, describe, expect, it, vi } from 'vitest';
import { upscaleAnime4k } from '../anime4k';
import * as generalUpscaleModule from '../upscale';
import {
  upscale,
  upscaleEasu,
  upscaleMitchell,
  upscaleNearest,
  type RgbaImage,
} from '../upscale';
import { upscalePerkSdf, upscalePerkSdfWithStatus } from '../perkVector';

type Pixel = [number, number, number, number];

function makeImage(
  width: number,
  height: number,
  fill: (x: number, y: number) => Pixel,
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

const OPAQUE_WHITE: Pixel = [255, 255, 255, 255];
const OPAQUE_BLACK: Pixel = [0, 0, 0, 255];
const TRANSPARENT_BLACK: Pixel = [0, 0, 0, 0];

interface FakeWebgl {
  gl: WebGL2RenderingContext;
  readPixelsCalls: Array<{ format: number; type: number; pixels: ArrayBufferView }>;
}

let createdCanvas: HTMLCanvasElement | undefined;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

function createFakeWebgl(
  extensions: string[] = ['EXT_color_buffer_half_float'],
  framebufferStatus = 0x8cd5,
): FakeWebgl {
  const readPixelsCalls: FakeWebgl['readPixelsCalls'] = [];
  let id = 0;
  const object = () => ({ id: id++ });
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE_2D: 0x0de1,
    RGBA16F: 0x881a,
    RGBA8: 0x8058,
    RGBA: 0x1908,
    HALF_FLOAT: 0x140b,
    UNSIGNED_BYTE: 0x1401,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE2: 0x84c2,
    MAX_TEXTURE_SIZE: 0x0d33,
    getExtension: (name: string) => (extensions.includes(name) ? {} : null),
    getParameter: () => 8192,
    createShader: object,
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: () => true,
    getShaderInfoLog: () => null,
    deleteShader: vi.fn(),
    createProgram: object,
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: () => true,
    getProgramInfoLog: () => null,
    deleteProgram: vi.fn(),
    getUniformLocation: object,
    createTexture: object,
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    createFramebuffer: object,
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: () => framebufferStatus,
    deleteFramebuffer: vi.fn(),
    deleteTexture: vi.fn(),
    createVertexArray: object,
    bindVertexArray: vi.fn(),
    createBuffer: object,
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    viewport: vi.fn(),
    useProgram: vi.fn(),
    activeTexture: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    drawArrays: vi.fn(),
    readPixels: (
      _x: number,
      _y: number,
      _width: number,
      _height: number,
      format: number,
      type: number,
      pixels: ArrayBufferView,
    ) => {
      readPixelsCalls.push({ format, type, pixels });
      if (pixels instanceof Uint8Array) pixels.fill(128);
    },
  } as unknown as WebGL2RenderingContext;

  return { gl, readPixelsCalls };
}

function useFakeWebgl(...contexts: FakeWebgl[]): void {
  const pending = [...contexts];
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string) {
    if (contextId !== 'webgl2') return null;
    createdCanvas = this;
    return pending.shift()?.gl ?? null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

afterEach(() => {
  createdCanvas?.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  createdCanvas = undefined;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  vi.restoreAllMocks();
});

describe('upscale — exact output dimensions', () => {
  const source = makeImage(8, 6, () => OPAQUE_WHITE);

  const cases: ReadonlyArray<[string, (s: RgbaImage, w: number, h: number) => RgbaImage]> = [
    ['nearest', upscaleNearest],
    ['mitchell', upscaleMitchell],
    ['easu', upscaleEasu],
  ];

  for (const [label, fn] of cases) {
    it(`${label} produces the requested dimensions`, () => {
      const out = fn(source, 32, 24);
      expect(out.width).toBe(32);
      expect(out.height).toBe(24);
      expect(out.data.length).toBe(32 * 24 * 4);
    });

    it(`${label} produces the requested dimensions for non-integer zoom`, () => {
      const out = fn(source, 30, 22);
      expect(out.width).toBe(30);
      expect(out.height).toBe(22);
      expect(out.data.length).toBe(30 * 22 * 4);
    });
  }
});

describe('upscale — EASU 2× cascade', () => {
  it('produces exact dimensions at 4× (cascade path)', () => {
    const out = upscaleEasu(makeImage(16, 16, () => OPAQUE_WHITE), 64, 64);
    expect(out.width).toBe(64);
    expect(out.height).toBe(64);
    expect(out.data.length).toBe(64 * 64 * 4);
  });

  it('stays within a tight local source window on a sharp step edge', () => {
    const srcW = 16;
    const srcH = 16;
    const source = makeImage(srcW, srcH, (x) => (x < 8 ? OPAQUE_BLACK : OPAQUE_WHITE));
    const dstW = 64; // 4x — exercises the 2x cascade
    const dstH = 64;
    const out = upscaleEasu(source, dstW, dstH);

    for (let y = 0; y < dstH; y += 1) {
      for (let x = 0; x < dstW; x += 1) {
        // Source-space centre of this output pixel, matching EASU's own mapping.
        const sx = (x + 0.5) * (srcW / dstW) - 0.5;
        const sy = (y + 0.5) * (srcH / dstH) - 0.5;
        const fx = Math.floor(sx);
        const fy = Math.floor(sy);

        // The cascade's second pass reconstructs from the 2x intermediate, so
        // its effective neighbourhood is one extra source texel wider than a
        // single pass. A 4x4 window (fx-1..fx+2) still guarantees zero ringing.
        let min = 255;
        let max = 0;
        for (let j = -1; j <= 2; j += 1) {
          for (let i = -1; i <= 2; i += 1) {
            const cx = fx + i < 0 ? 0 : fx + i >= srcW ? srcW - 1 : fx + i;
            const cy = fy + j < 0 ? 0 : fy + j >= srcH ? srcH - 1 : fy + j;
            const v = source.data[(cy * srcW + cx) * 4] ?? 0;
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }

        const o = (y * dstW + x) * 4;
        for (let c = 0; c < 3; c += 1) {
          const value = out.data[o + c] ?? 0;
          expect(value).toBeGreaterThanOrEqual(min - 1);
          expect(value).toBeLessThanOrEqual(max + 1);
        }
      }
    }
  });
});

describe('upscale — premultiplied alpha preservation', () => {
  const cases: ReadonlyArray<[string, (s: RgbaImage, w: number, h: number) => RgbaImage]> = [
    ['easu', upscaleEasu],
    ['mitchell', upscaleMitchell],
    ['nearest', upscaleNearest],
  ];

  for (const [label, fn] of cases) {
    it(`${label} never bleeds transparent black into opaque white`, () => {
      // Left half transparent black, right half opaque white.
      const source = makeImage(16, 16, (x) => (x < 8 ? TRANSPARENT_BLACK : OPAQUE_WHITE));
      const out = fn(source, 32, 32);

      for (let i = 0; i < out.data.length; i += 4) {
        const a = out.data[i + 3] ?? 0;
        if (a < 128) continue;
        // Wherever the pixel is meaningfully opaque, it must still be white:
        // a straight-alpha filter would darken it to roughly the alpha value.
        expect(out.data[i] ?? 0).toBeGreaterThanOrEqual(235);
        expect(out.data[i + 1] ?? 0).toBeGreaterThanOrEqual(235);
        expect(out.data[i + 2] ?? 0).toBeGreaterThanOrEqual(235);
      }
    });
  }
});

describe('upscale — perk-sdf on a transparent monochrome PNG', () => {
  it('tightens the contour, keeps the interior white and leaves no dark fringe', () => {
    // A 16x16 white square glyph (rows/cols 4..11) on transparency.
    const source = makeImage(16, 16, (x, y) =>
      x >= 4 && x <= 11 && y >= 4 && y <= 11 ? OPAQUE_WHITE : TRANSPARENT_BLACK,
    );
    const out = upscalePerkSdf(source, 64, 64);

    // Interior (dead centre) is fully opaque white.
    const centre = (32 * 64 + 32) * 4;
    expect(out.data[centre + 3] ?? 0).toBeGreaterThanOrEqual(240);
    expect(out.data[centre] ?? 0).toBeGreaterThanOrEqual(235);

    // Outside the glyph is fully transparent.
    const corner = (2 * 64 + 2) * 4;
    expect(out.data[corner + 3] ?? 0).toBeLessThanOrEqual(12);

    // Zero dark fringe: wherever alpha is visible, the colour is still white.
    for (let i = 0; i < out.data.length; i += 4) {
      const a = out.data[i + 3] ?? 0;
      if (a < 16) continue;
      expect(out.data[i] ?? 0).toBeGreaterThanOrEqual(235);
      expect(out.data[i + 1] ?? 0).toBeGreaterThanOrEqual(235);
      expect(out.data[i + 2] ?? 0).toBeGreaterThanOrEqual(235);
    }
  });

  it('preserves a 1px-wide line without collapsing it', () => {
    // A single 1px vertical white line at x=8 on transparency.
    const source = makeImage(16, 16, (x) => (x === 8 ? OPAQUE_WHITE : TRANSPARENT_BLACK));
    const out = upscalePerkSdf(source, 64, 64);

    let maxAlpha = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 28; x <= 40; x += 1) {
        const a = out.data[(y * 64 + x) * 4 + 3] ?? 0;
        if (a > maxAlpha) maxAlpha = a;
      }
    }
    // The 1px stroke must survive contour fitting at near-full strength.
    expect(maxAlpha).toBeGreaterThanOrEqual(200);
  });

  it('fills to the frame when a transparent glyph is clipped at a corner', () => {
    const source = makeImage(16, 12, (x, y) =>
      x < 8 && y < 6 ? OPAQUE_WHITE : TRANSPARENT_BLACK,
    );
    const out = upscalePerkSdf(source, 192, 84);
    const alpha = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3]!;
    expect(alpha(0, 0)).toBe(255);
    expect(alpha(0, 20)).toBe(255);
    expect(alpha(40, 0)).toBe(255);
    expect(alpha(0, 60)).toBe(0);
    expect(alpha(120, 0)).toBe(0);
  });

  it('extends solid foreground RGB through partly transparent contour pixels', () => {
    const tint: Pixel = [231, 47, 159, 255];
    const source = makeImage(12, 12, (x, y) => {
      if (x >= 4 && x <= 7 && y >= 3 && y <= 8) return tint;
      return x === 3 && y >= 3 && y <= 8 ? [0, 0, 0, 170] : TRANSPARENT_BLACK;
    });
    const out = upscalePerkSdf(source, 47, 43);
    const fringe: Pixel[] = [];
    for (let i = 0; i < out.data.length; i += 4) {
      const alpha = out.data[i + 3]!;
      if (alpha > 0 && alpha < 255) fringe.push([out.data[i]!, out.data[i + 1]!, out.data[i + 2]!, alpha]);
    }
    expect(fringe.length).toBeGreaterThan(10);
    expect(fringe.every(([r, g, b]) => r === tint[0] && g === tint[1] && b === tint[2])).toBe(true);
  });

  it('retains a faint hairline below the isoline alongside crisp vector contours', () => {
    const source = makeImage(32, 32, (x, y) => {
      if (y >= 6 && y <= 10 && x >= 5 && x <= 25) return OPAQUE_WHITE;
      if (y === 16 && x >= 5 && x <= 25) return [255, 255, 255, 110 - (x - 5) * 3];
      return TRANSPARENT_BLACK;
    });
    const out = upscalePerkSdf(source, 128, 128);
    const at = (x: number, y: number) => out.data[((y * 4 + 1) * 128 + x * 4 + 1) * 4 + 3]!;
    expect(at(12, 8)).toBe(255);
    expect(at(12, 13)).toBe(0);
    expect(at(12, 16)).toBeGreaterThan(60);
    expect(at(12, 16)).toBeLessThan(128);
  });

  it('fits a continuous faint diagonal from its sampled edge coverage', () => {
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let sample = 0; sample < 32; sample += 1) {
        const along = (x + (sample + 0.5) / 32) / scale;
        if (along < 3 || along > 29) continue;
        const center = (14.12 + 0.2 * along) * scale;
        const halfWidth = 0.24 * scale;
        area += Math.max(0, Math.min(y + 1, center + halfWidth) - Math.max(y, center - halfWidth));
      }
      return area * 184 / 32;
    };
    const source = makeImage(32, 32, (x, y) => {
      if (x >= 6 && x < 26 && y >= 3 && y < 9) return OPAQUE_WHITE;
      return [255, 255, 255, Math.round(coverage(x, y, 1))];
    });
    const result = upscalePerkSdf(source, 128, 128);
    let squaredError = 0, count = 0;
    for (let x = 32; x < 96; x += 1) {
      const center = Math.floor(14.12 * 4 + 0.2 * x);
      for (let y = center - 4; y <= center + 4; y += 1) {
        const actual = result.data[(y * result.width + x) * 4 + 3]!;
        squaredError += (actual - coverage(x, y, 4)) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(squaredError / count)).toBeLessThan(24);
  });

  it('retains the faint continuation of a taper next to its traced body at asymmetric zoom', () => {
    const source = makeImage(24, 16, (x, y) => {
      if (y >= 4 && y <= 6 && x >= 3 && x <= 8) return OPAQUE_WHITE;
      if (y === 5 && x >= 9 && x <= 14) return [255, 255, 255, 110 - (x - 9) * 9];
      return TRANSPARENT_BLACK;
    });
    const out = upscalePerkSdf(source, 240, 48);
    const alpha = (x: number, y: number) => out.data[((y * 3 + 1) * 240 + x * 10 + 5) * 4 + 3]!;
    expect(alpha(5, 5)).toBe(255);
    expect(alpha(12, 5)).toBeGreaterThan(45);
    expect(alpha(12, 5)).toBeLessThan(128);
    expect(alpha(12, 8)).toBe(0);
  });

  it('preserves the sampled opacity of a small translucent accent', () => {
    const source = makeImage(24, 24, (x, y) => {
      if (x >= 3 && x <= 9 && y >= 5 && y <= 16) return OPAQUE_WHITE;
      if (x === 16 && y === 12) return [255, 255, 255, 190];
      return TRANSPARENT_BLACK;
    });
    const out = upscalePerkSdf(source, 96, 96);
    const dot = out.data[((12 * 4 + 1) * 96 + 16 * 4 + 1) * 4 + 3]!;
    expect(dot).toBeGreaterThan(150);
    expect(dot).toBeLessThanOrEqual(190);
    expect(out.data[((12 * 4 + 1) * 96 + 6 * 4 + 1) * 4 + 3]).toBe(255);
  });

  it('preserves rotation and mirror symmetry when a traced glyph has both', () => {
    const source = makeImage(23, 23, (x, y) => {
      const u = Math.abs(x - 11), v = Math.abs(y - 11);
      const alpha = Math.round(255 * Math.min(1, Math.max(0, 10.7 - u - v * 0.42, 10.7 - v - u * 0.42)));
      return [255, 255, 255, alpha];
    });
    const out = upscalePerkSdf(source, 101, 101);
    const alpha = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3]!;
    for (let y = 0; y < out.height; y += 1) {
      for (let x = 0; x < out.width; x += 1) {
        expect(alpha(x, y)).toBe(alpha(100 - y, x));
        expect(alpha(x, y)).toBe(alpha(100 - x, y));
      }
    }
  });

  it('keeps an intentionally asymmetric accent on a symmetric body', () => {
    const source = makeImage(32, 32, (x, y) => {
      if (Math.hypot(x - 15.5, y - 15.5) < 9) return OPAQUE_WHITE;
      if (x === 3 && y === 11) return [255, 255, 255, 202];
      return TRANSPARENT_BLACK;
    });
    const out = upscalePerkSdf(source, 128, 128);
    const alpha = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3]!;
    expect(alpha(13, 45)).toBeGreaterThan(150);
    expect(alpha(114, 45)).toBe(0);
  });

  it('finds an off-center mirror axis while keeping an unmatched accent', () => {
    const source = makeImage(32, 30, (x, y) => {
      if (x === 2 && y === 10) return [255, 255, 255, 202];
      const distance = Math.hypot(x - 13.5, y - 14);
      const bias = x === 20 && y === 8 ? 0.05 : 0;
      const alpha = Math.round(255 * Math.max(0, Math.min(1, 9.3 - distance - bias)));
      return [255, 255, 255, alpha];
    });
    const out = upscalePerkSdf(source, 128, 120);
    const alpha = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3]!;
    for (let y = 16; y < 100; y += 1) {
      for (let x = 18; x < 56; x += 1) {
        expect(Math.abs(alpha(x, y) - alpha(111 - x, y))).toBeLessThanOrEqual(1);
      }
    }
    expect(alpha(9, 41)).toBeGreaterThan(150);
    expect(alpha(102, 41)).toBe(0);
  });

  it('fits mirrored sub-shapes consistently inside an asymmetric glyph', () => {
    const source = makeImage(48, 32, (x, y) => {
      if (x < 17 && y < 7) return OPAQUE_WHITE;
      const localX = x < 24 ? x - 4 : 43 - x;
      const localY = y - 11;
      if (localX < 0 || localX >= 14 || localY < 0 || localY >= 14) return TRANSPARENT_BLACK;
      const edge = Math.min(localY - localX * 0.32, 11.4 - localY - localX * 0.17, 11.2 - localX);
      return [255, 255, 255, Math.round(255 * Math.min(1, Math.max(0, edge + 0.5)))];
    });
    const out = upscalePerkSdf(source, 192, 128);
    let difference = 0;
    for (let y = 42; y < 101; y += 1) {
      for (let x = 10; x < 76; x += 1) {
        const a = out.data[(y * out.width + x) * 4 + 3]!;
        const b = out.data[(y * out.width + out.width - 1 - x) * 4 + 3]!;
        difference = Math.max(difference, Math.abs(a - b));
      }
    }
    expect(difference).toBeLessThanOrEqual(1);
  });

  it('retains a partial-alpha recess inside a solid silhouette', () => {
    const source = makeImage(24, 24, (x, y) => {
      if (x < 4 || x > 19 || y < 4 || y > 19) return TRANSPARENT_BLACK;
      return x === 12 && y === 12 ? [255, 255, 255, 115] : OPAQUE_WHITE;
    });
    const out = upscalePerkSdf(source, 96, 96);
    expect(out.data[(49 * 96 + 49) * 4 + 3]).toBeLessThan(150);
    expect(out.data[(41 * 96 + 49) * 4 + 3]).toBe(255);
  });

  it('keeps supported gray accents on their original side of half coverage', () => {
    const source = makeImage(24, 24, (x, y) => {
      if (x === 3 && y === 12) return [255, 255, 255, 109];
      if (x < 7 || x > 19 || y < 4 || y > 19) return TRANSPARENT_BLACK;
      return x === 12 && y === 12 ? [255, 255, 255, 149] : OPAQUE_WHITE;
    });
    const out = upscalePerkSdf(source, 120, 120);
    const alpha = (x: number) => out.data[(62 * out.width + x * 5 + 2) * 4 + 3]!;
    expect(alpha(3)).toBe(109);
    expect(alpha(12)).toBe(149);
  });

  it('preserves opposing narrow bands against their local backgrounds', () => {
    const source = makeImage(36, 28, (x, y) => {
      if (x < 4 || x > 31) return TRANSPARENT_BLACK;
      if (y === 7) return [255, 255, 255, 100];
      if (y === 19) return [255, 255, 255, 155];
      return y >= 15 && y <= 23 ? OPAQUE_WHITE : TRANSPARENT_BLACK;
    });
    const out = upscalePerkSdf(source, 180, 140);
    const alpha = (x: number, y: number) => out.data[((y * 5 + 2) * out.width + x * 5 + 2) * 4 + 3]!;
    for (let x = 7; x <= 28; x += 1) {
      expect(alpha(x, 7)).toBeCloseTo(100, 0);
      expect(alpha(x, 19)).toBeCloseTo(155, 0);
      expect(alpha(x, 6)).toBe(0);
      expect(alpha(x, 20)).toBe(255);
    }
  });

  it('keeps a smooth circular ring at consistent radius through diagonal turns', () => {
    const source = makeImage(32, 32, (x, y) => {
      const distance = Math.abs(Math.hypot(x - 15.5, y - 15.5) - 9);
      return [255, 255, 255, Math.round(255 * Math.min(1, Math.max(0, 1.7 - distance)))];
    });
    const out = upscalePerkSdf(source, 192, 192);
    const atRadius = (radius: number, angle: number) => {
      const x = Math.floor(96 + radius * 6 * Math.cos(angle));
      const y = Math.floor(96 + radius * 6 * Math.sin(angle));
      return out.data[(y * out.width + x) * 4 + 3]!;
    };
    for (let step = 0; step < 64; step += 1) {
      const angle = step * Math.PI / 32;
      expect(atRadius(9, angle)).toBeGreaterThan(235);
      expect(atRadius(7, angle)).toBeLessThan(80);
      expect(atRadius(11, angle)).toBeLessThan(80);
    }
  });

  it('fits neighboring round dots while keeping the gaps between them', () => {
    const circles = [[9.31, 13.36], [14.21, 13.41], [19.11, 13.46], [24.01, 13.51]] as const;
    const coverage = (x: number, y: number, scale: number) => {
      let sum = 0;
      for (let sample = 0; sample < 48; sample += 1) {
        const position = (y + (sample + 0.5) / 48) / scale;
        for (const [centerX, centerY] of circles) {
          const half = Math.sqrt(Math.max(0, 2.11 ** 2 - (position - centerY) ** 2));
          sum += Math.max(0, Math.min(x + 1, (centerX + half) * scale) - Math.max(x, (centerX - half) * scale));
        }
      }
      return sum / 48;
    };
    const source = makeImage(34, 26, (x, y) => [255, 255, 255, Math.round(255 * coverage(x, y, 1))]);
    const out = upscalePerkSdf(source, 136, 104);
    let error = 0, count = 0;
    for (let y = 42; y < 65; y += 1) {
      for (let x = 27; x < 108; x += 1) {
        error += (out.data[(y * 136 + x) * 4 + 3]! - 255 * coverage(x, y, 4)) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(error / count)).toBeLessThan(4.5);
  });

  it.each([false, true])('fits a diamond through its vertices and split markers (markers %s)', (markers) => {
    const coverage = (x: number, y: number, scale: number) => {
      const interval = (lo: number, hi: number) => Math.max(0, Math.min(x + 1, hi * scale) - Math.max(x, lo * scale));
      let sum = 0;
      for (let sample = 0; sample < 64; sample += 1) {
        const position = (y + (sample + 0.5) / 64) / scale;
        const distance = Math.abs(position - 24);
        sum += interval(24 - 19.18 + distance, 24 + 19.18 - distance)
          - interval(24 - 17.82 + distance, 24 + 17.82 - distance);
        if (markers && position >= 11.18 && position < 17.87) {
          sum += interval(11.22, Math.min(17.71, 48 - position - 20.29))
            + interval(Math.max(11.22, 48 - position - 16.28), 17.71);
        }
      }
      return sum / 64;
    };
    const source = makeImage(48, 48, (x, y) => {
      const inside = x >= 21 && x < 27 && y >= 21 && y < 27;
      return [255, 255, 255, Math.round(255 * Math.max(coverage(x, y, 1), Number(inside)))];
    });
    const out = upscalePerkSdf(source, 192, 192);
    let error = 0, count = 0;
    for (let y = 12; y < 180; y += 1) {
      for (let x = 12; x < 180; x += 1) {
        if (Math.abs(Math.abs(x + 0.5 - 96) + Math.abs(y + 0.5 - 96) - 76) > 8) continue;
        error += (out.data[(y * 192 + x) * 4 + 3]! - 255 * coverage(x, y, 4)) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(error / count)).toBeLessThan(4.5);
  });

  it('keeps a thin circular band continuous across the crown above joined interior shapes', () => {
    const coverage = (x: number, y: number, scale: number) => {
      const overlap = (lo: number, hi: number) => Math.max(0, Math.min(y + 1, hi * scale) - Math.max(y, lo * scale));
      let sum = 0;
      for (let sample = 0; sample < 32; sample += 1) {
        const dx = (x + (sample + 0.5) / 32) / scale - 22;
        if (Math.abs(dx) >= 16) continue;
        const outer = Math.sqrt(16 ** 2 - dx ** 2);
        const inner = Math.sqrt(Math.max(0, 14.8 ** 2 - dx ** 2));
        sum += overlap(22 - outer, 22 + outer) - overlap(21.35 - inner, Math.min(33.75, 21.35 + inner));
      }
      return sum / 32;
    };
    const source = makeImage(44, 44, (x, y) => [255, 255, 255, Math.round(255 * coverage(x, y, 1))]);
    const out = upscalePerkSdf(source, 176, 176);
    let error = 0, count = 0;
    for (let y = 22; y < 35; y += 1) {
      for (let x = 62; x < 114; x += 1) {
        error += (out.data[(y * 176 + x) * 4 + 3]! - 255 * coverage(x, y, 4)) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(error / count)).toBeLessThan(5);
  });

  it('fits closely spaced concentric rings using all four boundaries', () => {
    const centerX = 22.34, centerY = 21.57, radii = [17.2, 16.1, 15.08, 14.03];
    const coverage = (x: number, y: number, scale: number) => {
      let sum = 0;
      for (let row = 0; row < 24; row += 1) {
        const dy = (y + (row + 0.5) / 24) / scale - centerY;
        for (const [i, radius] of radii.entries()) {
          if (Math.abs(dy) >= radius) continue;
          const span = Math.sqrt(radius ** 2 - dy ** 2);
          const width = Math.max(0, Math.min(x + 1, (centerX + span) * scale) - Math.max(x, (centerX - span) * scale));
          sum += i % 2 ? -width : width;
        }
      }
      return sum / 24;
    };
    const source = makeImage(44, 44, (x, y) => [255, 255, 255, Math.round(coverage(x, y, 1) * 255)]);
    const out = upscalePerkSdf(source, 176, 176);
    let squaredError = 0, count = 0;
    for (let y = 0; y < 176; y += 1) {
      for (let x = 0; x < 176; x += 1) {
        const r = Math.hypot((x + 0.5) / 4 - centerX, (y + 0.5) / 4 - centerY);
        if (r < 13.6 || r > 17.6) continue;
        squaredError += (out.data[(y * out.width + x) * 4 + 3]! - 255 * coverage(x, y, 4)) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(squaredError / count)).toBeLessThan(5);
  });

  it('keeps partially covered punctures open at even zoom factors', () => {
    const source = makeImage(36, 24, (x, y) => {
      if (x < 3 || x > 32 || y < 3 || y > 20) return TRANSPARENT_BLACK;
      return y === 11 && (x === 10 || x === 25) ? [255, 255, 255, 105] : OPAQUE_WHITE;
    });
    const out = upscalePerkSdf(source, 144, 96);
    const center = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3]!;
    for (const x of [10 * 4, 25 * 4]) {
      for (const dx of [1, 2]) {
        for (const dy of [1, 2]) expect(center(x + dx, 44 + dy)).toBeLessThan(128);
      }
      expect(center(x + 6, 46)).toBe(255);
    }
  });

  it.each(['dot', 'hole'] as const)('retains the native area of an isolated %s at 2×', (kind) => {
    const source = makeImage(20, 20, (x, y) => {
      if (x === 10 && y === 12) return [255, 255, 255, kind === 'dot' ? 173 : 82];
      const solid = kind === 'dot'
        ? x >= 5 && x < 14 && y >= 4 && y < 8
        : x >= 4 && x < 16 && y >= 4 && y < 16;
      return solid ? OPAQUE_WHITE : TRANSPARENT_BLACK;
    });
    const out = upscalePerkSdf(source, 40, 40);
    const phase = (x: number, y: number) => {
      const alpha = out.data[(y * out.width + x) * 4 + 3]!;
      return kind === 'dot' ? alpha : 255 - alpha;
    };
    const measured = (phase(20, 24) + phase(21, 24) + phase(20, 25) + phase(21, 25)) / 4;
    expect(measured).toBeGreaterThan(165);
    expect(measured).toBeLessThanOrEqual(173);
  });

  it.each(['dot', 'hole'] as const)('fits a small circular %s without faceting its edge', (kind) => {
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let j = 0; j < 24; j += 1) {
        const dy = (y + (j + 0.5) / 24) / scale - 10.81;
        const chord = Math.sqrt(Math.max(0, 1.23 ** 2 - dy ** 2));
        area += Math.max(0, Math.min(x + 1, (12.28 + chord) * scale) - Math.max(x, (12.28 - chord) * scale));
      }
      return area / 24;
    };
    const source = makeImage(26, 26, (x, y) => {
      const phase = coverage(x, y, 1);
      const inside = x >= 3 && x < 23 && y >= 3 && y < 23;
      return [255, 255, 255, Math.round(255 * (kind === 'dot' ? phase : Number(inside) - phase))];
    });
    const out = upscalePerkSdf(source, 104, 104);
    let error = 0, samples = 0;
    for (let y = 34; y < 52; y += 1) {
      for (let x = 42; x < 57; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        const phase = kind === 'dot' ? alpha : 255 - alpha;
        error += (phase - coverage(x, y, 4) * 255) ** 2;
        samples += 1;
      }
    }
    expect(Math.sqrt(error / samples)).toBeLessThan(3);
  });

  it.each(['rail', 'slot'] as const)('keeps the flat ends of an isolated subpixel %s', (kind) => {
    const overlap = (start: number, end: number, low: number, high: number) =>
      Math.max(0, Math.min(end, high) - Math.max(start, low));
    const coverage = (x: number, y: number, scale: number) =>
      overlap(x, x + 1, 7.25 * scale, 17.5 * scale) * overlap(y, y + 1, 9.25 * scale, 10.5 * scale);
    const source = makeImage(26, 20, (x, y) => {
      const value = coverage(x, y, 1);
      const inside = x >= 3 && x < 23 && y >= 3 && y < 17;
      const alpha = kind === 'rail' ? value : Number(inside) - value;
      return [255, 255, 255, Math.round(alpha * 255)];
    });
    const out = upscalePerkSdf(source, 104, 80);
    for (let y = 36; y < 43; y += 1) {
      for (let x = 28; x < 71; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        const phase = kind === 'rail' ? alpha : 255 - alpha;
        expect(Math.abs(phase - coverage(x, y, 4) * 255), `${kind} at (${x}, ${y})`).toBeLessThan(6);
      }
    }
  });

  it('keeps a one-texel slot open through both antialiased edges of a bar', () => {
    const interval = (index: number, lo: number, hi: number) => Math.max(0, Math.min(index + 1, hi) - Math.max(index, lo));
    const coverage = (x: number, y: number, scale: number) => interval(y, 6.36 * scale, 19.65 * scale)
      * (interval(x, 4 * scale, 21 * scale) - interval(x, 12.2 * scale, 12.8 * scale));
    const source = makeImage(26, 24, (x, y) => [255, 255, 255, Math.round(255 * coverage(x, y, 1))]);
    const out = upscalePerkSdf(source, 104, 96);
    let error = 0, count = 0;
    for (let y = 24; y < 80; y += 1) {
      for (let x = 48; x < 52; x += 1) {
        error += (out.data[(y * out.width + x) * 4 + 3]! - coverage(x, y, 4) * 255) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(error / count)).toBeLessThan(4);
  });

  it('keeps two lightly filtered slanted slots separate through a long run', () => {
    const slit = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let i = 0; i < 32; i += 1) {
        const center = 8.31 * scale + 0.257 * (x + (i + 0.5) / 32);
        for (const offset of [0, 2.7]) {
          const midpoint = center + offset * scale;
          area += Math.max(0, Math.min(y + 1, midpoint + 0.35 * scale) - Math.max(y, midpoint - 0.35 * scale));
        }
      }
      return area / 32;
    };
    const source = makeImage(42, 29, (x, y) => {
      if (x < 2 || x >= 40 || y < 3 || y >= 26) return [255, 255, 255, 0];
      const filtered = 0.88 * slit(x, y, 1) + 0.06 * (slit(x, y - 1, 1) + slit(x, y + 1, 1));
      return [255, 255, 255, Math.round((1 - filtered) * 255)];
    });
    const out = upscalePerkSdf(source, 168, 116);
    let squaredError = 0, count = 0;
    for (let x = 30; x < 140; x += 1) {
      const midpoint = 8.31 * 4 + 0.257 * (x + 0.5);
      for (const offset of [0, 10.8]) {
        const alpha = out.data[(Math.floor(midpoint + offset) * out.width + x) * 4 + 3]!;
        expect(alpha).toBeLessThan(128);
      }
      expect(out.data[(Math.floor(midpoint + 5.4) * out.width + x) * 4 + 3]!).toBeGreaterThan(230);
      const yStart = Math.floor(8.31 * 4 + 0.257 * x) - 4;
      for (let y = yStart; y < yStart + 20; y += 1) {
        const deficit = 255 - out.data[(y * out.width + x) * 4 + 3]!;
        squaredError += (deficit - slit(x, y, 4) * 255) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(squaredError / count)).toBeLessThan(30);
  });

  it('recovers the visible part of a taper clipped at the frame edge', () => {
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let i = 0; i < 48; i += 1) {
        const u = (x + (i + 0.5) / 48) / scale;
        if (u >= 14) continue;
        const center = 9.42 + 0.052 * (u + 0.31);
        const half = 0.097 * (u + 0.31);
        area += Math.max(0, Math.min(y + 1, (center + half) * scale) - Math.max(y, (center - half) * scale));
      }
      return area / 48;
    };
    const source = makeImage(24, 20, (x, y) => [255, 255, 255, Math.round(coverage(x, y, 1) * 255)]);
    const out = upscalePerkSdf(source, 96, 80);
    let squaredError = 0, count = 0;
    for (let y = 33; y < 44; y += 1) {
      for (let x = 0; x < 25; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        squaredError += (alpha - coverage(x, y, 4) * 255) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(squaredError / count)).toBeLessThan(10);
  });

  it('fits a curved silhouette within the first source row', () => {
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let i = 0; i < 48; i += 1) {
        const u = (x + (i + 0.5) / 48) / scale;
        if (u < 4 || u >= 28) continue;
        const top = 0.41 + 0.0038 * (u - 16.17) ** 2;
        area += Math.max(0, Math.min(y + 1, 13.2 * scale) - Math.max(y, top * scale));
      }
      return area / 48;
    };
    const source = makeImage(32, 20, (x, y) => [255, 255, 255, Math.round(coverage(x, y, 1) * 255)]);
    const out = upscalePerkSdf(source, 128, 80);
    for (let y = 0; y < 7; y += 1) {
      for (let x = 38; x < 92; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        expect(Math.abs(alpha - coverage(x, y, 4) * 255)).toBeLessThan(7);
      }
    }
  });

  it('preserves the gaps between straight strokes as they converge', () => {
    const slopes = [0.73, 0.46, 0.19, -0.19, -0.46, -0.73];
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let j = 0; j < 48; j += 1) {
        const u = (y + (j + 0.5) / 48) / scale;
        if (u < 9.25 || u >= 29.4) continue;
        let end = x;
        for (const slope of slopes) {
          const center = (17.14 + slope * (u - 29.4)) * scale;
          const lo = Math.max(x, center - 0.78 * scale);
          const hi = Math.min(x + 1, center + 0.78 * scale);
          if (hi <= lo) continue;
          area += Math.max(0, hi - Math.max(lo, end));
          end = Math.max(end, hi);
        }
      }
      return area / 48;
    };
    const source = makeImage(36, 36, (x, y) => [255, 255, 255, Math.round(coverage(x, y, 1) * 255)]);
    const out = upscalePerkSdf(source, 144, 144);
    let squaredError = 0, count = 0;
    for (let y = 88; y < 114; y += 1) {
      for (let x = 45; x < 95; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        squaredError += (alpha - coverage(x, y, 4) * 255) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(squaredError / count)).toBeLessThan(7);
  });

  it('fits a short pointed cutout next to a broad dark region', () => {
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let i = 0; i < 48; i += 1) {
        const u = (x + (i + 0.5) / 48) / scale;
        const offset = u - 7.18;
        if (offset < 0 || u >= 21) continue;
        const low = u < 13 ? 11.43 - 0.02 * offset : 8;
        const high = u < 13 ? 11.43 + 0.37 * offset : 16;
        area += Math.max(0, Math.min(y + 1, high * scale) - Math.max(y, low * scale));
      }
      return area / 48;
    };
    const source = makeImage(28, 24, (x, y) => {
      const solid = x >= 3 && x < 25 && y >= 3 && y < 21;
      return [255, 255, 255, solid ? Math.round((1 - coverage(x, y, 1)) * 255) : 0];
    });
    const out = upscalePerkSdf(source, 112, 96);
    let squaredError = 0, count = 0;
    for (let y = 43; y < 55; y += 1) {
      for (let x = 27; x < 45; x += 1) {
        const deficit = 255 - out.data[(y * out.width + x) * 4 + 3]!;
        squaredError += (deficit - coverage(x, y, 4) * 255) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(squaredError / count)).toBeLessThan(8);
  });

  it('keeps a curved stroke continuous as it tapers below one texel', () => {
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let i = 0; i < 48; i += 1) {
        const u = (x + (i + 0.5) / 48) / scale;
        if (u < 5 || u >= 27) continue;
        const center = 4.34 + 0.024 * (u - 26) ** 2;
        const half = (0.97 - 0.036 * (u - 5)) / 2;
        area += Math.max(0, Math.min(y + 1, (center + half) * scale) - Math.max(y, (center - half) * scale));
      }
      return area / 48;
    };
    const source = makeImage(32, 24, (x, y) => {
      const solid = x >= 7 && x < 25 && y >= 16 && y < 21;
      return [255, 255, 255, solid ? 255 : Math.round(coverage(x, y, 1) * 255)];
    });
    const out = upscalePerkSdf(source, 128, 96);
    let squaredError = 0, count = 0;
    for (let x = 52; x < 104; x += 1) {
      const center = Math.floor(4 * (4.34 + 0.024 * ((x + 0.5) / 4 - 26) ** 2));
      for (let y = center - 3; y <= center + 3; y += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        squaredError += (alpha - coverage(x, y, 4) * 255) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(squaredError / count)).toBeLessThan(16);
  });

  it.each([
    { circleY: 8.4, radius: 4, barY: 12.66 },
    { circleY: 2.22, radius: 10, barY: 12.28 },
  ])('retains the gap between a rounded shape and a straight edge at $barY', ({ circleY, radius, barY }) => {
    const coverage = (x: number, y: number, scale: number) => {
      const overlap = (start: number, end: number) => Math.max(0, Math.min(y + 1, end) - Math.max(y, start));
      let circle = 0;
      for (let i = 0; i < 48; i += 1) {
        const dx = (x + (i + 0.5) / 48) / scale - 15.1;
        const halfHeight = Math.sqrt(Math.max(0, radius * radius - dx * dx));
        circle += overlap((circleY - halfHeight) * scale, (circleY + halfHeight) * scale);
      }
      const bar = x >= 4 * scale && x < 26 * scale ? overlap(barY * scale, 19 * scale) : 0;
      return circle / 48 + bar;
    };
    const source = makeImage(30, 23, (x, y) => [255, 255, 255, Math.round(255 * coverage(x, y, 1))]);
    const out = upscalePerkSdf(source, 120, 92);
    let squaredError = 0, count = 0;
    for (let y = 48; y < 52; y += 1) {
      for (let x = 42; x < 79; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        squaredError += (alpha - coverage(x, y, 4) * 255) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(squaredError / count)).toBeLessThan(12);
  });

  it.each(['rail', 'slot'] as const)('resolves both edges of a split subpixel %s with slanted ends', (kind) => {
    const coverage = (x: number, y: number, scale: number) => {
      const left = Math.max(x, 11.65 * scale), right = Math.min(x + 1, 12.29 * scale);
      if (right <= left) return 0;
      const offset = (left + right) / (2 * scale) - 12;
      const top = (6.35 + 0.6 * offset) * scale, bottom = (17.72 - 0.45 * offset) * scale;
      return (right - left) * Math.max(0, Math.min(y + 1, bottom) - Math.max(y, top));
    };
    const source = makeImage(26, 24, (x, y) => {
      const inside = x >= 3 && x < 23 && y >= 3 && y < 21;
      const phase = coverage(x, y, 1);
      const alpha = kind === 'rail' ? Math.max(phase, Number(x >= 4 && x < 8 && inside)) : Number(inside) - phase;
      return [255, 255, 255, Math.round(alpha * 255)];
    });
    const out = upscalePerkSdf(source, 104, 96);
    let error = 0, count = 0;
    for (let y = 24; y < 72; y += 1) {
      for (let x = 43; x < 53; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        const phase = kind === 'rail' ? alpha : 255 - alpha;
        error += (phase - coverage(x, y, 4) * 255) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(error / count)).toBeLessThan(3);
  });

  it.each(['stroke', 'channel'] as const)('joins a slanted %s to a straight bar without a rounded shoulder', (kind) => {
    const coverage = (x: number, y: number, scale: number) => {
      let sum = 0;
      for (let sample = 0; sample < 64; sample += 1) {
        const along = (y + (sample + 0.5) / 64) / scale;
        if (along < 11.25 || along >= 24) continue;
        const offset = along - 13.5;
        const center = 14.12 + 0.37 * offset, half = 1.12 - 0.06 * offset;
        const left = along < 13.5625 ? 4 : center - half;
        const right = along < 13.5625 ? 27 : center + half;
        sum += Math.max(0, Math.min(x + 1, right * scale) - Math.max(x, left * scale));
      }
      return sum / 64;
    };
    const source = makeImage(32, 32, (x, y) => {
      const inside = x >= 2 && x < 30 && y >= 3 && y < 29;
      const area = coverage(x, y, 1);
      return [255, 255, 255, Math.round(255 * (kind === 'stroke' ? area : Number(inside) - area))];
    });
    const out = upscalePerkSdf(source, 128, 128);
    let error = 0, count = 0;
    for (let y = 52; y < 60; y += 1) {
      for (let x = 48; x < 68; x += 1) {
        const alpha = out.data[(y * 128 + x) * 4 + 3]!;
        const phase = kind === 'stroke' ? alpha : 255 - alpha;
        error += (phase - 255 * coverage(x, y, 4)) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(error / count)).toBeLessThan(2.5);
  });

  it('recovers a long taper whose first samples fit inside one source texel', () => {
    const coverage = (x: number, y: number, scale: number) => {
      let sum = 0;
      for (let sample = 0; sample < 32; sample += 1) {
        const position = (y + (sample + 0.5) / 32) / scale;
        if (position < 5.48 || position >= 20) continue;
        const offset = position - 5.48;
        const center = 12.31 + 0.01 * offset, half = 0.11 * offset;
        sum += Math.max(0, Math.min(x + 1, (center + half) * scale) - Math.max(x, (center - half) * scale));
      }
      return sum / 32;
    };
    const source = makeImage(32, 32, (x, y) => {
      const inside = x > 4 && x < 8 && y > 6 && y < 24;
      return [255, 255, 255, Math.round(255 * Math.max(coverage(x, y, 1), Number(inside)))];
    });
    const out = upscalePerkSdf(source, 128, 128);
    let error = 0, count = 0;
    for (let y = 20; y < 48; y += 1) {
      for (let x = 46; x < 57; x += 1) {
        error += (out.data[(y * 128 + x) * 4 + 3]! - 255 * coverage(x, y, 4)) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(error / count)).toBeLessThan(2);
  });

  it.each([false, true])('reconstructs a curved subpixel band from neighboring sections (faint %s)', (faint) => {
    const coverage = (x: number, y: number, scale: number) => {
      let sum = 0;
      for (let sample = 0; sample < 32; sample += 1) {
        const position = (y + (sample + 0.5) / 32) / scale;
        if (position < (faint ? 7 : 5) || position >= 26) continue;
        const offset = position - 14.5;
        const center = faint ? 12.82 + 0.085 * offset + 0.005 * offset ** 2
          : 12.76 + 0.085 * offset + 0.01 * offset ** 2;
        const half = faint ? 0.10 + 0.012 * offset : 0.185 + 0.003 * offset ** 2;
        sum += Math.max(0, Math.min(x + 1, (center + half) * scale) - Math.max(x, (center - half) * scale));
      }
      return sum / 32;
    };
    const source = makeImage(32, 32, (x, y) => {
      const inside = x > 4 && x < 8 && y > 6 && y < 24;
      const alpha = Math.max(coverage(x, y, 1), Number(inside));
      return [255, 255, 255, Math.round(alpha * 255)];
    });
    const out = upscalePerkSdf(source, 128, 128);
    let error = 0, count = 0;
    for (let y = 40; y < (faint ? 82 : 74); y += 1) {
      for (let x = 46; x < 57; x += 1) {
        error += (out.data[(y * out.width + x) * 4 + 3]! - 255 * coverage(x, y, 4)) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(error / count)).toBeLessThan(faint ? 38 : 45);
  });

  it.each(['outer', 'inner'] as const)('keeps a subpixel right angle at an %s corner', (kind) => {
    const overlap = (i: number, min: number, max: number) => Math.max(0, Math.min(i + 1, max) - Math.max(i, min));
    const coverage = (x: number, y: number, scale: number) =>
      overlap(x, 8.25 * scale, 17.75 * scale) * overlap(y, 7.5 * scale, 15.25 * scale);
    const source = makeImage(26, 24, (x, y) => {
      const alpha = coverage(x, y, 1);
      const inside = x >= 3 && x < 23 && y >= 3 && y < 21;
      return [255, 255, 255, Math.round(255 * (kind === 'outer' ? alpha : Number(inside) - alpha))];
    });
    const out = upscalePerkSdf(source, 104, 96);
    for (let y = 27; y < 34; y += 1) {
      for (let x = 30; x < 38; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        const phase = kind === 'outer' ? alpha : 255 - alpha;
        expect(Math.abs(phase - coverage(x, y, 4) * 255), `${kind} at (${x}, ${y})`).toBeLessThan(6);
      }
    }
  });

  it.each([
    { kind: 'strokes', junction: 'crossing' }, { kind: 'channels', junction: 'crossing' },
    { kind: 'strokes', junction: 'T' }, { kind: 'channels', junction: 'T' },
  ])('keeps $kind from swelling at a $junction junction', ({ kind, junction }) => {
    const overlap = (i: number, a: number, b: number) => Math.max(0, Math.min(i + 1, b) - Math.max(i, a));
    const coverage = (x: number, y: number, scale: number) => {
      const vertical = overlap(x, 10.22 * scale, 11.28 * scale) * overlap(y, (junction === 'T' ? 10.25 : 5) * scale, 17 * scale);
      const horizontal = overlap(y, 9.39 * scale, 10.25 * scale) * overlap(x, 5 * scale, 18 * scale);
      return vertical + horizontal - (junction === 'crossing' ? vertical * horizontal : 0);
    };
    const source = makeImage(24, 24, (x, y) => {
      const cross = coverage(x, y, 1);
      const inside = x >= 3 && x < 21 && y >= 3 && y < 21;
      return [255, 255, 255, Math.round(255 * (kind === 'strokes' ? cross : Number(inside) - cross))];
    });
    const out = upscalePerkSdf(source, 96, 96);
    for (let y = 32; y < 44; y += 1) {
      for (let x = 36; x < 48; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        const phase = kind === 'strokes' ? alpha : 255 - alpha;
        expect(Math.abs(phase - 255 * coverage(x, y, 4)), `${kind} at (${x}, ${y})`).toBeLessThan(6);
      }
    }
  });

  it.each([
    { slope: 0, bend: 0 }, { slope: 0.14, bend: 0 }, { slope: 0.4, bend: 0 },
    { slope: 0.94, bend: 0 }, { slope: -1.07, bend: 0 }, { slope: 0.11, bend: 0.05 },
  ])('reconstructs local edge coverage at slope $slope and bend $bend', ({ slope, bend }) => {
    const offset = slope < 0 ? 53.15 : 19.15;
    const position = (y: number) => offset + slope * y + bend * (y - 30) ** 2;
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let row = 0; row < 32; row += 1) {
        const edge = position((y + (row + 0.5) / 32) / scale) * scale;
        area += Math.max(0, Math.min(1, edge - x));
      }
      return area * 255 / 32;
    };
    const source = makeImage(64, 64, (x, y) => [255, 255, 255, Math.round(coverage(x, y, 1))]);
    const out = upscalePerkSdf(source, 256, 256);
    let squaredError = 0, samples = 0;
    const start = bend ? 104 : 32, end = bend ? 132 : Math.abs(slope) > 0.7 ? 160 : 224;
    for (let y = start; y < end; y += 1) {
      const center = Math.floor(position(y / 4) * 4);
      for (let x = center - 3; x <= center + 3; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        squaredError += (alpha - coverage(x, y, 4)) ** 2;
        samples += 1;
      }
    }
    expect(Math.sqrt(squaredError / samples)).toBeLessThan(4);
  });

  it.each(['outline', 'cutout'] as const)('fits both rectangles of an axis-aligned frame %s', (kind) => {
    const coverage = (x: number, y: number, scale: number) => {
      const overlap = (pixel: number, lo: number, hi: number) =>
        Math.max(0, Math.min(pixel + 1, hi * scale) - Math.max(pixel, lo * scale));
      return overlap(x, 10.28, 22.54) * overlap(y, 9.67, 21.15)
        - overlap(x, 11.53, 21.18) * overlap(y, 10.82, 19.84);
    };
    const source = makeImage(32, 32, (x, y) => {
      if (x < 4 || x >= 28 || y < 4 || y >= 28) return TRANSPARENT_BLACK;
      const alpha = coverage(x, y, 1);
      return [255, 255, 255, Math.round((kind === 'outline' ? alpha : 1 - alpha) * 255)];
    });
    const out = upscalePerkSdf(source, 128, 128);
    for (let y = 36; y < 88; y += 1) {
      for (let x = 38; x < 94; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        const phase = kind === 'outline' ? alpha : 255 - alpha;
        expect(Math.abs(phase - coverage(x, y, 4) * 255)).toBeLessThan(5);
      }
    }
  });

  it('recovers a coherent edge when a few sections spread the same coverage across two texels', () => {
    const source = makeImage(32, 32, (x, y) => {
      if (x < 5 || x > 17 || y < 4 || y >= 28) return TRANSPARENT_BLACK;
      const noisy = y % 3 === 0;
      const alpha = x < 16 ? 255 : x === 16 ? (noisy ? 222 : 255) : (noisy ? 122 : 89);
      return [255, 255, 255, alpha];
    });
    const out = upscalePerkSdf(source, 128, 128);
    for (let y = 48; y < 52; y += 1) {
      const alpha = (x: number) => out.data[(y * out.width + x) * 4 + 3]!;
      expect(alpha(67)).toBe(255);
      expect(alpha(68)).toBe(255);
      expect(alpha(69)).toBeGreaterThan(90);
      expect(alpha(70)).toBe(0);
    }
  });

  it.each([
    { kind: 'stroke' },
    { kind: 'cutout' },
  ])('fits a short exposed edge along a $kind junction', ({ kind }) => {
    const coverage = (x: number, y: number, scale: number) => {
      let mass = 0;
      for (let i = 0; i < 32; i += 1) {
        const along = (y + (i + 0.5) / 32) / scale;
        const edge = along < 13 ? 22 : along < 16 ? 17.63 + 0.36 * (along - 14.5) : 21;
        mass += Math.max(0, Math.min(1, edge * scale - x));
      }
      return mass * 255 / 32;
    };
    const source = makeImage(32, 32, (x, y) => {
      if (x < 3 || x >= 29 || y < 3 || y >= 29) return TRANSPARENT_BLACK;
      const alpha = coverage(x, y, 1);
      return [255, 255, 255, Math.round(kind === 'stroke' ? alpha : 255 - alpha)];
    });
    const out = upscalePerkSdf(source, 128, 128);
    for (let y = 56; y < 60; y += 1) {
      for (let x = 67; x < 74; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        expect(Math.abs((kind === 'stroke' ? alpha : 255 - alpha) - coverage(x, y, 4))).toBeLessThan(5);
      }
    }
  });

  it.each([
    { kind: 'stroke', intercept: 5.37, halfWidth: 0.495, slope: 0.37, bend: 0, taper: 0, rmsLimit: 8 },
    { kind: 'gap', intercept: 5.37, halfWidth: 0.495, slope: 0.37, bend: 0, taper: 0, rmsLimit: 8 },
    { kind: 'diagonal stroke', intercept: 0.37, halfWidth: 0.495, slope: 1, bend: 0, taper: 0, rmsLimit: 7 },
    { kind: 'diagonal gap', intercept: 0.37, halfWidth: 0.495, slope: 1, bend: 0, taper: 0, rmsLimit: 7 },
    { kind: 'curved stroke', intercept: 11.05, halfWidth: 0.52, slope: 0.27, bend: 0.03, taper: 0.017, rmsLimit: 13 },
    { kind: 'curved gap', intercept: 11.05, halfWidth: 0.52, slope: 0.27, bend: 0.03, taper: 0.017, rmsLimit: 13 },
    { kind: 'texel-boundary tapered stroke', intercept: 12, halfWidth: 0.37, slope: 0, bend: 0, taper: 0.014, rmsLimit: 2 },
    { kind: 'texel-boundary tapered gap', intercept: 12, halfWidth: 0.37, slope: 0, bend: 0, taper: 0.014, rmsLimit: 2 },
    { kind: 'variable-width stroke', intercept: 10.24, halfWidth: 0.54, slope: 0.21, bend: 0, taper: 0, rmsLimit: 4 },
    { kind: 'variable-width gap', intercept: 10.24, halfWidth: 0.54, slope: 0.21, bend: 0, taper: 0, rmsLimit: 4 },
  ])('fits both edges of a narrow $kind', ({ kind, intercept, halfWidth, slope, bend, taper, rmsLimit }) => {
    const gap = kind.endsWith('gap');
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let i = 0; i < 32; i += 1) {
        const u = (x + (i + 0.5) / 32) / scale;
        const center = (intercept + slope * u + bend * (u - 16) ** 2) * scale;
        const variation = kind.startsWith('variable') ? 0.13 * Math.sin((u - 16) * 0.69) : 0;
        const half = (halfWidth + taper * (u - 16) + variation) * scale;
        area += Math.max(0, Math.min(y + 1, center + half) - Math.max(y, center - half));
      }
      return area / 32;
    };
    const source = makeImage(32, 32, (x, y) => {
      const inside = x > 0 && x < 31 && y > 0 && y < 31;
      const alpha = inside ? (gap ? 1 - coverage(x, y, 1) : coverage(x, y, 1)) : 0;
      return [255, 255, 255, Math.round(alpha * 255)];
    });
    const out = upscalePerkSdf(source, 128, 128);
    let squaredError = 0;
    // Stay far enough inside the image for the full cross-section support
    // around the feature, including the shifted diagonal samples.
    for (let y = 20; y < 108; y += 1) {
      for (let x = 20; x < 108; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        const phase = gap ? 255 - alpha : alpha;
        squaredError += (phase - coverage(x, y, 4) * 255) ** 2;
      }
    }
    expect(Math.sqrt(squaredError / 88 ** 2)).toBeLessThan(rmsLimit);
  });

  it('fits the middle of a compact diagonal stroke from three matching slices', () => {
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let i = 0; i < 48; i += 1) {
        const along = (x + (i + 0.5) / 48) / scale;
        if (along < 9.1 || along > 13.8) continue;
        const center = (9.4 + along - 11) * scale;
        const halfWidth = 0.52 * scale;
        area += Math.max(0, Math.min(y + 1, center + halfWidth) - Math.max(y, center - halfWidth));
      }
      return area * 255 / 48;
    };
    const source = makeImage(26, 26, (x, y) => [255, 255, 255, Math.round(coverage(x, y, 1))]);
    const out = upscalePerkSdf(source, 104, 104);
    let error = 0, samples = 0;
    for (let x = 44; x < 48; x += 1) {
      for (let y = 25; y < 52; y += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        error += (alpha - coverage(x, y, 4)) ** 2;
        samples += 1;
      }
    }
    expect(Math.sqrt(error / samples)).toBeLessThan(4);
  });

  it.each([
    { kind: 'stroke', capped: false }, { kind: 'cutout', capped: false },
    { kind: 'stroke', capped: true }, { kind: 'cutout', capped: true },
  ])('fits the endpoint on a $kind (flat cap: $capped)', ({ kind, capped }) => {
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let i = 0; i < 48; i += 1) {
        const along = (x + (i + 0.5) / 48) / scale - 10.25;
        if (along < 0 || along > 6) continue;
        const base = capped ? 10.34 + 0.25 * along : 10.5;
        const lower = base * scale;
        const upper = (base + (capped ? 0.8 + 0.05 * along : 0.66 * along)) * scale;
        area += Math.max(0, Math.min(y + 1, upper) - Math.max(y, lower));
      }
      return area * 255 / 48;
    };
    const source = makeImage(26, 26, (x, y) => {
      const inside = x >= 3 && x < 23 && y >= 3 && y < 23;
      const alpha = coverage(x, y, 1);
      return [255, 255, 255, Math.round(kind === 'stroke' ? alpha : Number(inside) * 255 - alpha)];
    });
    const out = upscalePerkSdf(source, 104, 104);
    // Check the endpoint and the section joining it to the wider body.
    for (const start of [40, 44]) {
      let error = 0, samples = 0;
      for (let x = start; x < start + 4; x += 1) {
        for (let y = 36; y < 48; y += 1) {
          const alpha = out.data[(y * out.width + x) * 4 + 3]!;
          const phase = kind === 'stroke' ? alpha : 255 - alpha;
          error += (phase - coverage(x, y, 4)) ** 2;
          samples += 1;
        }
      }
      expect(Math.sqrt(error / samples)).toBeLessThan(6);
    }
  });

  it.each(['horizontal', 'vertical', 'inverted', 'staggered'] as const)(
    'uses both flanks to recover an overdrawn split (%s)', (kind) => {
      const horizontal = kind !== 'vertical';
      const inverted = kind === 'inverted';
      const source = makeImage(32, 32, (x, y) => {
        const [u, v] = horizontal ? [x, y] : [y, x];
        if (u < 4 || u >= 28 || v < 4 || v >= 28) return TRANSPARENT_BLACK;
        const middle = u >= 11 && u < 21;
        const outside = v < 16 ? 255 : v === 16 ? 213 : 0;
        const inside = v < 15 ? 0 : v === 15 ? 159 : v === 16 && kind !== 'staggered' ? 207 : 255;
        const alpha = middle ? inside : outside;
        return [255, 255, 255, inverted ? 255 - alpha : alpha];
      });
      const out = upscalePerkSdf(source, 128, 128);
      const phaseAt = (u: number, v: number) => {
        const [x, y] = horizontal ? [u, v] : [v, u];
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        return inverted ? 255 - alpha : alpha;
      };
      const flank = Array.from({ length: 8 }, (_, i) => phaseAt(32, 60 + i));
      const middle = Array.from({ length: 8 }, (_, i) => phaseAt(64, 60 + i));
      expect(flank.slice(0, 6).every(alpha => alpha >= 245)).toBe(true);
      expect(Math.abs(flank[7]! - 87)).toBeLessThanOrEqual(3);
      if (kind === 'staggered') {
        expect(middle[3]).toBeGreaterThan(245);
      } else {
        expect(middle.every((alpha, i) => Math.abs(alpha + flank[i]! - 255) <= 3)).toBe(true);
      }
    },
  );

  it.each(['stroke', 'cutout'] as const)('fits a short %s between nearby parallel details', (kind) => {
    const coverage = (x: number, y: number, scale: number) => {
      let area = 0;
      for (let i = 0; i < 48; i += 1) {
        const u = (x + (i + 0.5) / 48) / scale;
        const bands = [10.43, 14.57];
        if (u >= 11 && u < 14) bands.push(12.5 + 0.55 * (u - 12.5));
        for (const center of bands) {
          area += Math.max(0, Math.min(y + 1, (center + 0.39) * scale) - Math.max(y, (center - 0.39) * scale));
        }
      }
      return area * 255 / 48;
    };
    const source = makeImage(26, 26, (x, y) => {
      if (x < 3 || x >= 23 || y < 3 || y >= 23) return TRANSPARENT_BLACK;
      const alpha = coverage(x, y, 1);
      return [255, 255, 255, Math.round(kind === 'stroke' ? alpha : 255 - alpha)];
    });
    const out = upscalePerkSdf(source, 104, 104);
    let error = 0, samples = 0;
    for (let x = 48; x < 52; x += 1) {
      for (let y = 44; y < 56; y += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        const phase = kind === 'stroke' ? alpha : 255 - alpha;
        error += (phase - coverage(x, y, 4)) ** 2;
        samples += 1;
      }
    }
    expect(Math.sqrt(error / samples)).toBeLessThan(6);
  });

  it.each(['stripes', 'channels'] as const)('resolves unequal adjacent %s from shared pixel coverage', (kind) => {
    const coverage = (x: number, scale: number) => {
      const overlap = (lo: number, hi: number) => Math.max(0, Math.min(x + 1, hi * scale) - Math.max(x, lo * scale));
      return overlap(9.246, 10.439) + overlap(11.875, 13.439);
    };
    const source = makeImage(24, 24, (x, y) => {
      if (x < 4 || x >= 20 || y < 3 || y >= 21) return TRANSPARENT_BLACK;
      const alpha = coverage(x, 1);
      return [255, 255, 255, Math.round((kind === 'stripes' ? alpha : 1 - alpha) * 255)];
    });
    const out = upscalePerkSdf(source, 96, 96);
    for (let x = 34; x < 58; x += 1) {
      const alpha = out.data[(48 * out.width + x) * 4 + 3]!;
      expect(Math.abs((kind === 'stripes' ? alpha : 255 - alpha) - 255 * coverage(x, 4))).toBeLessThan(5);
    }
  });

  it.each(['strokes', 'channels'] as const)('keeps closely spaced parallel %s separate', (kind) => {
    const coverage = (y: number, scale: number) => {
      let area = 0;
      for (let band = 0; band < 4; band += 1) {
        const center = (9.43 + (band - 1.5) * 2.04) * scale;
        const halfWidth = 0.58 * scale;
        area += Math.max(0, Math.min(y + 1, center + halfWidth) - Math.max(y, center - halfWidth));
      }
      return area * 255;
    };
    const source = makeImage(32, 32, (x, y) => {
      const inside = x >= 2 && x < 30 && y >= 2 && y < 30;
      const amount = kind === 'strokes' ? coverage(y, 1) : 255 - coverage(y, 1);
      return [255, 255, 255, inside ? Math.round(amount) : 0];
    });
    const out = upscalePerkSdf(source, 128, 128);
    let error = 0, count = 0;
    for (let y = 12; y < 76; y += 1) {
      for (let x = 24; x < 104; x += 1) {
        const alpha = out.data[(y * out.width + x) * 4 + 3]!;
        const amount = kind === 'strokes' ? alpha : 255 - alpha;
        error += (amount - coverage(y, 4)) ** 2;
        count += 1;
      }
    }
    expect(Math.sqrt(error / count)).toBeLessThan(9);
  });

  it('keeps a narrow slanted opening between two fitted contours', () => {
    const source = makeImage(36, 36, (x, y) => {
      if (x < 3 || x > 32 || y < 3 || y > 32) return TRANSPARENT_BLACK;
      const distance = Math.abs(x - y - 0.15);
      const alpha = Math.round(255 * Math.max(0, Math.min(1, distance - 0.18)));
      return [255, 255, 255, alpha];
    });
    const out = upscalePerkSdf(source, 144, 144);
    const at = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3]!;
    for (let y = 28; y < 112; y += 1) {
      expect(at(y, y)).toBeLessThan(128);
      expect(at(y - 5, y)).toBeGreaterThan(200);
      expect(at(y + 6, y)).toBeGreaterThan(200);
    }
  });

  it('keeps the last well-supported sample of a taper from fading prematurely', () => {
    const taper = [[225, 185], [255, 95], [255, 25], [200, 0], [12, 0]];
    const source = makeImage(24, 24, (x, y) => {
      if (y >= 5 && y < 11 && x >= 11 && x < 15) return OPAQUE_WHITE;
      return [255, 255, 255, taper[y - 11]?.[x - 11] ?? 0];
    });
    const out = upscalePerkSdf(source, 96, 96);
    const alpha = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3]!;
    const center = (alpha(45, 57) + alpha(46, 57) + alpha(45, 58) + alpha(46, 58)) / 4;
    expect(center).toBeGreaterThan(184);
    expect(alpha(51, 58)).toBe(0);
  });

  it('keeps the clipped end of a subpixel stem opaque and continuous at 4×', () => {
    const source = makeImage(24, 24, (x, y) => {
      if (y >= 8 && y < 12 && x >= 3 && x < 21) return OPAQUE_WHITE;
      const alpha = y < 8 ? [143, 79][x - 10] ?? 0 : 0;
      return [255, 255, 255, alpha];
    });
    const out = upscalePerkSdf(source, 96, 96);
    const alpha = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3]!;
    for (let y = 0; y < 24; y += 1) {
      expect(alpha(42, y)).toBeGreaterThanOrEqual(240);
      expect(alpha(44, y)).toBeGreaterThanOrEqual(240);
      expect(alpha(40, y)).toBeLessThanOrEqual(15);
      expect(alpha(46, y)).toBeLessThanOrEqual(15);
    }
  });

  it('reconstructs the thin end of a diagonal taper with an opaque core and clear shoulders', () => {
    const sections = [[11, 14], [0, 90, 37], [0, 0, 154, 68], [0, 0, 9, 202, 110],
      [0, 0, 0, 27, 230, 153], [0, 0, 0, 0, 54, 247, 190], [0, 0, 0, 0, 0, 81, 255, 221]];
    const source = makeImage(24, 24, (x, y) => {
      const alpha = y >= 12 && y <= 17 && x >= 11 && x <= 16 ? 255 : sections[y - 5]?.[x - 5] ?? 0;
      return [255, 255, 255, alpha];
    });
    const out = upscalePerkSdf(source, 96, 96);
    const alpha = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3]!;
    for (let y = 29; y < 39; y += 1) {
      let core = 0, intermediate = 0;
      for (let x = 20; x < 47; x += 1) {
        if (alpha(x, y) >= 240) core += 1;
        if (alpha(x, y) >= 25 && alpha(x, y) <= 230) intermediate += 1;
      }
      expect(core).toBeGreaterThan(0);
      expect(intermediate).toBeLessThanOrEqual(4);
    }
    expect(alpha(25, 24)).toBeGreaterThan(70);
  });

  it('resolves a subpixel interruption as a clear gap between solid shapes', () => {
    const source = makeImage(24, 24, (x, y) => {
      if (x < 6 || x > 14 || y < 3 || y > 19) return TRANSPARENT_BLACK;
      const caps = y === 10 ? 143 : y === 11 ? 111 : 255;
      const shoulder = x === 6 || x === 14 ? 0.77 : 1;
      return [255, 255, 255, Math.round(caps * shoulder)];
    });
    const out = upscalePerkSdf(source, 96, 96);
    for (let x = 29; x <= 53; x += 1) {
      const alpha = (y: number) => out.data[(y * out.width + x) * 4 + 3]!;
      expect(alpha(40)).toBeGreaterThanOrEqual(240);
      expect(alpha(43)).toBeLessThanOrEqual(15);
      expect(alpha(44)).toBeLessThanOrEqual(15);
      expect(alpha(47)).toBeGreaterThanOrEqual(240);
    }
  });

  it.each([
    {
      glyph: 'triangle',
      contains: (x: number, y: number) => y > 10 && y < 25 && Math.abs(x - 15.6) < (y - 10) * 0.82,
      rmsLimit: 6.2,
      fringeLimit: 26,
    },
    {
      glyph: 'annulus',
      contains: (x: number, y: number) => Math.abs(Math.hypot(x - 16.2, y - 15.8) - 10.4) < 1.65,
      rmsLimit: 2.5,
      fringeLimit: 5,
    },
  ])('keeps a traced $glyph close to its source coverage with narrow antialiasing', ({ glyph, contains, rmsLimit, fringeLimit }) => {
    const coverage = (x: number, y: number, scale: number) => {
      let samples = 0;
      for (let j = 0; j < 12; j += 1) {
        for (let i = 0; i < 12; i += 1) {
          const px = (x + (i + 0.5) / 12) / scale;
          const py = (y + (j + 0.5) / 12) / scale;
          if (contains(px, py)) samples += 1;
        }
      }
      return Math.round(samples * 255 / 144);
    };
    const source = makeImage(32, 32, (x, y) => [255, 255, 255, coverage(x, y, 1)]);
    const out = upscalePerkSdf(source, 128, 128);
    let squaredError = 0, fringePixels = 0;
    for (let y = 0; y < out.height; y += 1) {
      for (let x = 0; x < out.width; x += 1) {
        const actual = out.data[(y * out.width + x) * 4 + 3]!;
        const expected = coverage(x, y, 4);
        squaredError += (actual - expected) ** 2;
        if ((expected === 0 && actual > 12) || (expected === 255 && actual < 243)) fringePixels += 1;
      }
    }
    expect(Math.sqrt(squaredError / (out.width * out.height))).toBeLessThan(rmsLimit);
    expect(fringePixels).toBeLessThan(fringeLimit);
    if (glyph === 'triangle') {
      // The acute triangle corner should stay solid through the last fully
      // covered source pixel, with no translucent pocket near the tip.
      let total = 0;
      for (let y = 96; y < 100; y += 1) {
        for (let x = 104; x < 108; x += 1) total += out.data[(y * out.width + x) * 4 + 3]!;
      }
      expect(total / 16).toBeGreaterThanOrEqual(252);
    }
  });

});

describe('upscale — perk-sdf on a noisy opaque monochrome JPEG', () => {
  it('suppresses flat-region ringing and reconstructs a crisp contour', () => {
    const n = 32;
    // Deterministic PRNG for reproducible JPEG-like mosquito noise.
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    // Dark charcoal background with a white glyph square, plus small ringing.
    const bg: Pixel = [40, 40, 40, 255];
    const source = makeImage(n, n, (x, y) => {
      const inside = x >= 10 && x <= 21 && y >= 10 && y <= 21;
      const base: Pixel = inside ? OPAQUE_WHITE : bg;
      const noise = Math.round((rnd() - 0.5) * 24);
      return [base[0] + noise, base[1] + noise, base[2] + noise, 255];
    });

    const out = upscalePerkSdf(source, 128, 128);

    // Opaque output.
    expect(out.data[3] ?? 0).toBe(255);

    // Background corners are clean and dark — no bright mosquito noise left.
    for (const [sx, sy] of [
      [2, 2],
      [29, 2],
      [2, 29],
      [29, 29],
    ] as const) {
      const p = (sy * 128 + sx) * 4;
      expect(out.data[p] ?? 0).toBeLessThanOrEqual(60);
      expect(out.data[p + 1] ?? 0).toBeLessThanOrEqual(60);
      expect(out.data[p + 2] ?? 0).toBeLessThanOrEqual(60);
    }

    // Glyph interior is clean and light. The glyph square spans source rows/cols
    // 10..21, so its centre lands at output (64, 64) at 4x.
    const centre = (64 * 128 + 64) * 4;
    expect(out.data[centre] ?? 0).toBeGreaterThanOrEqual(200);

    // Crisp contour: the blended transition across a horizontal scan through
    // the glyph centre spans only a few pixels.
    let blend = 0;
    for (let x = 0; x < 128; x += 1) {
      const v = out.data[(64 * 128 + x) * 4] ?? 0;
      if (v > 60 && v < 200) blend += 1;
    }
    expect(blend).toBeLessThanOrEqual(8);
  });

  it('discards weak JPEG specks and pinholes while keeping a solid one-pixel cutout', () => {
    const source = makeImage(24, 24, (x, y) => {
      if (x === 4 && y === 4) return [157, 157, 157, 255];
      if (x === 10 && y === 10) return [110, 110, 110, 255];
      if (x === 13 && y === 13) return OPAQUE_BLACK;
      return x >= 6 && x <= 17 && y >= 6 && y <= 17 ? OPAQUE_WHITE : OPAQUE_BLACK;
    });
    const out = upscalePerkSdf(source, 96, 96);
    const at = (x: number, y: number) => out.data[((y * 4 + 1) * 96 + x * 4 + 1) * 4];
    expect(at(4, 4)).toBe(0);
    expect(at(10, 10)).toBe(255);
    expect(at(13, 13)).toBe(0);
  });

  it('preserves a coherent low-contrast seam inside an otherwise flat opaque glyph', () => {
    const source = makeImage(24, 24, (x, y) => {
      if (x < 4 || x > 19 || y < 4 || y > 19) return OPAQUE_BLACK;
      if (y === 10 && x >= 6 && x <= 17) return [163, 163, 163, 255];
      return OPAQUE_WHITE;
    });
    const out = upscalePerkSdf(source, 96, 96);
    const red = (x: number, y: number) => out.data[((y * 4 + 1) * 96 + x * 4 + 1) * 4]!;
    expect(red(12, 10)).toBeGreaterThan(128);
    expect(red(12, 10)).toBeLessThan(205);
    expect(red(12, 8)).toBe(255);
    expect(red(12, 12)).toBe(255);
  });

  it('keeps a narrow gray diagonal seam visible against both bright flanks', () => {
    const source = makeImage(32, 32, (x, y) => {
      if (x < 4 || x > 27 || y < 4 || y > 27) return OPAQUE_BLACK;
      return x === y ? [164, 164, 164, 255] : OPAQUE_WHITE;
    });
    const out = upscalePerkSdf(source, 160, 160);
    for (let p = 10; p < 22; p += 1) {
      const y = p * 5 + 2;
      expect(out.data[(y * out.width + y) * 4]).toBeLessThan(205);
      expect(out.data[(y * out.width + y + 10) * 4]).toBe(255);
    }
  });

  it('keeps both 45° gray seams continuous between the source samples', () => {
    for (const sign of [-1, 1]) {
      const source = makeImage(32, 32, (x, y) => {
        if (x < 4 || x > 27 || y < 4 || y > 27) return [0, 0, 0, 255];
        const offset = sign === 1 ? x - y : x + y - 31;
        return offset === 0 ? [80, 80, 80, 255] : OPAQUE_WHITE;
      });
      const out = upscalePerkSdf(source, 128, 128);
      const seam = Array.from({ length: 48 }, (_, index) => {
        const y = 40 + index;
        const x = sign === 1 ? y : 127 - y;
        return out.data[(y * out.width + x) * 4]!;
      });
      expect(Math.max(...seam)).toBeLessThan(110);
      expect(Math.max(...seam) - Math.min(...seam)).toBeLessThan(16);
    }
  });
});

describe('upscale — perk-sdf on a flat 2-colour gold+white .jpg-like trait', () => {
  // Real .jpg Traits like Headseeker are a white vector glyph on a flat gold
  // (#c8aa38) background. The old saturation-based bypass wrongly treated them
  // as photographic art and fell back to blurry Mitchell.
  const GOLD: Pixel = [200, 170, 56, 255];

  it('reconstructs a razor-sharp contour instead of bypassing to Mitchell', () => {
    // A flat gold background with a white circle glyph (hard, un-anti-aliased).
    const source = makeImage(16, 16, (x, y) => {
      const dx = x - 7.5;
      const dy = y - 7.5;
      return dx * dx + dy * dy <= 25 ? OPAQUE_WHITE : GOLD;
    });

    const sdf = upscalePerkSdf(source, 64, 64);
    const mit = upscaleMitchell(source, 64, 64);

    // Interior is cleanly white.
    const centre = (32 * 64 + 32) * 4;
    expect(sdf.data[centre] ?? 0).toBeGreaterThanOrEqual(245);
    expect(sdf.data[centre + 1] ?? 0).toBeGreaterThanOrEqual(245);
    expect(sdf.data[centre + 2] ?? 0).toBeGreaterThanOrEqual(245);

    // Background stays flat gold — no chroma drift or posterization.
    const corner = (2 * 64 + 2) * 4;
    expect(Math.abs((sdf.data[corner] ?? 0) - 200)).toBeLessThanOrEqual(12);
    expect(Math.abs((sdf.data[corner + 1] ?? 0) - 170)).toBeLessThanOrEqual(12);
    expect(Math.abs((sdf.data[corner + 2] ?? 0) - 56)).toBeLessThanOrEqual(12);

    // The SDF path engaged: it must NOT be byte-identical to Mitchell (the old
    // colour-bypass made them identical).
    let diff = 0;
    for (let i = 0; i < sdf.data.length; i += 4) {
      if (
        sdf.data[i] !== mit.data[i] ||
        sdf.data[i + 1] !== mit.data[i + 1] ||
        sdf.data[i + 2] !== mit.data[i + 2]
      ) {
        diff += 1;
      }
    }
    expect(diff).toBeGreaterThan(100);

    // Sharper than Mitchell: the contour transition spans fewer intermediate
    // (anti-aliased) pixels.
    const intermediates = (img: RgbaImage): number => {
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        const r = img.data[i] ?? 0;
        if (r >= 210 && r <= 250) n += 1;
      }
      return n;
    };
    expect(intermediates(sdf)).toBeLessThan(intermediates(mit));
  });
});

describe('upscale — perk-sdf keeps dark gaps separated (no white bridging)', () => {
  it('keeps two bright bars separated by a 1px dark channel dark at the centre', () => {
    // Two 3px-wide bright white bars (source cols 5..7 and 9..11) separated by a
    // single 1px dark channel (col 8) on an opaque black background. A too-wide
    // resampling kernel lifts the 1px gap above the 0.5 iso-level and bridges the
    // two bars together — it must stay cleanly separated and dark.
    const source = makeImage(16, 16, (x) =>
      x >= 5 && x <= 7 ? OPAQUE_WHITE : x >= 9 && x <= 11 ? OPAQUE_WHITE : OPAQUE_BLACK,
    );
    const out = upscalePerkSdf(source, 64, 64);

    // Source gap col 8 maps to output cols 32..35; the centre of the channel is
    // output col 33.5. Every pixel inside the channel must remain dark.
    let maxGap = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 32; x <= 35; x += 1) {
        const r = out.data[(y * 64 + x) * 4] ?? 0;
        if (r > maxGap) maxGap = r;
      }
    }
    // Never bridged: the dark channel centre stays well below the mid-grey that
    // would signal the two white bars have merged.
    expect(maxGap).toBeLessThan(96);

    // And the white bars themselves stay bright.
    const barInterior = (32 * 64 + 26) * 4; // source col 6.5 → output ~26
    expect(out.data[barInterior] ?? 0).toBeGreaterThanOrEqual(235);
  });

  it('connects the thin phase at exact diagonal saddles in opaque glyphs', () => {
    for (const [stroke, surround] of [[OPAQUE_WHITE, OPAQUE_BLACK], [OPAQUE_BLACK, OPAQUE_WHITE]]) {
      const source = makeImage(24, 24, (x, y) => x === y && x > 2 && x < 21 ? stroke! : surround!);
      const out = upscalePerkSdf(source, 96, 96);
      const wanted = stroke![0];
      for (let p = 16; p < 80; p += 1) {
        expect(Math.abs(out.data[(p * 96 + p) * 4]! - wanted)).toBeLessThan(48);
      }
    }

    // This diagonal is also a 1px-wide channel through two bright wedges.
    const channel = makeImage(24, 24, (x, y) =>
      x === y || x < 3 || y < 3 || x >= 21 || y >= 21 ? OPAQUE_BLACK : OPAQUE_WHITE,
    );
    const out = upscalePerkSdf(channel, 96, 96);
    for (let p = 16; p < 80; p += 1) {
      expect(out.data[(p * 96 + p) * 4]!).toBeLessThan(48);
    }
  });
});

describe('upscale — perk-sdf invert symmetry (white ⇄ black)', () => {
  it('reconstructs black-on-white as the exact inversion of white-on-black', () => {
    // Opaque white circle on black, and its photographic inverse (black circle on
    // white). Border-based palette orientation gives both inputs the same
    // coverage field and byte rounding follows the direction of the glyph.
    const circle = (x: number, y: number): Pixel => {
      const dx = x - 7.5;
      const dy = y - 7.5;
      return dx * dx + dy * dy <= 25 ? OPAQUE_WHITE : OPAQUE_BLACK;
    };
    const inverse = (x: number, y: number): Pixel => {
      const dx = x - 7.5;
      const dy = y - 7.5;
      return dx * dx + dy * dy <= 25 ? OPAQUE_BLACK : OPAQUE_WHITE;
    };

    const a = upscalePerkSdf(makeImage(16, 16, circle), 64, 64);
    const b = upscalePerkSdf(makeImage(16, 16, inverse), 64, 64);

    let maxDiff = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        // invert(sdf(img)) = 255 - a[i+c]; compare to sdf(invert(img)) = b[i+c].
        const d = Math.abs(255 - (a.data[i + c] ?? 0) - (b.data[i + c] ?? 0));
        if (d > maxDiff) maxDiff = d;
      }
    }
    expect(maxDiff).toBe(0);
  });

  it('keeps anti-aliased isoluminant color boundaries byte-exact under inversion', () => {
    const source = makeImage(24, 24, (x, y) => {
      const t = Math.min(1, Math.max(0, 6.5 - Math.hypot(x - 11.2, y - 12.6)));
      return [230 - 198 * t, 40 + 76 * t, 32 + 182 * t, 255];
    });
    const inverse = { ...source, data: source.data.map((v, i) => i % 4 === 3 ? v : 255 - v) };
    const a = upscalePerkSdf(source, 91, 103);
    const b = upscalePerkSdf(inverse, 91, 103);
    expect(a.data.every((v, i) => i % 4 === 3 || v + b.data[i]! === 255)).toBe(true);
    expect(a.data).not.toEqual(upscaleMitchell(source, 91, 103).data);
  });
});

describe('upscale — perk-sdf leaves no internal pinholes in solid strokes', () => {
  it('keeps a solid white bar free of dark interior holes', () => {
    // A 3px-wide solid white vertical bar (source cols 6..8) on black.
    // Its contour closes beyond the crop and fills uniformly to the border.
    const source = makeImage(16, 16, (x) => (x >= 6 && x <= 8 ? OPAQUE_WHITE : OPAQUE_BLACK));
    const out = upscalePerkSdf(source, 64, 64);

    // The bar interior maps to output cols ~24..35; its solid core (cols 27..31)
    // must be uniformly bright with no dark pinholes.
    let minInterior = 255;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 27; x <= 31; x += 1) {
        const r = out.data[(y * 64 + x) * 4] ?? 0;
        if (r < minInterior) minInterior = r;
      }
    }
    expect(minInterior).toBeGreaterThanOrEqual(235);
  });
});

describe('upscale — perk-sdf on genuinely multi-colour art', () => {
  it('keeps the full palette of an opaque multi-colour image', () => {
    const source = makeImage(16, 16, (x, y) => {
      if (x < 8 && y < 8) return [220, 40, 40, 255];
      if (x >= 8 && y < 8) return [40, 200, 60, 255];
      if (x < 8) return [40, 80, 220, 255];
      return [230, 210, 40, 255];
    });

    const sdf = upscalePerkSdf(source, 64, 64);
    const mit = upscaleMitchell(source, 64, 64);

    let maxDiff = 0;
    for (let i = 0; i < sdf.data.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        const d = Math.abs((sdf.data[i + c] ?? 0) - (mit.data[i + c] ?? 0));
        if (d > maxDiff) maxDiff = d;
      }
    }
    expect(maxDiff).toBeLessThanOrEqual(2);
  });

  it('keeps a low-contrast background gradient under an opaque white glyph', () => {
    const source = makeImage(48, 48, (x, y) => {
      if (Math.hypot(x - 24, y - 24) < 11) return OPAQUE_WHITE;
      const glow = Math.round(28 * Math.max(0, 1 - Math.hypot(x - 24, y - 24) / 21));
      return [48 + glow, 21 + glow, 8 + glow, 255];
    });
    expect(upscalePerkSdf(source, 96, 96)).toEqual(upscaleMitchell(source, 96, 96));
  });

  it('keeps coherent translucent detail below the 0.5 contour', () => {
    const source = makeImage(32, 32, (x, y) => {
      if (Math.hypot(x - 12, y - 16) < 6) return OPAQUE_WHITE;
      if (x >= 21 && x <= 28 && y >= 10 && y <= 21) return [250, 110, 72, 85];
      return TRANSPARENT_BLACK;
    });
    expect(upscalePerkSdf(source, 64, 64)).toEqual(upscaleMitchell(source, 64, 64));
  });

  it('keeps distressed texture without turning translucent fragments into solid dots', () => {
    const source = makeImage(32, 32, (x, y) => {
      if (x >= 2 && x <= 6 && y >= 5 && y <= 16) return OPAQUE_WHITE;
      if (x >= 12 && y >= 8 && x % 4 === 0 && y % 4 === 0) return [255, 255, 255, 200];
      return TRANSPARENT_BLACK;
    });
    const out = upscalePerkSdf(source, 96, 96);
    const at = (x: number, y: number) => out.data[((y * 3 + 1) * out.width + x * 3 + 1) * 4 + 3]!;
    expect(at(4, 10)).toBe(255);
    expect(at(16, 16)).toBe(200);
    expect(at(18, 16)).toBe(0);
  });

  it('keeps opposing partial coverages distinct in a densely sampled pattern', () => {
    const source = makeImage(24, 24, (x, y) => {
      if (y >= 3 && y <= 5 && x >= 4 && x <= 19) return OPAQUE_WHITE;
      if (x < 7 || x > 16 || y < 10 || y > 19) return TRANSPARENT_BLACK;
      return [255, 255, 255, (x + y) % 2 === 0 ? 185 : 70];
    });
    const out = upscalePerkSdf(source, 120, 120);
    const at = (x: number, y: number) => out.data[((y * 5 + 2) * out.width + x * 5 + 2) * 4 + 3]!;
    expect(at(12, 4)).toBe(255);
    expect(at(12, 14)).toBeGreaterThan(160);
    expect(at(12, 15)).toBeLessThan(95);
  });
});

describe('upscale — dispatcher', () => {
  it('keeps general-purpose algorithms independent of the perk vector module', () => {
    const source = makeImage(8, 8, (x) => (x < 4 ? OPAQUE_BLACK : OPAQUE_WHITE));
    expect(upscale(source, 16, 16, 'mitchell').width).toBe(16);
    expect(upscale(source, 16, 16, 'nearest').width).toBe(16);
    expect('upscalePerkSdf' in generalUpscaleModule).toBe(false);
    expect(upscalePerkSdf(source, 16, 16).width).toBe(16);
  });

  it('reports the smooth fallback for artwork without a traceable perk palette', () => {
    const source = makeImage(8, 8, () => OPAQUE_WHITE);
    expect(upscalePerkSdfWithStatus(source, 16, 16).method).toBe('smooth');
    expect(upscalePerkSdf(source, 16, 16).width).toBe(16);
  });
});

describe('upscale — mobile-safe Anime4K WebGL2', () => {
  it('accepts half-float targets and reads the clamped output from RGBA8', () => {
    const fake = createFakeWebgl();
    useFakeWebgl(fake);
    const source = makeImage(8, 8, () => OPAQUE_WHITE);

    const out = upscaleAnime4k(source, 16, 16);

    expect(out).not.toBeNull();
    expect(out?.width).toBe(16);
    expect(fake.readPixelsCalls).toHaveLength(1);
    expect(fake.readPixelsCalls[0]?.format).toBe(fake.gl.RGBA);
    expect(fake.readPixelsCalls[0]?.type).toBe(fake.gl.UNSIGNED_BYTE);
    expect(fake.readPixelsCalls[0]?.pixels).toBeInstanceOf(Uint8Array);
    expect(out?.data[0]).toBe(128);
  });

  it('retries engine initialization after an unsupported or transient context', () => {
    const unavailable = createFakeWebgl([]);
    const available = createFakeWebgl();
    useFakeWebgl(unavailable, available);
    const source = makeImage(8, 8, () => OPAQUE_WHITE);

    expect(upscaleAnime4k(source, 16, 16)).toBeNull();
    expect(upscaleAnime4k(source, 16, 16)).not.toBeNull();
  });

  it('falls back when the RGBA16F framebuffer is incomplete', () => {
    const incomplete = createFakeWebgl(['EXT_color_buffer_half_float'], 0x8cd6);
    useFakeWebgl(incomplete);
    const source = makeImage(8, 8, () => OPAQUE_WHITE);

    expect(upscaleAnime4k(source, 16, 16)).toBeNull();
  });

  it('rebuilds the engine after its WebGL context is lost', () => {
    const first = createFakeWebgl();
    const second = createFakeWebgl();
    useFakeWebgl(first, second);
    const source = makeImage(8, 8, () => OPAQUE_WHITE);

    expect(upscaleAnime4k(source, 16, 16)).not.toBeNull();
    expect(createdCanvas?.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))).toBe(
      false,
    );
    expect(upscaleAnime4k(source, 16, 16)).not.toBeNull();
    expect(second.readPixelsCalls).toHaveLength(1);
  });
});

describe('upscale — anime4k graceful null fallback', () => {
  it('returns null when WebGL2 is unavailable (Node/jsdom)', () => {
    useFakeWebgl();
    const source = makeImage(8, 8, () => OPAQUE_WHITE);
    expect(upscaleAnime4k(source, 16, 16)).toBeNull();
  });

  it('returns null for a no-op (target equals source)', () => {
    const source = makeImage(8, 8, () => OPAQUE_WHITE);
    expect(upscaleAnime4k(source, 8, 8)).toBeNull();
  });
});
