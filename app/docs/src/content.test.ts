import { describe, expect, it } from "vitest";

import {
  docsBySection,
  extractHeadings,
  filterDocs,
  parseDocMeta,
  splitFrontmatter,
} from "./content";

describe("splitFrontmatter", () => {
  it("separates frontmatter from the markdown body", () => {
    expect(splitFrontmatter("---\ntitle: A\n---\n\n# A\n")).toEqual({
      frontmatter: "title: A",
      markdown: "# A\n",
    });
  });

  it("returns the source untouched without frontmatter", () => {
    expect(splitFrontmatter("# A")).toEqual({
      frontmatter: "",
      markdown: "# A",
    });
  });
});

describe("parseDocMeta", () => {
  it("reads the verified date and audience list", () => {
    expect(
      parseDocMeta(
        "title: A\naudience: [developer, operator]\nverified: 2026-07-21",
      ),
    ).toEqual({ verified: "2026-07-21", audience: ["developer", "operator"] });
  });

  it("tolerates missing fields", () => {
    expect(parseDocMeta("title: A")).toEqual({
      verified: undefined,
      audience: [],
    });
  });
});

describe("filterDocs", () => {
  it("returns every section for an empty query", () => {
    expect(filterDocs("  ")).toBe(docsBySection);
  });

  it("matches titles, summaries and keywords case-insensitively", () => {
    const result = filterDocs("FEDERATION PROTOCOL");
    const titles = Object.values(result)
      .flat()
      .map((doc) => doc.title);
    expect(titles).toContain("Federation protocol");
    expect(result.start).toEqual([]);
  });
});

describe("extractHeadings", () => {
  const markdown = [
    "# Title",
    "## Using `cn` with **bold** and [links](other.md)",
    "```bash",
    "## not a heading",
    "```",
    "### Plain, simple",
    "## Using `cn` with **bold** and [links](other.md)",
  ].join("\n");

  it("strips inline markdown and skips fenced code", () => {
    expect(extractHeadings(markdown)).toEqual([
      {
        level: 2,
        text: "Using cn with bold and links",
        id: "using-cn-with-bold-and-links",
      },
      { level: 3, text: "Plain, simple", id: "plain-simple" },
      {
        level: 2,
        text: "Using cn with bold and links",
        id: "using-cn-with-bold-and-links-2",
      },
    ]);
  });
});
