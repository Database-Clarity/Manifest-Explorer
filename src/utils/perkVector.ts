import { upscaleMitchell, type RgbaImage } from './upscale';

type Color = [number, number, number];
interface Point { x: number; y: number }
type Cubic = [Point, Point, Point, Point];

const ISO = 0.5;
const FIT_ERROR = 0.24;
const TRACE_ERROR = 0.3;
const VERTICAL_SAMPLES = 16;
const NARROW_BAND_OFFSETS = (width: number): readonly (readonly [number, number])[] => [
  [1, width],
  [width, 1],
  [width - 1, width + 1],
  [width + 1, width - 1],
];
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Persistent midtones carry shading even along a single palette axis. */
function hasSoftShading(coverage: Float64Array, width: number, height: number, limit: number): boolean {
  let shaded = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const t = coverage[p]!;
      if (t < 0.16 || t > 0.84) continue;
      if (Math.abs(coverage[p - width]! - t) < 0.12 && Math.abs(coverage[p + width]! - t) < 0.12
        && Math.abs(coverage[p - 1]! - t) < 0.12 && Math.abs(coverage[p + 1]! - t) < 0.12
        && ++shaded > limit) return true;
    }
  }
  return false;
}

/** Sparse translucent dots can account for many tiny contours without producing saddle cells. */
function hasIsolatedTranslucency(field: Float64Array, width: number, height: number): boolean {
  let isolated = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const alpha = field[p]!;
      if (alpha < 0.1 || alpha > 0.86) continue;
      let alone = true;
      for (let dy = -1; dy <= 1 && alone; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dx || dy) && field[p + dy * width + dx]! > 0.06) {
            alone = false;
            break;
          }
        }
      }
      if (alone && ++isolated > Math.max(8, field.length / 1024)) return true;
    }
  }
  return false;
}

function hasUniformForeground(data: Uint8ClampedArray): boolean {
  let reference = -1;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 224) continue;
    if (reference < 0) reference = i;
    if (Math.abs(data[i]! - data[reference]!) > 12 || Math.abs(data[i + 1]! - data[reference + 1]!) > 12
      || Math.abs(data[i + 2]! - data[reference + 2]!) > 12) return false;
  }
  return reference >= 0;
}

/** Find coherent color shifts in regions that the palette would make flat. */
function hasPaletteShading({ data, width, height }: RgbaImage, coverage: Float64Array, bg: Color, fg: Color) {
  const tile = 4;
  const minimumTiles = Math.max(2, width * height / (tile * tile) * 0.08);
  let shaded = 0;
  for (let y = 0; y + tile <= height; y += tile) {
    for (let x = 0; x + tile <= width; x += tile) {
      const high = coverage[y * width + x]! > ISO;
      const color = high ? fg : bg;
      let totalR = 0, totalG = 0, totalB = 0, flat = true;
      for (let j = 0; j < tile && flat; j += 1) {
        for (let i = 0; i < tile; i += 1) {
          const p = (y + j) * width + x + i;
          if (high ? coverage[p]! < 0.84 : coverage[p]! > 0.16) {
            flat = false;
            break;
          }
          totalR += data[p * 4]! - color[0];
          totalG += data[p * 4 + 1]! - color[1];
          totalB += data[p * 4 + 2]! - color[2];
        }
      }
      // A coherent shift of over six byte levels per channel exceeds typical
      // flat JPEG ringing. Averaging the signed offsets cancels local noise.
      if (flat && totalR ** 2 + totalG ** 2 + totalB ** 2 > 3 * (6 * tile * tile) ** 2
        && ++shaded > minimumTiles) return true;
    }
  }
  return false;
}

/** Locate the background even when the glyph is darker or has similar luminance. */
function fitPalette(source: RgbaImage) {
  const { data, width, height } = source;
  const border: [number[], number[], number[]] = [[], [], []];
  const size = width * height;
  for (let p = 0; p < size; p += 1) {
    const x = p % width;
    if (x !== 0 && x !== width - 1 && p >= width && p < size - width) continue;
    for (const c of [0, 1, 2] as const) border[c].push(data[p * 4 + c]!);
  }
  const bg = border.map((values) => {
    values.sort((a, b) => a - b);
    return (values[(values.length - 1) >> 1]! + values[values.length >> 1]!) / 2;
  }) as Color;

  // A distance histogram avoids a global luminance sort and works for sparse
  // and isoluminant glyphs. Use the far cluster, omitting its outermost outliers.
  const distances = new Uint32Array(size);
  const histogram = new Uint32Array(3 * 256);
  for (let p = 0; p < size; p += 1) {
    const i = p * 4;
    const d = Math.round(Math.abs(data[i]! - bg[0]) + Math.abs(data[i + 1]! - bg[1]) + Math.abs(data[i + 2]! - bg[2]));
    distances[p] = d;
    histogram[d]! += 1;
  }
  let far = histogram.length - 1;
  let seen = 0;
  for (; far > 0; far -= 1) {
    seen += histogram[far]!;
    if (seen >= Math.max(1, Math.ceil(size * 0.006))) break;
  }
  if (far < 18) return undefined;

  const fg: Color = [0, 0, 0];
  let count = 0;
  for (let p = 0; p < size; p += 1) {
    const distance = distances[p]!;
    if (distance < far * 0.94 || distance > far * 1.12) continue;
    for (const c of [0, 1, 2] as const) fg[c] += data[p * 4 + c]!;
    count += 1;
  }
  for (const c of [0, 1, 2] as const) fg[c] /= count;
  const dr = fg[0] - bg[0], dg = fg[1] - bg[1], db = fg[2] - bg[2];
  const lengthSq = dr * dr + dg * dg + db * db;
  if (lengthSq < 108) return undefined;

  const coverage = new Float64Array(size);
  let errorSq = 0;
  for (let p = 0; p < size; p += 1) {
    const i = p * 4;
    const r = data[i]! - bg[0], g = data[i + 1]! - bg[1], b = data[i + 2]! - bg[2];
    const t = clamp01((r * dr + g * dg + b * db) / lengthSq);
    coverage[p] = t;
    errorSq += (r - t * dr) ** 2 + (g - t * dg) ** 2 + (b - t * db) ** 2;
  }
  const rms = Math.sqrt(errorSq / (3 * size));
  if (rms > 12 || rms * rms > lengthSq * 0.013) return undefined;

  if (hasSoftShading(coverage, width, height, size * 0.035)
    || hasPaletteShading(source, coverage, bg, fg)) return undefined;

  // Only snap flat neighborhoods. In particular, leave the endpoints of the
  // actual interpolated 0.5 crossing unchanged.
  const clean = coverage.slice();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const t = coverage[p]!;
      if (t === 0 || t === 1 || (t > 0.12 && t < 0.88)) continue;
      const high = t >= ISO;
      let flat = true;
      for (let dy = Math.max(-1, -y); dy <= Math.min(1, height - 1 - y) && flat; dy += 1) {
        for (let dx = Math.max(-1, -x); dx <= Math.min(1, width - 1 - x); dx += 1) {
          const v = coverage[p + dy * width + dx]!;
          if (high ? v < 0.8 : v > 0.2) {
            flat = false;
            break;
          }
        }
      }
      if (flat) clean[p] = high ? 1 : 0;
    }
  }
  return { bg, fg, coverage: clean };
}

/** Preserve strongly sampled tiny details while rejecting weak isolated loops. */
function hasStrongSample(loop: Point[], field: Float64Array, stride: number, pad: number): boolean {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of loop) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  for (let y = Math.ceil(minY - 0.5); y + 0.5 < maxY; y += 1) {
    for (let x = Math.ceil(minX - 0.5); x + 0.5 < maxX; x += 1) {
      const sample = field[(y + pad) * stride + x + pad]!;
      if (Math.abs(sample - ISO) < 0.35) continue;
      let inside = false;
      for (let i = 0; i < loop.length; i += 1) {
        const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
        if ((a.y > y + 0.5) === (b.y > y + 0.5)) continue;
        const crossing = a.x + (y + 0.5 - a.y) * (b.x - a.x) / (b.y - a.y);
        if (x + 0.5 < crossing) inside = !inside;
      }
      if (inside) return true;
    }
  }
  return false;
}

/** Grid-edge IDs weld neighboring cells exactly, including saddle cells. */
function traceContours(coverage: Float64Array, width: number, height: number, opaque: boolean) {
  // Extend sampled edges beyond the crop so fitted corners at clipped
  // boundaries stay outside the image.
  const pad = 4;
  const stride = width + 2 * pad;
  const rows = height + 2 * pad;
  const field = new Float64Array(stride * rows);
  for (let y = 1; y < rows - 1; y += 1) {
    const sy = Math.max(0, Math.min(height - 1, y - pad));
    const sourceOffset = sy * width;
    const targetOffset = y * stride + pad;
    for (let x = 0; x < width; x += 1) {
      field[targetOffset + x] = coverage[sourceOffset + x]!;
    }
    field.fill(coverage[sy * width]!, y * stride + 1, y * stride + pad);
    field.fill(coverage[(sy + 1) * width - 1]!, y * stride + pad + width, (y + 1) * stride - 1);
  }

  const points: Point[] = [];
  const edges = new Int32Array(2 * field.length).fill(-1);
  // A contour vertex has degree two. Store its two neighbors directly rather
  // than allocating a small JS array for every crossing point.
  const adjacentFirst: number[] = [];
  const adjacentSecond: number[] = [];
  let ambiguousCells = 0;
  function crossing(p: number, step: number, x: number, y: number): number {
    const vertical = step === stride;
    const edge = 2 * p + Number(vertical);
    if (edges[edge]! >= 0) return edges[edge]!;
    const a = field[p]!;
    const t = (ISO - a) / (field[p + step]! - a);
    const index = points.length;
    points.push({ x: x + (vertical ? 0 : t), y: y + (vertical ? t : 0) });
    adjacentFirst.push(-1);
    adjacentSecond.push(-1);
    edges[edge] = index;
    return index;
  }
  function join(a: number, b: number) {
    if (adjacentFirst[a] === -1) adjacentFirst[a] = b;
    else adjacentSecond[a] = b;
    if (adjacentFirst[b] === -1) adjacentFirst[b] = a;
    else adjacentSecond[b] = a;
  }

  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < stride - 1; x += 1) {
      const p = y * stride + x;
      const tl = field[p]!, tr = field[p + 1]!;
      const bl = field[p + stride]!, br = field[p + stride + 1]!;
      const a = tl >= ISO, b = tr >= ISO, c = br >= ISO, d = bl >= ISO;
      if (a === b && b === c && c === d) continue;
      const px = x - pad + 0.5, py = y - pad + 0.5;
      const top = a !== b ? crossing(p, 1, px, py) : -1;
      const right = b !== c ? crossing(p + 1, stride, px + 1, py) : -1;
      const bottom = d !== c ? crossing(p + stride, 1, px, py + 1) : -1;
      const left = a !== d ? crossing(p, stride, px, py) : -1;
      if (a !== b && b !== c && c !== d && d !== a) {
        ambiguousCells += 1;
        // The bilinear saddle determines which diagonal is connected. Its
        // sign can differ from the average of the four corner samples.
        const saddle = (tl - ISO) * (br - ISO) - (tr - ISO) * (bl - ISO);
        // At exact equality, connect the locally thinner phase. This keeps
        // both binary diagonal strokes and diagonal channels continuous.
        const surrounding = (field[p - stride] ?? 0) + (field[p - stride + 1] ?? 0)
          + (field[p + 2 * stride] ?? 0) + (field[p + 2 * stride + 1] ?? 0)
          + (x > 0 ? field[p - 1]! + field[p + stride - 1]! : 0)
          + (x + 2 < stride ? field[p + 2]! + field[p + stride + 2]! : 0);
        let connectHigh = a ? saddle > 0 : saddle < 0;
        if (Math.abs(saddle) < 1e-12) {
          if (surrounding === 4 && x > 0 && x + 2 < stride && y > 0 && y + 2 < rows) {
            // Where a channel meets a silhouette boundary, look along both
            // diagonals for continuation through the four far corners.
            const diagonalSum = field[p - stride - 1]! + field[p - stride + 2]!
              + field[p + 2 * stride - 1]! + field[p + 2 * stride + 2]!;
            connectHigh = diagonalSum >= 2;
          } else {
            connectHigh = surrounding <= 4;
          }
        }
        if (connectHigh === a) {
          join(top, right);
          join(bottom, left);
        } else {
          join(top, left);
          join(right, bottom);
        }
      } else {
        const ends = [top, right, bottom, left].filter((id) => id >= 0);
        join(ends[0]!, ends[1]!);
      }
    }
  }

  const loops: Point[][] = [];
  let fineFragments = 0;
  const visited = new Uint8Array(points.length);
  for (let start = 0; start < points.length; start += 1) {
    if (visited[start]) continue;
    const loop: Point[] = [];
    let current = start;
    let previous = -1;
    do {
      visited[current] = 1;
      const point = points[current]!;
      const first = adjacentFirst[current]!;
      const next = first !== previous ? first : adjacentSecond[current]!;
      const nextPoint = points[next]!;
      if (point.x !== nextPoint.x || point.y !== nextPoint.y) loop.push(point);
      previous = current;
      current = next;
    } while (!visited[current]);

    let area = 0;
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
      area += a.x * b.y - a.y * b.x;
    }
    area = Math.abs(area) / 2;
    if (current !== start || loop.length < 3 || area <= (opaque ? 0.35 : 1e-8)) continue;
    // Keep track of dense subpixel detail that a single isoline cannot model.
    if (area < 2) fineFragments += 1;
    if (!opaque || area >= 1.05 || hasStrongSample(loop, field, stride, pad)) loops.push(loop);
  }
  return { loops, fineFragments, ambiguousCells };
}

function difference(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function unit({ x, y }: Point): Point {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function mix(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function offset(p: Point, direction: Point, length: number): Point {
  return { x: p.x + direction.x * length, y: p.y + direction.y * length };
}

function arcPoint(loop: Point[], index: number, step: number, distance: number): Point {
  let current = loop[index]!;
  for (let i = 1; i < loop.length; i += 1) {
    const next = loop[(index + step * i + loop.length) % loop.length]!;
    const length = Math.hypot(next.x - current.x, next.y - current.y);
    if (length >= distance) return mix(current, next, distance / length);
    distance -= length;
    current = next;
  }
  return current;
}

/** A localized turn remains strong as the chord window grows. */
function findCorners(loop: Point[], perimeter: number): number[] {
  if (perimeter < 7) return [];
  const scores = loop.map((p, i) => {
    const turn = (radius: number) => dot(
      unit(difference(p, arcPoint(loop, i, -1, radius))),
      unit(difference(arcPoint(loop, i, 1, radius), p)),
    );
    const near = turn(1.2);
    const far = turn(2.6);
    return far < 0.74 && near < 0.77 && near - far < 0.46 ? 2 - near - far : 0;
  });
  return scores.flatMap((score, i) => score > 0 && score > scores[(i + loop.length - 1) % loop.length]!
    && score >= scores[(i + 1) % loop.length]! ? [i] : []);
}

/** Keep the incoming and outgoing directions of a sampled sharp corner. */
function cornerDirections(loop: Point[], index: number, radius: number): [Point, Point] {
  const near = radius * 0.28;
  return [
    unit(difference(arcPoint(loop, index, -1, radius), arcPoint(loop, index, -1, near))),
    unit(difference(arcPoint(loop, index, 1, radius), arcPoint(loop, index, 1, near))),
  ];
}

function sharpenCorner(loop: Point[], index: number, radius: number): Point {
  const origin = loop[index]!;
  const [left, right] = cornerDirections(loop, index, radius);
  const a = arcPoint(loop, index, -1, radius * 0.28);
  const b = arcPoint(loop, index, 1, radius * 0.28);
  const offsetToRight = difference(b, a);
  const determinant = left.x * right.y - left.y * right.x;
  if (Math.abs(determinant) < 0.4) return origin;
  const t = (offsetToRight.x * right.y - offsetToRight.y * right.x) / determinant;
  const corner = offset(a, left, t);
  const delta = difference(corner, origin);
  return dot(delta, delta) <= 0.42 ** 2 ? corner : origin;
}

interface StraightLine {
  center: Point;
  direction: Point;
  end: number;
}

/** Fit the whole straight edge, leaving samples nearest its corner out of the fit. */
function fitStraightLine(loop: Point[], start: number, end: number, length: number): StraightLine | undefined {
  const inset = Math.min(1, length * 0.19);
  const count = Math.min(18, Math.ceil(length) + 2);
  const samples: Point[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < count; i += 1) {
    const sample = arcPoint(loop, start, 1, inset + (length - 2 * inset) * i / (count - 1));
    x += sample.x;
    y += sample.y;
    samples.push(sample);
  }
  const center = { x: x / count, y: y / count };
  let xx = 0, xy = 0, yy = 0;
  for (const sample of samples) {
    const delta = difference(sample, center);
    xx += delta.x ** 2;
    xy += delta.x * delta.y;
    yy += delta.y ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let direction = { x: Math.cos(angle), y: Math.sin(angle) };
  if (dot(direction, difference(loop[end]!, loop[start]!)) < 0) direction = { x: -direction.x, y: -direction.y };
  const normal = { x: -direction.y, y: direction.x };
  let squareError = 0, midError = 0, middle = 0;
  for (let i = 0; i < count; i += 1) {
    const residual = dot(normal, difference(samples[i]!, center));
    if (Math.abs(residual) > 0.29) return undefined;
    squareError += residual ** 2;
    if (i * 3 >= count && i * 3 < 2 * count) {
      midError += residual;
      middle += 1;
    }
  }
  if (squareError / count > 0.145 ** 2 || Math.abs(midError) / middle > 0.085) return undefined;
  if ([start, end].some((index) => Math.abs(dot(normal, difference(loop[index]!, center))) > 0.34)) return undefined;
  return { center, direction, end };
}

function intersectStraightLines(first: StraightLine, second: StraightLine): Point | undefined {
  const { direction: a } = first;
  const { direction: b } = second;
  const determinant = a.x * b.y - a.y * b.x;
  if (Math.abs(determinant) < 0.32) return undefined;
  const offsetToSecond = difference(second.center, first.center);
  const t = (offsetToSecond.x * b.y - offsetToSecond.y * b.x) / determinant;
  return offset(first.center, a, t);
}

/** Lock long near-linear spans at any angle when supported by a firm turn. */
function straightRuns(loop: Point[], lengths: number[], corners: number[]) {
  const entering = new Map<number, Point>();
  const leaving = new Map<number, Point>();
  const perimeter = lengths[loop.length]!;
  // Exact rules can begin immediately after a clipped corner or a chamfer.
  // Lock their endpoints even when the corners fall outside the straight span.
  for (const axis of ['x', 'y'] as const) {
    for (let start = 0; start < loop.length; start += 1) {
      const a = loop[start]!, previous = loop[(start + loop.length - 1) % loop.length]!;
      if (Math.abs(a[axis] - previous[axis]) < 0.025) continue;
      let end = start + 1;
      while (end < start + loop.length && Math.abs(loop[end % loop.length]![axis] - a[axis]) < 0.025) end += 1;
      end -= 1;
      const index = end % loop.length;
      const distance = lengths[index]! - lengths[start]! + (end >= loop.length ? perimeter : 0);
      if (distance < 6) continue;
      const tangent = unit(difference(loop[index]!, a));
      leaving.set(start, tangent);
      entering.set(index, tangent);
    }
  }
  for (let k = 0; k < corners.length; k += 1) {
    const start = corners[k]!, end = corners[(k + 1) % corners.length]!;
    const distance = lengths[end]! - lengths[start]! + (end <= start ? perimeter : 0);
    if (distance < 3.5 || distance > perimeter / 2) continue;
    const a = loop[start]!, b = loop[end]!;
    const tangent = unit(difference(b, a));
    const normal = { x: -tangent.y, y: tangent.x };
    let minDeviation = 0, maxDeviation = 0;
    for (let i = (start + 1) % loop.length; i !== end; i = (i + 1) % loop.length) {
      const deviation = dot(normal, difference(loop[i]!, a));
      minDeviation = Math.min(minDeviation, deviation);
      maxDeviation = Math.max(maxDeviation, deviation);
    }
    if (minDeviation < -0.16 || maxDeviation > 0.16) continue;
    // A small, consistently one-sided sagitta indicates curvature. A
    // reconstructed straight edge can have alternating sampling error.
    if ((minDeviation > -0.02 && maxDeviation > 0.06) || (maxDeviation < 0.02 && minDeviation < -0.06)) continue;
    if (!leaving.has(start)) leaving.set(start, tangent);
    if (!entering.has(end)) entering.set(end, tangent);
  }
  return { entering, leaving };
}


/** Fair only the normal displacement of smooth arcs, keeping corner positions. */
function fairLoop(loop: Point[], lengths: number[], locked: Set<number>): Point[] {
  const perimeter = lengths[loop.length]!;
  const anchors = [...locked].sort((a, b) => a - b);
  let next = 0;
  return loop.map((point, i) => {
    while (next < anchors.length && anchors[next]! < i) next += 1;
    let radius = 3;
    if (anchors.length) {
      const before = next > 0 ? lengths[anchors[next - 1]!]! : lengths[anchors[anchors.length - 1]!]! - perimeter;
      const after = next < anchors.length ? lengths[anchors[next]!]! : lengths[anchors[0]!]! + perimeter;
      radius = Math.min(radius, lengths[i]! - before, after - lengths[i]!);
    }
    if (radius < 1.2 || perimeter < 10) return point;

    // A quadratic Savitzky–Golay stencil on uniform arc-length samples
    // suppresses grid jitter without flattening the quadratic term of an arc.
    const coefficients = [-2, 3, 6, 7, 6, 3, -2];
    const sample = (step: number) => step === 0 ? point : arcPoint(loop, i, Math.sign(step), radius * Math.abs(step) / 3);
    const delta = { x: 0, y: 0 };
    for (let step = -3; step <= 3; step += 1) {
      const p = sample(step);
      const weight = coefficients[step + 3]! / 21;
      delta.x += (p.x - point.x) * weight;
      delta.y += (p.y - point.y) * weight;
    }
    const tangent = unit(difference(sample(3), sample(-3)));
    const normal = { x: -tangent.y, y: tangent.x };
    return offset(point, normal, Math.max(-0.13, Math.min(0.13, dot(delta, normal))));
  });
}

function evaluate(curve: Cubic, t: number): Point {
  const s = 1 - t;
  const a = s * s * s, b = 3 * t * s * s, c = 3 * t * t * s, d = t * t * t;
  return {
    x: a * curve[0].x + b * curve[1].x + c * curve[2].x + d * curve[3].x,
    y: a * curve[0].y + b * curve[1].y + c * curve[2].y + d * curve[3].y,
  };
}

function solveCubic(points: Point[], start: number, end: number, t: number[], left: Point, right: Point): Cubic {
  const first = points[start]!, last = points[end]!;
  let ll = 0, lr = 0, rr = 0, lp = 0, rp = 0;
  for (let i = 1; i < end - start; i += 1) {
    const u = t[i]!, s = 1 - u;
    const a = 3 * u * s * s, b = 3 * u * u * s;
    const residual = difference(points[start + i]!, mix(first, last, u * u * u + b));
    ll += a * a;
    lr += a * b * dot(left, right);
    rr += b * b;
    lp += a * dot(left, residual);
    rp += b * dot(right, residual);
  }
  const det = ll * rr - lr * lr;
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  let l = (lp * rr - rp * lr) / det, r = (ll * rp - lr * lp) / det;
  if (!(l > 0 && r > 0 && l < chord && r < chord)) l = r = chord / 3;
  return [first, offset(first, left, l), offset(last, right, r), last];
}

function fitSpan(points: Point[], trace: Point[], start: number, end: number, left: Point, right: Point, spans: Cubic[]): void {
  const first = points[start]!, last = points[end]!;
  if (end - start === 1) {
    spans.push([first, mix(first, last, 1 / 3), mix(first, last, 2 / 3), last]);
    return;
  }

  const t = [0];
  for (let i = start + 1; i <= end; i += 1) {
    const a = points[i - 1]!, b = points[i]!;
    t.push(t[t.length - 1]! + Math.hypot(a.x - b.x, a.y - b.y));
  }
  const length = t[t.length - 1]!;
  for (let i = 1; i < t.length; i += 1) t[i]! /= length;

  let split = Math.floor((start + end) / 2);
  for (let pass = 0; pass < 4; pass += 1) {
    const curve = solveCubic(points, start, end, t, left, right);
    let error = 0;
    let fitsTrace = true;
    for (let i = 1; i <= end - start; i += 1) {
      if (i < end - start) {
        const point = evaluate(curve, t[i]!);
        const d = difference(point, points[start + i]!);
        const raw = difference(point, trace[start + i]!);
        const squared = dot(d, d);
        if (squared > error) {
          error = squared;
          split = start + i;
        }
        if (dot(raw, raw) > TRACE_ERROR ** 2) fitsTrace = false;
      }
      const midpoint = evaluate(curve, (t[i - 1]! + t[i]!) / 2);
      const d = difference(midpoint, mix(trace[start + i - 1]!, trace[start + i]!, 0.5));
      if (dot(d, d) > TRACE_ERROR ** 2) fitsTrace = false;
    }
    if (fitsTrace && error <= FIT_ERROR ** 2) {
      spans.push(curve);
      return;
    }

    // Newton reparameterization allows the fit to move samples along the
    // curve instead of fitting the pixel grid's uneven chord-length spacing.
    if (pass === 3 || error > 2.25) break;
    const [p0, p1, p2, p3] = curve;
    const v0 = difference(p1, p0), v1 = difference(p2, p1), v2 = difference(p3, p2);
    const refined = [0];
    for (let i = 1; i < t.length - 1; i += 1) {
      const u = t[i]!;
      const a = mix(v0, v1, u), b = mix(v1, v2, u);
      const velocity = offset({ x: 0, y: 0 }, mix(a, b, u), 3);
      const acceleration = offset({ x: 0, y: 0 }, difference(b, a), 6);
      const d = difference(evaluate(curve, u), points[start + i]!);
      const denominator = dot(velocity, velocity) + dot(d, acceleration);
      refined.push(denominator > 1e-9 ? u - dot(d, velocity) / denominator : u);
    }
    refined.push(1);
    if (refined.some((u, i) => i > 0 && u <= refined[i - 1]!)) break;
    for (let i = 1; i < t.length - 1; i += 1) t[i] = refined[i]!;
  }

  // Avoid repeatedly peeling off one vertex on long, poorly fitted spans.
  const margin = Math.max(1, Math.floor((end - start) / 8));
  split = Math.max(start + margin, Math.min(end - margin, split));
  const p = points[split]!;
  const before = arcPoint(points, split, -1, 2);
  const after = arcPoint(points, split, 1, 2);
  // Keep a common tangent, using the distant chord only within this arc.
  const tangent = unit(difference(
    end - split < 3 ? points[end]! : after,
    split - start < 3 ? points[start]! : before,
  ));
  if (dot(tangent, difference(points[split + 1]!, p)) <= 0
    || dot(tangent, difference(p, points[split - 1]!)) <= 0) {
    fitSpan(points, trace, start, split, left, unit(difference(points[split - 1]!, p)), spans);
    fitSpan(points, trace, split, end, unit(difference(points[split + 1]!, p)), right, spans);
  } else {
    fitSpan(points, trace, start, split, left, { x: -tangent.x, y: -tangent.y }, spans);
    fitSpan(points, trace, split, end, tangent, right, spans);
  }
}

function fitLoop(loop: Point[]): Cubic[] {
  const lengths = [0];
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
    lengths.push(lengths[i]! + Math.hypot(a.x - b.x, a.y - b.y));
  }
  const perimeter = lengths[loop.length]!;
  const corners = findCorners(loop, perimeter);
  const straights = straightRuns(loop, lengths, corners);
  const breaks = new Set([...corners, ...straights.entering.keys(), ...straights.leaving.keys()]);
  const faired = fairLoop(loop, lengths, breaks);
  const incoming = new Map<number, StraightLine>();
  const outgoing = new Map<number, StraightLine>();
  for (let i = 0; i < corners.length; i += 1) {
    const start = corners[i]!, end = corners[(i + 1) % corners.length]!;
    const length = lengths[end]! - lengths[start]! + (end <= start ? perimeter : 0);
    if (length < 4 || length > perimeter * 0.48) continue;
    const line = fitStraightLine(loop, start, end, length);
    if (line) {
      incoming.set(end, line);
      outgoing.set(start, line);
    }
  }
  if (breaks.size < 2) {
    // Nearly equal arc lengths give a closed smooth contour a stable seam.
    const origin = breaks.values().next().value ?? 0;
    for (let i = 0; i < 4; i += 1) {
      const distance = (lengths[origin]! + i * perimeter / 4) % perimeter;
      const next = lengths.findIndex((length) => length > distance);
      breaks.add(next - 1);
    }
  }

  for (let k = 0; k < corners.length; k += 1) {
    const index = corners[k]!, previous = corners[(k + corners.length - 1) % corners.length]!;
    const next = corners[(k + 1) % corners.length]!;
    const left = incoming.get(index), right = outgoing.get(index);
    if (left && right) {
      const intersection = intersectStraightLines(left, right);
      if (intersection) {
        const delta = difference(intersection, loop[index]!);
        if (dot(delta, delta) <= 0.47 ** 2) {
          faired[index] = intersection;
          continue;
        }
      }
    }
    const before = lengths[index]! - lengths[previous]! + (previous >= index ? perimeter : 0);
    const after = lengths[next]! - lengths[index]! + (next <= index ? perimeter : 0);
    const radius = Math.min(2.2, before * 0.6, after * 0.6);
    if (radius > 0.9 && !straights.entering.has(index) && !straights.leaving.has(index)) {
      faired[index] = sharpenCorner(loop, index, radius);
    }
  }
  const doubled = [...faired, ...faired];
  const trace = [...loop, ...loop];
  const anchors = [...breaks].sort((a, b) => a - b);
  const spans: Cubic[] = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const start = anchors[i]!, end = anchors[i + 1] ?? anchors[0]! + loop.length;
    const endIndex = end % loop.length;
    const length = lengths[endIndex]! - lengths[start]! + (end >= loop.length ? perimeter : 0);
    const radius = Math.min(2.5, perimeter / 8);
    const cornerRadius = Math.min(radius, length * 0.65);
    const fittedLine = outgoing.get(start);
    if (fittedLine?.end === endIndex) {
      const startPoint = faired[start]!, endPoint = faired[endIndex]!;
      const normal = { x: -fittedLine.direction.y, y: fittedLine.direction.x };
      if ([startPoint, endPoint].every((point) => Math.abs(dot(normal, difference(point, fittedLine.center))) < 0.1)) {
        spans.push([startPoint, mix(startPoint, endPoint, 1 / 3), mix(startPoint, endPoint, 2 / 3), endPoint]);
        continue;
      }
    }
    const left = straights.leaving.get(start) ?? straights.entering.get(start) ?? (corners.includes(start)
      ? unit(difference(arcPoint(faired, start, 1, cornerRadius), arcPoint(faired, start, 1, cornerRadius * 0.32)))
      : unit(difference(arcPoint(faired, start, 1, radius), arcPoint(faired, start, -1, radius))));
    const straightEnd = straights.entering.get(endIndex) ?? straights.leaving.get(endIndex);
    const right = straightEnd ? { x: -straightEnd.x, y: -straightEnd.y } : (corners.includes(endIndex)
      ? unit(difference(arcPoint(faired, endIndex, -1, cornerRadius), arcPoint(faired, endIndex, -1, cornerRadius * 0.32)))
      : unit(difference(arcPoint(faired, endIndex, -1, radius), arcPoint(faired, endIndex, 1, radius))));
    fitSpan(doubled, trace, start, end, left, right, spans);
  }
  return spans;
}

/** Fit repeated shapes in the same orientation, regardless of contour discovery order. */
function fitCanonicalLoop(loop: Point[]): Cubic[] {
  // Compare translated contours across all axis reflections and swaps.
  // Quantization is used only for ordering; the fitted coordinates stay intact.
  const ordered = (n: number) => Math.round(n * 1e8);
  const comparePoint = (a: Point, b: Point) => ordered(a.y) - ordered(b.y) || ordered(a.x) - ordered(b.x);
  let best: Point[] | undefined;
  let restore = (p: Point) => p;
  for (const swap of [false, true]) {
    for (const signX of [-1, 1]) {
      for (const signY of [-1, 1]) {
        const transformed = loop.map(({ x, y }) => ({
          x: (swap ? y : x) * signX,
          y: (swap ? x : y) * signY,
        }));
        let minX = Infinity;
        let origin = 0;
        for (let i = 0; i < transformed.length; i += 1) {
          const point = transformed[i]!;
          minX = Math.min(minX, point.x);
          if (comparePoint(point, transformed[origin]!) < 0) origin = i;
        }
        const minY = transformed[origin]!.y;
        const atOffset = (i: number) => transformed[(origin + i + transformed.length) % transformed.length]!;
        const direction = comparePoint(atOffset(1), atOffset(-1)) <= 0 ? 1 : -1;
        const candidate = transformed.map((_, i) => {
          const p = atOffset(i * direction);
          return { x: p.x - minX, y: p.y - minY };
        });
        const index = best ? candidate.findIndex((point, i) => comparePoint(point, best![i]!) !== 0) : -1;
        if (best && (index < 0 || comparePoint(candidate[index]!, best[index]!) >= 0)) continue;
        best = candidate;
        restore = ({ x, y }) => {
          const a = (x + minX) * signX, b = (y + minY) * signY;
          return swap ? { x: b, y: a } : { x: a, y: b };
        };
      }
    }
  }
  return fitLoop(best!).map(([a, b, c, d]) => [restore(a), restore(b), restore(c), restore(d)]);
}

function flatten(curve: Cubic, tolerance: number, output: Point[], depth = 0): void {
  const [a, b, c, d] = curve;
  const e1 = difference(b, mix(a, d, 1 / 3));
  const e2 = difference(c, mix(a, d, 2 / 3));
  if (depth >= 12 || Math.max(dot(e1, e1), dot(e2, e2)) <= tolerance * tolerance) {
    output.push(d);
    return;
  }
  const ab = mix(a, b, 0.5), bc = mix(b, c, 0.5), cd = mix(c, d, 0.5);
  const abc = mix(ab, bc, 0.5), bcd = mix(bc, cd, 0.5);
  const middle = mix(abc, bcd, 0.5);
  flatten([a, ab, abc, middle], tolerance, output, depth + 1);
  flatten([middle, bcd, cd, d], tolerance, output, depth + 1);
}

interface Segment {
  a: Point;
  b: Point;
  loop: number;
  index: number;
}

function intersects({ a, b }: Segment, { a: c, b: d }: Segment): boolean {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const within = (p: Point, q: Point, r: Point) => (r.x - p.x) * (r.x - q.x) <= 0 && (r.y - p.y) * (r.y - q.y) <= 0;
  const s = side(a, b, c), t = side(a, b, d), u = side(c, d, a), v = side(c, d, b);
  return (s * t < 0 && u * v < 0)
    || (s === 0 && within(a, b, c)) || (t === 0 && within(a, b, d))
    || (u === 0 && within(c, d, a)) || (v === 0 && within(c, d, b));
}

/** A spatial grid detects intersecting fitted spans, including across loops. */
function preserveTopology(loops: Point[][], tolerance: number): Point[][] {
  const fitted = loops.map((loop) => {
    const spans = fitCanonicalLoop(loop);
    const points = [spans[0]![0]];
    for (const span of spans) flatten(span, tolerance, points);
    return points;
  });
  const raw = loops.map((loop) => [...loop, loop[0]!]);
  const reverted = new Set<number>();
  for (;;) {
    const grid = new Map<string, Segment[]>();
    const collisions = new Set<number>();
    for (let i = 0; i < loops.length; i += 1) {
      const points = reverted.has(i) ? raw[i]! : fitted[i]!;
      for (let j = 1; j < points.length; j += 1) {
        const a = points[j - 1]!, b = points[j]!;
        const segment = { a, b, loop: i, index: j };
        const minX = Math.floor(Math.min(a.x, b.x) / 2), maxX = Math.floor(Math.max(a.x, b.x) / 2);
        const minY = Math.floor(Math.min(a.y, b.y) / 2), maxY = Math.floor(Math.max(a.y, b.y) / 2);
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            const key = x + ',' + y;
            const neighbors = grid.get(key);
            if (!neighbors) {
              grid.set(key, [segment]);
              continue;
            }
            for (const other of neighbors) {
              if (other.loop === i && (other.index === j - 1 || (other.index === 1 && j === points.length - 1))) continue;
              if ((!reverted.has(i) || !reverted.has(other.loop)) && intersects(segment, other)) {
                if (!reverted.has(i)) collisions.add(i);
                if (!reverted.has(other.loop)) collisions.add(other.loop);
              }
            }
            neighbors.push(segment);
          }
        }
      }
    }
    if (collisions.size === 0) return fitted.map((path, i) => reverted.has(i) ? raw[i]! : path);
    for (const loop of collisions) reverted.add(loop);
  }
}

