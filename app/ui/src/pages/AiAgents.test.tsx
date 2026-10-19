import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import type { Snapshot } from "@/components/ai-agents/types";
const { apiMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
import { AiAgents } from "./AiAgents";
const id = "11111111-1111-4111-8111-111111111111";
const config = {
  reasoning: {
    mode: "provider_default" as const,
    level: null,
    budget_tokens: null,
  },
  image_detail: "default",
  timeout_seconds: 45,
  max_input_tokens: 1000,
  max_output_tokens: 1000,
};
const models = [
  {
    provider: "gemini",
    model_id: "vision",
    label: "Vision",
    input_modalities: ["text", "image"],
    structured_output: true,
    validated: true,
    source: "manifest",
    reasoning_levels: ["low", "high"],
    reasoning_enabled: false,
    reasoning_disabled: false,
    thinking_budget_min: null,
    thinking_budget_max: null,
    max_output_tokens: 16000,
    context_window: 32000,
    image_details: ["default", "high"],
  },
  {
    provider: "gemini",
    model_id: "budget",
    label: "Budget",
    input_modalities: ["text"],
    structured_output: true,
    validated: true,
    source: "manifest",
    reasoning_levels: [],
    reasoning_enabled: true,
    reasoning_disabled: true,
    thinking_budget_min: 1,
    thinking_budget_max: 100,
    max_output_tokens: 4000,
    context_window: 32000,
    image_details: ["default"],
  },
  {
    provider: "gemini",
    model_id: "pending",
    label: "Pending",
    validated: false,
    input_modalities: [],
    structured_output: false,
    source: "pending",
    reasoning_levels: [],
    image_details: ["default"],
  },
];
const base: Snapshot = {
  revision: 1,
  migrated: false,
  review_fingerprint: "f".repeat(64),
  truncated: false,
  engines: [{ provider: "gemini", supported: true }],
  actions: [
    {
      id: "shows.extract.vision",
      label: "Extract shows",
      group: "shows",
      input: "image",
      permission: "curation.shows.write",
      location: "/upcoming",
      description: "Send poster",
      maxima: {
        timeout_seconds: 90,
        max_output_tokens: 16000,
        max_input_tokens: 131072,
        max_image_pixels: 20000000,
        max_proposals: 200,
        max_selected: 50,
      },
    },
  ],
  connections: [
    {
      id,
      persistent_id: id,
      label: "Studio",
      provider: "gemini",
      revision: 2,
      endpoint: null,
      enabled: true,
      model_count: 3,
      catalog_status: "error",
      catalog_error_code: "AI_CATALOG_STALE",
      catalog_updated_at: null,
      max_concurrent: 2,
      daily_calls: 100,
      daily_tokens: 1000000,
      source: "stored",
      has_key: true,
      last4: null,
      read_only: false,
    },
    {
      id: "env:gemini",
      persistent_id: null,
      label: "Environment",
      provider: "gemini",
      revision: 0,
      endpoint: null,
      enabled: true,
      model_count: 0,
      catalog_status: "pending",
      catalog_error_code: null,
      catalog_updated_at: null,
      max_concurrent: 2,
      daily_calls: 100,
      daily_tokens: 1000000,
      source: "environment",
      has_key: true,
      last4: null,
      read_only: true,
    },
  ],
  profiles: [
    {
      id,
      label: "Poster",
      current_version: 1,
      versions: [
        {
          profile_id: id,
          version: 1,
          connection_id: id,
          model_id: "vision",
          config,
          fingerprint: "a".repeat(64),
        },
      ],
    },
  ],
  bindings: [],
  legacy_actions: [
    {
      action_id: "shows.extract.vision",
      provider: "gemini",
      supported: true,
      model_id: "old",
      legacy_model: "gemini/old",
      effective_timeout_seconds: 90,
      legacy_options: {
        timeout_seconds: 90,
        max_tokens: 16000,
        image_detail: "default",
      },
    },
  ],
};
const modelCatalog = {
  models,
  status: "error",
  error_code: "AI_CATALOG_STALE",
  updated_at: null,
};
let snapshot: Snapshot;
beforeEach(() => {
  snapshot = structuredClone(base);
  apiMock
    .mockReset()
    .mockResolvedValue({ task_id: "job1", deduplicated: false });
  useApiMock.mockReset().mockImplementation((url: string | null) => ({
    data: url?.endsWith("/snapshot")
      ? snapshot
      : url?.endsWith("/models")
        ? modelCatalog
        : url?.endsWith("/usage")
          ? {
              legacy_usage_unknown: true,
              truncated: false,
              totals: {
                calls: 2,
                tokens: 30,
                unknown_calls: 1,
                estimated_cost: null,
                failed: 1,
                completed: 1,
              },
            }
          : url?.includes("/activity")
            ? { items: [], next_cursor: "next" }
            : null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
});
describe("AiAgents", () => {
  it("shows four tabs and keeps migration explicit with reviewed fingerprint", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AiAgents />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByText(/Current: gemini\/old/)).toBeVisible();
    expect(apiMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Review migration" }));
    expect(apiMock).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Confirm activation" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/ai/activate", "POST", {
        expected_revision: 1,
        expected_review_fingerprint: base.review_fingerprint,
      }),
    );
  });
  it("uses only validated models and resets incompatible native controls", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AiAgents />);
    await user.click(screen.getByRole("tab", { name: "Models and profiles" }));
    await user.selectOptions(screen.getByLabelText("Connection"), id);
    expect(
      screen.queryByRole("option", { name: "Pending" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Model"), "vision");
    await user.selectOptions(screen.getByLabelText("Reasoning"), "level");
    await user.selectOptions(screen.getByLabelText("Native level"), "high");
    await user.selectOptions(screen.getByLabelText("Model"), "budget");
    expect(screen.getByLabelText("Reasoning")).toHaveValue("provider_default");
    expect(screen.getByText(/Model changed; review/)).toBeVisible();
    expect(screen.queryByLabelText("Native level")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Reasoning"), "budget");
    expect(screen.getByLabelText("Thinking budget")).toHaveAttribute(
      "max",
      "100",
    );
    await user.selectOptions(screen.getByLabelText("Reasoning"), "enabled");
    expect(screen.queryByLabelText("Thinking budget")).not.toBeInTheDocument();
  });
  it("separates credential permission, write-only keys and environment controls", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AiAgents />, {
      auth: {
        hasCapability: (cap) =>
          ["ai.config.read", "ai.credentials.manage"].includes(cap),
      },
    });
    await user.click(screen.getByRole("tab", { name: "Providers" }));
    expect(
      screen.queryByRole("button", { name: "Add connection" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("New API key")).toHaveLength(1);
    const key = screen.getByLabelText("New API key");
    expect(key).toHaveValue("");
    fireEvent.change(key, { target: { value: "secret-new" } });
    await user.click(screen.getByRole("button", { name: "Rotate key" }));
    await waitFor(() => expect(key).toHaveValue(""));
    expect(
      screen.getByText(/Environment connection is read-only/),
    ).toBeVisible();
  });
  it("does not expose secret forms to configuration-only operators", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AiAgents />, {
      auth: { hasCapability: (cap) => cap !== "ai.credentials.manage" },
    });
    await user.click(screen.getByRole("tab", { name: "Providers" }));
    expect(screen.queryByLabelText("New API key")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh catalog Studio" }),
    ).toBeVisible();
  });
  it("reviews a CAS batch and leaves effective routing unchanged on conflict", async () => {
    apiMock.mockRejectedValue(new Error("AI_BINDING_CONFLICT"));
    const user = userEvent.setup();
    renderWithAdminProviders(<AiAgents />);
    await user.selectOptions(
      screen.getByLabelText("Profile version for Extract shows"),
      `${id}:1`,
    );
    await user.click(screen.getByLabelText("Select Extract shows"));
    await user.click(
      screen.getByRole("button", { name: "Review assignments" }),
    );
    expect(apiMock).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Confirm assignments" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/ai/bindings", "POST", {
        changes: [
          {
            action_id: "shows.extract.vision",
            profile_id: id,
            profile_version: 1,
            enabled: true,
            expected_revision: 0,
          },
        ],
      }),
    );
    expect(screen.getByText(/Current: gemini\/old/)).toBeVisible();
  });
  it("shows unknown cost and pages bounded private metadata", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AiAgents />);
    await user.click(screen.getByRole("tab", { name: "Activity and usage" }));
    expect(screen.getByText(/Cost: unknown/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(useApiMock).toHaveBeenCalledWith(
      expect.stringContaining("limit=50&cursor=next"),
    );
  });
});
it("creates an immutable new version from validated native options", async () => {
  const user = userEvent.setup();
  renderWithAdminProviders(<AiAgents />);
  await user.click(screen.getByRole("tab", { name: "Models and profiles" }));
  await user.selectOptions(screen.getByLabelText("Profile"), id);
  await user.selectOptions(screen.getByLabelText("Connection"), id);
  await user.selectOptions(screen.getByLabelText("Model"), "budget");
  await user.selectOptions(screen.getByLabelText("Reasoning"), "enabled");
  expect(
    screen.queryByRole("textbox", { name: "Model" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
  await user.click(screen.getByRole("button", { name: "Save new version" }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith(
      `/api/admin/ai/profiles/${id}/versions`,
      "POST",
      expect.objectContaining({
        expected_version: 1,
        model_id: "budget",
        connection_id: id,
        config: expect.objectContaining({
          reasoning: { mode: "enabled", level: null, budget_tokens: null },
        }),
      }),
    ),
  );
  expect(apiMock).not.toHaveBeenCalledWith(
    "/api/admin/ai/bindings",
    expect.anything(),
    expect.anything(),
  );
});
it("requires billable acknowledgment and reuses acceptance identity after a lost response", async () => {
  apiMock
    .mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValue({ task_id: "job1", deduplicated: true });
  const user = userEvent.setup();
  renderWithAdminProviders(<AiAgents />);
  await user.click(screen.getByRole("tab", { name: "Models and profiles" }));
  await user.click(
    screen.getByRole("button", { name: "Review billable test Poster v1" }),
  );
  expect(apiMock).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Run one billable test" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /acknowledge/ }));
  await user.click(
    screen.getByRole("button", { name: "Run one billable test" }),
  );
  await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
  await user.click(
    screen.getByRole("button", { name: "Run one billable test" }),
  );
  await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
  expect(apiMock.mock.calls[0]).toEqual(apiMock.mock.calls[1]);
  expect(apiMock.mock.calls[0]?.[2]).toEqual({
    acknowledged_billable: true,
    expected_fingerprint: "a".repeat(64),
    idempotency_key: expect.any(String),
  });
});
it("keeps the reviewed migration identity when a new snapshot arrives", async () => {
  const user = userEvent.setup();
  const { rerender, authValue } = renderWithAdminProviders(<AiAgents />);
  await user.click(screen.getByRole("button", { name: "Review migration" }));
  snapshot = { ...snapshot, revision: 2, review_fingerprint: "b".repeat(64) };
  const { AuthContext } = await import("@/contexts/AuthContext");
  const { MemoryRouter } = await import("react-router");
  rerender(
    <MemoryRouter>
      <AuthContext.Provider value={authValue}>
        <AiAgents />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "Confirm activation" }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith("/api/admin/ai/activate", "POST", {
      expected_revision: 1,
      expected_review_fingerprint: "f".repeat(64),
    }),
  );
});
it("refreshes a stale catalog through a queued job without launching a billable probe", async () => {
  const user = userEvent.setup();
  renderWithAdminProviders(<AiAgents />);
  await user.click(screen.getByRole("tab", { name: "Providers" }));
  await user.click(
    screen.getByRole("button", { name: "Refresh catalog Studio" }),
  );
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith(
      `/api/admin/ai/connections/${id}/refresh`,
      "POST",
      { expected_revision: 2 },
    ),
  );
  expect(screen.getByRole("status")).toHaveTextContent("job1");
  expect(useApiMock).toHaveBeenCalledWith("/api/admin/ai/jobs/job1");
  expect(apiMock).not.toHaveBeenCalledWith(
    expect.stringContaining("/test"),
    expect.anything(),
    expect.anything(),
  );
});
it("does not fetch usage without its separate capability", async () => {
  const user = userEvent.setup();
  renderWithAdminProviders(<AiAgents />, {
    auth: { hasCapability: (cap) => cap !== "ai.usage.read" },
  });
  await user.click(screen.getByRole("tab", { name: "Activity and usage" }));
  expect(screen.getByText("Usage permission required.")).toBeVisible();
  expect(
    useApiMock.mock.calls.some(
      ([url]) => url?.includes("/usage") || url?.includes("/activity"),
    ),
  ).toBe(false);
});
