import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  SectionHeader,
  SectionActionLabel,
  SectionActionButton,
} from "@crate/ui/domain/lists/SectionHeader";
import { FormField } from "@crate/ui/primitives/FormField";
const meta = {
  id: "components-sectionheader",
  title: "Components/Layout/SectionHeader",
  component: SectionHeader,
  args: {
    title: "Recent albums",
    subtitle: "From your collection.",
    eyebrow: "Collection",
    count: 0,
    actionLabel: "View All",
    onAction: () => {},
  },
  argTypes: {
    size: { control: "radio", options: ["md", "lg", "display"] },
    as: { control: "select", options: ["h1", "h2", "h3", "h4"] },
  },
} satisfies Meta<typeof SectionHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};
export const Large: Story = { args: { size: "lg", count: 12 } };
export const Display: Story = { args: { size: "display" } };
export const WithoutContext: Story = {
  args: {
    eyebrow: undefined,
    subtitle: undefined,
    count: undefined,
    actionLabel: undefined,
    onAction: undefined,
  },
};
export const LongContent: Story = {
  args: {
    title: "Averylongunbrokensectionnamethatwrapswithoutclipping",
    subtitle:
      "A translated description remains fully readable beside the action.",
  },
  decorators: [
    (Story) => (
      <div className="showcase-narrow">
        <Story />
      </div>
    ),
  ],
};
export const NativeLink: Story = {
  args: {
    actionLabel: undefined,
    onAction: undefined,
    action: (
      <a
        className="link-accent inline-flex min-h-11 items-center"
        href="#section-destination"
      >
        <SectionActionLabel>View All</SectionActionLabel>
      </a>
    ),
  },
};

export const TextAlignedAction: Story = {
  render: () => (
    <FormField kind="group" label="Text-aligned contextual action">
      {(props) => (
        <div {...props} role="group">
          <p className="text-sm text-text-muted">
            A contextual action starts at the same edge as its preceding text.
          </p>
          <SectionActionButton>Show more</SectionActionButton>
        </div>
      )}
    </FormField>
  ),
};
