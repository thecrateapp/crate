import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { SettingsFixtureProvider } from "../reviews/SettingsFixtureProvider";
import { StatsOverviewReview } from "../reviews/StatsOverviewReview";
const meta = {
  id: "listen-stats",
  title: "Listen/Stats/Dashboard",
  component: StatsOverviewReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual Stats header, states, metric, artist, highlight, ranked poster, sound profile, stats explorer (real view and panel, local fixture blocks), the listening heatmap band (real view: the now hour on Populated, a hidden grid on Global below three listeners, a flat zero-minute grid on Long and zero) and closing views. Adapters retain API, canonical routes, managed images, playback and context menus. Initial loading reserves geometry; errors retry; cached data persists; unknown analysis is distinct from a confirmed zero. Existing explorer/decade instruments and editorial artwork scale remain. Crate Digging uses the production chapter builder, keyboard/timer/pointer and share summary, with local media/actions only. Search/skeleton loading evidence is in Reviews/1BE/Stats and Digging. Track rows reuse the canonical frame, cover playback control and fixed quality/BPM-key/duration/action slots. Runtime adapters use the actual TrackRow controller with active playback, likes and menus. Movement counts use actual uppercase MonoLabel. Source format/bit depth/sample rate/bitrate/duration are additive API fields; missing source data remains unknown. Removed library tracks keep their history without an enabled Play action. Older servers retain client totals and show a capability message rather than a failed or empty detail. Reviews/1BE/Stats row consistency isolates these cases. No API writes or new instruments.",
      },
    },
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <SettingsFixtureProvider>
          <main className="mx-auto max-w-content p-4 sm:p-8">
            <Story />
          </main>
        </SettingsFixtureProvider>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof StatsOverviewReview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {};
export const Global: Story = { args: { initialScope: "global" } };
export const User: Story = { args: { initialScope: "user" } };
export const Loading: Story = { args: { initialState: "loading" } };
export const Error: Story = { args: { initialState: "error" } };
export const Empty: Story = { args: { initialState: "empty" } };
export const Cached: Story = { args: { initialState: "cached" } };
export const Legacy: Story = { args: { initialState: "legacy" } };
export const LongAndZero: Story = { args: { initialState: "long and zero" } };
export const CrateDigging: Story = { args: { initialDigging: true } };
