import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandLoadingExample } from "../reviews/WebClosureSamples";
const meta = {
  id: "components-crateloader",
  title: "Components/Feedback/CrateLoader",
  component: BrandLoadingExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof BrandLoadingExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
