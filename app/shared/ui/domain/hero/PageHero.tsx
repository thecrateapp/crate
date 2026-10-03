import { Fragment, useId, type ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

export type PageHeroVariant = "media" | "artist" | "editorial" | "card";
export type PageHeroBackgroundTreatment = "muted" | "blur" | "vivid";
export type PageHeroBackgroundGradient = "default" | "strong";
export type PageHeroMetaSeparator = "none" | "dot" | "slash";

export interface PageHeroBackground {
  src?: string | null;
  render?: (className: string) => ReactNode;
  treatment?: PageHeroBackgroundTreatment;
  gradient?: PageHeroBackgroundGradient;
  overlay?: ReactNode;
}

export interface PageHeroProps {
  variant?: PageHeroVariant;
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode[];
  metaSeparator?: PageHeroMetaSeparator;
  artwork?: ReactNode;
  background?: PageHeroBackground;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
  contentClassName?: string;
  artworkClassName?: string;
  titleClassName?: string;
  actionsClassName?: string;
}

const ROOT_CLASS_NAME: Record<PageHeroVariant, string> = {
  media: "relative h-[420px] overflow-hidden lg:h-[460px]",
  artist: "relative h-[420px] overflow-hidden sm:h-[400px]",
  editorial: "relative h-[420px] overflow-hidden sm:h-[400px]",
  card: "relative overflow-hidden rounded-xl p-5 sm:p-6",
};

const TREATMENT_CLASS_NAME: Record<PageHeroBackgroundTreatment, string> = {
  muted:
    "scale-[1.02] object-cover brightness-[0.72] contrast-110 opacity-[0.82] sm:grayscale sm:brightness-[0.5] sm:opacity-[0.45]",
  blur: "scale-125 object-cover opacity-90 blur-2xl brightness-[0.8] saturate-150 sm:opacity-80 sm:brightness-[0.6]",
  vivid:
    "scale-[1.02] object-cover brightness-[0.66] contrast-110 opacity-[0.68] saturate-125",
};

const ARTWORK_CLASS_NAME: Record<PageHeroVariant, string> = {
  media:
    "hidden aspect-square w-[200px] shrink-0 overflow-hidden rounded-xl bg-text-primary/5 shadow-2xl ring-1 ring-text-primary/10 sm:block lg:w-[240px]",
  artist:
    "hidden size-40 shrink-0 overflow-hidden rounded-full bg-text-primary/5 shadow-2xl ring-2 ring-text-primary/10 sm:block",
  editorial: "hidden",
  card: "size-20 shrink-0 overflow-hidden rounded-full bg-text-primary/5",
};

const TITLE_CLASS_NAME: Record<PageHeroVariant, string> = {
  media: "text-3xl font-bold text-text-primary sm:text-4xl",
  artist: "text-3xl font-bold text-text-primary sm:text-4xl",
  editorial:
    "text-4xl font-black leading-none tracking-tight text-text-primary sm:text-6xl",
  card: "text-3xl font-bold leading-tight text-text-primary",
};

const META_CLASS_NAME: Record<PageHeroVariant, string> = {
  media:
    "mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted",
  artist:
    "mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted",
  editorial:
    "mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-text-primary/56",
  card: "mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted",
};

const SEPARATOR_GLYPH: Record<
  Exclude<PageHeroMetaSeparator, "none">,
  string
> = {
  dot: "·",
  slash: "/",
};

function HeroBackground({ background }: { background: PageHeroBackground }) {
  const {
    src,
    render,
    treatment = "muted",
    gradient = "default",
    overlay,
  } = background;
  const imageClassName = cn(
    "absolute inset-0 size-full",
    TREATMENT_CLASS_NAME[treatment],
  );

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      data-testid="page-hero-background"
      data-treatment={treatment}
    >
      {render ? (
        render(imageClassName)
      ) : src ? (
        <img src={src} alt="" className={imageClassName} />
      ) : null}
      {overlay ?? (
        <>
          <div className="absolute inset-0 bg-surface-canvas/10 sm:bg-surface-canvas/32" />
          <div
            className="absolute inset-0 sm:hidden"
            style={{ background: "var(--hero-artwork-gradient-mobile)" }}
          />
          <div
            className="absolute inset-0 hidden sm:block"
            style={{
              background:
                gradient === "strong"
                  ? "var(--hero-artwork-gradient-desktop-strong)"
                  : "var(--hero-artwork-gradient-desktop)",
            }}
          />
        </>
      )}
    </div>
  );
}

