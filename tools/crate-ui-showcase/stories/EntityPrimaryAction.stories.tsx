import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { EntityPrimaryAction } from "@crate/ui/domain/entity/EntityPrimaryAction";
const meta = {
  id: "components-entityprimaryaction",
  title: "Components/Actions/EntityPrimaryAction",
  component: EntityPrimaryAction,
  args: {
    href: "/album/sample",
    className: "flex min-h-11 items-center px-3",
    children: "Open album",
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof EntityPrimaryAction>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const SelectionToggle: Story = {
  args: {
    href: undefined,
    onOpen: () => {},
    pressed: true,
    children: "Selected album",
  },
};

export const InternalLink: Story = {
  args: { href: "/albums/october", children: "Open album" },
};
export const ExternalLink: Story = {
  args: {
    href: "https://example.org/album",
    external: true,
    children: "External album",
  },
};
export const Callback: Story = {
  args: { href: undefined, onOpen: () => {}, children: "Open album callback" },
};
export const Disabled: Story = {
  args: {
    href: "/albums/october",
    disabled: true,
    children: "Unavailable album",
  },
};
