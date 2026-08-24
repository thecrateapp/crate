import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, refetchMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  refetchMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasAnyCapability: () => true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { FeedSources } from "./FeedSources";

const source = {
  id: 1,
  source_kind: "publisher_rss",
  source_scope: "publisher",
  source_url: "https://pitchfork.com/feed/rss",
  canonical_url: "https://pitchfork.com/",
  display_name: "Pitchfork",
  publisher_name: "Pitchfork",
  category: "music_news",
  state: "active",
  ai_policy: "enabled",
  refresh_interval_seconds: 86400,
  active_item_count: 18,
  last_success_at: "2026-08-24T08:00:00Z",
  last_error: null,
};

describe("FeedSources", () => {
  beforeEach(() => {
    apiMock.mockReset();
    refetchMock.mockReset();
    useApiMock.mockReturnValue({
      data: { items: [source] },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
  });

  it("lists global sources and creates one from the admin modal", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ source: { id: 2 }, task_id: "task-2" });

    render(<FeedSources />);

    expect(
      screen.getByRole("heading", { name: "RSS sources" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Pitchfork")).toBeInTheDocument();
    expect(screen.getByText("18 active items")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add RSS source" }));
    await user.type(screen.getByLabelText("Display name"), "Bandcamp Daily");
    await user.type(
      screen.getByLabelText("RSS or Atom URL"),
      "https://daily.bandcamp.com/feed",
    );
    await user.click(screen.getByRole("button", { name: "Save source" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/external-feeds/sources",
        "POST",
        expect.objectContaining({
          display_name: "Bandcamp Daily",
          source_url: "https://daily.bandcamp.com/feed",
        }),
      );
    });
    expect(refetchMock).toHaveBeenCalled();
  });

  it("pauses a source and can refresh it immediately", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({});

    render(<FeedSources />);

    await user.click(screen.getByRole("button", { name: "Pause Pitchfork" }));
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/external-feeds/sources/1",
        "PATCH",
        { state: "disabled" },
      );
    });

    await user.click(screen.getByRole("button", { name: "Refresh Pitchfork" }));
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/external-feeds/sources/1/refresh",
        "POST",
      );
    });
  });

  it("previews cached items without fetching the provider from the browser", async () => {
    const user = userEvent.setup();
    useApiMock.mockImplementation((url: string | null) => {
      if (url?.includes("/items")) {
        return {
          data: {
            items: [
              {
                id: 31,
                title: "New music briefing",
                excerpt: "The latest independent releases.",
                published_at: "2026-08-24T08:00:00Z",
                canonical_url: "https://pitchfork.com/news/briefing",
              },
            ],
          },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: { items: [source] },
        loading: false,
        error: null,
        refetch: refetchMock,
      };
    });

    render(<FeedSources />);

    await user.click(screen.getByRole("button", { name: "Preview Pitchfork" }));

    expect(screen.getByText("New music briefing")).toBeInTheDocument();
    expect(
      screen.getByText("The latest independent releases."),
    ).toBeInTheDocument();
  });
});
