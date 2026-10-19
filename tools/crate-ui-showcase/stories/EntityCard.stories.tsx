import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
const meta = {
  id: "components-entitycard",
  title: "Components/Data Display/EntityCard",
  component: EntityCard,
  args: {
    title: "Luz de octubre",
    subtitle: "Costa Norte",
    href: "/album/sample",
    layout: "rail",
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof EntityCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};

export const Active: Story = { args: { active: true } };
export const Selected: Story = { args: { selected: true } };
export const Disabled: Story = { args: { disabled: true } };
export const FullText: Story = {
  args: {
    truncate: false,
    title: "AnUnbrokenTitleThatNeedsToWrapWithoutEscapingTheCollection",
    subtitle:
      "A longer subtitle which remains readable within its available width.",
    meta: 0,
  },
};
