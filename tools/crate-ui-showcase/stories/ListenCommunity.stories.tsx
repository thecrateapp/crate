import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommunityReview } from "../reviews/CommunityReview";
const meta = {
  id: "listen-community",
  title: "Listen/Community",
  component: CommunityReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual Listen-local directory, public profile, connections and profile-card views. PageHeader, person EntityRow/Avatar, SectionHeader, StatNumber, MonoLabel, FormField/SearchInput and existing feedback/actions own presentation. The app adapters retain authenticated imagery, public API boundaries, follow and collection authority. Slots accept managed artwork and library rows; fixtures substitute local data and callbacks only. Directory search keeps its 250 ms debounce, discards obsolete replies and exposes read retry. Profile cards retain desktop hover/focus and cached reads; own-profile cards hide follow. ProfileAffinity occupies the far-right header slot and uses the existing StatNumber md role, one step above the sm metrics. Social and listening metrics use the same responsive ProfileMetricsGrid (two mobile columns, three desktop columns), with Top sound and identity badges in a separate content row. Names and bios retain their case. No new shared foundation or fictitious Admin consumer. All seven locales keep the production copy; this fixture is English.",
      },
    },
  },
} satisfies Meta<typeof CommunityReview>;
export default meta;
export const Directory: StoryObj<typeof meta> = {};
export const PublicProfile: StoryObj<typeof meta> = {
  args: { initialTab: "profile" },
};
export const Connections: StoryObj<typeof meta> = {
  args: { initialTab: "connections" },
};
export const ProfileCard: StoryObj<typeof meta> = {
  args: { initialTab: "card" },
};
