import { useEffect, useState } from "react";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { SectionHeader } from "@crate/ui/domain/lists";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Card, CardContent, CardHeader } from "@crate/ui/shadcn/card";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { MoreHorizontal, Play } from "@crate/ui/icons";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
import { TrackRowPlaybackControl } from "../../../app/listen/src/components/cards/TrackRowPlaybackControl";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import hubotLicense from "../assets/font-pairing/hubot-sans/OFL.txt?url";
import monaLicense from "../assets/font-pairing/mona-sans/OFL.txt?url";
import sairaLicense from "../assets/font-pairing/saira/OFL.txt?url";
import anybodyLicense from "../assets/font-pairing/anybody/OFL.txt?url";
import splineLicense from "../assets/font-pairing/spline-sans/OFL.txt?url";
import tekturLicense from "../assets/font-pairing/tektur/OFL.txt?url";
import golosLicense from "../assets/font-pairing/golos-text/OFL.txt?url";
import chakraLicense from "../assets/font-pairing/chakra-petch/OFL.txt?url";
import plexLicense from "../assets/font-pairing/ibm-plex-sans/OFL.txt?url";
import oxaniumLicense from "../assets/font-pairing/oxanium/OFL.txt?url";
import hankenLicense from "../assets/font-pairing/hanken-grotesk/OFL.txt?url";
import unboundedLicense from "../assets/font-pairing/unbounded/OFL.txt?url";
import onestLicense from "../assets/font-pairing/onest/OFL.txt?url";
import "./font-pairing-review.css";

export const FONT_PAIRINGS = [
  {
    id: "bricolage-roboto",
    label: "Grotesque + Roboto",
    display: "Bricolage Grotesque",
    body: "Roboto",
    round: 3,
    direction: "Aprobada · en la app",
  },
  {
    id: "bricolage-plex",
    label: "Grotesque + Plex",
    display: "Bricolage Grotesque",
    body: "IBM Plex Sans",
    round: 2,
    direction: "Aprobada anterior",
  },
  {
    id: "tektur-golos",
    label: "Tektur + Golos",
    display: "Tektur",
    body: "Golos Text",
    round: 2,
    direction: "Angular · industrial",
  },
  {
    id: "chakra-plex",
    label: "Chakra + Plex",
    display: "Chakra Petch",
    body: "IBM Plex Sans",
    round: 2,
    direction: "Técnica · ligera",
  },
  {
    id: "oxanium-hanken",
    label: "Oxanium + Hanken",
    display: "Oxanium",
    body: "Hanken Grotesk",
    round: 2,
    direction: "Geométrica · digital",
  },
  {
    id: "unbounded-onest",
    label: "Unbounded + Onest",
    display: "Unbounded",
    body: "Onest",
    round: 2,
    direction: "Ancha · electrónica",
  },
  {
    id: "current",
    label: "Anterior",
    display: "Bricolage Grotesque",
    body: "Poppins",
    round: 1,
    direction: "Referencia original",
  },
  {
    id: "hubot-mona",
    label: "Hubot + Mona",
    display: "Hubot Sans",
    body: "Mona Sans",
    round: 1,
    direction: "Primera tanda",
  },
  {
    id: "saira",
    label: "Saira",
    display: "Saira",
    body: "Saira",
    round: 1,
    direction: "Primera tanda",
  },
  {
    id: "anybody-spline",
    label: "Anybody + Spline",
    display: "Anybody",
    body: "Spline Sans",
    round: 1,
    direction: "Primera tanda",
  },
] as const;
export type FontPairingId = (typeof FONT_PAIRINGS)[number]["id"];
export type FontPairingSelection = "new" | "all" | FontPairingId;

const FONT_NAMES = [
  "Roboto",
  "Review Hubot Sans",
  "Review Mona Sans",
  "Review Saira",
  "Review Anybody",
  "Review Spline Sans",
  "Review Tektur",
  "Review Golos Text",
  "Review Chakra Petch",
  "Review IBM Plex Sans",
  "Review Oxanium",
  "Review Hanken Grotesk",
  "Review Unbounded",
  "Review Onest",
];
const ACCENTS =
  "Música · L’été · Björk · Für immer · œ Œ ß ẞ · à á ç è é í ï ñ ò ó ú ü";

