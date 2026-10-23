import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { AddShowSheet } from "./AddShowSheet";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const planId = "d105bd45-92c0-4f99-b12a-bb1cc8910fa1";
let candidates: Record<string, unknown>[];
type Row = Record<string, unknown>;
let planOverrides: (rows: Row[]) => Record<string, unknown>;
let changeAfter: Record<string, unknown>;

const FRESH_AVAILABILITY = {
  ocr: { available: true },
  checked_at: "2026-10-20T10:00:00Z",
  actions: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  candidates = [];
  planOverrides = () => ({});
  changeAfter = {};
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
        after: { ...candidate, ...changeAfter },
      })),
      approval_required: false,
      ...planOverrides(candidates),
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

function posts(fragment: string) {
  return vi
    .mocked(api)
    .mock.calls.filter(
      ([url, method]) => method === "POST" && url.endsWith(fragment),
    );
}

// The footer «Close» and the corner X share a name; query each by place.
function footerButton(name: string) {
  const footer = document.querySelector<HTMLElement>(
    '[data-slot="sheet-footer"]',
  )!;
  return within(footer).getByRole("button", { name });
}

function cornerClose() {
  return screen
    .getAllByRole("button", { name: "Close" })
    .find((button) => !button.closest('[data-slot="sheet-footer"]'))!;
}

function ReopenableSheet({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Reopen show draft</button>
      <AddShowSheet open={open} onOpenChange={setOpen} onSaved={onSaved} />
    </>
  );
}

