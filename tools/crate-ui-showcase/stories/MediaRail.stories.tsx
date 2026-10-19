import type { Meta, StoryObj } from "@storybook/react-vite";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import { MemoryRouter } from "react-router";
import { MediaRail } from "@crate/ui/domain/lists/MediaRail";
const cards = (grid: boolean) =>
  ["Luz de octubre", "Bruma", "Marea", "Horizonte"].map((title, index) => (
    <EntityCard
      key={title}
      title={title}
      subtitle="Costa Norte"
      layout={grid ? "grid" : "rail"}
      cover={{ src: IMAGE_SAMPLES[index % 2] }}
      menuButton="none"
      href="/album/sample"
    />
  ));
const meta = {
  id: "components-mediarail",
  title: "Components/Layout/MediaRail",
  component: MediaRail,
  args: { children: cards(false) },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof MediaRail>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Base: Story = {};

export const Columns: Story = {
  args: { fit: "columns", label: "Albums", children: cards(true) },
};
