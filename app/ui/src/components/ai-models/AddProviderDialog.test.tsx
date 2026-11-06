import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { aiSnapshot } from "./test-fixtures";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AddProviderDialog } from "./AddProviderDialog";

function renderDialog() {
  const refresh = vi.fn();
  const onOpenChange = vi.fn();
  renderWithAdminProviders(
    <AddProviderDialog
      snapshot={aiSnapshot()}
      open
      onOpenChange={onOpenChange}
      refresh={refresh}
    />,
  );
  return { refresh, onOpenChange };
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

async function openCompatible(user: UserEvent) {
  const dialog = await screen.findByRole("dialog", { name: "Add provider" });
  await user.click(
    within(dialog).getByRole("radio", { name: "OpenAI-compatible" }),
  );
  await user.type(within(dialog).getByLabelText("Name"), "Kimi");
  return dialog;
}

async function describeModel(
  user: UserEvent,
  dialog: HTMLElement,
  model: { id: string; context: string; output: string },
) {
  const entry = within(dialog).getByRole("group", { name: "Model 1" });
  await user.type(within(entry).getByLabelText("Model ID"), model.id);
  await user.type(
    within(entry).getByLabelText("Context window"),
    model.context,
  );
  await user.type(within(entry).getByLabelText("Max output"), model.output);
  return entry;
}

function submitButton(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "Add provider" });
}

beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({});
  vi.mocked(toast.error).mockReset();
});

describe("AddProviderDialog", () => {
  it("shows template origins", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await openCompatible(user);

    const origins: [string, string][] = [
      ["Moonshot (Kimi)", "https://api.moonshot.ai/v1"],
      [
        "DashScope international (Qwen)",
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      ],
      ["OpenRouter", "https://openrouter.ai/api/v1"],
    ];
    for (const [template, origin] of origins) {
      await choose(user, dialog, "Origin", template);
      expect(within(dialog).getByText(origin)).toBeVisible();
      // A predefined origin is fixed: there is no address to edit.
      expect(
        within(dialog).queryByLabelText("Address"),
      ).not.toBeInTheDocument();
    }
    expect(
      within(dialog).getByText(
        /Model IDs change, and Moonshot has no "latest" alias/,
      ),
    ).toBeVisible();

    await choose(user, dialog, "Origin", "Custom address");
    expect(within(dialog).getByLabelText("Address")).toBeVisible();
    expect(
      within(dialog).queryByText("https://openrouter.ai/api/v1"),
    ).not.toBeInTheDocument();
  });

  it("requires manifest entry with structured output", async () => {
    const user = userEvent.setup();
    const { refresh } = renderDialog();
    const dialog = await openCompatible(user);
    await choose(user, dialog, "Origin", "Moonshot (Kimi)");
    const entry = await describeModel(user, dialog, {
      id: "kimi-k3.1-pro",
      context: "262144",
      output: "32768",
    });

    expect(submitButton(dialog)).toBeDisabled();
    await choose(user, entry, "Structured output", "JSON object");
    expect(submitButton(dialog)).toBeEnabled();

    // A level control needs its levels; the template offers only its own controls.
    await user.click(
      within(entry).getByRole("combobox", { name: "Reasoning" }),
    );
    expect(
      screen.queryByRole("option", { name: /enable_thinking/ }),
    ).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole("option", { name: "reasoning_effort levels" }),
    );
    expect(submitButton(dialog)).toBeDisabled();
    await user.type(
      within(entry).getByLabelText("Reasoning levels"),
      "low, high, max",
    );
    // Output larger than the context window is not a valid declaration.
    await user.clear(within(entry).getByLabelText("Max output"));
    await user.type(within(entry).getByLabelText("Max output"), "300000");
    expect(submitButton(dialog)).toBeDisabled();
    await user.clear(within(entry).getByLabelText("Max output"));
    await user.type(within(entry).getByLabelText("Max output"), "32768");

    await user.click(within(dialog).getByRole("button", { name: "Add model" }));
    const second = within(dialog).getByRole("group", { name: "Model 2" });
    expect(submitButton(dialog)).toBeDisabled();
    await user.click(
      within(second).getByRole("button", { name: "Remove model 2" }),
    );
    expect(submitButton(dialog)).toBeEnabled();

    await user.click(submitButton(dialog));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/ai/connections",
        "POST",
        {
          label: "Kimi",
          provider: "openai_compatible",
          endpoint: null,
          template: "moonshot",
          model_manifest: [
            {
              model_id: "kimi-k3.1-pro",
              context_window: 262144,
              max_output_tokens: 32768,
              structured_output: "json_object",
              reasoning: "reasoning_effort",
              reasoning_levels: ["low", "high", "max"],
            },
          ],
        },
      ),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("custom origin asks confirmation", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await openCompatible(user);
    await choose(user, dialog, "Origin", "Custom address");
    await user.type(
      within(dialog).getByLabelText("Address"),
      "http://10.0.0.5:8000",
    );
    await choose(user, dialog, "Path prefix", "/v1");
    const entry = await describeModel(user, dialog, {
      id: "Qwen/Qwen3.8-27B",
      context: "32768",
      output: "8192",
    });
    await choose(user, entry, "Structured output", "JSON schema");
    await choose(user, entry, "Reasoning", "enable_thinking on/off");

    const confirmation = within(dialog).getByRole("checkbox", {
      name: "Send prompts and this provider's key to this address",
    });
    expect(confirmation).not.toBeChecked();
    expect(submitButton(dialog)).toBeDisabled();
    await user.click(confirmation);
    expect(submitButton(dialog)).toBeEnabled();

    await user.click(submitButton(dialog));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/ai/connections",
        "POST",
        {
          label: "Kimi",
          provider: "openai_compatible",
          endpoint: "http://10.0.0.5:8000",
          template: "custom",
          path_prefix: "/v1",
          confirm_custom_origin: true,
          model_manifest: [
            {
              model_id: "Qwen/Qwen3.8-27B",
              context_window: 32768,
              max_output_tokens: 8192,
              structured_output: "json_schema",
              reasoning: "enable_thinking",
              reasoning_levels: [],
            },
          ],
        },
      ),
    );
  });

  it("keeps the confirmation for the address it was given", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await openCompatible(user);
    await choose(user, dialog, "Origin", "Custom address");
    const address = within(dialog).getByLabelText("Address");
    await user.type(address, "https://llm.example.test");
    const confirmation = within(dialog).getByRole("checkbox", {
      name: "Send prompts and this provider's key to this address",
    });
    await user.click(confirmation);
    expect(confirmation).toBeChecked();
    await user.type(address, ":8443");
    expect(confirmation).not.toBeChecked();
    expect(
      within(dialog).getByText(
        "Use HTTPS unless the server is on your private network.",
      ),
    ).toBeVisible();
  });
});
