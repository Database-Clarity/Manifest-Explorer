/**
 * Anime4K v4.0 "3D-AA" Upscale CNN (x2, US) — WebGL2 runner.
 *
 * A small (11 KB) convolutional neural network that reconstructs silky smooth
 * diagonals and clean detail with zero JPEG ringing. It is the default crisp
 * upscaler behind the "CNN (Anime4K)" lightbox mode, and falls back to the CPU
 * FSR EASU 2x cascade (`upscaleEasu`) whenever WebGL2 / float render targets
 * are unavailable.
 *
 * Upstream shader: `Anime4K_Upscale_3DAA_x2_US.glsl` (the anti-aliasing
 * variant of the 3D-graphics upscale CNN).
 *
 * ---------------------------------------------------------------------------
 * MIT License
 *
 * Copyright (c) 2019-2021 bloc97
 * All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * ---------------------------------------------------------------------------
 */

import { upscaleEasu, upscaleMitchell, type RgbaImage } from './upscale';

// The vendored shader (weights and pass structure) verbatim from
// `Anime4K_Upscale_3DAA_x2_US.glsl`, including its MIT header.
const A4K_GLSL = `// MIT License

// Copyright (c) 2019-2021 bloc97
// All rights reserved.

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

//!DESC Anime4K-v4.0-3D-AA-Upscale-CNN-x2-(US)-Conv-4x3x3x3
//!HOOK MAIN
//!BIND MAIN
//!SAVE conv2d_tf
//!WIDTH MAIN.w
//!HEIGHT MAIN.h
//!COMPONENTS 4
#define go_0(x_off, y_off) (MAIN_texOff(vec2(x_off, y_off)))
vec4 hook() {
    vec4 result = mat4(0.10005958, 0.30363804, -0.24045889, -0.003466652, 0.25860623, 0.47408342, -0.58965975, 0.058167808, 0.17228158, 0.43657768, -0.3982826, -0.022539442, 0.0, 0.0, 0.0, 0.0) * go_0(-1.0, -1.0);
    result += mat4(-0.23593923, 0.4692322, 0.04355681, 0.009586428, -0.37485301, 0.5885971, 0.3236714, -0.08301241, -0.3188667, 0.5608897, 0.3396368, 0.059106056, 0.0, 0.0, 0.0, 0.0) * go_0(-1.0, 0.0);
    result += mat4(-0.15485556, -0.11745722, 0.042440087, 0.5313071, -0.24682014, 0.00033858762, -0.08202063, 0.84100145, -0.15803772, -0.11368423, -0.09765383, 0.6991758, 0.0, 0.0, 0.0, 0.0) * go_0(-1.0, 1.0);
    result += mat4(0.21323937, 0.07442176, -0.10949712, -0.05313448, 0.44871446, 0.16815953, 0.07202329, -0.05763504, 0.12998791, 0.06934043, 0.044557367, -0.00978054, 0.0, 0.0, 0.0, 0.0) * go_0(0.0, -1.0);
    result += mat4(0.40295616, -0.7156766, 0.7321813, -0.54544497, 0.44781828, -1.1244348, 0.7786728, -0.91297877, 0.52567977, -0.81486106, 0.56867415, -0.68681335, 0.0, 0.0, 0.0, 0.0) * go_0(0.0, 0.0);
    result += mat4(0.020084642, -0.072761856, -0.13040084, 0.063976064, 0.18822637, -0.096821584, -0.06842927, 0.18078656, 0.05295053, -0.18540566, -0.1239999, 0.0156137515, 0.0, 0.0, 0.0, 0.0) * go_0(0.0, 1.0);
    result += mat4(-0.6254935, 0.0074730455, 0.21930416, 0.028796878, -0.82789946, 0.051125027, 0.25597844, 0.049207535, -0.68400925, -0.015768895, 0.233402, 0.021760475, 0.0, 0.0, 0.0, 0.0) * go_0(1.0, -1.0);
    result += mat4(0.21823564, -0.15992375, -0.14845636, -0.031485636, 0.13821888, -0.27466524, -0.094343, -0.07067512, 0.20875643, -0.20346795, -0.12910774, -0.052383807, 0.0, 0.0, 0.0, 0.0) * go_0(1.0, 0.0);
    result += mat4(0.001368614, 0.17603171, -0.36661625, -0.0043979343, 0.1381601, 0.27952382, -0.6743216, 0.0067374213, -0.023204552, 0.21662682, -0.3795221, -0.025739884, 0.0, 0.0, 0.0, 0.0) * go_0(1.0, 1.0);
    result += vec4(0.025272772, 0.014345055, -0.009859513, 0.000597734);
    return result;
}
//!DESC Anime4K-v4.0-3D-AA-Upscale-CNN-x2-(US)-Conv-4x3x3x8
//!HOOK MAIN
//!BIND conv2d_tf
//!SAVE conv2d_1_tf
//!WIDTH conv2d_tf.w
//!HEIGHT conv2d_tf.h
//!COMPONENTS 4
#define go_0(x_off, y_off) (max((conv2d_tf_texOff(vec2(x_off, y_off))), 0.0))
#define go_1(x_off, y_off) (max(-(conv2d_tf_texOff(vec2(x_off, y_off))), 0.0))
vec4 hook() {
    vec4 result = mat4(-0.08796357, 0.028130328, 0.073414765, -0.029320398, -0.07826724, 0.012752971, 0.06304871, 0.082551956, -0.052348416, 0.010077275, 0.0803755, 0.16395038, -0.08238233, -0.0012038432, -0.1297045, -0.1087021) * go_0(-1.0, -1.0);
    result += mat4(0.044162463, -0.019727755, -0.05845153, -0.23984948, 0.08363732, -0.06774037, 0.0234879, 0.02139741, 0.0028723166, -0.07549135, 0.0744662, 0.109019615, 0.03763121, -0.060664024, -0.03823593, -0.015655363) * go_0(-1.0, 0.0);
    result += mat4(-0.026882887, 0.124355234, -0.005225512, 0.053853527, -0.004761375, 0.07739831, 0.007993726, -0.024238527, -0.035357814, 0.022114292, -0.026158875, 0.047122046, -0.021067293, 0.041959677, 0.008588816, -0.006613815) * go_0(-1.0, 1.0);
    result += mat4(-0.037601672, 0.010898833, 0.05053419, -0.0118405875, 0.052177202, 0.013291429, -0.20246609, -0.07192325, -0.05164381, -0.011278074, -0.12394048, -0.037769064, 0.24392918, 0.03289724, 0.018663784, 0.04071627) * go_0(0.0, -1.0);
    result += mat4(-0.17768572, -0.003431817, 0.024597375, -0.067222916, -0.15119793, -0.049984362, 0.0588867, 0.20031504, -0.028296817, -0.17337173, 0.02136566, 0.07842319, -0.10203611, 0.02128208, 0.20057699, 0.026265312) * go_0(0.0, 0.0);
    result += mat4(-0.018206367, -0.36731398, -0.07842714, -0.08946319, 0.05601789, -0.13398123, -0.09766525, 0.0051633804, -0.004821273, -0.060362365, -0.08751827, -0.01924666, -0.01642196, -0.084792316, -0.021546558, -0.01531331) * go_0(0.0, 1.0);
    result += mat4(-0.003315341, 0.003464535, 0.023609636, -0.029517155, 0.023121882, -0.033598952, 0.032658506, 0.072380014, 0.038630765, -0.020992903, -0.09003304, 0.048244834, 0.17752261, -0.023978172, 0.7178278, 0.09461632) * go_0(1.0, -1.0);
    result += mat4(0.010277829, -0.0462686, -0.024897251, -0.02214524, 0.1262903, -0.15583614, -0.50100106, -0.04074772, 0.0612536, -0.17066137, -0.15715116, -0.020877155, -0.062031068, 0.4314311, -0.008700501, -0.030722365) * go_0(1.0, 0.0);
    result += mat4(-0.12062004, 0.055291675, 0.041176047, -0.034254536, -0.04062085, 0.14750236, 0.100433215, 0.024384778, -0.02506444, -0.0012329774, 0.06715311, 0.013158619, -0.07343181, 0.08929479, 0.015891392, 0.0014893904) * go_0(1.0, 1.0);
    result += mat4(-0.00028356185, 0.008408778, 0.046833538, -0.110735945, 0.050230157, -0.023995856, -0.06471944, -0.12666705, 0.121487044, -0.040447604, -0.13425831, -0.035763647, 0.06327994, 0.04542948, 0.12984566, 0.041735172) * go_1(-1.0, -1.0);
    result += mat4(-0.09654193, 0.055733874, 0.14149562, 0.20103204, -0.04256184, 0.041129943, -0.0997907, 0.030775042, 0.017492702, 0.053436417, -0.13472094, -0.037674613, -0.09461306, 0.07363193, 0.025130237, -0.020962669) * go_1(-1.0, 0.0);
    result += mat4(0.003966979, -0.077911004, -0.025530541, -0.08657802, 0.047928706, -0.12820454, -0.034780253, 0.070523396, 0.0991259, -0.07432318, -0.035848588, 0.026542934, -0.005886989, -0.048655648, 0.014799456, -0.033676937) * go_1(-1.0, 1.0);
    result += mat4(0.0040423325, 0.011639387, 0.014709128, -0.100935176, -0.03094238, -0.0058094636, 0.1256023, 0.086693585, -0.00840243, -0.02635784, -0.2395783, 0.0055595445, -0.104565054, 0.05285065, 0.092289336, 0.12696597) * go_1(0.0, -1.0);
    result += mat4(-0.097862415, 0.035469674, -0.12026435, -0.25865972, 0.12508512, -0.00648921, -0.1848096, -0.24143967, -0.009432349, -0.035211377, -0.05589267, -0.11565712, 0.015937572, 0.02717122, -0.09954979, -0.081140056) * go_1(0.0, 0.0);
    result += mat4(-0.09073428, 0.31426015, 0.087145604, -0.00073830306, 0.013578701, 0.032616604, 0.038264107, 0.07236385, -0.012257218, 0.040580798, 0.08520396, 0.004167174, 0.02280993, 0.113494344, 0.027510444, 0.029490784) * go_1(0.0, 1.0);
    result += mat4(-0.02391937, 0.0039571812, -0.026116686, -0.025334306, 0.06904104, 0.011511556, -0.14147542, 0.01224604, 0.03788813, -0.041387778, -0.1523622, 0.03650455, 0.04693732, 0.03091366, 0.2839756, 0.1779714) * go_1(1.0, -1.0);
    result += mat4(-0.026292996, 0.020397607, 0.09354275, 0.00044126343, -0.047845, 0.11368384, 0.18426466, 0.12002076, -0.034070846, 0.042704806, -0.041553736, 0.04446022, -0.006331844, 0.16227855, 0.07832003, -0.07068554) * go_1(1.0, 0.0);
    result += mat4(-0.026658786, -0.0079359505, -0.04125044, -0.10622727, 0.06254047, -0.36537018, -0.10755624, 0.011665703, 0.025558028, -0.087151, -0.06987865, 0.00023839885, 0.03247968, -0.053188834, -0.004876301, -0.06005079) * go_1(1.0, 1.0);
    result += vec4(-0.012601902, -0.0121468, -0.027073797, -0.0223602);
    return result;
}
//!DESC Anime4K-v4.0-3D-AA-Upscale-CNN-x2-(US)-Conv-4x3x3x4
//!HOOK MAIN
//!BIND conv2d_1_tf
//!SAVE conv2d_last_tf
//!WIDTH conv2d_1_tf.w
//!HEIGHT conv2d_1_tf.h
//!COMPONENTS 4
#define go_0(x_off, y_off) (max((conv2d_1_tf_texOff(vec2(x_off, y_off))), 0.0))
vec4 hook() {
    vec4 result = mat4(-0.00055252935, 0.0011350953, -0.0016148019, 0.0014946404, -0.30635214, -0.017596753, -0.0036547943, 0.016236471, 0.005174489, 0.0030302007, 0.00019672248, 0.0006430973, 0.0007490077, -0.0031795658, -6.158733e-05, 0.0006820584) * go_0(-1.0, -1.0);
    result += mat4(0.15602079, 0.011071071, -0.0027609533, -0.0034318874, -0.0039016667, 0.016504101, -0.27816474, -0.008282344, 0.19063498, 0.012465078, 0.010091085, -0.004841106, -0.11758087, -0.012808949, 0.0067606894, 0.005216566) * go_0(-1.0, 0.0);
    result += mat4(0.013258877, -0.014989483, 0.22402754, 0.013204027, 0.00016207264, -0.00042593342, -0.00333761, -0.0012207513, 0.0033727325, -0.007841196, 0.16044731, 0.00594871, -0.0028581345, 0.012616562, -0.15928285, -0.011812331) * go_0(-1.0, 1.0);
    result += mat4(-0.0048872055, -0.0011780986, -0.0029523429, 0.00082424335, -0.0024385185, -0.26525813, 0.013532772, -0.0008381766, 0.0024996721, 0.0022899017, -0.0017697349, -0.0010618394, 0.0024938583, 0.005421073, 0.0028740794, -0.007808829) * go_0(0.0, -1.0);
    result += mat4(-0.08293415, 0.2659366, -0.010839574, 0.023423964, 0.01725351, -0.009252893, -0.011632222, -0.308242, 0.0001496815, 0.16104282, -0.0069378703, 0.00842848, 0.085917845, -0.18407243, -0.006601597, -0.027134055) * go_0(0.0, 0.0);
    result += mat4(-0.033873428, -0.011743531, -0.230377, 0.116242796, -0.0018527015, -0.00853698, 0.0059901997, -0.006155517, -0.009841329, 0.006163952, 0.014816026, 0.18667653, 0.016977048, -0.0017093032, 0.19695279, -0.061764043) * go_0(0.0, 1.0);
    result += mat4(-0.0003514533, -0.0069080726, 0.0052108583, -0.0016346197, -0.0016860099, 0.006002445, -0.0022835485, -0.0028219873, 0.0005367275, 0.0005437954, 0.00059865275, -0.00014915364, -0.0032214937, -0.00052043283, -0.0031621973, 0.0055843857) * go_0(1.0, -1.0);
    result += mat4(-0.006905302, -0.20389622, 0.01891904, -0.018114902, 0.00724176, 0.011335843, -0.0028616642, 0.016452003, -0.00013852821, -0.00039706306, 0.0011838446, 0.0028873065, 0.012857878, 0.16889338, -0.014114007, 0.009388666) * go_0(1.0, 0.0);
    result += mat4(0.0040798862, 0.002933288, -0.016012201, -0.14650294, -0.0017411204, 0.0017980475, 0.00056705566, -0.0003218331, -0.0014291195, -0.0062614805, 0.00082543516, -0.00397049, -0.004496662, 0.0008032309, 0.0049529593, 0.117166765) * go_0(1.0, 1.0);
    result += vec4(-3.1127936e-05, 3.3726166e-05, 4.8580805e-05, -9.541029e-06);
    return result;
}
//!DESC Anime4K-v4.0-3D-AA-Upscale-CNN-x2-(US)-Depth-to-Space
//!HOOK MAIN
//!BIND MAIN
//!BIND conv2d_last_tf
//!SAVE MAIN
//!WIDTH conv2d_last_tf.w 2 *
//!HEIGHT conv2d_last_tf.h 2 *
vec4 hook() {
    vec2 f0 = fract(conv2d_last_tf_pos * conv2d_last_tf_size);
    ivec2 i0 = ivec2(f0 * vec2(2.0));
    float c0 = conv2d_last_tf_tex((vec2(0.5) - f0) * conv2d_last_tf_pt + conv2d_last_tf_pos)[i0.y * 2 + i0.x];
    float c1 = c0;
    float c2 = c1;
    float c3 = c2;
    return vec4(c0, c1, c2, c3) + MAIN_tex(MAIN_pos);
}`;

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** Bilinear 2x blit used to build the "base" input to the residual add. */
const BLIT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
void main() { fragColor = texture(u_tex, v_uv); }`;

/**
 * Depth-to-space: the last conv layer emits 4 channels per source texel that
 * map onto the 4 sub-pixels of each 2x output texel, added to a bilinear base.
 */
const DEPTH_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_conv;
uniform sampler2D u_base;
uniform sampler2D u_alpha;
void main() {
  ivec2 dst = ivec2(gl_FragCoord.xy);
  ivec2 srcpx = dst / 2;
  ivec2 sub = dst % 2;
  vec4 c = texelFetch(u_conv, srcpx, 0);
  float v = c[sub.y * 2 + sub.x];
  vec4 base = texture(u_base, v_uv);
  float a = texture(u_alpha, v_uv).a;
  fragColor = vec4(max(base.rgb + vec3(v), 0.0), a);
}`;