/** Even-odd scanlines with exact horizontal span coverage at each subrow. */
function rasterize(paths: Point[][], sx: number, sy: number, width: number, height: number): Float32Array {
  const rows: number[][] = Array.from({ length: height * VERTICAL_SAMPLES }, () => []);
  const coverage = new Float32Array(width * height);
  for (const points of paths) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!, b = points[i]!;
      const low = a.y < b.y ? a : b, high = a.y < b.y ? b : a;
      if (low.y === high.y) continue;
      const y0 = low.y * sy * VERTICAL_SAMPLES;
      const y1 = high.y * sy * VERTICAL_SAMPLES;
      const slope = (high.x - low.x) * sx / (y1 - y0);
      const end = Math.min(rows.length, Math.ceil(y1 - 0.5));
      for (let y = Math.max(0, Math.ceil(y0 - 0.5)); y < end; y += 1) {
        rows[y]!.push(low.x * sx + (y + 0.5 - y0) * slope);
      }
    }
  }
  const spans = new Int32Array(width + 1);
  for (let y = 0; y < height; y += 1) {
    const offset = y * width;
    for (let sub = 0; sub < VERTICAL_SAMPLES; sub += 1) {
      const row = rows[y * VERTICAL_SAMPLES + sub]!;
      row.sort((a, b) => a - b);
      for (let i = 1; i < row.length; i += 2) {
        const start = Math.max(0, row[i - 1]!), end = Math.min(width, row[i]!);
        if (end <= start) continue;
        const first = Math.floor(start), last = Math.ceil(end) - 1;
        if (first === last) {
          coverage[offset + first]! += (end - start) / VERTICAL_SAMPLES;
        } else {
          coverage[offset + first]! += (first + 1 - start) / VERTICAL_SAMPLES;
          coverage[offset + last]! += (end - last) / VERTICAL_SAMPLES;
          spans[first + 1]! += 1;
          spans[last]! -= 1;
        }
      }
    }
    let active = 0;
    for (let x = 0; x < width; x += 1) {
      active += spans[x]!;
      coverage[offset + x]! += active / VERTICAL_SAMPLES;
      spans[x] = 0;
    }
  }
  return coverage;
}

/** Interpolate antialiasing samples without overshooting the adjacent pair. */
function interpolateDetail(a: number, b: number, c: number, d: number, t: number): number {
  const slope = (c - a) * 0.5;
  const endSlope = (d - b) * 0.5;
  const delta = c - b;
  const value = b + t * (slope + t * (3 * delta - 2 * slope - endSlope + t * (slope + endSlope - 2 * delta)));
  return Math.max(Math.min(b, c), Math.min(Math.max(b, c), value));
}

function sampleFieldRow(
  field: Float64Array,
  width: number,
  row: number,
  xPrev: number,
  x0: number,
  x1: number,
  xNext: number,
  t: number,
): number {
  const start = row * width;
  return interpolateDetail(
    field[start + xPrev]!,
    field[start + x0]!,
    field[start + x1]!,
    field[start + xNext]!,
    t,
  );
}

/** Measure agreement along the two diagonals around each source sample. */
function diagonalCoherence(field: Float64Array, width: number, height: number): Float32Array {
  const directions = new Float32Array(field.length);
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      let down = 0, up = 0;
      for (let j = y - 1; j <= y; j += 1) {
        for (let i = x - 1; i <= x; i += 1) {
          const p = j * width + i;
          down += Math.abs(field[p]! - field[p + width + 1]!);
          up += Math.abs(field[p + width]! - field[p + 1]!);
        }
      }
      if (Math.max(down, up) < 0.5) continue;
      directions[y * width + x] = Math.sign(up - down) * clamp01((Math.abs(up - down) / (up + down) - 0.5) * 2);
    }
  }
  return directions;
}

/** Interpolate across diagonal lattice lines after following each line longitudinally. */
function sampleDiagonal(field: Float64Array, width: number, height: number, x: number, y: number, sign: number): number {
  const across = x - sign * y;
  const line = Math.floor(across);
  const along = (sign * x + y) / 2;
  const sample = (k: number): number => {
    const row = along - sign * k / 2;
    const lo = Math.floor(row);
    const fraction = row - lo;
    const row0 = Math.max(0, Math.min(height - 1, lo));
    const row1 = Math.max(0, Math.min(height - 1, lo + 1));
    const x0 = Math.max(0, Math.min(width - 1, k + sign * lo));
    const x1 = Math.max(0, Math.min(width - 1, k + sign * (lo + 1)));
    const a = field[row0 * width + x0]!;
    const b = field[row1 * width + x1]!;
    return a * (1 - fraction) + b * fraction;
  };
  return interpolateDetail(
    sample(line - 1),
    sample(line),
    sample(line + 1),
    sample(line + 2),
    across - line,
  );
}

/** Retain coherent fine structures that a single contour cannot express. */
function restoreDetail(
  field: Float64Array, sourceWidth: number, sourceHeight: number, paths: Point[][],
  mask: Float32Array, width: number, height: number, opaque: boolean, textured: boolean,
): { vector: Float32Array; detailed: Float32Array } | undefined {
  const sampled = rasterize(paths, 1, 1, sourceWidth, sourceHeight);
  const residual = Float32Array.from(field, (value, p) => value - sampled[p]!);
  const weights = new Float32Array(residual.length);
  const narrow = new Float32Array(residual.length);
  const featureWeights = new Float32Array(residual.length);
  const narrowBandOffsets = NARROW_BAND_OFFSETS(sourceWidth);
  const minimumError = textured ? 0.08 : 0.14;
  let hasDetail = false;
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const p = y * sourceWidth + x;
      const value = field[p]!;
      const error = residual[p]!;
      const fractional = value > 0.12 && value < 0.88;
      let localPeak = !opaque && value >= 0.16 && value < 0.98;
      let localValley = !opaque && value > 0.02 && value <= 0.84;
      if (!localPeak && !localValley && Math.abs(error) < 0.08) continue;
      let supported = false;
      let adjacentFineDetail = 0;
      let solidNeighbors = 0, emptyNeighbors = 0;
      const direction = Math.sign(error);
      for (let dy = Math.max(-1, -y); dy <= Math.min(1, sourceHeight - 1 - y); dy += 1) {
        for (let dx = Math.max(-1, -x); dx <= Math.min(1, sourceWidth - 1 - x); dx += 1) {
          if (!dx && !dy) continue;
          const q = p + dy * sourceWidth + dx;
          const neighbor = field[q]!;
          if (neighbor >= 0.88 || neighbor > value + 0.03) localPeak = false;
          if (neighbor <= 0.12 || neighbor < value - 0.03) localValley = false;
          if (residual[q]! * direction >= 0.095) supported = true;
          if (neighbor > 0.08 && neighbor < 0.92) adjacentFineDetail += 1;
          else if (neighbor >= 0.92) solidNeighbors += 1;
          else emptyNeighbors += 1;
        }
      }
      // A narrow band can be well represented in the samples even when its
      // coverage never crosses the tracing isoline. Check across and along it.
      let narrowBand = false;
      if (Math.abs(error) >= 0.08 && x > 0 && x < sourceWidth - 1 && y > 0 && y < sourceHeight - 1) {
        for (const [across, along] of narrowBandOffsets) {
          const left = (value - field[p - across]!) * direction;
          const right = (value - field[p + across]!) * direction;
          const paired = Math.min(Math.abs(value - field[p - along]!), Math.abs(value - field[p + along]!));
          if (Math.min(left, right) < 0.18 || paired > 0.18) continue;
          narrowBand = true;
          // Only override the sampled contour near a ridge or valley whose
          // contrast was reduced by the native-resolution round trip.
          narrow[p] = clamp01((Math.abs(error) - 0.08) / 0.25);
          break;
        }
      }
      // Packed but opaque contours can meet the texture heuristic near a
      // junction. Use the full sample only when the outline does not explain
      // the detail, or when the nearby values genuinely lack a solid phase.
      const sampledTexture = textured && fractional && adjacentFineDetail >= 3;
      const useSample = localPeak || localValley || sampledTexture;
      if (!useSample && !narrowBand && (!fractional || Math.abs(error) < minimumError || !supported)) continue;
      const textureWeight = solidNeighbors && emptyNeighbors
        ? clamp01((Math.abs(error) - 0.06) / 0.20) : 1;
      const weight = localPeak || localValley ? 1 : sampledTexture ? textureWeight
        : narrowBand ? clamp01(Math.abs(error) * 3) : clamp01((Math.abs(error) - 0.12) / 0.15);
      const feature = useSample || narrowBand;
      if (!fractional) continue;
      for (let dy = Math.max(-1, -y); dy <= Math.min(1, sourceHeight - 1 - y); dy += 1) {
        for (let dx = Math.max(-1, -x); dx <= Math.min(1, sourceWidth - 1 - x); dx += 1) {
          const q = p + dy * sourceWidth + dx;
          weights[q] = Math.max(weights[q]!, weight);
          if (feature) featureWeights[q] = Math.max(featureWeights[q]!, weight);
        }
      }
      hasDetail = true;
    }
  }
  if (!hasDetail) return;

  const sx = width / sourceWidth, sy = height / sourceHeight;
  const compareArea = !opaque && Number.isInteger(sx) && Number.isInteger(sy) && Math.min(sx, sy) >= 3;
  const vector = compareArea ? mask.slice() : undefined;
  const directions = diagonalCoherence(field, sourceWidth, sourceHeight);
  for (let y = 0; y < height; y += 1) {
    const py = Math.max(0, (y + 0.5) * sourceHeight / height - 0.5);
    const y0 = Math.floor(py), y1 = Math.min(y0 + 1, sourceHeight - 1);
    const fy = py - y0;
    for (let x = 0; x < width; x += 1) {
      const px = Math.max(0, (x + 0.5) * sourceWidth / width - 0.5);
      const x0 = Math.floor(px), x1 = Math.min(x0 + 1, sourceWidth - 1);
      const fx = px - x0;
      const a = y0 * sourceWidth + x0, b = y0 * sourceWidth + x1;
      const c = y1 * sourceWidth + x0, d = y1 * sourceWidth + x1;
      // Ease the transition between a traced stretch and a sampled detail.
      const wx = fx * fx * (3 - 2 * fx), wy = fy * fy * (3 - 2 * fy);
      const topWeight = weights[a]! * (1 - wx) + weights[b]! * wx;
      const bottomWeight = weights[c]! * (1 - wx) + weights[d]! * wx;
      const band = (narrow[a]! * (1 - wx) + narrow[b]! * wx) * (1 - wy)
        + (narrow[c]! * (1 - wx) + narrow[d]! * wx) * wy;
      const weight = Math.max(topWeight * (1 - wy) + bottomWeight * wy, band);
      if (!weight) continue;
      const p = y * width + x;
      const xPrev = Math.max(0, x0 - 1), xNext = Math.min(sourceWidth - 1, x1 + 1);
      // A densely sampled texture needs more weight at the pixel centre
      // to retain one-texel openings between adjoining partial coverages.
      const bias = Math.max(band, Number(textured));
      const tx = fx + (wx - fx) * bias, ty = fy + (wy - fy) * bias;
      const cubic = interpolateDetail(
        sampleFieldRow(field, sourceWidth, Math.max(0, y0 - 1), xPrev, x0, x1, xNext, tx),
        sampleFieldRow(field, sourceWidth, y0, xPrev, x0, x1, xNext, tx),
        sampleFieldRow(field, sourceWidth, y1, xPrev, x0, x1, xNext, tx),
        sampleFieldRow(field, sourceWidth, Math.min(sourceHeight - 1, y1 + 1), xPrev, x0, x1, xNext, tx),
        ty,
      );
      const top = field[a]! * (1 - fx) + field[b]! * fx;
      const bottom = field[c]! * (1 - fx) + field[d]! * fx;
      const linear = top * (1 - fy) + bottom * fy;
      const min = Math.min(field[a]!, field[b]!, field[c]!, field[d]!);
      const max = Math.max(field[a]!, field[b]!, field[c]!, field[d]!);
      const detail = Math.max(min, Math.min(max, cubic + 0.35 * (cubic - linear)));
      const direction = (directions[a]! * (1 - fx) + directions[b]! * fx) * (1 - fy)
        + (directions[c]! * (1 - fx) + directions[d]! * fx) * fy;
      // The directional model is for fine bands. Keeping it off neighboring
      // silhouettes avoids moving already well-fit edges.
      const confidence = clamp01((Math.abs(direction) - 0.35) / 0.65) * (opaque ? 1 : band);
      const directionalDetail = confidence > 0
        ? detail + confidence * (sampleDiagonal(field, sourceWidth, sourceHeight, px, py, Math.sign(direction)) - detail)
        : detail;
      // A locally uniform phase can still carry a translucent accent. Keep
      // fitted coverage from turning it into a new solid dot or pinhole.
      const traced = mask[p]!;
      let coverage = traced * (1 - weight) + directionalDetail * weight;
      if (!opaque && (traced === 0 || traced === 1) && (coverage >= ISO) === (traced >= ISO)) {
        const topFeature = featureWeights[a]! * (1 - wx) + featureWeights[b]! * wx;
        const bottomFeature = featureWeights[c]! * (1 - wx) + featureWeights[d]! * wx;
        const protection = topFeature * (1 - wy) + bottomFeature * wy;
        // Tighten the restored fringe without moving the half-coverage
        // boundary or changing the opacity of an identified fine feature.
        const contrast = 1 + 0.82 * (1 - protection);
        coverage = clamp01(ISO + (coverage - ISO) * contrast);
      }
      if (!opaque && !textured && min <= 0.2 && max >= 0.8 && coverage > 0.03 && coverage < 0.97) {
        const gx = (field[b]! - field[a]!) * (1 - fy) + (field[d]! - field[c]!) * fy;
        const gy = (field[c]! - field[a]!) * (1 - fx) + (field[d]! - field[b]!) * fx;
        const gradient = Math.hypot(gx, gy);
        if (gradient > 0.38) {
          // The level set stays at half coverage. Convert its local normal
          // displacement to the area of one destination pixel.
          const nx = Math.abs(gx / gradient) * sourceWidth / width;
          const ny = Math.abs(gy / gradient) * sourceHeight / height;
          const projected = edgeArea((coverage - ISO) / gradient, Math.max(nx, ny), Math.min(nx, ny));
          if (Math.abs(projected - ISO) > Math.abs(coverage - ISO)) {
            const strength = clamp01((gradient - 0.38) / 0.45) * weight * 0.7;
            coverage += (projected - coverage) * strength;
          }
        }
      }
      if (max < 0.46 && coverage >= ISO) {
        mask[p] = Math.min(coverage, ISO - 1 / 255);
      } else if (min > 0.54 && coverage < ISO) {
        mask[p] = Math.max(coverage, ISO + 1 / 255);
      } else {
        mask[p] = coverage;
      }
    }
  }
  return vector ? { vector, detailed: mask.slice() } : undefined;
}

/** Use only the amount of detail interpolation supported by the native pixel area. */
function limitDetailToSourceArea(
  field: Float64Array, sourceWidth: number, sourceHeight: number, vector: Float32Array, detailed: Float32Array,
  mask: Float32Array, width: number, sx: number, sy: number,
): void {
  const block = sx * sy;
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const value = field[y * sourceWidth + x]!;
      if (value > 0.1 && value < 0.9) continue;
      let tracedArea = 0, restoredArea = 0, sameOutline = true, furtherFitted = false;
      for (let j = y * sy; j < (y + 1) * sy; j += 1) {
        for (let i = x * sx; i < (x + 1) * sx; i += 1) {
          const p = j * width + i;
          tracedArea += vector[p]!;
          restoredArea += mask[p]!;
          if ((vector[p]! >= ISO) !== (mask[p]! >= ISO)) sameOutline = false;
          if (Math.abs(detailed[p]! - mask[p]!) > 0.006) furtherFitted = true;
        }
      }
      const change = restoredArea - tracedArea;
      if (furtherFitted || !sameOutline || Math.abs(change) < block * 0.015) continue;
      const target = value * block;
      const proportion = clamp01((target - tracedArea) / change);
      if (proportion >= 1) continue;
      for (let j = y * sy; j < (y + 1) * sy; j += 1) {
        for (let i = x * sx; i < (x + 1) * sx; i += 1) {
          const p = j * width + i;
          mask[p] = vector[p]! + (mask[p]! - vector[p]!) * proportion;
        }
      }
    }
  }
}

/** Match area in dense contours while keeping the fitted inside/outside boundary. */
function matchAreaNearContours(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  const pixels: number[] = [], budgets: number[] = [];
  for (let y = 1; y < sourceHeight - 1; y += 1) {
    for (let x = 1; x < sourceWidth - 1; x += 1) {
      const p = y * sourceWidth + x;
      const sample = field[p]!;
      if (sample < 0.065 || sample > 0.935) continue;
      let solid = false, empty = false;
      for (let j = -1; j <= 1; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
          const value = field[p + j * sourceWidth + i]!;
          solid ||= value >= 0.92;
          empty ||= value <= 0.08;
        }
      }
      if (!solid || !empty) continue;
      let total = 0;
      for (let j = y * sy; j < (y + 1) * sy; j += 1) {
        for (let i = x * sx; i < (x + 1) * sx; i += 1) total += mask[j * width + i]!;
      }
      const error = sample * sx * sy - total;
      if (Math.abs(error) < 0.022 * sx * sy) continue;
      const sign = Math.sign(error);
      pixels.length = 0;
      budgets.length = 0;
      let available = 0;
      for (let j = y * sy; j < (y + 1) * sy; j += 1) {
        for (let i = x * sx; i < (x + 1) * sx; i += 1) {
          const q = j * width + i;
          const alpha = mask[q]!;
          const inside = alpha >= ISO;
          const bound = sign > 0 ? inside ? 1 : 0.494 : inside ? 0.506 : 0;
          const budget = Math.min(0.32, sign * (bound - alpha));
          if (budget <= 0) continue;
          let nearEdge = false;
          for (let row = j - 1; row <= j + 1; row += 1) {
            for (let column = i - 1; column <= i + 1; column += 1) {
              if ((alpha === 0 || alpha === 1) && row !== j && column !== i) continue;
              nearEdge ||= (mask[row * width + column]! >= ISO) !== inside;
            }
          }
          if (!nearEdge) continue;
          pixels.push(q);
          budgets.push(budget);
          available += budget;
        }
      }
      if (!available) continue;
      const amount = sign * Math.min(1, Math.abs(error) / available);
      for (let i = 0; i < pixels.length; i += 1) mask[pixels[i]!]! += amount * budgets[i]!;
    }
  }
}


/** Remove directional fitting bias in locally matching parts of near-symmetric art. */
function preserveSymmetry(
  source: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array | Float64Array, width: number, height: number,
): void {
  const flipX = (p: number, w: number) => p + w - 1 - 2 * (p % w);
  const flipY = (p: number, w: number, h: number) => p + (h - 1 - 2 * Math.floor(p / w)) * w;
  const halfTurn = (p: number, w: number, h: number) => w * h - 1 - p;
  const quarterTurn = (p: number, w: number) => (p % w) * w + w - 1 - Math.floor(p / w);
  const matchingRegions = (transform: (p: number, w: number, h: number) => number) => {
    const weights = new Float32Array(source.length).fill(1);
    let error = 0, signal = 0;
    for (let p = 0; p < source.length; p += 1) {
      const a = source[p]!, b = source[transform(p, sourceWidth, sourceHeight)] ?? 0;
      const difference = Math.abs(a - b);
      error += difference * difference;
      signal += Math.max(a, b);
      if (difference <= 0.08) continue;
      // Local differences may be intentional. Leave the accent and its edge
      // intact while matching the remaining shared geometry.
      const strength = 1 - clamp01((difference - 0.08) / 0.12);
      const x = p % sourceWidth, y = Math.floor(p / sourceWidth);
      for (let j = Math.max(0, y - 1); j <= Math.min(sourceHeight - 1, y + 1); j += 1) {
        for (let i = Math.max(0, x - 1); i <= Math.min(sourceWidth - 1, x + 1); i += 1) {
          const q = j * sourceWidth + i;
          weights[q] = Math.min(weights[q]!, strength);
        }
      }
    }
    return signal > 0 && error <= signal * 0.0169 ? weights : undefined;
  };
  const weightAt = (target: number, weights: Float32Array) => {
    const x = Math.floor((target % width + 0.5) * sourceWidth / width);
    const y = Math.floor((Math.floor(target / width) + 0.5) * sourceHeight / height);
    return weights[y * sourceWidth + x]!;
  };
  const averagePairs = (transform: (p: number, w: number, h: number) => number) => {
    const weights = matchingRegions(transform);
    if (!weights) return false;
    for (let p = 0; p < mask.length; p += 1) {
      const q = transform(p, width, height);
      if (p >= q) continue;
      const weight = Math.min(weightAt(p, weights), weightAt(q, weights));
      const correction = (mask[p]! - mask[q]!) * weight * 0.5;
      mask[p]! -= correction;
      mask[q]! += correction;
    }
    return true;
  };

  const rotation = sourceWidth === sourceHeight && width === height ? matchingRegions(quarterTurn) : undefined;
  if (rotation) {
    for (let p = 0; p < mask.length; p += 1) {
      const q = quarterTurn(p, width), r = halfTurn(p, width, height), s = quarterTurn(r, width);
      if (p >= q || p >= r || p >= s) continue;
      const weight = Math.min(weightAt(p, rotation), weightAt(q, rotation), weightAt(r, rotation), weightAt(s, rotation));
      const average = (mask[p]! + mask[q]! + mask[r]! + mask[s]!) * 0.25;
      mask[p]! += (average - mask[p]!) * weight;
      mask[q]! += (average - mask[q]!) * weight;
      mask[r]! += (average - mask[r]!) * weight;
      mask[s]! += (average - mask[s]!) * weight;
    }
  } else {
    averagePairs(halfTurn);
  }
  const centeredX = averagePairs(flipX);
  const centeredY = averagePairs(flipY);
  if (centeredX && centeredY) return;

  // The coverage centroid proposes a second axis for artwork inset
  // asymmetrically in its frame. It must still pass the mirror-error test.
  let mass = 0, xMoment = 0, yMoment = 0;
  for (let p = 0; p < source.length; p += 1) {
    const value = source[p]!;
    mass += value;
    xMoment += (p % sourceWidth) * value;
    yMoment += Math.floor(p / sourceWidth) * value;
  }
  if (!mass) return;
  for (const axis of ['x', 'y'] as const) {
    const horizontal = axis === 'x';
    if (horizontal ? centeredX : centeredY) continue;
    const originalSize = horizontal ? sourceWidth : sourceHeight;
    const targetSize = horizontal ? width : height;
    const moment = horizontal ? xMoment : yMoment;
    const offset = Math.round(2 * moment / mass) - (originalSize - 1);
    const targetOffset = offset * targetSize / originalSize;
    if (!offset || Math.abs(offset) > 6 || !Number.isInteger(targetOffset)) continue;
    averagePairs((p, w, h) => {
      const size = horizontal ? w : h;
      const x = p % w, y = Math.floor(p / w);
      const coord = horizontal ? x : y;
      const mirrored = size - 1 + offset * size / originalSize - coord;
      if (mirrored < 0 || mirrored >= size) return -1;
      return horizontal ? y * w + mirrored : mirrored * w + x;
    });
  }
}

