import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@crate/ui/shadcn/button";
import { useAuth } from "@/contexts/AuthContext";
import { AddShowDialog } from "./AddShowDialog";

export function AddShowButton({ onSaved }: { onSaved: () => void }) {
  const { hasCapability } = useAuth();
  const [open, setOpen] = useState(false);
  if (!hasCapability("curation.shows.write")) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} className="mr-1" />
        Add show
      </Button>
      <AddShowDialog open={open} onOpenChange={setOpen} onSaved={onSaved} />
    </>
  );
}
