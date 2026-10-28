// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  albumEntityUid,
  artistEntityUid,
  ENTITY_NAMESPACES,
  normalizeText,
  trackEntityUid,
  uuid5,
} from "./entity-uid";

describe("normalizeText", () => {
  it("folds accents, case, punctuation and whitespace like crate.entity_ids", () => {
    expect(normalizeText("  Sigur Rós ")).toBe("sigur ros");
    expect(normalizeText("SIGUR   RÓS")).toBe("sigur ros");
    expect(normalizeText("Godspeed You! Black Emperor")).toBe(
      "godspeed you black emperor",
    );
    expect(normalizeText(null)).toBe("");
  });
});

describe("uuid5", () => {
  it("matches RFC 4122 version 5 for the URL namespace", () => {
    expect(
      uuid5("6ba7b811-9dad-11d1-80b4-00c04fd430c8", "crate:entity-uids:v1"),
    ).toBe("9bd0ee7a-6701-5946-927d-09671b546bb9");
  });

  it("derives the artist namespace from the root", () => {
    expect(ENTITY_NAMESPACES.artist).toBe(
      "f961f09b-cf77-5dc7-a9a9-e0570c1e8b13",
    );
  });
});

describe("entity uids", () => {
  it("gives the same artist id to every spelling that normalises the same", () => {
    expect(artistEntityUid({ name: "Sigur Rós" })).toBe(
      "f65c87f6-b26e-5dcc-911f-48f87527d949",
    );
    expect(artistEntityUid({ name: "SIGUR RÓS" })).toBe(
      "f65c87f6-b26e-5dcc-911f-48f87527d949",
    );
    expect(artistEntityUid({ name: "Slowdive" })).toBe(
      "dd335d6e-20e9-53c1-852c-b65ecdd1fbf6",
    );
  });

  it("prefers the MusicBrainz id when there is one", () => {
    expect(
      artistEntityUid({
        name: "x",
        mbid: "8a1c5a3b-4b21-4f2d-9b3a-1c2d3e4f5a6b",
      }),
    ).toBe("4c95aaf8-f249-5c38-a55c-351cd6b958ad");
  });

  it("chains album and track ids from their parents", () => {
    const album = albumEntityUid({
      artistUid: "dd335d6e-20e9-53c1-852c-b65ecdd1fbf6",
      albumName: "Souvlaki",
      year: "1993",
    });
    expect(album).toBe("1c9a2b45-b265-5625-b7ac-4f8eab13ab2e");
    expect(
      trackEntityUid({
        albumUid: album,
        discNumber: 1,
        trackNumber: 1,
        title: "Alison",
        filename: "01 - Alison.flac",
      }),
    ).toBe("203e2dd3-5cdc-580c-a43b-6c54fd1dade6");
  });
});
