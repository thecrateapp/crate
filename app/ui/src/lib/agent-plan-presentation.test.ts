import { describe, expect, it } from "vitest";

import {
  connectionKindLabel,
  fieldDiff,
  formatTrackDuration,
  impactChips,
  operationLabel,
  planStateView,
  planTitle,
  requesterText,
  reversibilityText,
  riskView,
} from "./agent-plan-presentation";

describe("operationLabel", () => {
  it.each([
    ["repair_photo_flag", "Update artist photo flag"],
    ["shows_import", "Import shows"],
    ["editorial_change", "Change editorial playlist"],
    ["job_retry", "Retry job"],
    ["job_cancel", "Cancel job"],
    ["schedule_run", "Run scheduled task"],
    ["schedule_update", "Change schedule"],
    ["runtime_update", "Change runtime policy"],
    ["health_check", "Run library health check"],
    ["quality_check", "Refresh library quality"],
    ["repairs", "Apply library repairs"],
    ["metadata_update", "Edit metadata"],
    ["enrichment", "Enrich metadata"],
    ["analysis", "Analyze tracks"],
    ["library_sync", "Sync library albums"],
    ["metadata_export", "Export metadata"],
    ["metadata_rehydrate", "Import portable metadata"],
    ["unknown_operation", "Unknown operation"],
  ])("maps %s to %s", (operation, expected) => {
    expect(operationLabel(operation)).toBe(expected);
  });
});

describe("planTitle", () => {
  it("appends the target count to the operation label", () => {
    expect(planTitle({ operation: "repair_photo_flag", target_count: 3 })).toBe(
      "Update artist photo flag · 3 items",
    );
  });

  it("uses the singular form for one target", () => {
    expect(planTitle({ operation: "repair_photo_flag", target_count: 1 })).toBe(
      "Update artist photo flag · 1 item",
    );
  });

  it("falls back to only the label without a target count", () => {
    expect(planTitle({ operation: "repair_photo_flag" })).toBe(
      "Update artist photo flag",
    );
  });
});

describe("planStateView", () => {
  it.each([
    ["awaiting_approval", "Needs approval", "warning"],
    ["ready", "Ready to apply", "info"],
    ["authorized", "Approved", "info"],
    ["queued", "Queued", "info"],
    ["running", "Running", "info"],
    ["applied", "Applied", "success"],
    ["partial", "Partially applied", "warning"],
    ["conflict", "Conflict", "danger"],
    ["failed", "Failed", "danger"],
    ["cancelled", "Cancelled", "neutral"],
    ["rejected", "Rejected", "neutral"],
    ["unknown_state", "Unknown state", "neutral"],
  ] as const)("maps %s to %s / %s when not expired", (state, label, tone) => {
    expect(planStateView(state, false)).toEqual({ label, tone });
  });

  it("shows Expired for an expired plan still awaiting approval", () => {
    expect(planStateView("awaiting_approval", true)).toEqual({
      label: "Expired",
      tone: "neutral",
    });
  });

  it("shows Expired for an expired plan still marked ready", () => {
    expect(planStateView("ready", true)).toEqual({
      label: "Expired",
      tone: "neutral",
    });
  });

  it("ignores expiry for states that are already final", () => {
    expect(planStateView("applied", true)).toEqual({
      label: "Applied",
      tone: "success",
    });
  });
});

describe("riskView", () => {
  it.each([
    ["safe", "Safe", "success"],
    ["low", "Low risk", "success"],
    ["caution", "Caution", "warning"],
    ["high", "High risk", "danger"],
    ["destructive", "Destructive", "danger"],
    [undefined, "Risk unknown", "neutral"],
    ["unknown", "Risk unknown", "neutral"],
  ] as const)("maps %s to %s / %s", (risk, label, tone) => {
    expect(riskView(risk)).toEqual({ label, tone });
  });
});

describe("connectionKindLabel", () => {
  it.each([
    ["service", "Token"],
    ["delegated", "OAuth sign-in"],
    ["human", "Admin session"],
    [null, "Connection"],
    [undefined, "Connection"],
    ["other", "Connection"],
  ] as const)("maps %s to %s", (kind, expected) => {
    expect(connectionKindLabel(kind)).toBe(expected);
  });
});

