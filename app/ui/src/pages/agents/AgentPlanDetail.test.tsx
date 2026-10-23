import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { AgentPlanDetail } from "./AgentPlanDetail";

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

const showTarget = {
  entity_type: "show",
  name: "c806cc6aac1892d0f55080693074769aff9f8e9d321c82755196e80977eb7812",
  label: "Coilguns · 2027-03-14",
};

// Mirrors the lab shows_import plan: an existing show (before) and the
// reviewed candidate (after), targeted by a hashed show identity.
function showImportPlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  const itemId = "6cff6a09-f56b-45ef-aaf4-7e9a4836ff0d";
  return plan({
    operation: "shows_import",
    risk: "safe",
    integration_name: "Local lab MCP",
    integration_kind: "service",
    created_at: new Date(Date.now() - 120_000).toISOString(),
    targets: [showTarget],
    changes: [
      {
        item_id: itemId,
        field: "show",
        targets: [showTarget],
        before: {
          artist_name: "Coilguns",
          date: "2027-03-14",
          local_time: null,
          doors_time: "21:00",
          timezone: null,
          venue: "Wurlitzer Ballroom",
          city: "Madrid",
          region: null,
          country: "Spain",
          country_code: "ES",
          address_line1: "Calle de las Tres Cruces, 12",
          postal_code: "28013",
          latitude: null,
          longitude: null,
          url: null,
          tickets_url: null,
          image_url: null,
          lineup: ["Coilguns"],
          price_range: "€17.54",
          status: "scheduled",
        },
        after: {
          city: "Madrid",
          date: "2027-03-14",
          venue: "WURLITZER BALLROOM",
          item_id: itemId,
          timezone: "Europe/Madrid",
          local_time: "21:00",
          artist_name: "Coilguns",
          country_code: "ES",
        },
      },
    ],
    impact: { scope: "selected", filesystem: false, public: true, shows: 1 },
    reversibility: "new_plan_required",
    source_versions: {
      shows: "fea51baa1103b3b5747f345868815ebfb60d53dbfbe033935f325795e281f4ca",
    },
    ...overrides,
  });
}

