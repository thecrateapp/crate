import { describe, expect, it } from "vitest";

import type { AgentPlan } from "./agent-integrations";
import {
  changeTargetLabels,
  editorialTrackIdentities,
  editorialView,
  impactView,
  isTechnicalKey,
  isTechnicalString,
  planChangeViews,
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

const mbidBefore = "11111111-2222-4333-8444-555555555555";
const mbidAfter = "99999999-8888-4777-8666-555555555555";

function one(
  change: Record<string, unknown>,
  operation = "library_sync",
  planTargets: AgentPlan["targets"] = targets,
) {
  const [view] = planChangeViews({
    operation,
    targets: planTargets,
    changes: [change],
  });
  if (!view) throw new Error("no view");
  return view;
}

describe("planChangeViews", () => {
  it("lists added internal identifiers in Technical details only", () => {
    const show = { entity_type: "show", name: hex, label: "Coilguns" };
    const view = one(
      {
        targets: [show],
        before: {},
        after: { city: "Madrid", item_id: uuid, source_ref: `upload:${uuid}` },
      },
      "shows_import",
      [show],
    );
    expect(view.targets).toEqual(["Coilguns"]);
    expect(view.body).toEqual({
      kind: "diff",
      rows: [
        {
          key: "city",
          before: undefined,
          after: "Madrid",
          status: "added",
          seeTechnical: false,
        },
        {
          key: "source_ref",
          before: undefined,
          after: TECHNICAL_PLACEHOLDER,
          status: "added",
          seeTechnical: true,
        },
      ],
    });
    expect(view.technical).toEqual([
      { label: "Coilguns · Proposed › Item id", value: uuid },
      { label: "Coilguns · Proposed › Source ref", value: `upload:${uuid}` },
    ]);
  });

  // Mirrors agent_sync's update_index change and native_scan's track payload.
  it("shows a changed MusicBrainz id as changed, with both values", () => {
    const view = one({
      entity_uid: "track-1",
      action: "update_index",
      relative_path: "Echo/Album/01 Song.flac",
      before: {
        title: "Song",
        genre: null,
        musicbrainz_trackid: mbidBefore,
      },
      after: {
        title: "Song",
        genre: null,
        musicbrainz_trackid: mbidAfter,
      },
    });
    expect(view.discriminator).toBe("Echo/Album/01 Song.flac");
    expect(view.details).toBeNull();
    expect(view.body).toEqual({
      kind: "diff",
      rows: [
        {
          key: "title",
          before: "Song",
          after: "Song",
          status: "unchanged",
          seeTechnical: false,
        },
        {
          key: "genre",
          before: null,
          after: null,
          status: "unchanged",
          seeTechnical: false,
        },
        {
          key: "musicbrainz_trackid",
          before: mbidBefore,
          after: mbidAfter,
          status: "changed",
          seeTechnical: true,
        },
      ],
    });
    expect(view.technical).toEqual([
      {
        label: "Missing track · Current › Musicbrainz trackid",
        value: mbidBefore,
      },
      {
        label: "Missing track · Proposed › Musicbrainz trackid",
        value: mbidAfter,
      },
    ]);
  });

  // Mirrors agent_sync.py:172-196: update_index always emits every key, with
  // missing ones as null. A newly tagged MBID on an existing record must not
  // vanish from the card.
  it("keeps an identifier newly set on an existing record visible", () => {
    const view = one({
      entity_uid: "track-1",
      action: "update_index",
      relative_path: "Echo/Album/01 Song.flac",
      before: {
        title: "Song",
        musicbrainz_albumid: null,
        musicbrainz_trackid: null,
      },
      after: {
        title: "Song",
        musicbrainz_albumid: null,
        musicbrainz_trackid: mbidAfter,
      },
    });
    expect(view.body).toEqual({
      kind: "diff",
      rows: [
        {
          key: "title",
          before: "Song",
          after: "Song",
          status: "unchanged",
          seeTechnical: false,
        },
        {
          key: "musicbrainz_trackid",
          before: null,
          after: TECHNICAL_PLACEHOLDER,
          status: "added",
          seeTechnical: true,
        },
      ],
    });
    expect(view.technical).toContainEqual({
      label: "Missing track · Proposed › Musicbrainz trackid",
      value: mbidAfter,
    });
  });

  it("still hides a newly set identifier on a brand-new record", () => {
    const view = one({
      entity_uid: "track-1",
      action: "add_index",
      relative_path: "Echo/Album/02 Song.flac",
      before: null,
      after: {
        title: "Song",
        musicbrainz_albumid: null,
        musicbrainz_trackid: mbidAfter,
      },
    });
    expect(view.body).toEqual({
      kind: "diff",
      rows: [
        {
          key: "title",
          before: undefined,
          after: "Song",
          status: "added",
          seeTechnical: false,
        },
      ],
    });
    expect(view.technical).toContainEqual({
      label: "Missing track · Proposed › Musicbrainz trackid",
      value: mbidAfter,
    });
  });

  it("keeps both values of a changed identifier field on the card", () => {
    const view = one(
      {
        entity_uid: "artist-1",
        field: "mbid",
        before: mbidBefore,
        after: mbidAfter,
      },
      "metadata_update",
    );
    expect(view.subject).toBe("Mbid");
    expect(view.body).toEqual({
      kind: "scalar",
      current: mbidBefore,
      proposed: mbidAfter,
      cleared: false,
      seeTechnical: true,
    });
    expect(view.technical.map(({ value }) => value)).toEqual([
      mbidBefore,
      mbidAfter,
    ]);
  });

  it("keeps the change's other keys as details", () => {
    const view = one(
      {
        artist_uid: "artist-1",
        providers: ["musicbrainz", "lastfm"],
        facets: ["bio"],
        locked_fields_preserved: ["bio"],
        value_policy: "only_missing_unlocked_values",
        after: "provider_result_unknown_until_execution",
      },
      "enrichment",
    );
    expect(view.details).toEqual({
      providers: ["musicbrainz", "lastfm"],
      facets: ["bio"],
      locked_fields_preserved: ["bio"],
      value_policy: "only_missing_unlocked_values",
    });
    expect(view.body).toMatchObject({
      kind: "scalar",
      proposed: "provider_result_unknown_until_execution",
    });
  });

  it("names target references in a change body and numbers its owner", () => {
    const [, , view] = planChangeViews({
      operation: "repairs",
      targets,
      changes: [
        { entity_uid: "artist-1", field: "bio", before: "a", after: "b" },
        { entity_uid: "track-1", field: "title", before: "a", after: "b" },
        {
          issue_id: 42,
          action: "delete_track",
          targets: [
            { entity_type: "artist", entity_uid: "artist-1" },
            { entity_type: "track", entity_uid: "track-1" },
          ],
          deleted_targets: [{ entity_type: "track", entity_uid: "track-1" }],
        },
      ],
    });
    expect(view?.subject).toBe("Delete track");
    expect(view?.numbered).toBe(true);
    expect(view?.body).toEqual({
      kind: "details",
      details: { action: "delete_track", deleted_targets: ["Missing track"] },
    });
    expect(view?.technical).toEqual([
      { label: "Change 3 · Issue id", value: 42 },
    ]);
  });

  it("numbers unlabelled targets and keeps owners unique", () => {
    const tracks: AgentPlan["targets"] = [
      { entity_type: "track", entity_uid: "t-1" },
      { entity_type: "track", entity_uid: "t-2" },
    ];
    const views = planChangeViews({
      operation: "metadata_update",
      targets: tracks,
      changes: [
        { entity_uid: "t-1", field: "genre", before: ["a"], after: ["b"] },
        { entity_uid: "t-2", field: "genre", before: ["a"], after: ["b"] },
        { entity_uid: "t-2", field: "year", before: ["1"], after: ["2"] },
        { entity_uid: "t-2", field: "year", before: ["1"], after: ["3"] },
      ],
    });
    expect(views.map(({ targets: names }) => names)).toEqual([
      ["Track 1"],
      ["Track 2"],
      ["Track 2"],
      ["Track 2"],
    ]);
    expect(views.map(({ owner }) => owner)).toEqual([
      "Track 1",
      "Track 2 · Genre",
      "Change 3 · Track 2 · Year",
      "Change 4 · Track 2 · Year",
    ]);
    expect(views.map(({ numbered }) => numbered)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("shows the photo flag in words", () => {
    expect(
      one(
        {
          artist_uid: "artist-1",
          field: "has_photo",
          before: false,
          after: true,
        },
        "repair_photo_flag",
      ).body,
    ).toEqual({
      kind: "photo",
      current: "No photo",
      proposed: "Photo present",
    });
  });
});

describe("impactView", () => {
  it("keeps lists and maps under the chips and lists identifiers", () => {
    expect(
      impactView({
        filesystem: false,
        external_providers: ["musicbrainz"],
        provider_min_intervals_seconds: { musicbrainz: 1 },
        snapshot_hash: hex,
      }),
    ).toEqual({
      chips: ["No file changes"],
      details: {
        external_providers: ["musicbrainz"],
        provider_min_intervals_seconds: { musicbrainz: 1 },
      },
      technical: [{ label: "Impact · Snapshot hash", value: hex }],
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
