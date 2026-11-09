import { codeToTokens, bundledLanguages, type BundledLanguage, type ThemedToken, type ThemeRegistration } from "shiki";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { Element, Root, RootContent } from "hast";
import theme from "./code-theme.json";
import { TOKEN_STYLE_LETTERS } from "./github-preview";
import { tokenClass } from "./github-preview-theme";

const languageByExtension: Record<string, string> = {
  py: "python", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", md: "markdown", mdx: "markdown",
  yml: "yaml", yaml: "yaml", json: "json", toml: "toml", sh: "bash", bash: "bash", css: "css",
  scss: "scss", html: "html", astro: "astro", sql: "sql", xml: "xml", svg: "xml", txt: "text",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", dockerfile: "dockerfile", makefile: "makefile",
};
/**
 * Shiki stops a line after 500 ms by default and colours the remainder with the
 * scope it had reached. On a loaded build machine that silently bakes wrong
 * colours (a whole line as a keyword), so builds allow far longer per line.
 */
export const TOKENIZE_TIME_LIMIT_MS = 10_000;

function languageForPath(path: string): string {
  const name = path.split("/").pop()!.toLowerCase();
  const extension = name.includes(".") ? name.split(".").pop()! : name;
  return languageByExtension[extension] ?? "text";
}

function safeHref(value: string, githubUrl: string): string | undefined {
  try {
    // URL resolves relative docs against the exact commit's file directory.
    const url = new URL(value, githubUrl);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

/** Only generated Markdown nodes reach HTML. Raw HTML is deliberately disabled. */
function prepareMarkdown(githubUrl: string) {
  return () => (tree: Root) => {
    const headings = new Map<string, number>();
    function textOf(node: RootContent): string {
      return node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "";
    }
    function visit(node: Root | Element) {
      node.children = node.children.filter((child) => child.type !== "raw");
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.position) {
          child.properties["data-source-start"] = child.position.start.line;
          child.properties["data-source-end"] = child.position.end.line;
        }
        if (/^h[1-6]$/.test(child.tagName)) {
          const slug = textOf(child).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/ /g, "-");
          const count = headings.get(slug) ?? 0;
          headings.set(slug, count + 1);
          child.properties["data-source-heading"] = count ? `${slug}-${count}` : slug;
        }
        if (child.tagName === "a") {
          const href = safeHref(String(child.properties.href ?? ""), githubUrl);
          if (href) { child.properties.href = href; child.properties.rel = ["noopener", "noreferrer"]; }
          else { child.tagName = "span"; delete child.properties.href; }
        }
        if (child.tagName === "img") {
          // Keep docs self-contained. Images stay explicit links instead of making
          // cross-origin requests merely because somebody opened a source file.
          const href = safeHref(String(child.properties.src ?? ""), githubUrl);
          const label = String(child.properties.alt || "Referenced image");
          child.tagName = href ? "a" : "span";
          child.properties = href ? { href, rel: ["noopener", "noreferrer"] } : {};
          child.children = [{ type: "text", value: label }];
        }
        // The generated GFM checkbox is display-only. No arbitrary attributes or
        // event handlers are imported from the document's literal HTML.
        if (child.tagName === "input") child.properties.disabled = true;
        visit(child);
      }
    }
    visit(tree);
  };
}

/**
 * Compact highlighting (decoded by `sourceCodeHtml`): `styles` lists class
 * names, index 0 being plain text, and each `runs` entry encodes one source
 * line as `<letter><length>` runs. The letter indexes `styles`; the length
 * counts UTF-16 code units. The last run has no length and extends to the end
 * of the line; trailing plain text is omitted, so an unhighlighted line is "".
 * The source text itself is stored once, in the snapshot's `source`.
 */
function encodeRuns(lines: ThemedToken[][]): { styles: string[]; runs: string[] } {
  const styles = [""];
  const indexes = new Map([["", 0]]);
  const runs = lines.map((line) => {
    const merged: [style: number, length: number][] = [];
    for (const token of line) {
      const name = tokenClass(token.color, Math.max(0, token.fontStyle ?? 0));
      let style = indexes.get(name);
      if (style === undefined) {
        style = styles.push(name) - 1;
        if (style >= TOKEN_STYLE_LETTERS.length) throw new Error("Too many distinct token styles for one source file.");
        indexes.set(name, style);
      }
      const previous = merged.at(-1);
      if (previous?.[0] === style) previous[1] += token.content.length;
      else merged.push([style, token.content.length]);
    }
    return merged.map(([style, length], index) => index < merged.length - 1
      ? `${TOKEN_STYLE_LETTERS[style]}${length}`
      : style ? TOKEN_STYLE_LETTERS[style] : "").join("");
  });
  return { styles, runs };
}

export async function renderPreviewSource(source: string, path: string, githubUrl: string): Promise<{
  language: string; styles: string[]; runs: string[]; markdownHtml?: string;
}> {
  const language = languageForPath(path);
  const lang = language in bundledLanguages ? language as BundledLanguage : "text";
  // A final newline terminates the last source line; it does not create an extra one.
  const displaySource = source.replace(/\r?\n$/, "");
  const highlighted = await codeToTokens(displaySource, { lang, theme: theme as ThemeRegistration, tokenizeTimeLimit: TOKENIZE_TIME_LIMIT_MS });
  const { styles, runs } = encodeRuns(source === "" ? [] : highlighted.tokens);
  if (!/\.mdx?$/i.test(path)) return { language, styles, runs };
  const markdown = await unified().use(remarkParse).use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(prepareMarkdown(githubUrl)).use(rehypeStringify).process(source);
  return { language, styles, runs, markdownHtml: String(markdown) };
}