function renderReview(capabilities?: string[]) {
  return renderWithAdminProviders(
    <Routes>
      <Route
        path="/agents/approvals/:planId"
        element={
          <>
            <Link to="/agents/approvals/plan-two">Next review target</Link>
            <AgentPlanDetail />
          </>
        }
      />
    </Routes>,
    {
      route: "/agents/approvals/plan-one",
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AgentPlanDetail", () => {
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
    expect(screen.getByText(/Requested by Unknown connection/)).toHaveClass(
      "text-text-secondary",
    );
    const rows = within(selection).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("1");
    expect(rows[1]).toHaveTextContent("Second track");
    expect(rows[1]).toHaveTextContent("Second artist");
    expect(rows[1]).toHaveTextContent("Second album");
    expect(rows[1]).toHaveTextContent("4:00");
    expect(rows[1]).toHaveTextContent("generated");
    expect(rows[1]).toHaveTextContent("Unlocked");
    expect(rows[2]).toHaveTextContent("2");
    expect(rows[2]).toHaveTextContent("First track");
    expect(rows[2]).toHaveTextContent("manual");
    expect(rows[2]).toHaveTextContent("Locked");
    const details = screen.getByRole("region", {
      name: "Complete editorial details",
    });
    // Track identities are exact review data but live in Technical details.
    expect(details).not.toHaveTextContent("track-second");
    expect(details).not.toHaveTextContent("excluded-new");
    expect(details).toHaveTextContent(/New exclusions\s*1 excluded track/);
    expect(details).toHaveTextContent(/Existing exclusions\s*1 excluded track/);
    expect(details).toHaveTextContent(/Copied exclusions\s*No excluded tracks/);
    expect(details).not.toHaveTextContent("service-one");
    await user.click(
      within(details).getByRole("button", { name: "Track identities" }),
    );
    expect(details).toHaveTextContent("track-second");
    expect(details).toHaveTextContent("global-first");
    expect(details).toHaveTextContent("A complete evening selection");
    expect(details).toHaveTextContent(/Generation mode\s*smart/);
    expect(details).toHaveTextContent(/Auto refresh enabled\s*No/);
    expect(details).toHaveTextContent("Ambient");
    expect(details).toHaveTextContent("excluded-new");
    expect(details).toHaveTextContent("excluded-existing");
    expect(details).toHaveTextContent(/Source revision\s*4/);
    expect(details).toHaveTextContent(/Generation epoch\s*2/);
    expect(details).toHaveTextContent("crate_worker");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Approve" }));
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
    const user = userEvent.setup();
    renderReview();
    const details = await screen.findByRole("region", {
      name: "Complete editorial details",
    });
    expect(details).toHaveTextContent(/Copied exclusions\s*1 excluded track/);
    expect(details).not.toHaveTextContent("excluded-existing");
    await user.click(
      within(details).getByRole("button", { name: "Track identities" }),
    );
    expect(
      within(details).getByText("Copied exclusion 1 · Track ID").parentElement,
    ).toHaveTextContent("excluded-existing");
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
        name: "Approve",
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
      await screen.findByRole("list", { name: "Proposed changes" });
      await user.click(screen.getByRole("checkbox"));
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
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
    await screen.findByRole("list", { name: "Proposed changes" });
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
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
    const list = await screen.findByRole("list", {
      name: "Proposed changes",
    });
    expect(list).toHaveTextContent("user_liked_tracks");
    // Every target of the change is named on the card, not only the first.
    expect(within(list).getByText("Echo")).toBeInTheDocument();
    expect(within(list).getAllByText("Missing track").length).toBeGreaterThan(
      0,
    );
    // Identifiers (uids, issue id, row keys, source hash) leave the card.
    expect(list).not.toHaveTextContent(trackUid);
    expect(list).not.toHaveTextContent("f".repeat(64));
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    expect(document.body.textContent).toContain(trackUid);
    expect(
      screen.getByText(
        "Change 1 · Dependent relations 1 › Rows 1 › Source hash",
      ).parentElement,
    ).toHaveTextContent("f".repeat(64));
    expect(
      screen.getByText("Change 1 · Issue id").parentElement,
    ).toHaveTextContent("42");
    const approve = screen.getByRole("button", { name: "Approve" });
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
      name: "Approve",
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

    const list = await screen.findByRole("list", {
      name: "Proposed changes",
    });
    expect(list).toHaveTextContent("Old biography");
    expect(list).toHaveTextContent("New biography");
    expect(list).toHaveTextContent("Old tag");
    expect(list).toHaveTextContent("New tag");
    // One card per proposed change (the old table had a header plus two rows).
    expect(list.children).toHaveLength(2);
    const approve = screen.getByRole("button", { name: "Approve" });
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
        screen.queryByRole("button", { name: "Approve" }),
      ).not.toBeInTheDocument(),
    );
    expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
      false,
    );
  });

  it("allows metadata reviewers to inspect without granting approval", async () => {
    apiMock.mockResolvedValue(metadataPlan());
    renderReview(["agents.plans.review", "library.metadata.write"]);
    const list = await screen.findByRole("list", {
      name: "Proposed changes",
    });
    expect(list).toHaveTextContent("New biography");
    expect(
      screen.queryByRole("button", { name: "Approve" }),
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
      name: "Approve",
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
    await screen.findByRole("list", { name: "Proposed changes" });
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject" }),
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
        name: "Approve",
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
    const list = await screen.findByRole("list", {
      name: "Proposed changes",
    });
    expect(list.textContent).toContain(biography);
  });

  it("shows an explicit cleared value as Cleared in the proposed value", async () => {
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
    const list = await screen.findByRole("list", { name: "Proposed changes" });
    const card = within(list).getByText("Old biography").closest("li");
    expect(card).not.toBeNull();
    const proposed = within(card!).getByText("Proposed").nextElementSibling;
    expect(proposed).toHaveTextContent(/^Cleared$/);
  });

  it("keeps a manual-only plan reviewable without granting execution approval", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue(metadataPlan({ executable: false }));
    renderReview();
    expect(
      await screen.findByRole("list", { name: "Proposed changes" }),
    ).toHaveTextContent("New biography");
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
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
    await screen.findByRole("list", { name: "Proposed changes" });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Reject" }));
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
        name: "Approve",
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
      await screen.findByRole("list", { name: "Proposed changes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Echo")).toBeInTheDocument();
    expect(screen.getByText("No photo")).toBeInTheDocument();
    expect(screen.getByText("Photo present")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject" }),
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
        name: decision === "approve" ? "Approve" : "Reject",
      });
      expect(button).toBeDisabled();
      await user.click(
        screen.getByRole("checkbox", {
          name: "I reviewed this change and its effects.",
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
          screen.queryByRole("button", { name: "Approve" }),
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
  ] satisfies [string, Partial<AgentPlan>][])(
    "blocks approval for %s",
    async (_label, invalid) => {
      const user = userEvent.setup();
      apiMock.mockResolvedValue(plan(invalid));
      renderReview();
      const button = await screen.findByRole("button", {
        name: "Approve",
      });
      const checkbox = screen.getByRole("checkbox");
      if (!checkbox.hasAttribute("disabled")) await user.click(checkbox);
      expect(button).toBeDisabled();
      expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
      expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
        false,
      );
    },
  );

  // An expired plan replaces the whole decision bar with an alert: there is
  // no checkbox, Approve or Reject to enable at all.
  it.each([
    ["expired plan", { expires_at: "2020-01-01T00:00:00Z" }],
    ["invalid expiry", { expires_at: "invalid-timestamp" }],
  ] satisfies [string, Partial<AgentPlan>][])(
    "blocks any decision for %s",
    async (_label, invalid) => {
      apiMock.mockResolvedValue(plan(invalid));
      renderReview();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This plan expired",
      );
      expect(screen.getByText("Expired")).toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Approve" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Reject" }),
      ).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The reviewed plan or policy is no longer current",
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText("Echo")).toBeInTheDocument();

    current = {
      ...current,
      plan_version: "d".repeat(64),
      content_hash: "e".repeat(64),
      policy_revision: 8,
    };
    conflict = false;
    await user.click(screen.getByRole("button", { name: "Reload plan" }));
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    await waitFor(() =>
      expect(
        screen.getByText("Policy revision").parentElement,
      ).toHaveTextContent(/^Policy revision\s*8$/),
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Approve" }));
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
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();

    await user.click(screen.getByRole("link", { name: "Next review target" }));
    await screen.findByText("Second artist");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
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
    await screen.findByRole("list", { name: "Proposed changes" });
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(apiMock).toHaveBeenCalledWith(
      base + "/plan-one/approve",
      "POST",
      exactDecision(item),
    );
  },
);

