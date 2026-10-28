import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
const meta = {
  id: "components-filterchip",
  title: "Components/Forms/FilterChip",
  component: FilterChip,
  args: { children: "Available only", active: false },
  argTypes: { className: { table: { disable: true } } },
} satisfies Meta<typeof FilterChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Interactive: Story = {
  render: function Interactive() {
    const [active, setActive] = useState(false);
    return (
      <div className="showcase-line">
        <FilterChip active={active} onClick={() => setActive(!active)}>
          Available only
        </FilterChip>
        <FilterChip disabled>Unavailable</FilterChip>
        <FilterChip variant="action" onClick={() => setActive(false)}>
          Reset
        </FilterChip>
      </div>
    );
  },
};
