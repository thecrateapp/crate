import { describe, expect, it } from "vitest";

import {
  docsBySection,
  extractHeadings,
  filterDocs,
  getDoc,
  loadDoc,
  parseDocMeta,
  sectionMeta,
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

// Crate Decks links to these pages and anchors from its Help menu, its
// Preferences pages and its dialogs. Renaming one of these headings breaks a
// link in a shipped app, so they are a contract.
const decksAnchors: Record<string, string[]> = {
  "user-manual": [
    "getting-started",
    "connecting-to-crate",
    "hardware-compatibility",
    "settings-directory",
    "command-line-options",
    "getting-help",
  ],
  library: [
    "the-crate-section",
    "local-music",
    "searching",
    "library-preferences",
  ],
  mixing: ["cue-modes", "sync-lock", "equalizers", "autodj"],
  analysis: ["analysis-from-crate", "beat-detection", "key-detection"],
  sound: [
    "sound-api",
    "output-and-input-devices",
    "latency",
    "microphones",
    "microphone-latency-compensation",
    "troubleshooting",
  ],
  controllers: [
    "using-a-controller",
    "supported-controllers",
    "mapping-file-format",
    "scripting",
    "controls",
    "controller-engine-versions",
  ],
  "keyboard-shortcuts": [],
  "recording-and-broadcasting": ["recording", "broadcasting"],
  "vinyl-control": ["configuring-vinyl-control", "troubleshooting"],
  community: [
    "getting-help",
    "reporting-bugs",
    "translations",
    "sharing-controller-mappings",
  ],
};

describe("Crate Decks section", () => {
  it("is a section with exactly the pages Crate Decks links to", () => {
    expect(sectionMeta.decks.label).toBe("Crate Decks");
    expect(docsBySection.decks.map((doc) => doc.slug).sort()).toEqual(
      Object.keys(decksAnchors).sort(),
    );
    for (const doc of docsBySection.decks) {
      expect(doc.route).toBe(`/decks/${doc.slug}`);
    }
  });

  it.each(Object.entries(decksAnchors))(
    "keeps the linked anchors of /decks/%s",
    async (slug, anchors) => {
      const doc = getDoc("decks", slug);
      expect(doc).toBeDefined();
      const loaded = await loadDoc(doc!);
      expect(loaded.meta.audience).toEqual(["user"]);
      const level2 = loaded.headings
        .filter((heading) => heading.level === 2)
        .map((heading) => heading.id);
      for (const anchor of anchors) expect(level2).toContain(anchor);
    },
  );

  it("never links to the upstream project's sites", async () => {
    for (const doc of docsBySection.decks) {
      const { markdown } = await loadDoc(doc);
      expect(markdown).not.toMatch(
        /mixxx\.org|mixxx\.discourse|github\.com\/mixxxdj|transifex/i,
      );
    }
  });
});
