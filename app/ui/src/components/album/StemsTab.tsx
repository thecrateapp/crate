import type { ReactNode } from "react";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { StemLanes, clock, dbText } from "./StemLanes";
import {
  STEMS,
  buildStemsTabModel,
  type SmartMixTrackStems,
  type StemsTabModel,
} from "./stems-model";

// The track dialog's Reading (AudioProfileCard), unchanged.
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

/** A mono note on its own line under a reading's value. */
function ReadingNote({
  wrap = false,
  children,
}: {
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wrap ? "mt-1 whitespace-normal" : "mt-1"}>
      <MonoLabel as="div">{children}</MonoLabel>
    </div>
  );
}

const JOB_LABELS = {
  pending: "Pending",
  analyzing: "Separating",
  ready: "Ready",
  failed: "Failed",
} as const;

const KIND_NAMES: Record<string, string> = {
  intro: "Intro",
  build: "Build",
  peak: "Peak",
  break: "Break",
  outro: "Outro",
  body: "Body",
};

const COLUMNS = "sm:grid-cols-2";

function SourcePanel({ model }: { model: StemsTabModel }) {
  const analysis = model.analysis;
  return (
    <InstrumentPanel
      as="section"
      headingLevel={3}
      label={{ children: "Analysis source", tone: "accent" }}
      meta="stem-analysis/1"
    >
      {analysis ? (
        <dl className={`m-0 grid gap-x-6 gap-y-4 ${COLUMNS}`}>
          <Reading label="Source">
            {analysis.kind === "server" ? "Crate server" : "Crate Decks upload"}
            {analysis.contributedBy ? (
              <ReadingNote>by {analysis.contributedBy}</ReadingNote>
            ) : null}
          </Reading>
          <Reading label="Producer">{analysis.producer}</Reading>
          <Reading label="Separator">
            {analysis.separatorModel}
            <ReadingNote>{analysis.separatorVersion}</ReadingNote>
          </Reading>
          <Reading label="Source revision">
            <span className="mr-2">{analysis.sourceRevision.slice(0, 8)}</span>
            {analysis.current ? (
              <InfoBadge>Current file</InfoBadge>
            ) : (
              <InfoBadge tone="warning">Stale</InfoBadge>
            )}
            {!analysis.current && analysis.fileChangedAt ? (
              <ReadingNote>file changed {analysis.fileChangedAt}</ReadingNote>
            ) : null}
          </Reading>
          <Reading label="Analysed">{analysis.analysedAt}</Reading>
          <Reading label="Drum-stem beats">
            {analysis.drumBeatsMs?.length.toLocaleString() ?? "—"}
          </Reading>
        </dl>
      ) : (
        <p className="m-0 text-sm text-text-muted">
          No stem analysis of this track yet.
        </p>
      )}
    </InstrumentPanel>
  );
}

