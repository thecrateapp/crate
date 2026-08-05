import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtistArtworkGallery } from "./ArtistArtworkGallery";

vi.mock("@/lib/tasks", () => ({
  waitForTask: vi.fn(async () => ({ status: "completed" })),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const asset = {
  id: 41,
  artist_id: 7,
  origin: "manual-upload",
  label: "Press photo",
  mime_type: "image/jpeg",
  width: 1800,
  height: 1200,
  checksum: "a".repeat(64),
  slots: ["avatar"],
  preview_url: "/api/artwork/artists/7/assets/41/preview",
  created_at: "2026-08-01T12:00:00+00:00",
};

describe("ArtistArtworkGallery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows curated assets and assigns one to any artwork slot", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "assign-1" });
        }
        return Response.json({ assets: [asset] });
      }),
    );
    const onChanged = vi.fn();

    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={onChanged}
      />,
    );

    expect(await screen.findByText("Press photo")).toBeVisible();
    expect(screen.getByText("Avatar")).toBeVisible();
    expect(screen.getByText("1800 × 1200")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Use Press photo as background",
      }),
    );

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const assignment = requests.find((request) =>
      request.url.endsWith("/slots/background"),
    );
    expect(assignment?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ asset_id: 41 }),
    });
    expect(
      screen.queryByRole("button", { name: "Delete Press photo" }),
    ).not.toBeInTheDocument();
  });

  it("deletes an unassigned asset after confirmation", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let listed = true;
    const unassignedAsset = { ...asset, slots: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "DELETE") {
          listed = false;
          return Response.json({ status: "queued", task_id: "delete-1" });
        }
        return Response.json({ assets: listed ? [unassignedAsset] : [] });
      }),
    );

    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={() => undefined}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Delete Press photo" }),
    );
    expect(screen.getByText("Delete Press photo?")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Delete image" }));

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url.endsWith("/assets/41") &&
            request.init?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });

  it("adds an upload to the gallery without assigning it implicitly", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "import-1" });
        }
        return Response.json({ assets: [] });
      }),
    );

    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={() => undefined}
      />,
    );

    await userEvent.upload(
      screen.getByLabelText("Add image to gallery"),
      new File(["image"], "press.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url.endsWith("/assets/upload") &&
            request.init?.method === "POST" &&
            request.init.body instanceof FormData,
        ),
      ).toBe(true),
    );
  });

  it("discovers, analyzes and imports trusted candidates", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/hero-candidates/analyze")) {
          return Response.json({
            summary: "Strong editorial fit with useful negative space.",
            desktop: {
              score: 92,
              reason: "Faces remain clear.",
              focal_x: 0.7,
              focal_y: 0.4,
            },
            mobile: {
              score: 76,
              reason: "Needs a tighter crop.",
              focal_x: 0.5,
              focal_y: 0.35,
            },
          });
        }
        if (url.endsWith("/assets/import-candidate")) {
          return Response.json({ status: "queued", task_id: "candidate-1" });
        }
        if (url.endsWith("/hero-candidates")) {
          return Response.json({
            candidates: [
              {
                id: "signed-candidate",
                origin: "fanart-background",
                label: "Fanart background",
                preview_url: "/candidate.jpg",
                width: 2400,
                height: 1200,
                desktop: {
                  score: 90,
                  label: "excellent",
                  reason: "Wide image.",
                },
                mobile: { score: 60, label: "poor", reason: "Wide crop." },
              },
            ],
          });
        }
        return Response.json({ assets: [] });
      }),
    );

    render(
      <ArtistArtworkGallery
        artistId={7}
        artistName="Converge"
        canEdit
        onChanged={() => undefined}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Find image candidates" }),
    );
    expect(await screen.findByText("Fanart background")).toBeVisible();
    expect(screen.getByText("Desktop 90")).toBeVisible();
    expect(screen.getByText("Mobile 60")).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Analyze Fanart background" }),
    );
    expect(
      await screen.findByText(
        "Strong editorial fit with useful negative space.",
      ),
    ).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Add Fanart background to gallery",
      }),
    );
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url.endsWith("/assets/import-candidate") &&
            request.init?.body ===
              JSON.stringify({
                candidate: "signed-candidate",
                label: "Fanart background",
              }),
        ),
      ).toBe(true),
    );
  });
});
