import { type ComponentProps } from "react";
import { Bot, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { useActionLLMStatus } from "@/hooks/use-llm";

interface AIButtonProps extends Omit<
  ComponentProps<typeof Button>,
  "variant" | "size"
> {
  actionId: string;
  loading?: boolean;
}

export function AIButton({
  actionId,
  loading,
  children,
  className,
  disabled,
  ...props
}: AIButtonProps) {
  const llmStatus = useActionLLMStatus(actionId);

  if (!llmStatus?.available) return null;

  return (
    <Button
      {...props}
      size="lg"
      variant="default"
      disabled={disabled}
      className={className}
      loading={loading}
    >
      {!loading ? (
        <Bot
          data-admin-ux="ai-bot"
          aria-hidden="true"
          size={CRATE_ICON_SIZE.sm}
          className="size-4 shrink-0 scale-125"
        />
      ) : null}
      {children}
    </Button>
  );
}
