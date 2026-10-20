import { createElement, type FunctionComponent } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import {
  migratedSnapshot,
  PROFILE_ID,
  STUDIO_ID,
  usageFixture,
} from "./test-fixtures";
import type { Activity, Invocation, Usage } from "./types";

const { apiMock, useApiMock, barProps } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
  barProps: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@nivo/bar", () => ({
  ResponsiveBar: (props: Record<string, unknown>) => {
    barProps.push(props);
    return null;
  },
}));

import { AiModels } from "@/pages/AiModels";

import { ActivityPanel } from "./ActivityPanel";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const REFINE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PROBE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

const refine: Invocation = {
  id: REFINE_ID,
  connection_id: STUDIO_ID,
  invocation_kind: "action",
  action_id: "music_paths.refine",
  profile_id: PROFILE_ID,
  profile_version: 1,
  model_id: "gemini-3.8-flash",
  reported_model: "gemini-3.8-flash-001",
  actor_id: 1,
  job_id: "job-7",
  status: "succeeded",
  input_tokens: 53,
  output_tokens: 5,
  thought_tokens: null,
  cached_input_tokens: null,
  total_tokens: 58,
  charged_tokens: 58,
  reserved_tokens: 4149,
  metering_mode: "enforced",
  usage_known: true,
  error_code: null,
  duration_ms: 3500,
  estimated_cost: null,
  created_at: minutesAgo(5),
};

const probe: Invocation = {
  ...refine,
  id: PROBE_ID,
  invocation_kind: "probe",
  action_id: null,
  reported_model: null,
  job_id: "job-9",
  status: "timeout",
  input_tokens: null,
  output_tokens: null,
  total_tokens: null,
  charged_tokens: 0,
  usage_known: false,
  error_code: "AI_PROVIDER_TIMEOUT",
  duration_ms: 45000,
  created_at: minutesAgo(90),
};

const firstPage: Activity = { items: [refine], next_cursor: "next" };
const secondPage: Activity = { items: [probe], next_cursor: null };
const filteredPage: Activity = { items: [], next_cursor: null };

