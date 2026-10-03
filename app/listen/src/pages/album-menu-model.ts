import type { TFunction } from "i18next";
import { Heart, ListPlus, Plus } from "@crate/ui/icons";

import type { ContextMenuEntry } from "@/components/actions/ItemActionMenu";
import type { PlaylistOption } from "@/contexts/PlaylistComposerContext";

interface AlbumSelectionMenuActions {
  selectedCount: number;
  selectionMenuPlaylistOpen: boolean;
  playlists: PlaylistOption[];
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onTogglePlaylist: () => void;
  onCreatePlaylist: () => void;
  onAddToPlaylist: (playlistId: number) => void | Promise<void>;
  onAddToCollection: () => void | Promise<void>;
}

export function buildAlbumSelectionMenuItems(
  options: AlbumSelectionMenuActions,
  t: TFunction,
): ContextMenuEntry[] {
  return [
    {
      type: "label",
      key: "selected-count",
      label: t("common.selectedCount", { count: options.selectedCount }),
    },
    {
      key: "play-next",
      label: t("album.actions.playNext"),
      icon: ListPlus,
      onSelect: options.onPlayNext,
    },
    {
      key: "queue",
      label: t("album.actions.addToQueue"),
      icon: Plus,
      onSelect: options.onAddToQueue,
    },
    {
      type: "disclosure",
      key: "playlist",
      label: t("playlist.actions.addToPlaylist"),
      icon: ListPlus,
      expanded: options.selectionMenuPlaylistOpen,
      onToggle: options.onTogglePlaylist,
      items: [
        {
          key: "playlist-create",
          label: t("playlist.actions.addNew"),
          onSelect: options.onCreatePlaylist,
        },
        ...options.playlists.map((playlist) => ({
          key: `playlist-${playlist.id}`,
          label: playlist.name,
          onSelect: () => options.onAddToPlaylist(playlist.id),
        })),
      ],
    },
    {
      type: "divider",
      key: "collection-divider",
    },
    {
      key: "collection",
      label: t("album.actions.addToMyCollection"),
      icon: Heart,
      onSelect: options.onAddToCollection,
    },
  ];
}
