import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpcomingDateStamp } from "@crate/ui/domain/shows/UpcomingDateStamp";
import { DateStampStates } from "../fixtures/ProgressUpcomingSamples";
const meta = {
  id: "components-upcomingdatestamp",
  title: "Components/Data Display/UpcomingDateStamp",
  component: UpcomingDateStamp,
  args: { date: "2028-02-29", locale: "en-US" },
} satisfies Meta<typeof UpcomingDateStamp>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const CalendarStates: Story = { render: () => <DateStampStates /> };
