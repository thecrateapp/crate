import { FormField } from "@crate/ui/primitives/FormField";
import { Switch } from "@crate/ui/primitives/Switch";

import { useApi } from "@/hooks/use-api";

interface PlaylistCapabilities {
  smart_mix?: { available?: boolean };
}

interface PlaylistTrackRequirementsProps {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** A generation requirement; manually added and locked tracks are preserved. */
export function PlaylistTrackRequirements({
  value,
  onChange,
  disabled = false,
  className,
}: PlaylistTrackRequirementsProps) {
  const { data, loading, error } =
    useApi<PlaylistCapabilities>("/api/capabilities");

  // Do not clear a saved requirement while capabilities are unavailable.
  if (loading || error || data?.smart_mix?.available !== true) return null;

  return (
    <FormField
      className={className}
      label="Full Smart Mix profile only"
      layout="inline"
      hint="Automatically selected tracks must have a current Full Smart Mix profile. Manually added and locked tracks are preserved."
    >
      <Switch checked={value} onCheckedChange={onChange} disabled={disabled} />
    </FormField>
  );
}
