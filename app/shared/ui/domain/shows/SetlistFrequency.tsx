import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";

export interface SetlistFrequencyProps {
  frequency: number;
  label: string;
  plays: string;
  showLastPlayed?: boolean;
  lastPlayed?: string | null;
}

export function SetlistFrequency({
  frequency,
  label,
  plays,
  showLastPlayed = false,
  lastPlayed,
}: SetlistFrequencyProps) {
  const value = Number.isFinite(frequency)
    ? Math.max(0, Math.min(1, frequency))
    : 0;
  return (
    <span
      data-slot="setlist-frequency"
      className={cn(
        "grid items-center gap-3",
        showLastPlayed
          ? "grid-cols-[3rem_6ch_12ch] sm:grid-cols-[3rem_6ch_12ch_13ch]"
          : "grid-cols-[3rem_6ch_auto]",
      )}
    >
      <ProgressHairline label={label} value={value} />
      <MonoLabel as="span" className="text-right">
        {Math.round(value * 100)}%
      </MonoLabel>
      <MonoLabel as="span">{plays}</MonoLabel>
      {showLastPlayed ? (
        <MonoLabel as="span" className="hidden sm:block">
          {lastPlayed ?? ""}
        </MonoLabel>
      ) : null}
    </span>
  );
}
