import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  ensureMediaAccessUrl: vi.fn(),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mocks.api,
  ensureMediaAccessUrl: mocks.ensureMediaAccessUrl,
}));
vi.mock("@crate/ui/lib/notify", () => ({
  notify: { success: mocks.notifySuccess, error: mocks.notifyError },
}));

import {
  AccountDataSection,
  EXPORT_POLL_INTERVAL_MS,
  type UserDataExport,
} from "@/components/settings/AccountDataSection";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

interface Fixture {
  export: UserDataExport | null;
  requirements: {
    requires_password: boolean;
    recent_sign_in: boolean;
    recent_sign_in_window_seconds: number;
  };
  onDelete?: (body: unknown) => Promise<unknown>;
  onRequest?: () => Promise<unknown>;
}

const READY: UserDataExport = {
  id: "a".repeat(32),
  status: "ready",
  created_at: "2026-11-18T10:00:00Z",
  expires_at: "2026-11-19T10:00:00Z",
  download_url: `/api/me/export/${"a".repeat(32)}/download`,
};

function serve(fixture: Fixture) {
  mocks.api.mockImplementation(
    (path: string, method?: string, body?: unknown) => {
      if (path === "/api/me/export" && method === "POST") {
        return fixture.onRequest?.() ?? Promise.resolve(fixture.export);
      }
      if (path === "/api/me/export") {
        return Promise.resolve({ export: fixture.export });
      }
      if (path === "/api/me/account/deletion") {
        return Promise.resolve(fixture.requirements);
      }
      if (path === "/api/me" && method === "DELETE") {
        return fixture.onDelete?.(body) ?? Promise.resolve({ ok: true });
      }
      return Promise.resolve({});
    },
  );
}

const passwordAccount = {
  requires_password: true,
  recent_sign_in: false,
  recent_sign_in_window_seconds: 600,
};

function renderSection(logout = vi.fn(async () => {})) {
  renderWithListenProviders(<AccountDataSection />, {
    locale: "en",
    auth: { logout },
  });
  return logout;
}

describe("AccountDataSection", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.ensureMediaAccessUrl.mockReset();
    mocks.notifySuccess.mockReset();
    mocks.notifyError.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests an export and shows that it is being prepared", async () => {
    const user = userEvent.setup();
    const fixture: Fixture = { export: null, requirements: passwordAccount };
    fixture.onRequest = () => {
      fixture.export = {
        id: "b".repeat(32),
        status: "pending",
        created_at: "2026-11-18T10:00:00Z",
      };
      return Promise.resolve(fixture.export);
    };
    serve(fixture);
    renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Export my data" }),
    );

    expect(mocks.api).toHaveBeenCalledWith("/api/me/export", "POST");
    expect(
      await screen.findByText(
        "Your export is being prepared. You can leave this page and come back later.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preparing export" }),
    ).toBeDisabled();
    expect(mocks.notifySuccess).toHaveBeenCalledWith("Export requested");
  });

  it("polls a pending export until it is ready", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const fixture: Fixture = {
      export: {
        id: "c".repeat(32),
        status: "pending",
        created_at: "2026-11-18T10:00:00Z",
      },
      requirements: passwordAccount,
    };
    serve(fixture);
    renderSection();
    await screen.findByRole("button", { name: "Preparing export" });

    fixture.export = READY;
    await act(async () => {
      vi.advanceTimersByTime(EXPORT_POLL_INTERVAL_MS);
    });

    expect(
      await screen.findByRole("button", { name: "Download export" }),
    ).toBeVisible();
    const exportCalls = mocks.api.mock.calls.filter(
      ([path, method]) => path === "/api/me/export" && method === undefined,
    );
    expect(exportCalls).toHaveLength(2);
  });

  it("downloads a ready export through an authorized media URL", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign,
    });
    mocks.ensureMediaAccessUrl.mockResolvedValue(
      "https://music.example/api/me/export/a/download?media_ticket=t",
    );
    serve({ export: READY, requirements: passwordAccount });
    renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Download export" }),
    );

    expect(mocks.ensureMediaAccessUrl).toHaveBeenCalledWith(
      READY.download_url,
      "artwork",
    );
    expect(assign).toHaveBeenCalledWith(
      "https://music.example/api/me/export/a/download?media_ticket=t",
    );
  });

  it("deletes the account with the current password and signs out", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => ({ ok: true }));
    serve({ export: null, requirements: passwordAccount, onDelete });
    const logout = renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Delete account" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.type(
      within(dialog).getByLabelText("Current password"),
      "s3cret",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Delete my account" }),
    );

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith({ password: "s3cret" });
    expect(mocks.notifySuccess).toHaveBeenCalledWith(
      "Your account was deleted",
    );
  });

  it("asks for the password before calling the API", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => ({ ok: true }));
    serve({ export: null, requirements: passwordAccount, onDelete });
    const logout = renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Delete account" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete my account" }),
    );

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "Enter your password to confirm",
      ),
    );
    expect(onDelete).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });

  it.each([
    [403, "That password is not correct"],
    [409, "Make someone else an admin before deleting this account"],
    [429, "Too many attempts. Try again later."],
  ])("keeps the account when the API answers %i", async (status, message) => {
    const user = userEvent.setup();
    serve({
      export: null,
      requirements: passwordAccount,
      onDelete: () =>
        Promise.reject(Object.assign(new Error("no"), { status })),
    });
    const logout = renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Delete account" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByLabelText("Current password"), "wrong");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete my account" }),
    );

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(message),
    );
    expect(logout).not.toHaveBeenCalled();
  });

  it("asks accounts without a password to sign in again first", async () => {
    serve({
      export: null,
      requirements: {
        requires_password: false,
        recent_sign_in: false,
        recent_sign_in_window_seconds: 600,
      },
    });
    renderSection();

    expect(
      await screen.findByText(
        "Your account has no password. Sign out, sign in again and delete it within 10 minutes.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Delete account" }),
    ).toBeDisabled();
  });

  it("deletes a recently signed-in account without a password field", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => ({ ok: true }));
    serve({
      export: null,
      requirements: {
        requires_password: false,
        recent_sign_in: true,
        recent_sign_in_window_seconds: 600,
      },
      onDelete,
    });
    const logout = renderSection();

    await user.click(
      await screen.findByRole("button", { name: "Delete account" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByLabelText("Current password")).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "Delete my account" }),
    );

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith({});
  });
});
