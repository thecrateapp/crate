import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(() => ({ data: [] })),
}));

import { useApi } from "@/hooks/use-api";
import { useLazyCrateOptions } from "@/hooks/use-lazy-crate-options";

describe("useLazyCrateOptions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not request Crates until the menu needs them", () => {
    const useApiMock = vi.mocked(useApi);

    const { result, rerender } = renderHook(() => useLazyCrateOptions());

    expect(useApiMock).toHaveBeenLastCalledWith(null);
    expect(result.current.crateOptions).toEqual([]);

    act(() => {
      result.current.ensureCrateOptionsLoaded();
    });
    rerender();

    expect(useApiMock).toHaveBeenLastCalledWith("/api/me/crates");
  });

  it("maps Crate summaries to menu options", () => {
    vi.mocked(useApi).mockReturnValue({
      data: [
        {
          id: "crate-1",
          owner_id: 1,
          name: "Year-end records",
        },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useLazyCrateOptions(true));

    expect(result.current.crateOptions).toEqual([
      { id: "crate-1", name: "Year-end records", albumUids: [] },
    ]);
  });
});
