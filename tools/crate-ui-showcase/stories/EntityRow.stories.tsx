import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
const meta = {
  id: "components-entityrow",
  title: "Components/Data Display/EntityRow",
  component: EntityRow,
  args: {
    title: "Luz de octubre",
    subtitle: "Costa Norte",
    href: "/album/sample",
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof EntityRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};

export const Active: Story = { args: { active: true } };
export const Selected: Story = { args: { selected: true } };
export const Disabled: Story = { args: { disabled: true } };
export const SelectionToggle: Story = {
  args: { href: undefined, onOpen: () => {}, selected: true, pressed: true },
};
export const FullText: Story = {
  args: {
    truncate: false,
    title: "AnUnbrokenTitleThatNeedsToWrapWithoutEscapingTheCollection",
    subtitle:
      "A longer subtitle which remains readable within its available width.",
    meta: 0,
  },
};

export const RichIdentity: Story = {
  args: {
    title: "Jane McKay",
    href: undefined,
    titleContent: <a href="/users/DJCase">Jane McKay</a>,
    subtitle: "@DJCase",
  },
};
