import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloudPositions,
  clusterCenters,
  decodeCloud,
  loadLibraryCloud,
  mulberry32,
} from "./sources";

describe("cloudPositions", () => {
  it("is deterministic for a given seed", () => {
    const a = cloudPositions(
      500,
      clusterCenters(8, 0.9, mulberry32(7)),
      mulberry32(7),
    );
    const b = cloudPositions(
      500,
      clusterCenters(8, 0.9, mulberry32(7)),
      mulberry32(7),
    );
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(a.positions.length).toBe(1500);
  });
});

describe("decodeCloud", () => {
  it("dequantises int16 xyz triples into the [-scale, scale] range", () => {
    const buffer = new Int16Array([32767, -32767, 0]).buffer;
    expect(Array.from(decodeCloud(buffer, 1.5))).toEqual([1.5, -1.5, 0]);
  });
});

describe("loadLibraryCloud", () => {
  const points = new Int16Array([32767, 0, 0, 0, 32767, 0, 0, 0, -32767]);

  function mockFetch(routes: Record<string, unknown>) {
    const fetch = vi.fn(async (url: string) => {
      const body = routes[url];
      if (body === undefined) return new Response(null, { status: 404 });
      return body instanceof ArrayBuffer
        ? new Response(body)
        : new Response(JSON.stringify(body));
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("skips the binary when the metadata is missing", async () => {
    const fetch = mockFetch({});

    expect(await loadLibraryCloud(2)).toBeNull();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/data/library-cloud.json",
    ]);
  });

  it("returns the requested points scaled by the exported radius", async () => {
    mockFetch({
      "/data/library-cloud.json": { count: 3, radius: 2 },
      "/data/library-cloud.bin": points.buffer,
    });

    expect(Array.from((await loadLibraryCloud(2))!)).toEqual([
      2, 0, 0, 0, 2, 0,
    ]);
  });

  it("uses every available point when fewer than requested exist", async () => {
    mockFetch({
      "/data/library-cloud.json": { count: 3, radius: 1.5 },
      "/data/library-cloud.bin": points.buffer,
    });

    expect((await loadLibraryCloud(40000))!.length).toBe(9);
  });

  it("trusts the binary length over a larger metadata count", async () => {
    mockFetch({
      "/data/library-cloud.json": { count: 50, radius: 1.5 },
      "/data/library-cloud.bin": points.buffer,
    });

    expect((await loadLibraryCloud(40000))!.length).toBe(9);
  });

  it("returns null when the binary is missing", async () => {
    mockFetch({ "/data/library-cloud.json": { count: 3, radius: 1.5 } });

    expect(await loadLibraryCloud(2)).toBeNull();
  });
});
