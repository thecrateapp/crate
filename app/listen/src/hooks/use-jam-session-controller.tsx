import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { Loader2, Trash2 } from "@crate/ui/icons";
import {
  type Track,
  usePlayerActions,
  usePlayerProgress,
  usePlayerState,
} from "@/contexts/PlayerContext";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import {
  useJamLobbyData,
  type GenreTaxonomyNode,
} from "@/hooks/use-jam-lobby-data";
import { useJamRoomActions } from "@/hooks/use-jam-room-actions";
import { useJamSessionState } from "@/hooks/use-jam-session-state";
import { useJamWebSocket } from "@/hooks/use-jam-websocket";
import { api } from "@/lib/api";
import { PLAYER_TRACK_FINISHED_EVENT } from "@/contexts/player-events";
import { tracksMatch as playerTracksMatch } from "@/contexts/player-session";
import {
  getPlaybackDeliveryPolicyPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
  setPlaybackDeliveryPolicyPreference,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import {
  payloadToTrack,
  type JamInvite,
  type JamQueueMode,
  type JamRoom,
  type JamRoomsResponse,
  type SearchData,
} from "@/pages/jam-reducer";
import {
  formatRoomTagsInput,
  parseRoomTags,
  trackIdentity,
  trackToPayload,
} from "@/pages/jam-session-utils";

export function useJamSessionController() {
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
    playSource,
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
  const roomNameRef = useRef<string>("Jam session");
  const queueSearchInputRef = useRef<HTMLInputElement>(null);
  const {
    taxonomyLoading,
    genreSuggestions,
    selectedGenreItems,
    memberRooms,
    publicRooms,
  } = useJamLobbyData({
    roomId,
    roomQueueMode,
    roomGenreFilters,
    roomGenreFiltersInput,
    visibleRooms: roomsData?.rooms ?? [],
    userId: user?.id,
  });

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
    playSource,
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
    playSource,
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

    if (currentPayload?.playing === true && currentTrack) {
      // Do not start an async queue load from the stale REST snapshot. The
      // WebSocket clock will perform the authoritative load at the projected
      // position; loading here would race that first sync and reset it to 0.
      pause();
      return;
    }

    syncJamQueue(
      queueItems.map((item) => item.track),
      {
        currentTrack,
        positionSeconds: Number.isFinite(position) ? Math.max(0, position) : 0,
        // REST stores the last transport position, but the live playback
        // clock arrives over WebSocket. Keep the player paused until that
        // clock hydrates a playing room, otherwise it audibly starts at 0.
        playing: false,
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
    pause,
    syncJamQueue,
  ]);

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
        const activeTrack = roomCurrentTrack || actions.currentTrack;
        const position = currentTimeRef.current;

        if (!activeTrack) {
          const tracks = queueItems.map((item) => item.track);
          if (tracks.length === 0) return;
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
        const activeTrack =
          roomCurrentTrack || playerActionsRef.current.currentTrack;
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
    roomCurrentTrack,
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

  const {
    shareCurrentTrack,
    addSearchTrackToRoom,
    syncPlaybackState,
    handlePlayRoomQueue,
    toggleRoomPlayback,
    focusQueueSearch,
    handlePlayNext,
    handleRemoveFromRoomQueue,
    handleMoveInRoomQueue,
    handleQueueDragEnd,
    handleVote,
    handleResolveRequest,
    toggleQueueMode,
    enableAutoDj,
  } = useJamRoomActions({
    t,
    currentTrack,
    roomCurrentTrack,
    currentTime,
    isPlaying,
    isHost,
    roomIsActive,
    isConnected,
    canSuggestTrack,
    canAddToQueue,
    currentTrackAlreadyQueued,
    queueItems,
    room,
    queueMode,
    canManageQueue,
    queueSearchInputRef,
    sendEvent,
    dispatch,
    setQueueSearch,
    setQueueSearchResults,
    setSyncStatus,
    resume,
    pause,
    updateRoomSettings,
  });

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
          <h2 className="text-lg font-semibold text-text-primary">
            {t("jam.delete.modalTitle")}
          </h2>
          <p className="text-xs text-text-muted">
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
          <div className="jam-danger-panel rounded-lg px-4 py-3">
            <div className="text-sm font-medium text-text-primary">
              {deleteTargetRoom?.name || t("jam.delete.roomFallback")}
            </div>
            <div className="jam-danger-text mt-1 text-xs">
              {t("jam.delete.irreversible")}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTargetRoom(null)}
              disabled={Boolean(deletingRoomId)}
              className="jam-secondary-action rounded-lg px-4 py-2.5 text-sm font-medium text-text-primary transition-colors disabled:opacity-60"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void confirmDeleteRoom()}
              disabled={Boolean(deletingRoomId)}
              className="jam-danger-control inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
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

  const lobbyViewProps = {
    roomName,
    setRoomName,
    roomDescription,
    setRoomDescription,
    roomTagsInput,
    setRoomTagsInput,
    roomQueueMode,
    onRoomQueueModeChange: setRoomQueueMode,
    roomGenreFiltersInput,
    setRoomGenreFiltersInput,
    genreSuggestionIndex,
    setGenreSuggestionIndex,
    selectedGenreItems,
    removeGenre,
    genreSuggestions,
    taxonomyLoading,
    selectGenre,
    roomAutoDjVoting,
    setRoomAutoDjVoting,
    roomVisibility,
    setRoomVisibility,
    roomPermanent,
    setRoomPermanent,
    creating,
    onCreateRoom: () => void handleCreateRoom(),
    inviteInput,
    setInviteInput,
    roomsLoading,
    roomSearch,
    setRoomSearch,
    memberRooms,
    publicRooms,
    user,
    joiningRoomId,
    deletingRoomId,
    onJoinRoom: (target: JamRoom) => void handleJoinRoom(target),
    onDeleteRoom: requestDeleteRoom,
    deleteRoomModal,
  };

  const roomViewProps = {
    t,
    room: room as JamRoom,
    inviteLink: inviteData
      ? `${window.location.origin}${inviteData.join_url}`
      : null,
    queueMode,
    isConnected,
    connectionProblem,
    roomIsActive: Boolean(roomIsActive),
    isHost,
    currentTrackAlreadyQueued,
    queuePrimaryActionLabel,
    shareCurrentTrack,
    handlePlayRoomQueue,
    queueItems,
    roomActionsOpen,
    setRoomActionsOpen,
    roomNowPlaying: roomNowPlaying ?? null,
    currentTime,
    duration,
    isPlaying,
    toggleRoomPlayback,
    handlePlayNext,
    syncStatus,
    syncPlaybackState,
    canAddToQueue: Boolean(canAddToQueue),
    updatingRoomField,
    updateRoomSettings,
    openMetadataModal,
    handleCreateInvite,
    creatingInvite,
    handleEndRoom,
    endingRoom,
    requestDeleteRoom,
    deletingRoomId,
    pendingRequests,
    canManageQueue: Boolean(canManageQueue),
    handleResolveRequest,
    user,
    autoDjSuggestions,
    queueSearchInputRef,
    queueSearch,
    setQueueSearch,
    canEditQueue: Boolean(canEditQueue),
    queueSearchLoading,
    queueSearchResults,
    addSearchTrackToRoom,
    queueSensors,
    handleQueueDragEnd,
    handleVote,
    handleMoveInRoomQueue,
    handleRemoveFromRoomQueue,
    focusQueueSearch,
    toggleQueueMode,
    enableAutoDj,
    metadataModalOpen,
    setMetadataModalOpen,
    metadataDescription,
    setMetadataDescription,
    metadataTagsInput,
    setMetadataTagsInput,
    saveRoomMetadata,
    deleteRoomModal,
    inviteModalOpen,
    setInviteModalOpen,
    copyInviteLink,
  };

  return {
    t,
    roomId,
    loading,
    error,
    room,
    lobbyViewProps,
    roomViewProps,
  };
}
