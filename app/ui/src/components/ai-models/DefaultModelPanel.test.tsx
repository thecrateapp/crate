import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryRouter } from "react-router";

import { AuthContext } from "@/contexts/AuthContext";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import {
  aiSnapshot,
  catalog,
  migratedSnapshot,
  STUDIO_ID,
} from "./test-fixtures";
import type {
  AssignmentOutcome,
  Model,
  ModelAssignmentResult,
  ModelsResponse,
  Snapshot,
} from "./types";

const { apiMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DefaultModelPanel } from "./DefaultModelPanel";

const CONFLICT =
  "AI settings changed while you were editing. Review and try again.";
const PROVIDER_DEFAULT = {
  mode: "provider_default",
  level: null,
  budget_tokens: null,
};

let models: ModelsResponse;

function model(overrides: Partial<Model>): Model {
  return { ...catalog.models[0]!, ...overrides };
}

const studioCatalog: ModelsResponse = {
  ...catalog,
  models: [
    model({ model_id: "vision", label: "Vision" }),
    catalog.models[1]!,
    model({
      model_id: "pending",
      label: "Pending",
      validated: false,
      structured_output: false,
      input_modalities: [],
      source: "pending",
    }),
    model({ provider: "deepseek", model_id: "chat", label: "Chat" }),
  ],
};

function outcome(
  action_id: string,
  kind: AssignmentOutcome["outcome"],
  reason: string | null = null,
  adjustments: AssignmentOutcome["adjustments"] = [],
  enabled: boolean | null = true,
): AssignmentOutcome {
  return { action_id, outcome: kind, reason, adjustments, enabled };
}

function result(
  outcomes: AssignmentOutcome[],
  overrides: Partial<ModelAssignmentResult> = {},
): ModelAssignmentResult {
  return {
    dry_run: true,
    activation: true,
    revision: 1,
    review_fingerprint: "f".repeat(64),
    outcomes,
    ...overrides,
  };
}

const firstUseOutcomes = [
  outcome("shows.extract.vision", "kept_legacy", "AI_ACTION_NEEDS_IMAGE"),
  outcome("shows.extract.text", "applied", null, ["reasoning"]),
  outcome("genres.eq.propose", "applied"),
  outcome("music_paths.refine", "applied", null, ["image_detail"]),
];

function withoutOverrides(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    default_model: {
      ...snapshot.default_model!,
      features: snapshot.default_model!.features.map((feature) =>
        feature.status === "override"
          ? { ...feature, status: "default" as const }
          : feature,
      ),
    },
  };
}

async function choose(user: UserEvent, select: string, option: string) {
  await user.click(screen.getByRole("button", { name: select }));
  await user.click(await screen.findByRole("button", { name: option }));
}

