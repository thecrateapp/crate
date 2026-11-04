import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";

import { useApi } from "@/hooks/use-api";

export type SmartMixPhraseKind =
  "intro" | "build" | "peak" | "break" | "outro" | "body";

export interface SmartMixPhrase {
  startBeat: number;
  startMs: number;
  endMs: number;
  bars: number;
  energy: number;
  deltaEnergy: number | null;
  kind: SmartMixPhraseKind;
  vocalPresence: number | null;
}

export interface SmartMixTrackStructureData {
  trackId: number;
  analyzerVersion: string;
  profileVersion: number;
  durationMs: number;
  structureConfidence: number | null;
  /** Null before the structure existed; empty when the track was not segmented. */
  phrases: SmartMixPhrase[] | null;
  energyCurve: number[] | null;
  barStartsMs: number[] | null;
  /** Model that computed the per-phrase voice; null when the profile has none. */
  vocalDetector: string | null;
}

const KIND_NAMES: Record<SmartMixPhraseKind, string> = {
  intro: "Intro",
  build: "Build",
  peak: "Peak",
  break: "Break",
  outro: "Outro",
  body: "Body",
};

function rounded(value: number) {
  return Number(value.toFixed(2));
}

function clock(ms: number) {
  const seconds = ((ms % 60_000) / 1_000).toFixed(1).padStart(4, "0");
  return `${Math.floor(ms / 60_000)}:${seconds}`;
}

function voiceShare(phrase: SmartMixPhrase) {
  return phrase.vocalPresence == null ? null : phrase.vocalPresence / 255;
}

function phraseDescription(phrase: SmartMixPhrase) {
  const voice = voiceShare(phrase);
  return `${KIND_NAMES[phrase.kind]}, ${phrase.bars} bars, ${clock(
    phrase.startMs,
  )} to ${clock(phrase.endMs)}, energy ${Math.round(phrase.energy * 100)}%${
    voice == null ? "" : `, voice ${Math.round(voice * 100)}%`
  }`;
}

/**
 * Phrase strip for reviewing the Smart Mix segmentation (gate SG1): a 1 px rule at
 * every phrase boundary, a mono label with the kind and length of each phrase, a 1 px
 * voice lane whose opacity is the share of each phrase with voice (SM3-D13), and the
 * per-bar energy as a 1 px lane under them, all on the track's time axis.
 */
export function SmartMixStructure({
  structure,
}: {
  structure: SmartMixTrackStructureData;
}) {
  const phrases = structure.phrases;
  const curve = structure.energyCurve ?? [];
  const bars = structure.barStartsMs ?? [];
  const lastEnd = phrases?.[phrases.length - 1]?.endMs ?? 0;
  const span = Math.max(structure.durationMs, lastEnd, 1);
  const x = (ms: number) =>
    rounded((Math.min(Math.max(ms, 0), span) / span) * 100);
  const boundaries = phrases?.length
    ? [...phrases.map((phrase) => phrase.startMs), lastEnd]
    : [];
  // One point per bar that has both an energy byte and a start time.
  const lane = bars
    .slice(0, curve.length)
    .map(
      (startMs, bar) =>
        `${x(startMs)},${rounded(100 - ((curve[bar] ?? 0) / 255) * 100)}`,
    )
    .join(" ");
  const confidence = structure.structureConfidence;
  const detector = structure.vocalDetector;

  return (
    <figure className="m-0 min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel as="figcaption" tone="accent">
          Phrase structure
        </MonoLabel>
        <div className="flex flex-wrap gap-2">
          {phrases ? <InfoBadge>{phrases.length} phrases</InfoBadge> : null}
          {confidence != null ? (
            <InfoBadge>Confidence {Math.round(confidence * 100)}%</InfoBadge>
          ) : null}
          {detector ? <InfoBadge>{`Voice · ${detector}`}</InfoBadge> : null}
        </div>
      </div>
      {phrases == null ? (
        <p className="m-0 text-sm text-text-muted">
          No phrases are stored for this profile ({structure.analyzerVersion}).
          Reanalyze the track to measure them.
        </p>
      ) : phrases.length === 0 ? (
        <p className="m-0 text-sm text-text-muted">
          The analyzer found no regular phrases in this track.
        </p>
      ) : null}
      {boundaries.length > 0 || lane ? (
        <div className="min-w-0">
          {phrases?.length ? (
            <ol aria-label="Phrases" className="relative m-0 h-6 list-none p-0">
              {phrases.map((phrase, index) => (
                <TooltipHint
                  key={`${phrase.startBeat}:${index}`}
                  content={phraseDescription(phrase)}
                >
                  <li
                    tabIndex={0}
                    aria-label={phraseDescription(phrase)}
                    data-kind={phrase.kind}
                    className="absolute inset-y-0 min-w-0 overflow-hidden border-l border-border-quiet pl-1 whitespace-nowrap"
                    style={{
                      left: `${x(phrase.startMs)}%`,
                      width: `${rounded(x(phrase.endMs) - x(phrase.startMs))}%`,
                    }}
                  >
                    <MonoLabel
                      as="span"
                      tone={phrase.kind === "peak" ? "accent" : "subtle"}
                    >
                      {phrase.kind} · {phrase.bars}
                    </MonoLabel>
                  </li>
                </TooltipHint>
              ))}
            </ol>
          ) : null}
          {detector && phrases?.length ? (
            <div
              aria-hidden="true"
              data-slot="voice-lane"
              className="relative mt-1 h-px"
            >
              {phrases.map((phrase, index) => (
                <span
                  key={`${phrase.startBeat}:${index}`}
                  className="absolute inset-y-0 bg-accent-action-hi"
                  style={{
                    left: `${x(phrase.startMs)}%`,
                    width: `${rounded(x(phrase.endMs) - x(phrase.startMs))}%`,
                    opacity: rounded(voiceShare(phrase) ?? 0),
                  }}
                />
              ))}
            </div>
          ) : null}
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="block h-12 w-full overflow-visible"
          >
            <line
              x1="0"
              x2="100"
              y1="100"
              y2="100"
              strokeWidth="1"
              className="stroke-border-quiet"
              vectorEffect="non-scaling-stroke"
            />
            {boundaries.map((ms, index) => (
              <line
                key={`${ms}:${index}`}
                data-slot="phrase-boundary"
                x1={x(ms)}
                x2={x(ms)}
                y1="0"
                y2="100"
                strokeWidth="1"
                className="stroke-border-quiet"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {lane ? (
              <polyline
                data-slot="energy-lane"
                points={lane}
                fill="none"
                strokeWidth="1"
                strokeLinejoin="round"
                className="stroke-accent-action-hi"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          <div className="mt-1 flex justify-between">
            <MonoLabel as="span">{clock(0)}</MonoLabel>
            <MonoLabel as="span">{clock(span)}</MonoLabel>
          </div>
        </div>
      ) : null}
    </figure>
  );
}

/**
 * Loads one track's stored structure when its audio profile opens. A failed read shows
 * a plain note: opening the profile again retries.
 */
export function SmartMixTrackStructure({ trackId }: { trackId: number }) {
  const { data, loading, error } = useApi<SmartMixTrackStructureData>(
    `/api/admin/smart-mix/tracks/${trackId}/structure`,
  );
  if (loading && !data) {
    return <LoadingState label="Loading phrase structure" />;
  }
  if (error || !data) {
    return (
      <p className="m-0 text-sm text-text-muted">
        The phrase structure is unavailable.
      </p>
    );
  }
  return <SmartMixStructure structure={data} />;
}
