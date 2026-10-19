import type { Meta, StoryObj } from "@storybook/react-vite";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { RefreshCw } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
const meta = {
  id: "components-instrumentpanel",
  title: "Components/Layout/InstrumentPanel",
  component: InstrumentPanel,
  args: {
    label: { children: "Resources" },
    summary: "Storage: 280 GB.",
    children: <StatNumber value="280" unit="GB" />,
    ruled: true,
  },
  argTypes: {
    label: { table: { disable: true } },
    children: { table: { disable: true } },
    headingLevel: { control: "select", options: [undefined, 2, 3] },
    as: { control: "select", options: ["figure", "section"] },
  },
} satisfies Meta<typeof InstrumentPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {
  args: {
    meta: "Updated 12 seconds ago",
    status: <StatusDot tone="on" label="Ready" />,
  },
};
export const Section: Story = {
  args: {
    as: "section",
    headingLevel: 2,
    summary: undefined,
    description: "Audio and playback preferences.",
    children: <p>Section content.</p>,
  },
};
export const Unruled: Story = { args: { ruled: false } };
export const Actions: Story = {
  args: {
    as: "section",
    headingLevel: 2,
    summary: undefined,
    description: "Current library storage.",
    actions: (
      <ActionGroup>
        <ActionButton label="Refresh resources" tooltip="Refresh">
          <RefreshCw aria-hidden="true" />
        </ActionButton>
      </ActionGroup>
    ),
  },
};
export const LongContent: Story = {
  args: {
    label: {
      children: "Averylongunbrokeninstrumentcaptionthatmustwrapatnarrowwidths",
    },
    meta: "Updatedafterthemostrecentlibrarysnapshot",
    status: <StatusDot label="Waiting for worker availability" />,
    summary: undefined,
  },
  decorators: [
    (Story) => (
      <div className="showcase-narrow">
        <Story />
      </div>
    ),
  ],
};

export const FragmentActions: Story = {
  args: {
    actions: (
      <>
        <Button size="sm" variant="outline">
          Sync lyrics
        </Button>
        <Button size="sm" variant="outline">
          Write metadata
        </Button>
      </>
    ),
  },
};
