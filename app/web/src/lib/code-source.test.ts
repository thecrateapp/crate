// @vitest-environment node
import { describe, expect, it } from "vitest";
import { codeSource } from "./code-source";

const COMMIT = "cacf4b347f6a1c3ff0c0ef0f9a4a6b1d2e3f4a5b";

describe("codeSource", () => {
  it("links a line range pinned to a commit", () => {
    expect(
      codeSource("app/readplane/internal/routes/server.go#L424-L438", COMMIT),
    ).toEqual({
      path: "app/readplane/internal/routes/server.go",
      startLine: 424,
      label: "L424–438",
      url: `https://github.com/thecrateapp/crate/blob/${COMMIT}/app/readplane/internal/routes/server.go#L424-L438`,
    });
  });

  it("links a single line", () => {
    const source = codeSource("app/crate/projector.py#L262", COMMIT);
    expect(source.label).toBe("L262");
    expect(source.startLine).toBe(262);
    expect(source.url.endsWith("projector.py#L262")).toBe(true);
  });

  it("links a whole file without line numbers", () => {
    const source = codeSource("docker-compose.yaml", COMMIT);
    expect(source.startLine).toBeUndefined();
    expect(source.label).toBe("");
    expect(source.url).toBe(
      `https://github.com/thecrateapp/crate/blob/${COMMIT}/docker-compose.yaml`,
    );
  });

  it("requires a full commit so links never drift with main", () => {
    expect(() => codeSource("a.go#L1", "main")).toThrow(/40-character commit/);
    expect(() => codeSource("a.go#L1", undefined)).toThrow(/commit/);
  });

  it("rejects a malformed range", () => {
    expect(() => codeSource("a.go#L9-L3", COMMIT)).toThrow(/range/);
    expect(() => codeSource("a.go#lines", COMMIT)).toThrow(/range/);
  });
});
