import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useApi: vi.fn(),
  detail: null as unknown,
  error: null as unknown,
}));

vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, getApiBase: vi.fn(() => "") };
});

import { Crate } from "@/pages/Crate";
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

function renderCrate() {
  return renderWithListenProviders(<Crate />, {
    path: "/crate/:crateId",
    route: `/crate/${crateId}`,
  });
}

describe("Crate page", () => {
  beforeEach(() => {
    mocks.detail = crate();
    mocks.error = null;
    mocks.useApi.mockImplementation(() => ({
      data: mocks.detail,
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

  it("offers editing only to owners and collaborators", () => {
    mocks.detail = crate("collaborator");
    renderCrate();
    expect(screen.getByRole("button", { name: "Edit Crate" })).toBeVisible();
  });

  it("does not reveal metadata when a private crate is inaccessible", () => {
    mocks.detail = null;
    mocks.error = new Error("not found");
    renderCrate();
    expect(screen.getByText("This Crate is unavailable.")).toBeVisible();
    expect(screen.queryByText("Year-end records")).not.toBeInTheDocument();
  });
});
