import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, useApiMock, pollTaskMock, refetchMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
  pollTaskMock: vi.fn(),
  refetchMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: pollTaskMock }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import type {
  ErrorIssueSummary,
  ErrorSummary,
  ErrorTrackingConnection,
} from "@/lib/error-inbox";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import {
  NOT_CONFIGURED_CONNECTION,
  NOT_CONFIGURED_SUMMARY,
  sampleConnection,
  sampleIssues,
  sampleSummary,
  sampleSync,
} from "@/test/error-inbox-fixtures";

import { Errors } from "./Errors";

function serve({
  summary = sampleSummary(),
  issues = sampleIssues(),
  connection = sampleConnection(),
}: {
  summary?: ErrorSummary;
  issues?: ErrorIssueSummary[];
  connection?: ErrorTrackingConnection;
} = {}) {
  useApiMock.mockImplementation((url: string | null) => ({
    data:
      url === "/api/admin/errors/summary"
        ? summary
        : url === "/api/admin/errors/connection"
          ? connection
          : null,
    loading: false,
    error: null,
    refetch: refetchMock,
  }));
  apiMock.mockImplementation(async (url: string, method = "GET") => {
    if (method === "PUT") return connection;
    const query = new URLSearchParams(url.split("?")[1]);
    const service = query.get("service");
    return {
      items: issues.filter((issue) => !service || issue.service === service),
      next_cursor: null,
    };
  });
}

function Location() {
  const location = useLocation();
  return (
    <output aria-label="Current location">
      {location.pathname}
      {location.search}
    </output>
  );
}

const only = (...granted: string[]) => ({
  hasCapability: (capability: string) => granted.includes(capability),
  hasAnyCapability: (required: readonly string[]) =>
    required.some((item) => granted.includes(item)),
});

async function issueTable() {
  return screen.findByRole("table", { name: /Error issues/ });
}