function ServerPanel({ model }: { model: StemsTabModel }) {
  const { job, files, playlists } = model;
  return (
    <InstrumentPanel
      as="section"
      headingLevel={3}
      label={{ children: "Server stems", tone: "accent" }}
    >
      <dl className={`m-0 grid gap-x-6 gap-y-4 ${COLUMNS}`}>
        <Reading label="Job">
          {job ? (
            <>
              {job.state === "failed" ? (
                <InfoBadge tone="warning">Failed</InfoBadge>
              ) : job.state === "analyzing" ? (
                <InfoBadge tone="accent">{JOB_LABELS[job.state]}</InfoBadge>
              ) : (
                JOB_LABELS[job.state]
              )}
              <ReadingNote>{job.detail}</ReadingNote>
              {model.canManage && job.lastError ? (
                <p
                  data-slot="stem-job-error"
                  className="m-0 mt-2 whitespace-normal wrap-anywhere font-sans text-xs text-state-warning-text"
                >
                  {job.lastError}
                </p>
              ) : null}
            </>
          ) : (
            <>
              None
              <ReadingNote>in no Smart Mix playlist</ReadingNote>
            </>
          )}
        </Reading>
        <Reading label="Stem file">
          {files.stored ? (
            <>
              {files.size}
              <ReadingNote>{files.streams}</ReadingNote>
            </>
          ) : (
            <>
              Not stored
              <ReadingNote wrap>{files.note}</ReadingNote>
            </>
          )}
        </Reading>
        {files.stored ? (
          <Reading label="Last use">{files.lastUsed}</Reading>
        ) : null}
        <div className="crate-form-field min-w-0 sm:col-span-2">
          <MonoLabel as="dt">Smart Mix playlists</MonoLabel>
          <dd className="m-0 min-w-0">
            {playlists.length ? (
              <ul className="m-0 list-none space-y-1.5 p-0">
                {playlists.map((playlist) => (
                  <li
                    key={playlist.id}
                    className="flex min-w-0 items-baseline justify-between gap-3"
                  >
                    <span className="min-w-0 truncate text-sm text-text-primary">
                      {playlist.name}
                    </span>
                    <MonoLabel as="span" className="shrink-0">
                      {playlist.owner} ·{" "}
                      {playlist.enabled
                        ? `${playlist.ready}/${playlist.total}`
                        : "off"}
                    </MonoLabel>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="font-mono text-base text-text-primary">—</span>
            )}
          </dd>
        </div>
      </dl>
    </InstrumentPanel>
  );
}

function LayerTable({ model }: { model: StemsTabModel }) {
  const layer = model.layer;
  if (!layer) return null;
  return (
    <table
      aria-label="Stems layer by phrase"
      className="w-full border-collapse text-sm tabular-nums"
    >
      <thead>
        <tr className="text-left text-text-muted">
          {[
            "#",
            "Kind",
            "Bars",
            "Span",
            "Drums",
            "Bass",
            "Other",
            "Vocals",
          ].map((header) => (
            <th key={header} scope="col" className="py-1 pr-3 font-normal">
              {header}
            </th>
          ))}
          {model.voiceDetector ? (
            <th scope="col" className="py-1 pr-3 font-normal">
              Voice
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {layer.map((phrase, index) => {
          const structure = model.phrases[index];
          return (
            <tr key={phrase.startMs} className="border-t border-border-quiet">
              <td className="py-1 pr-3">{index + 1}</td>
              <td className="py-1 pr-3">
                {structure
                  ? (KIND_NAMES[structure.kind] ?? structure.kind)
                  : "—"}
              </td>
              <td className="py-1 pr-3">{structure?.bars ?? "—"}</td>
              <td className="py-1 pr-3">
                {clock(phrase.startMs)}–{clock(phrase.endMs)}
              </td>
              {STEMS.map((stem) => (
                <td key={stem} className="py-1 pr-3">
                  {dbText(phrase[stem])} dB
                </td>
              ))}
              {model.voiceDetector ? (
                <td className="py-1 pr-3">
                  {structure?.voiced == null
                    ? "—"
                    : structure.voiced
                      ? "Yes"
                      : "No"}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The Stems tab of a track's Audio profile dialog (design §3, STEM-D2): stem levels over
 * time with the phrase grid and the stems layer, where the analysis came from, and the
 * server's stem file, job and Smart Mix playlists. Nothing plays here.
 */
export function StemsTab({ model }: { model: StemsTabModel }) {
  const analysis = model.analysis;
  const stale = Boolean(analysis && !analysis.current);
  return (
    <div className="min-w-0 space-y-6 @container" data-slot="stems-tab">
      <div className="grid gap-y-2">
        <figure className="m-0 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MonoLabel as="figcaption" tone="accent">
              Stem levels
            </MonoLabel>
            <div className="flex flex-wrap gap-2">
              {analysis ? (
                <>
                  <InfoBadge
                    tone={
                      stale
                        ? "warning"
                        : analysis.kind === "decks"
                          ? "accent"
                          : "neutral"
                    }
                  >
                    {stale
                      ? "Stale analysis"
                      : analysis.kind === "server"
                        ? "Server analysis"
                        : "Crate Decks upload"}
                  </InfoBadge>
                  <InfoBadge>{analysis.separatorVersion}</InfoBadge>
                  {model.phrases.length ? (
                    <InfoBadge>{model.phrases.length} phrases</InfoBadge>
                  ) : null}
                </>
              ) : model.job ? (
                <InfoBadge
                  tone={model.job.state === "failed" ? "warning" : "accent"}
                >
                  {model.job.state === "failed"
                    ? "Separation failed"
                    : model.job.state === "pending"
                      ? "Waiting for separation"
                      : "Separating on the server"}
                </InfoBadge>
              ) : null}
            </div>
          </div>
          <StemLanes
            durationMs={model.durationMs}
            phrases={model.phrases}
            levels={analysis?.levels ?? null}
            hopMs={analysis?.hopMs}
            layer={model.layer}
            drumBeatsMs={analysis?.drumBeatsMs ?? null}
            voiceDetector={model.voiceDetector}
            stale={stale}
            emptyMessage={
              model.job?.state === "failed"
                ? "No stem analysis of this file"
                : model.job?.state === "pending"
                  ? "Waiting for separation · levels appear when it ends"
                  : "Separating on the server · levels appear when it ends"
            }
          />
          <p className="m-0 text-xs text-text-muted">
            {model.layerNote ??
              "Level of each stem every 250 ms, from −60 to 0 dBFS. Lit bars: each phrase's mean, the stems layer the planner reads. Right: the track's mean."}
          </p>
        </figure>
        <aside className="grid min-w-0 gap-x-10 @4xl:grid-cols-2">
          <SourcePanel model={model} />
          <ServerPanel model={model} />
        </aside>
      </div>
      <LayerTable model={model} />
    </div>
  );
}

/** The tab's content once the dialog has read the track's stems. */
export function SmartMixTrackStems({
  data,
  loading,
  canManage,
}: {
  data: SmartMixTrackStems | null;
  loading: boolean;
  canManage: boolean;
}) {
  if (!data) {
    return loading ? (
      <LoadingState label="Loading stems" />
    ) : (
      <p className="m-0 text-sm text-text-muted">The stems are unavailable.</p>
    );
  }
  return <StemsTab model={buildStemsTabModel(data, { canManage })} />;
}
