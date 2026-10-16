import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { AddShowDialog } from "./AddShowDialog";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const planId = "d105bd45-92c0-4f99-b12a-bb1cc8910fa1";
let candidates: Record<string, unknown>[];

beforeEach(() => {
  vi.clearAllMocks();
  candidates = [];
  vi.mocked(api).mockImplementation(async (url, method, body) => {
    if (url.endsWith("/plans") && method === "POST") {
      candidates = (body as { candidates: Record<string, unknown>[] })
        .candidates;
      return { job_id: "prepare-1", status: "pending" };
    }
    const plan = {
      plan_id: planId,
      plan_version: "a".repeat(64),
      executable: true,
      changes: candidates.map((candidate) => ({
        item_id: candidate.item_id,
        before: {},
        after: candidate,
      })),
      approval_required: false,
    };
    if (url.endsWith("/jobs/prepare-1"))
      return { status: "completed", result: { plan } };
    if (url.endsWith(`/plans/${planId}`)) return plan;
    if (url.endsWith("/apply")) return { job_id: "apply-1", status: "pending" };
    if (url.endsWith("/jobs/apply-1"))
      return {
        status: "completed",
        result: {
          verification: { status: "passed" },
          execution: {
            status: "completed",
            items: candidates.map((candidate) => ({
              item_id: candidate.item_id,
              show_id: 7,
              status: "created",
            })),
          },
        },
      };
    throw new Error(`Unexpected request: ${url}`);
  });
});

async function fillManual() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Artist"), "External Band");
  await user.type(screen.getByLabelText("Date"), "2027-03-02");
  await user.type(screen.getByLabelText("Venue"), "Sala Norte");
  await user.type(screen.getByLabelText("City"), "Madrid");
  return user;
}

