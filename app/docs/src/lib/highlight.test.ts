import { describe, expect, it } from "vitest";

import { highlight, resolveLanguage, type Token } from "./highlight";

function kinds(tokens: Token[]) {
  return tokens
    .filter((token) => token.kind !== "plain")
    .map((token) => [token.kind, token.text]);
}

describe("highlight", () => {
  it("returns a single plain token for unknown languages", () => {
    expect(highlight("hello world", "text")).toEqual([
      { kind: "plain", text: "hello world" },
    ]);
    expect(highlight("x", undefined)).toEqual([{ kind: "plain", text: "x" }]);
  });

  it("marks bash commands, flags, strings, variables and comments", () => {
    const code =
      '# start the stack\ndocker compose up -d --build "api" && echo $HOME';
    expect(kinds(highlight(code, "bash"))).toEqual([
      ["comment", "# start the stack"],
      ["command", "docker"],
      ["flag", "-d"],
      ["flag", "--build"],
      ["string", '"api"'],
      ["command", "echo"],
      ["variable", "$HOME"],
    ]);
  });

  it("does not treat continuation lines as new commands", () => {
    const tokens = highlight("make deploy \\\n  VERSION=abc", "sh");
    expect(kinds(tokens)).toEqual([["command", "make"]]);
  });

  it("marks json keys separately from string values", () => {
    expect(kinds(highlight('{"name": "crate", "port": 8585}', "json"))).toEqual(
      [
        ["key", '"name"'],
        ["string", '"crate"'],
        ["key", '"port"'],
        ["literal", "8585"],
      ],
    );
  });

  it("marks yaml keys and comments", () => {
    expect(kinds(highlight("services:\n  - api: true # main", "yml"))).toEqual([
      ["key", "services"],
      ["key", "api"],
      ["literal", "true"],
      ["comment", "# main"],
    ]);
  });

  it("preserves the source text exactly", () => {
    const code = 'curl -fsSL "https://x" | sh\n# done\n';
    expect(
      highlight(code, "bash")
        .map((token) => token.text)
        .join(""),
    ).toBe(code);
  });

  it("resolves shell aliases", () => {
    expect(resolveLanguage("Shell")).toBe("bash");
    expect(resolveLanguage("yml")).toBe("yaml");
  });
});