interface PassDef {
  kind: 'conv' | 'depth2x';
  bind: string | null;
  save: string | null;
  body: string;
}

interface ConvPass {
  program: WebGLProgram;
  uTex: WebGLUniformLocation | null;
  uTexel: WebGLUniformLocation | null;
}

interface Engine {
  gl: WebGL2RenderingContext;
  vao: WebGLVertexArrayObject;
  convPasses: ConvPass[];
  blitProgram: WebGLProgram;
  blitUTex: WebGLUniformLocation | null;
  depthProgram: WebGLProgram;
  depthUConv: WebGLUniformLocation | null;
  depthUBase: WebGLUniformLocation | null;
  depthUAlpha: WebGLUniformLocation | null;
}

/** Lazily-initialized, cached engine. `undefined` = not attempted, `null` = unavailable. */
let engine: Engine | null | undefined;

function parsePasses(src: string): PassDef[] {
  const chunks = src.split('//!DESC').slice(1);
  const passes: PassDef[] = [];
  for (const chunk of chunks) {
    const bind = /\/\/!BIND\s+(\w+)/.exec(chunk)?.[1] ?? null;
    const save = /\/\/!SAVE\s+(\w+)/.exec(chunk)?.[1] ?? null;
    const isFinal = /Depth-to-Space/i.test(chunk.split('\n')[0] ?? '');
    if (isFinal) {
      passes.push({ kind: 'depth2x', bind, save, body: '' });
      continue;
    }
    const start = chunk.indexOf('#define');
    let body = chunk.slice(start);
    body = body.slice(0, body.lastIndexOf('}') + 1);
    passes.push({ kind: 'conv', bind, save, body });
  }
  return passes;
}

