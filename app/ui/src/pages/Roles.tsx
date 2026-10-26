import { OpsPageHero } from "@/components/admin/ops-surfaces";
import { api } from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@crate/ui/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";

interface RolePreset {
  slug: string;
  name: string;
  capabilities: string[];
  system: boolean;
}

interface RolesPayload {
  capabilities: string[];
  roles: RolePreset[];
}

function capabilityGroup(capability: string) {
  return capability.split(".")[0] || "other";
}

function groupCapabilities(capabilities: string[]) {
  const groups = new Map<string, string[]>();
  for (const capability of capabilities) {
    const group = capabilityGroup(capability);
    groups.set(group, [...(groups.get(group) ?? []), capability]);
  }
  return [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

export function Roles() {
  const [data, setData] = useState<RolesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const payload = await api<RolesPayload>("/api/auth/roles");
      setData(payload);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const groupedCapabilities = useMemo(
    () => groupCapabilities(data?.capabilities ?? []),
    [data?.capabilities],
  );
  const roles = data?.roles ?? [];
  const capabilities = data?.capabilities ?? [];

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Roles & Permissions"
        description="Compare the system presets against the capabilities they grant."
      />

      {loading ? (
        <LoadingState label="Loading role presets and capabilities" />
      ) : loadError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-8">
            <div>
              <MonoLabel as="h2" tone="accent">
                Permissions unavailable
              </MonoLabel>
              <p role="alert" className="mt-2 text-sm text-text-muted">
                The role and capability catalog could not be loaded.
              </p>
            </div>
            <Button variant="outline" onClick={() => void loadRoles()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <section aria-labelledby="role-presets-heading" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <MonoLabel as="h2" id="role-presets-heading" tone="accent">
                  Preset roles
                </MonoLabel>
                <p className="mt-2 text-sm text-text-muted">
                  These presets are defined by the system. Role editing is not
                  available here.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <InfoBadge>{roles.length} roles</InfoBadge>
                <InfoBadge>{capabilities.length} capabilities</InfoBadge>
              </div>
            </div>

            {roles.length > 0 ? (
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {roles.map((role) => (
                  <article
                    key={role.slug}
                    className="min-w-0 border-t border-border-quiet px-1 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-display text-base font-semibold text-text-primary">
                          {role.name}
                        </h3>
                        <MonoLabel as="div" className="mt-1 break-all">
                          {role.slug}
                        </MonoLabel>
                      </div>
                      <InfoBadge className="shrink-0">
                        {role.capabilities.length} grants
                      </InfoBadge>
                    </div>
                    <p className="mt-3 text-xs text-text-muted">
                      {role.system ? "System preset" : "Custom role"}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="border-t border-border-quiet py-6 text-sm text-text-muted">
                No role presets are currently defined.
              </div>
            )}
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="font-display">Capability matrix</CardTitle>
              <CardDescription>
                Each row is a backend capability. The columns show which presets
                include it; this catalog is read-only.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {groupedCapabilities.length > 0 && roles.length > 0 ? (
                <>
                  <p className="text-xs text-text-muted lg:hidden">
                    Scroll horizontally to compare every role.
                  </p>
                  {groupedCapabilities.map(([group, grouped]) => (
                    <section
                      key={group}
                      aria-labelledby={`capability-group-${group}`}
                      className="min-w-0"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <MonoLabel
                          as="h3"
                          id={`capability-group-${group}`}
                          tone="accent"
                        >
                          {group}
                        </MonoLabel>
                        <InfoBadge>{grouped.length} capabilities</InfoBadge>
                      </div>
                      <div className="max-w-full overflow-x-auto rounded-md border border-border-quiet">
                        <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                          <caption className="sr-only">
                            {group} capabilities by role
                          </caption>
                          <thead className="bg-raised-surface text-text-subtle">
                            <tr>
                              <th
                                scope="col"
                                className="sticky left-0 z-10 min-w-56 border-b border-border-quiet bg-raised-surface px-3 py-3 font-mono text-[10px] uppercase tracking-[0.12em]"
                              >
                                Capability
                              </th>
                              {roles.map((role) => (
                                <th
                                  key={role.slug}
                                  scope="col"
                                  className="min-w-28 border-b border-border-quiet px-3 py-3 text-center font-mono text-[10px] uppercase tracking-[0.12em]"
                                >
                                  {role.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {grouped.map((capability) => (
                              <tr
                                key={capability}
                                className="border-b border-border-quiet-subtle last:border-0"
                              >
                                <th
                                  scope="row"
                                  className="sticky left-0 bg-card px-3 py-3 text-left font-mono text-xs font-normal text-text-primary"
                                >
                                  {capability}
                                </th>
                                {roles.map((role) => {
                                  const granted =
                                    role.capabilities.includes(capability);
                                  return (
                                    <td
                                      key={role.slug}
                                      className="px-3 py-3 text-center"
                                    >
                                      <span
                                        className={`font-mono text-[10px] uppercase tracking-[0.08em] ${granted ? "text-accent-action-hi" : "text-text-subtle"}`}
                                      >
                                        {granted ? "Yes" : "—"}
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </>
              ) : (
                <div className="border-t border-border-quiet py-6 text-sm text-text-muted">
                  No capability data is available for this role catalog.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
