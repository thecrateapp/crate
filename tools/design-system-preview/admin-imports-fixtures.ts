type QueueItem = {
  source: string;
  source_path: string;
  artist: string;
  album: string;
  track_count: number;
  formats: string[];
  total_size_mb: number;
  dest_path: string;
  dest_exists: boolean;
  status: "pending" | "importing" | "imported" | "merged";
  dest_album_id?: number;
  task_id?: string;
  last_error?: string | null;
};

const initialQueue: QueueItem[] = [
  {
    source: "upload",
    source_path: "/staging/Mint Field/Elsewhere",
    artist: "Mint Field",
    album: "Elsewhere",
    track_count: 9,
    formats: ["flac"],
    total_size_mb: 412,
    dest_path: "/music/Mint Field/Elsewhere",
    dest_exists: false,
    status: "pending",
  },
  {
    source: "bandcamp",
    source_path: "/staging/Glacier Veins/Slow Bloom",
    artist: "Glacier Veins",
    album: "Slow Bloom",
    track_count: 7,
    formats: ["flac", "mp3"],
    total_size_mb: 286,
    dest_path: "/music/Glacier Veins/Slow Bloom",
    dest_exists: false,
    status: "importing",
    task_id: "sample-import-task",
  },
  {
    source: "upload",
    source_path: "/staging/Glacier Veins/Quiet Passage",
    artist: "Glacier Veins",
    album: "Quiet Passage",
    track_count: 8,
    formats: ["flac"],
    total_size_mb: 338,
    dest_path: "/music/Glacier Veins/Quiet Passage",
    dest_exists: true,
    status: "imported",
    dest_album_id: 44,
  },
];

let queue = structuredClone(initialQueue);
let taskSerial = 0;

export function resetImportsFixture() {
  queue = structuredClone(initialQueue);
  taskSerial = 0;
}

const sidecar = {
  schema_version: 1,
  artist: { name: "Glacier Veins", slug: "glacier-veins" },
  album: {
    name: "Quiet Passage",
    path: "/music/Glacier Veins/Quiet Passage",
    has_cover: 1,
    year: "2025",
  },
  tracks: [
    {
      relative_path: "01 - Thin Air.flac",
      filename: "01 - Thin Air.flac",
      title: "Thin Air",
      track_number: 1,
    },
    {
      relative_path: "02 - Quiet Passage.flac",
      filename: "02 - Quiet Passage.flac",
      title: "Quiet Passage",
      track_number: 2,
    },
    {
      relative_path: "03 - Winter Window.flac",
      filename: "03 - Winter Window.flac",
      title: "Winter Window",
      track_number: 3,
    },
  ],
  portable_metadata: {
    sidecar_path: "/music/Glacier Veins/Quiet Passage/.crate/album.json",
    sidecar_written_at: "2026-10-21T11:00:00Z",
    audio_tags_written_at: "2026-10-21T11:00:00Z",
    tracks: 8,
    tags_written: 8,
    tag_errors: 0,
    exported_at: null,
    updated_at: "2026-10-21T11:00:00Z",
  },
};

export async function api<T>(
  url: string,
  method = "GET",
  body?: { source_path?: string },
): Promise<T> {
  if (url.startsWith("/api/imports/pending?")) {
    const status = new URLSearchParams(url.split("?")[1]).get("status");
    const visible =
      status === "completed"
        ? queue.filter(
            (item) => item.status === "imported" || item.status === "merged",
          )
        : status === "all"
          ? queue
          : queue.filter((item) => item.status === status);
    return structuredClone(visible) as T;
  }

  if (url === "/api/manage/albums/44/portable-metadata")
    return structuredClone(sidecar) as T;

  if (method === "POST" && url === "/api/imports/import") {
    const item = queue.find((entry) => entry.source_path === body?.source_path);
    const taskId = `sample-import-${++taskSerial}`;
    if (item) Object.assign(item, { status: "importing", task_id: taskId });
    return { task_id: taskId, status: "queued" } as T;
  }

  if (method === "POST" && url === "/api/imports/import-all") {
    const taskId = `sample-import-all-${++taskSerial}`;
    for (const item of queue) {
      if (item.status === "pending")
        Object.assign(item, { status: "importing", task_id: taskId });
    }
    return { task_id: taskId, status: "queued" } as T;
  }

  if (method === "POST" && url === "/api/imports/remove") {
    queue = queue.filter((item) => item.source_path !== body?.source_path);
    return { task_id: `sample-remove-${++taskSerial}`, status: "queued" } as T;
  }

  throw new Error(
    `Unsupported staged imports preview request: ${method} ${url}`,
  );
}

export function useTaskEvents(taskId: string | null) {
  if (!taskId) return { events: [], done: null, connected: false };
  return {
    events: [
      {
        id: 1,
        type: "item",
        data: { label: "Slow Bloom" },
        timestamp: "2026-10-22T10:00:00Z",
      },
    ],
    done: null,
    connected: true,
  };
}

export function albumCoverApiUrl(_input: {
  albumId?: number | null;
  artistName?: string | null;
  albumName?: string | null;
}) {
  return new URL("./acquisition-cover-signal.svg", import.meta.url).href;
}
