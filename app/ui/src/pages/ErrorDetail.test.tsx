import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, useApiMock, pollTaskMock, refetchMock, toastMock, llm } =
  vi.hoisted(() => ({
    apiMock: vi.fn(),
    useApiMock: vi.fn(),
    pollTaskMock: vi.fn(),
    refetchMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
    llm: { status: { available: true } as { available: boolean } | null },
  }));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: pollTaskMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/use-llm", () => ({ useActionLLMStatus: () => llm.status }));

import type { ErrorIssueDetail } from "@/lib/error-inbox";
import { clockText } from "@/lib/error-inbox";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import {
  minutesAgo,
  sampleDetail,
  sampleFix,
  sampleFixRun,
  sampleTriage,
} from "@/test/error-inbox-fixtures";

import { ErrorDetail } from "./ErrorDetail";

const only = (...granted: string[]) => ({
  hasCapability: (capability: string) => granted.includes(capability),
  hasAnyCapability: (required: readonly string[]) =>
    required.some((item) => granted.includes(item)),
});

function renderDetail(
  detail: ErrorIssueDetail | null,
  {
    auth = only("ops.errors.view", "ops.errors.manage"),
    error = null,
  }: { auth?: ReturnType<typeof only>; error?: string | null } = {},
) {
  useApiMock.mockReturnValue({
    data: detail,
    loading: false,
    error,
    refetch: refetchMock,
  });
  return renderWithAdminProviders(
    <Routes>
      <Route path="/errors/:id" element={<ErrorDetail />} />
    </Routes>,
    { route: `/errors/${detail?.id ?? "missing"}`, auth },
  );
}

const resolveButton = () =>
  screen.queryByRole("button", { name: "Resolve in next release" });
const launchButton = () => screen.queryByRole("button", { name: "Launch fix" });