/** Area of a pixel below the projected edge, with a centered unit-mass square. */
function edgeArea(distance: number, major: number, minor: number): number {
  const tail = (major + minor) / 2 - Math.abs(distance);
  if (tail <= 0) return Number(distance >= 0);
  const fraction = tail < minor ? tail * tail / (2 * major * minor) : (tail - minor / 2) / major;
  return distance >= 0 ? 1 - fraction : fraction;
}

/** Protect the core of a narrow stroke or opening supported across and along it. */
function protectNarrowRuns(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (Math.min(sx, sy) < 2) return;
  const axes = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
  let lower: Float32Array | undefined;
  let upper: Float32Array | undefined;
  for (let y = 1; y < sourceHeight - 1; y += 1) {
    for (let x = 1; x < sourceWidth - 1; x += 1) {
      const p = y * sourceWidth + x;
      const dark = field[p]! < ISO;
      const phase = (index: number) => dark ? 1 - field[index]! : field[index]!;
      const center = phase(p);
      if (center < 0.73) continue;
      let best: { nx: number; ny: number; center: number; halfWidth: number; confidence: number; extent: number } | undefined;
      for (const [nx, ny] of axes) {
        const across = nx + ny * sourceWidth, along = ny - nx * sourceWidth;
        const left = phase(p - across), right = phase(p + across);
        const support = Math.min(phase(p - along), phase(p + along));
        if (Math.max(left, right) > 0.3 || support < 0.65) continue;
        const mass = left + center + right;
        const length = nx !== 0 && ny !== 0 ? Math.SQRT2 : 1;
        const confidence = Math.min(center, support) - Math.max(left, right);
        if (best && best.confidence >= confidence) continue;
        best = { nx: nx / length, ny: ny / length, center: (right - left) / (mass * length),
          halfWidth: mass / (2 * length), confidence, extent: length * 1.06 };
      }
      if (!best) continue;
      const { nx, ny, center: offset, halfWidth, confidence, extent } = best;
      const minX = Math.max(0, Math.floor((x - 1) * sx)), maxX = Math.min(width, Math.ceil((x + 2) * sx));
      const minY = Math.max(0, Math.floor((y - 1) * sy)), maxY = Math.min(height, Math.ceil((y + 2) * sy));
      const major = Math.max(Math.abs(nx) / sx, Math.abs(ny) / sy);
      const minor = Math.min(Math.abs(nx) / sx, Math.abs(ny) / sy);
      for (let j = minY; j < maxY; j += 1) {
        for (let i = minX; i < maxX; i += 1) {
          const dx = (i + 0.5) / sx - x - 0.5, dy = (j + 0.5) / sy - y - 0.5;
          const along = Math.abs(dy * nx - dx * ny);
          if (along >= extent) continue;
          const across = dx * nx + dy * ny - offset;
          const coverage = edgeArea(halfWidth - across, major, minor) - edgeArea(-halfWidth - across, major, minor);
          if (coverage < 0.72) continue;
          const target = j * width + i;
          const current = dark ? 1 - mask[target]! : mask[target]!;
          if (current >= coverage - 0.08) continue;
          const deficient = clamp01((0.86 - current) / 0.24);
          const weight = clamp01((1 - along / extent) * 2) * clamp01(confidence * 1.35) * deficient;
          if (weight <= 0) continue;
          const corrected = current + (coverage - current) * weight;
          if (dark) {
            upper ??= new Float32Array(mask.length).fill(1);
            upper[target] = Math.min(upper[target]!, 1 - corrected);
          } else {
            lower ??= new Float32Array(mask.length);
            lower[target] = Math.max(lower[target]!, corrected);
          }
        }
      }
    }
  }
  if (!lower && !upper) return;
  for (let i = 0; i < mask.length; i += 1) {
    const low = lower?.[i] ?? 0, high = upper?.[i] ?? 1;
    if (low <= high) mask[i] = Math.max(low, Math.min(high, mask[i]!));
  }
}

/** Tighten a two-phase edge while retaining as much native pixel area as it supports. */
function refineCoverage(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2 || Math.max(sx, sy) > 6) return;
  const correction = new Float32Array(field.length);
  const confidence = new Float32Array(field.length);
  const areaPreserved = new Uint8Array(field.length);
  let hasRefinement = false;
  for (let y = 1; y < sourceHeight - 1; y += 1) {
    for (let x = 1; x < sourceWidth - 1; x += 1) {
      const p = y * sourceWidth + x;
      const expected = field[p]!;
      if (expected < 0.06 || expected > 0.94) continue;
      const a = field[p - 1]!, b = field[p + 1]!, c = field[p - sourceWidth]!, d = field[p + sourceWidth]!;
      const low = Math.min(a, b, c, d), high = Math.max(a, b, c, d);
      const edge = Math.hypot(b - a, d - c);
      if (low > 0.16 || high < 0.84 || edge < 0.58) continue;
      const strength = clamp01((edge - 0.48) / 0.47);
      let area = 0, capacity = 0, originalArea = 0, originalCapacity = 0;
      for (let j = y * sy; j < (y + 1) * sy; j += 1) {
        for (let i = x * sx; i < (x + 1) * sx; i += 1) {
          const value = mask[j * width + i]!;
          const tighter = clamp01(ISO + (value - ISO) * (1 + 0.62 * strength));
          originalArea += value;
          originalCapacity += 4 * value * (1 - value);
          area += tighter;
          capacity += 4 * tighter * (1 - tighter);
        }
      }
      // A crisp edge that already integrates to the measured area needs no
      // further sharpening, even when neighboring texels need correction.
      if (Math.abs(originalArea - expected * sx * sy) <= sx * sy * 0.02
        && originalCapacity <= Math.max(sx, sy) * 1.2) {
        areaPreserved[p] = 1;
        continue;
      }
      if (capacity < 0.2) continue;
      confidence[p] = strength;
      const residual = (expected * sx * sy - area) / capacity;
      correction[p] = Math.max(-0.28, Math.min(0.28, residual)) * strength * 0.7;
      hasRefinement = true;
    }
  }
  if (!hasRefinement) return;
  for (let y = 0; y < height; y += 1) {
    const py = Math.max(0, (y + 0.5) / sy - 0.5), y0 = Math.floor(py);
    const y1 = Math.min(sourceHeight - 1, y0 + 1), fy = py - y0;
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const value = mask[p]!;
      if (value <= 0 || value >= 1) continue;
      if (areaPreserved[Math.floor(y / sy) * sourceWidth + Math.floor(x / sx)]) continue;
      const px = Math.max(0, (x + 0.5) / sx - 0.5), x0 = Math.floor(px);
      const x1 = Math.min(sourceWidth - 1, x0 + 1), fx = px - x0;
      const a = y0 * sourceWidth + x0, b = y0 * sourceWidth + x1;
      const c = y1 * sourceWidth + x0, d = y1 * sourceWidth + x1;
      const interpolate = (field: Float32Array) => (field[a]! * (1 - fx) + field[b]! * fx) * (1 - fy)
        + (field[c]! * (1 - fx) + field[d]! * fx) * fy;
      const strength = interpolate(confidence);
      if (!strength) continue;
      const tighter = clamp01(ISO + (value - ISO) * (1 + 0.62 * strength));
      const restored = tighter + 4 * tighter * (1 - tighter) * interpolate(correction);
      mask[p] = value >= ISO ? Math.min(1, Math.max(ISO, restored)) : Math.max(0, Math.min(ISO - 1 / 255, restored));
    }
  }
}

/** Fit a straight or smoothly bending edge from adjacent source cross-sections. */
function restoreFittedEdges(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2) return;
  const intercepts = new Float64Array(5);
  const directions = [[1, 0], [sourceWidth, 0], [sourceWidth, 1], [sourceWidth, -1]] as const;
  const layouts = [2, 1].flatMap(span => directions.map(([normal, shear]) => ({ span, normal, shear })));
  for (let y = 2; y < sourceHeight - 2; y += 1) {
    for (let x = 2; x < sourceWidth - 2; x += 1) {
      const p = y * sourceWidth + x;
      for (const { span, normal, shear } of layouts) {
        const short = span === 1;
        const first = field[p]!, second = field[p + normal]!;
        if ((first >= ISO) === (second >= ISO) || Math.abs(first - second) < 0.27) continue;
        if (short && Math.abs(first - second) > 0.97) continue;
        const tangent = normal === 1 ? sourceWidth : 1;
        const descending = first > second;
        const phase = (q: number) => descending ? field[q]! : 1 - field[q]!;
        // Follow steep diagonals by shifting each native cross-section one
        // texel across per step. Residual slope is measured in this frame.
        const reach = span + 2;
        if (shear && (y < reach || y + reach >= sourceHeight
          || (phase(p + tangent) - phase(p - tangent)) * shear < 0.52)) continue;
        const advance = tangent + shear * normal;
        const roomBeyond = normal === 1 ? x + 3 < sourceWidth : y + 3 + span * Math.abs(shear) < sourceHeight;
        let extendsBefore = false, extendsAfter = false;
        let sum = 0, moment = 0, curvatureMoment = 0, complete = true;
        for (let u = -span; u <= span; u += 1) {
          const q = p + u * advance;
          const high = phase(q - normal), low = phase(q + 2 * normal);
          if (short && (high < 0.985 || low > 0.015)) {
            complete = false;
            break;
          }
          const before = high < 0.97 ? phase(q - 2 * normal) : 1;
          const after = low > 0.03 ? (roomBeyond ? phase(q + 3 * normal) : low) : 0;
          if (before < 0.97 || after > 0.03) {
            complete = false;
            break;
          }
          extendsBefore ||= high < 0.97;
          extendsAfter ||= low > 0.03;
          const intercept = high + phase(q) + phase(q + normal) + low - 1.5 + (before - 1) + after;
          intercepts[u + 2] = intercept;
          sum += intercept;
          moment += u * intercept;
          curvatureMoment += (u * u - 2) * intercept;
        }
        if (!complete) continue;
        const mean = sum / (2 * span + 1), residualSlope = moment / (short ? 2 : 10);
        const tolerance = short ? 0.014 : 0.025;
        const straight = intercepts.every((value, i) => Math.abs(i - 2) > span || Math.abs(value - mean - (i - 2) * residualSlope) <= tolerance);
        // Near a junction the edge may resolve in only three sections. Three
        // samples must support a line independently, since they cannot reject
        // a quadratic fit through all three observations.
        if (short && !straight) continue;
        const bend = straight ? 0 : curvatureMoment / 14;
        const offset = mean - 2 * bend;
        if ((straight && (extendsBefore || extendsAfter)) || Math.abs(residualSlope) + 4 * Math.abs(bend) > (shear ? 0.43 : 0.7)
          || offset <= 0 || offset >= 1 || Math.abs(bend) > 0.085
          || (!straight && intercepts.some((value, i) => Math.abs(value - offset - (i - 2) * residualSlope - (i - 2) ** 2 * bend) > 0.02))) continue;
        const slope = residualSlope + shear;
        const minimum = extendsBefore ? -2 : -1, maximum = extendsAfter ? 3 : 2;
        let cleanSections = 0, worstError = 0;
        for (let u = -span; u <= span && complete; u += 1) {
          const center = offset + residualSlope * u + bend * u * u;
          const tilt = Math.abs(slope + 2 * bend * u);
          let sectionError = 0;
          for (let v = minimum; v <= maximum; v += 1) {
            const coverage = edgeArea(center - v, 1, tilt);
            const expected = phase(p + u * advance + v * normal);
            const difference = Math.abs(coverage - expected);
            sectionError = Math.max(sectionError, difference);
            if (difference > (short ? 0.018 : 0.27) || (expected < 0.12 && coverage >= ISO)
              || (expected > 0.88 && coverage < ISO)) {
              complete = false;
              break;
            }
          }
          if (sectionError <= 0.035) cleanSections += 1;
          worstError = Math.max(worstError, sectionError);
        }
        if (!complete) continue;
        const noisy = worstError > 0.035;
        if (noisy) {
          // Keep the shape implied by coherent cross-section areas where a
          // few source samples spread that area across the fitted edge.
          const centralMass = phase(p) + phase(p + normal);
          const fittedMass = edgeArea(offset, 1, Math.abs(slope)) + edgeArea(offset - 1, 1, Math.abs(slope));
          if (cleanSections < 2 || Math.abs(centralMass - fittedMass) > 0.016) continue;
        }
        const acrossX = normal === 1;
        const acrossStep = 1 / (acrossX ? sx : sy), alongStep = 1 / (acrossX ? sy : sx);
        // Cross-section mass measures the average edge position inside a
        // source texel. Subtract that average's curvature contribution before
        // evaluating the same geometry at a different resolution.
        const center = offset + bend * (alongStep * alongStep - 1) / 12;
        for (let v = 0; v <= 1; v += 1) {
          const tx = x + (acrossX ? v : 0), ty = y + (acrossX ? 0 : v);
          let previousArea = 0;
          for (let j = 0; j < sy; j += 1) {
            for (let i = 0; i < sx; i += 1) previousArea += mask[(ty * sy + j) * width + tx * sx + i]!;
          }
          const fittedArea = edgeArea(offset - v, 1, Math.abs(slope));
          const expected = field[p + v * normal]!;
          if (!noisy && Math.abs((descending ? fittedArea : 1 - fittedArea) - expected)
            > Math.abs(previousArea / (sx * sy) - expected) + (straight && !short ? 1 / 255 : 0)) continue;
          for (let j = 0; j < sy; j += 1) {
            for (let i = 0; i < sx; i += 1) {
              const dx = (i + 0.5) / sx - 0.5, dy = (j + 0.5) / sy - 0.5;
              const u = acrossX ? dy : dx;
              const distance = center + slope * u + bend * u * u - v - (acrossX ? dx : dy);
              const tilt = Math.abs(slope + 2 * bend * u) * alongStep;
              const coverage = edgeArea(distance, Math.max(acrossStep, tilt), Math.min(acrossStep, tilt));
              mask[(ty * sy + j) * width + tx * sx + i] = descending ? coverage : 1 - coverage;
            }
          }
          if (soft) soft[p + v * normal] = 0;
        }
        break;
      }
    }
  }
}

/** Recover a right-angle corner when its neighboring samples support two straight edges. */
function restoreSquareCorners(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2) return;
  const directions = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  const unitOverlap = (index: number, center: number, scale: number) =>
    clamp01(index + 1 - (1 - center) * scale);
  for (let y = 2; y < sourceHeight - 2; y += 1) {
    for (let x = 2; x < sourceWidth - 2; x += 1) {
      const p = y * sourceWidth + x;
      for (const [nx, ny] of directions) {
        const dx = nx, dy = ny * sourceWidth;
        const interior = field[p + 2 * (dx + dy)]!;
        const exterior = field[p - 2 * (dx + dy)]!;
        if (Math.abs(interior - exterior) < 0.94) continue;
        const dark = interior < exterior;
        const phase = (q: number) => dark ? 1 - field[q]! : field[q]!;
        const across = phase(p + 2 * dy), down = phase(p + 2 * dx);
        if (Math.min(across, down) <= 0.02 || Math.abs(across * down - phase(p)) > 0.045) continue;
        // A corner with two square sides projects to separable interval
        // coverage. Check the entire neighborhood before using the model.
        let matches = true;
        for (let v = -2; v <= 2 && matches; v += 1) {
          const coverageY = v === 0 ? down : Number(v > 0);
          for (let u = -2; u <= 2; u += 1) {
            const coverageX = u === 0 ? across : Number(u > 0);
            if (Math.abs(coverageX * coverageY - phase(p + u * dx + v * dy)) > 0.035) {
              matches = false;
              break;
            }
          }
        }
        if (!matches) continue;
        for (let v = -1; v <= 1; v += 1) {
          for (let u = -1; u <= 1; u += 1) {
            const tx = x + u * nx, ty = y + v * ny;
            for (let j = 0; j < sy; j += 1) {
              const alongY = ny > 0 ? j : sy - 1 - j;
              const alphaY = v === 0 ? unitOverlap(alongY, down, sy) : Number(v > 0);
              for (let i = 0; i < sx; i += 1) {
                const alongX = nx > 0 ? i : sx - 1 - i;
                const alphaX = u === 0 ? unitOverlap(alongX, across, sx) : Number(u > 0);
                const coverage = alphaX * alphaY;
                mask[(ty * sy + j) * width + tx * sx + i] = dark ? 1 - coverage : coverage;
              }
            }
            if (soft) soft[ty * sourceWidth + tx] = 0;
          }
        }
        break;
      }
    }
  }
}

/** Recover corners where two nonparallel source edges meet. */
function clipPolygon(
  points: Float64Array, count: number, output: Float64Array, nx: number, ny: number, intercept: number,
): number {
  let size = 0, px = points[count - 2]!, py = points[count - 1]!;
  let prior = nx * px + ny * py - intercept;
  for (let i = 0; i < count; i += 2) {
    const x = points[i]!, y = points[i + 1]!, current = nx * x + ny * y - intercept;
    if ((current >= 0) !== (prior >= 0)) {
      const t = prior / (prior - current);
      output[size++] = px + t * (x - px);
      output[size++] = py + t * (y - py);
    }
    if (current >= 0) {
      output[size++] = x;
      output[size++] = y;
    }
    px = x;
    py = y;
    prior = current;
  }
  return size;
}

function polygonCoverage(points: Float64Array, count: number, pixelArea: number): number {
  let twiceArea = 0, px = points[count - 2]!, py = points[count - 1]!;
  for (let i = 0; i < count; i += 2) {
    const qx = points[i]!, qy = points[i + 1]!;
    twiceArea += px * qy - py * qx;
    px = qx;
    py = qy;
  }
  return clamp01(Math.abs(twiceArea) / (2 * pixelArea));
}

function restoreAngledCorners(
  loops: Point[][], field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  const first = new Float64Array(14), clipped = new Float64Array(14);
  for (const loop of loops) {
    const perimeter = loop.reduce((total, p, i) => {
      const q = loop[(i + 1) % loop.length]!;
      return total + Math.hypot(p.x - q.x, p.y - q.y);
    }, 0);
    if (perimeter < 12) continue;
    for (const index of findCorners(loop, perimeter)) {
      const sides = [-1, 1].map(step => {
        const center = arcPoint(loop, index, step, 1.25);
        const outer = arcPoint(loop, index, step, 3.15);
        return { center, direction: unit(difference(outer, center)), end: index };
      });
      const [a, b] = sides as [StraightLine, StraightLine];
      const vertex = intersectStraightLines(a, b);
      const corner = loop[index]!;
      if (!vertex || (vertex.x - corner.x) ** 2 + (vertex.y - corner.y) ** 2 > 1.05 ** 2
        || dot(a.direction, b.direction) < -0.62 || dot(a.direction, b.direction) > 0.94) continue;
      const nx = [a.direction.y, b.direction.y], ny = [-a.direction.x, -b.direction.x];
      if (nx.every((x, i) => Math.min(Math.abs(x), Math.abs(ny[i]!)) < 0.08)) continue;
      for (let i = 0; i < 2; i += 1) {
        const other = sides[1 - i]!.direction;
        if (nx[i]! * other.x + ny[i]! * other.y >= 0) continue;
        nx[i]! *= -1;
        ny[i]! *= -1;
      }
      const model = [0, 0, 0, 0];
      const area = (x: number, y: number, dx: number, dy: number) => {
        const left = x - vertex.x, top = y - vertex.y;
        const centerX = left + dx / 2, centerY = top + dy / 2;
        const ax = nx[0]! - model[2]! * ny[0]!, ay = ny[0]! + model[2]! * nx[0]!;
        const bx = nx[1]! - model[3]! * ny[1]!, by = ny[1]! + model[3]! * nx[1]!;
        const da = centerX * ax + centerY * ay - model[0]!, db = centerX * bx + centerY * by - model[1]!;
        const xA = Math.abs(ax * dx), yA = Math.abs(ay * dy), xB = Math.abs(bx * dx), yB = Math.abs(by * dy);
        const ra = (xA + yA) / 2, rb = (xB + yB) / 2;
        if (da <= -ra || db <= -rb) return 0;
        if (da >= ra) return edgeArea(db, Math.max(xB, yB), Math.min(xB, yB));
        if (db >= rb) return edgeArea(da, Math.max(xA, yA), Math.min(xA, yA));
        first[0] = left;
        first[1] = top;
        first[2] = left + dx;
        first[3] = top;
        first[4] = left + dx;
        first[5] = top + dy;
        first[6] = left;
        first[7] = top + dy;
        const size = clipPolygon(first, 8, clipped, ax, ay, model[0]!);
        if (!size) return 0;
        const rest = clipPolygon(clipped, size, first, bx, by, model[1]!);
        if (!rest) return 0;
        return polygonCoverage(first, rest, dx * dy);
      };
      const left = Math.floor(vertex.x) - 1, top = Math.floor(vertex.y) - 1;
      if (left < 0 || left + 3 > sourceWidth || top < 0 || top + 3 > sourceHeight) continue;
      const measure = (dark: boolean) => {
        let error = 0, largest = 0, fractional = 0;
        for (let y = top; y < top + 3; y += 1) {
          for (let x = left; x < left + 3; x += 1) {
            const value = field[y * sourceWidth + x]!;
            const coverage = area(x, y, 1, 1);
            const distance = Math.abs((dark ? 1 - value : value) - coverage);
            error += distance ** 2;
            largest = Math.max(largest, distance);
            fractional += Number(coverage > 0.05 && coverage < 0.95);
          }
        }
        return { error, largest, fractional };
      };
      const dark = measure(true).error < measure(false).error;
      let best = measure(dark);
      if (best.error > 0.27) continue;
      for (const step of [0.18, 0.09, 0.045, 0.0225]) {
        for (let p = 0; p < model.length; p += 1) {
          const previous = model[p]!;
          const delta = p < 2 ? step : step / 2;
          let selected = previous;
          for (const direction of [-1, 1]) {
            model[p] = previous + direction * delta;
            if (Math.abs(model[p]!) > (p < 2 ? 0.54 : 0.21)) continue;
            const fit = measure(dark);
            if (fit.error >= best.error) continue;
            selected = model[p]!;
            best = fit;
          }
          model[p] = selected;
        }
      }
      if (best.fractional < 3 || best.error > 0.012 || best.largest > 0.074) continue;
      const prior = new Float64Array(9);
      let priorError = 0;
      for (let y = top; y < top + 3; y += 1) {
        for (let x = left; x < left + 3; x += 1) {
          let current = 0;
          for (let j = 0; j < sy; j += 1) {
            for (let i = 0; i < sx; i += 1) current += mask[(y * sy + j) * width + x * sx + i]!;
          }
          const error = Math.abs(current / (sx * sy) - field[y * sourceWidth + x]!);
          prior[(y - top) * 3 + x - left] = error;
          priorError += error ** 2;
        }
      }
      if (priorError < best.error + 0.002) continue;
      const copies = [[false, false], [true, false], [false, true], [true, true]] as const;
      const matched = copies.filter(([flipX, flipY]) => {
        if (!flipX && !flipY) return true;
        for (let y = Math.max(0, top - 1); y < Math.min(sourceHeight, top + 4); y += 1) {
          const ty = flipY ? sourceHeight - 1 - y : y;
          for (let x = Math.max(0, left - 1); x < Math.min(sourceWidth, left + 4); x += 1) {
            const tx = flipX ? sourceWidth - 1 - x : x;
            if (Math.abs(field[ty * sourceWidth + tx]! - field[y * sourceWidth + x]!) > 2 / 255) return false;
          }
        }
        return true;
      });
      for (let y = top; y < top + 3; y += 1) {
        for (let x = left; x < left + 3; x += 1) {
          const expected = field[y * sourceWidth + x]!;
          const coverage = area(x, y, 1, 1);
          if (Math.abs((dark ? 1 - coverage : coverage) - expected) > prior[(y - top) * 3 + x - left]! + 0.006) continue;
          for (let j = 0; j < sy; j += 1) {
            for (let i = 0; i < sx; i += 1) {
              const alpha = area(x + i / sx, y + j / sy, 1 / sx, 1 / sy);
              for (const [flipX, flipY] of matched) {
                const tx = flipX ? width - 1 - (x * sx + i) : x * sx + i;
                const ty = flipY ? height - 1 - (y * sy + j) : y * sy + j;
                mask[ty * width + tx] = dark ? 1 - alpha : alpha;
              }
            }
          }
          if (soft) {
            for (const [flipX, flipY] of matched) {
              const tx = flipX ? sourceWidth - 1 - x : x, ty = flipY ? sourceHeight - 1 - y : y;
              soft[ty * sourceWidth + tx] = 0;
            }
          }
        }
      }
    }
  }
}

/** Recover an orthogonal crossing or a T-junction between two thin strokes. */
function restoreCrossings(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2) return;
  const interval = (leading: number, center: number, trailing: number) => {
    const size = leading + center + trailing;
    if (center < 0.35 || leading + trailing < 0.035 || size < 0.55 || size > 1.7) return undefined;
    const start = leading > 0.012 ? -0.5 - leading : 0.5 - center;
    const end = trailing > 0.012 ? 0.5 + trailing : -0.5 + center;
    return [start, end] as const;
  };
  const overlap = (start: number, end: number, band: readonly [number, number]) =>
    intervalOverlap(start, end, band[0], band[1]) / (end - start);
  for (let y = 2; y < sourceHeight - 2; y += 1) {
    for (let x = 2; x < sourceWidth - 2; x += 1) {
      const p = y * sourceWidth + x, vertical = 2 * sourceWidth;
      const dark = field[p]! < ISO;
      const phase = (offset: number) => dark ? 1 - field[p + offset]! : field[p + offset]!;
      if (phase(-2 - vertical) > 0.035 || phase(2 - vertical) > 0.035
        || phase(-2 + vertical) > 0.035 || phase(2 + vertical) > 0.035) continue;
      for (const horizontal of [true, false]) {
        const tangent = horizontal ? 1 : sourceWidth;
        const normal = horizontal ? sourceWidth : 1;
        if (Math.min(phase(-2 * tangent), phase(2 * tangent)) < 0.34) continue;
        const before = phase(-2 * normal), after = phase(2 * normal);
        const crossing = before >= 0.34 && after >= 0.34;
        if (!crossing && !(before >= 0.34 && after <= 0.035) && !(after >= 0.34 && before <= 0.035)) continue;
        // Use measurements away from the junction. A T has evidence on
        // only one side of its stem, which stops where it meets the bar.
        const acrossStem = (i: number) => crossing ? (phase(i * tangent - 2 * normal) + phase(i * tangent + 2 * normal)) / 2
          : phase(i * tangent + (before > after ? -2 : 2) * normal);
        const acrossBar = (i: number) => (phase(i * normal - 2 * tangent) + phase(i * normal + 2 * tangent)) / 2;
        const stem = interval(acrossStem(-1), acrossStem(0), acrossStem(1));
        const bar = interval(acrossBar(-1), acrossBar(0), acrossBar(1));
        if (!stem || !bar) continue;
        const outsideBar = before > after ? [-Infinity, bar[0]] as const : [bar[1], Infinity] as const;
        const stemEnd = (start: number, end: number, barCoverage: number) =>
          crossing ? 1 - barCoverage : overlap(start, end, outsideBar);
        let matches = true;
        for (let v = -2; v <= 2 && matches; v += 1) {
          const alphaBar = overlap(v - 0.5, v + 0.5, bar);
          const alphaEnd = stemEnd(v - 0.5, v + 0.5, alphaBar);
          for (let u = -2; u <= 2; u += 1) {
            const alphaStem = overlap(u - 0.5, u + 0.5, stem);
            if (Math.abs(alphaBar + alphaStem * alphaEnd - phase(v * normal + u * tangent)) > 0.035) {
              matches = false;
              break;
            }
          }
        }
        if (!matches) continue;
        const normalScale = horizontal ? sy : sx, tangentScale = horizontal ? sx : sy;
        for (let v = -1; v <= 1; v += 1) {
          for (let u = -1; u <= 1; u += 1) {
            const tx = x + (horizontal ? u : v), ty = y + (horizontal ? v : u);
            for (let j = 0; j < normalScale; j += 1) {
              const start = v + j / normalScale - 0.5, end = v + (j + 1) / normalScale - 0.5;
              const alphaBar = overlap(start, end, bar);
              const alphaEnd = stemEnd(start, end, alphaBar);
              for (let i = 0; i < tangentScale; i += 1) {
                const alphaStem = overlap(u + i / tangentScale - 0.5, u + (i + 1) / tangentScale - 0.5, stem);
                const coverage = alphaBar + alphaStem * alphaEnd;
                mask[(ty * sy + (horizontal ? j : i)) * width + tx * sx + (horizontal ? i : j)] = dark ? 1 - coverage : coverage;
              }
            }
            if (soft) soft[ty * sourceWidth + tx] = 0;
          }
        }
        break;
      }
    }
  }
}

