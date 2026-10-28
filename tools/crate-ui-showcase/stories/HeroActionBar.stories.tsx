import type { Meta, StoryObj } from "@storybook/react-vite";
import { HeroActionBar } from "@crate/ui/domain/hero/HeroActionBar";
import { Play, Shuffle, Heart, Download } from "@crate/ui/icons";
const meta = {
  id: "components-heroactionbar",
  title: "Components/Actions/HeroActionBar",
  component: HeroActionBar,
  args: {
    mobileMenuPortal: false,
    primaryLabel: "Playback actions",
    secondaryLabel: "Media actions",
    primaryActions: [
      { key: "play", label: "Play", icon: <Play aria-hidden="true" /> },
      {
        key: "shuffle",
        label: "Shuffle",
        tone: "neutral",
        icon: <Shuffle aria-hidden="true" />,
      },
    ],
    secondaryActions: [
      {
        key: "follow",
        label: "Follow",
        active: true,
        icon: <Heart aria-hidden="true" />,
      },
      {
        key: "download",
        label: "Download",
        disabled: true,
        icon: <Download aria-hidden="true" />,
      },
    ],
    menu: { actions: [{ key: "share", label: "Share", onSelect: () => {} }] },
  },
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof HeroActionBar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Busy: Story = {
  args: {
    primaryActions: [
      { key: "play", label: "Preparing playback", loading: true },
    ],
  },
};
export const LongContent: Story = {
  args: {
    primaryActions: [
      { key: "play", label: "Play every track in this translated collection" },
    ],
    secondaryActions: [
      { key: "share", label: "A long translated contextual action" },
    ],
  },
  decorators: [
    (Story) => (
      <div className="showcase-narrow">
        <Story />
      </div>
    ),
  ],
};
export const MobilePortal: Story = { args: { mobileMenuPortal: true } };
export const Empty: Story = {
  args: { primaryActions: [], secondaryActions: [], menu: undefined },
};

export const UnbrokenActions: Story = {
  args: {
    primaryActions: [],
    secondaryActions: [
      {
        key: "translated",
        label:
          "AnExceptionallyLongTranslatedContextualActionWhoseWordsDoNotContainNaturalBreaks",
      },
    ],
    menu: undefined,
  },
  decorators: [
    (Story) => (
      <div className="showcase-narrow">
        <Story />
      </div>
    ),
  ],
};
