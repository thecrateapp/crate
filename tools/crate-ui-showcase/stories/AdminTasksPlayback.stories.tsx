import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { AdminTaskPlaybackReview } from "../../design-system-preview/admin-task-playback-review";

const meta = {
  title: "Reviews/Admin/Tasks and Playback Delivery",
  component: AdminTaskPlaybackReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminTaskPlaybackReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TaskDeskAndPlayback: Story = {
  render: () => (
    <MemoryRouter initialEntries={["/tasks"]}>
      <AdminTaskPlaybackReview />
    </MemoryRouter>
  ),
};
