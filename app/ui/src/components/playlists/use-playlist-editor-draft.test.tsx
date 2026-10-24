import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createPlaylistEditorDraft,
  serializePlaylistEditorDraft,
  usePlaylistEditorDraft,
  type PersistedPlaylistEditor,
  type PlaylistEditorDraft,
} from "./use-playlist-editor-draft";

function playlist(
  overrides: Partial<PersistedPlaylistEditor> = {},
): PersistedPlaylistEditor {
  return {
    id: 1,
    name: "Morning radio",
    description: "A fresh start",
    category: "mood",
    featured_rank: 2,
    is_active: true,
    is_curated: true,
    auto_refresh_enabled: true,
    smart_rules: {
      match: "all",
      rules: [{ field: "energy", op: "gte", value: 0.2 }],
      limit: 30,
      sort: "random",
    },
    ...overrides,
  };
}

describe("usePlaylistEditorDraft", () => {
  it("initializes numeric form values as editable strings", () => {
    const { result } = renderHook(() => usePlaylistEditorDraft(1, playlist()));
    expect(result.current.draft.featuredRank).toBe("2");
    expect(result.current.draft.limit).toBe("30");
    expect(result.current.draft.rules[0]?.value).toBe("0.2");
    expect(result.current.draft.requireFullMixProfile).toBe(false);
    expect(result.current.dirtyFields.size).toBe(0);
  });

  it.each([true, false])(
    "initializes the full SmartMix requirement from persisted %s",
    (requireFullMixProfile) => {
      const current = playlist();
      const { result } = renderHook(() =>
        usePlaylistEditorDraft(
          1,
          playlist({
            smart_rules: {
              ...current.smart_rules,
              require_full_mix_profile: requireFullMixProfile,
            },
          }),
        ),
      );
      expect(result.current.draft.requireFullMixProfile).toBe(
        requireFullMixProfile,
      );
      expect(result.current.isDirty).toBe(false);
    },
  );

  it("preserves a locally disabled SmartMix requirement across replacement snapshots", () => {
    const current = playlist({
      smart_rules: { require_full_mix_profile: true },
    });
    const { result, rerender } = renderHook(
      ({ persisted }) => usePlaylistEditorDraft(1, persisted),
      { initialProps: { persisted: current } },
    );
    act(() => result.current.setField("requireFullMixProfile", false));
    rerender({
      persisted: { ...current, description: "Fresh server copy" },
    });
    expect(result.current.draft.requireFullMixProfile).toBe(false);
    expect(result.current.draft.description).toBe("Fresh server copy");
    expect([...result.current.dirtyFields]).toEqual(["requireFullMixProfile"]);
    act(() => result.current.reset());
    expect(result.current.draft.requireFullMixProfile).toBe(true);
    expect(result.current.isDirty).toBe(false);
  });

  it("updates a clean SmartMix requirement when a fresh snapshot changes it", () => {
    const { result, rerender } = renderHook(
      ({ persisted }) => usePlaylistEditorDraft(1, persisted),
      { initialProps: { persisted: playlist() } },
    );
    rerender({
      persisted: playlist({
        smart_rules: { require_full_mix_profile: true },
      }),
    });
    expect(result.current.draft.requireFullMixProfile).toBe(true);
    expect(result.current.isDirty).toBe(false);
  });

  it("preserves dirty fields across replacement snapshots while updating clean fields", () => {
    const { result, rerender } = renderHook(
      ({ persisted }) => usePlaylistEditorDraft(1, persisted),
      {
        initialProps: { persisted: playlist() },
      },
    );
    act(() => {
      result.current.setField("name", "My unsaved title");
      result.current.setField("rules", (rules) => [
        { ...rules[0]!, value: "0." },
      ]);
    });
    rerender({
      persisted: playlist({
        name: "Server title",
        description: "Updated by another editor",
        featured_rank: 4,
      }),
    });
    expect(result.current.draft).toMatchObject({
      name: "My unsaved title",
      description: "Updated by another editor",
      featuredRank: "4",
    });
    expect(result.current.draft.rules[0]?.value).toBe("0.");
    expect([...result.current.dirtyFields]).toEqual(["name", "rules"]);
  });

  it("does not clear loaded fields when a refetch temporarily has no payload", () => {
    const { result, rerender } = renderHook(
      ({ persisted }) => usePlaylistEditorDraft(1, persisted),
      {
        initialProps: {
          persisted: playlist() as PersistedPlaylistEditor | null,
        },
      },
    );
    rerender({ persisted: null });
    expect(result.current.draft.name).toBe("Morning radio");
    expect(result.current.isDirty).toBe(false);
  });

  it("initializes a delayed snapshot and replaces drafts when the playlist identity changes", () => {
    const { result, rerender } = renderHook(
      ({ id, persisted }) => usePlaylistEditorDraft(id, persisted),
      {
        initialProps: {
          id: 1,
          persisted: null as PersistedPlaylistEditor | null,
        },
      },
    );
    rerender({ id: 1, persisted: playlist() });
    act(() => result.current.setField("description", "Unsaved"));
    rerender({ id: 2, persisted: playlist() });
    expect(result.current.draft.name).toBe(""); // old route data is not the new identity
    rerender({ id: 2, persisted: playlist({ id: 2, name: "Evening radio" }) });
    expect(result.current.draft.name).toBe("Evening radio");
    expect(result.current.draft.description).toBe("A fresh start");
    expect(result.current.isDirty).toBe(false);
  });

  it("accepts a saved snapshot without overwriting edits made while its request was pending", () => {
    const { result } = renderHook(() => usePlaylistEditorDraft(1, playlist()));
    act(() => result.current.setField("name", "Sent title"));
    const sent = { name: result.current.draft.name };
    act(() => result.current.setField("name", "Newer title"));
    act(() => result.current.acceptSaved(sent));
    expect(result.current.draft.name).toBe("Newer title");
    expect(result.current.dirtyFields.has("name")).toBe(true);
    act(() => result.current.reset());
    expect(result.current.draft.name).toBe("Sent title");
    expect(result.current.isDirty).toBe(false);
  });

  it("acknowledges only submitted fields and ignores an unchanged old server snapshot", () => {
    const { result, rerender } = renderHook(
      ({ persisted }) => usePlaylistEditorDraft(1, persisted),
      {
        initialProps: { persisted: playlist() },
      },
    );
    act(() => {
      result.current.setField("name", "Still unsaved");
      result.current.setField("limit", "31");
    });
    act(() => result.current.acceptSaved({ limit: "31" }));
    rerender({ persisted: playlist() });
    expect(result.current.draft.limit).toBe("31");
    expect([...result.current.dirtyFields]).toEqual(["name"]);
  });

  it("ignores late save acknowledgments and setters belonging to a previous playlist", () => {
    const { result, rerender } = renderHook(
      ({ id, persisted }) => usePlaylistEditorDraft(id, persisted),
      {
        initialProps: { id: 1, persisted: playlist() },
      },
    );
    const oldAccept = result.current.acceptSaved;
    const oldSet = result.current.setField;
    rerender({
      id: 2,
      persisted: playlist({ id: 2, name: "Second playlist" }),
    });
    act(() => {
      oldAccept({ name: "Old response" });
      oldSet("name", "Old edit");
    });
    expect(result.current.draft.name).toBe("Second playlist");
    expect(result.current.isDirty).toBe(false);
  });

  it("clears dirtiness when the server converges to a local edit and resets to latest persisted values", () => {
    const { result, rerender } = renderHook(
      ({ persisted }) => usePlaylistEditorDraft(1, persisted),
      {
        initialProps: { persisted: playlist() },
      },
    );
    act(() => result.current.setField("name", "Shared title"));
    rerender({
      persisted: playlist({ name: "Shared title", description: "Latest copy" }),
    });
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.setField("description", "Another draft"));
    act(() => result.current.reset());
    expect(result.current.draft.description).toBe("Latest copy");
  });
});

