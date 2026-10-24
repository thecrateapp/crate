import type { ReactNode } from "react";
import { ResponsiveRadar } from "@nivo/radar";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Meter } from "@crate/ui/primitives/Meter";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import type { AudioAnalysisTrack, SmartMixAnalysis } from "./audio-analysis";

const FEATURES = [
  ["danceability", "Danceability"],
  ["valence", "Valence"],
  ["acousticness", "Acousticness"],
  ["energy", "Energy"],
  ["spectral_complexity", "Complexity"],
  ["instrumentalness", "Instrumental"],
] as const;
const CHART_THEME = {
  text: {
    fill: "var(--color-text-muted)",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
  },
  grid: { line: { stroke: "var(--color-border-quiet)" } },
  tooltip: {
    container: {
      background: "var(--color-popover-surface)",
      color: "var(--color-text-primary)",
      fontSize: 12,
    },
  },
};
function finite(values: (number | null | undefined)[]) {
  return values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
}
function mean(values: (number | null | undefined)[]) {
  const samples = finite(values);
  return samples.length
    ? samples.reduce((sum, value) => sum + value, 0) / samples.length
    : null;
}
function number(value: number | null | undefined, digits = 1, unit = "") {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(digits)}${unit}`;
}
function timestamp(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
function range(values: (number | null | undefined)[], unit: string) {
  const samples = finite(values);
  return samples.length
    ? `${Math.min(...samples).toFixed(1)}–${Math.max(...samples).toFixed(1)} ${unit}`
    : "—";
}
function Reading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="crate-form-field min-w-0">
      <MonoLabel as="dt">{label}</MonoLabel>
      <dd className="m-0 min-w-0 wrap-anywhere font-mono text-base tabular-nums text-text-primary">
        {children}
      </dd>
    </div>
  );
}
function ReadingPair({
  first,
  second,
  separator = "/",
}: {
  first: string;
  second: string;
  separator?: string;
}) {
  return (
    <>
      <span className="inline-block whitespace-nowrap">{first}</span>{" "}
      {separator}{" "}
      <span className="inline-block whitespace-nowrap">{second}</span>
    </>
  );
}
function MixDetails({
  profile,
  group = "all",
}: {
  profile: SmartMixAnalysis;
  group?: "all" | "mixing" | "provenance";
}) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {group !== "mixing" ? (
        <Reading label="Profile schema">
          {profile.profile_version == null
            ? "—"
            : `v${profile.profile_version}`}
        </Reading>
      ) : null}
      {group !== "provenance" ? (
        <>
          <Reading label="Mix key">{profile.camelot || "—"}</Reading>
          <Reading label="Time signature">
            {profile.time_signature == null
              ? "—"
              : `${profile.time_signature} beats/bar`}
          </Reading>
          <Reading label="Tempo confidence">
            {number(
              profile.bpm_confidence == null
                ? null
                : profile.bpm_confidence * 100,
              0,
              "%",
            )}
          </Reading>
          <Reading label="Tempo stability">
            {number(
              profile.tempo_stability == null
                ? null
                : profile.tempo_stability * 100,
              0,
              "%",
            )}
          </Reading>
          <Reading label="Intro / outro tempo">
            <ReadingPair
              first={number(profile.intro_bpm, 1, " BPM")}
              second={number(profile.outro_bpm, 1, " BPM")}
            />
          </Reading>
          <Reading label="Intro / outro energy">
            <ReadingPair
              first={number(
                profile.intro_energy == null
                  ? null
                  : profile.intro_energy * 100,
                0,
                "%",
              )}
              second={number(
                profile.outro_energy == null
                  ? null
                  : profile.outro_energy * 100,
                0,
                "%",
              )}
            />
          </Reading>
          <Reading label="Intro / outro loudness">
            <ReadingPair
              first={number(profile.intro_lufs, 1, " LUFS")}
              second={number(profile.outro_lufs, 1, " LUFS")}
            />
          </Reading>
          <Reading label="Intro / outro cue">
            <ReadingPair
              first={number(
                profile.intro_cue_ms == null
                  ? null
                  : profile.intro_cue_ms / 1000,
                2,
                " s",
              )}
              second={number(
                profile.outro_cue_ms == null
                  ? null
                  : profile.outro_cue_ms / 1000,
                2,
                " s",
              )}
            />
          </Reading>
          <Reading label="Active audio window">
            <ReadingPair
              first={number(
                profile.active_start_ms == null
                  ? null
                  : profile.active_start_ms / 1000,
                2,
                " s",
              )}
              separator="–"
              second={number(
                profile.active_end_ms == null
                  ? null
                  : profile.active_end_ms / 1000,
                2,
                " s",
              )}
            />
          </Reading>
        </>
      ) : null}
      {group !== "mixing" ? (
        <>
          <Reading label="Measured">{timestamp(profile.analyzed_at)}</Reading>
          <Reading label="Measurement version">
            {profile.measurement_version || "—"}
          </Reading>
          <Reading label="Profile revision">
            {profile.profile_revision || "—"}
          </Reading>
          <Reading label="Source revision">
            {profile.source_revision || "—"}
          </Reading>
          <Reading label="Bliss reference">
            {profile.bliss_vector_revision || "—"}
          </Reading>
          {profile.source_stale_at ? (
            <Reading label="Source changed">
              {timestamp(profile.source_stale_at)}
            </Reading>
          ) : null}
        </>
      ) : null}
    </dl>
  );
}

export function AudioProfileCard({
  analysisData,
  totalTracks,
  presentation = "album",
}: {
  analysisData: Record<string, AudioAnalysisTrack>;
  totalTracks?: number;
  presentation?: "album" | "track-dialog";
}) {
  const motionAllowed = useMotionAllowed();
  const tracks = Object.values(analysisData);
  const total = totalTracks ?? tracks.length;
  const analyzed = tracks.filter(
    (track) =>
      track.analysis_state === "completed" ||
      [
        track.tempo,
        track.energy,
        track.loudness,
        track.dynamic_range,
        track.danceability,
        track.valence,
        track.acousticness,
        track.instrumentalness,
        track.spectral_complexity,
      ].some((value) => value != null),
  );
  const profiles = tracks.flatMap((track) =>
    track.smart_mix ? [track.smart_mix] : [],
  );
  const bliss = tracks.flatMap((track) => (track.bliss ? [track.bliss] : []));
  const featureData = FEATURES.flatMap(([key, label]) => {
    const value = mean(tracks.map((track) => track[key]));
    return value == null
      ? []
      : [{ feature: label, value: Math.round(value * 100) }];
  });
  const dominantKeys = tracks.reduce<Record<string, number>>(
    (counts, track) => {
      if (track.key) {
        const key = `${track.key}${track.scale ? ` ${track.scale}` : ""}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
  const key = Object.entries(dominantKeys).sort((a, b) => b[1] - a[1])[0]?.[0];
  const moodSamples = new Map<string, number[]>();
  for (const track of tracks)
    for (const [mood, score] of Object.entries(track.mood ?? {}))
      if (Number.isFinite(score))
        moodSamples.set(mood, [...(moodSamples.get(mood) ?? []), score]);
  const moods = [...moodSamples]
    .map(([mood, samples]) => ({ mood, score: mean(samples)! }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const qualities = [
    ...new Set(profiles.map((profile) => profile.quality).filter(Boolean)),
  ];
  const versions = [
    ...new Set(
      profiles.map((profile) => profile.analyzer_version).filter(Boolean),
    ),
  ];
  const single = total === 1 && tracks.length === 1;
  const detailed = single && presentation === "track-dialog";
  const profileBadges = (
    <div className="flex flex-wrap gap-2">
      {qualities.map((quality) => (
        <InfoBadge
          key={quality}
          tone={quality === "unavailable" ? "warning" : "neutral"}
        >
          {quality}
        </InfoBadge>
      ))}
      {versions.map((version) => (
        <InfoBadge key={version}>{version}</InfoBadge>
      ))}
      {profiles.some(
        (profile) => profile.source_stale_at || profile.status === "outdated",
      ) ? (
        <InfoBadge tone="warning">Needs refresh</InfoBadge>
      ) : null}
    </div>
  );
  const features = (
    <>
      {featureData.length ? (
        <div
          className={
            detailed
              ? "grid min-w-0 gap-5"
              : "grid min-w-0 gap-6 md:grid-cols-2"
          }
        >
          <div
            className={
              detailed
                ? "grid min-w-0 gap-x-5 gap-y-3 sm:grid-cols-2"
                : "space-y-3"
            }
          >
            {featureData.map((feature) => (
              <Meter
                key={feature.feature}
                label={feature.feature}
                value={feature.value}
                max={100}
                valueText={`${feature.value}%`}
              />
            ))}
          </div>
          {featureData.length >= 3 ? (
            <div
              className="h-60 min-w-0"
              role="img"
              aria-label="Measured audio features radar"
            >
              <ResponsiveRadar
                data={featureData}
                keys={["value"]}
                indexBy="feature"
                maxValue={100}
                margin={{ top: 30, right: 70, bottom: 30, left: 70 }}
                gridLabelOffset={14}
                dotSize={4}
                colors={["var(--color-accent-action-hi)"]}
                dotColor="var(--color-accent-action-hi)"
                fillOpacity={0.15}
                theme={CHART_THEME}
                animate={motionAllowed}
                isInteractive={false}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {moods.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <MonoLabel as="span">Mood</MonoLabel>
          {moods.map(({ mood, score }) => (
            <InfoBadge key={mood}>
              {mood} {Math.round(score * 100)}%
            </InfoBadge>
          ))}
        </div>
      ) : null}
    </>
  );
  return (
    <InstrumentPanel
      as="section"
      headingLevel={2}
      ruled={!detailed}
      label={{ children: "Audio analysis", tone: "accent" }}
      meta={`${analyzed.length} / ${total} tracks with audio features`}
    >
      {!tracks.length ? (
        <p className="text-sm text-text-muted">
          No audio analysis is available for these tracks. Queue analysis from
          the album actions.
        </p>
      ) : (
        <div className="space-y-6">
          {single ? (
            <div className="flex flex-wrap gap-2">
              <InfoBadge>
                {tracks[0]?.analysis_state ||
                  (analyzed.length ? "Measured" : "No measured features")}
              </InfoBadge>
              {tracks[0]?.analysis_completed_at ? (
                <InfoBadge>
                  Analyzed {timestamp(tracks[0]?.analysis_completed_at)}
                </InfoBadge>
              ) : null}
            </div>
          ) : null}
          <dl
            className={
              detailed
                ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
                : "grid grid-cols-2 gap-4 lg:grid-cols-4"
            }
          >
            <Reading label={single ? "Tempo" : "Mean tempo"}>
              {number(
                mean(
                  tracks.map((track) => track.smart_mix?.bpm ?? track.tempo),
                ),
                1,
                " BPM",
              )}
            </Reading>
            <Reading label={single ? "Key" : "Most frequent key"}>
              {key || "—"}
            </Reading>
            <Reading label={single ? "Loudness" : "Mean loudness"}>
              {number(mean(tracks.map((track) => track.loudness)), 1, " dB")}
            </Reading>
            <Reading label={single ? "Dynamic range" : "Mean dynamic range"}>
              {number(
                mean(tracks.map((track) => track.dynamic_range)),
                1,
                " dB",
              )}
            </Reading>
          </dl>
          <div
            className={
              detailed
                ? "grid min-w-0 gap-x-8 gap-y-6 lg:grid-cols-2"
                : "space-y-6"
            }
            data-audio-profile-layout={detailed ? "track-dialog" : "album"}
          >
            {detailed ? (
              <InstrumentPanel
                as="section"
                headingLevel={3}
                label={{ children: "Sound profile", tone: "accent" }}
              >
                <div className="space-y-5">
                  {features}
                  {!featureData.length ? (
                    <p className="m-0 text-sm text-text-muted">
                      No measured sound features are available.
                    </p>
                  ) : null}
                </div>
              </InstrumentPanel>
            ) : (
              features
            )}
            <section className="space-y-4 border-t border-border-quiet pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <MonoLabel as="h3" tone="accent">
                  Smart Mix
                </MonoLabel>
                <InfoBadge>
                  {profiles.length} / {total} profiles
                </InfoBadge>
              </div>
              {!detailed ? profileBadges : null}
              <dl
                className={
                  detailed
                    ? "grid min-w-0 gap-4 sm:grid-cols-2"
                    : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                }
              >
                <Reading
                  label={
                    single
                      ? "Integrated loudness"
                      : "Mean track integrated loudness"
                  }
                >
                  {number(
                    mean(profiles.map((profile) => profile.integrated_lufs)),
                    1,
                    " LUFS",
                  )}
                </Reading>
                <Reading
                  label={single ? "True peak" : "Highest track true peak"}
                >
                  {number(
                    finite(profiles.map((profile) => profile.true_peak_dbfs))
                      .length
                      ? Math.max(
                          ...finite(
                            profiles.map((profile) => profile.true_peak_dbfs),
                          ),
                        )
                      : null,
                    1,
                    " dBFS",
                  )}
                </Reading>
                {!detailed ? (
                  <Reading label="Track loudness range">
                    {range(
                      profiles.map((profile) => profile.integrated_lufs),
                      "LUFS",
                    )}
                  </Reading>
                ) : null}
              </dl>
              {!single ? (
                <p className="text-sm text-text-muted">
                  Loudness values summarize measured tracks; they are not an
                  integrated measurement of the album.
                </p>
              ) : null}
              {single && profiles[0] ? (
                <>
                  {detailed ? (
                    <MonoLabel as="h3" tone="accent">
                      Tempo and mix cues
                    </MonoLabel>
                  ) : null}
                  <MixDetails
                    profile={profiles[0]}
                    group={detailed ? "mixing" : "all"}
                  />
                </>
              ) : null}
              {!profiles.length ? (
                <p className="text-sm text-text-muted">
                  No Smart Mix profile is available.
                </p>
              ) : null}
            </section>
            {detailed && profiles[0] ? (
              <InstrumentPanel
                as="section"
                headingLevel={3}
                label={{ children: "Analysis provenance", tone: "accent" }}
                description="Versions and source references for this measured profile."
              >
                <div className="space-y-4">
                  {profileBadges}
                  <MixDetails profile={profiles[0]} group="provenance" />
                </div>
              </InstrumentPanel>
            ) : null}
            <section className="space-y-4 border-t border-border-quiet pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <MonoLabel as="h3" tone="accent">
                  Bliss similarity
                </MonoLabel>
                <InfoBadge>
                  {bliss.filter((entry) => entry.available).length} / {total}{" "}
                  vectors available
                </InfoBadge>
              </div>
              <p className="text-sm text-text-muted">
                Similarity embeddings support related tracks and radio. Vector
                contents are not displayed.
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  ...new Set(
                    bliss.flatMap((entry) =>
                      entry.available && entry.dimensions != null
                        ? [entry.dimensions]
                        : [],
                    ),
                  ),
                ].map((dimension) => (
                  <InfoBadge key={dimension}>{dimension} dimensions</InfoBadge>
                ))}
              </div>
              {single && bliss[0]?.available ? (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Reading label="Embedding state">
                    {bliss[0]?.state || "Available"}
                  </Reading>
                  <Reading label="Profile vector reference">
                    {bliss[0].revision || "—"}
                  </Reading>
                  <Reading label="Computed">
                    {timestamp(bliss[0].computed_at)}
                  </Reading>
                  <Reading label="Model version">
                    {bliss[0].model_version || "—"}
                  </Reading>
                </dl>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </InstrumentPanel>
  );
}
