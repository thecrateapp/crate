import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type { Track } from "@/contexts/PlayerContext";
import type { PlaySource } from "@/contexts/player-types";
import { tracksMatch } from "@/contexts/player-session";
import { apiWsUrl } from "@/lib/api";
import type {
  JamEvent,
  JamMember,
  JamQueueItem,
  JamRoom,
  JamSessionAction,
  JamTrackRequest,
} from "@/pages/jam-reducer";
import { payloadToTrack } from "@/pages/jam-reducer";
import {
  type JamPlayerActionsRef,
  useJamWebSocketSync,
} from "@/hooks/use-jam-websocket-sync";

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

function isJamPlaybackSource(source: PlaySource | null | undefined) {
  return source?.type === "queue" && source.name.startsWith("Jam:");
}

function queueSnapshotTracks(queue: JamQueueItem[] | undefined) {
  if (!queue) return [];
  return queue
    .map((item) =>
      payloadToTrack(item.track as unknown as Record<string, unknown>),
    )
    .filter((track): track is Track => track !== null);
}

export function projectJamClockPosition({
  positionMs,
  serverTimeMs,
  clientNowMs,
  clockOffsetMs,
  playing,
}: {
  positionMs: number;
  serverTimeMs?: number;
  clientNowMs: number;
  clockOffsetMs: number;
  playing: boolean;
}) {
  if (!playing || typeof serverTimeMs !== "number") return positionMs;
  return positionMs + Math.max(0, clientNowMs + clockOffsetMs - serverTimeMs);
}

interface UseJamWebSocketOptions {
  roomId: string | undefined;
  userId: number | undefined;
  dispatch: React.Dispatch<JamSessionAction>;
  playerActionsRef: React.MutableRefObject<JamPlayerActionsRef>;
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
  const roomRevisionRef = useRef(0);
  const navigate = useNavigate();