/** Align an inverted middle segment with the same edge on both sides. */
function restoreSharedSplits(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2) return;
  for (const horizontal of [true, false]) {
    const across = horizontal ? sourceHeight : sourceWidth;
    const along = horizontal ? sourceWidth : sourceHeight;
    const normal = horizontal ? sourceWidth : 1;
    const tangent = horizontal ? 1 : sourceWidth;
    for (let v = 1; v + 2 < across; v += 1) {
      const runs: Array<{ start: number; end: number; direction: number; first: number; second: number }> = [];
      for (let u = 0; u < along; u += 1) {
        const p = v * normal + u * tangent;
        const before = field[p - normal]!, after = field[p + 2 * normal]!;
        const direction = Math.sign(after - before);
        if (Math.abs(after - before) < 0.97) continue;
        const first = field[p]!, second = field[p + normal]!;
        if ((second - first) * direction < -0.008) continue;
        const last = runs[runs.length - 1];
        if (last && last.end === u && last.direction === direction
          && Math.abs(first - last.first) < 0.016 && Math.abs(second - last.second) < 0.016) {
          last.end += 1;
        } else {
          runs.push({ start: u, end: u + 1, direction, first, second });
        }
      }
      const segments = runs.filter(run => run.end - run.start >= 4);
      for (let i = 1; i + 1 < segments.length; i += 1) {
        const left = segments[i - 1]!, middle = segments[i]!, right = segments[i + 1]!;
        if (left.direction !== right.direction || left.direction === middle.direction
          || middle.start - left.end > 2 || right.start - middle.end > 2
          || Math.abs(left.first - right.first) > 0.016 || Math.abs(left.second - right.second) > 0.016) continue;
        // Orient the profiles so the flanks descend and their leading texel
        // is solid. A shared fractional level with excess coverage in both
        // texels distinguishes overdraw from two crisp, staggered steps.
        const inverted = left.direction > 0;
        const phase = (value: number) => inverted ? 1 - value : value;
        const lead = (phase(left.first) + phase(right.first)) / 2;
        const tail = (phase(left.second) + phase(right.second)) / 2;
        const early = phase(middle.first), late = phase(middle.second);
        if (lead < 0.985 || tail < 0.65 || tail > 0.94 || early < 0.48 || late > 0.945
          || tail + late < 1.35 || Math.abs(tail - late) > 0.095) continue;
        const start = left.end - 1, end = right.start + 1;
        let supported = true;
        for (let u = start; u < end; u += 1) {
          const p = v * normal + u * tangent;
          if (Math.abs(field[p - normal]! + field[p + 2 * normal]! - 1) > 0.09) supported = false;
        }
        if (!supported) continue;
        const normalScale = horizontal ? sy : sx;
        const tangentScale = horizontal ? sx : sy;
        const seam = lead + tail;
        for (let u = start; u < end; u += 1) {
          const p = v * normal + u * tangent;
          const upper = (phase(field[p - normal]!) + 1 - phase(field[p + 2 * normal]!)) / 2;
          const gradient = phase(field[p - normal + tangent]!) - phase(field[p - normal - tangent]!);
          for (let k = 0; k < 2 * normalScale; k += 1) {
            const top = clamp01(seam * normalScale - k);
            for (let l = 0; l < tangentScale; l += 1) {
              const front = upper < 0.02 || upper > 0.98 ? Number(upper > 0.5)
                : clamp01(upper * tangentScale - (gradient > 0 ? tangentScale - 1 - l : l));
              const value = top * front + (1 - top) * (1 - front);
              const tx = horizontal ? u * sx + l : v * sx + k;
              const ty = horizontal ? v * sy + k : u * sy + l;
              mask[ty * width + tx] = phase(value);
            }
          }
          if (soft) soft[p] = soft[p + normal] = 0;
        }
      }
    }
  }
}

function featureBounds(loop: Point[], width: number, height: number) {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const { x, y } of loop) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const x0 = Math.floor(left) - 1, x1 = Math.ceil(right) + 1;
  const y0 = Math.floor(top) - 1, y1 = Math.ceil(bottom) + 1;
  if (x0 < 0 || x1 > width || y0 < 0 || y1 > height) return undefined;
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  return {
    x0, x1, y0, y1, centerX, centerY, middleX: Math.floor(centerX), middleY: Math.floor(centerY),
    spanX: right - left, spanY: bottom - top,
  };
}

function intervalOverlap(start: number, end: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(end, hi) - Math.max(start, lo));
}

/** Resolve short oblique dashes from both long edges and both end caps. */
function restoreSlantedDashes(
  loops: Point[][], field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  const points = new Float64Array(16), clipped = new Float64Array(16);
  for (const loop of loops) {
    const bounds = featureBounds(loop, sourceWidth, sourceHeight);
    if (!bounds || Math.max(bounds.spanX, bounds.spanY) < 3.4 || Math.max(bounds.spanX, bounds.spanY) > 8) continue;
    const { x0, x1, y0, y1, centerX, centerY, middleX, middleY } = bounds;
    if (field[middleY * sourceWidth + middleX]! < 0.95) continue;
    let xx = 0, xy = 0, yy = 0;
    for (const point of loop) {
      const x = point.x - centerX, y = point.y - centerY;
      xx += x * x;
      xy += x * y;
      yy += y * y;
    }
    const angle = Math.atan2(2 * xy, xx - yy) / 2;
    const alongX = Math.cos(angle), alongY = Math.sin(angle);
    if (Math.min(Math.abs(alongX), Math.abs(alongY)) < 0.07) continue;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const point of loop) {
      const x = point.x - centerX, y = point.y - centerY;
      const along = x * alongX + y * alongY, across = -x * alongY + y * alongX;
      a0 = Math.min(a0, along); a1 = Math.max(a1, along);
      b0 = Math.min(b0, across); b1 = Math.max(b1, across);
    }
    if (a1 - a0 < 3.6 || b1 - b0 < 1.25 || b1 - b0 > 3.9 || a1 - a0 < 1.3 * (b1 - b0)) continue;
    const model: [number, number, number, number, number] = [a0, a1, b0, b1, angle];
    let nx = alongX, ny = alongY;
    const area = (x: number, y: number, dx: number, dy: number) => {
      const left = x - centerX, top = y - centerY;
      const cx = left + dx / 2, cy = top + dy / 2;
      const a = nx * cx + ny * cy, b = -ny * cx + nx * cy;
      const ra = (Math.abs(nx * dx) + Math.abs(ny * dy)) / 2;
      const rb = (Math.abs(ny * dx) + Math.abs(nx * dy)) / 2;
      const [lo, hi, low, high] = model;
      if (a + ra <= lo || a - ra >= hi || b + rb <= low || b - rb >= high) return 0;
      if (a - ra >= lo && a + ra <= hi && b - rb >= low && b + rb <= high) return 1;
      points[0] = left;
      points[1] = top;
      points[2] = left + dx;
      points[3] = top;
      points[4] = left + dx;
      points[5] = top + dy;
      points[6] = left;
      points[7] = top + dy;
      let count = clipPolygon(points, 8, clipped, nx, ny, lo);
      if (count) count = clipPolygon(clipped, count, points, -nx, -ny, -hi);
      if (count) count = clipPolygon(points, count, clipped, -ny, nx, low);
      if (count) count = clipPolygon(clipped, count, points, ny, -nx, -high);
      if (!count) return 0;
      return polygonCoverage(points, count, dx * dy);
    };
    const sites: Array<{ x: number; y: number; value: number }> = [];
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const dx = x + 0.5 - centerX, dy = y + 0.5 - centerY;
        const a = alongX * dx + alongY * dy, b = -alongY * dx + alongX * dy;
        if (a < a0 - 0.85 || a > a1 + 0.85 || b < b0 - 0.85 || b > b1 + 0.85) continue;
        sites.push({ x, y, value: field[y * sourceWidth + x]! });
      }
    }
    const measure = () => {
      nx = Math.cos(model[4]!);
      ny = Math.sin(model[4]!);
      let error = 0;
      for (const { x, y, value } of sites) error += (area(x, y, 1, 1) - value) ** 2;
      return error;
    };
    let error = measure();
    if (error > sites.length * 0.18 ** 2) continue;
    for (const step of [0.16, 0.08, 0.04, 0.02, 0.01]) {
      for (let i = 0; i < model.length; i += 1) {
        const previous = model[i]!, delta = i === 4 ? step * 0.4 : step;
        let best = previous;
        for (const direction of [-1, 1]) {
          model[i] = previous + direction * delta;
          const candidate = measure();
          if (candidate >= error) continue;
          best = model[i]!;
          error = candidate;
        }
        model[i] = best;
      }
    }
    if (error > sites.length * 0.065 ** 2) continue;
    nx = Math.cos(model[4]!);
    ny = Math.sin(model[4]!);
    const fitted = sites.map(site => ({ ...site, coverage: area(site.x, site.y, 1, 1) }));
    // A crossed or adjacent stroke can spill into the fitting window. Keep
    // its pixels wherever the dash alone cannot explain the source sample.
    if (fitted.some(({ value, coverage }) => coverage - value > 0.21
      || (value >= ISO && coverage < ISO && value - coverage > 0.12))) continue;
    for (const { x, y, value, coverage } of fitted) {
      if (Math.abs(value - coverage) > 0.13) continue;
      if (soft) soft[y * sourceWidth + x] = 0;
      for (let j = 0; j < sy; j += 1) {
        for (let i = 0; i < sx; i += 1) {
          mask[(y * sy + j) * width + x * sx + i] = area(x + i / sx, y + j / sy, 1 / sx, 1 / sy);
        }
      }
    }
  }
}

/** Recover short rails and slots whose source coverage supports a rectangle. */
function restoreRectangularFeatures(
  loops: Point[][], field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (Math.min(sx, sy) < 2) return;
  for (const loop of loops) {
    const bounds = featureBounds(loop, sourceWidth, sourceHeight);
    if (!bounds || Math.min(bounds.spanX, bounds.spanY) > 5 || Math.max(bounds.spanX, bounds.spanY) < 2.5) continue;
    const { x0, x1, y0, y1, middleX, middleY, spanX, spanY } = bounds;
    const dark = field[middleY * sourceWidth + middleX]! < ISO;
    const phase = (x: number, y: number) => {
      const value = field[y * sourceWidth + x]!;
      return dark ? 1 - value : value;
    };
    const columns = new Float64Array(x1 - x0), rows = new Float64Array(y1 - y0);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const value = phase(x, y);
        columns[x - x0]! += value;
        rows[y - y0]! += value;
      }
    }
    // An axis-aligned rectangle projects to one-dimensional interval overlaps.
    // Use a fully covered interior sample on the long axis to resolve the width.
    const interval = (profile: Float64Array, thickness: number): [number, number] | undefined => {
      if (thickness < 0.5 || profile[0]! > 0.035 || profile[profile.length - 1]! > 0.035) return undefined;
      const i = profile.findIndex((v) => v > 0.025);
      if (i < 0) return undefined;
      let j = profile.length - 1;
      while (profile[j]! <= 0.025) j -= 1;
      if (i === j) {
        const half = profile[i]! / thickness / 2;
        return [i + 0.5 - half, i + 0.5 + half];
      }
      return [i + 1 - profile[i]! / thickness, j + profile[j]! / thickness];
    };
    const area = rows.reduce((sum, value) => sum + value, 0);
    if (area < 1.5) continue;
    const longerX = spanX >= spanY;
    const thickness = Math.max(...(longerX ? columns : rows));
    const horizontal = interval(columns, longerX ? thickness : area / thickness);
    const vertical = interval(rows, longerX ? area / thickness : thickness);
    if (!horizontal || !vertical) continue;
    const minX = x0 + horizontal[0], maxX = x0 + horizontal[1];
    const minY = y0 + vertical[0], maxY = y0 + vertical[1];
    let error = 0, maxError = 0;
    for (let y = y0; y < y1; y += 1) {
      const yCoverage = intervalOverlap(y, y + 1, minY, maxY);
      for (let x = x0; x < x1; x += 1) {
        const difference = Math.abs(phase(x, y) - yCoverage * intervalOverlap(x, x + 1, minX, maxX));
        error += difference;
        maxError = Math.max(maxError, difference);
      }
    }
    if (maxError > 0.04 || error > area * 0.027) continue;
    if (soft) {
      for (let y = y0; y < y1; y += 1) soft.fill(0, y * sourceWidth + x0, y * sourceWidth + x1);
    }
    for (let y = Math.ceil(y0 * sy); y < Math.floor(y1 * sy); y += 1) {
      const yCoverage = intervalOverlap(y, y + 1, minY * sy, maxY * sy);
      for (let x = Math.ceil(x0 * sx); x < Math.floor(x1 * sx); x += 1) {
        const value = yCoverage * intervalOverlap(x, x + 1, minX * sx, maxX * sx);
        mask[y * width + x] = dark ? 1 - value : value;
      }
    }
  }
}

/** Fit both contours of a rectangular frame from its four source rails. */
function restoreRectangleFrames(
  loops: Point[][], source: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2) return;
  for (const loop of loops) {
    const bounds = featureBounds(loop, sourceWidth, sourceHeight);
    if (!bounds || Math.min(bounds.spanX, bounds.spanY) < 4 || Math.max(bounds.spanX, bounds.spanY) > 32) continue;
    const { middleX, middleY, spanX, spanY } = bounds;
    const middle = source[middleY * sourceWidth + middleX]!;
    if (middle > 0.035 && middle < 0.965) continue;
    const dark = middle > ISO;
    const phase = (value: number) => dark ? 1 - value : value;
    const rail = (horizontal: boolean, direction: number) => {
      const center = horizontal ? middleX : middleY;
      const reach = Math.ceil((horizontal ? spanX : spanY) / 2) + 4;
      const length = horizontal ? sourceWidth : sourceHeight;
      const sample = (u: number) => {
        const index = horizontal ? middleY * sourceWidth + u : u * sourceWidth + middleX;
        const transverse = horizontal ? sourceWidth : 1;
        return (phase(source[index - transverse]!) + phase(source[index]!) + phase(source[index + transverse]!)) / 3;
      };
      let first = -1, last = -1;
      for (let i = 1; i <= reach; i += 1) {
        const u = center + i * direction;
        if (u < 0 || u >= length) return undefined;
        if (sample(u) > 0.025) {
          if (first < 0) first = u;
          last = u;
        } else if (first >= 0) {
          // A rail in one texel does not give both edge positions.
          if (first === last) return undefined;
          const lo = Math.min(first, last), hi = Math.max(first, last);
          return [lo + 1 - sample(lo), hi + sample(hi)] as const;
        }
      }
      return undefined;
    };
    const left = rail(true, -1), right = rail(true, 1), top = rail(false, -1), bottom = rail(false, 1);
    if (!left || !right || !top || !bottom || right[0] - left[1] < 2.5 || bottom[0] - top[1] < 2.5) continue;
    const x0 = Math.floor(left[0]) - 1, x1 = Math.ceil(right[1]) + 1;
    const y0 = Math.floor(top[0]) - 1, y1 = Math.ceil(bottom[1]) + 1;
    if (x0 < 0 || x1 > sourceWidth || y0 < 0 || y1 > sourceHeight) continue;
    const area = (x: number, y: number, dx: number, dy: number) => clamp01((
      intervalOverlap(x, x + dx, left[0], right[1]) * intervalOverlap(y, y + dy, top[0], bottom[1])
      - intervalOverlap(x, x + dx, left[1], right[0]) * intervalOverlap(y, y + dy, top[1], bottom[0])
    ) / (dx * dy));
    let error = 0, largest = 0;
    for (let y = y0; y < y1 && largest <= 0.06; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const fitted = area(x, y, 1, 1);
        const delta = Math.abs(fitted - phase(source[y * sourceWidth + x]!));
        largest = Math.max(largest, delta);
        error += delta * delta;
      }
    }
    if (largest > 0.06 || error > (x1 - x0 + y1 - y0) * 0.004) continue;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (soft) soft[y * sourceWidth + x] = 0;
        for (let j = 0; j < sy; j += 1) {
          for (let i = 0; i < sx; i += 1) {
            const coverage = area(x + i / sx, y + j / sy, 1 / sx, 1 / sy);
            mask[(y * sy + j) * width + x * sx + i] = phase(coverage);
          }
        }
      }
    }
  }
}

/** Integrate a circle over a rectangle using signed quadrant areas. */
function circleCoverage(left: number, top: number, right: number, bottom: number, radius: number): number {
  const squared = radius * radius;
  const nearX = left <= 0 && right >= 0 ? 0 : Math.min(Math.abs(left), Math.abs(right));
  const nearY = top <= 0 && bottom >= 0 ? 0 : Math.min(Math.abs(top), Math.abs(bottom));
  if (nearX ** 2 + nearY ** 2 >= squared) return 0;
  const farX = Math.max(Math.abs(left), Math.abs(right)), farY = Math.max(Math.abs(top), Math.abs(bottom));
  if (farX ** 2 + farY ** 2 <= squared) return 1;
  const integral = (x: number) => (x * Math.sqrt(Math.max(0, squared - x * x)) + squared * Math.asin(x / radius)) * 0.5;
  const quadrant = (x: number, y: number) => {
    const a = Math.min(radius, Math.abs(x)), b = Math.min(radius, Math.abs(y));
    const flatEnd = Math.min(a, Math.sqrt(Math.max(0, squared - b * b)));
    return (b * flatEnd + integral(a) - integral(flatEnd)) * Math.sign(x) * Math.sign(y);
  };
  return clamp01((quadrant(right, bottom) - quadrant(right, top) - quadrant(left, bottom) + quadrant(left, top))
    / ((right - left) * (bottom - top)));
}

/** Fit isolated round forms directly to source area before replacing a faceted trace. */
function restoreCircularFeatures(
  loops: Point[][], source: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (Math.min(sx, sy) < 2) return;
  for (const loop of loops) {
    const bounds = featureBounds(loop, sourceWidth, sourceHeight);
    if (!bounds || Math.max(bounds.spanX, bounds.spanY) > 7 || Math.min(bounds.spanX, bounds.spanY) < 1.15) continue;
    const { x0, x1, y0, y1, middleX, middleY, spanX, spanY } = bounds;
    if (Math.abs(spanX - spanY) > 0.75) continue;
    const dark = source[middleY * sourceWidth + middleX]! < ISO;
    const phase = (value: number) => dark ? 1 - value : value;
    let mass = 0, xMoment = 0, yMoment = 0, border = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const coverage = phase(source[y * sourceWidth + x]!);
        mass += coverage;
        xMoment += (x + 0.5) * coverage;
        yMoment += (y + 0.5) * coverage;
        if (x === x0 || x === x1 - 1 || y === y0 || y === y1 - 1) border = Math.max(border, coverage);
      }
    }
    if (mass < 1.5 || border > 0.035) continue;
    const radius = Math.sqrt(mass / Math.PI);
    const measure = (cx: number, cy: number) => {
      let error = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const predicted = circleCoverage(x - cx, y - cy, x + 1 - cx, y + 1 - cy, radius);
          error += (predicted - phase(source[y * sourceWidth + x]!)) ** 2;
        }
      }
      return error;
    };
    let cx = xMoment / mass, cy = yMoment / mass;
    let error = measure(cx, cy);
    if (error > 0.12) continue;
    for (const step of [0.08, 0.04, 0.02, 0.01]) {
      let nextX = cx, nextY = cy;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (!dx && !dy) continue;
          const x = cx + dx * step, y = cy + dy * step;
          const candidate = measure(x, y);
          if (candidate >= error) continue;
          nextX = x;
          nextY = y;
          error = candidate;
        }
      }
      cx = nextX;
      cy = nextY;
    }
    if (error > 0.028 || cx - radius < x0 || cx + radius > x1 || cy - radius < y0 || cy + radius > y1) continue;
    if (soft) {
      for (let y = y0; y < y1; y += 1) soft.fill(0, y * sourceWidth + x0, y * sourceWidth + x1);
    }
    for (let y = Math.ceil(y0 * sy); y < Math.floor(y1 * sy); y += 1) {
      for (let x = Math.ceil(x0 * sx); x < Math.floor(x1 * sx); x += 1) {
        const coverage = circleCoverage(x / sx - cx, y / sy - cy, (x + 1) / sx - cx, (y + 1) / sy - cy, radius);
        mask[y * width + x] = dark ? 1 - coverage : coverage;
      }
    }
  }
}

/** Fit repeated round details without sampling neighboring marks in their bounding boxes. */
function restoreCrowdedCircles(
  loops: Point[][], field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  const shapes = loops.flatMap(loop => {
    const bounds = featureBounds(loop, sourceWidth, sourceHeight);
    return bounds && Math.min(bounds.spanX, bounds.spanY) >= 1.45 && Math.max(bounds.spanX, bounds.spanY) < 6
      && Math.abs(bounds.spanX - bounds.spanY) <= 0.65 ? [bounds] : [];
  });
  if (shapes.length < 3) return;
  for (const shape of shapes) {
    const { x0, x1, y0, y1, centerX, centerY, middleX, middleY, spanX, spanY } = shape;
    const seed = (spanX + spanY) / 4;
    const neighbors = shapes.filter(other => other !== shape && Math.abs((other.spanX + other.spanY) / 4 - seed) <= 0.38
      && (other.centerX - centerX) ** 2 + (other.centerY - centerY) ** 2 < 18 ** 2);
    if (neighbors.length < 2) continue;
    const dark = field[middleY * sourceWidth + middleX]! < ISO;
    const sites: Array<{ x: number; y: number; sample: number; foreign: boolean }> = [];
    const model = [centerX, centerY, seed];
    const coverage = (x: number, y: number, dx: number, dy: number) =>
      circleCoverage(x - model[0]!, y - model[1]!, x + dx - model[0]!, y + dy - model[1]!, model[2]!);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const dx = x + 0.5 - centerX, dy = y + 0.5 - centerY;
        if (dx * dx + dy * dy > (seed + 1.18) ** 2) continue;
        const foreign = neighbors.some(other => {
          const dx = Math.max(0, x - other.centerX, other.centerX - x - 1);
          const dy = Math.max(0, y - other.centerY, other.centerY - y - 1);
          const radius = (other.spanX + other.spanY) / 4 + 0.24;
          return dx * dx + dy * dy < radius * radius;
        });
        const value = field[y * sourceWidth + x]!;
        sites.push({ x, y, sample: dark ? 1 - value : value, foreign });
      }
    }
    const observations = sites.filter(site => !site.foreign);
    if (observations.length < 12) continue;
    let before = 0;
    for (const { x, y, sample } of observations) {
      let sum = 0;
      for (let j = 0; j < sy; j += 1) {
        for (let i = 0; i < sx; i += 1) sum += mask[(y * sy + j) * width + x * sx + i]!;
      }
      const area = sum / (sx * sy);
      before += ((dark ? 1 - area : area) - sample) ** 2;
    }
    const measure = () => observations.reduce((sum, { x, y, sample }) => sum + (coverage(x, y, 1, 1) - sample) ** 2, 0);
    let error = measure();
    if (error / observations.length > 0.18 ** 2) continue;
    for (const step of [0.16, 0.08, 0.04, 0.02, 0.01]) {
      for (let i = 0; i < model.length; i += 1) {
        const previous = model[i]!;
        let best = previous;
        for (const direction of [-1, 1]) {
          model[i] = previous + step * direction;
          const candidate = measure();
          if (candidate >= error) continue;
          error = candidate;
          best = model[i]!;
        }
        model[i] = best;
      }
    }
    if (error / observations.length > 0.075 ** 2 || error + 0.00025 * observations.length >= before
      || observations.some(({ x, y, sample }) => Math.abs(coverage(x, y, 1, 1) - sample) > 0.24)) continue;
    for (const { x, y, foreign } of sites) {
      for (let j = 0; j < sy; j += 1) {
        for (let i = 0; i < sx; i += 1) {
          const px = x + i / sx, py = y + j / sy;
          if (foreign) {
            const mx = px + 0.5 / sx, my = py + 0.5 / sy;
            const distance = (mx - model[0]!) ** 2 + (my - model[1]!) ** 2;
            if (neighbors.some(other => (mx - other.centerX) ** 2 + (my - other.centerY) ** 2 < distance)) continue;
          }
          const alpha = coverage(px, py, 1 / sx, 1 / sy);
          mask[(y * sy + j) * width + x * sx + i] = dark ? 1 - alpha : alpha;
        }
      }
      if (soft && !foreign) soft[y * sourceWidth + x] = 0;
    }
  }
}

interface Circle { x: number; y: number; radius: number }

function estimateCircle(loop: Point[], width: number, height: number): Circle | undefined {
  const bounds = featureBounds(loop, width, height);
  if (!bounds || Math.min(bounds.spanX, bounds.spanY) < 7 || Math.abs(bounds.spanX - bounds.spanY) > 0.9) return undefined;
  let x = bounds.centerX, y = bounds.centerY;
  let radius = (bounds.spanX + bounds.spanY) / 4;
  let error = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    let dx = 0, dy = 0, dr = 0;
    error = 0;
    for (const point of loop) {
      const length = Math.hypot(point.x - x, point.y - y);
      if (length === 0) return undefined;
      const residual = length - radius;
      dx += residual * (point.x - x) / length;
      dy += residual * (point.y - y) / length;
      dr += residual;
      error += residual ** 2;
    }
    x += 2 * dx / loop.length;
    y += 2 * dy / loop.length;
    radius += dr / loop.length;
  }
  return error / loop.length <= 0.235 ** 2 ? { x, y, radius } : undefined;
}

/** Fit round boundaries against the source near the perimeter, leaving any interior art intact. */
function restoreCircularContours(
  loops: Point[][], field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2) return;
  const candidates = loops.flatMap((loop) => {
    const circle = estimateCircle(loop, sourceWidth, sourceHeight);
    return circle ? [circle] : [];
  }).sort((a, b) => b.radius - a.radius);
  const completed = new Set<Circle>();
  for (const outer of candidates) {
    if (completed.has(outer)) continue;
    const group = [outer];
    for (const circle of candidates) {
      if (completed.has(circle) || (circle.x - outer.x) ** 2 + (circle.y - outer.y) ** 2 >= 0.3 ** 2) continue;
      const distance = group[group.length - 1]!.radius - circle.radius;
      if (distance < 0.7 || distance > 6) continue;
      group.push(circle);
      if (group.length === 4) break;
    }
    const sizes = group.length === 4 ? [4, 2, 1] : group.length >= 2 ? [2, 1] : [1];
    for (const size of sizes) {
      const rings = group.slice(0, size);
      const model = [rings.reduce((sum, circle) => sum + circle.x, 0) / size,
        rings.reduce((sum, circle) => sum + circle.y, 0) / size, ...rings.map(circle => circle.radius)];
      const sites: Array<{ x: number; y: number; value: number }> = [];
      const margin = 1.25;
      for (let y = Math.max(0, Math.floor(model[1]! - outer.radius - margin));
        y < Math.min(sourceHeight, Math.ceil(model[1]! + outer.radius + margin)); y += 1) {
        for (let x = Math.max(0, Math.floor(model[0]! - outer.radius - margin));
          x < Math.min(sourceWidth, Math.ceil(model[0]! + outer.radius + margin)); x += 1) {
          const dx = x + 0.5 - model[0]!, dy = y + 0.5 - model[1]!;
          const distanceSq = dx * dx + dy * dy;
          if (rings.some(circle => {
            const minimum = Math.max(0, circle.radius - margin);
            const maximum = circle.radius + margin;
            return distanceSq >= minimum * minimum && distanceSq <= maximum * maximum;
          })) {
            sites.push({ x, y, value: field[y * sourceWidth + x]! });
          }
        }
      }
      const coverage = (left: number, top: number, dx: number, dy: number) => {
        const a = left - model[0]!, b = top - model[1]!;
        let value = 0;
        for (let i = 2; i < model.length; i += 1) {
          const disk = circleCoverage(a, b, a + dx, b + dy, model[i]!);
          value += i % 2 ? -disk : disk;
        }
        return value;
      };
      const measure = (dark: boolean) => {
        let error = 0, largest = 0;
        for (const site of sites) {
          const expected = coverage(site.x, site.y, 1, 1);
          const difference = Math.abs(expected - (dark ? 1 - site.value : site.value));
          error += difference ** 2;
          largest = Math.max(largest, difference);
        }
        return { error, largest };
      };
      const dark = measure(true).error < measure(false).error;
      let fit = measure(dark);
      const multiple = size === 4;
      if (fit.error / sites.length > (multiple ? 0.075 : 0.055) ** 2 || fit.largest > (multiple ? 0.30 : 0.24)) continue;
      for (const step of [0.08, 0.04, 0.02]) {
        for (let parameter = 0; parameter < model.length; parameter += 1) {
          const previous = model[parameter]!;
          model[parameter] = previous + step;
          const plus = measure(dark);
          model[parameter] = previous - step;
          const minus = measure(dark);
          if (plus.error < fit.error && plus.error <= minus.error) {
            model[parameter] = previous + step;
            fit = plus;
          } else if (minus.error < fit.error) {
            fit = minus;
          } else {
            model[parameter] = previous;
          }
        }
      }
      const fullFit = fit.error / sites.length <= 0.038 ** 2 && fit.largest <= 0.13;
      if (!fullFit && !multiple) continue;
      const sectorCount = 16;
      const sectorAt = (x: number, y: number) => (Math.atan2(y - model[1]!, x - model[0]!) / (2 * Math.PI) + 1) * sectorCount % sectorCount;
      const sectors = fullFit ? undefined : Array.from({ length: sectorCount }, () => ({ count: 0, prior: 0, error: 0, largest: 0 }));
      let originalError = 0;
      for (const site of sites) {
        let area = 0;
        for (let j = 0; j < sy; j += 1) {
          for (let i = 0; i < sx; i += 1) area += mask[(site.y * sy + j) * width + site.x * sx + i]!;
        }
        const prior = (area / (sx * sy) - site.value) ** 2;
        originalError += prior;
        if (sectors) {
          const section = sectors[Math.floor(sectorAt(site.x + 0.5, site.y + 0.5))]!;
          const fitted = coverage(site.x, site.y, 1, 1);
          const delta = Math.abs(fitted - (dark ? 1 - site.value : site.value));
          section.count += 1;
          section.prior += prior;
          section.error += delta ** 2;
          section.largest = Math.max(section.largest, delta);
        }
      }
      if (fullFit && fit.error >= originalError) continue;
      // Other paths can cross a small part of otherwise supported rings.
      // Use the fit along measured arcs and ease out near those crossings.
      const accepted = sectors?.map(section => section.count > 0 && section.largest <= 0.13
        && section.error < section.count * 0.048 ** 2 && section.error < section.prior + section.count * 0.00035);
      if (accepted && accepted.filter(Boolean).length < 4) continue;
      const weightAt = (x: number, y: number) => {
        if (!accepted) return 1;
        const location = sectorAt(x, y), index = Math.floor(location);
        if (!accepted[index]) return 0;
        const from = accepted[(index + sectorCount - 1) % sectorCount] ? 1 : (location - index) * 3;
        const to = accepted[(index + 1) % sectorCount] ? 1 : (index + 1 - location) * 3;
        return Math.min(1, from, to);
      };
      for (const site of sites) {
        const weight = weightAt(site.x + 0.5, site.y + 0.5);
        if (!weight) continue;
        for (let j = 0; j < sy; j += 1) {
          for (let i = 0; i < sx; i += 1) {
            const alpha = coverage(site.x + i / sx, site.y + j / sy, 1 / sx, 1 / sy);
            const p = (site.y * sy + j) * width + site.x * sx + i;
            mask[p]! += weight * ((dark ? 1 - alpha : alpha) - mask[p]!);
          }
        }
        if (soft) soft[site.y * sourceWidth + site.x]! *= 1 - weight;
      }
      for (const ring of rings) completed.add(ring);
      break;
    }
  }
}

