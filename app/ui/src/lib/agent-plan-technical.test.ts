import { describe, expect, it } from "vitest";

import type { AgentPlan } from "./agent-integrations";
import {
  changeTargetLabels,
  changeView,
  editorialTrackIdentities,
  editorialView,
  isTechnicalKey,
  isTechnicalString,
  redactTechnical,
  TECHNICAL_PLACEHOLDER,
  targetDisplayName,
  technicalLabel,
} from "./agent-plan-technical";

const hex = "ab".repeat(32);
const uuid = "6cff6a09-f56b-45ef-aaf4-7e9a4836ff0d";

describe("isTechnicalKey", () => {
  it.each([
    "item_id",
    "source_hash",
    "plan_version",
    "planVersion",
    "sha256",
    "uid",
    "trackUID",
    "audio_fingerprint",
    "actor_principal_id",
    "id",
  ])("treats %s as technical", (key) => {
    expect(isTechnicalKey(key)).toBe(true);
  });

  it.each(["paid", "valid", "android", "name", "source_revision", "video"])(
    "keeps %s visible",
    (key) => {
      expect(isTechnicalKey(key)).toBe(false);
    },
  );
});

describe("isTechnicalString", () => {
  it("recognises digests and UUIDs only", () => {
    expect(isTechnicalString(hex)).toBe(true);
    expect(isTechnicalString(uuid)).toBe(true);
    expect(isTechnicalString(`upload:${uuid}`)).toBe(true);
    expect(isTechnicalString(`show:${hex}`)).toBe(true);
    expect(isTechnicalString(`see ${uuid}`)).toBe(false);
    expect(isTechnicalString("https://link.dice.fm/ZcaQVxQ0f7b")).toBe(false);
    expect(isTechnicalString("plan-one")).toBe(false);
    expect(isTechnicalString("abc123")).toBe(false);
    expect(isTechnicalString(42)).toBe(false);
  });
});

describe("redactTechnical", () => {
  it("moves technical keys and values out and keeps everything else", () => {
    const { visible, hidden } = redactTechnical(
      {
        relation: "user_liked_tracks",
        rows: [{ keys: { user_id: 7, track_id: 9 }, source_hash: hex }],
        manifest: [hex, "readable"],
        source_hash: null,
      },
      ["Proposed"],
    );
    expect(visible).toEqual({
      relation: "user_liked_tracks",
      rows: [{ keys: TECHNICAL_PLACEHOLDER }],
      manifest: [TECHNICAL_PLACEHOLDER, "readable"],
    });
    expect(hidden).toEqual([
      { path: ["Proposed", "Rows", "1", "Keys", "User id"], value: 7 },
      { path: ["Proposed", "Rows", "1", "Keys", "Track id"], value: 9 },
      { path: ["Proposed", "Rows", "1", "Source hash"], value: hex },
      { path: ["Proposed", "Manifest", "1"], value: hex },
      { path: ["Proposed", "Source hash"], value: null },
    ]);
  });

  it("leaves empty records and plain values alone", () => {
    expect(redactTechnical({}).visible).toEqual({});
    expect(redactTechnical("Madrid").visible).toBe("Madrid");
    expect(redactTechnical(null).hidden).toEqual([]);
  });
});

describe("technicalLabel", () => {
  it("joins the owner and the path, attaching list positions", () => {
    expect(
      technicalLabel("Change 1", ["Dependent relations", "1", "Source hash"]),
    ).toBe("Change 1 · Dependent relations 1 › Source hash");
    expect(technicalLabel("Echo", [])).toBe("Echo");
  });
});

describe("targetDisplayName", () => {
  it.each([
    [
      { entity_type: "show", name: hex, label: "Coilguns · 2027-03-14" },
      "Coilguns · 2027-03-14",
    ],
    [{ entity_type: "show", name: hex }, "Show"],
    [{ entity_type: "artist", entity_uid: uuid, name: "Echo" }, "Echo"],
    [{ entity_type: "playlist", name: uuid }, "Playlist"],
    [{ entity_type: "library", scope: "global" }, "Whole library"],
    [{}, "Unknown target"],
  ])("names %o as %s", (target, expected) => {
    expect(targetDisplayName(target)).toBe(expected);
  });
});

