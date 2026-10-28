import { describe, expect, it } from "vitest";
import { chapterId } from "../../lib/chapters";
import { admin } from "./en";

describe("admin chapters", () => {
  const mcp = admin.chapters.find((chapter) => chapter.id === "mcp");

  it("has an MCP chapter anchored at #mcp for the home page to link to", () => {
    expect(mcp?.title).toBe("AI agents, via MCP");
    const ids = admin.chapters.map(
      (chapter, index) => chapter.id ?? chapterId(index + 1, chapter.title),
    );
    expect(ids.filter((id) => id === "mcp")).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks MCP as available and opt-in", () => {
    expect(mcp?.status).toBe("opt-in");
  });

  it("promises a person approves before anything changes", () => {
    expect(mcp?.lede.join(" ")).toMatch(
      /Nothing changes until a person approves it/,
    );
  });

  it("keeps the existing chapter anchors", () => {
    expect(admin.chapters[0]!.id).toBeUndefined();
    expect(chapterId(1, admin.chapters[0]!.title)).toBe("01-health");
  });

  it("names only the providers Admin AI configuration supports", () => {
    const models = admin.chapters
      .flatMap((chapter) => chapter.features ?? [])
      .find((feature) => feature.title === "Language models");
    expect(models?.body).toMatch(/Gemini, DeepSeek, or Ollama/);
    expect(JSON.stringify(admin)).not.toMatch(/LiteLLM|OpenAI|Anthropic/);
  });

  it("presents Telegram control as Crate Agent and Crate Operator, not the old bot", () => {
    const features = admin.chapters.flatMap(
      (chapter) => chapter.features ?? [],
    );
    expect(features.map((feature) => feature.title)).not.toContain(
      "Telegram bot",
    );
    const telegram = features.find(
      (feature) => feature.title === "Crate Agent and Crate Operator",
    );
    expect(telegram?.body).toMatch(
      /Look after the server from Telegram\. Crate Agent diagnoses/,
    );
    expect(telegram?.status).toBe("opt-in");
    expect(telegram?.link?.href).toBe("#telegram-agent");
    expect(JSON.stringify(admin)).not.toMatch(/hermes|nous research/i);
  });
});
