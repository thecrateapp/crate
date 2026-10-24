import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import {
  activityFixture,
  aiSnapshot,
  catalog,
  migratedSnapshot,
  PROFILE_ID,
  STUDIO_ID,
} from "./test-fixtures";
import type { Activity, Snapshot } from "./types";

const { apiMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FeaturesPanel } from "./FeaturesPanel";

const CONFLICT =
  "AI settings changed while you were editing. Review and try again.";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function row(label: string): HTMLElement {
  return screen.getByRole("listitem", { name: label });
}

function renderPanel(
  snapshot: Snapshot,
  {
    activity = null,
    refresh = vi.fn(),
    capabilities,
  }: {
    activity?: Activity | null;
    refresh?: () => void;
    capabilities?: string[];
  } = {},
) {
  const view = renderWithAdminProviders(
    <FeaturesPanel snapshot={snapshot} activity={activity} refresh={refresh} />,
    capabilities
      ? { auth: { hasCapability: (cap) => capabilities.includes(cap) } }
      : {},
  );
  return { ...view, refresh };
}

async function openSheet(user: UserEvent, label: string) {
  await user.click(
    screen.getByRole("button", { name: `Use a different model for ${label}` }),
  );
  return screen.findByRole("dialog", { name: `Model for ${label}` });
}

async function choose(
  user: UserEvent,
  scope: HTMLElement,
  select: string,
  option: string,
) {
  await user.click(within(scope).getByRole("combobox", { name: select }));
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({});
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  useApiMock.mockReset().mockImplementation((url: string | null) => ({
    data: url?.endsWith("/models") ? catalog : null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }));
});

