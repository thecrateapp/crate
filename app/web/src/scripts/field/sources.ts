export type Random = () => number;

export interface ClusterCenter {
  x: number;
  y: number;
  z: number;
  size: number;
}

export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(random: Random = Math.random): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function clusterCenters(
  count: number,
  spread = 0.9,
  random: Random = Math.random,
): ClusterCenter[] {
  return Array.from({ length: count }, () => {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const radius = 0.45 + random() * spread;
    return {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.sin(phi) * Math.sin(theta) * 0.55,
      z: radius * Math.cos(phi),
      size: 0.09 + random() * 0.2,
    };
  });
}

export function cloudPositions(
  count: number,
  centers: ClusterCenter[],
  random: Random = Math.random,
): { positions: Float32Array; cluster: Uint16Array } {
  const positions = new Float32Array(count * 3);
  const cluster = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    if (i % 8 === 0) {
      const a = centers[Math.floor(random() * centers.length)];
      const b = centers[Math.floor(random() * centers.length)];
      const t = random();
      positions[i * 3] = a.x + (b.x - a.x) * t + gaussian(random) * 0.03;
      positions[i * 3 + 1] = a.y + (b.y - a.y) * t + gaussian(random) * 0.03;
      positions[i * 3 + 2] = a.z + (b.z - a.z) * t + gaussian(random) * 0.03;
      cluster[i] = 65535;
    } else {
      const index = i % centers.length;
      const c = centers[index];
      positions[i * 3] = c.x + gaussian(random) * c.size;
      positions[i * 3 + 1] = c.y + gaussian(random) * c.size * 0.8;
      positions[i * 3 + 2] = c.z + gaussian(random) * c.size;
      cluster[i] = index;
    }
  }
  return { positions, cluster };
}

export async function sampleImage(
  src: string,
  count: number,
  { width = 1.6, threshold = 40, depth = 0.04 } = {},
  random: Random = Math.random,
): Promise<Float32Array> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const size = 360;
  const aspect = image.naturalHeight / image.naturalWidth || 1;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = Math.round(size * aspect);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const filled: number[] = [];
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > threshold) filled.push(x, y);
    }
  }
  const positions = new Float32Array(count * 3);
  const scale = width / canvas.width;
  for (let i = 0; i < count; i++) {
    const pick = Math.floor(random() * (filled.length / 2)) * 2;
    positions[i * 3] = (filled[pick] + random() - canvas.width / 2) * scale;
    positions[i * 3 + 1] =
      -(filled[pick + 1] + random() - canvas.height / 2) * scale;
    positions[i * 3 + 2] = gaussian(random) * depth;
  }
  return positions;
}

export function decodeCloud(buffer: ArrayBuffer, scale: number): Float32Array {
  const ints = new Int16Array(buffer);
  const out = new Float32Array(ints.length);
  for (let i = 0; i < ints.length; i++) out[i] = (ints[i] / 32767) * scale;
  return out;
}

interface CloudMeta {
  count: number;
  radius: number;
}

export async function loadLibraryCloud(
  count: number,
  base = "/data/library-cloud",
): Promise<Float32Array | null> {
  const init = { priority: "low" } as RequestInit;
  try {
    const meta = await fetch(`${base}.json`, init);
    if (!meta.ok) return null;
    const { count: exported, radius } = (await meta.json()) as CloudMeta;
    const response = await fetch(`${base}.bin`, init);
    if (!response.ok) return null;
    const cloud = decodeCloud(await response.arrayBuffer(), radius);
    const points = Math.min(count, exported, Math.floor(cloud.length / 3));
    return points > 0 ? cloud.subarray(0, points * 3) : null;
  } catch {
    return null;
  }
}
