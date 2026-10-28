import type { PlaySource, Track } from "@/contexts/player-types";
import { api } from "@/lib/api";
import { toShapedRadioTrack, type ShapedRadioTrack } from "./radio-model";

export interface ContinuationBatch {
  tracks: Track[];
  status: "ok" | "retryable_empty" | "exhausted" | "auth_required";
  batchIndex: number | undefined;
  revision: number;
}

function sessionUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ensureContinuationSession(source: PlaySource): string | null {
  const radio = source.radio;
  if (!radio) return null;
  radio.continuationSessionId ??= radio.shapedSessionId ?? sessionUuid();
  radio.continuationBatchIndex ??= radio.shapedSessionId ? 1 : 0;
  radio.continuationRevision ??= 1;
  return radio.continuationSessionId;
}

export async function fetchContinuationBatch(
  source: PlaySource,
  buffer: Track[],
  signal: AbortSignal,
): Promise<ContinuationBatch> {
  const sessionId = ensureContinuationSession(source);
  const radio = source.radio;
  if (!sessionId || !radio) throw new Error("Missing continuation source");
  const index = radio.continuationBatchIndex ?? 0;
  const bufferRefs = buffer
    .slice(-200)
    .map(
      (track) =>
        track.entityUid ??
        track.globalTrackUid ??
        String(track.libraryTrackId ?? track.id),
    );
  const data = await api<{
    tracks: ShapedRadioTrack[];
    status: ContinuationBatch["status"];
    batch_index?: number;
    revision: number;
  }>(
    index === 0 ? "/api/radio/start" : "/api/radio/next",
    "POST",
    {
      session_id: sessionId,
      count: 30,
      buffer_refs: bufferRefs,
      ...(index === 0
        ? {
            mode: "seeded",
            seed_type:
              radio.seedType === "playlist" && typeof radio.seedId === "string"
                ? "home-playlist"
                : radio.seedType,
            seed_value: String(
              radio.seedEntityUid ?? radio.seedId ?? radio.seedPath ?? "",
            ),
          }
        : { batch_index: index, revision: radio.continuationRevision ?? 1 }),
    },
    { signal },
  );
  return {
    tracks: data.tracks.map(toShapedRadioTrack),
    status: data.status,
    batchIndex: data.batch_index,
    revision: data.revision,
  };
}

export function acknowledgeContinuationBatch(
  source: PlaySource,
  batch: ContinuationBatch,
): void {
  if (!source.radio || batch.batchIndex === undefined) return;
  source.radio.continuationBatchIndex = batch.batchIndex + 1;
  source.radio.continuationRevision = batch.revision;
}
