import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useApi: vi.fn(),
  detail: null as unknown,
  error: null as unknown,
  playback: [] as unknown,
  shuffleArray: vi.fn((tracks: unknown[]) => [...tracks].reverse()),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi }));

vi.mock("@/lib/utils", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
  return { ...actual, shuffleArray: mocks.shuffleArray };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, getApiBase: vi.fn(() => "") };
});

import { Crate } from "@/pages/Crate";
import type { PlayerActionsValue } from "@/contexts/player-context";
import { SHARE_REQUEST_EVENT, type SharePayload } from "@/lib/social-share";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const crateId = "77777777-7777-4777-8777-777777777777";

function crate(access: "public" | "owner" | "collaborator" = "public") {
  return {
    id: crateId,
    owner_id: 7,
    owner_username: "jane",
    owner_name: "Jane Doe",
    name: "Year-end records",
    description: "Our favorite albums this year.",
    visibility: "public" as const,
    is_collaborative: true,
    access,
    album_count: 2,
    first_album: null,
    albums: [
      {
        global_album_uid: "11111111-1111-4111-8111-111111111111",
        position: 0,
        name: "Blending",
        artist_name: "High Vis",
        year: "2022",
        has_cover: true,
      },
      {
        global_album_uid: "22222222-2222-4222-8222-222222222222",
        position: 1,
        name: "A Light for Attracting Attention",
        artist_name: "The Smile",
        year: "2022",
        has_cover: false,
      },
    ],
  };
}

function renderCrate(playerActions?: Partial<PlayerActionsValue>) {
  return renderWithListenProviders(<Crate />, {
    path: "/crate/:crateId",
    route: `/crate/${crateId}`,
    playerActions,
  });
}

describe("Crate page", () => {
  beforeEach(() => {
    mocks.detail = crate();
    mocks.error = null;
    mocks.playback = [
      {
        global_track_uid: "33333333-3333-4333-8333-333333333333",
        global_album_uid: "11111111-1111-4111-8111-111111111111",
        title: "Track One",
        artist: "High Vis",
        album: "Blending",
        duration: 181,
      },
      {
        global_track_uid: "44444444-4444-4444-8444-444444444444",
        global_album_uid: "22222222-2222-4222-8222-222222222222",
        title: "Track Two",
        artist: "The Smile",
        album: "A Light for Attracting Attention",
        duration: 212,
      },
    ];
    mocks.shuffleArray.mockClear();
    mocks.useApi.mockImplementation((path: string | null) => ({
      data: path?.endsWith("/playback") ? mocks.playback : mocks.detail,
      loading: false,
      error: mocks.error,
      refetch: vi.fn(),
    }));
  });

  it("renders ordered albums and shares the canonical social-preview link", async () => {
    const user = userEvent.setup();
    const shareRequest = vi.fn();
    window.addEventListener(SHARE_REQUEST_EVENT, shareRequest);

    renderCrate();

    expect(
      screen.getByRole("heading", { name: "Year-end records" }),
    ).toBeVisible();
    expect(screen.getByText("A crate by Jane Doe")).toBeVisible();
    expect(screen.getByText("Blending")).toBeVisible();
    expect(screen.getByText("A Light for Attracting Attention")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Edit Crate" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Share Crate" }));

    expect(shareRequest).toHaveBeenCalledOnce();
    const payload = (
      shareRequest.mock.calls[0]![0] as CustomEvent<SharePayload>
    ).detail;
    expect(payload.kind).toBe("crate");
    expect(payload.url).toContain(`/share/crate/${crateId}`);
    window.removeEventListener(SHARE_REQUEST_EVENT, shareRequest);
  });

  it("offers editing only to owners and collaborators", async () => {
    mocks.detail = crate("collaborator");
    renderCrate();
    expect(
      await screen.findByRole("button", { name: "Edit Crate" }),
    ).toBeVisible();
  });

  it("plays the flattened tracks in order with a Crate source and deep link", async () => {
    const user = userEvent.setup();
    const playAll = vi.fn();
    renderCrate({ playAll });

    await user.click(screen.getByRole("button", { name: "Play" }));

    const [tracks, startIndex, source] = playAll.mock.calls[0]!;
    expect(tracks.map((track: { title: string }) => track.title)).toEqual([
      "Track One",
      "Track Two",
    ]);
    expect(startIndex).toBe(0);
    expect(source).toEqual({
      type: "crate",
      name: "Year-end records",
      id: crateId,
      href: `/crate/${crateId}`,
    });
  });

  it("shuffles the flattened tracks before starting playback", async () => {
    const user = userEvent.setup();
    const playAll = vi.fn();
    renderCrate({ playAll });

    await user.click(screen.getByRole("button", { name: "Shuffle" }));

    const [tracks, startIndex, source] = playAll.mock.calls[0]!;
    expect(mocks.shuffleArray).toHaveBeenCalledOnce();
    expect(tracks.map((track: { title: string }) => track.title)).toEqual([
      "Track Two",
      "Track One",
    ]);
    expect(startIndex).toBe(0);
    expect(source).toMatchObject({ type: "crate", href: `/crate/${crateId}` });
  });

  it("disables playback controls when the Crate has no playable tracks", async () => {
    mocks.playback = [];
    renderCrate();

    expect(await screen.findByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeDisabled();
  });

  it("does not reveal metadata when a private crate is inaccessible", async () => {
    mocks.detail = null;
    mocks.error = new Error("not found");
    renderCrate();
    expect(await screen.findByText("This Crate is unavailable.")).toBeVisible();
    expect(screen.queryByText("Year-end records")).not.toBeInTheDocument();
  });
});