describe("AgentPlanDetail presentation", () => {
  it("summarises a show import without hashes or raw JSON", async () => {
    const user = userEvent.setup();
    const item = showImportPlan();
    apiMock.mockResolvedValue(item);
    renderReview();

    expect(
      await screen.findByRole("heading", { name: "Import shows · 1 item" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Requested by Local lab MCP/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Can't be undone automatically. Undoing it needs a new plan.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Coilguns · 2027-03-14")).toBeInTheDocument();
    expect(screen.getByText("Visible to listeners")).toBeInTheDocument();
    const venue = screen.getByRole("row", { name: /Venue/ });
    expect(venue).toHaveTextContent("Wurlitzer Ballroom");
    expect(venue).toHaveTextContent("WURLITZER BALLROOM");
    expect(
      screen.queryByRole("row", { name: /Artist name/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "17 unchanged fields" }),
    );
    expect(screen.getByRole("row", { name: /Artist name/ })).toHaveTextContent(
      "Coilguns",
    );

    expect(
      screen.queryByRole("row", { name: /Item id/ }),
    ).not.toBeInTheDocument();

    const text = document.body.textContent ?? "";
    expect(text).not.toContain('{"');
    expect(text).not.toMatch(/[0-9a-f]{64}/i);
    expect(text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );

    await user.click(screen.getByRole("button", { name: "Technical details" }));
    expect(document.body.textContent).toContain(item.content_hash);
    expect(document.body.textContent).toContain(`show:${showTarget.name}`);
    expect(
      screen.getByText("Coilguns · 2027-03-14 · Proposed › Item id")
        .parentElement,
    ).toHaveTextContent("6cff6a09-f56b-45ef-aaf4-7e9a4836ff0d");
  });

  it("disables the decision when the plan expires while open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    apiMock.mockResolvedValue(
      plan({ expires_at: new Date(Date.now() + 5_000).toISOString() }),
    );
    renderReview();
    const approve = await screen.findByRole("button", { name: "Approve" });
    await user.click(screen.getByRole("checkbox"));
    expect(approve).toBeEnabled();

    expect(screen.getByText("Needs approval")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(screen.getByRole("alert")).toHaveTextContent("This plan expired");
    // The header badge reads the same clock as the decision bar.
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.queryByText("Needs approval")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
      false,
    );
  });

  it("treats a click after expiry as expired before the next clock tick", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    apiMock.mockResolvedValue(
      plan({ expires_at: new Date(Date.now() + 5_000).toISOString() }),
    );
    renderReview();
    await user.click(await screen.findByRole("checkbox"));
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeEnabled();

    // The wall clock passes the expiry without the 15 s tick firing.
    vi.setSystemTime(Date.now() + 10_000);
    await user.click(approve);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This plan expired",
    );
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
      false,
    );
  });

  it("renders nested arrays of records in a change", async () => {
    apiMock.mockResolvedValue(
      metadataPlan({
        changes: [
          {
            entity_uid: uid,
            field: "lineup",
            before: [{ name: "A" }],
            after: [{ name: "A" }, { name: "B", role: "support" }],
          },
        ],
      }),
    );
    renderReview();
    const list = await screen.findByRole("list", { name: "Proposed changes" });
    expect(within(list).getAllByText("A")).toHaveLength(2);
    expect(within(list).getByText("B")).toBeInTheDocument();
    expect(within(list).getByText("Role")).toBeInTheDocument();
    expect(within(list).getByText("support")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("[object Object]");
  });

  it("tells the sidebar when a decision is made", async () => {
    const user = userEvent.setup();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const changed = () =>
      dispatchSpy.mock.calls.some(
        ([event]) => event.type === "crate:agent-plans-changed",
      );
    apiMock.mockResolvedValue(plan());
    renderReview();
    await user.click(await screen.findByRole("checkbox"));
    expect(changed()).toBe(false);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(changed()).toBe(true));
  });

  it("shows a conflict body as text and does not tell the sidebar", async () => {
    const user = userEvent.setup();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    apiMock.mockImplementation((_path: string, method = "GET") =>
      method === "POST"
        ? Promise.reject(
            Object.assign(
              new Error('{"detail":"The reviewed plan is no longer current"}'),
              { status: 409 },
            ),
          )
        : Promise.resolve(plan()),
    );
    renderReview();
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      /^The reviewed plan is no longer current\s*Reload plan$/,
    );
    expect(
      dispatchSpy.mock.calls.some(
        ([event]) => event.type === "crate:agent-plans-changed",
      ),
    ).toBe(false);
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("explains a plan the connection policy already allows", async () => {
    apiMock.mockResolvedValue(
      plan({ state: "ready", approval_required: false }),
    );
    renderReview();
    expect(
      await screen.findByText(
        "Already allowed by this connection's policy. The agent can apply it without approval.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
  });

  it("explains an incomplete plan to reviewers who cannot decide", async () => {
    apiMock.mockResolvedValue(metadataPlan({ truncated: true }));
    renderReview(["agents.plans.review", "library.metadata.write"]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The complete change list is not available. This plan cannot be approved.",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("lists the OAuth client and authorization in Technical details", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue(
      plan({
        authorization_context: {
          actor_user_id: 4,
          client_id: "remote-client",
          authorization_id: "authorization-7",
        },
      }),
    );
    renderReview();
    await user.click(
      await screen.findByRole("button", { name: "Technical details" }),
    );
    expect(screen.getByText("Client ID").parentElement).toHaveTextContent(
      "remote-client",
    );
    expect(
      screen.getByText("Authorization ID").parentElement,
    ).toHaveTextContent("authorization-7");
  });

  it("names the person behind a delegated plan", async () => {
    apiMock.mockResolvedValue(
      showImportPlan({
        requester_name: "Diego",
        authorization_context: { actor_user_id: 4 },
      }),
    );
    renderReview();
    expect(await screen.findByText("Delegated by Diego")).toBeInTheDocument();
  });

  it("highlights cleared fields and folds a single unchanged field", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue(
      metadataPlan({
        changes: [
          {
            entity_uid: uid,
            field: "profile",
            before: { bio: "Old biography", country: "ES" },
            after: { bio: null, country: "ES" },
          },
        ],
      }),
    );
    renderReview();
    const cleared = await screen.findByRole("row", { name: /Bio/ });
    expect(cleared).toHaveAttribute("data-status", "cleared");
    expect(cleared).toHaveTextContent("Old biography");
    expect(cleared).toHaveTextContent("Cleared");
    expect(
      screen.queryByRole("row", { name: /Country/ }),
    ).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "1 unchanged field" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("row", { name: /Country/ })).toHaveAttribute(
      "data-status",
      "unchanged",
    );
  });

  it("links back to approvals and to the execution of a decided plan", async () => {
    apiMock.mockResolvedValue(plan({ state: "applied", job_id: "job-9" }));
    renderReview();
    expect(
      await screen.findByRole("link", { name: "View execution" }),
    ).toHaveAttribute("href", "/tasks?task=job-9");
    expect(
      screen.getByRole("link", { name: "Back to approvals" }),
    ).toHaveAttribute("href", "/agents/approvals");
    expect(screen.getByText("Applied")).toBeInTheDocument();
  });
});

