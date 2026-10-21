import type { Meta, StoryObj } from "@storybook/react-vite";
import { NativeChromeExample } from "../reviews/NativeChromeReview";
import { SettingsFixtureProvider } from "../reviews/SettingsFixtureProvider";
const meta = {
  id: "listen-native-chrome",
  title: "Listen/Platform/Tauri chrome",
  component: NativeChromeExample,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Linux-only window chrome and development diagnostics. The real titlebar view keeps its 36px height, 28px native dot targets and GNOME placement; native controls are an explicit exception to conventional 44px app action buttons. It uses the shared opaque canvas, MonoLabel and custom TooltipHint without browser titles. The runtime adapter retains compositor actions, drag/double-click, saved bounds and resize cleanup. The diagnostic view composes Card, Button and MonoLabel, preserves newest-first entries, bounded scrolling, clear, Escape and focus return; it is mounted only in Tauri development builds. Fixture actions remain local. macOS/Windows retain their operating-system window decorations. This does not certify native audio, OAuth, sleep/resume or physical mobile devices.",
      },
    },
  },
  decorators: [
    (Story) => (
      <SettingsFixtureProvider>
        <div className="p-4 sm:p-8">
          <Story />
        </div>
      </SettingsFixtureProvider>
    ),
  ],
} satisfies Meta<typeof NativeChromeExample>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