function passSource(body: string): string {
  return `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_texel;
#define MAIN_texOff(off) (texture(u_tex, v_uv + (off) * u_texel))
#define conv2d_tf_texOff(off) (texture(u_tex, v_uv + (off) * u_texel))
#define conv2d_1_tf_texOff(off) (texture(u_tex, v_uv + (off) * u_texel))
#define conv2d_last_tf_texOff(off) (texture(u_tex, v_uv + (off) * u_texel))
${body}
void main() { fragColor = hook(); }`;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('shader compile: ' + (log ?? 'unknown'));
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, fsSource: string): WebGLProgram {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('link: ' + (log ?? 'unknown'));
  }
  return program;
}

function makeTex(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function makeFbo(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const f = gl.createFramebuffer();
  if (!f) throw new Error('createFramebuffer failed');
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(f);
    throw new Error('fbo incomplete ' + status);
  }
  return f;
}

function uploadRgba8(
  gl: WebGL2RenderingContext,
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function buildEngine(): Engine | null {
  if (typeof document === 'undefined') return null;

  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = document
      .createElement('canvas')
      .getContext('webgl2', {
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null;
  } catch {
    return null;
  }
  if (!gl) return null;

  // Float render targets are required for the RGBA16F intermediate tensors.
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');
  gl.getExtension('OES_texture_half_float_linear');

  try {
    const passes = parsePasses(A4K_GLSL);
    const convPasses: ConvPass[] = [];
    for (const pass of passes) {
      if (pass.kind !== 'conv') continue;
      const program = linkProgram(gl, passSource(pass.body));
      convPasses.push({
        program,
        uTex: gl.getUniformLocation(program, 'u_tex'),
        uTexel: gl.getUniformLocation(program, 'u_texel'),
      });
    }

    const blitProgram = linkProgram(gl, BLIT_FRAGMENT);
    const depthProgram = linkProgram(gl, DEPTH_FRAGMENT);

    // Fullscreen triangle.
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Keep the VAO bound — every draw uses this single fullscreen triangle.

    return {
      gl,
      vao,
      convPasses,
      blitProgram,
      blitUTex: gl.getUniformLocation(blitProgram, 'u_tex'),
      depthProgram,
      depthUConv: gl.getUniformLocation(depthProgram, 'u_conv'),
      depthUBase: gl.getUniformLocation(depthProgram, 'u_base'),
      depthUAlpha: gl.getUniformLocation(depthProgram, 'u_alpha'),
    };
  } catch {
    // Shader compilation / linking failed — no GPU upscaling.
    return null;
  }
}

function getEngine(): Engine | null {
  if (engine === undefined) engine = buildEngine();
  return engine;
}

/** Run one 2x CNN pass. Returns a new RGBA16F texture at (w*2, h*2). */
function run2x(
  engine: Engine,
  inputTex: WebGLTexture,
  w: number,
  h: number,
): WebGLTexture {
  const { gl } = engine;
  const convTextures: WebGLTexture[] = [];
  const convFbos: WebGLFramebuffer[] = [];
  for (let i = 0; i < engine.convPasses.length; i += 1) {
    const tex = makeTex(gl, w, h);
    convTextures.push(tex);
    convFbos.push(makeFbo(gl, tex));
  }

  const baseTex = makeTex(gl, w * 2, h * 2);
  const baseFbo = makeFbo(gl, baseTex);
  const outTex = makeTex(gl, w * 2, h * 2);
  const outFbo = makeFbo(gl, outTex);

  gl.bindVertexArray(engine.vao);

  // Base: bilinear 2x upsample of the input (residual is added onto this).
  gl.viewport(0, 0, w * 2, h * 2);
  gl.bindFramebuffer(gl.FRAMEBUFFER, baseFbo);
  gl.useProgram(engine.blitProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, inputTex);
  gl.uniform1i(engine.blitUTex, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // Convolution passes (4x3x3x3 -> 4x3x3x8 -> 4x3x3x4).
  gl.viewport(0, 0, w, h);
  let srcTex = inputTex;
  for (let i = 0; i < engine.convPasses.length; i += 1) {
    const pass = engine.convPasses[i];
    if (!pass) continue;
    gl.bindFramebuffer(gl.FRAMEBUFFER, convFbos[i] ?? null);
    gl.useProgram(pass.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(pass.uTex, 0);
    gl.uniform2f(pass.uTexel, 1 / w, 1 / h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    srcTex = convTextures[i] ?? srcTex;
  }

  // Depth-to-space: assemble the 2x output from the residual + bilinear base.
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
  gl.viewport(0, 0, w * 2, h * 2);
  gl.useProgram(engine.depthProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.uniform1i(engine.depthUConv, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, baseTex);
  gl.uniform1i(engine.depthUBase, 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, inputTex);
  gl.uniform1i(engine.depthUAlpha, 2);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Free every temporary texture/framebuffer except the returned output.
  for (const tex of convTextures) gl.deleteTexture(tex);
  for (const fbo of convFbos) gl.deleteFramebuffer(fbo);
  gl.deleteTexture(baseTex);
  gl.deleteFramebuffer(baseFbo);
  gl.deleteFramebuffer(outFbo);

  return outTex;
}

function readRgba16f(
  engine: Engine,
  tex: WebGLTexture,
  w: number,
  h: number,
): Float32Array {
  const { gl } = engine;
  const fbo = makeFbo(gl, tex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const out = new Float32Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  return out;
}

function hasMeaningfulAlpha(source: RgbaImage): boolean {
  const { data } = source;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) < 254) return true;
  }
  return false;
}

/**
 * Build the opaque RGB input for the CNN: straight colour with transparent
 * regions edge-extended with the nearest visible colour (so no dark halo is
 * learned), alpha forced to 255.
 */
function buildInputRgb(source: RgbaImage, transparent: boolean): Uint8Array {
  const { data, width: w, height: h } = source;
  const rgb = new Uint8Array(w * h * 4);

  if (!transparent) {
    for (let i = 0; i < data.length; i += 4) {
      rgb[i] = data[i] ?? 0;
      rgb[i + 1] = data[i + 1] ?? 0;
      rgb[i + 2] = data[i + 2] ?? 0;
      rgb[i + 3] = 255;
    }
    return rgb;
  }

  // Multi-source BFS to fill transparent pixels with the nearest colour.
  const seen = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  let tail = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      const i = p * 4;
      const a = data[i + 3] ?? 0;
      rgb[i] = data[i] ?? 0;
      rgb[i + 1] = data[i + 1] ?? 0;
      rgb[i + 2] = data[i + 2] ?? 0;
      rgb[i + 3] = 255;
      if (a > 8) {
        seen[p] = 1;
        qx[tail] = x;
        qy[tail] = y;
        tail += 1;
      }
    }
  }
  if (tail === 0) {
    rgb.fill(255);
    return rgb;
  }

  let head = 0;
  while (head < tail) {
    const x = qx[head] ?? 0;
    const y = qy[head] ?? 0;
    head += 1;
    const si = (y * w + x) * 4;
    const steps: Array<[number, number]> = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of steps) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const np = ny * w + nx;
      if (seen[np]) continue;
      seen[np] = 1;
      const ni = np * 4;
      rgb[ni] = rgb[si] ?? 0;
      rgb[ni + 1] = rgb[si + 1] ?? 0;
      rgb[ni + 2] = rgb[si + 2] ?? 0;
      rgb[ni + 3] = 255;
      qx[tail] = nx;
      qy[tail] = ny;
      tail += 1;
    }
  }
  return rgb;
}