function HeroMeta({
  items,
  separator,
  className,
}: {
  items: ReactNode[];
  separator: PageHeroMetaSeparator;
  className: string;
}) {
  const visible = items.filter(
    (item) =>
      item !== null && item !== undefined && item !== false && item !== "",
  );
  if (visible.length === 0) return null;

  return (
    <div className={className} data-testid="page-hero-meta">
      {visible.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && separator !== "none" ? (
            <span aria-hidden="true" className="text-text-primary/20">
              {SEPARATOR_GLYPH[separator]}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">{item}</span>
        </Fragment>
      ))}
    </div>
  );
}

export function PageHero({
  variant = "media",
  title,
  eyebrow,
  subtitle,
  description,
  meta,
  metaSeparator,
  artwork,
  background,
  actions,
  children,
  id,
  className,
  contentClassName,
  artworkClassName,
  titleClassName,
  actionsClassName,
}: PageHeroProps) {
  const generatedId = useId();
  const titleId = id ?? `${generatedId}-title`;
  const isCard = variant === "card";
  const separator =
    metaSeparator ??
    (variant === "editorial" ? "slash" : isCard ? "dot" : "none");

  const info = (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-end text-left",
        isCard ? "flex-1" : "max-w-3xl pb-1",
      )}
    >
      {eyebrow ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">{eyebrow}</div>
      ) : null}
      <h1
        id={titleId}
        className={cn("break-words", TITLE_CLASS_NAME[variant], titleClassName)}
      >
        {title}
      </h1>
      {subtitle ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
          {subtitle}
        </div>
      ) : null}
      {meta && meta.length > 0 ? (
        <HeroMeta
          items={meta}
          separator={separator}
          className={META_CLASS_NAME[variant]}
        />
      ) : null}
      {description ? (
        <div
          className={cn(
            "max-w-2xl whitespace-pre-line text-sm text-text-primary/70",
            variant === "editorial"
              ? "mt-4 leading-6 sm:text-base sm:leading-7"
              : "mt-3 line-clamp-3 leading-relaxed",
          )}
        >
          {description}
        </div>
      ) : null}
      {children}
    </div>
  );

  const artworkNode =
    artwork && variant !== "editorial" ? (
      <div
        className={cn(ARTWORK_CLASS_NAME[variant], artworkClassName)}
        data-testid="page-hero-artwork"
      >
        {artwork}
      </div>
    ) : null;

  if (isCard) {
    return (
      <section
        aria-labelledby={titleId}
        className={cn(ROOT_CLASS_NAME.card, className)}
        data-testid="page-hero"
        data-variant={variant}
      >
        {background ? <HeroBackground background={background} /> : null}
        <div
          className={cn(
            "relative flex flex-col gap-5 sm:flex-row sm:items-start",
            contentClassName,
          )}
        >
          {artworkNode}
          {info}
        </div>
        {actions ? (
          <div
            className={cn(
              "relative mt-5 flex flex-wrap items-center gap-2",
              actionsClassName,
            )}
          >
            {actions}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <div data-testid="page-hero" data-variant={variant}>
      <section
        aria-labelledby={titleId}
        className={cn(ROOT_CLASS_NAME[variant], className)}
      >
        {background ? <HeroBackground background={background} /> : null}
        <div
          className={cn(
            "relative mx-auto flex size-full max-w-[1480px] items-end px-4 pb-6 pt-[var(--listen-mobile-page-top,0px)] sm:px-6 sm:pt-0",
            contentClassName,
          )}
        >
          <div className="flex w-full flex-col gap-5 sm:flex-row sm:items-end">
            {artworkNode}
            {info}
          </div>
        </div>
      </section>
      {actions ? (
        <div className={cn("relative z-10 p-4 sm:px-6", actionsClassName)}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
