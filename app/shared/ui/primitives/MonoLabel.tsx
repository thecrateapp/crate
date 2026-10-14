import { Fragment, type ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

type MonoLabelElement = "p" | "span" | "div" | "h2" | "h3";

interface MonoLabelProps {
  as?: MonoLabelElement;
  accent?: ReactNode;
  meta?: readonly (string | null | undefined | false)[];
  children?: ReactNode;
  className?: string;
}

export function MonoLabel({
  as: Element = "p",
  accent,
  meta,
  children,
  className,
}: MonoLabelProps) {
  const parts = (meta ?? []).filter((part): part is string => Boolean(part));

  return (
    <Element
      className={cn(
        "m-0 font-mono text-label font-normal uppercase tracking-caps text-text-subtle tabular-nums",
        className,
      )}
    >
      {accent ? (
        <span className="mr-2 text-accent-action-hi">{accent} </span>
      ) : null}
      {parts.map((part, index) => (
        <Fragment key={`${index}:${part}`}>
          {index > 0 ? (
            <>
              {" "}
              <span aria-hidden="true" className="px-1">
                ·
              </span>{" "}
            </>
          ) : null}
          <span>{part}</span>
        </Fragment>
      ))}
      {children}
    </Element>
  );
}
