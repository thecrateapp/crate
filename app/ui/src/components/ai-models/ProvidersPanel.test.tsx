import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { aiSnapshot, STUDIO_ID } from "./test-fixtures";
import type { Connection, Snapshot } from "./types";

const { apiMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProvidersPanel } from "./ProvidersPanel";

function storedConnection(overrides: Partial<Connection>): Connection {
  return {
    id: "stored",
    persistent_id: "stored",
    label: "Stored",
    provider: "gemini",
    revision: 1,
    endpoint: null,
    enabled: true,
    model_count: 0,
    catalog_status: "pending",
    catalog_error_code: null,
    catalog_updated_at: null,
    max_concurrent: 2,
    daily_calls: 100,
    daily_tokens: 1000000,
    source: "stored",
    has_key: true,
    last4: null,
    read_only: false,
    ...overrides,
  };
}

function renderPanel(
  snapshot: Snapshot,
  options: {
    refresh?: () => void;
    hasCapability?: (cap: string) => boolean;
  } = {},
) {
  const refresh = options.refresh ?? vi.fn();
  const view = renderWithAdminProviders(
    <ProvidersPanel snapshot={snapshot} refresh={refresh} />,
    options.hasCapability
      ? { auth: { hasCapability: options.hasCapability } }
      : {},
  );
  return { ...view, refresh };
}

