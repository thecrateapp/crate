export function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function clusterCenters(count, spread = 0.9) {
  return Array.from({ length: count }, () => {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 0.45 + Math.random() * spread;
    return {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.sin(phi) * Math.sin(theta) * 0.55,
      z: radius * Math.cos(phi),
      size: 0.09 + Math.random() * 0.2,
    };
  });
}

export function cloudPositions(count, centers) {
  const positions = new Float32Array(count * 3);
  const cluster = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    if (i % 8 === 0) {
      const a = centers[Math.floor(Math.random() * centers.length)];
      const b = centers[Math.floor(Math.random() * centers.length)];
      const t = Math.random();
      positions[i * 3] = a.x + (b.x - a.x) * t + gaussian() * 0.03;
      positions[i * 3 + 1] = a.y + (b.y - a.y) * t + gaussian() * 0.03;
      positions[i * 3 + 2] = a.z + (b.z - a.z) * t + gaussian() * 0.03;
      cluster[i] = 65535;
    } else {
      const index = i % centers.length;
      const c = centers[index];
      positions[i * 3] = c.x + gaussian() * c.size;
      positions[i * 3 + 1] = c.y + gaussian() * c.size * 0.8;
      positions[i * 3 + 2] = c.z + gaussian() * c.size;
      cluster[i] = index;
    }
  }
  return { positions, cluster };
}

export function ballPositions(count, radius = 1.5) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * Math.cbrt(Math.random());
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  return positions;
}

export async function sampleImage(
  src,
  count,
  { width = 1.6, threshold = 40, depth = 0.04 } = {},
) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const size = 360;
  const aspect = image.naturalHeight / image.naturalWidth || 1;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = Math.round(size * aspect);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const filled = [];
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > threshold) filled.push(x, y);
    }
  }
  const positions = new Float32Array(count * 3);
  const scale = width / canvas.width;
  for (let i = 0; i < count; i++) {
    const pick = Math.floor(Math.random() * (filled.length / 2)) * 2;
    positions[i * 3] =
      (filled[pick] + Math.random() - canvas.width / 2) * scale;
    positions[i * 3 + 1] =
      -(filled[pick + 1] + Math.random() - canvas.height / 2) * scale;
    positions[i * 3 + 2] = gaussian() * depth;
  }
  return positions;
}

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

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * nf,
    -1,
    0,
    0,
    2 * far * near * nf,
    0,
  ];
}

function lookAt(eye, target) {
  let z = eye.map((v, k) => v - target[k]);
  const zl = Math.hypot(...z);
  z = z.map((v) => v / zl);
  let x = [z[2], 0, -z[0]];
  const xl = Math.hypot(...x) || 1;
  x = x.map((v) => v / xl);
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  const dot = (a) => -(a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2]);
  return [
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    dot(x),
    dot(y),
    dot(z),
    1,
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

export function createField(
  canvas,
  {
    positions,
    targets = positions,
    pointScale = 8,
    mobileScale = 6,
    isMobile = false,
  },
) {
  const count = positions.length / 3;
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);

  const seeds = new Float32Array(count).map(() => Math.random());
  for (const [name, data, size] of [
    ["aPos", positions, 3],
    ["aTarget", targets, 3],
    ["aSeed", seeds, 1],
  ]) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  const u = Object.fromEntries(
    ["uMVP", "uTime", "uScale", "uMorph", "uFocus", "uMouse", "uRepel"].map(
      (name) => [name, gl.getUniformLocation(program, name)],
    ),
  );
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  let mvp = new Array(16).fill(0);
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
  }) {
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
    gl.drawArrays(gl.POINTS, 0, count);
  }

  function pointAt(index, morph = morphNow) {
    const k = Math.min(1, Math.max(0, morph));
    return [0, 1, 2].map(
      (axis) =>
        positions[index * 3 + axis] +
        (targets[index * 3 + axis] - positions[index * 3 + axis]) * k,
    );
  }

  function project(point) {
    const m = mvp;
    const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
    const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
    const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
    return {
      x: ((x / w) * 0.5 + 0.5) * canvas.clientWidth,
      y: (1 - ((y / w) * 0.5 + 0.5)) * canvas.clientHeight,
      w,
    };
  }

  return { count, render, project, pointAt, resize };
}
