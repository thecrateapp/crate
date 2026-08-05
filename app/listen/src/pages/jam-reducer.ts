import type { Track } from "@/contexts/PlayerContext";
import { albumCoverAssetPath } from "@/lib/library-routes";
import {
  hasPlayableTrackReference,
  toPlayableTrack,
} from "@/lib/playable-track";

export type JamVisibility = "public" | "private";
export type JamQueueMode = "manual" | "auto" | "auto_dj";

export interface JamMember {
  room_id: string;
  user_id: number;
  role: "host" | "collab";
  joined_at: string;
  last_seen_at: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
}

export interface JamEvent {
  id: number;
  room_id: string;
  user_id: number | null;
  event_type: string;
  payload_json?: Record<string, unknown> | null;
  created_at: string;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
}

export interface JamRoomsResponse {
  rooms: JamRoom[];
}

export interface JamQueueItem {
  id: string;
  track: Track;
  added_by?: number | null;
  source?: string;
  status?: "queued" | "playing" | string;
  position?: number;
  vote_count: number;
  voted_by_me: boolean;
  created_at?: string | null;
}

export interface JamTrackRequest {
  id: string;
  track: Track;
  requested_by?: number | null;
  status: "pending" | "approved" | "rejected" | string;
  resolved_by?: number | null;
  queue_item_id?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
  requester_name?: string | null;
  requester_username?: string | null;
}

export interface SearchData {
  tracks: SearchTrack[];
}

export interface JamRoom {
  id: string;
  host_user_id: number;
  name: string;
  status: string;
  visibility: JamVisibility;
  is_permanent: boolean;
  queue_mode?: JamQueueMode;
  auto_dj_voting?: boolean;
  genre_filters?: string[];
  description?: string | null;
  tags?: string[];
  current_track_payload?: Record<string, unknown> | null;
  created_at: string;
  ended_at?: string | null;
  member_count?: number | null;
  is_member?: boolean | null;
  last_event_at?: string | null;
  members: JamMember[];
  events: JamEvent[];
  queue?: JamQueueItem[];
  requests?: JamTrackRequest[];
  auto_dj_suggestions?: Record<string, unknown>[];
}

export interface JamInvite {
  token: string;
  join_url: string;
  qr_value: string;
  expires_at?: string | null;
}

export interface SearchTrack {
  id?: number;
  entity_uid?: string;
  global_uid?: string;
  global_track_uid?: string;
  globalTrackUid?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  global_album_uid?: string;
  globalAlbumUid?: string;
  album_slug?: string;
  path?: string;
}

export interface JamSessionState {
  roomSearch: string;
  room: JamRoom | null;
  sharedQueue: Track[];
  queueItems: JamQueueItem[];
  pendingRequests: JamTrackRequest[];
  roomName: string;
  roomDescription: string;
  roomTagsInput: string;
  roomVisibility: JamVisibility;
  roomPermanent: boolean;
  creating: boolean;
  joiningRoomId: string | null;
  inviteInput: string;
  inviteData: JamInvite | null;
  creatingInvite: boolean;
  inviteModalOpen: boolean;
  metadataModalOpen: boolean;
  metadataDescription: string;
  metadataTagsInput: string;
  endingRoom: boolean;
  deletingRoomId: string | null;
  deleteTargetRoom: JamRoom | null;
  updatingRoomField:
    | "visibility"
    | "permanent"
    | "metadata"
    | "queue_mode"
    | null;
  queueSearch: string;
  queueSearchResults: SearchTrack[];
  queueSearchLoading: boolean;
  syncStatus: "idle" | "synced" | "drifting";
  isConnected: boolean;
  connectionProblem: string | null;
}