describe("reversibilityText", () => {
  it("explains the new-plan-required case", () => {
    expect(reversibilityText("new_plan_required")).toBe(
      "Can't be undone automatically. Undoing it needs a new plan.",
    );
  });

  it("falls back to a stated-nothing message when empty", () => {
    expect(reversibilityText(undefined)).toBe("Reversibility not stated.");
  });

  it("passes through any other value as-is", () => {
    expect(reversibilityText("A new reviewed plan is required.")).toBe(
      "A new reviewed plan is required.",
    );
  });
});

describe("impactChips", () => {
  it("builds the expected chip set in input order", () => {
    expect(
      impactChips({
        scope: "selected",
        shows: 1,
        public: true,
        filesystem: false,
      }),
    ).toEqual([
      "Selected items only",
      "Shows: 1",
      "Visible to listeners",
      "No file changes",
    ]);
  });

  it("describes a whole-library scope with writes and notifications", () => {
    expect(
      impactChips({
        scope: "global",
        filesystem_writes: true,
        notifications: true,
        artist_count: 1,
      }),
    ).toEqual([
      "Whole library",
      "Writes files",
      "Sends notifications",
      "1 artist",
    ]);
  });

  it("skips nested objects and arrays", () => {
    expect(
      impactChips({
        database: true,
        pipelines: ["analysis"],
        provenance: { source: "manual" },
      }),
    ).toEqual(["Changes the database"]);
  });

  it("describes an unchanged database as no database changes", () => {
    expect(impactChips({ database: false })).toEqual(["No database changes"]);
  });
});

describe("requesterText", () => {
  it("names the admin preparer by their display name", () => {
    expect(
      requesterText({
        authorization_context: { human_actor_id: 42 },
        requester_name: "Jordan",
      }),
    ).toBe("Prepared in Admin by Jordan");
  });

  it("falls back to a numbered user when no display name is known", () => {
    expect(
      requesterText({
        authorization_context: { human_actor_id: 42 },
        requester_name: null,
      }),
    ).toBe("Prepared in Admin by user #42");
  });

  it("names the delegating user", () => {
    expect(
      requesterText({
        authorization_context: { actor_user_id: 7 },
        requester_name: null,
      }),
    ).toBe("Delegated by user #7");
  });

  it("returns null for a service-only authorization context", () => {
    expect(
      requesterText({ authorization_context: {}, requester_name: null }),
    ).toBeNull();
  });

  it("falls through a null admin id to a real delegated id", () => {
    expect(
      requesterText({
        authorization_context: { human_actor_id: null, actor_user_id: 7 },
        requester_name: "Ana",
      }),
    ).toBe("Delegated by Ana");
  });

  it("returns null when the only id present is explicitly null", () => {
    expect(
      requesterText({
        authorization_context: { human_actor_id: null },
        requester_name: null,
      }),
    ).toBeNull();
  });
});

describe("fieldDiff", () => {
  it("classifies unchanged, changed and added fields in after-then-before order", () => {
    const rows = fieldDiff(
      { city: "Madrid", url: null, date: "2027-05-15" },
      { city: "Madrid", date: "2027-05-16", venue: "Hall" },
    );
    expect(rows?.map(({ key, status }) => ({ key, status }))).toEqual([
      { key: "city", status: "unchanged" },
      { key: "date", status: "changed" },
      { key: "venue", status: "added" },
      { key: "url", status: "unchanged" },
    ]);
  });

  it("classifies an explicit clear as cleared", () => {
    const rows = fieldDiff({ bio: "Old" }, { bio: null });
    expect(rows?.map(({ key, status }) => ({ key, status }))).toEqual([
      { key: "bio", status: "cleared" },
    ]);
  });

  it("returns null when after is not a record", () => {
    expect(fieldDiff("a", "b")).toBeNull();
  });
});

describe("formatTrackDuration", () => {
  it.each([
    [240, "4:00"],
    [61, "1:01"],
    [null, "—"],
  ] as const)("formats %s as %s", (seconds, expected) => {
    expect(formatTrackDuration(seconds)).toBe(expected);
  });
});
