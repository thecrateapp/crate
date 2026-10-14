// TEST_GAP: WebGL2 rendering cannot run in jsdom; covered by the Playwright smoke in e2e/home.spec.ts.
import {
  lookAt,
  multiply,
  perspective,
  project as projectPoint,
  type Mat4,
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
  uniform vec2 uMouse;
  uniform float uRepel;
  out float vAlpha;
  out float vHot;
  void main() {
    float m = clamp(uMorph * 1.25 - aSeed * 0.25, 0.0, 1.0);
    m = m * m * (3.0 - 2.0 * m);
    vec3 base = mix(aPos, aTarget, m);
    vec3 p = base + 0.007 * vec3(
      sin(uTime * 0.7 + aSeed * 40.0),
      cos(uTime * 0.6 + aSeed * 31.0),
      sin(uTime * 0.5 + aSeed * 17.0));
    gl_Position = uMVP * vec4(p, 1.0);
    float depth = max(gl_Position.w, 0.04);
    vec2 ndc = gl_Position.xy / gl_Position.w;
    vec2 away = ndc - uMouse;
    float d = length(away * vec2(1.0, 0.6));
    float push = uRepel * smoothstep(0.17, 0.0, d);
    gl_Position.xy += normalize(away + 0.0001) * push * 0.09 * gl_Position.w;
    float near = smoothstep(0.32, 0.0, distance(base, uFocus));
    vHot = max(near, push * 0.8);
    vAlpha = clamp(1.5 / depth, 0.06, 1.0) * (0.3 + aSeed * 0.7);
    gl_PointSize = min(uScale * (0.6 + aSeed * 1.1 + near * 2.4) / depth, uScale * 2.2);
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
  "uMouse",
  "uRepel",
] as const;

export interface FieldOptions {
  positions: Float32Array;
  targets?: Float32Array;
  pointScale?: number;
  mobileScale?: number;
  isMobile?: boolean;
}

export interface RenderOptions {
  eye: Vec3;
  target?: Vec3;
  fov?: number;
  time?: number;
  morph?: number;
  focus?: Vec3;
  mouse?: [number, number];
  repel?: number;
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
  return gl ? buildField(canvas, gl, options) : null;
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
  }: FieldOptions,
): Field | null {
  const count = positions.length / 3;

  function compile(type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
    return shader;
  }

  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const seeds = new Float32Array(count).map(() => Math.random());
  const buffers = new Map<string, WebGLBuffer>();
  for (const [name, data, size] of [
    ["aPos", positions, 3],
    ["aTarget", targets, 3],
    ["aSeed", seeds, 1],
  ] as const) {
    const buffer = gl.createBuffer();
    if (!buffer) return null;
    buffers.set(name, buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  const u = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  let base = positions;
  let drawn = count;
  let mvp: Mat4 = new Array<number>(16).fill(0);
  let morphNow = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(u.uScale, (isMobile ? mobileScale : pointScale) * dpr);
  }
  resize();
  addEventListener("resize", resize);

  function render({
    eye,
    target = [0, 0, 0],
    fov = 0.85,
    time = 0,
    morph = 0,
    focus = [99, 99, 99],
    mouse = [9, 9],
    repel = 0,
  }: RenderOptions) {
    morphNow = morph;
    mvp = multiply(
      perspective(fov, canvas.clientWidth / canvas.clientHeight, 0.04, 50),
      lookAt(eye, target),
    );
    gl.clearColor(0.039, 0.039, 0.059, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniformMatrix4fv(u.uMVP, false, mvp);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uMorph, morph);
    gl.uniform3fv(u.uFocus, focus);
    gl.uniform2fv(u.uMouse, mouse);
    gl.uniform1f(u.uRepel, repel);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.get("aPos")!);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, next.subarray(0, points * 3));
  }

  function dispose() {
    removeEventListener("resize", resize);
    for (const buffer of buffers.values()) gl.deleteBuffer(buffer);
    buffers.clear();
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return { count, render, project, pointAt, resize, setPositions, dispose };
}