describe("AddShowDialog", () => {
  it("creates a manual show after exact server review without querying the LLM", async () => {
    const saved = vi.fn();
    renderWithAdminProviders(
      <AddShowDialog open onOpenChange={vi.fn()} onSaved={saved} />,
    );
    const user = await fillManual();
    expect(screen.getByLabelText("Time")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Review selection" }));
    await user.click(
      await screen.findByRole("button", { name: "Save selected shows" }),
    );
    expect(
      await screen.findByRole("link", { name: "Open show 7" }),
    ).toHaveAttribute("href", "/shows?show_id=7");
    expect(saved).toHaveBeenCalledOnce();
    expect(vi.mocked(api).mock.calls.some(([url]) => url.includes("llm"))).toBe(
      false,
    );
  });

  it("invalidates the preview after an edit and keeps an unknown time unknown", async () => {
    renderWithAdminProviders(
      <AddShowDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review selection" }));
    await screen.findByRole("button", { name: "Save selected shows" });
    await user.type(screen.getByLabelText("Venue"), " Annex");
    expect(
      screen.queryByRole("button", { name: "Save selected shows" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/review again/i)).toBeInTheDocument();
    expect(candidates[0]!.local_time ?? null).toBeNull();
  });

  it("retries an uncertain save using the same exact payload and key", async () => {
    const implementation = vi.mocked(api).getMockImplementation()!;
    let fail = true;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/apply") && fail) {
        fail = false;
        throw new Error("Connection lost");
      }
      return implementation(...args);
    });
    renderWithAdminProviders(
      <AddShowDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review selection" }));
    await user.click(
      await screen.findByRole("button", { name: "Save selected shows" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Retry same save" }),
    );
    await screen.findByRole("link", { name: "Open show 7" });
    const writes = vi
      .mocked(api)
      .mock.calls.filter(([url]) => url.endsWith("/apply"));
    expect(writes).toHaveLength(2);
    expect(writes[0]![2]).toEqual(writes[1]![2]);
    await waitFor(() => expect(screen.getByLabelText("Artist")).toBeDisabled());
  });

  it("unlocks a preserved draft after a definitive preparation failure", async () => {
    const implementation = vi.mocked(api).getMockImplementation()!;
    let failed = true;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/jobs/prepare-1") && failed)
        return {
          status: "failed",
          result: {
            execution: {
              error: "Plan exceeds 40 KB",
              error_code: "LIMIT_EXCEEDED",
            },
          },
        };
      return implementation(...args);
    });
    renderWithAdminProviders(
      <AddShowDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review selection" }));
    await screen.findByText("Plan exceeds 40 KB");
    expect(screen.getByLabelText("Artist")).not.toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Retry same review" }),
    ).not.toBeInTheDocument();
    const first = vi
      .mocked(api)
      .mock.calls.find(([url]) => url.endsWith("/plans"))![2];
    await user.type(screen.getByLabelText("Venue"), " Annex");
    failed = false;
    await user.click(screen.getByRole("button", { name: "Review selection" }));
    await screen.findByRole("button", { name: "Save selected shows" });
    const attempts = vi
      .mocked(api)
      .mock.calls.filter(([url]) => url.endsWith("/plans"));
    expect(attempts).toHaveLength(2);
    expect(
      (attempts[1]![2] as { idempotency_key: string }).idempotency_key,
    ).not.toEqual((first as { idempotency_key: string }).idempotency_key);
  });

  it.each(["canonical", "duplicates", "ids"])(
    "invalidates a reviewed consolidation after editing %s",
    async (change) => {
      const implementation = vi.mocked(api).getMockImplementation()!;
      vi.mocked(api).mockImplementation(async (...args) => {
        if (args[0].includes("/shows?"))
          return {
            items: [7, 8].map((id) => ({
              id,
              revision: 2,
              artist_name: "Band",
              date: "2027-03-02",
              venue: "Hall",
              city: "City",
              attendance_count: 1,
              reminder_count: 0,
            })),
          };
        if (args[0].endsWith("/plans") && args[1] === "POST")
          return { job_id: "prepare-1", status: "pending" };
        return implementation(...args);
      });
      renderWithAdminProviders(
        <AddShowDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
      );
      const user = userEvent.setup();
      await user.click(screen.getByText("Consolidate existing shows"));
      await user.type(
        screen.getByLabelText("Existing show IDs, separated by commas"),
        "7,8",
      );
      await user.click(
        screen.getByRole("button", { name: "Load shows for consolidation" }),
      );
      await user.click(await screen.findByLabelText("Transfer this duplicate"));
      await user.click(
        screen.getByRole("button", { name: "Review exact consolidation" }),
      );
      await screen.findByRole("button", { name: "Save selected shows" });
      if (change === "canonical")
        await user.click(
          screen.getAllByLabelText("Keep this canonical show")[1]!,
        );
      else if (change === "duplicates")
        await user.click(screen.getByLabelText("Transfer this duplicate"));
      else
        await user.type(
          screen.getByLabelText("Existing show IDs, separated by commas"),
          ",9",
        );
      expect(
        screen.queryByRole("button", { name: "Save selected shows" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/review again/i)).toBeInTheDocument();
    },
  );

  it("does not expose the editor without the show-writing capability", () => {
    renderWithAdminProviders(
      <AddShowDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
      {
        auth: { hasCapability: () => false },
      },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

it("saves only selected tour dates and preserves excluded rows for another batch", async () => {
  const implementation = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (...args) => {
    const url = args[0];
    if (url.endsWith("/availability"))
      return {
        configured: false,
        vision: "unknown",
        connectivity: "not_checked",
        ocr: { available: true },
      };
    if (url.endsWith("/drafts")) return { items: [] };
    if (url.endsWith("/extractions")) return { job_id: "extract-tour" };
    if (url.endsWith("/jobs/extract-tour"))
      return {
        status: "completed",
        result: {
          draft: {
            raw_text: "tour",
            coverage: "incomplete",
            candidates: [1, 2, 3].map((index) => ({
              item_id: `tour-${index}`,
              artist_name: "Band",
              artist_uid: "10000000-0000-0000-0000-000000000001",
              date: `2027-03-0${index}`,
              venue: "Hall",
              city: "City",
            })),
          },
        },
      };
    return implementation(...args);
  });
  renderWithAdminProviders(
    <AddShowDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Assisted import" }));
  await user.selectOptions(screen.getByLabelText("Extraction method"), "parse");
  await user.type(screen.getByLabelText("Source text"), "tour");
  await user.click(screen.getByRole("button", { name: "Extract candidates" }));
  await screen.findByLabelText("Select show 3");
  await user.click(screen.getByLabelText("Select show 1"));
  await user.click(screen.getByLabelText("Select show 2"));
  await user.type(screen.getByLabelText("Shared artist"), "Corrected Band");
  await user.click(
    screen.getByRole("button", {
      name: "Apply shared fields to selected dates",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Review selection" }));
  await user.click(
    await screen.findByRole("button", { name: "Save selected shows" }),
  );
  await waitFor(() =>
    expect(screen.getByText(/1 unsaved/)).toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Artist for show 1")).toBeDisabled();
  expect(screen.getByLabelText("Date for show 3")).toHaveValue("2027-03-03");
  expect(screen.getByLabelText("Artist for show 3")).not.toBeDisabled();
  expect(candidates).toHaveLength(2);
  expect(
    candidates.every(
      (candidate) =>
        candidate.artist_name === "Corrected Band" &&
        candidate.artist_uid == null,
    ),
  ).toBe(true);
  expect(screen.getByLabelText("Artist for show 3")).toHaveValue("Band");
});
