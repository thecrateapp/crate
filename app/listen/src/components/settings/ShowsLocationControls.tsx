import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Navigation } from "@crate/ui/icons";
import { AppPopover, AppMenuButton } from "@crate/ui/primitives/AppPopover";
import { FormField } from "@crate/ui/primitives/FormField";
import { Input } from "@crate/ui/shadcn/input";
import { Button } from "@crate/ui/shadcn/button";
import { SelectRow } from "./SettingsPrimitives";

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
    <SelectRow
      label={t("settings.shows.location")}
      value={mode}
      onChange={onChange}
      options={[
        {
          value: "fixed",
          label: t("settings.shows.fixedCity"),
          description: displayCity
            ? `${displayCity}${displayCountry ? `, ${displayCountry}` : ""}`
            : t("settings.shows.notSet"),
        },
        {
          value: "near_me",
          label: t("settings.shows.nearMe"),
          description: t("settings.shows.nearMeDescription"),
        },
      ]}
    />
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
  const listId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const expanded =
    focused &&
    dismissedQuery !== searchQuery &&
    showDropdown &&
    searchResults.length > 0;
  const active =
    expanded && activeIndex >= 0 && activeIndex < searchResults.length
      ? activeIndex
      : -1;
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-3">
      <FormField
        className="min-w-0 flex-1 basis-64"
        label={t("settings.shows.city")}
      >
        {(field) => (
          <div className="relative min-w-0">
            <Input
              {...field}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={expanded}
              aria-controls={listId}
              aria-busy={searching || undefined}
              aria-activedescendant={
                active >= 0 ? `${listId}-${active}` : undefined
              }
              value={searchQuery || city}
              placeholder={t("settings.shows.cityPlaceholder")}
              onChange={(event) => {
                setActiveIndex(-1);
                setDismissedQuery(null);
                setSearchQuery(event.target.value);
                if (!event.target.value) setCity("");
              }}
              onFocus={() => {
                setFocused(true);
                setDismissedQuery(null);
                if (searchResults.length) setShowDropdown(true);
              }}
              onBlur={() => {
                setFocused(false);
                setShowDropdown(false);
                setActiveIndex(-1);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229)
                  return;
                if (event.key === "Escape") {
                  if (expanded) event.stopPropagation();
                  setDismissedQuery(searchQuery);
                  setShowDropdown(false);
                  setActiveIndex(-1);
                  return;
                }
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                  searchResults.length
                ) {
                  event.preventDefault();
                  setShowDropdown(true);
                  setActiveIndex((previous) =>
                    event.key === "ArrowDown"
                      ? (previous + 1) % searchResults.length
                      : (previous <= 0 ? searchResults.length : previous) - 1,
                  );
                } else if (event.key === "Enter" && active >= 0) {
                  event.preventDefault();
                  selectCity(searchResults[active]!);
                  setActiveIndex(-1);
                }
              }}
            />
            {expanded ? (
              <AppPopover
                id={listId}
                role="listbox"
                aria-labelledby={field["aria-labelledby"]}
                className="absolute inset-x-0 top-full mt-2 max-h-64 overflow-auto"
              >
                {searchResults.map((result, index) => (
                  <AppMenuButton
                    key={`${result.latitude}-${result.longitude}`}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={active === index}
                    data-active={active === index || undefined}
                    data-highlighted={active === index ? "" : undefined}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      selectCity(result);
                      setActiveIndex(-1);
                    }}
                  >
                    {result.display_name}
                  </AppMenuButton>
                ))}
              </AppPopover>
            ) : null}
          </div>
        )}
      </FormField>
      <Button
        variant="secondary"
        loading={detecting}
        onClick={() => detectFromIp()}
      >
        {!detecting ? (
          <Navigation size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
        ) : null}
        {t("settings.shows.detectFromIp")}
      </Button>
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
    <SelectRow
      label={t("settings.shows.searchRadius")}
      value={String(radius)}
      onChange={(value) => onChange(Number(value))}
      options={[...new Set([...RADIUS_OPTIONS, radius])]
        .sort((a, b) => a - b)
        .map((value) => ({ value: String(value), label: `${value} km` }))}
    />
  );
}
