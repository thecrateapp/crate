import { api } from "@/lib/api";

export interface SystemPlaylistBlueprintCreateResult {
  id: number;
  name: string;
}

export async function createSystemPlaylistFromBlueprint({
  targetType,
  targetName,
  blueprintKey,
}: {
  targetType: "artist" | "genre";
  targetName: string;
  blueprintKey: string;
}) {
  return api<SystemPlaylistBlueprintCreateResult>(
    "/api/admin/system-playlists/from-blueprint",
    "POST",
    {
      target_type: targetType,
      target_name: targetName,
      blueprint_key: blueprintKey,
    },
  );
}
