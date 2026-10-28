import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  PageHeader,
  PageHeaderLayout,
} from "@crate/ui/domain/navigation/PageHeader";
import { BackLink } from "@crate/ui/domain/navigation/BackLink";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { Button } from "@crate/ui/shadcn/button";
import { Pencil } from "@crate/ui/icons";
const meta = {
  id: "components-pageheader",
  title: "Components/Layout/PageHeader",
  component: PageHeader,
  args: {
    title: "Settings",
    subtitle: "Manage your listening preferences.",
    eyebrow: "Your account",
  },
  argTypes: {
    size: { control: "radio", options: ["md", "lg"] },
    title: { control: "text" },
    artwork: { table: { disable: true } },
    actions: { table: { disable: true } },
    meta: { table: { disable: true } },
  },
} satisfies Meta<typeof PageHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Compact: Story = { args: { size: "md" } };
export const Artwork: Story = {
  args: {
    title: "Costa de noche",
    eyebrow: <InfoBadge active>curated</InfoBadge>,
    artwork: (
      <MediaCover alt="Playlist cover" fallback="CN" className="size-28" />
    ),
    meta: <InfoBadge>0 followers</InfoBadge>,
    actions: (
      <ActionButton label="Edit playlist" tooltip="Edit">
        <Pencil aria-hidden="true" />
      </ActionButton>
    ),
  },
};
export const LongContent: Story = {
  args: {
    title:
      "Averylongunbrokenpagenamethatmustnotpushitsactionsoutofthecontainer",
    actions: (
      <ActionButton label="Edit collection" tooltip="Edit">
        <Pencil aria-hidden="true" />
      </ActionButton>
    ),
  },
  decorators: [
    (Story) => (
      <div className="showcase-narrow">
        <Story />
      </div>
    ),
  ],
};
export const Back: Story = {
  args: { back: <BackLink label="Back to collection" onClick={() => {}} /> },
};
export const ExistingIdentity: Story = {
  render: () => (
    <PageHeaderLayout
      as="header"
      actions={
        <ActionButton label="Edit identity" tooltip="Edit">
          <Pencil aria-hidden="true" />
        </ActionButton>
      }
    >
      <p>
        Existing rich page identity, preserved by the compatibility adapter.
      </p>
    </PageHeaderLayout>
  ),
};

export const FragmentActions: Story = {
  args: {
    actions: (
      <>
        <Button variant="outline">Export collection</Button>
        <Button variant="outline">Copy link</Button>
      </>
    ),
  },
};
