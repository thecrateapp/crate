import { useState } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { Bot } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/contexts/AuthContext";
import { ActionsTab } from "@/components/ai-agents/ActionsTab";
import { ProvidersTab } from "@/components/ai-agents/ProvidersTab";
import { ProfilesTab } from "@/components/ai-agents/ProfilesTab";
import { ActivityTab } from "@/components/ai-agents/ActivityTab";
import { AI_ROOT } from "@/components/ai-agents/api";
import type { Snapshot } from "@/components/ai-agents/types";
export function AiAgents() {
  const { hasCapability } = useAuth();
  const read = hasCapability("ai.config.read");
  const { data, error, loading, refetch } = useApi<Snapshot>(
    read ? `${AI_ROOT}/snapshot` : null,
  );
  const [tab, setTab] = useState("Actions");
  if (!read) return <p>AI configuration permission required.</p>;
  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Bot />
          AI Agents
        </h1>
        <p className="text-muted-foreground">
          Models, native options and routing for Crate's registered operations.
        </p>
      </header>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          aria-label="AI configuration"
          className="flex h-auto flex-wrap"
        >
          {[
            "Actions",
            "Providers",
            "Models and profiles",
            "Activity and usage",
          ].map((name) => (
            <TabsTrigger key={name} value={name}>
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
        {loading ? <p>Loading AI configuration…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {data ? (
          <TabsContent value={tab}>
            {data.truncated ? (
              <p role="alert">
                Configuration history is truncated. Only loaded versions can be
                selected.
              </p>
            ) : null}
            {tab === "Actions" ? (
              <ActionsTab snapshot={data} refresh={refetch} />
            ) : tab === "Providers" ? (
              <ProvidersTab snapshot={data} refresh={refetch} />
            ) : tab === "Models and profiles" ? (
              <ProfilesTab snapshot={data} refresh={refetch} />
            ) : hasCapability("ai.usage.read") ? (
              <ActivityTab snapshot={data} />
            ) : (
              <p>Usage permission required.</p>
            )}
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
