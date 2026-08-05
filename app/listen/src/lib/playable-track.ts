import type { Track } from "@/contexts/player-types";
import { resolveMaybeApiAssetUrl } from "@/lib/api";

interface RemoteAvailabilityInput {
  catalog: boolean;
  stream: boolean;
  import: boolean;
  stale?: boolean;
  local?: boolean;
  remote?: boolean;
  healthy?: boolean;
}

export interface PlayableTrackInput {
  id?: string | number | null;
  track_id?: string | number | null;
  global_track_uid?: string | null;
  globalTrackUid?: string | null;
  global_artist_uid?: string | null;
  globalArtistUid?: string | null;
  global_album_uid?: string | null;
  globalAlbumUid?: string | null;
  entity_uid?: string | null;
  entityUid?: string | null;
  track_entity_uid?: string | null;
  duration?: number | null;
  title?: string | null;
  artist: string;
  artist_id?: number | null;
  artistId?: number | null;
  artist_entity_uid?: string | null;
  artistEntityUid?: string | null;
  artist_slug?: string | null;
  artistSlug?: string | null;
  album?: string | null;
  album_id?: number | null;
  albumId?: number | null;
  album_entity_uid?: string | null;
  albumEntityUid?: string | null;
  album_slug?: string | null;
  albumSlug?: string | null;
  albumCover?: string | null;
  album_cover?: string | null;
  path?: string | null;
  track_path?: string | null;
  library_track_id?: number | null;
  libraryTrackId?: number | null;
  format?: string | null;
  bitrate?: number | null;
  sample_rate?: number | null;
  sampleRate?: number | null;
  bit_depth?: number | null;
  bitDepth?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audioKey?: string | null;
  audio_scale?: string | null;
  audioScale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  blissVector?: number[] | null;
  is_suggested?: boolean;
  isSuggested?: boolean;
  suggestion_source?: "playlist";
  suggestionSource?: "playlist";
  origin?: "local" | "remote";
  node_uid?: string | null;
  nodeUid?: string | null;
  node_name?: string | null;
  nodeName?: string | null;
  remote_entity_uid?: string | null;
  remoteEntityUid?: string | null;
  availability?: RemoteAvailabilityInput | null;
}

export type PlayableTrackIdentityInput = Pick<
  PlayableTrackInput,
  | "id"
  | "track_id"
  | "global_track_uid"
  | "globalTrackUid"
  | "entity_uid"
  | "entityUid"
  | "track_entity_uid"
  | "path"
  | "track_path"
  | "library_track_id"
  | "libraryTrackId"
>;