/** Build a grayscale image whose RGB carries the source alpha (for EASU). */
function alphaAsGrayscale(source: RgbaImage): RgbaImage {
  const { data, width, height } = source;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    out[i] = a;
    out[i + 1] = a;
    out[i + 2] = a;
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}

/**
 * Upscale `source` to `(targetW, targetH)` using the Anime4K 3D-AA CNN.
 *
 * Returns `null` (so the caller can fall back to CPU EASU) when WebGL2, float
 * render targets, or shader compilation are unavailable, or on any GPU error.
 *
 * Uses cascaded 2x passes (1 pass for <= 2x, 2 passes for <= 4x), then a clean
 * Mitchell step to the exact target size. For transparent PNGs the RGB is
 * edge-extended and upscaled by the CNN while the alpha channel is upscaled
 * independently via the EASU 2x cascade (crisp silhouettes, no blocky edges).
 */
export function upscaleAnime4k(
  source: RgbaImage,
  targetWidth: number,
  targetHeight: number,
): RgbaImage | null {
  const srcW = source.width;
  const srcH = source.height;
  if (targetWidth < srcW || targetHeight < srcH) return null;
  if (targetWidth === srcW && targetHeight === srcH) return null;

  const engine = getEngine();
  if (!engine) return null;

  try {
    const scale = Math.max(targetWidth / srcW, targetHeight / srcH);
    let passes = 0;
    if (scale > 1) passes = 1;
    if (scale > 2) passes = 2;

    const iw = srcW << passes;
    const ih = srcH << passes;

    const transparent = hasMeaningfulAlpha(source);
    const input = buildInputRgb(source, transparent);
    const inputTex = uploadRgba8(engine.gl, input, srcW, srcH);

    let tex = inputTex;
    for (let p = 0; p < passes; p += 1) {
      const next = run2x(engine, tex, srcW << p, srcH << p);
      if (p > 0) engine.gl.deleteTexture(tex);
      tex = next;
    }
    engine.gl.deleteTexture(inputTex);

    const f32 = readRgba16f(engine, tex, iw, ih);
    engine.gl.deleteTexture(tex);

    // Alpha: EASU 2x cascade for transparent icons, opaque otherwise.
    const alphaBytes = transparent ? upscaleEasu(alphaAsGrayscale(source), iw, ih) : null;

    const mid: RgbaImage = {
      data: new Uint8ClampedArray(iw * ih * 4),
      width: iw,
      height: ih,
    };
    for (let i = 0; i < f32.length; i += 4) {
      const a = alphaBytes ? (alphaBytes.data[i] ?? 0) : 255;
      mid.data[i] = (f32[i] ?? 0) < 0 ? 0 : (f32[i] ?? 0) > 1 ? 255 : Math.round((f32[i] ?? 0) * 255);
      mid.data[i + 1] =
        (f32[i + 1] ?? 0) < 0 ? 0 : (f32[i + 1] ?? 0) > 1 ? 255 : Math.round((f32[i + 1] ?? 0) * 255);
      mid.data[i + 2] =
        (f32[i + 2] ?? 0) < 0 ? 0 : (f32[i + 2] ?? 0) > 1 ? 255 : Math.round((f32[i + 2] ?? 0) * 255);
      mid.data[i + 3] = a;
    }

    if (iw === targetWidth && ih === targetHeight) return mid;
    return upscaleMitchell(mid, targetWidth, targetHeight);
  } catch {
    return null;
  }
}
