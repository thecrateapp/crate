import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminOpsCheckpoint } from "../../design-system-preview/admin-ops-checkpoint";

const meta = {
  id: "reviews-admin-operations-solid",
  title: "Reviews/Admin/Operations",
  component: AdminOpsCheckpoint,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof AdminOpsCheckpoint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SolidSurfaces: Story = {
  render: () => (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <AdminOpsCheckpoint />
    </main>
  ),
};
