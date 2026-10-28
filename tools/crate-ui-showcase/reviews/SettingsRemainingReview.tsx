import { useState } from "react";
import { MemoryRouter } from "react-router";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { PageHeader } from "@crate/ui/domain/navigation";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { SelectRow } from "../../../app/listen/src/components/settings/SettingsPrimitives";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import {
  SettingsConnectionsFixture,
  SettingsLocationFixture,
  SettingsServersFixture,
  SettingsOfflineFixture,
  type SettingsReadState,
} from "./SettingsRemainingFixtures";
export type SettingsRemainingTab =
  "location" | "connections" | "offline" | "navigation";
export function SettingsRemainingReview({
  initialTab = "connections",
}: { initialTab?: SettingsRemainingTab } = {}) {
  const [tab, setTab] = useState(initialTab),
    [read, setRead] = useState<SettingsReadState>("ready"),
    [runtime, setRuntime] = useState("web"),
    [busy, setBusy] = useState(false),
    [linked, setLinked] = useState(true),
    [countsUnavailable, setCountsUnavailable] = useState(false),
    [long, setLong] = useState(false),
    [empty, setEmpty] = useState(false),
    [supported, setSupported] = useState(true),
    [quota, setQuota] = useState(true),
    [event, setEvent] = useState("No action yet");
  const props = {
    read,
    busy,
    native: runtime === "native",
    linked,
    countsUnavailable,
    long,
    onEvent: setEvent,
  };
  return (
    <MemoryRouter>
      <SettingsFixtureProvider>
        <main className="mx-auto grid max-w-5xl gap-8 px-4 py-6 sm:px-8">
          <MonoLabel
            accent="1BD · Remaining settings"
            meta={["Actual Listen views", "Local fixture actions"]}
          />
          <PageHeader
            title="Settings integrations"
            subtitle="Location, connections, offline storage and native servers."
          />
          <div className="flex flex-wrap items-end gap-4">
            <SelectRow
              label="Read state"
              value={read}
              onChange={setRead}
              options={["ready", "loading", "error"].map((value) => ({
                value: value as SettingsReadState,
                label: value,
              }))}
            />
            <SelectRow
              label="Runtime"
              value={runtime}
              onChange={setRuntime}
              options={[
                { value: "web", label: "Web" },
                { value: "native", label: "Native desktop" },
              ]}
            />
            <FormField label="Busy" layout="inline">
              <Checkbox
                checked={busy}
                onCheckedChange={(value) => setBusy(value === true)}
              />
            </FormField>
            <FormField label="Linked services" layout="inline">
              <Checkbox
                checked={linked}
                onCheckedChange={(value) => setLinked(value === true)}
              />
            </FormField>
            <FormField label="Bandcamp totals unavailable" layout="inline">
              <Checkbox
                checked={countsUnavailable}
                onCheckedChange={(value) =>
                  setCountsUnavailable(value === true)
                }
              />
            </FormField>
            <FormField label="Long values" layout="inline">
              <Checkbox
                checked={long}
                onCheckedChange={(value) => setLong(value === true)}
              />
            </FormField>
          </div>
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as SettingsRemainingTab)}
          >
            <TabsList aria-label="Settings review sections" variant="line">
              <TabsTrigger value="location">Location</TabsTrigger>
              <TabsTrigger value="connections">Connections</TabsTrigger>
              <TabsTrigger value="offline">Offline</TabsTrigger>
              <TabsTrigger value="navigation">Servers</TabsTrigger>
            </TabsList>
            <TabsContent value="location" className="grid gap-8">
              <SettingsLocationFixture {...props} />
            </TabsContent>
            <TabsContent value="connections" className="grid gap-8">
              <SettingsConnectionsFixture
                key={`${runtime}-${linked}`}
                {...props}
              />
            </TabsContent>
            <TabsContent value="offline" className="grid gap-8">
              <div className="flex flex-wrap gap-4">
                {[
                  { label: "Empty mirror", value: empty, set: setEmpty },
                  {
                    label: "Offline supported",
                    value: supported,
                    set: setSupported,
                  },
                  {
                    label: "Browser quota available",
                    value: quota,
                    set: setQuota,
                  },
                ].map(({ label, value, set }) => (
                  <FormField key={label} label={label} layout="inline">
                    <Checkbox
                      checked={value}
                      onCheckedChange={(value) => set(value === true)}
                    />
                  </FormField>
                ))}
              </div>
              <SettingsOfflineFixture
                {...props}
                supported={supported}
                empty={empty}
                quota={quota}
              />
            </TabsContent>
            <TabsContent value="navigation" className="grid gap-8">
              <SettingsServersFixture {...props} />
            </TabsContent>
          </Tabs>
          <MonoLabel role="status" aria-label="Settings fixture event">
            {event}
          </MonoLabel>
        </main>
      </SettingsFixtureProvider>
    </MemoryRouter>
  );
}
