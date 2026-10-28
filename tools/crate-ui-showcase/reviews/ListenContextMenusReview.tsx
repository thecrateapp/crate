import { useRef, useState } from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { AlbumActionsView } from "../../../app/listen/src/components/album/AlbumActionsView";
import { ArtistHeroActionsView } from "../../../app/listen/src/components/artist/ArtistHeroActionsView";
import { HeroActionBar, type HeroActionMenu } from "@crate/ui/domain/hero";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import { Play, Share2 } from "@crate/ui/icons";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import { ContextMenuExamples } from "./ContextMenuReview";

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

function HeroMenuExample({
  family,
}: {
  family: "Artist" | "Album" | "Playlist" | "Crate" | "Genre";
}) {
  const [event, setEvent] = useState("No action yet");
  const [expanded, setExpanded] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const select = () => setEvent(`${family} action selected locally`);
  const menu: HeroActionMenu = {
    sheetLabel: `${family} actions`,
    header: {
      type: "media",
      title:
        family === "Artist"
          ? "High Vis"
          : family === "Album"
            ? "Blending"
            : `${family} selection`,
      subtitle: `${family} actions`,
      imageUrl: IMAGE_SAMPLES[0],
      imageShape: family === "Artist" ? "circle" : "square",
    },
    actions: [
      {
        key: "play",
        label: `Play ${family.toLowerCase()}`,
        icon: Play,
        onSelect: select,
      },
      {
        key: "share",
        label: `Share ${family.toLowerCase()}`,
        icon: Share2,
        onSelect: select,
      },
      {
        key: "playlist",
        type: "disclosure",
        label: "Add to playlist",
        expanded,
        onToggle: () => setExpanded(!expanded),
        items: [{ key: "night", label: "Night music", onSelect: select }],
      },
      {
        key: "offline",
        label: "Make available offline",
        disabled: true,
        onSelect: select,
      },
      { key: "divider", type: "divider" },
      {
        key: "remove",
        label: `Remove ${family.toLowerCase()}`,
        danger: true,
        onSelect: select,
      },
    ],
  };
  return (
    <FormField kind="group" label={`${family} hero`}>
      {(group) => (
        <section {...group} role="group" className="grid gap-4">
          {family === "Artist" ? (
            <ArtistHeroActionsView
              following={false}
              hasSetlist={false}
              onPlay={select}
              onShuffle={select}
              onArtistRadio={select}
              onToggleFollow={select}
              onShare={select}
              menu={menu}
              mobileMenuPortal={false}
            />
          ) : family === "Album" ? (
            <AlbumActionsView
              actionsRef={actionsRef}
              t={i18n.t}
              menu={menu}
              state={{
                isPreRelease: false,
                canPersistAlbum: true,
                canSaveAlbum: true,
                offlineSupported: false,
                offlineState: "idle",
                offlineBusy: false,
                offlineButtonLabel: "Make available offline",
                offlineStatusDetail: null,
                saved: false,
                remoteOnly: false,
                playerTracksAvailable: true,
              }}
              actions={{
                onAlbumRadio: select,
                onToggleOffline: select,
                onToggleSaved: select,
                onShare: select,
                onPlay: select,
                onShuffle: select,
                onMenuClose: () => {},
              }}
            />
          ) : (
            <HeroActionBar
              moreLabel="More"
              mobileMenuPortal={false}
              menu={menu}
              primaryActions={[{ key: "play", label: "Play", onClick: select }]}
            />
          )}
          <output aria-label={`${family} fixture action`} aria-live="polite">
            {event}
          </output>
        </section>
      )}
    </FormField>
  );
}

export function ListenContextMenusReview() {
  const families = [
    "Tracks",
    "Artist",
    "Album",
    "Playlist",
    "Crate",
    "Genre",
  ] as const;
  return (
    <I18nextProvider i18n={i18n}>
      <main className="mx-auto grid max-w-5xl gap-8 p-4 sm:p-6">
        <PageHeader
          title="Context menus"
          eyebrow="1BE · Solid surfaces"
          subtitle="One solid menu surface for rows and every hero. Real Artist/Album action views and the shared playlist, crate and genre action bar; local fixture actions only."
        />
        <Tabs defaultValue="Tracks">
          <TabsList aria-label="Menu family">
            {families.map((family) => (
              <TabsTrigger value={family} key={family}>
                {family}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="Tracks">
            <ContextMenuExamples />
          </TabsContent>
          {families
            .filter((family) => family !== "Tracks")
            .map((family) => (
              <TabsContent key={family} value={family}>
                <HeroMenuExample family={family} />
              </TabsContent>
            ))}
        </Tabs>
      </main>
    </I18nextProvider>
  );
}
