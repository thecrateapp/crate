import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { TracksExample } from "../reviews/CollectionsReview";
import { TrackList } from "@crate/ui/domain/tracks/TrackList";
const TypedTrackList = TrackList<{ id: number; title: string }>;
const meta = {
  id: "components-tracklist",
  title: "Components/Data Display/TrackList",
  component: TypedTrackList,
  args: {
    items: [{ id: 1, title: "Marea" }],
    itemKey: (row: { id: number }) => row.id,
    renderRow: (row: { title: string }) => <span>{row.title}</span>,
    label: "Sample tracks",
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof TypedTrackList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};

export const Empty: Story = { args: { items: [], empty: <p>No tracks.</p> } };
export const Many: Story = {
  args: {
    items: [
      { id: 1, title: "Marea" },
      { id: 2, title: "Horizonte" },
    ],
    header: 0,
  },
};
export const ListenPlayback: Story = { render: () => <TracksExample /> };
