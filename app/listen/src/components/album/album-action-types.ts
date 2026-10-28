import type { AlbumData } from "@/pages/album-types";

export type { AlbumActionState, AlbumActionHandlers } from "./AlbumActionsView";

export interface AlbumActionData {
  data: AlbumData;
  coverUrl: string;
  displayName: string;
  globalAlbumUid: string | null;
}
