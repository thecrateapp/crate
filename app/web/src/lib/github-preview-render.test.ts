// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeToTokens, type ThemeRegistration } from "shiki";
import { sourceCodeHtml } from "./github-preview";
import { renderPreviewSource, TOKENIZE_TIME_LIMIT_MS } from "./github-preview-render";
import { previewTokenCss, tokenClass } from "./github-preview-theme";
import theme from "./code-theme.json";
const url = "https://github.com/thecrateapp/crate/blob/0123456789abcdef0123456789abcdef01234567/docs/guide.md";
const view = async (source: string, path: string) => {
  const result = await renderPreviewSource(source, path, url);
  return { ...result, html: sourceCodeHtml({ path, source, ...result }) };
};

const unescape = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const perCharacter = (style: string, text: string) => [...text].map((char) => `${style}|${char}`);

/** Per-character styles of the previous markup: one inline-styled span per Shiki token. */
async function inlineStyledCharacters(source: string, lang: string): Promise<string[][]> {
  const { tokens } = await codeToTokens(source.replace(/\r?\n$/, ""), { lang: lang as "python", theme: theme as ThemeRegistration, tokenizeTimeLimit: TOKENIZE_TIME_LIMIT_MS });
  return tokens.map((line) => line.flatMap((token) => {
    const declarations: string[] = [];
    if (token.color && token.color.toLowerCase() !== theme.colors["editor.foreground"]) declarations.push(`color:${token.color.toLowerCase()}`);
    if (token.fontStyle && token.fontStyle & 1) declarations.push("font-style:italic");
    if (token.fontStyle && token.fontStyle & 2) declarations.push("font-weight:600");
    return perCharacter(declarations.join(";"), token.content);
  }));
}

/** Per-character styles of the rebuilt markup, translating classes back to the theme. */
function classStyledCharacters(html: string, lines: string[]): string[][] {
  const rows = [...html.matchAll(/<span class="gfp-line-code">(.*?)<\/span><\/span>(?=<span class="gfp-code-line"|<\/code>)/g)].map((match) => match[1]);
  expect(rows).toHaveLength(lines.length);
  return rows.map((row, index) => lines[index] === "" ? [] : [...row.matchAll(/<span class="([^"]+)">([^<]*)<\/span>|([^<]+)/g)].flatMap((match) => {
    const names = (match[1] ?? "").split(" ");
    const color = names.find((name) => name.startsWith("gfp-c-"))?.replace("gfp-c-", "#");
    const style = [color && `color:${color}`, names.includes("gfp-i") && "font-style:italic", names.includes("gfp-b") && "font-weight:600"].filter(Boolean).join(";");
    return perCharacter(style, unescape(match[2] ?? match[3]));
  }));
}

