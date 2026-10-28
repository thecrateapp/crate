import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
const meta = {
  id: "components-errorstate",
  title: "Components/Feedback/ErrorState",
  component: ErrorState,
  args: {
    variant: "page",
    title: "The service is unavailable",
    message: "Try again while keeping your place.",
    statusCode: 503,
    onRetry: () => {},
  },
} satisfies Meta<typeof ErrorState>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};

export const Compact: Story = {
  args: { variant: "compact", statusCode: undefined },
};
export const NotFound: Story = {
  args: {
    kind: "notFound",
    title: "Collection not found",
    statusCode: 404,
    onRetry: undefined,
  },
};
export const Unavailable: Story = {
  args: {
    kind: "unavailable",
    title: "This collection is unavailable",
    statusCode: undefined,
  },
};