const albumUid = "30000000-0000-4000-8000-000000000001";
const introUid = "30000000-0000-4000-8000-000000000002";
const outroUid = "30000000-0000-4000-8000-000000000003";
const mbAlbum = "a1a1a1a1-0000-4000-8000-000000000001";
const mbOld = "b2b2b2b2-0000-4000-8000-000000000002";
const mbNew = "c3c3c3c3-0000-4000-8000-000000000003";

function indexedTrack(overrides: Record<string, unknown> = {}) {
  // native_scan's track payload minus path and audio fingerprints.
  return {
    filename: "01 Intro.flac",
    title: "Intro",
    track_number: 1,
    disc_number: 1,
    format: "flac",
    bitrate: 912,
    sample_rate: 44100,
    bit_depth: 16,
    duration: 120.5,
    size: 13_400_000,
    year: "2020",
    genre: null,
    albumartist: "Echo",
    musicbrainz_albumid: mbAlbum,
    musicbrainz_trackid: mbOld,
    _crate_identity_tagged: true,
    ...overrides,
  };
}

// Mirrors agent_sync.compile_operation for one indexed album.
function syncPlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  const targets = [
    { entity_type: "track", entity_uid: introUid },
    { entity_type: "track", entity_uid: outroUid },
  ];
  return plan({
    operation: "library_sync",
    risk: "destructive",
    target_count: 2,
    returned_count: 2,
    targets,
    changes: [
      {
        entity_uid: introUid,
        action: "update_index",
        relative_path: "Echo/Night/01 Intro.flac",
        before: indexedTrack(),
        after: indexedTrack({ musicbrainz_trackid: mbNew }),
      },
      {
        entity_uid: outroUid,
        action: "remove_index",
        before: { title: "Outro" },
        after: null,
      },
    ],
    source_versions: {
      albums: [
        {
          entity_uid: albumUid,
          database: "d".repeat(64),
          filesystem: "e".repeat(64),
        },
      ],
    },
    impact: {
      database: true,
      filesystem: false,
      scope: "album",
      indexed_albums_only: true,
      new_album_discovery: false,
      albums: 1,
      tracks: 2,
      removed_indexes: 1,
      refreshes_artist_summary: true,
      artwork_materialization: "album-cover when present",
      enrichment: false,
      preserves_field_locks: true,
      filesystem_precondition: "device/inode/size/mtime/ctime manifest",
    },
    reversibility:
      "removed indexes can affect references; rescan does not restore deleted references",
    ...overrides,
  });
}

