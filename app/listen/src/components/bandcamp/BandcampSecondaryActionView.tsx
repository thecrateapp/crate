import { CRATE_ICON_SIZE, Loader2 } from "@crate/ui/icons";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import {
  HERO_SECONDARY_ACTION_CLASS,
  HERO_SECONDARY_ACTION_ACTIVE_CLASS,
} from "@crate/ui/domain/hero";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { cn } from "@crate/ui/lib/cn";
/** Transport and purchase/import authority remain in BandcampSupportButton. */
export function BandcampSecondaryActionView({
  owned,
  busy,
  className,
  label,
  onActivate,
}: {
  owned: boolean;
  busy: boolean;
  className?: string;
  label: string;
  onActivate: () => void;
}) {
  const caption = (
    <MonoLabel as="span" className="text-inherit">
      Bandcamp
    </MonoLabel>
  );
  if (owned)
    return (
      <span
        className={cn(
          HERO_SECONDARY_ACTION_CLASS,
          HERO_SECONDARY_ACTION_ACTIVE_CLASS,
          className,
        )}
        aria-label={label}
      >
        <BandcampLogo size={CRATE_ICON_SIZE.lg} />
        {caption}
      </span>
    );
  return (
    <button
      type="button"
      onClick={onActivate}
      disabled={busy}
      className={cn(HERO_SECONDARY_ACTION_CLASS, className)}
      aria-label={label}
    >
      {busy ? (
        <Loader2 size={CRATE_ICON_SIZE.lg} className="animate-spin" />
      ) : (
        <BandcampLogo size={CRATE_ICON_SIZE.lg} />
      )}
      {caption}
    </button>
  );
}
