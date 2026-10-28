import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  FixedCityPicker,
  LocationModePicker,
  RadiusPicker,
  type CityResult,
} from "@/components/settings/ShowsLocationControls";
import { I18nProvider } from "@/i18n/I18nProvider";

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider initialLocale="en">{ui}</I18nProvider>);
}

describe("ShowsLocationControls", () => {
  it("reports location mode changes and preserves the selected city context", () => {
    const onChange = vi.fn();

    renderWithI18n(
      <LocationModePicker
        mode="fixed"
        displayCity="Madrid"
        displayCountry="Spain"
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Madrid, Spain")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Location for shows" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("combobox", { name: "Location for shows" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Near me" }));

    expect(onChange).toHaveBeenCalledWith("near_me");
  });

  it("reports radius changes from the extracted picker", () => {
    const onChange = vi.fn();

    renderWithI18n(<RadiusPicker radius={60} onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Search radius" }));
    fireEvent.click(screen.getByRole("option", { name: "100 km" }));

    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("reports a selected city from the search results", () => {
    const result: CityResult = {
      city: "Madrid",
      country: "Spain",
      country_code: "ES",
      display_name: "Madrid, Spain",
      latitude: 40.4168,
      longitude: -3.7038,
    };
    const onSelect = vi.fn();

    renderWithI18n(
      <FixedCityPicker
        city=""
        searchQuery="Mad"
        searchResults={[result]}
        searching={false}
        detecting={false}
        showDropdown
        setCity={vi.fn()}
        setSearchQuery={vi.fn()}
        setShowDropdown={vi.fn()}
        detectFromIp={vi.fn()}
        selectCity={onSelect}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox", { name: "City" }));
    fireEvent.click(screen.getByRole("option", { name: "Madrid, Spain" }));

    const input = screen.getByRole("combobox", { name: "City" });
    expect(input).toHaveAttribute("aria-controls");
    expect(input).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      screen.getByRole("option", { name: "Madrid, Spain" }),
    ).toHaveAttribute("data-active", "true");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(result);
  });
});
