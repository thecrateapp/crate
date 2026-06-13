import { cn } from "@/lib/utils";

type CrateLoaderVariant = "compact" | "page" | "screen";

const WRAPPER_CLASSES: Record<CrateLoaderVariant, string> = {
  compact: "py-12",
  page: "min-h-[min(46svh,28rem)] py-16",
  screen: "min-h-svh",
};

const IMAGE_CLASSES: Record<CrateLoaderVariant, string> = {
  compact: "w-[clamp(8rem,30vw,12rem)]",
  page: "w-[clamp(11rem,36vw,18rem)]",
  screen: "w-[clamp(12rem,34vw,20rem)]",
};

interface CrateLoaderProps {
  className?: string;
  label?: string;
  variant?: CrateLoaderVariant;
}

export function CrateLoader({
  className,
  label = "Loading Music.",
  variant = "page",
}: CrateLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative flex items-center justify-center overflow-hidden text-center",
        WRAPPER_CLASSES[variant],
        className,
      )}
    >
      <img
        src="/loaders/crate-loader.webp"
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn(
          "h-auto select-none drop-shadow-[0_0_24px_rgba(6,182,212,0.12)]",
          IMAGE_CLASSES[variant],
        )}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
