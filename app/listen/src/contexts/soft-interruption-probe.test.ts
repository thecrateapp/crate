import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiUrlResolver } from "@/lib/api-url-resolver";
import { getStreamUrl } from "@/contexts/player-utils";
import { ensureMediaAccessUrl } from "@/lib/api";
import { isOnline } from "@/lib/capacitor";
import { probeTrackAvailability } from "./soft-interruption-probe";

const platform = vi.hoisted(() => ({ configurable: true }));
vi.mock("@/lib/platform", () => ({
  get usesConfigurableServer() {
    return platform.configurable;
  },
}));
vi.mock("@/lib/capacitor", () => ({ isOnline: vi.fn() }));
vi.mock("@/contexts/player-utils", () => ({ getStreamUrl: vi.fn() }));
vi.mock("@/lib/api", () => ({
  requiresMediaAccessTicket: (url: string) =>
    resolver.requiresMediaAccessTicket(url),
  ensureMediaAccessUrl: vi.fn(),
}));

const base = "https://library.example";
const resolver = createApiUrlResolver({
  get usesConfigurableServer() {
    return platform.configurable;
  },
  getApiBase: () => base,
  apiUrl: (path) => base + path,
  getCurrentServer: () => ({
    id: "server",
    label: "",
    url: base,
    token: null,
    tokenExpiresAt: null,
    refreshToken: null,
  }),
  getMediaAccessTicket: () => null,
  queueMediaAccessTarget: () => {},
});
const track = { id: "17", title: "Track", artist: "Artist" };
const request = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  platform.configurable = true;
  vi.stubGlobal("fetch", request);
  vi.mocked(isOnline).mockResolvedValue(true);
  request.mockResolvedValue(new Response(null, { status: 206 }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("probeTrackAvailability", () => {
  it("uses the current stream ticket for the single-byte desktop request", async () => {
    const url = base + "/api/tracks/17/stream?media_ticket=old";
    const signed = base + "/api/tracks/17/stream?media_ticket=current";
    vi.mocked(getStreamUrl).mockReturnValue(url);
    vi.mocked(ensureMediaAccessUrl).mockResolvedValue(signed);
    await expect(probeTrackAvailability(track)).resolves.toBe(true);
    expect(ensureMediaAccessUrl).toHaveBeenCalledWith(url, "stream");
    expect(request).toHaveBeenCalledWith(
      signed,
      expect.objectContaining({
        headers: { Range: "bytes=0-0" },
        credentials: "omit",
      }),
    );
  });

  it.each([
    "https://external.example/api/tracks/17/stream",
    "blob:offline-track",
  ])("probes %s without supplying server credentials", async (url) => {
    vi.mocked(getStreamUrl).mockReturnValue(url);
    await expect(probeTrackAvailability(track)).resolves.toBe(true);
    expect(ensureMediaAccessUrl).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("uses same-origin cookies on the web and skips requests when offline", async () => {
    platform.configurable = false;
    vi.mocked(getStreamUrl).mockReturnValue("/api/tracks/17/stream");
    vi.mocked(isOnline).mockResolvedValueOnce(false);
    await expect(probeTrackAvailability(track)).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
    await expect(probeTrackAvailability(track)).resolves.toBe(true);
    expect(ensureMediaAccessUrl).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      "/api/tracks/17/stream",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("finishes within the probe deadline even when ticket acquisition stalls", async () => {
    vi.useFakeTimers();
    vi.mocked(getStreamUrl).mockReturnValue(base + "/api/tracks/17/stream");
    vi.mocked(ensureMediaAccessUrl).mockImplementation(
      () => new Promise(() => {}),
    );
    const result = probeTrackAvailability(track);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(result).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
