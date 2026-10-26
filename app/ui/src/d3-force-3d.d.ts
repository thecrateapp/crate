declare module "d3-force-3d" {
  interface CollideForce<N> {
    (alpha: number): void;
    initialize(nodes: N[]): void;
    radius(radius: number | ((node: N) => number)): CollideForce<N>;
    strength(strength: number): CollideForce<N>;
    iterations(iterations: number): CollideForce<N>;
  }

  export function forceCollide<N = unknown>(
    radius?: number | ((node: N) => number),
  ): CollideForce<N>;
}
