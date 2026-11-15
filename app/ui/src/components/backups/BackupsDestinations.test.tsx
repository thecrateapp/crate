import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, pollTask, toastMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pollTask: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask, stopPolling: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@nivo/line", () => ({ ResponsiveLine: () => null }));

import { Backups } from "@/pages/Backups";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import {
  BACKUPS_NOW,
  OVERVIEW,
  POLICIES,
  PROVIDERS,
  SNAPSHOTS,
} from "@/test/backups-fixtures";

const API = "/api/admin/backups";

function routeApi(
  extra: (url: string, method: string, body: unknown) => unknown = () =>
    undefined,
) {
  apiMock.mockImplementation(
    async (url: string, method = "GET", body?: unknown) => {
      const custom = extra(url, method, body);
      if (custom !== undefined) return custom;
      if (url === `${API}/overview`) return OVERVIEW;
      if (url === `${API}/policies`) return POLICIES;
      if (url === `${API}/providers`) return PROVIDERS;
      if (url === `${API}/destinations/dest-r2/snapshots`) return SNAPSHOTS;
      if (method === "POST" && url.endsWith("/test"))
        return { task_id: "task-test" };
      throw new Error(`Unexpected ${method} ${url}`);
    },
  );
}

/** Completes the last followed task with this result. */
function completeTask(result: Record<string, unknown>) {
  const call = pollTask.mock.calls[pollTask.mock.calls.length - 1]!;
  act(() => (call[1] as (r: Record<string, unknown>) => void)(result));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BACKUPS_NOW);
  apiMock.mockReset();
  pollTask.mockReset();
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  routeApi();
});

afterEach(() => vi.useRealTimers());

async function openDestinations() {
  const user = userEvent.setup();
  renderWithAdminProviders(<Backups />, {
    route: "/backups?view=destinations",
  });
  await screen.findByRole("table");
  return user;
}

