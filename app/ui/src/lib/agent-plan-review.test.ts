import { describe, expect, it } from "vitest";

import type { AgentPlan } from "./agent-integrations";
import {
  planIsComplete,
  reviewIdentity,
  targetIdentity,
} from "./agent-plan-review";

const uid = "10000000-0000-0000-0000-000000000001";

// Mirrors the plan() fixture in src/pages/agents/AgentPlanDetail.test.tsx.
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
    impact: {
      artist_count: 1,
      filesystem_writes: false,
      notifications: false,
    },
    reversibility: "The flag can be recomputed from current photo evidence.",
    source_versions: {
      observation_id: "observation-one",
      observed_at: new Date().toISOString(),
    },
    authorization_context: {},
    ...overrides,
  };
}

describe("planIsComplete", () => {
  it("is true for a complete plan", () => {
    expect(planIsComplete(plan())).toBe(true);
  });

  it("is false when the plan was truncated", () => {
    expect(planIsComplete(plan({ truncated: true }))).toBe(false);
  });

  it("is false when fewer targets were returned than expected", () => {
    expect(planIsComplete(plan({ returned_count: 0 }))).toBe(false);
  });

  it("is false when a change's artist_uid is not among the declared targets", () => {
    expect(
      planIsComplete(
        plan({
          changes: [
            {
              artist_uid: "another-artist",
              field: "has_photo",
              before: false,
              after: true,
            },
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe("reviewIdentity", () => {
  it("joins the plan's review-sensitive identity fields", () => {
    expect(reviewIdentity(plan())).toBe(
      "plan-one/" +
        "a".repeat(64) +
        "/" +
        "b".repeat(64) +
        "/" +
        "c".repeat(64) +
        "/7",
    );
  });
});

describe("targetIdentity", () => {
  it("identifies the global library target", () => {
    expect(targetIdentity({ entity_type: "library", scope: "global" })).toBe(
      "library:global",
    );
  });
});
