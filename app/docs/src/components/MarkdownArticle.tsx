import { Link } from "react-router";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { resolveDocHref } from "@/content";
import { slugify } from "@/lib/utils";

function isExternalHref(href: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href);
}

export function MarkdownArticle({
  markdown,
  sourcePath,
}: {
  markdown: string;
  sourcePath: string;
}) {
  const seenHeadingIds = new Map<string, number>();

  function headingId(children: ReactNode): string {
    const baseId = slugify(String(children).replace(/,/g, ""));
    const duplicate = seenHeadingIds.get(baseId) ?? 0;
    seenHeadingIds.set(baseId, duplicate + 1);
    return duplicate === 0 ? baseId : `${baseId}-${duplicate + 1}`;
  }

  function renderHeading(level: 2 | 3 | 4, children: ReactNode) {
    const id = headingId(children);
    if (level === 2) return <h2 id={id}>{children}</h2>;
    if (level === 3) return <h3 id={id}>{children}</h3>;
    return <h4 id={id}>{children}</h4>;
  }

  return (
    <div className="docs-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => renderHeading(2, children),
          h3: ({ children }) => renderHeading(3, children),
          h4: ({ children }) => renderHeading(4, children),
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
          code: ({ className, children }) => {
            if (className) return <code className={className}>{children}</code>;
            return <code>{children}</code>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
