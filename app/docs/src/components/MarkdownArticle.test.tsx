/**
 * @vitest-environment jsdom
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownArticle } from "./MarkdownArticle";

function renderMarkdown(markdown: string) {
  return render(
    <MemoryRouter>
      <MarkdownArticle markdown={markdown} sourcePath="docs/technical/x.md" />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MarkdownArticle", () => {
  it("links headings to their own anchors", () => {
    renderMarkdown("## Runtime model\n\n## Runtime model");
    const links = screen.getAllByRole("link", { name: "Runtime model" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "#runtime-model",
      "#runtime-model-2",
    ]);
    expect(screen.getAllByRole("heading", { level: 2 })[0]?.id).toBe(
      "runtime-model",
    );
  });

  it("renders alert blockquotes as labelled callouts", () => {
    const { container } = renderMarkdown(
      "> [!EXPERIMENTAL]\n> Federation is opt-in.\n\n> [!WARNING] Back up first.\n\n> Plain quote.",
    );
    const callouts = container.querySelectorAll(".callout");
    expect([...callouts].map((node) => node.getAttribute("data-kind"))).toEqual(
      ["experimental", "warning"],
    );
    const text = (index: number) =>
      callouts[index]?.textContent?.replace(/\s+/g, " ").trim();
    expect(text(0)).toBe("Experimental Federation is opt-in.");
    expect(text(1)).toBe("Warning Back up first.");
    expect(container.querySelector("blockquote")?.textContent?.trim()).toBe(
      "Plain quote.",
    );
  });

  it("renders fenced code with a language label and a copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = renderMarkdown("```bash\nmake dev\n```");

    expect(container.querySelector(".code-lang")?.textContent).toBe("bash");
    expect(container.querySelector(".tok-command")?.textContent).toBe("make");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    });
    expect(writeText).toHaveBeenCalledWith("make dev");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("wraps tables in a scroll container", () => {
    const { container } = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(container.querySelector(".table-wrap > table")).toBeTruthy();
  });
});