function useReviewFonts() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    let cancelled = false;
    const loads = FONT_NAMES.flatMap((name) =>
      [400, 700].map(async (weight) => {
        const faces = await document.fonts.load(
          `${weight} 16px "${name}"`,
          ACCENTS,
        );
        if (!faces.length) throw new Error(`Missing review font: ${name}`);
      }),
    );
    void Promise.all(loads).then(
      () => {
        if (!cancelled) setStatus("ready");
      },
      () => {
        if (!cancelled) setStatus("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

function PairingSample({
  pairing,
  playlistName,
  onPlaylistName,
  onAction,
}: {
  pairing: (typeof FONT_PAIRINGS)[number];
  playlistName: string;
  onPlaylistName: (value: string) => void;
  onAction: (value: string) => void;
}) {
  return (
    <Card as="article" aria-label={pairing.label}>
      <CardHeader>
        <MonoLabel as="h2" tone="accent">
          {pairing.label}
        </MonoLabel>
        <MonoLabel>
          {pairing.display} / {pairing.body}
        </MonoLabel>
        <MonoLabel>{pairing.direction}</MonoLabel>
      </CardHeader>
      <CardContent
        className="font-pairing-sample @container grid gap-6"
        data-font-pairing={pairing.id}
      >
        <PageHeader
          title="The Lovecraft Sextet"
          subtitle="Música nocturna para escuchar sin prisa. L’été à Montréal, Für immer y El cant dels ocells."
          meta={<MonoLabel meta={["2026", "8 tracks", "48 min"]} />}
        />
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
          <EntityCard
            compact
            title="Luz de octubre"
            subtitle="Costa Norte"
            menuButton="none"
            truncate={false}
            artwork={
              <MediaCover src={IMAGE_SAMPLES[0]} alt="" className="size-full" />
            }
            onOpen={() => onAction("Abrir Luz de octubre · ejemplo local")}
            meta={<MonoLabel>2026 · 8 tracks</MonoLabel>}
          />
          <div className="grid min-w-0 gap-4">
            <StatNumber value="12.480" label="Plays" size="md" />
            <Button onClick={() => onAction("Play all · ejemplo local")}>
              <Play aria-hidden="true" />
              Play all
            </Button>
          </div>
        </div>
        <div className="grid min-w-0 gap-2">
          <SectionHeader
            title="Favourite artists"
            as="h3"
            actionLabel="View All"
            onAction={() => onAction("View All · ejemplo local")}
          />
          <EntityRow
            title="Einstürzende Neubauten"
            subtitle="Alles in Allem"
            menuButton="none"
            truncate={false}
            shape="circle"
            cover={{ src: IMAGE_SAMPLES[1] }}
            meta={<MonoLabel>84 plays · 12 albums</MonoLabel>}
            onOpen={() => onAction("Abrir artista · ejemplo local")}
          />
        </div>
        <FormField kind="group" label="Track row">
          <TrackRowView
            role="group"
            aria-label="Running Up That Hill"
            onClick={() => onAction("Play track · ejemplo local")}
          >
            <TrackRowContent
              title="Running Up That Hill (A Deal with God)"
              leading={
                <TrackRowPlaybackControl
                  index={1}
                  disabled={false}
                  isActive={false}
                  isPlaying={false}
                  label="Play Running Up That Hill"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAction("Play track · ejemplo local");
                  }}
                  artwork={
                    <MediaCover
                      src={IMAGE_SAMPLES[2]}
                      alt=""
                      className="size-12"
                    />
                  }
                />
              }
              details={
                <div className="truncate text-xs text-text-muted">
                  Kate Bush · Hounds of Love
                </div>
              }
              quality={{
                label: "Hi-Res 24/96",
                tier: "hi-res",
                detail: "FLAC · 24 bit / 96 kHz",
              }}
              tempo="108"
              musicalKey="8A"
              duration="4:57"
              actions={
                <ActionButton
                  label="More track actions"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAction("More actions · ejemplo local");
                  }}
                >
                  <MoreHorizontal aria-hidden="true" />
                </ActionButton>
              }
            />
          </TrackRowView>
        </FormField>
        <FormField label="Playlist name">
          <Input
            value={playlistName}
            onChange={(event) => onPlaylistName(event.target.value)}
          />
        </FormField>
        <MonoLabel>JetBrains Mono · 83 BPM · 8A · 4:57</MonoLabel>
      </CardContent>
    </Card>
  );
}

