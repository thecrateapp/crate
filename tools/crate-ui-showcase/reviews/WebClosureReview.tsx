import { useState } from "react";
import { WebClosureEvidence } from "./WebClosureEvidence";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@crate/ui/shadcn/tabs";
import {
  PlaybackSettingsView,
  type PlaybackSettingsValue,
} from "../../../app/listen/src/components/settings/PlaybackSettingsView";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import { PlayerEqExample } from "./PlayerEqReview";
import {
  ClosureSample,
  ConfirmationExample,
  EntityMenuExample,
  TouchSheetExample,
  OAuthExample,
  BrandLoadingExample,
  CollectionEmptyExample,
  PlaybackButtonExample,
  FollowExample,
  HairlineProgressExample,
  PullExample,
  NavigationExample,
  CloseControlExample,
  TooltipExample,
} from "./WebClosureSamples";

function PlaybackPair() {
  const [value, setValue] = useState<PlaybackSettingsValue>({
    crossfadeSeconds: 5,
    smartCrossfadeEnabled: true,
    infinitePlaybackEnabled: true,
    smartPlaylistSuggestionsEnabled: true,
    smartPlaylistSuggestionsCadence: 5,
    playbackDeliveryPolicy: "auto",
    equalizerEnabled: true,
  });
  return (
    <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div data-dismissible-layer-boundary>
        <PlaybackSettingsView
          ruled={false}
          value={value}
          onChange={(patch) => setValue((old) => ({ ...old, ...patch }))}
          mobilePlaybackRuntime={false}
          androidNativePlayerEnabled={false}
        />
      </div>
      <PlayerEqExample
        controlledEnabled={value.equalizerEnabled}
        onEnabledChange={(equalizerEnabled) =>
          setValue((old) => ({ ...old, equalizerEnabled }))
        }
      />
    </div>
  );
}
export function WebClosureReview() {
  return (
    <SettingsFixtureProvider>
      <main className="mx-auto grid max-w-7xl gap-8 p-4 sm:p-8">
        <PageHeader
          eyebrow="1BE · Review"
          title="Listen web closure"
          subtitle="Actual components, local callbacks and explicit remaining coverage. No production requests or saved preferences change in this preview."
        />
        <Tabs defaultValue="playback">
          <TabsList
            aria-label="Web closure groups"
            data-dismissible-layer-boundary
          >
            <TabsTrigger value="playback">Playback</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
            <TabsTrigger value="feedback">Feedback</TabsTrigger>
            <TabsTrigger value="navigation">Navigation</TabsTrigger>
            <TabsTrigger value="coverage">Coverage</TabsTrigger>
          </TabsList>
          <TabsContent value="playback">
            <PlaybackPair />
          </TabsContent>
          <TabsContent value="actions">
            <div className="grid min-w-0 gap-8 md:grid-cols-2">
              <ClosureSample label="Confirm removal">
                <ConfirmationExample />
              </ClosureSample>
              <ClosureSample label="Entity actions">
                <EntityMenuExample />
              </ClosureSample>
              <ClosureSample label="OAuth providers">
                <OAuthExample unavailable />
              </ClosureSample>
              <ClosureSample label="Sheet owner">
                <TouchSheetExample />
              </ClosureSample>
              <ClosureSample label="Playback action">
                <PlaybackButtonExample />
              </ClosureSample>
              <ClosureSample label="Follow action">
                <FollowExample />
              </ClosureSample>
              <ClosureSample label="Overlay close">
                <CloseControlExample />
              </ClosureSample>
            </div>
          </TabsContent>
          <TabsContent value="feedback">
            <div className="grid min-w-0 gap-8 md:grid-cols-2">
              <ClosureSample label="Known progress">
                <HairlineProgressExample />
              </ClosureSample>
              <ClosureSample label="Unknown total">
                <HairlineProgressExample indeterminate />
              </ClosureSample>
              <ClosureSample label="Empty collection">
                <CollectionEmptyExample />
              </ClosureSample>
              <ClosureSample label="Pull to refresh">
                <PullExample />
              </ClosureSample>
              <ClosureSample label="Brand startup">
                <BrandLoadingExample />
              </ClosureSample>
            </div>
          </TabsContent>
          <TabsContent value="navigation">
            <div className="grid min-w-0 gap-8 md:grid-cols-2">
              <ClosureSample label="Router navigation">
                <NavigationExample />
              </ClosureSample>
              <ClosureSample label="Contextual help">
                <TooltipExample />
              </ClosureSample>
            </div>
          </TabsContent>
          <TabsContent value="coverage">
            <WebClosureEvidence />
          </TabsContent>
        </Tabs>
      </main>
    </SettingsFixtureProvider>
  );
}
