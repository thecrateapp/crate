import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { ShowsLocationView } from "./ShowsLocationView";
import type { CityResult } from "./ShowsLocationControls";
import { api } from "@/lib/api";

interface LocationData {
  city: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  show_radius_km: number;
  show_location_mode: string;
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [mode, setMode] = useState<"fixed" | "near_me">("fixed");
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(60);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CityResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const writePending = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    api<LocationData>("/api/me/location")
      .then((data) => {
        if (!active) return;
        setLocation(data);
        setMode((data.show_location_mode as "fixed" | "near_me") || "fixed");
        setCity(data.city || "");
        setRadius(data.show_radius_km || 60);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshAttempt]);

  const fetchDetectedLocation =
    useCallback(async (): Promise<DetectedLocation> => {
      if (writePending.current) throw new Error("Location update in progress");
      writePending.current = true;
      setSaving(true);
      try {
        const geo = await api<DetectedLocation>("/api/me/geolocation");
        await api("/api/me/location", "PUT", {
          city: geo.city,
          country: geo.country,
          country_code: geo.country_code,
          latitude: geo.latitude,
          longitude: geo.longitude,
        });
        return geo;
      } finally {
        writePending.current = false;
        setSaving(false);
      }
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
    let active = true;
    setSearchResults([]);
    setSearching(false);
    if (searchQuery.length < 2) {
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      void api<CityResult[]>(
        `/api/me/cities/search?q=${encodeURIComponent(searchQuery)}`,
      )
        .then((results) => {
          if (active) {
            setSearchResults(results);
            setShowDropdown(true);
          }
        })
        .catch(() => {
          if (active) setSearchResults([]);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const detectFromIp = useCallback(
    async (silent = false) => {
      if (writePending.current) return;
      setDetecting(true);
      try {
        const geo = await fetchDetectedLocation();
        setCity(geo.city);
        setLocation((prev) => (prev ? { ...prev, ...geo } : null));
        if (!silent) {
          notify.success(
            t("settings.shows.toasts.detected", {
              city: geo.city,
              country: geo.country,
            }),
          );
        }
      } catch {
        if (!silent) notify.error(t("settings.shows.toasts.detectFailed"));
      } finally {
        setDetecting(false);
      }
    },
    [fetchDetectedLocation, t],
  );

  async function selectCity(result: CityResult) {
    if (writePending.current) return;
    writePending.current = true;
    setSaving(true);
    setCity(location?.city || "");
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
    try {
      await api("/api/me/location", "PUT", {
        city: result.city,
        country: result.country,
        country_code: result.country_code,
        latitude: result.latitude,
        longitude: result.longitude,
      });
      setCity(result.city);
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
      notify.success(
        t("settings.shows.toasts.citySet", { city: result.display_name }),
      );
    } catch {
      notify.error(t("settings.shows.toasts.saveCityFailed"));
    } finally {
      writePending.current = false;
      setSaving(false);
    }
  }

  async function saveMode(newMode: "fixed" | "near_me") {
    if (writePending.current) return;
    writePending.current = true;
    setSaving(true);
    try {
      await api("/api/me/location", "PUT", { show_location_mode: newMode });
      setMode(newMode);
    } catch {
      notify.error(t("common.toasts.saveFailed"));
    } finally {
      writePending.current = false;
      setSaving(false);
    }
  }

  async function saveRadius(newRadius: number) {
    if (writePending.current) return;
    writePending.current = true;
    setSaving(true);
    try {
      await api("/api/me/location", "PUT", { show_radius_km: newRadius });
      setRadius(newRadius);
    } catch {
      notify.error(t("common.toasts.saveFailed"));
    } finally {
      writePending.current = false;
      setSaving(false);
    }
  }

  const displayCity = city || location?.city;
  const displayCountry = location?.country;

  return (
    <ShowsLocationView
      loading={loading}
      error={loadError}
      onRetry={() => setRefreshAttempt((value) => value + 1)}
      mode={{
        mode,
        displayCity,
        displayCountry,
        onChange: saveMode,
        disabled: saving || detecting,
      }}
      city={{
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
        disabled: saving || detecting,
      }}
      radius={{ radius, onChange: saveRadius, disabled: saving || detecting }}
    />
  );
}