beforeEach(() => {
  apiMock
    .mockReset()
    .mockResolvedValue({ task_id: "job1", deduplicated: false });
  useApiMock.mockReset().mockImplementation(() => ({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
});

describe("ProvidersPanel", () => {
  it("shows each provider's status, key source and models", () => {
    const snapshot = aiSnapshot();
    snapshot.connections = [
      ...snapshot.connections,
      storedConnection({
        id: "deepseek-stored",
        persistent_id: "deepseek-stored",
        label: "Research",
        provider: "deepseek",
        has_key: false,
      }),
      storedConnection({
        id: "ollama-local",
        persistent_id: "ollama-local",
        label: "Home server",
        provider: "ollama",
        endpoint: "http://localhost:11434",
        has_key: false,
        model_count: 0,
      }),
    ];
    renderPanel(snapshot);

    const geminiEnv = screen.getByRole("article", {
      name: "Gemini from server",
    });
    expect(geminiEnv).toHaveTextContent("Ready");
    expect(geminiEnv).toHaveTextContent(
      "Key: from server environment, read-only · ending abcd",
    );
    expect(geminiEnv).toHaveTextContent("2 models");

    const studio = screen.getByRole("article", { name: "Studio" });
    expect(studio).toHaveTextContent("Error");
    expect(studio).toHaveTextContent(
      "Couldn't load models. The last list is kept.",
    );

    const research = screen.getByRole("article", { name: "Research" });
    expect(research).toHaveTextContent("Needs key");

    const homeServer = screen.getByRole("article", { name: "Home server" });
    expect(homeServer).toHaveTextContent("Models not loaded");
  });

  it("hides environment providers without a key behind Add provider", async () => {
    const user = userEvent.setup();
    renderPanel(aiSnapshot());

    expect(
      screen.queryByRole("article", { name: "DeepSeek from server" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add provider" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "DeepSeek: set DEEPSEEK_API_KEY on the server to use it.",
      ),
    ).toBeVisible();
  });

  it("refreshes models with inline progress and no billable test", async () => {
    const user = userEvent.setup();
    renderPanel(aiSnapshot());

    await user.click(
      screen.getByRole("button", { name: "Refresh models for Studio" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/api/admin/ai/connections/${STUDIO_ID}/refresh`,
        "POST",
        { expected_revision: 2 },
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing models…");
    expect(useApiMock).toHaveBeenCalledWith("/api/admin/ai/jobs/job1");
    expect(apiMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/test"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("keeps polling the accepted environment refresh across materialization", async () => {
    const user = userEvent.setup();
    let snapshot = aiSnapshot();
    const jobPoll = vi.fn();
    useApiMock.mockImplementation((url: string | null) =>
      url?.includes("/jobs/")
        ? {
            data: { id: "job1", status: "running", result: null },
            loading: false,
            error: null,
            refetch: jobPoll,
          }
        : { data: null, loading: false, error: null, refetch: vi.fn() },
    );
    const { rerender, authValue, refresh } = renderPanel(snapshot);

    await user.click(
      screen.getByRole("button", {
        name: "Refresh models for Gemini from server",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing models…");

    snapshot = {
      ...snapshot,
      connections: snapshot.connections.map((connection) =>
        connection.id === "env:gemini"
          ? { ...connection, revision: 1 }
          : connection,
      ),
    };
    const { AuthContext } = await import("@/contexts/AuthContext");
    const { MemoryRouter } = await import("react-router");
    rerender(
      <MemoryRouter>
        <AuthContext.Provider value={authValue}>
          <ProvidersPanel snapshot={snapshot} refresh={refresh} />
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Refreshing models…");
    await waitFor(() => expect(jobPoll).toHaveBeenCalled(), { timeout: 2500 });
  });

  it("retains the known refresh job after a deduplicated acceptance", async () => {
    apiMock
      .mockReset()
      .mockResolvedValueOnce({ task_id: "job1", deduplicated: false })
      .mockResolvedValueOnce({ task_id: null, deduplicated: true })
      .mockResolvedValueOnce({ task_id: "job2", deduplicated: false });
    const user = userEvent.setup();
    renderPanel(aiSnapshot());

    const button = screen.getByRole("button", {
      name: "Refresh models for Studio",
    });
    await user.click(button);
    await waitFor(() =>
      expect(useApiMock).toHaveBeenCalledWith("/api/admin/ai/jobs/job1"),
    );

    await user.click(button);
    expect(screen.getByRole("status")).not.toHaveTextContent("unavailable");

    await user.click(button);
    await waitFor(() =>
      expect(useApiMock).toHaveBeenCalledWith("/api/admin/ai/jobs/job2"),
    );
  });

  it("keeps keys write-only and separates credential permission", async () => {
    const user = userEvent.setup();
    renderPanel(aiSnapshot(), {
      hasCapability: (cap) =>
        ["ai.config.read", "ai.credentials.manage"].includes(cap),
    });

    expect(
      screen.queryByRole("button", { name: "Add provider" }),
    ).not.toBeInTheDocument();

    const keyFields = screen.getAllByLabelText("API key");
    expect(keyFields).toHaveLength(1);
    const key = keyFields[0]!;
    expect(key).toHaveValue("");
    await user.type(key, "secret-new");
    await user.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(key).toHaveValue(""));

    expect(
      screen.getByRole("article", { name: "Gemini from server" }),
    ).toHaveTextContent("read-only");
  });

  it("hides key forms from configuration-only operators", () => {
    renderPanel(aiSnapshot(), {
      hasCapability: (cap) => cap !== "ai.credentials.manage",
    });

    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh models for Studio" }),
    ).toBeVisible();
  });

  it("edits limits in a collapsed section with revision checking", async () => {
    const user = userEvent.setup();
    renderPanel(aiSnapshot());

    const studio = screen.getByRole("article", { name: "Studio" });
    const settingsButton = within(studio).getByRole("button", {
      name: "Settings",
    });
    expect(settingsButton).toHaveAttribute("aria-expanded", "false");

    await user.click(settingsButton);
    expect(settingsButton).toHaveAttribute("aria-expanded", "true");

    const dailyCalls = within(studio).getByLabelText("Daily calls");
    await user.clear(dailyCalls);
    await user.type(dailyCalls, "50");

    await user.click(
      within(studio).getByRole("button", { name: "Save settings" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/api/admin/ai/connections/${STUDIO_ID}`,
        "PATCH",
        expect.objectContaining({ daily_calls: 50, expected_revision: 2 }),
      ),
    );
  });
});
