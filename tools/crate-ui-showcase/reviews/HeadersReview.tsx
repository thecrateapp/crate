import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { Copy, Download, Heart, Pencil, Play, Save } from "@crate/ui/icons";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { BackLink } from "@crate/ui/domain/navigation/BackLink";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { PageHero } from "@crate/ui/domain/hero/PageHero";
import { HeroActionBar } from "@crate/ui/domain/hero/HeroActionBar";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { FormField } from "@crate/ui/primitives/FormField";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Button } from "@crate/ui/shadcn/button";

function RouteReadout() {
  const location = useLocation();
  return (
    <output aria-label="Current route" className="block font-mono text-xs">
      {location.pathname}
      {location.search}
    </output>
  );
}
function HeadersScene() {
  const [result, setResult] = useState("No action yet.");
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [following, setFollowing] = useState(false);
  return (
    <main className="mx-auto grid max-w-6xl gap-10 p-6 sm:p-10">
      <PageHeader
        eyebrow="Checkpoint 1AU · Headers"
        title="Identity, context and actions."
        subtitle="Real shared components. Local data and callbacks; the approved mockup remains the reference."
      />
      <section aria-label="Page headers">
        <FormField kind="group" label="PageHeader · artwork and metadata">
          {(group) => (
            <div {...group} role="group">
              <PageHeader
                title="Costa de noche"
                back={
                  <BackLink
                    to="/collection?tab=playlists"
                    label="Back to playlists"
                  />
                }
                artwork={
                  <MediaCover
                    alt="Playlist cover"
                    fallback="CN"
                    className="size-28"
                  />
                }
                eyebrow={
                  <>
                    <InfoBadge active>smart</InfoBadge>
                    <InfoBadge>curated</InfoBadge>
                  </>
                }
                subtitle="A playlist keeps its identity alongside compact actions."
                meta={
                  <div className="flex flex-wrap gap-2">
                    <InfoBadge>0 followers</InfoBadge>
                    <InfoBadge>12 tracks</InfoBadge>
                  </div>
                }
                actions={
                  <ActionGroup label="Playlist actions">
                    <ActionButton
                      label="Duplicate Costa de noche"
                      tooltip="Duplicate"
                      onClick={() => setResult("Playlist duplicated.")}
                    >
                      <Copy aria-hidden="true" />
                    </ActionButton>
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
                }
              />
            </div>
          )}
        </FormField>
      </section>
      <section aria-label="Narrow page header">
        <FormField
          kind="group"
          label="PageHeader · narrow container on any viewport"
        >
          {(group) => (
            <div {...group} role="group" className="w-80 max-w-full">
              <PageHeader
                size="md"
                title="Averylongunbrokencollectionnamethatmustnotpushactionsoutofthecontainer"
                subtitle="The container determines the arrangement."
                actions={
                  <ActionButton
                    label="Edit collection"
                    tooltip="Edit"
                    onClick={() => setResult("Collection editor opened.")}
                  >
                    <Pencil aria-hidden="true" />
                  </ActionButton>
                }
              />
            </div>
          )}
        </FormField>
      </section>
      <section aria-label="Section headers">
        <FormField
          kind="group"
          label="SectionHeader · sizes, context and zero count"
        >
          {(group) => (
            <div {...group} role="group" className="grid gap-6">
              <SectionHeader
                eyebrow="Collection"
                title="Recent albums"
                count={0}
                subtitle="Nothing is hidden when the count is zero."
                actionLabel="See all albums"
                onAction={() => setResult("Album list opened.")}
              />
              <SectionHeader
                size="lg"
                as="h3"
                title="Featured artists"
                count={12}
              />
              <SectionHeader
                size="display"
                as="h3"
                title="Longsectionnamethatwrapswithoutconsumerrepairs"
              />
            </div>
          )}
        </FormField>
      </section>
      {(["media", "artist", "editorial", "card"] as const).map((variant) => (
        <section key={variant} aria-label={`${variant} hero example`}>
          <FormField kind="group" label={`PageHero · ${variant}`}>
            {(group) => (
              <div {...group} role="group">
                <PageHero
                  variant={variant}
                  title={`${variant.charAt(0).toUpperCase()}${variant.slice(
                    1,
                  )} story`}
                  eyebrow={<InfoBadge>In library</InfoBadge>}
                  subtitle="Costa Norte"
                  description="Identity and metadata stay readable without replacing the artwork or playback contracts."
                  meta={[0, null, "2026", "12 tracks"]}
                  artwork={
                    <MediaCover
                      alt={`${variant} cover`}
                      fallback="CN"
                      className="size-full"
                    />
                  }
                  actions={
                    <Button
                      variant="outline"
                      onClick={() => setResult(`${variant} opened.`)}
                    >
                      Open {variant}
                    </Button>
                  }
                />
              </div>
            )}
          </FormField>
        </section>
      ))}
      <section aria-label="Compact media hero">
        <FormField
          kind="group"
          label="PageHero · compact title and long content"
        >
          {(group) => (
            <div {...group} role="group">
              <PageHero
                titleSize="compact"
                title="Averylongunbrokenalbumtitlethatmustremainreadableinsideitsownheroatnarrowwidths"
                subtitle="The compact AlbumHero title role belongs to the shared component."
                meta={["0 tracks"]}
              />
            </div>
          )}
        </FormField>
      </section>
      <section aria-label="Content-sized media hero">
        <FormField
          kind="group"
          label="PageHero · content-sized empty collection"
        >
          {(group) => (
            <div {...group} role="group">
              <PageHero
                height="content"
                titleSize="compact"
                title="Empty collection"
                subtitle="A content-sized collection keeps its actions close to the identity."
                meta={["0 albums"]}
              />
            </div>
          )}
        </FormField>
      </section>
      <section aria-label="Hero actions">
        <FormField
          kind="group"
          label="HeroActionBar · playback and contextual actions"
        >
          {(group) => (
            <div {...group} role="group">
              <HeroActionBar
                mobileMenuPortal={false}
                primaryLabel="Playback actions"
                secondaryLabel="Media actions"
                primaryActions={[
                  {
                    key: "play",
                    label: "Play collection",
                    icon: <Play aria-hidden="true" />,
                    loading: playing,
                    onClick: () => {
                      setPlaying(true);
                      setResult("Preparing playback.");
                    },
                  },
                ]}
                secondaryActions={[
                  {
                    key: "follow",
                    label: "Follow",
                    icon: <Heart aria-hidden="true" />,
                    active: following,
                    onClick: () => setFollowing(!following),
                  },
                  {
                    key: "download",
                    label: "Download",
                    icon: <Download aria-hidden="true" />,
                    disabled: true,
                  },
                  {
                    key: "long",
                    label: "A translated action label remains fully readable",
                    onClick: () => setResult("Translated action used."),
                  },
                ]}
                menu={{
                  actions: [
                    {
                      key: "share",
                      label: "Share collection",
                      onSelect: () => setResult("Collection shared."),
                    },
                  ],
                }}
              />
            </div>
          )}
        </FormField>
      </section>
      <section aria-label="Back navigation">
        <FormField kind="group" label="BackLink · text and icon navigation">
          {(group) => (
            <div
              {...group}
              role="group"
              className="flex flex-wrap items-center gap-4"
            >
              <BackLink label="Back to header review" to="/headers" />
              <BackLink
                variant="icon"
                label="Previous view"
                onClick={() => setResult("Previous view requested.")}
              />
            </div>
          )}
        </FormField>
      </section>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={!saving}
          onClick={() => {
            setSaving(false);
            setResult("Playlist saved.");
          }}
        >
          Complete save
        </Button>
        <Button
          variant="outline"
          disabled={!playing}
          onClick={() => {
            setPlaying(false);
            setResult("Playback prepared.");
          }}
        >
          Complete playback
        </Button>
      </div>
      <output
        aria-label="Action result"
        aria-live="polite"
        className="block text-sm"
      >
        {result}
      </output>
      <RouteReadout />
    </main>
  );
}
export function HeadersReview() {
  return (
    <MemoryRouter initialEntries={["/headers"]}>
      <HeadersScene />
    </MemoryRouter>
  );
}
