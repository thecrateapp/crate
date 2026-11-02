import type { Meta, StoryObj } from "@storybook/react-vite";
import { ObservabilityIntegrityReview } from "../reviews/ObservabilityIntegrityReview";

const meta = {
  id: "reviews-observability-integrity",
  title: "Reviews/Observability/Collection integrity",
  component: ObservabilityIntegrityReview,
  parameters: { layout: "fullscreen", controls: { disable: true } },
} satisfies Meta<typeof ObservabilityIntegrityReview>;

export default meta;
type Story = StoryObj<typeof meta>;
export const CollectionStates: Story = {};