// Mirrors agent_metadata.compile_operation for an artist patch.
function artistMetadataPlan(): AgentPlan {
  return plan({
    operation: "metadata_update",
    risk: "safe",
    targets: [{ entity_type: "artist", entity_uid: uid }],
    changes: [
      { entity_uid: uid, field: "mbid", before: mbOld, after: mbNew },
      {
        entity_uid: uid,
        field: "bio",
        before: "Old biography",
        after: "New biography",
      },
    ],
    source_versions: { database: "d".repeat(64), files: [] },
    impact: {
      database: true,
      filesystem: false,
      files: 0,
      bytes_read_for_preconditions: 0,
      locks_modified_fields: true,
      provenance: "manual_edit",
      refreshes_size_totals: [],
    },
    reversibility: "new_plan_required",
  });
}

// Mirrors agent_enrichment.compile_operation for one artist.
function enrichmentPlan(): AgentPlan {
  const providers = ["musicbrainz", "lastfm"];
  return plan({
    operation: "enrichment",
    risk: "safe",
    targets: [{ entity_type: "artist", entity_uid: uid }],
    changes: [
      {
        artist_uid: uid,
        providers,
        facets: ["bio", "tags"],
        locked_fields_preserved: ["bio"],
        value_policy: "only_missing_unlocked_values",
        after: "provider_result_unknown_until_execution",
      },
    ],
    source_versions: { database: "d".repeat(64) },
    impact: {
      database: true,
      filesystem: false,
      external_providers: providers,
      provider_facets: { musicbrainz: ["tags"], lastfm: ["bio", "tags"] },
      unsupported_provider_facets: { musicbrainz: ["bio"], lastfm: [] },
      provider_fetches: 2,
      provider_min_intervals_seconds: { musicbrainz: 1, lastfm: 0.25 },
      transport_requests:
        "Provider clients may issue multiple requests and reuse their configured caches; refresh does not purge caches",
      metadata_only: true,
      setlists_storage: "bounded_metadata_cache_and_job_result",
      implicit_photos: false,
      mode: "missing",
    },
    reversibility: "new_plan_required; provider history is recorded in audit",
  });
}