function coverageBounds(field: Float64Array, sourceWidth: number, sourceHeight: number, threshold: number) {
  let left = sourceWidth, right = 0, top = sourceHeight, bottom = 0;
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      if (field[y * sourceWidth + x]! <= threshold) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return { left, right, top, bottom };
}

/** Restore a sampled silhouette edge in the first or last source row. */
function restoreFrameEdges(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  for (const horizontal of [true, false]) {
    const along = horizontal ? 1 : sourceWidth, inward = horizontal ? sourceWidth : 1;
    const alongSize = horizontal ? sourceWidth : sourceHeight;
    const inwardSize = horizontal ? sourceHeight : sourceWidth;
    const alongScale = horizontal ? sx : sy, inwardScale = horizontal ? sy : sx;
    if (inwardSize < 3) continue;
    for (const end of [false, true]) {
      const row = end ? inwardSize - 1 : 0;
      const step = end ? -inward : inward;
      for (let u = 2; u < alongSize - 2; u += 1) {
        const p = row * inward + u * along;
        const current = field[p]!;
        if (current < 0.065 || current > 0.94 || field[p + step]! < 0.975) continue;
        const samples = [-2, -1, 0, 1, 2].map(i => field[p + i * along]!);
        if (samples.some((a, i) => a < 0.025 || a > 0.97
          || field[p + (i - 2) * along + step]! < 0.975)) continue;
        const slope = (samples[4]! - samples[0]!) / 4;
        const bend = (samples[4]! + samples[0]! - 2 * current) / 8;
        if (Math.abs(slope) + 3 * Math.abs(bend) > 0.39 || (Math.abs(slope) < 0.006 && Math.abs(bend) < 0.002)
          || Math.abs(samples[1]! - (current - slope + bend)) > 0.026
          || Math.abs(samples[3]! - (current + slope + bend)) > 0.026) continue;
        for (let i = 0; i < alongScale; i += 1) {
          const across = (i + 0.5) / alongScale - 0.5;
          const amount = current + slope * across + bend * (across ** 2 + (1 / alongScale ** 2 - 1) / 12);
          const projected = Math.abs(slope + 2 * bend * across) / alongScale;
          const column = u * alongScale + i;
          for (let j = 0; j < inwardScale * 2; j += 1) {
            const fromFrame = (j + 0.5) / inwardScale;
            const target = end ? inwardSize * inwardScale - j - 1 : j;
            const index = horizontal ? target * width + column : column * width + target;
            mask[index] = edgeArea(fromFrame + amount - 1,
              Math.max(1 / inwardScale, projected), Math.min(1 / inwardScale, projected));
          }
        }
        if (soft) {
          soft[p] = 0;
          soft[p + step] = 0;
        }
      }
    }
  }
}

/** Recover an enclosing circular band even if its inner contour joins other shapes. */
function restoreOuterCircularBand(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  const { left, right, top, bottom } = coverageBounds(field, sourceWidth, sourceHeight, 0.035);
  const spanX = right - left, spanY = bottom - top;
  if (Math.min(spanX, spanY) < 16 || Math.abs(spanX - spanY) > 1) return;
  const cx = (left + right) / 2, cy = (top + bottom) / 2, radius = (spanX + spanY) / 4;
  const radialSample = (angle: number, r: number) => {
    const x = Math.floor(cx + r * Math.cos(angle)), y = Math.floor(cy + r * Math.sin(angle));
    return x < 0 || x >= sourceWidth || y < 0 || y >= sourceHeight ? 0 : field[y * sourceWidth + x]!;
  };
  let support = 0;
  for (let i = 0; i < 32; i += 1) {
    const angle = i * 2 * Math.PI / 32;
    if (radialSample(angle, radius - 0.65) > 0.07 && radialSample(angle, radius + 1.15) < 0.07) support += 1;
  }
  if (support < 29) return;

  for (const horizontal of [false, true]) {
    const alongSize = horizontal ? sourceHeight : sourceWidth;
    const acrossSize = horizontal ? sourceWidth : sourceHeight;
    const alongScale = horizontal ? sy : sx, acrossScale = horizontal ? sx : sy;
    const centerAlong = horizontal ? cy : cx, centerAcross = horizontal ? cx : cy;
    for (const mirrored of [false, true]) {
      const center = mirrored ? acrossSize - centerAcross : centerAcross;
      const disk = (u: number, v: number, du: number, dv: number) =>
        circleCoverage(u - centerAlong, v - center, u + du - centerAlong, v + dv - center, radius);
      const sources = (u: number, v: number) => {
        const across = mirrored ? acrossSize - v - 1 : v;
        return horizontal ? u * sourceWidth + across : across * sourceWidth + u;
      };
      const sections: Array<{ first: number; last: number; edge: number } | undefined> = [];
      for (let u = 0; u < alongSize; u += 1) {
        const axis = u + 0.5 - centerAlong;
        if (Math.abs(axis) > radius * 0.77) continue;
        const outer = center - Math.sqrt(radius ** 2 - axis ** 2);
        const first = Math.max(0, Math.floor(outer) - 1);
        let mass = 0, outerArea = 0, seenBand = false;
        for (let v = first; v < Math.min(acrossSize, first + 8); v += 1) {
          const source = field[sources(u, v)]!;
          const coverage = disk(u, v, 1, 1);
          if (source > coverage + 0.08) break;
          if (seenBand && source <= 0.025) {
            if (mass >= 0.30 && mass <= 5 && coverage >= 0.98) {
              sections[u] = { first, last: v, edge: v - outerArea + mass };
            }
            break;
          }
          seenBand ||= source > 0.06;
          mass += source;
          outerArea += coverage;
        }
      }
      for (let u = 2; u < alongSize - 2; u += 1) {
        if (Math.abs(u + 0.5 - centerAlong) > radius * Math.SQRT1_2) continue;
        const a = sections[u - 2], b = sections[u - 1], middle = sections[u], c = sections[u + 1], d = sections[u + 2];
        if (!a || !b || !middle || !c || !d) continue;
        const slope = (d.edge - a.edge) / 4;
        const bend = (a.edge + d.edge - 2 * middle.edge) / 8;
        const { first, last, edge } = middle;
        if (Math.abs(slope) > 1.1 || Math.abs(bend) > 0.066
          || Math.abs(b.edge - (edge - slope + bend)) > 0.1 || Math.abs(c.edge - (edge + slope + bend)) > 0.1) continue;
        const coverage = (along: number, across: number, du: number, dv: number) => {
          const position = along + du / 2 - u - 0.5;
          const cut = edge + slope * position + bend * (position ** 2 + (du ** 2 - 1) / 12);
          const drift = Math.abs(slope + 2 * bend * position) * du;
          const inner = edgeArea(across + dv / 2 - cut, Math.max(dv, drift), Math.min(dv, drift));
          return clamp01(disk(along, across, du, dv) - inner);
        };
        const target = (i: number, j: number) => {
          const v = mirrored ? acrossSize * acrossScale - j - 1 : j;
          return horizontal ? i * width + v : v * width + i;
        };
        let supported = true;
        for (let v = first; v <= last; v += 1) {
          if (Math.abs(coverage(u, v, 1, 1) - field[sources(u, v)]!) > 0.07) supported = false;
        }
        if (!supported) continue;
        for (let v = first; v <= last; v += 1) {
          for (let i = 0; i < alongScale; i += 1) {
            for (let j = 0; j < acrossScale; j += 1) {
              mask[target(u * alongScale + i, v * acrossScale + j)] = coverage(u + i / alongScale,
                v + j / acrossScale, 1 / alongScale, 1 / acrossScale);
            }
          }
          if (soft) soft[sources(u, v)] = 0;
        }
      }
    }
  }
}

/** Fit both boundaries of a thin diamond frame, including its vertices. */
function restoreDiamondFrame(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  const { left, right, top, bottom } = coverageBounds(field, sourceWidth, sourceHeight, 0.12);
  const spanX = right - left, spanY = bottom - top;
  if (Math.min(spanX, spanY) < 16 || Math.abs(spanX - spanY) > 1) return;
  const radius = (spanX + spanY) / 4;
  let cx = (left + right) / 2, cy = (top + bottom) / 2;
  let outer = radius + 0.18, inner = radius - 1.18;
  const area = (x: number, y: number, dx: number, dy: number, outside: number, inside: number) => {
    let covered = 0;
    // Split at the center axes so each piece sees two parallel straight edges.
    const band = (a: number, b: number, w: number, h: number) => {
      const distance = Math.abs(a + w / 2 - cx) + Math.abs(b + h / 2 - cy);
      return (edgeArea(outside - distance, Math.max(w, h), Math.min(w, h))
        - edgeArea(inside - distance, Math.max(w, h), Math.min(w, h))) * w * h;
    };
    const firstX = x < cx && x + dx > cx ? cx - x : dx;
    const firstY = y < cy && y + dy > cy ? cy - y : dy;
    covered += band(x, y, firstX, firstY);
    if (firstX < dx) covered += band(x + firstX, y, dx - firstX, firstY);
    if (firstY < dy) covered += band(x, y + firstY, firstX, dy - firstY);
    if (firstX < dx && firstY < dy) covered += band(x + firstX, y + firstY, dx - firstX, dy - firstY);
    return clamp01(covered / (dx * dy));
  };
  const sites: Array<{ x: number; y: number; sample: number; quadrant: number }> = [];
  const supported = [0, 0, 0, 0], possible = [0, 0, 0, 0];
  for (let y = Math.max(0, top - 1); y < Math.min(sourceHeight, bottom + 1); y += 1) {
    for (let x = Math.max(0, left - 1); x < Math.min(sourceWidth, right + 1); x += 1) {
      if (Math.abs(Math.abs(x + 0.5 - cx) + Math.abs(y + 0.5 - cy) - radius) > 3) continue;
      const predicted = area(x, y, 1, 1, outer, inner);
      const sample = field[y * sourceWidth + x]!;
      const quadrant = Number(x + 0.5 > cx) + 2 * Number(y + 0.5 > cy);
      if (predicted >= 0.18) {
        possible[quadrant]! += 1;
        if (Math.abs(sample - predicted) <= 0.15) supported[quadrant]! += 1;
      }
      if (Math.abs(sample - predicted) <= 0.29) sites.push({ x, y, sample, quadrant });
    }
  }
  if (supported.some((count, i) => count < 10 || count < possible[i]! * 0.56)) return;
  const measure = (outside: number, inside: number) => sites.reduce((sum, { x, y, sample }) =>
    sum + (area(x, y, 1, 1, outside, inside) - sample) ** 2, 0);
  let error = measure(outer, inner);
  for (const step of [0.16, 0.08, 0.04, 0.02, 0.01]) {
    const startX = cx, startY = cy;
    let bestX = cx, bestY = cy;
    for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      cx = startX + a * step;
      cy = startY + b * step;
      const loss = measure(outer, inner);
      if (loss >= error) continue;
      error = loss;
      bestX = cx;
      bestY = cy;
    }
    cx = bestX;
    cy = bestY;
    let bestOuter = outer, bestInner = inner;
    for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const candidateOuter = outer + a * step, candidateInner = inner + b * step;
      const loss = measure(candidateOuter, candidateInner);
      if (loss >= error) continue;
      error = loss;
      bestOuter = candidateOuter;
      bestInner = candidateInner;
    }
    outer = bestOuter;
    inner = bestInner;
  }
  if (error / sites.length > 0.07 ** 2) return;
  supported.fill(0);
  for (const { x, y, sample, quadrant } of sites) {
    const fitted = area(x, y, 1, 1, outer, inner);
    if (fitted >= 0.18 && Math.abs(fitted - sample) <= 0.09) supported[quadrant]! += 1;
  }
  if (supported.some((count, i) => count < 10 || count < possible[i]! * 0.72)) return;
  for (const { x, y, sample } of sites) {
    const fitted = area(x, y, 1, 1, outer, inner);
    if (Math.abs(fitted - sample) > 0.09 || (fitted < 0.012 && sample > 0.02)) continue;
    for (let j = 0; j < sy; j += 1) {
      for (let i = 0; i < sx; i += 1) {
        mask[(y * sy + j) * width + x * sx + i] = area(x + i / sx, y + j / sy, 1 / sx, 1 / sy, outer, inner);
      }
    }
    if (soft) soft[y * sourceWidth + x] = 0;
  }

  // A marker can be split by a wider gap on both sides of the diamond.
  // Fit the rectangle and that gap together so their coverage never overlaps.
  for (const across of [-1, 1]) {
    for (const along of [-1, 1]) {
      const markerX = cx + across * radius / 2, markerY = cy + along * radius / 2;
      const x0 = Math.max(0, Math.floor(markerX - 5.5)), x1 = Math.min(sourceWidth, Math.ceil(markerX + 5.5));
      const y0 = Math.max(0, Math.floor(markerY - 5.5)), y1 = Math.min(sourceHeight, Math.ceil(markerY + 5.5));
      const columns = new Float64Array(x1 - x0), rows = new Float64Array(y1 - y0);
      const patch: Array<{ x: number; y: number; sample: number; frame: number }> = [];
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const frame = area(x, y, 1, 1, outer, inner), sample = field[y * sourceWidth + x]!;
          patch.push({ x, y, sample, frame });
          if (frame > 0.025) continue;
          columns[x - x0] = Math.max(columns[x - x0]!, sample);
          rows[y - y0] = Math.max(rows[y - y0]!, sample);
        }
      }
      const interval = (profile: Float64Array, start: number) => {
        const first = profile.findIndex(value => value > 0.14);
        let last = profile.length - 1;
        while (last > first && profile[last]! <= 0.14) last -= 1;
        if (first < 1 || last >= profile.length - 1 || last - first < 3 || last - first > 9) return;
        return [start + first + 1 - profile[first]!, start + last + profile[last]!] as const;
      };
      const horizontal = interval(columns, x0), vertical = interval(rows, y0);
      if (!horizontal || !vertical) continue;
      const model = [...horizontal, ...vertical, inner - 1.35, outer + 1.35];
      const marker = (x: number, y: number, dx: number, dy: number) => {
        const left = Math.max(x, model[0]!), right = Math.min(x + dx, model[1]!);
        const top = Math.max(y, model[2]!), bottom = Math.min(y + dy, model[3]!);
        if (right <= left || bottom <= top) return 0;
        const w = right - left, h = bottom - top;
        return (1 - area(left, top, w, h, model[5]!, model[4]!)) * w * h / (dx * dy);
      };
      const measureMarker = () => patch.reduce((sum, { x, y, sample, frame }) =>
        sum + (frame + marker(x, y, 1, 1) - sample) ** 2, 0);
      let markerError = measureMarker();
      if (markerError / patch.length > 0.17 ** 2) continue;
      for (const step of [0.4, 0.2, 0.1, 0.05, 0.025]) {
        for (let i = 0; i < model.length; i += 1) {
          const previous = model[i]!;
          let fitted = previous;
          for (const direction of [-1, 1]) {
            const value = previous + direction * step;
            if ((i === 4 && value > inner) || (i === 5 && value < outer)) continue;
            model[i] = value;
            const candidateError = measureMarker();
            if (candidateError >= markerError) continue;
            markerError = candidateError;
            fitted = value;
          }
          model[i] = fitted;
        }
      }
      if (markerError / patch.length > 0.055 ** 2) continue;
      for (const { x, y, sample, frame } of patch) {
        if (Math.abs(frame + marker(x, y, 1, 1) - sample) > 0.14) continue;
        for (let j = 0; j < sy; j += 1) {
          for (let i = 0; i < sx; i += 1) {
            const px = x + i / sx, py = y + j / sy;
            mask[(y * sy + j) * width + x * sx + i] = clamp01(area(px, py, 1 / sx, 1 / sy, outer, inner)
              + marker(px, py, 1 / sx, 1 / sy));
          }
        }
        if (soft) soft[y * sourceWidth + x] = 0;
      }
    }
  }
}

/** Reconstruct both edges of a narrow stroke or gap from shared pixel areas. */
function restorePairedEdges(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2) return;
  const bandArea = (half: number, distance: number, across: number, first: number, second: number) =>
    edgeArea(half + distance, Math.max(across, first), Math.min(across, first))
    - edgeArea(-half + distance, Math.max(across, second), Math.min(across, second));
  const profiles = new Float64Array(45);
  const directions = [[1, 0], [sourceWidth, 0], [sourceWidth, 1], [sourceWidth, -1]] as const;
  const windows = [[2, false], [1, false], [2, true], [1, true], [4, false]] as const;
  const layouts = windows.flatMap(([span, compact]) => directions.map(([normal, shear]) => ({ normal, shear, span, compact })));
  for (let y = 2; y < sourceHeight - 2; y += 1) {
    for (let x = 2; x < sourceWidth - 2; x += 1) {
      const p = y * sourceWidth + x;
      for (const { normal, shear, span, compact } of layouts) {
        const short = span === 1;
        const shortCompact = short && compact;
        const fineBand = span === 4;
        const diagonalFine = fineBand && !!shear;
        const reach = span + 2;
        if (fineBand && (x < span || x + span >= sourceWidth || y < span || y + span >= sourceHeight)) continue;
        if (shear && (y < reach || y + reach >= sourceHeight)) continue;
        const tangent = normal === 1 ? sourceWidth : 1;
        // Offset each section with the direction of a steep diagonal, so its
        // edges remain inside the sampled strip across all five sections.
        const advance = tangent + shear * normal;
        const dark = compact ? field[p - normal]! + field[p + normal]! > 2 * field[p]!
          : field[p - 2 * normal]! > 0.9;
        const phase = (index: number) => dark ? 1 - field[index]! : field[index]!;
        const sample = phase(p);
        const split = Math.max(phase(p - normal), phase(p + normal));
        const faintBand = fineBand && sample < 0.2;
        // When the centerline runs between two texel centers, each side of
        // a narrow taper can stay below the normal per-texel support level.
        const outside = Math.max(phase(p - 2 * normal), phase(p + 2 * normal));
        const splitTaper = !fineBand && !short && !compact && sample >= 0.08 && sample < 0.4 && split >= 0.11 && split < 0.67;
        const supported = fineBand ? sample >= 0.065 && sample < (diagonalFine ? 0.82 : 0.51) && split <= sample + 0.035
          && sample + phase(p - normal) + phase(p + normal) <= (diagonalFine ? 1.6 : 0.86)
          : splitTaper || sample >= (shortCompact ? 0.41 : short || compact ? 0.52 : 0.4);
        // A compact band can cover more than half of a neighboring texel
        // when its center is off grid. Let the measured width, area and
        // containment checks below distinguish it from the next band.
        if (!supported || (compact ? outside <= 0.04 || split > 0.72 || sample - split < 0.07 : outside > 0.04)) continue;
        if (shear && Math.min(phase(p - advance), phase(p + advance)) < (faintBand ? 0.055 : diagonalFine ? 0.2 : 0.33)) continue;
        const acrossSpan = compact || (fineBand && !diagonalFine && !faintBand) ? 1 : 2;
        const masses: number[] = [], centers: number[] = [];
        const resolved: Array<{ section: number; center: number }> = [];
        for (let u = -span; u <= span; u += 1) {
          let mass = 0, moment = 0;
          let first = acrossSpan + 1, last = -acrossSpan - 1;
          for (let v = -acrossSpan; v <= acrossSpan; v += 1) {
            const alpha = phase(p + u * advance + v * normal);
            profiles[(u + span) * 5 + v + 2] = alpha;
            mass += alpha;
            moment += v * alpha;
            if ((compact || fineBand) && alpha > (faintBand ? 0.018 : fineBand ? 0.025 : 0.012)) {
              first = Math.min(first, v);
              last = v;
            }
          }
          if (mass < (faintBand ? 0.055 : fineBand ? 0.22 : splitTaper || shortCompact ? 0.36 : 0.48)
            || mass > (fineBand && !diagonalFine ? 0.95 : 1.6)) break;
          masses.push(mass);
          const base = (u + span) * 5 + 2;
          const center = first < last
            ? (first + last + profiles[base + last]! - profiles[base + first]!) / 2 : moment / mass;
          if (fineBand && first < last) resolved.push({ section: u, center });
          centers.push(center);
        }
        if (masses.length !== 2 * span + 1 || (fineBand && resolved.length < 3)
          || (faintBand && Math.max(...masses) < 0.26)) continue;
        if (shortCompact) {
          // Both sides must be resolved somewhere along this short run. A
          // ridge confined to its middle sample gives only a width estimate.
          let left = 0, right = 0;
          for (let u = -span; u <= span; u += 1) {
            left += profiles[(u + span) * 5 + 1]!;
            right += profiles[(u + span) * 5 + 3]!;
          }
          if (Math.min(left, right) < 0.075) continue;
        }
        const half = masses.reduce((sum, value) => sum + value, 0) / (2 * masses.length);
        const taper = masses.reduce((sum, value, i) => sum + (i - span) * value, 0) / (short ? 4 : fineBand ? 120 : 20);
        if (splitTaper && Math.abs(taper) < 0.012) continue;
        const uneven = masses.some((value, i) => Math.abs(value - 2 * (half + taper * (i - span))) > 0.045);
        if (Math.abs(taper) > 0.12 || (uneven && (short || splitTaper
          || masses.some((value, i) => i > 0 && Math.abs(value - masses[i - 1]!) > 0.34)))) continue;
        // The centerline can be coherent even when the authored band changes
        // width. In that case use each cross-section's measured area.
        const widths = uneven || fineBand ? masses.map(mass => mass / 2) : undefined;
        const tapers = widths?.map((_, i) => {
          const previous = Math.max(0, i - 1), next = Math.min(widths.length - 1, i + 1);
          return (widths[next]! - widths[previous]!) / (next - previous);
        });
        const measure = (center: number, slope: number, bend: number) => {
          let error = 0;
          for (let u = -span; u <= span; u += 1) {
            const mid = center + u * slope + bend * (u * u + 1 / 12);
            const derivative = slope + shear + 2 * bend * u;
            const local = tapers?.[u + span] ?? taper;
            const first = Math.abs(derivative + local);
            const second = Math.abs(derivative - local);
            for (let v = -acrossSpan; v <= acrossSpan; v += 1) {
              const predicted = bandArea(widths?.[u + span] ?? half + taper * u, mid - v, 1, first, second);
              error += (predicted - profiles[(u + span) * 5 + v + 2]!) ** 2;
            }
          }
          return error;
        };
        let center = centers[span]!;
        let slope = (centers[2 * span]! - centers[0]!) / (2 * span);
        if (fineBand) {
          // Partially covered neighboring texels locate both edges. A
          // section contained in one texel determines width but not center.
          const first = resolved[0]!, last = resolved[resolved.length - 1]!;
          if (!diagonalFine && Math.abs(last.center - first.center) < 0.075) continue;
          slope = (last.center - first.center) / (last.section - first.section);
          center = resolved.reduce((sum, point) => sum + point.center - slope * point.section, 0) / resolved.length;
        }
        if (Math.abs(center) > 0.65 || Math.abs(slope) > (shear ? 0.28 : 0.72)) continue;
        let bend = 0;
        let error = measure(center, slope, bend);
        // Sample the two parameters jointly. The fit can distinguish a
        // shifted thin band from distortion of its two independent edges.
        for (const step of [0.12, 0.06, 0.03, 0.015]) {
          let nextCenter = center, nextSlope = slope;
          for (let dc = -1; dc <= 1; dc += 1) {
            for (let ds = -1; ds <= 1; ds += 1) {
              if (!dc && !ds) continue;
              const candidateCenter = center + dc * step, candidateSlope = slope + ds * step / 2;
              const candidateError = measure(candidateCenter, candidateSlope, bend);
              if (candidateError >= error) continue;
              nextCenter = candidateCenter;
              nextSlope = candidateSlope;
              error = candidateError;
            }
          }
          center = nextCenter;
          slope = nextSlope;
        }
        // Curved bands can still supply both edges when their cross-sections
        // follow the same local arc and the native area confirms that arc.
        if (!short && error > (fineBand ? 0.0005 : 0.003) && error < 0.13) {
          for (const step of [0.04, 0.02, 0.01, 0.005]) {
            let nextCenter = center, nextSlope = slope, nextBend = bend;
            for (const [dc, ds, db] of [
              [-2, 0, 0], [2, 0, 0], [0, -1, 0], [0, 1, 0], [-1, 0, 1], [1, 0, -1], [0, 0, -1], [0, 0, 1],
            ] as const) {
              const candidateCenter = center + dc * step;
              const candidateSlope = slope + ds * step;
              const candidateBend = bend + db * step;
              if (Math.abs(candidateBend) > 0.066) continue;
              const candidateError = measure(candidateCenter, candidateSlope, candidateBend);
              if (candidateError >= error) continue;
              error = candidateError;
              nextCenter = candidateCenter;
              nextSlope = candidateSlope;
              nextBend = candidateBend;
            }
            center = nextCenter;
            slope = nextSlope;
            bend = nextBend;
          }
        }
        const centered = Math.abs(center);
        if (centered >= (short || compact ? 0.49 : 0.56) || (splitTaper && centered < 0.28)
          || Math.abs(slope) >= (shear ? 0.28 : 0.7)
          || error > (faintBand ? 0.009 : fineBand ? 0.025 : shortCompact ? 0.0009 : short || compact ? 0.0018 : uneven ? 0.006 : 0.0045)) continue;
        if (compact || fineBand) {
          // The tighter window must contain the entire fitted stroke. A
          // neighboring stripe beyond it supplies no evidence for this fit.
          let contained = true;
          for (let u = -span; u <= span; u += 1) {
            const position = center + slope * u + bend * u * u;
            const spread = (Math.abs(slope + shear + 2 * bend * u) + Math.abs(tapers?.[u + span] ?? taper)) * 0.5;
            if (Math.abs(position) + (widths?.[u + span] ?? half + taper * u) + spread > acrossSpan + 0.49) contained = false;
          }
          if (!contained) continue;
        }
        slope += shear;
        const middleWidth = widths?.[span] ?? half, middleTaper = tapers?.[span] ?? taper;
        const acrossX = normal === 1;
        const acrossStep = 1 / (acrossX ? sx : sy), alongStep = 1 / (acrossX ? sy : sx);
        const renderSpan = diagonalFine || faintBand ? 2 : 1;
        // A shorter observation can be enough near a compact feature. Require
        // it to improve the central strip's source coverage before using it.
        if (short || compact || fineBand || splitTaper || centered >= 0.49 || uneven) {
          let before = 0, after = 0;
          for (let v = -renderSpan; v <= renderSpan; v += 1) {
            const tx = x + (acrossX ? v : 0), ty = y + (acrossX ? 0 : v);
            const expected = phase(p + v * normal);
            let area = 0;
            for (let j = 0; j < sy; j += 1) {
              for (let i = 0; i < sx; i += 1) area += mask[(ty * sy + j) * width + tx * sx + i]!;
            }
            const previous = dark ? 1 - area / (sx * sy) : area / (sx * sy);
            const next = bandArea(middleWidth, center - v, 1, Math.abs(slope + middleTaper), Math.abs(slope - middleTaper));
            before += (previous - expected) ** 2;
            after += (next - expected) ** 2;
          }
          const improvement = fineBand || (compact && error < 0.00025) ? 0.0002 : 0.001;
          if (after + improvement >= before || (fineBand && after > 0.0025)) continue;
        }
        // Update only the middle cross-section. Neighboring strips are
        // rendered from their own fitted pair, with overlapping evidence.
        for (let v = -renderSpan; v <= renderSpan; v += 1) {
          const tx = x + (acrossX ? v : 0), ty = y + (acrossX ? 0 : v);
          for (let j = 0; j < sy; j += 1) {
            for (let i = 0; i < sx; i += 1) {
              const dx = (i + 0.5) / sx - 0.5, dy = (j + 0.5) / sy - 0.5;
              const u = acrossX ? dy : dx;
              const distance = center + slope * u + bend * u * u - v - (acrossX ? dx : dy);
              const rate = slope + 2 * bend * u;
              const alpha = bandArea(middleWidth + middleTaper * u, distance, acrossStep,
                Math.abs(rate + middleTaper) * alongStep, Math.abs(rate - middleTaper) * alongStep);
              mask[(ty * sy + j) * width + tx * sx + i] = dark ? 1 - alpha : alpha;
            }
          }
          if (soft) soft[ty * sourceWidth + tx] = 0;
        }
        break;
      }
    }
  }
}

