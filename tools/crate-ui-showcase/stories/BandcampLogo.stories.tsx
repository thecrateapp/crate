import type { Meta, StoryObj } from "@storybook/react-vite";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
const meta = {
  id: "components-bandcamplogo",
  title: "Components/Foundations/BandcampLogo",
  component: BandcampLogo,
  args: { size: 48 },
} satisfies Meta<typeof BandcampLogo>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Decorative: Story = { args: { "aria-hidden": true } };
export const Named: Story = { args: { "aria-label": "Bandcamp profile" } };
