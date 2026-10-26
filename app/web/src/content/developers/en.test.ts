import { describe, expect, it } from "vitest";
import { developers } from "./en";

describe("developers APIs chapter", () => {
  const apis = developers.chapters.find((chapter) => chapter.title === "APIs");
  const mcp = apis?.features?.find((feature) => feature.title === "MCP");

  it("points at the opt-in MCP endpoint and the admin chapter", () => {
    expect(mcp?.body).toMatch(/\/mcp on the Crate API/);
    expect(mcp?.body).toMatch(/Opt-in/);
    expect(mcp?.link).toEqual({
      href: "/admin#mcp",
      label: "AI agents, via MCP",
    });
  });

  it("does not claim any client is certified", () => {
    expect(mcp?.body).toMatch(/MCP clients such as Claude Code/);
    expect(mcp?.body).not.toMatch(/certified|official/i);
  });
});
