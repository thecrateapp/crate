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

  it("keeps the mono label size apart from text colours and merges colours", () => {
    expect(cn("text-label text-text-subtle", "text-text-secondary")).toBe(
      "text-label text-text-secondary",
    );
    expect(cn("leading-none", "leading-display")).toBe("leading-display");
  });

  it.each(["eyebrow", "numeral-sm", "numeral-md", "numeral-lg", "numeral-xl"])(
    "keeps the %s font size when its text colour is overridden",
    (size) => {
      expect(cn(`text-${size} text-text-subtle`, "text-text-primary")).toBe(
        `text-${size} text-text-primary`,
      );
    },
  );

  it.each(["eyebrow", "numeral-sm", "numeral-md", "numeral-lg", "numeral-xl"])(
    "resolves font-size conflicts for the %s token in either order",
    (size) => {
      expect(cn("text-lg", `text-${size}`)).toBe(`text-${size}`);
      expect(cn(`text-${size}`, "text-lg")).toBe("text-lg");
    },
  );

  it("resolves numeral tracking and leading overrides in either order", () => {
    expect(cn("tracking-wide", "tracking-numeral")).toBe("tracking-numeral");
    expect(cn("tracking-numeral", "tracking-wide")).toBe("tracking-wide");
    expect(cn("tracking-numeral", "tracking-numeral-sm")).toBe(
      "tracking-numeral-sm",
    );
    expect(cn("leading-none", "leading-numeral")).toBe("leading-numeral");
    expect(cn("leading-numeral", "leading-none")).toBe("leading-none");
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
