import { useState } from "react";
import { Button } from "@crate/ui/shadcn/button";
import { useAuth } from "@/contexts/AuthContext";
import { MergeShowsSheet } from "./MergeShowsSheet";

export function MergeShowsButton({ onMerged }: { onMerged: () => void }) {
  const { hasCapability } = useAuth();
  const [open, setOpen] = useState(false);
  if (!hasCapability("curation.shows.write")) return null;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11"
        onClick={() => setOpen(true)}
      >
        Merge duplicates
      </Button>
      <MergeShowsSheet open={open} onOpenChange={setOpen} onMerged={onMerged} />
    </>
  );
}
