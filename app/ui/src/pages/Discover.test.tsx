import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  pollTaskMock,
  refetchCompletenessMock,
  toastWarningMock,
  useApiMock,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pollTaskMock: vi.fn(),
  refetchCompletenessMock: vi.fn(),
  toastWarningMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: useApiMock,
}));

vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: pollTaskMock }),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: toastWarningMock,
  },
}));

import { Discover } from "./Discover";

describe("Discover completeness refresh", () => {
  beforeEach(() => {
    apiMock.mockReset();
    pollTaskMock.mockReset();
    refetchCompletenessMock.mockReset();
    useApiMock.mockImplementation((url: string) => {
      if (url === "/api/discover/completeness") {
        return {
          data: [],
          loading: false,
          error: null,
          refetch: refetchCompletenessMock,
        };
      }
      if (url.startsWith("/api/acquisition/new-releases")) {
        return {
          data: { releases: [] },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: { popularity: [], top_albums: [], top_genres: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });
  });

  it("tracks the queued task and refreshes completeness when it completes", async () => {
    apiMock.mockResolvedValue({ task_id: "task-1" });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Discover />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Recompute gaps" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/discover/completeness/refresh",
        "POST",
      );
    });
    expect(pollTaskMock).toHaveBeenCalledWith(
      "task-1",
      expect.any(Function),
      expect.any(Function),
      3000,
      expect.any(Number),
    );

    const onComplete = pollTaskMock.mock.calls[0]![1] as () => void;
    onComplete();

    expect(refetchCompletenessMock).toHaveBeenCalledTimes(1);
  });

  it("uses the shared solid surface for acquisition opportunity cards", () => {
    useApiMock.mockImplementation((url: string) => {
      if (url === "/api/discover/completeness") {
        return {
          data: [
            {
              artist: "Caspian",
              artist_id: 41,
              has_photo: false,
              listeners: 28,
              local_count: 2,
              mb_count: 4,
              pct: 50,
              missing: [
                { title: "Dust and Disquiet", type: "album", year: "2015" },
              ],
            },
          ],
          loading: false,
          error: null,
          refetch: refetchCompletenessMock,
        };
      }
      if (url.startsWith("/api/acquisition/new-releases")) {
        return {
          data: { releases: [] },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: { popularity: [], top_albums: [], top_genres: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    render(
      <MemoryRouter>
        <Discover />
      </MemoryRouter>,
    );

    expect(screen.getByRole("img", { name: "Caspian" })).toBeInTheDocument();
    const surface = screen
      .getByText("50% discography coverage")
      .closest(".bg-raised-surface");
    expect(surface).toHaveClass("border", "border-border-quiet", "shadow-none");
    expect(surface).not.toHaveClass("bg-black/20");
  });

  it("warns when the completed refresh contains skipped artists", async () => {
    apiMock.mockResolvedValue({ task_id: "task-1" });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Discover />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Recompute gaps" }));

    const onComplete = pollTaskMock.mock.calls[0]![1] as (
      result?: Record<string, unknown>,
    ) => void;
    onComplete({ partial: true, failed_artists: 2 });

    expect(refetchCompletenessMock).toHaveBeenCalledTimes(1);
    expect(toastWarningMock).toHaveBeenCalledWith(
      "Completeness refreshed with 2 artists skipped",
    );
  });

  it("shows an unavailable catalogue feed without hiding healthy discovery data", async () => {
    useApiMock.mockImplementation((url: string) => {
      if (url === "/api/discover/completeness") {
        return {
          data: null,
          loading: false,
          error: "Catalogue source unavailable",
          refetch: refetchCompletenessMock,
        };
      }
      if (url.startsWith("/api/acquisition/new-releases")) {
        return {
          data: { releases: [] },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: { popularity: [], top_albums: [], top_genres: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Discover />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Discovery" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Catalogue gaps could not be loaded. Other discovery data remains available.",
    );
    expect(screen.getByText("Catalogue gaps unavailable")).toBeVisible();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(
      screen.queryByText(
        "No acquisition opportunities match the current filter.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("No detected releases available right now."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(refetchCompletenessMock).toHaveBeenCalledTimes(1);
  });
});
