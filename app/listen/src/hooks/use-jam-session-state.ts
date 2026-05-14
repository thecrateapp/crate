import { useCallback, useReducer } from "react";

import type { Track } from "@/contexts/PlayerContext";
import {
  initialJamSessionState,
  jamSessionReducer,
  type JamInvite,
  type JamRoom,
  type JamVisibility,
  type SearchTrack,
} from "@/pages/jam-reducer";

export function useJamSessionState() {
  const [state, dispatch] = useReducer(
    jamSessionReducer,
    initialJamSessionState,
  );

  const setRoomSearch = useCallback(
    (payload: string) => dispatch({ type: "SET_ROOM_SEARCH", payload }),
    [],
  );
  const setRoom = useCallback(
    (payload: JamRoom | null | ((prev: JamRoom | null) => JamRoom | null)) =>
      dispatch({ type: "SET_ROOM", payload }),
    [],
  );
  const setSharedQueue = useCallback(
    (payload: Track[]) => dispatch({ type: "SET_SHARED_QUEUE", payload }),
    [],
  );
  const setRoomName = useCallback(
    (payload: string) => dispatch({ type: "SET_ROOM_NAME", payload }),
    [],
  );
  const setRoomDescription = useCallback(
    (payload: string) => dispatch({ type: "SET_ROOM_DESCRIPTION", payload }),
    [],
  );
  const setRoomTagsInput = useCallback(
    (payload: string) => dispatch({ type: "SET_ROOM_TAGS_INPUT", payload }),
    [],
  );
  const setRoomVisibility = useCallback(
    (payload: JamVisibility) =>
      dispatch({ type: "SET_ROOM_VISIBILITY", payload }),
    [],
  );
  const setRoomPermanent = useCallback(
    (payload: boolean) => dispatch({ type: "SET_ROOM_PERMANENT", payload }),
    [],
  );
  const setCreating = useCallback(
    (payload: boolean) => dispatch({ type: "SET_CREATING", payload }),
    [],
  );
  const setJoiningRoomId = useCallback(
    (payload: string | null) =>
      dispatch({ type: "SET_JOINING_ROOM_ID", payload }),
    [],
  );
  const setInviteInput = useCallback(
    (payload: string) => dispatch({ type: "SET_INVITE_INPUT", payload }),
    [],
  );
  const setInviteData = useCallback(
    (payload: JamInvite | null) =>
      dispatch({ type: "SET_INVITE_DATA", payload }),
    [],
  );
  const setCreatingInvite = useCallback(
    (payload: boolean) => dispatch({ type: "SET_CREATING_INVITE", payload }),
    [],
  );
  const setInviteModalOpen = useCallback(
    (payload: boolean) => dispatch({ type: "SET_INVITE_MODAL_OPEN", payload }),
    [],
  );
  const setMetadataModalOpen = useCallback(
    (payload: boolean) =>
      dispatch({ type: "SET_METADATA_MODAL_OPEN", payload }),
    [],
  );
  const setMetadataDescription = useCallback(
    (payload: string) =>
      dispatch({ type: "SET_METADATA_DESCRIPTION", payload }),
    [],
  );
  const setMetadataTagsInput = useCallback(
    (payload: string) => dispatch({ type: "SET_METADATA_TAGS_INPUT", payload }),
    [],
  );
  const setEndingRoom = useCallback(
    (payload: boolean) => dispatch({ type: "SET_ENDING_ROOM", payload }),
    [],
  );
  const setDeletingRoomId = useCallback(
    (payload: string | null) =>
      dispatch({ type: "SET_DELETING_ROOM_ID", payload }),
    [],
  );
  const setDeleteTargetRoom = useCallback(
    (payload: JamRoom | null) =>
      dispatch({ type: "SET_DELETE_TARGET_ROOM", payload }),
    [],
  );
  const setUpdatingRoomField = useCallback(
    (payload: "visibility" | "permanent" | "metadata" | null) =>
      dispatch({ type: "SET_UPDATING_ROOM_FIELD", payload }),
    [],
  );
  const setQueueSearch = useCallback(
    (payload: string) => dispatch({ type: "SET_QUEUE_SEARCH", payload }),
    [],
  );
  const setQueueSearchResults = useCallback(
    (payload: SearchTrack[]) =>
      dispatch({ type: "SET_QUEUE_SEARCH_RESULTS", payload }),
    [],
  );
  const setQueueSearchLoading = useCallback(
    (payload: boolean) =>
      dispatch({ type: "SET_QUEUE_SEARCH_LOADING", payload }),
    [],
  );
  const setSyncStatus = useCallback(
    (payload: "idle" | "synced" | "drifting") =>
      dispatch({ type: "SET_SYNC_STATUS", payload }),
    [],
  );
  const setIsConnected = useCallback(
    (payload: boolean) => dispatch({ type: "SET_IS_CONNECTED", payload }),
    [],
  );
  const setConnectionProblem = useCallback(
    (payload: string | null) =>
      dispatch({ type: "SET_CONNECTION_PROBLEM", payload }),
    [],
  );

  return {
    state,
    dispatch,
    setRoomSearch,
    setRoom,
    setSharedQueue,
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
    setIsConnected,
    setConnectionProblem,
  };
}