// Mirrors agent_runtime.compile_operation for a runtime policy patch.
function runtimePlan(): AgentPlan {
  const target = { entity_type: "runtime", name: "policy" };
  return plan({
    operation: "runtime_update",
    risk: "high",
    targets: [target],
    changes: [
      {
        ...target,
        before: { max_workers: 2, analysis: { enabled: true, threads: 4 } },
        after: { max_workers: 3, analysis: { enabled: true, threads: 4 } },
      },
    ],
    source_versions: undefined,
    impact: {
      scope: "instance",
      configured_policy_only: true,
      running_tasks_interrupted: false,
      process_resize: false,
    },
  });
}

function textLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(textLeaves);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(textLeaves);
  return [];
}

describe("AgentPlanDetail completeness", () => {
  it("shows a changed MusicBrainz id as a changed row with both values", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue(syncPlan());
    renderReview();
    const row = await screen.findByRole("row", { name: /Musicbrainz trackid/ });
    expect(row).toHaveAttribute("data-status", "changed");
    expect(row).toHaveTextContent("Changed · see Technical details");
    expect(row).toHaveTextContent(mbOld);
    expect(row).toHaveTextContent(mbNew);
    // Equal values, including null on both sides, are folded as unchanged.
    expect(
      screen.queryByRole("row", { name: /Genre/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No field changes.")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /^\d+ unchanged fields$/ }),
    );
    expect(screen.getByRole("row", { name: /Genre/ })).toHaveAttribute(
      "data-status",
      "unchanged",
    );
    // Unlabelled tracks are numbered and the path tells the cards apart.
    expect(screen.getByText("Track 1")).toBeInTheDocument();
    expect(screen.getByText("Track 2")).toBeInTheDocument();
    expect(screen.getByText("Echo/Night/01 Intro.flac")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    expect(
      screen.getByText("Track 1 · Proposed › Musicbrainz trackid")
        .parentElement,
    ).toHaveTextContent(mbNew);
  });

  it("shows an identifier newly set on an existing record", async () => {
    const user = userEvent.setup();
    apiMock.mockResolvedValue(
      syncPlan({
        changes: [
          {
            entity_uid: introUid,
            action: "update_index",
            relative_path: "Echo/Night/01 Intro.flac",
            before: indexedTrack({ musicbrainz_trackid: null }),
            after: indexedTrack({ musicbrainz_trackid: mbNew }),
          },
        ],
      }),
    );
    renderReview();
    const list = await screen.findByRole("list", { name: "Proposed changes" });
    expect(screen.queryByText("No field changes.")).not.toBeInTheDocument();
    const row = within(list).getByRole("row", { name: /Musicbrainz trackid/ });
    expect(row).toHaveAttribute("data-status", "added");
    expect(row).toHaveTextContent("Added · see Technical details");
    expect(row).not.toHaveTextContent(mbNew);
    expect(document.body.textContent ?? "").not.toContain(mbNew);
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    expect(
      screen.getByText("Track 1 · Proposed › Musicbrainz trackid")
        .parentElement,
    ).toHaveTextContent(mbNew);
  });

  it("points to Technical details when the only change is an identifier the record lacked", async () => {
    const user = userEvent.setup();
    const withoutTrackId: Record<string, unknown> = indexedTrack();
    delete withoutTrackId.musicbrainz_trackid;
    apiMock.mockResolvedValue(
      syncPlan({
        changes: [
          {
            entity_uid: introUid,
            action: "update_index",
            relative_path: "Echo/Night/01 Intro.flac",
            before: withoutTrackId,
            after: indexedTrack({ musicbrainz_trackid: mbNew }),
          },
        ],
      }),
    );
    renderReview();
    const list = await screen.findByRole("list", { name: "Proposed changes" });
    expect(
      within(list).getByText("Identifiers change · see Technical details"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No field changes.")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(mbNew);
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    expect(
      screen.getByText("Track 1 · Proposed › Musicbrainz trackid")
        .parentElement,
    ).toHaveTextContent(mbNew);
  });

  it("shows both values of a changed artist MBID", async () => {
    apiMock.mockResolvedValue(artistMetadataPlan());
    renderReview();
    const list = await screen.findByRole("list", { name: "Proposed changes" });
    const card = within(list).getByText("Mbid").closest("li");
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("Changed · see Technical details");
    expect(card).toHaveTextContent(mbOld);
    expect(card).toHaveTextContent(mbNew);
    expect(card).not.toHaveTextContent("Listed in technical details");
  });

  it.each([
    ["library sync", syncPlan],
    ["artist metadata", artistMetadataPlan],
    ["enrichment", enrichmentPlan],
    ["runtime policy", runtimePlan],
  ] as const)(
    "shows every leaf of the %s plan's changes and impact",
    async (_label, makePlan) => {
      const user = userEvent.setup();
      const item = makePlan();
      apiMock.mockResolvedValue(item);
      renderReview();
      await screen.findByRole("list", { name: "Proposed changes" });
      for (const toggle of screen.queryAllByRole("button", {
        name: /unchanged field/,
      }))
        await user.click(toggle);
      await user.click(
        screen.getByRole("button", { name: "Technical details" }),
      );
      const text = (document.body.textContent ?? "").toLowerCase();
      const missing = [
        ...textLeaves(item.changes),
        ...textLeaves(item.impact),
      ].filter((leaf) => {
        const value = leaf.toLowerCase();
        // The subject (field, action or pipeline) is a heading, humanized
        // like a key: «update_index» reads «Update index».
        return (
          !text.includes(value) && !text.includes(value.replace(/_/g, " "))
        );
      });
      expect(missing).toEqual([]);
    },
  );
});
