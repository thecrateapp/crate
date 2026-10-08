import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Check,
  CrateBox,
  Download,
  Heart,
  HeartBold,
  ListMusic,
  ListPlus,
  Loader2,
  Play,
  Radio,
  Share2,
  Shuffle,
  UserRound,
} from "@crate/ui/icons";
import { notify } from "@crate/ui/lib/notify";

import type { ItemActionMenuEntry } from "@crate/ui/domain/actions";
import {
  action,
  fetchAlbumTracks,
  sharePath,
  type AlbumMenuData,
} from "@/components/actions/shared";
import { usePlayerActions, type PlaySource } from "@/contexts/PlayerContext";
import { useOffline } from "@/contexts/OfflineContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
import {
  openCrateComposerForAlbum,
  useOptionalCrateComposer,
} from "@/contexts/CrateComposerContext";
import { useOptionalPlaylistComposer } from "@/contexts/PlaylistComposerContext";
import {
  useLazyCrateOptions,
  type CrateOption,
} from "@/hooks/use-lazy-crate-options";
import { api } from "@/lib/api";
import {
  albumDownloadApiPath,
  albumPagePath,
  albumSharePath,
  artistPagePath,
  downloadApiUrl,
} from "@/lib/library-routes";
import { isOfflineBusy, type OfflineItemState } from "@/lib/offline";
import { fetchAlbumRadio } from "@/lib/radio";
import { toTrackReferencePayload } from "@/lib/track-reference";
import { shuffleArray } from "@/lib/utils";

export interface AlbumMenuOptions {
  saved: boolean;
  canSave: boolean;
  canAddToCrate: boolean;
  canAddToPlaylist: boolean;
  canRadio: boolean;
  canPlay?: boolean;
  canDownload: boolean;
  offlineEnabled: boolean;
  offlineState: OfflineItemState;
  offlineLabel: string;
  globalAlbumUid?: string | null;
  crates: CrateOption[];
  cratePickerOpen: boolean;
  playlists: Array<{ id: number; name: string }>;
  playlistPickerOpen: boolean;
  onPlay: () => void | Promise<void>;
  onPlayNext: () => void | Promise<void>;
  onShuffle: () => void | Promise<void>;
  onToggleCratePicker: () => void;
  onCreateCrate: () => void;
  onAddToCrate: (crate: CrateOption) => void | Promise<void>;
  onTogglePlaylistPicker: () => void;
  onCreatePlaylist: () => void | Promise<void>;
  onAddToPlaylist: (playlistId: number) => void | Promise<void>;
  onToggleSaved: () => void | Promise<void>;
  onRadio: () => void | Promise<void>;
  onToggleOffline: () => void | Promise<void>;
  onDownload: () => void | Promise<void>;
  onGoToArtist: () => void;
  onShare: () => void | Promise<void>;
}

function offlineIcon(state: OfflineItemState) {
  if (isOfflineBusy(state)) return Loader2;
  if (state === "ready") return ArrowDownToLineBold;
  if (state === "error") return AlertCircle;
  return ArrowDownToLine;
}

export function buildAlbumMenuEntries(
  options: AlbumMenuOptions,
  t: TFunction,
): ItemActionMenuEntry[] {
  const entries: ItemActionMenuEntry[] = [
    action({
      key: "play",
      label: t("actions.album.play"),
      icon: Play,
      disabled: options.canPlay === false,
      onSelect: options.onPlay,
    }),
    action({
      key: "play-next",
      label: t("album.actions.playNext"),
      icon: ListPlus,
      disabled: options.canPlay === false,
      onSelect: options.onPlayNext,
    }),
    action({
      key: "shuffle",
      label: t("actions.album.shuffle"),
      icon: Shuffle,
      disabled: options.canPlay === false,
      onSelect: options.onShuffle,
    }),
    { type: "divider", key: "divider-album-main" },
  ];

  if (options.canAddToCrate) {
    entries.push({
      type: "disclosure",
      key: "crate",
      label: t("album.actions.addToCrate"),
      icon: CrateBox,
      expanded: options.cratePickerOpen,
      onToggle: options.onToggleCratePicker,
      items: [
        {
          key: "crate-create",
          label: t("library.crates.create"),
          onSelect: options.onCreateCrate,
        },
        ...options.crates.map((crate) => {
          const alreadyInCrate = Boolean(
            options.globalAlbumUid &&
              crate.albumUids.includes(options.globalAlbumUid),
          );
          return {
            key: `crate-${crate.id}`,
            label: crate.name,
            icon: alreadyInCrate ? Check : undefined,
            active: alreadyInCrate,
            onSelect: () => options.onAddToCrate(crate),
          };
        }),
      ],
    });
  }

  if (options.canAddToPlaylist) {
    entries.push({
      type: "disclosure",
      key: "playlist",
      label: t("playlist.actions.addToPlaylist"),
      icon: ListMusic,
      expanded: options.playlistPickerOpen,
      onToggle: options.onTogglePlaylistPicker,
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
    });
  }

  entries.push(
    action({
      key: "save",
      label: options.saved
        ? t("album.actions.removeFromCollection")
        : t("album.actions.addToCollection"),
      icon: options.saved ? HeartBold : Heart,
      active: options.saved,
      disabled: !options.canSave,
      onSelect: options.onToggleSaved,
    }),
    action({
      key: "radio",
      label: t("actions.album.radio"),
      icon: Radio,
      disabled: !options.canRadio,
      onSelect: options.onRadio,
    }),
    action({
      key: "offline",
      label: options.offlineLabel,
      icon: offlineIcon(options.offlineState),
      active: options.offlineState === "ready",
      disabled: !options.offlineEnabled || isOfflineBusy(options.offlineState),
      onSelect: options.onToggleOffline,
    }),
    action({
      key: "download",
      label: t("actions.album.downloadZip"),
      icon: Download,
      disabled: !options.canDownload,
      onSelect: options.onDownload,
    }),
    { type: "divider", key: "divider-album-links" },
    action({
      key: "artist",
      label: t("album.actions.goToArtist"),
      icon: UserRound,
      onSelect: options.onGoToArtist,
    }),
    action({
      key: "share",
      label: t("actions.album.share"),
      icon: Share2,
      onSelect: options.onShare,
    }),
  );

  return entries;
}