/** Fit both boundaries of a slanted or tapering hairline from source cross-sections. */
function restoreSlantedHairlines(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2) return;
  const minWidth = 0.32, maxWidth = 0.91;
  for (const acrossX of [false, true]) {
    const across = acrossX ? 1 : sourceWidth, along = acrossX ? sourceWidth : 1;
    const acrossSize = acrossX ? sourceWidth : sourceHeight, alongSize = acrossX ? sourceHeight : sourceWidth;
    const acrossScale = acrossX ? sx : sy, alongScale = acrossX ? sy : sx;
    const fits = new Map<number, {
      section: number; center: number; slope: number; mass: number; rate: number;
      low: number; high: number; dark: boolean; opacity: number; error: number;
    }>();
    const bandArea = (distance: number, mass: number, acrossSpan: number, alongSpan: number, slope: number, rate: number) => {
      const lower = alongSpan * Math.abs(slope - rate / 2);
      const upper = alongSpan * Math.abs(slope + rate / 2);
      return edgeArea(distance + mass / 2, Math.max(acrossSpan, upper), Math.min(acrossSpan, upper))
        - edgeArea(distance - mass / 2, Math.max(acrossSpan, lower), Math.min(acrossSpan, lower));
    };
    for (let u = 1; u < alongSize - 1; u += 1) {
      for (let v = 3; v < acrossSize - 3; v += 1) {
        const index = u * along + v * across;
        const level = field[index]!;
        if (level < 0.085 || level > 0.945) continue;
        const left = field[index - across]!, right = field[index + across]!;
        const dark = left + right > 2 * level;
        const phase = (p: number) => dark ? 1 - field[p]! : field[p]!;
        const profile = (section: number, previousCenter: number, seed: boolean) => {
          const base = section * along;
          const expected = Math.round(previousCenter);
          if (expected < 3 || expected >= acrossSize - 3) return;
          let peak = expected;
          if (!seed) {
            for (const candidate of [expected - 1, expected + 1]) {
              if (phase(base + candidate * across) > phase(base + peak * across)) peak = candidate;
            }
          }
          const core = phase(base + peak * across);
          if (core < (dark ? 0.14 : 0.085) || core > (dark ? maxWidth : 0.945)) return;
          const low = phase(base + (peak - 1) * across), high = phase(base + (peak + 1) * across);
          if (Math.max(low, high) > core || (low === core && low > 0)) return;
          // An adjoining stroke or an unresolved junction is not evidence
          // for the hairline. Require the sampled profile to return to its background.
          const outerLow = phase(base + (peak - 2) * across), outerHigh = phase(base + (peak + 2) * across);
          // A shallow valley can separate a second dark slit from this one.
          // Keep that neighboring slit outside the fitted window.
          const separated = (inner: number, outer: number) => (dark || core < 0.5)
            && inner < 0.105 && outer >= inner + 0.025;
          const start = separated(low, outerLow) ? -1 : -2;
          const end = separated(high, outerHigh) ? 1 : 2;
          const farLow = start === -2 ? outerLow : 0, farHigh = end === 2 ? outerHigh : 0;
          if (Math.max(farLow, farHigh) > 0.125) return;
          const mass = low + core + high + farLow + farHigh;
          if (mass < (dark ? minWidth : 0.105) || mass > (dark ? maxWidth : 1.25)) return;
          const center = peak + (high - low + 2 * (farHigh - farLow)) / mass;
          if (Math.abs(center - previousCenter) > (seed ? 0.61 : 1.05)) return;
          const minor = Math.max(low, high);
          const splitCenter = minor > 0.035 && Math.min(low, high) < 0.025
            ? peak + Math.sign(high - low) * (1 + minor - core) / 2 : center;
          return { section, center, mass, splitCenter, resolved: minor > 0.035, peak, start, end };
        };
        const middle = profile(u, v, true);
        if (!middle) continue;
        if (middle.mass < 0.52 && (fits.get(index)?.error ?? Infinity) < 0.0015) continue;
        const profiles = [middle];
        for (const direction of [-1, 1]) {
          let center = middle.center;
          let previousMass = middle.mass;
          for (let i = 1; i <= 6; i += 1) {
            const section = u + direction * i;
            if (section < 0 || section >= alongSize) break;
            const next = profile(section, center, false);
            if (!next || Math.abs(next.mass - (dark ? middle.mass : previousMass)) > 0.18) break;
            profiles.push(next);
            center = next.center;
            previousMass = next.mass;
          }
        }
        if (profiles.length < 8) continue;
        let sumU = 0, sumV = 0, sumUU = 0, sumUV = 0, sumMass = 0, sumUMass = 0;
        for (const p of profiles) {
          const offset = p.section - u;
          sumU += offset;
          sumV += p.center;
          sumUU += offset * offset;
          sumUV += offset * p.center;
          sumMass += p.mass;
          sumUMass += offset * p.mass;
        }
        const count = profiles.length;
        const variance = count * sumUU - sumU * sumU;
        let slope = (count * sumUV - sumU * sumV) / variance;
        let center = (sumV - slope * sumU) / count;
        let mass = sumMass / count;
        const widthSlope = (count * sumUMass - sumU * sumMass) / variance;
        const faint = !dark && profiles.every(p => p.mass < 0.52) && Math.abs(widthSlope) < 0.014;
        const taper = !dark && Math.abs(widthSlope) >= 0.023
          && profiles.some(p => p.mass < minWidth) && profiles.some(p => p.mass > 0.51);
        let bend = 0, rate = 0, opacity = 1;
        if (taper) {
          const resolved = profiles.filter(p => p.resolved);
          if (resolved.length < 4 || Math.abs(widthSlope) > 0.13) continue;
          rate = widthSlope;
          mass -= rate * sumU / count;
          // A texel containing the entire stroke fixes its width, but does
          // not locate both edges. Estimate the curve from split samples.
          const n = resolved.length;
          const origin = resolved.reduce((sum, p) => sum + p.section - u, 0) / n;
          const average = resolved.reduce((sum, p) => sum + p.splitCenter, 0) / n;
          const meanSquare = resolved.reduce((sum, p) => sum + (p.section - u - origin) ** 2, 0) / n;
          let xx = 0, xq = 0, qq = 0, xy = 0, qy = 0;
          for (const p of resolved) {
            const x = p.section - u - origin, q = x * x - meanSquare, y = p.splitCenter - average;
            xx += x * x;
            xq += x * q;
            qq += q * q;
            xy += x * y;
            qy += q * y;
          }
          const determinant = xx * qq - xq * xq;
          if (determinant <= 1e-8) continue;
          bend = (xx * qy - xq * xy) / determinant;
          if (Math.abs(bend) > 0.048) continue;
          const tangent = (qq * xy - xq * qy) / determinant;
          slope = tangent - 2 * bend * origin;
          center = average - tangent * origin + bend * (origin * origin - meanSquare);
          if (resolved.some(p => {
            const x = p.section - u;
            return Math.abs(p.splitCenter - center - slope * x - bend * x * x) > 0.14;
          })) continue;
        } else if (faint) {
          if (Math.abs(slope) < 0.07 || Math.abs(slope) > 0.97 || mass < 0.16
            || profiles.some(p => Math.abs(p.center - center - (p.section - u) * slope) > 0.28
              || Math.abs(p.mass - mass) > 0.12)) continue;
          // Fit optical coverage and width jointly. A model with increased
          // width and lower opacity is only used if the sampled shoulders
          // support it, so opaque subpixel lines can retain their contrast.
          const measure = () => {
            if (opacity < 0.36 || opacity > 1 || mass / opacity > 1.15 || Math.abs(slope) > 0.97) return Infinity;
            let error = 0;
            for (const q of profiles) {
              const at = center + slope * (q.section - u);
              const base = q.section * along + q.peak * across;
              for (let j = q.start; j <= q.end; j += 1) {
                const predicted = opacity * bandArea(at - q.peak - j, mass / opacity, 1, 1, slope, 0);
                error += (predicted - field[base + j * across]!) ** 2;
              }
            }
            return error / count;
          };
          let best = measure();
          if (best > 0.028) continue;
          for (const step of [0.08, 0.04, 0.02, 0.01]) {
            const at = center, tangent = slope, level = opacity;
            let nextCenter = at, nextSlope = tangent, nextOpacity = level;
            for (const direction of [-1, 1]) {
              for (const [dc, ds, da] of [[step, 0, 0], [0, step / 4, 0], [0, 0, step * 2]] as const) {
                center = at + direction * dc;
                slope = tangent + direction * ds;
                opacity = level + direction * da;
                const error = measure() + (1 - opacity) * 0.00035;
                if (error >= best) continue;
                best = error;
                nextCenter = center; nextSlope = slope; nextOpacity = opacity;
              }
            }
            center = nextCenter; slope = nextSlope; opacity = nextOpacity;
          }
          if (best > 0.007) continue;
        } else if (Math.abs(slope) < 0.1 || profiles.some(p => p.mass < minWidth || p.mass > maxWidth
          || Math.abs(p.center - center - (p.section - u) * slope) > (dark ? 0.16 : 0.12))) continue;
        if (Math.abs(slope) > (faint ? 0.97 : 0.88)
          || profiles.some(p => Math.abs(p.mass - mass - rate * (p.section - u)) > (taper ? 0.092 : 0.115))) continue;
        const first = Math.min(...profiles.map(p => p.section));
        const last = Math.max(...profiles.map(p => p.section));
        // Allow the fitted edges to continue up to two sections beyond the
        // observed run, but only while those samples confirm their coverage.
        for (const direction of [-1, 1]) {
          const stop = direction < 0 ? Math.max(0, first - 2) : Math.min(alongSize - 1, last + 2);
          for (let section = u + (direction > 0 ? 1 : 0); (stop - section) * direction >= 0; section += direction) {
            const offset = section - u;
            const projected = center + slope * offset + bend * offset * offset;
            const tangent = slope + 2 * bend * offset;
            const localMass = mass + rate * offset;
            if (localMass < (faint ? 0.16 : taper ? 0.08 : minWidth) || Math.abs(tangent) > (faint ? 0.97 : 0.92)) break;
            const peak = Math.round(projected);
            if (peak < 2 || peak + 2 >= acrossSize) break;
            const p = section * along + peak * across;
            const outerLow = phase(p - 2 * across), outerHigh = phase(p + 2 * across);
            const innerLow = phase(p - across), innerHigh = phase(p + across);
            const low = outerLow < 0.13 && ((!dark && !faint) || outerLow < innerLow + 0.025) ? -2 : -1;
            const high = outerHigh < 0.13 && ((!dark && !faint) || outerHigh < innerHigh + 0.025) ? 2 : 1;
            let plainError = 0, filteredError = 0, observed = 0;
            for (let j = low; j <= high; j += 1) {
              const sample = phase(p + j * across);
              const distance = projected - peak - j;
              const predicted = opacity * bandArea(distance, localMass / opacity, 1, 1, tangent, rate);
              const filtered = 0.88 * predicted + 0.06 * opacity * (
                bandArea(distance - 1, localMass / opacity, 1, 1, tangent, rate)
                + bandArea(distance + 1, localMass / opacity, 1, 1, tangent, rate)
              );
              observed += sample;
              plainError += (sample - predicted) ** 2;
              filteredError += (sample - filtered) ** 2;
            }
            const extended = section < first || section > last;
            const error = Math.min(plainError, filteredError + 0.002);
            if (error > (extended ? 0.031 : 0.025) || Math.abs(observed - localMass) > (taper ? 0.07 : 0.1)) break;
            const rank = error + (extended ? 0.006 : 0);
            if ((fits.get(p)?.error ?? Infinity) <= rank) continue;
            fits.set(p, { section, center: projected, slope: tangent, mass: localMass, rate,
              low: peak + low, high: peak + high, dark, opacity, error: rank });
          }
        }
      }
    }
    for (const fit of fits.values()) {
      const { section, center, slope, mass, rate, low, high, dark, opacity } = fit;
      for (let w = low; w <= high; w += 1) {
        const neighbors = [];
        for (let offset = -2; offset <= 2; offset += 1) {
          if (w + offset < 0 || w + offset >= acrossSize) continue;
          const neighbor = fits.get(section * along + (w + offset) * across);
          if (neighbor && neighbor !== fit && w >= neighbor.low && w <= neighbor.high) neighbors.push(neighbor);
        }
        for (let j = 0; j < alongScale; j += 1) {
          const alongOffset = (j + 0.5) / alongScale - 0.5;
          const projected = center + slope * alongOffset;
          const row = section * alongScale + j;
          for (let i = 0; i < acrossScale; i += 1) {
            const column = w * acrossScale + i;
            const acrossPosition = w + (i + 0.5) / acrossScale - 0.5;
            const distance = projected - acrossPosition;
            // Adjacent slits can share a source texel. Give each part of
            // that texel to the closer centerline.
            if (neighbors.some(neighbor => {
              const nextDistance = neighbor.center + neighbor.slope * alongOffset - acrossPosition;
              return Math.abs(nextDistance) < Math.abs(distance)
                || (Math.abs(nextDistance) === Math.abs(distance) && neighbor.center < center);
            })) continue;
            const alpha = opacity * bandArea(distance, (mass + rate * alongOffset) / opacity,
              1 / acrossScale, 1 / alongScale, slope, rate);
            mask[acrossX ? row * width + column : column * width + row] = dark ? 1 - alpha : alpha;
          }
        }
        if (soft) soft[section * along + w * across] = 0;
      }
    }
  }
}

/** Continue resolved straight bands through a narrowing fan. */
function restoreConvergingBands(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  for (const acrossX of [true, false]) {
    const across = acrossX ? 1 : sourceWidth, along = acrossX ? sourceWidth : 1;
    const acrossSize = acrossX ? sourceWidth : sourceHeight, alongSize = acrossX ? sourceHeight : sourceWidth;
    const acrossScale = acrossX ? sx : sy, alongScale = acrossX ? sy : sx;
    const lines = Array.from({ length: alongSize }, (_, row) => {
      if (field[row * along]! >= 0.014) return [];
      const runs: Array<{ center: number; mass: number; start: number; end: number }> = [];
      for (let i = 1; i < acrossSize - 1; i += 1) {
        if (field[row * along + i * across]! < 0.014) continue;
        const start = i;
        let sum = 0;
        while (i < acrossSize && field[row * along + i * across]! >= 0.014) {
          sum += field[row * along + i * across]!;
          i += 1;
        }
        const end = i - 1;
        if (start === end || i >= acrossSize - 1 || sum < 0.74 || sum > 3.2 || runs.length >= 8) return [];
        const a = field[row * along + start * across]!, b = field[row * along + end * across]!;
        runs.push({ center: (start + end + 1 + b - a) / 2, mass: sum, start, end });
      }
      return runs.length >= 3 ? runs : [];
    });
    const painted = new Array<{ start: number; end: number } | undefined>(alongSize);
    for (const direction of [-1, 1]) {
      for (let row = 0; row < alongSize; row += 1) {
        const n = lines[row]!.length;
        if (n < 3 || row + 5 * direction < 0 || row + 5 * direction >= alongSize) continue;
        const sections = Array.from({ length: 5 }, (_, i) => lines[row + i * direction]!);
        if (sections.some(section => section.length !== n)) continue;
        const bands = sections[0]!.map((_, index) => {
          const samples = sections.map(section => section[index]!);
          const center = samples.reduce((sum, sample) => sum + sample.center, 0) / 5;
          const slope = samples.reduce((sum, sample, i) => sum + (i - 2) * sample.center, 0) / 10;
          const width = samples.reduce((sum, sample) => sum + sample.mass, 0) / 5;
          return { center, slope, width, valid: Math.abs(slope) < 0.99 && samples.every((sample, i) =>
            Math.abs(sample.center - center - (i - 2) * slope) < 0.15 && Math.abs(sample.mass - width) < 0.055) };
        });
        if (bands.some((band, i) => !band.valid || (i > 0 && band.slope >= bands[i - 1]!.slope - 0.045))) continue;
        const matches = bands.every((band, k) => {
          const measure = (center: number, slope: number) => {
            let error = 0;
            for (let index = 0; index < 5; index += 1) {
              const { start, end } = sections[index]![k]!;
              const at = center + (index - 2) * slope;
              const line = (row + index * direction) * along;
              for (let column = start - 1; column <= end + 1; column += 1) {
                const distance = at - column - 0.5;
                const a = edgeArea(distance + band.width / 2, 1, Math.abs(slope));
                const b = edgeArea(distance - band.width / 2, 1, Math.abs(slope));
                error += (a - b - field[line + column * across]!) ** 2;
              }
            }
            return error;
          };
          let best = measure(band.center, band.slope);
          for (const step of [0.08, 0.04, 0.02, 0.01, 0.005, 0.0025]) {
            if (best < 0.00014) break;
            const center = band.center, slope = band.slope;
            const trials = [[center - step, slope], [center + step, slope], [center, slope - step / 2], [center, slope + step / 2]] as const;
            for (const [x, d] of trials) {
              const next = measure(x, d);
              if (next >= best) continue;
              band.center = x;
              band.slope = d;
              best = next;
            }
          }
          return best < 0.012;
        });
        if (!matches) continue;
        // The fitted centerlines must converge into the same neighborhood.
        const first = bands[0]!, last = bands[n - 1]!;
        const meeting = (last.center - first.center) / (first.slope - last.slope);
        if (meeting < 5 || meeting > 35) continue;
        const aim = first.center + first.slope * meeting;
        if (bands.some(band => Math.abs(band.center + band.slope * meeting - aim) > 2.8)) continue;
        const starts = new Float64Array(n), ends = new Float64Array(n);
        const coverage = (u: number, v: number, da: number, dv: number) => {
          let total = 0;
          // Integrate the union of the bands. Summing individual coverages
          // would overfill pixels once the bands begin to cross.
          for (let sample = 0; sample < 12; sample += 1) {
            const t = u + da * (sample + 0.5) / 12;
            let count = 0;
            for (const band of bands) {
              const center = band.center + band.slope * t;
              const start = Math.max(v, center - band.width / 2);
              const finish = Math.min(v + dv, center + band.width / 2);
              if (finish <= start) continue;
              let i = count;
              while (i > 0 && start < starts[i - 1]!) {
                starts[i] = starts[i - 1]!;
                ends[i] = ends[i - 1]!;
                i -= 1;
              }
              starts[i] = start;
              ends[i] = finish;
              count += 1;
            }
            let end = v;
            for (let i = 0; i < count; i += 1) {
              total += Math.max(0, ends[i]! - Math.max(starts[i]!, end));
              end = Math.max(end, ends[i]!);
            }
          }
          return total / (12 * dv);
        };
        for (let i = 3; i <= Math.min(25, Math.floor(meeting) + 2); i += 1) {
          const section = row + i * direction;
          if (section < 0 || section >= alongSize || i - 2 >= meeting) break;
          const u = i - 2;
          if (painted[section]) continue;
          const lower = Math.max(0, Math.floor(Math.min(...bands.map(b => b.center + b.slope * u - b.width / 2))) - 1);
          const upper = Math.min(acrossSize, Math.ceil(Math.max(...bands.map(b => b.center + b.slope * u + b.width / 2))) + 1);
          let gap = Infinity;
          for (let j = 1; j < n; j += 1) {
            const a = bands[j - 1]!, b = bands[j]!;
            gap = Math.min(gap, b.center - a.center + (b.slope - a.slope) * u - (a.width + b.width) / 2);
          }
          if (gap > 0.85) continue;
          let error = 0, largest = 0;
          for (let j = lower; j < upper; j += 1) {
            const delta = Math.abs(coverage(u - 0.5, j, 1, 1) - field[section * along + j * across]!);
            error += delta * delta;
            largest = Math.max(largest, delta);
          }
          if (largest > 0.10 || error > 0.003 * (upper - lower)) break;
          painted[section] = { start: lower, end: upper };
          for (let v = lower; v < upper; v += 1) {
            for (let j = 0; j < alongScale; j += 1) {
              const step = direction > 0 ? j : alongScale - 1 - j;
              const target = section * alongScale + j;
              for (let k = 0; k < acrossScale; k += 1) {
                const column = v * acrossScale + k;
                mask[acrossX ? target * width + column : column * width + target] =
                  coverage(u - 0.5 + step / alongScale, v + k / acrossScale, 1 / alongScale, 1 / acrossScale);
              }
            }
            if (soft) soft[section * along + v * across] = 0;
          }
        }
      }
    }
    // Two straight bands cannot enclose a new isolated gap as they meet.
    // At this scale a last diagonal sliver can threshold to one orphan
    // pixel. Remove it only inside a native sample with solid coverage.
    for (let u = 1; u < alongSize - 1; u += 1) {
      const repaint = painted[u];
      if (!repaint) continue;
      for (let v = Math.max(1, repaint.start); v < Math.min(acrossSize - 1, repaint.end); v += 1) {
        if (field[u * along + v * across]! < 0.9) continue;
        for (let j = 0; j < alongScale; j += 1) {
          for (let i = 0; i < acrossScale; i += 1) {
            const row = u * alongScale + j, column = v * acrossScale + i;
            const p = acrossX ? row * width + column : column * width + row;
            if (mask[p]! >= ISO) continue;
            let surrounding = 1;
            for (let dy = -1; dy <= 1; dy += 1) {
              for (let dx = -1; dx <= 1; dx += 1) {
                if (dx || dy) surrounding = Math.min(surrounding, mask[p + dy * width + dx]!);
              }
            }
            if (surrounding >= ISO) mask[p] = surrounding;
          }
        }
      }
    }
  }
}

/** Reconstruct resolved parallel edges along a straight, narrow source band. */
function restoreStraightBands(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  for (const horizontal of [false, true]) {
    const alongSize = horizontal ? sourceWidth : sourceHeight;
    const acrossSize = horizontal ? sourceHeight : sourceWidth;
    const alongScale = horizontal ? sx : sy, acrossScale = horizontal ? sy : sx;
    const sourceIndex = (u: number, v: number) => horizontal ? v * sourceWidth + u : u * sourceWidth + v;
    const targetIndex = (u: number, v: number) => horizontal ? v * width + u : u * width + v;
    for (const dark of [false, true]) {
      const phase = (u: number, v: number) => dark ? 1 - field[sourceIndex(u, v)]! : field[sourceIndex(u, v)]!;
      for (let u = 1; u < alongSize - 2; u += 1) {
        for (let v = 1; v < acrossSize - 2; v += 1) {
          const first = phase(u, v), second = phase(u, v + 1);
          const single = dark && first >= 0.38 && first <= 0.84 && second <= 0.015 && phase(u, v - 1) <= 0.015;
          if (!single && (first < 0.08 || second < 0.08 || phase(u, v - 1) > 0.025)) continue;
          const end = single ? v : second >= 0.975 && phase(u, v + 2) > 0.08 ? v + 2 : v + 1;
          const last = phase(u, end);
          if (end + 1 >= acrossSize || phase(u, end + 1) > 0.025) continue;
          const lo = single ? v + (1 - first) / 2 : v + 1 - first;
          const hi = single ? v + (1 + first) / 2 : end + last;
          if (hi - lo < 0.38 || hi - lo > 2.6) continue;
          const sameLane = (row: number) => {
            for (let col = v - 1; col <= end + 1; col += 1) {
              const amount = intervalOverlap(col, col + 1, lo, hi);
              if (Math.abs(amount - phase(row, col)) > 0.028) return false;
            }
            return true;
          };
          if (!sameLane(u + 1) || !sameLane(u + 2) || sameLane(u - 1)) continue;
          let next = u + 3;
          while (next < alongSize && sameLane(next)) next += 1;
          // A one-column dip only determines width if it behaves like a
          // slot at a sampled silhouette edge. A flat gray stripe alone
          // does not establish that there are two sides to reconstruct.
          const openEnd = (row: number) => {
            if (!single || row < 0 || row >= alongSize) return;
            const a = 1 - phase(row, v - 1), b = 1 - phase(row, v + 1);
            const fill = (a + b) / 2;
            if (fill <= 0.13 || fill >= 0.91 || Math.abs(a - b) >= 0.31
              || Math.abs(1 - phase(row, v) - fill * (1 - first)) > 0.034) return;
            return { fill, slope: (b - a) / 2 };
          };
          const openStart = openEnd(u - 1), openFinish = openEnd(next);
          if (single && !openStart && !openFinish) continue;

          // A clean terminal within one source row can be oblique. The
          // covered length in each of the two edge columns fixes its slope.
          const cap = (row: number, direction: number) => {
            if (row < 0 || row >= alongSize || phase(row, v - 1) > 0.025 || phase(row, end + 1) > 0.025) return;
            const left = phase(row, v) / first, right = phase(row, end) / last;
            if (Math.min(left, right) < 0.045 || Math.max(left, right) > 0.955) return;
            if (single) return () => row + (direction < 0 ? 1 - left : left);
            const center = (lo + v + 1) / 2;
            const slope = (right - left) / ((end + hi) / 2 - center);
            const lengthAt = (x: number) => left + slope * (x - center);
            if (Math.min(lengthAt(lo), lengthAt(hi)) < 0 || Math.max(lengthAt(lo), lengthAt(hi)) > 1) return;
            if (end > v + 1 && Math.abs(lengthAt(v + 1.5) - phase(row, v + 1)) > 0.028) return;
            return (x: number) => row + (direction < 0 ? 1 - lengthAt(x) : lengthAt(x));
          };
          const startCap = cap(u - 1, -1), endCap = cap(next, 1);
          const from = startCap ? u - 1 : u, to = endCap ? next + 1 : next;
          let before = 0, after = 0;
          for (let row = from; row < to; row += 1) {
            const terminal = row < u ? startCap : row === next ? endCap : undefined;
            for (let col = v; col <= end; col += 1) {
              const left = Math.max(lo, col), right = Math.min(hi, col + 1);
              const endAt = terminal?.((left + right) / 2) ?? row + 1;
              const expected = phase(row, col);
              const fitted = (right - left) * (row < u ? row + 1 - endAt : endAt - row);
              let area = 0;
              for (let j = 0; j < acrossScale; j += 1) {
                for (let i = 0; i < alongScale; i += 1) {
                  area += mask[targetIndex(row * alongScale + i, col * acrossScale + j)]!;
                }
              }
              const previous = area / (alongScale * acrossScale);
              before += ((dark ? 1 - previous : previous) - expected) ** 2;
              after += (fitted - expected) ** 2;
            }
          }
          // Uniform narrow gaps can match source area with a gray streak.
          // Keep their measured width even if the prior has the same area.
          if (after + (to - from) * 0.00035 >= before && (!single || after > (to - from) * 0.00012)) continue;
          for (let row = from; row < to; row += 1) {
            const terminal = row < u ? startCap : row === next ? endCap : undefined;
            for (let col = v - 1; col <= end + 1; col += 1) {
              const amount = intervalOverlap(col, col + 1, lo, hi);
              const sample = phase(row, col);
              // Leave weak evidence beside the band for the existing contour.
              if (!amount && sample > 0.012) continue;
              for (let j = 0; j < acrossScale; j += 1) {
                const left = Math.max(lo, col + j / acrossScale);
                const right = Math.min(hi, col + (j + 1) / acrossScale);
                const breadth = Math.max(0, right - left) * acrossScale;
                for (let i = 0; i < alongScale; i += 1) {
                  const top = row + i / alongScale;
                  const bottom = row + (i + 1) / alongScale;
                  let alpha = breadth;
                  if (terminal && breadth) {
                    const firstEnd = terminal(left), secondEnd = terminal(right);
                    const span = Math.abs(firstEnd - secondEnd) * alongScale;
                    const distance = ((firstEnd + secondEnd - top - bottom) / 2) * alongScale;
                    alpha *= edgeArea(row < u ? -distance : distance, Math.max(1, span), Math.min(1, span));
                  }
                  mask[targetIndex(row * alongScale + i, col * acrossScale + j)] = dark ? 1 - alpha : alpha;
                }
              }
              if (soft) soft[sourceIndex(row, col)] = 0;
            }
          }
          for (const [row, end] of [[u - 1, openStart], [next, openFinish]] as const) {
            if (!end) continue;
            const entering = row < u;
            for (let j = 0; j < acrossScale; j += 1) {
              const left = v + j / acrossScale, right = v + (j + 1) / acrossScale;
              for (let i = 0; i < alongScale; i += 1) {
                const along = entering ? 1 - (i + 0.5) / alongScale : (i + 0.5) / alongScale;
                const covered = (a: number, b: number) => {
                  if (a >= b) return 0;
                  const distance = (end.fill + end.slope * ((a + b) / 2 - v - 0.5) - along) * alongScale;
                  const drift = Math.abs(end.slope) * (b - a) * alongScale;
                  return edgeArea(distance, Math.max(1, drift), Math.min(1, drift)) * (b - a) * acrossScale;
                };
                mask[targetIndex(row * alongScale + i, v * acrossScale + j)] = clamp01(covered(left, right)
                  - covered(Math.max(lo, left), Math.min(hi, right)));
              }
            }
            if (soft) soft[sourceIndex(row, v)] = 0;
          }
        }
      }
    }
  }
}

