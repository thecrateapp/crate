import { Link } from "react-router";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock } from "@/components/CodeBlock";
import { resolveDocHref } from "@/content";
import {
  calloutLabels,
  remarkCallouts,
  type CalloutKind,
} from "@/lib/callouts";
import { slugify } from "@/lib/utils";

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function isExternalHref(href: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href);
}

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function codeLanguage(node: HastNode | undefined): string | undefined {
  const className = node?.properties?.className;
  const classes = Array.isArray(className) ? className : [];
  const language = classes.find(
    (value): value is string =>
      typeof value === "string" && value.startsWith("language-"),
  );
  return language?.slice("language-".length);
}

export function MarkdownArticle({
  markdown,
  sourcePath,
}: {
  markdown: string;
  sourcePath: string;
}) {
  const seenHeadingIds = new Map<string, number>();

  function headingId(node: HastNode | undefined): string {
    const baseId = slugify(textOf(node).trim());
    const duplicate = seenHeadingIds.get(baseId) ?? 0;
    seenHeadingIds.set(baseId, duplicate + 1);
    return duplicate === 0 ? baseId : `${baseId}-${duplicate + 1}`;
  }

  function renderHeading(
    level: 2 | 3 | 4,
    node: HastNode | undefined,
    children: ReactNode,
  ) {
    const id = headingId(node);
    const anchor = (
      <a className="heading-anchor" href={`#${id}`}>
        {children}
      </a>
    );
    if (level === 2) return <h2 id={id}>{anchor}</h2>;
    if (level === 3) return <h3 id={id}>{anchor}</h3>;
    return <h4 id={id}>{anchor}</h4>;
  }

  return (
    <div className="docs-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCallouts]}
        components={{
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ node, children }) =>
            renderHeading(2, node as HastNode | undefined, children),
          h3: ({ node, children }) =>
            renderHeading(3, node as HastNode | undefined, children),
          h4: ({ node, children }) =>
            renderHeading(4, node as HastNode | undefined, children),
          a: ({ href = "", children }) => {
            const resolvedHref = resolveDocHref(sourcePath, href);
            if (resolvedHref.startsWith("/")) {
              return <Link to={resolvedHref}>{children}</Link>;
            }
            return (
              <a
                href={resolvedHref}
                target={isExternalHref(resolvedHref) ? "_blank" : undefined}
                rel={isExternalHref(resolvedHref) ? "noreferrer" : undefined}
              >
                {children}
              </a>
            );
          },
          pre: ({ node }) => {
            const code = (node as HastNode | undefined)?.children?.find(
              (child) => child.tagName === "code",
            );
            return (
              <CodeBlock
                code={textOf(code).replace(/\n$/, "")}
                language={codeLanguage(code)}
              />
            );
          },
          table: ({ children }) => (
            <div className="table-wrap" tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
          blockquote: ({ children, ...props }) => {
            const kind = (props as Record<string, unknown>)["data-callout"] as
              | CalloutKind
              | undefined;
            if (!kind) return <blockquote>{children}</blockquote>;
            return (
              <aside className="callout" data-kind={kind}>
                <p className="callout-label">{calloutLabels[kind]}</p>
                {children}
              </aside>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
