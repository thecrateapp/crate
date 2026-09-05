import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Loader2, MapPin, Navigation } from "@crate/ui/icons";

import { Section } from "@/components/settings/SettingsPrimitives";
import { api } from "@/lib/api";

const RADIUS_OPTIONS = [20, 40, 60, 100, 150, 200];

interface LocationData {
  city: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  show_radius_km: number;
  show_location_mode: string;
}

interface CityResult {
  city: string;
  country: string;
  country_code: string;
  display_name: string;
  latitude: number;
  longitude: number;
}

interface DetectedLocation {
  city: string;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
}

export function ShowsLocationSection() {
  const { t } = useTranslation();
  const [location, setLocation] = useState<LocationData | null>(null);
  const [mode, setMode] = useState<"fixed" | "near_me">("fixed");
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(60);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CityResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    api<LocationData>("/api/me/location")
      .then((data) => {
        setLocation(data);
        setMode((data.show_location_mode as "fixed" | "near_me") || "fixed");
        setCity(data.city || "");
        setRadius(data.show_radius_km || 60);
      })
      .catch(() => {});
  }, []);

  const fetchDetectedLocation =
    useCallback(async (): Promise<DetectedLocation> => {
      const geo = await api<DetectedLocation>("/api/me/geolocation");
      await api("/api/me/location", "PUT", {
        city: geo.city,
        country: geo.country,
        country_code: geo.country_code,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
      return geo;
    }, []);

  useEffect(() => {
    if (!location || location.city) return;
    let cancelled = false;
    setDetecting(true);
    void fetchDetectedLocation()
      .then((geo) => {
        if (cancelled) return;
        setCity(geo.city);
        setLocation((previous) => (previous ? { ...previous, ...geo } : null));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDetecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchDetectedLocation, location]);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      api<CityResult[]>(
        `/api/me/cities/search?q=${encodeURIComponent(searchQuery)}`,
      )
        .then((results) => {
          setSearchResults(results);
          setShowDropdown(true);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const detectFromIp = useCallback(
    async (silent = false) => {
      setDetecting(true);
      try {
        const geo = await fetchDetectedLocation();
        setCity(geo.city);
        setLocation((prev) => (prev ? { ...prev, ...geo } : null));
        if (!silent) {
          toast.success(
            t("settings.shows.toasts.detected", {
              city: geo.city,
              country: geo.country,
            }),
          );
        }
      } catch {
        if (!silent) toast.error(t("settings.shows.toasts.detectFailed"));
      } finally {
        setDetecting(false);
      }
    },
    [fetchDetectedLocation, t],
  );

  function selectCity(result: CityResult) {
    setCity(result.city);
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
    api("/api/me/location", "PUT", {
      city: result.city,
      country: result.country,
      country_code: result.country_code,
      latitude: result.latitude,
      longitude: result.longitude,
    })
      .then(() => {
        setLocation((prev) =>
          prev
            ? {
                ...prev,
                city: result.city,
                country: result.country,
                country_code: result.country_code,
                latitude: result.latitude,
                longitude: result.longitude,
              }
            : null,
        );
        toast.success(
          t("settings.shows.toasts.citySet", { city: result.display_name }),
        );
      })
      .catch(() => toast.error(t("settings.shows.toasts.saveCityFailed")));
  }

  async function saveMode(newMode: "fixed" | "near_me") {
    setMode(newMode);
    try {
      await api("/api/me/location", "PUT", { show_location_mode: newMode });
    } catch {
      toast.error(t("common.toasts.saveFailed"));
    }
  }

  async function saveRadius(newRadius: number) {
    setRadius(newRadius);
    try {
      await api("/api/me/location", "PUT", { show_radius_km: newRadius });
    } catch {
      toast.error(t("common.toasts.saveFailed"));
    }
  }

  const displayCity = city || location?.city;
  const displayCountry = location?.country;

  return (
    <Section
      title={t("settings.shows.title")}
      description={t("settings.shows.description")}
    >
      <LocationModePicker
        mode={mode}
        displayCity={displayCity}
        displayCountry={displayCountry}
        onChange={saveMode}
      />
      {mode === "fixed" ? (
        <FixedCityPicker
          city={city}
          searchQuery={searchQuery}
          searchResults={searchResults}
          searching={searching}
          detecting={detecting}
          showDropdown={showDropdown}
          setCity={setCity}
          setSearchQuery={setSearchQuery}
          setShowDropdown={setShowDropdown}
          detectFromIp={detectFromIp}
          selectCity={selectCity}
        />
      ) : null}
      <RadiusPicker radius={radius} onChange={saveRadius} />
    </Section>
  );
}

function LocationModePicker({
  mode,
  displayCity,
  displayCountry,
  onChange,
}: {
  mode: "fixed" | "near_me";
  displayCity?: string | null;
  displayCountry?: string | null;
  onChange: (mode: "fixed" | "near_me") => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-text-primary">
        {t("settings.shows.location")}
      </div>
      <div className="flex flex-col gap-2">
        <LocationModeOption
          active={mode === "fixed"}
          icon="map"
          title={t("settings.shows.fixedCity")}
          description={
            displayCity
              ? `${displayCity}${displayCountry ? `, ${displayCountry}` : ""}`
              : t("settings.shows.notSet")
          }
          onClick={() => onChange("fixed")}
        />
        <LocationModeOption
          active={mode === "near_me"}
          icon="navigation"
          title={t("settings.shows.nearMe")}
          description={t("settings.shows.nearMeDescription")}
          onClick={() => onChange("near_me")}
        />
      </div>
    </div>
  );
}

function LocationModeOption({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: "map" | "navigation";
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
        active
          ? "border-accent-action/30 bg-accent-action/8"
          : "border-border-quiet/10 bg-text-primary/[0.02] hover:bg-text-primary/[0.04]"
      }`}
    >
      {icon === "map" ? (
        <MapPin
          size={16}
          className={active ? "text-accent-action" : "text-text-primary/40"}
        />
      ) : (
        <Navigation
          size={16}
          className={active ? "text-accent-action" : "text-text-primary/40"}
        />
      )}
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm font-medium ${
            active ? "text-accent-action" : "text-text-primary"
          }`}
        >
          {title}
        </div>
        <div className="text-xs text-text-muted">{description}</div>
      </div>
      <div
        className={`h-4 w-4 rounded-full border-2 ${
          active
            ? "border-accent-action bg-accent-action"
            : "border-border-quiet/20"
        }`}
      >
        {active ? (
          <div className="h-full w-full scale-[0.4] rounded-full bg-text-primary" />
        ) : null}
      </div>
    </button>
  );
}

function FixedCityPicker({
  city,
  searchQuery,
  searchResults,
  searching,
  detecting,
  showDropdown,
  setCity,
  setSearchQuery,
  setShowDropdown,
  detectFromIp,
  selectCity,
}: {
  city: string;
  searchQuery: string;
  searchResults: CityResult[];
  searching: boolean;
  detecting: boolean;
  showDropdown: boolean;
  setCity: (value: string) => void;
  setSearchQuery: (value: string) => void;
  setShowDropdown: (value: boolean) => void;
  detectFromIp: () => void;
  selectCity: (result: CityResult) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="settings-city" className="text-xs text-text-muted">
          {t("settings.shows.city")}
        </label>
        <button
          type="button"
          onClick={() => detectFromIp()}
          disabled={detecting}
          className="flex items-center gap-1 text-[11px] text-accent-action hover:underline disabled:opacity-50"
        >
          {detecting ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Navigation size={10} />
          )}
          {t("settings.shows.detectFromIp")}
        </button>
      </div>
      <div className="relative">
        <input
          id="settings-city"
          type="text"
          value={searchQuery || city}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (!e.target.value) setCity("");
          }}
          onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder={t("settings.shows.cityPlaceholder")}
          className="h-10 w-full rounded-lg border border-border-quiet/10 bg-text-primary/5 px-3 text-sm text-text-primary outline-none placeholder:text-text-primary/40 focus:border-accent-action/40"
        />
        {searching ? (
          <Loader2
            size={14}
            className="absolute right-3 top-3 animate-spin text-text-primary/40"
          />
        ) : null}
        {showDropdown && searchResults.length > 0 ? (
          <div className="absolute inset-x-0 top-full z-app-dropdown mt-1 overflow-hidden rounded-xl border border-border-quiet/10 bg-surface-overlay shadow-xl">
            {searchResults.map((result) => (
              <button
                key={`${result.latitude}-${result.longitude}`}
                type="button"
                onMouseDown={() => selectCity(result)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary transition-colors hover:bg-text-primary/5"
              >
                <MapPin
                  size={12}
                  className="flex-shrink-0 text-accent-action/60"
                />
                <span>{result.display_name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RadiusPicker({
  radius,
  onChange,
}: {
  radius: number;
  onChange: (radius: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-text-primary">
          {t("settings.shows.searchRadius")}
        </div>
        <div className="rounded-full border border-border-quiet/10 bg-text-primary/[0.03] px-2.5 py-1 text-xs text-text-primary/70">
          {radius} km
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {RADIUS_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              radius === option
                ? "bg-accent-action text-accent-action-foreground"
                : "bg-text-primary/5 text-text-muted hover:bg-text-primary/10"
            }`}
          >
            {option} km
          </button>
        ))}
      </div>
    </div>
  );
}
