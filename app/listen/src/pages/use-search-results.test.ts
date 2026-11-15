import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/lib/network-search-stream", () => ({
  openNetworkSearchStream: vi.fn(() => () => undefined),
}));

import { api } from "@/lib/api";
import { openNetworkSearchStream } from "@/lib/network-search-stream";

import { useSearchResults } from "./use-search-results";

const EMPTY = { artists: [], albums: [], tracks: [] };

describe("useSearchResults", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(api).mockResolvedValue(EMPTY);
    vi.mocked(openNetworkSearchStream).mockClear();
  });

  it("starts nothing while the capabilities load, then streams at once", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean | null }) =>
        useSearchResults("joy division", 0, enabled),
      { initialProps: { enabled: null as boolean | null } },
    );

    expect(result.current.searching).toBe(true);
    expect(api).not.toHaveBeenCalled();
    expect(openNetworkSearchStream).not.toHaveBeenCalled();

    rerender({ enabled: true });

    expect(openNetworkSearchStream).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openNetworkSearchStream).mock.calls[0]![0]).toBe(
      "joy division",
    );
    expect(api).not.toHaveBeenCalled();
  });

  it("uses the canonical search once the server says no", async () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean | null }) =>
        useSearchResults("joy division", 0, enabled),
      { initialProps: { enabled: null as boolean | null } },
    );

    await act(async () => {
      rerender({ enabled: false });
    });

    expect(api).toHaveBeenCalledTimes(1);
    expect(openNetworkSearchStream).not.toHaveBeenCalled();
  });
});
