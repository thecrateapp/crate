import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("handles conditional classes", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });

  it("resolves tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("keeps badge typography when merged with a text color", () => {
    expect(cn("text-badge", "text-[var(--active-text)]")).toBe(
      "text-badge text-[var(--active-text)]",
    );
  });

  it("keeps counter typography when merged with a text color", () => {
    expect(cn("text-counter", "text-[var(--active-text)]")).toBe(
      "text-counter text-[var(--active-text)]",
    );
  });

  it("keeps token font sizes when merged with a text color", () => {
    expect(cn("text-caption", "text-text-muted")).toBe(
      "text-caption text-text-muted",
    );
    expect(cn("text-micro", "text-accent-action")).toBe(
      "text-micro text-accent-action",
    );
  });

  it("resolves conflicts with layout and typography tokens", () => {
    expect(cn("rounded-xl", "rounded-panel")).toBe("rounded-panel");
    expect(cn("max-w-md", "max-w-content")).toBe("max-w-content");
    expect(cn("h-10", "h-hero-md")).toBe("h-hero-md");
    expect(cn("tracking-wide", "tracking-eyebrow")).toBe("tracking-eyebrow");
  });

  it("handles arrays and objects", () => {
    expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c");
  });

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });
});
