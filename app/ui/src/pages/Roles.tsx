import { PageHeaderLayout } from "@/components/layout/PageHeader";
import { useEffect, useMemo, useState } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { Badge } from "@crate/ui/shadcn/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
import { api } from "@/lib/api";

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

export function Roles() {
  const [data, setData] = useState<RolesPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<RolesPayload>("/api/auth/roles")
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const groupedCapabilities = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const capability of data?.capabilities ?? []) {
      const group = capabilityGroup(capability);
      groups.set(group, [...(groups.get(group) ?? []), capability]);
    }
    return [...groups.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [data?.capabilities]);

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <PageHeaderLayout>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
              Roles & Permissions
            </h1>
            <p className="text-sm text-white/55">
              System role presets mapped to explicit backend capabilities.
            </p>
          </div>
        </PageHeaderLayout>
      </section>

      <Card className="border-white/10 bg-panel-surface">
        <CardHeader>
          <CardTitle className="font-sans">Role presets</CardTitle>
          <CardDescription>
            These presets are code-defined for now. Custom role editing can come
            later without changing the authorization model.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div
              role="status"
              aria-label="Loading roles"
              className="py-12 text-sm text-white/45"
            >
              Loading roles...
            </div>
          ) : (
            <div className="space-y-4">
              {(data?.roles ?? []).map((role) => (
                <div
                  key={role.slug}
                  className="rounded-md border border-white/8 bg-black/15 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="crate-form-field min-w-0">
                      <div className="font-sans text-lg font-semibold text-white">
                        {role.name}
                      </div>
                      <MonoLabel as="div" className="break-all text-white/35">
                        {role.slug}
                      </MonoLabel>
                    </div>
                    <Badge variant="outline">
                      {role.capabilities.length} capabilities
                    </Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {role.capabilities.map((capability) => (
                      <Badge
                        key={capability}
                        variant="secondary"
                        className="max-w-full"
                      >
                        {capability}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-panel-surface">
        <CardHeader>
          <CardTitle className="font-sans">Capability catalog</CardTitle>
          <CardDescription>
            The backend primitive is the capability. Roles are just readable
            presets over this list.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groupedCapabilities.map(([group, capabilities]) => (
            <div
              key={group}
              className="crate-form-field min-w-0 rounded-md border border-white/8 bg-black/15 p-4"
            >
              <MonoLabel as="div" className="text-accent-action-hi">
                {group}
              </MonoLabel>
              <div className="flex flex-wrap gap-1.5">
                {capabilities.map((capability) => (
                  <Badge
                    key={capability}
                    variant="outline"
                    className="max-w-full text-white/68"
                  >
                    {capability}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
