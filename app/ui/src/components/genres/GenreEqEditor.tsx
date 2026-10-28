import { useEffect, useMemo, useState } from "react";
import { Save, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";
import { api } from "@/lib/api";
import { EqBands } from "@crate/ui/domain/player/EqBands";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { Readout } from "@crate/ui/primitives/Readout";

const EQ_BAND_COUNT = 10;
const FLAT_GAINS: number[] = new Array(EQ_BAND_COUNT).fill(0);

interface ResolvedPreset {
  gains: number[];
  source: "direct" | "inherited";
  slug: string;
  name: string;
}

interface Props {
  canonicalSlug: string;
  canonicalName: string;
  initialGains: number[] | null;
  initialResolved: ResolvedPreset | null;
  eqReasoning?: string | null;
  aiProposalGains?: number[] | null;
  aiProposalReasoning?: string | null;
  embedded?: boolean;
  onSaved?: () => void;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > 0.001) return false;
  }
  return true;
}

export function GenreEqEditor({
  canonicalSlug,
  canonicalName,
  initialGains,
  initialResolved,
  eqReasoning,
  aiProposalGains = null,
  aiProposalReasoning = null,
  embedded = false,
  onSaved,
}: Props) {
  const seeded = useMemo<number[]>(() => {
    if (initialGains && initialGains.length === EQ_BAND_COUNT)
      return [...initialGains];
    if (initialResolved?.gains.length === EQ_BAND_COUNT)
      return [...initialResolved.gains];
    return [...FLAT_GAINS];
  }, [initialGains, initialResolved]);

  const [gains, setGains] = useState<number[]>(seeded);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [reasoning, setReasoning] = useState(eqReasoning || "");
  const motionAllowed = useMotionAllowed();

  useEffect(() => {
    setGains(seeded);
  }, [seeded]);

  useEffect(() => {
    setReasoning(
      aiProposalGains?.length === EQ_BAND_COUNT
        ? aiProposalReasoning || ""
        : eqReasoning || "",
    );
  }, [canonicalSlug, eqReasoning, aiProposalGains, aiProposalReasoning]);

  useEffect(() => {
    if (aiProposalGains?.length !== EQ_BAND_COUNT) return;
    setGains([...aiProposalGains]);
    if (aiProposalReasoning) setReasoning(aiProposalReasoning);
  }, [aiProposalGains, aiProposalReasoning]);

  const dirty = !arraysEqual(gains, seeded);
  const aiProposalStaged =
    dirty &&
    aiProposalGains?.length === EQ_BAND_COUNT &&
    arraysEqual(gains, aiProposalGains);
  const syncStatus = dirty
    ? aiProposalStaged
      ? "AI proposal · unsaved"
      : "Unsaved changes"
    : "In sync with database";
  const hasOwnPreset = initialGains !== null;
  const inherited = !hasOwnPreset && initialResolved?.source === "inherited";

  const updateBand = (index: number, dB: number) => {
    setGains((prev) => {
      const next = [...prev];
      next[index] = dB;
      return next;
    });
  };

  const save = async () => {
    if (saving || clearing) return;
    setSaving(true);
    try {
      await api(`/api/genres/${canonicalSlug}/eq-preset`, "PATCH", { gains });
      toast.success(`Saved EQ preset for ${canonicalName}`);
      onSaved?.();
    } catch {
      toast.error("Failed to save preset");
    } finally {
      setSaving(false);
    }
  };

  const clearPreset = async () => {
    if (saving || clearing) return;
    setClearing(true);
    try {
      await api(`/api/genres/${canonicalSlug}/eq-preset`, "PATCH", {
        gains: null,
      });
      toast.success(
        `Cleared preset for ${canonicalName} — will inherit from parent`,
      );
      onSaved?.();
    } catch {
      toast.error("Failed to clear preset");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className={
        embedded
          ? "min-w-0"
          : "rounded-md border border-border-quiet bg-raised-surface p-5"
      }
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {embedded ? (
            <span className="text-sm font-medium text-text-secondary">
              10-band curve · {canonicalName}
            </span>
          ) : (
            <MonoLabel
              as="h2"
              accent="Equalizer preset"
              meta={[canonicalName]}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Reset sliders to flat"
            title="Reset sliders to flat"
            onClick={() => setGains([...FLAT_GAINS])}
            disabled={saving || clearing}
            className="text-text-subtle hover:text-text-secondary disabled:opacity-30"
          >
            <RotateCcw aria-hidden="true" />
          </Button>
        </div>
        {aiProposalStaged ? (
          <StatusDot tone="warn" label="AI proposal · unsaved" />
        ) : hasOwnPreset ? (
          <StatusDot label="Direct preset" />
        ) : inherited && initialResolved ? (
          <StatusDot
            tone="off"
            label={`Inherits from ${initialResolved.name}`}
          />
        ) : (
          <StatusDot tone="warn" label="No preset" />
        )}
      </div>

      <p className="mb-4 text-xs leading-5 text-text-muted">
        {reasoning ||
          'Curve applied when a track in this genre plays with "Genre Adaptive" on. Saving stores gains on this taxonomy node directly. Clearing drops back to the first ancestor that has a preset.'}
      </p>

      <div className="border-t border-border-quiet pt-4">
        <EqBands
          gains={gains}
          onBandChange={updateBand}
          animate={motionAllowed}
          trackClassName="h-28"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Readout announcement={syncStatus} minWidthCh={24}>
          {syncStatus}
        </Readout>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={clearPreset}
            disabled={saving || clearing || !hasOwnPreset}
            className="text-xs"
          >
            {clearing ? (
              <Loader2 size={13} className="mr-1 animate-spin" />
            ) : (
              <RotateCcw size={13} className="mr-1" />
            )}
            Clear (inherit)
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving || clearing || !dirty}
            className="text-xs"
          >
            {saving ? (
              <Loader2 size={13} className="mr-1 animate-spin" />
            ) : (
              <Save size={13} className="mr-1" />
            )}
            Save preset
          </Button>
        </div>
      </div>
    </div>
  );
}
