import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildInstagramStoryBlob: vi.fn(),
  buildSquarePostCard: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isNative: false,
}));

vi.mock("@/lib/external-links", () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("@/lib/social-share-story-builder", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/social-share-story-builder")
  >("@/lib/social-share-story-builder");
  return {
    ...actual,
    buildInstagramStoryBlob: mocks.buildInstagramStoryBlob,
    buildSquarePostCard: mocks.buildSquarePostCard,
  };
});

vi.mock("@crate/ui/lib/notify", () => ({
  notify: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { ShareSheetHost } from "@/components/share/ShareSheet";
import { openShareSheet, type SharePayload } from "@/lib/social-share";
import { openExternalUrl } from "@/lib/external-links";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const cratePayload: SharePayload = {
  kind: "crate",
  title: "Year-end records",
  subtitle: "Jane Doe",
  crateOwnerName: "Jane Doe",
  url: "https://listen.example/share/crate/77777777-7777-4777-8777-777777777777",
  crateIsOrdered: true,
  crateTrackCount: 18,
  crateAlbums: [
    { imageUrl: null, name: "Blending", artistName: "High Vis", position: 0 },
    {
      imageUrl: null,
      name: "Wall of Eyes",
      artistName: "The Smile",
      position: 1,
    },
  ],
};

function openPayload(payload: SharePayload) {
  act(() => {
    openShareSheet(payload);
  });
}

describe("ShareSheetHost", () => {
  const originalShare = navigator.share;
  const originalCanShare = navigator.canShare;

  beforeEach(() => {
    window.localStorage.clear();
    mocks.buildInstagramStoryBlob.mockResolvedValue(
      new Blob(["story"], { type: "image/jpeg" }),
    );
    mocks.buildSquarePostCard.mockResolvedValue(
      new Blob(["post"], { type: "image/jpeg" }),
    );
  });

  afterEach(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: originalShare,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: originalCanShare,
    });
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("opens Crate's share sheet instead of the native share dialog", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<ShareSheetHost />);

    openPayload({
      kind: "album",
      title: "Jane Doe",
      subtitle: "Converge",
      url: "https://listen.example/share/album/1/jane-doe",
    });

    expect(await screen.findByText("Share album")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
    expect(screen.getByText("Instagram Story")).toBeInTheDocument();
    expect(screen.getByText("Square post")).toBeInTheDocument();
    expect(screen.getByText("C").parentElement).toHaveClass(
      "shadow-share-preview",
    );
    expect(
      screen.getByText("WhatsApp").closest("button")?.querySelector("span"),
    ).toHaveClass("shadow-share-action-icon");

    await user.click(screen.getByText("Telegram"));
    expect(openExternalUrl).toHaveBeenCalledWith(
      expect.stringContaining("https://t.me/share/url"),
    );
  });

  it("shows the link itself under copy link", async () => {
    renderWithListenProviders(<ShareSheetHost />);

    openPayload({
      kind: "album",
      title: "Jane Doe",
      subtitle: "Converge",
      url: "https://listen.example/share/album/1/jane-doe",
    });

    const copyButton = (await screen.findByText("Copy link")).closest("button");
    expect(copyButton).toHaveTextContent(
      "listen.example/share/album/1/jane-doe",
    );
    expect(copyButton).not.toHaveTextContent("Jane Doe - Converge");
  });

  it("supports Crate share previews", async () => {
    renderWithListenProviders(<ShareSheetHost />);

    openPayload(cratePayload);

    expect(await screen.findByText("Share Crate")).toBeInTheDocument();
    expect(screen.getByText("Year-end records")).toBeVisible();
  });

  it("sends localized Crate text to WhatsApp", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<ShareSheetHost />, { locale: "es" });

    openPayload(cratePayload);
    await user.click(await screen.findByText("WhatsApp"));

    const target = vi.mocked(openExternalUrl).mock.calls[0]?.[0] ?? "";
    expect(decodeURIComponent(target.split("text=")[1] ?? "")).toBe(
      `«Year-end records» — Crate de Jane Doe · 2 álbumes\n${cratePayload.url}`,
    );
  });

  it("shares the story image as a file through the Web Share API", async () => {
    const user = userEvent.setup();
    const share = vi.fn(async () => undefined);
    const canShare = vi.fn(() => true);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: canShare,
    });
    renderWithListenProviders(<ShareSheetHost />);

    openPayload(cratePayload);
    await user.click(await screen.findByText("Instagram Story"));
    await user.click(await screen.findByText("Wall"));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [shareData] = share.mock.calls[0] as unknown as [ShareData];
    expect(shareData.files?.[0]).toBeInstanceOf(File);
    expect(shareData.files?.[0]?.name).toBe("crate-year-end-records-story.jpg");
    expect(mocks.buildInstagramStoryBlob).toHaveBeenCalledWith(
      { ...cratePayload, crateStoryStyle: "bento" },
      expect.objectContaining({
        subtitle: "A selected Crate by Jane Doe",
        metadata: "2 albums · 18 tracks",
        kicker: "Ranked",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Share Crate")).not.toBeInTheDocument(),
    );
  });

  it("asks for a story style before sharing a Crate and remembers it", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: vi.fn(() => true),
    });
    renderWithListenProviders(<ShareSheetHost />);

    openPayload(cratePayload);
    await user.click(await screen.findByText("Instagram Story"));

    expect(screen.getByText("Story style")).toBeInTheDocument();
    expect(
      ["Wall", "Podium", "Chart"].map(
        (name) => screen.getByText(name).closest("button") !== null,
      ),
    ).toEqual([true, true, true]);
    expect(screen.queryByText("WhatsApp")).not.toBeInTheDocument();

    await user.click(screen.getByText("Podium"));
    await waitFor(() =>
      expect(mocks.buildInstagramStoryBlob).toHaveBeenCalledWith(
        { ...cratePayload, crateStoryStyle: "podium" },
        expect.anything(),
      ),
    );

    openPayload(cratePayload);
    await user.click(await screen.findByText("Instagram Story"));
    const styleNames = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "")
      .filter((text) => /^(Wall|Podium|Chart)/.test(text))
      .map((text) => text.match(/^(Wall|Podium|Chart)/)?.[1]);
    expect(styleNames).toEqual(["Podium", "Wall", "Chart"]);
  });

  it("goes back from the story style step to the share options", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<ShareSheetHost />);

    openPayload(cratePayload);
    await user.click(await screen.findByText("Instagram Story"));
    await user.click(
      screen.getByRole("button", { name: "Back to share options" }),
    );

    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.queryByText("Story style")).not.toBeInTheDocument();
  });

  it("shares non-Crate stories without asking for a style", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: vi.fn(() => true),
    });
    const albumPayload: SharePayload = {
      kind: "album",
      title: "Blending",
      subtitle: "High Vis",
      url: "https://listen.example/share/album/1",
    };
    renderWithListenProviders(<ShareSheetHost />);

    openPayload(albumPayload);
    await user.click(await screen.findByText("Instagram Story"));

    await waitFor(() =>
      expect(mocks.buildInstagramStoryBlob).toHaveBeenCalledWith(
        albumPayload,
        expect.anything(),
      ),
    );
    expect(screen.queryByText("Story style")).not.toBeInTheDocument();
  });

  it("offers only the story image for a private Wrapped", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: vi.fn(() => true),
    });
    const wrappedPayload: SharePayload = {
      kind: "wrapped",
      title: "2026 on Crate",
      subtitle: "Converge, no doubt about it.",
      url: "https://listen.example/stats/wrapped?window=year%3A2026",
      wrapped: {
        kicker: "2026 on Crate",
        headline: "Converge, no doubt about it.",
        coverUrls: [],
        topArtistsLabel: "Top artists",
        topArtists: ["Converge"],
        topTracksLabel: "Top tracks",
        topTracks: ["Concubine"],
        stats: [{ value: "41,382", label: "minutes" }],
        credit: "A selected year by diego",
      },
    };
    renderWithListenProviders(<ShareSheetHost />);

    openPayload(wrappedPayload);
    const story = await screen.findByText("Instagram Story");
    expect(screen.queryByText("WhatsApp")).not.toBeInTheDocument();
    expect(screen.queryByText("Copy link")).not.toBeInTheDocument();
    expect(screen.queryByText("Square post")).not.toBeInTheDocument();
    await user.click(story);

    await waitFor(() =>
      expect(mocks.buildInstagramStoryBlob).toHaveBeenCalledWith(
        wrappedPayload,
        expect.anything(),
      ),
    );
  });

  it("downloads the square post when file sharing is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: undefined,
    });
    const createObjectURL = vi.fn(() => "blob:post");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    renderWithListenProviders(<ShareSheetHost />);

    openPayload(cratePayload);
    await user.click(await screen.findByText("Square post"));

    await waitFor(() =>
      expect(downloads).toEqual(["crate-year-end-records-post.jpg"]),
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Image downloaded");
  });

  it("shows localized errors when the image cannot be generated", async () => {
    const user = userEvent.setup();
    mocks.buildSquarePostCard.mockRejectedValue(
      new Error("Canvas is not available"),
    );
    renderWithListenProviders(<ShareSheetHost />, { locale: "es" });

    openPayload(cratePayload);
    await user.click(await screen.findByText("Post cuadrado"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "No se pudo crear la imagen para compartir",
      ),
    );
    expect(screen.getByText("Post cuadrado").closest("button")).toBeEnabled();
  });

  it("disables image actions while an image is being generated", async () => {
    const user = userEvent.setup();
    let resolveBlob: (blob: Blob) => void = () => undefined;
    mocks.buildSquarePostCard.mockReturnValue(
      new Promise<Blob>((resolve) => {
        resolveBlob = resolve;
      }),
    );
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:post"),
    });
    renderWithListenProviders(<ShareSheetHost />);

    openPayload(cratePayload);
    await user.click(await screen.findByText("Square post"));

    const squareButton = screen.getByText("Square post").closest("button");
    expect(squareButton).toBeDisabled();
    expect(squareButton).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByText("Instagram Story").closest("button"),
    ).toBeDisabled();

    await act(async () => {
      resolveBlob(new Blob(["post"], { type: "image/jpeg" }));
    });
  });

  it("localizes the share sheet chrome", async () => {
    renderWithListenProviders(<ShareSheetHost />, { locale: "es" });

    openPayload({
      kind: "album",
      title: "Jane Doe",
      subtitle: "Converge",
      url: "https://listen.example/share/album/1/jane-doe",
    });

    expect(await screen.findByText("Compartir álbum")).toBeInTheDocument();
    expect(
      screen.getByText("Enviar un enlace de Crate con vista previa"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Compartir en un chat o canal"),
    ).toBeInTheDocument();
    expect(screen.getByText("Copiar enlace")).toBeInTheDocument();
    expect(
      screen.getByText("Comparte o descarga una imagen para historias"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cerrar menú de compartir" }),
    ).toBeInTheDocument();
  });
});