/** Separate approaching contours when one edge stays straight across the gap. */
function restoreGapsAlongStraightEdges(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2) return;
  for (const acrossX of [false, true]) {
    const across = acrossX ? 1 : sourceWidth, along = acrossX ? sourceWidth : 1;
    const acrossSize = acrossX ? sourceWidth : sourceHeight, alongSize = acrossX ? sourceHeight : sourceWidth;
    const acrossScale = acrossX ? sx : sy, alongScale = acrossX ? sy : sx;
    for (const direction of [-1, 1]) {
      const inward = direction * across;
      for (let v = 1; v < acrossSize - 1; v += 1) {
        for (let u = 0; u < alongSize - 6; u += 1) {
          const index = v * across + u * along;
          const fill = field[index]!;
          if (fill < 0.18 || fill > 0.75 || field[index + inward]! < 0.97 || field[index - inward]! > 0.025) continue;
          const isExposed = (p: number) => Math.abs(field[p]! - fill) <= 0.025 && field[p - inward]! <= 0.025;
          if (!isExposed(index + along) || field[index + along + inward]! < 0.97
            || (u > 0 && isExposed(index - along) && field[index - along + inward]! >= 0.97)) continue;
          let stop = u + 2, lastContact = u;
          let strongest = 0, active = 0;
          for (; stop < alongSize; stop += 1) {
            const p = v * across + stop * along;
            const addition = field[p]! - fill;
            if (field[p + inward]! < 0.97 || addition < -0.025 || field[p]! > 0.95
              || (addition > 0.05 && field[p - inward]! < 0.94)) break;
            if (!isExposed(p)) {
              lastContact = stop;
              strongest = Math.max(strongest, addition);
              active += Number(addition > 0.10);
            } else if (lastContact > u && stop - lastContact >= 2) {
              stop += 1;
              break;
            }
          }
          const end = stop - 1;
          // Both exposed stretches fix which side of the texel owns the
          // straight edge. The extra coverage must attach to the other side.
          if (end - lastContact < 2 || active < 3 || strongest < Math.min(0.24, (1 - fill) * 0.37)) continue;
          const top = (column: number) => Math.max(0, field[v * across + column * along]! - fill);
          const approach = (column: number) => {
            const far = v - 3 * direction;
            if (column < u || column > end || far < 0 || far >= acrossSize) return;
            const p = v * across + column * along;
            const near = field[p - inward]!, next = field[p - 2 * inward]!;
            if (field[p - 3 * inward]! < 0.96 || near > next + 0.025 || (top(column) > 0.055 && near < 0.96)) return;
            return top(column) + near + next - 2;
          };
          for (let column = u; column <= end; column += 1) {
            const meeting = approach(column), before = approach(column - 1), after = approach(column + 1);
            if (meeting !== undefined && before !== undefined && after !== undefined) {
              // The approaching edge may cross the texel boundary before
              // meeting the bar. Measure both shapes over all three texels.
              const p = v * across + column * along;
              const slope = (after - before) / 2;
              const coverage = (fromOuter: number, alongOffset: number, span: number, length: number) => {
                const drift = Math.abs(slope * length);
                return edgeArea(meeting + slope * alongOffset - fromOuter, Math.max(span, drift), Math.min(span, drift));
              };
              const matches = [0, 1, 2].every(offset => {
                const alpha = coverage(0.5 - offset, 0, 1, 1) + (offset === 0 ? fill : 0);
                return Math.abs(field[p - offset * inward]! - alpha) <= 0.072;
              });
              if (matches && Math.abs(slope) <= 0.98) {
                for (let offset = 0; offset <= 2; offset += 1) {
                  for (let i = 0; i < alongScale; i += 1) {
                    const alongOffset = (i + 0.5) / alongScale - 0.5;
                    const row = column * alongScale + i;
                    for (let j = 0; j < acrossScale; j += 1) {
                      const coordinate = (direction > 0 ? j + 0.5 : acrossScale - j - 0.5) / acrossScale;
                      const fixed = offset === 0 ? clamp01((coordinate - 1 + fill) * acrossScale + 0.5) : 0;
                      const other = coverage(coordinate - offset, alongOffset, 1 / acrossScale, 1 / alongScale);
                      const target = (v - offset * direction) * acrossScale + j;
                      mask[acrossX ? row * width + target : target * width + row] = Math.min(1, fixed + other);
                    }
                  }
                  if (soft) soft[p - offset * inward] = 0;
                }
                continue;
              }
            }
            const amount = top(column);
            const room = 2 * (1 - fill - amount);
            const difference = (top(Math.min(end, column + 1)) - top(Math.max(u, column - 1))) / 2;
            const slope = Math.min(room, Math.max(-room, difference));
            const halfRise = Math.abs(slope) / 2;
            // At the tip of the curved edge, part of its fitted line can
            // fall outside this row. Locate the clipped line by area.
            const midpoint = amount < halfRise ? Math.sqrt(4 * halfRise * amount) - halfRise : amount;
            for (let i = 0; i < alongScale; i += 1) {
              const outerEdge = midpoint + slope * ((i + 0.5) / alongScale - 0.5);
              const steepness = Math.abs(slope) * acrossScale / alongScale;
              const row = column * alongScale + i;
              for (let j = 0; j < acrossScale; j += 1) {
                const fromOuter = (direction > 0 ? j + 0.5 : acrossScale - j - 0.5) / acrossScale;
                const fixed = clamp01((fromOuter - 1 + fill) * acrossScale + 0.5);
                const other = edgeArea((outerEdge - fromOuter) * acrossScale, Math.max(1, steepness), Math.min(1, steepness));
                const target = v * acrossScale + j;
                mask[acrossX ? row * width + target : target * width + row] = Math.min(1, fixed + other);
              }
            }
            if (soft) soft[v * across + column * along] = 0;
          }
          u = end;
        }
      }
    }
  }
}

/** Area of a tapered or flat-ended strip inside one rectangular pixel. */
function taperCoverage(
  left: number, top: number, right: number, bottom: number,
  tip: number, apex: number, slope: number, widthRate: number, tipWidth: number,
): number {
  const start = Math.max(left, tip);
  if (start >= right) return 0;
  const length = right - start;
  const positiveIntegral = (a: number, b: number) => {
    if (a >= 0 && b >= 0) return length * (a + b) / 2;
    const high = Math.max(a, b);
    return high <= 0 ? 0 : length * high * high / (2 * Math.abs(b - a));
  };
  const below = (rate: number, end: number) => {
    const a = end + (start - tip) * rate, b = end + (right - tip) * rate;
    return positiveIntegral(a - top, b - top) - positiveIntegral(a - bottom, b - bottom);
  };
  return clamp01((below(slope + widthRate / 2, apex + tipWidth / 2) - below(slope - widthRate / 2, apex - tipWidth / 2))
    / ((right - left) * (bottom - top)));
}

/** Resolve a point or flat end when the source supports both sides. */
function restoreTaperedTips(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 2) return;
  const directions = [[true, 1, 0], [true, -1, 0], [false, 1, 0], [false, -1, 0],
    [false, 1, 1], [false, -1, 1], [false, 1, -1], [false, -1, -1],
    [true, 1, 1], [true, -1, 1], [true, 1, -1], [true, -1, -1]] as const;
  const profile = new Float64Array(20), masses = new Float64Array(4), centers = new Float64Array(4);
  for (let y = 4; y < sourceHeight - 4; y += 1) {
    for (let x = 4; x < sourceWidth - 4; x += 1) {
      const p = y * sourceWidth + x;
      if (field[p]! < 0.035 || field[p]! > 0.965) continue;
      for (const [acrossX, inward, shear] of directions) {
        const normal = acrossX ? 1 : sourceWidth;
        const advance = inward * (acrossX ? sourceWidth : 1) + shear * normal;
        const crowded = shear !== 0 && field[p]! >= 0.68 && field[p]! <= 0.94
          && Math.min(field[p - normal]!, field[p + normal]!) >= 0.81
          && Math.min(field[p - 2 * normal]!, field[p + 2 * normal]!) < 0.965;
        if (acrossX && shear !== 0 && !crowded) continue;
        const radius = crowded ? 1 : 2;
        const dark = crowded || field[p - 2 * normal]! > 0.9;
        const phase = (q: number) => dark ? 1 - field[q]! : field[q]!;
        if (phase(p) > 0.65 || phase(p - advance) > 0.055 || phase(p + advance) < 0.26) continue;
        if (!crowded && (phase(p - 2 * normal) > 0.035 || phase(p + 2 * normal) > 0.035)) continue;
        if (crowded && Math.max(phase(p - normal), phase(p + normal)) > phase(p) / 2) continue;
        for (let u = -1; u <= 2; u += 1) {
          let mass = 0, moment = 0;
          for (let v = -2; v <= 2; v += 1) {
            const value = Math.abs(v) > radius ? 0 : phase(p + u * advance + v * normal);
            profile[(u + 1) * 5 + v + 2] = value;
            mass += value;
            moment += v * value;
          }
          masses[u + 1] = mass;
          centers[u + 1] = mass ? moment / mass : 0;
        }
        const rate = masses[3]! - masses[2]!;
        const capped = Math.abs(rate) <= 0.15 && masses[2]! >= 0.55 && masses[3]! <= 2.8;
        if (masses[0]! > 0.05 || masses[1]! < 0.045 || (!capped && (rate < 0.22 || rate > 1.15))) continue;
        if (crowded && (capped || masses[3]! > 1.6)) continue;
        // At least two incoming sections must resolve the across-stroke
        // position. Single-texel coverage alone cannot locate the apex.
        if (masses[2]! - profile[12]! < 0.035 || masses[3]! - profile[17]! < 0.035) continue;
        const centerWidth = masses[2]! - rate;
        const areaAt = (tip: number) => (0.5 - tip) * (centerWidth + rate * (0.5 + tip) / 2);
        let tip = capped ? 0.5 - masses[1]! / centerWidth : 1 - masses[2]! / rate;
        if (capped) tip += (areaAt(tip) - masses[1]!) / (centerWidth + rate * tip);
        if (tip < -0.5 || tip > 0.5 || Math.abs(areaAt(tip) - masses[1]!) > 0.045) continue;
        const tipWidth = capped ? centerWidth + rate * tip : 0;
        const profileCenter = (row: number) => {
          const start = row * 5;
          let first = 0, last = 4;
          while (first < last && profile[start + first]! < 0.012) first += 1;
          while (last > first && profile[start + last]! < 0.012) last -= 1;
          if (first === last) return centers[row]!;
          return (first + last - 4 + profile[start + last]! - profile[start + first]!) / 2;
        };
        // The center of an interval spanning two texels comes from its two
        // resolved boundaries. A texel-center moment biases narrow intervals
        // toward the fuller sample when the two sides have different area.
        const near = capped ? profileCenter(2) : centers[2]!;
        const far = capped ? profileCenter(3) : centers[3]!;
        let slope = far - near + shear;
        let apex = near + shear - slope * (1 - tip);
        if (Math.abs(apex) > (crowded ? 0.85 : 0.6) || Math.abs(slope - shear) > 0.75) continue;
        const measure = (center: number, direction: number) => {
          let error = 0;
          for (let u = -1; u <= 2; u += 1) {
            for (let v = -radius; v <= radius; v += 1) {
              const offset = v + shear * u;
              const prediction = taperCoverage(u - 0.5, offset - 0.5, u + 0.5, offset + 0.5, tip, center, direction, rate, tipWidth);
              error += (prediction - profile[(u + 1) * 5 + v + 2]!) ** 2;
            }
          }
          return error;
        };
        let error = measure(apex, slope);
        for (const step of [0.1, 0.05, 0.025, 0.0125]) {
          let nextApex = apex, nextSlope = slope;
          for (const d of [-1, 1]) {
            const center = apex + d * step, direction = slope + d * step;
            const positionError = measure(center, slope);
            if (positionError < error) {
              error = positionError;
              nextApex = center;
              nextSlope = slope;
            }
            const slopeError = measure(apex, direction);
            if (slopeError < error) {
              error = slopeError;
              nextApex = apex;
              nextSlope = direction;
            }
          }
          apex = nextApex;
          slope = nextSlope;
        }
        if (error > (crowded ? 0.0075 : capped ? 0.0018 : 0.0032)
          || Math.abs(apex) > (crowded ? 0.83 : 0.53)) continue;
        const du = 1 / (acrossX ? sy : sx), dv = 1 / (acrossX ? sx : sy);
        for (let u = 0; u <= (crowded ? 2 : 1); u += 1) {
          const row = p + u * advance;
          const left = u - 0.5;
          // Apply the same geometry to the adjacent section where both sides
          // are resolved. Validate the section together to avoid a seam from
          // mixing fitted and sampled coverage across its width.
          const errors: number[] = [];
          for (let v = -1; v <= 1; v += 1) {
            const q = row + v * normal;
            const tx = q % sourceWidth, ty = Math.floor(q / sourceWidth);
            const expected = phase(q);
            let area = 0;
            for (let j = 0; j < sy; j += 1) {
              for (let i = 0; i < sx; i += 1) area += mask[(ty * sy + j) * width + tx * sx + i]!;
            }
            const previous = dark ? 1 - area / (sx * sy) : area / (sx * sy);
            const offset = v + shear * u - 0.5;
            const predicted = taperCoverage(left, offset, left + 1, offset + 1, tip, apex, slope, rate, tipWidth);
            errors.push(Math.abs(predicted - expected) - Math.abs(previous - expected));
          }
          if (u && !crowded && (Math.max(...errors) > 1 / 255 || errors.reduce((sum, delta) => sum + delta, 0) > 0)) continue;
          if (u && crowded && (Math.max(...errors) > 0.035 || errors.reduce((sum, delta) => sum + delta, 0) > -0.025)) continue;
          for (let v = -1; v <= 1; v += 1) {
            if (!u && errors[v + 1]! > 1 / 255) continue;
            const q = row + v * normal;
            const tx = q % sourceWidth, ty = Math.floor(q / sourceWidth);
            for (let j = 0; j < sy; j += 1) {
              for (let i = 0; i < sx; i += 1) {
                const a = acrossX ? j : i, b = acrossX ? i : j;
                const along = left + (inward > 0 ? a * du : 1 - (a + 1) * du);
                const offset = v + shear * u + b * dv - 0.5;
                const alpha = taperCoverage(along, offset, along + du, offset + dv, tip, apex, slope, rate, tipWidth);
                mask[(ty * sy + j) * width + tx * sx + i] = dark ? 1 - alpha : alpha;
              }
            }
            if (soft) soft[q] = 0;
          }
        }
        break;
      }
    }
  }
}

/** Recover acute tips using better-resolved sections farther inward. */
function restorePointedStems(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  for (const acrossX of [true, false]) {
    const alongSize = acrossX ? sourceHeight : sourceWidth;
    const acrossSize = acrossX ? sourceWidth : sourceHeight;
    const normal = acrossX ? 1 : sourceWidth, tangent = acrossX ? sourceWidth : 1;
    const du = 1 / (acrossX ? sy : sx), dv = 1 / (acrossX ? sx : sy);
    for (let along = 0; along < alongSize; along += 1) {
      for (let across = 2; across < acrossSize - 2; across += 1) {
        const p = along * tangent + across * normal;
        const dark = field[p - 2 * normal]! > 0.96;
        const sample = dark ? 1 - field[p]! : field[p]!;
        if (sample < 0.015 || sample > 0.38) continue;
        for (const direction of [-1, 1]) {
          const available = Math.min(8, direction > 0 ? alongSize - along : along + 1);
          if (available < 5) continue;
          const visibleBefore = along - direction >= 0 && along - direction < alongSize;
          const advance = direction * tangent;
          const phase = (u: number, v: number) => dark ? 1 - field[p + u * advance + v * normal]! : field[p + u * advance + v * normal]!;
          if (phase(0, -1) > sample + 0.015 || phase(0, 1) > sample + 0.015) continue;
          const massAt = (u: number) => phase(u, -2) + phase(u, -1) + phase(u, 0) + phase(u, 1) + phase(u, 2);
          if (visibleBefore && massAt(-1) > 0.026) continue;
          const masses = Array.from({ length: available }, (_, u) => massAt(u));
          if (masses[0]! > 0.44) continue;
          const shortest = 5;
          // Nearby teeth can enter the inward window. Accept a shorter
          // estimate only when its own sections still resolve the tip.
          const centers: Array<{ u: number; center: number }> = [];
          for (let u = 0; u < available; u += 1) {
            let first = -2, last = 2;
            while (first < last && phase(u, first) < 0.012) first += 1;
            while (last > first && phase(u, last) < 0.012) last -= 1;
            if (first < last) centers.push({ u, center: (first + last + phase(u, last) - phase(u, first)) / 2 });
          }
          if (centers.length < 3) continue;
          let fit: ((u: number, v: number, stepU: number, stepV: number) => number) | undefined;
          let sections = available;
          for (; sections >= shortest; sections -= 1) {
            const wide = masses[sections - 1]!;
            if (wide < 0.48 || wide > 3.1) continue;
            const resolved = centers.filter(point => point.u < sections);
            if (resolved.length < 3) continue;
            const midpoint = sections / 2;
            const interior = masses.slice(1, sections);
            const mean = interior.reduce((sum, mass) => sum + mass, 0) / interior.length;
            const variance = interior.reduce((sum, _, i) => sum + (i + 1 - midpoint) ** 2, 0);
            const rate = interior.reduce((sum, mass, i) => sum + (i + 1 - midpoint) * mass, 0) / variance;
            if (rate < 0.033 || rate > (dark ? 0.78 : 0.39) || (sections < 8 && rate < (dark ? 0.19 : 0.1))) continue;
            const tip = midpoint - mean / rate;
            if (tip < -0.95 || tip > 0.46 || (visibleBefore && rate * Math.max(0, -0.5 - tip) ** 2 / 2 > 0.018)) continue;
            const first = resolved[0]!, last = resolved[resolved.length - 1]!;
            let slope = (last.center - first.center) / (last.u - first.u);
            let apex = resolved.reduce((sum, point) => sum + point.center - slope * (point.u - tip), 0) / resolved.length;
            if (Math.abs(apex) > 0.64 || Math.abs(slope) > 0.24) continue;
            const coverage = (u: number, v: number, stepU: number, stepV: number) =>
              taperCoverage(u, v, u + stepU, v + stepV, tip, apex, slope, rate, 0);
            const measure = () => {
              let error = 0, largest = 0;
              for (let u = 0; u < sections; u += 1) {
                for (let v = -2; v <= 2; v += 1) {
                  const delta = Math.abs(coverage(u - 0.5, v - 0.5, 1, 1) - phase(u, v));
                  error += delta ** 2;
                  largest = Math.max(largest, delta);
                }
              }
              return { error, largest };
            };
            let result = measure();
            if ((sections < 8 || !visibleBefore) && result.error > 0.00025 && result.error < 0.085) {
              // A tip that occupies only one texel can bias the estimated
              // center. Refine both edges against every sampled area.
              for (const step of [0.08, 0.04, 0.02, 0.01, 0.005]) {
                const center = apex, heading = slope;
                let bestCenter = apex, bestSlope = slope;
                for (let da = -1; da <= 1; da += 1) {
                  for (let ds = -1; ds <= 1; ds += 1) {
                    if (!da && !ds) continue;
                    apex = center + da * step;
                    slope = heading + ds * step / 3;
                    const candidate = measure();
                    if (candidate.error >= result.error) continue;
                    result = candidate;
                    bestCenter = apex;
                    bestSlope = slope;
                  }
                }
                apex = bestCenter;
                slope = bestSlope;
              }
            }
            if (Math.abs(apex) > 0.64 || Math.abs(slope) > 0.24
              || result.largest > (sections < 8 ? 0.06 : 0.09) || result.error > 0.0035 * sections) continue;
            fit = coverage;
            break;
          }
          if (!fit) continue;
          // Reuse a resolved tip on the opposite side only when the local
          // source samples validate the reflected geometry independently.
          for (const [flipX, flipY] of [[false, false], [true, false], [false, true]] as const) {
            const reflect = (q: number, w: number, h: number) => {
              const x = q % w, y = Math.floor(q / w);
              return (flipY ? h - 1 - y : y) * w + (flipX ? w - 1 - x : x);
            };
            if (flipX || flipY) {
              let mirrorError = 0, difference = 0;
              for (let u = visibleBefore ? -1 : 0; u < sections; u += 1) {
                for (let v = -2; v <= 2; v += 1) {
                  const q = reflect(p + u * advance + v * normal, sourceWidth, sourceHeight);
                  const sample = dark ? 1 - field[q]! : field[q]!;
                  mirrorError += (sample - fit(u - 0.5, v - 0.5, 1, 1)) ** 2;
                  difference = Math.max(difference, Math.abs(sample - phase(u, v)));
                }
              }
              if (mirrorError > 0.034 || difference > 0.065) continue;
            }
            const repaint = sections < 8 ? sections : sections - 1;
            for (let u = 0; u < repaint; u += 1) {
              for (let v = -2; v <= 2; v += 1) {
                const q = p + u * advance + v * normal;
                const tx = q % sourceWidth, ty = Math.floor(q / sourceWidth);
                for (let j = 0; j < sy; j += 1) {
                  for (let i = 0; i < sx; i += 1) {
                    const a = (acrossX ? j : i) * du, b = (acrossX ? i : j) * dv;
                    const inside = u - 0.5 + (direction > 0 ? a : 1 - a - du);
                    const alpha = fit(inside, v - 0.5 + b, du, dv);
                    const target = reflect((ty * sy + j) * width + tx * sx + i, width, height);
                    mask[target] = dark ? 1 - alpha : alpha;
                  }
                }
                if (soft) soft[reflect(q, sourceWidth, sourceHeight)] = 0;
              }
            }
          }
        }
      }
    }
  }
}

/** Fit an angled branch through the fractional edge of a straight bar. */
function restoreBarJunctionEdges(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  for (const acrossX of [true, false]) {
    const normal = acrossX ? 1 : sourceWidth, tangent = acrossX ? sourceWidth : 1;
    const du = 1 / (acrossX ? sy : sx), dv = 1 / (acrossX ? sx : sy);
    for (let y = 3; y < sourceHeight - 3; y += 1) {
      for (let x = 3; x < sourceWidth - 3; x += 1) {
        const p = y * sourceWidth + x;
        for (const direction of [-1, 1]) {
          const advance = direction * tangent;
          const dark = field[p - advance]! < 0.025;
          const phase = (u: number, v: number) => dark ? 1 - field[p + u * advance + v * normal]! : field[p + u * advance + v * normal]!;
          if (phase(-1, 0) < 0.975 || phase(1, 0) < 0.5 || phase(2, 0) < 0.35) continue;
          const bar = (phase(0, -2) + phase(0, 2)) / 2;
          if (bar < 0.08 || bar > 0.89 || Math.abs(phase(0, -2) - phase(0, 2)) > 0.025) continue;
          if (Math.min(phase(-1, -2), phase(-1, 2)) < 0.975 || phase(0, 0) < bar + 0.10) continue;
          const section = (u: number) => {
            if (Math.max(phase(u, -3), phase(u, 3)) > 0.04) return;
            let mass = 0, left = 3, right = -3;
            for (let v = -2; v <= 2; v += 1) {
              const alpha = phase(u, v);
              mass += alpha;
              if (alpha > 0.018) {
                left = Math.min(left, v);
                right = Math.max(right, v);
              }
            }
            if (left >= right || mass < 0.65 || mass > 2.9) return;
            return { mass, center: (left + right + phase(u, right) - phase(u, left)) / 2 };
          };
          const near = section(1), far = section(2);
          if (!near || !far) continue;
          const slope = far.center - near.center, rate = far.mass - near.mass;
          const apex = near.center + slope * (bar - 1.5), branchWidth = near.mass + rate * (bar - 1.5);
          if (Math.abs(slope) > 0.72 || Math.abs(rate) > 0.42 || branchWidth < 0.5 || branchWidth > 3.15) continue;
          const coverage = (u: number, v: number, stepU: number, stepV: number) =>
            clamp01((Math.max(0, Math.min(u + stepU, bar) - u) / stepU)
              + taperCoverage(u, v, u + stepU, v + stepV, bar, apex, slope, rate, branchWidth));
          // Check both the interrupted row and the branch beyond it.
          let before = 0, after = 0, largest = 0;
          for (let u = 0; u <= 1; u += 1) {
            for (let v = -2; v <= 2; v += 1) {
              const q = p + u * advance + v * normal;
              const tx = q % sourceWidth, ty = Math.floor(q / sourceWidth);
              const expected = phase(u, v);
              let area = 0;
              for (let j = 0; j < sy; j += 1) {
                for (let i = 0; i < sx; i += 1) area += mask[(ty * sy + j) * width + tx * sx + i]!;
              }
              const prior = area / (sx * sy);
              const error = Math.abs(coverage(u, v - 0.5, 1, 1) - expected);
              before += ((dark ? 1 - prior : prior) - expected) ** 2;
              after += error ** 2;
              largest = Math.max(largest, error);
            }
          }
          if (largest > 0.075 || after + 0.0001 >= before) continue;
          for (let u = 0; u <= 1; u += 1) {
            for (let v = -2; v <= 2; v += 1) {
              const q = p + u * advance + v * normal;
              const tx = q % sourceWidth, ty = Math.floor(q / sourceWidth);
              for (let j = 0; j < sy; j += 1) {
                for (let i = 0; i < sx; i += 1) {
                  const along = (acrossX ? j : i) * du;
                  const across = v - 0.5 + (acrossX ? i : j) * dv;
                  const alpha = coverage(u + (direction > 0 ? along : 1 - along - du), across, du, dv);
                  mask[(ty * sy + j) * width + tx * sx + i] = dark ? 1 - alpha : alpha;
                }
              }
              if (soft) soft[q] = 0;
            }
          }
        }
      }
    }
  }
}

/** Recover a supported one-sample island or hole when the trace loses its area. */
function restoreIsolatedFeatures(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (Math.min(sx, sy) < 2) return;
  for (let y = 1; y < sourceHeight - 1; y += 1) {
    for (let x = 1; x < sourceWidth - 1; x += 1) {
      const p = y * sourceWidth + x;
      const dark = field[p]! < ISO;
      const phase = (offset: number) => dark ? 1 - field[p + offset]! : field[p + offset]!;
      const area = phase(0);
      if (area < 0.65 || area > 0.97) continue;
      let isolated = true;
      for (let j = -1; j <= 1 && isolated; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
          if ((i || j) && phase(i + j * sourceWidth) > 0.23) {
            isolated = false;
            break;
          }
        }
      }
      if (!isolated) continue;
      const startX = Math.ceil(x * sx - 0.5), endX = Math.ceil((x + 1) * sx - 0.5);
      const startY = Math.ceil(y * sy - 0.5), endY = Math.ceil((y + 1) * sy - 0.5);
      let present = false, measured = 0;
      for (let j = startY; j < endY; j += 1) {
        for (let i = startX; i < endX; i += 1) {
          const value = mask[j * width + i]!;
          const amount = dark ? 1 - value : value;
          measured += amount;
          if (amount >= ISO) present = true;
        }
      }
      const expected = area * (endX - startX) * (endY - startY);
      if (present && measured >= expected * 0.86) continue;

      const cx = x + 0.5 + (phase(1) - phase(-1)) * 0.55;
      const cy = y + 0.5 + (phase(sourceWidth) - phase(-sourceWidth)) * 0.55;
      const radius = Math.min(0.49, Math.sqrt(area / Math.PI));
      const proposed: Array<{ target: number; increase: number }> = [];
      let added = 0;
      for (let j = startY; j < endY; j += 1) {
        for (let i = startX; i < endX; i += 1) {
          const dx = (i + 0.5) / sx - cx, dy = (j + 0.5) / sy - cy;
          const distance = Math.hypot(dx, dy);
          const nx = distance === 0 ? 1 / sx : Math.abs(dx / distance) / sx;
          const ny = distance === 0 ? 0 : Math.abs(dy / distance) / sy;
          const coverage = Math.min(area, edgeArea(radius - distance, Math.max(nx, ny), Math.min(nx, ny)));
          const target = j * width + i;
          const current = dark ? 1 - mask[target]! : mask[target]!;
          const increase = coverage - current;
          if (increase <= 0) continue;
          added += increase;
          proposed.push({ target, increase });
        }
      }
      if (added <= 0) continue;
      const gain = clamp01((expected - measured) / added);
      for (const { target, increase } of proposed) mask[target]! += (dark ? -1 : 1) * gain * increase;
    }
  }
}


/** Extend straight RGB from trustworthy foreground texels into the AA fringe. */
function dilateColors({ data, width, height }: RgbaImage, minAlpha: number): Int32Array {
  const owners = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(owners.length);
  let tail = 0;
  for (let p = 0; p < owners.length; p += 1) {
    if (data[p * 4 + 3]! < minAlpha) continue;
    owners[p] = p * 4;
    queue[tail++] = p;
  }
  for (let head = 0; head < tail; head += 1) {
    const p = queue[head]!;
    const x = p % width;
    const visit = (q: number) => {
      if (owners[q] !== -1) return;
      owners[q] = owners[p]!;
      queue[tail++] = q;
    };
    if (x > 0) visit(p - 1);
    if (x + 1 < width) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p < owners.length - width) visit(p + width);
  }
  return owners;
}

/** Recover a faint stroke that spends part of its length below the isoline. */
function findSoftStrokes(alpha: Float64Array, width: number, height: number): Float32Array | undefined {
  const candidates = new Uint8Array(alpha.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (alpha[p]! < 0.06 || alpha[p]! >= 0.84) continue;
      const nearSolid = (x >= 2 && alpha[p - 2]! >= 0.84) || (x + 2 < width && alpha[p + 2]! >= 0.84)
        || (y >= 2 && alpha[p - 2 * width]! >= 0.84) || (y + 2 < height && alpha[p + 2 * width]! >= 0.84);
      if (nearSolid) continue;
      let separated = true;
      for (let j = Math.max(0, y - 1); j <= Math.min(height - 1, y + 1) && separated; j += 1) {
        for (let i = Math.max(0, x - 1); i <= Math.min(width - 1, x + 1); i += 1) {
          if (alpha[j * width + i]! >= 0.84) {
            separated = false;
            break;
          }
        }
      }
      if (separated) candidates[p] = 1;
    }
  }

  let soft: Float32Array | undefined;
  for (let start = 0; start < alpha.length; start += 1) {
    if (!candidates[start]) continue;
    const stroke = [start];
    candidates[start] = 0;
    let faint = 0;
    let ridge = 0;
    let opacity = 0;
    for (let head = 0; head < stroke.length; head += 1) {
      const p = stroke[head]!;
      const x = p % width, y = Math.floor(p / width);
      const value = alpha[p]!;
      opacity += value;
      if (value < ISO) faint += 1;
      if (value >= 0.2) ridge += 1;
      for (let j = Math.max(0, y - 1); j <= Math.min(height - 1, y + 1); j += 1) {
        for (let i = Math.max(0, x - 1); i <= Math.min(width - 1, x + 1); i += 1) {
          const q = j * width + i;
          if (!candidates[q]) continue;
          stroke.push(q);
          candidates[q] = 0;
        }
      }
    }
    // A ridge averaging near the isoline already has a vector outline.
    if (stroke.length < 8 || faint < 4 || ridge < 5 || opacity >= stroke.length * 0.42) continue;
    soft ??= new Float32Array(alpha.length);
    for (const p of stroke) soft[p] = Math.min(0.49, alpha[p]!);
  }
  return soft;
}

