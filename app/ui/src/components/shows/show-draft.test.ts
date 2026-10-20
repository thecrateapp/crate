import { describe, expect, it } from "vitest";
import {
  MAX_DRAFT_SHOWS,
  MAX_SELECTED_SHOWS,
  REQUIRED_SHOW_FIELDS,
  addDate,
  fillDates,
  fillTargets,
  isBlankCandidate,
  mergeImportedDraft,
  missingFields,
  newDraft,
  removeDate,
  reviewSelection,
  savedItemIds,
  selectAllValid,
  type ShowDraftState,
} from "./show-draft";
import {
  emptyShow,
  type ShowCandidate,
  type ShowDraft,
} from "./show-import-types";

function candidate(overrides: Partial<ShowCandidate>): ShowCandidate {
  return { ...emptyShow(), ...overrides };
}

describe("newDraft", () => {
  it("has one selected row with every required field missing", () => {
    const draft = newDraft();
    expect(draft.candidates).toHaveLength(1);
    expect(draft.selected).toEqual([draft.candidates[0]!.item_id]);
    expect(missingFields(draft.candidates[0]!)).toEqual([
      ...REQUIRED_SHOW_FIELDS,
    ]);
  });
});

describe("isBlankCandidate", () => {
  it("is true only when artist, date, venue and city are all empty", () => {
    expect(isBlankCandidate(emptyShow())).toBe(true);
    expect(isBlankCandidate(candidate({ artist_name: "Band" }))).toBe(false);
  });
});

describe("missingFields", () => {
  it("lists only the trimmed-empty required fields, in required order", () => {
    expect(
      missingFields(
        candidate({
          artist_name: "Band",
          date: "2027-03-02",
          venue: "  ",
          city: "",
        }),
      ),
    ).toEqual(["venue", "city"]);
  });
});

describe("savedItemIds", () => {
  it("collects the item ids of saved outcomes only", () => {
    expect(
      savedItemIds([
        { item_id: "a", status: "created", show_id: 1 },
        { item_id: "b", status: "conflict" },
        { item_id: "c", status: "linked_source", show_id: 2 },
      ]),
    ).toEqual(new Set(["a", "c"]));
  });
});

describe("addDate", () => {
  it("copies the artist name and uid from the last row and selects the new row", () => {
    const base = newDraft();
    const withArtist: ShowDraftState = {
      candidates: [
        { ...base.candidates[0]!, artist_name: "Band", artist_uid: "uid-1" },
      ],
      selected: [base.candidates[0]!.item_id],
    };
    const result = addDate(withArtist);
    expect(result.candidates).toHaveLength(2);
    const added = result.candidates[1]!;
    expect(added.artist_name).toBe("Band");
    expect(added.artist_uid).toBe("uid-1");
    expect(result.selected).toContain(added.item_id);
  });

  it("does not select the new row once 50 rows are already selected", () => {
    const candidates = Array.from({ length: 51 }, (_, i) =>
      candidate({ item_id: `row-${i}` }),
    );
    const selected = candidates.slice(0, 50).map((c) => c.item_id);
    const result = addDate({ candidates, selected });
    expect(result.candidates).toHaveLength(52);
    expect(result.selected).toEqual(selected);
  });

  it("is a no-op once the draft holds 200 rows", () => {
    const candidates = Array.from({ length: 200 }, (_, i) =>
      candidate({ item_id: `row-${i}` }),
    );
    expect(candidates.length).toBe(MAX_DRAFT_SHOWS);
    const draft: ShowDraftState = { candidates, selected: [] };
    expect(addDate(draft)).toBe(draft);
  });
});

describe("removeDate", () => {
  it("removes the row and prunes it from selected", () => {
    const a = candidate({ item_id: "a" });
    const b = candidate({ item_id: "b" });
    const result = removeDate(
      { candidates: [a, b], selected: ["a", "b"] },
      "a",
    );
    expect(result.candidates.map((c) => c.item_id)).toEqual(["b"]);
    expect(result.selected).toEqual(["b"]);
  });

  it("never removes the last remaining row", () => {
    const only = candidate({ item_id: "only" });
    const draft: ShowDraftState = { candidates: [only], selected: ["only"] };
    expect(removeDate(draft, "only")).toBe(draft);
  });
});

describe("selectAllValid", () => {
  it("selects at most 50 unsaved, complete rows in draft order", () => {
    const valid = Array.from({ length: 60 }, (_, i) =>
      candidate({
        item_id: `valid-${i}`,
        artist_name: "Band",
        date: "2027-03-02",
        venue: "Hall",
        city: "Madrid",
      }),
    );
    const incomplete = candidate({
      item_id: "incomplete",
      artist_name: "Band",
    });
    const savedValid = candidate({
      item_id: "saved-valid",
      artist_name: "Band",
      date: "2027-03-02",
      venue: "Hall",
      city: "Madrid",
    });
    const draft: ShowDraftState = {
      candidates: [...valid, incomplete, savedValid],
      selected: [],
    };
    const result = selectAllValid(draft, new Set(["saved-valid"]));
    expect(result).toEqual(
      valid.slice(0, MAX_SELECTED_SHOWS).map((c) => c.item_id),
    );
  });
});

