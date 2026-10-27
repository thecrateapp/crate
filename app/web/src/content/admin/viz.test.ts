import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import scale from "../../data/scale.json";
import {
  readPyConstants,
  readPyTuples,
  repoFile,
} from "../../lib/source-drift";
import { EQ_PRESETS } from "../listen/viz";
import {
  ENRICHMENT,
  GENRES,
  GOVERNED_TASKS,
  GOVERNOR,
  HEALTH_CHECKS,
  QUEUE_ORDER,
  QUEUE_PICKS,
  RELATION_TYPES,
  RELEASE_STAGES,
  EXAMPLE_TRACKS,
  SIDECAR,
  SIDECAR_TRACKS,
  IDENTITY_TAGS,
  TAXONOMY_RELEASE,
} from "./viz";
import {
  albumEntityUid,
  artistEntityUid,
  trackEntityUid,
} from "../../lib/entity-uid";

const read = (path: string) => readFileSync(repoFile(path), "utf8");

const pyStrings = (block: string) =>
  [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);

function pyBlock(source: string, start: string): string {
  const from = source.indexOf(start);
  if (from === -1) throw new Error(`${start} not found`);
  return source.slice(from, source.indexOf("\n)", from));
}

describe("health checks copied from the repair catalog", () => {
  const catalog = pyBlock(
    read("app/crate/repair_catalog.py"),
    "REPAIR_CATALOG: tuple",
  );
  const entries = catalog.split("RepairCatalogEntry(").slice(1);

  it("lists the same checks with the same risk, scope and confirmation", () => {
    const fromSource = entries.map((entry) => {
      const [id, , , , risk, scope] = pyStrings(
        entry.replace(/\bNone\b/, '"None"'),
      );
      return {
        id,
        risk,
        scope,
        confirm: /requires_confirmation=True/.test(entry),
      };
    });

    expect(
      HEALTH_CHECKS.map(({ id, risk, scope, confirm }) => ({
        id,
        risk,
        scope,
        confirm,
      })),
    ).toEqual(fromSource);
    expect(HEALTH_CHECKS).toHaveLength(17);
  });

  it("uses the labels and descriptions from the admin Health page", () => {
    const page = read("app/ui/src/pages/Health.tsx");
    const table = (name: string) => {
      const block = page.slice(
        page.indexOf(`const ${name}`),
        page.indexOf("};", page.indexOf(`const ${name}`)),
      );
      return Object.fromEntries(
        [...block.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)].map(
          ([, key, value]) => [key, value],
        ),
      );
    };
    const labels = table("CHECK_LABELS");
    const descriptions = table("CHECK_DESCRIPTIONS");

    for (const check of HEALTH_CHECKS) {
      expect(check.label).toBe(labels[check.id]);
      expect(check.description).toBe(descriptions[check.id]);
    }
  });
});

describe("genre taxonomy copied from the seeded definitions", () => {
  const source = read("app/crate/genre_taxonomy.py");

  it("has every seeded genre with its parents, related genres and EQ template", () => {
    const block = pyBlock(source, "_RAW_GENRE_DEFINITIONS:");
    const fromSource = block
      .split("GenreDefinition(")
      .slice(1)
      .map((entry) => {
        const list = (name: string) => {
          const match = entry.match(new RegExp(`${name}=\\(([^)]*)\\)`));
          return match ? pyStrings(match[1]!) : [];
        };
        const genre: Record<string, unknown> = { slug: pyStrings(entry)[0] };
        if (/top_level=True/.test(entry)) genre.top = true;
        if (list("parents").length) genre.parents = list("parents");
        if (list("related").length) genre.related = list("related");
        const eq = entry.match(/eq_gains=_EQ_(\w+)/);
        if (eq) genre.eq = eq[1]!.toLowerCase();
        return genre;
      });

    expect(GENRES).toEqual(fromSource);
    expect(GENRES).toHaveLength(61);
  });

  it("uses EQ templates whose gains match Listen's presets", () => {
    const templates = readPyTuples(source, "_EQ_");
    for (const genre of GENRES.filter((item) => item.eq)) {
      expect(templates[`_EQ_${genre.eq!.toUpperCase()}`]).toEqual(
        EQ_PRESETS[genre.eq!],
      );
    }
  });

  it("names the relation types the repository accepts", () => {
    const repository = read(
      "app/crate/db/repositories/genres_taxonomy_edges.py",
    );
    const declared = pyStrings(
      repository.match(/VALID_RELATION_TYPES = \{([^}]*)\}/)![1]!,
    );

    expect([...RELATION_TYPES].sort()).toEqual(declared.sort());
  });

  it("matches the signed core release", () => {
    const release = JSON.parse(
      read("app/crate/data/taxonomy/crate-core-1.0.0.json"),
    );

    expect(release.taxonomy_id).toBe(TAXONOMY_RELEASE.id);
    expect(release.version).toBe(TAXONOMY_RELEASE.version);
    expect(release.taxonomy_digest).toBe(TAXONOMY_RELEASE.digest);
    expect(release.released_at.slice(0, 10)).toBe(TAXONOMY_RELEASE.releasedAt);
  });
});

