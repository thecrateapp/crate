import { api } from "@/lib/api";
import {
  artistActionApiPath,
  type AdminArtistRouteInput,
} from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";

/** Persist the reviewed prose through the metadata worker before reporting success. */
export async function saveArtistBiography(
  artist: AdminArtistRouteInput,
  proposal: string,
): Promise<string> {
  const endpoint = artistActionApiPath(artist, "metadata");
  if (!endpoint) throw new Error("Artist reference missing");
  const biography = proposal.trim();
  if (!biography) throw new Error("Biography cannot be empty");
  const queued = await api<{ task_id: string }>(endpoint, "PUT", {
    bio: biography,
  });
  const task = await waitForTask(queued.task_id, 60000);
  if (task.status !== "completed") {
    throw new Error(task.error || "Failed to save biography");
  }
  return biography;
}