describe("fillTargets", () => {
  const a = candidate({ item_id: "a" });
  const b = candidate({ item_id: "b" });
  const savedC = candidate({ item_id: "c" });

  it("targets every unsaved row, scope unsaved, when nothing is selected", () => {
    const draft: ShowDraftState = { candidates: [a, b, savedC], selected: [] };
    expect(fillTargets(draft, new Set(["c"]))).toEqual({
      ids: ["a", "b"],
      scope: "unsaved",
    });
  });

  it("targets only the selected unsaved rows, scope selected, otherwise", () => {
    const draft: ShowDraftState = {
      candidates: [a, b, savedC],
      selected: ["b", "c"],
    };
    expect(fillTargets(draft, new Set(["c"]))).toEqual({
      ids: ["b"],
      scope: "selected",
    });
  });
});

describe("fillDates", () => {
  it("sets the trimmed artist name and clears artist_uid only on target ids", () => {
    const a = candidate({ item_id: "a", artist_uid: "old-uid" });
    const b = candidate({ item_id: "b", artist_uid: "keep-uid" });
    const result = fillDates(
      { candidates: [a, b], selected: [] },
      { artist_name: "  Band  " },
      ["a"],
    );
    expect(result.candidates[0]).toMatchObject({
      artist_name: "Band",
      artist_uid: null,
    });
    expect(result.candidates[1]).toBe(b);
  });

  it("ignores blank values", () => {
    const a = candidate({ item_id: "a", artist_name: "Original" });
    const result = fillDates(
      { candidates: [a], selected: [] },
      { artist_name: "   " },
      ["a"],
    );
    expect(result.candidates[0]!.artist_name).toBe("Original");
  });
});

describe("reviewSelection", () => {
  it("returns the only unsaved row when selected is empty", () => {
    const saved = candidate({ item_id: "saved" });
    const unsaved = candidate({ item_id: "unsaved", artist_name: "Band" });
    const draft: ShowDraftState = {
      candidates: [saved, unsaved],
      selected: [],
    };
    expect(reviewSelection(draft, new Set(["saved"]))).toEqual([unsaved]);
  });

  it("returns the lone unsaved row whatever selected holds, even a stale id", () => {
    const saved = candidate({ item_id: "saved" });
    const unsaved = candidate({ item_id: "unsaved", artist_name: "Band" });
    for (const selected of [["removed-row"], ["saved"], ["unsaved"]]) {
      const draft: ShowDraftState = {
        candidates: [saved, unsaved],
        selected,
      };
      expect(reviewSelection(draft, new Set(["saved"]))).toEqual([unsaved]);
    }
  });

  it("returns the selected unsaved rows in draft order for multi-row drafts", () => {
    const a = candidate({ item_id: "a" });
    const b = candidate({ item_id: "b" });
    const c = candidate({ item_id: "c" });
    const draft: ShowDraftState = {
      candidates: [a, b, c],
      selected: ["c", "a"],
    };
    expect(reviewSelection(draft, new Set())).toEqual([a, c]);
  });
});

describe("mergeImportedDraft", () => {
  const rows = [1, 2].map((index) =>
    Object.freeze(
      candidate({
        item_id: `resume-${index}`,
        artist_name: "Band",
        date: `2027-03-0${index}`,
        venue: "Hall",
        city: "Original City",
      }),
    ),
  );

  function imported(overrides: Partial<ShowDraft>): ShowDraft {
    return {
      draft_id: "resume-draft",
      raw_text: "source",
      coverage: "incomplete",
      candidates: rows,
      publication: {},
      ...overrides,
    };
  }

  it("replaces a single blank row", () => {
    const result = mergeImportedDraft(newDraft(), imported({}));
    expect(result.candidates.map((c) => c.item_id)).toEqual([
      "resume-1",
      "resume-2",
    ]);
    expect(
      result.candidates.every((c) => c.source_draft_id === "resume-draft"),
    ).toBe(true);
    expect(result.selected).toEqual([]);
  });

  it("keeps the blank row when an import finds no shows", () => {
    const draft = newDraft();
    const empty = mergeImportedDraft(draft, imported({ candidates: [] }));
    expect(empty).toBe(draft);
    expect(empty.candidates).toHaveLength(1);
    expect(isBlankCandidate(empty.candidates[0]!)).toBe(true);
    const next = mergeImportedDraft(
      empty,
      imported({ candidates: [rows[0]!] }),
    );
    expect(next.candidates.map((c) => c.item_id)).toEqual(["resume-1"]);
  });

  it("keeps an unsaved local edit, but lets a saved row take the imported value", () => {
    const first = mergeImportedDraft(newDraft(), imported({}));
    const edited: ShowDraftState = {
      candidates: first.candidates.map((c) =>
        c.item_id === "resume-1" ? { ...c, city: "Manual City" } : c,
      ),
      selected: [],
    };
    const second = mergeImportedDraft(
      edited,
      imported({
        candidates: rows.map((row) => ({ ...row, city: "Final City" })),
        publication: {
          "resume-2": { item_id: "resume-2", show_id: 8, status: "created" },
        },
      }),
    );
    expect(second.candidates.find((c) => c.item_id === "resume-1")!.city).toBe(
      "Manual City",
    );
    expect(second.candidates.find((c) => c.item_id === "resume-2")!.city).toBe(
      "Final City",
    );
    expect(second.selected).toEqual([]);
    expect(rows.every((row) => row.city === "Original City")).toBe(true);
    expect(edited.candidates.find((c) => c.item_id === "resume-1")!.city).toBe(
      "Manual City",
    );
  });
});
