import { createHash } from "node:crypto";

const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

export function uuid5(namespace: string, name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
    .update(name, "utf8")
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normalizeIdentifier = (value: string | null | undefined) =>
  normalizeText(value).replace(/ /g, "");

const ROOT = uuid5(URL_NAMESPACE, "crate:entity-uids:v1");

export const ENTITY_NAMESPACES = {
  root: ROOT,
  artist: uuid5(ROOT, "artist"),
  album: uuid5(ROOT, "album"),
  track: uuid5(ROOT, "track"),
} as const;

export function artistEntityName({
  name,
  mbid,
}: {
  name: string;
  mbid?: string;
}): string {
  const id = normalizeIdentifier(mbid);
  return id ? `mbid:${id}` : `name:${normalizeText(name)}`;
}

export function artistEntityUid(input: {
  name: string;
  mbid?: string;
}): string {
  return uuid5(ENTITY_NAMESPACES.artist, artistEntityName(input));
}

export function albumEntityUid({
  artistUid,
  albumName,
  year,
}: {
  artistUid: string;
  albumName: string;
  year: string;
}): string {
  return uuid5(
    ENTITY_NAMESPACES.album,
    [
      `artist-uid:${artistUid}`,
      `album:${normalizeText(albumName)}`,
      `tag:${normalizeText(albumName)}`,
      `year:${normalizeText(year)}`,
    ].join("|"),
  );
}

export function trackEntityUid({
  albumUid,
  discNumber,
  trackNumber,
  title,
  filename,
}: {
  albumUid: string;
  discNumber: number;
  trackNumber: number;
  title: string;
  filename: string;
}): string {
  return uuid5(
    ENTITY_NAMESPACES.track,
    [
      `album-uid:${albumUid}`,
      `disc:${discNumber}`,
      `track:${trackNumber}`,
      `title:${normalizeText(title)}`,
      `file:${normalizeText(filename)}`,
    ].join("|"),
  );
}
