export type Vec3 = [number, number, number];
export type Mat4 = number[] | Float32Array;

export function perspective(
  fov: number,
  aspect: number,
  near: number,
  far: number,
  out: Mat4 = new Array<number>(16),
): Mat4 {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function lookAt(
  eye: Vec3,
  target: Vec3,
  out: Mat4 = new Array<number>(16),
): Mat4 {
  let z0 = eye[0] - target[0];
  let z1 = eye[1] - target[1];
  let z2 = eye[2] - target[2];
  const zl = Math.hypot(z0, z1, z2);
  z0 /= zl;
  z1 /= zl;
  z2 /= zl;
  const xl = Math.hypot(z2, 0, -z0) || 1;
  const x0 = z2 / xl;
  const x1 = 0;
  const x2 = -z0 / xl;
  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;
  out[0] = x0;
  out[1] = y0;
  out[2] = z0;
  out[3] = 0;
  out[4] = x1;
  out[5] = y1;
  out[6] = z1;
  out[7] = 0;
  out[8] = x2;
  out[9] = y2;
  out[10] = z2;
  out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
  return out;
}

export function multiply(
  a: Mat4,
  b: Mat4,
  out: Mat4 = new Array<number>(16),
): Mat4 {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
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
