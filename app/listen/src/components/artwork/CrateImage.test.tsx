import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedArtworkCandidate } from "@/lib/artwork-manager";
import type { ArtworkSource } from "@/lib/artwork-source";

const managerMocks = vi.hoisted(() => ({
  preloadArtwork: vi.fn(),
  preloadResolvedArtwork: vi.fn(),
  refreshArtworkCandidate: vi.fn(),
  resolveArtworkCandidate: vi.fn(),
}));
const versions = vi.hoisted(() => ({
  requiresTicket: true,
  resume: 0,
  tickets: 1,
}));

vi.mock("@/lib/artwork-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/artwork-manager")>();
  return { ...actual, ...managerMocks };
});

vi.mock("@/hooks/use-media-access-version", () => ({
  useMediaAccessResumeVersion: () => versions.resume,
  useMediaAccessVersion: () => versions.tickets,
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requiresMediaAccessTicket: (value: string | null | undefined) =>
    versions.requiresTicket && Boolean(value?.startsWith("/api/")),
}));

import { CrateImage } from "./CrateImage";

function source(
  logicalKey: string,
  revision: string,
  retryPolicy: ArtworkSource["retryPolicy"] = "credentials",
): ArtworkSource {
  return {
    kind: "artist-photo",
    logicalKey,
    retryPolicy,
    src: `/api/artists/${logicalKey}/photo?v=${revision}`,
  };
}

function candidate(value: ArtworkSource): ResolvedArtworkCandidate {
  return {
    logicalKey: value.logicalKey,
    contentKey: `${value.logicalKey}:${value.src}`,
    src: `${value.src}&media_ticket=${versions.tickets}`,
    sizes: value.sizes,
  };
}

