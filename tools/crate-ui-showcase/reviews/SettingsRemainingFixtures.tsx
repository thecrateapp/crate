import { useState } from "react";
import { ShowsLocationView } from "../../../app/listen/src/components/settings/ShowsLocationView";
import {
  OpenSubsonicSettingsView,
  type CredentialAction,
  type CredentialNotice,
} from "../../../app/listen/src/components/settings/OpenSubsonicSettingsView";
import { ScrobbleSettingsView } from "../../../app/listen/src/components/settings/ScrobbleSettingsView";
import { BandcampSettingsView } from "../../../app/listen/src/components/settings/BandcampSettingsView";
import { ServersSettingsView } from "../../../app/listen/src/components/settings/ServersSettingsView";
import { OfflineSettingsView } from "../../../app/listen/src/components/settings/OfflineSettingsView";
import { useSettingsOverlay } from "../../../app/listen/src/components/settings/settings-panel-activity";
export type SettingsReadState = "ready" | "loading" | "error";
export interface SettingsFixtureProps {
  countsUnavailable?: boolean;
  read?: SettingsReadState;
  busy?: boolean;
  native?: boolean;
  linked?: boolean;
  long?: boolean;
  onEvent: (message: string) => void;
}
const cities = [
  {
    city: "Madrid",
    country: "Spain",
    country_code: "ES",
    display_name: "Madrid, Spain",
    latitude: 40.4,
    longitude: -3.7,
  },
  {
    city: "Manchester",
    country: "United Kingdom",
    country_code: "GB",
    display_name: "Manchester, United Kingdom",
    latitude: 53.4,
    longitude: -2.2,
  },
];
export function SettingsLocationFixture({
  read = "ready",
  busy = false,
  long = false,
  onEvent,
}: SettingsFixtureProps) {
  const [mode, setMode] = useState<"fixed" | "near_me">("fixed"),
    [city, setCity] = useState("Madrid"),
    [query, setQuery] = useState(""),
    [radius, setRadius] = useState(60),
    [open, setOpen] = useState(false);
  return (
    <ShowsLocationView
      loading={read === "loading"}
      error={read === "error"}
      onRetry={() => onEvent("Location retry requested locally")}
      mode={{
        mode,
        displayCity: city,
        displayCountry: "Spain",
        onChange: (mode) => {
          setMode(mode);
          onEvent(`Location mode: ${mode}`);
        },
      }}
      radius={{
        radius,
        onChange: (radius) => {
          setRadius(radius);
          onEvent(`Radius: ${radius} km`);
        },
      }}
      city={{
        city: long ? "A city with a deliberately long mixed Case name" : city,
        searchQuery: query,
        searchResults:
          query.length >= 2
            ? cities.filter((city) =>
                city.display_name.toLowerCase().includes(query.toLowerCase()),
              )
            : [],
        searching: false,
        detecting: busy,
        showDropdown: open,
        setCity,
        setSearchQuery: (value) => {
          setQuery(value);
          setOpen(true);
        },
        setShowDropdown: setOpen,
        detectFromIp: () => {
          setCity("Madrid");
          setQuery("");
          onEvent("Location detected locally");
        },
        selectCity: (result) => {
          setCity(result.city);
          setQuery("");
          setOpen(false);
          onEvent(`City: ${result.city}`);
        },
      }}
    />
  );
}
export function SettingsConnectionsFixture({
  countsUnavailable = false,
  read = "ready",
  busy = false,
  native = false,
  linked = true,
  long = false,
  onEvent,
}: SettingsFixtureProps) {
  const [configured, setConfigured] = useState(true),
    [secret, setSecret] = useState<string | null>(null),
    [notice, setNotice] = useState<CredentialNotice | null>(null),
    [action, setAction] = useState<CredentialAction>("rotate"),
    [confirm, setConfirm] = useSettingsOverlay();
  const [remote, setRemote] = useState(false),
    [token, setToken] = useState(""),
    [lastfm, setLastfm] = useState(linked),
    [brainz, setBrainz] = useState(false),
    [nativePending, setNativePending] = useState(native);
  const [bandcamp, setBandcamp] = useState(linked),
    [cookie, setCookie] = useState("");
  return (
    <>
      <OpenSubsonicSettingsView
        configured={configured}
        loading={read === "loading"}
        loadError={read === "error"}
        onRetry={() => onEvent("Credential retry requested locally")}
        secret={secret}
        notice={notice}
        error={null}
        busy={busy}
        confirmOpen={confirm}
        confirmingAction={action}
        onConfirmOpenChange={setConfirm}
        onCreate={() => {
          setConfigured(true);
          setSecret("fixture-only-key-not-valid");
          onEvent("Created fixture key locally");
        }}
        onCopy={() => {
          setSecret(null);
          setNotice("copied");
          onEvent("Fixture key copied locally");
        }}
        onHide={() => {
          setSecret(null);
          setNotice("hidden");
        }}
        onRequestConfirmation={(action) => {
          setAction(action);
          setConfirm(true);
        }}
        onConfirm={() => {
          setConfigured(action === "rotate");
          setSecret(action === "rotate" ? "fixture-only-key-not-valid" : null);
          onEvent(`Credential ${action} confirmed locally`);
        }}
      />
      <ScrobbleSettingsView
        loading={read === "loading"}
        loadError={read === "error"}
        onRetry={() => onEvent("Scrobble retry requested locally")}
        status={{
          lastfm: {
            connected: lastfm,
            username: long
              ? "A very long mixed Case listener identity across external services"
              : "Record Collector",
          },
          listenbrainz: { connected: brainz, username: "Record Collector" },
        }}
        remoteScrobblingEnabled={remote}
        savingRemotePreference={busy}
        onRemoteChange={setRemote}
        lbToken={token}
        onTokenChange={setToken}
        connecting={busy ? "listenbrainz" : null}
        nativeLastfmPending={nativePending}
        isTauriRuntime={native}
        onLastfmConnect={() => {
          if (native) setNativePending(true);
          else setLastfm(true);
          onEvent("Last.fm connect requested locally");
        }}
        onNativeComplete={() => {
          setLastfm(true);
          setNativePending(false);
        }}
        onNativeCancel={() => setNativePending(false)}
        onListenBrainzConnect={() => {
          setBrainz(true);
          setToken("");
          onEvent("ListenBrainz connected locally");
        }}
        onDisconnect={(provider) => {
          if (provider === "lastfm") setLastfm(false);
          else setBrainz(false);
          onEvent(`Disconnected locally: ${provider}`);
        }}
      />
      <BandcampSettingsView
        status={{
          connected: bandcamp,
          status: bandcamp ? "connected" : "disconnected",
          bridge_enabled: true,
          display_name: long
            ? "Record Collector with a very long mixed Case account name"
            : "Record Collector",
        }}
        counts={
          countsUnavailable
            ? null
            : { collection: 42, wishlist: 18, following: 9 }
        }
        countsError={countsUnavailable}
        onRetryCounts={() => onEvent("Bandcamp totals retry requested locally")}
        busy={busy ? "sync" : null}
        loading={read === "loading"}
        loadError={read === "error"}
        onRetry={() => onEvent("Bandcamp retry requested locally")}
        isTauriRuntime={native}
        bandcampCookie={cookie}
        setBandcampCookie={setCookie}
        onSync={() => onEvent("Bandcamp sync requested locally")}
        onDisconnect={() => {
          setBandcamp(false);
          onEvent("Bandcamp disconnected locally");
        }}
        onOpenDesktop={() =>
          onEvent("Native Bandcamp window requested locally")
        }
        onConnect={() => {
          setBandcamp(true);
          setCookie("");
          onEvent("Bandcamp connected locally");
        }}
      />
    </>
  );
}
export function SettingsServersFixture({
  long = false,
  onEvent,
}: SettingsFixtureProps) {
  const [servers, setServers] = useState([
      { id: "home", label: "Home server", url: "https://home.example.test" },
      {
        id: "studio",
        label: long
          ? "Studio server with a long mixed Case display name"
          : "Studio server",
        url: "https://studio.example.test",
      },
    ]),
    [current, setCurrent] = useState("home");
  return (
    <ServersSettingsView
      servers={servers}
      currentId={current}
      onSwitch={(id) => {
        setCurrent(id);
        onEvent(`Server switch requested locally: ${id}`);
      }}
      onRemove={(id) => {
        setServers((items) => items.filter((server) => server.id !== id));
        onEvent(`Server removed locally: ${id}`);
      }}
      onAdd={() => onEvent("Add server requested locally")}
    />
  );
}
export function SettingsOfflineFixture({
  busy = false,
  supported = true,
  empty = false,
  quota = true,
  onEvent,
}: SettingsFixtureProps & {
  supported?: boolean;
  empty?: boolean;
  quota?: boolean;
}) {
  return (
    <OfflineSettingsView
      supported={supported}
      syncing={busy}
      summary={
        empty
          ? {
              itemCount: 0,
              readyItemCount: 0,
              errorItemCount: 0,
              trackCount: 0,
              readyTrackCount: 0,
              totalBytes: 0,
            }
          : {
              itemCount: 3,
              readyItemCount: 2,
              errorItemCount: 1,
              trackCount: 10,
              readyTrackCount: 8,
              totalBytes: 268435456,
            }
      }
      storageQuota={quota ? 1073741824 : null}
      bytesText={empty ? "0 B" : "256 MB"}
      quotaText={quota ? "1 GB" : null}
      onSync={() => onEvent("Offline sync requested locally")}
      onClear={() => onEvent("Offline clear requested locally")}
    />
  );
}
