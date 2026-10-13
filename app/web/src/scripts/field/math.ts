export type Vec3 = [number, number, number];
export type Mat4 = number[];

export function perspective(
  fov: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
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

export function lookAt(eye: Vec3, target: Vec3): Mat4 {
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
  const dot = (a: number[]) => -(a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2]);
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

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

export function project(
  mvp: Mat4,
  point: Vec3,
  width: number,
  height: number,
): { x: number; y: number; w: number } {
  const m = mvp;
  const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
  const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
  const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
  return {
    x: ((x / w) * 0.5 + 0.5) * width,
    y: (1 - ((y / w) * 0.5 + 0.5)) * height,
    w,
  };
}
