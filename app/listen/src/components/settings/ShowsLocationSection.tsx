import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (location && !location.city) detectFromIp(true);
  }, [location?.city]);

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

  async function detectFromIp(silent = false) {
    setDetecting(true);
    try {
      const geo = await api<{
        city: string;
        country: string;
        country_code: string;
        latitude: number;
        longitude: number;
      }>("/api/me/geolocation");
      setCity(geo.city);
      await api("/api/me/location", "PUT", {
        city: geo.city,
        country: geo.country,
        country_code: geo.country_code,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
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
  }

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
      <div className="space-y-3">
        <div className="text-sm font-medium text-text-primary">
          {t("settings.shows.location")}
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => saveMode("fixed")}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
              mode === "fixed"
                ? "border-accent-action/30 bg-accent-action/8"
                : "border-border-quiet/10 bg-text-primary/[0.02] hover:bg-text-primary/[0.04]"
            }`}
          >
            <MapPin
              size={16}
              className={
                mode === "fixed" ? "text-accent-action" : "text-text-primary/40"
              }
            />
            <div className="min-w-0 flex-1">
              <div
                className={`text-sm font-medium ${
                  mode === "fixed" ? "text-accent-action" : "text-text-primary"
                }`}
              >
                {t("settings.shows.fixedCity")}
              </div>
              <div className="text-xs text-text-muted">
                {displayCity
                  ? `${displayCity}${
                      displayCountry ? `, ${displayCountry}` : ""
                    }`
                  : t("settings.shows.notSet")}
              </div>
            </div>
            <div
              className={`h-4 w-4 rounded-full border-2 ${
                mode === "fixed"
                  ? "border-accent-action bg-accent-action"
                  : "border-border-quiet/20"
              }`}
            >
              {mode === "fixed" && (
                <div className="h-full w-full rounded-full bg-text-primary scale-[0.4]" />
              )}
            </div>
          </button>
          <button
            onClick={() => saveMode("near_me")}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
              mode === "near_me"
                ? "border-accent-action/30 bg-accent-action/8"
                : "border-border-quiet/10 bg-text-primary/[0.02] hover:bg-text-primary/[0.04]"
            }`}
          >
            <Navigation
              size={16}
              className={
                mode === "near_me"
                  ? "text-accent-action"
                  : "text-text-primary/40"
              }
            />
            <div className="min-w-0 flex-1">
              <div
                className={`text-sm font-medium ${
                  mode === "near_me"
                    ? "text-accent-action"
                    : "text-text-primary"
                }`}
              >
                {t("settings.shows.nearMe")}
              </div>
              <div className="text-xs text-text-muted">
                {t("settings.shows.nearMeDescription")}
              </div>
            </div>
            <div
              className={`h-4 w-4 rounded-full border-2 ${
                mode === "near_me"
                  ? "border-accent-action bg-accent-action"
                  : "border-border-quiet/20"
              }`}
            >
              {mode === "near_me" && (
                <div className="h-full w-full rounded-full bg-text-primary scale-[0.4]" />
              )}
            </div>
          </button>
        </div>
      </div>

      {mode === "fixed" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-text-muted">
              {t("settings.shows.city")}
            </label>
            <button
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
              type="text"
              value={searchQuery || city}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (!e.target.value) setCity("");
              }}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              placeholder={t("settings.shows.cityPlaceholder")}
              className="w-full h-10 px-3 rounded-lg bg-text-primary/5 border border-border-quiet/10 text-sm text-text-primary outline-none focus:border-accent-action/40 placeholder:text-text-primary/40"
            />
            {searching && (
              <Loader2
                size={14}
                className="absolute right-3 top-3 animate-spin text-text-primary/40"
              />
            )}
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute inset-x-0 top-full z-app-dropdown mt-1 overflow-hidden rounded-xl border border-border-quiet/10 bg-surface-overlay shadow-xl">
                {searchResults.map((result) => (
                  <button
                    key={`${result.latitude}-${result.longitude}`}
                    onMouseDown={() => selectCity(result)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-text-primary/5 transition-colors"
                  >
                    <MapPin
                      size={12}
                      className="flex-shrink-0 text-accent-action/60"
                    />
                    <span>{result.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => saveRadius(r)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                radius === r
                  ? "bg-accent-action text-accent-action-foreground"
                  : "bg-text-primary/5 text-text-muted hover:bg-text-primary/10"
              }`}
            >
              {r} km
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}
