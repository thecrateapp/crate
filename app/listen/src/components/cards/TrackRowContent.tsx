import type { ReactNode } from "react";

// The real row's visual composition, separate from playback, selection and menu controllers.
export function TrackRowContent({
  rank,
  leading,
  title,
  titleAccessory,
  details,
  meta,
  explicitLabel,
  quality,
  analysis,
  provenance,
  duration,
  like,
  actions,
}: {
  rank?: number;
  leading: ReactNode;
  title: string;
  titleAccessory?: ReactNode;
  details?: ReactNode;
  meta?: ReactNode;
  explicitLabel?: string;
  quality?: string | null;
  analysis?: string | null;
  provenance?: ReactNode;
  duration?: string;
  like?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <>
      {rank != null ? (
        <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-text-muted">
          {rank}
        </span>
      ) : null}
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-[var(--content-row-inline-gap)]">
          <div className="crate-track-title min-w-0 truncate text-sm font-medium text-text-primary">
            {title}
          </div>
          {titleAccessory}
        </div>
        {details}
        {meta != null ? (
          <div className="crate-media-meta truncate tabular-nums text-text-muted">
            {meta}
          </div>
        ) : null}
      </div>
      {explicitLabel ? (
        <span
          className="crate-track-quality crate-track-explicit"
          title={explicitLabel}
        >
          E
        </span>
      ) : null}
      {quality ? <span className="crate-track-quality">{quality}</span> : null}
      {analysis ? (
        <span className="crate-track-analysis">{analysis}</span>
      ) : null}
      {provenance ? (
        <span className="crate-track-provenance crate-media-meta">
          {provenance}
        </span>
      ) : null}
      {duration ? (
        <span className="text-text-muted shrink-0 font-mono text-xs tabular-nums">
          {duration}
        </span>
      ) : null}
      {like}
      {actions}
    </>
  );
}