describe("GitHub source rendering", () => {
  it("preserves source text and complete numbered lines without executing HTML", async () => {
    const result = await view('const html = "<script>alert(1)</script>";\n\nexport default html;', "view.ts");
    expect(result.language).toBe("typescript");
    expect(result.html).toContain('data-source-line="1"');
    expect(result.html).toContain('data-source-line="3"');
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain('<span class="gfp-c-67e8f9">const</span>');
    expect(result.html).not.toContain("style=");
    expect(result.markdownHtml).toBeUndefined();
    expect(result).not.toHaveProperty("codeHtml");
  });

  it("stores each file's text once and highlighting as short class-indexed runs", async () => {
    const source = readFileSync(new URL("./github-preview-render.ts", import.meta.url), "utf8");
    const result = await renderPreviewSource(source, "github-preview-render.ts", url);
    expect(result.styles[0]).toBe("");
    expect(new Set(result.styles).size).toBe(result.styles.length);
    expect(result.runs).toHaveLength(source.replace(/\n$/, "").split("\n").length);
    for (const line of result.runs) expect(line).toMatch(/^([a-zA-Z]\d+)*[a-zA-Z]?$/);
    expect(JSON.stringify({ styles: result.styles, runs: result.runs }).length).toBeLessThan(source.length);
  }, 30_000);

  it("rebuilds exactly the text, colours and font styles of the per-token inline styles", async () => {
    const samples: [string, string][] = [
      ["github-preview-render.ts", readFileSync(new URL("./github-preview-render.ts", import.meta.url), "utf8")],
      ["planner.py", '"""Doc."""\nclass Plan:  # comment\n    def run(self, n: int = 3) -> str:\n        return f"{n!r}"\n\tx = [1, 2.5, None]\n'],
      ["guide.md", "# Title\n\n*em* **strong** `code` [link](./a.md)\n\n- [x] done\n\n```py\nprint('hi')\n```\n"],
      ["notes.txt", "plain\r\n\r\ntext\r\n"],
    ];
    for (const [path, source] of samples) {
      const result = await view(source, path);
      const lines = source.replace(/\r?\n$/, "").split(/\r?\n/);
      expect(classStyledCharacters(result.html, lines)).toEqual(await inlineStyledCharacters(source, result.language));
    }
  }, 30_000);

  it("does not turn a final newline into a phantom line but keeps intentional blank lines", async () => {
    const result = await view("first\n\nlast\n", "notes.txt");
    expect(result.html.match(/data-source-line=/g)).toHaveLength(3);
    expect(result.runs).toEqual(["", "", ""]);
    const windows = await view("first\r\nlast\r\n", "notes.txt");
    expect(windows.html.match(/data-source-line=/g)).toHaveLength(2);
    const empty = await view("", "empty.txt");
    expect(empty.html).not.toContain("data-source-line=");
    expect(empty.runs).toEqual([]);
  });

  it("renders Markdown structure and source coordinates while dropping raw HTML and unsafe links", async () => {
    const result = await renderPreviewSource('# The plan\n\n[unsafe](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[Related](../README.md#intro)\n\n![Diagram](./diagram.svg)\n\n## Details\n\n| Item | State |\n| --- | --- |\n| Queue | Ready |', "docs/guide.md", url);
    expect(result.markdownHtml).toContain('data-source-heading="the-plan"');
    expect(result.markdownHtml).toContain('data-source-start="1"');
    expect(result.markdownHtml).toContain("<table");
    expect(result.markdownHtml).not.toMatch(/<script|<img|onerror|javascript:/);
    expect(result.markdownHtml).toContain('href="https://github.com/thecrateapp/crate/blob/0123456789abcdef0123456789abcdef01234567/README.md#intro"');
    expect(result.markdownHtml).toContain('>Diagram</a>');
  });

  it("gives repeated headings distinct GitHub-style anchors and safely displays unknown formats", async () => {
    const markdown = await renderPreviewSource("## A heading\n\n## A heading", "guide.md", url);
    expect(markdown.markdownHtml).toContain('data-source-heading="a-heading-1"');
    const plain = await view("<value>&amp;</value>", "something.unknown");
    expect(plain.language).toBe("text");
    expect(plain.html).toContain("&lt;value&gt;&amp;amp;&lt;/value&gt;");
  });
});

describe("source viewer token styles", () => {
  it("ships one rule per theme colour and maps Shiki tokens onto them", () => {
    for (const rule of theme.tokenColors) {
      const color = rule.settings.foreground.toLowerCase();
      if (color === theme.colors["editor.foreground"]) expect(tokenClass(color)).toBe("");
      else expect(previewTokenCss).toContain(`.gfp-code .gfp-c-${color.slice(1)}{color:${color}}`);
    }
    expect(tokenClass("#67E8F9", 0)).toBe("gfp-c-67e8f9");
    expect(tokenClass("#7E8084", 1)).toBe("gfp-c-7e8084 gfp-i");
    expect(tokenClass(undefined, 2)).toBe("gfp-b");
    expect(previewTokenCss).toContain(".gfp-code .gfp-i{font-style:italic}");
    expect(previewTokenCss).toContain(".gfp-code .gfp-b{font-weight:600}");
    expect(() => tokenClass("#ff0000")).toThrow("not defined by the code theme");
  });

  it("decodes runs defensively: bounded lengths, escaped text and no injected classes", () => {
    const html = sourceCodeHtml({ path: 'a"b.ts', source: "a<b>c\n\nxyz", styles: ["", "gfp-c-67e8f9", '"><img src=x>'], runs: ["a1b2", "", "c1b99"] });
    expect(html).toContain('aria-label="a&quot;b.ts source"');
    expect(html).toContain('<span class="gfp-line-code">a<span class="gfp-c-67e8f9">&lt;b</span>&gt;c</span>');
    expect(html).toContain('<span class="gfp-line-code"> </span>');
    expect(html).toContain('<span class="gfp-line-code">x<span class="gfp-c-67e8f9">yz</span></span>');
    expect(html).not.toContain("<img");
  });
});