function tourApi(count: number) {
  const implementation = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (...args) => {
    const url = args[0];
    if (url.endsWith("/availability")) return FRESH_AVAILABILITY;
    if (url.endsWith("/drafts")) return { items: [] };
    if (url.endsWith("/extractions")) return { job_id: "extract-tour" };
    if (url.endsWith("/jobs/extract-tour"))
      return {
        status: "completed",
        result: {
          execution: { status: "completed", draft_id: "tour-draft" },
          draft: {
            raw_text: "tour",
            coverage: "incomplete",
            candidates: Array.from({ length: count }, (_, i) => ({
              item_id: `tour-${i + 1}`,
              artist_name: "Band",
              artist_uid: "10000000-0000-0000-0000-000000000001",
              date: `2027-${String(3 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
              venue: "Hall",
              city: "City",
            })),
          },
        },
      };
    return implementation(...args);
  });
}

const NO_NEW_TEXT =
  "No new shows. The dates Crate read are already in the draft.";

// Each run reads the same three shows under new item IDs, as the server does.
function reimportApi() {
  let run = 0;
  const implementation = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (...args) => {
    const url = args[0];
    if (url.endsWith("/availability")) return FRESH_AVAILABILITY;
    if (url.endsWith("/drafts")) return { items: [] };
    if (url.endsWith("/extractions")) {
      run += 1;
      return { job_id: `extract-${run}` };
    }
    if (url.includes("/jobs/extract-"))
      return {
        status: "completed",
        result: {
          execution: { status: "completed", draft_id: `draft-${run}` },
          draft: {
            raw_text: "tour",
            coverage: "incomplete",
            candidates: [2, 4, 6].map((day) => ({
              item_id: `run-${run}-${day}`,
              artist_name: "Band",
              date: `2027-03-0${day}`,
              venue: "Hall",
              city: "City",
            })),
          },
        },
      };
    return implementation(...args);
  });
  return () => run;
}

async function importTour(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("radio", { name: "Import from flyer, text or link" }),
  );
  await user.type(await screen.findByLabelText("Pasted text"), "tour");
  expect(
    await screen.findByRole("radio", { name: "Text rules" }),
  ).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Find dates" }));
}

// Each case drives the whole panel; under a full parallel run the first one
// also pays the cold start, so the per-test budget is wider than the default.
describe("AddShowSheet", { timeout: 15_000 }, () => {
  it.each(["prepare", "apply"])(
    "resumes the same accepted %s job after closing and reopening the panel",
    async (kind) => {
      const original = vi.mocked(api).getMockImplementation()!;
      let recover = false;
      let signal: AbortSignal | undefined;
      vi.mocked(api).mockImplementation(async (...args) => {
        if (args[0].endsWith(`/jobs/${kind}-1`) && !recover) {
          signal = args[3]?.signal;
          return new Promise((_, reject) =>
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Closed", "AbortError")),
              { once: true },
            ),
          );
        }
        return original(...args);
      });
      const saved = vi.fn();
      renderWithAdminProviders(<ReopenableSheet onSaved={saved} />);
      const user = await fillManual();
      await user.click(screen.getByRole("button", { name: "Review show" }));
      if (kind === "apply")
        await user.click(
          await screen.findByRole("button", { name: "Save show" }),
        );
      await waitFor(() => expect(signal).toBeDefined());
      await user.click(footerButton("Close"));
      expect(signal?.aborted).toBe(true);
      recover = true;
      await user.click(
        screen.getByRole("button", { name: "Reopen show draft" }),
      );
      expect(screen.getByLabelText("Artist")).toHaveValue("External Band");
      expect(screen.getByLabelText("Artist")).toBeDisabled();
      await user.click(
        screen.getByRole("button", {
          name: kind === "prepare" ? "Retry review" : "Retry save",
        }),
      );
      if (kind === "prepare") {
        await screen.findByRole("button", { name: "Save show" });
        expect(saved).not.toHaveBeenCalled();
      } else {
        expect(
          await screen.findByRole("link", { name: "Open show" }),
        ).toHaveAttribute("href", "/upcoming?show_id=7");
        expect(saved).toHaveBeenCalledOnce();
      }
      expect(posts(kind === "prepare" ? "/plans" : "/apply")).toHaveLength(1);
      await user.click(footerButton("Close"));
      await user.click(
        screen.getByRole("button", { name: "Reopen show draft" }),
      );
      expect(
        screen.queryByRole("button", { name: /Retry/ }),
      ).not.toBeInTheDocument();
    },
  );

  it("restores an import in StrictMode while keeping unsaved edits and canonical saved rows", async () => {
    const original = vi.mocked(api).getMockImplementation()!;
    let restoring = false;
    const rows = [1, 2].map((index) =>
      Object.freeze({
        item_id: `resume-${index}`,
        artist_name: "Band",
        date: `2027-03-0${index}`,
        venue: "Hall",
        city: "Original City",
      }),
    );
    vi.mocked(api).mockImplementation(async (...args) => {
      const url = args[0];
      if (url.endsWith("/availability")) return FRESH_AVAILABILITY;
      if (url.endsWith("/drafts"))
        return {
          items: [
            {
              id: "resume-draft",
              job_id: "resume-job",
              status: "completed",
              mode: "parse",
              candidate_count: 2,
              created_at: new Date().toISOString(),
            },
          ],
        };
      if (url.endsWith("/drafts/resume-draft"))
        return {
          result: {
            raw_text: "source",
            coverage: "incomplete",
            candidates: restoring
              ? rows.map((row) => ({ ...row, city: "Final City" }))
              : rows,
            publication: restoring
              ? {
                  "resume-2": {
                    item_id: "resume-2",
                    show_id: 8,
                    status: "created",
                  },
                }
              : {},
          },
        };
      return original(...args);
    });
    renderWithAdminProviders(
      <StrictMode>
        <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />
      </StrictMode>,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("radio", { name: "Import from flyer, text or link" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Recent imports" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Open Text rules import" }),
    );
    await user.clear(await screen.findByLabelText("City for show 1"));
    await user.type(screen.getByLabelText("City for show 1"), "Manual City");
    restoring = true;
    await user.click(
      screen.getByRole("button", { name: "Open Text rules import" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("City for show 2")).toBeDisabled(),
    );
    expect(screen.getByLabelText("City for show 1")).toHaveValue("Manual City");
    expect(screen.getByLabelText("City for show 1")).not.toBeDisabled();
    expect(screen.getByLabelText("City for show 2")).toHaveValue("Final City");
    expect(
      screen
        .getAllByRole("link", { name: "Open show" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/upcoming?show_id=8"]);
    expect(rows.every((row) => row.city === "Original City")).toBe(true);
  });

  it("creates a manual show after the exact server review without calling AI", async () => {
    const saved = vi.fn();
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={saved} />,
    );
    const user = await fillManual();
    expect(screen.getByLabelText("Time")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await user.click(await screen.findByRole("button", { name: "Save show" }));
    expect(
      await screen.findByRole("link", { name: "Open show" }),
    ).toHaveAttribute("href", "/upcoming?show_id=7");
    expect(screen.getByText("Show saved.")).toBeVisible();
    expect(saved).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          ([url]) =>
            url.includes("llm") ||
            url.includes("/availability") ||
            url.includes("/extractions"),
        ),
    ).toBe(false);
  });

  it("invalidates the review after an edit and keeps an unknown time unknown", async () => {
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await screen.findByRole("button", { name: "Save show" });
    await user.type(screen.getByLabelText("Venue"), " Annex");
    expect(
      screen.queryByRole("button", { name: "Save show" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("The draft changed. Review again before saving."),
    ).toBeInTheDocument();
    expect(candidates[0]!.local_time ?? null).toBeNull();
  });

  it("retries an uncertain save with the same payload and key", async () => {
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
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await user.click(await screen.findByRole("button", { name: "Save show" }));
    expect(
      await screen.findByText(
        "We lost contact before this was confirmed. Retrying continues the same request.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry save" }));
    await screen.findByRole("link", { name: "Open show" });
    const writes = posts("/apply");
    expect(writes).toHaveLength(2);
    expect(writes[0]![2]).toEqual(writes[1]![2]);
    await waitFor(() => expect(screen.getByLabelText("Artist")).toBeDisabled());
  });

  it("unlocks a kept draft after a definitive review failure", async () => {
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
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Plan exceeds 40 KB",
    );
    expect(screen.getByLabelText("Artist")).not.toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Retry review" }),
    ).not.toBeInTheDocument();
    const first = posts("/plans")[0]![2] as { idempotency_key: string };
    await user.type(screen.getByLabelText("Venue"), " Annex");
    failed = false;
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await screen.findByRole("button", { name: "Save show" });
    const attempts = posts("/plans");
    expect(attempts).toHaveLength(2);
    expect(
      (attempts[1]![2] as { idempotency_key: string }).idempotency_key,
    ).not.toEqual(first.idempotency_key);
  });

  it("does not render without the show-writing capability", () => {
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
      { auth: { hasCapability: () => false } },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves only selected tour dates and keeps the rest for another batch", async () => {
    tourApi(3);
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    await importTour(user);
    await screen.findByLabelText("Select show 3");
    expect(screen.getByText(/^0 of 3 shows selected$/)).toBeInTheDocument();
    await user.click(screen.getByLabelText("Select show 1"));
    await user.click(screen.getByLabelText("Select show 2"));
    await user.type(
      screen.getByLabelText("Artist for several shows"),
      "Corrected Band",
    );
    await user.click(
      screen.getByRole("button", { name: "Apply to 2 selected shows" }),
    );
    await user.click(screen.getByRole("button", { name: "Review 2 shows" }));
    await user.click(
      await screen.findByRole("button", { name: "Save 2 shows" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/2 saved/)).toBeInTheDocument(),
    );
    expect(screen.getByText("1 of 1 shows selected · 2 saved")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Select show 3" }),
    ).toBeChecked();
    expect(screen.getByRole("button", { name: "Review show" })).toBeEnabled();
    expect(screen.getByLabelText("Artist for show 1")).toBeDisabled();
    expect(screen.getByLabelText("Date for show 3")).toHaveValue("2027-03-03");
    expect(screen.getByLabelText("Artist for show 3")).not.toBeDisabled();
    expect(screen.getByLabelText("Artist for show 3")).toHaveValue("Band");
    expect(candidates).toHaveLength(2);
    expect(
      candidates.every(
        (candidate) =>
          candidate.artist_name === "Corrected Band" &&
          candidate.artist_uid == null,
      ),
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Remove show 3" }),
    ).not.toBeInTheDocument();
  });

  it("adds a single show without selection controls or the merge tool", async () => {
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByRole("radio", { name: "Enter manually" })).toBeChecked();
    expect(screen.getByLabelText("Artist")).toBeEnabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/selected|unsaved/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Consolidate existing shows"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Merge/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Show IDs")).not.toBeInTheDocument();
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });

  it("adds rows with «Add another date» and shows selection only then", async () => {
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Artist"), "External Band");
    await user.click(screen.getByRole("button", { name: "Add another date" }));
    expect(
      screen.getByRole("checkbox", { name: "Select show 1" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select show 2" }),
    ).toBeChecked();
    expect(screen.getByText("2 of 2 shows selected")).toBeInTheDocument();
    expect(screen.getByLabelText("Artist for show 2")).toHaveValue(
      "External Band",
    );
    expect(screen.getByLabelText("Artist for show 1")).toHaveValue(
      "External Band",
    );
    await user.click(screen.getByRole("button", { name: "Remove show 2" }));
    expect(screen.getByLabelText("Artist")).toHaveValue("External Band");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("highlights missing fields instead of sending an incomplete show", async () => {
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    expect(screen.getByLabelText("Venue")).not.toHaveAttribute("aria-invalid");
    await user.type(screen.getByLabelText("Artist"), "External Band");
    await user.type(screen.getByLabelText("Date"), "2027-03-02");
    await user.click(screen.getByRole("button", { name: "Review show" }));
    expect(posts("/plans")).toHaveLength(0);
    expect(screen.getByLabelText("Venue")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("City")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Artist")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Fill in the highlighted fields to continue.",
    );
  });

  it("renders the reviewed plan without raw objects or hashes", async () => {
    changeAfter = {
      source_ref: "upload:0f3c",
      source_manifest: [
        {
          source_ref: "upload:0f3c",
          sha256: "f".repeat(64),
          modality: "image",
          read: true,
        },
      ],
      extractor_model: "gemini/gemini-3.8-flash",
      lineup: ["A", "B"],
      evidence: "MAR 02",
    };
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    const review = await screen.findByRole("region", {
      name: "Review before saving",
    });
    expect(review).toHaveTextContent("1 show to save");
    expect(review).toHaveTextContent("New");
    expect(review).toHaveTextContent("External Band · Tue, Mar 2, 2027");
    expect(screen.getByText("A, B")).toBeVisible();
    expect(screen.getByText("Read by gemini-3.8-flash")).toBeVisible();
    expect(screen.getByText("Source: Uploaded image")).toBeVisible();
    expect(review).toHaveTextContent("MAR 02");
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("[object Object]");
    expect(text).not.toMatch(/[a-f0-9]{64}/);
    expect(text).not.toContain("upload:0f3c");
    expect(text).not.toContain(planId);
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    expect(document.body.textContent).toContain("f".repeat(64));
    expect(document.body.textContent).toContain(planId);
  });

  it("shows server errors as sentences", async () => {
    const implementation = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/plans") && args[1] === "POST")
        throw Object.assign(
          new Error(
            JSON.stringify({
              detail: "An unambiguous ISO date with year is required",
            }),
          ),
          { status: 422 },
        );
      return implementation(...args);
    });
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "An unambiguous ISO date with year is required",
    );
    expect(alert.textContent).not.toContain('{"detail"');
    expect(screen.getByLabelText("Artist")).toBeEnabled();
  });

  it("links a plan that needs approval to Agent approvals", async () => {
    planOverrides = () => ({ approval_required: true });
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    const link = await screen.findByRole("link", {
      name: "Open in Agent approvals",
    });
    expect(link).toHaveAttribute(
      "href",
      "/agents/approvals/d105bd45-92c0-4f99-b12a-bb1cc8910fa1",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("note")).toHaveTextContent(
      "This change needs approval. Approve it in Agent approvals, then save it here.",
    );
  });

  it("offers the matching saved show and artist without showing their ids", async () => {
    const artistUid = "10000000-0000-0000-0000-000000000009";
    const implementation = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/api/show-imports/shows/42"))
        return { id: 42, revision: 5 };
      return implementation(...args);
    });
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    planOverrides = (rows) => ({
      executable: false,
      issues: [
        {
          item_id: rows[0]!.item_id,
          reason: "This show may already be saved",
          matches: [42],
          artist_matches: [{ artist_uid: artistUid, name: "Listed Band" }],
        },
      ],
    });
    await user.click(screen.getByRole("button", { name: "Review show" }));
    expect(
      await screen.findByText("Show 1: This show may already be saved"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save show" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View it (Show 1)" }),
    ).toHaveAttribute("href", "/upcoming?show_id=42");
    expect(
      screen.getByRole("button", { name: "Use Listed Band (Show 1)" }),
    ).not.toHaveAttribute("title");
    expect(document.body.textContent).not.toContain(artistUid);
    await user.click(
      screen.getByRole("button", {
        name: "Update the existing show (Show 1)",
      }),
    );
    await screen.findByText("The draft changed. Review again before saving.");
    planOverrides = () => ({});
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await screen.findByRole("button", { name: "Save show" });
    expect(candidates[0]).toMatchObject({
      existing_show_id: 42,
      expected_revision: 5,
    });
  });

  it("locks the panel while it loads the existing show", async () => {
    let answer!: (value: unknown) => void;
    const implementation = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/api/show-imports/shows/42"))
        return new Promise((resolve) => (answer = resolve));
      return implementation(...args);
    });
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    planOverrides = (rows) => ({
      issues: [{ item_id: rows[0]!.item_id, matches: [42] }],
    });
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Update the existing show (Show 1)",
      }),
    );
    expect(screen.getByRole("button", { name: "Save show" })).toBeDisabled();
    expect(screen.getByLabelText("Artist")).toBeDisabled();
    answer({ id: 42, revision: 5 });
    await screen.findByText("The draft changed. Review again before saving.");
    expect(
      screen.queryByRole("button", { name: "Save show" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Artist")).toBeEnabled();
    expect(posts("/apply")).toHaveLength(0);
  });

  it("rotates the review key after a refusal even without an edit", async () => {
    const implementation = vi.mocked(api).getMockImplementation()!;
    let refuse = true;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/plans") && args[1] === "POST" && refuse) {
        refuse = false;
        throw Object.assign(new Error(JSON.stringify({ detail: "Busy" })), {
          status: 409,
          code: "TARGET_BUSY",
        });
      }
      return implementation(...args);
    });
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Another change is saving these shows. Try again in a moment.",
    );
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await screen.findByRole("button", { name: "Save show" });
    const [first, second] = posts("/plans").map(
      ([, , body]) => (body as { idempotency_key: string }).idempotency_key,
    );
    expect(second).toBeDefined();
    expect(second).not.toEqual(first);
  });

  it("refuses to review more than 50 shows at once", async () => {
    // 51 full rows make label queries slow; aria-label selectors stay fast.
    const byLabel = (label: string) =>
      document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    tourApi(51);
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    await importTour(user);
    await waitFor(() => expect(byLabel("Select show 51")).not.toBeNull());
    fireEvent.click(screen.getByText("Select all valid"));
    fireEvent.click(byLabel("Select show 51")!);
    expect(screen.getByText("51 of 51 shows selected")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Review 51 shows"));
    const notice = screen.getByText(
      "Select up to 50 shows per save. The rest stay here for the next batch.",
    );
    expect(notice).toHaveAttribute("role", "alert");
    expect(posts("/plans")).toHaveLength(0);
  });

  it("refreshes the shows list when a failed save still saved some shows", async () => {
    const implementation = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/jobs/apply-1"))
        return {
          status: "completed",
          result: {
            verification: { status: "failed" },
            execution: {
              status: "completed",
              items: [
                {
                  item_id: candidates[0]!.item_id,
                  show_id: 7,
                  status: "created",
                },
              ],
            },
          },
        };
      return implementation(...args);
    });
    const saved = vi.fn();
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={saved} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await user.click(await screen.findByRole("button", { name: "Save show" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The change didn't go through. Review it again.",
    );
    expect(saved).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Artist")).toBeDisabled();
  });

  it("keeps a reviewed plan when an import finds nothing", async () => {
    tourApi(0);
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await screen.findByRole("button", { name: "Save show" });
    await importTour(user);
    expect(
      await screen.findByText(
        "No shows found. Try another method or enter the show manually.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save show" })).toBeEnabled();
    expect(
      screen.queryByText("The draft changed. Review again before saving."),
    ).toBeNull();
    expect(screen.getByLabelText("Artist")).toHaveValue("External Band");
  });

  it("hides the changed note while the new review runs", async () => {
    const implementation = vi.mocked(api).getMockImplementation()!;
    let hang = false;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/jobs/prepare-1") && hang)
        return new Promise(() => {});
      return implementation(...args);
    });
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await screen.findByRole("button", { name: "Save show" });
    await user.type(screen.getByLabelText("Venue"), " Annex");
    expect(
      screen.getByText("The draft changed. Review again before saving."),
    ).toBeVisible();
    hang = true;
    await user.click(screen.getByRole("button", { name: "Review show" }));
    expect(
      await screen.findByText(
        "Checking the selection. Nothing is published yet.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("The draft changed. Review again before saving."),
    ).toBeNull();
  });

  it.each(["corner button", "Escape key"])(
    "starts fresh, source included, after a save closed with the %s",
    async (how) => {
      tourApi(1);
      renderWithAdminProviders(<ReopenableSheet onSaved={vi.fn()} />);
      const user = userEvent.setup();
      await importTour(user);
      expect(await screen.findByLabelText("Artist")).toHaveValue("Band");
      await user.click(screen.getByRole("button", { name: "Review show" }));
      await user.click(
        await screen.findByRole("button", { name: "Save show" }),
      );
      await screen.findByText("Show saved.");
      if (how === "corner button") await user.click(cornerClose());
      else await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await user.click(
        screen.getByRole("button", { name: "Reopen show draft" }),
      );
      expect(screen.getByLabelText("Artist")).toHaveValue("");
      expect(screen.getByLabelText("Artist")).toBeEnabled();
      expect(
        screen.getByRole("radio", { name: "Enter manually" }),
      ).toBeChecked();
      await user.click(
        screen.getByRole("radio", { name: "Import from flyer, text or link" }),
      );
      expect(await screen.findByLabelText("Pasted text")).toHaveValue("");
      expect(screen.queryByText(/Found 1 show/)).toBeNull();
      expect(
        screen.getByText("Add a flyer, text or link to choose how to read it."),
      ).toBeVisible();
    },
  );

  it("starts fresh after everything was saved", async () => {
    tourApi(1);
    const saved = vi.fn();
    renderWithAdminProviders(<ReopenableSheet onSaved={saved} />);
    const user = userEvent.setup();
    await importTour(user);
    expect(await screen.findByLabelText("Artist")).toHaveValue("Band");
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await user.click(await screen.findByRole("button", { name: "Save show" }));
    await screen.findByText("Show saved.");
    expect(saved).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reopen show draft" }));
    expect(screen.getByLabelText("Artist")).toHaveValue("");
    expect(screen.getByLabelText("Artist")).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Enter manually" })).toBeChecked();
    expect(screen.queryByText("Show saved.")).not.toBeInTheDocument();
  });

  it("uses design-system controls only", async () => {
    tourApi(2);
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    await importTour(user);
    await screen.findByLabelText("Select show 2");
    const sheet = screen.getByRole("dialog");
    expect(sheet.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(
      sheet.querySelector(
        'select, details, pre, input[type="checkbox"]:not([aria-hidden]), input[type="radio"]:not([aria-hidden])',
      ),
    ).toBeNull();
  });

  it("starts over after a partial save, asking first and leaving saved shows alone", async () => {
    tourApi(4);
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    await importTour(user);
    await screen.findByLabelText("Select show 4");
    for (const index of [1, 2, 3])
      await user.click(screen.getByLabelText(`Select show ${index}`));
    await user.click(screen.getByRole("button", { name: "Review 3 shows" }));
    await user.click(
      await screen.findByRole("button", { name: "Save 3 shows" }),
    );
    await screen.findByText("1 of 1 shows selected · 3 saved");
    const requests = vi.mocked(api).mock.calls.length;
    await user.click(footerButton("Start over"));
    const confirm = await screen.findByRole("alertdialog", {
      name: "Discard 1 unsaved show?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Date for show 4")).toHaveValue("2027-03-04");
    await user.click(footerButton("Start over"));
    await user.click(
      within(
        await screen.findByRole("alertdialog", {
          name: "Discard 1 unsaved show?",
        }),
      ).getByRole("button", { name: "Discard" }),
    );
    expect(screen.getByRole("radio", { name: "Enter manually" })).toBeChecked();
    expect(screen.getByLabelText("Artist")).toHaveValue("");
    expect(screen.getByLabelText("Artist")).toBeEnabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Venue")).not.toHaveAttribute("aria-invalid");
    expect(footerButton("Start over")).toBeDisabled();
    // Discarding is local: nothing is sent, so saved shows stay in Crate.
    expect(vi.mocked(api).mock.calls.length).toBe(requests);
    await user.click(
      screen.getByRole("radio", { name: "Import from flyer, text or link" }),
    );
    expect(await screen.findByLabelText("Pasted text")).toHaveValue("");
  });

  it("starts over at once when only the source holds something", async () => {
    tourApi(1);
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    expect(footerButton("Start over")).toBeDisabled();
    await user.click(
      screen.getByRole("radio", { name: "Import from flyer, text or link" }),
    );
    await user.type(await screen.findByLabelText("Pasted text"), "tour");
    await user.click(footerButton("Start over"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Enter manually" })).toBeChecked();
    await user.click(
      screen.getByRole("radio", { name: "Import from flyer, text or link" }),
    );
    expect(await screen.findByLabelText("Pasted text")).toHaveValue("");
  });

  it("keeps «Start over» off while a save runs", async () => {
    const implementation = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (...args) =>
      args[0].endsWith("/jobs/apply-1")
        ? new Promise(() => {})
        : implementation(...args),
    );
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    expect(footerButton("Start over")).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await user.click(await screen.findByRole("button", { name: "Save show" }));
    await screen.findByText("Saving the reviewed selection…");
    expect(footerButton("Start over")).toBeDisabled();
    await user.click(footerButton("Start over"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Artist")).toHaveValue("External Band");
  });

  it("keeps a re-imported tour at one row per show", async () => {
    const runs = reimportApi();
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    await importTour(user);
    await screen.findByLabelText("Select show 3");
    await user.click(screen.getByRole("button", { name: "Find dates" }));
    await waitFor(() => expect(runs()).toBe(2));
    await screen.findByText(NO_NEW_TEXT);
    expect(screen.getByLabelText("Select show 3")).toBeInTheDocument();
    expect(screen.queryByLabelText("Select show 4")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pasted text")).toHaveValue("tour");
  });

  it("keeps a standing review when a re-import finds only shows already in the draft", async () => {
    reimportApi();
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    await importTour(user);
    expect(await screen.findByText(/Found 3 shows/)).toBeVisible();
    await user.click(screen.getByLabelText("Select show 1"));
    await user.click(screen.getByLabelText("Select show 2"));
    await user.click(screen.getByRole("button", { name: "Review 2 shows" }));
    await screen.findByRole("button", { name: "Save 2 shows" });
    await user.click(screen.getByRole("button", { name: "Find dates" }));
    expect(await screen.findByText(NO_NEW_TEXT)).toBeVisible();
    expect(screen.queryByText(/Found 3 shows/)).toBeNull();
    expect(posts("/extractions")).toHaveLength(2);
    // Nothing changed, so the review stands and can be saved as it is.
    expect(screen.getByRole("button", { name: "Save 2 shows" })).toBeEnabled();
    expect(
      screen.queryByText("The draft changed. Review again before saving."),
    ).toBeNull();
    expect(screen.getByLabelText("Select show 1")).toBeChecked();
    expect(screen.getByLabelText("Select show 2")).toBeChecked();
    expect(screen.getByLabelText("Select show 3")).not.toBeChecked();
    expect(screen.queryByLabelText("Select show 4")).not.toBeInTheDocument();
  });

  it("keeps «Start over» off while an import's acceptance is uncertain", async () => {
    tourApi(1);
    const tour = vi.mocked(api).getMockImplementation()!;
    let lost = true;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/extractions") && lost) {
        lost = false;
        throw new TypeError("Failed to fetch");
      }
      return tour(...args);
    });
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    await importTour(user);
    const retry = await screen.findByRole("button", { name: "Retry import" });
    // The source holds text, which alone would allow a fresh start.
    expect(footerButton("Start over")).toBeDisabled();
    await user.click(footerButton("Start over"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pasted text")).toHaveValue("tour");
    await user.click(retry);
    expect(await screen.findByLabelText("Artist")).toHaveValue("Band");
    const keys = posts("/extractions").map(
      ([, , body]) => (body as { idempotency_key: string }).idempotency_key,
    );
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(footerButton("Start over")).toBeEnabled();
  });

  it("asks to select shows when several rows have none selected", async () => {
    tourApi(2);
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = userEvent.setup();
    await importTour(user);
    await screen.findByLabelText("Select show 2");
    expect(footerButton("Select shows to review")).toBeDisabled();
    await user.click(screen.getByLabelText("Select show 1"));
    expect(footerButton("Review show")).toBeEnabled();
  });

  it("announces every state in one status region that is always there", async () => {
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await screen.findByRole("button", { name: "Save show" });
    await user.type(screen.getByLabelText("Venue"), " Annex");
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent(
      "The draft changed. Review again before saving.",
    );
    await user.click(screen.getByRole("button", { name: "Review show" }));
    await user.click(await screen.findByRole("button", { name: "Save show" }));
    await waitFor(() => expect(status).toHaveTextContent("Show saved."));
    expect(screen.getByRole("status")).toBe(status);
  });

  it.each([
    [
      true,
      "This change needs approval first. Approve it in Agent approvals, then save again.",
    ],
    [
      false,
      "This change needs approval first. Someone who can approve changes must approve it in Agent approvals. Then come back and save again.",
    ],
  ])(
    "explains a save that still needs approval (can approve: %s)",
    async (canApprove, text) => {
      const implementation = vi.mocked(api).getMockImplementation()!;
      vi.mocked(api).mockImplementation(async (...args) => {
        if (args[0].endsWith("/apply"))
          throw Object.assign(
            new Error(JSON.stringify({ detail: "Approval required" })),
            { status: 409, code: "APPROVAL_REQUIRED" },
          );
        return implementation(...args);
      });
      planOverrides = () => ({ approval_required: true });
      renderWithAdminProviders(
        <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
        {
          auth: {
            hasCapability: (capability: string) =>
              canApprove || capability !== "agents.plans.review",
          },
        },
      );
      const user = await fillManual();
      await user.click(screen.getByRole("button", { name: "Review show" }));
      expect(
        screen.queryAllByRole("link", { name: "Open in Agent approvals" }),
      ).toHaveLength(canApprove ? 1 : 0);
      await user.click(
        await screen.findByRole("button", { name: "Save show" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
    },
  );

  it("explains that another job of the editor's is still running", async () => {
    const implementation = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (...args) => {
      if (args[0].endsWith("/plans") && args[1] === "POST")
        throw Object.assign(
          new Error(
            JSON.stringify({
              detail: "This integration already has an active maintenance job",
            }),
          ),
          { status: 429, code: "LIMIT_EXCEEDED" },
        );
      return implementation(...args);
    });
    renderWithAdminProviders(
      <AddShowSheet open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );
    const user = await fillManual();
    await user.click(screen.getByRole("button", { name: "Review show" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Another import or save of yours is still running. Try again in a moment.",
    );
    expect(screen.getByLabelText("Artist")).toBeEnabled();
  });
});
