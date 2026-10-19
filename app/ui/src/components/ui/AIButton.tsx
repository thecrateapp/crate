import { type ComponentProps } from "react";
import { Bot, Loader2, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { cn } from "@/lib/utils";
import { useLLMStatus } from "@/hooks/use-llm";

interface AIButtonProps
  extends Omit<ComponentProps<typeof Button>, "variant" | "size"> {
  loading?: boolean;
}

export function AIButton({
  loading,
  children,
  className,
  disabled,
  ...props
}: AIButtonProps) {
  const llmStatus = useLLMStatus();

  if (!llmStatus?.available) return null;

  return (
    <div className="relative inline-flex">
      {/* Glow pulse behind the button */}
      <div
        className={cn(
          "absolute -inset-[3px] rounded-md bg-gradient-to-r from-primary/45 via-accent-action/25 to-primary/45 opacity-65 blur-md",
          loading
            ? "animate-pulse"
            : "animate-[aiGlow_3s_ease-in-out_infinite]",
          disabled && "opacity-0",
        )}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || loading}
        className={cn(
          "relative min-h-11 border-primary/45 bg-black/85 text-primary shadow-none hover:border-primary/70 hover:bg-primary/15 hover:text-primary",
          className,
        )}
        {...props}
        loading={false}
        aria-busy={loading || undefined}
      >
        {loading ? (
          <Loader2
            data-admin-ux="ai-loading"
            aria-hidden="true"
            size={CRATE_ICON_SIZE.xs}
            className="mr-1.5 animate-spin"
          />
        ) : (
          <Bot
            data-admin-ux="ai-bot"
            aria-hidden="true"
            size={CRATE_ICON_SIZE.sm}
            className="size-4 shrink-0 scale-125"
          />
        )}
        {children}
      </Button>
    </div>
  );
}
