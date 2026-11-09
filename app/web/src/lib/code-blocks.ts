import type { ExpressiveCodePlugin } from "astro-expressive-code";
import { h, select } from "astro-expressive-code/hast";
import { codeSource, type CodeSource } from "./code-source";
import { blogLinkIcon } from "./blog-links";

const sources = new WeakMap<object, CodeSource>();

export function crateSourceLinks(): ExpressiveCodePlugin {
  return {
    name: "crate-source-links",
    baseStyles: `
      pre,
      code {
        font-variant-ligatures: none;
      }
      .source-link {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        margin-inline-start: auto;
        padding-inline: 1rem;
        align-self: center;
        color: #67e8f9;
        text-decoration: none;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .source-link svg { flex: none; }
      .source-link:hover,
      .source-link:focus-visible {
        text-decoration: underline;
        text-underline-offset: 3px;
      }
    `,
    hooks: {
      preprocessMetadata: ({ codeBlock }) => {
        const source = codeBlock.metaOptions.getString("source");
        if (!source) return;
        const resolved = codeSource(
          source,
          codeBlock.metaOptions.getString("commit"),
        );
        sources.set(codeBlock, resolved);
        const props = codeBlock.props as Record<string, unknown>;
        props.title ||= resolved.path;
        if (resolved.startLine !== undefined) {
          props.showLineNumbers = true;
          props.startLineNumber = resolved.startLine;
        }
      },
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const source = sources.get(codeBlock);
        if (!source) return;
        const header = select("figcaption", renderData.blockAst);
        if (!header) return;
        const text = source.label ? `GitHub · ${source.label}` : "GitHub";
        header.children.push(
          h(
            "a",
            {
              className: ["source-link"],
              "data-blog-link": "github",
              href: source.url,
              "aria-label":
                `View ${source.path} ${source.label} on GitHub`.trim(),
            },
            [blogLinkIcon("github"), text],
          ),
        );
      },
    },
  };
}
