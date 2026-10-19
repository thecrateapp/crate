import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import { AuthContext } from "@/contexts/AuthContext";
import { createMockAuthValue } from "@/test/render-with-admin-providers";
import {
  AGENT_PLANS_CHANGED_EVENT,
  notifyAgentPlansChanged,
  usePendingApprovals,
} from "./use-pending-approvals";

function wrapperFor(capabilities: string[]) {
  const authValue = createMockAuthValue({
    hasAnyCapability: (required: readonly string[]) =>
      required.some((capability) => capabilities.includes(capability)),
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
    );
  };
}

beforeEach(() => {
  apiMock.mockReset();
});

describe("usePendingApprovals", () => {
  it("fetches the summary and returns the awaiting count with the review capability", async () => {
    apiMock.mockResolvedValue({ awaiting_approval: 3 });

    const { result } = renderHook(() => usePendingApprovals(), {
      wrapper: wrapperFor(["agents.plans.review"]),
    });

    await waitFor(() => expect(result.current).toBe(3));
    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/agent-plans/summary",
      "GET",
      undefined,
      expect.any(Object),
    );
  });

  it("refetches after notifyAgentPlansChanged is dispatched", async () => {
    apiMock.mockResolvedValue({ awaiting_approval: 1 });

    const { result } = renderHook(() => usePendingApprovals(), {
      wrapper: wrapperFor(["agents.plans.review"]),
    });
    await waitFor(() => expect(result.current).toBe(1));
    expect(apiMock).toHaveBeenCalledTimes(1);

    apiMock.mockResolvedValue({ awaiting_approval: 5 });
    act(() => {
      notifyAgentPlansChanged();
    });

    await waitFor(() => expect(result.current).toBe(5));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("never calls the API and returns 0 without the review capability", () => {
    const { result } = renderHook(() => usePendingApprovals(), {
      wrapper: wrapperFor([]),
    });

    expect(result.current).toBe(0);
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("AGENT_PLANS_CHANGED_EVENT", () => {
  it("is the event name notifyAgentPlansChanged dispatches on window", () => {
    const handler = vi.fn();
    window.addEventListener(AGENT_PLANS_CHANGED_EVENT, handler);
    notifyAgentPlansChanged();
    window.removeEventListener(AGENT_PLANS_CHANGED_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
