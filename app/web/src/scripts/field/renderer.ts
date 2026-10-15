// TEST_GAP: WebGL2 rendering cannot run in jsdom; covered by the Playwright smoke in e2e/home.spec.ts.
import {
  lookAt,
  multiply,
  perspective,
  project as projectPoint,
  type Vec3,
} from "./math";

const VERTEX = `#version 300 es
  in vec3 aPos;
  in vec3 aTarget;
  in float aSeed;
  uniform mat4 uMVP;
  uniform float uTime;
  uniform float uScale;
  uniform float uMorph;
  uniform vec3 uFocus;
  uniform float uWarp;
  uniform vec3 uCenter;
  uniform float uSettled;
  uniform float uFade;
  out float vAlpha;
  out float vHot;
  void main() {
    float m = clamp(uMorph * 1.25 - aSeed * 0.25, 0.0, 1.0);
    m = m * m * (3.0 - 2.0 * m);
    vec3 base = mix(aPos, aTarget, m);
    float flight = 4.0 * m * (1.0 - m) * uWarp;
    float flash = uSettled < 0.0 ? 0.0 : exp(-uSettled * 2.6) * m * uWarp;
    if (uWarp > 0.5) {
      vec3 rel = base - uCenter;
      float a = (1.0 - m) * (2.4 + aSeed * 4.2);
      float c = cos(a);
      float s = sin(a);
      rel = vec3(c * rel.x - s * rel.z, rel.y, s * rel.x + c * rel.z);
      base = uCenter + rel * (1.0 + flight * (0.25 + aSeed * 0.35));
    }
    vec3 p = base + 0.007 * vec3(
      sin(uTime * 0.7 + aSeed * 40.0),
      cos(uTime * 0.6 + aSeed * 31.0),
      sin(uTime * 0.5 + aSeed * 17.0));
    gl_Position = uMVP * vec4(p, 1.0);
    float depth = max(gl_Position.w, 0.04);
    float near = smoothstep(0.32, 0.0, distance(base, uFocus));
    float hot = max(flight * 0.5, flash);
    vHot = max(near, hot);
    vAlpha = clamp(1.5 / depth, 0.06, 1.0) * (0.3 + aSeed * 0.7) * (1.0 + hot * 0.8) * (1.0 - uFade);
    gl_PointSize = min(uScale * (0.6 + aSeed * 1.1 + near * 2.4 + flight * 0.7 + flash * 1.2) / depth, uScale * 3.0);
  }`;

const FRAGMENT = `#version 300 es
  precision mediump float;
  in float vAlpha;
  in float vHot;
  out vec4 outColor;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    vec3 cyan = vec3(0.024, 0.714, 0.831);
    vec3 hi = vec3(0.404, 0.91, 0.976);
    vec3 color = mix(cyan, hi, vHot * 0.9 + soft * 0.2);
    outColor = vec4(color * soft * vAlpha * (1.0 + vHot * 1.8), 1.0);
  }`;

const UNIFORMS = [
  "uMVP",
  "uTime",
  "uScale",
  "uMorph",
  "uFocus",
  "uWarp",
  "uCenter",
  "uSettled",
  "uFade",
] as const;

export interface FieldOptions {
  positions: Float32Array;
  targets?: Float32Array;
  pointScale?: number;
  mobileScale?: number;
  isMobile?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface RenderOptions {
  eye: Vec3;
  target?: Vec3;
  fov?: number;
  time?: number;
  morph?: number;
  focus?: Vec3;
  warp?: boolean;
  center?: Vec3;
  settled?: number;
  fade?: number;
}

export interface Field {
  count: number;
  render(options: RenderOptions): void;
  project(point: Vec3): { x: number; y: number; w: number };
  pointAt(index: number, morph?: number): Vec3;
  resize(): void;
  setPositions(positions: Float32Array): void;
  dispose(): void;
}

export function createField(
  canvas: HTMLCanvasElement,
  options: FieldOptions,
): Field | null {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  const field = buildField(canvas, gl, options);
  if (!field) gl.getExtension("WEBGL_lose_context")?.loseContext();
  return field;
}

type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

interface Resources {
  buffers: Map<string, WebGLBuffer>;
  u: Uniforms;
  release(): void;
}

function createResources(
  gl: WebGL2RenderingContext,
  attributes: [string, Float32Array, number][],
): Resources | null {
  const shaders: WebGLShader[] = [];
  const buffers = new Map<string, WebGLBuffer>();
  let program: WebGLProgram | null = null;

  function release() {
    for (const buffer of buffers.values()) gl.deleteBuffer(buffer);
    buffers.clear();
    gl.deleteProgram(program);
    shaders.forEach((shader) => gl.deleteShader(shader));
  }

  function fail() {
    release();
    return null;
  }

  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return fail();
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return fail();
  }

