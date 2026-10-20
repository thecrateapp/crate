import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { LanguageSettingsView } from "./LanguageSettingsView";
import { ConnectDevicesView } from "./ConnectDevicesView";
describe("settings read-only value case", () => {
  it.each([
    "Current language: English",
    "Last seen Oct 20, 2026, 14:29",
    "Desktop app · Linux",
  ])("preserves prose/value case for %s", (text) => {
    renderWithListenProviders(
      <>
        <LanguageSettingsView
          selection="auto"
          activeLanguage="English"
          options={[]}
          onChange={vi.fn()}
        />
        <ConnectDevicesView
          devices={[
            {
              id: "desktop",
              label: "My desktop",
              meta: "Desktop app · Linux",
              lastSeen: "Oct 20, 2026, 14:29",
              current: false,
              active: true,
            },
          ]}
          loading={false}
          error={false}
          enabled
          updating={false}
          forgettingId={null}
          onToggle={vi.fn()}
          onRetry={vi.fn()}
          onRevoke={vi.fn()}
        />
      </>,
    );
    expect(screen.getByText(text).closest(".uppercase")).toBeNull();
  });
});
