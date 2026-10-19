import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bandcamp } from "./Bandcamp";
import { api } from "@/lib/api";
import { toast } from "sonner";
import fixture from "../../../../tests/admin-e2e/fixtures/bandcamp-1ah.json";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const mockApi = vi.mocked(api);
let payloads: Record<string, unknown>;
const getPaths = Object.keys(fixture);
const actions = [
  "Sync collection",
  "Refresh Radar",
  "Backfill URLs",
  "Confirm",
  "Reject",
];
function pendingPost() {
  let finish!: (value: unknown) => void;
  mockApi.mockImplementation((path, method) =>
    method === "POST"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(structuredClone(payloads[path])),
  );
  return (value: unknown) => act(async () => finish(value));
}
async function ready() {
  render(<Bandcamp />);
  await screen.findByText("Diego de muestra");
}
beforeEach(() => {
  vi.clearAllMocks();
  payloads = structuredClone(fixture);
  mockApi.mockImplementation((path, method) =>
    Promise.resolve(
      method === "POST"
        ? { task_id: "sample-task" }
        : structuredClone(payloads[path]),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Bandcamp text presentation and real contracts", () => {
  it("uses existing display/metric recipes with only reviewed external glyphs at rest", async () => {
    await ready();
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "font-display",
    );
    expect(screen.getByText("2 pending", { exact: true })).toHaveTextContent(
      /^2 pending$/,
    );
    for (const label of ["Collection", "Wishlist", "Following", "Radar"]) {
      const metric = screen
        .getAllByText(label, { exact: true })
        .find((node) => node.closest(".crate-form-field"));
      expect(metric).toBeDefined();
      expect(metric!.parentElement).toHaveClass("crate-form-field");
    }
    expect(document.querySelectorAll("svg:not([data-admin-ux])")).toHaveLength(
      0,
    );
    expect(document.querySelectorAll("svg[data-admin-ux]")).toHaveLength(7);
    for (const glyph of document.querySelectorAll("svg"))
      expect(glyph).toHaveAttribute("aria-hidden", "true");
    for (const name of actions)
      for (const button of screen.getAllByRole("button", { name }))
        if (button.closest('[data-slot="admin-page-header"]'))
          expect(button).toHaveAttribute("data-size", "icon-lg");
        else expect(button).toHaveClass("min-h-11");
    expect(screen.getByText("12", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("92%", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("7 total", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("No debe verse")).not.toBeInTheDocument();
    expect(mockApi.mock.calls.map(([path]) => path).sort()).toEqual(
      [...getPaths].sort(),
    );
  });

  it.each([
    ["Sync collection", "/api/bandcamp/me/sync", "Bandcamp sync"],
    ["Refresh Radar", "/api/bandcamp/me/radar/refresh", "Bandcamp Radar"],
    [
      "Backfill URLs",
      "/api/bandcamp/admin/backfill-urls?limit=250&public_search=true",
      "Bandcamp URL backfill",
    ],
  ])(
    "keeps %s POST, busy locking and all eight refetches",
    async (name, path, label) => {
      await ready();
      const complete = pendingPost();
      const user = userEvent.setup();
      const button = screen.getByRole("button", { name });
      button.focus();
      await user.keyboard("{Enter}");
      expect(mockApi).toHaveBeenCalledWith(path, "POST");
      expect(button).toHaveAttribute("aria-busy", "true");
      for (const action of actions)
        for (const control of screen.getAllByRole("button", {
          name: action,
        }))
          expect(control).toBeDisabled();
      await user.click(button);
      expect(
        mockApi.mock.calls.filter(([, method]) => method === "POST"),
      ).toHaveLength(1);
      await complete({ task_id: "sample-task" });
      await waitFor(() => expect(button).toBeEnabled());
      expect(toast.success).toHaveBeenCalledWith(
        `${label} queued (sample-task)`,
      );
      expect(
        mockApi.mock.calls
          .filter(([, method]) => method !== "POST")
          .map(([url]) => url)
          .sort(),
      ).toEqual([...getPaths, ...getPaths].sort());
    },
  );

  it.each(["Confirm", "Reject"])(
    "keeps %s match id and refetches only matches",
    async (name) => {
      await ready();
      const complete = pendingPost();
      const button = screen.getAllByRole("button", { name })[0]!;
      button.focus();
      await userEvent.keyboard(" ");
      expect(mockApi).toHaveBeenCalledWith(
        `/api/bandcamp/admin/matches/71/${name.toLowerCase()}`,
        "POST",
      );
      expect(button).toHaveAttribute("aria-busy", "true");
      await complete({});
      await waitFor(() => expect(button).toBeEnabled());
      expect(toast.success).toHaveBeenCalledWith(
        name === "Confirm" ? "Match confirmed" : "Match rejected",
      );
      expect(
        mockApi.mock.calls.filter(([, method]) => method !== "POST"),
      ).toHaveLength(9);
      expect(mockApi.mock.calls[mockApi.mock.calls.length - 1]).toEqual([
        "/api/bandcamp/admin/matches?limit=100",
        "GET",
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ]);
    },
  );

  it.each([
    ["Sync collection", new Error("Sample unavailable"), "Sample unavailable"],
    ["Backfill URLs", new Error(""), "Failed to queue Bandcamp URL backfill"],
    ["Confirm", new Error("Candidate changed"), "Candidate changed"],
    ["Reject", new Error(""), "Failed to update Bandcamp match"],
  ])(
    "keeps %s failure messages and unlocks without success refetch",
    async (name, error, message) => {
      await ready();
      const reads = mockApi.mock.calls.length;
      mockApi.mockRejectedValue(error);
      const button = screen.getAllByRole("button", { name })[0]!;
      await userEvent.click(button);
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
      expect(button).toBeEnabled();
      expect(mockApi).toHaveBeenCalledTimes(reads + 1);
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it("keeps connection eligibility without inventing connectivity", async () => {
    payloads["/api/bandcamp/me/status"] = { connected: false };
    render(<Bandcamp />);
    await screen.findByText("Not connected");
    expect(
      screen.getByRole("button", { name: "Sync collection" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Refresh Radar" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Backfill URLs" })).toBeEnabled();
  });

  it("preserves checking state and empty fallbacks while reads are pending", () => {
    mockApi.mockReturnValue(new Promise(() => {}));
    render(<Bandcamp />);
    expect(screen.getByText("Checking connection...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sync collection" }),
    ).toBeDisabled();
    expect(
      screen.getByText("No Bandcamp match candidates pending."),
    ).toBeInTheDocument();
    expect(screen.getByText("No Bandcamp imports yet.")).toBeInTheDocument();
  });

  it("keeps real metadata, image URL and external opening arguments from the keyboard", async () => {
    const data = structuredClone(fixture);
    (
      data["/api/bandcamp/admin/matches?limit=100"].items[0]! as {
        cover_url: string | null;
      }
    ).cover_url = "/sample-cover.svg";
    payloads = data;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await ready();
    const candidate = screen
      .getByText("Costa Norte · Luz en Crate")
      .closest("article")!;
    expect(
      within(candidate).getByRole("button", { name: "Open" }),
    ).toBeInTheDocument();
    expect(candidate.querySelector("img")).toHaveAttribute(
      "src",
      "/sample-cover.svg",
    );
    const button = within(candidate).getByRole("button", {
      name: "Open",
    });
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(open).toHaveBeenCalledWith(
      data["/api/bandcamp/admin/matches?limit=100"].items[0]!.item_url,
      "_blank",
      "noopener,noreferrer",
    );
    for (const text of [
      "Lucía de muestra",
      "mar-de-muestra",
      "flac · failed",
      "74%",
    ])
      expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
  });

  it("retains the existing visible-item limits and candidate filter", async () => {
    const data = structuredClone(fixture);
    const match = data["/api/bandcamp/admin/matches?limit=100"].items[2]!;
    data["/api/bandcamp/admin/matches?limit=100"].items = Array.from(
      { length: 10 },
      (_, i) => ({ ...match, id: 100 + i, entity_name: `Confirmed ${i}` }),
    );
    const radar = data["/api/bandcamp/me/radar"].items[0]!;
    data["/api/bandcamp/me/radar"].items = Array.from(
      { length: 7 },
      (_, i) => ({ ...radar, id: 200 + i, album_title: `Radar ${i}` }),
    );
    const imported = data["/api/bandcamp/me/imports"].imports[0]!;
    data["/api/bandcamp/me/imports"].imports = Array.from(
      { length: 7 },
      (_, i) => ({ ...imported, id: 300 + i, album_title: `Import ${i}` }),
    );
    const bought =
      data["/api/bandcamp/admin/collection?relation_type=collection&limit=50"]
        .items[0]!;
    data[
      "/api/bandcamp/admin/collection?relation_type=collection&limit=50"
    ].items = Array.from({ length: 10 }, (_, i) => ({
      ...bought,
      id: 400 + i,
      album_title: `Purchase ${i}`,
    }));
    payloads = data;
    await ready();
    for (const text of ["Confirmed 7", "Radar 4", "Import 4", "Purchase 7"])
      expect(screen.getByText(text, { exact: true })).toBeInTheDocument();
    for (const text of ["Confirmed 8", "Radar 5", "Import 5", "Purchase 8"])
      expect(screen.queryByText(text, { exact: true })).not.toBeInTheDocument();
  });
});
