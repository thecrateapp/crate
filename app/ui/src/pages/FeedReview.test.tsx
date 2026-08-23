import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, refetchMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  refetchMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { FeedReview } from "./FeedReview";

const item = {
  id: 19,
  item_id: 7,
  status: "ready",
  review_status: "pending",
  source_content_hash: "hash-1",
  current_content_hash: "hash-1",
  language: "English",
  result_json: {
    summary: "A new European tour was announced.",
    key_points: ["European tour"],
    warnings: [],
  },
  model: "ollama/test",
  prompt_version: "external-feed-summary-v1",
  title: "Tour announcement",
  item_kind: "news",
  source_url: "https://artist.example/feed.xml",
  canonical_url: "https://artist.example/news/tour",
  excerpt: "The artist announced a new European tour.",
  published_at: "2026-08-23T12:00:00Z",
  source_kind: "artist_site",
  artist_name: "Example Artist",
};

describe("FeedReview", () => {
  beforeEach(() => {
    apiMock.mockReset();
    refetchMock.mockReset();
    useApiMock.mockReturnValue({
      data: { items: [item] },
      loading: false,
      error: null,
      refetch: refetchMock,
    });
  });

  it("renders a proposal and accepts it from the review modal", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({ review_status: "accepted" });

    render(
      <MemoryRouter>
        <FeedReview />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Feed review" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tour announcement")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review proposal" }));
    expect(
      screen.getAllByText("A new European tour was announced.").length,
    ).toBe(2);
    expect(screen.getByLabelText("Rejection reason")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Accept proposal" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/external-feeds/enrichments/19/review",
        "POST",
        { decision: "accept", rejection_reason: null },
      );
    });
    expect(refetchMock).toHaveBeenCalled();
  });

  it("requires a rejection reason before rejecting", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <FeedReview />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Review proposal" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(apiMock).not.toHaveBeenCalled();
  });
});
