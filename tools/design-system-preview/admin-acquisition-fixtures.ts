import { useCallback, useEffect, useRef, useState } from "react";
import { createUseApi } from "../../app/shared/web/use-api";

const coverA = new URL("./acquisition-cover-caspian.svg", import.meta.url).href;
const coverB = new URL("./acquisition-cover-signal.svg", import.meta.url).href;

const acquisitionSnapshot = {
  tidal_authenticated: true,
  tidal_queue: [
    {
      id: 3101,
      tidal_url: "https://tidal.example/album/3101",
      title: "On Circles",
      artist: "Caspian",
      status: "downloading",
      source: "tidal",
      quality: "max",
      cover_url: coverA,
      created_at: "2026-10-22T09:45:00Z",
    },
    {
      id: 3102,
      tidal_url: "https://tidal.example/album/3102",
      title: "Dust and Disquiet",
      artist: "Caspian",
      status: "wishlist",
      source: "tidal",
      quality: "high",
      cover_url: coverB,
      created_at: "2026-10-21T15:30:00Z",
    },
    {
      id: 3103,
      tidal_url: "https://tidal.example/album/3103",
      title: "Waking Season",
      artist: "Caspian",
      status: "completed",
      source: "tidal",
      quality: "max",
      cover_url: coverA,
      created_at: "2026-10-20T12:00:00Z",
    },
    {
      id: 3104,
      tidal_url: "https://tidal.example/album/3104",
      title: "Lost Songs",
      artist: "Caspian",
      status: "failed",
      source: "tidal",
      quality: "high",
      cover_url: coverB,
      created_at: "2026-10-19T12:00:00Z",
    },
  ],
  soulseek_queue: [
    {
      source: "soulseek",
      artist: "Caspian",
      album: "Dust and Disquiet",
      filename: "Separation No. 2.flac",
      fullPath: "Caspian/Dust and Disquiet/Separation No. 2.flac",
      status: "Downloading",
      progress: 42,
      username: "northstar",
      speed: 2_097_152,
    },
  ],
};

const searchResults = {
  artists: [
    {
      id: "artist-caspian",
      name: "Caspian",
      picture: coverA,
    },
  ],
  albums: [
    {
      id: "album-on-circles",
      title: "On Circles",
      artist: "Caspian",
      year: "2020",
      tracks: 10,
      cover: coverA,
      url: "https://tidal.example/album/on-circles",
      quality: ["HIRES_LOSSLESS"],
    },
    {
      id: "album-dust-disquiet",
      title: "Dust and Disquiet",
      artist: "Caspian",
      year: "2015",
      tracks: 11,
      cover: coverB,
      url: "https://tidal.example/album/dust-and-disquiet",
      quality: ["LOSSLESS"],
    },
  ],
  tracks: [
    {
      id: "track-hymn",
      title: "Hymn for the Greatest Generation",
      artist: "Caspian",
      album: "Waking Season",
      duration: 472,
      url: "https://tidal.example/track/hymn",
      quality: ["LOSSLESS"],
    },
  ],
};

const artistAlbums = {
  artist_name: "Caspian",
  albums: [
    {
      id: "album-on-circles",
      title: "On Circles",
      artist: "Caspian",
      year: "2020",
      tracks: 10,
      cover: coverA,
      url: "https://tidal.example/album/on-circles",
      quality: ["HIRES_LOSSLESS"],
      duration: 2700,
      release_date: "2020-02-07",
      type: "ALBUM",
      status: "local",
      local_quality: { format: "flac", bit_depth: 16, sample_rate: 44100 },
      local_album_id: 510,
    },
    {
      id: "album-waking-season",
      title: "Waking Season",
      artist: "Caspian",
      year: "2012",
      tracks: 10,
      cover: coverB,
      url: "https://tidal.example/album/waking-season",
      quality: ["LOSSLESS"],
      duration: 2600,
      release_date: "2012-09-25",
      type: "ALBUM",
      status: "local",
      local_quality: { format: "flac", bit_depth: 16, sample_rate: 44100 },
      local_album_id: 511,
    },
    {
      id: "album-dust-disquiet",
      title: "Dust and Disquiet",
      artist: "Caspian",
      year: "2015",
      tracks: 11,
      cover: coverB,
      url: "https://tidal.example/album/dust-and-disquiet",
      quality: ["LOSSLESS"],
      duration: 3200,
      release_date: "2015-09-25",
      type: "ALBUM",
      status: "available",
    },
  ],
};

const soulseekResults = [
  {
    username: "northstar",
    speed: 8388608,
    freeSlot: true,
    album: "On Circles",
    artist: "Caspian",
    files: [
      {
        filename: "01 - Wildblood.flac",
        size: 38273024,
        length: 318,
        extension: "flac",
        bitDepth: 24,
        sampleRate: 96000,
      },
      {
        filename: "02 - Flowers of Light.flac",
        size: 44122112,
        length: 367,
        extension: "flac",
        bitDepth: 24,
        sampleRate: 96000,
      },
    ],
    quality: "FLAC 24-bit / 96 kHz",
    totalSize: 82395136,
  },
  {
    username: "ambientroom",
    speed: 0,
    freeSlot: false,
    album: "Dust and Disquiet",
    artist: "Caspian",
    files: [
      {
        filename: "01 - Separation No. 2.flac",
        size: 31788032,
        length: 286,
        extension: "flac",
        bitDepth: 16,
        sampleRate: 44100,
      },
    ],
    quality: "FLAC 16-bit / 44.1 kHz",
    totalSize: 31788032,
  },
];

export async function api<T>(path: string, method = "GET"): Promise<T> {
  if (method === "GET" && path === "/api/acquisition/snapshot")
    return structuredClone(acquisitionSnapshot) as T;
  if (method === "GET" && path === "/api/tidal/artists/artist-caspian/albums")
    return structuredClone(artistAlbums) as T;
  if (method === "GET" && path === "/api/acquisition/artist-suggestions")
    return {
      suggestions: [
        {
          id: 8401,
          artist_name: "Drowse",
          artist_url: "https://bandcamp.com/drowse",
          note: "Listeners asked us to add the new album.",
          status: "open",
          created_by_name: "Mara",
          supporter_count: 3,
        },
      ],
    } as T;
  if (method === "GET" && path.startsWith("/api/tidal/search?"))
    return structuredClone(searchResults) as T;
  if (method === "GET" && path === "/api/auth/scrobble/lastfm/auth-url")
    return { api_key: null } as T;
  if (method === "GET" && path === "/api/tidal/albums/album-on-circles/tracks")
    return { tracks: [] } as T;
  if (method === "POST" && path === "/api/acquisition/search/soulseek")
    return { search_id: "sample-soulseek-search" } as T;
  if (
    method === "POST" &&
    ["/api/tidal/download", "/api/tidal/wishlist"].includes(path)
  )
    return { task_id: "sample-acquisition-task" } as T;
  throw new Error(
    `Unsupported Acquisition specimen request: ${method} ${path}`,
  );
}

export const useApi = createUseApi(
  { useState, useEffect, useCallback, useRef },
  api,
);

export function apiSseUrl(path: string) {
  return path;
}

export class AcquisitionEventSource {
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private closed = false;

  constructor(url: string) {
    if (url.includes("/api/acquisition/search/soulseek/")) {
      queueMicrotask(() => {
        if (this.closed) return;
        this.onmessage?.({
          data: JSON.stringify({ results: soulseekResults, isComplete: true }),
        } as MessageEvent<string>);
      });
    }
  }

  close() {
    this.closed = true;
  }
}
