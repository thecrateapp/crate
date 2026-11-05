import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, useApiMock, pollTaskMock, refetchMock, toastMock } =
  vi.hoisted(() => ({
    apiMock: vi.fn(),
    useApiMock: vi.fn(),
    pollTaskMock: vi.fn(),
    refetchMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
  }));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: pollTaskMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import type { ErrorTrackingConnection } from "@/lib/error-inbox";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import {
  NOT_CONFIGURED_CONNECTION,
  sampleConnection,
  sampleFixConnection,
} from "@/test/error-inbox-fixtures";

import { ConnectionPanel, connectionTestOutcome } from "./ConnectionPanel";

function renderPanel(connection: ErrorTrackingConnection, onChanged = vi.fn()) {
  useApiMock.mockReturnValue({
    data: connection,
    loading: false,
    error: null,
    refetch: refetchMock,
  });
  renderWithAdminProviders(<ConnectionPanel onChanged={onChanged} />);
  return onChanged;
}

const form = () =>
  screen.getByRole("form", { name: "Sentry connection settings" });
const field = (name: string) => within(form()).getByLabelText(name);
const fixForm = () => screen.getByRole("form", { name: "Launch fix settings" });
const fixField = (name: string) => within(fixForm()).getByLabelText(name);

describe("ConnectionPanel", () => {
  beforeEach(() => {
    apiMock.mockReset();
    useApiMock.mockReset();
    pollTaskMock.mockReset();
    refetchMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it("never prefills the token and only sends it when typed", async () => {
    apiMock.mockResolvedValue(sampleConnection());
    const onChanged = renderPanel(sampleConnection());

    const token = field("Token");
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveAttribute("autocomplete", "new-password");
    expect(token).toHaveValue("");
    expect(token).not.toBeRequired();
    expect(screen.getByText("Token stored")).toBeInTheDocument();
    expect(field("Organization")).toHaveValue("example-org");
    expect(field("Projects")).toHaveValue(
      "crate-api, crate-workers, crate-readplane, crate-listen",
    );

    await userEvent.clear(field("Environments"));
    await userEvent.type(field("Environments"), "production, staging");
    await userEvent.click(within(form()).getByRole("button", { name: "Save" }));

    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/admin/errors/connection",
      "PUT",
      {
        base_url: "https://sentry.io",
        organization: "example-org",
        projects: [
          "crate-api",
          "crate-workers",
          "crate-readplane",
          "crate-listen",
        ],
        environments: ["production", "staging"],
      },
    );
    expect(apiMock.mock.lastCall![2]).not.toHaveProperty("token");
    expect(toastMock.success).toHaveBeenCalledWith("Connection saved");
    expect(onChanged).toHaveBeenCalled();
    expect(refetchMock).toHaveBeenCalled();

    await userEvent.type(field("Token"), "sntrys_new_token");
    await userEvent.click(within(form()).getByRole("button", { name: "Save" }));

    expect(apiMock.mock.lastCall![2]).toMatchObject({
      token: "sntrys_new_token",
    });
    expect(field("Token")).toHaveValue("");
  });

  it("shows the status block before the settings, in one column", () => {
    renderPanel(sampleConnection());

    const status = screen.getByRole("region", { name: "Status" });
    const settings = screen.getByRole("region", { name: "Settings" });
    expect(
      status.compareDocumentPosition(settings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(status).getByText("Connected")).toBeInTheDocument();
    expect(within(status).getByText("Read access")).toBeInTheDocument();
    expect(within(status).getByText("Last sync")).toBeInTheDocument();
    expect(
      within(status).getByRole("button", { name: "Test connection" }),
    ).toBeInTheDocument();
    expect(
      within(settings).getByRole("form", {
        name: "Sentry connection settings",
      }),
    ).toBeInTheDocument();
    // The drawer header owns the title and description now.
    expect(
      screen.queryByText(/Where Crate reads issues from/),
    ).not.toBeInTheDocument();
  });

  it("requires a token before the first save", () => {
    renderPanel(NOT_CONFIGURED_CONNECTION);

    expect(field("Token")).toBeRequired();
    expect(field("Token")).toHaveValue("");
    expect(screen.getByText("No token stored")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).toBeDisabled();
  });

  it("shows the reason the API refused the settings", async () => {
    apiMock.mockRejectedValue(
      Object.assign(
        new Error('{"detail":"Organization must be a Sentry slug"}'),
        { status: 422, code: "ERROR_TRACKING_INVALID" },
      ),
    );
    renderPanel(sampleConnection());

    await userEvent.click(within(form()).getByRole("button", { name: "Save" }));

    expect(within(form()).getByRole("alert")).toHaveTextContent(
      "Organization must be a Sentry slug",
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("test connection polls the task", async () => {
    apiMock.mockResolvedValue({ task_id: "task-test" });
    const onChanged = renderPanel(sampleConnection());

    await userEvent.click(
      screen.getByRole("button", { name: "Test connection" }),
    );

    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/errors/connection/test",
      "POST",
    );
    expect(pollTaskMock).toHaveBeenCalledWith(
      "task-test",
      expect.any(Function),
      expect.any(Function),
    );
    const pending = screen.getByRole("button", { name: "Testing…" });
    expect(pending).toBeDisabled();
    expect(
      screen.getByText("Checking the stored token with Sentry…"),
    ).toBeInTheDocument();

    const onComplete = pollTaskMock.mock.calls[0]![1] as (
      result?: Record<string, unknown>,
    ) => void;
    act(() =>
      onComplete({ status: "succeeded", access: { read: true, write: false } }),
    );

    expect(toastMock.success).toHaveBeenCalledWith(
      "Connection works. Read access: Yes. Write access: No.",
    );
    expect(refetchMock).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).toBeEnabled();
  });

  it("reports a failed connection test and reloads the recorded access", async () => {
    apiMock.mockResolvedValue({ task_id: "task-test" });
    renderPanel(sampleConnection());

    await userEvent.click(
      screen.getByRole("button", { name: "Test connection" }),
    );
    const onFailed = pollTaskMock.mock.calls[0]![2] as (error?: string) => void;
    act(() => onFailed("Sentry rejected the token"));

    expect(toastMock.error).toHaveBeenCalledWith("Sentry rejected the token");
    expect(refetchMock).toHaveBeenCalled();
  });

  it("shows recorded access, problems and the last sync", () => {
    renderPanel(
      sampleConnection({
        access: {
          read: false,
          write: false,
          checked_at: new Date().toISOString(),
          source: "connection_test",
          error_code: "SENTRY_AUTH",
        },
      }),
    );

    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText(/by a connection test/)).toBeInTheDocument();
    expect(
      screen.getByText(/Sentry rejected the token. It may have been revoked/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Without event:write/)).toBeInTheDocument();
  });

  it("configures Launch fix with a write-only GitHub token", async () => {
    apiMock.mockResolvedValue(sampleConnection());
    const onChanged = renderPanel(sampleConnection());

    const section = screen.getByRole("region", { name: "Launch fix" });
    expect(within(section).getByText("Off")).toBeInTheDocument();
    expect(fixField("Repository")).toHaveValue("thecrateapp/crate");
    expect(fixField("Workflow")).toHaveValue("error-autofix.yml");
    expect(fixField("Branch")).toHaveValue("main");
    const token = fixField("GitHub token");
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveAttribute("autocomplete", "new-password");
    expect(token).toBeRequired();
    expect(
      within(fixForm()).queryByRole("button", { name: "Turn off" }),
    ).not.toBeInTheDocument();

    await userEvent.type(token, "github_pat_new_token");
    await userEvent.click(
      within(fixForm()).getByRole("button", { name: "Save Launch fix" }),
    );

    // The stored Sentry settings go along unchanged; only `fix` is new.
    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/admin/errors/connection",
      "PUT",
      {
        base_url: "https://sentry.io",
        organization: "example-org",
        projects: [
          "crate-api",
          "crate-workers",
          "crate-readplane",
          "crate-listen",
        ],
        environments: ["production"],
        fix: {
          repository: "thecrateapp/crate",
          workflow: "error-autofix.yml",
          ref: "main",
          token: "github_pat_new_token",
        },
      },
    );
    expect(apiMock.mock.lastCall![2]).not.toHaveProperty("token");
    expect(toastMock.success).toHaveBeenCalledWith("Launch fix saved");
    expect(onChanged).toHaveBeenCalled();
    expect(fixField("GitHub token")).toHaveValue("");
  });

  it("keeps the stored GitHub token and turns Launch fix off", async () => {
    apiMock.mockResolvedValue(sampleConnection());
    renderPanel(
      sampleConnection({ fix: sampleFixConnection({ ref: "release" }) }),
    );

    const section = screen.getByRole("region", { name: "Launch fix" });
    expect(within(section).getByText("Ready")).toBeInTheDocument();
    expect(fixField("Branch")).toHaveValue("release");
    expect(fixField("GitHub token")).not.toBeRequired();
    expect(fixField("GitHub token")).toHaveValue("");

    await userEvent.click(
      within(fixForm()).getByRole("button", { name: "Save Launch fix" }),
    );
    expect(apiMock.mock.lastCall![2].fix).toEqual({
      repository: "thecrateapp/crate",
      workflow: "error-autofix.yml",
      ref: "release",
    });

    await userEvent.click(
      within(fixForm()).getByRole("button", { name: "Turn off" }),
    );
    expect(apiMock.mock.lastCall![2]).toMatchObject({
      organization: "example-org",
      fix: null,
    });
    expect(toastMock.success).toHaveBeenLastCalledWith(
      "Launch fix is off and its GitHub token was deleted",
    );
  });

  it("flags Launch fix settings without a token", () => {
    renderPanel(
      sampleConnection({ fix: sampleFixConnection({ has_token: false }) }),
    );

    const section = screen.getByRole("region", { name: "Launch fix" });
    expect(within(section).getByText("Token missing")).toBeInTheDocument();
    expect(fixField("GitHub token")).toBeRequired();
  });

  it("asks for the Sentry settings before Launch fix", () => {
    renderPanel(NOT_CONFIGURED_CONNECTION);

    const section = screen.getByRole("region", { name: "Launch fix" });
    expect(
      within(section).getByText(/Save the Sentry settings first/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Launch fix settings" }),
    ).not.toBeInTheDocument();
  });

  it("shows why the API refused the Launch fix settings", async () => {
    apiMock.mockRejectedValue(
      Object.assign(
        new Error(
          '{"detail":"The GitHub token must be a fine-grained personal access token (github_pat_...)"}',
        ),
        { status: 422, code: "ERROR_TRACKING_INVALID" },
      ),
    );
    renderPanel(sampleConnection());

    await userEvent.type(fixField("GitHub token"), "ghp_classic");
    await userEvent.click(
      within(fixForm()).getByRole("button", { name: "Save Launch fix" }),
    );

    expect(within(fixForm()).getByRole("alert")).toHaveTextContent(
      /fine-grained personal access token/,
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(fixField("GitHub token")).toHaveValue("ghp_classic");
  });
});

describe("connectionTestOutcome", () => {
  it.each([
    [
      { status: "succeeded", access: { read: true, write: false } },
      { read: true, write: false, errorCode: null },
    ],
    [
      { status: "ok", read: true, write: true, error_code: null },
      { read: true, write: true, errorCode: null },
    ],
    [
      { status: "failed", error_code: "SENTRY_AUTH", access: { read: false } },
      { read: false, write: null, errorCode: "SENTRY_AUTH" },
    ],
    [undefined, { read: null, write: null, errorCode: null }],
  ])("reads %j", (result, expected) => {
    expect(connectionTestOutcome(result)).toEqual(expected);
  });
});
