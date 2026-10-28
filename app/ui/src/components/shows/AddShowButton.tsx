import { useState } from "react";
import { CalendarPlus } from "@crate/ui/icons";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeaderAction } from "@/components/layout/PageHeader";
import { AddShowSheet } from "./AddShowSheet";

export function AddShowButton({ onSaved }: { onSaved: () => void }) {
  const { hasCapability } = useAuth();
  const [open, setOpen] = useState(false);
  if (!hasCapability("curation.shows.write")) return null;
  return (
    <>
      <PageHeaderAction
        label="Add show"
        type="button"
        onClick={() => setOpen(true)}
      >
        <CalendarPlus data-admin-ux="show-add" aria-hidden="true" />
      </PageHeaderAction>
      <AddShowSheet open={open} onOpenChange={setOpen} onSaved={onSaved} />
    </>
  );
}
