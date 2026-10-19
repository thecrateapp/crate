import type { ReactNode } from "react";
import { PageHeaderLayout } from "@/components/layout/PageHeader";

import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

type OpsTone = "default" | "primary" | "success" | "warning" | "danger";

function valueToneClass(tone: OpsTone) {
  switch (tone) {
    case "success":
      return "text-accent-action-hi";
    case "warning":
    case "danger":
      return "text-state-warning-text";
    default:
      return "text-text-primary";
  }
}

export function OpsPageHero({
  title,
  description,
  actions,
  children,
  className,
  compactActions = false,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  compactActions?: boolean;
}) {
  const identity = (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-[clamp(2.25rem,4vw,3.75rem)] font-extrabold leading-display tracking-[-0.045em] text-balance text-text-primary">
          {title}
        </h1>
        <p className="text-sm text-white/55">{description}</p>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
  return (
    <section
      className={cn(
        "rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl",
        className,
      )}
    >
      {compactActions ? (
        <PageHeaderLayout actions={actions}>{identity}</PageHeaderLayout>
      ) : (
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          {identity}
          {actions ? (
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              {actions}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function OpsStatTile({
  label,
  value,
  caption,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: OpsTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "@container rounded-md border border-white/8 bg-black/20 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]",
        className,
      )}
    >
      <div className="crate-form-field">
        <MonoLabel as="div">{label}</MonoLabel>
        <div
          className={cn(
            "font-display text-numeral-md font-bold leading-none tabular-nums",
            valueToneClass(tone),
          )}
        >
          {value}
        </div>
      </div>
      {caption ? (
        <div className="mt-1 text-xs text-white/40">{caption}</div>
      ) : null}
    </div>
  );
}

export function OpsPanel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-md border border-white/10 bg-panel-surface/90 shadow-[0_24px_60px_rgba(0,0,0,0.2)] backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 md:flex-row md:items-start md:justify-between md:px-5">
        <div className="space-y-1">
          <h2 className="font-display text-[clamp(1.25rem,1.7vw,1.6rem)] font-bold leading-[1.1] tracking-tight text-text-primary">
            {title}
          </h2>
          {description ? (
            <p className="max-w-3xl text-sm text-white/45">{description}</p>
          ) : null}
        </div>
        {action ? (
          <div className="flex flex-wrap items-center gap-2">{action}</div>
        ) : null}
      </div>
      <div className="px-4 py-4 md:px-5 md:py-5">{children}</div>
    </section>
  );
}
