import { readFileSync } from "node:fs";
import path from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@nivo/line", () => ({
  ResponsiveLine: ({ data }: { data: { id: string }[] }) => (
    <div data-testid="size-chart">{data.map((s) => s.id).join(",")}</div>
  ),
}));

import { ADMIN_CONSOLE_ENTRY_CAPABILITIES } from "@/contexts/AuthContext";
import { formatStamp } from "@/lib/backups";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import {
  BACKUPS_NOW,
  OVERVIEW,
  POLICIES,
  POLICY_NIGHTLY,
} from "@/test/backups-fixtures";

import { Backups } from "./Backups";

function routeApi(overrides: Record<string, unknown> = {}) {
  apiMock.mockImplementation(async (url: string, method = "GET") => {
    const key = `${method} ${url}`;
    if (key in overrides) {
      const value = overrides[key];
      if (value instanceof Error) throw value;
      return typeof value === "function" ? (value as () => unknown)() : value;
    }
    if (url === "/api/admin/backups/overview") return OVERVIEW;
    if (url === "/api/admin/backups/policies") return POLICIES;
    if (method === "POST" && url === "/api/admin/backups/run")
      return { task_id: "task-1", deduplicated: false };
    if (method === "POST" && url === "/api/admin/backups/recovery-kit/confirm")
      return { confirmed: 6 };
    throw new Error(`Unexpected ${key}`);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BACKUPS_NOW);
  apiMock.mockReset();
  pollTask.mockReset();
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  routeApi();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Backups page", () => {
  it("renders the overview from the API", async () => {
    renderWithAdminProviders(<Backups />, { route: "/backups" });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Backups" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("article", { name: "Hetzner Storage Box" }),
    ).toBeInTheDocument();
    for (const name of [
      "Backup volume",
      "Cloudflare R2",
      "Google Drive",
      "Dropbox",
      "MinIO at home",
    ])
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "4 of 6 destinations have repository passwords",
    );
    expect(screen.getByText("Last off-site copy")).toBeInTheDocument();
    expect(screen.getAllByText("13 h ago").length).toBeGreaterThan(1);
    expect(screen.getByText("1.38 GB")).toBeInTheDocument();
    expect(
      screen.getByText(
        `Cloudflare R2 · ${formatStamp("2026-11-10T03:37:00Z")}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("size-chart")).toHaveTextContent(
      "Cloudflare R2,Google Drive,Backup volume,Hetzner Storage Box",
    );
    expect(
      screen.getByRole("tab", { name: "Overview", selected: true }),
    ).toBeInTheDocument();
  });

  it("marks failing in the danger tone, late in amber and never-tested as untested", async () => {
    renderWithAdminProviders(<Backups />, { route: "/backups" });
    const failing = await screen.findAllByText("Failing");
    expect(failing[0]).toHaveAttribute("data-tone", "error");
    expect(failing[0]).toHaveClass("text-state-danger-text");
    const late = screen.getAllByText("Late")[0]!;
    expect(late).toHaveAttribute("data-tone", "warn");
    expect(late).toHaveClass("text-state-warning-text");
    expect(screen.getByText("Untested")).toHaveAttribute("data-tone", "off");
    expect(
      screen.getByText("Permission denied (publickey) since 9 Nov 03:40."),
    ).toHaveClass("text-state-danger-text");
  });

  it("chooses the policy from the Run now menu when there are several", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<Backups />, { route: "/backups" });
    await user.click(
      (await screen.findAllByRole("button", { name: "Run now" }))[0]!,
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Before upgrades" }),
    ).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Nightly" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/backups/run", "POST", {
        kind: "backup",
        policy_id: POLICY_NIGHTLY,
      }),
    );
    expect(pollTask).toHaveBeenCalledWith(
      "task-1",
      expect.any(Function),
      expect.any(Function),
      3000,
      expect.any(Number),
    );
  });

  it("makes a local dump when there is no policy", async () => {
    const user = userEvent.setup();
    routeApi({
      "GET /api/admin/backups/overview": { ...OVERVIEW, policies: [] },
    });
    renderWithAdminProviders(<Backups />, { route: "/backups" });
    await user.click(
      (await screen.findAllByRole("button", { name: "Run now" }))[0]!,
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/backups/run", "POST", {
        kind: "backup",
      }),
    );
  });

  it("verifies the destination chosen in the menu", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<Backups />, { route: "/backups" });
    await user.click(await screen.findByRole("button", { name: "Verify" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: "Dropbox" }),
    ).toBeNull();
    await user.click(
      within(menu).getByRole("menuitem", { name: "Cloudflare R2" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/backups/run", "POST", {
        kind: "verify",
        destination_id: "dest-r2",
      }),
    );
  });

  it("downloads the recovery kit, shows a wrong password inline and confirms it was stored", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: "The password is not correct" }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Blob(["age-encryption.org/v1"]), {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition":
              'attachment; filename="crate-recovery-kit-20261110.md.age"',
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:kit");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderWithAdminProviders(<Backups />, { route: "/backups" });
    await user.click(
      await screen.findByRole("button", { name: "Download recovery kit" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Download recovery kit",
    });
    await user.type(within(dialog).getByLabelText("Account password"), "wrong");
    await user.type(
      within(dialog).getByLabelText("Kit passphrase"),
      "correct horse battery",
    );
    await user.type(
      within(dialog).getByLabelText("Repeat the passphrase"),
      "correct horse battery",
    );
    expect(within(dialog).getByText(/open it with/)).toHaveTextContent(
      "age -d",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Download kit" }),
    );
    expect(
      await within(dialog).findByText("The password is not correct."),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Account password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/backups/recovery-kit",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          password: "wrong",
          passphrase: "correct horse battery",
        }),
      }),
    );

    await user.clear(within(dialog).getByLabelText("Account password"));
    await user.type(within(dialog).getByLabelText("Account password"), "right");
    await user.click(
      within(dialog).getByRole("button", { name: "Download kit" }),
    );
    const stored = await screen.findByRole("button", { name: "I stored it" });
    expect(click).toHaveBeenCalled();
    expect(
      screen.getByText("crate-recovery-kit-20261110.md.age"),
    ).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/admin/backups/recovery-kit/confirm",
      "POST",
    );
    await user.click(stored);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/backups/recovery-kit/confirm",
        "POST",
      ),
    );
    click.mockRestore();
  });

  it("refuses a short kit passphrase before asking the server", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWithAdminProviders(<Backups />, { route: "/backups" });
    await user.click(
      await screen.findByRole("button", { name: "Download recovery kit" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Account password"), "pw");
    await user.type(within(dialog).getByLabelText("Kit passphrase"), "short");
    await user.type(
      within(dialog).getByLabelText("Repeat the passphrase"),
      "short",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Download kit" }),
    );
    expect(
      await within(dialog).findByText(
        "The kit passphrase needs 12 characters or more.",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides the kit warning once the kit is saved", async () => {
    routeApi({
      "GET /api/admin/backups/overview": {
        ...OVERVIEW,
        kit: { saved: true, uncovered: 0, total: 6 },
      },
    });
    renderWithAdminProviders(<Backups />, { route: "/backups" });
    await screen.findByRole("article", { name: "Hetzner Storage Box" });
    expect(screen.queryByText("Recovery kit not saved")).toBeNull();
  });

  it("reports the OAuth callback outcome with a toast", async () => {
    renderWithAdminProviders(<Backups />, {
      route:
        "/backups?oauth=error&message=The%20provider%20refused%3A%20access_denied",
    });
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "The provider refused: access_denied",
      ),
    );
  });
});

describe("Backups access", () => {
  it("is gated by system.backups.manage in the router and opens the console", () => {
    const app = readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).toMatch(
      /const BACKUPS_MANAGE = \["system\.backups\.manage"\] as const;/,
    );
    expect(app).toMatch(
      /path="backups"\s+element=\{\s+<RequireCapabilities anyOf=\{BACKUPS_MANAGE\}>\s+<Backups \/>/,
    );
    expect(ADMIN_CONSOLE_ENTRY_CAPABILITIES).toContain("system.backups.manage");
  });
});
