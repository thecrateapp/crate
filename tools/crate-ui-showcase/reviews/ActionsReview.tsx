import { useState } from "react";
import { Copy, Download, Eye, Heart, Save, Trash2 } from "@crate/ui/icons";
import {
  ActionButton,
  ActionGroup,
  ActionLink,
} from "@crate/ui/primitives/ActionGroup";
import {
  ActionIconButton,
  ActionIconLink,
} from "@crate/ui/primitives/ActionIconButton";
import { FormField } from "@crate/ui/primitives/FormField";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button, type ButtonProps } from "@crate/ui/shadcn/button";

const variants: NonNullable<ButtonProps["variant"]>[] = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "link",
  "destructive",
  "danger-soft",
];
export function ActionsReview() {
  const [result, setResult] = useState("No action yet.");
  const [following, setFollowing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(true);
  return (
    <main className="mx-auto max-w-6xl space-y-10 p-6 sm:p-10">
      <header className="grid gap-3">
        <MonoLabel accent="1AS">Checkpoint 1AS · Actions</MonoLabel>
        <h1 className="font-display text-3xl font-bold">
          Actions with one contract.
        </h1>
        <p className="text-sm text-text-secondary">
          Real shared components. Local callbacks only; no library data is
          changed.
        </p>
      </header>
      <section
        aria-label="Playlist actions example"
        className="space-y-4 border-y border-border-quiet py-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-bold">Costa de noche</h2>
            <p className="text-sm text-text-muted">
              A long playlist name keeps its own space alongside these actions.
            </p>
          </div>
          <ActionGroup label="Playlist actions">
            <ActionButton
              label="Duplicate Costa de noche"
              tooltip="Duplicate"
              onClick={() => setResult("Playlist duplicated.")}
            >
              <Copy aria-hidden="true" />
            </ActionButton>
            <ActionLink
              href="#preview-target"
              label="Preview Costa de noche"
              tooltip="Preview"
            >
              <Eye aria-hidden="true" />
            </ActionLink>
            <ActionButton
              label="Save Costa de noche"
              tooltip="Save"
              loading={saving}
              onClick={() => {
                setSaving(true);
                setResult("Saving playlist.");
              }}
            >
              <Save aria-hidden="true" />
            </ActionButton>
          </ActionGroup>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="text-sm">Marea · Costa Norte</span>
          <ActionGroup label="Track actions">
            <ActionButton
              label="Remove Marea"
              tooltip="Remove"
              onClick={() => setResult("Track removed.")}
            >
              <Trash2 aria-hidden="true" />
            </ActionButton>
            <ActionLink
              label="Download Marea"
              tooltip="Download"
              href="#download-target"
              disabled={unavailable}
            >
              <Download aria-hidden="true" />
            </ActionLink>
          </ActionGroup>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setSaving(false)}>
            Complete save
          </Button>
          <Button
            variant="outline"
            onClick={() => setUnavailable(!unavailable)}
          >
            {unavailable ? "Enable download" : "Disable download"}
          </Button>
        </div>
      </section>
      <section aria-label="Text actions">
        <FormField kind="group" label="Button · text actions">
          {(group) => (
            <div {...group} role="group" className="grid gap-4">
              <div className="flex flex-wrap gap-3">
                {variants.map((variant) => (
                  <Button
                    key={variant}
                    variant={variant}
                    onClick={() => setResult(`${variant} action.`)}
                  >
                    {variant}
                  </Button>
                ))}
              </div>
              <form
                className="flex flex-wrap items-center gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  setResult("Form submitted.");
                }}
              >
                <Button type="submit">Submit form</Button>
                <Button size="xs">Compact</Button>
                <Button size="sm">Small</Button>
                <Button size="lg">Large</Button>
                <Button disabled>Disabled</Button>
                <Button loading>Loading</Button>
                <Button asChild>
                  <a href="#preview-target">Enabled text link</a>
                </Button>
                <Button asChild disabled>
                  <a href="#blocked-target">Disabled text link</a>
                </Button>
              </form>
            </div>
          )}
        </FormField>
      </section>
      <section aria-label="Compact icon controls">
        <FormField kind="group" label="IconButton · round controls">
          {(group) => (
            <div {...group} role="group" className="grid gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <IconButton
                  label="Small control"
                  size="sm"
                  onClick={() => setResult("Small control used.")}
                >
                  <Eye aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="Follow artist"
                  aria-pressed={following}
                  onClick={() => setFollowing(!following)}
                >
                  <Heart aria-hidden="true" />
                </IconButton>
                <IconButton label="Large control" size="lg">
                  <Copy aria-hidden="true" />
                </IconButton>
                <IconButton label="Primary control" tone="primary">
                  <Save aria-hidden="true" />
                </IconButton>
                <IconButton label="Danger control" tone="danger">
                  <Trash2 aria-hidden="true" />
                </IconButton>
                <IconButton label="Disabled control" disabled>
                  <Save aria-hidden="true" />
                </IconButton>
                <IconButton label="Busy control" loading>
                  <Save aria-hidden="true" />
                </IconButton>
                <IconButton label="Artwork control" variant="card">
                  <Heart aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          )}
        </FormField>
      </section>
      <section aria-label="Compatibility actions">
        <FormField
          kind="group"
          label="ActionIcon · compatibility"
          hint="Compatibility row/card controls retain their documented sizes. New compositions use IconButton or ActionGroup."
        >
          {(group) => (
            <div {...group} role="group" className="grid gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <ActionIconButton aria-label="Legacy row">
                  <Eye aria-hidden="true" />
                </ActionIconButton>
                <ActionIconButton aria-label="Legacy card" variant="card">
                  <Heart aria-hidden="true" />
                </ActionIconButton>
                <ActionIconLink href="#preview-target" aria-label="Legacy link">
                  <Eye aria-hidden="true" />
                </ActionIconLink>
                <ActionIconLink
                  href="#blocked-target"
                  disabled
                  aria-label="Disabled legacy link"
                >
                  <Download aria-hidden="true" />
                </ActionIconLink>
              </div>
            </div>
          )}
        </FormField>
      </section>
      <output className="block text-sm text-text-secondary" aria-live="polite">
        {result}
      </output>
      <p id="preview-target" className="text-sm">
        Preview destination.
      </p>
      <p id="download-target" className="text-sm">
        Download destination.
      </p>
    </main>
  );
}
