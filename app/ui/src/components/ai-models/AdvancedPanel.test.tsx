import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthContext, type AuthContextValue } from "@/contexts/AuthContext";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import {
  aiSnapshot,
  catalog,
  ENV_GEMINI_PERSISTENT_ID,
  migratedSnapshot,
  PROFILE_ID,
  STUDIO_ID,
} from "./test-fixtures";
import type { Profile, Snapshot } from "./types";

const { apiMock, useApiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  useApiMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdvancedPanel } from "./AdvancedPanel";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const LEGACY_PROFILE_ID = "99999999-9999-4999-8999-999999999999";
const TEST_PATH = `/api/admin/ai/profiles/${PROFILE_ID}/versions/1/test`;

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** Matches the innermost element whose whole text is `text`. */
function textContent(text: string) {
  return (_content: string, element: Element | null) =>
    element?.textContent === text &&
    Array.from(element.children).every((child) => child.textContent !== text);
}

function legacyProfile(): Profile {
  return {
    id: LEGACY_PROFILE_ID,
    label: "Extract shows from image",
    current_version: 1,
    created_at: hoursAgo(5),
    versions: [
      {
        profile_id: LEGACY_PROFILE_ID,
        version: 1,
        connection_id: ENV_GEMINI_PERSISTENT_ID,
        model_id: "gemini-3.8-flash",
        config: {
          kind: "legacy_snapshot",
          action_id: "shows.extract.vision",
          legacy_model: "gemini/gemini-3.8-flash",
          legacy_options: {
            timeout_seconds: 90,
            max_tokens: 16000,
            image_detail: "default",
          },
        },
        fingerprint: "b".repeat(64),
        created_at: hoursAgo(5),
      },
    ],
  };
}