export function FontPairingReview({
  initialPairing = "new",
}: {
  initialPairing?: FontPairingSelection;
}) {
  const [selection, setSelection] =
    useState<FontPairingSelection>(initialPairing);
  const [playlistName, setPlaylistName] = useState("L’été à Montréal");
  const [action, setAction] = useState("Solo acciones locales");
  const fonts = useReviewFonts();
  const selected = FONT_PAIRINGS.filter(
    (pairing) =>
      selection === "all" ||
      (selection === "new" && pairing.round === 2) ||
      selection === pairing.id,
  );
  return (
    <SettingsFixtureProvider>
      <main className="mx-auto grid max-w-screen-2xl gap-6 p-4 sm:p-6">
        <PageHeader
          eyebrow="1BE · Typography review"
          title="Comparativa tipográfica"
          subtitle="Mismos componentes, tamaños, pesos y contenido. JetBrains Mono se conserva en todas las opciones. Combinación aprobada en Listen y Admin: Bricolage Grotesque para títulos y Roboto para texto; IBM Plex Sans conserva su muestra anterior."
        />
        <FormField label="Combinación" kind="group">
          <SegmentedControl
            as="radio"
            value={selection}
            onValueChange={(value) =>
              setSelection(value as FontPairingSelection)
            }
            items={[
              { value: "new", label: "Nuevas" },
              { value: "all", label: "Todas" },
              ...FONT_PAIRINGS.map((pairing) => ({
                value: pairing.id,
                label: pairing.label,
              })),
            ]}
          />
        </FormField>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <MonoLabel
            as="p"
            tone={fonts === "error" ? "subtle" : "accent"}
            role="status"
            aria-live="polite"
          >
            {fonts === "ready"
              ? "Fuentes locales listas"
              : fonts === "error"
                ? "No se han podido cargar las fuentes de prueba. Recarga el preview."
                : "Cargando fuentes de prueba…"}
          </MonoLabel>
          <output
            className="font-mono text-xs text-text-muted"
            aria-live="polite"
          >
            {action}
          </output>
        </div>
        <div
          data-testid="font-comparison"
          data-fonts={fonts}
          className={
            selection === "all" || selection === "new"
              ? "grid min-w-0 items-start gap-6 lg:grid-cols-2"
              : "mx-auto grid w-full min-w-0 max-w-3xl gap-6"
          }
        >
          {selected.map((pairing) => (
            <PairingSample
              key={pairing.id}
              pairing={pairing}
              playlistName={playlistName}
              onPlaylistName={setPlaylistName}
              onAction={setAction}
            />
          ))}
        </div>
        <FormField label="Licencias de las fuentes de prueba" kind="group">
          <div
            role="group"
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            {[
              ["Tektur", tekturLicense],
              ["Golos Text", golosLicense],
              ["Chakra Petch", chakraLicense],
              ["IBM Plex Sans", plexLicense],
              ["Oxanium", oxaniumLicense],
              ["Hanken Grotesk", hankenLicense],
              ["Unbounded", unboundedLicense],
              ["Onest", onestLicense],
              ["Hubot Sans", hubotLicense],
              ["Mona Sans", monaLicense],
              ["Saira", sairaLicense],
              ["Anybody", anybodyLicense],
              ["Spline Sans", splineLicense],
            ].map(([name, href]) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="link-accent inline-flex min-h-11 items-center"
              >
                <MonoLabel>{name}</MonoLabel>
              </a>
            ))}
          </div>
        </FormField>
      </main>
    </SettingsFixtureProvider>
  );
}
