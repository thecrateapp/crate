// @vitest-environment node
import type { Element, Root, RootContent } from "hast";
import { VFile } from "vfile";
import { describe, expect, it } from "vitest";
import { blogLinkIcon, blogLinkKind, rehypeBlogLinks } from "./blog-links";

const BLOG_PATH = "/project/app/web/src/content/blog/example.md";

function element(
  tagName: string,
  properties: Element["properties"] = {},
  children: Element["children"] = [],
): Element {
  return { type: "element", tagName, properties, children };
}

function root(...children: RootContent[]): Root {
  return { type: "root", children };
}

function link(href: string, label = "Read the source"): Element {
  return element("a", { href }, [{ type: "text", value: label }]);
}

function apply(tree: Root, path = BLOG_PATH) {
  rehypeBlogLinks()(tree, new VFile({ path }));
}

describe("blog link classification", () => {
  it("recognizes GitHub only by its supported hostnames", () => {
    for (const href of [
      "https://github.com/thecrateapp/crate/blob/abc/file.py#L10",
      "http://www.github.com/thecrateapp/crate",
      "https://gist.github.com/author/example",
      "https://raw.githubusercontent.com/thecrateapp/crate/main/file.py",
      "https://GITHUB.COM/thecrateapp/crate",
      "//github.com/thecrateapp/crate",
    ]) {
      expect(blogLinkKind(href), href).toBe("github");
    }
    for (const href of [
      "https://example.com/docs",
      "http://example.com/docs",
      "https://github.io/project",
      "https://github.com.example.org/source",
      "https://example.com/?source=https://github.com/thecrateapp/crate",
      "https://github.com@example.org/source",
    ]) {
      expect(blogLinkKind(href), href).toBe("external");
    }
  });

  it("leaves same-site, relative, fragment, non-web and invalid links alone", () => {
    for (const href of [
      "https://cratemusic.app/blog/example",
      "//cratemusic.app/blog/example",
      "https://cratemusic.app/blog?ref=https://github.com/#section",
      "/blog/example",
      "../example",
      "example.md",
      "#implementation",
      "?part=2",
      "mailto:reader@example.com",
      "tel:+34123456789",
      "ftp://github.com/file",
      "javascript:void(0)",
      "data:text/plain,example",
      "https://[invalid",
      "not a URL",
      "",
    ]) {
      expect(blogLinkKind(href), href).toBeUndefined();
    }
  });
});

describe("blog link icons", () => {
  it("renders a decorative, nonfocusable 16px SVG for each link kind", () => {
    for (const kind of ["github", "external"] as const) {
      const icon = blogLinkIcon(kind);
      expect(icon.type).toBe("element");
      expect(icon.tagName).toBe("svg");
      expect(Number(icon.properties.width)).toBe(16);
      expect(Number(icon.properties.height)).toBe(16);
      expect(
        String(icon.properties.ariaHidden ?? icon.properties["aria-hidden"]),
      ).toBe("true");
      expect(String(icon.properties.focusable)).toBe("false");
      const viewBox = String(icon.properties.viewBox)
        .split(/[\s,]+/)
        .map(Number);
      expect(viewBox).toHaveLength(4);
      expect(viewBox.every(Number.isFinite)).toBe(true);
      expect(viewBox[2]).toBeGreaterThan(0);
      expect(viewBox[3]).toBeGreaterThan(0);
      expect(icon.children.some((child) => child.type === "element")).toBe(
        true,
      );
      expect(
        icon.properties.tabIndex ?? icon.properties.tabindex,
      ).toBeUndefined();
    }
  });
});

describe("rehypeBlogLinks", () => {
  it("prefixes an icon while preserving the source caption and link attributes", () => {
    const caption: Element["children"] = [
      { type: "text", value: "Source at " },
      element("code", {}, [{ type: "text", value: "211f715c" }]),
      { type: "text", value: ", lines 29–38" },
    ];
    const originalProperties = {
      href: "https://github.com/thecrateapp/crate/blob/211f715c/file.py#L29-L38",
      target: "_blank",
      rel: ["noopener", "noreferrer"],
      className: ["source-caption"],
      ariaLabel: "Read the historical source",
    };
    const anchor = element("a", { ...originalProperties }, [...caption]);
    apply(root(element("p", {}, [anchor])));

    expect(anchor.properties).toMatchObject(originalProperties);
    expect(
      anchor.properties.dataBlogLink ?? anchor.properties["data-blog-link"],
    ).toBe("github");
    expect(anchor.children[0]).toMatchObject({
      type: "element",
      tagName: "svg",
    });
    expect(anchor.children.slice(1)).toEqual(caption);
  });

  it("marks external links once and leaves internal links unchanged", () => {
    const external = link("https://developer.mozilla.org/docs/Web/Media");
    const internal = link("/blog/example#implementation");
    const originalInternal = structuredClone(internal);
    const tree = root(element("p", {}, [external, internal]));
    apply(tree);
    const once = structuredClone(tree);
    apply(tree);

    expect(tree).toEqual(once);
    expect(
      external.properties.dataBlogLink ?? external.properties["data-blog-link"],
    ).toBe("external");
    expect(external.children).toHaveLength(2);
    expect(internal).toEqual(originalInternal);
  });

  it("runs only for Markdown entries in the blog content directory", () => {
    for (const path of [
      "/project/app/web/src/content/developers/example.md",
      "/project/docs/blog/example.md",
      "/project/app/web/src/content/blog/example.json",
      "/project/app/web/src/content/blog/example.ts",
      "/project/app/web/src/pages/blog/example.astro",
    ]) {
      const tree = root(link("https://github.com/thecrateapp/crate"));
      const original = structuredClone(tree);
      apply(tree, path);
      expect(tree, path).toEqual(original);
    }
    const treeWithoutPath = root(link("https://github.com/thecrateapp/crate"));
    const original = structuredClone(treeWithoutPath);
    rehypeBlogLinks()(treeWithoutPath, new VFile());
    expect(treeWithoutPath).toEqual(original);

    const mdxLink = link("https://example.org/docs");
    apply(root(mdxLink), "/project/app/web/src/content/blog/example.mdx");
    expect(
      mdxLink.properties.dataBlogLink ?? mdxLink.properties["data-blog-link"],
    ).toBe("external");
  });

  it("does not decorate linked images or Expressive Code source headers", () => {
    const image = element("img", {
      src: "/blog/example/diagram.svg",
      alt: "The playback request path",
    });
    const linkedImage = element(
      "a",
      { href: "https://example.org/diagram.svg" },
      [image],
    );
    const linkedPicture = element(
      "a",
      { href: "https://example.org/diagram.svg" },
      [element("picture", {}, [structuredClone(image)])],
    );
    const codeHeader = element("div", { className: ["expressive-code"] }, [
      element("figure", {}, [
        element("figcaption", {}, [
          link("https://github.com/thecrateapp/crate"),
        ]),
      ]),
    ]);
    const tree = root(linkedImage, linkedPicture, codeHeader);
    const original = structuredClone(tree);
    apply(tree);
    expect(tree).toEqual(original);
  });
});
