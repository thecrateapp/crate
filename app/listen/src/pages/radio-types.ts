/** View contracts shared with isolated reviews; no API/runtime dependency. */
export type EndpointType = "artist" | "genre" | "album" | "track";
export type RadioMode = "seeded" | "discovery";
export interface SearchResult {
  type: EndpointType;
  value: string;
  label: string;
  imageUrl?: string;
}
