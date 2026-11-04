import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, useApiMock, pollTaskMock, refetchMock, toastMock } =
  vi.hoisted(() => ({
    apiMock: vi.fn(),
    useApiMock: vi.fn(),
    pollTaskMock: vi.fn(),
    refetchMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
  }));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: pollTaskMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import type { ErrorIssueDetail } from "@/lib/error-inbox";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { sampleDetail } from "@/test/error-inbox-fixtures";

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

describe("ErrorDetail", () => {
  beforeEach(() => {
    apiMock.mockReset();
    useApiMock.mockReset();
    pollTaskMock.mockReset();
    refetchMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
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
    expect(screen.getByText("Not triaged yet")).toBeInTheDocument();
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
});