  const {
    authoritativeQueueRef,
    awaitingInitialClockRef,
    hasServerClockOffsetRef,
    jamRateCorrectionRef,
    lastHardCorrectionAtRef,
    pendingSyncTrackRef,
    serverClockOffsetMsRef,
    syncSeek,
  } = useJamWebSocketSync({
    currentTimeRef,
    dispatch,
    playerActionsRef,
    roomNameRef,
  });

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
    pendingSyncTrackRef.current = null;
    awaitingInitialClockRef.current = false;
    authoritativeQueueRef.current = [];
    serverClockOffsetMsRef.current = 0;
    hasServerClockOffsetRef.current = false;
    lastHardCorrectionAtRef.current = 0;
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
        const sendClockPing = () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          socket.send(
            JSON.stringify({
              type: "ping",
              client_sent_at_ms: Date.now(),
            }),
          );
        };
        sendClockPing();
        socketHeartbeatTimer = window.setInterval(() => {
          sendClockPing();
        }, 10_000);
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
            queue?: JamQueueItem[];
            requests?: JamTrackRequest[];
            track?: Record<string, unknown>;
            position_ms?: number;
            server_time_ms?: number;
            client_sent_at_ms?: number;
            playing?: boolean;
            force_sync?: boolean;
            detail?: string;
          };

          if (payload.type === "pong") {
            if (
              typeof payload.server_time_ms === "number" &&
              typeof payload.client_sent_at_ms === "number"
            ) {
              const receivedAtMs = Date.now();
              const roundTripMs = receivedAtMs - payload.client_sent_at_ms;
              if (roundTripMs >= 0 && roundTripMs <= 5_000) {
                const sampleOffsetMs =
                  payload.server_time_ms -
                  (payload.client_sent_at_ms + roundTripMs / 2);
                serverClockOffsetMsRef.current = hasServerClockOffsetRef.current
                  ? serverClockOffsetMsRef.current * 0.8 + sampleOffsetMs * 0.2
                  : sampleOffsetMs;
                hasServerClockOffsetRef.current = true;
              }
            }
            return;
          }

          if (payload.type === "warning") {
            if (payload.detail) toast.info(payload.detail);
            return;
          }

          if (payload.type === "error") {
            if (payload.detail) toast.error(payload.detail);
            return;
          }

          if (
            payload.type === "sync_clock" &&
            typeof payload.position_ms === "number"
          ) {
            const playing = payload.playing !== false;
            const projectedPositionMs = projectJamClockPosition({
              positionMs: payload.position_ms,
              serverTimeMs: payload.server_time_ms,
              clientNowMs: Date.now(),
              clockOffsetMs: serverClockOffsetMsRef.current,
              playing,
            });
            const initialTrack = payloadToTrack(payload.track);
            if (awaitingInitialClockRef.current && initialTrack) {
              awaitingInitialClockRef.current = false;
              const authoritativeQueue = authoritativeQueueRef.current;
              playerActionsRef.current.syncJamQueue(
                authoritativeQueue.length > 0
                  ? authoritativeQueue
                  : [initialTrack],
                {
                  currentTrack: initialTrack,
                  positionSeconds: projectedPositionMs / 1000,
                  playing,
                  forcePosition: true,
                  source: {
                    type: "queue",
                    name: `Jam: ${roomNameRef.current}`,
                  },
                },
              );
              dispatch({
                type: "SET_SYNC_STATUS",
                payload: playing ? "synced" : "idle",
              });
              return;
            }
            syncSeek(
              payload.track,
              projectedPositionMs,
              playing,
              payload.force_sync === true,
            );
            return;
          }

          if (payload.type === "state_sync" && payload.room) {
            dispatch({ type: "APPLY_ROOM_DATA", payload: payload.room });
            const eventIds = (payload.room.events || []).reduce<number[]>(
              (ids, roomEvent) => {
                const eventId = Number(roomEvent.id);
                if (Number.isFinite(eventId) && eventId > 0) ids.push(eventId);
                return ids;
              },
              [],
            );
            roomRevisionRef.current = Math.max(0, ...eventIds);
            seenEventIdsRef.current = new Set(eventIds);
            roomNameRef.current = payload.room.name;
            const current = payload.room.current_track_payload;
            const roomQueue = queueSnapshotTracks(payload.room.queue);
            authoritativeQueueRef.current = roomQueue;
            const currentTrack = payloadToTrack(
              current?.track as Record<string, unknown> | undefined,
            );
            const roomHasCurrentTrack = !!currentTrack;
            // A room with a current track must be hydrated from its
            // authoritative clock, not from the persisted room position.
            // Starting the async queue load here would also allow the
            // following sync_clock message to seek the old engine and then be
            // overwritten by this load at the stale position.
            awaitingInitialClockRef.current = roomHasCurrentTrack;
            if (roomHasCurrentTrack) {
              if (
                playerActionsRef.current.isPlaying &&
                !isJamPlaybackSource(playerActionsRef.current.playSource)
              ) {
                playerActionsRef.current.pause();
              }
              return;
            }
            // Always hand the authoritative room queue to the player,
            // including an empty queue. This is what switches a newly-created
            // room from the user's local queue into Jam/readonly mode.
            playerActionsRef.current.syncJamQueue(roomQueue, {
              currentTrack,
              positionSeconds: Number(current?.position || 0),
              playing: false,
              source: {
                type: "queue",
                name: `Jam: ${roomNameRef.current}`,
              },
            });
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
          const eventId = Number(eventRow.id);
          if (
            Number.isFinite(eventId) &&
            eventId > 0 &&
            eventId < roomRevisionRef.current
          ) {
            return;
          }
          if (Number.isFinite(eventId) && eventId > 0) {
            roomRevisionRef.current = Math.max(
              roomRevisionRef.current,
              eventId,
            );
          }
          if (
            Number.isFinite(eventId) &&
            seenEventIdsRef.current.has(eventId)
          ) {
            return;
          }
          if (Number.isFinite(eventId) && eventId > 0) {
            seenEventIdsRef.current.add(eventId);
          }

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
          const eventCurrentTrack = payloadToTrack(
            eventPayload.current_track as Record<string, unknown> | undefined,
          );
          const queueAddStartsPlayback =
            payload.type === "queue_add" &&
            eventCurrentTrack !== null &&
            eventPayload.playing === true;

          const queueSnapshot = Array.isArray(payload.queue)
            ? (payload.queue as JamQueueItem[])
            : undefined;
          if (queueSnapshot) {
            authoritativeQueueRef.current = queueSnapshotTracks(queueSnapshot);
          }
          const roomTracksForTransport = queueSnapshot
            ? queueSnapshotTracks(queueSnapshot)
            : authoritativeQueueRef.current;
          const isTransportEvent =
            (payload.type === "play" ||
              payload.type === "pause" ||
              payload.type === "seek") &&
            eventTrack;
          if (
            isTransportEvent &&
            roomTracksForTransport.length > 0 &&
            !roomTracksForTransport.some((candidate) =>
              tracksMatch(candidate, eventTrack),
            )
          ) {
            // A stale or forged transport event must not replace the room's
            // current track or make a member play outside the authoritative
            // queue.
            return;
          }
          if (queueSnapshot) {
            dispatch({ type: "QUEUE_SNAPSHOT", payload: queueSnapshot });
            const transportEventHasTrack =
              (payload.type === "play" ||
                payload.type === "pause" ||
                payload.type === "seek") &&
              eventTrack;
            if (
              payload.type !== "play_next" &&
              payload.type !== "queue_play" &&
              !queueAddStartsPlayback &&
              !transportEventHasTrack
            ) {
              playerActionsRef.current.syncJamQueue(
                queueSnapshotTracks(queueSnapshot),
                {
                  queueOnly: true,
                  source: {
                    type: "queue",
                    name: `Jam: ${roomNameRef.current}`,
                  },
                },
              );
            }
          }
          if (payload.requests) {
            dispatch({ type: "REQUESTS_SNAPSHOT", payload: payload.requests });
          }
          if (
            payload.type === "queue_vote" &&
            typeof eventPayload.queue_item_id === "string" &&
            typeof eventPayload.vote_count === "number" &&
            Number(eventRow.user_id) === userId
          ) {
            dispatch({
              type: "QUEUE_VOTE",
              payload: {
                queueItemId: eventPayload.queue_item_id,
                voted: eventPayload.voted === true,
                voteCount: eventPayload.vote_count,
              },
            });
          }

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
                payload.type === "seek" ||
                payload.type === "play_next" ||
                payload.type === "queue_play" ||
                queueAddStartsPlayback
              ) {
                nextRoom.current_track_payload = {
                  track: eventPayload.current_track ?? eventPayload.track,
                  position: eventPayload.position,
                  playing: eventPayload.playing,
                };
              }
              return nextRoom;
            },
          });

          if (!queueSnapshot) {
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
          }

          if (
            eventRow.user_id === userId &&
            payload.type !== "play_next" &&
            payload.type !== "queue_play" &&
            !queueAddStartsPlayback
          )
            return;

          const {
            play: pl,
            pause: pa,
            resume: re,
            seek: sk,
          } = playerActionsRef.current;

          if (queueAddStartsPlayback && eventCurrentTrack) {
            const roomTracks = queueSnapshot
              ? queueSnapshotTracks(queueSnapshot)
              : authoritativeQueueRef.current;
            const positionSeconds =
              typeof eventPayload.position === "number"
                ? projectJamClockPosition({
                    positionMs: eventPayload.position * 1000,
                    serverTimeMs:
                      typeof eventPayload.server_time_ms === "number"
                        ? eventPayload.server_time_ms
                        : undefined,
                    clientNowMs: Date.now(),
                    clockOffsetMs: serverClockOffsetMsRef.current,
                    playing: true,
                  }) / 1000
                : 0;
            playerActionsRef.current.syncJamQueue(
              roomTracks.length > 0 ? roomTracks : [eventCurrentTrack],
              {
                currentTrack: eventCurrentTrack,
                positionSeconds,
                playing: true,
                source: {
                  type: "queue",
                  name: `Jam: ${roomNameRef.current}`,
                },
              },
            );
            return;
          }

          if (
            (payload.type === "play" ||
              payload.type === "pause" ||
              payload.type === "seek") &&
            eventTrack
          ) {
            const roomTracks = queueSnapshot
              ? queueSnapshotTracks(queueSnapshot)
              : authoritativeQueueRef.current;
            const trackIsInRoomQueue = roomTracks.some((candidate) =>
              tracksMatch(candidate, eventTrack),
            );
            if (trackIsInRoomQueue) {
              const playing =
                payload.type === "play"
                  ? true
                  : payload.type === "pause"
                    ? false
                    : typeof eventPayload.playing === "boolean"
                      ? eventPayload.playing
                      : undefined;
              const positionSeconds =
                typeof eventPayload.position === "number"
                  ? projectJamClockPosition({
                      positionMs: eventPayload.position * 1000,
                      serverTimeMs:
                        typeof eventPayload.server_time_ms === "number"
                          ? eventPayload.server_time_ms
                          : undefined,
                      clientNowMs: Date.now(),
                      clockOffsetMs: serverClockOffsetMsRef.current,
                      playing: playing === true,
                    }) / 1000
                  : undefined;
              playerActionsRef.current.syncJamQueue(roomTracks, {
                currentTrack: eventTrack,
                positionSeconds,
                playing,
                queueOnly: true,
                // A transport command is a user-visible discontinuity. Apply
                // its position even when the network delta is below the
                // periodic-heartbeat threshold; heartbeats use rate matching
                // instead and do not need this hard correction.
                forcePosition: true,
                source: {
                  type: "queue",
                  name: `Jam: ${roomNameRef.current}`,
                },
              });
              return;
            }
          }

          if (payload.type === "play_next" || payload.type === "queue_play") {
            const tracks = queueSnapshot
              ? queueSnapshotTracks(queueSnapshot)
              : authoritativeQueueRef.current;
            const transportTrack = eventTrack;
            const targetTrack = transportTrack || tracks[0];
            if (targetTrack) {
              const startPositionSeconds =
                projectJamClockPosition({
                  positionMs: 0,
                  serverTimeMs:
                    typeof eventPayload.server_time_ms === "number"
                      ? eventPayload.server_time_ms
                      : undefined,
                  clientNowMs: Date.now(),
                  clockOffsetMs: serverClockOffsetMsRef.current,
                  playing: true,
                }) / 1000;
              playerActionsRef.current.syncJamQueue(
                tracks.length > 0 ? tracks : [targetTrack],
                {
                  currentTrack: targetTrack,
                  positionSeconds: startPositionSeconds,
                  playing: true,
                  source: {
                    type: "queue",
                    name: `Jam: ${roomNameRef.current}`,
                  },
                },
              );
            } else {
              pa();
            }
          } else if (payload.type === "play") {
            if (eventTrack) {
              pl(eventTrack, {
                type: "queue",
                name: `Jam: ${roomNameRef.current}`,
              });
            } else {
              re();
            }
            const eventPosition = eventPayload.position;
            if (typeof eventPosition === "number") {
              window.setTimeout(() => {
                const positionSeconds =
                  projectJamClockPosition({
                    positionMs: eventPosition * 1000,
                    serverTimeMs:
                      typeof eventPayload.server_time_ms === "number"
                        ? eventPayload.server_time_ms
                        : undefined,
                    clientNowMs: Date.now(),
                    clockOffsetMs: serverClockOffsetMsRef.current,
                    playing: true,
                  }) / 1000;
                sk(positionSeconds);
              }, 120);
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
            sk(
              projectJamClockPosition({
                positionMs: eventPayload.position * 1000,
                serverTimeMs:
                  typeof eventPayload.server_time_ms === "number"
                    ? eventPayload.server_time_ms
                    : undefined,
                clientNowMs: Date.now(),
                clockOffsetMs: serverClockOffsetMsRef.current,
                playing: eventPayload.playing === true,
              }) / 1000,
            );
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

    // The effect owns the WebSocket lifecycle; connect dispatches its initial
    // lifecycle state as part of establishing that external subscription.
    // react-doctor-disable-next-line no-pass-live-state-to-parent
    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      for (const timer of heartbeatTimers) {
        window.clearInterval(timer);
      }
      heartbeatTimers.clear();
      pendingSyncTrackRef.current = null;
      awaitingInitialClockRef.current = false;
      authoritativeQueueRef.current = [];
      roomRevisionRef.current = 0;
      if (jamRateCorrectionRef.current) {
        playerActionsRef.current.setPlaybackRate?.(1);
        jamRateCorrectionRef.current = false;
      }
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        try {
          // Tell the room before closing. This avoids waiting for the server
          // to infer a disconnect from the TCP connection.
          socket.send(JSON.stringify({ type: "leave" }));
        } catch {
          // The close path is best-effort; server-side disconnect/TTL cleanup
          // remains the fallback for an already broken socket.
        }
      }
      socket?.close();
      socketRef.current = null;
    };
    // Retry timers and socket-local cancellation state intentionally live
    // inside this effect and are not stable render dependencies.
    // react-doctor-disable-next-line exhaustive-deps
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
