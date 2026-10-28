import type { PlaySource } from "@/contexts/player-types";
import { pathPagePath } from "@/components/actions/path-actions";

export function createPathPlaySource(path: {
  id: number;
  name: string;
}): PlaySource {
  return {
    type: "path",
    id: path.id,
    name: path.name,
    href: pathPagePath(path.id),
  };
}

export function getPlaySourceHref(source: PlaySource | null): string | null {
  if (source?.type !== "path" || source.id == null) return null;
  const id = Number(source.id);
  return Number.isSafeInteger(id) && id > 0 ? pathPagePath(id) : null;
}

export function getPlaySourceLabel(
  playSource: PlaySource | null,
): string | null {
  if (!playSource) return null;
  if (playSource.radio?.seedType === "discovery") return "Discovery Radio";
  const name = playSource.name?.trim();
  return name || null;
}
