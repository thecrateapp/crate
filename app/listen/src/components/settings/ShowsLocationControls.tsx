import { useTranslation } from "react-i18next";

import { CRATE_ICON_SIZE, Loader2, MapPin, Navigation } from "@crate/ui/icons";
import { Input } from "@crate/ui/shadcn/input";

const RADIUS_OPTIONS = [20, 40, 60, 100, 150, 200];

export interface CityResult {
  city: string;
  country: string;
  country_code: string;
  display_name: string;
  latitude: number;
  longitude: number;
}

export function LocationModePicker({
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
          size={CRATE_ICON_SIZE.sm}
          className={active ? "text-accent-action" : "text-text-primary/40"}
        />
      ) : (
        <Navigation
          size={CRATE_ICON_SIZE.sm}
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
        className={` size-4 rounded-full border-2 ${
          active
            ? "border-accent-action bg-accent-action"
            : "border-border-quiet/20"
        }`}
      >
        {active ? (
          <div className=" size-full scale-[0.4] rounded-full bg-text-primary" />
        ) : null}
      </div>
    </button>
  );
}

export function FixedCityPicker({
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
          className="flex items-center gap-1 text-xs link-accent disabled:opacity-50"
        >
          {detecting ? (
            <Loader2 size={CRATE_ICON_SIZE.micro} className="animate-spin" />
          ) : (
            <Navigation size={CRATE_ICON_SIZE.micro} />
          )}
          {t("settings.shows.detectFromIp")}
        </button>
      </div>
      <div className="relative">
        <Input
          id="settings-city"
          type="text"
          value={searchQuery || city}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            if (!event.target.value) setCity("");
          }}
          onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder={t("settings.shows.cityPlaceholder")}
          className="h-10 rounded-lg border-border-quiet/10 bg-text-primary/5 px-3 shadow-none backdrop-blur-none focus-visible:border-accent-action/40 md:text-base"
        />
        {searching ? (
          <Loader2
            size={CRATE_ICON_SIZE.xs}
            className="absolute right-3 top-3 animate-spin text-text-primary/40"
          />
        ) : null}
        {showDropdown && searchResults.length > 0 ? (
          <div className="absolute inset-x-0 top-full z-app-dropdown mt-1 overflow-hidden rounded-xl border border-border-quiet/10 bg-surface-overlay">
            {searchResults.map((result) => (
              <button
                key={`${result.latitude}-${result.longitude}`}
                type="button"
                onMouseDown={() => selectCity(result)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary transition-colors hover:bg-text-primary/5"
              >
                <MapPin
                  size={CRATE_ICON_SIZE.micro}
                  className="shrink-0 text-accent-action/60"
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

export function RadiusPicker({
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
        <div className="rounded-full border border-border-quiet/10 bg-text-primary/[0.03] px-3 py-2 text-xs text-text-primary/70">
          {radius} km
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {RADIUS_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={radius === option}
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