export function isUuidLikeTrackId(value: string | null | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

export function getPlayableTrackLibraryId(
  input: PlayableTrackIdentityInput,
): number | undefined {
  return (
    input.libraryTrackId ??
    input.library_track_id ??
    (typeof input.track_id === "number" ? input.track_id : undefined) ??
    (typeof input.id === "number" ? input.id : undefined)
  );
}

function remoteNodeUid(input: PlayableTrackInput): string | null {
  return input.nodeUid ?? input.node_uid ?? null;
}

function remoteEntityUid(input: PlayableTrackInput): string | null {
  return input.remoteEntityUid ?? input.remote_entity_uid ?? null;
}

function isRemotePlayableInput(input: PlayableTrackInput): boolean {
  return (
    input.origin === "remote" &&
    Boolean(remoteNodeUid(input)) &&
    Boolean(remoteEntityUid(input))
  );
}

function globalTrackUid(input: Partial<PlayableTrackInput>): string | null {
  return input.globalTrackUid ?? input.global_track_uid ?? null;
}

export function hasPlayableTrackReference(
  input: PlayableTrackIdentityInput & Partial<PlayableTrackInput>,
): boolean {
  if (globalTrackUid(input)) {
    return true;
  }
  if (isRemotePlayableInput(input as PlayableTrackInput)) {
    return (input as PlayableTrackInput).availability?.stream !== false;
  }
  if (typeof input.id === "string" && isUuidLikeTrackId(input.id)) {
    return true;
  }
  return (
    getPlayableTrackLibraryId(input) != null ||
    Boolean(
      input.entityUid ??
        input.entity_uid ??
        input.track_entity_uid ??
        input.path ??
        input.track_path,
    )
  );
}

export function resolvePlayableTrackId(input: PlayableTrackInput): string {
  const globalUid = globalTrackUid(input);
  if (globalUid) {
    return globalUid;
  }
  if (isRemotePlayableInput(input)) {
    return `remote:${remoteNodeUid(input)}:${remoteEntityUid(input)}`;
  }
  return (
    input.entityUid ||
    input.entity_uid ||
    input.track_entity_uid ||
    input.path ||
    input.track_path ||
    (input.track_id != null ? String(input.track_id) : undefined) ||
    String(input.id || "")
  );
}

export function toPlayableTrack(
  input: PlayableTrackInput,
  options: { cover?: string } = {},
): Track {
  const albumCover =
    resolveMaybeApiAssetUrl(
      options.cover || input.albumCover || input.album_cover,
    ) || undefined;
  const canonicalGlobalTrackUid = globalTrackUid(input) ?? undefined;
  const inferredLocalEntityUid =
    !canonicalGlobalTrackUid &&
    typeof input.id === "string" &&
    isUuidLikeTrackId(input.id)
      ? input.id
      : undefined;
  const entityUid =
    input.entityUid ??
    input.entity_uid ??
    input.track_entity_uid ??
    inferredLocalEntityUid;
  const origin = input.origin === "remote" ? "remote" : undefined;
  const nodeUid = remoteNodeUid(input);
  const remoteUid = remoteEntityUid(input);
  const availability = input.availability ?? {
    catalog: true,
    stream: true,
    import: false,
  };

  return {
    id: resolvePlayableTrackId(input),
    globalTrackUid: canonicalGlobalTrackUid,
    globalArtistUid:
      input.globalArtistUid ?? input.global_artist_uid ?? undefined,
    globalAlbumUid: input.globalAlbumUid ?? input.global_album_uid ?? undefined,
    entityUid,
    title: input.title || "Unknown",
    artist: input.artist,
    artistId: input.artistId ?? input.artist_id ?? undefined,
    artistEntityUid:
      input.artistEntityUid ?? input.artist_entity_uid ?? undefined,
    artistSlug: input.artistSlug ?? input.artist_slug ?? undefined,
    album: input.album ?? undefined,
    albumId: input.albumId ?? input.album_id ?? undefined,
    albumEntityUid: input.albumEntityUid ?? input.album_entity_uid ?? undefined,
    albumSlug: input.albumSlug ?? input.album_slug ?? undefined,
    albumCover,
    duration: input.duration ?? undefined,
    path: input.path ?? input.track_path ?? undefined,
    libraryTrackId: getPlayableTrackLibraryId(input),
    format: input.format ?? undefined,
    bitrate: input.bitrate ?? null,
    sampleRate: input.sampleRate ?? input.sample_rate ?? null,
    bitDepth: input.bitDepth ?? input.bit_depth ?? null,
    bpm: input.bpm ?? null,
    audioKey: input.audioKey ?? input.audio_key ?? null,
    audioScale: input.audioScale ?? input.audio_scale ?? null,
    energy: input.energy ?? null,
    danceability: input.danceability ?? null,
    valence: input.valence ?? null,
    blissVector: input.blissVector ?? input.bliss_vector ?? null,
    isSuggested: input.isSuggested ?? input.is_suggested,
    suggestionSource: input.suggestionSource ?? input.suggestion_source,
    origin,
    remote:
      origin === "remote" && nodeUid && remoteUid
        ? {
            nodeUid,
            nodeName: input.nodeName ?? input.node_name ?? "",
            remoteEntityUid: remoteUid,
            availability,
          }
        : undefined,
  };
}
