import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { useState } from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { HomeGreeting } from "../../../app/listen/src/components/home/HomeGreeting";
import { HeroActions } from "../../../app/listen/src/components/home/HomeHeroActions";
import { LibrarySection } from "../../../app/listen/src/components/library/LibrarySection";
import { LibraryContributionRow } from "../../../app/listen/src/components/library/LibraryContributionRow";
import { ContributionWithdrawDialog } from "../../../app/listen/src/components/library/ContributionWithdrawDialog";
import { LibraryBandcampHeader } from "../../../app/listen/src/pages/LibraryBandcampHeader";
import { CrateIndexGrid } from "../../../app/listen/src/components/crates/CrateIndexGrid";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { Button } from "@crate/ui/shadcn/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@crate/ui/shadcn/select";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";

const i18n = i18next.createInstance();
void i18n
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources: { en: { translation: english } },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });

type ReadState = "ready" | "loading" | "error" | "empty";
export function HomeLibraryExamples() {
  const [following, setFollowing] = useState(false);
  const [event, setEvent] = useState("No action yet");
  const [read, setRead] = useState<ReadState>("ready");
  const [withdraw, setWithdraw] = useState(false);
  const [pending, setPending] = useState(false);
  const [removed, setRemoved] = useState(false);
  return (
    <I18nextProvider i18n={i18n}>
      <div className="space-y-10">
        <FormField
          kind="group"
          label="Home · greeting and conventional hero actions"
        >
          {(group) => (
            <div {...group} role="group">
              <HomeGreeting
                greeting="Good evening, Alex"
                date="Monday, October 19"
              />
              <HeroActions
                hero={{ name: "Chelsea Wolfe" }}
                following={following}
                onPlay={() => setEvent("Play artist requested")}
                onToggleFollow={() => {
                  setFollowing(!following);
                  setEvent("Follow state changed");
                }}
              />
            </div>
          )}
        </FormField>
        <FormField
          kind="group"
          label="Contextual metrics · the MonoLabel contract"
        >
          {(group) => (
            <div {...group} role="group" className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  name: "Chelsea Wolfe",
                  context: "84 plays",
                  shape: "circle" as const,
                },
                {
                  name: "High Vis",
                  context: "2 albums · 0 tracks",
                  shape: "circle" as const,
                },
                {
                  name: "Night music",
                  context: "12 tracks · 52m",
                  shape: "square" as const,
                },
              ].map((item, index) => (
                <EntityCard
                  key={item.name}
                  title={item.name}
                  subtitle={<MonoLabel as="span">{item.context}</MonoLabel>}
                  shape={item.shape}
                  profileSize="tile"
                  artwork={
                    <MediaCover
                      src={IMAGE_SAMPLES[index]}
                      shape={item.shape}
                      alt=""
                      className="size-full"
                    />
                  }
                />
              ))}
            </div>
          )}
        </FormField>
        <LibraryBandcampHeader
          title="Bandcamp library"
          description="Purchases, imports and wishlist from the existing account reads."
          purchases={0}
          importedCount={2}
          wishlistCount={3}
          purchasesLabel="Purchases"
          importedLabel="Imported"
          wishlistLabel="Wishlist"
        />
        <FormField label="Read state">
          {(control) => (
            <Select
              value={read}
              onValueChange={(value) => setRead(value as ReadState)}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["ready", "loading", "error", "empty"] as const).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <LibrarySection
          title="Contributions"
          subtitle="The same production row is used for imported Bandcamp records and contributions."
        >
          {read === "loading" ? (
            <LoadingState label="Loading contributions" />
          ) : read === "error" ? (
            <ErrorState
              message="Unable to load contributions"
              retryLabel="Retry"
              onRetry={() => {
                setRead("ready");
                setEvent("Read retried");
              }}
            />
          ) : read === "empty" || removed ? (
            <EmptyState message="No contributions" />
          ) : (
            <div className="space-y-3">
              <LibraryContributionRow
                title="Night music"
                artist="Chelsea Wolfe"
                artwork={
                  <MediaCover
                    src={IMAGE_SAMPLES[0]}
                    alt=""
                    className="size-14"
                  />
                }
                sourceLabel="Bandcamp"
                exportLabel="Export"
                withdrawLabel="Remove contribution"
                canExport
                onExport={() => setEvent("Export Night music requested")}
                onWithdraw={() => setWithdraw(true)}
              />
              <LibraryContributionRow
                title="Pending record"
                artist="High Vis"
                artwork={
                  <MediaCover
                    src={IMAGE_SAMPLES[1]}
                    alt=""
                    className="size-14"
                  />
                }
                sourceLabel="Upload"
                exportLabel="Export"
                withdrawLabel="Remove contribution"
                canExport={false}
                onExport={() => setEvent("Unexpected disabled export")}
                onWithdraw={() => setWithdraw(true)}
              />
            </div>
          )}
        </LibrarySection>
        <LibrarySection
          title="Your playlists"
          actions={
            <Button
              variant="secondary"
              onClick={() => setEvent("Create playlist requested")}
            >
              New playlist
            </Button>
          }
        >
          <LibrarySection as="h3" title="Owned">
            <EmptyState message="No owned playlists in this fixture" />
          </LibrarySection>
          <LibrarySection as="h3" title="Shared with you">
            <EmptyState message="No shared playlists in this fixture" />
          </LibrarySection>
          <LibrarySection as="h3" title="Followed">
            <EmptyState message="No followed playlists in this fixture" />
          </LibrarySection>
          <LibrarySection as="h3" title="Curated">
            <EmptyState message="No curated playlists in this fixture" />
          </LibrarySection>
        </LibrarySection>
        <FormField
          kind="group"
          label="Crates index · preserved V2 grid geometry"
        >
          {(group) => (
            <div {...group} role="group" className="space-y-4">
              <LibrarySection
                title="Crates"
                subtitle="Geometry slots only; the 3D CrateCard and detail/editor variants remain in the next batch."
              >
                <CrateIndexGrid>
                  {IMAGE_SAMPLES.map((src, index) => (
                    <MediaCover
                      key={src}
                      src={src}
                      alt={`Grid artwork ${index + 1}`}
                    />
                  ))}
                </CrateIndexGrid>
              </LibrarySection>
            </div>
          )}
        </FormField>
        <output
          aria-label="Fixture action"
          className="block"
          aria-live="polite"
        >
          {event}
        </output>
      </div>
      <ContributionWithdrawDialog
        open={withdraw}
        pending={pending}
        title="Remove contribution?"
        body="This fixture only changes local review state."
        onCancel={() => setWithdraw(false)}
        onConfirm={async () => {
          setPending(true);
          await new Promise((resolve) => setTimeout(resolve, 350));
          setPending(false);
          setWithdraw(false);
          setRemoved(true);
          setEvent("Contribution removed in fixture");
        }}
      />
    </I18nextProvider>
  );
}
export function HomeLibraryReview() {
  return (
    <main className="mx-auto max-w-6xl space-y-10 p-4 sm:p-8">
      <PageHeader
        eyebrow="Checkpoint 1BB · first batch · review"
        title="Home and Library"
        subtitle="Actual production views and shared components. Deterministic fixtures; no API, audio or preference writes. Playlist and crate details remain next."
      />
      <HomeLibraryExamples />
    </main>
  );
}
