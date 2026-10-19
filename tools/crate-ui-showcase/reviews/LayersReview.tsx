import { SearchLayersReview } from "./SearchLayersReview";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import {
  AppModal,
  ModalBody,
  ModalFooter,
} from "@crate/ui/primitives/AppModal";
import {
  AppPopover,
  AppMenuButton,
  AppPopoverDivider,
} from "@crate/ui/primitives/AppPopover";
import { AppErrorBoundary } from "@crate/ui/primitives/AppErrorBoundary";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { SkipLink } from "@crate/ui/primitives/SkipLink";
import { FormField } from "@crate/ui/primitives/FormField";
import { Input } from "@crate/ui/shadcn/input";
import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@crate/ui/shadcn/tooltip";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { BackLink } from "@crate/ui/domain/navigation/BackLink";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";

function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormField kind="group" label={label}>
      {(group) => (
        <div {...group} role="group" className="grid min-w-0 gap-4">
          {children}
        </div>
      )}
    </FormField>
  );
}
export function ModalExample() {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState("private");
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open playlist settings</Button>
      <AppModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="Playlist settings"
        description="Local review data. No changes are sent to a server."
        size="md"
        closeDisabled={busy}
        closeOnEscape={!busy}
        closeOnOverlay={!busy}
        panelClassName="flex flex-col"
      >
        <ModalBody className="grid gap-6 p-5">
          <FormField label="Playlist name">
            <Input defaultValue="Costa de noche" />
          </FormField>
          <FormField label="Visibility">
            {(control) => (
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                  {Array.from({ length: 20 }, (_, i) => (
                    <SelectItem key={i} value={`scope-${i}`}>
                      Review scope {i + 1}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Simulate saving" layout="inline">
            <Switch checked={busy} onCheckedChange={setBusy} />
          </FormField>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost">About visibility</Button>
            </TooltipTrigger>
            <TooltipContent>
              Only invited listeners can open a private playlist.
            </TooltipContent>
          </Tooltip>
          <Button variant="outline" onClick={() => setNested(true)}>
            Open nested dialog
          </Button>
          <AppModal
            open={nested}
            onClose={() => setNested(false)}
            title="Nested dialog"
            size="sm"
          >
            <ModalBody className="p-5">
              <p>
                Escape closes this dialog first. Focus returns to its trigger.
              </p>
              <Button onClick={() => setNested(false)}>Done</Button>
            </ModalBody>
          </AppModal>
        </ModalBody>
        <ModalFooter className="flex justify-end gap-3 px-5 py-4">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button loading={busy} onClick={() => setOpen(false)}>
            Save settings
          </Button>
        </ModalFooter>
      </AppModal>
    </>
  );
}
export function PopoverExample() {
  const [selected, setSelected] = useState("No action selected.");
  return (
    <div className="isolate grid max-w-sm gap-4">
      <AppPopover>
        <AppMenuButton onClick={() => setSelected("Added to queue.")}>
          Add to queue
        </AppMenuButton>
        <AppMenuButton disabled>Unavailable action</AppMenuButton>
        <AppPopoverDivider />
        <AppMenuButton
          danger
          onClick={() => setSelected("Removed from collection.")}
        >
          Remove
        </AppMenuButton>
      </AppPopover>
      <output>{selected}</output>
    </div>
  );
}
function FailedContent({ fail }: { fail: boolean }) {
  if (fail) throw new Error("The collection could not be rendered.");
  return <p>Collection restored.</p>;
}
export function BoundaryExample() {
  const [fail, setFail] = useState(false);
  return (
    <div className="grid gap-4">
      <Button variant="outline" onClick={() => setFail(true)}>
        Simulate render failure
      </Button>
      <AppErrorBoundary onReset={() => setFail(false)}>
        <FailedContent fail={fail} />
      </AppErrorBoundary>
    </div>
  );
}
export function SkipExample() {
  return (
    <>
      <SkipLink targetId="skip-example-main">Skip to sample content</SkipLink>
      <p>Tab to reveal the skip link, then activate it.</p>
      <main id="skip-example-main" tabIndex={-1}>
        Sample content
      </main>
    </>
  );
}
function Scene() {
  const [retried, setRetried] = useState(false);
  return (
    <TooltipProvider delayDuration={100}>
      <SkipLink targetId="layers-main">Skip to review content</SkipLink>
      <main
        id="layers-main"
        tabIndex={-1}
        className="mx-auto grid max-w-5xl gap-10 p-6 sm:p-10"
      >
        <PageHeader
          eyebrow="Checkpoint 1AX · Layers, feedback and navigation"
          title="Keep the listener in context."
          subtitle="Real shared components, local fixture data. The approved mockup remains the visual reference."
        />
        <Sample label="AppModal · Select, Tooltip, nested ownership and saving gates">
          <ModalExample />
        </Sample>
        <Sample label="Search · results, recent history, loading, empty and error">
          <SearchLayersReview />
        </Sample>
        <Sample label="AppPopover · solid surface, menu actions and disabled state">
          <PopoverExample />
        </Sample>
        <Sample label="LoadingState · reserved list and delayed route indicator">
          <div className="grid gap-6 sm:grid-cols-2">
            <LoadingState label="Loading collection" />
            <LoadingState variant="route" label="Loading route" />
          </div>
        </Sample>
        <Sample label="ErrorState · page, compact, unavailable and empty">
          <ErrorState
            variant="page"
            title="The service is unavailable"
            message="Try again without losing your place."
            statusCode={503}
            onRetry={() => setRetried(true)}
          />
          <output>{retried ? "Retry requested." : "No retry yet."}</output>
          <ErrorState
            title="Unable to load the list"
            message="Your filters are preserved."
          />
          <ErrorState kind="notFound" title="Collection not found" />
          <EmptyState
            title="No matching tracks"
            description="Change the current filters to see more tracks."
          />
        </Sample>
        <Sample label="AppErrorBoundary · caught render failure and reset">
          <BoundaryExample />
        </Sample>
        <Sample label="Navigation · text tabs, destination link and shell skip">
          <Tabs defaultValue="albums">
            <TabsList aria-label="Review collection">
              <TabsTrigger value="albums">Albums</TabsTrigger>
              <TabsTrigger value="tracks">Tracks</TabsTrigger>
            </TabsList>
            <TabsContent value="albums">Album collection</TabsContent>
            <TabsContent value="tracks">Track collection</TabsContent>
          </Tabs>
          <BackLink
            to="/library?tab=albums#collection"
            label="Back to library"
          />
          <p>
            The shell skip link is the first keyboard stop. Listen URL-state
            behaviour is checked in its own router fixture.
          </p>
        </Sample>
      </main>
    </TooltipProvider>
  );
}
export function LayersReview() {
  return (
    <MemoryRouter>
      <Scene />
    </MemoryRouter>
  );
}
