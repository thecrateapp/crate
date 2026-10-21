import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerEqExample } from "../reviews/PlayerEqReview";
import { SettingsFixtureProvider } from "../reviews/SettingsFixtureProvider";
const meta = {
  id: "listen-player-eq",
  title: "Listen/Player/Equalizer",
  component: PlayerEqExample,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual EqualizerPanelView and anchored surface, widened to720px within the player column. Band values are14px Mono400, independent of statistic headlines. Generic presets remain available through a compact fixed-width Select. Confirmed track curves form a separate concise list; accent marks the actually applied source. Availability is informative, with no new source-selection or engine commands. Smart, Adaptive, Genre, manual edits, saving/reset and capability gates retain their existing authority. Old APIs expose only the confirmed current curve with an explicit compatibility message; a new read-only inventory includes only the authenticated user's personal curve, curator track/album, actual genre, usable analysis and flat fallback. On/Off is a FilterChip beside Smart; OFF bypasses processing, shows a flat inactive display and retains saved gains for ON. The player bar keeps its Equalizer access and any open panel while powered off; power does not disable availability. Off, loading, missing and old-server cases are distinct. Portalled preset content stays inside the dismissal boundary; Escape closes its menu first. Automatic modes do not preselect a remembered manual preset. Failed inventory refreshes withdraw stale candidates; helper curves become current only after resolution. Narrow widths scroll the instrument with readable signed decimals. Enabled curves are directly editable: the first band edit exits Smart/Adaptive/Genre into Custom, preserving the displayed gains and persisting the manual mode. The fixture uses local callbacks and never controls real audio or sends requests. Tauri chrome remains pending.",
      },
    },
  },
  decorators: [
    (Story) => (
      <SettingsFixtureProvider>
        <main className="p-4 sm:p-8">
          <Story />
        </main>
      </SettingsFixtureProvider>
    ),
  ],
} satisfies Meta<typeof PlayerEqExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Smart: Story = {};
export const Manual: Story = { args: { initialScenario: "manual" } };
export const Off: Story = { args: { initialScenario: "off" } };
export const Loading: Story = { args: { initialScenario: "loading" } };
export const Unavailable: Story = { args: { initialScenario: "unavailable" } };
export const OlderServer: Story = { args: { initialScenario: "legacy" } };
