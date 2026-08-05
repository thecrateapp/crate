import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Globe2,
  GripVertical,
  ListMusic,
  Loader2,
  Lock,
  MoreHorizontal,
  Pause,
  Pin,
  Play,
  Plus,
  Power,
  QrCode,
  Radio,
  Search,
  Share2,
  SkipForward,
  Trash2,
  Users,
  Zap,
} from "@crate/ui/icons";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { Button } from "@crate/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { QrCodeImage } from "@crate/ui/primitives/QrCodeImage";
import { useAuth } from "@/contexts/AuthContext";
import {
  type Track,
  usePlayerActions,
  usePlayerProgress,
  usePlayerState,
} from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { api } from "@/lib/api";
import { useJamWebSocket } from "@/hooks/use-jam-websocket";
import { useJamSessionState } from "@/hooks/use-jam-session-state";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { formatDuration } from "@/lib/utils";
import {
  payloadToTrack,
  type JamEvent,
  type JamInvite,
  type JamMember,
  type JamQueueItem,
  type JamRoom,
  type JamQueueMode,
  type JamRoomsResponse,
  type SearchData,
  type SearchTrack,
} from "@/pages/jam-reducer";
import { PLAYER_TRACK_FINISHED_EVENT } from "@/contexts/player-events";
import { tracksMatch as playerTracksMatch } from "@/contexts/player-session";
import {
  getPlaybackDeliveryPolicyPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
  setPlaybackDeliveryPolicyPreference,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";

interface HeroActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  loading?: boolean;
  children: ReactNode;
}

function HeroActionButton({
  label,
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: HeroActionButtonProps) {
  return (
    <ActionIconButton
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={`h-11 w-11 border border-white/10 bg-white/[0.04] text-muted-foreground hover:border-white/20 hover:bg-white/[0.08] hover:text-foreground disabled:opacity-35 ${className}`}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : children}
    </ActionIconButton>
  );
}

interface HeroPrimaryButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  loading?: boolean;
  children: ReactNode;
}

interface GenreTaxonomyNode {
  slug: string;
  name: string;
  alias_names?: string[];
}

interface GenreTaxonomyTreeResponse {
  nodes: GenreTaxonomyNode[];
}

const EMPTY_GENRE_TAXONOMY_NODES: GenreTaxonomyNode[] = [];

function HeroPrimaryButton({
  label,
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: HeroPrimaryButtonProps) {
  return (
    <Button
      type="button"
      aria-label={label}
      disabled={disabled || loading}
      variant="outline"
      size="lg"
      className={`h-11 px-3.5 disabled:opacity-35 ${className}`}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : children}
      <span>{label}</span>
    </Button>
  );
}

const jamQueueItemClassName =
  "flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3";

function SortableJamQueueItem({
  id,
  dragLabel,
  children,
}: {
  id: string;
  dragLabel: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className={jamQueueItemClassName}
    >
      <button
        type="button"
        aria-label={dragLabel}
        title={dragLabel}
        className="shrink-0 touch-none cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      {children}
    </div>
  );
}

function JamQueueItemShell({
  sortable,
  id,
  dragLabel,
  children,
}: {
  sortable: boolean;
  id: string;
  dragLabel: string;
  children: ReactNode;
}) {
  if (sortable) {
    return (
      <SortableJamQueueItem id={id} dragLabel={dragLabel}>
        {children}
      </SortableJamQueueItem>
    );
  }
  return <div className={jamQueueItemClassName}>{children}</div>;
}

function trackToPayload(track: Track) {
  return {
    id: track.id,
    globalTrackUid: track.globalTrackUid,
    globalArtistUid: track.globalArtistUid,
    globalAlbumUid: track.globalAlbumUid,
    entityUid: track.entityUid,
    title: track.title,
    artist: track.artist,
    artistId: track.artistId,
    artistEntityUid: track.artistEntityUid,
    artistSlug: track.artistSlug,
    album: track.album,
    albumId: track.albumId,
    albumEntityUid: track.albumEntityUid,
    albumSlug: track.albumSlug,
    duration: track.duration,
    path: track.path,
    libraryTrackId: track.libraryTrackId,
  };
}

function trackIdentity(track: Track) {
  return (
    track.globalTrackUid ||
    track.entityUid ||
    (track.libraryTrackId != null ? `library:${track.libraryTrackId}` : null) ||
    track.id ||
    track.path ||
    "unknown"
  );
}

function searchTrackToTrack(track: SearchTrack): Track {
  const globalTrackUid =
    track.globalTrackUid ?? track.global_track_uid ?? track.global_uid;
  const globalAlbumUid =
    track.globalAlbumUid ?? track.global_album_uid ?? track.album_entity_uid;
  return toPlayableTrack(
    {
      ...track,
      globalTrackUid,
      globalAlbumUid,
      library_track_id:
        !globalTrackUid && typeof track.id === "number" ? track.id : undefined,
    },
    {
      cover: track.album
        ? globalTrackUid && globalAlbumUid
          ? albumCoverApiUrl({ globalAlbumUid }, { size: 512 })
          : albumCoverApiUrl(
              {
                albumId: track.album_id,
                albumEntityUid: track.album_entity_uid,
                artistEntityUid: track.artist_entity_uid,
                albumSlug: track.album_slug,
                artistName: track.artist,
                albumName: track.album,
              },
              { size: 512 },
            )
        : undefined,
    },
  );
}

function parseRoomTags(value: string) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value.split(/[,\n]/)) {
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag.slice(0, 40));
    if (tags.length >= 12) break;
  }
  return tags;
}

function formatRoomTagsInput(tags: string[] | undefined | null) {
  return (tags || []).join(", ");
}

function displayName(person: {
  display_name?: string | null;
  username?: string | null;
  user_id?: number | null;
}) {
  const profileName = person.display_name?.trim();
  const username = person.username?.trim();
  return (
    profileName ||
    username ||
    (person.user_id ? `User ${person.user_id}` : "Someone")
  );
}

function resolveJamActor(
  event: JamEvent,
  members: JamMember[],
  currentUser?: {
    id: number;
    username?: string | null;
    name?: string | null;
    avatar?: string | null;
  } | null,
) {
  const member =
    event.user_id == null
      ? null
      : members.find((candidate) => candidate.user_id === event.user_id);
  const ownUser =
    currentUser && event.user_id === currentUser.id ? currentUser : null;
  const actor = {
    user_id: event.user_id,
    username: event.username || member?.username || ownUser?.username || null,
    display_name:
      event.display_name || member?.display_name || ownUser?.name || null,
    avatar: event.avatar || member?.avatar || ownUser?.avatar || null,
  };
  return {
    name: displayName(actor),
    avatar: actor.avatar,
    user_id: actor.user_id,
  };
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] || "?").toUpperCase() + (parts[1]?.[0] || "").toUpperCase()
  );
}

