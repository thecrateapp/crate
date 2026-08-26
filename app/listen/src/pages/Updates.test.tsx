import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { Updates } from "./Updates";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

const mockUseApi = vi.mocked(useApi);

describe("Updates page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders global editorial items", () => {
    mockUseApi.mockReturnValue({
      data: [
        {
          type: "news",
          source_detail: "Pitchfork",
          title: "A global music update",
          canonical_url: "https://example.test/news",
          published_at: "2026-08-23T12:00:00Z",
          excerpt: "A short excerpt.",
        },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<Updates />);

    expect(mockUseApi).toHaveBeenCalledWith("/api/me/updates");
    expect(
      screen.getByRole("heading", { level: 1, name: "Updates" }),
    ).toBeInTheDocument();
    expect(screen.getByText("A global music update")).toBeInTheDocument();
    expect(screen.getByText("Pitchfork")).toBeInTheDocument();
  });

  it("renders an empty state when no editorial items are available", () => {
    mockUseApi.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<Updates />);

    expect(screen.getByText("No updates yet")).toBeInTheDocument();
  });
});
