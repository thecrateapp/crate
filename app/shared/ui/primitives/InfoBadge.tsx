import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  memo,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  type ReactElement,
} from "react";
import { CRATE_ICON_SIZE } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export type InfoBadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";
export type InfoBadgeSurface = "default" | "overlay";

export const INFO_BADGE_CLASS =
  "crate-info-badge inline-flex min-w-0 max-w-full shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border font-mono font-normal text-info-badge whitespace-nowrap [&>button]:shrink-0 [&>a]:shrink-0 [&>svg]:shrink-0";
export const BADGE_TONE_CLASS: Record<InfoBadgeTone, string> = {
  neutral: "border-border-quiet bg-transparent text-text-secondary",
  info: "border-state-info/25 bg-state-info/10 text-state-info",
  success:
    "border-state-success/25 bg-state-success/10 text-state-success-text",
  warning:
    "border-state-warning/25 bg-state-warning/10 text-state-warning-text",
  danger: "border-state-danger/25 bg-state-danger/10 text-state-danger-text",
  accent:
    "border-accent-action-hi/40 bg-accent-action/10 text-accent-action-hi",
};

const ICON_TONE_CLASS: Record<InfoBadgeTone, string> = {
  neutral: "text-text-secondary",
  info: "text-state-info",
  success: "text-state-success-text",
  warning: "text-state-warning-text",
  danger: "text-state-danger-text",
  accent: "text-accent-action-hi",
};

/** Read text from children without invoking components or including action/icon labels. */
export function infoBadgeText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (
        typeof child === "string" ||
        typeof child === "number" ||
        typeof child === "bigint"
      )
        return String(child);
      if (
        isValidElement<{ children?: ReactNode }>(child) &&
        child.type !== "button" &&
        child.type !== "svg"
      )
        return infoBadgeText(child.props.children);
      return "";
    })
    .join("");
}

/** Text can shrink; native controls keep their own space and event handlers. */
export function infoBadgeContent(
  children: ReactNode,
  containText = false,
): ReactNode {
  const groups: ReactNode[] = [];
  let text = "";
  const flush = () => {
    if (text) {
      groups.push(text);
      text = "";
    }
  };
  for (const child of Children.toArray(children)) {
    if (
      typeof child === "string" ||
      typeof child === "number" ||
      typeof child === "bigint"
    )
      text += String(child);
    else {
      flush();
      groups.push(child);
    }
  }
  flush();
  const wrap = containText || groups.some(isValidElement);
  return groups.map((child, index) => {
    if (typeof child === "string")
      return wrap ? (
        <span key={index} className="min-w-0 truncate">
          {child}
        </span>
      ) : (
        child
      );
    if (isValidElement<{ children?: ReactNode; className?: string }>(child)) {
      if (child.type === Fragment)
        return (
          <Fragment key={child.key ?? index}>
            {infoBadgeContent(child.props.children, true)}
          </Fragment>
        );
      if (
        typeof child.type === "string" &&
        ["span", "strong", "em", "code", "small"].includes(child.type)
      )
        return cloneElement(child as ReactElement<{ className?: string }>, {
          className: cn("min-w-0 truncate", child.props.className),
        });
    }
    return child;
  });
}

export interface InfoBadgeProps extends ComponentProps<"span"> {
  icon?: ComponentType<{ size: number; className?: string }>;
  tone?: InfoBadgeTone;
  /** Visual emphasis only; static information never becomes a toggle. */
  active?: boolean;
  surface?: InfoBadgeSurface;
  variant?: "label" | "counter";
  iconClassName?: string;
}

/** Metadata, state and inline counters; one 24px recipe in both apps. */
export const InfoBadge = memo(function InfoBadge({
  children,
  icon: Icon,
  tone = "neutral",
  active = false,
  surface = "default",
  variant = "label",
  className,
  iconClassName,
  title,
  ...props
}: InfoBadgeProps) {
  return (
    <span
      {...props}
      title={title ?? (infoBadgeText(children) || undefined)}
      data-slot="info-badge"
      data-variant={variant}
      data-tone={tone}
      data-surface={surface}
      className={cn(
        INFO_BADGE_CLASS,
        active
          ? "border-[var(--chip-active-border)] bg-[var(--chip-active-bg)] text-[var(--active-text)]"
          : BADGE_TONE_CLASS[tone],
        className,
      )}
    >
      {Icon ? (
        <Icon
          size={CRATE_ICON_SIZE.micro}
          className={cn(
            "shrink-0",
            active ? "text-current" : ICON_TONE_CLASS[tone],
            iconClassName,
          )}
          aria-hidden="true"
        />
      ) : null}
      {infoBadgeContent(children, Boolean(Icon))}
    </span>
  );
});
