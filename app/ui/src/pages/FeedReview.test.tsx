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

  it("renders classification proposals in the review modal", async () => {
    const user = userEvent.setup();
    useApiMock.mockReturnValue({
      data: {
        items: [
          {
            ...item,
            result_json: {
              classification: "tour",
              confidence: 0.94,
              reasons: ["The source announces European tour dates."],
              warnings: [],
            },
          },
        ],
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    render(
      <MemoryRouter>
        <FeedReview />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Classified as tour · 94% confidence"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review proposal" }));
    expect(screen.getAllByText(/94%/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("The source announces European tour dates.").length,
    ).toBeGreaterThan(0);
  });

  it("renders cluster proposals and their source items in the review modal", async () => {
    const user = userEvent.setup();
    useApiMock.mockReturnValue({
      data: {
        items: [
          {
            ...item,
            result_json: {
              operation: "cluster",
              cluster_type: "release",
              confidence: 0.88,
              rationale: "Both items concern the same album campaign.",
              members: [
                {
                  item_id: 7,
                  role: "representative",
                  reason: "The announcement introduces the release.",
                  title: "Tour announcement",
                  source_kind: "artist_site",
                  canonical_url: "https://artist.example/news/tour",
                  published_at: "2026-08-23T12:00:00Z",
                },
                {
                  item_id: 8,
                  role: "related",
                  reason: "The pre-order covers the same album.",
                  title: "Album pre-order",
                  source_kind: "label",
                  canonical_url: "https://artist.example/pre-order",
                  published_at: "2026-08-24T12:00:00Z",
                },
              ],
              warnings: [],
            },
          },
        ],
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    render(
      <MemoryRouter>
        <FeedReview />
      </MemoryRouter>,
    );

    expect(screen.getByText("2 related items · release")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review proposal" }));
    expect(screen.getByText("Album pre-order")).toBeInTheDocument();
    expect(
      screen.getByText("Both items concern the same album campaign."),
    ).toBeInTheDocument();
    expect(screen.getByText("representative")).toBeInTheDocument();
  });

  it("explains when clustering finds no coherent related item", async () => {
    const user = userEvent.setup();
    useApiMock.mockReturnValue({
      data: {
        items: [
          {
            ...item,
            result_json: {
              operation: "cluster",
              cluster_type: "other",
              confidence: 0,
              rationale: "No related items were available.",
              members: [],
              warnings: ["No related candidate items were available."],
            },
          },
        ],
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    render(
      <MemoryRouter>
        <FeedReview />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("No related items were available."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review proposal" }));
    expect(screen.getByText("Cluster review")).toBeInTheDocument();
    expect(screen.getAllByText("No related items were available.").length).toBe(
      2,
    );
  });

  it("applies an accepted cluster and hides only its related items", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({
      enrichment_id: 19,
      representative_item_id: 7,
      related_item_ids: [8],
      applied: true,
      already_applied: false,
    });
    useApiMock.mockReturnValue({
      data: {
        items: [
          {
            ...item,
            review_status: "accepted",
            cluster_applied_item_ids: [],
            result_json: {
              operation: "cluster",
              cluster_type: "release",
              confidence: 0.88,
              rationale: "Both items concern the same album campaign.",
              members: [
                {
                  item_id: 7,
                  role: "representative",
                  reason: "The announcement introduces the release.",
                  title: "Tour announcement",
                  source_kind: "artist_site",
                },
                {
                  item_id: 8,
                  role: "related",
                  reason: "The pre-order covers the same album.",
                  title: "Album pre-order",
                  source_kind: "label",
                },
              ],
            },
          },
        ],
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    render(
      <MemoryRouter>
        <FeedReview />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "View review" }));
    await user.click(
      screen.getByRole("button", { name: "Hide related items" }),
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/external-feeds/enrichments/19/apply-cluster",
        "POST",
      );
    });
    expect(refetchMock).toHaveBeenCalled();
  });

  it("restores related items from an applied cluster", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({
      enrichment_id: 19,
      representative_item_id: 7,
      restored_item_ids: [8],
      restored: true,
      already_reverted: false,
    });
    useApiMock.mockReturnValue({
      data: {
        items: [
          {
            ...item,
            review_status: "accepted",
            cluster_applied_item_ids: [8],
            result_json: {
              operation: "cluster",
              cluster_type: "release",
              confidence: 0.88,
              rationale: "Both items concern the same album campaign.",
              members: [
                {
                  item_id: 7,
                  role: "representative",
                  reason: "The announcement introduces the release.",
                  title: "Tour announcement",
                  source_kind: "artist_site",
                },
                {
                  item_id: 8,
                  role: "related",
                  reason: "The pre-order covers the same album.",
                  title: "Album pre-order",
                  source_kind: "label",
                },
              ],
            },
          },
        ],
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    render(
      <MemoryRouter>
        <FeedReview />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "View review" }));
    await user.click(
      screen.getByRole("button", { name: "Restore related items" }),
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/external-feeds/enrichments/19/revert-cluster",
        "POST",
      );
    });
    expect(refetchMock).toHaveBeenCalled();
  });

  it("renders extracted show proposals in the review modal", async () => {
    const user = userEvent.setup();
    useApiMock.mockReturnValue({
      data: {
        items: [
          {
            ...item,
            result_json: {
              operation: "extract_show",
              shows: [
                {
                  event_date: "2026-10-18",
                  local_time: "20:00",
                  venue: "The Roundhouse",
                  city: "London",
                  country: "United Kingdom",
                  country_code: "GB",
                  confidence: 0.91,
                  evidence: "The artist will play London on 18 October 2026.",
                  tickets_url: "https://tickets.example/london",
                },
              ],
              warnings: [],
            },
          },
        ],
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    render(
      <MemoryRouter>
        <FeedReview />
      </MemoryRouter>,
    );

    expect(screen.getByText("1 show extracted for review")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review proposal" }));
    expect(screen.getByText("The Roundhouse")).toBeInTheDocument();
    expect(screen.getByText(/Oct 18, 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tickets" })).toHaveAttribute(
      "href",
      "https://tickets.example/london",
    );
  });

  it("applies an accepted show proposal to the catalogue", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue({
      enrichment_id: 19,
      show_ids: [101],
      applied: true,
      already_applied: false,
    });
    useApiMock.mockReturnValue({
      data: {
        items: [
          {
            ...item,
            review_status: "accepted",
            result_json: {
              operation: "extract_show",
              shows: [
                {
                  event_date: "2026-10-18",
                  venue: "The Roundhouse",
                  city: "London",
                  confidence: 0.91,
                  evidence: "The artist will play London on 18 October 2026.",
                },
              ],
            },
            applied_show_ids: [],
          },
        ],
      },
      loading: false,
      error: null,
      refetch: refetchMock,
    });

    render(
      <MemoryRouter>
        <FeedReview />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "View review" }));
    await user.click(
      screen.getByRole("button", { name: "Add shows to catalogue" }),
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/external-feeds/enrichments/19/apply-shows",
        "POST",
      );
    });
    expect(refetchMock).toHaveBeenCalled();
  });
});
