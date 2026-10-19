import {
  Children,
  cloneElement,
  type HTMLAttributes,
  type LiHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "@crate/ui/lib/cn";

interface HairlineListProps
  extends Omit<
    HTMLAttributes<HTMLOListElement | HTMLUListElement>,
    "children"
  > {
  as?: "ol" | "ul";
  label?: string;
  ruled?: boolean;
  children: ReactNode;
}

export function HairlineList({
  as: Element = "ol",
  label,
  ruled = true,
  children,
  className,
  ...props
}: HairlineListProps) {
  return (
    <Element
      aria-label={label}
      {...props}
      className={cn(
        "m-0 list-none p-0",
        ruled && "border-t border-border-quiet",
        className,
      )}
    >
      {children}
    </Element>
  );
}

interface HairlineRowProps
  extends Omit<LiHTMLAttributes<HTMLLIElement>, "children"> {
  index?: number;
  trailing?: ReactNode;
  muted?: boolean;
  active?: boolean;
  truncate?: boolean;
  asChild?: boolean;
  children: ReactNode;
}

export function formatRowIndex(index: number): string {
  return String(index).padStart(2, "0");
}

export function HairlineRow({
  index,
  trailing,
  muted = false,
  active = false,
  truncate = true,
  asChild = false,
  children,
  className,
  ...props
}: HairlineRowProps) {
  const child = asChild
    ? (Children.only(children) as ReactElement<{
        children?: ReactNode;
        className?: string;
      }>)
    : null;
  const Content = truncate || child?.type === "button" ? "span" : "div";
  const content = (
    <>
      {index != null ? (
        <span className="w-[3ch] shrink-0 font-mono text-label text-text-subtle tabular-nums">
          {formatRowIndex(index)}
        </span>
      ) : null}
      {index != null ? " " : null}
      <Content
        className={cn(
          "min-w-0 flex-1",
          truncate ? "truncate" : "wrap-anywhere",
          muted ? "text-text-subtle" : "text-text-primary",
        )}
      >
        {child ? child.props.children : children}
      </Content>
      {trailing != null && trailing !== false ? (
        <>
          {" "}
          <span className="shrink-0">{trailing}</span>
        </>
      ) : null}
    </>
  );
  const layout =
    "flex min-h-8 items-baseline gap-3.5 px-3 py-2.5 text-left font-[family-name:var(--font-brand)] text-xs font-normal leading-normal [@media(pointer:coarse)]:min-h-11";

  return (
    <li
      {...props}
      data-slot="hairline-row"
      data-muted={muted || undefined}
      data-active={active || undefined}
      className={cn(
        "relative border-b border-border-quiet-subtle ",
        active && "bg-linear-to-r from-accent-action/8 to-transparent",
        !asChild && layout,
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-slot="active-bar"
        className={cn(
          "crate-hairline-active-bar pointer-events-none absolute inset-y-0 left-0 w-0.5 origin-center bg-accent-action-hi transition-transform duration-250 ease-snap motion-reduce:transition-none",
          active ? "scale-y-100" : "scale-y-0",
        )}
      />
      {child
        ? cloneElement(child, {
            className: cn(layout, "w-full", child.props.className),
            children: content,
          })
        : content}
    </li>
  );
}
