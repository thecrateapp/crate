import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentPlan } from "@/lib/agent-integrations";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { apiMock, toastSuccessMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: vi.fn() },
}));

import { AgentPlanReview } from "./AgentPlanReview";

const base = "/api/admin/agent-plans";
const uid = "10000000-0000-0000-0000-000000000001";

function plan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    plan_id: "plan-one",
    principal_id: "service-one",
    state: "awaiting_approval",
    approval_required: true,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    plan_version: "a".repeat(64),
    content_hash: "b".repeat(64),
    authorization_context_hash: "c".repeat(64),
    policy_revision: 7,
    operation: "repair_photo_flag",
    risk: "low",
    target_count: 1,
    returned_count: 1,
    truncated: false,
    targets: [{ artist_uid: uid, name: "Echo" }],
    changes: [
      { artist_uid: uid, field: "has_photo", before: false, after: true },
    ],
    impact: { artist_count: 1, filesystem_writes: false, notifications: false },
    reversibility: "The flag can be recomputed from current photo evidence.",
    source_versions: {
      observation_id: "observation-one",
      observed_at: new Date().toISOString(),
    },
    authorization_context: {},
    ...overrides,
  };
}

function metadataPlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return plan({
    operation: "metadata_update",
    risk: "caution",
    targets: [{ entity_type: "artist", entity_uid: uid, name: "Echo" }],
    changes: [
      {
        entity_uid: uid,
        field: "bio",
        before: "Old biography",
        after: "New biography",
      },
      {
        entity_uid: uid,
        field: "tags",
        before: ["Old tag"],
        after: ["New tag"],
      },
    ],
    source_versions: { database: "d".repeat(64), files: [] },
    impact: {
      database: true,
      filesystem: false,
      locks_modified_fields: true,
      provenance: "manual_edit",
    },
    reversibility:
      "A new reviewed plan is required to change these values again.",
    ...overrides,
  });
}

function analysisPlan(): AgentPlan {
  return plan({
    operation: "analysis",
    risk: "caution",
    targets: [{ entity_type: "track", entity_uid: uid }],
    changes: [
      {
        entity_uid: uid,
        pipeline: "analysis",
        before: "done",
        after: "pending",
        generation_before: 3,
      },
    ],
    source_versions: { database: "d".repeat(64), files: [] },
    impact: {
      database: true,
      filesystem: false,
      audio_read: true,
      tracks: 1,
      bytes_scheduled: 1000,
      pipelines: ["analysis"],
      completion: "asynchronous_daemon_results",
      may_replace_existing_results: true,
    },
    reversibility:
      "Existing analysis values remain until a new result commits.",
  });
}

// Mirrors agent_editorial.compile_operation and the persisted get_plan DTO:
// changes is a playlist summary; the exact editorial content is top-level.
function editorialPlan(overrides: Record<string, unknown> = {}) {
  return {
    ...plan(),
    operation: "editorial_change",
    kind: "edit",
    risk: "high",
    targets: [{ entity_type: "playlist", name: "42" }],
    changes: [
      {
        field: "playlist",
        targets: [{ entity_type: "playlist", name: "42" }],
        kind: "edit",
        name: "Night drive",
        track_count: 2,
        description: "A complete evening selection",
        generation_mode: "smart",
        scope: "system",
        visibility: "public",
        is_active_before: true,
        is_active_after: true,
        auto_refresh_before: false,
        auto_refresh_after: false,
      },
    ],
    metadata: {
      name: "Night drive",
      description: "A complete evening selection",
      scope: "system",
      visibility: "public",
      generation_mode: "smart",
      is_active: true,
      auto_refresh_enabled: false,
    },
    selection: [
      {
        row_id: null,
        track_uid: "track-second",
        global_track_uid: null,
        title: "Second track",
        artist: "Second artist",
        album: "Second album",
        duration: 240,
        position: 1,
        source: "generated",
        locked: false,
      },
      {
        row_id: 9,
        track_uid: null,
        global_track_uid: "global-first",
        title: "First track",
        artist: "First artist",
        album: "First album",
        duration: null,
        position: 2,
        source: "manual",
        locked: true,
      },
    ],
    smart_rules: {
      match: "all",
      rules: [{ field: "genre", op: "eq", value: "Ambient" }],
      sort: "random",
      limit: 2,
    },
    new_exclusions: ["excluded-new"],
    existing_exclusions: [
      { track_uid: "excluded-existing", global_track_uid: null },
    ],
    copied_exclusions: [],
    source_revision: 4,
    generation_epoch: 2,
    impact: {
      playlist_count: 1,
      track_count: 2,
      duration_seconds: 240,
      public_discovery: true,
      notifications: false,
      future_refresh_notifications: false,
    },
    provenance: {
      source: "local_library",
      actor_principal_id: "service-one",
      prepared_by: "crate_worker",
    },
    source_versions: undefined,
    ...overrides,
  };
}

