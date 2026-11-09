import { describe, expect, it } from "vitest";
import {
  AGE_DAYS,
  assemble,
  enrichmentFrame,
  enrichmentReadout,
  ENRICHMENT_STATES,
  ENRICHMENT_TRACKS,
  isCached,
  JOBS,
  PARALLELISM,
  PAYLOADS,
  SOURCES,
  STEPS,
  STORED,
  writeRow,
} from "./enrichment";

const track = ENRICHMENT_TRACKS.run;
const pin = (phase: number) => track.pins![phase]!;
const source = (t: number, id: string) =>
  enrichmentFrame(t).sources.find((item) => item.id === id)!;
const field = (t: number, id: string) =>
  enrichmentFrame(t).fields.find((item) => item.id === id)!;

describe("enrichment figure model", () => {
  it("has one phase start per phase of copy", () => {
    for (const state of ENRICHMENT_STATES)
      expect(ENRICHMENT_TRACKS[state.id]!.starts).toHaveLength(
        state.phases.length,
      );
  });

  it("uses the fetch order, source TTLs and pool size from enrichment.py", () => {
    expect(SOURCES.map((item) => item.id)).toEqual([
      "lastfm",
      "spotify",
      "musicbrainz",
      "setlist",
      "fanart",
      "discogs",
    ]);
    expect(SOURCES.map((item) => item.ttlDays)).toEqual([7, 3, 30, 1, 30, 30]);
    expect(PARALLELISM).toBe(3);
  });

  it("reuses the sources still inside their TTL and schedules only the misses", () => {
    const hits = SOURCES.filter((item) => isCached(item, AGE_DAYS)).map(
      (item) => item.id,
    );
    expect(hits).toEqual(["musicbrainz", "fanart", "discogs"]);
    expect(JOBS.map((job) => job.source).sort()).toEqual(
      ["lastfm", "setlist", "spotify"].sort(),
    );
    expect(isCached({ ttlDays: 7 }, 7)).toBe(false);
    expect(isCached({ ttlDays: 7 }, 6.9)).toBe(true);
  });

  it("parks cache hits in memory before any fetcher starts", () => {
    const firstStart = Math.min(...JOBS.map((job) => job.start));
    for (const id of ["musicbrainz", "fanart", "discogs"]) {
      const before = source(firstStart, id);
      expect(before.status).toBe("hit");
      expect(before.parked).toBe(true);
    }
    expect(source(firstStart - 0.01, "lastfm").status).toBe("queued");
  });

  it("never runs more fetchers than the pool allows", () => {
    for (let t = 0; t < track.period; t += 0.05) {
      const frame = enrichmentFrame(t);
      expect(frame.busy).toBeLessThanOrEqual(PARALLELISM);
    }
    const lanes = new Set(JOBS.map((job) => job.lane));
    expect(lanes.size).toBeLessThanOrEqual(PARALLELISM);
    expect(enrichmentFrame((JOBS[0]!.start + JOBS[1]!.end) / 2).busy).toBe(3);
  });

  it("drops the failed source: no payload, no packet, nothing parked", () => {
    const failed = source(pin(1), "lastfm");
    expect(failed.status).toBe("failed");
    expect(failed.packet).toBeNull();
    expect(failed.parked).toBe(false);
    expect(PAYLOADS.lastfm).toBeNull();
  });

  it("separates responses received from the artist saved", () => {
    const received = enrichmentFrame(pin(1));
    expect(received.received).toBe(5);
    expect(received.row).toBe("unchanged");
    expect(received.fields.every((item) => item.stage === "stored")).toBe(true);
    const lastEnd = Math.max(...JOBS.map((job) => job.end));
    const assembly = STEPS.find((step) => step.id === "assemble")!;
    expect(assembly.start).toBeGreaterThanOrEqual(lastEnd);
    expect(track.starts[2]).toBeGreaterThanOrEqual(lastEnd);
  });

  it("assembles tags from Last.fm then Spotify, removing exact duplicates in order", () => {
    const merged = assemble({
      lastfm: { bio: "English rock band", tags: ["rock", "art rock"] },
      spotify: {
        followers: 5000000,
        genres: ["alternative rock", "rock"],
      },
      musicbrainz: { country: "GB" },
    });
    expect(merged.tags).toEqual(["rock", "art rock", "alternative rock"]);
    expect(merged.bio).toBe("English rock band");
    expect(merged.country).toBe("GB");
  });

  it("proposes no biography and Spotify-only tags when Last.fm fails", () => {
    const persist = assemble(PAYLOADS);
    expect(persist.bio).toBeUndefined();
    expect(persist.tags).toEqual(PAYLOADS.spotify!.genres);
    expect(persist.country).toBe("GB");
    expect(field(pin(2), "bio").value).toBe("None");
    expect(field(pin(2), "bio").stage).toBe("proposed");
    expect(field(pin(2), "country").value).toBe("GB");
  });

  it("writes only values that are not None and not locked", () => {
    const { row, outcomes } = writeRow(
      STORED,
      { tags: [], country: "GB", spotify_followers: 10 },
      new Set(["country"]),
    );
    expect(row.bio).toBe(STORED.bio);
    expect(outcomes.bio).toBe("kept");
    expect(row.country).toBe(STORED.country);
    expect(outcomes.country).toBe("locked");
    expect(row.tags).toEqual([]);
    expect(outcomes.tags).toBe("replaced");
    expect(row.spotify_followers).toBe(10);
  });

  it("ends with the biography and the corrected country kept, tags replaced", () => {
    const end = enrichmentFrame(pin(3));
    expect(end.row).toBe("written");
    const outcome = (id: string) =>
      end.fields.find((item) => item.id === id)!.outcome;
    expect(outcome("bio")).toBe("kept");
    expect(outcome("country")).toBe("locked");
    expect(outcome("tags")).toBe("replaced");
    expect(outcome("spotify_followers")).toBe("set");
    expect(field(pin(3), "country").value).toBe("CA");
    expect(field(pin(3), "bio").value).toBe(STORED.bio);
    expect(enrichmentFrame(pin(3)).stamp).toBe("now");
    expect(enrichmentFrame(pin(1)).stamp).toBe(`${AGE_DAYS} days ago`);
  });

  it("reports the failure and the fix in the readouts", () => {
    expect(enrichmentReadout(enrichmentFrame(pin(0))).hits).toEqual({
      text: "3 / 6",
      tone: "ok",
    });
    const fetched = enrichmentReadout(enrichmentFrame(pin(1)));
    expect(fetched.payloads).toEqual({ text: "5 / 6", tone: "warn" });
    expect(fetched.row.text).toBe("Unchanged");
    expect(enrichmentReadout(enrichmentFrame(pin(2))).bio).toEqual({
      text: "None",
      tone: "warn",
    });
    const end = enrichmentReadout(enrichmentFrame(pin(3)));
    expect(end.bio).toEqual({ text: "Kept", tone: "ok" });
    expect(end.row).toEqual({ text: "Written", tone: "ok" });
  });

  it("keeps the reduced-motion end state on the written record", () => {
    const end = enrichmentFrame(track.period - 0.001);
    expect(end.row).toBe("written");
    expect(end.busy).toBe(0);
  });
});
