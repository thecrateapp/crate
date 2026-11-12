import { Button } from "@crate/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@crate/ui/shadcn/dropdown-menu";

import type {
  BackupDestinationHealth,
  BackupPolicySummary,
} from "@/lib/backups";

import type { CheckKind } from "./BackupsOverview";

/**
 * Run now: with no policy it makes a local dump, with one it runs that policy,
 * with several it opens a menu to choose (BG1-12).
 */
export function RunNowButton({
  policies,
  busy,
  onRun,
}: {
  policies: readonly BackupPolicySummary[];
  busy: boolean;
  onRun: (policyId: string | null) => void;
}) {
  if (policies.length < 2)
    return (
      <Button
        type="button"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => onRun(policies[0]?.id ?? null)}
      >
        Run now
      </Button>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" disabled={busy} aria-busy={busy || undefined}>
          Run now
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Run a policy now</DropdownMenuLabel>
        {policies.map((policy) => (
          <DropdownMenuItem key={policy.id} onSelect={() => onRun(policy.id)}>
            {policy.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Verify and Restore drill act on the destination chosen in the menu (BG1-12). */
export function CheckMenuButton({
  kind,
  destinations,
  busy,
  onRun,
}: {
  kind: CheckKind;
  destinations: readonly BackupDestinationHealth[];
  busy: boolean;
  onRun: (kind: CheckKind, destinationId: string) => void;
}) {
  const label = kind === "verify" ? "Verify" : "Restore drill";
  const usable = destinations.filter(
    (d) => d.enabled && d.repository_initialized_at,
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !usable.length}
          aria-busy={busy || undefined}
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          {kind === "verify"
            ? "Verify a destination"
            : "Drill from a destination"}
        </DropdownMenuLabel>
        {usable.map((destination) => (
          <DropdownMenuItem
            key={destination.id}
            onSelect={() => onRun(kind, destination.id)}
          >
            {destination.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
