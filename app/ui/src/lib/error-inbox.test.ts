import { describe, expect, it } from "vitest";

import {
  sampleDetail,
  sampleIssue,
  sampleIssues,
  sampleTriage,
} from "@/test/error-inbox-fixtures";

import {
  DEFAULT_FILTERS,
  aiProblemText,
  apiErrorCode,
  currentAssessments,
  investigateUrl,
  previousAssessment,
  triagePassText,
  clockText,
  filtersFromParams,
  fixProblemText,
  fixUrl,
  filtersToParams,
  hasActiveFilters,
  issuesUrl,
  knownReleases,
  laneGroups,
  needsConnectionFix,
  parseNameList,
  problemText,
  problemTitle,
  substatusLabel,
} from "./error-inbox";

describe("laneGroups", () => {
  it("puts the critical lane first and orders each lane by score", () => {
    const lanes = laneGroups([...sampleIssues()].reverse());
    expect(lanes.map((lane) => lane.id)).toEqual(["critical", "other"]);
    expect(lanes[0]!.groups.map((group) => group.lead.short_id)).toEqual([
      "CRATE-READPLANE-2D",
      "CRATE-WORKERS-3K",
      "CRATE-LISTEN-9F",
    ]);
    expect(lanes[1]!.issueCount).toBe(4);
  });

  it("collapses a shared group key into one group with totals", () => {
    const other = laneGroups(sampleIssues()).find(
      (lane) => lane.id === "other",
    )!;
    const group = other.groups[0]!;
    expect(group.members.map((issue) => issue.short_id)).toEqual([
      "CRATE-LISTEN-7A",
      "CRATE-LISTEN-7C",
      "CRATE-LISTEN-81",
    ]);
    expect(group.events_24h).toBe(21);
    expect(group.users_24h).toBe(6);
    expect(group.crate_score).toBe(63);
    expect(group.last_seen).toBe(group.members[0]!.last_seen);
  });

  it("makes a group critical when any member is", () => {
    const lanes = laneGroups([
      sampleIssue({ id: "a", group_key: "k", crate_score: 40 }),
      sampleIssue({ id: "b", group_key: "k", crate_score: 75, critical: true }),
    ]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.id).toBe("critical");
    expect(lanes[0]!.groups[0]!.lead.id).toBe("b");
  });

  it("returns no lanes for no issues", () => {
    expect(laneGroups([])).toEqual([]);
  });
});

describe("filters", () => {
  it("round-trips through the URL and omits defaults", () => {
    const params = filtersToParams({
      ...DEFAULT_FILTERS,
      lane: "critical",
      service: "readplane",
    });
    expect(params.toString()).toBe("lane=critical&service=readplane");
    expect(filtersFromParams(params)).toEqual({
      ...DEFAULT_FILTERS,
      lane: "critical",
      service: "readplane",
    });
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters(filtersFromParams(params))).toBe(true);
  });

  it("falls back to defaults for unknown values", () => {
    expect(
      filtersFromParams(new URLSearchParams("lane=loud&status=maybe")),
    ).toEqual(DEFAULT_FILTERS);
  });

  it("builds the list URL with the contract's parameters", () => {
    expect(issuesUrl({ ...DEFAULT_FILTERS, release: "crate-8e1f0a7" })).toBe(
      "/api/admin/errors?status=unresolved&lane=all&limit=50&release=crate-8e1f0a7",
    );
  });
});

describe("presentation", () => {
  it("words sync problems plainly and tells which need a connection fix", () => {
    expect(problemText("SENTRY_AUTH")).toMatch(/rejected the token/);
    expect(problemText("SENTRY_UNAVAILABLE")).toMatch(/could not reach Sentry/);
    expect(problemText("SENTRY_HTTP_418")).toMatch(/\(SENTRY_HTTP_418\)/);
    expect(needsConnectionFix("SENTRY_AUTH")).toBe(true);
    expect(needsConnectionFix("SENTRY_TIMEOUT")).toBe(false);
    expect(problemTitle("SENTRY_TIMEOUT")).toBe("Sentry is unreachable");
  });

  it("reads the error code from the header or the body", () => {
    expect(
      apiErrorCode(Object.assign(new Error("{}"), { code: "ERROR_X" })),
    ).toBe("ERROR_X");
    expect(apiErrorCode(new Error('{"detail":{"code":"ERROR_Y"}}'))).toBe(
      "ERROR_Y",
    );
    expect(apiErrorCode(new Error('{"code":"ERROR_Z"}'))).toBe("ERROR_Z");
    expect(apiErrorCode(new Error("Bad gateway"))).toBeNull();
  });

  it("parses comma separated names and lists releases", () => {
    expect(parseNameList(" crate-api,crate-workers ,, crate-listen\n")).toEqual(
      ["crate-api", "crate-workers", "crate-listen"],
    );
    expect(knownReleases(sampleIssues())).toEqual([
      "crate-android-1.42.0",
      "crate-8e1f0a7",
      "crate-5c5bd24",
    ]);
    expect(substatusLabel("archived_until_escalating")).toBe("Archived");
    expect(substatusLabel(null)).toBeNull();
  });
});

