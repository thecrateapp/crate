import { useRef, useState } from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { ExtendedPlayerHeaderBar } from "../../../app/listen/src/components/player/ExtendedPlayerHeaderBar";
import { PlayerLyricsSurface } from "../../../app/listen/src/components/player/PlayerLyricsSurface";
import { MemoryRouter } from "react-router";
import { ArtistAlbumGroupFrame } from "../../../app/listen/src/components/artist/ArtistLibraryFrames";
import { ArtistBioProfile } from "@crate/ui/domain/ArtistBioProfile";
import { AppModal } from "@crate/ui/primitives/AppModal";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
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

export function PlayerChromeRefinementsExample() {
  const [mode, setMode] = useState<"cd" | "cover" | "visualizer">("cd");
  const [showEqualizer, setShowEqualizer] = useState(false);
  const [showVizSettings, setShowVizSettings] = useState(false);
  const eqButton = useRef<HTMLButtonElement>(null);
  const vizButton = useRef<HTMLButtonElement>(null);
  return (
    <I18nextProvider i18n={i18n}>
      <FormField
        kind="group"
        label="Player chrome · EQ access, no extra heading"
      >
        {(group) => (
          <div {...group} role="group" className="relative min-h-24">
            <ExtendedPlayerHeaderBar
              t={i18n.t}
              state={{
                equalizerAvailable: true,
                showEqualizer,
                showVizSettings,
                visualizerAllowed: true,
                vizCfg: { surfaceMode: mode },
              }}
              refs={{
                equalizerButtonRef: eqButton,
                vizSettingsButtonRef: vizButton,
              }}
              actions={{
                closeWithFeedback: () => {},
                onSurfaceModeChange: setMode,
                setShowEqualizer,
                setShowVizSettings,
              }}
            />
            <output className="block pt-20" aria-label="Equalizer panel state">
              {showEqualizer ? "Open" : "Closed"}
            </output>
          </div>
        )}
      </FormField>
      <FormField kind="group" label="Fullscreen lyrics · original flat canvas">
        {(group) => (
          <div {...group} role="group" className="flex h-48 min-h-0">
            <PlayerLyricsSurface className="p-4">
              <p className="text-text-primary">
                The lyrics retain their content and seek controls.
              </p>
              <p className="mt-4 text-text-muted">
                The colored background gradient is removed in both fullscreen
                renderers.
              </p>
            </PlayerLyricsSurface>
          </div>
        )}
      </FormField>
    </I18nextProvider>
  );
}

export function ArtistAlbumScaleExample() {
  return (
    <MemoryRouter>
      <ArtistAlbumGroupFrame title="Artist albums · V2 image scale">
        {Array.from({ length: 8 }, (_, index) => (
          <EntityCard
            key={index}
            title={`Album ${index + 1}`}
            subtitle="Sample artist · 2026"
            layout="grid"
            cover={{ src: IMAGE_SAMPLES[index % 2], alt: "" }}
            menuButton="none"
            onOpen={() => {}}
          />
        ))}
      </ArtistAlbumGroupFrame>
    </MemoryRouter>
  );
}

export function ArtistBioWidthExample() {
  const [open, setOpen] = useState(false);
  return (
    <FormField kind="group" label="Artist biography · full modal body width">
      {(group) => (
        <div {...group} role="group">
          <Button onClick={() => setOpen(true)}>Show more</Button>
          <AppModal
            open={open}
            onClose={() => setOpen(false)}
            ariaLabel="Sample artist biography"
            size="xl"
            panelClassName="flex min-h-0 flex-col sm:max-h-[92vh]"
            mobileSafeArea
          >
            <ArtistBioProfile
              artistName="Sample artist"
              photoUrl={IMAGE_SAMPLES[0]}
              bio={
                "The artist biography uses the available modal width. ".repeat(
                  16,
                ) +
                "\n\nA second paragraph keeps its own spacing and remains fully readable."
              }
              bioExpanded
              onClose={() => setOpen(false)}
            />
          </AppModal>
        </div>
      )}
    </FormField>
  );
}

export function ArtistPlayerReview() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 p-4 sm:p-8">
      <PageHeader
        eyebrow="Checkpoint 1BA · review"
        title="Artist and player refinements"
        subtitle="V2 image scale and biography width, restored EQ access and flat fullscreen lyrics."
      />
      <ArtistAlbumScaleExample />
      <ArtistBioWidthExample />
      <PlayerChromeRefinementsExample />
    </div>
  );
}