const targets: AgentPlan["targets"] = [
  { entity_type: "artist", entity_uid: "artist-1", name: "Echo" },
  { entity_type: "track", entity_uid: "track-1", name: "Missing track" },
];

describe("changeTargetLabels", () => {
  it("names every nested target through the plan targets", () => {
    expect(
      changeTargetLabels(
        {
          targets: [
            { entity_type: "artist", entity_uid: "artist-1" },
            { entity_type: "track", entity_uid: "track-1" },
          ],
        },
        targets,
      ),
    ).toEqual(["Echo", "Missing track"]);
  });

  it("uses the change's own target, the whole library, or a fallback", () => {
    expect(changeTargetLabels({ entity_uid: "artist-1" }, targets)).toEqual([
      "Echo",
    ]);
    expect(changeTargetLabels({ scope: "global" }, targets)).toEqual([
      "Whole library",
    ]);
    expect(changeTargetLabels({ field: "bio" }, targets)).toEqual([
      "Unknown target",
    ]);
  });
});

describe("changeView", () => {
  it("diffs fields without identifiers and lists them as technical items", () => {
    const view = changeView(
      {
        targets: [{ entity_type: "show", name: hex, label: "Coilguns" }],
        before: {},
        after: { city: "Madrid", item_id: uuid },
      },
      0,
      {
        operation: "shows_import",
        targets: [{ entity_type: "show", name: hex, label: "Coilguns" }],
      },
    );
    expect(view.targets).toEqual(["Coilguns"]);
    expect(view.body).toEqual({
      kind: "diff",
      rows: [
        { key: "city", before: undefined, after: "Madrid", status: "added" },
      ],
    });
    expect(view.technical).toEqual([
      { label: "Coilguns · Proposed › Item id", value: uuid },
    ]);
  });

  it("names target references in a change body and numbers its owner", () => {
    const view = changeView(
      {
        issue_id: 42,
        action: "delete_track",
        targets: [
          { entity_type: "artist", entity_uid: "artist-1" },
          { entity_type: "track", entity_uid: "track-1" },
        ],
        deleted_targets: [{ entity_type: "track", entity_uid: "track-1" }],
      },
      2,
      { operation: "repairs", targets },
    );
    expect(view.subject).toBe("Delete track");
    expect(view.body).toEqual({
      kind: "details",
      details: { action: "delete_track", deleted_targets: ["Missing track"] },
    });
    expect(view.technical).toEqual([
      { label: "Change 3 · Issue id", value: 42 },
    ]);
  });

  it("shows the photo flag in words", () => {
    expect(
      changeView(
        {
          artist_uid: "artist-1",
          field: "has_photo",
          before: false,
          after: true,
        },
        0,
        { operation: "repair_photo_flag", targets },
      ).body,
    ).toEqual({
      kind: "photo",
      current: "No photo",
      proposed: "Photo present",
    });
  });
});

describe("editorial content", () => {
  const plan = {
    new_exclusions: ["excluded-new", "excluded-other"],
    existing_exclusions: [
      { track_uid: "excluded-existing", global_track_uid: null },
    ],
    copied_exclusions: [],
    provenance: { source: "local_library", actor_principal_id: "service-one" },
    selection: [
      {
        title: "First",
        track_uid: "track-a",
        global_track_uid: null,
        row_id: 3,
      },
    ],
  } as unknown as AgentPlan;

  it("counts exclusions and hides identifiers", () => {
    const { visible, technical } = editorialView(plan);
    expect(visible).toMatchObject({
      new_exclusions: "2 excluded tracks",
      existing_exclusions: "1 excluded track",
      copied_exclusions: "No excluded tracks",
      provenance: { source: "local_library" },
    });
    expect(technical).toEqual([
      {
        label: "Editorial content · Provenance › Actor principal id",
        value: "service-one",
      },
    ]);
  });

  it("lists selection and exclusion track identities", () => {
    expect(editorialTrackIdentities(plan)).toEqual([
      { label: "1. First · Track ID", value: "track-a" },
      { label: "1. First · Row ID", value: 3 },
      { label: "New exclusion 1 · Track ID", value: "excluded-new" },
      { label: "New exclusion 2 · Track ID", value: "excluded-other" },
      { label: "Existing exclusion 1 · Track ID", value: "excluded-existing" },
    ]);
  });
});