export const initialJamSessionState: JamSessionState = {
  roomSearch: "",
  room: null,
  sharedQueue: [],
  queueItems: [],
  pendingRequests: [],
  roomName: "",
  roomDescription: "",
  roomTagsInput: "",
  roomVisibility: "private",
  roomPermanent: false,
  creating: false,
  joiningRoomId: null,
  inviteInput: "",
  inviteData: null,
  creatingInvite: false,
  inviteModalOpen: false,
  metadataModalOpen: false,
  metadataDescription: "",
  metadataTagsInput: "",
  endingRoom: false,
  deletingRoomId: null,
  deleteTargetRoom: null,
  updatingRoomField: null,
  queueSearch: "",
  queueSearchResults: [],
  queueSearchLoading: false,
  syncStatus: "idle",
  isConnected: false,
  connectionProblem: null,
};

export type JamSessionAction =
  | { type: "SET_ROOM_SEARCH"; payload: string }
  | {
      type: "SET_ROOM";
      payload: JamRoom | null | ((prev: JamRoom | null) => JamRoom | null);
    }
  | { type: "SET_SHARED_QUEUE"; payload: Track[] }
  | { type: "SET_ROOM_NAME"; payload: string }
  | { type: "SET_ROOM_DESCRIPTION"; payload: string }
  | { type: "SET_ROOM_TAGS_INPUT"; payload: string }
  | { type: "SET_ROOM_VISIBILITY"; payload: JamVisibility }
  | { type: "SET_ROOM_PERMANENT"; payload: boolean }
  | { type: "SET_CREATING"; payload: boolean }
  | { type: "SET_JOINING_ROOM_ID"; payload: string | null }
  | { type: "SET_INVITE_INPUT"; payload: string }
  | { type: "SET_INVITE_DATA"; payload: JamInvite | null }
  | { type: "SET_CREATING_INVITE"; payload: boolean }
  | { type: "SET_INVITE_MODAL_OPEN"; payload: boolean }
  | { type: "SET_METADATA_MODAL_OPEN"; payload: boolean }
  | { type: "SET_METADATA_DESCRIPTION"; payload: string }
  | { type: "SET_METADATA_TAGS_INPUT"; payload: string }
  | { type: "SET_ENDING_ROOM"; payload: boolean }
  | { type: "SET_DELETING_ROOM_ID"; payload: string | null }
  | { type: "SET_DELETE_TARGET_ROOM"; payload: JamRoom | null }
  | {
      type: "SET_UPDATING_ROOM_FIELD";
      payload: "visibility" | "permanent" | "metadata" | "queue_mode" | null;
    }
  | { type: "SET_QUEUE_SEARCH"; payload: string }
  | { type: "SET_QUEUE_SEARCH_RESULTS"; payload: SearchTrack[] }
  | { type: "SET_QUEUE_SEARCH_LOADING"; payload: boolean }
  | { type: "SET_SYNC_STATUS"; payload: "idle" | "synced" | "drifting" }
  | { type: "SET_IS_CONNECTED"; payload: boolean }
  | { type: "SET_CONNECTION_PROBLEM"; payload: string | null }
  | { type: "APPLY_ROOM_DATA"; payload: JamRoom }
  | { type: "QUEUE_SNAPSHOT"; payload: JamQueueItem[] }
  | { type: "REQUESTS_SNAPSHOT"; payload: JamTrackRequest[] }
  | {
      type: "QUEUE_VOTE";
      payload: { queueItemId: string; voted: boolean; voteCount: number };
    }
  | { type: "QUEUE_ADD"; payload: Track }
  | { type: "QUEUE_REMOVE"; payload: number }
  | { type: "QUEUE_REMOVE_ITEM"; payload: string }
  | { type: "QUEUE_REORDER"; payload: { fromIndex: number; toIndex: number } }
  | { type: "UPDATE_ROOM_MEMBERS"; payload: JamMember[] }
  | { type: "ROOM_ENDED"; payload: JamRoom }
  | { type: "ROOM_DELETED" }
  | { type: "WEBSOCKET_OPEN" }
  | { type: "WEBSOCKET_CLOSED"; payload: { code: number; message: string } }
  | { type: "SEND_EVENT_FAIL"; payload: string }
  | { type: "RESET_STATE" };

export function reorderTracks<T>(
  tracks: T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tracks.length ||
    toIndex >= tracks.length
  ) {
    return tracks;
  }
  const next = [...tracks];
  const [item] = next.splice(fromIndex, 1);
  if (!item) return tracks;
  next.splice(toIndex, 0, item);
  return next;
}