function albumPlaySource(data: AlbumMenuData): PlaySource {
  const seedId = data.albumId ?? data.globalAlbumUid;
  return {
    type: "album",
    name: `${data.artist} - ${data.album}`,
    radio: seedId != null ? { seedType: "album", seedId } : undefined,
  };
}

function offlineActionLabelKey(state: OfflineItemState) {
  switch (state) {
    case "ready":
      return "actions.offline.removeCopy";
    case "error":
      return "actions.offline.retryCopy";
    case "queued":
    case "downloading":
      return "actions.offline.downloading";
    case "syncing":
      return "actions.offline.syncing";
    default:
      return "actions.offline.makeAvailable";
  }
}

export function useAlbumActionEntries(
  input: AlbumMenuData,
): ItemActionMenuEntry[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll, playNext } = usePlayerActions();
  const { isSaved, toggleAlbumSaved } = useSavedAlbums();
  const {
    supported: offlineSupported,
    getAlbumState,
    toggleAlbumOffline,
  } = useOffline();
  const saved = isSaved(input.albumId, input.globalAlbumUid);
  const crateComposer = useOptionalCrateComposer();
  const playlistComposer = useOptionalPlaylistComposer();
  const [cratePickerOpen, setCratePickerOpen] = useState(false);
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const { crateOptions, ensureCrateOptionsLoaded } = useLazyCrateOptions();
  const offlineState = getAlbumState(input.albumId);
  const radioSeed = input.albumId ?? input.globalAlbumUid ?? null;
  const playlistOptions = playlistComposer?.playlistOptions;

  return useMemo<ItemActionMenuEntry[]>(() => {
    const albumPath = albumPagePath({
      albumId: input.albumId,
      albumEntityUid: input.albumEntityUid,
      globalAlbumUid: input.globalAlbumUid,
      albumSlug: input.albumSlug,
      artistEntityUid: input.artistEntityUid,
      artistSlug: input.artistSlug,
      artistName: input.artist,
      albumName: input.album,
    });
    const albumShare = albumSharePath({
      albumId: input.albumId,
      albumEntityUid: input.albumEntityUid,
      globalAlbumUid: input.globalAlbumUid,
      albumSlug: input.albumSlug,
      artistSlug: input.artistSlug,
      artistName: input.artist,
      albumName: input.album,
    });
    const hasAlbumRef = input.albumId != null || Boolean(input.globalAlbumUid);

    async function loadTracks() {
      try {
        const tracks = await fetchAlbumTracks(input);
        if (!tracks.length) notify.info(t("actions.album.toasts.noTracks"));
        return tracks;
      } catch {
        notify.error(t("actions.album.toasts.loadFailed"));
        return [];
      }
    }

    return buildAlbumMenuEntries(
      {
        saved,
        canSave: hasAlbumRef,
        canAddToCrate: Boolean(input.globalAlbumUid),
        canAddToPlaylist:
          !input.isPreRelease && hasAlbumRef && playlistComposer != null,
        canRadio: radioSeed != null && !input.isPreRelease,
        canDownload: input.albumId != null || Boolean(input.albumEntityUid),
        offlineEnabled: offlineSupported && input.albumId != null,
        offlineState,
        offlineLabel: t(offlineActionLabelKey(offlineState)),
        globalAlbumUid: input.globalAlbumUid,
        crates: crateOptions,
        cratePickerOpen,
        playlists: playlistOptions ?? [],
        playlistPickerOpen,
        onPlay: async () => {
          const tracks = await loadTracks();
          if (tracks.length) playAll(tracks, 0, albumPlaySource(input));
        },
        onPlayNext: async () => {
          const tracks = await loadTracks();
          if (!tracks.length) return;
          [...tracks].reverse().forEach((track) => playNext(track));
          notify.success(t("album.toasts.queuedNext"));
        },
        onShuffle: async () => {
          const tracks = await loadTracks();
          if (tracks.length) {
            playAll(shuffleArray(tracks), 0, albumPlaySource(input));
          }
        },
        onToggleCratePicker: () => {
          ensureCrateOptionsLoaded();
          setCratePickerOpen((open) => !open);
        },
        onCreateCrate: () => {
          const opened = openCrateComposerForAlbum(crateComposer, {
            globalAlbumUid: input.globalAlbumUid,
            name: input.album,
            artistName: input.artist,
          });
          if (opened) setCratePickerOpen(false);
        },
        onAddToCrate: async (crate) => {
          const alreadyInCrate = Boolean(
            input.globalAlbumUid &&
              crate.albumUids.includes(input.globalAlbumUid),
          );
          if (alreadyInCrate) {
            notify.info(t("album.toasts.alreadyInCrate", { name: crate.name }));
            return;
          }
          try {
            await api(`/api/crates/${crate.id}/albums`, "POST", {
              global_album_uid: input.globalAlbumUid,
            });
            setCratePickerOpen(false);
            notify.success(t("album.toasts.addedToCrate"));
          } catch (error) {
            if ((error as { status?: number }).status === 409) {
              notify.info(
                t("album.toasts.alreadyInCrate", { name: crate.name }),
              );
              return;
            }
            notify.error(t("album.toasts.addToCrateFailed"));
          }
        },
        onTogglePlaylistPicker: () => {
          playlistComposer?.ensurePlaylistOptionsLoaded();
          setPlaylistPickerOpen((open) => !open);
        },
        onCreatePlaylist: async () => {
          const tracks = await loadTracks();
          if (!tracks.length) return;
          playlistComposer?.openCreatePlaylist({ name: input.album, tracks });
          setPlaylistPickerOpen(false);
        },
        onAddToPlaylist: async (playlistId) => {
          const tracks = await loadTracks();
          if (!tracks.length) return;
          try {
            await api(`/api/playlists/${playlistId}/tracks`, "POST", {
              tracks: tracks.map((track) => toTrackReferencePayload(track)),
            });
            setPlaylistPickerOpen(false);
            notify.success(t("album.toasts.addedToPlaylist"));
          } catch {
            notify.error(t("album.toasts.addToPlaylistFailed"));
          }
        },
        onToggleSaved: async () => {
          await toggleAlbumSaved(
            input.albumId ?? null,
            input.globalAlbumUid ?? null,
          );
        },
        onRadio: async () => {
          if (radioSeed == null) return;
          try {
            const radio = await fetchAlbumRadio({
              albumId: radioSeed,
              artistName: input.artist,
              albumName: input.album,
            });
            if (!radio.tracks.length) {
              notify.info(t("actions.album.toasts.radioUnavailable"));
              return;
            }
            playAll(radio.tracks, 0, radio.source);
          } catch {
            notify.error(t("actions.album.toasts.radioFailed"));
          }
        },
        onToggleOffline: async () => {
          try {
            const result = await toggleAlbumOffline({
              albumId: input.albumId,
              title: input.album,
            });
            notify.success(
              result === "removed"
                ? t("actions.offline.toasts.removed")
                : t("actions.album.toasts.offlineReady"),
            );
          } catch (error) {
            notify.error(
              (error as Error).message ||
                t("actions.offline.toasts.updateFailed"),
            );
          }
        },
        onDownload: () => {
          const url = downloadApiUrl(
            albumDownloadApiPath({
              albumId: input.albumId,
              albumEntityUid: input.albumEntityUid,
              artistName: input.artist,
              albumName: input.album,
            }),
          );
          if (url) window.location.assign(url);
        },
        onGoToArtist: () =>
          navigate(
            artistPagePath({
              artistEntityUid: input.artistEntityUid,
              artistSlug: input.artistSlug,
              artistName: input.artist,
            }),
          ),
        onShare: sharePath(albumShare || albumPath, input.album, {
          kind: "album",
          subtitle: input.artist,
          imageUrl: input.cover,
          copiedToast: t("share.toasts.linkCopied"),
        }),
      },
      t,
    );
  }, [
    input,
    cratePickerOpen,
    crateOptions,
    ensureCrateOptionsLoaded,
    crateComposer,
    navigate,
    offlineState,
    offlineSupported,
    playAll,
    playNext,
    playlistComposer,
    playlistOptions,
    playlistPickerOpen,
    radioSeed,
    saved,
    t,
    toggleAlbumOffline,
    toggleAlbumSaved,
  ]);
}