function renderPanel(
  snapshot: Snapshot,
  { capabilities }: { capabilities?: string[] } = {},
) {
  const refresh = vi.fn();
  const view = renderWithAdminProviders(
    <AdvancedPanel snapshot={snapshot} refresh={refresh} />,
    capabilities
      ? { auth: { hasCapability: (cap) => capabilities.includes(cap) } }
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
        <AdvancedPanel snapshot={snapshot} refresh={view.refresh} />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const CONFLICT_COPY =
  "AI settings changed while you were editing. Review and try again.";

function conflict(code = "AI_CONFIGURATION_CONFLICT") {
  return Object.assign(new Error('{"detail":"conflict"}'), {
    status: 409,
    code,
  });
}

/** Poster after another admin saved version 2. */
function withPosterVersion2(snapshot: Snapshot): Snapshot {
  const next = structuredClone(snapshot);
  const poster = next.profiles.find((item) => item.id === PROFILE_ID)!;
  const first = poster.versions[0]!;
  poster.current_version = 2;
  poster.versions = [
    {
      ...first,
      version: 2,
      fingerprint: "e".repeat(64),
      created_at: hoursAgo(0.5),
    },
    first,
  ];
  return next;
}

async function expand(user: UserEvent) {
  await user.click(
    screen.getByRole("button", { name: "Show advanced settings" }),
  );
}

function profile(label: string): HTMLElement {
  return screen.getByRole("article", { name: label });
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

describe("AdvancedPanel", () => {
  it("lists saved profiles with relative update times and keeps version numbers in technical details", async () => {
    const user = userEvent.setup();
    renderPanel(migratedSnapshot());

    expect(screen.getByRole("heading", { name: "Advanced" })).toBeVisible();
    const toggle = screen.getByRole("button", {
      name: "Show advanced settings",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(
      screen.getByRole("button", { name: "Hide advanced settings" }),
    ).toHaveAttribute("aria-expanded", "true");
    const region = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    expect(region).not.toBeNull();
    expect(
      within(region!).getByRole("article", { name: "Poster" }),
    ).toBeVisible();

    const poster = profile("Poster");
    expect(
      within(poster).getByText(textContent("Updated 2 hours ago")),
    ).toBeVisible();
    expect(within(poster).getByText("gemini-3.8-flash · Studio")).toBeVisible();
    expect(
      within(poster).getByText(
        "Reasoning: Provider default · Image detail: Standard · Up to 45 s · 4,096 output tokens",
      ),
    ).toBeVisible();
    expect(
      within(poster).getByText(
        "Used by: Extract shows from image, Extract shows from text, Propose genre EQ, Refine Music Path",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/\bv1\b|version 1/i)).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(UUID);
    expect(text).not.toMatch(/[a-f0-9]{64}/);

    await user.click(
      within(poster).getByRole("button", { name: "Technical details" }),
    );
    expect(
      within(poster).getByText("Version").closest("div"),
    ).toHaveTextContent("1");
    expect(within(poster).getByText(PROFILE_ID)).toBeVisible();
    expect(within(poster).getByText("a".repeat(64))).toBeVisible();
    expect(within(poster).getByText(STUDIO_ID)).toBeVisible();
  });

  it("shows earlier versions with their update time and summary", async () => {
    const user = userEvent.setup();
    const snapshot = aiSnapshot();
    const poster = snapshot.profiles[0]!;
    const first = poster.versions[0]!;
    poster.current_version = 2;
    poster.versions = [
      {
        ...first,
        version: 2,
        model_id: "budget",
        fingerprint: "c".repeat(64),
        created_at: hoursAgo(1),
      },
      { ...first, created_at: hoursAgo(26) },
    ];
    renderPanel(snapshot);
    await expand(user);

    const article = profile("Poster");
    expect(
      within(article).getByText(textContent("Updated 1 hour ago")),
    ).toBeVisible();
    expect(within(article).getByText("budget · Studio")).toBeVisible();
    expect(within(article).getByText("Not used by any feature")).toBeVisible();

    const earlier = within(article).getByRole("button", {
      name: "Earlier versions (1)",
    });
    expect(earlier).toHaveAttribute("aria-expanded", "false");
    expect(
      within(article).queryByText(textContent("Updated yesterday")),
    ).not.toBeInTheDocument();
    await user.click(earlier);
    expect(earlier).toHaveAttribute("aria-expanded", "true");
    expect(
      within(article).getByText(textContent("Updated yesterday")),
    ).toBeVisible();
    expect(
      within(article).getByText(
        "gemini-3.8-flash · Reasoning: Provider default · Image detail: Standard · Up to 45 s · 4,096 output tokens",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/\bv[12]\b|version [12]/i)).toBeNull();
  });

  it("requires billable acknowledgement and reuses the acceptance identity after a lost response", async () => {
    apiMock
      .mockReset()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ task_id: "job1", deduplicated: true });
    const user = userEvent.setup();
    renderPanel(migratedSnapshot());
    await expand(user);

    await user.click(screen.getByRole("button", { name: "Test Poster" }));
    expect(apiMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", {
      name: "Run a billable test?",
    });
    expect(
      within(dialog).getByText(
        "Crate sends one small synthetic request to gemini-3.8-flash. Your provider may charge for it. No library data is sent, and there are no retries.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "Up to 45 s · 131,072 input and 4,096 output tokens reserved",
      ),
    ).toBeVisible();

    const run = within(dialog).getByRole("button", { name: "Run test" });
    expect(run).toBeDisabled();
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I understand this call may be billed",
      }),
    );
    expect(run).toBeEnabled();
    await user.click(run);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

    await user.click(within(dialog).getByRole("button", { name: "Run test" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(apiMock.mock.calls[0]).toEqual(apiMock.mock.calls[1]);
    expect(apiMock.mock.calls[0]?.[0]).toBe(TEST_PATH);
    expect(apiMock.mock.calls[0]?.[1]).toBe("POST");
    expect(apiMock.mock.calls[0]?.[2]).toEqual({
      acknowledged_billable: true,
      expected_fingerprint: "a".repeat(64),
      idempotency_key: expect.any(String),
    });
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "Testing…",
    );
    expect(useApiMock).toHaveBeenCalledWith("/api/admin/ai/jobs/job1");
    expect(
      within(dialog).queryByRole("button", { name: "Run test" }),
    ).not.toBeInTheDocument();
  });

  it("starts a new test identity each time the dialog opens", async () => {
    apiMock
      .mockReset()
      .mockResolvedValue({ task_id: null, deduplicated: false });
    const user = userEvent.setup();
    renderPanel(migratedSnapshot());
    await expand(user);

    async function runOnce() {
      await user.click(screen.getByRole("button", { name: "Test Poster" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Run a billable test?",
      });
      await user.click(
        within(dialog).getByRole("checkbox", {
          name: "I understand this call may be billed",
        }),
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Run test" }),
      );
      await within(dialog).findByRole("status");
      await user.click(within(dialog).getByRole("button", { name: "Done" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
    }

    await runOnce();
    await runOnce();
    expect(apiMock).toHaveBeenCalledTimes(2);
    const first = apiMock.mock.calls[0]?.[2] as { idempotency_key: string };
    const second = apiMock.mock.calls[1]?.[2] as { idempotency_key: string };
    expect(first.idempotency_key).not.toBe(second.idempotency_key);
  });

  it("creates an immutable version without changing features", async () => {
    const user = userEvent.setup();
    const { refresh } = renderPanel(migratedSnapshot());
    await expand(user);

    await user.click(
      within(profile("Poster")).getByRole("button", { name: "New version" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "New version of Poster",
    });
    expect(
      within(dialog).getByText("Saving a profile doesn't change any feature."),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("textbox", { name: "Name" }),
    ).not.toBeInTheDocument();
    // The current version's model is resolved from the catalog.
    expect(
      within(dialog).getByRole("combobox", { name: "Image detail" }),
    ).toBeEnabled();
    expect(within(dialog).getByLabelText("Output tokens")).toHaveAttribute(
      "max",
      "16000",
    );

    await choose(user, dialog, "Connection", "Studio");
    await choose(user, dialog, "Model", "Budget");
    expect(
      within(dialog).getByText(
        "Model changed. Review its options and limits before saving.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByLabelText("Output tokens")).toHaveValue(4000);
    expect(within(dialog).getByLabelText("Output tokens")).toHaveAttribute(
      "max",
      "4000",
    );
    expect(within(dialog).getByLabelText("Input tokens")).toHaveAttribute(
      "max",
      "28000",
    );
    await choose(user, dialog, "Reasoning", "On");

    const save = within(dialog).getByRole("button", {
      name: "Save new version",
    });
    expect(save).toBeDisabled();
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I reviewed this model's options and limits",
      }),
    );
    await user.click(save);

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/api/admin/ai/profiles/${PROFILE_ID}/versions`,
        "POST",
        expect.objectContaining({
          expected_version: 1,
          model_id: "budget",
          connection_id: STUDIO_ID,
          config: expect.objectContaining({
            reasoning: { mode: "enabled", level: null, budget_tokens: null },
            max_output_tokens: 4000,
          }),
        }),
      ),
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/admin/ai/bindings",
      expect.anything(),
      expect.anything(),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("blocks saving limits the model does not accept", async () => {
    const user = userEvent.setup();
    renderPanel(migratedSnapshot());
    await expand(user);

    await user.click(
      within(profile("Poster")).getByRole("button", { name: "New version" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "New version of Poster",
    });
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I reviewed this model's options and limits",
      }),
    );
    const save = within(dialog).getByRole("button", {
      name: "Save new version",
    });
    expect(save).toBeEnabled();

    const output = within(dialog).getByLabelText("Output tokens");
    await user.clear(output);
    expect(output).toHaveValue(null);
    expect(output).not.toHaveAttribute("value", "NaN");
    expect(save).toBeDisabled();
    await user.type(output, "20000");
    expect(
      within(dialog).getByText(
        "Choose an image detail and limits this model accepts.",
      ),
    ).toBeVisible();
    expect(save).toBeDisabled();
    await user.click(save);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("creates a named profile on the connection's persistent identity", async () => {
    const user = userEvent.setup();
    renderPanel(migratedSnapshot());
    await expand(user);

    await user.click(screen.getByRole("button", { name: "New profile" }));
    const dialog = await screen.findByRole("dialog", { name: "New profile" });
    await user.type(within(dialog).getByLabelText("Name"), "Fast posters");
    await choose(user, dialog, "Connection", "Gemini from server");
    await choose(user, dialog, "Model", "Gemini 3.8 Flash");
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I reviewed this model's options and limits",
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create profile" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/admin/ai/profiles", "POST", {
        label: "Fast posters",
        connection_id: ENV_GEMINI_PERSISTENT_ID,
        model_id: "gemini-3.8-flash",
        config: {
          reasoning: {
            mode: "provider_default",
            level: null,
            budget_tokens: null,
          },
          image_detail: "default",
          timeout_seconds: 45,
          max_output_tokens: 2048,
          max_input_tokens: 16384,
        },
      }),
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("marks inherited snapshots as not testable", async () => {
    const user = userEvent.setup();
    const snapshot = migratedSnapshot();
    snapshot.profiles.push(legacyProfile());
    renderPanel(snapshot);
    await expand(user);

    const legacy = profile("Extract shows from image");
    expect(
      within(legacy).getByText(
        "Kept from server settings. It can't be tested.",
      ),
    ).toBeVisible();
    expect(
      within(legacy).queryByRole("button", { name: /^Test/ }),
    ).not.toBeInTheDocument();
    expect(
      within(legacy).getByRole("button", { name: "New version" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Test Poster" })).toBeVisible();
  });

  it("hides tests and profile writes without their capabilities", async () => {
    const user = userEvent.setup();
    renderPanel(migratedSnapshot(), { capabilities: ["ai.config.read"] });
    await expand(user);

    const poster = profile("Poster");
    expect(
      within(poster).queryByRole("button", { name: "Test Poster" }),
    ).not.toBeInTheDocument();
    expect(
      within(poster).queryByRole("button", { name: "New version" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New profile" }),
    ).not.toBeInTheDocument();
  });
  it("retries a conflicting version against the refreshed profile and keeps the form", async () => {
    apiMock
      .mockReset()
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    const snapshot = migratedSnapshot();
    const view = renderPanel(snapshot);
    await expand(user);

    await user.click(
      within(profile("Poster")).getByRole("button", { name: "New version" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "New version of Poster",
    });
    await choose(user, dialog, "Model", "Budget");
    const reviewed = within(dialog).getByRole("checkbox", {
      name: "I reviewed this model's options and limits",
    });
    await user.click(reviewed);
    const save = within(dialog).getByRole("button", {
      name: "Save new version",
    });
    await user.click(save);

    await waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(apiMock.mock.calls[0]?.[2]).toMatchObject({ expected_version: 1 });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(CONFLICT_COPY);
    // Wait for the refreshed profile before saving again.
    expect(save).toBeDisabled();

    rerenderPanel(view, withPosterVersion2(snapshot));
    expect(
      within(dialog).getByRole("combobox", { name: "Model" }),
    ).toHaveTextContent("Budget");
    expect(reviewed).not.toBeChecked();
    await user.click(reviewed);
    await user.click(save);

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(apiMock.mock.calls[1]).toEqual([
      `/api/admin/ai/profiles/${PROFILE_ID}/versions`,
      "POST",
      expect.objectContaining({ expected_version: 2, model_id: "budget" }),
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("closes a stale billable test and refreshes the profile", async () => {
    apiMock.mockReset().mockRejectedValue(conflict("AI_CONTEXT_STALE"));
    const user = userEvent.setup();
    const { refresh } = renderPanel(migratedSnapshot());
    await expand(user);

    await user.click(screen.getByRole("button", { name: "Test Poster" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Run a billable test?",
    });
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "I understand this call may be billed",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Run test" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(CONFLICT_COPY);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
