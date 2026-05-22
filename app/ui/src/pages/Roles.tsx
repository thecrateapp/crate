import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";

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
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_18px_40px_rgba(6,182,212,0.14)]">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Roles & Permissions
            </h1>
            <p className="text-sm text-white/55">
              System role presets mapped to explicit backend capabilities.
            </p>
          </div>
        </div>
      </section>

      <Card className="border-white/10 bg-panel-surface">
        <CardHeader>
          <CardTitle>Role presets</CardTitle>
          <CardDescription>
            These presets are code-defined for now. Custom role editing can come
            later without changing the authorization model.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-sm text-white/45">Loading roles...</div>
          ) : (
            <div className="space-y-4">
              {(data?.roles ?? []).map((role) => (
                <div
                  key={role.slug}
                  className="rounded-md border border-white/8 bg-black/15 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-white">
                        {role.name}
                      </div>
                      <div className="text-xs uppercase tracking-[0.16em] text-white/35">
                        {role.slug}
                      </div>
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
                        className="font-mono text-[11px]"
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
          <CardTitle>Capability catalog</CardTitle>
          <CardDescription>
            The backend primitive is the capability. Roles are just readable
            presets over this list.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {groupedCapabilities.map(([group, capabilities]) => (
            <div
              key={group}
              className="rounded-md border border-white/8 bg-black/15 p-4"
            >
              <div className="mb-3 text-xs uppercase tracking-[0.16em] text-cyan-200">
                {group}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {capabilities.map((capability) => (
                  <Badge
                    key={capability}
                    variant="outline"
                    className="font-mono text-[11px] text-white/68"
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
