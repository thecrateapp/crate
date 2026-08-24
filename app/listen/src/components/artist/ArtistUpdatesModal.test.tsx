import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { useApi } from "@/hooks/use-api";

import { ArtistUpdatesModal } from "./ArtistUpdatesModal";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

const mockUseApi = vi.mocked(useApi);

describe("ArtistUpdatesModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads on demand and renders source, summary, and original link", () => {
    mockUseApi.mockReturnValue({
      data: [
        {
          type: "news",
          source: "publisher_rss",
          source_detail: "Pitchfork",
          canonical_url: "https://pitchfork.com/news/artist",
          published_at: "2026-08-23T12:00:00Z",
          title: "Artist announces a new record",
          excerpt: "The source excerpt.",
          editorial_summary: "The accepted consolidated summary.",
        },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <ArtistUpdatesModal
        open
        artistName="Artist Updates Target"
        artistId={7}
        onClose={() => {}}
      />,
    );

    expect(mockUseApi).toHaveBeenCalledWith("/api/artists/7/updates");
    expect(
      screen.getByText("Artist announces a new record"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The accepted consolidated summary."),
    ).toBeInTheDocument();
    expect(screen.getByText("Pitchfork")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open original source" }),
    ).toHaveAttribute("href", "https://pitchfork.com/news/artist");
  });

  it("renders a useful empty state", () => {
    mockUseApi.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(
      <ArtistUpdatesModal
        open
        artistName="No News"
        artistId={8}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("No updates yet")).toBeInTheDocument();
  });
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <I18nProvider initialLocale="en">{ui}</I18nProvider>
    </MemoryRouter>,
  );
}
