import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type { Track } from "@/contexts/PlayerContext";
import type { PlaySource } from "@/contexts/player-types";
import { apiWsUrl } from "@/lib/api";
import type {
  JamEvent,
  JamMember,
  JamRoom,
  JamSessionAction,
} from "@/pages/jam-reducer";
import { payloadToTrack } from "@/pages/jam-reducer";

function jamCloseMessage(code: number) {
  if (code === 4401)
    return "Your session is not valid anymore. Log in again to join this room.";
  if (code === 4403)
    return "You do not have access to this room, or the room is no longer active.";
  if (code === 4500)
    return "Room sync is temporarily unavailable. Retrying... (4500)";
  return `Room connection dropped. Retrying... (${code || "unknown"})`;
}

function shouldReconnectJamClose(code: number) {
  return ![4401, 4403, 4409].includes(code);
}

interface UseJamWebSocketOptions {
  roomId: string | undefined;
  userId: number | undefined;
  dispatch: React.Dispatch<JamSessionAction>;
  playerActionsRef: React.MutableRefObject<{
    play: (track: Track, source?: PlaySource) => void;
    playAll: (
      tracks: Track[],
      startIndex?: number,
      source?: PlaySource,
    ) => void;
    pause: () => void;
    resume: () => void;
    seek: (time: number) => void;
    currentTrack: Track | undefined;
  }>;
  currentTimeRef: React.MutableRefObject<number>;
  roomNameRef: React.MutableRefObject<string>;
}

