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
