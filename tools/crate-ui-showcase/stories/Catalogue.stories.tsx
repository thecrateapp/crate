import type { Meta, StoryObj } from "@storybook/react-vite";
import { CatalogueTable } from "../components/Catalogue";
const meta = {
  id: "system-inventory",
  title: "System/Inventory",
  component: CatalogueTable,
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof CatalogueTable>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Catalogue: Story = {};