describe("enrichment sources copied from crate.enrichment", () => {
  const source = read("app/crate/enrichment.py");

  it("fetches the same artist sources in the same order with the same cache lifetimes", () => {
    const order = pyStrings(
      source.slice(
        source.indexOf("_ENRICHMENT_FETCH_ORDER"),
        source.indexOf(")", source.indexOf("_ENRICHMENT_FETCH_ORDER")),
      ),
    );
    const ttlBlock = source.slice(
      source.indexOf("_SOURCE_TTLS_SECONDS"),
      source.indexOf("}", source.indexOf("_SOURCE_TTLS_SECONDS")),
    );
    const ttls = Object.fromEntries(
      [...ttlBlock.matchAll(/"(\w+)":\s*86400(?:\s*\*\s*(\d+))?/g)].map(
        ([, id, days]) => [id, Number(days ?? 1)],
      ),
    );
    const intervalBlock = source.slice(
      source.indexOf("_PROVIDER_MIN_INTERVAL_SECONDS"),
      source.indexOf("}", source.indexOf("_PROVIDER_MIN_INTERVAL_SECONDS")),
    );
    const intervals = Object.fromEntries(
      [...intervalBlock.matchAll(/"(\w+)":\s*([\d.]+)/g)].map(
        ([, id, value]) => [id, Number(value)],
      ),
    );

    expect(ENRICHMENT.artist.map((item) => item.id)).toEqual(order);
    for (const item of ENRICHMENT.artist) {
      expect(item.ttlDays).toBe(ttls[item.id]);
      expect(item.interval).toBe(intervals[item.id]);
    }
    expect(source).toContain(
      `raw = config.get("enrichment_parallelism", ${ENRICHMENT.parallelism})`,
    );
  });
});

describe("resource governor copied from crate.resource_governor", () => {
  const source = read("app/crate/resource_governor.py");

  it("uses the default thresholds", () => {
    const defaults = readPyConstants(source, "DEFAULT_");

    expect(defaults.DEFAULT_LOAD_RATIO).toBe(GOVERNOR.loadRatio);
    expect(defaults.DEFAULT_IOWAIT_PERCENT).toBe(GOVERNOR.iowaitPercent);
    expect(defaults.DEFAULT_SWAP_PERCENT).toBe(GOVERNOR.swapPercent);
    expect(defaults.DEFAULT_SWAP_MIN_USED_MB).toBe(GOVERNOR.swapMinUsedMb);
    expect(defaults.DEFAULT_MIN_MEMORY_AVAILABLE_PERCENT).toBe(
      GOVERNOR.minMemoryAvailablePercent,
    );
    expect(defaults.DEFAULT_MAX_ACTIVE_USERS).toBe(GOVERNOR.maxActiveUsers);
    expect(defaults.DEFAULT_MAX_ACTIVE_STREAMS).toBe(GOVERNOR.maxActiveStreams);
    expect(defaults.DEFAULT_DEFER_SECONDS).toBe(GOVERNOR.deferSeconds);
    expect([
      defaults.DEFAULT_MAINTENANCE_WINDOW_START,
      defaults.DEFAULT_MAINTENANCE_WINDOW_END,
    ]).toEqual([...GOVERNOR.window]);
  });

  it("governs the same task types", () => {
    const block = pyBlock(source, "RESOURCE_GOVERNED_TASK_TYPES = frozenset(");

    expect([...GOVERNED_TASKS].sort()).toEqual(pyStrings(block).sort());
  });
});