describe("Launch fix", () => {
  it("builds the fix URL from the issue id", () => {
    expect(fixUrl("a b")).toBe("/api/admin/errors/a%20b/fix");
  });

  it("shows the clock today and the day before it otherwise", () => {
    const now = new Date(2026, 10, 5, 18, 30);
    expect(clockText(new Date(2026, 10, 5, 9, 7).toISOString(), now)).toBe(
      "09:07",
    );
    expect(clockText(new Date(2026, 10, 4, 23, 59).toISOString(), now)).toBe(
      "4 Nov, 23:59",
    );
    expect(clockText("not a date", now)).toBe("an unknown time");
  });

  it("words the API refusals plainly", () => {
    expect(fixProblemText("ERROR_FIX_RECENTLY_REQUESTED")).toBe(
      "A fix for this issue was launched less than 24 hours ago.",
    );
    expect(fixProblemText("ERROR_FIX_NOT_CONFIGURED")).toMatch(
      /not configured/,
    );
    expect(fixProblemText("ERROR_FIX_UNSUPPORTED_ISSUE")).toMatch(
      /CRATE-API-1F/,
    );
    expect(fixProblemText(null)).toBe("Could not launch the fix. Try again.");
  });
});

describe("AI assessments", () => {
  const investigation = sampleTriage({
    id: "investigation",
    kind: "investigation",
  });
  const triage = sampleTriage({ id: "triage" });
  const older = sampleTriage({ id: "older", digest_hash: "earlier-event" });

  it("picks the current event's triage and investigation", () => {
    const issue = sampleDetail({ triages: [investigation, older, triage] });

    expect(currentAssessments(issue)).toEqual({ triage, investigation });
    expect(previousAssessment(issue)).toBe(older);
    expect(currentAssessments(sampleDetail({ triages: [older] }))).toEqual({
      triage: null,
      investigation: null,
    });
    expect(previousAssessment(sampleDetail({ triages: [triage] }))).toBeNull();
  });

  it("builds the investigate URL and words its refusals", () => {
    expect(investigateUrl("a b")).toBe("/api/admin/errors/a%20b/investigate");
    expect(aiProblemText("AI_ACTION_DISABLED", "investigation")).toBe(
      "No usable model is bound to Investigate error issue. Bind one in AI models.",
    );
    expect(aiProblemText("AI_PROFILE_UNKNOWN", "triage")).toMatch(
      /Triage error issue/,
    );
    expect(
      aiProblemText("ERROR_ISSUE_ALREADY_INVESTIGATED", "investigation"),
    ).toBe("The latest event of this issue has already been investigated.");
    expect(aiProblemText("ERROR_ISSUE_NO_DIGEST", "investigation")).toMatch(
      /next sync/,
    );
    expect(aiProblemText(null, "triage")).toBe(
      "Could not queue the triage. Try again.",
    );
  });
});

describe("triagePassText", () => {
  const pass = {
    queued: 3,
    queued_24h: 12,
    daily_max: 30,
    error_code: null,
  };

  it("words each automatic triage outcome", () => {
    expect(triagePassText({ ...pass, status: "queued" })).toBe(
      "The last sync queued 3 issues for triage. 12 of 30 in the last 24 hours.",
    );
    expect(triagePassText({ ...pass, status: "queued", queued: 1 })).toMatch(
      /queued 1 issue for triage/,
    );
    expect(triagePassText({ ...pass, status: "cap_reached" })).toMatch(
      /daily limit is used up/,
    );
    expect(triagePassText({ ...pass, status: "idle" })).toMatch(
      /nothing new to triage/,
    );
    expect(triagePassText({ ...pass, status: "failed" })).toMatch(
      /could not queue triage/,
    );
    expect(triagePassText({ ...pass, status: "off" })).toBeNull();
    expect(triagePassText(null)).toBeNull();
  });
});