describe("FeaturesPanel", () => {
  it("groups features by area with what they send and their model", () => {
    const snapshot = migratedSnapshot();
    snapshot.default_model!.features = snapshot.default_model!.features.map(
      (feature) =>
        feature.action_id === "shows.extract.vision"
          ? {
              ...feature,
              status: "incompatible" as const,
              reason: "AI_ACTION_NEEDS_IMAGE",
            }
          : feature,
    );
    renderPanel(snapshot);

    expect(screen.getByRole("heading", { name: "Features" })).toBeVisible();
    const areas = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(areas).toEqual(["Shows", "Genres", "Discovery"]);
    const shows = screen.getByRole("region", { name: "Shows" });
    expect(within(shows).getAllByRole("listitem")).toHaveLength(2);

    const vision = row("Extract shows from image");
    expect(
      within(vision).getByText("Sends: the poster or screenshot"),
    ).toBeVisible();
    expect(
      within(vision).getByText("Needs a model that reads images"),
    ).toBeVisible();

    const paths = row("Refine Music Path");
    expect(within(paths).getByText("Default")).toBeVisible();
    expect(within(paths).getByText("gemini-3.8-flash")).toBeVisible();

    const eq = row("Propose genre EQ");
    expect(within(eq).getByText("Override")).toBeVisible();
    expect(within(eq).getByText("gemini-3.8-flash")).toBeVisible();

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(UUID);
    expect(text).not.toMatch(/[a-f0-9]{64}/);
    expect(text).not.toContain("AI_ACTION_NEEDS_IMAGE");
  });

  it("turns a feature off with the binding revision", async () => {
    const user = userEvent.setup();
    const { refresh } = renderPanel(migratedSnapshot());

    const toggle = screen.getByRole("switch", { name: "Refine Music Path" });
    expect(toggle).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Extract shows from text" }),
    ).not.toBeChecked();
    await user.click(toggle);

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/ai/bindings", "POST", {
        changes: [
          {
            action_id: "music_paths.refine",
            profile_id: PROFILE_ID,
            profile_version: 1,
            enabled: false,
            expected_revision: 3,
          },
        ],
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Refine Music Path turned off");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("turns a disabled feature on", async () => {
    const user = userEvent.setup();
    renderPanel(migratedSnapshot());

    const toggle = screen.getByRole("switch", {
      name: "Extract shows from text",
    });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/ai/bindings", "POST", {
        changes: [
          expect.objectContaining({
            action_id: "shows.extract.text",
            enabled: true,
            expected_revision: 1,
          }),
        ],
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Extract shows from text turned on",
    );
  });

  it("keeps a turned-off image feature off and explains why it can't turn on", async () => {
    const snapshot = migratedSnapshot();
    snapshot.bindings = snapshot.bindings.map((binding) =>
      binding.action_id === "shows.extract.vision"
        ? { ...binding, enabled: false }
        : binding,
    );
    snapshot.default_model!.features = snapshot.default_model!.features.map(
      (feature) =>
        feature.action_id === "shows.extract.vision"
          ? {
              ...feature,
              status: "incompatible" as const,
              reason: "AI_ACTION_NEEDS_IMAGE",
            }
          : feature,
    );
    apiMock.mockRejectedValueOnce(
      Object.assign(new Error('{"detail":"Action requires image input"}'), {
        status: 422,
        code: "AI_ACTION_NEEDS_IMAGE",
      }),
    );
    const user = userEvent.setup();
    const { refresh } = renderPanel(snapshot);

    const toggle = screen.getByRole("switch", {
      name: "Extract shows from image",
    });
    expect(toggle).not.toBeChecked();
    expect(
      within(row("Extract shows from image")).getByText(
        "Needs a model that reads images",
      ),
    ).toBeVisible();
    await user.click(toggle);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This feature needs a model that reads images.",
      ),
    );
    expect(apiMock).toHaveBeenCalledWith("/api/admin/ai/bindings", "POST", {
      changes: [
        expect.objectContaining({
          action_id: "shows.extract.vision",
          enabled: true,
        }),
      ],
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("switch", { name: "Extract shows from image" }),
    ).not.toBeChecked();
  });

  it("keeps routing unchanged when a binding change conflicts", async () => {
    apiMock.mockRejectedValueOnce(
      Object.assign(new Error('{"detail":"stale"}'), {
        status: 409,
        code: "AI_CONFIGURATION_CONFLICT",
      }),
    );
    const user = userEvent.setup();
    const { refresh } = renderPanel(migratedSnapshot());

    await user.click(screen.getByRole("switch", { name: "Refine Music Path" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CONFLICT));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Refine Music Path" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("switch", { name: "Refine Music Path" }),
    ).toBeChecked();
    expect(within(row("Refine Music Path")).getByText("Default")).toBeVisible();
  });

  it("disables feature controls before setup", () => {
    renderPanel(aiSnapshot());

    expect(
      screen.getByText(
        "Choose a default model to turn features on or off or give them their own model.",
      ),
    ).toBeVisible();
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(4);
    for (const toggle of switches) {
      expect(toggle).toBeDisabled();
      expect(toggle).toBeChecked();
    }
    expect(
      screen.queryByRole("button", { name: /Use a different model for/ }),
    ).not.toBeInTheDocument();
    expect(
      within(row("Propose genre EQ")).getByText("Server settings"),
    ).toBeVisible();
  });

  it("shows a feature turned off in server settings as off before setup", () => {
    const snapshot = aiSnapshot();
    snapshot.legacy_actions = snapshot.legacy_actions.map((action) =>
      action.action_id === "music_paths.refine"
        ? { ...action, legacy_enabled: false }
        : action,
    );
    renderPanel(snapshot);

    const paths = screen.getByRole("switch", { name: "Refine Music Path" });
    expect(paths).not.toBeChecked();
    expect(paths).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "Propose genre EQ" }),
    ).toBeChecked();
  });

  it("hides models and profiles without a known image bound from image features", async () => {
    const unbounded = {
      ...catalog.models[0]!,
      model_id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      image_token_bound: null,
    };
    useApiMock.mockImplementation((url: string | null) => ({
      data: url?.endsWith("/models")
        ? { ...catalog, models: [...catalog.models, unbounded] }
        : null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
    const snapshot = migratedSnapshot();
    const poster = snapshot.profiles[0]!;
    snapshot.profiles.push({
      ...poster,
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      label: "Text Gemini",
      versions: [
        {
          ...poster.versions[0]!,
          profile_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          model_id: "gemini-2.5-flash",
          image_token_bound: null,
        },
      ],
    });
    const user = userEvent.setup();
    renderPanel(snapshot);

    const sheet = await openSheet(user, "Extract shows from image");
    await user.click(within(sheet).getByRole("combobox", { name: "Model" }));
    expect(
      await screen.findByRole("option", { name: "Gemini 3.8 Flash" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "Gemini 2.5 Flash" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Gemini 3.8 Flash" }));
    await user.click(
      within(sheet).getByRole("radio", { name: "Use a saved profile" }),
    );
    await user.click(
      within(sheet).getByRole("combobox", { name: "Saved profile" }),
    );
    expect(
      await screen.findByRole("option", { name: /^Poster · / }),
    ).toBeVisible();
    expect(
      screen.queryByRole("option", { name: /^Text Gemini/ }),
    ).not.toBeInTheDocument();
  });

  it("disables feature controls for read-only operators", () => {
    renderPanel(migratedSnapshot(), {
      capabilities: ["ai.config.read", "ai.usage.read"],
    });

    for (const toggle of screen.getAllByRole("switch")) {
      expect(toggle).toBeDisabled();
    }
    expect(
      screen.queryByRole("button", { name: /Use a different model for/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the last result from recent activity", () => {
    const { container } = renderPanel(migratedSnapshot(), {
      activity: activityFixture,
    });

    const vision = row("Extract shows from image");
    expect(within(vision).getByText(/Last run/)).toBeVisible();
    const time = vision.querySelector("time");
    expect(time).not.toBeNull();
    expect(time).not.toHaveAttribute("title");
    expect(time).toHaveAttribute(
      "dateTime",
      activityFixture.items.find(
        (item) => item.action_id === "shows.extract.vision",
      )!.created_at,
    );
    expect(time).toHaveAttribute("tabIndex", "0");
    expect(time).toHaveTextContent(/ago/);
    expect(within(vision).getByText(/Succeeded/)).toBeVisible();
    expect(
      within(row("Propose genre EQ")).getByText("No recent runs"),
    ).toBeVisible();
    expect(container.textContent).not.toMatch(UUID);
  });

  it("hides last runs without usage access", () => {
    renderPanel(migratedSnapshot(), {
      activity: activityFixture,
      capabilities: ["ai.config.read", "ai.config.manage"],
    });

    expect(screen.queryByText(/Last run/)).not.toBeInTheDocument();
    expect(screen.queryByText("No recent runs")).not.toBeInTheDocument();
  });

  it("gives one feature its own model", async () => {
    const user = userEvent.setup();
    const { refresh } = renderPanel(migratedSnapshot());

    const sheet = await openSheet(user, "Propose genre EQ");
    expect(within(sheet).getByText("Only this feature changes.")).toBeVisible();
    expect(
      within(sheet).getByRole("radio", { name: "Choose a model" }),
    ).toBeChecked();
    await choose(user, sheet, "Model", "Budget");
    await user.click(
      within(sheet).getByRole("button", { name: "Use this model" }),
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const [url, method, body] = apiMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/ai/actions/genres.eq.propose/model");
    expect(method).toBe("POST");
    expect(body).toEqual({
      connection_id: STUDIO_ID,
      model_id: "budget",
      reasoning: { mode: "provider_default", level: null, budget_tokens: null },
      expected_revision: 1,
      expected_review_fingerprint: "f".repeat(64),
    });
    expect(body).not.toHaveProperty("dry_run");
    expect(toast.success).toHaveBeenCalledWith(
      "Propose genre EQ now uses budget",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("offers only image models to an image feature", async () => {
    const user = userEvent.setup();
    renderPanel(migratedSnapshot());

    const sheet = await openSheet(user, "Extract shows from image");
    await user.click(within(sheet).getByRole("combobox", { name: "Model" }));
    expect(
      await screen.findByRole("option", { name: "Gemini 3.8 Flash" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "Budget" }),
    ).not.toBeInTheDocument();
  });

  it("returns an overridden feature to the default model", async () => {
    const user = userEvent.setup();
    renderPanel(migratedSnapshot());

    const sheet = await openSheet(user, "Propose genre EQ");
    await user.click(
      within(sheet).getByRole("button", { name: "Use the default model" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/ai/actions/genres.eq.propose/model",
        "POST",
        {
          connection_id: STUDIO_ID,
          model_id: "gemini-3.8-flash",
          reasoning: {
            mode: "provider_default",
            level: null,
            budget_tokens: null,
          },
          expected_revision: 1,
          expected_review_fingerprint: "f".repeat(64),
        },
      ),
    );
  });

  it("offers the default model only to overridden features", async () => {
    const user = userEvent.setup();
    renderPanel(migratedSnapshot());

    const sheet = await openSheet(user, "Refine Music Path");
    expect(
      within(sheet).queryByRole("button", { name: "Use the default model" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the sheet open and reloads when a model change conflicts", async () => {
    apiMock.mockRejectedValueOnce(
      Object.assign(new Error("x"), {
        status: 409,
        code: "AI_CONFIGURATION_CONFLICT",
      }),
    );
    const user = userEvent.setup();
    const { refresh } = renderPanel(migratedSnapshot());

    const sheet = await openSheet(user, "Propose genre EQ");
    await choose(user, sheet, "Model", "Budget");
    await user.click(
      within(sheet).getByRole("button", { name: "Use this model" }),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CONFLICT));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("dialog", { name: "Model for Propose genre EQ" }),
    ).toBeVisible();
  });

  it("binds a saved profile to one feature", async () => {
    const snapshot = migratedSnapshot();
    const profile = snapshot.profiles[0]!;
    profile.current_version = 2;
    profile.versions.push({
      ...profile.versions[0]!,
      version: 2,
      model_id: "vision",
      fingerprint: "e".repeat(64),
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    snapshot.bindings = snapshot.bindings.map((binding) =>
      binding.action_id === "genres.eq.propose"
        ? { ...binding, revision: 7 }
        : binding,
    );
    const user = userEvent.setup();
    const { refresh } = renderPanel(snapshot);

    const sheet = await openSheet(user, "Propose genre EQ");
    await user.click(
      within(sheet).getByRole("radio", { name: "Use a saved profile" }),
    );
    await choose(
      user,
      sheet,
      "Saved profile",
      "Poster · vision · Updated 2 hours ago",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Use this profile" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/ai/bindings", "POST", {
        changes: [
          {
            action_id: "genres.eq.propose",
            profile_id: PROFILE_ID,
            profile_version: 2,
            enabled: true,
            expected_revision: 7,
          },
        ],
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Propose genre EQ now uses Poster",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("lists legacy profiles only for their own feature", async () => {
    const snapshot = migratedSnapshot();
    snapshot.profiles.push({
      id: "99999999-9999-4999-8999-999999999999",
      label: "Kept settings",
      current_version: 1,
      created_at: new Date().toISOString(),
      versions: [
        {
          profile_id: "99999999-9999-4999-8999-999999999999",
          version: 1,
          connection_id: STUDIO_ID,
          model_id: "legacy-model",
          config: {
            kind: "legacy_snapshot",
            action_id: "shows.extract.vision",
            legacy_model: "gemini/legacy-model",
            legacy_options: {
              timeout_seconds: 90,
              max_tokens: 16000,
              image_detail: "default",
            },
          },
          fingerprint: "c".repeat(64),
          created_at: new Date().toISOString(),
        },
      ],
    });
    const user = userEvent.setup();
    renderPanel(snapshot);

    const sheet = await openSheet(user, "Propose genre EQ");
    await user.click(
      within(sheet).getByRole("radio", { name: "Use a saved profile" }),
    );
    await user.click(
      within(sheet).getByRole("combobox", { name: "Saved profile" }),
    );
    expect(
      await screen.findByRole("option", { name: /^Poster · / }),
    ).toBeVisible();
    expect(
      screen.queryByRole("option", { name: /^Kept settings/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps identifiers in the sheet's technical details", async () => {
    const user = userEvent.setup();
    renderPanel(migratedSnapshot());

    const sheet = await openSheet(user, "Refine Music Path");
    expect(sheet.textContent).not.toMatch(UUID);
    await user.click(
      within(sheet).getByRole("button", { name: "Technical details" }),
    );
    expect(within(sheet).getByText("Profile ID")).toBeVisible();
    expect(within(sheet).getByText(PROFILE_ID)).toBeVisible();
    expect(within(sheet).getByText("Binding revision")).toBeVisible();
  });
});
