import { describe, expect, it } from "vitest";

import {
  patchCatalogMessage,
  patchCatalogMetadata,
} from "@/i18n/dev/translation-dev-plugin";

describe("patchCatalogMessage", () => {
  it("updates one key and preserves sorted JSON", () => {
    const next = patchCatalogMessage('{"b":"B","a":"A"}', "c", "C");

    expect(JSON.parse(next)).toEqual({ a: "A", b: "B", c: "C" });
    expect(next).toBe('{\n  "a": "A",\n  "b": "B",\n  "c": "C"\n}\n');
  });

  it("updates an existing key without changing other values", () => {
    const next = patchCatalogMessage('{"a":"A","b":"B"}', "a", "Updated");

    expect(JSON.parse(next)).toEqual({ a: "Updated", b: "B" });
  });
});

describe("patchCatalogMetadata", () => {
  it("stores the reviewed source hash for one key", () => {
    const next = patchCatalogMetadata(
      '{"a":{"sourceHash":"old","reviewedAt":"2026-01-01T00:00:00.000Z"}}',
      "b",
      "sha256:new",
      "2026-07-07T00:00:00.000Z",
    );

    expect(JSON.parse(next)).toEqual({
      a: {
        sourceHash: "old",
        reviewedAt: "2026-01-01T00:00:00.000Z",
      },
      b: {
        sourceHash: "sha256:new",
        reviewedAt: "2026-07-07T00:00:00.000Z",
      },
    });
  });
});