describe("task queues generated from crate.actors", () => {
  const queues = scale.taskQueues as Record<string, string[]>;

  it("are current: rerun npm run build when actors.py changes", () => {
    const source = read("app/crate/actors.py");
    const block = source.slice(source.indexOf("TASK_POOL_CONFIG: dict"));
    const declared = [
      ...block.matchAll(/"(\w+)"\s*:\s*TaskPoolConfig\(\s*"(\w+)"/g),
    ];

    expect(Object.values(queues).flat().sort()).toEqual(
      declared.map(([, name]) => name).sort(),
    );
    expect(scale.taskTypes).toBe(declared.length);
  });

  it("only show task types that exist on their queue", () => {
    expect(Object.keys(queues).sort()).toEqual([...QUEUE_ORDER].sort());
    for (const queue of QUEUE_ORDER) {
      for (const task of QUEUE_PICKS[queue])
        expect(queues[queue]).toContain(task);
    }
    for (const stage of RELEASE_STAGES.filter((item) =>
      /^\w+$/.test(item.task),
    )) {
      expect(Object.values(queues).flat()).toContain(stage.task);
    }
  });
});

describe("portable metadata sample", () => {
  const sources =
    read("app/crate/portable_metadata.py") +
    read("app/crate/db/queries/portable_metadata.py");

  const keys = (value: unknown): string[] =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
      : Array.isArray(value)
        ? value.flatMap(keys)
        : [];

  it("only uses keys that .crate/album.json really has", () => {
    for (const key of new Set(keys(SIDECAR)))
      expect(sources).toMatch(new RegExp(`\\b${key}\\b`));
    expect(sources).toContain(
      `PORTABLE_SCHEMA_VERSION = ${SIDECAR.schema_version}`,
    );
  });

  it("uses the identity tags written into every file", () => {
    for (const tag of IDENTITY_TAGS) expect(sources).toContain(`"${tag}"`);
  });

  it("carries the entity ids crate.entity_ids would derive", () => {
    const artist = artistEntityUid({ name: SIDECAR.artist.name });
    const album = albumEntityUid({
      artistUid: artist,
      albumName: SIDECAR.album.name,
      year: SIDECAR.album.year,
    });
    const [track] = SIDECAR.tracks;

    expect(SIDECAR.artist.entity_uid).toBe(artist);
    expect(SIDECAR.album.entity_uid).toBe(album);
    expect(track!.entity_uid).toBe(
      trackEntityUid({
        albumUid: album,
        discNumber: 1,
        trackNumber: 1,
        title: track!.title,
        filename: track!.filename,
      }),
    );
    expect(SIDECAR_TRACKS[0]).toBe(track!.title);
    expect(SIDECAR_TRACKS).toHaveLength(SIDECAR.album.track_count);
    expect(track!.bliss.vector).toHaveLength(20);
  });
});

describe("analysis readout", () => {
  it("only shows features the analysis pipeline stores", () => {
    const query = read("app/crate/db/queries/portable_metadata.py");
    for (const feature of Object.keys(EXAMPLE_TRACKS[0]!.features))
      expect(query).toContain(`"${feature}": track.get("analysis_${feature}")`);
    for (const column of [
      "bpm",
      "loudness",
      "dynamic_range",
      "audio_key",
      "audio_scale",
    ])
      expect(query).toContain(`"${column}": track.get("analysis_${column}")`);
    expect(read("app/crate/audio_analysis.py")).toContain("LoudnessEBUR128");
  });
});
