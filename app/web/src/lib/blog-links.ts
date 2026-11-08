import type { Element, Root } from "hast";
import type { VFile } from "vfile";
import { blogIconPaths } from "./blog-icons";

type BlogLinkKind = "github" | "external";
const SITE = "https://cratemusic.app";
const GITHUB_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "gist.github.com",
  "raw.githubusercontent.com",
]);

export function blogLinkKind(href: string): BlogLinkKind | undefined {
  let url: URL;
  try {
    url = new URL(href, SITE);
  } catch {
    return undefined;
  }
  if (!["https:", "http:"].includes(url.protocol) || url.origin === SITE)
    return undefined;
  return GITHUB_HOSTS.has(url.hostname) ? "github" : "external";
}

export function blogLinkIcon(kind: BlogLinkKind): Element {
  const name = kind === "github" ? "github" : "external-link";
  return {
    type: "element",
    tagName: "svg",
    properties: {
      viewBox: "0 0 24 24",
      width: 16,
      height: 16,
      fill: "currentColor",
      ariaHidden: "true",
      focusable: "false",
      "data-blog-icon": name,
    },
    children: blogIconPaths[name].map((d) => ({
      type: "element",
      tagName: "path",
      properties: { d, fillRule: "evenodd", clipRule: "evenodd" },
      children: [],
    })),
  };
}

function hasMedia(element: Element): boolean {
  return element.children.some(
    (child) =>
      child.type === "element" &&
      (["img", "picture", "video"].includes(child.tagName) || hasMedia(child)),
  );
}

/** Decorate authored blog links at build time, including future articles. */
export function rehypeBlogLinks() {
  return (tree: Root, file: VFile) => {
    if (
      !/(?:^|[/\\])src[/\\]content[/\\]blog[/\\].+\.mdx?$/i.test(
        file.path ?? "",
      )
    )
      return;
    function visit(node: Root | Element) {
      if (node.type === "element") {
        const classes = node.properties.className;
        if (
          String(classes ?? "")
            .split(/[\s,]+/)
            .includes("expressive-code")
        )
          return;
        if (node.tagName === "a") {
          const kind = blogLinkKind(String(node.properties.href ?? ""));
          if (kind && !node.properties["data-blog-link"] && !hasMedia(node)) {
            node.properties["data-blog-link"] = kind;
            node.children.unshift(blogLinkIcon(kind));
          }
          return;
        }
      }
      for (const child of node.children) {
        if (child.type === "element") visit(child);
      }
    }
    visit(tree);
  };
}
