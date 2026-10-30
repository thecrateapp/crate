// @vitest-environment node
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import Base from "./Base.astro";

describe("Base layout", () => {
  it("renders the head slot inside <head>", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Base, {
      props: { title: "T", description: "D" },
      slots: {
        head: '<meta name="robots" content="noindex" />',
        default: "<p>body</p>",
      },
    });
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));

    expect(head).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain("<p>body</p>");
  });
});

describe("Base backdrop", () => {
  it("dims the record shop by default and shows it in full when a page asks", async () => {
    const container = await AstroContainer.create();
    const props = { title: "T", description: "D" };

    const dim = await container.renderToString(Base, { props });
    const full = await container.renderToString(Base, {
      props: { ...props, backdrop: "full" },
    });

    expect(dim).toMatch(/class="backdrop is-dim/);
    expect(full).toMatch(/class="backdrop is-full/);
    expect(full).toContain('media="(max-aspect-ratio: 3/4)"');
    expect(full).toContain("/backdrop/shop-1920.jpg");
  });
});