function mockApi(usage: Usage | null = usageFixture(NOW)) {
  const snapshot = migratedSnapshot();
  useApiMock.mockReset().mockImplementation((url: string | null) => ({
    data: url?.endsWith("/snapshot")
      ? snapshot
      : url?.endsWith("/usage")
        ? usage
        : url?.includes("/activity")
          ? url.includes("action_id=")
            ? filteredPage
            : url.includes("cursor=next")
              ? secondPage
              : firstPage
          : null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
}

function renderPanel(
  usage: Usage | null = usageFixture(NOW),
  capabilities?: string[],
) {
  mockApi(usage);
  return renderWithAdminProviders(
    <ActivityPanel snapshot={migratedSnapshot()} usage={usage} />,
    capabilities
      ? { auth: { hasCapability: (cap) => capabilities.includes(cap) } }
      : {},
  );
}

function last<T>(items: T[]): T | undefined {
  return items[items.length - 1];
}

function activityUrls(): string[] {
  return useApiMock.mock.calls
    .map(([url]) => url as string | null)
    .filter((url): url is string => !!url && url.includes("/activity"));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  apiMock.mockReset();
  barProps.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivityPanel", () => {
  it("lists activity with readable features, tokens, duration and result", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Activity" })).toBeVisible();
    expect(
      screen.getByText("Calls Crate made to models in the last 90 days."),
    ).toBeVisible();
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Feature", "Model", "Tokens", "Duration", "Result", "When"]);

    const row = within(table).getByRole("row", { name: /Refine Music Path/ });
    expect(row).toHaveTextContent("Refine Music Path");
    expect(row).toHaveTextContent("gemini-3.8-flash");
    expect(row).toHaveTextContent("53 in · 5 out");
    expect(row).toHaveTextContent("3.5 s");
    expect(row).toHaveTextContent("Succeeded");
    const time = row.querySelector("time");
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute("title");
    expect(time?.getAttribute("title")).not.toBe("");
    expect(time).toHaveTextContent("5 minutes ago");

    const list = screen.getByRole("list", { name: "Recent calls" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByRole("listitem")).toHaveTextContent(
      "Refine Music Path",
    );

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(UUID);
    expect(text).not.toContain("music_paths.refine");
  });

  it("opens invocation details in a side sheet with unknown cost", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "Refine Music Path",
      }),
    );
    const sheet = await screen.findByRole("dialog", {
      name: "Refine Music Path",
    });
    const field = (label: string) =>
      within(sheet).getByText(label, { selector: "dt" }).closest("div");

    expect(field("Cost")).toHaveTextContent("Unknown");
    expect(field("Model")).toHaveTextContent("gemini-3.8-flash");
    expect(
      within(sheet).getByText("Reported as gemini-3.8-flash-001"),
    ).toBeVisible();
    expect(field("Result")).toHaveTextContent("Succeeded");
    expect(field("Duration")).toHaveTextContent("3.5 s");
    expect(field("Input")).toHaveTextContent("53");
    expect(field("Cached input")).toHaveTextContent("Unknown");
    expect(field("Output")).toHaveTextContent("5");
    expect(field("Thinking")).toHaveTextContent("Unknown");
    expect(field("Total")).toHaveTextContent("58");
    expect(field("Reserved")).toHaveTextContent("4,149");
    expect(field("Charged")).toHaveTextContent("58");
    expect(field("Usage")).toHaveTextContent("Known");
    expect(
      within(sheet).getByRole("link", { name: "View job" }),
    ).toHaveAttribute("href", "/tasks?task_id=job-7");

    expect(document.body.textContent).not.toContain(REFINE_ID);
    await user.click(
      within(sheet).getByRole("button", { name: "Technical details" }),
    );
    expect(within(sheet).getByText(REFINE_ID)).toBeVisible();
    expect(
      within(sheet).getByText("job-7", { selector: "code" }),
    ).toBeVisible();
  });

  it("explains a failed compatibility test without its error code", async () => {
    const user = userEvent.setup();
    renderPanel(usageFixture(NOW), ["ai.config.read", "ai.usage.read"]);

    await user.click(screen.getByRole("button", { name: "Load more" }));
    const table = screen.getByRole("table");
    const row = within(table).getByRole("row", { name: /Compatibility test/ });
    expect(row).toHaveTextContent("Unknown");
    expect(row).toHaveTextContent("45.0 s");
    expect(row).toHaveTextContent("Timed out");

    await user.click(
      within(row).getByRole("button", { name: "Compatibility test" }),
    );
    const sheet = await screen.findByRole("dialog", {
      name: "Compatibility test",
    });
    const field = (label: string) =>
      within(sheet).getByText(label, { selector: "dt" }).closest("div");
    expect(field("Error")).toHaveTextContent(
      "The provider didn't answer in time",
    );
    expect(field("Usage")).toHaveTextContent("Not reported");
    expect(field("Input")).toHaveTextContent("Unknown");
    expect(
      within(sheet).queryByRole("link", { name: "View job" }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("AI_PROVIDER_TIMEOUT");

    await user.click(
      within(sheet).getByRole("button", { name: "Technical details" }),
    );
    expect(within(sheet).getByText("AI_PROVIDER_TIMEOUT")).toBeVisible();
  });

  it("loads more activity with the cursor", async () => {
    const user = userEvent.setup();
    renderPanel();

    const table = screen.getByRole("table");
    expect(
      within(table).queryByRole("row", { name: /Compatibility test/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(useApiMock).toHaveBeenCalledWith(
      expect.stringContaining("limit=50&cursor=next"),
    );
    expect(
      within(table).getByRole("row", { name: /Refine Music Path/ }),
    ).toBeVisible();
    expect(
      within(table).getByRole("row", { name: /Compatibility test/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("filters by feature and starts again from the first page", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      3,
    );

    await user.click(screen.getByRole("button", { name: "Feature" }));
    await user.click(
      await screen.findByRole("button", { name: "Propose genre EQ" }),
    );

    await waitFor(() =>
      expect(last(activityUrls())).toBe(
        "/api/admin/ai/activity?limit=50&action_id=genres.eq.propose",
      ),
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No calls for this feature yet.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("charts daily calls with Nivo", () => {
    renderPanel();

    expect(
      screen.getByRole("figure", { name: "Daily calls, last 30 days" }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Daily calls, last 30 days" }),
    ).toBeVisible();

    const props = last(barProps)!;
    const data = props.data as {
      day: string;
      Completed: number;
      Failed: number;
      tokens: number;
    }[];
    expect(data).toHaveLength(30);
    expect(props.keys).toEqual(["Completed", "Failed"]);
    expect(props.indexBy).toBe("day");
    expect(props.groupMode).toBe("stacked");
    expect(last(data)).toEqual({
      day: "2026-10-20",
      Completed: 3,
      Failed: 1,
      tokens: 1200,
    });

    const colors = props.colors as (bar: { id: string }) => string;
    expect(colors({ id: "Completed" })).toBe("#06b6d4");
    expect(colors({ id: "Failed" })).toBe("#f87171");

    const axis = props.axisBottom as {
      tickValues: string[];
      format: (value: string) => string;
    };
    expect(axis.tickValues).toEqual([
      "2026-09-22",
      "2026-09-29",
      "2026-10-06",
      "2026-10-13",
      "2026-10-20",
    ]);
    expect(axis.format("2026-10-12")).toBe("Oct 12");

    const Tooltip = props.tooltip as FunctionComponent<{
      data: (typeof data)[number];
    }>;
    render(createElement(Tooltip, { data: last(data)! }));
    expect(screen.getByText("Oct 20: 4 calls · 1,200 tokens")).toBeVisible();
  });

  it("explains missing usage history", () => {
    renderPanel({
      ...usageFixture(NOW),
      legacy_usage_unknown: true,
      truncated: true,
    });

    expect(
      screen.getByText("Usage from before setup is not known."),
    ).toBeVisible();
    expect(screen.getByText("Older daily totals are not shown.")).toBeVisible();
  });

  it("removes the engine inventory", () => {
    mockApi();
    renderWithAdminProviders(<AiModels />);

    expect(screen.getByRole("heading", { name: "Advanced" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Activity" })).toBeVisible();
    expect(screen.queryByText(/Engine inventory/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tesseract OCR/)).not.toBeInTheDocument();
  });
});