describe("Errors", () => {
  beforeEach(() => {
    apiMock.mockReset();
    useApiMock.mockReset();
    pollTaskMock.mockReset();
    refetchMock.mockReset();
  });

  it("renders critical lane first", async () => {
    // The API order puts a low-priority issue first; the lane still leads.
    serve({ issues: [...sampleIssues()].reverse() });
    renderWithAdminProviders(<Errors />, { route: "/errors" });

    const table = await issueTable();
    const lanes = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent)
      .filter((text) => /lane|Everything/.test(text ?? ""));
    expect(lanes).toEqual(["Critical lane · 3", "Everything else · 4"]);

    const order = within(table)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(order.slice(0, 3)).toEqual([
      "UpstreamUnavailable: api-unavailable (502)",
      'IntegrityError: duplicate key value violates unique constraint "library_tracks_path_key"',
      "java.lang.IllegalStateException: MediaSession was released before playback resumed",
    ]);
    expect(order[order.length - 1]).toBe(
      "ResizeObserver loop completed with undelivered notifications",
    );
  });

  it("groups by group key", async () => {
    serve();
    renderWithAdminProviders(<Errors />, { route: "/errors" });

    const table = await issueTable();
    const toggle = within(table).getByRole("button", {
      name: /Show 3 similar issues/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      within(table).queryAllByRole("link", {
        name: "TypeError: Failed to fetch",
      }),
    ).toHaveLength(0);
    // Totals of the three duplicates: 12 + 7 + 2 events.
    const groupRow = toggle.closest("tr")!;
    expect(within(groupRow).getByText("21")).toBeInTheDocument();
    expect(within(groupRow).getByText("3 issues")).toBeInTheDocument();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(table).getAllByRole("link", {
        name: "TypeError: Failed to fetch",
      }),
    ).toHaveLength(3);
  });

  it("shows not configured state", async () => {
    serve({
      summary: NOT_CONFIGURED_SUMMARY,
      issues: [],
      connection: NOT_CONFIGURED_CONNECTION,
    });
    renderWithAdminProviders(<Errors />, {
      route: "/errors",
      auth: only("ops.errors.view", "ops.runtime.manage"),
    });

    expect(
      screen.getByRole("heading", { name: "Error tracking is not set up" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open the Sentry connection" }),
    ).toBeInTheDocument();
    // The settings live in the drawer, not in the page body.
    expect(
      screen.queryByRole("form", { name: "Sentry connection settings" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // Nothing to list until a connection exists.
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("not configured state opens the drawer", async () => {
    serve({
      summary: NOT_CONFIGURED_SUMMARY,
      issues: [],
      connection: NOT_CONFIGURED_CONNECTION,
    });
    renderWithAdminProviders(<Errors />, {
      route: "/errors",
      auth: only("ops.errors.view", "ops.runtime.manage"),
    });

    const cta = screen.getByRole("button", {
      name: "Open the Sentry connection",
    });
    await userEvent.click(cta);

    const drawer = await screen.findByRole("dialog", {
      name: "Sentry connection",
    });
    expect(
      within(drawer).getByRole("form", { name: "Sentry connection settings" }),
    ).toBeInTheDocument();
    expect(within(drawer).getByText("Not configured")).toBeInTheDocument();
    expect(within(drawer).getByLabelText("Token")).toBeRequired();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(cta).toHaveFocus());
  });

  it("opens the Sentry connection in a side drawer", async () => {
    serve();
    renderWithAdminProviders(<Errors />, {
      route: "/errors",
      auth: only("ops.errors.view", "ops.runtime.manage"),
    });
    await issueTable();

    const trigger = screen.getByRole("button", { name: /^Sentry connection/ });
    expect(trigger).toHaveAccessibleName("Sentry connection, connected");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("form", { name: "Sentry connection settings" }),
    ).not.toBeInTheDocument();

    await userEvent.click(trigger);

    const drawer = await screen.findByRole("dialog", {
      name: "Sentry connection",
    });
    expect(drawer).toHaveAttribute("data-side", "right");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Status first, then the settings form.
    const status = within(drawer).getByRole("region", { name: "Status" });
    const settings = within(drawer).getByRole("region", { name: "Settings" });
    expect(
      status.compareDocumentPosition(settings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(status).getByText("Connected")).toBeInTheDocument();
    expect(
      within(status).getByRole("button", { name: "Test connection" }),
    ).toBeEnabled();

    // Saving keeps the drawer open and refreshes the page data.
    await userEvent.click(within(drawer).getByRole("button", { name: "Save" }));
    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/errors/connection",
      "PUT",
      expect.objectContaining({ organization: "example-org" }),
    );
    expect(refetchMock).toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Sentry connection" }),
    ).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("hides the connection button without runtime manage", async () => {
    serve();
    renderWithAdminProviders(<Errors />, {
      route: "/errors",
      auth: only("ops.errors.view"),
    });
    await issueTable();

    expect(
      screen.queryByRole("button", { name: /Sentry connection/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("points viewers without runtime access to someone who has it", () => {
    serve({ summary: NOT_CONFIGURED_SUMMARY, issues: [] });
    renderWithAdminProviders(<Errors />, {
      route: "/errors",
      auth: only("ops.errors.view"),
    });

    expect(
      screen.getByText(/Someone who manages the runtime can fix it/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open the Sentry connection" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Sentry connection settings" }),
    ).not.toBeInTheDocument();
  });

  it("shows connection error state", async () => {
    serve({
      summary: sampleSummary({
        sync: sampleSync({
          status: "failed",
          error_code: "SENTRY_AUTH",
          last_success_at: null,
        }),
      }),
      issues: [],
    });
    renderWithAdminProviders(<Errors />, { route: "/errors" });

    expect(
      await screen.findByRole("heading", { name: "Sentry rejected the token" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/It may have been revoked or mistyped/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Last sync failed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Sentry connection/ }),
    ).toHaveAccessibleName("Sentry connection, needs attention");

    await userEvent.click(
      screen.getByRole("button", { name: "Open the Sentry connection" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Sentry connection" }),
    ).toBeInTheDocument();
  });

  it("keeps the last good issues visible when Sentry is unreachable", async () => {
    serve({
      summary: sampleSummary({
        sync: sampleSync({
          status: "failed",
          error_code: "SENTRY_UNAVAILABLE",
        }),
      }),
    });
    renderWithAdminProviders(<Errors />, { route: "/errors" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Crate could not reach Sentry");
    expect(alert).toHaveTextContent("Showing issues from the last good sync");
    // Waiting fixes it: no pointer to the connection settings.
    expect(
      within(alert).queryByRole("button", {
        name: "Open the Sentry connection",
      }),
    ).not.toBeInTheDocument();
    expect(await issueTable()).toBeInTheDocument();
  });

  it("filters by service", async () => {
    serve();
    renderWithAdminProviders(
      <>
        <Errors />
        <Location />
      </>,
      { route: "/errors" },
    );
    await issueTable();

    await userEvent.click(screen.getByRole("combobox", { name: "Service" }));
    await userEvent.click(
      await screen.findByRole("option", { name: /readplane/ }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith(
        expect.stringContaining("service=readplane"),
      ),
    );
    expect(
      screen.getByRole("status", { name: "Current location" }),
    ).toHaveTextContent("/errors?service=readplane");
    const table = await issueTable();
    await waitFor(() =>
      expect(
        within(table)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["UpstreamUnavailable: api-unavailable (502)"]),
    );
  });

  it("explains an empty filter result and clears it", async () => {
    serve({ issues: [] });
    renderWithAdminProviders(
      <>
        <Errors />
        <Location />
      </>,
      { route: "/errors?lane=critical&service=admin" },
    );

    expect(
      await screen.findByRole("heading", { name: "No matching issues" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear filters" }),
    );
    expect(
      screen.getByRole("status", { name: "Current location" }),
    ).toHaveTextContent(/^\/errors$/);
  });

  it("says when nothing is open", async () => {
    serve({ issues: [] });
    renderWithAdminProviders(<Errors />, { route: "/errors" });

    expect(
      await screen.findByRole("heading", { name: "No open issues" }),
    ).toBeInTheDocument();
  });
});