  program = gl.createProgram();
  if (!program) return fail();
  for (const shader of shaders) gl.attachShader(program, shader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail();
  gl.useProgram(program);

  for (const [name, data, size] of attributes) {
    const buffer = gl.createBuffer();
    if (!buffer) return fail();
    buffers.set(name, buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  const linked = program;
  const u = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(linked, name)]),
  ) as Uniforms;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  return { buffers, u, release };
}

function buildField(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  {
    positions,
    targets = positions,
    pointScale = 8,
    mobileScale = 6,
    isMobile = false,
    onContextLost,
    onContextRestored,
  }: FieldOptions,
): Field | null {
  const count = positions.length / 3;
  const seeds = new Float32Array(count).map(() => Math.random());
  const attributes: [string, Float32Array, number][] = [
    ["aPos", positions, 3],
    ["aTarget", targets, 3],
    ["aSeed", seeds, 1],
  ];
  let gpu = createResources(gl, attributes);
  if (!gpu) return null;

  let base = positions;
  let drawn = count;
  let morphNow = 0;
  const projection = new Float32Array(16);
  const view = new Float32Array(16);
  const mvp = new Float32Array(16);

  function resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    if (!gpu) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(gpu.u.uScale, (isMobile ? mobileScale : pointScale) * dpr);
  }
  resize();
  addEventListener("resize", resize);

  function uploadBase() {
    if (!gpu) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffers.get("aPos")!);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, base.subarray(0, drawn * 3));
  }

  function contextLost(event: Event) {
    event.preventDefault();
    gpu = null;
    onContextLost?.();
  }

  function contextRestored() {
    gpu = createResources(gl, attributes);
    if (!gpu) return;
    uploadBase();
    resize();
    onContextRestored?.();
  }

  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);

  function render({
    eye,
    target = [0, 0, 0],
    fov = 0.85,
    time = 0,
    morph = 0,
    focus = [99, 99, 99],
    warp = false,
    center = [0, 0, 0],
    settled = -1,
    fade = 0,
  }: RenderOptions) {
    morphNow = morph;
    multiply(
      perspective(
        fov,
        canvas.clientWidth / canvas.clientHeight,
        0.04,
        50,
        projection,
      ),
      lookAt(eye, target, view),
      mvp,
    );
    if (!gpu) return;
    const { u } = gpu;
    gl.clearColor(0.039, 0.039, 0.059, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniformMatrix4fv(u.uMVP, false, mvp);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uMorph, morph);
    gl.uniform3fv(u.uFocus, focus);
    gl.uniform1f(u.uWarp, warp ? 1 : 0);
    gl.uniform3fv(u.uCenter, center);
    gl.uniform1f(u.uSettled, settled);
    gl.uniform1f(u.uFade, fade);
    gl.drawArrays(gl.POINTS, 0, drawn);
  }

  function pointAt(index: number, morph = morphNow): Vec3 {
    const k = Math.min(1, Math.max(0, morph));
    const at = (axis: number) =>
      base[index * 3 + axis] +
      (targets[index * 3 + axis] - base[index * 3 + axis]) * k;
    return [at(0), at(1), at(2)];
  }

  function project(point: Vec3) {
    return projectPoint(mvp, point, canvas.clientWidth, canvas.clientHeight);
  }

  function setPositions(next: Float32Array) {
    const points = Math.min(count, Math.floor(next.length / 3));
    if (!points) return;
    base = next;
    drawn = points;
    uploadBase();
  }

  function dispose() {
    canvas.removeEventListener("webglcontextlost", contextLost);
    canvas.removeEventListener("webglcontextrestored", contextRestored);
    removeEventListener("resize", resize);
    gpu?.release();
    gpu = null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return { count, render, project, pointAt, resize, setPositions, dispose };
}