export function useJamWebSocket({
  roomId,
  userId,
  dispatch,
  playerActionsRef,
  currentTimeRef,
  roomNameRef,
}: UseJamWebSocketOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const seenEventIdsRef = useRef<Set<number>>(new Set());
  const navigate = useNavigate();

  const syncSeek = useCallback(
    (track: Record<string, unknown> | null | undefined, positionMs: number) => {
      const targetTrack = payloadToTrack(track);
      const { currentTrack: ct, seek: sk } = playerActionsRef.current;
      const currentPositionMs = currentTimeRef.current * 1000;

      if (
        targetTrack &&
        ct &&
        (targetTrack.id === ct.id || targetTrack.path === ct.path)
      ) {
        const drift = Math.abs(positionMs - currentPositionMs);
        if (drift > 200) {
          sk(positionMs / 1000);
        }
        if (drift < 100) {
          dispatch({ type: "SET_SYNC_STATUS", payload: "synced" });
        } else {
          dispatch({ type: "SET_SYNC_STATUS", payload: "drifting" });
        }
      } else if (targetTrack) {
        dispatch({ type: "SET_SYNC_STATUS", payload: "idle" });
      }
    },
    [dispatch, playerActionsRef, currentTimeRef],
  );

  const sendEvent = useCallback(
    (payload: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        const message = "Room connection dropped. Retrying... (not open)";
        dispatch({ type: "SEND_EVENT_FAIL", payload: message });
        toast.error(message);
        return false;
      }
      socket.send(JSON.stringify(payload));
      return true;
    },
    [dispatch],
  );

  useEffect(() => {
    if (!roomId || !userId) return;
    let cancelled = false;
    let retries = 0;
    let reconnectTimer: number | undefined;
    const heartbeatTimers = new Set<number>();

    function clearHeartbeat(timer: number | undefined) {
      if (timer === undefined) return;
      window.clearInterval(timer);
      heartbeatTimers.delete(timer);
    }

    function connect() {
      if (cancelled) return;
      dispatch({ type: "SET_SYNC_STATUS", payload: "idle" });
      dispatch({ type: "SET_CONNECTION_PROBLEM", payload: null });
      const socket = new WebSocket(apiWsUrl(`/api/jam/rooms/${roomId}/ws`));
      let socketHeartbeatTimer: number | undefined;
      socketRef.current = socket;

      socket.onopen = () => {
        if (cancelled || socketRef.current !== socket) {
          socket.close();
          return;
        }
        retries = 0;
        dispatch({ type: "WEBSOCKET_OPEN" });
        socketHeartbeatTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, 30_000);
        heartbeatTimers.add(socketHeartbeatTimer);
      };

      socket.onmessage = (event) => {
        if (cancelled || socketRef.current !== socket) return;
        try {
          const payload = JSON.parse(event.data) as {
            type: string;
            room?: JamRoom;
            event?: JamEvent;
            members?: JamMember[];
            track?: Record<string, unknown>;
            position_ms?: number;
            playing?: boolean;
            detail?: string;
          };

          if (payload.type === "pong") return;

          if (payload.type === "warning") {
            if (payload.detail) toast.info(payload.detail);
            return;
          }

          if (
            payload.type === "sync_clock" &&
            typeof payload.position_ms === "number"
          ) {
            syncSeek(payload.track, payload.position_ms);
            return;
          }

          if (payload.type === "state_sync" && payload.room) {
            dispatch({ type: "APPLY_ROOM_DATA", payload: payload.room });
            seenEventIdsRef.current = new Set(
              (payload.room.events || [])
                .map((roomEvent) => roomEvent.id)
                .filter(Boolean),
            );
            roomNameRef.current = payload.room.name;
            return;
          }

          if (payload.type === "room_ended" && payload.room) {
            dispatch({ type: "ROOM_ENDED", payload: payload.room });
            toast.info("This jam room has ended");
            return;
          }

          if (payload.type === "room_deleted") {
            dispatch({ type: "ROOM_DELETED" });
            toast.info("This jam room was deleted");
            navigate("/jam", { replace: true });
            return;
          }

          if (payload.type === "presence") {
            dispatch({
              type: "UPDATE_ROOM_MEMBERS",
              payload: payload.members || [],
            });
            return;
          }

          if (!payload.event) return;

          const eventRow = payload.event;
          if (eventRow.id && seenEventIdsRef.current.has(eventRow.id)) return;
          if (eventRow.id) seenEventIdsRef.current.add(eventRow.id);

          if (payload.type === "room_updated" && payload.room) {
            dispatch({ type: "APPLY_ROOM_DATA", payload: payload.room });
            roomNameRef.current = payload.room.name;
            toast.info("Room settings updated");
            return;
          }

          const eventPayload = (eventRow.payload_json || {}) as Record<
            string,
            unknown
          >;
          const eventTrack = payloadToTrack(
            eventPayload.track as Record<string, unknown> | undefined,
          );

          dispatch({
            type: "SET_ROOM",
            payload: (prev: JamRoom | null) => {
              if (!prev) return prev;
              const nextRoom = {
                ...prev,
                members: payload.members || prev.members,
                events: [...prev.events, eventRow].slice(-80),
              };
              if (
                payload.type === "play" ||
                payload.type === "pause" ||
                payload.type === "seek"
              ) {
                nextRoom.current_track_payload = {
                  track: eventPayload.track,
                  position: eventPayload.position,
                  playing: eventPayload.playing,
                };
              }
              return nextRoom;
            },
          });

          if (payload.type === "queue_add" && eventTrack) {
            dispatch({ type: "QUEUE_ADD", payload: eventTrack });
          } else if (
            payload.type === "queue_remove" &&
            typeof eventPayload.index === "number"
          ) {
            dispatch({
              type: "QUEUE_REMOVE",
              payload: eventPayload.index as number,
            });
          } else if (
            payload.type === "queue_reorder" &&
            typeof eventPayload.fromIndex === "number" &&
            typeof eventPayload.toIndex === "number"
          ) {
            dispatch({
              type: "QUEUE_REORDER",
              payload: {
                fromIndex: eventPayload.fromIndex as number,
                toIndex: eventPayload.toIndex as number,
              },
            });
          }

          if (eventRow.user_id === userId) return;

          const {
            play: pl,
            pause: pa,
            resume: re,
            seek: sk,
          } = playerActionsRef.current;

          if (payload.type === "play") {
            if (eventTrack) {
              pl(eventTrack, {
                type: "queue",
                name: `Jam: ${roomNameRef.current}`,
              });
            } else {
              re();
            }
            if (typeof eventPayload.position === "number") {
              window.setTimeout(() => sk(eventPayload.position as number), 120);
            }
          } else if (payload.type === "pause") {
            if (typeof eventPayload.position === "number") {
              sk(eventPayload.position as number);
            }
            pa();
          } else if (
            payload.type === "seek" &&
            typeof eventPayload.position === "number"
          ) {
            sk(eventPayload.position as number);
          }
        } catch {
          // ignore malformed payloads
        }
      };

      socket.onclose = (event) => {
        clearHeartbeat(socketHeartbeatTimer);
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        dispatch({
          type: "WEBSOCKET_CLOSED",
          payload: { code: event.code, message: jamCloseMessage(event.code) },
        });

        if (event.code === 4409) {
          dispatch({
            type: "SET_ROOM",
            payload: (prev: JamRoom | null) =>
              prev ? { ...prev, status: "ended" } : prev,
          });
          dispatch({ type: "SET_CONNECTION_PROBLEM", payload: null });
          return;
        }
        if (cancelled) return;

        if (!shouldReconnectJamClose(event.code)) {
          toast.error(jamCloseMessage(event.code));
          return;
        }

        const delay = Math.min(1000 * Math.pow(2, retries), 30_000);
        retries++;
        console.debug(
          `[jam] WebSocket closed, reconnecting in ${delay}ms (attempt ${retries})`,
        );
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        // onclose will fire after this — reconnect logic lives there
      };
    }

    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      for (const timer of heartbeatTimers) {
        window.clearInterval(timer);
      }
      heartbeatTimers.clear();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [
    roomId,
    userId,
    dispatch,
    navigate,
    syncSeek,
    playerActionsRef,
    roomNameRef,
  ]);

  return { sendEvent, socketRef, seenEventIdsRef };
}
