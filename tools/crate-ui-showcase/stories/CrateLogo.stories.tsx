import type { Meta, StoryObj } from "@storybook/react-vite";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
const meta = {
  id: "components-cratelogo",
  title: "Components/Foundations/CrateLogo",
  component: CrateLogo,
  args: { title: "Crate", size: 64 },
} satisfies Meta<typeof CrateLogo>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Decorative: Story = { args: { title: undefined } };
export const WithoutEffects: Story = { args: { effects: false } };
export const ReducedMotion: Story = { args: { reducedMotion: true } };
export const Multiple: Story = {
  render: () => (
    <div className="showcase-line">
      <CrateLogo title="First Crate" size={48} />
      <CrateLogo title="Second Crate" size={48} />
    </div>
  ),
};
