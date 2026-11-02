export type LabelSide = "above" | "below" | "left" | "right";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelCandidate {
  id: string;
  x: number;
  y: number;
  depth: number;
  width: number;
  height: number;
  gap: number;
  preferred: LabelSide;
  priority: number;
}

export interface LabelPlacement {
  side: LabelSide;
  hidden: boolean;
}

const SIDES: LabelSide[] = ["below", "right", "left", "above"];
const FORCED_PRIORITY = 1;

export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function labelRect(
  side: LabelSide,
  x: number,
  y: number,
  width: number,
  height: number,
  gap: number,
): Rect {
  if (side === "below")
    return { x: x - width / 2, y: y + gap, w: width, h: height };
  if (side === "above")
    return { x: x - width / 2, y: y - gap - height, w: width, h: height };
  if (side === "right")
    return { x: x + gap, y: y - height / 2, w: width, h: height };
  return { x: x - gap - width, y: y - height / 2, w: width, h: height };
}

export function preferredSide(dx: number, dy: number): LabelSide {
  if (Math.abs(dx) > Math.abs(dy) * 0.9) return dx < 0 ? "left" : "right";
  return dy < 0 ? "above" : "below";
}

export function placeLabels(
  candidates: LabelCandidate[],
  nodeRects: Map<string, Rect>,
  obstacles: Rect[] = [],
): Map<string, LabelPlacement> {
  const placed: Rect[] = [...obstacles];
  const result = new Map<string, LabelPlacement>();
  const ordered = [...candidates].sort(
    (a, b) =>
      a.priority - b.priority || a.depth - b.depth || (a.id < b.id ? -1 : 1),
  );
  for (const candidate of ordered) {
    const sides = [
      candidate.preferred,
      ...SIDES.filter((side) => side !== candidate.preferred),
    ];
    let chosen: { side: LabelSide; rect: Rect } | null = null;
    for (const side of sides) {
      const rect = labelRect(
        side,
        candidate.x,
        candidate.y,
        candidate.width,
        candidate.height,
        candidate.gap,
      );
      const blocked =
        placed.some((other) => overlaps(rect, other)) ||
        [...nodeRects].some(
          ([id, other]) => id !== candidate.id && overlaps(rect, other),
        );
      if (!blocked) {
        chosen = { side, rect };
        break;
      }
    }
    if (!chosen && candidate.priority <= FORCED_PRIORITY)
      chosen = {
        side: candidate.preferred,
        rect: labelRect(
          candidate.preferred,
          candidate.x,
          candidate.y,
          candidate.width,
          candidate.height,
          candidate.gap,
        ),
      };
    if (chosen) placed.push(chosen.rect);
    result.set(candidate.id, {
      side: chosen?.side ?? candidate.preferred,
      hidden: !chosen,
    });
  }
  return result;
}
