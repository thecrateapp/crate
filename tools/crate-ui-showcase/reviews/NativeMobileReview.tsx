import { useEffect, useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Input } from "@crate/ui/shadcn/input";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { MobileShellView } from "../../../app/listen/src/components/layout/MobileShellView";
import { TopBarView } from "../../../app/listen/src/components/layout/TopBarView";
import { MobileNavigationView } from "../../../app/listen/src/components/layout/ListenNavigation";
import {
  listenNavigationItems,
  collectionNavigationItems,
} from "../../../app/listen/src/components/layout/listen-navigation-model";
import { PlayerBarFrame } from "../../../app/listen/src/components/player/bar/PlayerBarFrame";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
import "../../../app/listen/src/components/layout/listen-shell.css";
import "../../../app/listen/src/components/layout/listen-shell-metrics.css";

function MobileGeometry({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [insets, setInsets] = useState(true);
  const [keyboard, setKeyboard] = useState(false);
  const [hasTrack, setHasTrack] = useState(true);
  // Fixture environment only: production receives these values from env() and
  // the Capacitor keyboard plugin. Restore the host when the scene unmounts.
  useEffect(() => {
    const root = document.documentElement;
    const values = {
      "--listen-safe-top": insets ? "44px" : "0px",
      "--listen-safe-bottom": insets ? "34px" : "0px",
      "--listen-keyboard-height": keyboard ? "300px" : "0px",
    };
    const previous = Object.keys(values).map((key) => [
      key,
      root.style.getPropertyValue(key),
    ]);
    Object.entries(values).forEach(([key, value]) =>
      root.style.setProperty(key, value),
    );
    return () =>
      previous.forEach(([key, value]) =>
        value
          ? root.style.setProperty(key!, value)
          : root.style.removeProperty(key!),
      );
  }, [insets, keyboard]);
  return (
    <MobileShellView
      topBar={
        <TopBarView
          backLabel="Return to native review"
          forwardLabel="Forward"
          onBack={() => onClose?.()}
          onForward={() => {}}
          search={null}
          userMenu={null}
          hideMobileActions
        />
      }
      player={
        hasTrack ? (
          <PlayerBarFrame isDesktop={false}>
            <MonoLabel>Player space · local fixture</MonoLabel>
          </PlayerBarFrame>
        ) : null
      }
      bottomNav={
        <MobileNavigationView
          items={listenNavigationItems(t, true)}
          sections={collectionNavigationItems(t, true, location)}
          collectionLabel="Collection"
          closeLabel="Close"
          collectionActive={location.pathname.startsWith("/collection")}
          hasTrack={hasTrack}
        />
      }
      collectionActive={false}
      hasTrack={hasTrack}
      headerScrolled={false}
      homeMobileOverlay={false}
      homePage={false}
      mobileContentPadClass="py-4 pt-[var(--listen-mobile-page-top)]"
      overlayHeader={false}
      headerChromeClass="bg-surface-chrome border-b border-border-quiet"
    >
      <div className="grid min-w-0 gap-6">
        <PageHeader
          title="Capacitor shell"
          subtitle="Actual mobile shell and navigation. Simulated safe areas and keyboard clearance; no native plugin or audio is started."
        />
        <div className="flex flex-wrap gap-4">
          <FormField label="Safe areas" layout="inline">
            <Checkbox
              checked={insets}
              onCheckedChange={(value) => setInsets(value === true)}
              aria-label="Safe areas"
            />
          </FormField>
          <FormField label="Keyboard clearance" layout="inline">
            <Checkbox
              checked={keyboard}
              onCheckedChange={(value) => setKeyboard(value === true)}
              aria-label="Keyboard clearance"
            />
          </FormField>
          <FormField label="Player space" layout="inline">
            <Checkbox
              checked={hasTrack}
              onCheckedChange={(value) => setHasTrack(value === true)}
              aria-label="Player space"
            />
          </FormField>
        </div>
        <FormField label="Focused field">
          {(field) => (
            <Input {...field} placeholder="Type without sending data" />
          )}
        </FormField>
        <p className="m-0 text-sm text-text-muted">
          Use a mobile viewport. The fixed header, player and navigation keep
          the same metrics as Listen. The keyboard switch reserves scroll space;
          it does not emulate a WebView keyboard.
        </p>
        {Array.from({ length: 4 }, (_, index) => (
          <FormField
            kind="group"
            label={`Content region ${index + 1}`}
            key={index}
          >
            <p role="group" className="m-0 py-4 text-sm text-text-secondary">
              Local content for scrolling and focus checks.
            </p>
          </FormField>
        ))}
        <output
          className="font-mono text-xs break-all"
          aria-label="Mobile route"
        >
          {location.pathname}
        </output>
        <Button onClick={onClose} disabled={!onClose}>
          Back to native review
        </Button>
        <div data-testid="native-content-end">
          <MonoLabel tone="accent">End of content</MonoLabel>
        </div>
      </div>
    </MobileShellView>
  );
}

export function NativeMobileReview({ onClose }: { onClose?: () => void }) {
  return (
    <SettingsFixtureProvider>
      <MemoryRouter initialEntries={["/"]}>
        <MobileGeometry onClose={onClose} />
      </MemoryRouter>
    </SettingsFixtureProvider>
  );
}
