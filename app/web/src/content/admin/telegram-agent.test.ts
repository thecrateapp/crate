import { describe, expect, it } from "vitest";
import {
  ACCESS,
  ACQUISITION_RULES,
  APPROVAL_RULES,
  CHAT,
  DISABLED,
  AGENT,
  AGENT_HEADINGS,
  MODELS,
  PROFILES,
  SETUP,
  SUPERVISOR,
} from "./telegram-agent";
import { TOOL_FAMILIES } from "./mcp";

const rules = APPROVAL_RULES.join(" ");

describe("Telegram profiles", () => {
  it("lists Crate Agent and Crate Operator, each available and opt-in", () => {
    expect(PROFILES.map((profile) => profile.id)).toEqual([
      "agent",
      "operator",
    ]);
    expect(PROFILES.map((profile) => profile.title)).toEqual([
      "Crate Agent",
      "Crate Operator",
    ]);
    for (const profile of PROFILES) expect(profile.status).toBe("opt-in");
    expect(AGENT_HEADINGS.optIn).toMatch(/opt-in, for any Crate instance/);
  });

  it("keeps Crate Agent read-only, with its own terminal, file, web and cron tools off", () => {
    const readOnly = PROFILES[0]!;
    expect(readOnly.summary).toMatch(/^Read-only\./);
    expect(readOnly.summary).toMatch(/never claims to have changed anything/);
    expect(readOnly.scope).toEqual(
      expect.arrayContaining(["Instance status", "Logs", "Runtime policy"]),
    );
    expect(DISABLED).toEqual([
      "Terminal",
      "Files",
      "Web",
      "Cron",
      "Docker socket",
      "SSH",
      "Music mount",
    ]);
  });

  it("lets Crate Operator act only through MCP with approval", () => {
    const operator = PROFILES[1]!;
    expect(operator.summary).toMatch(/through MCP/);
    expect(operator.summary).toMatch(/approve it in Telegram/);
    expect(operator.scope).toContain("Soulseek and Tidal acquisition");
    expect(operator.scope).toContain("Job retry and cancel");
  });
});

describe("approval in Telegram", () => {
  it("uses native Next, Approve and Reject buttons", () => {
    expect(rules).toMatch(/Native Telegram buttons: Next, Approve, Reject/);
  });

  it("needs every page of the exact plan before Approve", () => {
    expect(rules).toMatch(
      /Every page of the exact plan is delivered before Approve is possible/,
    );
  });

  it("never approves on free text", () => {
    expect(rules).toMatch(/Free text never approves/);
  });

  it("expires confirmations after 15 minutes and keeps Admin as a fallback", () => {
    expect(AGENT.confirmMinutes).toBe(15);
    expect(rules).toMatch(/expire after 15 minutes/);
    expect(rules).toMatch(/Admin approval pages remain as a fallback/);
  });

  it("states the acquisition approvals", () => {
    const text = ACQUISITION_RULES.join(" ");
    expect(AGENT.tidalMaxAlbums).toBe(50);
    expect(text).toMatch(/up to 50 albums, takes one mandatory approval/);
    expect(text).toMatch(/never overwrites/);
    expect(text).toMatch(
      /transfer and the publication are approved separately/,
    );
  });

  it("names the supervisor alerts and who may talk to the bot", () => {
    expect(SUPERVISOR).toMatch(/failed tasks, health alerts and new releases/);
    expect(ACCESS.body).toMatch(/allowlisted Telegram user IDs/);
    expect(ACCESS.body).toMatch(/Bots are refused/);
  });
});

describe("the example chat", () => {
  const pages = CHAT.flatMap((entry, index) =>
    entry.kind === "page" ? [{ ...entry, index }] : [],
  );
  const decisions = CHAT.flatMap((entry, index) =>
    entry.kind === "decision" ? [index] : [],
  );

  it("delivers every page, with Approve only on the last one", () => {
    expect(pages.map((page) => page.page)).toEqual([1, 2, 3]);
    for (const page of pages) {
      expect(page.pages).toBe(pages.length);
      expect(page.buttons).toContain("reject");
      expect(page.buttons.includes("approve")).toBe(page.page === page.pages);
      expect(page.buttons.includes("next")).toBe(page.page < page.pages);
    }
  });

  it("approves once, by the button, right after the last page", () => {
    expect(decisions).toEqual([pages.at(-1)!.index + 1]);
  });

  it("does not treat the user's message as an approval", () => {
    const ask = CHAT.findIndex(
      (entry) => entry.kind === "user" && entry.text === "Fix it.",
    );
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(pages[0]!.index);
    const reply = CHAT.slice(ask + 1).find((entry) => entry.kind === "bot");
    expect(reply && "text" in reply && reply.text).toMatch(
      /A message is not an approval/,
    );
  });

  it("only calls tools the MCP server exposes", () => {
    const tools = new Set(TOOL_FAMILIES.flatMap((family) => family.tools));
    for (const entry of CHAT)
      if (entry.kind === "tools")
        for (const tool of entry.tools) expect(tools).toContain(tool);
  });

  it("ends with the supervisor reporting back", () => {
    const last = CHAT.at(-1)!;
    expect(last.kind).toBe("alert");
  });
});

describe("Telegram agent facts", () => {
  it("never names the underlying engine", async () => {
    const content = await import("./telegram-agent");
    expect(JSON.stringify(content)).not.toMatch(/hermes|nous research/i);
  });

  it("is an MCP client that replaces the old bot", () => {
    const lede = AGENT_HEADINGS.lede.join(" ");
    expect(AGENT_HEADINGS.title).toBe(
      "Crate Agent and Crate Operator, in Telegram",
    );
    expect(lede).toMatch(/clients of Crate's MCP server/);
    expect(lede).toMatch(/release-pinned index of Crate's own docs and code/);
    expect(lede).toMatch(/They replace Crate's older built-in Telegram bot/);
  });

  it("lets the operator choose the model", () => {
    expect(MODELS.providers).toEqual([
      "OpenAI",
      "Anthropic",
      "OpenRouter",
      "Gemini",
      "DeepSeek",
    ]);
    expect(MODELS.body).toMatch(/ChatGPT, signed in with your account/);
    expect(MODELS.body).toMatch(/Ollama or any OpenAI-compatible endpoint/);
    expect(MODELS.body).toMatch(/Switching model is one command/);
    expect(MODELS.command).toBe("make agent-model");
  });

  it("sets up in three steps and links the operator guide", () => {
    expect(SETUP.map((step) => step.code)).toEqual([
      "@BotFather",
      "make agent-init",
      "make agent-up",
    ]);
    expect(SETUP[1]!.body).toMatch(
      /exact permissions of the chosen profile, stores the secrets and signs in to the model/,
    );
    expect(SETUP[2]!.body).toMatch(
      /AGENT_PROFILE=agent or AGENT_PROFILE=operator/,
    );
    expect(AGENT.guide.href).toBe(
      "https://docs.cratemusic.app/operations/crate-agent",
    );
  });
});
