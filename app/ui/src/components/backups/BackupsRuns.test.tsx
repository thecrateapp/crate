import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, toastMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: vi.fn(), stopPolling: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@nivo/line", () => ({ ResponsiveLine: () => null }));

import { Backups } from "@/pages/Backups";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import {
  BACKUPS_NOW,
  OVERVIEW,
  POLICIES,
  POLICY_NIGHTLY,
  RUNS,
  runsPage,
} from "@/test/backups-fixtures";

import { runSize } from "./BackupsRuns";

const API = "/api/admin/backups";

function runsCalls() {
  return apiMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith(`${API}/runs?`))
    .map((url) => new URL(url, "http://x").searchParams);
}

function lastRunsCall() {
  const calls = runsCalls();
  return calls[calls.length - 1]!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BACKUPS_NOW);
  apiMock.mockReset();
  apiMock.mockImplementation(async (url: string, method = "GET") => {
    if (url === `${API}/overview`) return OVERVIEW;
    if (url === `${API}/policies`) return POLICIES;
    if (url.startsWith(`${API}/runs?`)) {
      const params = new URL(url, "http://x").searchParams;
      const status = params.get("status");
      const items = status ? RUNS.filter((r) => r.status === status) : RUNS;
      return runsPage(Number(params.get("offset")), 10, items);
    }
    if (method === "POST" && url === `${API}/run`) return { task_id: "t" };
    throw new Error(`Unexpected ${method} ${url}`);
  });
});

afterEach(() => vi.useRealTimers());

async function openRuns() {
  const user = userEvent.setup();
  renderWithAdminProviders(<Backups />, { route: "/backups?view=runs" });
  await screen.findByRole("table");
  return user;
}

describe("Backups runs", () => {
  it("lists the last 14 days of runs, newest first, with quiet successes", async () => {
    await openRuns();
    const [first] = runsCalls();
    expect(first!.get("limit")).toBe("50");
    expect(first!.get("offset")).toBe("0");
    expect(first!.get("since")).toBe(
      new Date(BACKUPS_NOW - 14 * 86_400_000).toISOString(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "13 runs in the last 14 days · 1 failed · 1 running",
    );
    const table = screen.getByRole("table");
    expect(within(table).getByText("Failed")).toHaveClass(
      "text-state-danger-text",
    );
    expect(within(table).getAllByText("Succeeded")[0]).toHaveAttribute(
      "data-tone",
      "off",
    );
    expect(within(table).getByText("3 min 41 s")).toBeInTheDocument();
    expect(within(table).getByText("a91f03c2")).toBeInTheDocument();
  });

  it("filters by status and destination", async () => {
    const user = await openRuns();
    await user.click(screen.getByRole("radio", { name: "Failed" }));
    await waitFor(() => expect(lastRunsCall().get("status")).toBe("failed"));
    expect(
      await screen.findByText(/1 run in the last 14 days/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Destination" }));
    await user.click(
      await screen.findByRole("option", { name: "Hetzner Storage Box" }),
    );
    await waitFor(() =>
      expect(lastRunsCall().get("destination_id")).toBe("dest-hetzner"),
    );
    await user.click(screen.getByRole("radio", { name: "Verify" }));
    await waitFor(() => expect(lastRunsCall().get("kind")).toBe("verify"));
  });

  it("pages with Load more", async () => {
    const user = await openRuns();
    expect(
      screen.getAllByRole("button", { name: /^Details of the/ }),
    ).toHaveLength(10);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /^Details of the/ }),
      ).toHaveLength(13),
    );
    expect(lastRunsCall().get("offset")).toBe("10");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("expands a failed run with its error, task link and a retry", async () => {
    const user = await openRuns();
    const toggle = screen.getByRole("button", {
      name: /Details of the Off-site run of .* to Hetzner Storage Box/,
    });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(/Permission denied \(publickey\)\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open task" })).toHaveAttribute(
      "href",
      "/tasks?task=7d2e5b1c9a41c",
    );
    expect(
      screen.getByRole("button", { name: "Copy error" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry now" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`${API}/run`, "POST", {
        kind: "backup",
        policy_id: POLICY_NIGHTLY,
      }),
    );
  });
});

describe("run sizes", () => {
  it("describes what each kind of run moved", () => {
    const byId = Object.fromEntries(RUNS.map((run) => [run.id, run]));
    expect(runSize(byId.r2!)).toBe("1.31 GB added");
    expect(runSize(byId.r4!)).toBe("1 dump deleted");
    expect(runSize(byId.r5!)).toBe("1.38 GB");
    expect(runSize(byId.r11!)).toBe("5% read");
    expect(runSize(byId.r13!)).toBe("48,212 tracks checked");
  });
});