describe("CrateImage", () => {
  beforeEach(() => {
    versions.resume = 0;
    versions.requiresTicket = true;
    versions.tickets = 1;
    managerMocks.preloadArtwork.mockReset();
    managerMocks.preloadResolvedArtwork.mockReset();
    managerMocks.refreshArtworkCandidate.mockReset();
    managerMocks.resolveArtworkCandidate.mockReset();
    managerMocks.resolveArtworkCandidate.mockImplementation(candidate);
    managerMocks.preloadArtwork.mockImplementation(
      async (value: ArtworkSource) => candidate(value),
    );
    managerMocks.preloadResolvedArtwork.mockImplementation(
      async (value: ResolvedArtworkCandidate) => value,
    );
    managerMocks.refreshArtworkCandidate.mockImplementation(
      async (value: ArtworkSource) => candidate(value),
    );
  });

  it("renders a logical artwork source", () => {
    render(<CrateImage source={source("high-vis", "one")} alt="High Vis" />);

    expect(screen.getByRole("img", { name: "High Vis" })).toHaveAttribute(
      "src",
      "/api/artists/high-vis/photo?v=one&media_ticket=1",
    );
  });

  it("does not mutate the DOM when only credentials rotate", () => {
    const artwork = source("high-vis", "one");
    const { rerender } = render(<CrateImage source={artwork} alt="High Vis" />);
    fireEvent.load(screen.getByRole("img", { name: "High Vis" }));

    versions.tickets = 2;
    rerender(<CrateImage source={artwork} alt="High Vis" />);

    expect(screen.getByRole("img", { name: "High Vis" })).toHaveAttribute(
      "src",
      "/api/artists/high-vis/photo?v=one&media_ticket=1",
    );
  });

  it("updates responsive sizes without replacing the visible bitmap", () => {
    const artwork = { ...source("high-vis", "one"), sizes: "100px" };
    const { rerender } = render(<CrateImage source={artwork} alt="High Vis" />);
    const image = screen.getByRole("img", { name: "High Vis" });
    fireEvent.load(image);

    rerender(
      <CrateImage source={{ ...artwork, sizes: "200px" }} alt="High Vis" />,
    );

    expect(image).toHaveAttribute("sizes", "200px");
    expect(managerMocks.preloadArtwork).not.toHaveBeenCalled();
  });

  it("decodes a new revision before swapping a visible bitmap", async () => {
    let release: ((value: ResolvedArtworkCandidate) => void) | undefined;
    managerMocks.preloadArtwork.mockImplementation(
      () =>
        new Promise<ResolvedArtworkCandidate>((resolve) => {
          release = resolve;
        }),
    );
    const { rerender } = render(
      <CrateImage source={source("high-vis", "one")} alt="High Vis" />,
    );
    fireEvent.load(screen.getByRole("img", { name: "High Vis" }));

    const next = source("high-vis", "two");
    rerender(<CrateImage source={next} alt="High Vis" />);

    expect(screen.getByRole("img", { name: "High Vis" })).toHaveAttribute(
      "src",
      "/api/artists/high-vis/photo?v=one&media_ticket=1",
    );

    release?.(candidate(next));
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "High Vis" })).toHaveAttribute(
        "src",
        "/api/artists/high-vis/photo?v=two&media_ticket=1",
      ),
    );
  });

  it("clears a previous entity immediately instead of showing stale art", () => {
    const { rerender } = render(
      <CrateImage source={source("high-vis", "one")} alt="Artist" />,
    );
    fireEvent.load(screen.getByRole("img", { name: "Artist" }));

    rerender(<CrateImage source={source("converge", "one")} alt="Artist" />);

    expect(screen.getByRole("img", { name: "Artist" })).toHaveAttribute(
      "src",
      "/api/artists/converge/photo?v=one&media_ticket=1",
    );
    expect(managerMocks.preloadArtwork).not.toHaveBeenCalled();
  });

  it("keeps the visible bitmap until resume credentials decode", async () => {
    let release: ((value: ResolvedArtworkCandidate) => void) | undefined;
    managerMocks.preloadResolvedArtwork.mockImplementation(
      () =>
        new Promise<ResolvedArtworkCandidate>((resolve) => {
          release = resolve;
        }),
    );
    const artwork = source("high-vis", "one");
    const { rerender } = render(<CrateImage source={artwork} alt="High Vis" />);
    fireEvent.load(screen.getByRole("img", { name: "High Vis" }));

    versions.resume = 1;
    rerender(<CrateImage source={artwork} alt="High Vis" />);

    await waitFor(() =>
      expect(managerMocks.refreshArtworkCandidate).toHaveBeenCalledWith(
        artwork,
      ),
    );
    expect(screen.getByRole("img", { name: "High Vis" })).toHaveAttribute(
      "src",
      "/api/artists/high-vis/photo?v=one&media_ticket=1",
    );

    const refreshed = {
      ...candidate(artwork),
      src: `${artwork.src}&media_ticket=fresh`,
    };
    release?.(refreshed);
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "High Vis" })).toHaveAttribute(
        "src",
        "/api/artists/high-vis/photo?v=one&media_ticket=fresh",
      ),
    );
  });

  it("does not preload lazy artwork outside the viewport on resume", async () => {
    const artwork = source("high-vis", "one");
    const { rerender } = render(
      <CrateImage source={artwork} alt="High Vis" loading="lazy" />,
    );
    const image = screen.getByRole("img", { name: "High Vis" });
    fireEvent.load(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      bottom: 2_100,
      height: 100,
      left: 0,
      right: 100,
      top: 2_000,
      width: 100,
      x: 0,
      y: 2_000,
      toJSON: () => ({}),
    });

    versions.resume = 1;
    rerender(<CrateImage source={artwork} alt="High Vis" loading="lazy" />);
    await Promise.resolve();

    expect(managerMocks.refreshArtworkCandidate).not.toHaveBeenCalled();
  });

  it("refreshes lazy artwork that is visible when the app resumes", async () => {
    const artwork = source("high-vis", "one");
    const { rerender } = render(
      <CrateImage source={artwork} alt="High Vis" loading="lazy" />,
    );
    const image = screen.getByRole("img", { name: "High Vis" });
    fireEvent.load(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    versions.resume = 1;
    rerender(<CrateImage source={artwork} alt="High Vis" loading="lazy" />);

    await waitFor(() =>
      expect(managerMocks.refreshArtworkCandidate).toHaveBeenCalledWith(
        artwork,
      ),
    );
  });

  it("recovers a terminal placeholder when the app resumes", async () => {
    const artwork = source("high-vis", "one");
    const { rerender } = render(<CrateImage source={artwork} alt="High Vis" />);
    const image = screen.getByRole("img", { name: "High Vis" });
    fireEvent.load(image);
    fireEvent.error(image);
    await waitFor(() =>
      expect(managerMocks.refreshArtworkCandidate).toHaveBeenCalledOnce(),
    );
    fireEvent.error(image);
    expect(image).toHaveAttribute("data-artwork-state", "loading");

    managerMocks.refreshArtworkCandidate.mockClear();
    const refreshed = {
      ...candidate(artwork),
      src: `${artwork.src}&media_ticket=restored`,
    };
    managerMocks.refreshArtworkCandidate.mockResolvedValue(refreshed);
    versions.resume = 1;
    rerender(<CrateImage source={artwork} alt="High Vis" />);

    await waitFor(() =>
      expect(image).toHaveAttribute(
        "src",
        "/api/artists/high-vis/photo?v=one&media_ticket=restored",
      ),
    );
    fireEvent.load(image);
    expect(image).toHaveAttribute("data-artwork-state", "ready");
  });

  it("performs one bounded recovery before surfacing an error", async () => {
    const onError = vi.fn();
    const artwork = source("high-vis", "one");
    render(<CrateImage source={artwork} alt="High Vis" onError={onError} />);

    fireEvent.error(screen.getByRole("img", { name: "High Vis" }));
    await waitFor(() =>
      expect(managerMocks.refreshArtworkCandidate).toHaveBeenCalledOnce(),
    );
    expect(onError).not.toHaveBeenCalled();

    fireEvent.error(screen.getByRole("img", { name: "High Vis" }));
    expect(onError).toHaveBeenCalledOnce();
  });

  it("cache-busts one transient web failure without dropping ready art", async () => {
    versions.requiresTicket = false;
    const artwork = source("high-vis", "one");
    render(<CrateImage source={artwork} alt="High Vis" />);
    fireEvent.load(screen.getByRole("img", { name: "High Vis" }));

    fireEvent.error(screen.getByRole("img", { name: "High Vis" }));

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "High Vis" })).toHaveAttribute(
        "src",
        "/api/artists/high-vis/photo?v=one&media_ticket=1&retry=1",
      ),
    );
    expect(screen.getByRole("img", { name: "High Vis" })).toHaveAttribute(
      "data-artwork-state",
      "ready",
    );
  });

  it("marks terminal failures as loading so surfaces reveal their fallback", () => {
    const onError = vi.fn();
    const artwork = source("external", "one", "none");
    render(
      <CrateImage source={artwork} alt="External artist" onError={onError} />,
    );
    fireEvent.load(screen.getByRole("img", { name: "External artist" }));

    fireEvent.error(screen.getByRole("img", { name: "External artist" }));

    expect(
      screen.getByRole("img", { name: "External artist" }),
    ).toHaveAttribute("data-artwork-state", "loading");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("discards a late recovery after the logical entity changes", async () => {
    let release: ((value: ResolvedArtworkCandidate | null) => void) | undefined;
    managerMocks.refreshArtworkCandidate.mockImplementation(
      () =>
        new Promise<ResolvedArtworkCandidate | null>((resolve) => {
          release = resolve;
        }),
    );
    const highVis = source("high-vis", "one");
    const converge = source("converge", "one");
    const { rerender } = render(<CrateImage source={highVis} alt="Artist" />);

    fireEvent.error(screen.getByRole("img", { name: "Artist" }));
    rerender(<CrateImage source={converge} alt="Artist" />);
    fireEvent.load(screen.getByRole("img", { name: "Artist" }));
    await act(async () => {
      release?.(candidate(highVis));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("img", { name: "Artist" })).toHaveAttribute(
      "src",
      "/api/artists/converge/photo?v=one&media_ticket=1",
    );
    expect(screen.getByRole("img", { name: "Artist" })).toHaveAttribute(
      "data-artwork-state",
      "ready",
    );
  });
});
