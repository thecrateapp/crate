import { Fragment, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

type MonoLabelElement =
  | "p"
  | "span"
  | "div"
  | "h2"
  | "h3"
  | "dt"
  | "figcaption"
  | "legend";

interface MonoLabelProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  as?: MonoLabelElement;
  size?: "label" | "eyebrow";
  accent?: ReactNode;
  meta?: readonly (string | null | undefined | false)[];
  children?: ReactNode;
  className?: string;
}

export function MonoLabel({
  as: Element = "p",
  size = "label",
  accent,
  meta,
  children,
  className,
  ...props
}: MonoLabelProps) {
  const parts = (meta ?? []).filter((part): part is string => Boolean(part));

  return (
    <Element
      {...props}
      className={cn(
        "m-0 font-mono font-normal uppercase text-text-subtle tabular-nums",
        size === "eyebrow"
          ? "text-eyebrow tracking-kicker"
          : "text-label tracking-caps",
        className,
      )}
    >
      {accent ? (
        <span className="mr-2.5 text-accent-action-hi">{accent} </span>
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