describe("serializePlaylistEditorDraft", () => {
  function draft(
    overrides: Partial<PlaylistEditorDraft> = {},
  ): PlaylistEditorDraft {
    return { ...createPlaylistEditorDraft(playlist()), ...overrides };
  }

  it("serializes decimals once, retains year strings and preserves advanced persisted rule options", () => {
    const result = serializePlaylistEditorDraft(
      draft({
        featuredRank: "",
        rules: [
          { field: "energy", op: "gte", value: "0.25" },
          { field: "bpm", op: "between", value: ["90.5", "130"] },
          { field: "year", op: "between", value: ["1990", "2026"] },
        ],
      }),
      {
        isSmart: true,
        persistedSmartRules: {
          deduplicate_artist: true,
          max_per_album: 3,
          expand_related_genres: false,
        },
      },
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.payload.featured_rank).toBeNull();
    expect(result.smartRules).toMatchObject({
      deduplicate_artist: true,
      max_per_album: 3,
      expand_related_genres: false,
      limit: 30,
      rules: [
        { field: "energy", op: "gte", value: 0.25 },
        { field: "bpm", op: "between", value: [90.5, 130] },
        { field: "year", op: "between", value: ["1990", "2026"] },
      ],
    });
  });

  describe.each(["all", "rules"] as const)("%s scope", (scope) => {
    it.each([
      { persisted: undefined, current: false, expected: undefined },
      { persisted: undefined, current: true, expected: true },
      { persisted: false, current: false, expected: false },
      { persisted: false, current: true, expected: true },
      { persisted: true, current: false, expected: false },
      { persisted: true, current: true, expected: true },
    ])(
      "serializes the SmartMix requirement from $persisted to $current as $expected",
      ({ persisted, current, expected }) => {
        const result = serializePlaylistEditorDraft(
          draft({ requireFullMixProfile: current }),
          {
            isSmart: true,
            scope,
            persistedSmartRules:
              persisted === undefined
                ? { max_per_album: 3 }
                : {
                    max_per_album: 3,
                    require_full_mix_profile: persisted,
                  },
          },
        );
        expect(result.valid).toBe(true);
        if (!result.valid) return;
        expect(result.smartRules?.max_per_album).toBe(3);
        expect(result.payload.smart_rules).toEqual(result.smartRules);
        if (expected === undefined) {
          expect(result.smartRules).not.toHaveProperty(
            "require_full_mix_profile",
          );
        } else {
          expect(result.smartRules?.require_full_mix_profile).toBe(expected);
        }
      },
    );
  });

  it.each(["", "NaN", "Infinity", "abc", "1e999", "0x10"])(
    "rejects invalid numeric input %j without submitting a coerced value",
    (value) => {
      const result = serializePlaylistEditorDraft(
        draft({ rules: [{ field: "energy", op: "gte", value }] }),
        { isSmart: true },
      );
      expect(result).toMatchObject({
        valid: false,
        errors: { "rules.0.value": "Enter a finite number." },
      });
    },
  );

  it("keeps a partial decimal in the draft and converts it only for a valid submission", () => {
    const current = draft({
      rules: [{ field: "energy", op: "gte", value: "0." }],
    });
    const result = serializePlaylistEditorDraft(current, { isSmart: true });
    expect(current.rules[0]?.value).toBe("0.");
    expect(result).toMatchObject({
      valid: true,
      smartRules: { rules: [{ value: 0 }] },
    });
  });

  it.each(["", "0", "501", "1.5", "NaN"])(
    "validates the complete integer limit %j",
    (limit) => {
      expect(
        serializePlaylistEditorDraft(draft({ limit }), { isSmart: true }),
      ).toMatchObject({ valid: false, errors: { limit: expect.any(String) } });
    },
  );

  it("reports distinct field errors for incomplete years and range endpoints", () => {
    const result = serializePlaylistEditorDraft(
      draft({
        rules: [
          { field: "year", op: "eq", value: "202" },
          { field: "bpm", op: "between", value: ["", "120"] },
          { field: "energy", op: "between", value: ["0.8", "0.2"] },
        ],
      }),
      { isSmart: true },
    );
    expect(result).toMatchObject({
      valid: false,
      errors: {
        "rules.0.value": "Enter a four-digit year.",
        "rules.1.value.0": "Enter a finite number.",
        "rules.2.value": "The minimum must not exceed the maximum.",
      },
    });
  });

  it("validates editorial fields for a global save but excludes them for rules-only operations", () => {
    const current = draft({ name: "", featuredRank: "NaN", limit: "31" });
    expect(
      serializePlaylistEditorDraft(current, { isSmart: true }),
    ).toMatchObject({
      valid: false,
      errors: { name: expect.any(String), featuredRank: expect.any(String) },
    });
    const result = serializePlaylistEditorDraft(current, {
      isSmart: true,
      scope: "rules",
    });
    expect(result).toMatchObject({
      valid: true,
      payload: { smart_rules: { limit: 31 }, auto_refresh_enabled: true },
    });
    if (!result.valid) return;
    expect(Object.keys(result.payload).sort()).toEqual([
      "auto_refresh_enabled",
      "smart_rules",
    ]);
  });

  it("does not validate or submit hidden smart fields for static playlists", () => {
    const result = serializePlaylistEditorDraft(
      draft({
        limit: "",
        rules: [{ field: "bpm", op: "gte", value: "" }],
        requireFullMixProfile: true,
      }),
      {
        isSmart: false,
        persistedSmartRules: { require_full_mix_profile: true },
      },
    );
    expect(result).toMatchObject({ valid: true, smartRules: null });
    if (!result.valid) return;
    expect(result.payload).not.toHaveProperty("smart_rules");
    expect(result.payload).not.toHaveProperty("auto_refresh_enabled");
  });

  it("matches the closed server contract for text values and list/range shapes", () => {
    const result = serializePlaylistEditorDraft(
      draft({
        rules: [
          { field: "genre", op: "eq", value: "" },
          { field: "bpm", op: "between", value: ["120"] },
          { field: "genre", op: "contains", value: ["punk"] },
          { field: "missing", op: "eq", value: "1" },
        ],
      }),
      { isSmart: true },
    );
    expect(result).toMatchObject({
      valid: false,
      errors: {
        "rules.0.value": expect.any(String),
        "rules.1.value": expect.any(String),
        "rules.2.value": expect.any(String),
        "rules.3.field": expect.any(String),
      },
    });
  });
});
