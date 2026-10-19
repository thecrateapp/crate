import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentCatalog } from "@/lib/agent-integrations";

import { ConnectionSnippets } from "./ConnectionSnippets";
import { PermissionPicker } from "./PermissionPicker";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const catalog: AgentCatalog = {
  mcp_enabled: true,
  actions_enabled: true,
  oauth_enabled: true,
  scopes: [
    {
      scope: "library.health.read",
      capability: "agents.integrations.manage",
      can_grant: true,
      label: "Inspect library health",
      group: "library",
      access: "read",
    },
    {
      scope: "library.repair.run",
      capability: "agents.repair.apply",
      can_grant: true,
      label: "Apply reviewed library repairs",
      group: "library",
      access: "change",
    },
    {
      scope: "ops.status.read",
      capability: "agents.integrations.manage",
      can_grant: true,
      label: "Read instance status",
      group: "instance",
      access: "read",
    },
    {
      scope: "ops.jobs.read",
      capability: "agents.integrations.manage",
      can_grant: true,
      label: "Read job history",
      group: "jobs",
      access: "read",
    },
    {
      scope: "curation.shows.read",
      capability: "agents.shows.manage",
      can_grant: true,
      label: "Read upcoming shows",
      group: "shows",
      access: "read",
    },
    {
      scope: "curation.shows.write",
      capability: "agents.shows.manage",
      can_grant: true,
      label: "Import reviewed shows",
      group: "shows",
      access: "change",
    },
    {
      scope: "editorial.read",
      capability: "agents.editorial.manage",
      can_grant: true,
      label: "Read editorial playlists and selections",
      group: "editorial",
      access: "read",
    },
    {
      scope: "editorial.publish",
      capability: "agents.editorial.publish",
      can_grant: false,
      label: "Change editorial playlist visibility",
      group: "editorial",
      access: "change",
    },
  ],
  scope_groups: [
    { id: "library", label: "Library" },
    { id: "shows", label: "Shows" },
    { id: "editorial", label: "Editorial" },
    { id: "jobs", label: "Jobs and schedules" },
    { id: "instance", label: "Instance" },
  ],
  presets: [
    {
      id: "read_only",
      label: "Read only",
      description:
        "Inspect library health, jobs, logs, schedules and shows. Cannot change anything.",
      scopes: [
        "library.health.read",
        "ops.status.read",
        "ops.jobs.read",
        "curation.shows.read",
        "editorial.read",
      ],
    },
    {
      id: "shows_curator",
      label: "Shows curator",
      description: "Read and import reviewed upcoming shows.",
      scopes: [
        "curation.shows.read",
        "curation.shows.write",
        "ops.status.read",
        "ops.jobs.read",
      ],
    },
    {
      id: "editorial_curator",
      label: "Editorial curator",
      description: "Prepare, apply and publish reviewed editorial playlists.",
      scopes: [
        "editorial.read",
        "editorial.publish",
        "ops.status.read",
        "ops.jobs.read",
      ],
    },
    {
      id: "library_maintainer",
      label: "Library maintainer",
      description:
        "Run checks, repairs, metadata, enrichment, analysis and sync on selected items.",
      scopes: [
        "library.health.read",
        "library.repair.run",
        "ops.status.read",
        "ops.jobs.read",
      ],
    },
  ],
  mcp_url: null,
  tools: [],
  limits: {
    calls_per_minute: 60,
    concurrent_calls: 2,
    active_maintenance_jobs: 1,
  },
};

const readOnlyPreset = catalog.presets.find(
  (preset) => preset.id === "read_only",
)!;

describe("PermissionPicker", () => {
  it("has a labelled radiogroup of preset and custom cards", () => {
    render(
      <PermissionPicker catalog={catalog} value={[]} onChange={vi.fn()} />,
    );
    expect(
      screen.getByRole("radiogroup", { name: "Access" }),
    ).toBeInTheDocument();
  });

  it("calls onChange with exactly the chosen preset's scopes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PermissionPicker catalog={catalog} value={[]} onChange={onChange} />,
    );

    await user.click(screen.getByRole("radio", { name: /Shows curator/ }));

    expect(onChange).toHaveBeenCalledWith([
      "curation.shows.read",
      "curation.shows.write",
      "ops.status.read",
      "ops.jobs.read",
    ]);
  });

  it("checks the matching preset radio for the current value", () => {
    render(
      <PermissionPicker
        catalog={catalog}
        value={readOnlyPreset.scopes}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /Read only/ })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Shows curator/ }),
    ).not.toBeChecked();
  });

  it("shows grouped checkboxes with ids only in the title when Custom is chosen", async () => {
    const user = userEvent.setup();
    render(
      <PermissionPicker
        catalog={catalog}
        value={readOnlyPreset.scopes}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Custom" }));

    const showsGroup = screen.getByRole("group", { name: "Shows" });
    expect(
      within(showsGroup).getByText("Read upcoming shows"),
    ).toBeInTheDocument();
    expect(screen.queryByText("curation.shows.read")).not.toBeInTheDocument();
    expect(screen.getByTitle("curation.shows.read")).toBeInTheDocument();
  });

  it("disables a preset that needs a permission the caller lacks", () => {
    render(
      <PermissionPicker catalog={catalog} value={[]} onChange={vi.fn()} />,
    );

    const editorialRadio = screen.getByRole("radio", {
      name: /Editorial curator/,
    });
    expect(editorialRadio).toBeDisabled();
    expect(
      screen.getByText(
        "Needs a permission you don't have: Change editorial playlist visibility",
      ),
    ).toBeInTheDocument();
  });

  it("disables an ungrantable scope checkbox in the custom editor", async () => {
    const user = userEvent.setup();
    render(
      <PermissionPicker catalog={catalog} value={[]} onChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("radio", { name: "Custom" }));

    expect(
      screen.getByLabelText("Change editorial playlist visibility"),
    ).toBeDisabled();
    expect(
      screen.getByText("Requires additional permission"),
    ).toBeInTheDocument();
  });
});

describe("ConnectionSnippets", () => {
  afterEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("shows the placeholder URL and a note when there is no MCP address", () => {
    render(<ConnectionSnippets url={null} token="crate_mcp_tok" />);

    expect(
      screen.getByText(/your-crate-api/, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Set CRATE_MCP_OAUTH_ISSUER on the server to show your MCP address here. Replace the placeholder with your Crate API address.",
      ),
    ).toBeInTheDocument();
  });

  it("switches to the Codex snippet and copies the visible configuration", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <ConnectionSnippets
        url="https://api.example.com/mcp"
        token="crate_mcp_tok"
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Codex" }));
    expect(screen.getByText(/bearer_token_env_var/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Copy configuration" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("bearer_token_env_var"),
    );
  });
});
