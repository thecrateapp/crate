import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "@/contexts/AuthContext";
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

function rerenderPanel(
  view: ReturnType<typeof renderPanel>,
  snapshot: Snapshot,
) {
  view.rerender(
    <MemoryRouter>
      <AuthContext.Provider value={view.authValue as AuthContextValue}>
        <ProvidersPanel snapshot={snapshot} refresh={view.refresh} />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function withConnection(
  snapshot: Snapshot,
  id: string,
  changes: Partial<Connection>,
): Snapshot {
  return {
    ...snapshot,
    connections: snapshot.connections.map((connection) =>
      connection.id === id ? { ...connection, ...changes } : connection,
    ),
  };
}

function lastUseApiUrl(): string | null {
  const calls = useApiMock.mock.calls;
  return (calls[calls.length - 1]?.[0] as string | null) ?? null;
}

async function openSettings(user: UserEvent, name: string) {
  const card = screen.getByRole("article", { name });
  await user.click(within(card).getByRole("button", { name: "Settings" }));
  return card;
}

const CONFLICT_COPY =
  "AI settings changed while you were editing. Review and try again.";

function conflict() {
  return Object.assign(new Error('{"detail":"conflict"}'), {
    status: 409,
    code: "AI_CONFIGURATION_CONFLICT",
  });
}

beforeEach(() => {
  vi.mocked(toast.error).mockReset();
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
    // No refresh time is known for Studio, so only the count is shown.
    expect(within(studio).getByText("3 models")).toBeVisible();
    expect(studio).not.toHaveTextContent("updated");
    expect(geminiEnv).toHaveTextContent("2 models · updated 1 hour ago");
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
    // Before its first refresh the environment provider has no stored identity.
    let snapshot = withConnection(aiSnapshot(), "env:gemini", {
      persistent_id: null,
    });
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
    const view = renderPanel(snapshot);

    await user.click(
      screen.getByRole("button", {
        name: "Refresh models for Gemini from server",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing models…");

    // The running refresh stores the provider: it gains a persistent identity.
    snapshot = withConnection(snapshot, "env:gemini", {
      persistent_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      revision: 1,
    });
    rerenderPanel(view, snapshot);

    expect(
      screen.getByRole("article", { name: "Gemini from server" }),
    ).toBeVisible();
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
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    // A deduplicated acceptance names no job: keep following job1.
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing models…");
    expect(lastUseApiUrl()).toBe("/api/admin/ai/jobs/job1");

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
  it("keeps the refresh outcome after it completes and still reports a refresh run elsewhere", async () => {
    apiMock
      .mockReset()
      .mockResolvedValueOnce({ task_id: "job1", deduplicated: false })
      .mockResolvedValueOnce({ task_id: null, deduplicated: true });
    useApiMock.mockImplementation((url: string | null) => ({
      data: url?.includes("/jobs/")
        ? {
            id: "job1",
            status: "completed",
            result: { status: "succeeded", model_count: 5 },
          }
        : null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
    const user = userEvent.setup();
    const { refresh } = renderPanel(aiSnapshot());

    const button = screen.getByRole("button", {
      name: "Refresh models for Studio",
    });
    await user.click(button);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("Loaded 5 models");

    await user.click(button);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "A refresh is already running.",
      ),
    );
  });

  const failingWrites: [string, (user: UserEvent) => Promise<void>][] = [
    [
      "saving a key",
      async (user) => {
        await user.type(screen.getByLabelText("API key"), "secret-new");
        await user.click(screen.getByRole("button", { name: "Save key" }));
      },
    ],
    [
      "removing a key",
      async (user) => {
        await user.click(screen.getByRole("button", { name: "Remove key" }));
      },
    ],
    [
      "saving settings",
      async (user) => {
        const studio = await openSettings(user, "Studio");
        await user.click(
          within(studio).getByRole("button", { name: "Save settings" }),
        );
      },
    ],
    [
      "adding a model",
      async (user) => {
        const studio = await openSettings(user, "Studio");
        await user.type(within(studio).getByLabelText("Model ID"), "pro");
        await user.click(
          within(studio).getByRole("button", { name: "Add model" }),
        );
      },
    ],
    [
      "refreshing models",
      async (user) => {
        await user.click(
          screen.getByRole("button", { name: "Refresh models for Studio" }),
        );
      },
    ],
  ];

  it.each(failingWrites)(
    "refetches after a conflict when %s",
    async (_name, write) => {
      apiMock.mockReset().mockRejectedValue(conflict());
      const user = userEvent.setup();
      const { refresh } = renderPanel(aiSnapshot());

      await write(user);

      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(toast.error).toHaveBeenCalledWith(CONFLICT_COPY);
    },
  );

  it("saves settings against the latest revision without reverting another change", async () => {
    const user = userEvent.setup();
    const snapshot = aiSnapshot();
    const view = renderPanel(snapshot);
    const studio = await openSettings(user, "Studio");
    expect(
      within(studio).getByRole("switch", { name: "Connection enabled" }),
    ).toBeChecked();

    // Another admin turned the connection off meanwhile.
    rerenderPanel(
      view,
      withConnection(snapshot, STUDIO_ID, { enabled: false, revision: 3 }),
    );
    const updated = screen.getByRole("article", { name: "Studio" });
    expect(
      within(updated).getByRole("switch", { name: "Connection enabled" }),
    ).not.toBeChecked();
    await user.click(
      within(updated).getByRole("button", { name: "Save settings" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/api/admin/ai/connections/${STUDIO_ID}`,
        "PATCH",
        expect.objectContaining({ enabled: false, expected_revision: 3 }),
      ),
    );
  });

  it("turns a connection off and leaves the endpoint alone for hosted providers", async () => {
    const user = userEvent.setup();
    renderPanel(aiSnapshot());
    const studio = await openSettings(user, "Studio");

    await user.click(
      within(studio).getByRole("switch", { name: "Connection enabled" }),
    );
    await user.click(
      within(studio).getByRole("button", { name: "Save settings" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/api/admin/ai/connections/${STUDIO_ID}`,
        "PATCH",
        {
          label: "Studio",
          enabled: false,
          daily_calls: 100,
          daily_tokens: 1000000,
          max_concurrent: 2,
          expected_revision: 2,
        },
      ),
    );
  });

  it("sends the endpoint for Ollama connections", async () => {
    const user = userEvent.setup();
    const snapshot = aiSnapshot();
    snapshot.connections = [
      storedConnection({
        id: "ollama-local",
        persistent_id: "ollama-local",
        label: "Home server",
        provider: "ollama",
        endpoint: "http://localhost:11434",
        has_key: false,
        model_count: 2,
      }),
    ];
    renderPanel(snapshot);
    const card = await openSettings(user, "Home server");

    const endpoint = within(card).getByLabelText("Endpoint");
    await user.clear(endpoint);
    await user.type(endpoint, "http://10.0.0.2:11434");
    await user.click(
      within(card).getByRole("button", { name: "Save settings" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/ai/connections/ollama-local",
        "PATCH",
        expect.objectContaining({
          endpoint: "http://10.0.0.2:11434",
          expected_revision: 1,
        }),
      ),
    );
  });

  it("shows a cleared limit as empty and does not save it", async () => {
    const user = userEvent.setup();
    renderPanel(aiSnapshot());
    const studio = await openSettings(user, "Studio");

    const dailyCalls = within(studio).getByLabelText("Daily calls");
    await user.clear(dailyCalls);
    expect(dailyCalls).toHaveValue(null);
    expect(dailyCalls).not.toHaveAttribute("value", "NaN");
    const save = within(studio).getByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("saves and removes keys with the connection revision", async () => {
    apiMock.mockReset().mockResolvedValue({});
    const user = userEvent.setup();
    renderPanel(aiSnapshot());

    await user.type(screen.getByLabelText("API key"), "secret-new");
    await user.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/api/admin/ai/connections/${STUDIO_ID}/credential`,
        "POST",
        { api_key: "secret-new", expected_revision: 2 },
      ),
    );

    await user.click(screen.getByRole("button", { name: "Remove key" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith(
        `/api/admin/ai/connections/${STUDIO_ID}/credential`,
        "POST",
        { api_key: null, expected_revision: 2 },
      ),
    );
  });

  it("adds a model by ID with the connection revision", async () => {
    apiMock.mockReset().mockResolvedValue({});
    const user = userEvent.setup();
    const { refresh } = renderPanel(aiSnapshot());
    const studio = await openSettings(user, "Studio");

    const modelId = within(studio).getByLabelText("Model ID");
    expect(modelId).toHaveAttribute("pattern", "[A-Za-z0-9][A-Za-z0-9._:/-]*");
    await user.type(modelId, "gemini-4-pro");
    await user.click(within(studio).getByRole("button", { name: "Add model" }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/api/admin/ai/connections/${STUDIO_ID}/models`,
        "POST",
        { model_id: "gemini-4-pro", expected_revision: 2 },
      ),
    );
    expect(refresh).toHaveBeenCalled();
    expect(modelId).toHaveValue("");
  });

  it("explains a model ID the server rejects", async () => {
    apiMock
      .mockReset()
      .mockRejectedValue(
        Object.assign(new Error("Invalid AI request"), { status: 422 }),
      );
    const user = userEvent.setup();
    renderPanel(aiSnapshot());
    const studio = await openSettings(user, "Studio");

    await user.type(within(studio).getByLabelText("Model ID"), "pro");
    await user.click(within(studio).getByRole("button", { name: "Add model" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("That model ID isn't valid."),
    );
  });

  it("adds hosted and Ollama providers with exactly the fields the API accepts", async () => {
    apiMock.mockReset().mockResolvedValue({});
    const user = userEvent.setup();
    const { refresh } = renderPanel(aiSnapshot());

    await user.click(screen.getByRole("button", { name: "Add provider" }));
    let dialog = await screen.findByRole("dialog", { name: "Add provider" });
    await user.type(within(dialog).getByLabelText("Name"), "Work");
    await user.click(
      within(dialog).getByRole("button", { name: "Add provider" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/ai/connections",
        "POST",
        {
          label: "Work",
          provider: "gemini",
          endpoint: null,
        },
      ),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Add provider" }));
    dialog = await screen.findByRole("dialog", { name: "Add provider" });
    await user.click(within(dialog).getByRole("radio", { name: "Ollama" }));
    await user.type(within(dialog).getByLabelText("Name"), "Home");
    await user.type(
      within(dialog).getByLabelText("Address"),
      "http://localhost:11434",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add provider" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith(
        "/api/admin/ai/connections",
        "POST",
        {
          label: "Home",
          provider: "ollama",
          endpoint: "http://localhost:11434",
        },
      ),
    );
  });

  it("starts the Add provider form afresh and stays open while saving", async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    apiMock.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPanel(aiSnapshot());

    await user.click(screen.getByRole("button", { name: "Add provider" }));
    let dialog = await screen.findByRole("dialog", { name: "Add provider" });
    await user.type(within(dialog).getByLabelText("Name"), "Draft");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Add provider" }));
    dialog = await screen.findByRole("dialog", { name: "Add provider" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("");

    await user.type(within(dialog).getByLabelText("Name"), "Work");
    await user.click(
      within(dialog).getByRole("button", { name: "Add provider" }),
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Add provider" })).toBeVisible();

    resolveCreate({});
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