beforeEach(() => {
  models = catalog;
  apiMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  useApiMock.mockReset().mockImplementation((url: string | null) => ({
    data: url?.endsWith("/models") ? models : null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
});

describe("DefaultModelPanel", () => {
  it("confirms what changes before first use and applies the reviewed identity", async () => {
    const snapshot = aiSnapshot();
    snapshot.connections = snapshot.connections.map((connection) =>
      connection.id === "env:gemini"
        ? { ...connection, daily_calls: 1000 }
        : connection,
    );
    apiMock
      .mockResolvedValueOnce(result(firstUseOutcomes))
      .mockResolvedValueOnce(result(firstUseOutcomes, { dry_run: false }));
    const refresh = vi.fn();
    const user = userEvent.setup();
    renderWithAdminProviders(
      <DefaultModelPanel snapshot={snapshot} refresh={refresh} />,
    );

    expect(
      screen.getByText(
        "Crate currently uses gemini-3.8-flash from server settings. Choosing a default model moves every feature to AI models settings.",
      ),
    ).toBeVisible();
    await choose(user, "Connection", "Gemini from server");
    await choose(user, "Model", "Gemini 3.8 Flash");
    await choose(user, "Reasoning", "High");
    expect(useApiMock).toHaveBeenCalledWith(
      "/api/admin/ai/connections/env%3Agemini/models",
    );
    await user.click(
      screen.getByRole("button", { name: "Use for all features" }),
    );

    const body = {
      connection_id: "env:gemini",
      model_id: "gemini-3.8-flash",
      reasoning: { mode: "level", level: "high", budget_tokens: null },
      expected_revision: 1,
      expected_review_fingerprint: "f".repeat(64),
    };
    await waitFor(() =>
      expect(apiMock).toHaveBeenNthCalledWith(
        1,
        "/api/admin/ai/default-model",
        "POST",
        { ...body, dry_run: true },
      ),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Use gemini-3.8-flash for all features?"),
    ).toBeVisible();
    expect(
      within(dialog).getByText("Connection limits start to apply."),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "Gemini from server: 2 at a time · 1,000 calls and 1,000,000 tokens per day.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "Each call reserves its full token allowance until the provider reports usage.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText("Will use gemini-3.8-flash (3)"),
    ).toBeVisible();
    expect(
      within(dialog).getByText("Reasoning adjusted to fit its limits"),
    ).toBeVisible();
    expect(
      within(dialog).getByText("Uses standard image detail"),
    ).toBeVisible();
    expect(
      within(dialog).getByText("Keep their current model (1)"),
    ).toBeVisible();
    expect(
      within(dialog).getByText("Needs a model that reads images"),
    ).toBeVisible();
    expect(within(dialog).getByText("Extract shows from image")).toBeVisible();
    expect(dialog.textContent).not.toMatch(/[a-f0-9]{64}/);

    await user.click(
      within(dialog).getByRole("button", { name: "Use for all features" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenNthCalledWith(
        2,
        "/api/admin/ai/default-model",
        "POST",
        { ...body, dry_run: false },
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("Default model updated", {
      description:
        "gemini-3.8-flash now runs 3 features. 1 kept their current model.",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps the reviewed identity when a new snapshot arrives before confirming", async () => {
    apiMock
      .mockResolvedValueOnce(result(firstUseOutcomes))
      .mockResolvedValueOnce(result(firstUseOutcomes, { dry_run: false }));
    const refresh = vi.fn();
    const user = userEvent.setup();
    const snapshot = aiSnapshot();
    const { rerender, authValue } = renderWithAdminProviders(
      <DefaultModelPanel snapshot={snapshot} refresh={refresh} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Use for all features" }),
    );
    const dialog = await screen.findByRole("dialog");
    rerender(
      <MemoryRouter>
        <AuthContext.Provider value={authValue}>
          <DefaultModelPanel
            snapshot={{
              ...snapshot,
              revision: 2,
              review_fingerprint: "b".repeat(64),
            }}
            refresh={refresh}
          />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    await user.click(
      within(dialog).getByRole("button", { name: "Use for all features" }),
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    const reviewed = {
      connection_id: "env:gemini",
      model_id: "gemini-3.8-flash",
      reasoning: PROVIDER_DEFAULT,
      expected_revision: 1,
      expected_review_fingerprint: "f".repeat(64),
    };
    expect(apiMock.mock.calls[0]).toEqual([
      "/api/admin/ai/default-model",
      "POST",
      { ...reviewed, dry_run: true },
    ]);
    expect(apiMock.mock.calls[1]).toEqual([
      "/api/admin/ai/default-model",
      "POST",
      { ...reviewed, dry_run: false },
    ]);
  });

  it("blocks first use when a feature cannot keep its current model", async () => {
    apiMock.mockResolvedValueOnce(
      result([
        outcome("shows.extract.vision", "blocked", "AI_LEGACY_LIMITS_UNKNOWN"),
        outcome("shows.extract.text", "applied"),
        outcome("genres.eq.propose", "applied"),
        outcome("music_paths.refine", "applied"),
      ]),
    );
    const user = userEvent.setup();
    renderWithAdminProviders(
      <DefaultModelPanel snapshot={aiSnapshot()} refresh={vi.fn()} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Use for all features" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Can't be set up (1)")).toBeVisible();
    expect(
      within(dialog).getByText("Its model's limits are unknown"),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Use for all features" }),
    ).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("turns off image features the model can't run and still confirms", async () => {
    const turnedOff = [
      outcome(
        "shows.extract.vision",
        "turned_off",
        "AI_ACTION_NEEDS_IMAGE",
        [],
        false,
      ),
      outcome("shows.extract.text", "applied"),
      outcome("genres.eq.propose", "applied"),
      outcome("music_paths.refine", "applied", null, [], false),
    ];
    apiMock
      .mockResolvedValueOnce(result(turnedOff))
      .mockResolvedValueOnce(result(turnedOff, { dry_run: false }));
    const user = userEvent.setup();
    renderWithAdminProviders(
      <DefaultModelPanel snapshot={aiSnapshot()} refresh={vi.fn()} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Use for all features" }),
    );

    const dialog = await screen.findByRole("dialog");
    const group = within(dialog).getByRole("region", {
      name: "Will be turned off (1)",
    });
    expect(within(group).getByText("Extract shows from image")).toBeVisible();
    expect(
      within(group).getByText("Needs a model that reads images"),
    ).toBeVisible();
    expect(
      within(group).getByText(
        "You can turn them on later with a model that supports them.",
      ),
    ).toBeVisible();
    expect(within(dialog).queryByText(/Can't be set up/)).toBeNull();
    expect(
      within(dialog).queryByText("Extract shows from image stays off."),
    ).toBeNull();
    expect(
      within(dialog).getByText("Refine Music Path stays off."),
    ).toBeVisible();
    expect(dialog.textContent).not.toContain("AI_ACTION_NEEDS_IMAGE");
    const confirm = within(dialog).getByRole("button", {
      name: "Use for all features",
    });
    expect(confirm).toBeEnabled();

    await user.click(confirm);

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Default model updated", {
        description: "gemini-3.8-flash now runs 3 features. 1 turned off.",
      }),
    );
  });

  it("applies directly after setup and reports kept features", async () => {
    apiMock.mockResolvedValueOnce(
      result(
        [
          outcome("shows.extract.vision", "unchanged"),
          outcome("shows.extract.text", "kept_current", "AI_CONTEXT_TOO_SMALL"),
          outcome("genres.eq.propose", "applied"),
          outcome("music_paths.refine", "unchanged"),
        ],
        { dry_run: false, activation: false },
      ),
    );
    const refresh = vi.fn();
    const user = userEvent.setup();
    renderWithAdminProviders(
      <DefaultModelPanel
        snapshot={withoutOverrides(migratedSnapshot())}
        refresh={refresh}
      />,
    );

    expect(
      screen.getByText("Current default: gemini-3.8-flash · Provider default"),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Use for all features" }),
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/ai/default-model",
      "POST",
      {
        connection_id: STUDIO_ID,
        model_id: "gemini-3.8-flash",
        reasoning: PROVIDER_DEFAULT,
        expected_revision: 1,
        expected_review_fingerprint: "f".repeat(64),
        dry_run: false,
      },
    );
    expect(toast.success).toHaveBeenCalledWith("Default model updated", {
      description:
        "gemini-3.8-flash now runs 3 features. 1 kept their current model.",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers only validated models and resets reasoning when the model changes", async () => {
    models = studioCatalog;
    const user = userEvent.setup();
    renderWithAdminProviders(
      <DefaultModelPanel snapshot={aiSnapshot()} refresh={vi.fn()} />,
    );

    await choose(user, "Connection", "Studio");
    expect(screen.getByRole("button", { name: "Model" })).toHaveTextContent(
      "Choose a model",
    );
    await user.click(screen.getByRole("button", { name: "Model" }));
    expect(
      screen.queryByRole("button", { name: "Pending" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Chat" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Vision" }));
    await choose(user, "Reasoning", "High");
    expect(screen.getByRole("button", { name: "Reasoning" })).toHaveTextContent(
      "High",
    );

    await choose(user, "Model", "Budget");
    const reasoning = screen.getByRole("button", { name: "Reasoning" });
    expect(reasoning).toHaveTextContent("Provider default");
    await user.click(reasoning);
    const menu = await screen.findByRole("dialog");
    expect(
      within(menu)
        .getAllByRole("button")
        .map((option) => option.textContent),
    ).toEqual(["Provider default", "Off", "On", "Thinking: 100 tokens"]);
  });

  it("reloads on conflict and leaves routing unchanged", async () => {
    apiMock.mockRejectedValueOnce(
      Object.assign(new Error("x"), {
        status: 409,
        code: "AI_CONFIGURATION_CONFLICT",
      }),
    );
    const refresh = vi.fn();
    const user = userEvent.setup();
    renderWithAdminProviders(
      <DefaultModelPanel snapshot={migratedSnapshot()} refresh={refresh} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Use for all features" }),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CONFLICT));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith(
      "/api/admin/ai/default-model",
      "POST",
      expect.objectContaining({ dry_run: true }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/Current default: gemini-3.8-flash/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Model" })).toHaveTextContent(
      "Gemini 3.8 Flash",
    );
  });

  it("closes the review and reloads when confirming conflicts", async () => {
    apiMock
      .mockResolvedValueOnce(result(firstUseOutcomes))
      .mockRejectedValueOnce(
        Object.assign(new Error('{"detail":"conflict"}'), {
          status: 409,
          code: "AI_CONFIGURATION_CONFLICT",
        }),
      );
    const refresh = vi.fn();
    const user = userEvent.setup();
    renderWithAdminProviders(
      <DefaultModelPanel snapshot={aiSnapshot()} refresh={refresh} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Use for all features" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Use for all features" }),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CONFLICT));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Crate currently uses gemini-3.8-flash/),
    ).toBeVisible();
  });

  it("explains an unavailable default and a missing provider", () => {
    const snapshot = migratedSnapshot();
    snapshot.default_model = {
      ...snapshot.default_model!,
      available: false,
      error_code: "AI_CREDENTIAL_REQUIRED",
    };
    const { unmount } = renderWithAdminProviders(
      <DefaultModelPanel snapshot={snapshot} refresh={vi.fn()} />,
    );
    expect(
      screen.getByText(
        "The default model is no longer available: No API key for its provider.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/AI_CREDENTIAL_REQUIRED/),
    ).not.toBeInTheDocument();
    unmount();

    const empty = aiSnapshot();
    empty.connections = empty.connections.map((connection) => ({
      ...connection,
      model_count: 0,
    }));
    renderWithAdminProviders(
      <DefaultModelPanel snapshot={empty} refresh={vi.fn()} />,
    );
    expect(
      screen.getByText(
        "No provider is ready. Add a key or refresh models in Providers below.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Use for all features" }),
    ).toBeDisabled();
  });

  it("reviews first when setup has no usable default model", async () => {
    const withoutDefault = migratedSnapshot();
    withoutDefault.default_model = null;
    const unavailable = migratedSnapshot();
    unavailable.default_model = {
      ...unavailable.default_model!,
      available: false,
      error_code: "AI_MODEL_UNVALIDATED",
      features: [],
    };
    for (const snapshot of [withoutDefault, unavailable]) {
      apiMock
        .mockReset()
        .mockResolvedValueOnce(result(firstUseOutcomes, { activation: false }));
      const user = userEvent.setup();
      const { unmount } = renderWithAdminProviders(
        <DefaultModelPanel snapshot={snapshot} refresh={vi.fn()} />,
      );

      if (!snapshot.default_model) {
        await choose(user, "Connection", "Studio");
        await choose(user, "Model", "Gemini 3.8 Flash");
      }
      await user.click(
        screen.getByRole("button", { name: "Use for all features" }),
      );

      const dialog = await screen.findByRole("dialog");
      expect(apiMock).toHaveBeenCalledTimes(1);
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/ai/default-model",
        "POST",
        expect.objectContaining({ dry_run: true }),
      );
      expect(
        within(dialog).getByText("Will use gemini-3.8-flash (3)"),
      ).toBeVisible();
      unmount();
    }
  });

  it("lists the limits of every connection that setup puts under limits", async () => {
    apiMock.mockResolvedValueOnce(result(firstUseOutcomes));
    const user = userEvent.setup();
    renderWithAdminProviders(
      <DefaultModelPanel snapshot={aiSnapshot()} refresh={vi.fn()} />,
    );

    await choose(user, "Connection", "Studio");
    await choose(user, "Model", "Gemini 3.8 Flash");
    await user.click(
      screen.getByRole("button", { name: "Use for all features" }),
    );

    const dialog = await screen.findByRole("dialog");
    const limits = within(dialog)
      .getAllByRole("listitem")
      .map((item) => item.textContent)
      .filter((text) => text?.includes("per day"));
    expect(limits).toEqual([
      "Studio: 2 at a time · 100 calls and 1,000,000 tokens per day.",
      "Gemini from server: 2 at a time · 100 calls and 1,000,000 tokens per day.",
    ]);
  });

  it("says which features stay off after setup", async () => {
    apiMock.mockResolvedValueOnce(
      result([
        outcome("shows.extract.vision", "kept_legacy", "AI_ACTION_NEEDS_IMAGE"),
        outcome("shows.extract.text", "applied"),
        outcome("genres.eq.propose", "applied"),
        outcome("music_paths.refine", "applied", null, [], false),
      ]),
    );
    const user = userEvent.setup();
    renderWithAdminProviders(
      <DefaultModelPanel snapshot={aiSnapshot()} refresh={vi.fn()} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Use for all features" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Refine Music Path stays off."),
    ).toBeVisible();
    expect(within(dialog).queryByText(/Propose genre EQ stays off/)).toBeNull();
  });

  it("hides the controls from read-only operators", () => {
    renderWithAdminProviders(
      <DefaultModelPanel snapshot={migratedSnapshot()} refresh={vi.fn()} />,
      { auth: { hasCapability: (cap) => cap === "ai.config.read" } },
    );

    expect(
      screen.getByRole("heading", { name: "Default model" }),
    ).toBeVisible();
    expect(screen.getByText(/Current default: gemini-3.8-flash/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Use for all features" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Model" }),
    ).not.toBeInTheDocument();
  });
});
