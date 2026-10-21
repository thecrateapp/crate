import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayerOutputExample } from "../reviews/PlayerOutputReview";
import { SettingsFixtureProvider } from "../reviews/SettingsFixtureProvider";
const meta = {
  id: "listen-player-output",
  title: "Listen/Player/Output and Devices",
  component: PlayerOutputExample,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The production output panel and picker use AppPopover, AppMenuButton, FormField, MonoLabel, StatusDot and shared request states. Device/provider capability and playback authority remain in the authenticated runtime adapter. Distinct disconnect/stop Cast actions preserve receiver behavior. Unavailable reasons stay visible; failed providers retain healthy outputs with retry. Loading, retry, pending and empty are separate. The picker supports keyboard navigation, focus return and bounded scrolling on narrow/short screens. The vertical volume slider matches the seek rail at2px with a44px interaction area. Its head/trail/fill share one moving edge. Fine-pointer hover opens it without taking focus; outside/idle closes after2.5s, while dragging or keyboard focus holds it open. Click mutes/restores the last audible volume; coarse pointers open by tap and have a separate mute action. Arrow keys open/focus the slider. Wheel changes volume by3% (Shift:1%) over the icon or popover, consuming page scroll even at endpoints; scrolling elsewhere is unaffected. Level-based non-pulsing glyph glow respects Effects off. The review uses local callbacks with no discovery, audio, native picker or API writes. Physical Cast/Connect/AirPlay/Android routing still requires native/device QA; this review does not certify protocols or add the H3 Devices page.",
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
} satisfies Meta<typeof PlayerOutputExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = {};
export const Cast: Story = { args: { initialScenario: "cast" } };
export const Connect: Story = { args: { initialScenario: "connect" } };
export const Native: Story = { args: { initialScenario: "native" } };
export const Unavailable: Story = { args: { initialScenario: "unavailable" } };
export const Loading: Story = { args: { initialScenario: "loading" } };
export const Failed: Story = { args: { initialScenario: "error" } };
export const Partial: Story = { args: { initialScenario: "partial" } };
export const Empty: Story = { args: { initialScenario: "empty" } };
export const Pending: Story = { args: { initialScenario: "pending" } };
export const Long: Story = { args: { initialScenario: "long" } };