export function deriveSharedQueue(events: JamEvent[]) {
  let queue: Track[] = [];
  for (const event of events) {
    const payload = (event.payload_json || {}) as Record<string, unknown>;
    if (event.event_type === "queue_add") {
      const track = payloadToTrack(
        payload.track as Record<string, unknown> | undefined,
      );
      if (track) queue = [...queue, track];
    } else if (
      event.event_type === "queue_remove" &&
      typeof payload.index === "number"
    ) {
      queue = queue.filter((_, index) => index !== payload.index);
    } else if (
      event.event_type === "queue_reorder" &&
      typeof payload.fromIndex === "number" &&
      typeof payload.toIndex === "number"
    ) {
      queue = reorderTracks(
        queue,
        payload.fromIndex as number,
        payload.toIndex as number,
      );
    }
  }
  return queue;
}

export function deriveLegacyQueueItems(events: JamEvent[]): JamQueueItem[] {
  return deriveSharedQueue(events).map((track, index) => ({
    id: `legacy-${index}`,
    track,
    vote_count: 0,
    voted_by_me: false,
    position: index,
  }));
}

function normalizeQueueItems(items: JamQueueItem[]): JamQueueItem[] {
  return items.flatMap((item) => {
    const track = normalizeQueueTrack(item.track);
    return track ? [{ ...item, track }] : [];
  });
}

function normalizeTrackRequests(
  requests: JamTrackRequest[],
): JamTrackRequest[] {
  return requests.flatMap((request) => {
    const track = normalizeQueueTrack(request.track);
    return track ? [{ ...request, track }] : [];
  });
}

function normalizeQueueTrack(track: Track): Track | null {
  const payload = track as unknown as Record<string, unknown>;
  const normalized = payloadToTrack(payload);
  if (!normalized) return null;
  const hasGlobalTrackUid = Boolean(
    payload.globalTrackUid ?? payload.global_track_uid,
  );
  if (!hasGlobalTrackUid && typeof payload.id === "string") {
    return { ...normalized, id: payload.id };
  }
  return normalized;
}

function sortQueueItemsForVotes(items: JamQueueItem[]): JamQueueItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftPlaying = left.item.status === "playing" ? 0 : 1;
      const rightPlaying = right.item.status === "playing" ? 0 : 1;
      if (leftPlaying !== rightPlaying) return leftPlaying - rightPlaying;

      const voteDifference = right.item.vote_count - left.item.vote_count;
      if (voteDifference !== 0) return voteDifference;

      const leftPosition = left.item.position ?? left.index;
      const rightPosition = right.item.position ?? right.index;
      return leftPosition - rightPosition || left.index - right.index;
    })
    .map(({ item }) => item);
}