function renderReview(capabilities?: string[]) {
  return renderWithAdminProviders(
    <Routes>
      <Route
        path="/agent-plans/:planId"
        element={
          <>
            <Link to="/agent-plans/plan-two">Next review target</Link>
            <AgentPlanReview />
          </>
        }
      />
    </Routes>,
    {
      route: "/agent-plans/plan-one",
      auth: capabilities
        ? { hasCapability: (capability) => capabilities.includes(capability) }
        : undefined,
    },
  );
}

function exactDecision(
  item: Pick<
    AgentPlan,
    | "plan_version"
    | "content_hash"
    | "policy_revision"
    | "authorization_context_hash"
  >,
) {
  return {
    plan_version: item.plan_version,
    content_hash: item.content_hash,
    policy_revision: item.policy_revision,
    authorization_context_hash: item.authorization_context_hash,
  };
}

beforeEach(() => {
  apiMock.mockReset();
  toastSuccessMock.mockReset();
});

describe("AgentPlanReview", () => {
  it("reviews the real editorial selection in order with locks, rules, exclusions and metadata", async () => {
    const user = userEvent.setup();
    const item = editorialPlan();
    apiMock.mockResolvedValue(item);
    renderReview([
      "agents.plans.review",
      "agents.plans.approve",
      "curation.playlists.write",
    ]);

    const selection = await screen.findByRole("table", {
      name: "Complete editorial selection",
    });
    const rows = within(selection).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("1");
    expect(rows[1]).toHaveTextContent("track-second");
    expect(rows[1]).toHaveTextContent("Second track");
    expect(rows[1]).toHaveTextContent("Second artist");
    expect(rows[1]).toHaveTextContent("Second album");
    expect(rows[1]).toHaveTextContent("240");
    expect(rows[1]).toHaveTextContent("generated");
    expect(rows[1]).toHaveTextContent("Unlocked");
    expect(rows[2]).toHaveTextContent("2");
    expect(rows[2]).toHaveTextContent("global-first");
    expect(rows[2]).toHaveTextContent("First track");
    expect(rows[2]).toHaveTextContent("manual");
    expect(rows[2]).toHaveTextContent("Locked");
    const details = screen.getByRole("region", {
      name: "Complete editorial details",
    });
    expect(details).toHaveTextContent("A complete evening selection");
    expect(details).toHaveTextContent('"generation_mode": "smart"');
    expect(details).toHaveTextContent('"auto_refresh_enabled": false');
    expect(details).toHaveTextContent("Ambient");
    expect(details).toHaveTextContent("excluded-new");
    expect(details).toHaveTextContent("excluded-existing");
    expect(details).toHaveTextContent('"source_revision": 4');
    expect(details).toHaveTextContent('"generation_epoch": 2');
    expect(details).toHaveTextContent("crate_worker");
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Approve exact plan" }),
    );
    expect(apiMock).toHaveBeenCalledWith(
      `${base}/plan-one/approve`,
      "POST",
      exactDecision(item),
    );
  });

  it("shows the exact copied exclusions in a duplicate editorial plan", async () => {
    const item = editorialPlan();
    apiMock.mockResolvedValue(
      editorialPlan({
        kind: "duplicate",
        changes: [{ ...item.changes[0], kind: "duplicate" }],
        new_exclusions: [],
        copied_exclusions: item.existing_exclusions,
      }),
    );
    renderReview();
    const details = await screen.findByRole("region", {
      name: "Complete editorial details",
    });
    expect(details).toHaveTextContent(
      '"copied_exclusions": [ { "track_uid": "excluded-existing", "global_track_uid": null } ]',
    );
  });

  it.each([
    ["missing selection", { selection: undefined }],
    ["selection shorter than the summary", { selection: [] }],
    ["missing smart rules", { smart_rules: undefined }],
    ["missing new exclusions", { new_exclusions: undefined }],
    ["missing existing exclusions", { existing_exclusions: undefined }],
    ["missing copied exclusions", { copied_exclusions: undefined }],
    ["missing metadata", { metadata: undefined }],
    ["missing generation epoch", { generation_epoch: undefined }],
    ["unknown editorial operation", { kind: "unknown" }],
    [
      "missing selected track lock",
      {
        selection: editorialPlan().selection.map((track) => ({
          ...track,
          locked: undefined,
        })),
      },
    ],
    [
      "missing selected track metadata",
      {
        selection: editorialPlan().selection.map((track) => ({
          ...track,
          title: undefined,
        })),
      },
    ],
    [
      "missing selected track identity",
      {
        selection: editorialPlan().selection.map((track) => ({
          ...track,
          track_uid: null,
          global_track_uid: null,
        })),
      },
    ],
    [
      "incomplete selected order",
      {
        selection: editorialPlan().selection.map((track) => ({
          ...track,
          position: 1,
        })),
      },
    ],
    [
      "duplicate local track identity",
      {
        selection: editorialPlan().selection.map((track) => ({
          ...track,
          track_uid: "track-second",
        })),
      },
    ],
  ])(
    "blocks approval for editorial content with %s",
    async (_label, invalid) => {
      const user = userEvent.setup();
      apiMock.mockResolvedValue(editorialPlan(invalid));
      renderReview();
      const approve = await screen.findByRole("button", {
        name: "Approve exact plan",
      });
      await user.click(screen.getByRole("checkbox"));
      expect(approve).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "complete change list",
      );
    },
  );

  it.each(["visibility", "refresh_policy"])(
    "allows a real %s editorial plan with an empty selection and existing track count",
    async (kind) => {
      const user = userEvent.setup();
      const item = editorialPlan();
      apiMock.mockResolvedValue(
        editorialPlan({
          kind,
          changes: [{ ...item.changes[0], kind, track_count: 120 }],
          selection: [],
          smart_rules: null,
          new_exclusions: [],
          impact: { ...item.impact, track_count: 120, duration_seconds: 0 },
        }),
      );
      renderReview();
      await screen.findByRole("table", { name: "Complete proposed changes" });
      await user.click(screen.getByRole("checkbox"));
      expect(
        screen.getByRole("button", { name: "Approve exact plan" }),
      ).toBeEnabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("allows a complete static editorial plan with an explicitly empty selection", async () => {
    const user = userEvent.setup();
    const item = editorialPlan();
    apiMock.mockResolvedValue(
      editorialPlan({
        changes: [
          { ...item.changes[0], track_count: 0, generation_mode: "static" },
        ],
        metadata: { ...item.metadata, generation_mode: "static" },
        selection: [],
        smart_rules: null,
        new_exclusions: [],
        impact: { ...item.impact, track_count: 0, duration_seconds: 0 },
      }),
    );
    renderReview();
    await screen.findByRole("table", { name: "Complete proposed changes" });
    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeEnabled();
  });

  it("reviews a repair issue with several exact nested targets and dependent losses", async () => {
    const user = userEvent.setup();
    const trackUid = "20000000-0000-0000-0000-000000000002";
    const targets = [
      { entity_type: "artist", entity_uid: uid, name: "Echo" },
      { entity_type: "track", entity_uid: trackUid, name: "Missing track" },
    ];
    const item = plan({
      operation: "repairs",
      risk: "destructive",
      target_count: 2,
      returned_count: 2,
      targets,
      changes: [
        {
          issue_id: 42,
          check_type: "stale_tracks",
          action: "delete_track",
          executable: true,
          targets,
          deleted_targets: [{ entity_type: "track", entity_uid: trackUid }],
          dependent_relations: [
            {
              relation: "user_liked_tracks",
              on_delete: "c",
              rows: [
                {
                  keys: { user_id: 7, track_id: 9 },
                  source_hash: "f".repeat(64),
                },
              ],
            },
          ],
        },
      ],
      impact: { metadata_relationship_loss: true, audio_deleted: false },
    });
    apiMock.mockResolvedValue(item);
    renderReview();
    const table = await screen.findByRole("table", {
      name: "Complete proposed changes",
    });
    expect(table).toHaveTextContent("user_liked_tracks");
    expect(table).toHaveTextContent(trackUid);
    const approve = screen.getByRole("button", { name: "Approve exact plan" });
    await user.click(screen.getByRole("checkbox"));
    expect(approve).toBeEnabled();
    await user.click(approve);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/plan-one/approve`,
        "POST",
        exactDecision(item),
      ),
    );
  });

  it("rejects a repair change containing a nested target outside the declared selection", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue(
      plan({
        operation: "repairs",
        risk: "destructive",
        targets: [{ entity_type: "artist", entity_uid: uid }],
        changes: [
          {
            action: "delete_artist",
            targets: [
              { entity_type: "artist", entity_uid: "unapproved-target" },
            ],
          },
        ],
      }),
    );
    renderReview();
    const approve = await screen.findByRole("button", {
      name: "Approve exact plan",
    });
    await user.click(screen.getByRole("checkbox"));
    expect(approve).toBeDisabled();
  });

  it("reviews every metadata field for one target with its domain permission", async () => {
    const user = userEvent.setup();
    const item = metadataPlan();
    apiMock.mockResolvedValue(item);
    renderReview([
      "agents.plans.review",
      "agents.plans.approve",
      "library.metadata.write",
    ]);

    const table = await screen.findByRole("table", {
      name: "Complete proposed changes",
    });
    expect(table).toHaveTextContent("Old biography");
    expect(table).toHaveTextContent("New biography");
    expect(table).toHaveTextContent("Old tag");
    expect(table).toHaveTextContent("New tag");
    expect(screen.getAllByRole("row")).toHaveLength(3);
    const approve = screen.getByRole("button", { name: "Approve exact plan" });
    expect(approve).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(approve).toBeEnabled();
    await user.click(approve);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/plan-one/approve`,
        "POST",
        exactDecision(item),
      ),
    );
  });

  it("does not treat a repair capability as metadata approval authority", async () => {
    apiMock.mockResolvedValue(metadataPlan());
    renderReview([
      "agents.plans.review",
      "agents.plans.approve",
      "library.repair.run",
    ]);
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Approve exact plan" }),
      ).not.toBeInTheDocument(),
    );
    expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
      false,
    );
  });

  it("allows metadata reviewers to inspect without granting approval", async () => {
    apiMock.mockResolvedValue(metadataPlan());
    renderReview(["agents.plans.review", "library.metadata.write"]);
    const table = await screen.findByRole("table", {
      name: "Complete proposed changes",
    });
    expect(table).toHaveTextContent("New biography");
    expect(
      screen.queryByRole("button", { name: "Approve exact plan" }),
    ).not.toBeInTheDocument();
  });

  it("allows analysis managers to approve an exact analysis plan", async () => {
    const user = userEvent.setup();
    const item = analysisPlan();
    apiMock.mockResolvedValue(item);
    renderReview([
      "agents.plans.review",
      "agents.plans.approve",
      "library.analysis.manage",
    ]);
    const approve = await screen.findByRole("button", {
      name: "Approve exact plan",
    });
    expect(approve).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(approve).toBeEnabled();
    await user.click(approve);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/plan-one/approve`,
        "POST",
        exactDecision(item),
      ),
    );
  });

  it("does not grant metadata editors authority to approve analysis", async () => {
    apiMock.mockResolvedValue(analysisPlan());
    renderReview([
      "agents.plans.review",
      "agents.plans.approve",
      "library.metadata.write",
    ]);
    await screen.findByRole("table", { name: "Complete proposed changes" });
    expect(
      screen.queryByRole("button", { name: "Approve exact plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject plan" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["high-risk metadata", () => metadataPlan({ risk: "destructive" })],
    [
      "global quality scan",
      () =>
        plan({
          operation: "quality_check",
          risk: "safe",
          targets: [{ entity_type: "library", scope: "global" }],
          changes: [{ action: "scan_metadata", scope: "global", checks: [] }],
          source_versions: { artist: null },
          impact: {
            scope: "global",
            filesystem_writes: false,
            database: "quality_snapshot",
            scans_audio_metadata: true,
          },
        }),
    ],
  ] as const)(
    "requires an explicit exact review for %s",
    async (_label, makePlan) => {
      const user = userEvent.setup();
      const item = makePlan();
      apiMock.mockResolvedValue(item);
      renderReview();
      const approve = await screen.findByRole("button", {
        name: "Approve exact plan",
      });
      expect(approve).toBeDisabled();
      await user.click(screen.getByRole("checkbox"));
      expect(approve).toBeEnabled();
      await user.click(approve);
      await waitFor(() =>
        expect(apiMock).toHaveBeenCalledWith(
          `${base}/plan-one/approve`,
          "POST",
          exactDecision(item),
        ),
      );
    },
  );

  it("renders complete long metadata values without truncating the reviewed content", async () => {
    const biography =
      "Unabridged biography " + "música contemporánea ".repeat(200);
    apiMock.mockResolvedValue(
      metadataPlan({
        changes: [
          {
            entity_uid: uid,
            field: "bio",
            before: "Old biography",
            after: biography,
          },
        ],
      }),
    );
    renderReview();
    const table = await screen.findByRole("table", {
      name: "Complete proposed changes",
    });
    expect(table.textContent).toContain(biography);
  });

  it("shows an explicit cleared value as null in the After column", async () => {
    apiMock.mockResolvedValue(
      metadataPlan({
        changes: [
          {
            entity_uid: uid,
            field: "bio",
            before: "Old biography",
            after: null,
          },
        ],
      }),
    );
    renderReview();
    await screen.findByRole("table", { name: "Complete proposed changes" });
    const row = screen.getByRole("row", { name: /Old biography/ });
    expect(row.querySelectorAll("td")[2]).toHaveTextContent(/^null$/);
  });

  it("keeps a manual-only plan reviewable without granting execution approval", async () => {
    apiMock.mockResolvedValue(metadataPlan({ executable: false }));
    renderReview();
    expect(
      await screen.findByRole("table", { name: "Complete proposed changes" }),
    ).toHaveTextContent("New biography");
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeDisabled();
  });

  it("rejects a complete manual-only diagnostic repair using its exact review hashes", async () => {
    const user = userEvent.setup();
    const diagnosticTarget = {
      entity_type: "library",
      scope: "global",
      diagnostic_only: true,
    };
    let current = plan({
      operation: "repairs",
      executable: false,
      risk: "destructive",
      targets: [diagnosticTarget],
      changes: [
        {
          issue_id: 42,
          check_type: "folder_naming",
          executable: false,
          support: "manual",
          scope: "global",
          reason: "A human must review directory names",
        },
      ],
    });
    const reviewed = current;
    apiMock.mockImplementation(async (_path, method) => {
      if (method === "POST") {
        current = { ...current, state: "rejected" };
        return current;
      }
      return current;
    });
    renderReview();
    await screen.findByRole("table", { name: "Complete proposed changes" });
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Reject plan" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/plan-one/reject`,
        "POST",
        exactDecision(reviewed),
      ),
    );
  });

  it.each([
    ["truncated generic plan", { truncated: true }],
    ["missing generic target", { targets: [] }],
    ["incorrect returned count", { returned_count: 0 }],
    [
      "change outside selected targets",
      {
        changes: [
          {
            entity_uid: "unselected",
            field: "bio",
            before: "Old",
            after: "New",
          },
        ],
      },
    ],
  ] satisfies [string, Partial<AgentPlan>][])(
    "blocks approval for %s",
    async (_label, invalid) => {
      const user = userEvent.setup();
      apiMock.mockResolvedValue(metadataPlan(invalid));
      renderReview();
      const approve = await screen.findByRole("button", {
        name: "Approve exact plan",
      });
      await user.click(screen.getByRole("checkbox"));
      expect(approve).toBeDisabled();
      expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
        false,
      );
    },
  );

  it.each([
    ["domain permission", ["agents.plans.review", "agents.plans.approve"]],
    ["review permission", ["agents.plans.approve", "library.repair.run"]],
  ] as const)("does not fetch plans without %s", (_label, capabilities) => {
    renderReview([...capabilities]);
    expect(
      screen.getByText("You do not have permission to review these plans."),
    ).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("lets reviewers inspect exact changes without approval controls", async () => {
    apiMock.mockResolvedValue(plan());
    renderReview(["agents.plans.review", "library.repair.run"]);
    expect(
      await screen.findByRole("table", { name: "Complete proposed changes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Echo")).toBeInTheDocument();
    expect(screen.getByText("No photo")).toBeInTheDocument();
    expect(screen.getByText("Photo present")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve exact plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject plan" }),
    ).not.toBeInTheDocument();
  });

  it.each(["approve", "reject"] as const)(
    "submits a human %s decision with the exact reviewed hashes and policy",
    async (decision) => {
      const user = userEvent.setup();
      let current = plan();
      const reviewed = current;
      apiMock.mockImplementation((_path: string, method = "GET") => {
        if (method === "POST")
          current = {
            ...current,
            state: decision === "approve" ? "authorized" : "rejected",
          };
        return Promise.resolve(current);
      });
      renderReview();
      const button = await screen.findByRole("button", {
        name: decision === "approve" ? "Approve exact plan" : "Reject plan",
      });
      expect(button).toBeDisabled();
      await user.click(
        screen.getByRole("checkbox", {
          name: "I reviewed all 1 proposed changes and their effects.",
        }),
      );
      expect(button).toBeEnabled();
      await user.click(button);

      await waitFor(() =>
        expect(apiMock).toHaveBeenCalledWith(
          `${base}/plan-one/${decision}`,
          "POST",
          exactDecision(reviewed),
        ),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Approve exact plan" }),
        ).not.toBeInTheDocument(),
      );
      expect(toastSuccessMock).toHaveBeenCalledWith(
        decision === "approve" ? "Plan approved" : "Plan rejected",
      );
      expect(
        apiMock.mock.calls.filter(([, method]) => method === "POST"),
      ).toHaveLength(1);
    },
  );

  it.each([
    ["truncated changes", { truncated: true }],
    ["missing change", { changes: [] }],
    ["missing target", { targets: [] }],
    [
      "mismatched target",
      { targets: [{ artist_uid: "another-artist", name: "Another" }] },
    ],
    [
      "empty target selection",
      { targets: [], changes: [], target_count: 0, returned_count: 0 },
    ],
    ["expired plan", { expires_at: "2020-01-01T00:00:00Z" }],
    ["invalid expiry", { expires_at: "invalid-timestamp" }],
  ] satisfies [string, Partial<AgentPlan>][])(
    "blocks approval for %s",
    async (_label, invalid) => {
      const user = userEvent.setup();
      apiMock.mockResolvedValue(plan(invalid));
      renderReview();
      const button = await screen.findByRole("button", {
        name: "Approve exact plan",
      });
      const checkbox = screen.getByRole("checkbox");
      if (!checkbox.hasAttribute("disabled")) await user.click(checkbox);
      expect(button).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Reject plan" }),
      ).toBeDisabled();
      expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
        false,
      );
    },
  );

  it("requires a fresh review after a conflicting decision and reloads the changed version", async () => {
    const user = userEvent.setup();
    let current = plan();
    let conflict = true;
    apiMock.mockImplementation((_path: string, method = "GET") => {
      if (method === "POST" && conflict)
        return Promise.reject(
          Object.assign(
            new Error("The reviewed plan or policy is no longer current"),
            { status: 409 },
          ),
        );
      if (method === "POST") current = { ...current, state: "authorized" };
      return Promise.resolve(current);
    });
    renderReview();
    await screen.findByText("Echo");
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Approve exact plan" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The reviewed plan or policy is no longer current",
    );
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeDisabled();
    expect(screen.getByText("Echo")).toBeInTheDocument();

    current = {
      ...current,
      plan_version: "d".repeat(64),
      content_hash: "e".repeat(64),
      policy_revision: 8,
    };
    conflict = false;
    await user.click(screen.getByRole("button", { name: "Reload plan" }));
    await screen.findByText(/Policy revision 8/);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Approve exact plan" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith(
        `${base}/plan-one`,
        "GET",
        undefined,
        expect.any(Object),
      ),
    );
    expect(apiMock).toHaveBeenCalledWith(
      `${base}/plan-one/approve`,
      "POST",
      exactDecision(current),
    );
  });

  it("resets the review checkbox when navigating to another exact plan", async () => {
    const user = userEvent.setup();
    const first = plan();
    const second = plan({
      plan_id: "plan-two",
      plan_version: "d".repeat(64),
      content_hash: "e".repeat(64),
      targets: [{ artist_uid: uid, name: "Second artist" }],
    });
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/plan-two") ? second : first),
    );
    renderReview();
    await screen.findByText("Echo");
    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeEnabled();

    await user.click(screen.getByRole("link", { name: "Next review target" }));
    await screen.findByText("Second artist");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeDisabled();
    expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
      false,
    );
  });
});

it.each([
  ["shows_import", "curation.shows.write", "show", "show-a"],
  ["job_cancel", "ops.tasks.manage", "task", "job-a"],
  ["runtime_update", "ops.runtime.manage", "runtime", "instance"],
])(
  "approves complete %s plans using the correct domain capability",
  async (operation, capability, kind, name) => {
    const user = userEvent.setup();
    const target = { entity_type: kind, name };
    const item = plan({
      operation,
      risk: "high",
      targets: [target],
      changes: [
        {
          targets: [target],
          field: "selection",
          before: { id: 1 },
          after: { id: 2 },
        },
      ],
    });
    apiMock.mockResolvedValue(item);
    renderReview(["agents.plans.review", "agents.plans.approve", capability]);
    await screen.findByRole("table", { name: "Complete proposed changes" });
    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "Approve exact plan" }),
    );
    expect(apiMock).toHaveBeenCalledWith(
      base + "/plan-one/approve",
      "POST",
      exactDecision(item),
    );
  },
);
