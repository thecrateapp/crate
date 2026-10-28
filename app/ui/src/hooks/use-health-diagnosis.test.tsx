import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";

import { diagnosisMessage, useHealthDiagnosis } from "./use-health-diagnosis";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/lib/tasks", () => ({ waitForTask: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function completed(result: Record<string, unknown>) {
  return { status: "completed", result } as Awaited<
    ReturnType<typeof waitForTask>
  >;
}

describe("useHealthDiagnosis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue({ task_id: "task-1" });
  });

  it("reports a clean diagnosis and refreshes the page", async () => {
    vi.mocked(waitForTask).mockResolvedValue(completed({ issue_count: 0 }));
    const onFinished = vi.fn();
    const { result } = renderHook(
      () =>
        useHealthDiagnosis({
          endpoint: "/api/manage/artists/7/health-recheck",
          onFinished,
        }),
      { wrapper },
    );

    await act(() => result.current.diagnose());

    expect(toast.success).toHaveBeenCalledWith(
      "Diagnosis found no issues",
      undefined,
    );
    expect(onFinished).toHaveBeenCalledOnce();
    expect(result.current.diagnosing).toBe(false);
  });

  it("reports a failed diagnosis without refreshing", async () => {
    vi.mocked(waitForTask).mockResolvedValue({ status: "failed" } as Awaited<
      ReturnType<typeof waitForTask>
    >);
    const onFinished = vi.fn();
    const { result } = renderHook(
      () => useHealthDiagnosis({ endpoint: "/api/x", onFinished }),
      { wrapper },
    );

    await act(() => result.current.diagnose());

    expect(toast.error).toHaveBeenCalledWith("Diagnosis failed");
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("does not wait when the server reports a diagnosis already running", async () => {
    vi.mocked(api).mockResolvedValue({ task_id: "" });
    const { result } = renderHook(
      () => useHealthDiagnosis({ endpoint: "/api/x" }),
      { wrapper },
    );

    await act(() => result.current.diagnose());

    expect(toast.info).toHaveBeenCalledWith("A diagnosis is already running");
    expect(waitForTask).not.toHaveBeenCalled();
  });

  it("pluralizes the finding count", () => {
    expect(diagnosisMessage(1)).toBe("Diagnosis found 1 issue");
    expect(diagnosisMessage(3)).toBe("Diagnosis found 3 issues");
  });
});
