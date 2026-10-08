import { describe, expect, it, vi } from "vitest";

import { createSpectrumClient, SpectrumUnavailableError } from "./client";

function envelope(): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x43, 0x52, 0x53, 0x50]);
  const view = new DataView(buffer);
  view.setUint8(4, 1);
  view.setUint8(5, 24);
  view.setUint16(6, 100);
  view.setUint32(8, 1);
  view.setUint32(12, 100);
  view.setInt16(16, -80);
  return buffer;
}

describe("Cast spectrum client", () => {
  it("honours Retry-After until the lazy artefact is ready", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "pending" }), {
          status: 202,
          headers: { "Retry-After": "2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "generating" }), {
          status: 425,
          headers: { "Retry-After": "1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(envelope(), {
          status: 200,
          headers: { ETag: '"spectrum-etag"' },
        }),
      );
    const sleep = vi.fn(async () => undefined);
    const client = createSpectrumClient({ fetcher, sleep });

    const artifact = await client.load("https://api.test/spectrum");

    expect(artifact.frameCount).toBe(1);
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000, undefined);
    expect(sleep).toHaveBeenNthCalledWith(2, 1_000, undefined);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("revalidates cached data with ETag and accepts 304", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(envelope(), {
          status: 200,
          headers: { ETag: '"spectrum-etag"' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = createSpectrumClient({ fetcher });

    const first = await client.load("https://api.test/spectrum");
    const second = await client.load("https://api.test/spectrum");

    expect(second).toBe(first);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api.test/spectrum",
      expect.objectContaining({
        headers: { "If-None-Match": '"spectrum-etag"' },
      }),
    );
  });

  it.each([404, 410, 500])(
    "falls back without leaking the scoped URL for status %s",
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
      const client = createSpectrumClient({ fetcher });
      const request = client.load(
        "https://api.test/api/cast/sessions/private-lease/items/one/spectrum",
      );

      await expect(request).rejects.toBeInstanceOf(SpectrumUnavailableError);
      await expect(request).rejects.not.toThrow("private-lease");
    },
  );

  it("bounds polling when generation never completes", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 425,
        headers: { "Retry-After": "999" },
      }),
    );
    const sleep = vi.fn(async () => undefined);
    const client = createSpectrumClient({ fetcher, maxAttempts: 3, sleep });

    await expect(client.load("https://api.test/spectrum")).rejects.toThrow(
      "CAST_SPECTRUM_UNAVAILABLE",
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5_000, undefined);
  });
});
