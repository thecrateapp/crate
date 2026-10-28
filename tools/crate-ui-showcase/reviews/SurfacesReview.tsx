import { useState } from "react";
import { Download, Heart, Pencil, RefreshCw } from "@crate/ui/icons";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { FormField } from "@crate/ui/primitives/FormField";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "@crate/ui/shadcn/card";
import { Separator } from "@crate/ui/shadcn/separator";

export function SurfacesReview() {
  const [result, setResult] = useState("No action yet.");
  const [live, setLive] = useState(true);
  const [ruled, setRuled] = useState(true);
  const [query, setQuery] = useState("Costa de noche");
  return (
    <main className="mx-auto max-w-6xl space-y-10 p-6 sm:p-10">
      <header className="grid gap-3">
        <MonoLabel accent="1AT">Checkpoint 1AT · Surfaces</MonoLabel>
        <h1 className="font-display text-3xl font-bold">
          Objects and sections have different roles.
        </h1>
        <p className="text-sm text-text-secondary">
          Shared components, static fixtures and local actions.
        </p>
      </header>
      <div className="grid min-w-0 items-start gap-10 md:grid-cols-2">
        <Card as="article" aria-labelledby="saved-query-title">
          <CardHeader>
            <CardTitle as="h2" id="saved-query-title">
              Saved query
            </CardTitle>
            <CardDescription>
              A standalone object with all card slots.
            </CardDescription>
            <CardAction>
              <ActionGroup label="Query actions">
                <ActionButton
                  label="Edit saved query"
                  tooltip="Edit"
                  onClick={() => setResult("Query editor opened.")}
                >
                  <Pencil aria-hidden="true" />
                </ActionButton>
              </ActionGroup>
            </CardAction>
          </CardHeader>
          <CardContent>
            <FormField label="Query name">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </FormField>
          </CardContent>
          <CardFooter>
            <Button onClick={() => setResult(`Query ${query} run.`)}>
              Run query
            </Button>
            <span className="text-sm text-text-muted">12 tracks</span>
          </CardFooter>
        </Card>
        <InstrumentPanel
          as="section"
          headingLevel={2}
          label={{ children: "Resources" }}
          description="A section with a rule and no filled box."
          meta="Updated 12 seconds ago"
          status={
            <StatusDot
              tone={live ? "on" : "off"}
              label={live ? "Ready" : "Paused"}
            />
          }
          ruled={ruled}
          actions={
            <ActionGroup label="Resource actions">
              <ActionButton
                label="Refresh resources"
                tooltip="Refresh"
                onClick={() => setResult("Resources refreshed.")}
              >
                <RefreshCw aria-hidden="true" />
              </ActionButton>
            </ActionGroup>
          }
        >
          <div className="grid grid-cols-2 gap-6">
            <StatNumber value="280" unit="GB" label="Music" />
            <StatNumber value="12" label="Pending" />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setLive(!live)}>
              {live ? "Pause status" : "Resume status"}
            </Button>
            <Button variant="outline" onClick={() => setRuled(!ruled)}>
              {ruled ? "Hide rule" : "Show rule"}
            </Button>
          </div>
        </InstrumentPanel>
        <Card as="article" aria-labelledby="long-title">
          <CardHeader>
            <CardTitle as="h2" id="long-title">
              Averylongunbrokenobjecttitlethatmustwrapwithoutlayoutoverrides
            </CardTitle>
            <CardDescription>
              Long titles and a right-aligned action share the available width.
            </CardDescription>
            <CardAction>
              <ActionButton label="Edit long object" tooltip="Edit">
                <Pencil aria-hidden="true" />
              </ActionButton>
            </CardAction>
          </CardHeader>
          <CardContent>
            <a href="#record">
              https://example.test/averylongunbrokenrecordpaththatmustremainreadableinaverynarrowcontainer
            </a>
          </CardContent>
          <CardFooter>
            <span className="text-sm text-text-muted">
              Footer text can wrap without widening the card.
            </span>
          </CardFooter>
        </Card>
        <InstrumentPanel
          as="section"
          label={{ children: "Collection notes" }}
          description="A visible caption also names a section without adding a heading."
          ruled={false}
        >
          <p className="text-sm text-text-secondary">
            An unruled panel keeps the same rhythm when an outer structure
            already supplies the separator.
          </p>
        </InstrumentPanel>
      </div>
      <section aria-label="Separators">
        <FormField kind="group" label="Separator · horizontal and vertical">
          {(group) => (
            <div {...group} role="group" className="grid gap-5">
              <Separator
                decorative={false}
                aria-label="Between object and artwork"
              />
              <div className="flex h-20 items-center gap-6">
                <span className="text-sm">First region</span>
                <Separator
                  decorative={false}
                  orientation="vertical"
                  aria-label="Between adjacent regions"
                />
                <span className="text-sm">Second region</span>
              </div>
            </div>
          )}
        </FormField>
      </section>
      <section aria-label="Artwork controls">
        <FormField
          kind="group"
          label="Solid controls on artwork"
          hint="The opaque control surface stays stable over different artwork colors."
        >
          {(group) => (
            <div
              {...group}
              role="group"
              className="relative h-32 overflow-hidden rounded-panel bg-surface-accent-active"
            >
              <div
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1/3 bg-accent-action-hi"
              />
              <div
                aria-hidden="true"
                className="absolute inset-y-0 right-0 w-1/3 bg-accent-action"
              />
              <div className="absolute top-4 right-4 flex gap-3">
                <IconButton
                  label="Follow artwork"
                  variant="card"
                  onClick={() => setResult("Artwork followed.")}
                >
                  <Heart aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="Download artwork"
                  variant="card"
                  onClick={() => setResult("Artwork downloaded.")}
                >
                  <Download aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          )}
        </FormField>
      </section>
      <Card as="article" aria-label="JSON record">
        <CardContent>
          <pre className="overflow-x-auto font-mono text-sm">
            {'{ "tracks": 0, "format": "FLAC" }'}
          </pre>
        </CardContent>
      </Card>
      <output className="block text-sm text-text-secondary" aria-live="polite">
        {result}
      </output>
      <p id="record" className="text-sm">
        Record destination.
      </p>
    </main>
  );
}
