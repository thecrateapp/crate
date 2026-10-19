import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageHero } from "@crate/ui/domain/hero/PageHero";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Button } from "@crate/ui/shadcn/button";
const meta = {
  id: "components-pagehero",
  title: "Components/Layout/PageHero",
  component: PageHero,
  args: {
    title: "Luz de octubre",
    subtitle: "Costa Norte",
    meta: [0, "2026", "12 tracks"],
    description:
      "A shared hero preserves artwork, metadata and contextual action placement.",
    eyebrow: <InfoBadge>In library</InfoBadge>,
    artwork: <MediaCover alt="Cover" fallback="CN" className="size-full" />,
    actions: <Button>Open collection</Button>,
  },
  argTypes: {
    height: { control: "radio", options: ["default", "content"] },
    variant: {
      control: "radio",
      options: ["media", "artist", "editorial", "card"],
    },
    titleSize: { control: "radio", options: ["default", "compact"] },
    artwork: { table: { disable: true } },
    background: { table: { disable: true } },
    meta: { table: { disable: true } },
  },
} satisfies Meta<typeof PageHero>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Media: Story = {};
export const Artist: Story = {
  args: { variant: "artist", title: "Costa Norte" },
};
export const Editorial: Story = {
  args: { variant: "editorial", title: "Night listening" },
};
export const Card: Story = { args: { variant: "card", title: "Diego" } };
export const Compact: Story = { args: { titleSize: "compact" } };
export const LongContent: Story = {
  args: {
    title:
      "Averylongunbrokenalbumtitlethatmustremainreadablewithoutcroppingtheheading",
    artwork: undefined,
    actions: undefined,
  },
  decorators: [
    (Story) => (
      <div className="showcase-narrow">
        <Story />
      </div>
    ),
  ],
};
export const Background: Story = {
  args: {
    background: {
      treatment: "vivid",
      render: (className) => (
        <div className={className + " bg-accent-action/10"} />
      ),
    },
  },
};

export const PlainContext: Story = { args: { eyebrow: "Collection" } };

export const ContentHeight: Story = {
  args: {
    height: "content",
    title: "Empty collection",
    artwork: undefined,
    meta: undefined,
    actions: undefined,
    description: undefined,
  },
};