describe("ErrorDetail", () => {
  beforeEach(() => {
    apiMock.mockReset();
    useApiMock.mockReset();
    pollTaskMock.mockReset();
    refetchMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    llm.status = { available: true };
  });

  it("shows metrics, the exception chain and frames with their source lines", () => {
    const detail = sampleDetail();
    renderDetail(detail);

    expect(useApiMock).toHaveBeenCalledWith(`/api/admin/errors/${detail.id}`);
    expect(
      screen.getByRole("heading", { level: 1, name: detail.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Critical lane", {
        selector: '[data-slot="info-badge"]',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1,212 in total")).toBeInTheDocument();
    expect(
      screen.getByText("Raised · unhandled · dramatiq"),
    ).toBeInTheDocument();

    const frames = screen.getByRole("list", {
      name: "In-app frames, innermost first",
    });
    const items = within(frames).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("upsert_tracks");
    expect(items[0]).toHaveTextContent("Innermost");
    expect(items[items.length - 1]).toHaveTextContent(
      "_handle_process_new_content",
    );
    const current = items[0]!.querySelector('[data-current="true"]');
    expect(current).toHaveTextContent("141");
    expect(current).toHaveTextContent("session.execute(statement)");
    expect(current).toHaveTextContent("(error line)");

    expect(screen.getByText("process_new_content")).toBeInTheDocument();
    expect(screen.getByText("Scanning /music/<path>")).toBeInTheDocument();
    expect(
      screen.getByText("No AI triage of the latest event"),
    ).toBeInTheDocument();
    const sentry = screen.getByRole("link", { name: /Open in Sentry/ });
    expect(sentry).toHaveAttribute("href", detail.permalink);
    expect(sentry).toHaveAttribute("target", "_blank");
    expect(sentry).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("hides status actions without event write", () => {
    renderDetail(sampleDetail({ write_access: false }));

    expect(resolveButton()).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Ignore until escalating" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/lacks event:write/);
    expect(
      screen.getByRole("link", { name: /Open in Sentry/ }),
    ).toBeInTheDocument();
  });

  it("hides status actions without manage capability", () => {
    renderDetail(sampleDetail(), { auth: only("ops.errors.view") });

    expect(resolveButton()).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Issue status" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("resolve enqueues and shows pending", async () => {
    const detail = sampleDetail();
    apiMock.mockResolvedValue({ task_id: "task-resolve" });
    renderDetail(detail);

    await userEvent.click(resolveButton()!);

    expect(apiMock).toHaveBeenCalledWith(
      `/api/admin/errors/${detail.id}/status`,
      "POST",
      { status: "resolved", in_next_release: true },
    );
    const pending = screen.getByRole("button", { name: "Resolving…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "Ignore until escalating" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Sending the change to Sentry/),
    ).toBeInTheDocument();
    expect(pollTaskMock).toHaveBeenCalledWith(
      "task-resolve",
      expect.any(Function),
      expect.any(Function),
    );

    const onComplete = pollTaskMock.mock.calls[0]![1] as (
      result?: Record<string, unknown>,
    ) => void;
    act(() => onComplete({ status: "succeeded", issue_status: "resolved" }));

    expect(toastMock.success).toHaveBeenCalledWith(
      "CRATE-WORKERS-3K resolved in the next release",
    );
    expect(refetchMock).toHaveBeenCalled();
    expect(resolveButton()).toBeEnabled();
  });

  it("ignores until escalating and reports a refused change", async () => {
    apiMock.mockResolvedValue({ task_id: "task-ignore" });
    renderDetail(sampleDetail());

    await userEvent.click(
      screen.getByRole("button", { name: "Ignore until escalating" }),
    );

    expect(apiMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/status$/),
      "POST",
      { status: "ignored", substatus: "archived_until_escalating" },
    );
    const onFailed = pollTaskMock.mock.calls[0]![2] as (error?: string) => void;
    act(() => onFailed("The token lacks a required scope"));
    expect(toastMock.error).toHaveBeenCalledWith(
      "The token lacks a required scope",
    );
    expect(resolveButton()).toBeEnabled();
  });

  it("offers only Reopen once an issue is no longer unresolved", async () => {
    apiMock.mockResolvedValue({ task_id: "task-reopen" });
    renderDetail(sampleDetail({ status: "resolved", substatus: null }));

    expect(resolveButton()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(apiMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/status$/),
      "POST",
      { status: "unresolved" },
    );
  });

  it("explains a write scope refusal from the API", async () => {
    apiMock.mockRejectedValue(
      Object.assign(new Error('{"detail":"Write scope missing"}'), {
        status: 409,
        code: "ERROR_TRACKING_WRITE_SCOPE_MISSING",
      }),
    );
    renderDetail(sampleDetail());

    await userEvent.click(resolveButton()!);

    expect(toastMock.error).toHaveBeenCalledWith(
      "The token cannot change issues in Sentry: it lacks event:write.",
    );
    expect(pollTaskMock).not.toHaveBeenCalled();
    expect(resolveButton()).toBeEnabled();
  });

  it("launch fix shows public repo warning", async () => {
    const detail = sampleDetail({ fix: sampleFix() });
    apiMock.mockResolvedValue({ task_id: "task-fix" });
    renderDetail(detail);

    await userEvent.click(launchButton()!);

    const dialog = screen.getByRole("alertdialog", {
      name: "Launch a fix for CRATE-WORKERS-3K?",
    });
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "thecrateapp/crate is a public repository. The short id and your note will be visible to anyone in the workflow run.",
    );
    expect(apiMock).not.toHaveBeenCalled();
    const note = within(dialog).getByLabelText("Note for the agent (optional)");
    expect(note).toHaveAttribute("maxlength", "500");
    await userEvent.type(note, "  Started after the last deploy. ");
    expect(
      within(dialog).getByText("33 of 500 characters. Public."),
    ).toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Launch fix" }),
    );

    expect(apiMock).toHaveBeenCalledWith(
      `/api/admin/errors/${detail.id}/fix`,
      "POST",
      { note: "Started after the last deploy." },
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launching…" })).toBeDisabled();
    expect(pollTaskMock).toHaveBeenCalledWith(
      "task-fix",
      expect.any(Function),
      expect.any(Function),
    );
    const onComplete = pollTaskMock.mock.calls[0]![1] as () => void;
    act(() => onComplete());
    expect(toastMock.success).toHaveBeenCalledWith(
      "Fix launched for CRATE-WORKERS-3K. Follow the run on GitHub.",
    );
    expect(refetchMock).toHaveBeenCalled();
  });

  it("launch fix hidden without config", () => {
    renderDetail(sampleDetail({ fix: null }));
    expect(launchButton()).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Workflow runs on GitHub/ }),
    ).not.toBeInTheDocument();
  });

  it("launch fix hidden without manage capability", () => {
    renderDetail(sampleDetail({ fix: sampleFix() }), {
      auth: only("ops.errors.view"),
    });

    expect(launchButton()).not.toBeInTheDocument();
    // Viewers still see the workflow runs.
    expect(
      screen.getByRole("link", { name: /Workflow runs on GitHub/ }),
    ).toBeInTheDocument();
  });

  it("shows who launched the last fix and when it can run again", () => {
    const requestedAt = minutesAgo(5);
    const availableAt = new Date(
      Date.parse(requestedAt) + 24 * 3_600_000,
    ).toISOString();
    renderDetail(
      sampleDetail({
        fix_requested_at: requestedAt,
        fix_requested_by: 1,
        fix_requested_by_name: "Diego",
        fix: sampleFix({ available_at: availableAt }),
      }),
    );

    expect(
      screen.getByText(`Fix requested by Diego at ${clockText(requestedAt)}.`, {
        exact: false,
      }),
    ).toBeInTheDocument();
    const runs = screen.getByRole("link", { name: /Workflow runs on GitHub/ });
    expect(runs).toHaveAttribute(
      "href",
      "https://github.com/thecrateapp/crate/actions/workflows/error-autofix.yml",
    );
    expect(runs).toHaveAttribute("target", "_blank");
    expect(runs).toHaveAttribute("rel", "noopener noreferrer");
    expect(launchButton()).toBeDisabled();
    expect(
      screen.getByText(
        `Launch fix is available again at ${clockText(availableAt)}.`,
      ),
    ).toBeInTheDocument();
  });

  it("shows the fix run panel and blocks a second launch while it is open", () => {
    renderDetail(
      sampleDetail({
        fix: sampleFix(),
        fix_runs: [sampleFixRun()],
        fix_requested_at: minutesAgo(50),
        fix_requested_by_name: "Diego",
      }),
    );

    expect(launchButton()).toBeDisabled();
    expect(
      screen.getByText("A fix is in progress. Discard it to launch another."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve & merge" }),
    ).toBeEnabled();
    expect(screen.getByRole("link", { name: /#412/ })).toHaveAttribute(
      "href",
      "https://github.com/thecrateapp/crate/pull/412",
    );
    // The panel replaces the older "Fix requested by" line.
    expect(screen.queryByText(/Fix requested by/)).not.toBeInTheDocument();
  });

  it("launch fix explains short ids the workflow refuses", () => {
    renderDetail(sampleDetail({ fix: sampleFix({ supported: false }) }));

    expect(launchButton()).toBeDisabled();
    expect(
      screen.getByText(/only accepts Crate short ids/),
    ).toBeInTheDocument();
  });

  it("launch fix reports a refusal and reloads the issue", async () => {
    apiMock.mockRejectedValue(
      Object.assign(new Error('{"detail":"Recently requested"}'), {
        status: 409,
        code: "ERROR_FIX_RECENTLY_REQUESTED",
      }),
    );
    renderDetail(sampleDetail({ fix: sampleFix() }));

    await userEvent.click(launchButton()!);
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Launch fix",
      }),
    );

    expect(toastMock.error).toHaveBeenCalledWith(
      "A fix for this issue was launched less than 24 hours ago.",
    );
    expect(pollTaskMock).not.toHaveBeenCalled();
    expect(refetchMock).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("launch fix keeps the note when the API refuses for another reason", async () => {
    apiMock.mockRejectedValue(
      Object.assign(new Error('{"detail":"Not configured"}'), {
        status: 409,
        code: "ERROR_FIX_NOT_CONFIGURED",
      }),
    );
    renderDetail(sampleDetail({ fix: sampleFix() }));

    await userEvent.click(launchButton()!);
    const dialog = screen.getByRole("alertdialog");
    await userEvent.type(
      within(dialog).getByLabelText("Note for the agent (optional)"),
      "Keep me",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Launch fix" }),
    );

    expect(toastMock.error).toHaveBeenCalledWith(
      "Launch fix is not configured. Set it up in the Sentry connection.",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      within(screen.getByRole("alertdialog")).getByLabelText(
        "Note for the agent (optional)",
      ),
    ).toHaveValue("Keep me");
    expect(refetchMock).not.toHaveBeenCalled();
  });

  it("launch fix reports a failed dispatch", async () => {
    apiMock.mockResolvedValue({ task_id: "task-fix" });
    renderDetail(sampleDetail({ fix: sampleFix() }));

    await userEvent.click(launchButton()!);
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Launch fix",
      }),
    );
    const onFailed = pollTaskMock.mock.calls[0]![2] as (error?: string) => void;
    act(() =>
      onFailed(
        "The GitHub token cannot run this workflow (it needs Actions write)",
      ),
    );

    expect(toastMock.error).toHaveBeenCalledWith(
      "The GitHub token cannot run this workflow (it needs Actions write)",
    );
    expect(launchButton()).toBeEnabled();
  });

  it("says when an issue has no digest yet", () => {
    renderDetail(sampleDetail({ digest: null, digest_event_id: null }));

    expect(screen.getByText("No event summary yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "In-app frames, innermost first" }),
    ).not.toBeInTheDocument();
  });

  it("says when the issue left the inbox", () => {
    renderDetail(null, { error: '{"detail":"Error issue not found"}' });

    expect(screen.getByText("Issue not in the inbox")).toBeInTheDocument();
  });

  const investigateButton = () =>
    screen.queryByRole("button", { name: "Investigate" });

  it("shows triage panel", () => {
    const detail = sampleDetail({
      triages: [
        sampleTriage({
          id: "a1b2c3d4-0000-4000-8000-00000000aa02",
          kind: "investigation",
          classification: "bug",
          severity: "critical",
          confidence: 0.9,
          summary: "A moved file reaches the upsert with a new id.",
          suspected_frames: [2],
          duplicate_of: "7d2e9a10-3b44-4f7c-8c2d-5e6f7a8b9c02",
          model: "gemini-2.5-pro",
        }),
        sampleTriage(),
        sampleTriage({
          id: "a1b2c3d4-0000-4000-8000-00000000aa03",
          digest_hash: "an-earlier-event",
          summary: "Earlier event summary",
        }),
      ],
    });
    renderDetail(detail);

    const investigation = screen.getByRole("region", { name: "Investigation" });
    expect(within(investigation).getByText("Bug")).toBeInTheDocument();
    expect(within(investigation).getByText("critical")).toBeInTheDocument();
    expect(
      within(investigation).getByText("90% confidence"),
    ).toBeInTheDocument();
    expect(
      within(investigation).getByText(
        "A moved file reaches the upsert with a new id.",
      ),
    ).toBeInTheDocument();
    expect(
      within(investigation).getByText(/gemini-2\.5-pro/),
    ).toBeInTheDocument();
    expect(
      within(investigation).getByText(
        "upsert_tracks · crate/db/repositories/library_tracks.py:141",
      ),
    ).toBeInTheDocument();
    expect(
      within(investigation).getByRole("link", {
        name: "Open the issue it duplicates",
      }),
    ).toHaveAttribute("href", "/errors/7d2e9a10-3b44-4f7c-8c2d-5e6f7a8b9c02");

    const triage = screen.getByRole("region", { name: "Triage" });
    expect(within(triage).getByText("82% confidence")).toBeInTheDocument();
    expect(
      within(triage).getByText(/persist_album upserts by id/),
    ).toBeInTheDocument();
    expect(
      within(triage).getByText(/Upsert library_tracks on path/),
    ).toBeInTheDocument();
    expect(within(triage).getByText(/gemini-2\.5-flash/)).toBeInTheDocument();
    // Only the current event's assessments are shown.
    expect(screen.queryByText("Earlier event summary")).not.toBeInTheDocument();

    // Suspected frames are marked in the stack trace and start open.
    const frames = screen.getByRole("list", {
      name: "In-app frames, innermost first",
    });
    const suspected = frames.querySelectorAll('[data-suspected="true"]');
    expect(suspected).toHaveLength(2);
    expect(suspected[0]).toHaveTextContent("upsert_tracks");
    expect(suspected[0]).toHaveTextContent("Suspected");
    expect(suspected[1]).toHaveTextContent("persist_album");
    expect(suspected[1]!.querySelector("details")).toHaveAttribute("open");

    // The latest event already has an investigation.
    expect(investigateButton()).toBeDisabled();
    expect(
      screen.getByText("The latest event has been investigated."),
    ).toBeInTheDocument();
  });

  it("investigate pending state", async () => {
    const detail = sampleDetail();
    apiMock.mockResolvedValue({ task_id: "task-investigate" });
    renderDetail(detail);

    await userEvent.click(investigateButton()!);

    expect(apiMock).toHaveBeenCalledWith(
      `/api/admin/errors/${detail.id}/investigate`,
      "POST",
    );
    const pending = screen.getByRole("button", { name: "Investigating…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByText(/The model is reading the latest event/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Investigating the latest event/),
    ).toBeInTheDocument();
    expect(pollTaskMock).toHaveBeenCalledWith(
      "task-investigate",
      expect.any(Function),
      expect.any(Function),
      undefined,
      300_000,
    );

    const onComplete = pollTaskMock.mock.calls[0]![1] as (
      result?: Record<string, unknown>,
    ) => void;
    act(() => onComplete({ status: "saved", kind: "investigation" }));

    expect(toastMock.success).toHaveBeenCalledWith(
      "Investigation of CRATE-WORKERS-3K is ready.",
    );
    expect(refetchMock).toHaveBeenCalled();
    expect(investigateButton()).toBeEnabled();
  });

  it("keeps a failed investigation's reason on screen", async () => {
    apiMock.mockResolvedValue({ task_id: "task-investigate" });
    renderDetail(sampleDetail());
    const reason =
      "This issue needs about 30,512 input tokens; the AI profile bound to Investigate error issue allows 16,384. Raise its input limit in AI models and try again.";

    await userEvent.click(investigateButton()!);
    const onFailed = pollTaskMock.mock.calls[0]![2] as (error?: string) => void;
    act(() => onFailed(reason));

    expect(toastMock.error).toHaveBeenCalledWith(reason);
    expect(screen.getByRole("alert")).toHaveTextContent(reason);
    expect(investigateButton()).toBeEnabled();
  });

  it("explains why the API refused an investigation", async () => {
    apiMock.mockRejectedValue(
      Object.assign(new Error('{"detail":"Action disabled"}'), {
        status: 503,
        code: "AI_ACTION_DISABLED",
      }),
    );
    renderDetail(sampleDetail());

    await userEvent.click(investigateButton()!);

    const text =
      "No usable model is bound to Investigate error issue. Bind one in AI models.";
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(toastMock.error).toHaveBeenCalledWith(text);
    expect(pollTaskMock).not.toHaveBeenCalled();
  });

  it("investigate is unavailable without a model, a digest or the capability", () => {
    llm.status = { available: false };
    const { unmount } = renderDetail(sampleDetail());
    expect(investigateButton()).toBeDisabled();
    expect(
      screen.getByText(
        "No usable model is bound to Investigate error issue. Bind one in AI models.",
      ),
    ).toBeInTheDocument();
    unmount();

    llm.status = { available: true };
    const second = renderDetail(
      sampleDetail({ digest: null, digest_hash: null }),
    );
    expect(investigateButton()).toBeDisabled();
    expect(
      screen.getByText(/Investigate needs the event summary/),
    ).toBeInTheDocument();
    second.unmount();

    renderDetail(sampleDetail(), { auth: only("ops.errors.view") });
    expect(investigateButton()).not.toBeInTheDocument();
  });

  it("says when automatic triage queued the latest event", () => {
    renderDetail(
      sampleDetail({
        auto_triage_queued_at: minutesAgo(4),
        triages: [
          sampleTriage({
            digest_hash: "an-earlier-event",
            summary: "Earlier event summary",
          }),
        ],
      }),
    );

    expect(
      screen.getByText(/Automatic triage queued this event/),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Queued/)).toBeInTheDocument();
    expect(
      screen.getByText(/An earlier event was assessed as bug, high severity/),
    ).toBeInTheDocument();
  });
});
