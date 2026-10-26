import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";

export function CopyButton({ value, label }: { value: string; label: string }) {
  async function handleCopy() {
    if (!navigator.clipboard) {
      toast.error("Could not copy. Select the text instead.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy. Select the text instead.");
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`Copy ${label}`}
      onClick={() => void handleCopy()}
    >
      <Copy aria-hidden="true" />
    </Button>
  );
}
