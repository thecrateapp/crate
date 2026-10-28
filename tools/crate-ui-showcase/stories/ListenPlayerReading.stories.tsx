import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerReadingExample } from "../reviews/PlayerReadingReview";
import { SettingsFixtureProvider } from "../reviews/SettingsFixtureProvider";
const meta = {
  id: "listen-player-reading",
  title: "Listen/Player/Lyrics and Info",
  component: PlayerReadingExample,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The production Lyrics content (drawer and fullscreen) and Info views. Adapters retain requests, managed artwork, canonical navigation and playback authority. Synced lyrics retain their Bricolage typography, active underline, seek, reduced motion and progress-only clock leaf; plain text preserves case and whitespace. Full-width loading, retryable failures and unavailable content are distinct. Info composes actual InstrumentPanel, MonoLabel, StatNumber, Meter and full QualityBadge shared with the player; source quality remains explicit in Source & Dynamics; confirmed zero is different from missing analysis. Source loudness/dynamics are shown once. Mood scores use actual GenrePill with percentages; existing Bliss data is preserved; no new instruments or playback provenance is inferred. Cover geometry stays96/112px. Local fixture actions never start playback or call APIs. Use the controls to inspect long, partial, zero and request states. Only synced fullscreen text is masked; plain/request states remain fully visible. The plain host removes Card inheritance to verify timed text wrapping belongs to the lyrics component.",
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
} satisfies Meta<typeof PlayerReadingExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Synced: Story = {};
export const Plain: Story = { args: { initialLyrics: "plain" } };
export const Loading: Story = {
  args: { initialLyrics: "loading", initialInfo: "loading" },
};
export const Failed: Story = {
  args: { initialLyrics: "error", initialInfo: "error" },
};
export const Unavailable: Story = {
  args: { initialLyrics: "empty", initialInfo: "empty" },
};
export const Partial: Story = { args: { initialInfo: "partial" } };
export const Zero: Story = { args: { initialInfo: "zero" } };
export const Long: Story = {
  args: { initialInfo: "long", initialLyrics: "plain" },
};

export const Delivery: Story = { args: { initialInfo: "delivery" } };
