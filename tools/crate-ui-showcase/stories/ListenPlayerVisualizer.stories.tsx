import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerVisualizerExample } from "../reviews/PlayerVisualizerReview";
import { SettingsFixtureProvider } from "../reviews/SettingsFixtureProvider";
const meta = {
  id: "listen-player-visualizer",
  title: "Listen/Player/Visualizer and Analysis",
  component: PlayerVisualizerExample,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The actual VisualizerSettingsPanel composes InstrumentPanel, accent MonoLabel, FormField, Switch, Slider, Readout, StatusDot and Button. Stacked labels retain8px; coarse targets are44px. Baseline settings keep native ranges and steps; adapted readings remain distinct, including real0 and separation precision0.01. CD/cover disable ranges while preserving saved palette/adaptive choices. Waiting analysis stays unknown. Adapted readings expose localized saved/effective values without live announcements. The actual production popover is constrained to its parent and scrolls in short windows. Static rendering invalidates on settings/reset/profile/palette changes and settles directly to the requested values without a frame loop. Production renderer uses real analyser data and keeps its existing artwork scale/palette. Reduced motion, OS preference or Effects off draws one static frame; hidden/inactive stops; resuming reuses the renderer. The unused SpectrumRibbonCanvas and its private drawer are retired after proving no runtime consumers. The review supplies only local config, without audio, API, native operations or persisted preferences. WebGL/real audio rendering remains in Listen; device QA remains separate. Tauri chrome and DevicesH3 are later cuts.",
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
} satisfies Meta<typeof PlayerVisualizerExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Saved: Story = {};
export const Adaptive: Story = { args: { initialScenario: "adaptive" } };
export const Waiting: Story = { args: { initialScenario: "waiting" } };
export const Zero: Story = { args: { initialScenario: "zero" } };
export const Long: Story = { args: { initialScenario: "long" } };
export const Cd: Story = { args: { initialScenario: "cd" } };
export const Cover: Story = { args: { initialScenario: "cover" } };
export const Unavailable: Story = { args: { initialScenario: "unavailable" } };
