import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, pollTaskMock, toastMock, changedMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pollTaskMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  changedMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: pollTaskMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import type { ErrorFixRun } from "@/lib/error-inbox";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { sampleDetail, sampleFixRun } from "@/test/error-inbox-fixtures";

import { FixRunPanel } from "./FixRunPanel";

const only = (...granted: string[]) => ({
  hasCapability: (capability: string) => granted.includes(capability),
  hasAnyCapability: (required: readonly string[]) =>
    required.some((item) => granted.includes(item)),
});

const MANAGER = only("ops.errors.view", "ops.errors.manage");

function renderPanel(
  runs: ErrorFixRun[],
  auth: ReturnType<typeof only> = MANAGER,
) {
  const issue = sampleDetail({ fix_runs: runs });
  renderWithAdminProviders(
    <FixRunPanel issue={issue} onChanged={changedMock} />,
    { auth },
  );
  return issue;
}

const mergeButton = () =>
  screen.queryByRole("button", { name: "Approve & merge" });
const discardButton = () => screen.queryByRole("button", { name: "Discard" });

describe("FixRunPanel", () => {
  beforeEach(() => {
    apiMock.mockReset();
    pollTaskMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    changedMock.mockReset();
  });

  it("renders nothing without fix runs", () => {
    renderPanel([]);
    expect(screen.queryByText("Fix")).not.toBeInTheDocument();
  });

  it("shows the pull request, its checks and the actions", () => {
    const run = sampleFixRun();
    renderPanel([run]);

    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(
      screen.getByText("A draft pull request waits for review."),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /#412/ });
    expect(link).toHaveAttribute("href", run.pr_url);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: /Open PR/ })).toHaveAttribute(
      "href",
      run.pr_url,
    );
    expect(screen.getByText("Passing")).toBeInTheDocument();
    expect(screen.getByText("3b1f0c9")).toBeInTheDocument();
    expect(mergeButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();
  });

  it("explains why Approve & merge is unavailable", () => {
    renderPanel([
      sampleFixRun({
        pr_draft: false,
        ci_state: "pending",
        review: {
          can_merge: false,
          blockers: ["PR_NOT_LABELLED", "CHECKS_PENDING"],
          can_discard: true,
        },
      }),
    ]);

    expect(mergeButton()).toBeDisabled();
    expect(
      screen.getByText(
        /does not carry the autofix label\. The checks have not passed yet\./,
      ),
    ).toBeInTheDocument();
  });

  it("hides the actions from people who cannot manage errors", () => {
    renderPanel([sampleFixRun()], only("ops.errors.view"));

    expect(mergeButton()).not.toBeInTheDocument();
    expect(discardButton()).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /#412/ })).toBeInTheDocument();
  });

  it("asks before approving, sends the reviewed commit and waits for the task", async () => {
    const user = userEvent.setup();
    const run = sampleFixRun();
    const issue = renderPanel([run]);
    apiMock.mockResolvedValue({ task_id: "task-merge" });

    await user.click(mergeButton()!);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("marks the draft ready for review");
    expect(dialog).toHaveTextContent("branch protection still applies");
    await user.click(
      within(dialog).getByRole("button", { name: "Approve & merge" }),
    );

    expect(apiMock).toHaveBeenCalledWith(
      `/api/admin/errors/${issue.id}/fix-runs/${run.id}/merge`,
      "POST",
      { head_sha: run.pr_head_sha },
    );
    const [taskId, onComplete] = pollTaskMock.mock.calls[0]!;
    expect(taskId).toBe("task-merge");
    onComplete({ merged: false });
    expect(toastMock.success).toHaveBeenCalledWith(
      "Approved #412. Crate merges it once its checks pass.",
    );
    expect(changedMock).toHaveBeenCalled();
  });

  it("closes the dialog when the pull request moved meanwhile", async () => {
    const user = userEvent.setup();
    renderPanel([sampleFixRun()]);
    apiMock.mockRejectedValue(
      Object.assign(new Error("moved"), { code: "ERROR_FIX_HEAD_CHANGED" }),
    );

    await user.click(mergeButton()!);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Approve & merge",
      }),
    );

    expect(toastMock.error).toHaveBeenCalledWith(
      "The pull request changed since this page loaded. Review it again.",
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(changedMock).toHaveBeenCalled();
    expect(pollTaskMock).not.toHaveBeenCalled();
  });

  it("discards after a warning that names the pull request and branch", async () => {
    const user = userEvent.setup();
    const run = sampleFixRun();
    const issue = renderPanel([run]);
    apiMock.mockResolvedValue({ task_id: "task-discard" });

    await user.click(discardButton()!);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "closes pull request #412 and deletes its branch autofix/crate-api-1-18800000001",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Discard fix" }),
    );

    expect(apiMock).toHaveBeenCalledWith(
      `/api/admin/errors/${issue.id}/fix-runs/${run.id}/discard`,
      "POST",
      undefined,
    );
    const [, , onFailed] = pollTaskMock.mock.calls[0]!;
    onFailed("The GitHub token cannot do this (it needs Pull requests write)");
    expect(toastMock.error).toHaveBeenCalledWith(
      "The GitHub token cannot do this (it needs Pull requests write)",
    );
  });

  it("shows finished runs, earlier attempts and a branch Crate could not delete", () => {
    renderPanel([
      sampleFixRun({
        status: "merged",
        pr_state: "merged",
        pr_draft: false,
        summary: "Merged from Crate after the checks passed.",
        cleanup_state: "failed",
        review: {
          can_merge: false,
          blockers: ["FIX_RUN_NOT_OPEN"],
          can_discard: false,
        },
      }),
      sampleFixRun({
        id: "f1a00000-0000-4000-8000-000000000002",
        status: "expired",
        pr_number: null,
        pr_url: null,
        summary: "No pull request appeared within 6 hours.",
      }),
    ]);

    expect(screen.getAllByText("Merged").length).toBeGreaterThan(0);
    expect(mergeButton()).not.toBeInTheDocument();
    expect(discardButton()).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open PR/ })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("lacks Contents write");
    expect(screen.getByText("Earlier attempts")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});