describe("Backups destinations", () => {
  it("lists every destination with its kind, status and size", async () => {
    await openDestinations();
    const table = screen.getByRole("table");
    expect(within(table).getByText("S3 · Cloudflare R2")).toBeInTheDocument();
    expect(within(table).getByText("S3 · MinIO")).toBeInTheDocument();
    expect(within(table).getByText("17.9 GB")).toBeInTheDocument();
    expect(within(table).getByText("Failing")).toHaveClass(
      "text-state-danger-text",
    );
    expect(within(table).getByText("Not connected")).toBeInTheDocument();
  });

  it("keeps the enabled toggle off until the first test passes", async () => {
    const user = await openDestinations();
    expect(
      screen.getByRole("switch", { name: "Dropbox enabled" }),
    ).toBeDisabled();
    const minio = screen.getByRole("switch", { name: "MinIO at home enabled" });
    expect(minio).toBeEnabled();
    expect(minio).not.toBeChecked();
    routeApi((url, method) =>
      method === "PATCH" && url === `${API}/destinations/dest-minio`
        ? { ...OVERVIEW.destinations[5], enabled: true }
        : undefined,
    );
    await user.click(minio);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${API}/destinations/dest-minio`,
        "PATCH",
        {
          enabled: true,
        },
      ),
    );
  });

  it("tests a saved destination from its row and reports the result", async () => {
    const user = await openDestinations();
    await user.click(
      screen.getByRole("button", { name: "Test Cloudflare R2" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${API}/destinations/dest-r2/test`,
        "POST",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Test Cloudflare R2" }),
    ).toHaveAttribute("aria-busy", "true");
    completeTask({ connection: { status: "ok", snapshot_count: 14 } });
    expect(toastMock.success).toHaveBeenCalledWith(
      "Cloudflare R2: connection works",
    );
  });

  it("adds a destination in the side drawer, testing the unsaved settings first", async () => {
    const user = await openDestinations();
    await user.click(screen.getByRole("button", { name: "Add destination" }));
    const drawer = await screen.findByRole("dialog");
    expect(drawer).toHaveAttribute("data-slot", "sheet-content");
    await user.click(
      within(drawer).getByRole("radio", { name: /Backblaze B2/ }),
    );
    await user.click(within(drawer).getByRole("button", { name: "Continue" }));
    expect(
      within(drawer).getByRole("heading", { name: "Backblaze B2" }),
    ).toBeInTheDocument();
    await user.type(within(drawer).getByLabelText("Bucket"), "crate-backups");
    await user.type(
      within(drawer).getByLabelText("Application key ID"),
      "005abc",
    );
    await user.type(
      within(drawer).getByLabelText("Application key"),
      "K005secret",
    );
    await user.click(
      within(drawer).getByRole("button", { name: "Test connection" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`${API}/destinations/test`, "POST", {
        kind: "b2",
        config: { bucket: "crate-backups", prefix: "" },
        secrets: { key_id: "005abc", application_key: "K005secret" },
      }),
    );
    expect(
      within(drawer).getByText("Testing the connection"),
    ).toBeInTheDocument();
    completeTask({ connection: { status: "ok", repository: "empty" } });
    expect(
      await within(drawer).findByText("Connection works"),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByText(/No repository there yet/),
    ).toBeInTheDocument();

    const created = {
      ...OVERVIEW.destinations[1],
      id: "dest-b2",
      kind: "b2",
      name: "Backblaze B2",
      config: { bucket: "crate-backups", prefix: "" },
      secrets_set: ["application_key", "key_id"],
      enabled: false,
      status: "untested",
      repository_initialized_at: null,
    };
    routeApi((url, method) => {
      if (method === "POST" && url === `${API}/destinations`) return created;
      if (method === "POST" && url === `${API}/destinations/dest-b2/test`)
        return { task_id: "task-saved" };
      return undefined;
    });
    await user.click(
      within(drawer).getByRole("button", { name: "Save destination" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`${API}/destinations`, "POST", {
        kind: "b2",
        name: "Backblaze B2",
        config: { bucket: "crate-backups", prefix: "" },
        secrets: { key_id: "005abc", application_key: "K005secret" },
      }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${API}/destinations/dest-b2/test`,
        "POST",
      ),
    );
    expect(
      await screen.findByRole("tab", { name: "Snapshots" }),
    ).toBeInTheDocument();
  });

  it("tests SFTP only after saving", async () => {
    const user = await openDestinations();
    await user.click(screen.getByRole("button", { name: "Add destination" }));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("radio", { name: /SFTP/ }));
    await user.click(within(drawer).getByRole("button", { name: "Continue" }));
    expect(
      within(drawer).getByRole("button", { name: "Test connection" }),
    ).toBeDisabled();
    expect(within(drawer).getByText("Tested after saving")).toBeInTheDocument();
  });

  it("shows saved secrets as Saved with Replace, never their values", async () => {
    const user = await openDestinations();
    await user.click(
      screen.getByRole("button", { name: "Edit Cloudflare R2" }),
    );
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findAllByText("Saved")).toHaveLength(2);
    expect(within(drawer).getByLabelText("Bucket")).toHaveValue(
      "crate-backups",
    );
    await user.click(
      within(drawer).getByRole("button", { name: "Replace secret access key" }),
    );
    await user.type(
      within(drawer).getByLabelText("Secret access key"),
      "new-secret",
    );
    routeApi((_url, method) =>
      method === "PATCH" ? OVERVIEW.destinations[1] : undefined,
    );
    await user.click(
      within(drawer).getByRole("button", { name: "Save changes" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${API}/destinations/dest-r2`,
        "PATCH",
        {
          secrets: { secret_access_key: "new-secret" },
        },
      ),
    );
  });

  it("lists the cached snapshots in a tab of the destination", async () => {
    const user = await openDestinations();
    await user.click(
      screen.getByRole("button", { name: "Edit Cloudflare R2" }),
    );
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("tab", { name: "Snapshots" }));
    expect(await within(drawer).findByText("a91f03c2")).toBeInTheDocument();
    expect(
      within(drawer).getByText(/2 snapshots · listed 13 h ago/),
    ).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(
      `${API}/destinations/dest-r2/snapshots`,
      "GET",
      undefined,
      expect.any(Object),
    );
  });

  it("builds the rclone authorize command for Google Drive from the typed client", async () => {
    const user = await openDestinations();
    await user.click(screen.getByRole("button", { name: "Add destination" }));
    const drawer = await screen.findByRole("dialog");
    await user.click(
      within(drawer).getByRole("radio", { name: /Google Drive/ }),
    );
    await user.click(within(drawer).getByRole("button", { name: "Continue" }));
    expect(
      within(drawer).getByText('rclone authorize drive "<blob>"'),
    ).toBeInTheDocument();
    await user.type(
      within(drawer).getByLabelText("OAuth client ID"),
      "id.apps",
    );
    await user.type(
      within(drawer).getByLabelText("OAuth client secret"),
      "sec",
    );
    const blob = btoa(
      JSON.stringify({
        client_id: "id.apps",
        client_secret: "sec",
        scope: "drive.file",
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(
      within(drawer).getByText(`rclone authorize drive "${blob}"`),
    ).toBeInTheDocument();
  });

  it("connects Google Drive through the install's own OAuth client", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const user = await openDestinations();
    routeApi((url, method) =>
      method === "POST" && url === `${API}/destinations/dest-gdrive/oauth/start`
        ? { authorize_url: "https://accounts.google.com/o/oauth2/auth?x=1" }
        : undefined,
    );
    await user.click(screen.getByRole("button", { name: "Edit Google Drive" }));
    const drawer = await screen.findByRole("dialog");
    await user.click(
      await within(drawer).findByRole("button", { name: "Reconnect" }),
    );
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/auth?x=1",
      ),
    );
    vi.unstubAllGlobals();
  });
});
