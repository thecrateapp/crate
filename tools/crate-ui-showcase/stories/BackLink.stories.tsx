import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { BackLink } from "@crate/ui/domain/navigation/BackLink";
const meta = {
  id: "components-backlink",
  title: "Components/Navigation/BackLink",
  component: BackLink,
  args: { label: "Back to collection", to: "/collection?tab=albums" },
  argTypes: { variant: { control: "radio", options: ["text", "icon"] } },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof BackLink>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Icon: Story = { args: { variant: "icon" } };
export const Button: Story = { args: { to: undefined, onClick: () => {} } };
export const LongContent: Story = {
  args: { label: "Back to the collection with a longer translated name" },
  decorators: [
    (Story) => (
      <div className="showcase-narrow">
        <Story />
      </div>
    ),
  ],
};
