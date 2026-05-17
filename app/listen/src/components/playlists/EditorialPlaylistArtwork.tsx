import { PlaylistArtwork, type PlaylistArtworkTrack } from "./PlaylistArtwork";

import { cn } from "@/lib/utils";

type EditorialVariant = "core" | "history" | "crate";

interface EditorialPlaylistArtworkProps {
  title: string;
  kicker?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  backgroundImageUrl?: string | null;
  variant?: EditorialVariant;
  className?: string;
  textClassName?: string;
}

const VARIANT_TONES: Record<EditorialVariant, string> = {
  core: "from-cyan-400/28 via-slate-950/12 to-slate-950",
  history: "from-teal-300/24 via-slate-950/10 to-slate-950",
  crate: "from-sky-300/22 via-slate-950/12 to-slate-950",
};

const VARIANT_RADIALS: Record<EditorialVariant, string> = {
  core: "bg-[radial-gradient(circle_at_16%_12%,rgba(6,182,212,0.3),transparent_32%)]",
  history:
    "bg-[radial-gradient(circle_at_20%_18%,rgba(190,242,100,0.26),transparent_34%)]",
  crate:
    "bg-[radial-gradient(circle_at_18%_14%,rgba(56,189,248,0.24),transparent_34%)]",
};

export function editorialPlaylistLabel(
  name: string,
  fallbackKicker = "Core Tracks",
): { title: string; kicker: string } {
  const cleaned = name.trim();
  const coreMatch = cleaned.match(/\s+core\s+tracks$/i);
  const mixMatch = cleaned.match(/\s+mix$/i);

  if (coreMatch) {
    return {
      title: cleaned.slice(0, coreMatch.index).trim() || cleaned,
      kicker: "Core Tracks",
    };
  }

  if (mixMatch && fallbackKicker === "Core Tracks") {
    return {
      title: cleaned.slice(0, mixMatch.index).trim() || cleaned,
      kicker: fallbackKicker,
    };
  }

  return { title: cleaned || "Crate", kicker: fallbackKicker };
}

export function EditorialPlaylistArtwork({
  title,
  kicker = "Core Tracks",
  tracks = [],
  coverDataUrl,
  backgroundImageUrl,
  variant = "core",
  className,
  textClassName,
}: EditorialPlaylistArtworkProps) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-[3px] border border-white/10 bg-slate-950 [container-type:inline-size]",
        className,
      )}
    >
      <div className="absolute inset-0 z-0 opacity-55 transition duration-500 group-hover:scale-[1.035] group-hover:opacity-70">
        {backgroundImageUrl ? (
          <img
            src={backgroundImageUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover grayscale"
          />
        ) : (
          <PlaylistArtwork
            name={title}
            coverDataUrl={coverDataUrl}
            tracks={tracks}
            className="h-full w-full rounded-none"
          />
        )}
      </div>

      <div
        className={cn(
          "absolute inset-0 z-[1] bg-gradient-to-br mix-blend-screen",
          VARIANT_TONES[variant],
        )}
      />
      <div className="absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(2,6,10,0.05)_0%,rgba(2,6,10,0.32)_45%,rgba(2,6,10,0.9)_100%)]" />
      <div className={cn("absolute inset-0 z-[2]", VARIANT_RADIALS[variant])} />
      <div className="absolute inset-0 z-[2] opacity-35 [background-image:linear-gradient(135deg,rgba(255,255,255,0.16)_0_1px,transparent_1px_12px)]" />

      <img
        src="/icons/logo.svg"
        alt=""
        aria-hidden="true"
        data-testid="crate-editorial-mark"
        className="absolute right-[7%] top-[7%] z-[4] h-[8.5cqw] max-h-6 min-h-3.5 w-[8.5cqw] max-w-6 min-w-3.5 opacity-95 drop-shadow-[0_1px_8px_rgba(0,0,0,0.55)]"
      />

      <div
        className={cn("absolute inset-x-[7%] bottom-[7%] z-[4]", textClassName)}
      >
        <div className="max-w-[96%] text-[clamp(1.25rem,21cqw,4.35rem)] font-black uppercase leading-[0.78] tracking-[-0.09em] text-white text-pretty drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]">
          {title}
        </div>
        {kicker ? (
          <div className="mt-[2.5cqw] text-[clamp(0.58rem,5.2cqw,1.05rem)] font-black uppercase leading-none tracking-[0.13em] text-primary drop-shadow-[0_1px_10px_rgba(0,0,0,0.65)]">
            {kicker}
          </div>
        ) : null}
      </div>
    </div>
  );
}