function inferAlbumIdentityFromCover(cover: string | null | undefined) {
  if (!cover) return {};
  const globalMatch = cover.match(
    /\/api\/catalog\/albums\/([^/?#]+)\/cover(?:[/?#]|$)/,
  );
  if (globalMatch?.[1]) {
    return { globalAlbumUid: decodeURIComponent(globalMatch[1]) };
  }
  const entityMatch = cover.match(
    /\/api\/albums\/by-entity\/([^/?#]+)\/cover(?:[/?#]|$)/,
  );
  if (entityMatch?.[1]) {
    return { albumEntityUid: decodeURIComponent(entityMatch[1]) };
  }
  const idMatch = cover.match(/\/api\/albums\/(\d+)\/cover(?:[/?#]|$)/);
  if (idMatch?.[1]) return { albumId: Number(idMatch[1]) };
  return {};
}

export function payloadToTrack(
  payload: Record<string, unknown> | null | undefined,
): Track | null {
  if (!payload) return null;
  const input = {
    ...payload,
    artist: typeof payload.artist === "string" ? payload.artist : "",
    title: typeof payload.title === "string" ? payload.title : "Unknown",
  };
  const hasStringOrNumericId =
    (typeof payload.id === "string" && payload.id.trim().length > 0) ||
    (typeof payload.id === "number" && Number.isFinite(payload.id));
  if (!hasStringOrNumericId && !hasPlayableTrackReference(input)) return null;
  const coverIdentity = inferAlbumIdentityFromCover(
    typeof payload.albumCover === "string"
      ? payload.albumCover
      : typeof payload.album_cover === "string"
        ? payload.album_cover
        : undefined,
  );
  const canonicalAlbumCover = albumCoverAssetPath(
    {
      globalAlbumUid:
        typeof payload.globalAlbumUid === "string"
          ? payload.globalAlbumUid
          : typeof payload.global_album_uid === "string"
            ? payload.global_album_uid
            : coverIdentity.globalAlbumUid,
      albumId:
        typeof payload.albumId === "number"
          ? payload.albumId
          : typeof payload.album_id === "number"
            ? payload.album_id
            : coverIdentity.albumId,
      albumEntityUid:
        typeof payload.albumEntityUid === "string"
          ? payload.albumEntityUid
          : typeof payload.album_entity_uid === "string"
            ? payload.album_entity_uid
            : coverIdentity.albumEntityUid,
    },
    { size: 512 },
  );
  return toPlayableTrack(input, {
    cover: canonicalAlbumCover || undefined,
  });
}

export function jamSessionReducer(
  state: JamSessionState,
  action: JamSessionAction,
): JamSessionState {
  switch (action.type) {
    case "SET_ROOM_SEARCH":
      return { ...state, roomSearch: action.payload };
    case "SET_ROOM": {
      const nextRoom =
        typeof action.payload === "function"
          ? action.payload(state.room)
          : action.payload;
      return { ...state, room: nextRoom };
    }
    case "SET_SHARED_QUEUE":
      return { ...state, sharedQueue: action.payload };
    case "SET_ROOM_NAME":
      return { ...state, roomName: action.payload };
    case "SET_ROOM_DESCRIPTION":
      return { ...state, roomDescription: action.payload };
    case "SET_ROOM_TAGS_INPUT":
      return { ...state, roomTagsInput: action.payload };
    case "SET_ROOM_VISIBILITY":
      return { ...state, roomVisibility: action.payload };
    case "SET_ROOM_PERMANENT":
      return { ...state, roomPermanent: action.payload };
    case "SET_CREATING":
      return { ...state, creating: action.payload };
    case "SET_JOINING_ROOM_ID":
      return { ...state, joiningRoomId: action.payload };
    case "SET_INVITE_INPUT":
      return { ...state, inviteInput: action.payload };
    case "SET_INVITE_DATA":
      return { ...state, inviteData: action.payload };
    case "SET_CREATING_INVITE":
      return { ...state, creatingInvite: action.payload };
    case "SET_INVITE_MODAL_OPEN":
      return { ...state, inviteModalOpen: action.payload };
    case "SET_METADATA_MODAL_OPEN":
      return { ...state, metadataModalOpen: action.payload };
    case "SET_METADATA_DESCRIPTION":
      return { ...state, metadataDescription: action.payload };
    case "SET_METADATA_TAGS_INPUT":
      return { ...state, metadataTagsInput: action.payload };
    case "SET_ENDING_ROOM":
      return { ...state, endingRoom: action.payload };
    case "SET_DELETING_ROOM_ID":
      return { ...state, deletingRoomId: action.payload };
    case "SET_DELETE_TARGET_ROOM":
      return { ...state, deleteTargetRoom: action.payload };
    case "SET_UPDATING_ROOM_FIELD":
      return { ...state, updatingRoomField: action.payload };
    case "SET_QUEUE_SEARCH":
      return { ...state, queueSearch: action.payload };
    case "SET_QUEUE_SEARCH_RESULTS":
      return { ...state, queueSearchResults: action.payload };
    case "SET_QUEUE_SEARCH_LOADING":
      return { ...state, queueSearchLoading: action.payload };
    case "SET_SYNC_STATUS":
      return { ...state, syncStatus: action.payload };
    case "SET_IS_CONNECTED":
      return { ...state, isConnected: action.payload };
    case "SET_CONNECTION_PROBLEM":
      return { ...state, connectionProblem: action.payload };
    case "APPLY_ROOM_DATA": {
      const room = action.payload;
      const queueItems = room.queue
        ? normalizeQueueItems(room.queue)
        : deriveLegacyQueueItems(room.events || []);
      const requests = normalizeTrackRequests(room.requests || []);
      return {
        ...state,
        room,
        queueItems,
        pendingRequests: requests.filter(
          (request) => request.status === "pending",
        ),
        sharedQueue: queueItems.map((item) => item.track),
      };
    }
    case "QUEUE_SNAPSHOT": {
      const currentVotes = new Map(
        state.queueItems.map((item) => [item.id, item.voted_by_me]),
      );
      const queueItems = normalizeQueueItems(action.payload).map((item) => ({
        ...item,
        voted_by_me: currentVotes.get(item.id) ?? item.voted_by_me,
      }));
      return {
        ...state,
        queueItems,
        sharedQueue: queueItems.map((item) => item.track),
      };
    }
    case "REQUESTS_SNAPSHOT": {
      const requests = normalizeTrackRequests(action.payload);
      return {
        ...state,
        pendingRequests: requests.filter(
          (request) => request.status === "pending",
        ),
      };
    }
    case "QUEUE_VOTE": {
      const queueItems = sortQueueItemsForVotes(
        state.queueItems.map((item) =>
          item.id === action.payload.queueItemId
            ? {
                ...item,
                voted_by_me: action.payload.voted,
                vote_count: action.payload.voteCount,
              }
            : item,
        ),
      );
      return {
        ...state,
        queueItems,
        sharedQueue: queueItems.map((item) => item.track),
      };
    }
    case "QUEUE_ADD":
      return {
        ...state,
        sharedQueue: [...state.sharedQueue, action.payload],
        queueItems: [
          ...state.queueItems,
          {
            id: `legacy-${state.queueItems.length}`,
            track: action.payload,
            vote_count: 0,
            voted_by_me: false,
          },
        ],
      };
    case "QUEUE_REMOVE":
      return {
        ...state,
        sharedQueue: state.sharedQueue.filter(
          (_, index) => index !== action.payload,
        ),
        queueItems: state.queueItems.filter(
          (_, index) => index !== action.payload,
        ),
      };
    case "QUEUE_REMOVE_ITEM": {
      const queueItems = state.queueItems.filter(
        (item) => item.id !== action.payload,
      );
      return {
        ...state,
        queueItems,
        sharedQueue: queueItems.map((item) => item.track),
      };
    }
    case "QUEUE_REORDER":
      return {
        ...state,
        sharedQueue: reorderTracks(
          state.sharedQueue,
          action.payload.fromIndex,
          action.payload.toIndex,
        ),
        queueItems: reorderTracks(
          state.queueItems,
          action.payload.fromIndex,
          action.payload.toIndex,
        ),
      };
    case "UPDATE_ROOM_MEMBERS":
      return {
        ...state,
        room: state.room
          ? { ...state.room, members: action.payload }
          : state.room,
      };
    case "ROOM_ENDED":
      return {
        ...state,
        room: action.payload,
        syncStatus: "idle",
        connectionProblem: null,
      };
    case "ROOM_DELETED":
      return {
        ...state,
        syncStatus: "idle",
        connectionProblem: null,
      };
    case "WEBSOCKET_OPEN":
      return { ...state, isConnected: true, connectionProblem: null };
    case "WEBSOCKET_CLOSED": {
      const { code, message } = action.payload;
      if (code === 4409) {
        return {
          ...state,
          room: state.room ? { ...state.room, status: "ended" } : state.room,
          isConnected: false,
          syncStatus: "idle",
          connectionProblem: null,
        };
      }
      return {
        ...state,
        isConnected: false,
        syncStatus: "idle",
        connectionProblem: message,
      };
    }
    case "SEND_EVENT_FAIL":
      return {
        ...state,
        isConnected: false,
        connectionProblem: action.payload,
      };
    case "RESET_STATE":
      return initialJamSessionState;
    default:
      return state;
  }
}
