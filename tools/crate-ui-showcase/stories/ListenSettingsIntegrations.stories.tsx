import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsRemainingReview } from "../reviews/SettingsRemainingReview";
const meta = {
  id: "listen-settings-integrations",
  title: "Listen/Settings integrations",
  component: SettingsRemainingReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual Listen-local ShowsLocationView, OpenSubsonicSettingsView, ScrobbleSettingsView, BandcampSettingsView, OfflineSettingsView and ServersSettingsView. Canonical FormField/Select/Input/EntityRow/StatusDot/Button replace local controls and skins; fields retain uppercase MonoLabel and an actual 8 px gap. City suggestions support keyboard/IME and pointer selection. Read errors expose retry, never synthetic disconnected states or zero counts. Existing adapters own API writes, one-time key reveal/copy/confirmation, OAuth/native sessions and local storage. Native server display props exclude credentials. The fixture supports ready/loading/error, linked/disconnected, busy, long labels, native completion, unsupported/empty offline and quota absence. Every action remains local: no credentials, network, persistent preferences or audio.",
      },
    },
  },
} satisfies Meta<typeof SettingsRemainingReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
export const Location: StoryObj<typeof meta> = {
  args: { initialTab: "location" },
};
export const Offline: StoryObj<typeof meta> = {
  args: { initialTab: "offline" },
};
// Keep the existing story id while naming its remaining scope.
export const ServersAndLinks: StoryObj<typeof meta> = {
  name: "Servers",
  args: { initialTab: "navigation" },
};