function paintTransparent(
  source: RgbaImage, coverage: Float32Array, width: number, height: number, maxAlpha: number,
  soft: Float32Array | undefined,
) {
  const owners = dilateColors(source, Math.min(224, maxAlpha));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const py = Math.max(0, (y + 0.5) * source.height / height - 0.5);
    const y0 = Math.floor(py), y1 = Math.min(y0 + 1, source.height - 1);
    const fy = py - y0;
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const base = coverage[p]!;
      if (base === 0 && !soft) continue;
      const px = Math.max(0, (x + 0.5) * source.width / width - 0.5);
      const x0 = Math.floor(px), x1 = Math.min(x0 + 1, source.width - 1);
      const fx = px - x0;
      const a = y0 * source.width + x0, b = y0 * source.width + x1;
      const c = y1 * source.width + x0, d = y1 * source.width + x1;
      let opacity = base;
      if (soft && opacity < ISO) {
        // This contribution stays below the isoline and leaves the filled
        // silhouette intact.
        const top = soft[a]! * (1 - fx) + soft[b]! * fx;
        const bottom = soft[c]! * (1 - fx) + soft[d]! * fx;
        opacity = Math.max(base, top * (1 - fy) + bottom * fy);
      }
      const alpha = Math.round(clamp01(opacity) * 255);
      if (!alpha) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = source.data[owners[a]! + channel]! * (1 - fx) + source.data[owners[b]! + channel]! * fx;
        const bottom = source.data[owners[c]! + channel]! * (1 - fx) + source.data[owners[d]! + channel]! * fx;
        data[p * 4 + channel] = top * (1 - fy) + bottom * fy;
      }
      data[p * 4 + 3] = alpha;
    }
  }
  return data;
}

/** Concentrate excess coverage at a supported edge without moving the contour. */
function concentrateEdgeCoverage(
  source: Float64Array, sourceWidth: number, sourceHeight: number,
  data: Uint8ClampedArray, width: number, height: number,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3 || Math.max(sx, sy) > 6) return;
  const fringe: number[] = [], edge: number[] = [];
  const radius = Math.min(sx, sy);
  for (let y = 1; y < sourceHeight - 1; y += 1) {
    for (let x = 1; x < sourceWidth - 1; x += 1) {
      const p = y * sourceWidth + x;
      const sample = source[p]!;
      if (sample < 0.025 || sample > 0.975) continue;
      let low = false, high = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const value = source[p + dy * sourceWidth + dx]!;
          low ||= value <= 0.12;
          high ||= value >= 0.88;
        }
      }
      if (!low || !high) continue;
      for (const dark of [false, true]) {
        const phase = (alpha: number) => dark ? 255 - alpha : alpha;
        const hasCore = (i: number, j: number, radius: number, threshold: number) => {
          for (let row = Math.max(0, j - radius); row <= Math.min(height - 1, j + radius); row += 1) {
            for (let col = Math.max(0, i - radius); col <= Math.min(width - 1, i + radius); col += 1) {
              if (phase(data[4 * (row * width + col) + 3]!) >= threshold) return true;
            }
          }
          return false;
        };
        fringe.length = edge.length = 0;
        let moved = 0, capacity = 0, area = 0;
        for (let j = y * sy; j < (y + 1) * sy; j += 1) {
          for (let i = x * sx; i < (x + 1) * sx; i += 1) {
            const alpha = 4 * (j * width + i) + 3;
            const residue = phase(data[alpha]!);
            area += residue;
            if (!residue || residue >= 127) continue;
            if (hasCore(i, j, 1, 128)) {
              edge.push(alpha);
              capacity += 127 - residue;
            } else if (residue <= 104 && hasCore(i, j, radius - 1, 128) && hasCore(i, j, radius, 210)) {
              fringe.push(alpha);
              moved += residue;
            }
          }
        }
        if (!moved) continue;
        const expected = (dark ? 1 - sample : sample) * 255;
        const excess = Math.max(0, Math.floor(area - (expected + 1.5) * sx * sy));
        // Move residual coverage toward a resolved boundary within the same
        // source texel. Remove coverage above the measured source area.
        let trimmed = Math.min(moved, capacity + excess);
        if (!trimmed) continue;
        let remaining = Math.max(0, trimmed - excess);
        for (const alpha of edge) {
          const residue = phase(data[alpha]!);
          const budget = 127 - residue;
          const transferred = Math.round(remaining * budget / capacity);
          data[alpha] = phase(residue + transferred);
          remaining -= transferred;
          capacity -= budget;
        }
        for (const alpha of fringe) {
          const residue = phase(data[alpha]!);
          const transfer = Math.round(trimmed * residue / moved);
          data[alpha] = phase(residue - transfer);
          trimmed -= transfer;
          moved -= residue;
          if (data[alpha] === 0) data.fill(0, alpha - 3, alpha);
        }
      }
    }
  }
}

/** Trim low-contrast residue in native texels whose source area is nearly flat. */
function trimUnsupportedFringe(
  source: Float64Array, sourceWidth: number, sourceHeight: number,
  data: Uint8ClampedArray, width: number, height: number,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const value = source[y * sourceWidth + x]!;
      const dark = value > ISO;
      const fraction = dark ? 1 - value : value;
      if (fraction > 0.038) continue;
      let area = 0, peak = 0;
      for (let j = 0; j < sy; j += 1) {
        for (let i = 0; i < sx; i += 1) {
          const alpha = data[4 * ((y * sy + j) * width + x * sx + i) + 3]!;
          const residue = dark ? 255 - alpha : alpha;
          area += residue;
          peak = Math.max(peak, residue);
        }
      }
      // Preserve the geometry where the contour actually traverses the texel.
      // A small allowance for coverage near its edges prevents visible seams.
      const limit = (fraction * 255 + 3) * sx * sy;
      if (peak > 104 || area <= limit) continue;
      const gain = limit / area;
      for (let j = 0; j < sy; j += 1) {
        for (let i = 0; i < sx; i += 1) {
          const p = 4 * ((y * sy + j) * width + x * sx + i);
          const alpha = data[p + 3]!;
          const residue = dark ? 255 - alpha : alpha;
          const trimmed = Math.floor(residue * gain);
          data[p + 3] = dark ? 255 - trimmed : trimmed;
          if (data[p + 3] === 0) data.fill(0, p, p + 3);
        }
      }
    }
  }
}

/** Remove isolated partial-coverage flecks only when the source supports their removal. */
function trimDisconnectedFringe(
  source: Float64Array, sourceWidth: number, sourceHeight: number,
  data: Uint8ClampedArray, width: number, height: number,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  const blockArea = sx * sy;
  const sourceIndex = (p: number) => Math.floor(Math.floor(p / width) / sy) * sourceWidth
    + Math.floor((p % width) / sx);
  let totals: Uint32Array | undefined;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start]) continue;
    const alpha = data[4 * start + 3]!;
    const dark = alpha >= 128;
    const value = dark ? 255 - alpha : alpha;
    if (value < 9 || value >= 116) continue;
    const residue = (p: number) => dark ? 255 - data[4 * p + 3]! : data[4 * p + 3]!;
    let size = 1, attached = false;
    queue[0] = start;
    visited[start] = 1;
    for (let i = 0; i < size; i += 1) {
      const p = queue[i]!, x = p % width, y = Math.floor(p / width);
      for (let j = Math.max(0, y - 1); j <= Math.min(height - 1, y + 1); j += 1) {
        for (let k = Math.max(0, x - 1); k <= Math.min(width - 1, x + 1); k += 1) {
          const q = j * width + k, coverage = residue(q);
          if (coverage >= 116) attached = true;
          if (coverage < 9 || coverage >= 116 || visited[q]) continue;
          visited[q] = 1;
          queue[size++] = q;
        }
      }
    }
    if (attached || size > blockArea * 1.25) continue;
    const removed = new Map<number, number>();
    for (let i = 0; i < size; i += 1) {
      const p = queue[i]!, q = sourceIndex(p);
      removed.set(q, (removed.get(q) ?? 0) + residue(p));
    }
    if (removed.size > 4) continue;
    if (!totals) {
      totals = new Uint32Array(source.length);
      for (let p = 0; p < visited.length; p += 1) totals[sourceIndex(p)]! += data[4 * p + 3]!;
    }
    let improves = true;
    for (const [p, amount] of removed) {
      const expected = (dark ? 1 - source[p]! : source[p]!) * blockArea * 255;
      const actual = dark ? blockArea * 255 - totals[p]! : totals[p]!;
      if (Math.abs(actual - amount - expected) >= Math.abs(actual - expected)) {
        improves = false;
        break;
      }
    }
    if (!improves) continue;
    for (const [p, amount] of removed) totals[p]! += (dark ? 1 : -1) * amount;
    for (let i = 0; i < size; i += 1) {
      const p = 4 * queue[i]!;
      if (dark) data[p + 3] = 255;
      else data.fill(0, p, p + 4);
    }
  }
}

/** Remove a threshold speck where the source supports one continuous edge. */
function repairIsolatedEdgeSpecks(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  data: Uint8ClampedArray, width: number, height: number,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3) return;
  for (let y = 1; y < sourceHeight - 1; y += 1) {
    for (let x = 1; x < sourceWidth - 1; x += 1) {
      const p = y * sourceWidth + x;
      const source = field[p]!;
      const dark = source >= ISO;
      const phase = (value: number) => dark ? 1 - value : value;
      const alpha = (value: number) => dark ? 255 - value : value;
      const detail = phase(source);
      if (detail > 0.23 || detail < 0.025) continue;
      // A source-supported pinhole has a valley in the bright shape. Only
      // change this texel if the samples instead resolve opposing phases.
      if (![1, sourceWidth].some(step => {
        const a = phase(field[p - step]!), b = phase(field[p + step]!);
        return Math.min(a, b) < 0.025 && Math.max(a, b) > 0.57;
      })) continue;
      const expected = detail * 255 * sx * sy;
      let area = 0, selected = -1, replacement = 255;
      for (let j = y * sy; j < (y + 1) * sy; j += 1) {
        for (let i = x * sx; i < (x + 1) * sx; i += 1) {
          const target = 4 * (j * width + i) + 3;
          const value = alpha(data[target]!);
          area += value;
          if (value < 128 || value > 210 || selected >= 0) continue;
          let surrounding = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx || dy) surrounding = Math.max(surrounding, alpha(data[target + 4 * (dy * width + dx)]!));
            }
          }
          if (surrounding >= 128) continue;
          selected = target;
          replacement = surrounding;
        }
      }
      if (selected < 0) continue;
      const decrease = alpha(data[selected]!) - replacement;
      if (Math.abs(area - expected - decrease) >= Math.abs(area - expected)) continue;
      data[selected] = dark ? 255 - replacement : replacement;
      if (data[selected] === 0) data.fill(0, selected - 3, selected);
    }
  }
}

/** Reject repairs that connect separate strokes or cut an open channel in two. */
function preserveDiffuseGaps(
  original: Float32Array, mask: Float32Array, width: number, height: number, minimumArea: number, dark: boolean,
): void {
  // In the dark phase, walk a proposed closure in reverse to see whether it
  // used to connect two regions which the repair has separated.
  const reference = dark ? mask : original;
  const repaired = dark ? original : mask;
  const includes = (values: Float32Array, p: number) => (values[p]! >= ISO) !== dark;
  const labels = new Int32Array(mask.length);
  const queue = new Int32Array(mask.length);
  const areas = [0];
  const visitNeighbors = (p: number, visit: (q: number) => void) => {
    const x = p % width, y = Math.floor(p / width);
    for (let dy = Math.max(-1, -y); dy <= Math.min(1, height - y - 1); dy += 1) {
      for (let dx = Math.max(-1, -x); dx <= Math.min(1, width - x - 1); dx += 1) {
        if (!dark || !dx || !dy) visit(p + dy * width + dx);
      }
    }
  };
  const component = (start: number) => {
    if (labels[start]) return labels[start]!;
    const label = areas.length;
    let size = 1;
    queue[0] = start;
    labels[start] = label;
    for (let i = 0; i < size; i += 1) {
      const p = queue[i]!, x = p % width, y = Math.floor(p / width);
      for (let dy = Math.max(-1, -y); dy <= Math.min(1, height - y - 1); dy += 1) {
        for (let dx = Math.max(-1, -x); dx <= Math.min(1, width - x - 1); dx += 1) {
          if (dark && dx && dy) continue;
          const q = p + dy * width + dx;
          if (labels[q] || !includes(reference, q)) continue;
          labels[q] = label;
          queue[size++] = q;
        }
      }
    }
    areas.push(size);
    return label;
  };
  const visited = new Uint8Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (visited[start] || includes(reference, start) || !includes(repaired, start)) continue;
    const bridge = [start];
    visited[start] = 1;
    let first = 0, joins = false;
    for (let i = 0; i < bridge.length; i += 1) {
      visitNeighbors(bridge[i]!, q => {
        if (!includes(repaired, q)) return;
        if (includes(reference, q)) {
          const label = component(q);
          if (areas[label]! < minimumArea) return;
          if (first && first !== label) joins = true;
          first = label;
        } else if (!visited[q]) {
          visited[q] = 1;
          bridge.push(q);
        }
      });
    }
    if (joins) for (const p of bridge) mask[p] = original[p]!;
  }
}

/** Fit an opaque band where sampled detail still supplies a diffuse stroke or gap. */
function resolveDiffuseBands(
  field: Float64Array, sourceWidth: number, sourceHeight: number,
  mask: Float32Array, width: number, height: number, soft: Float32Array | undefined,
  vector: Float32Array, sampled: Float32Array,
): void {
  const sx = width / sourceWidth, sy = height / sourceHeight;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || Math.min(sx, sy) < 3 || Math.max(sx, sy) > Math.min(sx, sy) * 2) return;
  const original = mask.slice();
  const diffusePixels = new Uint8Array(mask.length);
  const diffuseAt = (values: Float32Array, p: number, x: number, y: number) => {
    if (values[p]! < 0.1 || values[p]! > 0.9) return false;
    let low = false, high = false;
    for (let dy = Math.max(-1, -y); dy <= Math.min(1, height - y - 1); dy += 1) {
      for (let dx = Math.max(-1, -x); dx <= Math.min(1, width - x - 1); dx += 1) {
        const a = values[p + dy * width + dx]!;
        low ||= a <= 0.06;
        high ||= a >= 0.94;
      }
    }
    return !low || !high;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (diffuseAt(original, p, x, y)) diffusePixels[p] = 1;
    }
  }
  const errors = new Float32Array(original.length).fill(Infinity);
  for (const horizontal of [false, true]) {
    const alongSize = horizontal ? sourceWidth : sourceHeight;
    const acrossSize = horizontal ? sourceHeight : sourceWidth;
    const alongScale = horizontal ? sx : sy, acrossScale = horizontal ? sy : sx;
    const sourceIndex = (u: number, v: number) => horizontal ? v * sourceWidth + u : u * sourceWidth + v;
    const targetIndex = (u: number, v: number) => horizontal ? v * width + u : u * width + v;
    for (const dark of [false, true]) {
      const phase = (u: number, v: number) => {
        const alpha = field[sourceIndex(u, v)]!;
        return dark ? 1 - alpha : alpha;
      };
      const profile = (u: number, v: number) => {
        if (u < 0 || u >= alongSize) return undefined;
        let first = v, last = v;
        while (first > 0 && v - first < 4 && phase(u, first - 1) > 0.025) first -= 1;
        while (last + 1 < acrossSize && last - v < 4 && phase(u, last + 1) > 0.025) last += 1;
        if (first < 1 || last + 1 >= acrossSize || last - first > 3) return undefined;
        let mass = 0;
        for (let w = first; w <= last; w += 1) mass += phase(u, w);
        if (mass < 0.045 || mass > 2.75) return undefined;
        const center = first === last ? first + 0.5 : (first + 1 - phase(u, first) + last + phase(u, last)) / 2;
        return { first, last, mass, center, resolved: first !== last };
      };
      for (let u = 0; u < alongSize; u += 1) {
        for (let v = 1; v < acrossSize - 1; v += 1) {
          const value = phase(u, v);
          if (value < 0.045 || value > 0.96 || phase(u, v - 1) > value || phase(u, v + 1) >= value) continue;
          const middle = profile(u, v);
          if (!middle) continue;
          const neighbor = (direction: number) => {
            const section = u + direction;
            if (section < 0 || section >= alongSize) return undefined;
            let peak = v;
            for (const offset of [-1, 1]) {
              if (phase(section, v + offset) > phase(section, peak)) peak = v + offset;
            }
            const next = profile(section, peak);
            if (!next || Math.abs(next.center - middle.center) > 1.3 || Math.abs(next.mass - middle.mass) > 0.7) return undefined;
            return next;
          };
          const before = neighbor(-1), after = neighbor(1);
          if (!before && !after) continue;
          if (!middle.resolved && !before?.resolved && !after?.resolved) continue;
          // A constant low-opacity ridge is ambiguous without a connection to
          // a stronger section. A taper can use the direction of rising mass.
          if (Math.max(middle.mass, before?.mass ?? 0, after?.mass ?? 0) < 0.6) continue;
          const slope = before?.resolved && after?.resolved ? (after.center - before.center) / 2
            : middle.resolved && before?.resolved ? middle.center - before.center
              : middle.resolved && after?.resolved ? after.center - middle.center : 0;
          const center = middle.resolved ? middle.center
            : before?.resolved && after?.resolved ? (after.center + before.center) / 2
              : before?.resolved ? before.center : after!.center;
          if (Math.abs(slope) > 1.12) continue;
          const rate = before && after ? (after.mass - before.mass) / 2
            : before ? middle.mass - before.mass : after!.mass - middle.mass;
          if (Math.abs(rate) > 0.65 || middle.mass - Math.abs(rate) / 2 < 0) continue;
          const area = (along: number, across: number, stepU: number, stepV: number) => {
            const offset = center + slope * along - across;
            const half = (middle.mass + rate * along) / 2;
            const left = Math.abs(slope - rate / 2) * stepU;
            const right = Math.abs(slope + rate / 2) * stepU;
            return edgeArea(offset + half, Math.max(stepV, right), Math.min(stepV, right))
              - edgeArea(offset - half, Math.max(stepV, left), Math.min(stepV, left));
          };
          const first = middle.first - 1, last = middle.last + 1;
          let error = 0, diffuse = 0, changedSolid = 0;
          for (let w = first; w <= last; w += 1) {
            error += (phase(u, w) - area(0, w + 0.5, 1, 1)) ** 2;
            for (let j = 0; j < alongScale; j += 1) {
              for (let i = 0; i < acrossScale; i += 1) {
                const p = targetIndex(u * alongScale + j, w * acrossScale + i);
                const value = original[p]!;
                const previous = dark ? 1 - value : value;
                const next = area((j + 0.5) / alongScale - 0.5, w + (i + 0.5) / acrossScale, 1 / alongScale, 1 / acrossScale);
                if (diffusePixels[p] && Math.abs(next - previous) > 0.25) diffuse += 1;
                if ((previous > 0.94 && next < 0.5) || (previous < 0.06 && next > 0.5)) changedSolid += 1;
              }
            }
          }
          if (error > 0.014 || diffuse < alongScale || changedSolid > 1) continue;
          for (let w = first; w <= last; w += 1) {
            for (let j = 0; j < alongScale; j += 1) {
              for (let i = 0; i < acrossScale; i += 1) {
                const p = targetIndex(u * alongScale + j, w * acrossScale + i);
                if (error >= errors[p]!) continue;
                const value = area((j + 0.5) / alongScale - 0.5, w + (i + 0.5) / acrossScale, 1 / alongScale, 1 / acrossScale);
                errors[p] = error;
                mask[p] = dark ? 1 - value : value;
              }
            }
            if (soft) soft[sourceIndex(u, w)] = 0;
          }
        }
      }
    }
  }
  // Reuse the traced boundary through a diffuse junction as a connected
  // patch. Replacing individual source texels can leave a rectangular seam.
  const pending = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p += 1) {
    if (Math.abs(original[p]! - vector[p]!) > 0.035
      && (errors[p] === Infinity || Math.abs(mask[p]! - vector[p]!) > 0.16)
      && Math.abs(original[p]! - sampled[p]!) < 0.035) pending[p] = 1;
  }
  for (let start = 0; start < mask.length; start += 1) {
    if (!pending[start]) continue;
    const patch = [start];
    pending[start] = 0;
    let diffuse = 0, changedSolid = 0, displaced = 0, lostCore = 0, unresolved = 0, resolved = 0;
    let low = false, high = false, departure = 0;
    for (let i = 0; i < patch.length; i += 1) {
      const p = patch[i]!, x = p % width, y = Math.floor(p / width);
      const previous = original[p]!, next = vector[p]!;
      departure = Math.max(departure, Math.abs(previous - next));
      if (diffusePixels[p] && Math.abs(previous - next) > 0.13) diffuse += 1;
      if (diffuseAt(mask, p, x, y)) unresolved += 1;
      else if (errors[p]! < Infinity) resolved += 1;
      if ((previous < 0.06 && next >= ISO) || (previous > 0.94 && next < ISO)) changedSolid += 1;
      let retainsPhase = (previous >= ISO) === (next >= ISO);
      const fitted = mask[p]!;
      let retainsFit = errors[p] === Infinity || (fitted > 0.06 && fitted < 0.94);
      for (let dy = Math.max(-1, -y); dy <= Math.min(1, height - y - 1); dy += 1) {
        for (let dx = Math.max(-1, -x); dx <= Math.min(1, width - x - 1); dx += 1) {
          const q = p + dy * width + dx, traced = vector[q]!;
          low ||= traced < 0.06;
          high ||= traced > 0.94;
          retainsPhase ||= (previous >= ISO) === (traced >= ISO);
          retainsFit ||= (fitted >= ISO) === (traced >= ISO);
          if (!pending[q]) continue;
          pending[q] = 0;
          patch.push(q);
        }
      }
      if (!retainsPhase) displaced += 1;
      if (!retainsFit) lostCore += 1;
    }
    // A junction may move a few fitted pixels, but keep the fitted contour
    // if the earlier trace lacks even a fraction of its resolved core.
    if (!low || !high || diffuse < 2 || unresolved * 2 <= resolved || departure < 0.25 || patch.length > 10 * sx * sy
      || lostCore > sx * sy / 3 || changedSolid > Math.max(2, diffuse / 8) || displaced > Math.max(3, diffuse / 6)) continue;
    for (const p of patch) mask[p] = vector[p]!;
  }
  preserveDiffuseGaps(original, mask, width, height, 4 * sx * sy, false);
  preserveDiffuseGaps(original, mask, width, height, 1, true);
  // A locally fitted edge can leave a single dark sample inside solid ink
  // where two independently fitted patches meet.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      if (original[p]! >= ISO && mask[p]! < ISO && mask[p - 1]! >= ISO && mask[p + 1]! >= ISO
        && mask[p - width]! >= ISO && mask[p + width]! >= ISO) mask[p] = original[p]!;
    }
  }
}

/** Return undefined for artwork best handled by the general-purpose resampler. */
export function upscalePerkVector(source: RgbaImage, width: number, height: number): RgbaImage | undefined {
  if (width <= 0 || height <= 0 || source.width <= 0 || source.height <= 0) return undefined;
  let minAlpha = 255, maxAlpha = 0, visible = 0, partial = 0;
  for (let i = 3; i < source.data.length; i += 4) {
    const a = source.data[i]!;
    minAlpha = Math.min(minAlpha, a);
    maxAlpha = Math.max(maxAlpha, a);
    if (a > 32) visible += 1;
    if (a > 32 && a < 224) partial += 1;
  }
  if (maxAlpha < 128 || (minAlpha === maxAlpha && maxAlpha !== 255)) return undefined;
  const palette = minAlpha === 255 ? fitPalette(source) : undefined;
  if (minAlpha === 255 && !palette) return undefined;
  const samples = palette?.coverage ?? Float64Array.from(
    { length: source.width * source.height }, (_, p) => source.data[p * 4 + 3]! / 255,
  );
  if (!palette && hasSoftShading(samples, source.width, source.height, Math.max(4, visible * 0.04))) {
    return undefined;
  }
  const coverage = samples.slice();
  preserveSymmetry(samples, source.width, source.height, coverage, source.width, source.height);
  const sx = width / source.width, sy = height / source.height;
  const { loops, fineFragments, ambiguousCells } = traceContours(coverage, source.width, source.height, !!palette);
  const textured = !palette && partial > visible * 0.1
    && (fineFragments > Math.max(12, coverage.length / 1024) || ambiguousCells > coverage.length / 160);
  const paths = preserveTopology(loops, Math.min(0.03, 0.1 / Math.max(sx, sy)));
  const mask = rasterize(paths, sx, sy, width, height);
  const detail = restoreDetail(coverage, source.width, source.height, paths, mask, width, height, !!palette, textured);
  protectNarrowRuns(coverage, source.width, source.height, mask, width, height);
  if (!palette && !textured) refineCoverage(coverage, source.width, source.height, mask, width, height);
  // Dense saddles and disconnected translucent flecks can be intentional
  // texture. Closely spaced fitted strands alone do not imply soft shading.
  const flatDetail = detail && hasUniformForeground(source.data) && (!textured || (ambiguousCells <= coverage.length / 160
    && !hasIsolatedTranslucency(samples, source.width, source.height)));
  const sampled = flatDetail ? mask.slice() : undefined;
  const soft = palette ? undefined : findSoftStrokes(coverage, source.width, source.height);
  if (!palette) {
    restoreIsolatedFeatures(coverage, source.width, source.height, mask, width, height);
    restoreAngledCorners(loops, samples, source.width, source.height, mask, width, height, soft);
  }
  preserveSymmetry(samples, source.width, source.height, mask, width, height);
  if (!palette) {
    restorePairedEdges(samples, source.width, source.height, mask, width, height, soft);
    restoreTaperedTips(samples, source.width, source.height, mask, width, height, soft);
    restoreFittedEdges(samples, source.width, source.height, mask, width, height, soft);
    restoreSquareCorners(samples, source.width, source.height, mask, width, height, soft);
    restoreCrossings(samples, source.width, source.height, mask, width, height, soft);
    restoreRectangularFeatures(loops, samples, source.width, source.height, mask, width, height, soft);
    restoreRectangleFrames(loops, samples, source.width, source.height, mask, width, height, soft);
    restoreCircularFeatures(loops, samples, source.width, source.height, mask, width, height, soft);
    restoreCrowdedCircles(loops, samples, source.width, source.height, mask, width, height, soft);
    restoreCircularContours(loops, samples, source.width, source.height, mask, width, height, soft);
    restoreOuterCircularBand(samples, source.width, source.height, mask, width, height, soft);
    restoreFrameEdges(samples, source.width, source.height, mask, width, height, soft);
    restoreSharedSplits(samples, source.width, source.height, mask, width, height, soft);
    restoreStraightBands(samples, source.width, source.height, mask, width, height, soft);
    restoreBarJunctionEdges(samples, source.width, source.height, mask, width, height, soft);
    restorePointedStems(samples, source.width, source.height, mask, width, height, soft);
    restoreDiamondFrame(samples, source.width, source.height, mask, width, height, soft);
    restoreSlantedHairlines(samples, source.width, source.height, mask, width, height, soft);
    restoreGapsAlongStraightEdges(samples, source.width, source.height, mask, width, height, soft);
    restoreConvergingBands(samples, source.width, source.height, mask, width, height, soft);
    if (detail) limitDetailToSourceArea(samples, source.width, source.height, detail.vector, detail.detailed, mask, width, sx, sy);
    if (textured) matchAreaNearContours(samples, source.width, source.height, mask, width, height);
    restoreSlantedDashes(loops, samples, source.width, source.height, mask, width, height, soft);
    if (sampled && detail) resolveDiffuseBands(coverage, source.width, source.height, mask, width, height, soft, detail.vector, sampled);
    const data = paintTransparent(source, mask, width, height, maxAlpha, soft);
    trimUnsupportedFringe(samples, source.width, source.height, data, width, height);
    trimDisconnectedFringe(samples, source.width, source.height, data, width, height);
    concentrateEdgeCoverage(samples, source.width, source.height, data, width, height);
    repairIsolatedEdgeSpecks(samples, source.width, source.height, data, width, height);
    return { data, width, height };
  }

  const { bg, fg } = palette;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < mask.length; p += 1) {
    const t = clamp01(mask[p]!);
    for (const c of [0, 1, 2] as const) {
      // Resolve exact byte ties toward the glyph so inverted palettes produce
      // inverted bytes as well as the same coverage geometry.
      const value = bg[c] + t * (fg[c] - bg[c]);
      data[p * 4 + c] = fg[c] < bg[c] ? 255 - Math.round(255 - value) : Math.round(value);
    }
    data[p * 4 + 3] = 255;
  }
  return { data, width, height };
}

export interface PerkSdfResult {
  image: RgbaImage;
  method: 'vector' | 'smooth';
}

/** Trace flat perk glyphs and use Mitchell for continuous-tone artwork. */
export function upscalePerkSdf(
  source: RgbaImage,
  width: number,
  height: number,
  onMethod?: (method: PerkSdfResult['method']) => void,
): RgbaImage {
  const vector = upscalePerkVector(source, width, height);
  const method = vector ? 'vector' : 'smooth';
  onMethod?.(method);
  return vector ?? upscaleMitchell(source, width, height);
}

/** Return the selected reconstruction along with its actual render path. */
export function upscalePerkSdfWithStatus(
  source: RgbaImage,
  width: number,
  height: number,
): PerkSdfResult {
  let method: PerkSdfResult['method'] = 'smooth';
  const image = upscalePerkSdf(source, width, height, (actualMethod) => {
    method = actualMethod;
  });
  return { image, method };
}
