import { useState, type ReactNode } from "react";
import { Button } from "@crate/ui/shadcn/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@crate/ui/shadcn/tooltip";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { HeroActionBar } from "@crate/ui/domain/hero/HeroActionBar";
import { FormField } from "@crate/ui/primitives/FormField";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { Heart, Play, Save, MoreHorizontal } from "@crate/ui/icons";

function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormField kind="group" label={label}>
      {(group) => (
        <div
          {...group}
          role="group"
          className="flex flex-wrap items-center gap-3"
        >
          {children}
        </div>
      )}
    </FormField>
  );
}

export function PrimaryHintsReview() {
  const [saved, setSaved] = useState(false);
  return (
    <main className="mx-auto grid max-w-5xl gap-8 p-4 sm:p-8">
      <PageHeader
        title="Primary actions & tooltips"
        subtitle="Accent outline, transparent surface and one custom tooltip."
      />
      <Sample label="Primary · default size">
        <Button onClick={() => setSaved(!saved)} title="Save this playlist">
          <Save aria-hidden="true" />
          {saved ? "Saved" : "Save changes"}
        </Button>
        <Button asChild>
          <a href="#details">Open playlist</a>
        </Button>
        <Button disabled>Unavailable</Button>
        <Button loading>Saving</Button>
      </Sample>
      <Sample label="Primary · sizes">
        <Button size="xs">Extra small</Button>
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg">Large</Button>
      </Sample>
      <Sample label="Hero · primary and secondary">
        <HeroActionBar
          primaryActions={[
            {
              key: "play",
              label: "Play",
              icon: <Play aria-hidden="true" />,
              onClick: () => setSaved(false),
            },
            {
              key: "shuffle",
              label: "Shuffle",
              onClick: () => setSaved(false),
              tone: "neutral",
            },
          ]}
        />
      </Sample>
      <Sample label="Actions · a single custom tooltip">
        <ActionGroup>
          <ActionButton label="Edit this playlist" tooltip="Edit">
            <MoreHorizontal aria-hidden="true" />
          </ActionButton>
        </ActionGroup>
        <ActionIconButton title="More actions" aria-label="More actions">
          <MoreHorizontal aria-hidden="true" />
        </ActionIconButton>
        <FollowHeartButton
          following={false}
          label="Like track"
          title="Like track"
        />
        <IconButton label="Follow artist">
          <Heart aria-hidden="true" />
        </IconButton>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" title="Legacy duplicate">
                Keyboard shortcut
              </Button>
            </TooltipTrigger>
            <TooltipContent>Press Space to play or pause</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Sample>
      <Sample label="Metadata · full detail on hover">
        <InfoBadge title="Lossless · 16 bit · 44.1 kHz" tone="accent">
          FLAC 16/44.1
        </InfoBadge>
        <GenrePill
          item={{ name: "Post-rock", percent: 83, source: "musicbrainz" }}
        />
      </Sample>
      <output aria-live="polite">
        {saved ? "Playlist saved locally" : "Example actions only"}
      </output>
    </main>
  );
}
