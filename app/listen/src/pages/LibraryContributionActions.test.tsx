import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { LibraryContributionsTab } from "./LibraryContributionsTab";
import { api } from "@/lib/api";
import { openExternalUrl } from "@/lib/external-links";
import { notify } from "@crate/ui/lib/notify";
vi.mock("@crate/ui/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: () => false,
    toggleAlbumSaved: vi.fn().mockResolvedValue(true),
  }),
}));
const state = vi.hoisted(() => ({
  refetch: vi.fn(),
  albumId: 5 as number | null,
  source: "upload",
}));
vi.mock("@/hooks/use-api", () => ({
  useApi: (url: string | null) => ({
    data:
      url === null
        ? null
        : {
            items: [
              {
                id: 7,
                album_id: state.albumId,
                album_name: "Evening Music",
                artist_name: "Mixed Case Artist",
                source: state.source,
              },
            ],
          },
    loading: false,
    error: null,
    refetch: state.refetch,
  }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));
vi.mock("@/lib/external-links", () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.albumId = 5;
  state.source = "upload";
  vi.mocked(api).mockResolvedValue({ task_id: "task-7" });
});
it("keeps withdrawal in the card menu but prevents album navigation, playback and export while unavailable", async () => {
  state.albumId = null;
  renderWithListenProviders(<LibraryContributionsTab />, { locale: "en" });
  expect(
    screen.queryByRole("link", { name: /Evening Music/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  expect(
    screen.queryByRole("menuitem", { name: "Play album" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole("menuitem", { name: "Export" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("menuitem", { name: "Remove contribution" }),
  ).toBeEnabled();
});
it("opens an available contribution as an album and exposes its normal lazy album menu", async () => {
  const playAll = vi.fn();
  renderWithListenProviders(<LibraryContributionsTab />, {
    locale: "en",
    playerActions: { playAll },
  });
  expect(screen.getByRole("link", { name: /Evening Music/ })).toHaveAttribute(
    "href",
    "/artists/mixed-case-artist/evening-music",
  );
  const grid = screen.getByRole("group", { name: "Contributions" });
  expect(grid).toHaveAttribute("data-slot", "media-grid");
  expect(grid).toHaveAttribute("data-density", "default");
  expect(grid.querySelector('[data-slot="entity-card"]')).toHaveAttribute(
    "data-layout",
    "grid",
  );
  expect(grid.querySelector('[data-slot="entity-row"]')).toBeNull();
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  const play = await screen.findByRole("menuitem", { name: "Play album" });
  expect(api).not.toHaveBeenCalled();
  vi.mocked(api).mockResolvedValueOnce({
    artist: "Mixed Case Artist",
    name: "Evening Music",
    tracks: [
      {
        id: 1,
        filename: "First.flac",
        length_sec: 75,
        tags: { title: "First" },
      },
    ],
  });
  fireEvent.click(play);
  await waitFor(() =>
    expect(playAll).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: "First" })]),
      0,
      expect.objectContaining({ type: "album" }),
    ),
  );
});
it("plays through the canonical album overlay while preserving its album source", async () => {
  const playAll = vi.fn();
  renderWithListenProviders(<LibraryContributionsTab />, {
    locale: "en",
    playerActions: { playAll },
  });
  vi.mocked(api).mockResolvedValueOnce({
    artist: "Mixed Case Artist",
    name: "Evening Music",
    tracks: [
      {
        id: 1,
        filename: "First.flac",
        length_sec: 75,
        tags: { title: "First" },
      },
    ],
  });
  fireEvent.click(screen.getByRole("button", { name: "Play Evening Music" }));
  await waitFor(() =>
    expect(playAll).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ title: "First", album: "Evening Music" }),
      ]),
      0,
      expect.objectContaining({
        type: "album",
        href: "/artists/mixed-case-artist/evening-music",
      }),
    ),
  );
});
it("exports through the authenticated existing helper without withdrawing", async () => {
  renderWithListenProviders(<LibraryContributionsTab />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Export" }));
  await waitFor(() =>
    expect(openExternalUrl).toHaveBeenCalledWith(
      expect.stringContaining("/api/me/contributions/7/export"),
    ),
  );
  expect(api).not.toHaveBeenCalled();
});
it("retains cancel and explicit confirmation before sending a withdrawal", async () => {
  renderWithListenProviders(<LibraryContributionsTab />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Remove contribution" }),
  );
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Remove contribution" }),
  );
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Remove contribution" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/me/contributions/7/withdraw",
      "POST",
    ),
  );
  await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledOnce();
});

it.each([
  ["en", "Removing your contribution of Evening Music. You can keep browsing."],
  [
    "es",
    "Estamos retirando tu aportación de Evening Music. Puedes seguir navegando.",
  ],
] as const)(
  "uses a friendly withdrawal toast in %s without exposing the task ID",
  async (locale, expected) => {
    renderWithListenProviders(<LibraryContributionsTab />, { locale });
    fireEvent.click(
      screen.getByRole("button", {
        name: locale === "es" ? "Más acciones" : "More actions",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: locale === "es" ? "Quitar contribución" : "Remove contribution",
      }),
    );
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: locale === "es" ? "Quitar contribución" : "Remove contribution",
      }),
    );
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith(expected));
    expect(JSON.stringify(vi.mocked(notify.success).mock.calls)).not.toContain(
      "task-7",
    );
  },
);
it("keeps the confirmation open and shows a friendly failure instead of a technical task error", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Task task-7 failed"));
  renderWithListenProviders(<LibraryContributionsTab />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Remove contribution" }),
  );
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Remove contribution",
    }),
  );
  await waitFor(() =>
    expect(notify.error).toHaveBeenCalledWith("Failed to remove contribution"),
  );
  expect(screen.getByRole("alertdialog")).toBeVisible();
  expect(state.refetch).not.toHaveBeenCalled();
});

it.each([
  ["upload", "upload", "text-text-subtle"],
  ["bandcamp", "Bandcamp", "text-accent-action-hi"],
])(
  "presents the %s source as an uppercase MonoLabel with a small decorative icon",
  (source, label, colorClass) => {
    state.source = source;
    renderWithListenProviders(<LibraryContributionsTab />, { locale: "en" });
    const caption = screen.getByText(label, { exact: true });
    expect(caption).toHaveClass("crate-mono-label", "uppercase", colorClass);
    expect(caption.closest('[data-slot="info-badge"]')).toBeNull();
    const icon = caption.querySelector("svg");
    expect(icon).toHaveAttribute("width", "12");
    expect(icon).toHaveAttribute("height", "12");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  },
);
