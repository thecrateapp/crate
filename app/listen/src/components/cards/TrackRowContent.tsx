import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { QualityBadge } from "../player/bar/QualityBadge";
import type { QualityBadge as QualityBadgeData } from "../player/bar/player-bar-utils";
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
  tempo,
  musicalKey,
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
  quality?: QualityBadgeData | null;
  tempo?: string | null;
  musicalKey?: string | null;
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
          {explicitLabel ? (
            <InfoBadge className="crate-track-explicit" title={explicitLabel}>
              E
            </InfoBadge>
          ) : null}
        </div>
        {details}
        {meta != null ? (
          <div className="crate-media-meta truncate tabular-nums text-text-muted">
            {meta}
          </div>
        ) : null}
        {provenance ? (
          <span className="crate-track-provenance crate-media-meta">
            {provenance}
          </span>
        ) : null}
      </div>
      <div className="crate-track-metadata">
        <div data-track-slot="quality" className="crate-track-quality-slot">
          {quality ? <QualityBadge badge={quality} /> : null}
        </div>
        <div data-track-slot="analysis" className="crate-track-analysis-slot">
          {tempo || musicalKey ? (
            <span className="crate-track-analysis">
              <span className="crate-track-bpm">{tempo}</span>
              <span aria-hidden="true">{tempo && musicalKey ? "·" : null}</span>
              <span className="crate-track-key">{musicalKey}</span>
            </span>
          ) : null}
        </div>
        <span
          data-track-slot="duration"
          className="crate-track-duration font-mono tabular-nums"
        >
          {duration}
        </span>
        <div data-track-slot="like" className="crate-track-control-slot">
          {like}
        </div>
        <div data-track-slot="actions" className="crate-track-control-slot">
          {actions}
        </div>
      </div>
    </>
  );
}
