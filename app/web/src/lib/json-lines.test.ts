import { describe, expect, it } from "vitest";
import { lineText, toJsonLines, typedAt } from "./json-lines";

describe("toJsonLines", () => {
  it("prints JSON one token-typed line at a time", () => {
    const lines = toJsonLines({ a: 1, b: { c: "x", d: true } });

    expect(lines.map(lineText)).toEqual([
      "{",
      '  "a": 1,',
      '  "b": {',
      '    "c": "x",',
      '    "d": true',
      "  }",
      "}",
    ]);
    expect(lines[3]!.tokens).toEqual([
      { kind: "key", text: '"c"' },
      { kind: "punct", text: ": " },
      { kind: "string", text: '"x"' },
      { kind: "punct", text: "," },
    ]);
    expect(lines[3]!.depth).toBe(2);
  });

  it("keeps arrays of scalars on one line and can elide long ones", () => {
    const lines = toJsonLines(
      { v: [0.1, -0.25, 0.3], tags: ["a", "b"] },
      { maxInline: 2 },
    );

    expect(lines.map(lineText)).toEqual([
      "{",
      '  "v": [0.1, -0.25, … 3 values],',
      '  "tags": ["a", "b"]',
      "}",
    ]);
  });

  it("prints arrays of objects as blocks and null as null", () => {
    expect(toJsonLines([{ a: null }]).map(lineText)).toEqual([
      "[",
      "  {",
      '    "a": null',
      "  }",
      "]",
    ]);
  });
});

describe("typedAt", () => {
  it("reveals characters at a steady rate and clamps at both ends", () => {
    expect(typedAt("curl", 0, 10)).toBe("");
    expect(typedAt("curl", 0.25, 10)).toBe("cu");
    expect(typedAt("curl", 9, 10)).toBe("curl");
    expect(typedAt("curl", -1, 10)).toBe("");
  });
});
