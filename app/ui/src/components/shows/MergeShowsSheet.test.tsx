import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { MergeShowsSheet } from "./MergeShowsSheet";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const planId = "d105bd45-92c0-4f99-b12a-bb1cc8910fa1";
const planVersion = "a".repeat(64);
const rows = [7, 8].map((id) => ({
  id,
  revision: 2,
  artist_name: "Band",
  date: "2027-03-02",
  venue: "Hall",
  city: "City",
  attendance_count: 1,
  reminder_count: 0,
}));
const revisions = { "7": 2, "8": 2 };

type ApiArgs = Parameters<typeof api>;

function routes(...args: ApiArgs): unknown {
  const [url, method] = args;
  if (url.includes("/shows?")) return { items: rows };
  if (url.endsWith("/plans") && method === "POST")
    return { job_id: "prepare-1", status: "pending" };
  if (url.endsWith("/jobs/prepare-1"))
    return { status: "completed", result: { plan: { plan_id: planId } } };
  if (url.endsWith(`/plans/${planId}`))
    return {
      plan_id: planId,
      plan_version: planVersion,
      kind: "consolidation",
      executable: true,
      approval_required: true,
      changes: [
        {
          item_id: "consolidation",
          before: { shows: rows },
          after: {
            canonical_show_id: 7,
            duplicate_show_ids: [8],
            revisions,
          },
        },
      ],
    };
  if (url.endsWith("/apply")) return { job_id: "apply-1", status: "pending" };
  if (url.endsWith("/jobs/apply-1"))
    return {
      status: "completed",
      result: {
        verification: { status: "passed" },
        execution: {
          status: "completed",
          items: [
            { item_id: "consolidation", show_id: 7, status: "linked_source" },
          ],
        },
      },
    };
  throw new Error(`Unexpected request: ${url}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (...args) => routes(...args));
});

function posts(fragment: string) {
  return vi
    .mocked(api)
    .mock.calls.filter(
      ([url, method]) => method === "POST" && url.endsWith(fragment),
    );
}

async function reviewMerge() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Show IDs"), "7,8");
  await user.click(screen.getByRole("button", { name: "Load shows" }));
  await user.click(
    await screen.findByRole("checkbox", { name: "Merge show 8" }),
  );
  await user.click(screen.getByRole("button", { name: "Review merge" }));
  await screen.findByRole("button", { name: "Merge shows" });
  return user;
}

function ReopenableSheet({ onMerged }: { onMerged: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Reopen merge panel</button>
      <MergeShowsSheet open={open} onOpenChange={setOpen} onMerged={onMerged} />
    </>
  );
}

describe("MergeShowsSheet", () => {
  it.each(["kept show", "merged shows", "ids"])(
    "asks for a new review after changing the %s",
    async (change) => {
      renderWithAdminProviders(
        <MergeShowsSheet open onOpenChange={vi.fn()} onMerged={vi.fn()} />,
      );
      const user = await reviewMerge();
      if (change === "kept show")
        await user.click(screen.getByRole("radio", { name: "Keep show 8" }));
      else if (change === "merged shows")
        await user.click(
          screen.getByRole("checkbox", { name: "Merge show 8" }),
        );
      else await user.type(screen.getByLabelText("Show IDs"), ",9");
      expect(
        screen.queryByRole("button", { name: "Merge shows" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText("The selection changed. Review again before merging."),
      ).toBeInTheDocument();
    },
  );

  it("explains that a merge needs approval and links to it", async () => {
    renderWithAdminProviders(
      <MergeShowsSheet open onOpenChange={vi.fn()} onMerged={vi.fn()} />,
    );
    await reviewMerge();
    const review = screen.getByRole("region", { name: "Merge review" });
    expect(
      within(review).getByRole("link", { name: "Open in Agent approvals" }),
    ).toHaveAttribute("href", `/agents/approvals/${planId}`);
    expect(
      within(review).getByRole("link", { name: "Open in Agent approvals" }),
    ).toHaveAttribute("target", "_blank");
    expect(within(review).getByRole("note")).toHaveTextContent(
      "A merge always needs approval. Approve it in Agent approvals, then come back and merge.",
    );
    const keep = within(review).getByRole("group", { name: "Keep" });
    expect(within(keep).getByText("Band · Tue, Mar 2, 2027")).toBeVisible();
    expect(
      within(review).getByRole("group", { name: "Merge into it" }),
    ).toHaveTextContent("Band · Tue, Mar 2, 2027");
    expect(review).toHaveTextContent(
      "Going lists, reminders and links move to the show you keep. Old show links open the kept show.",
    );
    expect(review).toHaveTextContent("Can't be undone automatically.");
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("[object Object]");
    expect(text).not.toMatch(/[a-f0-9]{64}/);
    expect(text).not.toContain(planId);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    expect(document.body.textContent).toContain(planVersion);
    expect(screen.getByText("Revision of show 8")).toBeVisible();
  });

  it("merges after review and links the kept show", async () => {
    const merged = vi.fn();
    renderWithAdminProviders(
      <MergeShowsSheet open onOpenChange={vi.fn()} onMerged={merged} />,
    );
    const user = await reviewMerge();
    await user.click(screen.getByRole("button", { name: "Merge shows" }));
    expect(await screen.findByText("Shows merged.")).toBeVisible();
    const link = screen.getByRole("link", { name: "Open the kept show" });
    expect(link).toHaveAttribute("href", "/shows?show_id=7");
    expect(link).toHaveAttribute("target", "_blank");
    expect(merged).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith("Shows merged");
    expect(posts("/apply")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Merge more" }));
    expect(screen.getByLabelText("Show IDs")).toHaveValue("");
    expect(screen.queryByText("Shows merged.")).not.toBeInTheDocument();
  });

  it("retries a merge whose answer was lost with the same request", async () => {
    let fail = true;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/apply") && fail) {
        fail = false;
        throw new Error("Connection lost");
      }
      return routes(...args);
    });
    const merged = vi.fn();
    renderWithAdminProviders(
      <MergeShowsSheet open onOpenChange={vi.fn()} onMerged={merged} />,
    );
    const user = await reviewMerge();
    await user.click(screen.getByRole("button", { name: "Merge shows" }));
    expect(
      await screen.findByText(
        "We lost contact before this was confirmed. Retrying continues the same request.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Show IDs")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry merge" }));
    await screen.findByText("Shows merged.");
    const writes = posts("/apply");
    expect(writes).toHaveLength(2);
    expect(writes[0]![2]).toEqual(writes[1]![2]);
    expect(merged).toHaveBeenCalledOnce();
  });

  it("keeps the review and explains a merge that still needs approval", async () => {
    let refused = true;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/apply") && refused) {
        refused = false;
        throw Object.assign(
          new Error(JSON.stringify({ detail: "Approval required" })),
          { status: 409, code: "APPROVAL_REQUIRED" },
        );
      }
      return routes(...args);
    });
    renderWithAdminProviders(
      <MergeShowsSheet open onOpenChange={vi.fn()} onMerged={vi.fn()} />,
    );
    const user = await reviewMerge();
    await user.click(screen.getByRole("button", { name: "Merge shows" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This change needs approval first. Approve it in Agent approvals, then save again.",
    );
    expect(
      screen.queryByRole("button", { name: "Retry merge" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Show IDs")).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Merge shows" }));
    await screen.findByText("Shows merged.");
    const writes = posts("/apply");
    expect(writes).toHaveLength(2);
    expect(
      (writes[1]![2] as { idempotency_key: string }).idempotency_key,
    ).not.toEqual(
      (writes[0]![2] as { idempotency_key: string }).idempotency_key,
    );
  });

  it("starts fresh when opened again after a merge", async () => {
    renderWithAdminProviders(<ReopenableSheet onMerged={vi.fn()} />);
    const user = await reviewMerge();
    await user.click(screen.getByRole("button", { name: "Merge shows" }));
    await screen.findByText("Shows merged.");
    await user.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    await waitFor(() =>
      expect(screen.queryByText("Shows merged.")).not.toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole("button", { name: "Reopen merge panel" }),
    );
    expect(screen.queryByText("Shows merged.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Show IDs")).toHaveValue("");
    expect(screen.getByLabelText("Show IDs")).not.toBeDisabled();
  });
});
