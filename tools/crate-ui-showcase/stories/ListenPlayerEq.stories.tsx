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
          "Actual EqualizerPanelView and anchored surface, up to720px within the player column. Compact composition: title, On/Off and close share the first row; Smart, Genre and Adaptive have a stable row of three pills. The ten-band instrument always fits, with12px mono gain values. Narrow instruments keep one rounded numeric row and reveal the precise signed gain when a band is touched/focused; audio and accessible values retain0.5dB precision. Generic presets are visible FilterChip pills in a wrapping group, with bounded vertical scrolling on mobile. One information slot between bands and presets uses the same accent-tinted box and uppercase MonoLabel typography for Smart source/genre, Genre resolution, analysis features, manual presets and loading/unavailable states. Analysis shows its metrics directly, without an Audio Analysis prefix. Information icons align to the first text line, including wrapped content. Only the applied source is shown; there are no mixed badge lists or secondary footer readouts. The common information band formats manual choices as PRESET: JAZZ and taxonomy curves from either Smart or Genre as GENRE TAXONOMY: JAZZ. Inheritance details stay in the tooltip. Library-backed tracks use local genre identity even when their separate global catalog genre is empty. Generic manual presets use the same slot; save/reset remain last. Older APIs show the confirmed current source without a technical server notice. Smart/Genre/Adaptive, saving, reset and capability gates retain their existing authority. OFF bypasses processing, displays a flat inactive curve and retains saved gains for ON; it never removes EQ access. Enabled automatic curves remain directly editable into Custom. Choosing a generic preset leaves and persists manual mode. The same scene uses local callbacks in both preview hosts, with no real audio or requests. Tauri chrome remains pending.",
      },
    },
  },
  decorators: [
    (Story) => (
      <SettingsFixtureProvider>
        <main className="sm:p-8">
          <Story />
        </main>
      </SettingsFixtureProvider>
    ),
  ],
} satisfies Meta<typeof PlayerEqExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Smart: Story = {};
export const SmartGenre: Story = { args: { initialScenario: "smart-genre" } };
export const Genre: Story = { args: { initialScenario: "genre" } };
export const Adaptive: Story = { args: { initialScenario: "adaptive" } };
export const Manual: Story = { args: { initialScenario: "manual" } };
export const Off: Story = { args: { initialScenario: "off" } };
export const Loading: Story = { args: { initialScenario: "loading" } };
export const Unavailable: Story = { args: { initialScenario: "unavailable" } };
export const OlderServer: Story = { args: { initialScenario: "legacy" } };
