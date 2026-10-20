import { useState } from "react";
import { Merge } from "lucide-react";
import { Button } from "@crate/ui/shadcn/button";
import { useAuth } from "@/contexts/AuthContext";
import { MergeShowsSheet } from "./MergeShowsSheet";

export function MergeShowsButton({ onMerged }: { onMerged: () => void }) {
  const { hasCapability } = useAuth();
  const [open, setOpen] = useState(false);
  if (!hasCapability("curation.shows.write")) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Merge size={14} className="mr-1" />
        Merge duplicates
      </Button>
      <MergeShowsSheet open={open} onOpenChange={setOpen} onMerged={onMerged} />
    </>
  );
}
