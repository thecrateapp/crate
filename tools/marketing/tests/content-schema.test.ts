import { describe, expect, it } from "vitest";
import {
  loadContent,
  validateGlossary,
  validateHashtags,
  validateSubreddits,
} from "../src/content";

const reviewed = {
  name: "r/example",
  audiences: ["all"],
  status: "reviewed",
  reviewed_on: "2026-11-03",
  rules: ["No spam."],
  self_promotion: { allowed: "conditional", conditions: "Weekends only." },
  piracy_discussion: "forbidden",
  links_to_blog: "no",
  notes: "",
};

const pending = {
  ...reviewed,
  name: "r/other",
  status: "pending_review",
  reviewed_on: null,
  rules: [],
};

describe("validateSubreddits", () => {
  it("accepts reviewed entries with rules and a review date", () => {
    expect(validateSubreddits({ subreddits: [reviewed, pending] })).toEqual([]);
  });

  it("requires rules and a review date when reviewed", () => {
    const errors = validateSubreddits({
      subreddits: [{ ...reviewed, rules: [], reviewed_on: null }],
    });
    expect(errors).toContain(
      "r/example: reviewed entries need at least one rule",
    );
    expect(errors).toContain(
      "r/example: reviewed_on must be a YYYY-MM-DD date",
    );
  });

  it("rejects rules on entries nobody has reviewed", () => {
    const errors = validateSubreddits({
      subreddits: [{ ...pending, rules: ["Invented rule"] }],
    });
    expect(errors).toContain(
      "r/other: pending_review entries must not record rules",
    );
  });

  it("rejects duplicate names and unknown enum values", () => {
    const errors = validateSubreddits({
      subreddits: [reviewed, { ...reviewed, piracy_discussion: "maybe" }],
    });
    expect(errors).toContain("r/example: duplicate subreddit");
    expect(errors).toContain(
      "r/example: piracy_discussion must be one of allowed, forbidden, unknown",
    );
  });
});

describe("validateGlossary", () => {
  it("rejects a term that is both canonical and banned", () => {
    const errors = validateGlossary({
      terms: [{ canonical: "Smart Mix", note: "", avoid: [] }],
      banned: [{ term: "smart mix", reason: "" }],
    });
    expect(errors).toContain('"Smart Mix" is both canonical and banned');
  });

  it("rejects an avoid entry that is another term's canonical name", () => {
    const errors = validateGlossary({
      terms: [
        { canonical: "Radio", note: "", avoid: [] },
        { canonical: "Smart Mix", note: "", avoid: ["radio"] },
      ],
      banned: [],
    });
    expect(errors).toContain(
      '"radio" is avoided by "Smart Mix" but is the canonical name "Radio"',
    );
  });
});

describe("validateHashtags", () => {
  it("rejects hashes, uppercase and duplicates across lists", () => {
    const errors = validateHashtags({
      approved: ["#selfhosted", "OpenSource"],
      proposed: [{ tag: "selfhosted", audience: "all" }],
    });
    expect(errors).toContain(
      '"#selfhosted" must be lowercase letters and digits without "#"',
    );
    expect(errors).toContain(
      '"OpenSource" must be lowercase letters and digits without "#"',
    );
  });

  it("rejects a tag that is both approved and proposed", () => {
    const errors = validateHashtags({
      approved: ["flac"],
      proposed: [{ tag: "flac", audience: "collectors" }],
    });
    expect(errors).toContain('"flac" is both approved and proposed');
  });
});

describe("repository content", () => {
  it("passes every check", async () => {
    const { errors } = await loadContent();
    expect(errors).toEqual([]);
  });
});
