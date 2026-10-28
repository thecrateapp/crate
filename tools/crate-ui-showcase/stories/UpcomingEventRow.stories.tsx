import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpcomingEventRow } from "@crate/ui/domain/shows/UpcomingEventRow";
import { UpcomingRowStates } from "../fixtures/ProgressUpcomingSamples";
const meta = {
  id: "components-upcomingeventrow",
  title: "Components/Data Display/UpcomingEventRow",
  component: UpcomingEventRow,
  args: {
    artwork: null,
    details: "Read-only event",
    date: null,
    actions: null,
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof UpcomingEventRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const IdentityAndActions: Story = {
  render: () => <UpcomingRowStates />,
};