function AvatarBubble({
  name,
  avatar,
  userId,
  size = "md",
}: {
  name: string;
  avatar?: string | null;
  userId?: number | null;
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "h-9 w-9 text-[11px]" : "h-11 w-11 text-xs";
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(avatar, userId);
  if (avatarUrl) {
    return (
      <CrateImage
        src={avatarUrl}
        alt=""
        onError={handleAvatarError}
        className={`${sizeClass} shrink-0 rounded-full border border-white/10 object-cover`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] font-semibold text-white/70`}
    >
      {initials(name)}
    </div>
  );
}

function eventActivityText(
  event: JamEvent,
  actorName: string | undefined,
  t: TFunction,
) {
  const payload = (event.payload_json || {}) as Record<string, unknown>;
  const actor =
    payload.source === "auto_dj" ? "Crate DJ" : actorName || displayName(event);
  const track = payloadToTrack(
    payload.track as Record<string, unknown> | undefined,
  );
  if (event.event_type === "join") return t("jam.activity.join", { actor });
  if (event.event_type === "queue_add")
    return t("jam.activity.queueAdd", {
      actor,
      title: track?.title || t("jam.activity.aTrack"),
    });
  if (event.event_type === "queue_remove")
    return t("jam.activity.queueRemove", { actor });
  if (event.event_type === "queue_reorder")
    return t("jam.activity.queueReorder", { actor });
  if (event.event_type === "play") return t("jam.activity.play", { actor });
  if (event.event_type === "pause") return t("jam.activity.pause", { actor });
  if (event.event_type === "seek") return t("jam.activity.seek", { actor });
  if (event.event_type === "room_updated")
    return t("jam.activity.roomUpdated", { actor });
  if (event.event_type === "room_ended")
    return t("jam.activity.roomEnded", { actor });
  return t("jam.activity.fallback", {
    actor,
    event: event.event_type.replace("_", " "),
  });
}

function extractInviteToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const marker = "/jam/invite/";
  const index = trimmed.indexOf(marker);
  if (index >= 0) {
    return trimmed.slice(index + marker.length).replace(/^\/+/, "");
  }
  return trimmed.replace(/^\/+/, "");
}

export function JamSession() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const { user } = useAuth();
  const [roomQueueMode, setRoomQueueMode] = useState<JamQueueMode>("manual");
  const [roomGenreFiltersInput, setRoomGenreFiltersInput] = useState("");
  const [roomGenreFilters, setRoomGenreFilters] = useState<string[]>([]);
  const [genreSuggestionIndex, setGenreSuggestionIndex] = useState(0);
  const [roomAutoDjVoting, setRoomAutoDjVoting] = useState(true);
  const [roomActionsOpen, setRoomActionsOpen] = useState(false);
  const queueSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const { currentTime, duration } = usePlayerProgress();
  const { isPlaying } = usePlayerState();
  const {
    currentTrack,
    play,
    playAll,
    pause,
    resume,
    seek,
    setPlaybackRate,
    enterJamSession,
    leaveJamSession,
    setJamTransport,
    syncJamQueue,
  } = usePlayerActions();
  const {
    state,
    dispatch,
    setRoomSearch,
    setRoom,
    setRoomName,
    setRoomDescription,
    setRoomTagsInput,
    setRoomVisibility,
    setRoomPermanent,
    setCreating,
    setJoiningRoomId,
    setInviteInput,
    setInviteData,
    setCreatingInvite,
    setInviteModalOpen,
    setMetadataModalOpen,
    setMetadataDescription,
    setMetadataTagsInput,
    setEndingRoom,
    setDeletingRoomId,
    setDeleteTargetRoom,
    setUpdatingRoomField,
    setQueueSearch,
    setQueueSearchResults,
    setQueueSearchLoading,
    setSyncStatus,
  } = useJamSessionState();

  const {
    roomSearch,
    room,
    roomName,
    roomDescription,
    roomTagsInput,
    roomVisibility,
    roomPermanent,
    creating,
    joiningRoomId,
    inviteInput,
    inviteData,
    creatingInvite,
    inviteModalOpen,
    metadataModalOpen,
    metadataDescription,
    metadataTagsInput,
    endingRoom,
    deletingRoomId,
    deleteTargetRoom,
    updatingRoomField,
    queueSearch,
    queueSearchResults,
    queueSearchLoading,
    queueItems,
    pendingRequests,
    syncStatus,
    isConnected,
    connectionProblem,
  } = state;

  const deferredRoomSearch = useDeferredValue(roomSearch);
  const roomsUrl = !roomId
    ? `/api/jam/rooms${
        deferredRoomSearch.trim()
          ? `?q=${encodeURIComponent(deferredRoomSearch.trim())}`
          : ""
      }`
    : null;
  const { data, loading, error } = useApi<JamRoom>(
    roomId ? `/api/jam/rooms/${roomId}` : null,
  );
  const {
    data: roomsData,
    loading: roomsLoading,
    refetch: refetchRooms,
  } = useApi<JamRoomsResponse>(roomsUrl, "GET", undefined, {
    safetyNetMs: 5_000,
  });
  const taxonomyUrl =
    !roomId && roomQueueMode === "auto_dj" ? "/api/genres/taxonomy/tree" : null;
  const { data: taxonomyData, loading: taxonomyLoading } =
    useApi<GenreTaxonomyTreeResponse>(taxonomyUrl);
  const roomNameRef = useRef<string>("Jam session");
  const queueSearchInputRef = useRef<HTMLInputElement>(null);

  const taxonomyNodes = taxonomyData?.nodes ?? EMPTY_GENRE_TAXONOMY_NODES;
  const taxonomyBySlug = useMemo(
    () => new Map(taxonomyNodes.map((node) => [node.slug, node])),
    [taxonomyNodes],
  );
  const genreSuggestions = useMemo(() => {
    const query = roomGenreFiltersInput.trim().toLocaleLowerCase();
    if (!query) return [];
    const selected = new Set(roomGenreFilters);
    return taxonomyNodes
      .filter((node) => {
        if (selected.has(node.slug)) return false;
        return [node.name, node.slug, ...(node.alias_names ?? [])].some(
          (value) => value.toLocaleLowerCase().includes(query),
        );
      })
      .sort((left, right) => {
        const leftName = left.name.toLocaleLowerCase();
        const rightName = right.name.toLocaleLowerCase();
        const leftStarts = leftName.startsWith(query) ? 0 : 1;
        const rightStarts = rightName.startsWith(query) ? 0 : 1;
        return leftStarts - rightStarts || leftName.localeCompare(rightName);
      })
      .slice(0, 8);
  }, [roomGenreFilters, roomGenreFiltersInput, taxonomyNodes]);
  const selectedGenreItems = useMemo(
    () =>
      roomGenreFilters.map((slug) => {
        const node = taxonomyBySlug.get(slug);
        return {
          name: node?.name ?? slug,
          slug,
        };
      }),
    [roomGenreFilters, taxonomyBySlug],
  );

  useEffect(() => {
    setGenreSuggestionIndex((current) =>
      genreSuggestions.length
        ? Math.min(current, genreSuggestions.length - 1)
        : 0,
    );
  }, [genreSuggestions.length]);

  function selectGenre(node: GenreTaxonomyNode) {
    setRoomGenreFilters((current) =>
      current.includes(node.slug) ? current : [...current, node.slug],
    );
    setRoomGenreFiltersInput("");
    setGenreSuggestionIndex(0);
  }

  function removeGenre(slug: string) {
    setRoomGenreFilters((current) => current.filter((value) => value !== slug));
  }

  const playerActionsRef = useRef({
    play,
    playAll,
    pause,
    resume,
    seek,
    setPlaybackRate,
    syncJamQueue,
    currentTrack,
    isPlaying,
  });
  playerActionsRef.current = {
    play,
    playAll,
    pause,
    resume,
    seek,
    setPlaybackRate,
    syncJamQueue,
    currentTrack,
    isPlaying,
  };
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  const prevQualityRef = useRef<PlaybackDeliveryPreference | null>(null);

  useEffect(() => {
    if (!roomId) {
      leaveJamSession();
      return;
    }
    enterJamSession();
    return () => leaveJamSession();
  }, [enterJamSession, leaveJamSession, roomId]);

  useEffect(() => {
    if (roomId && room?.status === "ended") {
      leaveJamSession();
    }
  }, [leaveJamSession, room?.status, roomId]);

  useEffect(() => {
    if (roomId) {
      const current = getPlaybackDeliveryPolicyPreference();
      if (current !== "original") {
        prevQualityRef.current = current;
        setPlaybackDeliveryPolicyPreference("original");
        window.dispatchEvent(
          new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
            detail: { playbackDeliveryPolicy: "original" },
          }),
        );
      }
    }
    return () => {
      if (prevQualityRef.current) {
        setPlaybackDeliveryPolicyPreference(prevQualityRef.current);
        window.dispatchEvent(
          new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
            detail: { playbackDeliveryPolicy: prevQualityRef.current },
          }),
        );
        prevQualityRef.current = null;
      }
    };
  }, [roomId]);

  useEffect(() => {
    if (data) {
      dispatch({ type: "APPLY_ROOM_DATA", payload: data });
      roomNameRef.current = data.name;
    }
  }, [data]);

  const isHost = useMemo(() => {
    return Boolean(room && user && room.host_user_id === user.id);
  }, [room, user]);

  const myRole = useMemo(() => {
    if (!room || !user) return null;
    return (
      room.members.find((member) => member.user_id === user.id)?.role || null
    );
  }, [room, user]);

  const roomIsActive = room?.status === "active";
  const queueMode: JamQueueMode = room?.queue_mode || "manual";
  const canManageQueue = roomIsActive && myRole === "host";
  const canAddToQueue =
    roomIsActive &&
    (myRole === "host" || (queueMode === "auto" && myRole === "collab"));
  const canSuggestTrack =
    roomIsActive && (myRole === "host" || myRole === "collab");
  const canEditQueue = canAddToQueue || canSuggestTrack;
  const roomCurrentTrack = payloadToTrack(
    room?.current_track_payload?.track as Record<string, unknown> | undefined,
  );
  const roomNowPlaying = roomCurrentTrack || currentTrack;
  const currentTrackAlreadyQueued = Boolean(
    currentTrack &&
      queueItems.some((item) => playerTracksMatch(item.track, currentTrack)),
  );
  const autoDjSuggestions = useMemo(
    () =>
      (room?.auto_dj_suggestions || [])
        .map((suggestion) => payloadToTrack(suggestion))
        .filter((suggestion): suggestion is Track => suggestion !== null),
    [room?.auto_dj_suggestions],
  );
  const queuePrimaryActionLabel = t(
    isHost || canAddToQueue
      ? "jam.room.actions.addCurrentTrack"
      : "jam.room.suggestTrack",
  );

  const restHydratedRoomRef = useRef<string | null>(null);
  useEffect(() => {
    if (!roomId) {
      restHydratedRoomRef.current = null;
      return;
    }

    const syncRoom = room?.id === roomId ? room : data;
    // REST only hydrates the player while entering a room. Once the WebSocket
    // is live, its state_sync/events are authoritative; applying the REST
    // snapshot again would restore its stale persisted position (usually 0).
    if (
      isConnected ||
      restHydratedRoomRef.current === roomId ||
      !roomIsActive ||
      !syncRoom
    ) {
      return;
    }
    restHydratedRoomRef.current = roomId;

    const currentPayload = syncRoom.current_track_payload;
    const currentTrack = payloadToTrack(
      currentPayload?.track as Record<string, unknown> | undefined,
    );
    const position = Number(currentPayload?.position);

    syncJamQueue(
      queueItems.map((item) => item.track),
      {
        currentTrack,
        positionSeconds: Number.isFinite(position) ? Math.max(0, position) : 0,
        playing: currentPayload?.playing === true,
        source: { type: "queue", name: `Jam: ${syncRoom.name}` },
      },
    );
  }, [
    data,
    isConnected,
    queueItems,
    restHydratedRoomRef,
    room,
    roomId,
    roomIsActive,
    syncJamQueue,
  ]);

  const visibleRooms = roomsData?.rooms || [];
  const { memberRooms, publicRooms } = useMemo(() => {
    const mine: JamRoom[] = [];
    const discoverable: JamRoom[] = [];
    for (const listedRoom of visibleRooms) {
      const isMember =
        listedRoom.is_member ??
        listedRoom.members.some((member) => member.user_id === user?.id);
      if (isMember) {
        mine.push(listedRoom);
      } else if (listedRoom.visibility === "public") {
        discoverable.push(listedRoom);
      }
    }
    return { memberRooms: mine, publicRooms: discoverable };
  }, [user?.id, visibleRooms]);

  useEffect(() => {
    const query = queueSearch.trim();
    if (!roomId || !canEditQueue || query.length < 2) {
      setQueueSearchResults([]);
      setQueueSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setQueueSearchLoading(true);
      api<SearchData>(
        `/api/catalog/search?q=${encodeURIComponent(query)}&limit=8`,
        "GET",
        undefined,
        { signal: controller.signal },
      )
        .then((result) => setQueueSearchResults(result.tracks || []))
        .catch(() => {
          if (!controller.signal.aborted) setQueueSearchResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setQueueSearchLoading(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canEditQueue, queueSearch, roomId]);

  const { sendEvent } = useJamWebSocket({
    roomId,
    userId: user?.id,
    dispatch,
    playerActionsRef,
    currentTimeRef,
    roomNameRef,
  });

  useEffect(() => {
    if (!roomId || !roomIsActive || !isConnected) {
      setJamTransport(null);
      return;
    }

    setJamTransport({
      canControl: isHost,
      togglePlayPause: () => {
        if (!isHost) return;
        const actions = playerActionsRef.current;
        const activeTrack = actions.currentTrack;
        const position = currentTimeRef.current;

        if (!activeTrack) {
          const tracks = queueItems.map((item) => item.track);
          if (tracks.length === 0) return;
          actions.playAll(tracks, 0, {
            type: "queue",
            name: `Jam: ${roomNameRef.current}`,
          });
          sendEvent({ type: "queue_play" });
          return;
        }

        const playing = !actions.isPlaying;
        if (
          !sendEvent({
            type: playing ? "play" : "pause",
            track: trackToPayload(activeTrack),
            position,
            playing,
          })
        ) {
          return;
        }
        if (playing) actions.resume();
        else actions.pause();
        setSyncStatus(playing ? "synced" : "idle");
      },
      next: () => {
        if (!isHost || queueItems.length === 0) return;
        sendEvent({ type: "play_next" });
      },
      previous: () => {
        // Jam playback is intentionally forward-only. The host can choose
        // the next item from the shared queue, but cannot move a member back
        // through a private local history.
      },
      seek: (time: number) => {
        if (!isHost) return;
        const activeTrack = playerActionsRef.current.currentTrack;
        if (!activeTrack) return;
        const position = Math.max(0, time);
        if (
          !sendEvent({
            type: "seek",
            track: trackToPayload(activeTrack),
            position,
            playing: playerActionsRef.current.isPlaying,
          })
        ) {
          return;
        }
        playerActionsRef.current.seek(position);
      },
    });

    return () => setJamTransport(null);
  }, [
    isConnected,
    isHost,
    queueItems,
    roomId,
    roomIsActive,
    sendEvent,
    setJamTransport,
    setSyncStatus,
  ]);

  const advanceTrackRef = useRef<string | null>(null);
  const transitionAdvanceRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !isHost ||
      !roomIsActive ||
      !isPlaying ||
      !roomCurrentTrack?.id ||
      !duration ||
      duration <= 0
    ) {
      if (currentTime < Math.max(0, (duration || 0) - 2)) {
        advanceTrackRef.current = null;
      }
      return;
    }
    if (
      currentTime >= duration - 0.75 &&
      advanceTrackRef.current !== trackIdentity(roomCurrentTrack)
    ) {
      advanceTrackRef.current = trackIdentity(roomCurrentTrack);
      sendEvent({ type: "play_next" });
    }
  }, [
    currentTime,
    duration,
    isHost,
    isPlaying,
    roomCurrentTrack?.id,
    roomIsActive,
    sendEvent,
  ]);

  useEffect(() => {
    if (
      !isHost ||
      !roomIsActive ||
      !isConnected ||
      !roomCurrentTrack ||
      !currentTrack
    ) {
      return;
    }

    if (playerTracksMatch(currentTrack, roomCurrentTrack)) {
      transitionAdvanceRef.current = null;
      return;
    }

    const roomTrackIndex = queueItems.findIndex((item) =>
      playerTracksMatch(item.track, roomCurrentTrack),
    );
    const playerTrackIndex = queueItems.findIndex((item) =>
      playerTracksMatch(item.track, currentTrack),
    );
    if (roomTrackIndex < 0 || playerTrackIndex !== roomTrackIndex + 1) {
      return;
    }

    const transitionKey = `${trackIdentity(roomCurrentTrack)}->${trackIdentity(
      currentTrack,
    )}`;
    if (transitionAdvanceRef.current === transitionKey) return;
    if (sendEvent({ type: "play_next" })) {
      transitionAdvanceRef.current = transitionKey;
    }
  }, [
    currentTrack,
    isConnected,
    isHost,
    queueItems,
    roomCurrentTrack,
    roomIsActive,
    sendEvent,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleTrackFinished(event: Event) {
      const detail = (event as CustomEvent<{ track?: Track }>).detail;
      if (
        !isHost ||
        !roomIsActive ||
        !isConnected ||
        !roomCurrentTrack ||
        !playerTracksMatch(detail?.track, roomCurrentTrack)
      ) {
        return;
      }

      if (!sendEvent({ type: "play_next" })) return;

      const roomTrackIndex = queueItems.findIndex((item) =>
        playerTracksMatch(item.track, roomCurrentTrack),
      );
      const nextTrack = queueItems[roomTrackIndex + 1]?.track;
      transitionAdvanceRef.current = nextTrack
        ? `${trackIdentity(roomCurrentTrack)}->${trackIdentity(nextTrack)}`
        : null;
      advanceTrackRef.current = trackIdentity(roomCurrentTrack);
    }

    window.addEventListener(PLAYER_TRACK_FINISHED_EVENT, handleTrackFinished);
    return () => {
      window.removeEventListener(
        PLAYER_TRACK_FINISHED_EVENT,
        handleTrackFinished,
      );
    };
  }, [
    isConnected,
    isHost,
    queueItems,
    roomCurrentTrack,
    roomIsActive,
    sendEvent,
  ]);

  async function handleCreateRoom() {
    const name = roomName.trim();
    if (!name) {
      toast.error(t("jam.toasts.roomNameRequired"));
      return;
    }
    setCreating(true);
    try {
      const created = await api<JamRoom>("/api/jam/rooms", "POST", {
        name,
        visibility: roomVisibility,
        is_permanent: roomPermanent,
        description: roomDescription.trim() || null,
        tags: parseRoomTags(roomTagsInput),
        queue_mode: roomQueueMode,
        auto_dj_voting: roomAutoDjVoting,
        genre_filters: roomGenreFilters,
      });
      navigate(`/jam/rooms/${created.id}`);
    } catch {
      toast.error(t("jam.toasts.createRoomFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinRoom(targetRoom: JamRoom) {
    if (
      targetRoom.is_member ??
      targetRoom.members.some((member) => member.user_id === user?.id)
    ) {
      navigate(`/jam/rooms/${targetRoom.id}`);
      return;
    }
    setJoiningRoomId(targetRoom.id);
    try {
      const joined = await api<{ room: JamRoom }>(
        `/api/jam/rooms/${targetRoom.id}/join`,
        "POST",
        {},
      );
      refetchRooms();
      navigate(`/jam/rooms/${joined.room.id}`);
    } catch {
      toast.error(t("jam.toasts.joinRoomFailed"));
    } finally {
      setJoiningRoomId(null);
    }
  }

  async function updateRoomSettings(
    patch: Partial<
      Pick<
        JamRoom,
        | "name"
        | "visibility"
        | "is_permanent"
        | "description"
        | "tags"
        | "queue_mode"
        | "auto_dj_voting"
        | "genre_filters"
      >
    >,
    field: "visibility" | "permanent" | "metadata" | "queue_mode",
  ) {
    if (!room || !isHost) return false;
    const previousRoom = room;
    setUpdatingRoomField(field);
    setRoom((current) => (current ? { ...current, ...patch } : current));
    try {
      const updated = await api<JamRoom>(
        `/api/jam/rooms/${room.id}`,
        "PATCH",
        patch,
      );
      setRoom((current) =>
        current ? { ...current, ...updated, ...patch } : updated,
      );
      toast.success(t("jam.toasts.roomSettingsUpdated"));
      return true;
    } catch {
      setRoom(previousRoom);
      toast.error(t("jam.toasts.roomSettingsUpdateFailed"));
      return false;
    } finally {
      setUpdatingRoomField(null);
    }
  }

  function openMetadataModal() {
    if (!room) return;
    setMetadataDescription(room.description || "");
    setMetadataTagsInput(formatRoomTagsInput(room.tags));
    setMetadataModalOpen(true);
  }

  async function saveRoomMetadata() {
    const updated = await updateRoomSettings(
      {
        description: metadataDescription.trim() || null,
        tags: parseRoomTags(metadataTagsInput),
      },
      "metadata",
    );
    if (updated) setMetadataModalOpen(false);
  }

  async function handleCreateInvite() {
    if (!room) return;
    setCreatingInvite(true);
    try {
      const invite = await api<JamInvite>(
        `/api/jam/rooms/${room.id}/invites`,
        "POST",
        {},
      );
      setInviteData(invite);
      setInviteModalOpen(true);
    } catch {
      toast.error(t("jam.toasts.createInviteFailed"));
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleEndRoom() {
    if (!room || !isHost) return;
    setEndingRoom(true);
    try {
      const updated = await api<JamRoom>(
        `/api/jam/rooms/${room.id}/end`,
        "POST",
        {},
      );
      setRoom(updated);
      setSyncStatus("idle");
      toast.success(t("jam.toasts.roomEnded"));
    } catch {
      toast.error(t("jam.toasts.roomEndFailed"));
    } finally {
      setEndingRoom(false);
    }
  }

  function requestDeleteRoom(targetRoom: JamRoom) {
    if (targetRoom.host_user_id !== user?.id) return;
    setDeleteTargetRoom(targetRoom);
  }

  async function confirmDeleteRoom() {
    const targetRoom = deleteTargetRoom;
    if (!targetRoom || targetRoom.host_user_id !== user?.id) return;
    setDeletingRoomId(targetRoom.id);
    try {
      await api<{ ok: boolean; room_id: string }>(
        `/api/jam/rooms/${targetRoom.id}`,
        "DELETE",
      );
      toast.success(t("jam.toasts.roomDeleted"));
      refetchRooms();
      setDeleteTargetRoom(null);
      if (roomId === targetRoom.id) navigate("/jam", { replace: true });
    } catch {
      toast.error(t("jam.toasts.roomDeleteFailed"));
    } finally {
      setDeletingRoomId(null);
    }
  }

  async function copyInviteLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("jam.toasts.inviteLinkCopied"));
    } catch {
      toast.error(t("jam.toasts.inviteLinkCopyFailed"));
    }
  }

  function shareCurrentTrack() {
    if (!canSuggestTrack) {
      toast.error(t("jam.toasts.queuePermissionDenied"));
      return;
    }
    if (!currentTrack) {
      toast.info(t("jam.toasts.playSomethingFirst"));
      return;
    }
    if (currentTrackAlreadyQueued) {
      toast.info(t("jam.toasts.trackAlreadyInQueue"));
      return;
    }
    const sent = sendEvent({
      type: canAddToQueue ? "queue_add" : "track_request",
      track: trackToPayload(currentTrack),
      source: "current_track",
    });
    if (sent) {
      if (canAddToQueue && queueItems.length === 0) {
        playAll([currentTrack], 0, {
          type: "queue",
          name: `Jam: ${room?.name || t("jam.room.sessionFallback")}`,
        });
      }
      toast.success(
        t(
          canAddToQueue
            ? "jam.toasts.sharedTrack"
            : "jam.toasts.requestedTrack",
          {
            title: currentTrack.title,
          },
        ),
      );
    }
  }

  function addSearchTrackToRoom(track: SearchTrack) {
    if (!canSuggestTrack) {
      toast.error(t("jam.toasts.queuePermissionDenied"));
      return;
    }
    const playable = searchTrackToTrack(track);
    if (queueItems.some((item) => playerTracksMatch(item.track, playable))) {
      toast.info(t("jam.toasts.trackAlreadyInQueue"));
      return;
    }
    const sent = sendEvent({
      type: canAddToQueue ? "queue_add" : "track_request",
      track: trackToPayload(playable),
      source: "search",
    });
    if (sent) {
      if (canAddToQueue && queueItems.length === 0) {
        playAll([playable], 0, {
          type: "queue",
          name: `Jam: ${room?.name || t("jam.room.sessionFallback")}`,
        });
      }
      toast.success(
        t(
          canAddToQueue ? "jam.toasts.addedTrack" : "jam.toasts.requestedTrack",
          {
            title: playable.title,
          },
        ),
      );
      setQueueSearch("");
      setQueueSearchResults([]);
    }
  }

  function syncPlaybackState() {
    if (!currentTrack && !roomNowPlaying) {
      toast.info(t("jam.toasts.noCurrentTrackToSync"));
      return;
    }
    if (
      sendEvent({
        type: "sync",
        scope: "room",
      })
    ) {
      setSyncStatus(isPlaying ? "synced" : "idle");
      toast.success(
        isPlaying
          ? t("jam.toasts.syncedPlayback")
          : t("jam.toasts.syncedPause"),
      );
    }
  }

  function toggleRoomPlayback() {
    if (!isHost || !roomIsActive || !isConnected) return;
    const activeTrack = currentTrack || roomCurrentTrack;
    if (!activeTrack) {
      handlePlayRoomQueue();
      return;
    }

    const playing = !isPlaying;
    if (
      !sendEvent({
        type: playing ? "play" : "pause",
        track: trackToPayload(activeTrack),
        position: currentTime,
        playing,
      })
    ) {
      return;
    }
    if (playing) resume();
    else pause();
    setSyncStatus(playing ? "synced" : "idle");
  }

  function handlePlayRoomQueue() {
    const tracks = queueItems.map((item) => item.track);
    if (tracks.length === 0) {
      toast.info(t("jam.toasts.roomQueueEmpty"));
      return;
    }
    playAll(tracks, 0, {
      type: "queue",
      name: `Jam: ${room?.name || t("jam.room.sessionFallback")}`,
    });
    if (isHost && isConnected) {
      sendEvent({ type: "queue_play" });
    }
    toast.success(t("jam.toasts.roomQueueLoaded"));
  }

  function focusQueueSearch() {
    const input = queueSearchInputRef.current;
    if (!input) return;
    input.focus();
    input.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }

  function handlePlayNext() {
    if (!isHost || !isConnected || queueItems.length === 0) return;
    sendEvent({ type: "play_next" });
  }

  function handleRemoveFromRoomQueue(queueItemId: string) {
    if (!canManageQueue) {
      toast.error(t("jam.toasts.queuePermissionDenied"));
      return;
    }
    if (queueItemId.startsWith("legacy-")) {
      if (
        !sendEvent({
          type: "queue_remove",
          index: Number(queueItemId.replace("legacy-", "")),
        })
      )
        return;
      dispatch({
        type: "QUEUE_REMOVE",
        payload: Number(queueItemId.replace("legacy-", "")),
      });
      return;
    }
    if (!sendEvent({ type: "queue_remove", queue_item_id: queueItemId })) {
      return;
    }
    dispatch({ type: "QUEUE_REMOVE_ITEM", payload: queueItemId });
  }

  function handleMoveInRoomQueue(
    queueItemId: string,
    fromIndex: number,
    toIndex: number,
  ) {
    if (!canManageQueue) {
      toast.error(t("jam.toasts.queuePermissionDenied"));
      return;
    }
    if (toIndex < 0 || toIndex >= queueItems.length) return;
    if (queueItemId.startsWith("legacy-")) {
      sendEvent({ type: "queue_reorder", fromIndex, toIndex });
      return;
    }
    sendEvent({ type: "queue_reorder", queue_item_id: queueItemId, toIndex });
  }

  function handleQueueDragEnd({ active, over }: DragEndEvent) {
    if (!canManageQueue || !over || active.id === over.id) return;
    const fromIndex = queueItems.findIndex(
      (item) => item.id === String(active.id),
    );
    const toIndex = queueItems.findIndex((item) => item.id === String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    handleMoveInRoomQueue(String(active.id), fromIndex, toIndex);
  }

  function handleVote(queueItem: JamQueueItem) {
    if (
      !["auto", "auto_dj"].includes(queueMode) ||
      room?.auto_dj_voting === false ||
      !isConnected ||
      queueItem.voted_by_me
    ) {
      return;
    }
    dispatch({
      type: "QUEUE_VOTE",
      payload: {
        queueItemId: queueItem.id,
        voted: true,
        voteCount: queueItem.vote_count + 1,
      },
    });
    if (!sendEvent({ type: "queue_vote", queue_item_id: queueItem.id })) {
      dispatch({
        type: "QUEUE_VOTE",
        payload: {
          queueItemId: queueItem.id,
          voted: false,
          voteCount: queueItem.vote_count,
        },
      });
    }
  }

  function handleResolveRequest(requestId: string, approve: boolean) {
    if (!canManageQueue) return;
    sendEvent({
      type: approve ? "request_approve" : "request_reject",
      request_id: requestId,
    });
  }

  function toggleQueueMode() {
    if (!room || !isHost) return;
    void updateRoomSettings(
      { queue_mode: queueMode === "manual" ? "auto" : "manual" },
      "queue_mode",
    );
  }

  function enableAutoDj() {
    if (!room || !isHost) return;
    void updateRoomSettings(
      { queue_mode: "auto_dj", is_permanent: true },
      "queue_mode",
    );
  }

  function renderRoomCard(listedRoom: JamRoom, mode: "member" | "public") {
    const isMember =
      listedRoom.is_member ??
      listedRoom.members.some((member) => member.user_id === user?.id);
    const isHostRoom = listedRoom.host_user_id === user?.id;
    const latestEvent = [...(listedRoom.events || [])].reverse()[0];
    const latestActor = latestEvent
      ? resolveJamActor(latestEvent, listedRoom.members, user)
      : null;
    const isJoining = joiningRoomId === listedRoom.id;
    return (
      <div key={listedRoom.id} className="relative">
        <div
          role="button"
          tabIndex={0}
          aria-label={
            isMember
              ? t("jam.roomCard.openAria", { name: listedRoom.name })
              : t("jam.roomCard.joinAria", { name: listedRoom.name })
          }
          onClick={() => void handleJoinRoom(listedRoom)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void handleJoinRoom(listedRoom);
            }
          }}
          className="cursor-pointer rounded-xl border border-white/10 bg-black/15 p-4 transition-colors hover:border-cyan-400/25 hover:bg-white/[0.035] focus:outline-none focus-visible:border-cyan-400/50 focus-visible:ring-2 focus-visible:ring-cyan-400/20"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-foreground">
                {listedRoom.name}
              </div>
              {listedRoom.description ? (
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {listedRoom.description}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-muted-foreground">
                  {listedRoom.visibility === "public" ? (
                    <Globe2 size={11} />
                  ) : (
                    <Lock size={11} />
                  )}
                  {mode === "member"
                    ? t("jam.roomCard.yourRoom")
                    : t("jam.visibility.public")}
                </span>
                {listedRoom.is_permanent ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-cyan-200">
                    <Pin size={11} />
                    {t("jam.roomCard.permanent")}
                  </span>
                ) : null}
                {listedRoom.status !== "active" ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-amber-200">
                    {t("jam.roomCard.paused")}
                  </span>
                ) : null}
                {(listedRoom.tags || []).slice(0, 5).map((tag) => (
                  <span
                    key={`${listedRoom.id}-${tag}`}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 pr-12">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-muted-foreground">
                {isJoining ? (
                  <Loader2 size={15} className="animate-spin text-cyan-300" />
                ) : (
                  <Users size={15} />
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex -space-x-2">
              {listedRoom.members.slice(0, 5).map((member) => {
                const name = displayName(member);
                return (
                  <AvatarBubble
                    key={`${listedRoom.id}-${member.user_id}`}
                    name={name}
                    avatar={member.avatar}
                    userId={member.user_id}
                    size="sm"
                  />
                );
              })}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("jam.roomCard.memberCount", {
                count: listedRoom.member_count || listedRoom.members.length,
              })}
            </div>
          </div>
          {latestEvent ? (
            <div className="mt-3 truncate text-xs text-muted-foreground">
              {eventActivityText(latestEvent, latestActor?.name, t)}
            </div>
          ) : null}
        </div>
        {isHostRoom ? (
          <button
            type="button"
            onClick={() => requestDeleteRoom(listedRoom)}
            disabled={deletingRoomId === listedRoom.id}
            title={t("jam.delete.title")}
            aria-label={t("jam.delete.aria", { name: listedRoom.name })}
            className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-200 transition-colors hover:bg-red-500/15 disabled:opacity-50"
          >
            {deletingRoomId === listedRoom.id ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
          </button>
        ) : null}
      </div>
    );
  }

  const deleteRoomModal = (
    <AppModal
      open={deleteTargetRoom !== null}
      onClose={() => {
        if (!deletingRoomId) setDeleteTargetRoom(null);
      }}
      maxWidthClassName="sm:max-w-md"
    >
      <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t("jam.delete.modalTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("jam.delete.modalDescription")}
          </p>
        </div>
        <ModalCloseButton
          onClick={() => {
            if (!deletingRoomId) setDeleteTargetRoom(null);
          }}
        />
      </ModalHeader>
      <ModalBody className="px-5 py-5">
        <div className="space-y-4">
          <div className="rounded-lg border border-red-500/15 bg-red-500/10 px-4 py-3">
            <div className="text-sm font-medium text-foreground">
              {deleteTargetRoom?.name || t("jam.delete.roomFallback")}
            </div>
            <div className="mt-1 text-xs text-red-100/75">
              {t("jam.delete.irreversible")}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTargetRoom(null)}
              disabled={Boolean(deletingRoomId)}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/10 disabled:opacity-60"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void confirmDeleteRoom()}
              disabled={Boolean(deletingRoomId)}
              className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/15 px-4 py-2.5 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/20 disabled:opacity-60"
            >
              {deletingRoomId ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Trash2 size={15} />
              )}
              {t("jam.delete.confirm")}
            </button>
          </div>
        </div>
      </ModalBody>
    </AppModal>
  );

  if (!roomId) {
    return (
      <>
        <div className="space-y-6">
          <div className="rounded-[12px] border border-white/10 bg-white/5 p-5 sm:p-6">
            <h1 className="text-3xl font-bold text-foreground">
              {t("jam.lobby.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("jam.lobby.subtitle")}
            </p>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
            <section className="rounded-[12px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-foreground">
                {t("jam.lobby.startTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("jam.lobby.startSubtitle")}
              </p>
              <div className="mt-4 space-y-3">
                <input
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  placeholder={t("jam.lobby.namePlaceholder")}
                  className="h-11 w-full rounded-lg border border-white/10 bg-black/20 px-4 text-sm text-foreground outline-none focus:border-cyan-400/40"
                />
                <textarea
                  value={roomDescription}
                  onChange={(event) => setRoomDescription(event.target.value)}
                  placeholder={t("jam.lobby.descriptionPlaceholder")}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400/40"
                />
                <input
                  value={roomTagsInput}
                  onChange={(event) => setRoomTagsInput(event.target.value)}
                  placeholder={t("jam.lobby.tagsPlaceholder")}
                  className="h-11 w-full rounded-lg border border-white/10 bg-black/20 px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400/40"
                />
                <label className="flex flex-col gap-2 text-sm text-foreground">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t("jam.lobby.playbackMode")}
                  </span>
                  <Select
                    value={roomQueueMode}
                    onValueChange={(value) => {
                      const nextMode = value as JamQueueMode;
                      setRoomQueueMode(nextMode);
                      if (nextMode === "auto_dj") setRoomPermanent(true);
                    }}
                  >
                    <SelectTrigger
                      aria-label={t("jam.lobby.playbackMode")}
                      className="h-11 w-full bg-black/20 px-4 focus:border-cyan-400/40"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">
                        {t("jam.room.djMode")}
                      </SelectItem>
                      <SelectItem value="auto">
                        {t("jam.room.autoMode")}
                      </SelectItem>
                      <SelectItem value="auto_dj">
                        {t("jam.room.autoDjMode")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                {roomQueueMode === "auto_dj" ? (
                  <>
                    <div className="space-y-2">
                      <div className="relative">
                        <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] px-3 py-1.5 focus-within:border-cyan-400/40">
                          {selectedGenreItems.map((item) => (
                            <GenrePill
                              key={item.slug}
                              item={item}
                              onRemove={() => removeGenre(item.slug || "")}
                              removeLabel={t("jam.lobby.removeGenreFilter", {
                                genre: item.name,
                              })}
                            />
                          ))}
                          <Search
                            size={16}
                            className="ml-1 shrink-0 text-muted-foreground"
                          />
                          <input
                            role="combobox"
                            aria-label={t("jam.lobby.genreFiltersPlaceholder")}
                            aria-expanded={Boolean(
                              roomGenreFiltersInput.trim(),
                            )}
                            aria-controls="jam-genre-taxonomy-options"
                            aria-autocomplete="list"
                            value={roomGenreFiltersInput}
                            onChange={(event) => {
                              setRoomGenreFiltersInput(event.target.value);
                              setGenreSuggestionIndex(0);
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key === "ArrowDown" &&
                                genreSuggestions.length
                              ) {
                                event.preventDefault();
                                setGenreSuggestionIndex(
                                  (current) =>
                                    (current + 1) % genreSuggestions.length,
                                );
                              } else if (
                                event.key === "ArrowUp" &&
                                genreSuggestions.length
                              ) {
                                event.preventDefault();
                                setGenreSuggestionIndex(
                                  (current) =>
                                    (current - 1 + genreSuggestions.length) %
                                    genreSuggestions.length,
                                );
                              } else if (
                                event.key === "Enter" &&
                                genreSuggestions[genreSuggestionIndex]
                              ) {
                                event.preventDefault();
                                selectGenre(
                                  genreSuggestions[genreSuggestionIndex],
                                );
                              } else if (event.key === "Escape") {
                                setRoomGenreFiltersInput("");
                              }
                            }}
                            placeholder={t("jam.lobby.genreFiltersPlaceholder")}
                            className="h-8 min-w-[12rem] flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          />
                        </div>
                        {roomGenreFiltersInput.trim() ? (
                          <div
                            id="jam-genre-taxonomy-options"
                            role="listbox"
                            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#15151c] p-1 shadow-2xl"
                          >
                            {taxonomyLoading ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                {t("jam.lobby.genreFiltersLoading")}
                              </div>
                            ) : genreSuggestions.length ? (
                              genreSuggestions.map((node, index) => (
                                <button
                                  key={node.slug}
                                  type="button"
                                  role="option"
                                  aria-selected={index === genreSuggestionIndex}
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={() => selectGenre(node)}
                                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                    index === genreSuggestionIndex
                                      ? "bg-cyan-400/15 text-cyan-100"
                                      : "text-foreground hover:bg-white/[0.06]"
                                  }`}
                                >
                                  <span className="truncate">{node.name}</span>
                                  <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                                    {node.slug}
                                  </span>
                                </button>
                              ))
                            ) : (
                              <div
                                role="status"
                                className="px-3 py-2 text-xs text-muted-foreground"
                              >
                                {t("jam.lobby.genreFiltersNoResults")}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("jam.lobby.genreFiltersHint")}
                      </p>
                    </div>
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] px-4 py-3 text-sm text-foreground">
                      <span>{t("jam.lobby.autoDjVoting")}</span>
                      <input
                        type="checkbox"
                        checked={roomAutoDjVoting}
                        onChange={(event) =>
                          setRoomAutoDjVoting(event.target.checked)
                        }
                        className="h-4 w-4 accent-cyan-400"
                      />
                    </label>
                  </>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setRoomVisibility("private")}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                      roomVisibility === "private"
                        ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.05]"
                    }`}
                  >
                    <Lock size={15} />
                    {t("jam.visibility.inviteOnly")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoomVisibility("public")}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                      roomVisibility === "public"
                        ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.05]"
                    }`}
                  >
                    <Globe2 size={15} />
                    {t("jam.visibility.public")}
                  </button>
                </div>
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Pin size={15} className="text-cyan-300" />
                    {t("jam.lobby.permanentRoom")}
                  </span>
                  <input
                    type="checkbox"
                    checked={roomPermanent}
                    onChange={(event) => setRoomPermanent(event.target.checked)}
                    className="h-4 w-4 accent-cyan-400"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleCreateRoom}
                  disabled={creating}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {creating ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Radio size={15} />
                  )}
                  {t("jam.lobby.createRoom")}
                </button>
              </div>
            </section>

            <section className="rounded-[12px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {t("jam.lobby.openRoomsTitle")}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("jam.lobby.openRoomsSubtitle")}
                  </p>
                </div>
                {roomsLoading ? (
                  <Loader2 size={18} className="animate-spin text-primary" />
                ) : null}
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <Search size={15} className="text-muted-foreground" />
                <input
                  value={roomSearch}
                  onChange={(event) => setRoomSearch(event.target.value)}
                  placeholder={t("jam.lobby.searchPlaceholder")}
                  className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>

              <div className="mt-5 space-y-6">
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("jam.lobby.yourRooms")}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {memberRooms.length}
                    </span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {memberRooms.map((listedRoom) =>
                      renderRoomCard(listedRoom, "member"),
                    )}
                    {!roomsLoading && memberRooms.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-white/10 p-5 text-sm text-muted-foreground">
                        {t("jam.lobby.emptyMemberRooms")}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("jam.lobby.publicRooms")}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {publicRooms.length}
                    </span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {publicRooms.map((listedRoom) =>
                      renderRoomCard(listedRoom, "public"),
                    )}
                    {!roomsLoading && publicRooms.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-white/10 p-5 text-sm text-muted-foreground">
                        {t("jam.lobby.emptyPublicRooms")}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-[12px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-foreground">
              {t("jam.lobby.joinInviteTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("jam.lobby.joinInviteSubtitle")}
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                value={inviteInput}
                onChange={(event) => setInviteInput(event.target.value)}
                placeholder={t("jam.lobby.invitePlaceholder")}
                className="h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-4 text-sm text-foreground outline-none focus:border-cyan-400/40"
              />
              <button
                type="button"
                onClick={() => {
                  const token = extractInviteToken(inviteInput);
                  if (!token) {
                    toast.error(t("jam.toasts.invalidInvite"));
                    return;
                  }
                  navigate(`/jam/invite/${token}`);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
              >
                <Users size={15} />
                {t("jam.lobby.joinRoom")}
              </button>
            </div>
          </section>
        </div>
        {deleteRoomModal}
      </>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={22} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-lg font-medium text-foreground">
          {t("jam.room.unavailableTitle")}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          {error || t("jam.room.unavailableDescription")}
        </p>
        <Link
          to="/jam"
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
        >
          {t("jam.room.backToJam")}
        </Link>
      </div>
    );
  }

  const inviteLink = inviteData
    ? `${window.location.origin}${inviteData.join_url}`
    : null;

  return (
    <div className="space-y-6">
      <div className="rounded-[12px] border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-cyan-300/75">
                {t("jam.room.eyebrow")}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <h1 className="text-3xl font-bold text-foreground">
                  {room.name}
                </h1>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-100">
                  <Zap size={12} />
                  {queueMode === "auto_dj"
                    ? t("jam.room.autoDjMode")
                    : queueMode === "auto"
                      ? t("jam.room.autoMode")
                      : t("jam.room.djMode")}
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-muted-foreground">
                  {room.visibility === "public" ? (
                    <Globe2 size={12} />
                  ) : (
                    <Lock size={12} />
                  )}
                  {room.visibility === "public"
                    ? t("jam.room.publicRoom")
                    : t("jam.visibility.inviteOnly")}
                </div>
                {room.is_permanent ? (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                    <Pin size={12} />
                    {t("jam.roomCard.permanent")}
                  </div>
                ) : null}
              </div>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {room.description ||
                  t("jam.room.defaultDescription", {
                    count: room.members.length,
                  })}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isConnected ? (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                    <Radio size={12} className="text-emerald-300" />
                    {t("jam.room.connected")}
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
                    {connectionProblem &&
                    !connectionProblem.includes("Retrying") ? (
                      <Radio size={12} />
                    ) : (
                      <Loader2 size={12} className="animate-spin" />
                    )}
                    {connectionProblem || t("jam.room.connecting")}
                  </div>
                )}
                {!roomIsActive ? (
                  <div className="inline-flex rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
                    {t("jam.room.ended")}
                  </div>
                ) : null}
                {queueMode === "auto_dj" &&
                (room.genre_filters || []).length ? (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs font-medium text-violet-100">
                    {t("jam.room.autoDjGenres", {
                      genres: (room.genre_filters || []).join(", "),
                    })}
                  </div>
                ) : null}
                {(room.tags || []).map((tag) => (
                  <div
                    key={tag}
                    className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {tag}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <HeroPrimaryButton
                label={queuePrimaryActionLabel}
                onClick={shareCurrentTrack}
                disabled={
                  !roomIsActive || !isConnected || currentTrackAlreadyQueued
                }
                title={
                  currentTrackAlreadyQueued
                    ? t("jam.toasts.trackAlreadyInQueue")
                    : undefined
                }
                className="border-cyan-400/20 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/15 hover:text-cyan-100"
              >
                <Plus size={17} />
              </HeroPrimaryButton>
              <HeroPrimaryButton
                label={t("jam.room.actions.playRoomQueue")}
                onClick={handlePlayRoomQueue}
                disabled={queueItems.length === 0}
              >
                <ListMusic size={17} />
              </HeroPrimaryButton>
              {isHost ? (
                <HeroActionButton
                  label={t("jam.room.actions.roomSettings")}
                  aria-expanded={roomActionsOpen}
                  onClick={() => setRoomActionsOpen((open) => !open)}
                  className={
                    roomActionsOpen
                      ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-100"
                      : ""
                  }
                >
                  <MoreHorizontal size={18} />
                </HeroActionButton>
              ) : null}
            </div>
          </div>

          <div className="grid min-w-0 gap-4 rounded-xl border border-white/10 bg-black/20 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-5">
            <div className="flex min-w-0 items-center gap-4">
              {roomNowPlaying?.albumCover ? (
                <CrateImage
                  src={roomNowPlaying.albumCover}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-lg object-cover shadow-[0_10px_25px_rgba(0,0,0,0.3)] sm:h-20 sm:w-20"
                />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/35 sm:h-20 sm:w-20">
                  <ListMusic size={22} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-300/75">
                  {t("jam.room.nowPlaying")}
                </div>
                {roomNowPlaying ? (
                  <>
                    <div className="mt-1 truncate text-lg font-semibold text-foreground sm:text-xl">
                      {roomNowPlaying.title}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {roomNowPlaying.artist}
                      {roomNowPlaying.album ? ` · ${roomNowPlaying.album}` : ""}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t("jam.toasts.roomQueueEmpty")}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-cyan-400 transition-[width] duration-300"
                      style={{
                        width: `${
                          duration > 0
                            ? Math.min(
                                100,
                                Math.max(0, (currentTime / duration) * 100),
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatDuration(currentTime)} / {formatDuration(duration)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 md:justify-end">
              {isHost ? (
                <>
                  <HeroActionButton
                    label={
                      isPlaying
                        ? t("jam.room.actions.pauseRoom")
                        : t("jam.room.actions.playRoom")
                    }
                    onClick={toggleRoomPlayback}
                    disabled={!roomIsActive || !isConnected}
                    className="h-12 w-12 border-cyan-400/20 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15"
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </HeroActionButton>
                  <HeroActionButton
                    label={t("jam.room.actions.playNextTrack")}
                    onClick={handlePlayNext}
                    disabled={
                      !roomIsActive || !isConnected || queueItems.length === 0
                    }
                    className="h-12 w-12"
                  >
                    <SkipForward size={19} />
                  </HeroActionButton>
                  <HeroActionButton
                    label={
                      syncStatus === "synced"
                        ? t("jam.room.actions.resyncPlayback")
                        : t("jam.room.actions.syncPlayback")
                    }
                    onClick={syncPlaybackState}
                    disabled={!roomIsActive || !isConnected || !roomNowPlaying}
                    className={`h-12 w-12 ${
                      syncStatus === "synced"
                        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15"
                        : ""
                    }`}
                  >
                    <Zap size={19} />
                  </HeroActionButton>
                </>
              ) : (
                <div
                  title={
                    syncStatus === "synced"
                      ? t("jam.room.syncedWithHost")
                      : syncStatus === "drifting"
                        ? t("jam.room.catchingUp")
                        : t("jam.room.waitingForHost")
                  }
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground"
                >
                  <Zap size={15} className="text-cyan-300/70" />
                  {syncStatus === "synced"
                    ? t("jam.room.synced")
                    : t("jam.room.waitingForHost")}
                </div>
              )}
            </div>
          </div>

          {roomActionsOpen && isHost ? (
            <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t("jam.room.actions.editProfile")}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {t("jam.room.members")} · {room.members.length}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <HeroActionButton
                  label={
                    room.visibility === "public"
                      ? t("jam.room.actions.makeInviteOnly")
                      : t("jam.room.actions.makePublic")
                  }
                  onClick={() =>
                    void updateRoomSettings(
                      {
                        visibility:
                          room.visibility === "public" ? "private" : "public",
                      },
                      "visibility",
                    )
                  }
                  disabled={updatingRoomField !== null || !roomIsActive}
                  loading={updatingRoomField === "visibility"}
                >
                  {room.visibility === "public" ? (
                    <Lock size={16} />
                  ) : (
                    <Globe2 size={16} />
                  )}
                </HeroActionButton>
                <HeroActionButton
                  label={
                    room.is_permanent
                      ? t("jam.room.actions.unpinPermanent")
                      : t("jam.room.actions.makePermanent")
                  }
                  onClick={() =>
                    void updateRoomSettings(
                      { is_permanent: !room.is_permanent },
                      "permanent",
                    )
                  }
                  disabled={updatingRoomField !== null || !roomIsActive}
                  loading={updatingRoomField === "permanent"}
                >
                  <Pin size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label={t("jam.room.actions.editProfile")}
                  onClick={openMetadataModal}
                  disabled={updatingRoomField !== null}
                  loading={updatingRoomField === "metadata"}
                >
                  <ListMusic size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label={t("jam.room.actions.invitePeople")}
                  onClick={handleCreateInvite}
                  disabled={!roomIsActive}
                  loading={creatingInvite}
                >
                  <Share2 size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label={t("jam.room.actions.endRoom")}
                  onClick={handleEndRoom}
                  disabled={!roomIsActive}
                  loading={endingRoom}
                  className="border-red-500/15 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                >
                  <Power size={16} />
                </HeroActionButton>
                <HeroActionButton
                  label={t("jam.delete.title")}
                  onClick={() => requestDeleteRoom(room)}
                  disabled={deletingRoomId === room.id}
                  loading={deletingRoomId === room.id}
                  className="border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/15 hover:text-red-100"
                >
                  <Trash2 size={16} />
                </HeroActionButton>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-0 min-w-0 gap-6 xl:grid-cols-[0.85fr_1.1fr_1.1fr]">
        <section className="min-h-0 min-w-0 overflow-hidden rounded-[12px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">
            {t("jam.room.members")}
          </h2>
          {pendingRequests.length > 0 ? (
            <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-amber-50">
                  {t("jam.room.pendingRequests")}
                </div>
                <div className="rounded-full bg-amber-300/10 px-2 py-0.5 text-[11px] text-amber-100">
                  {pendingRequests.length}
                </div>
              </div>
              <div className="mt-2 space-y-2">
                {pendingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/15 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">
                        {request.track.title}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {request.track.artist}
                        {request.requester_name
                          ? ` · ${request.requester_name}`
                          : ""}
                      </div>
                    </div>
                    {canManageQueue ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleResolveRequest(request.id, true)}
                          className="rounded-md bg-cyan-400/15 px-2 py-1 text-[11px] font-medium text-cyan-100 hover:bg-cyan-400/25"
                        >
                          {t("jam.room.approveRequest")}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleResolveRequest(request.id, false)
                          }
                          className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-muted-foreground hover:bg-white/5"
                        >
                          {t("jam.room.rejectRequest")}
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-amber-100/70">
                        {t("jam.room.waitingForHost")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            {room.members.map((member) => (
              <UserProfileLink
                key={`${member.room_id}-${member.user_id}`}
                username={member.username}
                hoverClassName="block"
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <AvatarBubble
                    name={displayName(member)}
                    avatar={member.avatar}
                    userId={member.user_id}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {displayName(member)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {member.username
                        ? `@${member.username}`
                        : t("jam.room.profile")}{" "}
                      · {member.role}
                    </div>
                  </div>
                </div>
                <div className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground">
                  {member.user_id === room.host_user_id
                    ? t("jam.room.roles.host")
                    : t("jam.room.roles.collab")}
                </div>
              </UserProfileLink>
            ))}
          </div>
        </section>

        <section className="min-h-0 min-w-0 overflow-hidden rounded-[12px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {t("jam.room.sharedQueue")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {queueMode === "auto_dj"
                  ? t("jam.room.autoDjQueueSubtitle")
                  : queueMode === "auto"
                    ? t("jam.room.autoQueueSubtitle")
                    : t("jam.room.manualQueueSubtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground">
                {t("jam.room.queueTrackCount", { count: queueItems.length })}
              </div>
            </div>
          </div>

          {isHost ? (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={toggleQueueMode}
                disabled={updatingRoomField !== null || !roomIsActive}
                className="flex w-full items-center justify-between rounded-lg border border-cyan-400/15 bg-cyan-400/[0.06] px-3 py-2.5 text-left text-xs text-cyan-50 hover:bg-cyan-400/10 disabled:opacity-50"
              >
                <span>
                  <span className="block font-medium">
                    {queueMode === "auto" || queueMode === "auto_dj"
                      ? t("jam.room.switchToDjMode")
                      : t("jam.room.switchToAutoMode")}
                  </span>
                  <span className="mt-0.5 block text-cyan-100/60">
                    {queueMode === "auto" || queueMode === "auto_dj"
                      ? t("jam.room.autoModeHelp")
                      : t("jam.room.djModeHelp")}
                  </span>
                </span>
                <Zap size={16} />
              </button>
              {queueMode !== "auto_dj" ? (
                <button
                  type="button"
                  onClick={enableAutoDj}
                  disabled={updatingRoomField !== null || !roomIsActive}
                  className="flex w-full items-center justify-between rounded-lg border border-violet-400/20 bg-violet-400/[0.06] px-3 py-2.5 text-left text-xs text-violet-50 hover:bg-violet-400/10 disabled:opacity-50"
                >
                  <span>
                    <span className="block font-medium">
                      {t("jam.room.switchToAutoDjMode")}
                    </span>
                    <span className="mt-0.5 block text-violet-100/60">
                      {t("jam.room.autoDjModeHelp")}
                    </span>
                  </span>
                  <Zap size={16} />
                </button>
              ) : null}
            </div>
          ) : null}

          {queueMode === "auto_dj" && autoDjSuggestions.length > 0 ? (
            <div className="mt-3 rounded-lg border border-violet-400/15 bg-violet-400/[0.05] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-violet-100">
                    {t("jam.room.autoDjSuggestions")}
                  </div>
                  <p className="mt-1 text-xs text-violet-100/60">
                    {t("jam.room.autoDjSuggestionsHelp")}
                  </p>
                </div>
                <Zap size={15} className="shrink-0 text-violet-200" />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {autoDjSuggestions.slice(0, 4).map((track) => (
                  <div
                    key={trackIdentity(track)}
                    className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-black/15 px-2.5 py-2"
                  >
                    {track.albumCover ? (
                      <CrateImage
                        src={track.albumCover}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-white/35">
                        <ListMusic size={14} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground">
                        {track.title}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {track.artist}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <Search size={15} className="text-muted-foreground" />
              <input
                ref={queueSearchInputRef}
                value={queueSearch}
                onChange={(event) => setQueueSearch(event.target.value)}
                disabled={!canEditQueue}
                placeholder={
                  canEditQueue
                    ? t("jam.room.queueSearchPlaceholder")
                    : t("jam.room.queueSearchDisabledPlaceholder")
                }
                className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />
              {queueSearchLoading ? (
                <Loader2 size={15} className="animate-spin text-primary" />
              ) : null}
            </div>
            {queueSearchResults.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-white/10 bg-black/25">
                {queueSearchResults.map((track) => {
                  const playable = searchTrackToTrack(track);
                  const alreadyQueued = queueItems.some((item) =>
                    playerTracksMatch(item.track, playable),
                  );
                  return (
                    <button
                      key={
                        playable.id ||
                        playable.path ||
                        `${track.artist}-${track.title}`
                      }
                      type="button"
                      onClick={() => addSearchTrackToRoom(track)}
                      disabled={alreadyQueued}
                      title={
                        alreadyQueued
                          ? t("jam.toasts.trackAlreadyInQueue")
                          : undefined
                      }
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.05] disabled:cursor-default disabled:opacity-45"
                    >
                      {playable.albumCover ? (
                        <CrateImage
                          src={playable.albumCover}
                          alt=""
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-white/35">
                          <ListMusic size={15} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {playable.title}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {playable.artist}
                          {playable.album ? ` · ${playable.album}` : ""}
                        </div>
                      </div>
                      <span className="text-[11px] font-medium text-cyan-200">
                        {canAddToQueue
                          ? t("jam.room.addToQueue")
                          : t("jam.room.suggestTrack")}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div
            data-testid="jam-shared-queue-list"
            className="mt-4 max-h-[min(42rem,calc(100vh-18rem))] space-y-3 overflow-y-auto overscroll-contain pr-1"
          >
            <DndContext
              collisionDetection={closestCenter}
              sensors={queueSensors}
              onDragEnd={handleQueueDragEnd}
            >
              <SortableContext
                items={queueItems.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                {queueItems.map((item, index) => {
                  const track = item.track;
                  return (
                    <JamQueueItemShell
                      key={item.id}
                      sortable={canManageQueue}
                      id={item.id}
                      dragLabel={t("jam.room.queueDragAria", {
                        title: track.title,
                      })}
                    >
                      <div className="w-6 text-center text-xs text-white/40">
                        {index + 1}
                      </div>
                      {track.albumCover ? (
                        <CrateImage
                          src={track.albumCover}
                          alt=""
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-white/35">
                          <ListMusic size={15} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {track.title}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {track.artist}
                          {track.album ? ` · ${track.album}` : ""}
                        </div>
                      </div>
                      {["auto", "auto_dj"].includes(queueMode) &&
                      (queueMode !== "auto_dj" ||
                        room.auto_dj_voting !== false) ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <FollowHeartButton
                            following={item.voted_by_me}
                            disabled={item.voted_by_me || !isConnected}
                            onClick={() => handleVote(item)}
                            aria-label={t(
                              item.voted_by_me
                                ? "jam.room.queueVotedAria"
                                : "jam.room.queueVoteAria",
                              {
                                title: track.title,
                              },
                            )}
                            title={t(
                              item.voted_by_me
                                ? "jam.room.queueVotedAria"
                                : "jam.room.queueVoteAria",
                              {
                                title: track.title,
                              },
                            )}
                            iconSize={18}
                            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-white/5 disabled:cursor-default disabled:opacity-45"
                          />
                          <span
                            aria-label={t("jam.room.queueVoteCount", {
                              count: item.vote_count,
                            })}
                            className="min-w-4 text-center text-xs tabular-nums text-muted-foreground"
                          >
                            {item.vote_count}
                          </span>
                        </div>
                      ) : null}
                      {canManageQueue ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={t("jam.room.queueMoveUpAria", {
                              title: track.title,
                            })}
                            onClick={() =>
                              handleMoveInRoomQueue(item.id, index, index - 1)
                            }
                            disabled={index === 0}
                            className="rounded-full border border-white/10 p-1.5 text-muted-foreground hover:bg-white/5 disabled:opacity-30"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={t("jam.room.queueMoveDownAria", {
                              title: track.title,
                            })}
                            onClick={() =>
                              handleMoveInRoomQueue(item.id, index, index + 1)
                            }
                            disabled={index === queueItems.length - 1}
                            className="rounded-full border border-white/10 p-1.5 text-muted-foreground hover:bg-white/5 disabled:opacity-30"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={t("jam.room.queueRemoveAria", {
                              title: track.title,
                            })}
                            onClick={() => handleRemoveFromRoomQueue(item.id)}
                            className="rounded-full border border-red-500/20 p-1.5 text-red-300 hover:bg-red-500/10"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ) : null}
                    </JamQueueItemShell>
                  );
                })}
              </SortableContext>
            </DndContext>
            {queueItems.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t("jam.room.emptyQueuePrefix")}{" "}
                  <b>{queuePrimaryActionLabel}</b>{" "}
                  {t("jam.room.emptyQueueSuffix")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={focusQueueSearch}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
                >
                  <Search size={15} />
                  {t("jam.room.browseLibrary")}
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="min-h-0 min-w-0 overflow-hidden rounded-[12px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">
            {t("jam.room.recentActivity")}
          </h2>
          <div className="mt-4 max-h-[min(42rem,calc(100vh-18rem))] space-y-3 overflow-y-auto overscroll-contain pr-1">
            {[...room.events]
              .reverse()
              .slice(0, 20)
              .map((event) => {
                const actor = resolveJamActor(event, room.members, user);
                const payload = (event.payload_json || {}) as Record<
                  string,
                  unknown
                >;
                const track = payloadToTrack(
                  payload.track as Record<string, unknown> | undefined,
                );
                return (
                  <div
                    key={event.id}
                    className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <AvatarBubble
                        name={actor.name}
                        avatar={actor.avatar}
                        userId={actor.user_id}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate text-sm font-medium text-foreground">
                            {eventActivityText(event, actor.name, t)}
                          </div>
                          <div className="shrink-0 text-[11px] text-muted-foreground">
                            {new Date(event.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                        {track ? (
                          <div className="mt-2 flex items-center gap-2 rounded-xl bg-black/20 p-2">
                            {track.albumCover ? (
                              <CrateImage
                                src={track.albumCover}
                                alt=""
                                className="h-9 w-9 rounded-lg object-cover"
                              />
                            ) : (
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.06] text-white/35">
                                <ListMusic size={14} />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-foreground">
                                {track.title}
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {track.artist}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            {room.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("jam.room.noEvents")}
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {deleteRoomModal}

      <AppModal
        open={metadataModalOpen}
        onClose={() => setMetadataModalOpen(false)}
        maxWidthClassName="sm:max-w-lg"
      >
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t("jam.room.profileModalTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("jam.room.profileModalDescription")}
            </p>
          </div>
          <ModalCloseButton onClick={() => setMetadataModalOpen(false)} />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                {t("jam.room.descriptionLabel")}
              </span>
              <textarea
                value={metadataDescription}
                onChange={(event) => setMetadataDescription(event.target.value)}
                rows={4}
                placeholder={t("jam.room.descriptionPlaceholder")}
                className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400/40"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">
                {t("jam.room.tagsLabel")}
              </span>
              <input
                value={metadataTagsInput}
                onChange={(event) => setMetadataTagsInput(event.target.value)}
                placeholder={t("jam.room.tagsPlaceholder")}
                className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-black/20 px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400/40"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setMetadataModalOpen(false)}
                className="rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void saveRoomMetadata()}
                disabled={updatingRoomField === "metadata"}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {updatingRoomField === "metadata" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <ListMusic size={15} />
                )}
                {t("jam.room.saveProfile")}
              </button>
            </div>
          </div>
        </ModalBody>
      </AppModal>

      <AppModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        maxWidthClassName="sm:max-w-md"
      >
        <ModalHeader className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t("jam.room.inviteModalTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("jam.room.inviteModalDescription")}
            </p>
          </div>
          <ModalCloseButton onClick={() => setInviteModalOpen(false)} />
        </ModalHeader>
        <ModalBody className="px-5 py-5">
          {inviteLink ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <QrCodeImage
                  value={inviteLink}
                  size={210}
                  className="rounded-xl border border-white/10 bg-[#0f1116] p-3"
                />
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-xs text-muted-foreground break-all">
                {inviteLink}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyInviteLink(inviteLink)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Copy size={15} />
                  {t("jam.room.copyLink")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void copyInviteLink(inviteLink);
                    setInviteModalOpen(false);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
                >
                  <QrCode size={15} />
                  {t("jam.room.done")}
                </button>
              </div>
            </div>
          ) : null}
        </ModalBody>
      </AppModal>
    </div>
  );
}
