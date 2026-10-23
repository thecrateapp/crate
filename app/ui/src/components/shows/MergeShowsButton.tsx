import { useState } from "react";
import { Link } from "@crate/ui/icons";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeaderAction } from "@/components/layout/PageHeader";
import { MergeShowsSheet } from "./MergeShowsSheet";

export function MergeShowsButton({ onMerged }: { onMerged: () => void }) {
  const { hasCapability } = useAuth();
  const [open, setOpen] = useState(false);
  if (!hasCapability("curation.shows.write")) return null;
  return (
    <>
      <PageHeaderAction
        label="Merge duplicates"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Link data-admin-ux="show-merge" aria-hidden="true" />
      </PageHeaderAction>
      <MergeShowsSheet open={open} onOpenChange={setOpen} onMerged={onMerged} />
    </>
  );
}
