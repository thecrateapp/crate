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
} from "@/test/backups-fixtures";

import {
  policyPayload,
  validatePolicy,
  type PolicyDraft,
} from "./BackupsPolicies";

const API = "/api/admin/backups";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BACKUPS_NOW);
  apiMock.mockReset();
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  apiMock.mockImplementation(
    async (url: string, method = "GET", body?: unknown) => {
      if (url === `${API}/overview`) return OVERVIEW;
      if (url === `${API}/policies` && method === "GET") return POLICIES;
      if (method === "PATCH" && url.startsWith(`${API}/policies/`))
        return { ...POLICIES[0], ...(body as object) };
      if (method === "POST" && url === `${API}/policies`)
        return { ...POLICIES[0], ...(body as object), id: "new-id" };
      if (method === "PUT" && url === `${API}/local-retention`) return body;
      throw new Error(`Unexpected ${method} ${url}`);
    },
  );
});

afterEach(() => vi.useRealTimers());

async function openPolicies() {
  const user = userEvent.setup();
  renderWithAdminProviders(<Backups />, { route: "/backups?view=policies" });
  await screen.findByRole("list", { name: "Backup policies" });
  return user;
}

describe("Backups policies", () => {
  it("lists the policies, the manual Before upgrades one included", async () => {
    await openPolicies();
    const list = screen.getByRole("list", { name: "Backup policies" });
    expect(
      within(list).getByText("Daily 03:30 · 4 destinations"),
    ).toBeInTheDocument();
    expect(
      within(list).getByText("Manual only · 2 destinations"),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Policy name" })).toHaveValue(
      "Nightly",
    );
    expect(
      screen.getByText(/Keeps up to 13 copies, about 17.9 GB per destination/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/local dumps keep their own counts \(3\/4\/3\)/),
    ).toBeInTheDocument();
  });

  it("shows the run-before-upgrade switch for manual policies", async () => {
    const user = await openPolicies();
    await user.click(screen.getByRole("button", { name: /Before upgrades/ }));
    expect(
      screen.getByRole("switch", { name: "Run before upgrades" }),
    ).toBeChecked();
    expect(
      screen.queryByRole("switch", { name: "Only start inside a window" }),
    ).toBeNull();
  });

  it("keeps untested and disabled destinations out of the tier matrix", async () => {
    const user = await openPolicies();
    expect(
      screen.getByRole("checkbox", { name: "Daily copies to Dropbox" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Weekly copies to MinIO at home" }),
    ).toBeDisabled();
    expect(screen.getByText("Test the connection first")).toBeInTheDocument();
    expect(screen.getByText("Destination disabled")).toBeInTheDocument();
    const hetznerDaily = screen.getByRole("checkbox", {
      name: "Daily copies to Hetzner Storage Box",
    });
    expect(hetznerDaily).not.toBeChecked();
    await user.click(hetznerDaily);
    await user.click(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${API}/policies/${POLICY_NIGHTLY}`,
        "PATCH",
        expect.objectContaining({
          destinations: {
            "dest-local": ["daily", "weekly"],
            "dest-r2": ["daily", "weekly", "monthly"],
            "dest-gdrive": ["daily", "weekly", "monthly"],
            "dest-hetzner": ["daily", "weekly", "monthly"],
          },
        }),
      ),
    );
  });

  it("refuses an invalid policy at its fields before sending it", async () => {
    const user = await openPolicies();
    await user.click(screen.getByRole("button", { name: "New policy" }));
    expect(screen.getByRole("textbox", { name: "Policy name" })).toHaveValue(
      "",
    );
    await user.clear(
      screen.getByRole("textbox", { name: "Daily time, HH:MM" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Daily time, HH:MM" }),
      "25:00",
    );
    await user.click(screen.getByRole("button", { name: "Create policy" }));
    expect(
      await screen.findByText("The policy needs a name of 1 to 80 characters."),
    ).toBeInTheDocument();
    expect(screen.getByText("Use a time of day as HH:MM.")).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith(
      `${API}/policies`,
      "POST",
      expect.anything(),
    );

    await user.type(
      screen.getByRole("textbox", { name: "Policy name" }),
      "Hourly",
    );
    await user.click(screen.getByRole("radio", { name: "Every N hours" }));
    await user.clear(screen.getByRole("spinbutton", { name: "Every N hours" }));
    await user.type(
      screen.getByRole("spinbutton", { name: "Every N hours" }),
      "6",
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Daily copies to Cloudflare R2" }),
    );
    await user.click(screen.getByRole("button", { name: "Create policy" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${API}/policies`,
        "POST",
        expect.objectContaining({
          name: "Hourly",
          schedule_kind: "hours",
          interval_hours: 6,
          daily_at: null,
          window_start: null,
          destinations: { "dest-r2": ["daily"] },
        }),
      ),
    );
  });

  it("saves the local dump counts apart from the policies", async () => {
    const user = await openPolicies();
    const daily = screen.getByRole("spinbutton", {
      name: "Local dumps kept daily",
    });
    expect(daily).toHaveValue(3);
    await user.clear(daily);
    await user.type(daily, "5");
    await user.click(
      screen.getByRole("button", { name: "Save local retention" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`${API}/local-retention`, "PUT", {
        keep_daily: 5,
        keep_weekly: 4,
        keep_monthly: 3,
      }),
    );
  });
});

describe("policy validation", () => {
  const base: PolicyDraft = {
    name: "Nightly",
    enabled: true,
    schedule_kind: "daily",
    daily_at: "03:30",
    interval_hours: "6",
    window: true,
    window_start: "02:00",
    window_end: "06:00",
    keep_daily: "7",
    keep_weekly: "4",
    keep_monthly: "3",
    compression: "auto",
    verify_every_days: "7",
    verify_read_percent: "5",
    drill_every_days: "30",
    drill_source: "rotate",
    run_before_upgrade: false,
    destinations: { a: ["daily"], b: [] },
  };

  it("accepts a valid policy and drops destinations without tiers", () => {
    expect(validatePolicy(base)).toEqual({});
    expect(policyPayload(base)).toMatchObject({
      window_start: "02:00",
      drill_destination_id: null,
      destinations: { a: ["daily"] },
    });
  });

  it("needs at least one copy and a whole read percent", () => {
    expect(
      validatePolicy({
        ...base,
        keep_daily: "0",
        keep_weekly: "0",
        keep_monthly: "0",
      }).keep,
    ).toBe("Keep at least one copy.");
    expect(
      validatePolicy({ ...base, verify_read_percent: "0" }).verify_every_days,
    ).toBeTruthy();
    expect(
      validatePolicy({ ...base, window_end: "" }).window_start,
    ).toBeTruthy();
  });

  it("sends no window for a manual policy", () => {
    expect(policyPayload({ ...base, schedule_kind: "manual" })).toMatchObject({
      daily_at: null,
      window_start: null,
      window_end: null,
    });
  });
});
