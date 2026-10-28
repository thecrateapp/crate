import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoFile } from "../../lib/source-drift";
import {
  ACCESS,
  APPROVAL_FLOW,
  CONNECT,
  MCP,
  NEVER,
  NO_APPROVAL_TOOL,
  OAUTH_CONNECT,
  OPT_IN,
  OWN_AI,
  PLAN_REF,
  SAFETY,
  TOOL_FAMILIES,
} from "./mcp";

const text = (items: { title: string; body: string }[]) =>
  items.map((item) => `${item.title} ${item.body}`).join(" ");

describe("the approval flow", () => {
  it("runs ask, preview, plan, approve, apply, audit in that order", () => {
    expect(APPROVAL_FLOW.map((step) => step.id)).toEqual([
      "ask",
      "preview",
      "plan",
      "approve",
      "apply",
      "audit",
    ]);
  });

  it("leaves approval to a person, with no MCP tool for it", () => {
    const approvals = APPROVAL_FLOW.filter((step) => step.actor === "person");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.id).toBe("approve");
    expect(approvals[0]!.code).toBe("no MCP tool");
    expect(approvals[0]!.body).toMatch(/version and hash in Admin/);
  });

  it("only applies after the approval step", () => {
    const ids = APPROVAL_FLOW.map((step) => step.id);
    expect(ids.indexOf("apply")).toBeGreaterThan(ids.indexOf("approve"));
    expect(ids.indexOf("approve")).toBeGreaterThan(ids.indexOf("plan"));
  });

  it("shows a versioned, hashed plan", () => {
    expect(PLAN_REF).toMatch(/^v\d+ · sha256:/);
    expect(APPROVAL_FLOW.find((step) => step.id === "plan")!.code).toBe(
      PLAN_REF,
    );
  });

  it("says the agent cannot approve", () => {
    expect(NO_APPROVAL_TOOL).toBe("The agent has no approval tool.");
    expect(text(SAFETY)).toMatch(
      /Require approval before changes” starts on when you connect an agent in Admin/,
    );
    expect(text(SAFETY)).toMatch(
      /High-risk operations, whole-library operations and acquisition always need approval/,
    );
  });
});

describe("tools and access", () => {
  it("names real tool families and never claims open-ended power", () => {
    expect(TOOL_FAMILIES.map((family) => family.title)).toEqual([
      "Diagnostics",
      "Checks and repairs",
      "Library maintenance",
      "Instance operations",
      "Editorial playlists",
      "Shows",
      "Acquisition",
    ]);
    expect(TOOL_FAMILIES[0]!.kind).toBe("read");
    expect(TOOL_FAMILIES.at(-1)!.kind).toBe("approval");
    expect(NEVER).toEqual([
      "Generic task dispatch",
      "Arbitrary SQL",
      "Shell access",
      "Free-form settings",
    ]);
  });

  it("states the published counts and limits", () => {
    expect(MCP).toMatchObject({
      endpoint: "/mcp",
      discovery: "/.well-known/oauth-protected-resource/mcp",
      tools: 71,
      readOnly: 27,
      scopes: 32,
      limits: {
        readsPerMinute: 60,
        concurrentPerClient: 2,
        concurrentGlobal: 8,
        responseKiB: 64,
      },
      serviceToken: { bits: 256, days: 90 },
    });
    expect(text(ACCESS)).toMatch(/PKCE \(S256\)/);
    expect(text(ACCESS)).toMatch(/revokes the whole chain/);
    expect(text(ACCESS)).toMatch(/checked again on every call/);
  });

  it("connects in three steps, opt-in, without claiming certified clients", () => {
    expect(CONNECT).toHaveLength(3);
    expect(text(CONNECT)).toMatch(/Connect an agent/);
    expect(text(CONNECT)).toMatch(/Claude Code, Codex and HTTP clients/);
    expect(text(CONNECT)).toMatch(
      /Read only, Shows curator, Editorial curator, Library maintainer or Custom/,
    );
    expect(OAUTH_CONNECT.discovery).toBe(
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(OPT_IN).toMatch(/off until a server operator enables it/);
    expect(
      JSON.stringify({ CONNECT, ACCESS, SAFETY, TOOL_FAMILIES }),
    ).not.toMatch(/certified|official/i);
  });

  it("keeps Crate's own AI brief and marked optional", () => {
    expect(OWN_AI.status).toBe("optional-llm");
    expect(OWN_AI.body).toMatch(/Gemini, DeepSeek or a local Ollama/);
  });
});

const branchSource = (path: string) =>
  existsSync(repoFile(path)) ? readFileSync(repoFile(path), "utf8") : null;

describe("tools copied from the MCP catalog", () => {
  const tools = branchSource("app/crate/mcp/tools.py");
  const limits = branchSource("app/crate/mcp/limits.py");
  const names = (block: string) =>
    [...block.matchAll(/^\s+"([a-z_]+)": \($/gm)].map(([, name]) => name!);
  const catalog = tools
    ? tools.slice(
        tools.indexOf("OBSERVATION_TOOLS = {"),
        tools.indexOf("\n)\n", tools.indexOf("ACTION_CATALOG.update(")),
      )
    : "";
  const readOnly = tools
    ? tools.slice(
        tools.indexOf("OBSERVATION_TOOLS = {"),
        tools.indexOf("ACTION_CATALOG = {"),
      )
    : "";

  it.skipIf(!tools)("lists only tools the server registers", () => {
    const registered = new Set(names(catalog));
    for (const family of TOOL_FAMILIES)
      for (const tool of family.tools) expect(registered).toContain(tool);
    for (const step of APPROVAL_FLOW)
      if (step.actor !== "person" && step.id !== "plan")
        expect(registered).toContain(step.code);
  });

  it.skipIf(!tools)("matches the tool and read-only counts", () => {
    expect(new Set(names(catalog)).size).toBe(MCP.tools);
    expect(new Set(names(readOnly)).size).toBe(MCP.readOnly);
    for (const tool of TOOL_FAMILIES[0]!.tools)
      expect(names(readOnly)).toContain(tool);
  });

  it.skipIf(!tools)("has no tool that approves a plan", () => {
    expect(names(catalog).filter((name) => /approv/.test(name))).toEqual([]);
  });

  it.skipIf(!limits)("uses the admission limits from limits.py", () => {
    expect(limits).toContain(
      `ZCARD', KEYS[1]) >= ${MCP.limits.readsPerMinute}`,
    );
    expect(limits).toContain(
      `ZCARD', KEYS[2]) >= ${MCP.limits.concurrentPerClient}`,
    );
    expect(limits).toContain(
      `ZCARD', KEYS[3]) >= ${MCP.limits.concurrentGlobal}`,
    );
  });
});
